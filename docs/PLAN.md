# brokit plan

brokit (Browser Kit): checks in a real, headless Chrome — real input, screenshots, pixel
diffs, assertions — with nothing to install but Node 22+ and Chrome. For any web project:
plain HTML, any framework, DOM or canvas, in a terminal, in CI, or driven by an AI agent.

## Principles

- **Universal.** Nothing in brokit knows about any one project, framework or renderer. A
  DOM form and a WebGPU canvas are checked with the same steps; canvas-specific features
  (reading pixels a page draws itself) are options, never assumptions.
- **Easy to plug in.** One command on a URL gives a useful answer with no config. A
  scenario is a short JSON file anyone (or any agent) can write; JS is there for the
  checks that need logic. Adding brokit to a project is one dev dependency or one Action.
- **No dependencies.** Node's built-ins only (WebSocket, zlib, http, child_process) and the
  Chrome already installed. Nothing to download, nothing to audit but our own code.
- **Secure by default.** Local pages only unless allowed; throwaway profile; debugging port
  on 127.0.0.1; Chrome's sandbox always on; every input file treated as untrusted.
- **Fast by doing less.** One Chrome for many scenarios; wait for the page's events and
  frames, never fixed sleeps.
- **Chrome only** (and so Chromium and Edge, which speak the same protocol). No Firefox.

## Where the pieces come from

All our own code, from earlier projects; reorganised and made generic, not copied as-is.

| Module | Source | What changes |
|---|---|---|
| `chrome.mjs`: find, launch, close Chrome; the DevTools protocol session | dac `web/tools/browser-test.mjs`, ghis `tools/brand/share-card.mjs` | Chrome found on Linux, macOS, Windows (+ `BROKIT_CHROME`); many scenarios share one Chrome |
| `actions.mjs`: real input | dac `browser-test.mjs` | Every point takes `[x, y]`, `{"selector": "#id"}` or a JS expression (today `move`/`dblclick` take numbers only, no selectors); more keys (PageUp/Down, F1–F12, Insert) |
| `png.mjs`: PNG encode/decode | duplicated in dac `browser-test.mjs` and `png-diff.mjs` | One copy; decoder bounds-checks chunks, checks CRCs, caps size; palette, gray and 16-bit PNGs too |
| `diff.mjs` | dac `web/tools/png-diff.mjs` | Same buckets (identical / ≤2 / ≤8 / ≤32 / >32), plus thresholds (`{"max": 2}`, `{">8": "0.1%"}`) and ignored regions (a caret, a clock) |
| `expect.mjs`: assertions | the `expect`/`near` helpers repeated in dac `check-showcases.mjs` | One library |
| `serve.mjs`: static server | dac `web/serve.py` | Node, 127.0.0.1 only, no path traversal |
| `report.mjs` | dac `browser-test.mjs`'s JSON | Text, JSON, JUnit XML, an HTML diff report (before / after / diff, with a slider) |

Left behind (project-specific): dac's `tools/stats.mjs`, its `"dacui done"` title convention
and `dacuiTest.*` hooks, its GPU flag sets tuned for one laptop, its check scripts.

## Generic where the old tools weren't

- **Ready signal**, per scenario: `"ready": "<expression>"` (polled until truthy),
  `"readyTitle": "<title>"`, or (the default) load + network idle. No blanket 5 s wait.
- **Waiting**: `{"frames": n}` (the page's next frames), `{"waitFor": "<expression>"}`,
  `{"wait": ms}` only for the odd case. No fixed sleep after every action.
- **Screenshots**: `{"screenshot": "name"}` is the browser's capture (any page);
  `{"screenshot": "name", "from": "<expression>"}` takes what the page itself returns
  (`{width, height, base64}` RGBA or a data URL): a canvas, an offscreen render, a share card.
- **GPU**: `--gpu default|software|hardware`, documented per platform; no WebGPU assumption.
- **Report**: optional `"report": "<expression>"` read at the end.

## Formats

A scenario in JSON, what most users and agents write:

```json
{
  "url": "/form.html",
  "viewport": { "size": "393x852", "dpr": 3, "mobile": true },
  "ready": "document.readyState === 'complete'",
  "steps": [
    { "tap": { "selector": "#email" } },
    { "type": "ana@example.com" },
    { "expect": "document.querySelector('#email').value", "equals": "ana@example.com" },
    { "ime": ["かな", 2] }, { "ime": ["", 0] },
    { "screenshot": "typed", "baseline": true, "tolerance": { "max": 2 } }
  ]
}
```

A scenario in JS, for checks with logic:

```js
export default async ({ page, expect }) => {
  await page.emulate({ size: '393x852', dpr: 3, mobile: true });
  const header = await page.rect('header');
  expect.near(header.y, 59, 0.5, 'clear of the notch');
};
```

Same engine; every JSON step is also a `page` method.

## Commands

```
brokit run <url|scenario.json> [--out shot.png]   one page: console, errors, screenshot
brokit check [dir]          every scenario; compare to baselines; exit 1 on a failure
brokit check --update       accept the current images as the baselines
brokit diff a.png b.png [diff.png]
brokit shot <url> <out.png> [--from <expression>]   README and share images
brokit serve [dir]          the static server alone
brokit mcp                  the same tools for AI agents (MCP over stdio)
```

And a library: `import { launch } from 'brokit'` for custom runners.

## CI and agents

- GitHub Action (`action.yml`): Ubuntu runners already have Chrome; uploads the HTML diff
  report when a check fails.
- JUnit XML, so GitLab, Jenkins, Azure DevOps show the results natively.
- MCP server, no dependencies (JSON-RPC over stdio): `open`, `act`, `eval`, `screenshot`,
  `diff`, `check`. Lets an agent drive a real browser and see what's drawn, canvas included.
- `AGENTS.md`: one page for agents — the scenario format, reading results, common mistakes.

## Security

- Local pages only (`localhost`, `127.0.0.1`) unless `--allow-host` names others.
- Throwaway profile per run; debugging port on 127.0.0.1; never `--no-sandbox`.
- Chrome and V8 flags checked against a strict pattern; every protocol call and every run
  has a timeout; Chrome is always killed and its profile removed.
- PNG decoding treats every file as untrusted (chunk bounds, CRCs, a pixel cap).
- Files are written only inside the output directory; scenario and image names can't
  escape it.
- No runtime dependencies.

## Phases

| # | Phase | Done when |
|---|---|---|
| 1 ✓ | Core: `chrome`, `page`, `keys`, `actions`, `png`, `diff`, `serve`, `run`; `brokit run`, `diff`, `serve` | brokit's own fixtures (a DOM form, a 2D canvas, a WebGL page) pass with every action kind, on Linux; same results run after run. **Done 2026-10-27** (85 tests, 5 runs in a row all green) |
| 2 ✓ | `expect`, baselines, `brokit check`, JS scenarios (`*.check.mjs`) | A multi-scenario suite runs on one Chrome, measurably faster than one Chrome per scenario (before/after numbers in NOTES). **Done 2026-10-27**: 10 checks, 3.1 s CPU vs 8.2 s, 8.0 s wall vs 11.3 s |
| 3 | Reports, JUnit, GitHub Action | A failing check in CI shows a readable diff report |
| 4 | MCP server, `AGENTS.md` | An agent session checks a page using only the MCP tools |
| 5 | Prove it in real projects | ghis replaces `share-card.mjs` and `screenshots.sh`; random-balloon (Next.js, DOM only) gets smoke checks; dac's checks can be written in it. None needs a brokit change made just for it |
| 6 | Docs, examples, test suite, macOS/Windows Chrome discovery checked, first release | The user publishes it |
| later | `brokit bench` (from dac `compare/web-bench.mjs`) | Linux first (reads `/proc`) |

## Before the first release

- [x] Talk to Chrome over a pipe (`--remote-debugging-pipe`) instead of a port: no
      other process on the machine can connect to brokit's Chrome while it runs.
- [x] Say plainly (README, SECURITY.md) that `*.check.mjs` files are code, run like
      tests; `--no-js` runs only JSON scenarios.
- [x] SECURITY.md (how to report a vulnerability), CHANGELOG.md.
- [ ] package.json: `repository`, `homepage`, `bugs`, `keywords` (once the host is
      chosen; `repository` also makes the README's logo show on npm); remove
      `"private": true` only when publishing.
- [ ] CI for the repository itself (tests on Linux; macOS and Windows to verify Chrome
      discovery and keyboard shortcuts there).
- [x] Smaller site baselines (5.2 MB → 1.5 MB).
- [ ] Verify on macOS and Windows (made portable on 2026-10-27, not run there yet).
- [x] `brokit doctor`, `brokit install-chrome` (+ `--pin`), CI and container recipes.
- [x] Decided (user, option B): `BROKIT_NO_SANDBOX=1`, honored only inside a container,
      local pages only, a warning every run; `--no-sandbox` as a flag stays refused.
- [x] Screenshots wait for motion: transitions and animations with an end, smooth
      scrolling (`"still"`: false, or a max ms); endless ones named in a baseline's note.
- [x] A page with errors never becomes a baseline, even with `--update`.
- [x] Docs pages on the site, generated from README/SECURITY/CHANGELOG/bench README.
- [x] Theme switch (system, light, dark) on every page.
- [ ] Set site/site.json "repo" once hosted (the docs then link source files, and a
      "Source" link can go in the footer); og:url and absolute og:image need the address.
- [ ] Faster per check by doing less (measure first): a frame only when the page has
      something to draw, no font wait without web fonts, reuse a tab between checks.
- [ ] Verify the GitHub Actions and GitLab CI recipes there.
- [ ] Publish from CI with npm provenance; 2FA on the npm account.

## Decided

- Name: brokit (free on npm as of 2026-10-27).
- Chrome only.
- Universal: not tied to dac, WebGL or WebGPU. How dac uses brokit is decided later.
- `serve` moved into phase 1: `brokit run page.html` serving the page's folder by itself
  is the easiest start, and the tests need it.
- Times are in ms everywhere (scenario JSON and CLI `--timeout` alike).
- `"private": true` in package.json until the user publishes (guards against an
  accidental `npm publish`).
- License: MIT OR Apache-2.0 (as dac), decided 2026-10-27.
- Expectations and baselines are "soft": a failure fails the run but the steps after it
  still run (they changed nothing on the page). Failed actions stop the run.
- Expectations retry until they hold or 2 s pass (no flaky failures from a page that
  updates a frame later; a failing one costs its timeout).
- Baselines live next to the checks (`checks/baselines/<check>/`), are written when
  missing except in CI (`CI` set), replaced only with `--update`.
- `check` runs scenarios one after another in one Chrome: faster by doing less (one
  browser start), not by using more cores. Parallel runs may come later, opt-in only.
- `check` draws with `--gpu software` by default (baselines match across machines);
  `run` keeps Chrome's default.
- Logo: "bro" + "kit" on a block, burgundy #2b1414 and white, swapped in dark (user,
  2026-10-27); the icon in the same two colors.
- Landing page: `site/`, static, no dependencies, hosting (GitHub or GitLab Pages) not
  decided yet.
