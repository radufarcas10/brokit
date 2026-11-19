// Scenario steps: JSON objects, one action each, run on a Page.
//
//   {"move": P}                      {"click": P}  ("button": "right", "count": 2)
//   {"dblclick": P}                  {"drag": [x0, y0, x1, y1]} or {"drag": {"from": P, "to": P}}
//   {"wheel": [x, y, dy, dx?]} or {"wheel": {"at": P, "dy": 100, "dx": 0}}
//   {"key": "Enter"}  {"key": "Ctrl+Shift+Z"}  {"key": "Tab", "shift": true}
//   {"type": "text"} ("perKey": true: a key press per character)
//   {"ime": "かな"} or {"ime": ["かな", 1]} (composing, caret at 1; {"ime": ""} cancels)
//   {"tap": P}                       {"swipe": [x0, y0, x1, y1, ms?]} or {"swipe": {"from": P, "to": P, "ms": 120}}
//   {"emulate": {"size": "393x852", "dpr": 3, "mobile": true, "scale": 0.5, "colorScheme": "dark", "reducedMotion": "reduce"}}
//   {"safeArea": [top, right, bottom, left]}
//   {"wait": ms}  {"frames": n}  {"waitFor": "expression"} ("timeout": ms)
//   {"eval": "expression"} (its value goes into the result)
//   {"expect": "expression", "equals": value} (or near/within, matches, includes,
//     atLeast/atMost, or nothing: truthy; see expect.mjs). Tried again until it holds or
//     "timeout" ms pass (2000). A failed expectation fails the run, but the steps after
//     it still run: it changed nothing on the page.
//   {"screenshot": "name"} ("selector", "fullPage", "scale", "from", "still"; see
//     Page.screenshot: taken once the page is still, "still": false at once)
//     ("baseline": true compares it with its baseline, with "tolerance" and "ignore" as
//     in diff.mjs; a difference fails the run without stopping it, as expect does)
// P is a point: [x, y], {"selector": "css"} ("offset": [x, y]), or a JS expression.
// Mouse, wheel, drag and key steps take "shift", "ctrl", "alt", "meta": true.
// Any step may have a "note" (for people; JSON has no comments).
// Every value can be an expression where noted: drag, wheel and swipe also take a string
// the page evaluates to their list of numbers.

import { parseTolerance } from './diff.mjs';
import { checkMatcher, describeMatcher, MATCHERS, mismatch, Mismatch } from './expect.mjs';
import { imageName } from './names.mjs';

const MODS = ['shift', 'ctrl', 'alt', 'meta'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each action: the options it takes, and what it does.
const ACTIONS = {
  move: { options: [], run: (page, v) => page.move(v) },
  click: { options: ['button', 'count', ...MODS], run: (page, v, o) => page.click(v, { button: o.button, count: count(o.count), ...mods(o) }) },
  dblclick: { options: MODS, run: (page, v, o) => page.dblclick(v, mods(o)) },
  drag: {
    options: ['steps', ...MODS],
    run: async (page, v, o) => {
      const [from, to] = await pair(page, v, 'drag');
      return page.drag(from, to, { steps: bounded(o.steps ?? 8, 1, 1000, 'steps'), ...mods(o) });
    },
  },
  wheel: {
    options: MODS,
    run: async (page, v, o) => {
      if (typeof v === 'string') v = await page.eval(v);
      if (Array.isArray(v)) {
        if (v.length < 3 || v.length > 4 || !v.every(Number.isFinite)) throw new Error('wheel: [x, y, dy, dx?]');
        return page.wheel([v[0], v[1]], { dy: v[2], dx: v[3] ?? 0, ...mods(o) });
      }
      if (!v || typeof v !== 'object' || v.at === undefined) throw new Error('wheel: [x, y, dy, dx?] or {"at": point, "dy": n, "dx": n}');
      for (const d of ['dx', 'dy']) if (v[d] !== undefined && !Number.isFinite(v[d])) throw new Error(`wheel: ${d} must be a number`);
      return page.wheel(v.at, { dy: v.dy ?? 0, dx: v.dx ?? 0, ...mods(o) });
    },
  },
  key: { options: MODS, run: (page, v, o) => page.key(v, mods(o)) },
  type: {
    options: ['perKey'],
    run: (page, v, o) => {
      if (typeof v !== 'string' || v.length > 100000) throw new Error('type: a string (up to 100000 characters)');
      return page.type(v, { perKey: Boolean(o.perKey) });
    },
  },
  ime: {
    options: [],
    run: (page, v) => {
      const [text, caret] = typeof v === 'string' ? [v] : Array.isArray(v) ? v : [];
      if (typeof text !== 'string' || (caret !== undefined && !Number.isInteger(caret))) throw new Error('ime: "text" or ["text", caret]');
      return page.ime(text, caret);
    },
  },
  tap: { options: [], run: (page, v) => page.tap(v) },
  swipe: {
    options: ['ms'],
    run: async (page, v, o) => {
      let ms = o.ms;
      if (typeof v === 'string') v = await page.eval(v);
      if (Array.isArray(v) && v.length === 5) [ms, v] = [v[4], v.slice(0, 4)];
      else if (v && typeof v === 'object' && !Array.isArray(v) && v.ms !== undefined) ms = v.ms;
      const [from, to] = await pair(page, v, 'swipe');
      return page.swipe(from, to, { ms: bounded(ms ?? 120, 1, 10000, 'ms') });
    },
  },
  emulate: {
    options: [],
    run: (page, v) => {
      if (Array.isArray(v)) {
        const [w, h, dpr, mobile, scale] = v;
        return page.emulate({ size: [w, h], dpr, mobile, scale });
      }
      if (!v || typeof v !== 'object') throw new Error('emulate: {"size": "393x852", "dpr": 3, "mobile": true}');
      const keys = ['size', 'dpr', 'mobile', 'scale', 'colorScheme', 'reducedMotion'];
      const unknown = Object.keys(v).filter((k) => !keys.includes(k));
      if (unknown.length) throw new Error(`emulate: unknown ${unknown.join(', ')} (${keys.join(', ')})`);
      return page.emulate(v);
    },
  },
  safeArea: {
    options: [],
    run: (page, v) => {
      if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => Number.isInteger(n) && n >= 0)) throw new Error('safeArea: [top, right, bottom, left]');
      return page.safeArea(v);
    },
  },
  wait: { options: [], run: (page, v) => page.wait(bounded(v, 0, 600000, 'wait')) },
  frames: {
    options: [],
    run: async (page, v) => {
      if (!(await page.frames(bounded(v, 1, 600, 'frames')))) return { note: 'the page drew no frames' };
    },
  },
  waitFor: {
    options: ['timeout'],
    run: async (page, v, o) => {
      if (typeof v !== 'string') throw new Error('waitFor: a JS expression');
      await page.waitFor(v, { timeout: bounded(o.timeout ?? 10000, 1, 600000, 'timeout') });
    },
  },
  eval: {
    options: [],
    run: async (page, v) => ({ value: await page.eval(v) }),
  },
  expect: {
    options: [...MATCHERS, 'timeout'],
    validate: (v, o) => {
      if (typeof v !== 'string') throw new Error('expect: a JS expression, as a string');
      checkMatcher(o);
      if (o.timeout !== undefined) bounded(o.timeout, 0, 600000, 'timeout');
    },
    run: async (page, v, o) => {
      const timeout = o.timeout ?? 2000;
      const start = Date.now();
      for (;;) {
        let value;
        let problem;
        try {
          value = await page.eval(v);
          problem = mismatch(value, o);
        } catch (e) {
          problem = e.message.split('\n')[0];
        }
        if (!problem) return { value };
        if (Date.now() - start >= timeout) throw Object.assign(new Mismatch(problem), { details: value === undefined ? {} : { value } });
        await sleep(50);
      }
    },
  },
  screenshot: {
    options: ['selector', 'fullPage', 'scale', 'from', 'still', 'baseline', 'tolerance', 'ignore'],
    validate: (v, o) => {
      imageName(v);
      if (o.scale !== undefined && !(typeof o.scale === 'number' && o.scale > 0 && o.scale <= 10)) throw new Error('scale: a number from 0 to 10');
      if (o.still !== undefined && typeof o.still !== 'boolean') bounded(o.still, 0, 600000, 'still');
      if (o.baseline !== undefined && typeof o.baseline !== 'boolean') throw new Error('baseline: true or false');
      if ((o.tolerance !== undefined || o.ignore !== undefined) && !o.baseline) throw new Error('screenshot: tolerance and ignore go with "baseline": true');
      if (o.tolerance !== undefined) parseTolerance(o.tolerance);
      if (o.ignore !== undefined && !(Array.isArray(o.ignore) && o.ignore.every((r) => Array.isArray(r) && r.length === 4 && r.every((n) => Number.isInteger(n) && n >= 0)))) {
        throw new Error('ignore: a list of [x, y, width, height] in image pixels');
      }
    },
    run: async (page, v, o, ctx) => {
      const take = () => page.screenshot({ selector: o.selector, fullPage: Boolean(o.fullPage), scale: o.scale, from: o.from, still: o.still });
      let shot = await take();
      if (o.baseline && !ctx.compare) {
        const details = { file: await ctx.save(v, shot.png), size: [shot.width, shot.height] };
        throw Object.assign(new Mismatch('baseline: no baseline folder here (run a scenario file, or give --baselines)'), { details });
      }
      // A baseline must be the page as it settled, not a moment of it still drawing:
      // before writing a new one, and before calling a difference real, take shots until
      // two in a row are the same. A shot that matches its baseline needs none of this.
      const settled = async () => {
        for (let k = 0; k < 6; k++) {
          await page.frames(3);
          const again = await take();
          if (again.png.equals(shot.png)) return;
          shot = again;
        }
      };
      if (o.baseline && !(await ctx.hasBaseline(v))) await settled();
      let r = o.baseline ? await ctx.compare(v, shot.png, { tolerance: o.tolerance, ignore: o.ignore }) : null;
      if (r?.status === 'differs') {
        const before = shot.png;
        await settled();
        if (!shot.png.equals(before)) r = await ctx.compare(v, shot.png, { tolerance: o.tolerance, ignore: o.ignore });
      }
      const entry = { file: await ctx.save(v, shot.png), size: [shot.width, shot.height], ...motionNote(shot, o.baseline) };
      if (!r) return entry;
      Object.assign(entry, { baseline: r.status, ...(r.diff ? { diff: r.diff } : {}) });
      if (r.status === 'differs' || r.status === 'missing') throw Object.assign(new Mismatch(r.message), { details: entry });
      return entry;
    },
  },
};

export const STEP_NAMES = Object.keys(ACTIONS);

/** Check a step's shape; returns [action, value, options]. Throws a helpful message. */
export function parseStep(step) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error(`a step is an object like {"click": [10, 20]}; got ${JSON.stringify(step)}`);
  const keys = Object.keys(step).filter((k) => k !== 'note');
  const actions = keys.filter((k) => ACTIONS[k]);
  if (actions.length !== 1) {
    throw new Error(actions.length ? `one action per step; this one has ${actions.join(' and ')}` : `no action in ${JSON.stringify(step)} (one of: ${STEP_NAMES.join(', ')})`);
  }
  const [action] = actions;
  const extra = keys.filter((k) => k !== action && !ACTIONS[action].options.includes(k));
  if (extra.length) throw new Error(`${action}: unknown option ${extra.join(', ')}${ACTIONS[action].options.length ? ` (it takes ${ACTIONS[action].options.join(', ')})` : ''}`);
  for (const m of MODS) if (step[m] !== undefined && typeof step[m] !== 'boolean') throw new Error(`${m}: true or false`);
  if (step.note !== undefined && typeof step.note !== 'string') throw new Error('note: a string');
  try {
    ACTIONS[action].validate?.(step[action], step);
  } catch (e) {
    throw new Error(e.message.startsWith(`${action}:`) ? e.message : `${action}: ${e.message}`);
  }
  return [action, step[action], step];
}

/**
 * Run one step. `ctx.save(name, png)` stores a screenshot and returns where it went.
 * Resolves to what the step gives back (eval: { value }; screenshot: { file, size }).
 */
export async function runStep(page, step, ctx) {
  const [action, value, options] = parseStep(step);
  return (await ACTIONS[action].run(page, value, options, ctx)) ?? {};
}

/** A short description of a step, for reports. */
export function describeStep(step) {
  let action, value;
  try {
    [action, value] = parseStep(step);
  } catch {
    return JSON.stringify(step);
  }
  const show = (v) => {
    if (typeof v === 'string') return action === 'type' || action === 'ime' ? JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v) : v.length > 60 ? `${v.slice(0, 60)}…` : v;
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.selector === 'string') return v.offset ? `${v.selector} +${JSON.stringify(v.offset)}` : v.selector;
    return JSON.stringify(v);
  };
  const held = MODS.filter((m) => step[m]).map((m) => m[0].toUpperCase() + m.slice(1));
  const prefix = held.length ? `${held.join('+')}+` : '';
  if (action === 'key') return `key ${prefix}${value}`;
  if (action === 'wait') return `wait ${value} ms`;
  if (action === 'expect') return `expect ${show(value)} ${describeMatcher(step)}`;
  return `${prefix ? `${prefix.slice(0, -1)} ` : ''}${action} ${show(value)}`;
}

// What a screenshot couldn't wait for. Something still moving when the wait ran out is
// worth saying for any shot; an endless animation only for a baseline, where it can make
// two runs differ.
function motionNote({ moving, endless }, baseline) {
  const list = (items) => (items.length > 3 ? `${items.slice(0, 3).join(', ')} and ${items.length - 3} more` : items.join(', '));
  const notes = [];
  if (moving) notes.push(`still moving when the wait ran out: ${list(moving)}`);
  if (endless && baseline) notes.push(`never stops: ${list(endless)} (emulate reducedMotion "reduce" if the page honors it, or ignore its region)`);
  return notes.length ? { note: notes.join('; ') } : {};
}

function mods(o) {
  return Object.fromEntries(MODS.map((m) => [m, Boolean(o[m])]));
}

function count(n = 1) {
  return bounded(n, 1, 3, 'count');
}

function bounded(n, min, max, name) {
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name}: a number from ${min} to ${max}`);
  return n;
}

// Two points: [x0, y0, x1, y1], {"from": P, "to": P}, or an expression giving either.
async function pair(page, v, name) {
  if (typeof v === 'string') v = await page.eval(v);
  if (Array.isArray(v) && v.length === 4 && v.every(Number.isFinite)) return [v.slice(0, 2), v.slice(2)];
  if (v && typeof v === 'object' && !Array.isArray(v) && v.from !== undefined && v.to !== undefined) return [v.from, v.to];
  throw new Error(`${name}: [x0, y0, x1, y1] or {"from": point, "to": point}`);
}
