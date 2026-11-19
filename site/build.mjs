// Builds the site into site/dist/: the landing page (src/page.html with its placeholders
// filled in; see lib/template.mjs), the docs pages (made from README.md, SECURITY.md,
// CHANGELOG.md and bench/README.md by lib/markdown.mjs, in src/docs.html), their styles,
// script and icons, and assets/.
//
//   node site/build.mjs              build from what's in src/, captured/ and assets/
//   node site/build.mjs --capture    first run brokit for real and keep what it printed
//                                    and drew: captured/*.txt and *.json, assets/*.png
//                                    (needs Chrome); then build
//   node site/build.mjs --out public build into another folder (GitLab Pages serves public/)
//
// Everything brokit says on the page is captured from real runs, on the demo pages in
// demo/ and the steps in examples/, so the page can't drift from the tool. Captures are
// kept (and committed), so a plain build gives the same page every time, which the
// site's own checks (site/checks/) compare with their baselines.

import { execFile } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../src/index.mjs';
import { markdown } from './lib/markdown.mjs';
import { escape, render } from './lib/template.mjs';

const SITE = dirname(fileURLToPath(import.meta.url));
const BIN = join(SITE, '..', 'bin', 'brokit.mjs');
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT = resolve(outArg >= 0 ? args[outArg + 1] ?? '' : join(SITE, 'dist'));
const ASSETS = ['before.png', 'after.png', 'diff.png', 'og.png'];

// The docs pages: made from the repository's own Markdown, so there's one text to keep.
const ROOT = join(SITE, '..');
const DOCS = [
  { source: 'README.md', page: 'docs.html', name: 'Docs', title: 'Documentation', description: 'How to use brokit: steps, scenarios, expectations, baselines, CI, containers and the library.' },
  { source: 'SECURITY.md', page: 'security.html', name: 'Security', title: 'Security', description: 'What brokit promises about the browser, pages, files and downloads, and how to report a vulnerability.' },
  { source: 'CHANGELOG.md', page: 'changelog.html', name: 'Changelog', title: 'Changelog', description: 'What changed in each version of brokit.' },
  { source: 'bench/README.md', page: 'benchmark.html', name: 'Benchmark', title: 'Benchmark', description: 'brokit next to Playwright and Puppeteer: the same work in the same Chrome, measured the same way.' },
];
// Other files the docs link to, published next to the pages.
const PUBLISHED = { 'LICENSE-MIT': 'LICENSE-MIT.txt', 'LICENSE-APACHE': 'LICENSE-APACHE.txt' };

/**
 * Where a link in a Markdown file goes on the site: another docs page, a published file,
 * the repository (when site.json names it), or nowhere (null: its text stays, unlinked).
 * `extra` collects files to publish.
 */
function siteLink(source, href, { repo, extra }) {
  if (/^(https?:|#|mailto:)/.test(href)) return href;
  const [path, hash = ''] = href.split('#');
  const target = posix.normalize(posix.join(posix.dirname(source), path));
  const doc = DOCS.find((d) => d.source === target);
  if (doc) return doc.page + (hash ? `#${hash}` : '');
  if (PUBLISHED[target]) return PUBLISHED[target];
  if (/^bench\/results\/[\w.-]+\.json$/.test(target)) {
    extra.set(target, `bench-results/${posix.basename(target)}`);
    return `bench-results/${posix.basename(target)}`;
  }
  if (repo) return `${repo.replace(/\/$/, '')}/${target.endsWith('/') ? 'tree' : 'blob'}/main/${target}`;
  return null;
}

function build() {
  const values = JSON.parse(readFileSync(join(SITE, 'captured', 'values.json'), 'utf8'));
  const { repo } = JSON.parse(readFileSync(join(SITE, 'site.json'), 'utf8'));
  mkdirSync(join(OUT, 'assets'), { recursive: true });

  const landingNav = ['<a href="#overview">Overview</a>', '<a href="#steps">Steps</a>', '<a href="#pixels">Diffs</a>', '<a href="#checks">Checks</a>', '<a href="docs.html">Docs</a>', '<a class="button small" href="#install">Install</a>'].join('\n      ');
  const html = render('src/page.html', { root: SITE, values, slots: { nav: landingNav } });
  writeFileSync(join(OUT, 'index.html'), html);

  const extra = new Map();
  const sizes = [`index.html ${(html.length / 1024).toFixed(1)} KB`];
  for (const doc of DOCS) {
    // A heading that's a picture (the README's logo, for GitHub and npm) is its alt text
    // here: the page's header shows the logo already, and the converter keeps no HTML.
    const md = readFileSync(join(ROOT, doc.source), 'utf8').replace(/^<h1>[\s\S]*?\balt="([^"]+)"[\s\S]*?<\/h1>\n/, '# $1\n');
    const { html: content, toc } = markdown(md, { link: (href) => siteLink(doc.source, href, { repo, extra }) });
    const current = (d) => (d === doc ? ' aria-current="page"' : '');
    const nav = [...DOCS.map((d) => `<a href="${d.page}"${current(d)}>${d.name}</a>`), '<a class="button small" href="docs.html#quick-start">Get started</a>'].join('\n      ');
    const pages = DOCS.map((d) => `<a href="${d.page}"${current(d)}>${d.name}</a>`).join('\n      ');
    const list = toc.length
      ? `<ol>\n${toc.map((t) => `        <li class="toc-${t.level}"><a href="#${t.id}">${escape(t.text)}</a></li>`).join('\n')}\n      </ol>`
      : '';
    const page = render('src/docs.html', {
      root: SITE,
      values,
      slots: { nav, pages, toc: list, content, title: escape(doc.title), description: escape(doc.description), source: escape(doc.source) },
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
    console.log(`captured: ${chrome}; brokit ${version}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
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

if (args.includes('--capture')) await capture();
build();
