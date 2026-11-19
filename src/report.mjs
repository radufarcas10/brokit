// Results as text for a terminal. (--json prints the result objects themselves.)

import { relative } from 'node:path';

const MAX_CONSOLE = 50;

const here = (file) => {
  const rel = relative(process.cwd(), file);
  return rel.startsWith('..') ? file : rel;
};
const short = (v) => {
  const s = JSON.stringify(v) ?? 'undefined';
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
};

/** One step of a run, as it finishes. */
export function formatStep(s, indent = '  ') {
  let line = `${indent}${s.ok ? '✓' : '✗'} ${s.label}`;
  // A passing expectation's label already says what the value was.
  if ('value' in s && !(s.action === 'expect' && s.ok)) line += ` → ${short(s.value)}`;
  if (s.file) line += ` → ${here(s.file)} (${s.size.join('×')})`;
  if (s.baseline && s.baseline !== 'differs' && s.baseline !== 'missing') line += ` [baseline: ${s.baseline}]`;
  if (s.note) line += ` (${s.note})`;
  if (s.ms >= 100) line += `  ${s.ms} ms`;
  if (!s.ok) line += `\n${indent}    ${s.error}`;
  if (s.diff) line += `\n${indent}    difference → ${here(s.diff)}`;
  return line;
}

/**
 * One scenario of a check: a line when it passed; when it failed, the failed steps, the
 * console's errors and the page's errors too (all steps with `verbose`).
 */
export function formatScenario(name, r, verbose = false) {
  const fresh = r.steps.filter((s) => s.baseline === 'new' || s.baseline === 'updated');
  const tags = [`${r.steps.length} step${r.steps.length === 1 ? '' : 's'}`, `${(r.ms / 1000).toFixed(1)} s`];
  if (fresh.length) tags.push(`${fresh.length} baseline${fresh.length === 1 ? '' : 's'} ${fresh.every((s) => s.baseline === 'new') ? 'written' : 'updated'}`);
  const lines = [`${r.ok ? '✓' : '✗'} ${name}  ${tags.join(', ')}`];
  if (!r.ready) lines.push('    ✗ not ready');
  for (const s of r.steps) if (verbose || !s.ok) lines.push(formatStep(s, '    '));
  if (!r.ok || verbose) {
    const loud = r.console.filter((c) => verbose || c.type === 'error');
    for (const c of loud.slice(0, MAX_CONSOLE)) lines.push(`    ${c.type}: ${c.text}`);
  }
  for (const e of r.errors) lines.push(`    error: ${e}`);
  return lines.join('\n');
}

/** The end of a check. */
export function formatCheckEnd(results, ms) {
  const failed = results.filter((r) => !r.ok).length;
  const n = results.length;
  const what = `${n} scenario${n === 1 ? '' : 's'}`;
  return failed ? `${what}: ${n - failed} passed, ${failed} FAILED in ${(ms / 1000).toFixed(1)} s` : `${what} passed in ${(ms / 1000).toFixed(1)} s`;
}

/** A run's header: before its steps. */
export function formatStart(url) {
  return `brokit run ${url}`;
}

/** What a run ended with: readiness (if it never got that far), console, errors, verdict. */
export function formatEnd(r) {
  const lines = [];
  if (!r.ready) lines.push('  ✗ not ready');
  if (r.report !== undefined) lines.push(`  report: ${short(r.report)}`);
  if (r.screenshot) lines.push(`  screenshot → ${here(r.screenshot)}`);
  if (r.cpuProfile) lines.push(`  CPU profile → ${here(r.cpuProfile)}`);
  if (r.console.length) {
    lines.push('console');
    for (const c of r.console.slice(0, MAX_CONSOLE)) lines.push(`  ${c.type}: ${c.text}`);
    if (r.console.length > MAX_CONSOLE) lines.push(`  … ${r.console.length - MAX_CONSOLE} more (--json has them all)`);
  }
  if (r.errors.length) {
    lines.push('errors');
    for (const e of r.errors) lines.push(`  ${e}`);
  }
  const failed = r.steps.find((s) => !s.ok);
  const verdict = r.ok ? 'ok' : failed ? `FAILED at step ${r.steps.indexOf(failed) + 1}` : 'FAILED';
  lines.push(`${verdict} in ${(r.ms / 1000).toFixed(1)} s`);
  return lines.join('\n');
}

/** The readiness line, printed as soon as the page is ready. */
export function formatReady(ready) {
  return `  ready (${ready.by}) in ${ready.ms} ms${ready.note ? `\n    note: ${ready.note}` : ''}`;
}

/** A diff's result. */
export function formatDiff(a, b, d, diffFile) {
  const lines = [`${a} vs ${b}`];
  if (d.otherSize) {
    lines.push(`  FAILED: ${d.failures[0]}`);
    return lines.join('\n');
  }
  lines.push(`  ${d.size.join('×')}, ${d.compared} pixels compared${d.ignored ? `, ${d.ignored} ignored` : ''}`);
  lines.push(`  ${Object.entries(d.percent).map(([k, v]) => `${k} ${v} %`).join('   ')}`);
  lines.push(`  mean ${d.mean}, worst ${d.worst}`);
  if (diffFile) lines.push(`  difference image → ${here(diffFile)}`);
  lines.push(d.pass ? '  ok' : `  FAILED: ${d.failures.join('; ')}`);
  return lines.join('\n');
}
