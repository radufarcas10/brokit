# brokit notes

Read this first. What's been done, what was learned, what's next. Newest first.

## 2026-10-27: screenshots wait for motion; 404s can't become baselines

- `Page.still()`: waits until no animation with an end runs (`document.getAnimations()`,
  on a DocumentTimeline: CSS animations and transitions, Web Animations, their delays
  included; scroll-driven ones left out) and nothing scrolls, up to 5 s. Endless ones
  (spinners) aren't waited for; they're named in a baseline step's note, as is anything
  still moving at the timeout. Top document only (not iframes); a page's own rAF
  drawing isn't seen (baselines still retake until two shots match).
- `screenshot` (not `from`): `"still"` true (default), false, or max ms. First version
  waited a frame before every shot: suite 5.85 → 6.21 s wall (279 → 297 ms per check),
  CPU the same. Now: look at animations at once; none → watch for scroll events while
  the shot is taken; only if something moved, wait (`still`) and take it again. A/B of
  the same build with the check on/off, 20 interleaved suite runs each: 5.84 vs 5.80 s,
  281 vs 279 ms per check (ranges overlap; three ~0.1 ms protocol calls).
- Learned, measuring smooth scrolls (a 3340 px anchor jump takes 1.0 s; the first scroll
  event comes ~35 ms after the click):
  - two quiet frames don't mean still: right after a clipped capture Chrome ran two rAFs
    in 11 ms without moving the scroll. A scroll now ends at `scrollend`, or after 200 ms
    without a scroll event; the watcher tells still() a scroll was under way.
  - a capture beyond the viewport (full page, an element out of view) resizes the page:
    that stops a smooth scroll (scrollend fires) and Chrome then scrolls to the anchor
    again. So those shots wait first, then capture (one frame; they already cost a
    relayout and three frames).
  - checked 15/15 each: viewport, scaled, element out of view, full page, all wait the
    scroll out. The wheel's scroll is instant in headless (no animation).
- Bug found by my own mistake: `brokit check --update` without `--serve` opened 404
  pages and replaced 8 approved site baselines with them. Now a page with errors so far
  (`page.errors`: HTTP errors, uncaught exceptions) never becomes a baseline (new or
  replaced); the step fails saying why. Test added. Site baselines regenerated with the
  server and each looked at; site check 3/3 passes.
- Also my mistake: a brokit-only `bench/run.mjs --tools brokit` overwrote
  bench/results/2026-10-27-linux.json (the README's raw data). run.mjs now saves only
  a run of every tool and plan; the full benchmark was run again (see bench/README.md).
- 145 tests.
- Logo (user, 2026-10-27): two colors, white and burgundy #2b1414, swapping with the
  theme. Taken literally, white on the light page and #2b1414 on the dark one can't be
  seen, so asked: chosen "bro" as text + "kit" reversed out of a block (light: burgundy
  text, white on a burgundy block; dark: white text, burgundy on a white block), and the
  icon recolored to match (window in --logo, check and dots in --logo-contrast).
  `sections/logo.html` (inline SVG + wordmark, so it follows the theme switch, not just
  the system) in header, footer and share card (dark there); favicon.svg picks its
  colors with prefers-color-scheme (the browser's theme). Text stays "brokit" for
  screen readers. Share card recaptured; site baselines updated and looked at.
- Header button (user): the logo's colors too (`.nav .button`: --logo background,
  --logo-contrast text), so Install / Get started match the logo; other buttons stay green.
- README logo (user): `<h1><picture>` with site/assets/logo-light.png and logo-dark.png
  (GitHub picks by the reader's theme), drawn by `npm run site:capture` from
  src/logo.html (the site's own logo, transparent background via
  Emulation.setDefaultBackgroundColorOverride, 2x). The docs build turns that heading
  back into `# brokit` (the converter keeps no HTML). On npm the relative image paths
  work only once package.json has `repository` (npm points them at the repo); npm may
  not honor <picture>, then it shows the light logo.
- Bug found looking at the new phone baseline: a capture beyond the viewport draws at
  most 8192 device pixels; past that the picture starts over from the page's top (the
  10535 px phone page showed the header and hero again at 8192). Measured with striped
  pages: wrong from 8200 px at dpr 1 and 2, desktop and phone; a strip captured at any
  depth is right. Now pages taller than that are captured in strips of 4096 device
  pixels (whole rows at any scale) and joined with our PNG decoder/encoder; too wide
  throws instead of giving a wrong picture. Checked 8000–20000 px, dpr 1–3, scale 1,
  0.5, 1/3: every stripe right; 12000 px takes ~0.8 s. The phone baseline approved in
  the clarity pass had this fault too (unseen at the size I looked at it); regenerated,
  looked at whole. 146 tests.

## 2026-10-27: docs pages, theme switch, saying clearly what brokit is

- Docs pages: `site/lib/markdown.mjs` (own converter: headings with GitHub ids, lists
  with continuation and nesting, pipe tables, fenced code highlighted for sh, json, js,
  yaml, toml, dockerfile and brokit's terminal output; everything escaped; code spans
  set aside first so bold or links can contain them — a bug the real SECURITY.md caught).
  `src/docs.html` layout; header and footer shared with the landing page
  (`sections/header.html`, `footer.html`, `{{slot:...}}` for each page's parts). Pages:
  docs (README), security, changelog, benchmark; links between the Markdown files become
  links between pages; LICENSE files published as .txt, bench results JSON published;
  links to source files wait for site.json "repo". Sticky contents with the current
  section marked, folded on narrow screens (and when a window narrows), copy buttons on
  code, tables scrolling in their box. Checks: `docs.check.json` (links incl. anchors on
  other pages, widths, a contents jump lands below the bar, theme switch, baselines),
  `pages.check.mjs` (security, changelog, benchmark), and the link check on the landing.
- Theme switch: system → light → dark, kept in localStorage; `theme.js` (not deferred)
  applies it before drawing; hidden without JS; CSS dark tokens under
  prefers-color-scheme + `:not([data-theme=light])` and `[data-theme=dark]`.
- Fixes found by the site checks: double scroll offset (html scroll-padding + heading
  scroll-margin); long inline code overflowing a phone (now wraps in docs); leaving phone
  emulation sometimes didn't bring the desktop scrollbar back (baselines with and
  without it) → `emulate` clears the device metrics when leaving phone mode, and the
  full-page restore re-applies the scrollbar setting. 6/6 passes after.
- Clarity pass (user: what/who/where/how wasn't clear; "zero dependencies" misleading):
  README opening says what brokit is, who it's for, what it checks, where it runs, what
  it needs, license, then Install (`npm install --save-dev brokit`, `npx brokit doctor`).
  Landing: eyebrow "Free, open-source CLI and Node.js library", a lead that says what it
  does, a "needs" line, an "At a glance" section (what, who, where, needs, where from,
  how to start), install with doctor, footer tagline, nav "Overview". Meta: description,
  og/twitter text, og:site_name, image alt, JSON-LD SoftwareApplication (checked: no CSP
  error, parses). "Zero/no dependencies" → "no npm dependencies" with what it does need,
  everywhere (README, SECURITY, CHANGELOG, bench README, package.json description; the
  npm keyword "zero-dependency" kept as a search tag). Sizes stated as a 51 kB download,
  about 160 kB installed. 142 tests.

## 2026-10-27: no-sandbox opt-out (option B); grid; share card; Rust question

- Rust? Measured where the CPU goes in the benchmark: brokit's own Node process 5–8 %,
  Chrome 92–95 % (one check 0.07 s vs 0.85 s; suite 0.21 s vs 3.9 s). A rewrite could
  save at most that, and would cost the 51 kB, readable, dependency-free package.
  Puppeteer (also JS) is fastest by doing less per check. Told the user; ideas in PLAN.
- `BROKIT_NO_SANDBOX=1` (user chose B): `inContainer()` (/.dockerenv,
  /run/.containerenv, KUBERNETES_SERVICE_HOST, $container, /proc/1/cgroup names),
  `sandboxOff()` throws outside one; `Browser.sandboxed`; runScenario and the CLI
  refuse non-local pages and --allow-host without it; a warning every run; doctor shows
  "sandbox OFF" as a warning and offers it in container advice. Verified in Docker with
  default settings as root and as node: doctor ready, check twice passes, --allow-host
  refused. SECURITY.md and README (GitLab.com recipe) updated. 135 tests.
- Hero grid more visible: its own `--grid` color per theme, opacity 0.85 (was the line
  color at 0.5). The half-scale desktop baselines didn't see that change (within 2/255);
  the phone ones did. Same grid on the share card.
- Share card had drifted since it shows real captured output: a scrollbar in its
  terminal, a 4-line headline, wrapped tags. Fixed (smaller type, no wrapping, no
  scrolling) and `build.mjs --capture` now fails if anything on the card overflows.
- Seen on the way: a plain screenshot right after `emulate colorScheme` caught the
  page's 0.3 s color transitions half done (baselines are safe: they retake until
  stable). In PLAN as a question.

## 2026-10-27: doctor, install-chrome, CI and containers

- `src/zip.mjs`: own unzip (streamed; CRC-32 per entry; no paths or links out of the
  folder; no encryption; size and count caps; modes and symlinks kept). 6 tests with
  archives built in the test, malicious ones included.
- `src/install.mjs`: Chrome for Testing (googlechromelabs.github.io list,
  storage.googleapis.com builds; no signed checksums published, so MD5 from Google's
  x-goog-hash header + HTTPS); per-user cache; pins (package.json "brokit.chrome" or
  BROKIT_CHROME_VERSION); `chooseChrome` order: BROKIT_CHROME, pin, system, own.
  Real install here: 156.0.8078.47, 200 MB, 309 files, 42 s (network), 5.5 s CPU,
  127 MB peak; doctor and all 29 browser tests pass with it; reinstall 0.04 s.
- `src/doctor.mjs`: Node, Chrome, starts (chrome://sandbox says whether it's sandboxed),
  draws (text width, screenshot, WebGL renderer), fonts (fc-list), CI. Diagnoses:
  root, missing libraries (ldd → Debian packages), blocked sandbox (chromium-sandbox for
  Debian's chromium; the setuid helper beside a downloaded Chrome), pipe vs port.
- `chromeEnv`: a downloaded Chrome uses its `chrome_sandbox` helper (CHROME_DEVEL_SANDBOX)
  only if it's root's and setuid; brokit never changes it.
- Found in Docker (node:22-bookworm-slim): installed.json kept an absolute path, so a
  cache mounted elsewhere wasn't found → paths now come from the folder name; Docker's
  defaults block the namespace sandbox ("No usable sandbox"), so my first doctor text
  ("Docker allows it") was wrong → fixed; a Chrome dying at start was reported as
  "connection closed" (the pipe closes first) → brokit waits for the exit and reports
  its code and messages; run/check printed a stack trace when Chrome didn't start →
  a message pointing to doctor.
- Second container round: a Chrome failing its sandbox aborts (SIGABRT: exitCode null,
  signalCode set), so the exit was still missed → signals count as exits now (pipe and
  port paths). Then measured, for Debian chromium and Chrome for Testing alike, as user
  node in node:22-bookworm-slim: Docker defaults → no sandbox possible (namespace
  sandbox: "No usable sandbox"; Debian's setuid chromium-sandbox: "Failed to move to new
  namespace … Operation not permitted"); --security-opt=seccomp=unconfined → works;
  --cap-add=SYS_ADMIN → works. doctor detects containers (/.dockerenv,
  /run/.containerenv) and gives those options. Following doctor step by step from a bare
  image worked: missing libraries (ldd list → one apt-get line), root, then the
  container option. The README's Dockerfile recipe was built and run as written: with
  the seccomp option, check writes the baseline then matches it; without, a clear message.
- So under "never --no-sandbox", brokit can't run where a job can't change its
  container's options: GitLab.com shared runners, GitHub `container:` jobs. Asked the
  user (2026-10-27) whether to allow an explicit, container-only opt-out.
- GitHub Actions and GitLab recipes in the README are marked not verified there yet.
- 132 tests, all green. Docker test images removed; node:22-bookworm-slim (227 MB) kept.

## 2026-10-27: benchmark against Playwright and Puppeteer

`bench/` (see bench/README.md): the same work in the same installed Chrome, measured
from outside (wall, CPU of the whole process tree, peak summed RSS from /proc; Linux).
playwright-core 1.64.1 and puppeteer-core 25.16.0 installed in bench/tools/*/ only,
`--ignore-scripts`, lockfiles kept; node_modules ignored by git; not in the npm package.

First run: brokit behind (suite 9.7 s CPU vs Puppeteer 4.3 s; 1.4–1.6 GB vs 1.0–1.1 GB).
Found by listing each tool's Chrome processes (only under the test's own process: a
first try counted the user's own Chrome) and measuring changes one at a time:
- a window per page costs far more than a tab: tabs now, a window only when another
  page is open at once (the background-tab problem): suite CPU 9.6 → 4.1 s
- `--disable-component-extensions-with-background-pages`: −2 processes, about −200 MB
- closing Chrome's first blank tab saves ~110 MB, but then the window is gone and every
  page must open a new one; kept.
Final (median of 5): one check brokit 0.53 s / 0.87 s CPU / 1150 MB, Playwright 0.63 /
1.17 / 1121, Puppeteer 0.45 / 0.71 / 1030; suite of 20 brokit 5.92 / 4.14 / 1248,
Playwright 6.58 / 11.96 / 1197, Puppeteer 4.58 / 4.29 / 1098. brokit isn't the fastest;
its extra wall time is its waits (fonts, frames), not CPU.

Screenshots, found again by the site's own check after the tab change:
- the dark desktop page came out two ways, 23915 pixels apart by at most 2 (large blurred
  shadows); each way stable within a run. Baselines now allow 2/255 by default
  (`BASELINE_TOLERANCE`; `{"max": 0}` for exact); `brokit diff` stays exact. Failure
  messages now say "N pixels differ by more than 2 (up to 5)".
- a phone's overlay scrollbar showed for a moment after the full-page capture's restore
  (4 px strip at the right): phone emulation now hides scrollbars (they take no room on a
  phone; desktop ones do and stay). Site check: 5 passes in a row after each fix.
116 tests, all green.

## 2026-10-27: pipe, --no-js, SECURITY/CHANGELOG, portability, smaller baselines

- Chrome over `--remote-debugging-pipe` (fd 3 in, fd 4 out, NUL-separated JSON, 512 MB
  cap per message); `BROKIT_CHROME_TRANSPORT=port` keeps the WebSocket for odd builds.
  Checked: over the pipe Chrome has no listening socket and writes no
  DevToolsActivePort (the port mode had one of each). Start time the same (~140 ms).
- `--no-js` (run, check): JS scenarios are code; SECURITY.md says what brokit promises
  and what's your own code. CHANGELOG.md (0.1.0 not released). Both in the npm package.
- macOS/Windows: `Mod` modifier (Cmd on macOS, Ctrl elsewhere); on macOS Cmd+A/C/X/V/Z
  send Chrome's editing command with the key (synthetic keys never reach the menu).
  Tests: file URLs to paths with fileURLToPath, basename instead of splitting on "/",
  symlink cases skipped where symlinks can't be made, path regexes accept "\". Not run on
  macOS or Windows yet: needs CI on those (waiting for the GitHub/GitLab choice).
- Site baselines 5.2 → 1.5 MB (laptop full page at half scale, phone at 1x, dark phone
  only its first screen); site check 5.6 → 3.8 s. Chrome's own PNGs are smaller than
  brokit's encoder makes (1.88 vs 1.97 MB), so baselines stay Chrome's bytes (which also
  keeps the byte-equal fast match).
- Footer: "Made by" + the FR logo linking to radufarcas.dev, as in ghis
  (site/src/fr.png copied from ghis).
- Package: npm's tarball 50.9 KB (gzip -9 of the same tar: 50.7 KB, so npm's
  compression is already as good as gzip gets; the registry only takes gzip), 163 KB
  installed, 0 dependencies, 21 files, bin executable. For comparison (npm registry,
  2026-10-27): playwright 5.0 MB + playwright-core 13.7 MB unpacked, puppeteer-core
  6.1 MB + 6 dependencies; both also download a browser of their own.
- 115 tests, all green.

## 2026-10-27: landing page as templates; steadier screenshots; publish readiness

Site (Option B, chosen by the user): `site/src/page.html` + `sections/*.html` with
`{{include|json|output|bar|copy|value:…}}` placeholders (`site/lib/template.mjs`; a typo
fails the build with file:line). `npm run site` builds `site/dist/` from the kept
captures; `npm run site:capture` reruns brokit for real (the example steps in
`site/examples/steps.json` on `site/demo/`, `brokit diff`, a `brokit check` that finds
the card's change, the share card) and saves `site/captured/` and `site/assets/`;
`npm run site:check` checks the built page (laptop and phone, light and dark, no
sideways scrolling, no terminal overflowing on a laptop) against
`site/checks/baselines/site/`. A new `checks` section shows real `brokit check` output.

brokit changes from this:
- Steadier screenshots (found by the site's own check: the same build differed by up to
  2/255 between runs): `goto` waits for fonts and two frames after ready; `emulate`
  waits three frames after a change; a new baseline, or a shot that differs from its
  baseline, is retaken until two in a row are identical. Three runs in a row: same.
- A baseline whose bytes equal the new PNG matches without decoding (Chrome's PNG
  encoder is deterministic): the site check went 9.0 s → 5.6 s; the 10-check benchmark
  3.65 s → 3.15 s wall, 3.2 s → 2.25 s CPU.
- Step entries carry `action`; a passing expectation doesn't echo its value.
- Baseline messages show paths relative to where brokit runs.

Publish readiness (checked, nothing published): `npm pack --dry-run` gives 19 files,
47.6 kB (bin, src, licenses, README, package.json); no personal paths in the repo;
`bin/brokit.mjs` made executable. Still open before a first release — see the list
given to the user on 2026-10-27, repeated in PLAN.md under "Before the first release".

## 2026-10-27: phase 2 done; license; landing page

License: MIT OR Apache-2.0 (LICENSE-MIT, LICENSE-APACHE as in dac; package.json, README).

Phase 2 built: `src/expect.mjs` (matchers), `src/baseline.mjs`, `src/load.mjs` (JSON
and JS scenario files, finding `*.check.*`), `src/names.mjs`; `expect` steps, baseline
screenshots, JS scenarios in `run.mjs`; `brokit check`; `--update`, `--baselines`;
`emulate`/`viewport` take `colorScheme` and `reducedMotion` (needed to check the
landing page in dark mode). Tests: 112, all green (~19 s).

Measured (10 small checks, software drawing, 3 rounds each, CPU = user + system of
brokit and every Chrome process):
- one Chrome for all (`brokit check`): 8.0 s wall, 3.1 s CPU
- a Chrome per check (10 × `brokit run`): 11.3 s wall, 8.2 s CPU
- one Chrome, pages giving a `ready` signal: 3.65 s wall, 3.2 s CPU — the default
  "network quiet" wait (500 ms after load) is most of a small check's wall time; it
  costs no CPU, but the README tells people to give `ready`.

Learned:
- The diff image's "faded" gray overflowed past 255 for light pixels (white came out
  black); the unit test only checked the pixel was gray. Fixed, with a test that it's
  light. Found by looking at the landing page's diff image.
- A page without `<meta name="viewport">` is 980 px wide under mobile emulation, as on
  a real phone (a test assumed 390).
- A centered layout turns a 3 px change into a whole-page diff (everything moves by
  half of it): worth saying in docs about baselines some day.

Landing page: `site/` — index.html, style.css, main.js, favicon.svg, og.html (share
card), demo/ (pages the images and terminal output come from), build.mjs (makes
assets/ with brokit: before/after/diff of the demo card, og.png). Checked with brokit
at 1280×800 and 390×844, light and dark, reduced motion: no console errors, no CSP
violations, no sideways scrolling. Not hosted; to do when hosting is chosen: absolute
og:image URL, a link to the repository.

Next: the user asked how to make the landing page easier to maintain (answered with a
proposal; waiting for their choice). Then phase 3: reports (HTML diff report, JUnit),
GitHub Action.

## 2026-10-27: phase 1 done

Built: `src/` chrome (find, launch, CDP connection, Browser), page (navigation, ready,
input, screenshots, logs), keys, actions (JSON steps), png, diff, serve, run (scenarios),
report (text); `bin/brokit.mjs` with `run`, `diff`, `serve`; README with the step
reference. No dependencies. Run it here with `node bin/brokit.mjs ...` (not installed
anywhere; `npm link` would put `brokit` on the PATH).

Tests: `npm test` — 85 tests, ~13 s: png (every color type and depth, 16 malformed
files), diff, keys, serve (traversal, symlinks, dotfiles, DNS rebinding), scenario and
URL checks, the CLI (exit codes, messages, JSON), and in Chrome every action on
`test/fixtures/` form.html (DOM), canvas.html (2D app), webgl.html. Five full runs in a
row: all green; no Chrome or temp profile left behind.

Measured (this laptop, Chrome 155, Node 26): Chrome starts in ~150 ms, closes in ~50 ms;
`brokit run page.html` end to end 0.9 s, of which 0.5 s is the default "network quiet"
wait (a page's `ready` signal skips it). A click with its frame: ~15 ms.

GPU modes here: `default` and `software` both give SwiftShader (headless Chrome's own
default on this machine); `hardware` gives the Intel Xe through ANGLE/OpenGL. WebGL
works in all three; `navigator.gpu` exists in all three.

Learned (each was a bug found by the tests, now fixed and covered):
- A second tab in one window is a background tab: Chrome gives it no animation frames,
  so every settle waited out its 1 s fallback. Each page now opens in its own window.
- `Page.captureScreenshot` with `captureBeyondViewport` leaves the page without its
  scrollbar (785 → 800 CSS px wide here), changing the layout for later steps.
  Re-applying the device metrics or `setScrollbarsHidden(false)` doesn't restore it;
  `Emulation.clearDeviceMetricsOverride` then setting them again does. It's also only
  used when the element doesn't fit in the viewport. Scroll position survives.
- The main document's `Network.responseReceived` can arrive before `Page.navigate`
  answers, so matching it by loaderId missed HTTP 404s. Matched by the top frame's id
  (= the target id) and `type: "Document"` instead.
- A 5 s fallback `setTimeout` in `Browser.close()` kept Node alive 5 s after every run;
  now cleared.
- Chrome asks for `/favicon.ico` by itself; its 404 is dropped from the console report.
- A touch swipe more sideways than vertical gets locked to the horizontal axis by
  Chrome (correct browser behavior; a test had it wrong).
- Port 9 is one of Chrome's "unsafe ports" (ERR_UNSAFE_PORT); tests use a freshly freed
  port for "nothing listening".

Not verified yet: macOS and Windows (Chrome discovery paths written, untested);
Ctrl/Cmd shortcuts on macOS may need CDP's `commands` for editing (select all, undo).

Next: phase 2 — `expect` steps, baselines (`brokit check`, `--update`), one Chrome for
a folder of scenarios.

## 2026-10-27: started

- Folder created with this file, `docs/PLAN.md` and a README.
- `brokit` checked free on npm.
- Sources drawn from (all our own): dac `web/tools/browser-test.mjs`, `png-diff.mjs`,
  `check-showcases.mjs`, `web/serve.py`, `compare/web-bench.mjs` (later: bench); ghis
  `tools/brand/share-card.mjs` (uses `--no-sandbox`, which brokit won't),
  `tools/screenshots.sh`.
- Gaps in the old code, all fixed in phase 1: PNG decoder read only 8-bit RGB/RGBA and
  didn't check chunk bounds or CRCs; `move`/`dblclick` took numbers only; small key
  table; fixed 60 ms sleep after every action; Chrome hard-coded to `google-chrome`.
