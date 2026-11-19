// A static file server for checking pages from disk, on 127.0.0.1 only.
//
// Only files inside the root are served: no "..", no symbolic links that lead out of it,
// no dotfiles (.env, .git), no directory listings. Only GET and HEAD. Requests whose Host
// isn't this server (a DNS-rebinding page elsewhere) are refused. Nothing is cached.
// `isolate: true` adds the cross-origin isolation headers (COOP/COEP), which pages using
// SharedArrayBuffer or precise timers need.

import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, normalize, relative, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.pdf': 'application/pdf',
};

/**
 * Serve `root` on 127.0.0.1. Resolves to { url, port, root, close() }; `url` ends in "/".
 * `port: 0` (the default) picks a free port.
 */
export async function serve(root, { port = 0, isolate = false } = {}) {
  const base = await realpath(root);
  if (!(await stat(base)).isDirectory()) throw new Error(`serve: ${root} isn't a directory`);
  let origin = '';
  const server = createServer(async (req, res) => {
    const fail = (code, text) => {
      res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`${code} ${text}\n`);
    };
    try {
      if (req.headers.host !== origin && req.headers.host !== origin.replace('127.0.0.1', 'localhost')) return fail(403, 'forbidden host');
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return fail(405, 'method not allowed');
      }
      const file = await resolveFile(base, req.url);
      if (!file) return fail(404, 'not found');
      const headers = {
        'Content-Type': TYPES[extname(file.path).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': file.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...(isolate ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' } : {}),
      };
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      createReadStream(file.path).on('error', () => res.destroy()).pipe(res);
    } catch (e) {
      fail(e.status ?? 500, e.status ? e.message : 'server error');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const actual = server.address().port;
  origin = `127.0.0.1:${actual}`;
  return {
    url: `http://${origin}/`,
    port: actual,
    root: base,
    close: () => new Promise((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
  };
}

/** The file a request path names inside `base` (realpath'd), or null for "not found". */
export async function resolveFile(base, url) {
  let path;
  try {
    path = decodeURIComponent(new URL(url, 'http://x').pathname);
  } catch {
    throw Object.assign(new Error('bad request'), { status: 400 });
  }
  if (path.includes('\0') || path.includes('\\')) throw Object.assign(new Error('bad request'), { status: 400 });
  const parts = path.split('/').filter(Boolean);
  if (parts.some((p) => p.startsWith('.'))) return null;
  let full = normalize(join(base, ...parts));
  if (!inside(base, full)) return null;
  let info;
  try {
    info = await stat(full);
    if (info.isDirectory()) {
      full = join(full, 'index.html');
      info = await stat(full);
    }
  } catch {
    return null;
  }
  if (!info.isFile()) return null;
  // A symbolic link inside the root may lead out of it.
  const real = await realpath(full);
  if (!inside(base, real)) return null;
  return { path: real, size: info.size };
}

function inside(base, path) {
  const rel = relative(base, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
