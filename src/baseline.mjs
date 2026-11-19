// Screenshot baselines: the image a screenshot should match, kept with the checks (in
// git, reviewed like code).
//
//   no baseline yet      written, and the step passes ("new"); in CI (update "none"),
//                        it fails instead: a check with nothing to compare against
//                        isn't a check
//   the same (within the tolerance)    passes
//   different            fails; the new screenshot and a difference image are in the
//                        output folder. With update "all", the baseline is replaced.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { diffImages } from './diff.mjs';
import { decodePng, encodePng } from './png.mjs';
import { imageName } from './names.mjs';

/**
 * Compare a screenshot (PNG bytes) with its baseline `dir`/`name`.png.
 * update: "missing" (write missing baselines; the default), "all" (replace ones that
 * differ too) or "none" (write nothing: CI). unfit: why this screenshot mustn't become a
 * baseline (the page had errors: a 404 page, a crash), if it mustn't; then nothing is
 * written, whatever `update` says.
 * Resolves to { status: "match" | "new" | "updated" | "missing" | "differs", baseline,
 * diff?, message? }; "missing" and "differs" are failures.
 */
export async function compareBaseline({ dir, name, png, outDir, tolerance, ignore, update = 'missing', unfit }) {
  const file = imageName(name);
  const baseline = join(dir, file);
  // In messages: relative to where brokit runs, when it's under there.
  const shown = ((rel) => (rel.startsWith('..') || isAbsolute(rel) ? baseline : rel))(relative(process.cwd(), baseline));
  let old;
  try {
    old = await readFile(baseline);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (!old) {
    if (update === 'none') return { status: 'missing', baseline, message: `no baseline ${shown} (make one outside CI, and commit it)` };
    if (unfit) return { status: 'missing', baseline, message: `no baseline ${shown}, and none made from a page with errors (${unfit})` };
    await mkdir(dir, { recursive: true });
    await writeFile(baseline, png);
    return { status: 'new', baseline };
  }
  // The same bytes are the same pixels: no need to decode and compare them (Chrome's PNG
  // encoder gives the same bytes for the same pixels, so this is the usual case).
  if (old.equals(png)) return { status: 'match', baseline };
  let d;
  try {
    d = diffImages(decodePng(old), decodePng(png), { tolerance, ignore });
  } catch (e) {
    throw new Error(`baseline ${baseline}: ${e.message}`);
  }
  if (d.pass) return { status: 'match', baseline };
  if (update === 'all' && !unfit) {
    await writeFile(baseline, png);
    return { status: 'updated', baseline };
  }
  let diff;
  if (d.image) {
    diff = join(outDir, file.replace(/\.png$/i, '.diff.png'));
    await mkdir(outDir, { recursive: true });
    await writeFile(diff, encodePng(d.image));
  }
  const kept = update === 'all' && unfit ? `; not replaced: the page has errors (${unfit})` : '';
  return { status: 'differs', baseline, diff, message: `differs from ${shown}: ${d.failures.join('; ')}${kept}` };
}
