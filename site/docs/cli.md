# Command line

```
brokit <command> [arguments] [options]
```

| Command | Does |
|---|---|
| [`brokit run`](#brokit-run) | opens one page, runs its steps, reports what happened |
| [`brokit check`](#brokit-check) | runs every check in the project, comparing baselines |
| [`brokit diff`](#brokit-diff) | compares two images and draws their difference |
| [`brokit serve`](#brokit-serve) | serves a folder on 127.0.0.1 |
| [`brokit doctor`](#brokit-doctor) | checks that brokit can work here, says what to fix |
| [`brokit install-chrome`](#brokit-install-chrome) | downloads Chrome for Testing, and pins it |

`brokit help` (or `--help`) prints a summary of all of them; `brokit --version` prints
the version.

## Exit codes

| Code | Means |
|---|---|
| `0` | everything went fine |
| `1` | something failed: a step, a check, a page error, a difference, a doctor check |
| `2` | a mistake in how brokit was run (an unknown option, a missing file, no Chrome) |

So a script or CI job can tell a failing check (1) from a broken setup (2).

## brokit run

```
brokit run <url | page.html | scenario.json | scenario.mjs> [options]
```

Opens the page, waits until it's ready, runs the steps, and reports each step, the
console and errors. Exits 1 if anything failed.

```sh
brokit run index.html                            # a page from disk: brokit serves its folder
brokit run http://localhost:3000/                # a page from your dev server
brokit run index.html --steps steps.json         # with steps
brokit run index.html --out shot.png             # a screenshot after the last step
brokit run index.html --size 393x852 --dpr 3 --mobile   # as a phone
brokit run checks/signup.check.json              # a scenario
brokit run index.html --json                     # the result as JSON
```

| Option | Does |
|---|---|
| `--steps <file.json>` | steps to run on a URL or page: a JSON list ([steps](steps.md)) |
| `--out <file.png>` | a screenshot of the viewport after the last step |
| `--size <WxH>` | the viewport, `1280x800` by default |
| `--dpr <n>` | device pixels per CSS pixel, 1 by default |
| `--mobile` | a phone: a mobile viewport, and touch |
| `--ready <expression>` | ready when this is truthy (default: loaded and the network quiet) |
| `--ready-title <title>` | ready when `document.title` is this |
| `--baselines <dir>` | where baselines go for a URL or page (`brokit-baselines`); a scenario's are next to it |
| `--cpu-profile <file>` | profiles the page's main thread into a `.cpuprofile` (open it in Chrome DevTools) |

With a scenario, `--size`, `--dpr`, `--mobile`, `--ready` and `--ready-title` override
what the scenario says. Plus the [options of run and check](#options-of-run-and-check).

## brokit check

```
brokit check [files or folders] [options]
```

Runs every `*.check.json` and `*.check.mjs` under the current folder (or under the files
and folders given) in one Chrome, one after another, comparing baseline screenshots.
Exits 1 if any failed. See [Checks and baselines](checks.md).

| Option | Does |
|---|---|
| `--filter <text>` | only the checks whose name contains this |
| `--verbose` | every step, not just the ones that failed |

Plus the options below. `check` draws with `--gpu software` unless told otherwise.

## Options of run and check

| Option | Does |
|---|---|
| `--update` | replace baselines that differ (missing ones are written anyway, except in CI, where they fail) |
| `--no-js` | don't run JS scenarios: `*.mjs` files are code; use this on a checkout you don't trust |
| `--out-dir <dir>` | where screenshots and difference images go (`brokit-out`) |
| `--timeout <ms>` | how long to wait for a page to be ready (30000) |
| `--gpu <mode>` | `default`, `software` or `hardware`: see [Drawing the same everywhere](checks.md#drawing-the-same-everywhere) |
| `--serve <dir>` | serve this folder for pages and relative URLs (the current folder) |
| `--isolate` | serve with cross-origin isolation (COOP/COEP), for `SharedArrayBuffer` |
| `--base <url>` | resolve relative URLs against this, such as your dev server |
| `--allow-host <host>` | allow a page that isn't on this computer; give it once per host |
| `--js-flags "<flags>"` | V8 flags, for experiments |
| `--json` | print the result as JSON |

## brokit diff

```
brokit diff <a.png> <b.png> [diff.png] [--tolerance <json>] [--ignore <json>] [--json]
```

Compares two images pixel by pixel and, given a third name, writes a difference image.
Exits 1 if they differ more than the tolerance allows (by default, at all). See
[Comparing images](checks.md#comparing-images).

| Option | Does |
|---|---|
| `--tolerance '<json>'` | how much may differ: `{"max": 2}`, `{"mean": 0.5}`, `{">8": "0.1%"}`, `{">0": 20}` |
| `--ignore '<json>'` | regions not compared: `[[x, y, width, height], ...]` in image pixels |
| `--json` | the result as JSON |

## brokit serve

```
brokit serve [dir] [--port <n>] [--isolate]
```

Serves a folder (the current one by default) on `127.0.0.1`, port 8080 unless `--port`
says otherwise, until you stop it with Ctrl+C. Only files inside the folder, no
dotfiles, no listings, GET and HEAD only, nothing cached. `--isolate` adds the
cross-origin isolation headers. See [Serving files](chrome.md#serving-files).

## brokit doctor

```
brokit doctor [--json]
```

Checks that brokit can work here: Node, which Chrome, that it starts with its sandbox on,
that it draws, fonts, and CI. Says exactly what to do when something's missing. Exits 1
if brokit can't work. See [Is everything in place?](chrome.md#is-everything-in-place)

## brokit install-chrome

```
brokit install-chrome [version | stable | beta | dev | canary] [--pin]
```

Downloads Google's Chrome for Testing into brokit's cache: the version the project pins,
or stable. `--pin` writes the version into package.json (`"brokit": { "chrome": ... }`),
so the project uses it everywhere. See [Installing and pinning Chrome](chrome.md#installing-and-pinning-chrome).

## JSON output

`--json` prints the result as JSON instead of text, for scripts and AI agents. For
`brokit run`:

```json
{
  "url": "http://127.0.0.1:41205/signup.html",
  "ok": true,
  "ms": 782,
  "ready": { "by": "load + network idle", "ms": 613 },
  "steps": [
    { "action": "click", "label": "click #email", "ok": true, "ms": 34 },
    { "action": "type", "label": "type \"ana@example.com\"", "ok": true, "ms": 16 },
    { "action": "expect", "label": "expect greeting.textContent equals \"Welcome, ana\"", "ok": true, "value": "Welcome, ana", "ms": 1 },
    { "action": "screenshot", "label": "screenshot signed-in", "ok": true, "file": "/home/ana/my-app/brokit-out/signed-in.png", "size": [1280, 800], "ms": 48 }
  ],
  "console": [],
  "errors": [],
  "title": "Sign up"
}
```

| Field | Is |
|---|---|
| `ok` | whether everything passed |
| `ready` | how and when the page was ready (`by`, `ms`, and a `note` when the network never went quiet); `null` if it never was |
| `steps` | each step: `action`, `label`, `ok`, `ms`, and as it applies `value` (eval, expect), `error`, `file` and `size` (screenshots), `baseline` (`"match"`, `"new"`, `"updated"`, `"differs"`, `"missing"`), `diff` (the difference image), `note` |
| `console` | what the page wrote to its console |
| `errors` | uncaught exceptions, HTTP errors and other page errors |
| `report` | the value of the scenario's `"report"` expression, if it has one |
| `title` | the page's title at the end |

`brokit check --json` gives `{ "ok", "ms", "gpu", "scenarios": [...] }`, each scenario a
result as above with its `name` and `file`. A failed step looks like this:

```json
{
  "action": "expect",
  "label": "expect document.title equals \"Nope\"",
  "ok": false,
  "value": "Sign up",
  "error": "expected \"Nope\", got \"Sign up\"",
  "ms": 103
}
```

## Environment variables

| Variable | Does |
|---|---|
| `BROKIT_CHROME` | the browser to use: a path to Chrome, Chromium or Edge |
| `BROKIT_CHROME_VERSION` | the Chrome version to use and install, instead of package.json's pin |
| `BROKIT_CACHE` | where `install-chrome` keeps its downloads |
| `BROKIT_NO_SANDBOX` | `1`: Chrome without its sandbox; honored only inside a container |
| `BROKIT_CHROME_TRANSPORT` | `port`: talk to Chrome over a local port instead of a pipe |
| `CI` | set by most CI systems: missing baselines fail instead of being written |
