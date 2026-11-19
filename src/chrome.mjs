// Find and start Chrome, and talk to it over the Chrome DevTools Protocol. One Chrome
// serves any number of pages (see page.mjs).
//
// brokit talks to Chrome over a pipe (two file descriptors only it holds), not a network
// port: no other program or user on the computer can connect to the browser it runs.
// (BROKIT_CHROME_TRANSPORT=port falls back to a WebSocket on 127.0.0.1, for a browser
// build that can't do pipes.) Chrome runs headless, with a throwaway profile and its
// sandbox on (brokit never passes --no-sandbox; in a container, run as a user that isn't
// root). Every protocol call times out, and Chrome is killed when the process exits.

import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { cacheDir, installPath, newestInstalledSync, pinnedVersion } from './install.mjs';
import { Page } from './page.mjs';

/**
 * Which Chrome to use, and why: { path, source, version? }, or { path: null, problem }.
 *   1. BROKIT_CHROME, a path
 *   2. the version the project pins (package.json "brokit": { "chrome": ... }, or
 *      BROKIT_CHROME_VERSION), from brokit's cache; if it isn't there, a problem saying so
 *   3. Chrome, Chromium or Edge installed on the computer
 *   4. the newest Chrome brokit installed (brokit install-chrome)
 */
export function chooseChrome({ env = process.env, platform = process.platform, cwd = process.cwd() } = {}) {
  if (env.BROKIT_CHROME) return { path: env.BROKIT_CHROME, source: 'BROKIT_CHROME' };
  const pin = pinnedVersion({ env, cwd });
  if (pin) {
    const { path } = installPath(pin.version, { cache: cacheDir({ env, platform }) });
    if (existsSync(path)) return { path, source: `pinned in ${pin.from}`, version: pin.version };
    return { path: null, problem: `this project uses Chrome ${pin.version} (${pin.from}), which isn't installed here: run brokit install-chrome` };
  }
  const system = systemChrome({ env, platform });
  if (system) return { path: system, source: 'installed on this computer' };
  const own = newestInstalledSync({ cache: cacheDir({ env, platform }) });
  if (own) return { path: own.path, source: "brokit's own (brokit install-chrome)", version: own.version };
  return { path: null, problem: 'no Chrome found: install Chrome, Chromium or Edge, or run brokit install-chrome, or set BROKIT_CHROME to a browser' };
}

/** The Chrome brokit would use (see chooseChrome), or null. */
export function findChrome(options = {}) {
  return chooseChrome(options).path;
}

/** Chrome, Chromium or Edge installed on the computer, or null. */
export function systemChrome({ env = process.env, platform = process.platform } = {}) {
  const runnable = (file) => {
    try {
      accessSync(file, platform === 'win32' ? constants.F_OK : constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (platform === 'darwin') {
    const apps = ['Google Chrome', 'Google Chrome Canary', 'Chromium', 'Microsoft Edge'];
    const homes = ['/Applications', join(env.HOME ?? '', 'Applications')];
    for (const home of homes) for (const app of apps) if (runnable(join(home, `${app}.app/Contents/MacOS/${app}`))) return join(home, `${app}.app/Contents/MacOS/${app}`);
    return null;
  }
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    const apps = ['Google\\Chrome\\Application\\chrome.exe', 'Chromium\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe'];
    for (const app of apps) for (const root of roots) if (runnable(join(root, app))) return join(root, app);
    return null;
  }
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable'];
  for (const name of names) for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) if (runnable(join(dir, name))) return join(dir, name);
  return null;
}

// How Chrome draws. "default" is Chrome's own choice; "software" is SwiftShader, the same
// pixels on every machine (the one to compare screenshots with); "hardware" asks for the
// real GPU, WebGPU included, where the platform allows it headless.
const GPU_FLAGS = {
  default: () => [],
  software: () => ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  hardware: (platform) => ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu', ...(platform === 'linux' ? ['--use-angle=gl'] : [])],
};
export const GPU_MODES = Object.keys(GPU_FLAGS);

// Flags passed through to Chrome or V8 must look like flags: no spaces, no shell, no paths
// smuggled in as values.
const FLAG = /^--[a-z0-9][\w-]*(=[\w.,:/-]+)?$/i;

/**
 * Start Chrome. Options: chrome (its path), gpu, jsFlags ("--a --b=1", for V8),
 * chromeFlags (a list), profile (a directory to keep; default a throwaway one),
 * transport ("pipe", the default, or "port"), startTimeout (ms).
 * Resolves to a Browser.
 */
export async function launch({
  chrome,
  gpu = 'default',
  jsFlags = null,
  chromeFlags = [],
  profile = null,
  transport = process.env.BROKIT_CHROME_TRANSPORT || 'pipe',
  startTimeout = 20000,
} = {}) {
  if (!chrome) {
    const choice = chooseChrome();
    if (!choice.path) throw Object.assign(new Error(choice.problem), { code: 'BROKIT_NO_CHROME' });
    chrome = choice.path;
  }
  if (!GPU_FLAGS[gpu]) throw new Error(`gpu: one of ${GPU_MODES.join(', ')}`);
  if (transport !== 'pipe' && transport !== 'port') throw new Error('transport: "pipe" or "port"');
  const pipe = transport === 'pipe';
  const unsandboxed = sandboxOff();
  if (jsFlags !== null && !String(jsFlags).split(' ').every((f) => FLAG.test(f))) throw new Error(`bad V8 flags: ${jsFlags}`);
  for (const f of chromeFlags) if (!FLAG.test(f) || /^--(no-sandbox|remote-debugging|user-data-dir)/.test(f)) throw new Error(`Chrome flag not allowed: ${f}`);
  const ownProfile = !profile;
  const dir = profile ?? mkdtempSync(join(tmpdir(), 'brokit-'));
  // A reused profile still has the last run's port file; Chrome writes a fresh one.
  rmSync(join(dir, 'DevToolsActivePort'), { force: true });
  const args = [
    '--headless=new',
    `--user-data-dir=${dir}`,
    ...(pipe ? ['--remote-debugging-pipe'] : ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0']),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-component-update',
    '--mute-audio',
    // Pages keep running at full speed whether or not they're "in front".
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    // The same colors on every machine, whatever its display profile.
    '--force-color-profile=srgb',
    // Chrome's own built-in extensions with background pages: two more processes, about
    // 200 MB and CPU at start, for nothing a check uses (--disable-extensions spares them).
    '--disable-component-extensions-with-background-pages',
    ...GPU_FLAGS[gpu](process.platform),
    ...(jsFlags ? [`--js-flags=${jsFlags}`] : []),
    // Only from BROKIT_NO_SANDBOX inside a container (sandboxOff); never as a flag.
    ...(unsandboxed ? ['--no-sandbox'] : []),
    ...chromeFlags,
    'about:blank',
  ];
  // With a pipe, Chrome reads the protocol from its fd 3 and writes to its fd 4.
  const child = spawn(chrome, args, { stdio: pipe ? ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] : ['ignore', 'ignore', 'pipe'], env: chromeEnv(chrome) });
  live.add(child);
  child.once('exit', () => live.delete(child));
  // Chrome's own log, for error messages: the last 16 KB.
  let log = '';
  child.stderr.on('data', (d) => (log = (log + d).slice(-16384)));
  let spawnFailure = null; // the browser couldn't even be run (no such file, not executable)
  const spawnError = new Promise((_, reject) =>
    child.once('error', (e) => {
      spawnFailure = new Error(`couldn't start Chrome (${chrome}): ${e.message}`);
      reject(spawnFailure);
    }),
  );
  spawnError.catch(() => {});

  const cleanup = () => {
    child.kill('SIGKILL');
    if (ownProfile) removeProfile(dir);
  };
  try {
    if (pipe) {
      const connection = Connection.overPipe(child.stdio[3], child.stdio[4]);
      // Chrome is ready when it answers.
      const exited = new Promise((_, reject) => child.once('exit', (code, signal) => reject(new Error(`Chrome exited (${code ?? signal}):\n${log}`))));
      exited.catch(() => {});
      try {
        await Promise.race([connection.send('Browser.getVersion', {}, undefined, startTimeout), spawnError, exited]);
      } catch (e) {
        connection.close();
        // A Chrome that dies at start closes the pipe before it's seen to exit: wait a
        // moment for its exit, whose code and messages say why (doctor reads them).
        if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise((r) => child.once('close', r)), sleep(2000)]);
        if (spawnFailure) throw spawnFailure;
        // A Chrome that fails a fatal check aborts (SIGABRT): a signal, not an exit code.
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Chrome exited (${child.exitCode ?? child.signalCode}):\n${log}`);
        if (/timed out/.test(e.message)) throw new Error(`Chrome didn't answer over its pipe in ${startTimeout / 1000} s (an unusual build? BROKIT_CHROME_TRANSPORT=port uses a local port instead):\n${log}`);
        throw e;
      }
      return new Browser(child, connection, ownProfile ? dir : null, !unsandboxed);
    }
    const portFile = join(dir, 'DevToolsActivePort');
    const until = Date.now() + startTimeout;
    while (!existsSync(portFile)) {
      if (spawnFailure) throw spawnFailure;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Chrome exited (${child.exitCode ?? child.signalCode}):\n${log}`);
      if (Date.now() > until) throw new Error(`Chrome didn't start in ${startTimeout / 1000} s:\n${log}`);
      await Promise.race([sleep(30), spawnError]);
    }
    let port, path;
    // The file can exist before Chrome has finished writing it.
    for (;;) {
      [port, path] = readFileSync(portFile, 'utf8').split('\n');
      if (/^\d+$/.test(port) && path?.startsWith('/devtools/browser/')) break;
      if (Date.now() > until) throw new Error(`Chrome wrote a bad DevToolsActivePort: ${JSON.stringify(port)}`);
      await sleep(30);
    }
    const connection = await Connection.open(`ws://127.0.0.1:${port}${path.trim()}`);
    return new Browser(child, connection, ownProfile ? dir : null, !unsandboxed);
  } catch (e) {
    cleanup();
    throw e;
  }
}

/**
 * Whether brokit runs inside a container (Docker, Podman, Kubernetes, LXC, a CI job's
 * container): the only place BROKIT_NO_SANDBOX is honored.
 */
export function inContainer({ exists = existsSync, read = (f) => readFileSync(f, 'utf8'), env = process.env, platform = process.platform } = {}) {
  if (platform !== 'linux') return false;
  if (exists('/.dockerenv') || exists('/run/.containerenv') || env.KUBERNETES_SERVICE_HOST || env.container) return true;
  try {
    return /docker|kubepods|containerd|libpod|lxc/.test(read('/proc/1/cgroup'));
  } catch {
    return false;
  }
}

/**
 * Whether Chrome's sandbox is to be off: BROKIT_NO_SANDBOX=1, honored only inside a
 * container (there the container keeps Chrome apart from the computer; where its
 * settings can't be changed, Chrome's own sandbox can't start). Throws if it's asked
 * for anywhere else.
 */
export function sandboxOff({ env = process.env, container = inContainer({ env }) } = {}) {
  const asked = env.BROKIT_NO_SANDBOX && env.BROKIT_NO_SANDBOX !== '0' && env.BROKIT_NO_SANDBOX !== 'false';
  if (!asked) return false;
  if (!container) {
    throw Object.assign(new Error("BROKIT_NO_SANDBOX works only inside a container (a CI job's or Docker's), where the container keeps Chrome apart from the computer; here Chrome's sandbox stays on"), { code: 'BROKIT_SANDBOX' });
  }
  return true;
}

/**
 * Chrome's environment. On Linux, where a system doesn't let Chrome's sandbox use user
 * namespaces (Docker's defaults, Ubuntu 23.10+ with AppArmor), a downloaded Chrome can
 * sandbox with the setuid helper next to it, once an administrator has made it root's
 * and setuid (brokit doctor gives the two commands; brokit never changes it). Chrome
 * only looks for it where CHROME_DEVEL_SANDBOX says.
 */
export function chromeEnv(chrome, env = process.env) {
  if (process.platform !== 'linux' || env.CHROME_DEVEL_SANDBOX) return env;
  const helper = join(dirname(chrome), 'chrome_sandbox');
  try {
    const s = statSync(helper);
    if (s.uid === 0 && s.mode & 0o4000) return { ...env, CHROME_DEVEL_SANDBOX: helper };
  } catch {}
  return env;
}

// Every Chrome this process started and hasn't closed: killed when the process exits, so
// none is left running after a crash or a Ctrl+C (the CLI turns signals into an exit).
const live = new Set();
process.on('exit', () => {
  for (const child of live) child.kill('SIGKILL');
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function removeProfile(dir) {
  // Chrome can still be writing to it as it exits: a few tries. A leftover temp folder
  // never fails a run.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
}

/** A running Chrome. */
export class Browser {
  #child;
  #connection;
  #profile;
  #pages = new Set();
  #sandboxed;
  constructor(child, connection, profile, sandboxed = true) {
    this.#child = child;
    this.#connection = connection;
    this.#profile = profile;
    this.#sandboxed = sandboxed;
  }

  /** Whether Chrome runs with its sandbox (false only with BROKIT_NO_SANDBOX in a container). */
  get sandboxed() {
    return this.#sandboxed;
  }

  /** The DevTools Protocol connection, for calls brokit has no method for. */
  get connection() {
    return this.#connection;
  }

  /** Chrome's version, e.g. "Chrome/155.0.8059.39". */
  async version() {
    return (await this.#connection.send('Browser.getVersion')).product;
  }

  /**
   * Open a page (a tab) at about:blank. Options: size ("1280x800" or [w, h]), dpr, mobile
   * (phone-like: a mobile viewport and touch). Then `page.goto(url)`.
   */
  async newPage(options = {}) {
    // A page is a tab in Chrome's first window (whose blank tab stays, so the window
    // does), unless another page is open: then a window of its own, since a tab behind
    // another is a background tab, which Chrome gives no animation frames. A window costs
    // far more than a tab (a suite of 20 checks: 9.6 s of CPU in windows, 4.1 s in tabs),
    // so one page at a time, as run and check go, is always a tab.
    const { targetId } = await this.#connection.send('Target.createTarget', { url: 'about:blank', newWindow: this.#pages.size > 0 });
    const { sessionId } = await this.#connection.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this.#connection, sessionId, targetId, () => this.#pages.delete(page));
    this.#pages.add(page);
    await page.init(options);
    return page;
  }

  /** Close Chrome and remove its throwaway profile. Safe to call twice. */
  async close() {
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) return;
    try {
      await this.#connection.send('Browser.close', {}, undefined, 3000);
    } catch {}
    this.#connection.close();
    if (this.#child.exitCode === null) {
      let timer;
      await new Promise((r) => {
        this.#child.once('exit', r);
        timer = setTimeout(r, 5000);
      });
      clearTimeout(timer);
      this.#child.kill('SIGKILL');
    }
    if (this.#profile) removeProfile(this.#profile);
  }
}

// The largest message Chrome may send: a full-page screenshot of a long page is tens of
// MB of base64; anything far beyond that is a broken pipe, not a message.
const MAX_MESSAGE = 512 * 1024 * 1024;

/**
 * The connection to Chrome: calls with ids and timeouts, events routed by session. Over
 * a pipe (overPipe) or a WebSocket (open).
 */
export class Connection {
  #transport; // { send(text), close() }
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map(); // sessionId ('' for the browser) -> Set of (method, params) => void
  #closed = null;

  /** Over Chrome's --remote-debugging-pipe: we write to its fd 3, it writes to its fd 4; each message ends with a NUL byte. */
  static overPipe(toChrome, fromChrome) {
    const c = new Connection({ send: (text) => toChrome.write(`${text}\0`), close: () => toChrome.end() });
    let parts = [];
    let size = 0;
    fromChrome.on('data', (chunk) => {
      let start = 0;
      for (let end = chunk.indexOf(0); end !== -1; end = chunk.indexOf(0, start)) {
        parts.push(chunk.subarray(start, end));
        const text = Buffer.concat(parts).toString('utf8');
        parts = [];
        size = 0;
        start = end + 1;
        c.#receive(text);
      }
      if (start < chunk.length) {
        parts.push(chunk.subarray(start));
        size += chunk.length - start;
        if (size > MAX_MESSAGE) {
          c.#lost('Chrome sent a message over 512 MB');
          fromChrome.destroy();
        }
      }
    });
    fromChrome.on('close', () => c.#lost('Chrome closed the connection'));
    fromChrome.on('error', () => c.#lost('Chrome closed the connection'));
    toChrome.on('error', () => c.#lost('Chrome closed the connection'));
    return c;
  }

  /** Over a WebSocket (Chrome's debugging port). */
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error(`couldn't connect to Chrome at ${url}`));
    });
    const c = new Connection({ send: (text) => ws.send(text), close: () => ws.close() });
    ws.onmessage = (m) => c.#receive(m.data);
    ws.onclose = () => c.#lost('Chrome closed the connection');
    ws.onerror = () => {};
    return c;
  }

  constructor(transport) {
    this.#transport = transport;
  }

  #lost(reason) {
    this.#closed ??= reason;
    for (const { reject } of this.#pending.values()) reject(new Error(this.#closed));
    this.#pending.clear();
  }

  #receive(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.id !== undefined) {
      const call = this.#pending.get(msg.id);
      if (!call) return;
      this.#pending.delete(msg.id);
      if (msg.error) call.reject(new Error(`${call.method}: ${msg.error.message}${msg.error.data ? ` (${msg.error.data})` : ''}`));
      else call.resolve(msg.result);
    } else if (msg.method) {
      for (const listener of this.#listeners.get(msg.sessionId ?? '') ?? []) listener(msg.method, msg.params);
    }
  }

  /** Call `method`; on a page's session when `sessionId` is given. Rejects after `timeout` ms. */
  send(method, params = {}, sessionId, timeout = 30000) {
    if (this.#closed) return Promise.reject(new Error(this.#closed));
    return new Promise((resolve, reject) => {
      const id = this.#nextId++;
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out after ${timeout / 1000} s`));
      }, timeout);
      this.#pending.set(id, {
        method,
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      try {
        this.#transport.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch (e) {
        this.#pending.get(id)?.reject(new Error(`${method}: ${e.message}`));
        this.#pending.delete(id);
      }
    });
  }

  /** Listen to a session's events; returns a function that stops listening. */
  on(sessionId, listener) {
    const key = sessionId ?? '';
    if (!this.#listeners.has(key)) this.#listeners.set(key, new Set());
    this.#listeners.get(key).add(listener);
    return () => this.#listeners.get(key)?.delete(listener);
  }

  close() {
    this.#lost('closed');
    try {
      this.#transport.close();
    } catch {}
  }
}
