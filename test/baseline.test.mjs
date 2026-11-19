import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { compareBaseline } from '../src/baseline.mjs';
import { baselineDir, findScenarios, loadScenario, scenarioName } from '../src/load.mjs';
import { decodePng, encodePng } from '../src/png.mjs';

const png = (v, w = 4) => encodePng({ width: w, height: 4, data: Buffer.alloc(w * 16, v) });

describe('compareBaseline', () => {
  let dir;
  before(() => (dir = mkdtempSync(join(tmpdir(), 'brokit-baseline-test-'))));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const args = (over) => ({ dir: join(dir, 'baselines'), outDir: join(dir, 'out'), name: 'home', ...over });

  it('writes a missing baseline, then matches it', async () => {
    assert.deepEqual(await compareBaseline(args({ png: png(100) })), { status: 'new', baseline: join(dir, 'baselines', 'home.png') });
    assert.equal((await compareBaseline(args({ png: png(100) }))).status, 'match');
  });

  it('a difference fails, with a difference image; the baseline stays', async () => {
    const r = await compareBaseline(args({ png: png(104) }));
    assert.equal(r.status, 'differs');
    assert.match(r.message, /differs from .*home\.png: 16 pixels differ \(up to 4\)/);
    assert.equal(r.diff, join(dir, 'out', 'home.diff.png'));
    assert.equal(decodePng(readFileSync(r.diff)).width, 4);
    assert.equal(decodePng(readFileSync(r.baseline)).data[0], 100);
  });

  it('a tolerance, or a different size', async () => {
    assert.equal((await compareBaseline(args({ png: png(104), tolerance: { max: 4 } }))).status, 'match');
    const sized = await compareBaseline(args({ png: png(100, 5) }));
    assert.equal(sized.status, 'differs');
    assert.match(sized.message, /sizes differ: 4×4 vs 5×4/);
    assert.equal(sized.diff, undefined);
  });

  it('update "all" replaces it', async () => {
    assert.equal((await compareBaseline(args({ png: png(104), update: 'all' }))).status, 'updated');
    assert.equal(decodePng(readFileSync(join(dir, 'baselines', 'home.png'))).data[0], 104);
  });

  it('update "none" (CI): a missing baseline fails and nothing is written', async () => {
    const r = await compareBaseline(args({ name: 'other', png: png(1), update: 'none' }));
    assert.equal(r.status, 'missing');
    assert.match(r.message, /no baseline .*other\.png/);
    assert.equal(existsSync(join(dir, 'baselines', 'other.png')), false);
  });

  it('a broken baseline file is an error, not a pass', async () => {
    writeFileSync(join(dir, 'baselines', 'broken.png'), 'not a png');
    await assert.rejects(compareBaseline(args({ name: 'broken', png: png(1) })), /broken\.png: not a PNG file/);
  });

  it('names can\'t leave the folder', async () => {
    await assert.rejects(compareBaseline(args({ name: '../escape', png: png(1) })), /screenshot name/);
  });
});

describe('scenario files', () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'brokit-load-test-'));
    for (const d of ['checks/deep', 'node_modules/pkg', '.git', 'checks/baselines/form', 'brokit-out']) mkdirSync(join(dir, d), { recursive: true });
    const s = JSON.stringify({ url: '/' });
    for (const f of ['checks/form.check.json', 'checks/deep/menu.check.mjs', 'node_modules/pkg/x.check.json', '.git/y.check.json', 'checks/baselines/form/z.check.json', 'brokit-out/w.check.json', 'checks/other.json', 'checks/notes.check.txt']) {
      writeFileSync(join(dir, f), f.endsWith('.mjs') ? "export const url = '/menu.html';\nexport default async () => {};\n" : s);
    }
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('names and baseline folders', () => {
    assert.equal(scenarioName('checks/form.check.json'), 'form');
    assert.equal(scenarioName('a/menu.check.mjs'), 'menu');
    assert.equal(scenarioName('plain.json'), 'plain');
    assert.equal(baselineDir(join('p', 'checks', 'form.check.json')), resolve('p', 'checks', 'baselines', 'form'));
  });

  it('finds *.check.json and *.check.mjs, not in dependencies, hidden folders, output or baselines', async () => {
    assert.deepEqual(await findScenarios([dir]), [join(dir, 'checks/deep/menu.check.mjs'), join(dir, 'checks/form.check.json')]);
    assert.deepEqual(await findScenarios([join(dir, 'checks/other.json')]), [join(dir, 'checks/other.json')]);
    await assert.rejects(findScenarios([join(dir, 'nope')]), /no such file or folder/);
    await assert.rejects(findScenarios([join(dir, 'checks/notes.check.txt')]), /a \.json or \.mjs file/);
  });

  it('loads JSON and JS scenarios', async () => {
    assert.deepEqual(await loadScenario(join(dir, 'checks/form.check.json')), { url: '/' });
    const js = await loadScenario(join(dir, 'checks/deep/menu.check.mjs'));
    assert.equal(js.url, '/menu.html');
    assert.equal(typeof js.run, 'function');
  });

  it('says what\'s wrong with a file, naming it', async () => {
    const bad = (name, text) => {
      writeFileSync(join(dir, name), text);
      return loadScenario(join(dir, name));
    };
    await assert.rejects(bad('a.json', '{'), /a\.json: isn't valid JSON/);
    await assert.rejects(bad('b.json', '{"url": "/", "stpes": []}'), /b\.json: scenario: unknown stpes/);
    await assert.rejects(bad('c.mjs', "export const url = '/';"), /c\.mjs: a JS scenario exports its function as the default/);
    await assert.rejects(bad('d.mjs', "export const url = '/'; export const steps = []; export default () => {};"), /d\.mjs: unknown export steps/);
    await assert.rejects(bad('e.mjs', 'export default () => {};'), /e\.mjs: scenario: "url" is required/);
    await assert.rejects(loadScenario(join(dir, 'missing.json')), /missing\.json: no such file/);
  });
});
