// Builds the site into site/dist/: the landing page (src/page.html with its placeholders
// filled in; see lib/template.mjs), the docs pages (made from README.md, SECURITY.md,
// CHANGELOG.md and bench/README.md by lib/markdown.mjs, in src/docs.html), their styles,
// script and icons, and assets/.
//
//   node site/build.mjs              build from what's in src/, captured/ and assets/
//   node site/build.mjs --capture    first run brokit for real and keep what it printed
//                                    and drew: captured/*.txt and *.json, assets/*.png
//                                    (needs Chrome); then build
//   node site/build.mjs --capture-examples   only the examples (examples/, see
//                                    lib/examples.mjs): their output and pictures; then build
//   node site/build.mjs --out public build into another folder (GitLab Pages serves public/)
//
// Everything brokit says on the page is captured from real runs, on the demo pages in
// demo/ and the steps in examples/, so the page can't drift from the tool. Captures are
// kept (and committed), so a plain build gives the same page every time, which the
// site's own checks (site/checks/) compare with their baselines.

import { execFile } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../src/index.mjs';
import { EXAMPLES } from './lib/examples.mjs';
import { markdown } from './lib/markdown.mjs';
import { escape, render } from './lib/template.mjs';

const SITE = dirname(fileURLToPath(import.meta.url));
const BIN = join(SITE, '..', 'bin', 'brokit.mjs');
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT = resolve(outArg >= 0 ? args[outArg + 1] ?? '' : join(SITE, 'dist'));
const ASSETS = ['before.png', 'after.png', 'diff.png', 'og.png'];

// The docs pages: made from the repository's own Markdown, so there's one text to keep.
// The README introduces brokit, site/docs/ has the guides and references, examples/ the
// examples; each group is a heading in the docs' side bar.
const ROOT = join(SITE, '..');
const GUIDE = (file, name, title, description) => ({ source: `site/docs/${file}.md`, page: `${file}.html`, name, title, description });
const GROUPS = [
  ['Start', [
    { source: 'README.md', page: 'docs.html', name: 'Introduction', title: 'Documentation', description: 'What brokit is, who it is for, how to install it, and where to read on.' },
    GUIDE('getting-started', 'Getting started', 'Getting started', 'From installing brokit to a first check with a baseline screenshot, in ten minutes.'),
  ]],
  ['Guides', [
    GUIDE('steps', 'Steps and expectations', 'Steps and expectations', 'Every step brokit can take on a page (clicks, typing, touch, input methods, screens) and every way to check what it shows.'),
    GUIDE('scenarios', 'Scenarios', 'Scenarios', 'Scenario files: the page, its screen and its steps together; when a page is ready; JS scenarios for checks that need logic.'),
    GUIDE('checks', 'Checks and baselines', 'Checks and baselines', 'brokit check, baseline screenshots, motion, tolerances, ignored regions and comparing images.'),
    GUIDE('chrome', 'Chrome and safety', 'Chrome and safety', 'Which Chrome brokit uses, brokit doctor, installing and pinning Chrome, serving files, and what brokit allows.'),
    GUIDE('ci', 'CI and containers', 'CI and containers', 'brokit in GitHub Actions, GitLab CI and Docker, and for AI agents.'),
  ]],
  ['Reference', [
    GUIDE('cli', 'Command line', 'Command line', 'Every brokit command, option, exit code and environment variable, and the JSON it prints.'),
    GUIDE('library', 'Node.js library', 'Node.js library', 'brokit as a library: launch, Browser, Page, scenarios, images, serving and Chrome.'),
  ]],
  ['Examples', [
    { source: 'examples/README.md', page: 'examples.html', name: 'All examples', title: 'Examples', description: 'Small apps with their brokit checks, each run for real to make these pages.' },
    ...EXAMPLES.map((e) => ({ source: `examples/${e.dir}/README.md`, page: `example-${e.dir}.html`, name: e.name, title: `Example: ${e.name}`, description: e.description, example: e })),
  ]],
  ['Project', [
    { source: 'SECURITY.md', page: 'security.html', name: 'Security', title: 'Security', description: 'What brokit promises about the browser, pages, files and downloads, and how to report a vulnerability.' },
    { source: 'CHANGELOG.md', page: 'changelog.html', name: 'Changelog', title: 'Changelog', description: 'What changed in each version of brokit.' },
    { source: 'bench/README.md', page: 'benchmark.html', name: 'Benchmark', title: 'Benchmark', description: 'brokit next to Playwright and Puppeteer: the same work in the same Chrome, measured the same way.' },
  ]],
];
const DOCS = GROUPS.flatMap(([group, docs]) => docs.map((d) => ({ ...d, group })));
// Other files the docs link to, published next to the pages.
const PUBLISHED = { 'LICENSE-MIT': 'LICENSE-MIT.txt', 'LICENSE-APACHE': 'LICENSE-APACHE.txt' };

/**
 * Where a link in a Markdown file goes on the site: another docs page, a published file,
 * the repository (when site.json names it), or nowhere (null: its text stays, unlinked).
 * `extra` collects files to publish.
 */
function siteLink(source, href, { repo, branch, extra }) {
  if (/^(https?:|#|mailto:)/.test(href)) return href;
  const [path, hash = ''] = href.split('#');
  const target = posix.normalize(posix.join(posix.dirname(source), path)).replace(/\/$/, '');
  // A page, or a folder whose README is a page (examples/form/ is that example's page).
  const doc = DOCS.find((d) => d.source === target || d.source === `${target}/README.md`);
  if (doc) return doc.page + (hash ? `#${hash}` : '');
  if (PUBLISHED[target]) return PUBLISHED[target];
  if (/^bench\/results\/[\w.-]+\.json$/.test(target)) {
    extra.set(target, `bench-results/${posix.basename(target)}`);
    return `bench-results/${posix.basename(target)}`;
  }
  // Pictures the site keeps (site/assets/...) are published with it.
  if (/^site\/assets\/[\w./-]+\.(png|svg|jpg)$/.test(target) && !target.includes('..')) {
    const to = target.slice('site/'.length);
    extra.set(target, to);
    return to;
  }
  if (repo) return `${repo.replace(/\/$/, '')}/${statSync(join(ROOT, target), { throwIfNoEntry: false })?.isDirectory() ? 'tree' : 'blob'}/${branch}/${target}`;
  return null;
}

/**
 * The site's directives in a Markdown file, each alone on its line as an HTML comment
 * (GitHub shows nothing for them): `<!-- include: path -->` shows that file (relative to
 * the Markdown file) as code; `<!-- output -->`, on an example's page, what its command
 * printed when captured. Other comments are dropped.
 */
function expand(md, doc) {
  return md.replace(/^<!--\s*([\s\S]*?)\s*-->[ \t]*$/gm, (whole, body) => {
    const include = /^include:\s*(\S+)$/.exec(body);
    if (include) {
      const file = posix.normalize(posix.join(posix.dirname(doc.source), include[1]));
      if (file.startsWith('..')) throw new Error(`${doc.source}: ${whole}: outside the repository`);
      let text;
      try {
        text = readFileSync(join(ROOT, file), 'utf8').replace(/\n+$/, '');
      } catch {
        throw new Error(`${doc.source}: ${whole}: no such file ${file}`);
      }
      const lang = { json: 'json', mjs: 'js', js: 'js', html: 'html', css: 'css', sh: 'sh', yml: 'yaml', yaml: 'yaml' }[posix.extname(file).slice(1)] ?? '';
      return `\`\`\`${lang || 'text'} ${include[1]}\n${text}\n\`\`\``;
    }
    if (body === 'output') {
      if (!doc.example) throw new Error(`${doc.source}: ${whole}: only an example's page has output`);
      let text;
      try {
        text = readFileSync(join(SITE, 'captured', 'examples', `${doc.example.dir}.txt`), 'utf8').replace(/\n+$/, '');
      } catch {
        throw new Error(`${doc.source}: ${whole}: nothing captured for ${doc.example.dir} yet (run node site/build.mjs --capture)`);
      }
      return `\`\`\`\n${text}\n\`\`\``;
    }
    if (/^(include|output)\b/.test(body)) throw new Error(`${doc.source}: ${whole}: write <!-- include: path --> or <!-- output -->`);
    return '';
  });
}

function build() {
  const values = JSON.parse(readFileSync(join(SITE, 'captured', 'values.json'), 'utf8'));
  const { repo, branch = 'main', url = '' } = JSON.parse(readFileSync(join(SITE, 'site.json'), 'utf8'));
  // Where the site is published, for share cards (which need absolute links) and the
  // page's canonical address; without it, relative links and none.
  const base = url ? escape(url.replace(/\/?$/, '/')) : '';
  const canonical = (page) => (base ? `<meta property="og:url" content="${base}${page}">\n<link rel="canonical" href="${base}${page}">` : '');
  mkdirSync(join(OUT, 'assets'), { recursive: true });

  // The repository, where the site knows it: a link in the bar and the footer.
  const host = repo ? (/gitlab\.com/.test(repo) ? 'GitLab' : 'GitHub') : null;
  const source = repo ? `<a href="${escape(repo)}" rel="noopener">${host}</a>` : '';
  const landingNav = ['<a href="#overview">Overview</a>', '<a href="#steps">Steps</a>', '<a href="#pixels">Diffs</a>', '<a href="#checks">Checks</a>', '<a href="docs.html">Docs</a>', '<a href="examples.html">Examples</a>', source, '<a class="button small" href="#install">Install</a>'].filter(Boolean).join('\n      ');
  const html = render('src/page.html', { root: SITE, values, slots: { nav: landingNav, source, base, canonical: canonical('') } });
  writeFileSync(join(OUT, 'index.html'), html);

  const extra = new Map();
  const sizes = [`index.html ${(html.length / 1024).toFixed(1)} KB`];
  for (const [k, doc] of DOCS.entries()) {
    // A heading that's a picture (the README's logo, for GitHub and npm) is its alt text
    // here: the page's header shows the logo already, and the converter keeps no HTML.
    const md = expand(readFileSync(join(ROOT, doc.source), 'utf8').replace(/^<h1>[\s\S]*?\balt="([^"]+)"[\s\S]*?<\/h1>\n/, '# $1\n'), doc);
    const { html: content, toc } = markdown(md, { link: (href) => siteLink(doc.source, href, { repo, branch, extra }) });
    const current = (d) => (d?.page === doc.page ? ' aria-current="page"' : '');
    const inDocs = (d) => d.group !== 'Project' && d.group !== 'Examples';
    const nav = [
      `<a href="docs.html"${inDocs(doc) ? ' aria-current="page"' : ''}>Docs</a>`,
      `<a href="examples.html"${doc.group === 'Examples' ? ' aria-current="page"' : ''}>Examples</a>`,
      `<a href="changelog.html"${current(DOCS.find((d) => d.page === 'changelog.html'))}>Changelog</a>`,
      source,
      '<a class="button small" href="getting-started.html">Get started</a>',
    ].filter(Boolean).join('\n      ');
    const pages = GROUPS.map(([group, docs]) => `<p class="docs-group">${escape(group)}</p>\n      ${docs.map((d) => `<a href="${d.page}"${current(d)}>${escape(d.name)}</a>`).join('\n      ')}`).join('\n      ');
    const list = toc.length
      ? `<ol>\n${toc.map((t) => `        <li class="toc-${t.level}"><a href="#${t.id}">${escape(t.text)}</a></li>`).join('\n')}\n      </ol>`
      : '';
    // Reading on: the page before and after this one, in the side bar's order.
    const [prev, next] = [DOCS[k - 1], DOCS[k + 1]];
    const turn = (d, rel, label) => (d ? `<a class="page-turn ${rel}" href="${d.page}" rel="${rel}"><span>${label}</span>${escape(d.name)}</a>` : '<span></span>');
    const pager = `<nav class="pager" aria-label="Read on">${turn(prev, 'prev', 'Previous')}${turn(next, 'next', 'Next')}</nav>`;
    const edit = repo ? `<p class="edit-page"><a href="${escape(`${repo.replace(/\/$/, '')}/blob/${branch}/${doc.source}`)}" rel="noopener">Edit this page on ${host}</a></p>` : '';
    const page = render('src/docs.html', {
      root: SITE,
      values,
      slots: { nav, pages, toc: list, content, pager, edit, source, base, canonical: canonical(doc.page), name: escape(doc.name), title: escape(doc.title), description: escape(doc.description), file: escape(doc.source) },
    });
    writeFileSync(join(OUT, doc.page), page);
    sizes.push(`${doc.page} ${(page.length / 1024).toFixed(1)} KB`);
  }
  for (const [from, to] of Object.entries(PUBLISHED)) copyFileSync(join(ROOT, from), join(OUT, to));
  for (const [from, to] of extra) {
    mkdirSync(join(OUT, dirname(to)), { recursive: true });
    copyFileSync(join(ROOT, from), join(OUT, to));
  }
  for (const f of ['style.css', 'theme.js', 'main.js', 'favicon.svg', 'fr.png']) copyFileSync(join(SITE, 'src', f), join(OUT, f));
  for (const f of ASSETS) copyFileSync(join(SITE, 'assets', f), join(OUT, 'assets', f));
  console.log(`built ${OUT}: ${sizes.join(', ')}`);
}

/** Run the brokit command in `cwd`; its exit code and output. */
function brokit(argv, cwd) {
  return new Promise((done) => {
    execFile(process.execPath, [BIN, ...argv], { cwd, env: { ...process.env, CI: '' }, timeout: 120000 }, (error, stdout, stderr) => done({ code: error ? error.code : 0, stdout, stderr }));
  });
}

/** The command as the page shows it, then what it printed. */
const transcript = (command, stdout) => `$ ${command}\n${stdout}`;

async function capture() {
  const tmp = mkdtempSync(join(tmpdir(), 'brokit-site-'));
  const captured = join(SITE, 'captured');
  mkdirSync(captured, { recursive: true });
  mkdirSync(join(SITE, 'assets'), { recursive: true });
  try {
    // A small app, as a user would have it: the demo pages and the example steps.
    const app = join(tmp, 'my-app');
    mkdirSync(app);
    for (const f of ['signup.html', 'signup.js', 'card.html', 'card.js', 'demo.css']) copyFileSync(join(SITE, 'demo', f), join(app, f));
    copyFileSync(join(SITE, 'examples', 'steps.json'), join(app, 'steps.json'));

    // The hero: the example steps on the sign-up page, as text and as JSON.
    const command = 'brokit run signup.html --steps steps.json';
    const run = await brokit(command.split(' ').slice(1), app);
    if (run.code !== 0) throw new Error(`the example steps failed:\n${run.stdout}${run.stderr}`);
    writeFileSync(join(captured, 'signup.txt'), transcript(command, run.stdout));
    const json = JSON.parse((await brokit([...command.split(' ').slice(1), '--json'], app)).stdout);
    const steps = json.steps.filter((s) => s.label.startsWith('click') || s.label.startsWith('expect')).map(({ label, ok, value, ms }) => ({ label, ok, ...(value !== undefined ? { value } : {}), ms }));
    writeFileSync(join(captured, 'signup-result.json'), jsonForPage({ url: json.url, ok: json.ok, ready: json.ready, steps, console: json.console, errors: json.errors }));

    // The card, before and after a small change, and brokit diff on the two.
    const [browser, server] = await Promise.all([launch({ gpu: 'software' }), serve(app)]);
    const shots = join(tmp, 'shots');
    mkdirSync(shots);
    let chrome;
    try {
      chrome = (await browser.version()).replace('/', ' ');
      for (const [name, query] of [['before', ''], ['after', '?v=after']]) {
        const page = await browser.newPage({ size: '380x470', dpr: 2 });
        await page.goto(`${server.url}card.html${query}`);
        writeFileSync(join(shots, `${name}.png`), (await page.screenshot()).png);
        await page.close();
      }
    } finally {
      await browser.close();
      await server.close();
    }
    const diff = await brokit(['diff', 'before.png', 'after.png', 'diff.png'], shots);
    if (diff.code !== 1) throw new Error(`brokit diff should find the change:\n${diff.stdout}${diff.stderr}`);
    writeFileSync(join(captured, 'diff.txt'), transcript('brokit diff before.png after.png diff.png', diff.stdout));
    for (const f of ['before.png', 'after.png', 'diff.png']) copyFileSync(join(shots, f), join(SITE, 'assets', f));

    // brokit check on the app: baselines made, then the card changes.
    const checks = join(app, 'checks');
    mkdirSync(checks);
    const steps2 = JSON.parse(readFileSync(join(SITE, 'examples', 'steps.json'), 'utf8')).filter((s) => !s.screenshot);
    const card = (url) => JSON.stringify({ url, viewport: { size: '380x470', dpr: 2 }, steps: [{ screenshot: 'card', baseline: true }] });
    writeFileSync(join(checks, 'card.check.json'), card('/card.html'));
    writeFileSync(join(checks, 'signup.check.json'), JSON.stringify({ url: '/signup.html', ready: "document.readyState === 'complete'", steps: [...steps2, { screenshot: 'welcome', baseline: true }] }));
    writeFileSync(join(checks, 'signup-phone.check.json'), JSON.stringify({ url: '/signup.html', ready: "document.readyState === 'complete'", viewport: { size: '393x852', dpr: 3, mobile: true }, steps: [{ tap: { selector: '#email' } }, ...steps2.slice(1), { screenshot: 'welcome', baseline: true }] }));
    const first = await brokit(['check'], app);
    if (first.code !== 0) throw new Error(`the first brokit check should pass:\n${first.stdout}${first.stderr}`);
    writeFileSync(join(checks, 'card.check.json'), card('/card.html?v=after'));
    const second = await brokit(['check'], app);
    if (second.code !== 1) throw new Error(`the second brokit check should find the card's change:\n${second.stdout}${second.stderr}`);
    writeFileSync(join(captured, 'check.txt'), transcript('brokit check', second.stdout));

    const version = JSON.parse(readFileSync(join(SITE, '..', 'package.json'), 'utf8')).version;
    writeFileSync(join(captured, 'values.json'), `${JSON.stringify({ version, chrome }, null, 2)}\n`);

    // The share card, drawn from its template.
    const og = join(tmp, 'og');
    mkdirSync(og);
    writeFileSync(join(og, 'index.html'), render('src/og.html', { root: SITE, values: {} }));
    for (const f of ['style.css', 'favicon.svg']) cpSync(join(SITE, 'src', f), join(og, f));
    const [b2, s2] = await Promise.all([launch({ gpu: 'software' }), serve(og)]);
    try {
      const page = await b2.newPage({ size: '1200x630' });
      await page.goto(s2.url);
      // A picture can't scroll: everything must fit (captured output can grow).
      const overflowing = await page.eval(`[...document.querySelectorAll('h1, .og-tags, pre')]
        .filter((el) => el.scrollWidth > el.clientWidth || el.getBoundingClientRect().bottom > innerHeight)
        .map((el) => el.tagName.toLowerCase() + (el.className ? '.' + el.className : ''))`);
      if (overflowing.length) throw new Error(`the share card doesn't fit: ${overflowing.join(', ')} (src/og.html, src/style.css)`);
      writeFileSync(join(SITE, 'assets', 'og.png'), (await page.screenshot()).png);

      // The README's logo, light and dark (GitHub shows the one that fits the reader's
      // theme), on a transparent background.
      writeFileSync(join(og, 'logo.html'), render('src/logo.html', { root: SITE, values: {} }));
      const logo = await b2.newPage({ size: '600x200', dpr: 2 });
      await logo.goto(new URL('logo.html', s2.url).href);
      await logo.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
      for (const theme of ['light', 'dark']) {
        await logo.eval(`document.documentElement.dataset.theme = '${theme}'`);
        writeFileSync(join(SITE, 'assets', `logo-${theme}.png`), (await logo.screenshot({ selector: '.brand' })).png);
      }
    } finally {
      await b2.close();
      await s2.close();
    }
    await captureExamples(tmp);
    console.log(`captured: ${chrome}; brokit ${version}; ${EXAMPLES.length} examples`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Run an example as a reader would, in a fresh copy of its folder: `brokit ...` is this
 * brokit's CLI, `node ...` runs with `import 'brokit'` finding this checkout (`reuse`:
 * run again in the copy already there). Resolves to the run's exit code and output, the
 * copy's folder and the files in it afterwards.
 */
export async function runExample(example, into) {
  const dir = join(into, example.dir);
  if (!example.reuse) {
    // Only what's in the repository: no baselines or output from a run here.
    cpSync(join(ROOT, 'examples', example.dir), dir, { recursive: true, filter: (src) => !/[\\/](baselines|brokit-out|node_modules|out)$/.test(src) });
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    symlinkSync(ROOT, join(dir, 'node_modules', 'brokit'), 'junction');
  }
  const [cmd, ...argv] = example.command.split(' ');
  const run = await new Promise((done) => {
    const file = cmd === 'brokit' ? [BIN, ...argv] : argv;
    execFile(process.execPath, file, { cwd: dir, env: { ...process.env, CI: '' }, timeout: 120000 }, (error, stdout, stderr) => done({ code: error ? error.code : 0, stdout, stderr }));
  });
  const files = readdirSync(dir, { recursive: true }).map((f) => f.split(sep).join('/')).filter((f) => !f.startsWith('node_modules'));
  return { ...run, dir, files };
}

async function captureExamples(tmp) {
  const into = join(tmp, 'examples');
  mkdirSync(into);
  mkdirSync(join(SITE, 'captured', 'examples'), { recursive: true });
  for (const example of EXAMPLES) {
    const run = await runExample(example, into);
    if (run.code !== 0) throw new Error(`the ${example.dir} example failed:\n${run.stdout}${run.stderr}`);
    writeFileSync(join(SITE, 'captured', 'examples', `${example.dir}.txt`), transcript(example.command, run.stdout));
    const shots = join(SITE, 'assets', 'examples', example.dir);
    rmSync(shots, { recursive: true, force: true });
    mkdirSync(shots, { recursive: true });
    for (const [from, to] of Object.entries(example.shots ?? {})) copyFileSync(join(run.dir, from), join(shots, to));
  }
}

/** JSON as the page shows it: one key per line, each list item on one line. */
function jsonForPage(value) {
  const inline = (v) => JSON.stringify(v, null, 1).replace(/\n\s*/g, ' ').replace(/\[ /g, '[').replace(/ \]/g, ']');
  const lines = Object.entries(value).map(([k, v]) => {
    if (Array.isArray(v) && v.length) return `  ${JSON.stringify(k)}: [\n${v.map((item) => `    ${inline(item)}`).join(',\n')}\n  ]`;
    return `  ${JSON.stringify(k)}: ${inline(v)}`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}

// Run as a script (not imported by the tests for runExample).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (args.includes('--capture')) await capture();
  else if (args.includes('--capture-examples')) {
    // Only the examples' runs, leaving the landing page's captures as they are.
    const tmp = mkdtempSync(join(tmpdir(), 'brokit-site-'));
    try {
      await captureExamples(tmp);
      console.log(`captured ${EXAMPLES.length} examples`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  build();
}
