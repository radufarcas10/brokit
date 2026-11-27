# Scenarios

A scenario holds a check together: the page, the screen it's seen on, when it's ready,
and the steps to take. It's a JSON file anyone can read, or a JS module when a check needs
loops and logic.

```json
{
  "url": "/form.html",
  "viewport": { "size": "393x852", "dpr": 3, "mobile": true },
  "ready": "window.app?.ready",
  "steps": [
    { "tap": { "selector": "#email" } },
    { "type": "ana@example.com" },
    { "expect": "document.querySelector('#email').value", "equals": "ana@example.com" }
  ]
}
```

```sh
brokit run checks/form.json                  # a relative url: brokit serves the current folder
brokit run checks/form.json --serve web      # ...or another folder
brokit run checks/form.json --base http://localhost:5173/   # ...or your dev server
```

Name a scenario file `*.check.json` (or `*.check.mjs`) and [`brokit check`](checks.md)
finds and runs it with all the others.

## What a scenario holds

| Key | Is |
|---|---|
| `"url"` | the page: absolute (`http://localhost:3000/`) or relative (`/form.html`) to what brokit serves or `--base`. Required |
| `"viewport"` | the screen it starts with: `"size"` (`"1280x800"`, the default), `"dpr"` (1), `"mobile"` (false), `"colorScheme"`, `"reducedMotion"` |
| `"ready"` | a JS expression: the page is ready once it's truthy |
| `"readyTitle"` | or: ready once `document.title` is this |
| `"timeout"` | ms to wait for ready (30000) |
| `"tolerance"` | for every [baseline](checks.md#tolerance-and-ignored-regions) screenshot in it that gives none |
| `"steps"` | the [steps](steps.md), in order |
| `"report"` | a JS expression evaluated at the end; its value goes in the result as `report` |
| `"name"`, `"note"` | for people: a name for the result, a note on what it checks |

Unknown keys are refused, so a typo can't quietly turn a check off.

### Relative URLs

A relative `url` is opened from a server: `brokit run` and `brokit check` serve the
current folder on `127.0.0.1` (or the one `--serve` names) unless `--base` points
somewhere else, such as your dev server. Keep your checks next to your app and the same
scenario works against the built files and against `npm run dev`.

## When a page is ready

Checking a page too early is the classic cause of flaky checks. brokit waits:

- **By default:** after the page's `load` event and half a second with no network
  requests. A page that never goes quiet (it polls, or keeps a socket open) is taken as
  ready 5 seconds after load, with a note saying so.
- **With `"ready": "expression"`:** until the expression is truthy. It may return a
  promise. `"window.app?.ready"`, `"document.querySelector('#list li')"`,
  `"document.readyState === 'complete'"`.
- **With `"readyTitle": "done"`:** until `document.title` is that.

Then, either way, until the page's fonts are loaded and it has drawn two frames, so what's
on screen is the page as it settled.

Give pages a `ready` signal when you can: it's faster and steadier than waiting for the
network. Ten small checks took 8.0 s waiting for the network to go quiet, and 3.7 s with
`"ready": "document.readyState === 'complete'"`. An app that loads data after `load` can
say exactly when it's done:

```js
// in the app
await Promise.all([loadUser(), loadSettings()]);
window.app = { ready: true };
```

```json
{ "url": "/", "ready": "window.app?.ready" }
```

## When a run fails

A run fails if:

- a step fails (see [When a step fails](steps.md#when-a-step-fails): a failed action
  stops the run; a failed expectation or baseline doesn't),
- the page throws an uncaught exception,
- the page is answered with an HTTP error (a 404, a 500),
- or it isn't ready in `"timeout"` ms.

What the page wrote to its console and the errors it threw are in every result, passing
or not: `brokit run` prints them, `brokit check` prints the console's errors and the
page's for checks that failed, and `--json` has them all as `console` and `errors`.

## JS scenarios

For checks that need logic (a loop over tabs, a value computed from another, a step only
when something is there), a `*.check.mjs` file exports the scenario's settings and a
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

It exports any of the keys a JSON scenario has (`url`, `viewport`, `ready`, `readyTitle`,
`timeout`, `tolerance`, `report`, `name`, `note`), except `steps`: the default export takes
their place. The function gets:

| | |
|---|---|
| `page` | the [Page](library.md): a method for every step (`click`, `tap`, `drag`, `key`, `type`, `waitFor`, ...), plus `eval` and `rect` |
| `expect` | checks on values, each recorded like an `expect` step, each returning whether it held: `equal(actual, expected)`, `near(actual, n, within)`, `matches(actual, regex)`, `includes(actual, item)`, `atLeast(actual, n)`, `atMost(actual, n)`, `ok(value)`; each takes a label last |
| `step(s)` | runs a JSON step, recorded as in a JSON scenario; resolves to whether it passed |
| `screenshot(name, options)` | a screenshot step (`{ baseline: true }`, `selector`, `fullPage`, ...); resolves to whether it passed |

`page` methods act at once and aren't recorded; `step(...)` and `screenshot(...)` are, so
use them for what should show in the report. As in JSON scenarios, a failed `expect`
doesn't stop the function, and an error thrown by it fails the run with the file and line
it came from.

> **A JS scenario is code.** `brokit check` runs it with Node and your permissions, as a
> test runner runs test files. On a checkout you don't trust, run `brokit check --no-js`:
> only JSON scenarios run, and their expressions run inside the page, in Chrome's sandbox.
