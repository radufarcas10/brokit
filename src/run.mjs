// Run a scenario: open its page, wait until it's ready, run its steps, and report what
// happened, step by step, with what the page logged and threw.
//
// A scenario:
//   {
//     "url": "/form.html",               (absolute, or relative to `base`)
//     "viewport": { "size": "1280x800", "dpr": 1, "mobile": false, "colorScheme": "dark" },
//     "ready": "expression",             (or "readyTitle": "title"; see Page.goto)
//     "timeout": 30000,                  (ms to be ready)
//     "tolerance": { "max": 2 },         (for every baseline screenshot that gives none)
//     "steps": [ ... ],                  (see actions.mjs)
//     "report": "expression"             (evaluated at the end, into the result)
//   }
// or the same keys from a JS module, with `run` (its default export) in place of
// steps: async ({ page, expect, screenshot, step }) => { ... } (see load.mjs).
//
// A run fails if a step fails, if the page throws an uncaught exception, answers an HTTP
// error, or isn't ready in time. A failed action stops the run (what follows would act
// on the wrong page); a failed expectation or baseline doesn't (it changed nothing).

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { describeStep, parseStep, runStep } from './actions.mjs';
import { compareBaseline } from './baseline.mjs';
import { parseTolerance } from './diff.mjs';
import { describeMatcher, mismatch } from './expect.mjs';
import { imageName } from './names.mjs';
import { parseSize } from './page.mjs';

export { imageName };

// What a baseline allows unless told otherwise: a channel off by up to 2 of 255. People
// can't see that, and it's what Chrome's drawing varies by between runs of the same page
// (the blur of a large shadow came out two ways, 23915 pixels apart by at most 2).
// Anything real differs by far more. {"max": 0} asks for pixel-exact.
export const BASELINE_TOLERANCE = { max: 2 };

export const SCENARIO_KEYS =['name', 'note', 'url', 'viewport', 'ready', 'readyTitle', 'timeout', 'tolerance', 'steps', 'run', 'report'];

/** Check a scenario's shape (and every step's); throws with what's wrong. */
export function checkScenario(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('a scenario is an object with at least "url"');
  const unknown = Object.keys(s).filter((k) => !SCENARIO_KEYS.includes(k));
  if (unknown.length) throw new Error(`scenario: unknown ${unknown.join(', ')} (it takes ${SCENARIO_KEYS.filter((k) => k !== 'run').join(', ')})`);
  if (typeof s.url !== 'string' || !s.url) throw new Error('scenario: "url" is required');
  if (s.viewport !== undefined) {
    const v = s.viewport;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('viewport: {"size": "1280x800", "dpr": 1, "mobile": false}');
    const keys = ['size', 'dpr', 'mobile', 'colorScheme', 'reducedMotion'];
    const bad = Object.keys(v).filter((k) => !keys.includes(k));
    if (bad.length) throw new Error(`viewport: unknown ${bad.join(', ')} (${keys.join(', ')})`);
    if (v.size !== undefined) parseSize(v.size);
  }
  for (const k of ['ready', 'readyTitle', 'report', 'name', 'note']) if (s[k] !== undefined && typeof s[k] !== 'string') throw new Error(`${k}: a string`);
  if (s.ready !== undefined && s.readyTitle !== undefined) throw new Error('give "ready" or "readyTitle", not both');
  if (s.timeout !== undefined && !(Number.isFinite(s.timeout) && s.timeout > 0 && s.timeout <= 600000)) throw new Error('timeout: ms, up to 600000');
  if (s.tolerance !== undefined) parseTolerance(s.tolerance);
  if (s.run !== undefined && typeof s.run !== 'function') throw new Error('run: a function');
  if (s.run !== undefined && s.steps !== undefined) throw new Error('give steps or a run function, not both');
  if (s.steps !== undefined) {
    if (!Array.isArray(s.steps)) throw new Error('steps: a list');
    s.steps.forEach((step, i) => {
      try {
        parseStep(step);
      } catch (e) {
        throw new Error(`step ${i + 1}: ${e.message}`);
      }
    });
  }
  return s;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Check that brokit may open `url`: http(s) only, and on this computer unless its host
 * is in `allowHosts`. Returns the URL, resolved against `base` if it's relative.
 */
export function checkUrl(url, { base, allowHosts = [] } = {}) {
  let u;
  try {
    u = new URL(url, base);
  } catch {
    throw new Error(base ? `bad URL: ${url}` : `bad URL: ${url} (a relative URL needs a base: --base, or a page served with --serve)`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`only http and https pages: ${u.href}`);
  if (!LOCAL_HOSTS.has(u.hostname) && !u.hostname.endsWith('.localhost') && !allowHosts.includes(u.hostname)) {
    throw new Error(`${u.hostname} isn't on this computer; allow it with --allow-host ${u.hostname}`);
  }
  return u.href;
}

/**
 * Run a scenario in `browser` (a Browser from launch()). Options:
 *   outDir       where screenshots go (default "brokit-out")
 *   base         for a relative url
 *   allowHosts   hosts not on this computer that may be opened
 *   timeout      ms to be ready, when the scenario gives none
 *   baselines    { dir, update } for baseline screenshots (see baseline.mjs)
 *   file         the scenario's file, for pointing at the line a JS scenario failed on
 *   screenshot   a file for a screenshot after the last step
 *   cpuProfile   a file for the main thread's profile
 *   onReady, onStep   called when the page is ready, and with each step as it finishes
 * Resolves to the result (it doesn't throw for the page's failures; see `ok`).
 */
export async function runScenario(browser, scenario, options = {}) {
  const { outDir = 'brokit-out', base, allowHosts = [], timeout, baselines, file, screenshot, cpuProfile, onReady, onStep } = options;
  const start = Date.now();
  checkScenario(scenario);
  const url = checkUrl(scenario.url, { base, allowHosts });
  // Without Chrome's sandbox, only the project's own pages: never the open web.
  if (browser.sandboxed === false) {
    try {
      checkUrl(url);
    } catch {
      throw new Error(`${new URL(url).hostname}: with Chrome's sandbox off (BROKIT_NO_SANDBOX), brokit opens only pages on this computer`);
    }
  }
  const out = resolve(outDir);
  const result = { ...(scenario.name ? { name: scenario.name } : {}), url, ok: false, ms: 0, ready: null, steps: [], console: [], errors: [], title: null };
  const ctx = {
    save: async (name, png) => {
      const target = join(out, imageName(name));
      const rel = relative(out, target);
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`screenshot name leaves the output folder: ${name}`);
      await mkdir(out, { recursive: true });
      await writeFile(target, png);
      return target;
    },
    compare: baselines
      ? (name, png, { tolerance, ignore }) =>
          // A page with errors so far (an HTTP error, an uncaught exception) never becomes a
          // baseline: `--update` against a server that's down would otherwise approve its 404s.
          compareBaseline({ dir: baselines.dir, update: baselines.update, name, png, outDir: out, tolerance: tolerance ?? scenario.tolerance ?? BASELINE_TOLERANCE, ignore, unfit: page.errors[0] })
      : null,
    hasBaseline: async (name) => Boolean(baselines) && (await stat(join(baselines.dir, imageName(name))).then(() => true, () => false)),
  };
  const record = (entry) => {
    result.steps.push(entry);
    onStep?.(entry);
    return entry;
  };
  // One step: its entry, recorded. A failed action throws (after recording) to stop the run.
  const step = async (s) => {
    const t = Date.now();
    const entry = { action: parseStep(s)[0], label: describeStep(s), ok: true };
    try {
      Object.assign(entry, await runStep(page, s, ctx));
    } catch (e) {
      Object.assign(entry, e.details, { ok: false, error: e.message.split('\n')[0] });
      entry.ms = Date.now() - t;
      record(entry);
      if (!e.soft) throw Object.assign(new Error(entry.error), { recorded: true });
      return entry;
    }
    entry.ms = Date.now() - t;
    return record(entry);
  };

  const page = await browser.newPage(scenario.viewport ?? {});
  try {
    if (cpuProfile) await page.startProfile();
    try {
      result.ready = await page.goto(url, { ready: scenario.ready, readyTitle: scenario.readyTitle, timeout: scenario.timeout ?? timeout });
      onReady?.(result.ready);
    } catch (e) {
      result.errors.push(e.message);
    }
    if (result.ready) {
      try {
        if (scenario.run) await scenario.run(scriptApi(page, step, record));
        else for (const s of scenario.steps ?? []) await step(s);
      } catch (e) {
        if (!e.recorded) record({ action: 'script', label: 'script', ok: false, error: `${e.message.split('\n')[0]}${where(e, file)}` });
      }
      if (scenario.report) {
        try {
          result.report = await page.eval(scenario.report);
        } catch (e) {
          result.errors.push(`report: ${e.message.split('\n')[0]}`);
        }
      }
      result.title = await page.title().catch(() => null);
      if (screenshot) {
        try {
          await writeFile(screenshot, (await page.screenshot()).png);
          result.screenshot = resolve(screenshot);
        } catch (e) {
          result.errors.push(`screenshot: ${e.message.split('\n')[0]}`);
        }
      }
    }
    if (cpuProfile) {
      await writeFile(cpuProfile, JSON.stringify(await page.stopProfile()));
      result.cpuProfile = resolve(cpuProfile);
    }
  } finally {
    result.console = page.console;
    result.errors.push(...page.errors);
    await page.close();
  }
  result.ok = Boolean(result.ready) && !result.errors.length && result.steps.every((s) => s.ok);
  result.ms = Date.now() - start;
  return result;
}

/**
 * What a JS scenario's function gets:
 *   page         the Page (every step is a method: page.click(...), page.eval(...))
 *   step(s)      run a JSON step, recorded like one in a JSON scenario
 *   screenshot(name, options)   a screenshot step (options as in JSON: baseline, ...)
 *   expect       checks on values, recorded; each returns whether it held:
 *                expect.equal(actual, expected, label?), expect.near(actual, n, within?, label?),
 *                expect.matches(actual, regex, label?), expect.includes(actual, item, label?),
 *                expect.atLeast(actual, n, label?), expect.atMost(actual, n, label?),
 *                expect.ok(value, label?)
 */
function scriptApi(page, step, record) {
  const check = (actual, matcher, label) => {
    const problem = mismatch(actual, matcher);
    const entry = { action: 'expect', label: label ?? `expect ${describeMatcher(matcher)}`, ok: !problem, value: actual };
    if (problem) entry.error = problem;
    record(entry);
    return !problem;
  };
  const expect = {
    equal: (actual, expected, label) => check(actual, { equals: expected }, label),
    near: (actual, n, within = 0.5, label) => (typeof within === 'string' ? check(actual, { near: n }, within) : check(actual, { near: n, within }, label)),
    matches: (actual, re, label) => check(actual, { matches: re instanceof RegExp ? re.source : re }, label),
    includes: (actual, item, label) => check(actual, { includes: item }, label),
    atLeast: (actual, n, label) => check(actual, { atLeast: n }, label),
    atMost: (actual, n, label) => check(actual, { atMost: n }, label),
    ok: (value, label) => check(value, {}, label),
  };
  return {
    page,
    expect,
    step: async (s) => (await step(s)).ok,
    screenshot: async (name, opts = {}) => (await step({ screenshot: name, ...opts })).ok,
  };
}

/** " (form.check.mjs:12)": where in the scenario's file an error came from, if it did. */
function where(e, file) {
  if (!file || !e.stack) return '';
  const name = file.split(/[\\/]/).pop();
  const line = e.stack.split('\n').find((l) => l.includes(name));
  const at = line?.match(/:(\d+):\d+\)?$/);
  return at ? ` (${name}:${at[1]})` : '';
}
