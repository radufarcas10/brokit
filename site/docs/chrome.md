# Chrome and safety

brokit drives a real Chrome: the one on your computer, or one it downloads for you. This
page covers how it finds that Chrome, how to check that everything is in place, how to
keep the same Chrome everywhere, and what brokit does to keep pages and your computer
apart.

## Is everything in place?

```sh
brokit doctor
```

```
$ brokit doctor
brokit doctor
  ✓ Node: Node 26.5.0
  ✓ Chrome: Chrome 158.0.8127.36 at /usr/bin/google-chrome (installed on this computer)
  ✓ starts: starts headless, over a pipe, with its sandbox on
  ✓ draws: text yes, screenshots yes, WebGL yes (ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver))
  ✓ fonts: 404 fonts installed
  ✓ CI: not in CI: missing baselines are written. Baseline screenshots match only where the operating system, its fonts and the Chrome version are the same: make and update them where CI runs (or in the same container). To use the same Chrome everywhere, pin it: brokit install-chrome --pin.
brokit is ready here
```

`doctor` checks Node, which Chrome brokit would use, that it starts with its sandbox on,
that it draws text, screenshots and WebGL, that fonts are installed, and what CI changes.
When something's missing, it says exactly what to run on that system: the packages a
Debian container lacks, the user to run as, the container setting Chrome's sandbox needs.
It exits 0 when brokit can work and 1 when it can't.

`brokit doctor --json` gives the same as data: `{ "ok": true, "checks": [{ "name",
"status": "ok" | "warn" | "fail", "detail", "fix" }] }`. Running it first is the best way
for an AI agent to set brokit up.

## Which Chrome

brokit uses, in this order:

1. `BROKIT_CHROME`, a path to a browser;
2. the version the project pins (below), from brokit's own cache;
3. Chrome, Chromium or Edge installed on the computer (Linux, macOS, Windows; tested on
   Linux so far);
4. a Chrome that `brokit install-chrome` downloaded.

```sh
BROKIT_CHROME=/usr/bin/chromium brokit check
```

## Installing and pinning Chrome

**No Chrome, or the same Chrome everywhere:** `brokit install-chrome` downloads Google's
[Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/) (the
stable version, or one you name) into a cache folder of brokit's. It's the only time
brokit downloads anything.

```sh
brokit install-chrome                # the version this project pins, or stable
brokit install-chrome beta           # or stable, dev, canary
brokit install-chrome 156.0.8078.47  # an exact version
```

Screenshots from one Chrome version can differ slightly from another's, so a project that
keeps baselines can pin its version:

```sh
npx brokit install-chrome --pin     # installs stable and writes it to package.json:
                                    # "brokit": { "chrome": "156.0.8078.47" }
npx brokit install-chrome           # elsewhere (a teammate, CI): installs the pinned one
```

Once pinned, brokit uses that version wherever the project runs; where it isn't
installed yet, brokit stops and says to run `brokit install-chrome`. `BROKIT_CHROME_VERSION` pins a version without package.json.

The cache is `~/.cache/brokit` on Linux (`$XDG_CACHE_HOME/brokit` if that's set),
`~/Library/Caches/brokit` on macOS and `%LOCALAPPDATA%\brokit\Cache` on Windows;
`BROKIT_CACHE` puts it elsewhere (a folder your CI caches, say).

## How brokit runs Chrome

- **Headless, with a throwaway profile.** Every launch gets a new, empty profile that's
  deleted afterwards: no cookies, history or extensions of yours, nothing left behind.
- **With its sandbox on.** Chrome's sandbox keeps what a page does away from your
  computer. brokit never turns it off from a flag; see [In a container](#in-a-container)
  for the one exception.
- **Over a pipe, not a port.** brokit talks to Chrome over a pipe: Chrome opens no
  debugging port, so nothing else on the computer can connect to it while it runs.

## Pages elsewhere

brokit opens pages on this computer only: `localhost`, `127.0.0.1`, `[::1]` and
`*.localhost`. To check a staging site, name it:

```sh
brokit run https://staging.example.com/ --allow-host staging.example.com
```

`--allow-host` can be given more than once. Only `http` and `https` pages open: no
`file://`, `chrome://` or `data:` URLs.

## Serving files

`brokit serve [dir]` serves a folder on `127.0.0.1`, port 8080 (`--port` to change it);
`brokit run` and `brokit check` do the same on their own for pages from disk and
relative URLs, on a free port.

```sh
brokit serve dist --port 5000
brokit serve dist --isolate          # with COOP/COEP, for SharedArrayBuffer
```

It serves only files inside the folder (no symbolic links out of it), no dotfiles
(`.env`, `.git`), no directory listings, GET and HEAD only, and nothing cached, so you
always see the files as they are now. `--isolate` adds the cross-origin isolation
headers that `SharedArrayBuffer` and precise timers need.

## In a container

Chrome's sandbox needs a user that isn't root, and container settings that allow it.
[CI and containers](ci.md) has the recipes. Where a container's settings can't be changed
(GitLab.com's shared runners, GitHub jobs that run in a container), set
`BROKIT_NO_SANDBOX=1`. Chrome then runs without its sandbox, inside the container, which
keeps it apart from the computer. brokit honors it only inside a container, opens only
pages on this computer with it, and says so on every run.

## Environment variables

| Variable | Does |
|---|---|
| `BROKIT_CHROME` | the browser to use: a path to Chrome, Chromium or Edge |
| `BROKIT_CHROME_VERSION` | the Chrome version to use (and install), as `"brokit": { "chrome": ... }` in package.json does |
| `BROKIT_CACHE` | where `install-chrome` keeps its downloads |
| `BROKIT_NO_SANDBOX` | `1`: Chrome without its sandbox, honored only inside a container |
| `BROKIT_CHROME_TRANSPORT` | `port`: talk to Chrome over a local port, for a Chrome that can't use a pipe (`doctor` says when) |
| `CI` | set by most CI systems: a missing baseline fails instead of being written |

[SECURITY.md](../../SECURITY.md) has the details of what brokit promises, and how to
report a vulnerability.
