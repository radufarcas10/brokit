// Expectations: whether a value is what it should be, and if not, a message saying how.
//
// A matcher is one of (JSON step keys and JS helpers alike):
//   (none)                truthy
//   equals: value         the same JSON (objects and lists compared by content)
//   near: n, within: d    a number within d of n (d defaults to 0.5)
//   matches: "regex"      a string the regular expression finds something in
//   includes: value       a string containing it, or a list with an item equal to it
//   atLeast: n / atMost: n   a number ≥ n / ≤ n (both may be given)

export const MATCHERS = ['equals', 'near', 'within', 'matches', 'includes', 'atLeast', 'atMost'];

/** Check a matcher's shape; throws a helpful message. */
export function checkMatcher(m) {
  const given = MATCHERS.filter((k) => m[k] !== undefined);
  const kinds = given.filter((k) => k !== 'within' && k !== 'atLeast' && k !== 'atMost');
  const bounds = given.some((k) => k === 'atLeast' || k === 'atMost');
  if (kinds.length + (bounds ? 1 : 0) > 1) throw new Error(`one of equals, near, matches, includes, atLeast/atMost; got ${given.join(', ')}`);
  if (m.within !== undefined && m.near === undefined) throw new Error('within goes with near');
  for (const k of ['near', 'within', 'atLeast', 'atMost']) if (m[k] !== undefined && !Number.isFinite(m[k])) throw new Error(`${k}: a number`);
  if (m.within !== undefined && m.within < 0) throw new Error('within: a number ≥ 0');
  if (m.matches !== undefined) {
    if (typeof m.matches !== 'string') throw new Error('matches: a regular expression, as a string');
    try {
      new RegExp(m.matches);
    } catch (e) {
      throw new Error(`matches: ${e.message}`);
    }
  }
}

/** Null if `actual` meets the matcher, else what's wrong. */
export function mismatch(actual, m) {
  const show = (v) => {
    const s = JSON.stringify(v) ?? String(v);
    return s.length > 300 ? `${s.slice(0, 300)}…` : s;
  };
  if (m.equals !== undefined) return same(actual, m.equals) ? null : `expected ${show(m.equals)}, got ${show(actual)}`;
  if (m.near !== undefined) {
    const within = m.within ?? 0.5;
    if (typeof actual !== 'number') return `expected a number near ${m.near}, got ${show(actual)}`;
    return Math.abs(actual - m.near) <= within ? null : `expected ${m.near} ± ${within}, got ${actual}`;
  }
  if (m.matches !== undefined) {
    if (typeof actual !== 'string') return `expected a string matching /${m.matches}/, got ${show(actual)}`;
    return new RegExp(m.matches).test(actual) ? null : `expected a match for /${m.matches}/, got ${show(actual)}`;
  }
  if (m.includes !== undefined) {
    if (typeof actual === 'string' && typeof m.includes === 'string') return actual.includes(m.includes) ? null : `expected text containing ${show(m.includes)}, got ${show(actual)}`;
    if (Array.isArray(actual)) return actual.some((v) => same(v, m.includes)) ? null : `expected a list with ${show(m.includes)}, got ${show(actual)}`;
    return `expected a string or a list containing ${show(m.includes)}, got ${show(actual)}`;
  }
  if (m.atLeast !== undefined || m.atMost !== undefined) {
    const range = [m.atLeast !== undefined ? `≥ ${m.atLeast}` : '', m.atMost !== undefined ? `≤ ${m.atMost}` : ''].filter(Boolean).join(' and ');
    if (typeof actual !== 'number') return `expected a number ${range}, got ${show(actual)}`;
    return (m.atLeast === undefined || actual >= m.atLeast) && (m.atMost === undefined || actual <= m.atMost) ? null : `expected ${range}, got ${actual}`;
  }
  return actual ? null : `expected something truthy, got ${show(actual)}`;
}

/** The matcher as words, for labels: 'equals "a"', 'near 59 ± 0.5', 'truthy'. */
export function describeMatcher(m) {
  if (m.equals !== undefined) return `equals ${JSON.stringify(m.equals)}`;
  if (m.near !== undefined) return `near ${m.near} ± ${m.within ?? 0.5}`;
  if (m.matches !== undefined) return `matches /${m.matches}/`;
  if (m.includes !== undefined) return `includes ${JSON.stringify(m.includes)}`;
  if (m.atLeast !== undefined || m.atMost !== undefined) return [m.atLeast !== undefined ? `≥ ${m.atLeast}` : '', m.atMost !== undefined ? `≤ ${m.atMost}` : ''].filter(Boolean).join(' and ');
  return 'truthy';
}

function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]));
}

/** A check that failed: reported, but the run goes on (it changed nothing on the page). */
export class Mismatch extends Error {
  soft = true;
}
