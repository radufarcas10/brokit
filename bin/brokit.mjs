#!/usr/bin/env node
// The brokit command. `brokit help` says what it does.

import { readFileSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { GPU_MODES, launch } from '../src/chrome.mjs';
import { diffImages } from '../src/diff.mjs';
import { doctor } from '../src/doctor.mjs';
import { installChrome, pinnedVersion, pinVersion } from '../src/install.mjs';
import { baselineDir, findScenarios, loadScenario, scenarioName } from '../src/load.mjs';
import { decodePng, encodePng } from '../src/png.mjs';
import { formatCheckEnd, formatDiff, formatEnd, formatReady, formatScenario, formatStart, formatStep } from '../src/report.mjs';
import { checkScenario, checkUrl, runScenario } from '../src/run.mjs';
import { serve } from '../src/serve.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `brokit ${VERSION}: check web pages in a real, headless Chrome

  brokit run <url | page.html | scenario.json | scenario.mjs> [options]
      Open the page, wait until it's ready, run the steps, report what happened:
      each step, the console, errors. Exits 1 if anything failed.
        --steps <file.json>    steps to run on a URL or page (a JSON list)
        --out <file.png>       a screenshot after the last step
        --size <WxH>           the viewport (default 1280x800)
        --dpr <n>              device pixels per CSS pixel (default 1)
        --mobile               a phone: mobile viewport, touch
        --ready <expression>   ready when this is truthy (default: loaded, network quiet)
        --ready-title <title>  ready when document.title is this
        --baselines <dir>      baselines for a URL or page (default brokit-baselines)
        --cpu-profile <file>   profile the page's main thread (.cpuprofile)
      and the options below.

  brokit check [files or folders] [options]
      Run every *.check.json and *.check.mjs (default: under this folder) in one
      Chrome, comparing baseline screenshots. Exits 1 if any failed.
        --filter <text>        only the checks whose name contains this
        --verbose              every step, not just the ones that failed

  Options of run and check:
        --update               replace baselines that differ (missing ones are written
                               anyway, except in CI, where they fail)
        --no-js                don't run JS scenarios (*.mjs are code; use this on a
                               checkout you don't trust)
        --out-dir <dir>        where screenshots and differences go (default brokit-out)
        --timeout <ms>         how long to wait for ready (default 30000)
        --gpu <mode>           ${GPU_MODES.join(' | ')} (run: default; check: software,
                               the same pixels on every machine)
        --serve <dir>          serve this folder for pages and relative URLs (default: .)
        --isolate              serve with cross-origin isolation (COOP/COEP)
        --base <url>           resolve relative URLs against this (a dev server)
        --allow-host <host>    allow a page that isn't on this computer (repeatable)
        --js-flags "<flags>"   V8 flags, for experiments
        --json                 print the result as JSON

  brokit diff <a.png> <b.png> [diff.png] [--tolerance <json>] [--ignore <json>] [--json]
      Compare two images pixel by pixel; write a difference image. Exits 1 if they
      differ more than the tolerance allows (default: not at all).
        --tolerance '{"max": 2}'  '{">8": "0.1%"}'  '{"mean": 0.5}'
        --ignore '[[x, y, width, height], ...]'   regions not compared

  brokit serve [dir] [--port <n>] [--isolate]
      Serve a folder on 127.0.0.1 (no listings, no dotfiles, nothing outside it).

  brokit doctor [--json]
      Check that brokit can work here (Node, Chrome, its sandbox, drawing, fonts, CI),
      and say exactly what to do when it can't. Exits 1 if it can't.

  brokit install-chrome [version | stable | beta | dev | canary] [--pin]
      Download Google's Chrome for Testing into brokit's cache (default: the version
      this project pins, or stable). --pin writes it into package.json, so this project
      uses that version everywhere.

Chrome: BROKIT_CHROME, else the version the project pins, else the Chrome installed on
this computer, else one brokit installed.
Steps and scenarios: see brokit's README.`;

// Ctrl+C and kills end the process normally, so Chrome is closed too.
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

class UsageError extends Error {}

const MAX_JSON = 10 * 1024 * 1024;
function readJson(file, what) {
  let text;
  try {
    if (statSync(file).size > MAX_JSON) throw new UsageError(`${what} ${file} is over 10 MB`);
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if (e instanceof UsageError) throw e;
    throw new UsageError(`can't read ${what} ${file}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new UsageError(`${what} ${file} isn't valid JSON: ${e.message}`);
  }
}
function parseJsonOption(text, name) {
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError(`--${name}: not valid JSON: ${text}`);
  }
}
function number(text, name) {
  const n = Number(text);
  if (text === undefined) return undefined;
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`--${name}: a positive number`);
  return n;
}
const inside = (root, file) => {
  const rel = relative(root, file);
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
};

// Options `run` and `check` share.
const COMMON = {
  'out-dir': { type: 'string' },
  timeout: { type: 'string' },
  gpu: { type: 'string' },
  serve: { type: 'string' },
  isolate: { type: 'boolean' },
  base: { type: 'string' },
  'allow-host': { type: 'string', multiple: true },
  update: { type: 'boolean' },
  'no-js': { type: 'boolean' },
  'js-flags': { type: 'string' },
  json: { type: 'boolean' },
};

// Baselines: --update replaces ones that differ; in CI (the CI variable, which GitHub,
// GitLab and most others set) a missing one fails; anywhere else it's written.
const updateMode = (o) => (o.update ? 'all' : process.env.CI && process.env.CI !== 'false' ? 'none' : 'missing');

// Chrome, or a message saying what went wrong and where to look (not a stack trace).
// With its sandbox off (BROKIT_NO_SANDBOX in a container), a warning every time, and
// no pages from other hosts.
async function startChrome(options, allowHosts = []) {
  let browser;
  try {
    browser = await launch(options);
  } catch (e) {
    if (e.code === 'BROKIT_NO_CHROME') throw new UsageError(`${e.message}\n(brokit doctor checks everything brokit needs)`);
    if (e.code === 'BROKIT_SANDBOX') throw new UsageError(e.message);
    throw new UsageError(`Chrome didn't start: ${e.message.split('\n').filter(Boolean).slice(0, 3).join(' / ')}\nbrokit doctor says why, and what to do about it`);
  }
  if (!browser.sandboxed) {
    if (allowHosts.length) {
      await browser.close();
      throw new UsageError("--allow-host: with Chrome's sandbox off (BROKIT_NO_SANDBOX), brokit opens only pages on this computer");
    }
    process.stderr.write("brokit: Chrome's sandbox is off (BROKIT_NO_SANDBOX, in a container): only pages on this computer are opened\n");
  }
  return browser;
}

async function loadOrFail(file) {
  try {
    return await loadScenario(file);
  } catch (e) {
    throw new UsageError(e.message);
  }
}

async function run(args) {
  const { values: o, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      ...COMMON,
      steps: { type: 'string' },
      out: { type: 'string' },
      size: { type: 'string' },
      dpr: { type: 'string' },
      mobile: { type: 'boolean' },
      ready: { type: 'string' },
      'ready-title': { type: 'string' },
      baselines: { type: 'string' },
      'cpu-profile': { type: 'string' },
    },
  });
  if (positionals.length !== 1) throw new UsageError('brokit run: give one URL, page or scenario (brokit help)');
  const [target] = positionals;
  if (o.gpu && !GPU_MODES.includes(o.gpu)) throw new UsageError(`--gpu: one of ${GPU_MODES.join(', ')}`);

  // What to open: a scenario file, a URL, or a page on disk.
  let scenario;
  let pageFile = null;
  let scenarioFile = null;
  if (/^https?:\/\//i.test(target)) scenario = { url: target };
  else if (/\.(json|mjs)$/i.test(target)) {
    if (o.steps) throw new UsageError('--steps is for a URL or a page; a scenario has its own steps');
    if (o['no-js'] && /\.mjs$/i.test(target)) throw new UsageError(`${target} is a JS scenario (code), and --no-js says not to run any`);
    scenarioFile = resolve(target);
    scenario = await loadOrFail(target);
    if (o.baselines) throw new UsageError("--baselines is for a URL or a page; a scenario's baselines are kept next to it");
  } else {
    pageFile = resolve(target);
    try {
      if (!statSync(pageFile).isFile()) throw new Error();
    } catch {
      throw new UsageError(`no such page: ${target} (give a URL, a page file, or a scenario .json)`);
    }
    scenario = { url: '' };
  }
  if (o.steps) scenario.steps = readJson(o.steps, 'steps');
  if (o.size || o.dpr || o.mobile) {
    scenario.viewport = { ...scenario.viewport, ...(o.size ? { size: o.size } : {}), ...(o.dpr ? { dpr: number(o.dpr, 'dpr') } : {}), ...(o.mobile ? { mobile: true } : {}) };
  }
  if (o.ready !== undefined) [scenario.ready, scenario.readyTitle] = [o.ready, undefined];
  if (o['ready-title'] !== undefined) [scenario.readyTitle, scenario.ready] = [o['ready-title'], undefined];
  const timeout = number(o.timeout, 'timeout');

  // A page on disk, or a relative URL without --base: serve a folder.
  let server = null;
  let base = o.base;
  if (pageFile || (!/^https?:\/\//i.test(scenario.url ?? '') && !base)) {
    const cwd = process.cwd();
    const root = resolve(o.serve ?? (pageFile && !inside(cwd, pageFile) ? dirname(pageFile) : cwd));
    if (pageFile) {
      if (!inside(root, pageFile)) throw new UsageError(`${target} isn't inside the served folder ${root}`);
      scenario.url = relative(root, pageFile).split(sep).map(encodeURIComponent).join('/');
    }
    server = await serve(root, { isolate: Boolean(o.isolate) });
    base = server.url;
  }
  const allowHosts = o['allow-host'] ?? [];
  let url;
  try {
    checkScenario(scenario);
    url = checkUrl(scenario.url, { base, allowHosts });
  } catch (e) {
    await server?.close();
    throw new UsageError(e.message);
  }

  let browser;
  try {
    browser = await startChrome({ gpu: o.gpu, jsFlags: o['js-flags'] ?? null }, allowHosts);
    const text = !o.json;
    if (text) console.log(formatStart(url));
    const result = await runScenario(browser, scenario, {
      outDir: o['out-dir'],
      base,
      allowHosts,
      timeout,
      baselines: { dir: scenarioFile ? baselineDir(scenarioFile) : resolve(o.baselines ?? 'brokit-baselines'), update: updateMode(o) },
      file: scenarioFile,
      screenshot: o.out,
      cpuProfile: o['cpu-profile'],
      onReady: (r) => text && console.log(formatReady(r)),
      onStep: (s) => text && console.log(formatStep(s)),
    });
    console.log(text ? formatEnd(result) : JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  } finally {
    await browser?.close();
    await server?.close();
  }
}

async function check(args) {
  const { values: o, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { ...COMMON, filter: { type: 'string' }, verbose: { type: 'boolean' } },
  });
  const gpu = o.gpu ?? 'software';
  if (!GPU_MODES.includes(gpu)) throw new UsageError(`--gpu: one of ${GPU_MODES.join(', ')}`);
  const timeout = number(o.timeout, 'timeout');
  const cwd = process.cwd();

  // Every scenario is read and checked before Chrome starts: a typo fails in milliseconds.
  let files;
  try {
    files = await findScenarios(positionals.length ? positionals : ['.']);
  } catch (e) {
    throw new UsageError(e.message);
  }
  if (!files.length) throw new UsageError(`no checks in ${positionals.join(', ') || 'this folder'}: name scenario files *.check.json or *.check.mjs`);
  // --no-js: JS scenarios are code; only JSON ones run (for a checkout you don't trust).
  const skipped = o['no-js'] ? files.filter((f) => /\.mjs$/i.test(f)).length : 0;
  if (skipped) files = files.filter((f) => !/\.mjs$/i.test(f));
  if (!files.length) throw new UsageError(`only JS checks here, and --no-js skips them (${skipped})`);
  const checks = [];
  for (const file of files) {
    const rel = relative(cwd, file);
    const name = rel.startsWith('..') || isAbsolute(rel) ? scenarioName(file) : rel.replace(/(\.check)?\.(json|mjs)$/, '').split(sep).join('/');
    if (o.filter && !name.includes(o.filter)) continue;
    checks.push({ file, name, scenario: await loadOrFail(file) });
  }
  if (!checks.length) throw new UsageError(`no checks match --filter ${o.filter}`);

  let server = null;
  let base = o.base;
  if (!base && checks.some((c) => !/^https?:\/\//i.test(c.scenario.url))) {
    server = await serve(resolve(o.serve ?? cwd), { isolate: Boolean(o.isolate) });
    base = server.url;
  }
  const allowHosts = o['allow-host'] ?? [];
  try {
    for (const c of checks) checkUrl(c.scenario.url, { base, allowHosts });
  } catch (e) {
    await server?.close();
    throw new UsageError(e.message);
  }

  const update = updateMode(o);
  const outRoot = resolve(o['out-dir'] ?? 'brokit-out');
  const text = !o.json;
  let browser;
  try {
    browser = await startChrome({ gpu, jsFlags: o['js-flags'] ?? null }, allowHosts);
    if (text) {
      const notes = [update === 'none' ? 'CI (missing baselines fail)' : update === 'all' ? 'updating baselines' : '', skipped ? `${skipped} JS check${skipped === 1 ? '' : 's'} skipped (--no-js)` : ''].filter(Boolean);
      console.log(`brokit check: ${checks.length} scenario${checks.length === 1 ? '' : 's'}, ${(await browser.version()).replace('/', ' ')}, ${gpu} drawing${notes.map((n) => `, ${n}`).join('')}`);
    }
    const start = Date.now();
    const results = [];
    for (const c of checks) {
      const r = await runScenario(browser, c.scenario, {
        outDir: join(outRoot, ...c.name.split('/')),
        base,
        allowHosts,
        timeout,
        baselines: { dir: baselineDir(c.file), update },
        file: c.file,
      });
      results.push({ name: c.name, file: relative(cwd, c.file), ...r });
      if (text) console.log(formatScenario(c.name, r, Boolean(o.verbose)));
    }
    const ms = Date.now() - start;
    const ok = results.every((r) => r.ok);
    console.log(text ? formatCheckEnd(results, ms) : JSON.stringify({ ok, ms, gpu, scenarios: results }, null, 2));
    return ok ? 0 : 1;
  } finally {
    await browser?.close();
    await server?.close();
  }
}

async function diff(args) {
  const { values: o, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { tolerance: { type: 'string' }, ignore: { type: 'string' }, json: { type: 'boolean' } },
  });
  if (positionals.length < 2 || positionals.length > 3) throw new UsageError('brokit diff a.png b.png [diff.png]');
  const [fa, fb, fout] = positionals;
  const load = (f) => {
    try {
      return decodePng(readFileSync(f));
    } catch (e) {
      throw new UsageError(`${f}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`);
    }
  };
  let d;
  try {
    d = diffImages(load(fa), load(fb), {
      tolerance: o.tolerance ? parseJsonOption(o.tolerance, 'tolerance') : undefined,
      ignore: o.ignore ? parseJsonOption(o.ignore, 'ignore') : undefined,
    });
  } catch (e) {
    throw e instanceof UsageError ? e : new UsageError(e.message);
  }
  if (fout && d.image) await writeFile(fout, encodePng(d.image));
  if (o.json) {
    const { image, ...rest } = d;
    console.log(JSON.stringify({ a: fa, b: fb, ...rest, ...(fout && image ? { diffImage: resolve(fout) } : {}) }, null, 2));
  } else console.log(formatDiff(fa, fb, d, fout && d.image ? resolve(fout) : null));
  return d.pass ? 0 : 1;
}

async function doctorCommand(args) {
  const { values: o } = parseArgs({ args, options: { json: { type: 'boolean' } } });
  const mark = { ok: '✓', warn: '!', fail: '✗' };
  if (!o.json) console.log('brokit doctor');
  const result = await doctor({
    onCheck: (c) => {
      if (o.json) return;
      console.log(`  ${mark[c.status]} ${c.name}: ${c.detail}`);
      if (c.fix) console.log(`      fix: ${c.fix}`);
    },
  });
  console.log(o.json ? JSON.stringify(result, null, 2) : result.ok ? 'brokit is ready here' : 'brokit can\'t work here yet: see the fixes above');
  return result.ok ? 0 : 1;
}

async function installChromeCommand(args) {
  const { values: o, positionals } = parseArgs({ args, allowPositionals: true, options: { pin: { type: 'boolean' }, json: { type: 'boolean' } } });
  if (positionals.length > 1) throw new UsageError('brokit install-chrome [version | stable | beta | dev | canary] [--pin]');
  const pin = pinnedVersion();
  const wanted = positionals[0] ?? pin?.version ?? 'stable';
  // Progress on stderr: a line redrawn in a terminal, a line per 10% elsewhere (CI logs).
  let last = -1;
  const progress = ({ phase, done, total }) => {
    if (o.json) return;
    const pct = total ? Math.floor((100 * done) / total) : 0;
    const line = phase === 'download' ? `downloading ${(done / 1e6).toFixed(0)}${total ? ` of ${(total / 1e6).toFixed(0)}` : ''} MB` : `unpacking ${done} of ${total} files`;
    if (process.stderr.isTTY) process.stderr.write(`\r  ${line}  `);
    else if (Math.floor(pct / 10) !== last) {
      last = Math.floor(pct / 10);
      process.stderr.write(`  ${line}\n`);
    }
    if (phase === 'unpack' && done === total) last = -1;
  };
  if (!o.json) console.error(`brokit install-chrome: Chrome for Testing ${wanted}${pin && !positionals[0] ? ` (pinned in ${pin.from})` : ''}`);
  let r;
  try {
    r = await installChrome(wanted, { onProgress: progress });
  } catch (e) {
    if (process.stderr.isTTY) process.stderr.write('\n');
    throw new UsageError(e.message);
  }
  if (process.stderr.isTTY && r.fresh) process.stderr.write('\n');
  let pinned = null;
  if (o.pin) {
    const file = resolve('package.json');
    try {
      await pinVersion(file, r.version);
      pinned = file;
    } catch (e) {
      throw new UsageError(`installed, but couldn't pin it in ${file}: ${e.code === 'ENOENT' ? 'no package.json here (set BROKIT_CHROME_VERSION instead)' : e.message}`);
    }
  }
  if (o.json) console.log(JSON.stringify({ ...r, ...(pinned ? { pinned } : {}) }, null, 2));
  else {
    console.log(`${r.fresh ? 'installed' : 'already installed'}: Chrome ${r.version} at ${r.path}`);
    if (pinned) console.log(`pinned in ${pinned}: brokit uses Chrome ${r.version} for this project, here and in CI (run brokit install-chrome there first)`);
    else if (!pin) console.log(`brokit uses it when the computer has no Chrome of its own; to use it for this project everywhere: brokit install-chrome ${r.version} --pin`);
  }
  return 0;
}

async function serveCommand(args) {
  const { values: o, positionals } = parseArgs({ args, allowPositionals: true, options: { port: { type: 'string' }, isolate: { type: 'boolean' } } });
  const port = o.port === undefined ? 8080 : Number(o.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError('--port: 0 to 65535');
  const s = await serve(positionals[0] ?? '.', { port, isolate: Boolean(o.isolate) });
  console.log(`brokit: serving ${s.root} at ${s.url} (Ctrl+C to stop)`);
  return new Promise(() => {});
}

const [command, ...rest] = process.argv.slice(2);
const commands = { run, check, diff, serve: serveCommand, doctor: doctorCommand, 'install-chrome': installChromeCommand };
try {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    process.exit(0);
  }
  if (command === '--version' || command === 'version') {
    console.log(VERSION);
    process.exit(0);
  }
  if (!commands[command]) throw new UsageError(`unknown command ${JSON.stringify(command)} (brokit help)`);
  process.exitCode = await commands[command](rest);
} catch (e) {
  if (e instanceof UsageError || e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || e.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' || e.code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL' || e.code === 'BROKIT_NO_CHROME') {
    console.error(`brokit: ${e.message}`);
    process.exitCode = 2;
  } else {
    console.error(e);
    process.exitCode = 2;
  }
}
