// brokit doctor: whether brokit can work here, and if not, exactly what to do about it.
// One command for a person setting up CI, or an agent before its first check.
//
// Each check is { name, status: "ok" | "warn" | "fail", detail, fix? }. Fixes name the
// command for this system (Debian and Ubuntu package names on Linux).

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { chooseChrome, inContainer, launch } from './chrome.mjs';
import { pinnedVersion } from './install.mjs';

const run = promisify(execFile);

// Libraries Chrome needs that a bare Linux image may not have, and the Debian/Ubuntu
// packages that bring them.
const LIB_PACKAGES = {
  'libnss3.so': 'libnss3',
  'libnssutil3.so': 'libnss3',
  'libsmime3.so': 'libnss3',
  'libnspr4.so': 'libnspr4',
  'libatk-1.0.so.0': 'libatk1.0-0',
  'libatk-bridge-2.0.so.0': 'libatk-bridge2.0-0',
  'libatspi.so.0': 'libatspi2.0-0',
  'libcups.so.2': 'libcups2',
  'libdrm.so.2': 'libdrm2',
  'libdbus-1.so.3': 'libdbus-1-3',
  'libxkbcommon.so.0': 'libxkbcommon0',
  'libXcomposite.so.1': 'libxcomposite1',
  'libXdamage.so.1': 'libxdamage1',
  'libXfixes.so.3': 'libxfixes3',
  'libXrandr.so.2': 'libxrandr2',
  'libXext.so.6': 'libxext6',
  'libX11.so.6': 'libx11-6',
  'libxcb.so.1': 'libxcb1',
  'libgbm.so.1': 'libgbm1',
  'libasound.so.2': 'libasound2',
  'libpango-1.0.so.0': 'libpango-1.0-0',
  'libcairo.so.2': 'libcairo2',
  'libexpat.so.1': 'libexpat1',
  'libglib-2.0.so.0': 'libglib2.0-0',
  'libgobject-2.0.so.0': 'libglib2.0-0',
  'libgio-2.0.so.0': 'libglib2.0-0',
  'libudev.so.1': 'libudev1',
};

const node = () => {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const ok = major > 22 || (major === 22 && minor >= 4);
  return { name: 'Node', status: ok ? 'ok' : 'fail', detail: `Node ${process.versions.node}`, ...(ok ? {} : { fix: 'brokit needs Node 22.4 or newer: https://nodejs.org' }) };
};

/** The libraries `path` needs that this Linux system lacks (from ldd), if it can tell. */
async function missingLibraries(path) {
  try {
    const { stdout } = await run('ldd', [path], { timeout: 10000 });
    return [...stdout.matchAll(/^\s*(\S+) => not found/gm)].map((m) => m[1]);
  } catch {
    return [];
  }
}

/** Why Chrome didn't start, and what to do: { detail, fix }. */
async function diagnose(path, error) {
  const text = error.message;
  const root = process.platform === 'linux' && process.getuid?.() === 0;
  if (root && /sandbox|root/i.test(text)) {
    return {
      detail: 'Chrome won\'t run as root with its sandbox on',
      fix: `run brokit as a user that isn't root. In Docker: add \`USER node\` (Node images have that user) or \`RUN useradd -m checker\` then \`USER checker\`; in CI jobs that run as root: \`su node -c "npx brokit check"\` after \`chown -R node .\`${inContainer() ? '. Or, in this container, set BROKIT_NO_SANDBOX=1 (Chrome without its sandbox, inside the container; only pages on this computer)' : ''}`,
    };
  }
  const libs = /error while loading shared libraries/.test(text) && process.platform === 'linux' ? await missingLibraries(path) : [];
  if (libs.length || /error while loading shared libraries: (\S+)/.test(text)) {
    const names = libs.length ? libs : [/error while loading shared libraries: ([^:\s]+)/.exec(text)[1]];
    const packages = [...new Set(names.map((l) => LIB_PACKAGES[l]).filter(Boolean))];
    return {
      detail: `Chrome is missing system libraries: ${names.join(', ')}`,
      fix: packages.length
        ? `install them (Debian, Ubuntu): apt-get install -y ${packages.join(' ')} fonts-liberation — or install Chromium from your distribution, which brings everything: apt-get install -y chromium`
        : 'install the libraries above with your system\'s package manager, or install Chromium from your distribution, which brings everything it needs',
    };
  }
  if (/No usable sandbox|setuid sandbox|namespace/i.test(text)) {
    // In a container, both of Chrome's sandboxes need namespaces the container's
    // defaults forbid (Docker's seccomp profile): only the container's settings help.
    if (inContainer()) {
      return {
        detail: 'Chrome\'s sandbox can\'t start in this container: its default settings forbid the namespaces Chrome needs (both its sandboxes need them)',
        fix: 'run the container with --security-opt=seccomp=unconfined (or --cap-add=SYS_ADMIN); for a self-hosted GitLab runner, set security_opt = ["seccomp=unconfined"] in its config.toml. Where the container\'s settings can\'t be changed (GitLab.com shared runners, GitHub jobs in a container), set BROKIT_NO_SANDBOX=1: Chrome then runs without its sandbox, inside the container, and brokit opens only pages on this computer',
      };
    }
    const detail = 'Chrome\'s sandbox can\'t start: this system doesn\'t let it create user namespaces (Ubuntu 23.10 and newer don\'t, for browsers they don\'t know)';
    // Debian's chromium has its setuid helper in a package of its own.
    if (/chromium-sandbox/.test(text)) return { detail, fix: 'install Chromium\'s sandbox helper: apt-get install -y chromium-sandbox' };
    // A downloaded Chrome has the helper beside it, to be made root's and setuid.
    const helper = join(dirname(path), 'chrome_sandbox');
    if (existsSync(helper)) {
      return {
        detail,
        fix: `let Chrome use the sandbox helper beside it (as root, once): chown root:root "${helper}" && chmod 4755 "${helper}" — brokit then uses it on its own`,
      };
    }
    return { detail, fix: 'use your distribution\'s Chrome or Chromium package (it brings what its sandbox needs), or on Ubuntu 23.10 and newer allow it with an AppArmor profile' };
  }
  if (/over its pipe/.test(text)) {
    try {
      const b = await launch({ chrome: path, transport: 'port' });
      await b.close();
      return { detail: 'this Chrome can\'t talk over a pipe, but works over a local port', fix: 'set BROKIT_CHROME_TRANSPORT=port (see SECURITY.md for what that means)' };
    } catch {}
  }
  return { detail: `Chrome didn't start: ${text.split('\n').slice(0, 6).join(' / ')}`, fix: 'run brokit install-chrome to get Google\'s Chrome for Testing, or set BROKIT_CHROME to another browser' };
}

async function fonts() {
  if (process.platform !== 'linux') return null;
  try {
    const { stdout } = await run('fc-list', [], { timeout: 10000 });
    const n = stdout.split('\n').filter(Boolean).length;
    return n
      ? { name: 'fonts', status: 'ok', detail: `${n} fonts installed` }
      : { name: 'fonts', status: 'fail', detail: 'no fonts installed: pages will draw no text', fix: 'apt-get install -y fonts-liberation (Debian, Ubuntu), or your system\'s fonts package' };
  } catch {
    return { name: 'fonts', status: 'warn', detail: 'couldn\'t list fonts (no fc-list)', fix: 'if text is missing from screenshots, install fonts: apt-get install -y fontconfig fonts-liberation' };
  }
}

function ci(env) {
  const where = env.GITHUB_ACTIONS ? 'GitHub Actions' : env.GITLAB_CI ? 'GitLab CI' : env.CI && env.CI !== 'false' ? 'CI' : null;
  const pin = pinnedVersion({ env });
  const same = 'Baseline screenshots match only where the operating system, its fonts and the Chrome version are the same: make and update them where CI runs (or in the same container)';
  const pinned = pin ? ` This project uses Chrome ${pin.version}.` : ' To use the same Chrome everywhere, pin it: brokit install-chrome --pin.';
  return where
    ? { name: 'CI', status: 'ok', detail: `in ${where}: a missing baseline fails here instead of being written. ${same}.${pinned}` }
    : { name: 'CI', status: 'ok', detail: `not in CI: missing baselines are written. ${same}.${pinned}` };
}

/** Run every check. `onCheck(check)` gets each as it's done. Resolves to { ok, checks }. */
export async function doctor({ env = process.env, onCheck } = {}) {
  const checks = [];
  const add = (c) => {
    if (!c) return;
    checks.push(c);
    onCheck?.(c);
  };
  add(node());
  const choice = chooseChrome({ env });
  if (!choice.path) {
    add({ name: 'Chrome', status: 'fail', detail: choice.problem, fix: 'npx brokit install-chrome downloads Google\'s Chrome for Testing into brokit\'s cache; or install Chrome, Chromium or Edge; or set BROKIT_CHROME to a browser' });
  } else {
    let browser;
    try {
      browser = await launch({ chrome: choice.path });
    } catch (e) {
      add({ name: 'Chrome', status: 'ok', detail: `found at ${choice.path} (${choice.source})` });
      if (e.code === 'BROKIT_SANDBOX') add({ name: 'starts', status: 'fail', detail: e.message, fix: 'unset BROKIT_NO_SANDBOX: outside a container Chrome keeps its sandbox' });
      else add({ name: 'starts', status: 'fail', ...(await diagnose(choice.path, e)) });
    }
    if (browser) {
      try {
        add({ name: 'Chrome', status: 'ok', detail: `${(await browser.version()).replace('/', ' ')} at ${choice.path} (${choice.source})` });
        const page = await browser.newPage();
        try {
          // Chrome's own sandbox report.
          await page.goto('chrome://sandbox', { ready: 'document.body && document.body.innerText.length > 0', timeout: 10000 });
          const report = await page.eval('document.body.innerText');
          const sandboxed = /adequately sandboxed/i.test(report);
          add(
            !browser.sandboxed
              ? { name: 'starts', status: 'warn', detail: 'starts headless, over a pipe, with its sandbox OFF (BROKIT_NO_SANDBOX, in a container): brokit opens only pages on this computer' }
              : sandboxed
                ? { name: 'starts', status: 'ok', detail: 'starts headless, over a pipe, with its sandbox on' }
                : { name: 'starts', status: 'warn', detail: `starts, but Chrome says its sandbox isn't complete: ${report.split('\n').filter(Boolean).slice(-1)[0] ?? ''}`.trim() },
          );
          await page.goto('about:blank');
          const drawn = await page.eval(`(() => {
            document.body.innerHTML = '<p id="t" style="font: 16px sans-serif; display: inline-block">Hello</p>';
            const width = document.getElementById('t').getBoundingClientRect().width;
            const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
            const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
            return { width, webgl: gl ? (info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'yes') : null };
          })()`);
          const shot = await page.screenshot();
          const text = drawn.width > 0;
          add({
            name: 'draws',
            status: text && shot.png.length > 0 ? (drawn.webgl ? 'ok' : 'warn') : 'fail',
            detail: `text ${text ? 'yes' : 'NO'}, screenshots yes, WebGL ${drawn.webgl ? `yes (${drawn.webgl})` : 'no'}`,
            ...(text ? {} : { fix: 'install fonts: apt-get install -y fonts-liberation (Debian, Ubuntu)' }),
            ...(drawn.webgl ? {} : text ? { fix: 'pages using WebGL won\'t draw; try --gpu software' } : {}),
          });
        } finally {
          await page.close();
        }
      } catch (e) {
        add({ name: 'draws', status: 'fail', detail: `couldn't open a page: ${e.message.split('\n')[0]}` });
      } finally {
        await browser.close();
      }
    }
  }
  add(await fonts());
  add(ci(env));
  return { ok: checks.every((c) => c.status !== 'fail'), checks };
}
