import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeStep, parseStep } from '../src/actions.mjs';
import { findChrome } from '../src/chrome.mjs';
import { checkScenario, checkUrl, imageName } from '../src/run.mjs';

describe('checkUrl', () => {
  it('pages on this computer', () => {
    assert.equal(checkUrl('http://localhost:3000/a'), 'http://localhost:3000/a');
    assert.equal(checkUrl('http://127.0.0.1/'), 'http://127.0.0.1/');
    assert.equal(checkUrl('http://[::1]:8080/'), 'http://[::1]:8080/');
    assert.equal(checkUrl('https://app.localhost/'), 'https://app.localhost/');
    assert.equal(checkUrl('/form.html', { base: 'http://127.0.0.1:5000/' }), 'http://127.0.0.1:5000/form.html');
  });

  it('other hosts only when allowed', () => {
    assert.throws(() => checkUrl('https://example.com/'), /example\.com isn't on this computer; allow it with --allow-host example\.com/);
    assert.equal(checkUrl('https://example.com/', { allowHosts: ['example.com'] }), 'https://example.com/');
    assert.throws(() => checkUrl('https://localhost.evil.com/'), /isn't on this computer/);
    assert.throws(() => checkUrl('http://127.0.0.1@evil.com/'), /isn't on this computer/);
  });

  it('http and https only', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'chrome://settings', 'data:text/html,hi']) assert.throws(() => checkUrl(url), /only http and https/, url);
  });

  it('a relative URL needs a base', () => {
    assert.throws(() => checkUrl('/form.html'), /needs a base/);
  });
});

describe('imageName', () => {
  it('adds .png, keeps safe names', () => {
    assert.equal(imageName('typed'), 'typed.png');
    assert.equal(imageName('step-2_a.png'), 'step-2_a.png');
    assert.equal(imageName('v1.2'), 'v1.2.png');
  });
  it('refuses anything that could leave the folder', () => {
    for (const bad of ['../x', '/etc/x', 'a/b', 'a\\b', '.hidden', '..', 'a..b', '', 'x'.repeat(101), 5, 'C:x']) assert.throws(() => imageName(bad), /screenshot name/, String(bad));
  });
});

describe('checkScenario', () => {
  it('accepts a full scenario', () => {
    checkScenario({ name: 'n', note: 'x', url: '/', viewport: { size: '393x852', dpr: 3, mobile: true }, ready: 'app.ready', timeout: 5000, steps: [{ click: [1, 2] }], report: '1' });
  });
  it('says what\'s wrong', () => {
    assert.throws(() => checkScenario({}), /"url" is required/);
    assert.throws(() => checkScenario({ url: '/', step: [] }), /unknown step/);
    assert.throws(() => checkScenario({ url: '/', viewport: { width: 3 } }), /viewport: unknown width/);
    assert.throws(() => checkScenario({ url: '/', viewport: { size: '100' } }), /size: like "1280x800"/);
    assert.throws(() => checkScenario({ url: '/', ready: 'a', readyTitle: 'b' }), /not both/);
    assert.throws(() => checkScenario({ url: '/', timeout: -1 }), /timeout/);
    assert.throws(() => checkScenario({ url: '/', steps: [{ click: [1, 2] }, { clik: [1, 2] }] }), /step 2: no action/);
  });
});

describe('parseStep', () => {
  it('one action, its options, a note', () => {
    assert.deepEqual(parseStep({ click: '#a', button: 'right', note: 'menu' }).slice(0, 2), ['click', '#a']);
    assert.deepEqual(parseStep({ key: 'Tab', shift: true }).slice(0, 2), ['key', 'Tab']);
  });
  it('helpful errors', () => {
    assert.throws(() => parseStep({ click: [1, 2], type: 'x' }), /one action per step; this one has click and type/);
    assert.throws(() => parseStep({ click: [1, 2], buton: 'left' }), /click: unknown option buton \(it takes button, count/);
    assert.throws(() => parseStep({ wait: 5, shift: true }), /wait: unknown option shift$/);
    assert.throws(() => parseStep({ key: 'a', shift: 'yes' }), /shift: true or false/);
    assert.throws(() => parseStep([]), /a step is an object/);
    assert.throws(() => parseStep({ note: 'only a note' }), /no action/);
  });
});

describe('describeStep', () => {
  it('reads well', () => {
    assert.equal(describeStep({ click: { selector: '#email' } }), 'click #email');
    assert.equal(describeStep({ click: { selector: 'canvas', offset: [10, 20] } }), 'click canvas +[10,20]');
    assert.equal(describeStep({ click: [10, 20], shift: true }), 'Shift click [10,20]');
    assert.equal(describeStep({ key: 'Tab', shift: true }), 'key Shift+Tab');
    assert.equal(describeStep({ type: 'hello' }), 'type "hello"');
    assert.equal(describeStep({ wait: 100 }), 'wait 100 ms');
    assert.equal(describeStep({ screenshot: 'home' }), 'screenshot home');
  });
});

describe('findChrome', () => {
  it('BROKIT_CHROME wins', () => {
    assert.equal(findChrome({ env: { BROKIT_CHROME: '/opt/my-chrome' } }), '/opt/my-chrome');
  });
  it('nothing on an empty PATH', () => {
    assert.equal(findChrome({ env: { PATH: '', BROKIT_CACHE: '/nonexistent-brokit-cache' }, platform: 'linux', cwd: '/' }), null);
  });
});

describe('BROKIT_NO_SANDBOX', () => {
  it('knows a container when it sees one', async () => {
    const { inContainer } = await import('../src/chrome.mjs');
    const none = { exists: () => false, read: () => '0::/init.scope\n', env: {}, platform: 'linux' };
    assert.equal(inContainer(none), false);
    assert.equal(inContainer({ ...none, exists: (f) => f === '/.dockerenv' }), true);
    assert.equal(inContainer({ ...none, exists: (f) => f === '/run/.containerenv' }), true);
    assert.equal(inContainer({ ...none, env: { KUBERNETES_SERVICE_HOST: '10.0.0.1' } }), true);
    assert.equal(inContainer({ ...none, read: () => '12:pids:/docker/3f9a\n' }), true);
    assert.equal(inContainer({ ...none, read: () => { throw new Error('no /proc'); } }), false);
    assert.equal(inContainer({ ...none, exists: () => true, platform: 'darwin' }), false);
  });

  it('is honored only in a container', async () => {
    const { sandboxOff } = await import('../src/chrome.mjs');
    assert.equal(sandboxOff({ env: {}, container: true }), false);
    assert.equal(sandboxOff({ env: { BROKIT_NO_SANDBOX: '1' }, container: true }), true);
    assert.equal(sandboxOff({ env: { BROKIT_NO_SANDBOX: '0' }, container: true }), false);
    assert.throws(() => sandboxOff({ env: { BROKIT_NO_SANDBOX: '1' }, container: false }), /works only inside a container/);
  });

  it('without the sandbox, only pages on this computer', async () => {
    const { runScenario } = await import('../src/run.mjs');
    const unsandboxed = { sandboxed: false, newPage: () => assert.fail('no page should open') };
    await assert.rejects(runScenario(unsandboxed, { url: 'https://example.com/' }, { allowHosts: ['example.com'] }), /example\.com: with Chrome's sandbox off \(BROKIT_NO_SANDBOX\), brokit opens only pages on this computer/);
  });
});
