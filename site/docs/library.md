# Node.js library

Everything the `brokit` command does is also a Node.js library: start Chrome, open
pages, give them real input, read from them, take screenshots, run scenarios, compare
images. The command is built from these same functions, so what works in a scenario
works from a script.

brokit is an ES module with no dependencies. It needs Node.js 22.4 or newer and a
Chrome, Chromium or Edge (see [Chrome](chrome.md)). Import what you need:

```js
import { launch, serve, runScenario, diffImages } from 'brokit';
```

Use the library when a check needs more than a scenario file gives: your own test
runner, a script that makes screenshots for a README, an agent's tool. For checks that
only need some logic, a [JS scenario](scenarios.md#js-scenarios) is simpler: `brokit
check` runs it, with baselines and reports.

## A first script

This serves a folder, opens its page, signs in, reads the greeting and saves a
screenshot:

```js
import { writeFile } from 'node:fs/promises';
import { launch, serve } from 'brokit';

const server = await serve('public'); // or use your dev server's URL
const browser = await launch();
try {
  const page = await browser.newPage({ size: '1280x800' });
  await page.goto(server.url, { ready: "document.readyState === 'complete'" });
  await page.click({ selector: '#email' });
  await page.type('ana@example.com');
  await page.key('Enter');
  await page.waitFor("document.querySelector('#greeting').textContent !== ''");
  const greeting = await page.eval("document.querySelector('#greeting').textContent");
  console.log(greeting); // Welcome, ana@example.com
  const { png } = await page.screenshot();
  await writeFile('signed-in.png', png);
} finally {
  await browser.close();
  await server.close();
}
```

Close the browser in a `finally`: it ends Chrome and removes its throwaway profile.
Until it's closed, Chrome keeps your script running. If the script throws or calls
`process.exit()` first, brokit still kills the Chrome it started as the process exits.

## launch and Browser

### launch(options)

`launch(options)` starts a headless Chrome and resolves to a `Browser`. All options are
optional:

| Option | Default | What it is |
|---|---|---|
| `chrome` | the one brokit [chooses](chrome.md) | the path to a browser |
| `gpu` | `'default'` | how Chrome draws: `'default'`, `'software'` (the same pixels on every machine) or `'hardware'`; see `GPU_MODES` |
| `jsFlags` | `null` | V8 flags, as one string: `'--expose-gc --max-old-space-size=512'` |
| `chromeFlags` | `[]` | more Chrome flags, as a list |
| `profile` | a throwaway folder | a profile folder to use and keep |
| `transport` | `'pipe'` | `'pipe'`, or `'port'` for a browser build that can't talk over a pipe (also set by `BROKIT_CHROME_TRANSPORT`) |
| `startTimeout` | `20000` | ms to wait for Chrome to answer |

```js
const browser = await launch({ gpu: 'software' });
```

Chrome runs headless, with its sandbox on, and talks to brokit over a pipe, so no other
program can connect to it. Flags must look like flags (`--name` or `--name=value`, no
spaces); `--no-sandbox`, `--remote-debugging-*` and `--user-data-dir` are refused.

`launch` throws when:

- no Chrome is found (the error's `code` is `'BROKIT_NO_CHROME'`, and its message says
  what to do);
- `gpu`, `transport` or a flag isn't allowed;
- `BROKIT_NO_SANDBOX` is set outside a container (`code: 'BROKIT_SANDBOX'`);
- Chrome can't be run, exits, or doesn't answer in `startTimeout` ms (the message has
  the end of Chrome's own log).

### browser.newPage(options)

Opens a tab at `about:blank` and resolves to a [`Page`](#page). Then call
`page.goto(url)`.

| Option | Default | What it is |
|---|---|---|
| `size` | `'1280x800'` | the viewport in CSS pixels: `'393x852'` or `[393, 852]` |
| `dpr` | `1` | device pixels per CSS pixel, from 0 to 10 |
| `mobile` | `false` | a phone: a mobile viewport, touch, no scrollbars |
| `colorScheme` | Chrome's | `'light'` or `'dark'`, as `prefers-color-scheme` sees it |
| `reducedMotion` | Chrome's | `'reduce'` or `'no-preference'`, as `prefers-reduced-motion` sees it |

```js
const phone = await browser.newPage({ size: '393x852', dpr: 3, mobile: true, colorScheme: 'dark' });
```

One page at a time is a tab in Chrome's window. A page opened while another is open
gets a window of its own, so both keep drawing frames (Chrome gives a tab behind another
none). Windows cost more, so close a page when you're done with it.

### Other Browser members

- `await browser.version()`: Chrome's version, like `'Chrome/155.0.8059.39'`.
- `await browser.close()`: closes Chrome and removes its throwaway profile (not one you
  passed as `profile`). Safe to call twice.
- `browser.sandboxed`: `true`, unless `BROKIT_NO_SANDBOX` turned Chrome's sandbox off in
  a container.
- `browser.connection`: the [`Connection`](#low-level) to Chrome, for DevTools Protocol
  calls on the browser itself.

## Page

A `Page` is a tab. You get one from `browser.newPage()`. Every step a scenario can have
is a method here, with the same names and options, plus a few for reading the page.
Every method is async.

| Method | Does |
|---|---|
| `goto(url, options)` | opens a URL and waits until the page is ready |
| `eval(expression, options)` | evaluates JS in the page; its value |
| `title()` | `document.title` |
| `rect(selector)` | where an element is: `{ x, y, width, height }` |
| `point(p)` | a [point](#points) as `[x, y]` |
| `move(p)` | moves the mouse |
| `click(p, options)` | clicks: `button`, `count`, modifiers |
| `dblclick(p, modifiers)` | double-clicks |
| `drag(from, to, options)` | presses, moves in `steps`, releases |
| `wheel(p, options)` | turns the wheel: `dy`, `dx` |
| `key(spec, modifiers)` | presses a key: `'Enter'`, `'Ctrl+Shift+Z'` |
| `type(text, options)` | types text at once, or a key per character |
| `ime(text, caret)` | an input method composing text |
| `tap(p)` | a finger tap |
| `swipe(from, to, options)` | a finger drag, then lifted |
| `emulate(options)` | changes the screen: size, dpr, mobile, scale, color scheme, motion |
| `safeArea([top, right, bottom, left])` | a phone's notch and bars |
| `wait(ms)` | waits that many ms |
| `frames(n)` | waits for the page's next frames |
| `waitFor(expression, options)` | waits until an expression is truthy |
| `still(options)` | waits until nothing is animating or scrolling |
| `screenshot(options)` | a PNG of the viewport, an element, the whole page or the page's own pixels |
| `startProfile()`, `stopProfile()` | samples the page's main thread |
| `send(method, params, timeout)` | a raw DevTools Protocol call |
| `close()` | closes the tab |

Two steps have no method of their own: `expect` (in a script, check values yourself,
or run it with [`runStep`](#single-steps)) and a screenshot's `baseline` (see
[Baselines](#baselines)).

After each input (mouse, wheel, key, typing, input method, touch, safe area) the page gets a frame
before the method resolves, so the next call sees what the input changed. Set
`page.settle = false` to skip that wait.

### Points

Every method that takes a point `p` takes any of:

- `[x, y]`: CSS pixels from the viewport's top left;
- `{ selector: '#id' }`: the element's center, scrolled into view if it's outside;
- `{ selector: 'canvas', offset: [10, 20] }`: a point from the element's top left;
- `'app.buttonCenter()'`: a JS expression the page evaluates to `[x, y]`.

They're the same points as in [steps](steps.md#where-points). A selector that matches
nothing, or an element with no size (hidden), throws.

```js
await page.click([200, 120]);
await page.click({ selector: '#go' });
await page.click({ selector: '#chart', offset: [10, 20] });
await page.move('[innerWidth / 2, 100]');
console.log(await page.point({ selector: '#go' })); // [ 285.46, 73.59 ]
```

### goto

`page.goto(url, options)` opens `url` and waits until the page is ready:

| Option | Default | Ready when |
|---|---|---|
| `ready` | | this expression is truthy (awaited if it's a promise) |
| `readyTitle` | | `document.title` is this |
| (neither) | | the load event, then no network requests for `idle` ms; a page whose network never goes quiet is taken as ready 5 s after load |
| `idle` | `500` | ms of no network requests, without `ready` or `readyTitle` |
| `timeout` | `30000` | ms before it gives up and throws |

Either way it then waits for the page's fonts and two frames, so what's on screen is
the page as it settled. It resolves to `{ by, ms, note? }`: how it knew the page was
ready, how long it took, and a note when the network never went quiet.

```js
const ready = await page.goto('http://localhost:3000/', { ready: 'window.app?.ready' });
console.log(ready); // { by: 'ready: window.app?.ready', ms: 123 }
```

It throws when the page can't be loaded at all (`couldn't load ...: net::ERR_CONNECTION_REFUSED`)
or isn't ready in time (`not ready after 30000 ms: ...`). An HTTP error such as a 404
doesn't throw: it's added to `page.errors`.

> **Note:** `page.goto` opens any URL you give it. The rule that brokit opens only pages
> on this computer unless you allow a host is in [`checkUrl`](#checkurl), which
> `runScenario` and the `brokit` command apply. Call it yourself for URLs you didn't
> write.

### Reading the page

- `page.eval(expression, { timeout })` evaluates a JS expression in the page, awaits it
  if it's a promise, and resolves to its value as JSON allows (numbers, strings, lists,
  plain objects; a DOM element comes back as `{}`). If the expression throws, `eval`
  throws with the page's error. `timeout` is in ms (default 30000).
- `page.title()` is `document.title`.
- `page.rect(selector)` is the element's `{ x, y, width, height }` in CSS pixels from
  the viewport's top left. It throws if nothing matches.
- `page.point(p)` turns any [point](#points) into `[x, y]`.

```js
const count = await page.eval("document.querySelectorAll('#list div').length");
const header = await page.rect('header');
const user = await page.eval('fetch("/user.json").then((r) => r.json())');
```

`eval` takes an expression, not a function. To pass values in, put them in the string
with `JSON.stringify`:

```js
const name = 'ana@example.com';
await page.eval(`document.querySelector('#email').value = ${JSON.stringify(name)}`);
```

### Mouse

- `page.move(p)` moves the mouse there.
- `page.click(p, { button, count, shift, ctrl, alt, meta })` clicks. `button` is
  `'left'` (default), `'right'` or `'middle'`; `count: 2` is a double click.
- `page.dblclick(p, { shift, ctrl, alt, meta })` is `click` with `count: 2`.
- `page.drag(from, to, { steps, shift, ctrl, alt, meta })` presses the left button at
  `from`, moves to `to` in `steps` moves (8 by default), and releases.
- `page.wheel(p, { dy, dx, shift, ctrl, alt, meta })` turns the wheel at `p`: positive
  `dy` scrolls down, `dx` sideways. Both default to 0.

```js
await page.click({ selector: '#go' }, { button: 'right' });
await page.click({ selector: '#email' }, { count: 3 }); // a triple click
await page.drag([100, 300], [400, 300], { steps: 20, shift: true });
await page.wheel({ selector: '#list' }, { dy: 300 });
```

### Keyboard and text

`page.key(spec, { shift, ctrl, alt, meta })` presses and releases a key, holding any
modifiers. `spec` is a character (`'a'`, `'A'`, `'é'`), a key name (`'Enter'`, `'Tab'`,
`'Escape'`, `'ArrowUp'`, `'PageDown'`, `'F5'`, in any case; also `Esc`, `Del`, `Up`,
`Down`, `Left`, `Right`, `Space`, `Return`), or a combination: `'Ctrl+Shift+Z'`,
`'Shift+Tab'`, `'Alt+F4'`. `'Mod+a'` is Cmd+A on macOS and Ctrl+A elsewhere. Keys are
those of a US keyboard; a key name brokit doesn't know throws.

`page.type(text, { perKey })` types text. By default it goes in as one insertion, as a
paste or an input method's commit does: an `input` event, no key events. With
`perKey: true` it presses a key for each character (`'\n'` presses Enter).

`page.ime(text, caret)` is an input method composing `text`, shown underlined and not
yet committed, with the caret at `caret` characters (default: the end). Commit it with
`type`, cancel it with `ime('')`.

```js
await page.click({ selector: '#email' });
await page.type('ana@example.com');
await page.key('Mod+a');
await page.key('Backspace');
await page.type('ana', { perKey: true });
await page.ime('かな');
await page.type('仮名'); // commits
await page.key('Tab', { shift: true });
```

### Touch

- `page.tap(p)` puts a finger down and lifts it at `p`.
- `page.swipe(from, to, { ms })` drags a finger from one point to the other over about
  `ms` milliseconds (120 by default, a move every 16 ms), then lifts it. A fast swipe
  flicks.

Touch works on any page; a `mobile` page has it from the start.

```js
await page.tap({ selector: '#go' });
await page.swipe({ selector: '#list' }, [200, 100], { ms: 300 });
```

### Screen

`page.emulate(options)` changes the screen as DevTools' device mode does. What you leave
out stays as it was.

| Option | What it is |
|---|---|
| `size` | `'393x852'` or `[393, 852]` |
| `dpr` | device pixels per CSS pixel, from 0 to 10 |
| `mobile` | a phone: mobile viewport, touch, no scrollbars |
| `scale` | the page drawn smaller, as device mode's "fit to window" (0 to 10) |
| `colorScheme` | `'light'` or `'dark'` |
| `reducedMotion` | `'reduce'` or `'no-preference'` |

```js
await page.emulate({ size: '393x852', dpr: 3, mobile: true });
await page.emulate({ colorScheme: 'dark' });
console.log(page.viewport); // { width: 393, height: 852, dpr: 3, mobile: true }
```

`page.viewport` is the current screen: `{ width, height, dpr, mobile }`.

`page.safeArea([top, right, bottom, left])` sets a phone's notch and bars in CSS pixels,
as `env(safe-area-inset-*)` sees them. The page needs `viewport-fit=cover` in its
viewport meta tag, as on a real phone.

```js
await page.safeArea([47, 0, 34, 0]);
```

### Waiting

- `page.waitFor(expression, { timeout })` waits until the expression is truthy (awaited
  if it's a promise), checking every 25 ms. It resolves to how many ms it waited, and
  throws after `timeout` ms (default 10000) with the expression's last error, if any.
- `page.frames(n)` waits for the page's next `n` frames (default 1). It resolves to
  `false` if none came, as for a page that isn't drawing.
- `page.still({ timeout, scrolling })` waits until nothing moves: no CSS transition or
  animation or Web Animation with an end, and no scrolling, for up to `timeout` ms
  (default 5000). `scrolling: true` says a scroll is known to be under way. It resolves
  to `{ ms, moving, endless }`: what still moved when the time ran out, and the
  animations that never end (a spinner), as short descriptions like
  `'p#toast.on: opacity'`.
- `page.wait(ms)` waits that many ms. Prefer the others: they wait for what matters.

```js
await page.click({ selector: '#go' });
await page.waitFor("document.querySelector('#greeting').textContent !== ''", { timeout: 5000 });
await page.frames(2);
const { moving, endless } = await page.still();
```

`still` can't see motion a page draws in its own `requestAnimationFrame` loop, or
motion inside iframes; wait for those with `waitFor`.

### screenshot

`page.screenshot(options)` resolves to `{ png, width, height }`: the PNG file's bytes (a
`Buffer`) and its size in device pixels. It saves nothing; write `png` to a file if you
want one.

| Option | Default | What it takes |
|---|---|---|
| (none) | | the viewport, as the browser shows it |
| `selector` | | just that element (from beyond the viewport if it reaches outside it) |
| `fullPage` | `false` | the whole page, beyond the viewport |
| `scale` | `1` | drawn that much smaller or larger: `0.5`, or `1 / 3` for a 3x phone seen at 1x |
| `still` | `true` | waits until the page is still first (see `still()`); `false` takes it at once; a number waits at most that many ms |
| `from` | | what the page itself gives (see below); taken at once |

```js
import { writeFile } from 'node:fs/promises';

const shot = await page.screenshot();
await writeFile('page.png', shot.png);
const { png, width, height } = await page.screenshot({ selector: 'header', scale: 0.5 });
const whole = await page.screenshot({ fullPage: true });
```

The wait for stillness costs nothing on a page that's already still: brokit looks before
the shot, watches while it's taken, and only waits and takes it again if something
moved. When it waited, the result also has `moving` (what still moved when the time ran
out) and, whenever there are any, `endless` (animations that never end), as lists of
descriptions.

A page taller than Chrome draws at once (8192 device pixels) is captured in strips and
joined; one wider than that, beyond the viewport, throws.

**The page's own pixels.** With `from`, the screenshot is what an expression in the page
gives: a canvas, an `OffscreenCanvas`, `ImageData`, a PNG data URL, or
`{ width, height, base64 }` of RGBA pixels. That's the canvas's own pixels, at its own
size, whatever the screen. A WebGL canvas reads back empty unless it was made with
`preserveDrawingBuffer: true`; take one with `selector` instead.

```js
const chart = await page.screenshot({ from: "document.querySelector('#chart')" });
console.log(chart.width, chart.height); // 120 60
```

### Profiling

`page.startProfile()` starts sampling the page's main thread (every 100 µs);
`page.stopProfile()` stops and resolves to the profile, an object you can save as a
`.cpuprofile` file and open in Chrome DevTools' Performance panel.

```js
import { writeFile } from 'node:fs/promises';

await page.startProfile();
await page.click({ selector: '#go' });
await writeFile('click.cpuprofile', JSON.stringify(await page.stopProfile()));
```

### Raw protocol calls

`page.send(method, params, timeout)` sends any [Chrome DevTools
Protocol](https://chromedevtools.github.io/devtools-protocol/) call to this page and
resolves to its result. It's for what brokit has no method for. `timeout` is in ms
(default 30000); an error from Chrome rejects with its message.

```js
await page.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Tokyo' });
const { cssContentSize } = await page.send('Page.getLayoutMetrics');
```

Calls on the browser rather than a page go through `browser.connection.send(method,
params)`.

### Console and errors

A page keeps what it logged and what went wrong, from the moment it was opened:

- `page.console`: `{ type, text }` for each console call (`'log'`, `'error'`, ...) and
  each of Chrome's own warnings and errors (a failed request, for one).
- `page.errors`: uncaught exceptions (`'uncaught Error: boom ...'`) and HTTP errors on
  the page itself (`'the page answered HTTP 404 Not Found'`), as strings.

Both keep at most 1000 entries, and they aren't cleared by `goto`. `page.close()` closes
the tab.

```js
await page.goto(url);
if (page.errors.length) throw new Error(page.errors.join('\n'));
for (const { type, text } of page.console) console.log(type, text);
```

## Running scenarios

A [scenario](scenarios.md) is a page, its screen and its steps, as a JSON object. These
functions run one, check one, and find and load scenario files, as `brokit run` and
`brokit check` do.

### runScenario

`runScenario(browser, scenario, options)` opens the scenario's page in a new tab, waits
until it's ready, runs its steps (or its `run` function), closes the tab, and resolves
to what happened. It doesn't throw when the page fails; look at `result.ok`. It throws
only for a scenario that isn't valid or a URL that isn't allowed (see
[`checkUrl`](#checkurl)).

| Option | Default | What it is |
|---|---|---|
| `base` | | what a relative `url` is resolved against, such as `server.url` |
| `allowHosts` | `[]` | hosts not on this computer that may be opened |
| `outDir` | `'brokit-out'` | where screenshot steps save their images (`name.png`) |
| `timeout` | `30000` | ms to be ready, when the scenario gives none |
| `baselines` | | `{ dir, update }`: where baseline screenshots are, and what to write; see [Baselines](#baselines) |
| `file` | | the scenario's file, so a JS scenario's error says which line it came from |
| `screenshot` | | a file for a screenshot of the viewport after the last step |
| `cpuProfile` | | a file for a profile of the page's main thread, the whole run |
| `onReady` | | called with `goto`'s result when the page is ready |
| `onStep` | | called with each step's entry as it finishes |

```js
import { launch, serve, runScenario } from 'brokit';

const server = await serve('public');
const browser = await launch({ gpu: 'software' });
try {
  const result = await runScenario(
    browser,
    {
      url: '/',
      viewport: { size: '393x852', dpr: 3, mobile: true },
      ready: 'window.app?.ready',
      steps: [
        { tap: { selector: '#email' } },
        { type: 'ana@example.com' },
        { key: 'Enter' },
        { expect: "document.querySelector('#greeting').textContent", equals: 'Welcome, ana@example.com' },
        { screenshot: 'signed-in' },
      ],
    },
    { base: server.url, onStep: (s) => console.log(s.ok ? '✓' : '✗', s.label) },
  );
  console.log(result.ok ? 'passed' : 'FAILED');
} finally {
  await browser.close();
  await server.close();
}
```

A scenario can have a `run` function in place of `steps`. It gets
`{ page, expect, step, screenshot }`, as a [JS scenario](scenarios.md#js-scenarios)'s
default export does:

```js
const result = await runScenario(browser, {
  url: '/',
  run: async ({ page, expect, screenshot }) => {
    const header = await page.rect('header');
    expect.atLeast(header.height, 30, 'header height');
    await screenshot('home');
  },
}, { base: server.url });
```

### The result

Here is the result of a run where one expectation failed:

```json
{
  "url": "http://127.0.0.1:43983/",
  "ok": false,
  "ms": 713,
  "ready": { "by": "ready: window.app?.ready", "ms": 114 },
  "steps": [
    { "action": "click", "label": "click #email", "ok": true, "ms": 33 },
    {
      "action": "expect",
      "label": "expect document.querySelector('#greeting').textContent equals \"Welcome, x\"",
      "ok": false,
      "value": "Welcome, ana",
      "error": "expected \"Welcome, x\", got \"Welcome, ana\"",
      "ms": 206
    },
    { "action": "eval", "label": "eval document.title", "ok": true, "value": "Sign in", "ms": 1 },
    { "action": "screenshot", "label": "screenshot done", "ok": true, "file": "/home/ana/app/brokit-out/done.png", "size": [1280, 800], "baseline": "new", "ms": 258 }
  ],
  "console": [],
  "errors": [],
  "title": "Sign in",
  "report": "/"
}
```

- `ok`: the page was ready, nothing went in `errors`, and every step passed.
- `ready`: what `goto` resolved to, or `null` if the page never got ready (then the
  reason is in `errors`).
- `steps`: an entry per step, in order. Each has `action`, `label`, `ok` and `ms`; a
  failed one has `error`. `eval` and `expect` add the `value` they saw; `screenshot`
  adds `file`, `size`, and, for a baseline, `baseline` (`'match'`, `'new'`,
  `'updated'`, `'missing'` or `'differs'`) and `diff` (the difference image) when there
  is one; a `note` says what a screenshot couldn't wait for.
- `console` and `errors`: as [`page.console` and `page.errors`](#console-and-errors),
  and in `errors` also a page that wasn't ready in time.
- `title`: the page's title at the end. `report`: the value of the scenario's `report`
  expression, if it has one. `screenshot` and `cpuProfile`: the files, if you asked for
  them. `name`: the scenario's, if it has one.

A failed action (a click on something that isn't there) stops the steps, since what
follows would act on the wrong page. A failed `expect` or baseline doesn't.

### Baselines

A screenshot step with `"baseline": true` is compared with `baselines.dir`/`name`.png.
`baselines.update` says what may be written:

- `'missing'` (the default): a missing baseline is written and the step passes.
- `'all'`: a baseline that differs is replaced too (as `brokit check --update`).
- `'none'`: nothing is written, and a missing baseline fails (as in CI).

The `brokit` command picks `'none'` when the `CI` variable is set. The library doesn't
look: pass what you want. Whatever `update` says, a page with errors (an HTTP error, an
uncaught exception) never becomes a baseline. The tolerance is the step's, else the
scenario's, else `{ max: 2 }`. When a screenshot differs, its difference image is
written next to it in `outDir`. A screenshot with `baseline: true` and no `baselines`
option fails.

These help put baselines where `brokit check` does:

- `baselineDir(file)`: where a scenario file's baselines go.
  `'checks/signup.check.json'` → `'<absolute path>/checks/baselines/signup'`.
- `scenarioName(file)`: a scenario file's name: `'checks/signup.check.json'` →
  `'signup'`.
- `imageName(name)`: a screenshot's file name: `'signed-in'` → `'signed-in.png'`. It
  throws on a name that could leave its folder (only letters, digits, `-`, `_` and `.`,
  not first, no `..`, up to 100).

`compareBaseline(options)` is the comparison itself, for screenshots you take with
`page.screenshot`:

| Option | What it is |
|---|---|
| `dir`, `name` | the baseline is `dir`/`name`.png |
| `png` | the screenshot's bytes |
| `outDir` | where the difference image goes; needed whenever a baseline exists |
| `tolerance`, `ignore` | as in [`diffImages`](#images); no tolerance means pixel-exact |
| `update` | `'missing'` (default), `'all'` or `'none'`, as above |
| `unfit` | a reason this screenshot mustn't become a baseline (the page had errors); then nothing is written |

It resolves to `{ status, baseline, diff?, message? }`. `status` is `'match'`, `'new'`
(written), `'updated'` (replaced), `'missing'` or `'differs'`; the last two are
failures, and `message` says why.

```js
import { compareBaseline } from 'brokit';

const { png } = await page.screenshot({ selector: 'header' });
const r = await compareBaseline({ dir: 'baselines', name: 'header', png, outDir: 'brokit-out', tolerance: { max: 2 } });
if (r.status === 'differs' || r.status === 'missing') console.log(r.message, r.diff ?? '');
```

### Scenario files

- `loadScenario(file)` reads a `.json` or `.mjs` scenario file and checks it. A `.mjs`
  file is imported: its named exports are the scenario's keys and its default export
  becomes `run`. It throws with the file's name in the message (`checks/a.check.json:
  isn't valid JSON: ...`). A JSON file may be up to 10 MB.
- `findScenarios(paths)` takes a list of files and folders and resolves to the scenario
  files among them, as absolute paths, sorted. Folders are searched for `*.check.json`
  and `*.check.mjs`, skipping `node_modules`, `brokit-out`, `baselines` and hidden
  folders; files are taken as they are, if they end in `.json` or `.mjs`.
- `checkScenario(scenario)` checks a scenario object (and every step in it) and returns
  it, or throws with what's wrong: `step 2: click: unknown option buton (it takes button,
  count, shift, ctrl, alt, meta)`.

> **Note:** `loadScenario` on a `.mjs` file runs it: it's code, with your permissions.
> Only load files you trust; see [JS scenarios](scenarios.md#js-scenarios).

A small `brokit check` of your own:

```js
import { launch, serve, findScenarios, loadScenario, runScenario, baselineDir, scenarioName } from 'brokit';

const server = await serve('public');
const browser = await launch({ gpu: 'software' });
let failed = 0;
try {
  for (const file of await findScenarios(['checks'])) {
    const name = scenarioName(file);
    const result = await runScenario(browser, await loadScenario(file), {
      base: server.url,
      file,
      outDir: `brokit-out/${name}`,
      baselines: { dir: baselineDir(file), update: process.env.CI ? 'none' : 'missing' },
    });
    console.log(result.ok ? '✓' : '✗', name, `${result.ms} ms`);
    for (const s of result.steps) if (!s.ok) console.log('   ', s.label, '→', s.error);
    for (const e of result.errors) console.log('   ', e);
    if (!result.ok) failed++;
  }
} finally {
  await browser.close();
  await server.close();
}
process.exitCode = failed ? 1 : 0;
```

### Single steps

- `runStep(page, step, ctx)` runs one [step](steps.md#all-steps) on a page and
  resolves to what it gives back: `{}` for most, `{ value }` for `eval` and `expect`,
  `{ file, size }` for `screenshot`, `{ note }` when there's something to say. A failed
  step throws; a failed `expect` throws an error with `soft: true` and `details:
  { value }`.
- `ctx` is needed only for screenshots: `ctx.save(name, png)` stores one and resolves to
  where it went; for `baseline: true`, also `ctx.compare(name, png, { tolerance, ignore })`
  (resolving as `compareBaseline` does) and `ctx.hasBaseline(name)`.
- `parseStep(step)` checks a step's shape and returns `[action, value, step]`, or
  throws a message saying what's wrong.
- `describeStep(step)` is a step in a few words, for reports: `{ key: 'Enter', ctrl:
  true }` → `'key Ctrl+Enter'`.
- `STEP_NAMES` is the list of actions: `move`, `click`, `dblclick`, `drag`, `wheel`,
  `key`, `type`, `ime`, `tap`, `swipe`, `emulate`, `safeArea`, `wait`, `frames`,
  `waitFor`, `eval`, `expect`, `screenshot`.

```js
import { writeFile } from 'node:fs/promises';
import { runStep } from 'brokit';

await runStep(page, { drag: [100, 300, 400, 300], steps: 20 });
const { value } = await runStep(page, { expect: "document.querySelectorAll('#list div').length", atLeast: 1 });
const ctx = { save: async (name, png) => (await writeFile(`${name}.png`, png), `${name}.png`) };
await runStep(page, { screenshot: 'list', selector: '#list' }, ctx);
```

### checkUrl

`checkUrl(url, { base, allowHosts })` returns `url` resolved against `base`, after
checking that brokit may open it: `http` or `https`, and on this computer (`localhost`,
`127.0.0.1`, `[::1]`, `*.localhost`) unless its host is in `allowHosts`. Otherwise it
throws: `staging.example.com isn't on this computer; allow it with --allow-host
staging.example.com`.

```js
checkUrl('/form.html', { base: 'http://localhost:5173/' }); // 'http://localhost:5173/form.html'
checkUrl('https://staging.example.com/', { allowHosts: ['staging.example.com'] });
```

## Images

An image is `{ width, height, data }`, with `data` a `Buffer` of 8-bit RGBA pixels, row
by row.

- `decodePng(bytes, { maxPixels })` decodes a PNG file's bytes. It reads every
  non-interlaced PNG (gray, RGB, palette, with or without alpha, 1 to 16 bits), checks
  every chunk's CRC, and throws on anything malformed, interlaced, or larger than
  `maxPixels` (default `MAX_PIXELS`, 40 000 000).
- `encodePng(image)` encodes an image as a PNG file's bytes.
- `diffImages(a, b, { tolerance, ignore })` compares two images pixel by pixel.
- `parseTolerance(tolerance)` checks a tolerance and returns its limits; it throws on a
  typo.

A pixel's difference is its largest difference in any channel, alpha included (0 to
255). The tolerance says how much is allowed; every limit given must hold, and none
means the images must be identical:

| Tolerance | Holds when |
|---|---|
| `{ max: 2 }` | no pixel differs by more than 2 |
| `{ mean: 0.5 }` | the mean difference is at most 0.5 |
| `{ '>8': '0.1%' }` | at most 0.1 % of the pixels differ by more than 8 |
| `{ '>0': 20 }` | at most 20 pixels differ at all |

`ignore` is a list of regions left out, `[x, y, width, height]` in image pixels.

```js
import { readFile, writeFile } from 'node:fs/promises';
import { decodePng, encodePng, diffImages } from 'brokit';

const before = decodePng(await readFile('before.png'));
const after = decodePng(await readFile('after.png'));
const d = diffImages(before, after, { tolerance: { max: 2 }, ignore: [[0, 0, 200, 40]] });
console.log(d.pass ? 'the same' : d.failures.join('; '));
console.log(d.pixels, `mean ${d.mean}, worst ${d.worst}`);
if (d.image) await writeFile('diff.png', encodePng(d.image));
```

`diffImages` returns:

- `pass`: whether the tolerance holds; `failures`: why not, as sentences
  (`'1840 pixels differ by more than 2 (up to 243)'`).
- `size`: `[width, height]`; `compared` and `ignored`: how many pixels each.
- `pixels` and `percent`: how many pixels differ by how much, in buckets: `identical`,
  `≤2`, `≤8`, `≤32`, `>32`.
- `mean` and `worst`: the mean and the largest difference.
- `image`: the difference image: the first image faded, differing pixels in red
  (stronger the more they differ), ignored regions in blue.

Images of different sizes don't pass; the result then has `size`, `otherSize` and
`failures`, and no `image`.

## Serving files

`serve(dir, { port, isolate })` serves a folder on 127.0.0.1 and resolves to
`{ url, port, root, close }`:

- `url`: like `'http://127.0.0.1:41235/'`, ending in `/`; pass it as `runScenario`'s
  `base`, or build a page's URL from it.
- `port`: the port; by default (`port: 0`) a free one is picked.
- `root`: the folder's real path.
- `close()`: stops the server; resolves when it's stopped.

```js
import { serve } from 'brokit';

const server = await serve('public', { isolate: true });
console.log(`${server.url}index.html`);
await server.close();
```

Only files inside the folder are served: no `..`, no symbolic links that lead out, no
dotfiles (`.env`, `.git`), no directory listings (a folder serves its `index.html`).
Only GET and HEAD, nothing cached, and requests for another host name (a DNS rebinding
attack) are refused. `isolate: true` adds the cross-origin isolation headers that
`SharedArrayBuffer` needs. A folder that doesn't exist throws.

## Chrome

These find, install and check the Chrome brokit uses; [Chrome](chrome.md) says how
brokit chooses one.

- `chooseChrome({ env, platform, cwd })`: which Chrome brokit would use, and why:
  `{ path, source, version? }`, or `{ path: null, problem }` with what to do. It looks at
  `BROKIT_CHROME`, then the version the project pins, then a Chrome, Chromium or Edge
  installed on the computer, then one brokit installed. Each option defaults to the
  current process's.
- `findChrome(options)`: just the path from `chooseChrome`, or `null`.
- `systemChrome({ env, platform })`: the Chrome, Chromium or Edge installed on the
  computer, or `null`.
- `GPU_MODES`: `['default', 'software', 'hardware']`, the values of `launch`'s `gpu`.
- `installChrome(wanted, { cache, onProgress })`: downloads Google's Chrome for Testing
  into brokit's cache, unless it's there. `wanted` is a version like
  `'156.0.8078.47'` or a channel (`'stable'`, the default, `'beta'`, `'dev'`,
  `'canary'`). `onProgress({ phase, done, total })` hears about the `'download'` and
  `'unpack'` phases. Resolves to `{ version, platform, path, fresh }`; `fresh` is
  `true` when it was downloaded just now.
- `installedChromes({ cache })`: the Chromes brokit has installed, newest first:
  `[{ version, platform, path }]`.
- `pinnedVersion({ env, cwd })`: the version the project pins, and where:
  `{ version, from }` from `BROKIT_CHROME_VERSION` or the nearest package.json's
  `"brokit": { "chrome": ... }`; `null` if none.
- `cacheDir({ env, platform })`: brokit's cache folder (`BROKIT_CACHE`, else
  `$XDG_CACHE_HOME/brokit` or `~/.cache/brokit` on Linux, `~/Library/Caches/brokit` on macOS,
  `%LOCALAPPDATA%\brokit\Cache` on Windows).
- `cftPlatform({ platform, arch })`: Chrome for Testing's name for a platform
  (`'linux64'`, `'mac-arm64'`, `'win64'`, ...), or `null` if it has no build for it.
- `doctor({ env, onCheck })`: everything `brokit doctor` checks. Resolves to
  `{ ok, checks }`; each check is `{ name, status, detail, fix? }` with `status` `'ok'`,
  `'warn'` or `'fail'`, and `onCheck` gets each one as it's done.

```js
import { chooseChrome, installChrome, launch } from 'brokit';

let { path, source, problem } = chooseChrome();
if (!path) {
  console.log(problem);
  ({ path } = await installChrome('stable', {
    onProgress: ({ phase, done, total }) => process.stdout.write(`\r${phase} ${done}/${total}`),
  }));
  source = 'installed just now';
}
console.log(`Chrome at ${path} (${source})`);
const browser = await launch({ chrome: path });
await browser.close();
```

```js
import { doctor } from 'brokit';

const { ok, checks } = await doctor();
for (const c of checks) console.log(c.status, c.name, c.detail, c.fix ? `→ ${c.fix}` : '');
process.exitCode = ok ? 0 : 1;
```

## Low-level

These are exported because the rest is built on them. Most scripts never need them.

- `Connection`: the DevTools Protocol connection to Chrome (`browser.connection`).
  `send(method, params, sessionId, timeout)` makes a call (`timeout` defaults to
  30000 ms), `on(sessionId, listener)` listens to events (`listener(method, params)`,
  `sessionId` `null` for the browser's) and returns a function that stops listening,
  `close()` closes it. You don't make one yourself: `launch` does.
- `Page` and `Browser`: the classes; get them from `launch()` and `browser.newPage()`.
- `parseKey(spec, modifiers)`: a key as Chrome wants it:
  `{ key, code, keyCode, text, modifiers, modifierKeys }`; throws on a key it doesn't
  know.
- `parseSize(size)`: `'1280x800'` or `[1280, 800]` as `[1280, 800]`; each side 1 to
  10000, or it throws.
- `mismatch(value, matcher)`: `null` if `value` meets an [expectation's](steps.md#expectations)
  matcher (`{ equals }`, `{ near, within }`, `{ matches }`, `{ includes }`,
  `{ atLeast, atMost }`, or `{}` for truthy), else what's wrong:
  `'expected 3, got 2'`.
- `checkMatcher(matcher)`: throws if a matcher isn't valid (two kinds at once, `within`
  without `near`, a bad regular expression).
- `unzip(file, dest, { onEntry })` and `readZip(file)`: the zip reader `installChrome`
  unpacks Chrome with. `unzip` resolves to how many entries it unpacked; `readZip` to
  the entries' list. Internal, but safe on untrusted archives: every entry must stay
  inside `dest`, and each is checked against its CRC.

```js
import { parseKey, parseSize, mismatch } from 'brokit';

parseKey('Ctrl+Shift+Z').modifiers; // 10 (Ctrl 2 + Shift 8)
parseSize('393x852'); // [393, 852]
mismatch('Welcome, ana', { matches: '^Welcome' }); // null
mismatch(58.2, { near: 59, within: 0.5 }); // 'expected 59 ± 0.5, got 58.2'
```

The exports are listed in [index.mjs](../../src/index.mjs), and come from
[chrome.mjs](../../src/chrome.mjs) (launch,
Browser, Connection), [page.mjs](../../src/page.mjs) (Page),
[actions.mjs](../../src/actions.mjs) (steps), [run.mjs](../../src/run.mjs) and
[load.mjs](../../src/load.mjs) (scenarios), [baseline.mjs](../../src/baseline.mjs),
[png.mjs](../../src/png.mjs), [diff.mjs](../../src/diff.mjs),
[serve.mjs](../../src/serve.mjs), [install.mjs](../../src/install.mjs),
[doctor.mjs](../../src/doctor.mjs).
