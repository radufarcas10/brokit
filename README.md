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
  CI (GitHub Actions, GitLab CI, Docker; see [CI and containers](site/docs/ci.md)),
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


**Documentation:** [radufarcas10.github.io/brokit](https://radufarcas10.github.io/brokit/)
has all of it, with examples. The same pages are in this repository: see
[Documentation](#documentation) below.

## A taste

Steps say what to do on a page, as a person would:

```json
[
  { "click": { "selector": "#email" } },
  { "type": "ana@example.com" },
  { "key": "Enter" },
  { "expect": "document.querySelector('#greeting').textContent", "equals": "Welcome, ana" },
  { "screenshot": "signed-in" }
]
```

```
$ brokit run signup.html --steps steps.json
brokit run http://127.0.0.1:45541/signup.html
  ready (load + network idle) in 609 ms
  ✓ click #email
  ✓ type "ana@example.com"
  ✓ key Enter
  ✓ expect greeting.textContent equals "Welcome, ana"
  ✓ screenshot signed-in → brokit-out/signed-in.png (1280×800)
ok in 0.8 s
```

Put them in a `*.check.json` file with their page and screen, add `"baseline": true` to
a screenshot, and `brokit check` runs every check in your project, comparing each
screenshot with the one you approved.

## Documentation

| | |
|---|---|
| [Getting started](site/docs/getting-started.md) | from installing to a first check with a baseline screenshot |
| [Steps and expectations](site/docs/steps.md) | every step: clicks, typing, touch, input methods, screens, waits; checking values |
| [Scenarios](site/docs/scenarios.md) | scenario files, when a page is ready, JS scenarios |
| [Checks and baselines](site/docs/checks.md) | `brokit check`, baselines, motion, tolerances, `brokit diff` |
| [Chrome and safety](site/docs/chrome.md) | which Chrome, `brokit doctor`, installing and pinning Chrome, serving, what brokit allows |
| [CI and containers](site/docs/ci.md) | GitHub Actions, GitLab CI, Docker, AI agents |
| [Command line](site/docs/cli.md) | every command, option, exit code and environment variable |
| [Node.js library](site/docs/library.md) | `launch`, `Browser`, `Page`, scenarios, images, serving, Chrome |
| [Examples](examples/README.md) | small apps with their checks: a form, a phone in dark mode, a canvas, keyboard and input methods, a JS scenario, the library |

Also: [SECURITY.md](SECURITY.md) (what brokit promises, and reporting a vulnerability),
[CHANGELOG.md](CHANGELOG.md), and [the benchmark](bench/README.md) next to Playwright
and Puppeteer.

## License

brokit is licensed under either of

- the Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE)), or
- the MIT license ([LICENSE-MIT](LICENSE-MIT)),

at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted for
inclusion in the work by you, as defined in the Apache-2.0 license, shall be dual
licensed as above, without any additional terms or conditions.
