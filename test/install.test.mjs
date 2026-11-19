import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { chooseChrome, chromeEnv } from '../src/chrome.mjs';
import { cacheDir, cftPlatform, installedChromes, installPath, pinnedVersion, pinVersion, resolveChrome } from '../src/install.mjs';

describe('where brokit keeps its own Chrome', () => {
  it('a cache folder per system, BROKIT_CACHE anywhere', () => {
    assert.equal(cacheDir({ env: { BROKIT_CACHE: '/x/y' }, platform: 'linux' }), '/x/y');
    assert.equal(cacheDir({ env: { XDG_CACHE_HOME: '/c' }, platform: 'linux' }), join('/c', 'brokit'));
    assert.equal(cacheDir({ env: {}, platform: 'linux' }), join(homedir(), '.cache', 'brokit'));
    assert.equal(cacheDir({ env: {}, platform: 'darwin' }), join(homedir(), 'Library', 'Caches', 'brokit'));
    assert.equal(cacheDir({ env: { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, platform: 'win32' }), join('C:\\Users\\a\\AppData\\Local', 'brokit', 'Cache'));
  });

  it('Chrome for Testing\'s platform names', () => {
    assert.equal(cftPlatform({ platform: 'linux', arch: 'x64' }), 'linux64');
    assert.equal(cftPlatform({ platform: 'linux', arch: 'arm64' }), 'linux-arm64');
    assert.equal(cftPlatform({ platform: 'darwin', arch: 'arm64' }), 'mac-arm64');
    assert.equal(cftPlatform({ platform: 'darwin', arch: 'x64' }), 'mac-x64');
    assert.equal(cftPlatform({ platform: 'win32', arch: 'x64' }), 'win64');
    assert.equal(cftPlatform({ platform: 'freebsd', arch: 'x64' }), null);
  });

  it('the browser inside each platform\'s build', () => {
    assert.match(installPath('1.2.3.4', { cache: '/c', cft: 'linux64' }).path, /chrome-linux64[\\/]chrome$/);
    assert.match(installPath('1.2.3.4', { cache: '/c', cft: 'win64' }).path, /chrome-win64[\\/]chrome\.exe$/);
    assert.match(installPath('1.2.3.4', { cache: '/c', cft: 'mac-arm64' }).path, /Google Chrome for Testing\.app[\\/]Contents[\\/]MacOS[\\/]Google Chrome for Testing$/);
  });

  it('versions must look like versions or channels (before anything is downloaded)', async () => {
    await assert.rejects(resolveChrome('latest'), /a version like 156\.0\.8078\.47, or one of stable, beta, dev, canary/);
    await assert.rejects(resolveChrome('156; rm -rf /'), /a version like/);
    await assert.rejects(resolveChrome('stable', { cft: null }), /no build for/);
  });
});

describe('a project\'s pinned Chrome, and which Chrome brokit uses', () => {
  let dir;
  before(() => (dir = mkdtempSync(join(tmpdir(), 'brokit-install-test-'))));
  after(() => rmSync(dir, { recursive: true, force: true }));

  // A fake installed Chrome for Testing in `cache`.
  const fakeInstall = (cache, version) => {
    const { dir: d, path } = installPath(version, { cache });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '#!/bin/sh\n');
    chmodSync(path, 0o755);
    writeFileSync(join(d, 'installed.json'), JSON.stringify({ version, platform: cftPlatform(), path }));
    return path;
  };

  it('reads the pin from the nearest package.json, or BROKIT_CHROME_VERSION', () => {
    const project = join(dir, 'project');
    mkdirSync(join(project, 'web', 'checks'), { recursive: true });
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'p', brokit: { chrome: '156.0.8078.47' } }));
    assert.deepEqual(pinnedVersion({ env: {}, cwd: join(project, 'web', 'checks') }), { version: '156.0.8078.47', from: join(project, 'package.json') });
    assert.deepEqual(pinnedVersion({ env: { BROKIT_CHROME_VERSION: '150.0.1.2' }, cwd: project }), { version: '150.0.1.2', from: 'BROKIT_CHROME_VERSION' });
    const other = join(dir, 'other');
    mkdirSync(other);
    writeFileSync(join(other, 'package.json'), JSON.stringify({ name: 'o' }));
    assert.equal(pinnedVersion({ env: {}, cwd: other }), null);
  });

  it('--pin writes it, keeping the file\'s indentation', async () => {
    const file = join(dir, 'pin.json');
    writeFileSync(file, '{\n    "name": "x",\n    "brokit": { "other": 1 }\n}\n');
    await pinVersion(file, '156.0.8078.47');
    const text = readFileSync(file, 'utf8');
    assert.match(text, /^ {4}"name"/m);
    assert.deepEqual(JSON.parse(text).brokit, { other: 1, chrome: '156.0.8078.47' });
  });

  it('finds builds in a cache that moved (paths come from the folder, not from the file)', async () => {
    const cache = join(dir, 'moved-cache');
    const path = fakeInstall(cache, '140.0.1.2');
    const info = join(dirname(dirname(path)), 'installed.json');
    writeFileSync(info, JSON.stringify({ version: '140.0.1.2', platform: cftPlatform(), path: '/home/someone-else/.cache/brokit/chrome/x/chrome' }));
    assert.deepEqual((await installedChromes({ cache })).map((c) => c.path), [path]);
    writeFileSync(info, JSON.stringify({ version: '../../etc', platform: cftPlatform() }));
    assert.deepEqual(await installedChromes({ cache }), [], 'a marker that doesn\'t match its folder is ignored');
  });

  it('uses Chrome\'s setuid sandbox helper only when it\'s root\'s and setuid', () => {
    const chrome = fakeInstall(join(dir, 'helper-cache'), '141.0.1.2');
    const helper = join(dirname(chrome), 'chrome_sandbox');
    writeFileSync(helper, '');
    chmodSync(helper, 0o4755); // setuid, but ours, not root's: not used
    assert.equal(chromeEnv(chrome, { A: '1' }).CHROME_DEVEL_SANDBOX, undefined);
    assert.equal(chromeEnv(chrome, { CHROME_DEVEL_SANDBOX: '/given' }).CHROME_DEVEL_SANDBOX, '/given');
  });

  it('chooses BROKIT_CHROME, then the pin, then the system\'s, then brokit\'s own', async () => {
    const cache = join(dir, 'cache');
    const project = join(dir, 'pinned');
    mkdirSync(project);
    writeFileSync(join(project, 'package.json'), JSON.stringify({ brokit: { chrome: '156.0.8078.47' } }));
    const plain = join(dir, 'plain');
    mkdirSync(plain);
    writeFileSync(join(plain, 'package.json'), '{}');
    const noSystem = { PATH: '', BROKIT_CACHE: cache };

    assert.deepEqual(chooseChrome({ env: { BROKIT_CHROME: '/opt/c' }, cwd: project }), { path: '/opt/c', source: 'BROKIT_CHROME' });
    const missing = chooseChrome({ env: noSystem, cwd: project, platform: 'linux' });
    assert.equal(missing.path, null);
    assert.match(missing.problem, /this project uses Chrome 156\.0\.8078\.47 \(.*package\.json\), which isn't installed here: run brokit install-chrome/);
    assert.match(chooseChrome({ env: noSystem, cwd: plain, platform: 'linux' }).problem, /no Chrome found/);

    const pinnedPath = fakeInstall(cache, '156.0.8078.47');
    fakeInstall(cache, '150.0.7000.1');
    const pinned = chooseChrome({ env: noSystem, cwd: project, platform: 'linux' });
    assert.equal(pinned.path, pinnedPath);
    assert.match(pinned.source, /^pinned in /);
    const own = chooseChrome({ env: noSystem, cwd: plain, platform: 'linux' });
    assert.equal(own.version, '156.0.8078.47', 'the newest of brokit\'s own');
    assert.deepEqual((await installedChromes({ cache })).map((c) => c.version), ['156.0.8078.47', '150.0.7000.1']);
  });
});
