import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { serve } from '../src/serve.mjs';

/** A raw request (fetch would tidy up "..": we want to send it as an attacker would). */
function get(port, path, { method = 'GET', host = `127.0.0.1:${port}` } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host } }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('serve', () => {
  let dir, server, port;
  let links = false;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'brokit-serve-test-'));
    const root = join(dir, 'root');
    mkdirSync(join(root, 'sub'), { recursive: true });
    mkdirSync(join(root, 'empty'));
    writeFileSync(join(root, 'index.html'), '<p>home</p>');
    writeFileSync(join(root, 'a.txt'), 'hello');
    writeFileSync(join(root, 'x.wasm'), 'w');
    writeFileSync(join(root, 'café.txt'), 'accent');
    writeFileSync(join(root, '.env'), 'SECRET=1');
    writeFileSync(join(root, 'sub', 'index.html'), '<p>sub</p>');
    writeFileSync(join(dir, 'secret.txt'), 'outside');
    // Symbolic links need developer mode on Windows; without them, those cases are skipped.
    try {
      symlinkSync(join(dir, 'secret.txt'), join(root, 'link.txt'));
      symlinkSync(join(root, 'a.txt'), join(root, 'inner-link.txt'));
      links = true;
    } catch {}
    server = await serve(root);
    port = server.port;
  });
  after(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves files and index.html, with types and no caching', async () => {
    const home = await get(port, '/');
    assert.equal(home.status, 200);
    assert.equal(home.body, '<p>home</p>');
    assert.match(home.headers['content-type'], /text\/html/);
    assert.equal(home.headers['cache-control'], 'no-store');
    assert.equal(home.headers['x-content-type-options'], 'nosniff');
    assert.equal((await get(port, '/sub/')).body, '<p>sub</p>');
    assert.equal((await get(port, '/sub')).body, '<p>sub</p>');
    assert.equal((await get(port, '/a.txt?v=1')).body, 'hello');
    assert.equal((await get(port, '/x.wasm')).headers['content-type'], 'application/wasm');
    assert.equal((await get(port, '/caf%C3%A9.txt')).body, 'accent');
    if (links) assert.equal((await get(port, '/inner-link.txt')).body, 'hello');
    assert.equal(server.url, `http://127.0.0.1:${port}/`);
  });

  it('answers HEAD without a body', async () => {
    const r = await get(port, '/a.txt', { method: 'HEAD' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-length'], '5');
    assert.equal(r.body, '');
  });

  it('serves nothing outside the root', async () => {
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/sub/../../secret.txt', '/%2E%2E%2Fsecret.txt', '/link.txt']) {
      const r = await get(port, path);
      assert.ok(r.status === 404 || r.status === 400, `${path}: ${r.status}`);
      assert.doesNotMatch(r.body, /outside/, path);
    }
  });

  it('no dotfiles, no listings, no odd paths', async () => {
    assert.equal((await get(port, '/.env')).status, 404);
    assert.equal((await get(port, '/sub/%2e%2e/.env')).status, 404);
    assert.equal((await get(port, '/empty/')).status, 404);
    assert.equal((await get(port, '/nope.html')).status, 404);
    assert.equal((await get(port, '/a%00.txt')).status, 400);
    assert.equal((await get(port, '/a%5c..%5csecret.txt')).status, 400);
    assert.equal((await get(port, '/%E0%A4%A')).status, 400);
  });

  it('only GET and HEAD', async () => {
    const r = await get(port, '/a.txt', { method: 'POST' });
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, 'GET, HEAD');
  });

  it('refuses requests for another host (DNS rebinding)', async () => {
    assert.equal((await get(port, '/a.txt', { host: `evil.example:${port}` })).status, 403);
    assert.equal((await get(port, '/a.txt', { host: `localhost:${port}` })).status, 200);
  });

  it('cross-origin isolation when asked', async () => {
    const s = await serve(server.root, { isolate: true });
    try {
      const r = await get(s.port, '/');
      assert.equal(r.headers['cross-origin-opener-policy'], 'same-origin');
      assert.equal(r.headers['cross-origin-embedder-policy'], 'require-corp');
    } finally {
      await s.close();
    }
    assert.equal((await get(port, '/')).headers['cross-origin-opener-policy'], undefined);
  });
});
