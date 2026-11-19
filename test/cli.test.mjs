// The brokit command as a user runs it: exit codes, messages, output.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { decodePng, encodePng, findChrome } from '../src/index.mjs';

const BIN = fileURLToPath(new URL('../bin/brokit.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

function brokit(args, { cwd = ROOT, env = process.env } = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd, env, timeout: 60000 }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

describe('brokit (the command)', () => {
  let dir;
  before(() => (dir = mkdtempSync(join(tmpdir(), 'brokit-cli-test-'))));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('help and version', async () => {
    const help = await brokit(['help']);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /brokit run <url \| page\.html \| scenario\.json \| scenario\.mjs>/);
    assert.match(help.stdout, /brokit check \[files or folders\]/);
    assert.equal((await brokit([])).code, 0);
    assert.match((await brokit(['--version'])).stdout, /^\d+\.\d+\.\d+\n$/);
  });

  it('usage mistakes exit 2 with a message', async () => {
    const cases = [
      [['frobnicate'], /unknown command "frobnicate"/],
      [['run'], /give one URL, page or scenario/],
      [['run', 'nope.html'], /no such page: nope\.html/],
      [['run', 'https://example.com/'], /example\.com isn't on this computer; allow it with --allow-host example\.com/],
      [['run', 'http://localhost/', '--bogus'], /Unknown option '--bogus'/],
      [['run', 'http://localhost/', '--gpu', 'quantum'], /--gpu: one of default, software, hardware/],
      [['run', 'http://localhost/', '--timeout', 'soon'], /--timeout: a positive number/],
      [['diff', 'a.png'], /brokit diff a\.png b\.png/],
      [['diff', 'none-a.png', 'none-b.png'], /none-a\.png: no such file/],
    ];
    for (const [args, message] of cases) {
      const r = await brokit(args);
      assert.equal(r.code, 2, `${args.join(' ')}: ${r.stderr}`);
      assert.match(r.stderr, message, args.join(' '));
    }
  });

  it('bad scenario files say what\'s wrong', async () => {
    writeFileSync(join(dir, 'broken.json'), '{ "url": ');
    writeFileSync(join(dir, 'typo.json'), JSON.stringify({ url: 'http://localhost/', steps: [{ clik: [1, 2] }] }));
    assert.match((await brokit(['run', join(dir, 'broken.json')])).stderr, /isn't valid JSON/);
    const typo = await brokit(['run', join(dir, 'typo.json')]);
    assert.equal(typo.code, 2);
    assert.match(typo.stderr, /step 1: no action in \{"clik":\[1,2\]\}/);
  });

  it('no Chrome: a clear message', async () => {
    const r = await brokit(['run', 'test/fixtures/form.html'], { env: { ...process.env, BROKIT_CHROME: join(dir, 'no-chrome') } });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /couldn't start Chrome/);
  });

  it('diff: the same, different, a tolerance, a difference image, JSON', async () => {
    const img = (v) => encodePng({ width: 4, height: 4, data: Buffer.alloc(64, v) });
    writeFileSync(join(dir, 'a.png'), img(100));
    writeFileSync(join(dir, 'b.png'), img(100));
    writeFileSync(join(dir, 'c.png'), img(104));
    const same = await brokit(['diff', join(dir, 'a.png'), join(dir, 'b.png')]);
    assert.equal(same.code, 0);
    assert.match(same.stdout, /identical 100 %/);
    const differ = await brokit(['diff', join(dir, 'a.png'), join(dir, 'c.png'), join(dir, 'd.png')]);
    assert.equal(differ.code, 1);
    assert.match(differ.stdout, /FAILED: 16 pixels differ \(up to 4\)/);
    assert.equal(decodePng(readFileSync(join(dir, 'd.png'))).width, 4);
    assert.equal((await brokit(['diff', join(dir, 'a.png'), join(dir, 'c.png'), '--tolerance', '{"max": 4}'])).code, 0);
    const json = JSON.parse((await brokit(['diff', join(dir, 'a.png'), join(dir, 'c.png'), '--json'])).stdout);
    assert.equal(json.pass, false);
    assert.equal(json.worst, 4);
    assert.equal(json.image, undefined);
    assert.match((await brokit(['diff', join(dir, 'a.png'), join(dir, 'b.png'), '--tolerance', '{"maxx": 1}'])).stderr, /unknown limit "maxx"/);
  });

  describe('run, in Chrome', { skip: findChrome() ? false : 'no Chrome on this computer' }, () => {
    it('a page from disk, steps, a screenshot: text', async () => {
      writeFileSync(join(dir, 'steps.json'), JSON.stringify([{ click: { selector: '#count' } }, { eval: "document.getElementById('count').textContent" }, { screenshot: 'counted' }]));
      const r = await brokit(['run', 'test/fixtures/form.html', '--steps', join(dir, 'steps.json'), '--out-dir', join(dir, 'shots'), '--out', join(dir, 'end.png'), '--size', '640x480']);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /^brokit run http:\/\/127\.0\.0\.1:\d+\/test\/fixtures\/form\.html\n {2}ready \(load \+ network idle\)/);
      assert.match(r.stdout, /✓ click #count/);
      assert.match(r.stdout, /✓ eval .* → "1"/);
      assert.match(r.stdout, /log: form ready/);
      assert.match(r.stdout, /\nok in \d+\.\d s\n$/);
      assert.equal(decodePng(readFileSync(join(dir, 'shots', 'counted.png'))).width, 640);
      assert.equal(decodePng(readFileSync(join(dir, 'end.png'))).height, 480);
    });

    it('check: baselines written, matched, differ, updated; CI fails on missing ones', async () => {
      // A small project: a page, a JSON check and a JS check.
      const project = join(dir, 'project');
      const checks = join(project, 'checks');
      const { mkdirSync } = await import('node:fs');
      mkdirSync(checks, { recursive: true });
      const page = (color) => `<!doctype html><meta name="viewport" content="width=device-width"><title>p</title><style>body{margin:0;background:${color}}</style><h1 id="t">Hello</h1>`;
      writeFileSync(join(project, 'index.html'), page('#fff'));
      writeFileSync(join(checks, 'home.check.json'), JSON.stringify({ url: '/index.html', steps: [{ expect: "document.getElementById('t').textContent", equals: 'Hello' }, { screenshot: 'home', baseline: true }] }));
      writeFileSync(join(checks, 'phone.check.mjs'), "export const url = '/index.html';\nexport const viewport = { size: '390x844', mobile: true };\nexport default async ({ page, expect, screenshot }) => {\n  expect.equal(await page.eval('innerWidth'), 390, 'phone width');\n  await screenshot('phone', { baseline: true });\n};\n");
      const env = { ...process.env, CI: '' };
      const check = (...args) => brokit(['check', ...args], { cwd: project, env });

      const first = await check();
      assert.equal(first.code, 0, first.stdout + first.stderr);
      assert.match(first.stdout, /brokit check: 2 scenarios, Chrome \d+.*, software drawing/);
      assert.match(first.stdout, /✓ checks\/home {2}2 steps, [\d.]+ s, 1 baseline written/);
      assert.match(first.stdout, /✓ checks\/phone {2}2 steps, [\d.]+ s, 1 baseline written/);
      assert.match(first.stdout, /2 scenarios passed in/);
      assert.equal(decodePng(readFileSync(join(checks, 'baselines', 'phone', 'phone.png'))).width, 390);

      const second = await check();
      assert.equal(second.code, 0, second.stdout);
      assert.doesNotMatch(second.stdout, /written/);

      writeFileSync(join(project, 'index.html'), page('#fafafa'));
      const changed = await check();
      assert.equal(changed.code, 1);
      assert.match(changed.stdout, /✗ checks\/home/);
      assert.match(changed.stdout, /differs from .*home\.png: \d+ pixels differ by more than 2 \(up to 5\)/);
      assert.match(changed.stdout, /difference → brokit-out[\\/]checks[\\/]home[\\/]home\.diff\.png/);
      assert.match(changed.stdout, /2 scenarios: 0 passed, 2 FAILED/);

      const filtered = await check('--filter', 'phone', '--json');
      const json = JSON.parse(filtered.stdout);
      assert.equal(json.scenarios.length, 1);
      assert.equal(json.scenarios[0].name, 'checks/phone');
      assert.equal(json.scenarios[0].steps[1].baseline, 'differs');

      const updated = await check('--update');
      assert.equal(updated.code, 0, updated.stdout);
      assert.match(updated.stdout, /1 baseline updated/);
      assert.equal((await check()).code, 0);

      const noJs = await check('--no-js');
      assert.equal(noJs.code, 0, noJs.stdout);
      assert.match(noJs.stdout, /brokit check: 1 scenario, .*, 1 JS check skipped \(--no-js\)/);
      const runJs = await brokit(['run', join(checks, 'phone.check.mjs'), '--no-js'], { cwd: project, env });
      assert.equal(runJs.code, 2);
      assert.match(runJs.stderr, /is a JS scenario \(code\), and --no-js says not to run any/);

      rmSync(join(checks, 'baselines'), { recursive: true });
      const ci = await brokit(['check'], { cwd: project, env: { ...process.env, CI: 'true' } });
      assert.equal(ci.code, 1);
      assert.match(ci.stdout, /CI \(missing baselines fail\)/);
      assert.match(ci.stdout, /no baseline .*home\.png/);
    });

    it('check: mistakes in checks stop it before Chrome starts', async () => {
      const project = join(dir, 'broken');
      const { mkdirSync } = await import('node:fs');
      mkdirSync(project, { recursive: true });
      const none = await brokit(['check'], { cwd: project });
      assert.equal(none.code, 2);
      assert.match(none.stderr, /no checks in this folder: name scenario files \*\.check\.json or \*\.check\.mjs/);
      writeFileSync(join(project, 'a.check.json'), JSON.stringify({ url: '/', steps: [{ expect: 'x', equal: 1 }] }));
      const typo = await brokit(['check'], { cwd: project, env: { ...process.env, BROKIT_CHROME: join(dir, 'no-chrome') } });
      assert.equal(typo.code, 2);
      assert.match(typo.stderr, /a\.check\.json: step 1: expect: unknown option equal/);
    });

    it('doctor: all checks pass here; a broken Chrome gets a fix', async () => {
      const ok = await brokit(['doctor', '--json']);
      assert.equal(ok.code, 0, ok.stdout + ok.stderr);
      const r = JSON.parse(ok.stdout);
      assert.equal(r.ok, true);
      assert.deepEqual(r.checks.map((c) => c.name).slice(0, 4), ['Node', 'Chrome', 'starts', 'draws']);
      const text = await brokit(['doctor']);
      assert.match(text.stdout, /✓ starts: starts headless, over a pipe, with its sandbox on/);
      assert.match(text.stdout, /brokit is ready here\n$/);
      const broken = join(dir, 'fake-chrome');
      writeFileSync(broken, '#!/bin/sh\necho "this is not chrome" >&2\nexit 3\n', { mode: 0o755 });
      const bad = await brokit(['doctor'], { env: { ...process.env, BROKIT_CHROME: broken } });
      assert.equal(bad.code, 1);
      assert.match(bad.stdout, /✗ starts: Chrome didn't start: Chrome exited \(3\)/);
      assert.match(bad.stdout, /fix: run brokit install-chrome/);
      assert.match(bad.stdout, /brokit can't work here yet/);
    });

    it('a scenario: JSON out, exit 1 when a step fails', async () => {
      writeFileSync(join(dir, 'fail.json'), JSON.stringify({ url: '/form.html', steps: [{ click: { selector: '#missing' } }] }));
      const r = await brokit(['run', join(dir, 'fail.json'), '--serve', 'test/fixtures', '--json']);
      assert.equal(r.code, 1);
      const result = JSON.parse(r.stdout);
      assert.equal(result.ok, false);
      assert.match(result.steps[0].error, /no element matches #missing/);
    });
  });
});
