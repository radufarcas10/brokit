// Scenario files: reading one, and finding a project's checks.
//
// A JSON scenario is the object run.mjs describes. A JS scenario is a module whose
// default export is the function to run, and whose named exports are the scenario's
// other keys:
//
//   export const url = '/form.html';
//   export const viewport = { size: '393x852', dpr: 3, mobile: true };
//   export default async ({ page, expect, screenshot }) => {
//     await page.tap({ selector: '#email' });
//     expect.near((await page.rect('header')).y, 59, 0.5, 'clear of the notch');
//     await screenshot('focused', { baseline: true });
//   };
//
// A JS scenario is your own code, run by Node like a test file: brokit only runs the
// files it's pointed at (or finds as *.check.mjs).
//
// `brokit check` runs files named *.check.json and *.check.mjs. Their baselines live
// next to them: checks/form.check.json → checks/baselines/form/<screenshot>.png.

import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkScenario, SCENARIO_KEYS } from './run.mjs';

const MAX_JSON = 10 * 1024 * 1024;
const CHECK = /\.check\.(json|mjs)$/;
// Never looked in: dependencies, hidden folders (.git), brokit's own output, baselines.
const SKIP = new Set(['node_modules', 'brokit-out', 'baselines']);

/** A scenario file's name for reports and baselines: "checks/form.check.json" → "form". */
export function scenarioName(file) {
  return basename(file).replace(/(\.check)?\.(json|mjs)$/, '');
}

/** Where a scenario file's baselines go. */
export function baselineDir(file) {
  return join(dirname(resolve(file)), 'baselines', scenarioName(file));
}

/** Read a scenario file (.json or .mjs) and check it. Throws with the file's name in the message. */
export async function loadScenario(file) {
  const path = resolve(file);
  try {
    let scenario;
    if (/\.mjs$/.test(path)) {
      const mod = await import(pathToFileURL(path).href);
      if (typeof mod.default !== 'function') throw new Error('a JS scenario exports its function as the default: export default async ({ page, expect }) => { ... }');
      const allowed = SCENARIO_KEYS.filter((k) => k !== 'steps' && k !== 'run');
      const unknown = Object.keys(mod).filter((k) => k !== 'default' && !allowed.includes(k));
      if (unknown.length) throw new Error(`unknown export ${unknown.join(', ')} (it may export ${allowed.join(', ')})`);
      scenario = Object.fromEntries([...allowed.filter((k) => mod[k] !== undefined).map((k) => [k, mod[k]]), ['run', mod.default]]);
    } else {
      if ((await stat(path)).size > MAX_JSON) throw new Error('over 10 MB');
      const text = await readFile(path, 'utf8');
      try {
        scenario = JSON.parse(text);
      } catch (e) {
        throw new Error(`isn't valid JSON: ${e.message}`);
      }
    }
    return checkScenario(scenario);
  } catch (e) {
    throw new Error(`${file}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`);
  }
}

/**
 * The scenario files under `paths` (files are taken as they are; folders are searched
 * for *.check.json and *.check.mjs). Sorted, so runs go in the same order every time.
 */
export async function findScenarios(paths) {
  const found = new Set();
  const walk = async (dir, depth) => {
    if (depth > 20) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      throw new Error(`can't read ${dir}: ${e.message}`);
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile() && CHECK.test(e.name)) found.add(full);
    }
  };
  for (const p of paths) {
    let info;
    try {
      info = await stat(p);
    } catch {
      throw new Error(`no such file or folder: ${p}`);
    }
    if (info.isDirectory()) await walk(resolve(p), 0);
    else if (/\.(json|mjs)$/.test(p)) found.add(resolve(p));
    else throw new Error(`${p}: a scenario is a .json or .mjs file`);
  }
  return [...found].sort();
}
