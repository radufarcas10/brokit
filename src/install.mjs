// A Chrome of brokit's own, for computers without one and for using the same version
// everywhere (screenshots from one Chrome version can differ slightly from another's).
//
// It's Google's "Chrome for Testing": a build made for automation, for every platform,
// at every version, listed at googlechromelabs.github.io/chrome-for-testing and served
// from storage.googleapis.com. brokit downloads it only when asked (`brokit install-chrome`),
// only from those two hosts, over HTTPS, checks the download against the MD5 Google's
// storage sends with it, unpacks it with zip.mjs (which checks every entry's CRC), and
// keeps it in a cache folder per user:
//   Linux    $XDG_CACHE_HOME/brokit or ~/.cache/brokit
//   macOS    ~/Library/Caches/brokit
//   Windows  %LOCALAPPDATA%\brokit\Cache
//   (BROKIT_CACHE anywhere)
//
// A project pins its Chrome in package.json, { "brokit": { "chrome": "156.0.8078.47" } },
// or with BROKIT_CHROME_VERSION; brokit then uses that version, and `brokit install-chrome`
// with no version installs it.

import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { unzip } from './zip.mjs';

const LIST = 'https://googlechromelabs.github.io/chrome-for-testing';
const HOSTS = new Set(['googlechromelabs.github.io', 'storage.googleapis.com']);
const MAX_DOWNLOAD = 600 * 1024 * 1024;
const MAX_LIST = 64 * 1024 * 1024;
const VERSION = /^\d+\.\d+\.\d+\.\d+$/;
export const CHANNELS = ['stable', 'beta', 'dev', 'canary'];

/** brokit's cache folder on this computer. */
export function cacheDir({ env = process.env, platform = process.platform } = {}) {
  if (env.BROKIT_CACHE) return resolve(env.BROKIT_CACHE);
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'brokit', 'Cache');
  if (platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'brokit');
  return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'brokit');
}

/** Chrome for Testing's name for this computer's platform, or null if it has no build for it. */
export function cftPlatform({ platform = process.platform, arch = process.arch } = {}) {
  if (platform === 'linux') return { x64: 'linux64', arm64: 'linux-arm64' }[arch] ?? null;
  if (platform === 'darwin') return { x64: 'mac-x64', arm64: 'mac-arm64' }[arch] ?? null;
  if (platform === 'win32') return { x64: 'win64', ia32: 'win32', arm64: 'win64' }[arch] ?? null;
  return null;
}

// Where the browser is inside an unpacked build.
function executable(dir, cft) {
  if (cft.startsWith('mac')) return join(dir, `chrome-${cft}`, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
  if (cft.startsWith('win')) return join(dir, `chrome-${cft}`, 'chrome.exe');
  return join(dir, `chrome-${cft}`, 'chrome');
}

/**
 * The Chrome version this project pins, and where it says so: BROKIT_CHROME_VERSION, or
 * "brokit": { "chrome": "..." } in the nearest package.json. Null if none.
 */
export function pinnedVersion({ env = process.env, cwd = process.cwd() } = {}) {
  if (env.BROKIT_CHROME_VERSION) return { version: env.BROKIT_CHROME_VERSION, from: 'BROKIT_CHROME_VERSION' };
  let dir = resolve(cwd);
  for (let depth = 0; depth < 50; depth++) {
    const file = join(dir, 'package.json');
    if (existsSync(file)) {
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        return null;
      }
      const version = pkg?.brokit?.chrome;
      return typeof version === 'string' ? { version, from: file } : null;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** The Chromes brokit has installed: [{ version, platform, path }], newest first. */
export async function installedChromes({ cache = cacheDir() } = {}) {
  const root = join(cache, 'chrome');
  let names;
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const found = names.map((name) => readInstalled(root, name)).filter(Boolean);
  return found.sort((a, b) => (versionKey(a.version) < versionKey(b.version) ? 1 : -1));
}

// An installed build, from its folder (not from a path saved in it: the cache may have
// moved, as when CI restores it under another home).
function readInstalled(root, name) {
  try {
    const info = JSON.parse(readFileSync(join(root, name, 'installed.json'), 'utf8'));
    if (!VERSION.test(info.version) || name !== `${info.version}-${info.platform}`) return null;
    const path = executable(join(root, name), info.platform);
    return existsSync(path) ? { version: info.version, platform: info.platform, path } : null;
  } catch {
    return null;
  }
}
const versionKey = (v) => v.split('.').map((n) => n.padStart(6, '0')).join('.');

/** The newest Chrome brokit has installed, found without waiting (for findChrome), or null. */
export function newestInstalledSync({ cache = cacheDir() } = {}) {
  const root = join(cache, 'chrome');
  let best = null;
  try {
    for (const name of readdirSync(root)) {
      const info = readInstalled(root, name);
      if (info && info.platform === cftPlatform() && (!best || versionKey(info.version) > versionKey(best.version))) best = info;
    }
  } catch {}
  return best;
}

/** Where brokit keeps (or would keep) a version: { dir, path }. */
export function installPath(version, { cache = cacheDir(), cft = cftPlatform() } = {}) {
  const dir = join(cache, 'chrome', `${version}-${cft}`);
  return { dir, path: executable(dir, cft) };
}

async function fetchChecked(url, { max }) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) throw new Error(`won't download from ${u.origin}`);
  const res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60 * 1000) });
  const final = new URL(res.url);
  if (final.protocol !== 'https:' || !HOSTS.has(final.hostname)) throw new Error(`${url} redirected to ${final.origin}, which brokit doesn't download from`);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const length = Number(res.headers.get('content-length'));
  if (length > max) throw new Error(`${url} is ${length} bytes, more than brokit will download`);
  return res;
}

/** The download for a version or channel: { version, url }. */
export async function resolveChrome(wanted = 'stable', { cft = cftPlatform() } = {}) {
  if (!cft) throw new Error(`Chrome for Testing has no build for ${process.platform} ${process.arch}`);
  const channel = CHANNELS.includes(String(wanted).toLowerCase()) ? wanted.toLowerCase() : null;
  if (!channel && !VERSION.test(wanted)) throw new Error(`a version like 156.0.8078.47, or one of ${CHANNELS.join(', ')}; got ${JSON.stringify(wanted)}`);
  const list = channel ? 'last-known-good-versions-with-downloads.json' : 'known-good-versions-with-downloads.json';
  const res = await fetchChecked(`${LIST}/${list}`, { max: MAX_LIST });
  const data = await res.json();
  const entry = channel ? data.channels?.[channel[0].toUpperCase() + channel.slice(1)] : data.versions?.find((v) => v.version === wanted);
  if (!entry) throw new Error(`Chrome for Testing has no version ${wanted}`);
  const download = entry.downloads?.chrome?.find((d) => d.platform === cft);
  if (!download) throw new Error(`Chrome for Testing ${entry.version} has no build for ${cft}`);
  return { version: entry.version, url: download.url };
}

/**
 * Install a Chrome for Testing version ("stable" by default) into the cache, unless it's
 * there. `onProgress({ phase, done, total })` reports the download and the unpacking.
 * Resolves to { version, platform, path, fresh } (fresh: it was downloaded just now).
 */
export async function installChrome(wanted = 'stable', { cache = cacheDir(), onProgress } = {}) {
  const cft = cftPlatform();
  if (VERSION.test(wanted)) {
    const { path } = installPath(wanted, { cache, cft });
    if (existsSync(path)) return { version: wanted, platform: cft, path, fresh: false };
  }
  const { version, url } = await resolveChrome(wanted, { cft });
  const { dir, path } = installPath(version, { cache, cft });
  if (existsSync(path)) return { version, platform: cft, path, fresh: false };

  const downloads = join(cache, 'downloads');
  await mkdir(downloads, { recursive: true });
  const id = `${process.pid}-${Date.now()}`;
  const zip = join(downloads, `chrome-${version}-${cft}.${id}.zip`);
  const partial = `${dir}.${id}.partial`;
  try {
    const res = await fetchChecked(url, { max: MAX_DOWNLOAD });
    const total = Number(res.headers.get('content-length')) || 0;
    const md5 = createHash('md5');
    let done = 0;
    await pipeline(
      Readable.fromWeb(res.body),
      new Transform({
        transform(chunk, _, next) {
          done += chunk.length;
          if (done > MAX_DOWNLOAD) return next(new Error(`the download passed ${MAX_DOWNLOAD} bytes`));
          md5.update(chunk);
          onProgress?.({ phase: 'download', done, total });
          next(null, chunk);
        },
      }),
      createWriteStream(zip),
    );
    if (total && done !== total) throw new Error(`the download stopped at ${done} of ${total} bytes`);
    // Google's storage sends the file's MD5: "x-goog-hash: crc32c=..., md5=<base64>".
    const sent = /md5=([A-Za-z0-9+/=]+)/.exec(res.headers.get('x-goog-hash') ?? '')?.[1];
    const got = md5.digest('base64');
    if (sent && sent !== got) throw new Error('the download is damaged (its MD5 differs from the one Google sent)');
    await unzip(zip, partial, { onEntry: (n, count) => onProgress?.({ phase: 'unpack', done: n, total: count }) });
    if (!existsSync(executable(partial, cft))) throw new Error('the download has no Chrome where Chrome for Testing keeps it');
    await rm(dir, { recursive: true, force: true });
    await rename(partial, dir);
    await writeFile(join(dir, 'installed.json'), `${JSON.stringify({ version, platform: cft, url, md5: got, installed: new Date().toISOString() }, null, 2)}\n`);
    return { version, platform: cft, path, fresh: true };
  } finally {
    await rm(zip, { force: true });
    await rm(partial, { recursive: true, force: true });
  }
}

/** Pin `version` in the package.json at `file` ("brokit": { "chrome": version }), keeping its indentation. */
export async function pinVersion(file, version) {
  const text = await readFile(file, 'utf8');
  const pkg = JSON.parse(text);
  const indent = /^[ \t]+/m.exec(text)?.[0] ?? '  ';
  pkg.brokit = { ...(pkg.brokit && typeof pkg.brokit === 'object' ? pkg.brokit : {}), chrome: version };
  await writeFile(file, `${JSON.stringify(pkg, null, indent)}\n`);
}
