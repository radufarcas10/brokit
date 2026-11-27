# Steps and expectations

A step is one thing done on a page: a click, some typing, a key, a finger's swipe, a new
screen size, a wait, a value read or checked, a screenshot. Steps are JSON objects with
one action each, so they're easy to write by hand and easy for a program or an AI agent
to make.

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

Run them on a page with `brokit run page.html --steps steps.json`, put them in a
[scenario](scenarios.md) with its page and screen, or call the same actions from
[the library](library.md) as `page` methods.

**Every input is real.** brokit sends Chrome the same input events a mouse, a keyboard,
a finger or an input method would. Pages see trusted events, in the order a person would
make them (`pointerdown`, `mousedown`, `focus`, `pointerup`, `mouseup`, `click`, ...), so
whatever your page listens for, it hears. After each input, the page gets a frame to draw,
so the next step sees what the input changed.

## Where: points

Anything that takes a point takes any of these:

| Point | Means |
|---|---|
| `[x, y]` | CSS pixels from the viewport's top left |
| `{ "selector": "#id" }` | the element's center (scrolled into view if it's outside) |
| `{ "selector": "canvas", "offset": [10, 20] }` | a point from the element's top left: handy for canvas apps |
| `"app.buttonCenter()"` | a JS expression the page evaluates to `[x, y]` |

A selector that matches nothing fails the step, saying so: `no element matches #emial`.
For canvas apps, `offset` places a point inside the canvas wherever the canvas is on the
page; an expression lets the app say where something it drew is.

## All steps

### Mouse

| Step | Does |
|---|---|
| `{ "move": P }` | moves the mouse there (hover) |
| `{ "click": P }` | presses and releases the left button; `"button": "right"` or `"middle"`, `"count": 2` for a double click |
| `{ "dblclick": P }` | double-clicks |
| `{ "drag": { "from": P, "to": P } }` | presses, moves in `"steps": 8` moves, releases; also `[x0, y0, x1, y1]` |
| `{ "wheel": { "at": P, "dy": 100, "dx": 0 } }` | turns the wheel (positive `dy` scrolls down); also `[x, y, dy, dx]` |

```json
{ "click": { "selector": "tr:nth-child(3)" }, "button": "right", "note": "the row's menu" }
{ "drag": { "from": { "selector": ".card" }, "to": { "selector": "#done" } }, "steps": 20 }
{ "wheel": { "at": { "selector": "#map" }, "dy": -240 }, "ctrl": true, "note": "zoom in" }
```

### Keyboard and text

| Step | Does |
|---|---|
| `{ "key": "Enter" }` | presses a key, with modifiers: `"a"`, `"Tab"`, `"ArrowUp"`, `"F5"`, `"Ctrl+Shift+Z"`, `"Shift+Tab"` |
| `{ "type": "text" }` | types text at once, as a paste or an input method's commit does |
| `{ "type": "text", "perKey": true }` | presses a key per character (for pages that listen to each key) |
| `{ "ime": "かな" }` | an input method composing text that isn't committed yet |

`"Mod+a"` is Cmd+A on macOS and Ctrl+A elsewhere, so one scenario works on both.

An input method (for Japanese, Chinese, Korean and many others) first *composes*: the
text shows, usually underlined, but isn't committed. Pages that handle text carefully
listen for this (`compositionstart`, `compositionupdate`, `compositionend`). brokit plays
it as an input method does:

```json
[
  { "ime": "か" },
  { "ime": "かな" },
  { "ime": ["かな", 1], "note": "the caret after the first character" },
  { "type": "仮名", "note": "commits" }
]
```

`{"ime": ""}` cancels the composition instead.

### Touch

| Step | Does |
|---|---|
| `{ "tap": P }` | a finger tap |
| `{ "swipe": { "from": P, "to": P, "ms": 120 } }` | a finger moving, then lifted; a fast one flicks; also `[x0, y0, x1, y1, ms]` |

On a [phone screen](#screen) (`"mobile": true`), touch is on: pages see a touch screen
(`navigator.maxTouchPoints` is 5) and get touch and pointer events, as on a phone.

### Screen

| Step | Does |
|---|---|
| `{ "emulate": { "size": "393x852", "dpr": 3, "mobile": true } }` | changes the screen mid-run, as DevTools' device mode does |
| `{ "emulate": { "colorScheme": "dark" } }` | `prefers-color-scheme`: `"light"` or `"dark"` |
| `{ "emulate": { "reducedMotion": "reduce" } }` | `prefers-reduced-motion` |
| `{ "safeArea": [47, 0, 34, 0] }` | a phone's notch and bars, top, right, bottom, left: `env(safe-area-inset-*)` |

As on a real phone, safe-area insets reach pages whose viewport meta has
`viewport-fit=cover`. `emulate` also takes `"scale"` (zoom). Change one setting or several; the others stay as
they were. A scenario's `viewport` sets the screen it starts with.

### Waiting

| Step | Does |
|---|---|
| `{ "waitFor": "expression" }` | waits until it's truthy (`"timeout": 10000` ms) |
| `{ "frames": 2 }` | waits for the page's next frames |
| `{ "wait": 100 }` | waits that many ms |

Prefer `waitFor` and `frames` to `wait`: they wait exactly as long as the page needs, so a
check is neither slow nor flaky. A `waitFor` expression may return a promise.

### Reading and checking

| Step | Does |
|---|---|
| `{ "eval": "expression" }` | evaluates JS in the page; its value goes in the result |
| `{ "expect": "expression", "equals": value }` | checks a value; see [Expectations](#expectations) |

Values are anything JSON can hold: numbers, strings, lists, objects. An expression that
returns a promise is awaited. `eval` values are printed by `brokit run` and are in its
`--json` result, which makes `eval` the way for an AI agent to ask the page a question.

### Screenshots

| Step | Does |
|---|---|
| `{ "screenshot": "name" }` | saves `name.png`: the viewport |
| `{ "screenshot": "name", "selector": "nav" }` | just that element |
| `{ "screenshot": "name", "fullPage": true }` | the whole page, as tall as it is |
| `{ "screenshot": "name", "scale": 0.5 }` | smaller (or larger) |
| `{ "screenshot": "name", "from": "expression" }` | pixels the page gives: a canvas, `ImageData`, or a PNG data URL |
| `{ "screenshot": "name", "baseline": true }` | compared with its [baseline](checks.md) |

Screenshots go to `brokit-out/` (`--out-dir` to change it). They're taken once the page
has stopped moving: transitions and animations finished, smooth scrolling stopped.
`"still": false` takes the shot at once; `"still": 2000` waits at most 2 seconds. See
[Screenshots and motion](checks.md#screenshots-and-motion).

`"from"` is for pixels a page draws itself, at their own size, with nothing on top: a
game's canvas, a WebGL view, an image the page decoded.

```json
{ "screenshot": "chart", "from": "document.querySelector('canvas')" }
{ "screenshot": "frame", "from": "app.renderer.domElement.toDataURL()" }
```

### On any step

- **Modifiers:** mouse, wheel, drag and key steps take `"shift"`, `"ctrl"`, `"alt"` and
  `"meta"`: `true`, as in `{ "click": P, "shift": true }`.
- **A note:** any step can have a `"note"` for people reading it (JSON has no comments).
  brokit doesn't act on it.
- **Expressions for numbers:** `drag`, `wheel` and `swipe` also take a JS expression the
  page evaluates to their list of numbers, as in `{ "drag": "app.handlePath()" }`.

Unknown options are refused, with the ones the step takes: a typo fails the run at once
instead of being quietly ignored.

## Expectations

An expectation is a JS expression and what its value should be:

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

Some that read well:

```json
{ "expect": "document.querySelectorAll('.todo').length", "equals": 3 }
{ "expect": "document.activeElement.id", "equals": "search", "note": "focus moved" }
{ "expect": "getComputedStyle(document.body).backgroundColor", "equals": "rgb(11, 12, 15)" }
{ "expect": "document.querySelector('header').getBoundingClientRect().top", "near": 47, "within": 1 }
{ "expect": "[...document.querySelectorAll('h2')].map((h) => h.textContent)", "includes": "Pricing" }
{ "expect": "performance.getEntriesByType('resource').length", "atMost": 20 }
{ "expect": "!document.querySelector('.error')" }
```

**Retried, not flaky.** An expectation is tried again until it holds or `"timeout"` ms
pass (default 2000), so a page that updates a moment later still passes. One that never
does fails with what it saw: `expected "Welcome, ana", got ""`. `"timeout": 0` checks
once.

## When a step fails

- **A failed action stops the run.** A click on something that isn't there means
  everything after it would act on the wrong page, so brokit stops and says why.
- **A failed expectation or baseline doesn't.** It fails the run, but the steps after it
  still run, since checking changed nothing on the page. One run shows everything that's
  wrong, not just the first thing.
- **The page itself can fail a run:** an uncaught exception, an HTTP error answering the
  page, or not being ready in time. See [Scenarios](scenarios.md#when-a-run-fails).

```
$ brokit check checks/signup.check.json
brokit check: 1 scenario, Chrome 158.0.8127.36, software drawing
✗ checks/signup  2 steps, 0.8 s
    ✗ expect document.title equals "Nope" → "Sign up"  103 ms
        expected "Nope", got "Sign up"
    ✗ click #missing
        Error: no element matches #missing
1 scenario: 0 passed, 1 FAILED in 0.8 s
```
