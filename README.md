<h1><picture><source media="(prefers-color-scheme: dark)" srcset="site/assets/logo-dark.png"><img src="site/assets/logo-light.png" alt="brokit" height="40"></picture></h1>

**brokit checks web pages in a real Chrome.** It's a free, open-source command-line tool
and Node.js library: it opens your pages in a headless Chrome, uses them as a person
would (clicks, typing, touch, input methods), checks what they show, and compares their
screenshots with the ones you approved. Its name is short for *browser kit*.

- **Who it's for:** web developers checking their own pages, teams that want those
  checks in CI, and AI coding agents that need to see and use what they build.
- **What it checks:** any page: plain HTML or any framework, DOM or canvas (2D, WebGL,
  WebGPU), on a desktop screen or a phone's, in light or dark mode.
- **Where it runs:** on your computer (Linux; macOS and Windows aren't tested yet), in
  CI (GitHub Actions, GitLab CI, Docker; see [In CI and containers](#in-ci-and-containers)),
  and wherever an AI agent can run a command.
- **What it needs:** Node.js 22.4 or newer, and Chrome, Chromium or Edge, which it finds
  on its own (no Chrome? `brokit install-chrome` downloads one). It has no npm
  dependencies: installing it adds one package (a 51 kB download, about 160 kB on disk).
- **Safe by default:** pages on your computer only, unless you allow a host; a throwaway
  Chrome profile; Chrome's sandbox on (only inside a container can you turn it off).
- **License:** MIT or Apache-2.0, at your option.

Status: early (0.1). `run`, `check` with expectations and baseline screenshots, `diff`,
`serve`, `doctor`, `install-chrome` and the library work, and are tested on Linux.
Reports, a GitHub Action and an MCP server for agents come next.

## Install

From npm, into your project:

```sh
npm install --save-dev brokit
npx brokit doctor          # checks that everything brokit needs is here, says what to fix
```

Or try it without installing: `npx brokit run index.html`.

## Quick start

```sh
brokit run index.html                       # a page from disk (brokit serves the folder)
brokit run http://localhost:3000/           # a page from your dev server
brokit run index.html --out shot.png        # ...and a screenshot
brokit run index.html --size 393x852 --dpr 3 --mobile   # as a phone
brokit check                                # every *.check.json / *.check.mjs here
```

It prints what happened: when the page was ready, each step, the console, any errors.
It exits 0 when everything went fine, 1 when something failed, 2 for a mistake in how it
was run. Add `--json` for the result as JSON (for scripts and agents).

## Steps

Give a page steps to run with `--steps steps.json`:

```json
[
  { "click": { "selector": "#email" } },
  { "type": "ana@example.com" },
  { "key": "Enter" },
  { "waitFor": "document.querySelector('#greeting').textContent !== ''" },
  { "eval": "document.querySelector('#greeting').textContent" },
  { "screenshot": "signed-in" }
]
```

`eval` values are printed; screenshots go to `brokit-out/` (`--out-dir` to change it).

### Where: points

Anything that takes a point takes any of:

| | |
|---|---|
| `[x, y]` | CSS pixels from the viewport's top left |
| `{ "selector": "#id" }` | the element's center (scrolled into view if it's outside) |
| `{ "selector": "canvas", "offset": [10, 20] }` | a point from the element's top left — handy for canvas apps |
| `"app.buttonCenter()"` | a JS expression the page evaluates to `[x, y]` |

### All steps

| Step | Does |
|---|---|
| `{ "move": P }` | moves the mouse |
| `{ "click": P }` | clicks; `"button": "right"`, `"count": 2` |
| `{ "dblclick": P }` | double-clicks |
| `{ "drag": { "from": P, "to": P } }` or `[x0, y0, x1, y1]` | presses, moves (`"steps": 8`), releases |
| `{ "wheel": { "at": P, "dy": 100, "dx": 0 } }` or `[x, y, dy, dx]` | turns the wheel (positive `dy` scrolls down) |
| `{ "key": "Enter" }` | presses a key: `"a"`, `"Tab"`, `"ArrowUp"`, `"F5"`, `"Ctrl+Shift+Z"`, `"Shift+Tab"`; `"Mod+a"` is Cmd+A on macOS and Ctrl+A elsewhere, so a scenario works on both |
| `{ "type": "text" }` | types text at once, as a paste or an input method's commit does; `"perKey": true` presses a key per character |
| `{ "ime": "かな" }` | an input method composing (not yet committed); `{"type": ...}` commits, `{"ime": ""}` cancels |
| `{ "tap": P }` | a finger tap |
| `{ "swipe": { "from": P, "to": P, "ms": 120 } }` | a finger drag, then lifted (a fast one flicks) |
| `{ "emulate": { "size": "393x852", "dpr": 3, "mobile": true } }` | changes the screen mid-run, like DevTools' device mode; also `"colorScheme": "dark"`, `"reducedMotion": "reduce"` |
| `{ "safeArea": [47, 0, 34, 0] }` | a phone's notch and bars (`env(safe-area-inset-*)`) |
| `{ "waitFor": "expression" }` | waits until it's truthy (`"timeout": 10000` ms) |
| `{ "frames": 2 }` | waits for the page's next frames |
| `{ "wait": 100 }` | waits that many ms (prefer `waitFor` or `frames`) |
| `{ "eval": "expression" }` | evaluates JS in the page; its value goes in the result |
| `{ "expect": "expression", "equals": value }` | checks a value; see [Expectations](#expectations) |
| `{ "screenshot": "name" }` | saves `name.png`: the viewport, or `"selector"`, `"fullPage": true`, `"scale": 0.5`, or `"from": "expression"` for pixels the page gives (a canvas, `ImageData`, a PNG data URL); `"baseline": true` compares it with its [baseline](#checks-and-baselines). Taken once the page is [still](#screenshots-and-motion) (`"still": false`: at once; a number: wait up to that many ms) |

Mouse, wheel, drag and key steps also take `"shift"`, `"ctrl"`, `"alt"`, `"meta"`: `true`.
Any step can have a `"note"` for people reading it. After each input the page gets a
frame, so the next step sees what the input changed.

## Scenarios

A scenario file holds the page, its screen and its steps together:

```json
{
  "url": "/form.html",
  "viewport": { "size": "393x852", "dpr": 3, "mobile": true },
  "ready": "window.app?.ready",
  "steps": [{ "tap": { "selector": "#email" } }, { "type": "ana@example.com" }]
}
```

```sh
brokit run checks/form.json                  # a relative url: brokit serves the current folder
brokit run checks/form.json --serve web      # ...or another folder
brokit run checks/form.json --base http://localhost:5173/   # ...or your dev server
```

**When a page is ready:** by default, after its load event and half a second with no
network requests. A page that knows better can say so: `"ready": "expression"` (until
it's truthy) or `"readyTitle": "done"` (until `document.title` is that). Waiting for the
page's own signal is faster and more reliable for apps that keep loading after `load`.

A run fails if a step fails, if the page throws an uncaught exception, if it answers an
HTTP error, or if it isn't ready in `"timeout"` ms (30000). A failed action (a click
on something that isn't there) stops the run, since what follows would act on the wrong
page; a failed expectation or baseline doesn't, so one run shows everything that's wrong.

Give pages a `ready` signal when you can: ten small checks took 8.0 s waiting for the
network to go quiet, and 3.7 s with `"ready": "document.readyState === 'complete'"`.

## Expectations

```json
{ "expect": "document.querySelector('#greeting').textContent", "equals": "Welcome, ana" }
```

| Matcher | Holds when the value |
|---|---|
| (none) | is truthy |
| `"equals": value` | is the same JSON (objects and lists compared by content) |
| `"near": 59, "within": 0.5` | is a number within 0.5 of 59 (`within` defaults to 0.5) |
| `"matches": "^Welcome"` | is a string the regular expression matches |
| `"includes": value` | is a string containing it, or a list with an item equal to it |
| `"atLeast": 1, "atMost": 3` | is a number in that range (either may be left out) |

An expectation is tried again until it holds or `"timeout"` ms pass (default 2000), so a
page that updates a moment later still passes, and one that never does fails with what
it saw: `expected "Welcome, ana", got ""`.

## Checks and baselines

`brokit check` runs every `*.check.json` and `*.check.mjs` under the current folder (or
the files and folders you name) in one Chrome, one after another, and exits 1 if any
failed. It skips `node_modules`, hidden folders and its own output.

```
$ brokit check
brokit check: 3 scenarios, Chrome 155.0.8059.39, software drawing
✓ checks/home  4 steps, 0.4 s
✗ checks/signup  6 steps, 0.5 s
    ✗ screenshot signed-in → brokit-out/checks/signup/signed-in.png (1280×800)
        differs from checks/baselines/signup/signed-in.png: 1840 pixels differ (up to 243)
        difference → brokit-out/checks/signup/signed-in.diff.png
✓ checks/phone  5 steps, 0.4 s
3 scenarios: 2 passed, 1 FAILED in 1.4 s
```

A screenshot with `"baseline": true` is compared with its baseline, kept next to the
check (`checks/signup.check.json` → `checks/baselines/signup/signed-in.png`) so it's
committed and reviewed with the code:

- **No baseline yet:** it's written and the step passes. In CI (where the `CI`
  variable is set, as GitHub, GitLab and most others do) it fails instead, since a
  check with nothing to compare against checks nothing.
- **Different:** the step fails; the new screenshot and a difference image are in
  `brokit-out/`. If the change is what you meant, `brokit check --update` takes it as
  the new baseline.
- **A page with errors** (an HTTP error such as a 404, an uncaught exception) never
  becomes a baseline, not even with `--update`: the step fails and says why, so a
  server that wasn't running can't replace your baselines with its error page.
- **Tolerance:** by default a pixel may be off by up to 2 of 255 in a channel. Nobody
  can see that, and it's how much Chrome's drawing of the same page can vary between
  runs (large blurred shadows, for one); anything real differs by far more. Change it
  with `"tolerance"` on the step or for the whole scenario (`{"max": 0}` is
  pixel-exact), and leave regions out with `"ignore"`, as in
  [Comparing images](#comparing-images).

`check` draws with `--gpu software` unless told otherwise, so baselines made on one
machine match on another. `--filter text` runs only the checks whose name contains
`text`; `--verbose` lists every step, not just failures; `--json` gives every result.

### Screenshots and motion

A screenshot shows the page once it has stopped moving, not halfway through a fade:
brokit waits for CSS transitions and animations (and Web Animations) that have an end,
and for scrolling to stop (`scroll-behavior: smooth`, `scrollTo({ behavior: "smooth" })`),
up to 5 seconds. A page that's already still costs nothing extra: brokit looks before the
shot, watches while it's taken, and waits and takes it again only if something moved.
`"still": false` takes the shot at once; `"still": 2000` waits at most 2 seconds.

What it can't wait for, it tells you in the step's note: something still moving when
the time ran out, and, for a baseline, an animation that never ends (a spinner, a
blinking cursor drawn in CSS), since that can make two runs differ. Emulate `"reducedMotion":
"reduce"` if the page honors it, or leave that region out with `"ignore"`. Drawing a
page does in its own `requestAnimationFrame` loop isn't seen as motion, nor is motion
inside iframes; wait for those with `"waitFor"`. Baselines are retaken until two shots
in a row match anyway.

## JS scenarios

For checks that need logic, a `*.check.mjs` file exports the scenario's settings and a
function:

```js
export const url = '/settings.html';
export const viewport = { size: '393x852', dpr: 3, mobile: true };

export default async ({ page, expect, step, screenshot }) => {
  const header = await page.rect('header');
  expect.near(header.y, 59, 0.5, 'clear of the notch');
  for (const tab of ['General', 'Privacy', 'About']) {
    await page.tap({ selector: `[data-tab="${tab}"]` });
    expect.equal(await page.eval("document.querySelector('[role=tab][aria-selected=true]').textContent"), tab);
    await screenshot(`tab-${tab.toLowerCase()}`, { baseline: true });
  }
  await step({ key: 'Escape' });
};
```

`page` has a method for every step (`click`, `tap`, `drag`, `key`, `type`, `waitFor`,
`eval`, `rect`, ...). `expect.equal`, `near`, `matches`, `includes`, `atLeast`,
`atMost` and `ok` record a check each and return whether it held; `step(...)` and
`screenshot(...)` run a JSON step.

**A JS scenario is code.** `brokit check` runs it with Node and your permissions, as a
test runner runs test files. On a checkout you don't trust, run `brokit check --no-js`:
only JSON scenarios run, and their expressions run inside the page, in Chrome's sandbox.

## Comparing images

```sh
brokit diff before.png after.png diff.png
brokit diff before.png after.png --tolerance '{"max": 2}'
brokit diff before.png after.png --tolerance '{">8": "0.1%"}' --ignore '[[0, 0, 200, 40]]'
```

It counts pixels by how much they differ (identical, ≤2, ≤8, ≤32, >32 out of 255),
reports the mean and the worst, and draws a difference image: the first image faded,
differing pixels in red, ignored regions in blue. Without a tolerance, any difference
fails. Tolerances: `max` (no pixel differs by more), `mean`, `">N"` (at most this many
pixels, or this percentage, differ by more than N).

## Drawing the same everywhere

`--gpu software` draws with SwiftShader: the same pixels on every machine, the one to
use for screenshots you compare. `--gpu hardware` asks for the real GPU (and WebGPU)
where the platform allows it headless; `--gpu default` is Chrome's own choice.

## Serving files

`brokit serve [dir]` serves a folder on 127.0.0.1 (port 8080, `--port` to change it);
`brokit run` does the same on its own for pages from disk. Only files inside the folder,
no dotfiles (`.env`, `.git`), no directory listings, GET and HEAD only, nothing cached.
`--isolate` adds the cross-origin isolation headers that `SharedArrayBuffer` needs.

## Pages elsewhere

brokit opens pages on this computer only (`localhost`, `127.0.0.1`, `*.localhost`). To
check a staging site, name it: `--allow-host staging.example.com`.

## As a library

```js
import { launch } from 'brokit';

const browser = await launch({ gpu: 'software' });
const page = await browser.newPage({ size: '393x852', dpr: 3, mobile: true });
await page.goto('http://localhost:3000/', { ready: 'window.app?.ready' });
await page.tap({ selector: '#menu' });
const open = await page.eval("document.querySelector('nav').classList.contains('open')");
const { png } = await page.screenshot({ selector: 'nav' });
await browser.close();
```

Every step is a `page` method (`click`, `drag`, `key`, `type`, `swipe`, `waitFor`, ...),
and `runScenario(browser, scenario)` runs a whole scenario. Also exported: `decodePng`,
`encodePng`, `diffImages`, `serve`, `findChrome`.

## Chrome

**Is everything in place?** `brokit doctor` checks Node, which Chrome brokit would use,
that it starts with its sandbox on, that it draws text, screenshots and WebGL, that
fonts are installed, and what CI changes; when something's missing, it says exactly what
to run on that system. (`--json` for scripts and agents. Running it first is the best
way for an AI agent to set brokit up.)

**Which Chrome:** brokit uses, in this order,
1. `BROKIT_CHROME`, a path to a browser;
2. the version the project pins (below), from brokit's own cache;
3. Chrome, Chromium or Edge installed on the computer (Linux, macOS, Windows; tested on
   Linux so far);
4. a Chrome that `brokit install-chrome` downloaded.

**No Chrome, or the same Chrome everywhere:** `brokit install-chrome` downloads Google's
[Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/) (the
stable version, or one you name) into a cache folder of brokit's. It's the only time
brokit downloads anything. Screenshots from one Chrome version can differ slightly from
another's, so a project that keeps baselines can pin its version:

```sh
npx brokit install-chrome --pin     # installs stable and writes it to package.json:
                                    # "brokit": { "chrome": "156.0.8078.47" }
npx brokit install-chrome           # elsewhere (a teammate, CI): installs the pinned one
```

It runs Chrome headless, with
a throwaway profile and its sandbox on, and talks to it over a pipe: Chrome opens no
debugging port, so nothing else on the computer can connect to it. In a container, run
as a user that isn't root (Chrome's sandbox needs that; brokit won't turn it off).
[SECURITY.md](SECURITY.md) has the details, and how to report a vulnerability.

## In CI and containers

Run `npx brokit doctor` first wherever brokit is new: it says what's missing and how to
add it. A failing check leaves its screenshots and difference images in `brokit-out/`;
keep that folder as the job's artifact.

**Baselines:** screenshots match only where the operating system, its fonts and the
Chrome version are the same, so make and update baselines where CI runs (in the same
container image), and pin Chrome (`brokit install-chrome --pin`) to keep its version.

**GitHub Actions** (not verified on GitHub yet). Its hosted Linux, macOS and Windows
runners come with Chrome, and run jobs on a virtual machine, not in a container:

```yaml
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx brokit check
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: brokit-out
          path: brokit-out/
```

**Docker** (verified on 2026-10-27 with `node:22-bookworm-slim` and Debian's Chromium):

```dockerfile
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
USER node
WORKDIR /home/node/app
COPY --chown=node . .
RUN npm ci
CMD ["npx", "brokit", "check"]
```

```sh
docker run --security-opt=seccomp=unconfined my-checks
```

Two things are required, and brokit says so when they're missing. **A user that isn't
root** (Chrome won't sandbox as root; Node images have the user `node`). **Container
settings that allow Chrome's sandbox:** Docker's default seccomp profile forbids the
namespaces it needs, so the container runs with `--security-opt=seccomp=unconfined`
(or `--cap-add=SYS_ADMIN`).

**Where the container's settings can't be changed** (GitLab.com's shared runners,
GitHub jobs that run in a container), set `BROKIT_NO_SANDBOX=1`. Chrome then runs
without its sandbox, inside the container, which keeps it apart from the computer.
brokit honors it only inside a container, opens only pages on this computer with it,
and says so on every run; root is fine then. (Verified on 2026-10-27 in Docker with
default settings, as root and as `node`.) See [SECURITY.md](SECURITY.md).

**GitLab CI** (not verified on GitLab yet). Jobs run in a container, so the runner must
allow Chrome's sandbox: on a runner you manage, set it in its `config.toml`:

```toml
[runners.docker]
  security_opt = ["seccomp=unconfined"]
```

```yaml
check:
  image: node:22-bookworm-slim
  before_script:
    - apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation
    - npm ci
    - chown -R node .
  script:
    - su node -c "npx brokit check"
  artifacts:
    when: on_failure
    paths: [brokit-out/]
```

GitLab.com's shared runners don't let a job change its container's settings, so Chrome's
sandbox can't start there; run without it:

```yaml
check:
  image: node:22-bookworm-slim
  variables:
    BROKIT_NO_SANDBOX: "1"   # in this container only; see SECURITY.md
  before_script:
    - apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation
    - npm ci
  script:
    - npx brokit check
  artifacts:
    when: on_failure
    paths: [brokit-out/]
```

**AI agents:** on a developer's computer, Chrome is usually there already. In a cloud
sandbox, `npx brokit doctor --json` says what's missing; `npx brokit install-chrome`
brings Chrome if the sandbox allows downloads, and the container notes above apply.

## License

brokit is licensed under either of

- the Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE)), or
- the MIT license ([LICENSE-MIT](LICENSE-MIT)),

at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted for
inclusion in the work by you, as defined in the Apache-2.0 license, shall be dual
licensed as above, without any additional terms or conditions.
