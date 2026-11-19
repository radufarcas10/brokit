# brokit next to Playwright and Puppeteer

The same work in each, in the same installed Chrome, measured the same way from outside.

```sh
cd bench/tools/playwright && npm install --ignore-scripts && cd ../puppeteer && npm install --ignore-scripts && cd ../../..
node bench/run.mjs                  # 5 runs of each case; --runs, --tools, --plans
```

Playwright and Puppeteer are installed here only, as their `-core` packages (no browser
download; install scripts off), pinned to exact versions. They aren't brokit's
dependencies and aren't in its npm package.

## What's fair

- **The same browser.** All three drive the Chrome installed on the machine, each with
  its own default launch options (headless).
- **The same work** ([scenarios.mjs](scenarios.mjs)), written each tool's usual way
  ([tools/](tools/)): a form (click, type, Enter, read the result, screenshot), a 2D
  canvas app (two drags of 8 moves, a key, the wheel, a screenshot of the canvas) and a
  phone page (393×852 at 3x with touch: a tap, a screenshot). Every run checks the page
  really did it; a wrong result fails the run.
- **The same readiness.** Pages count as loaded at their load event (and, for the
  canvas, when the app says it's ready). Playwright and Puppeteer don't wait after
  input, so their runners wait for the page to show the result, as a test would.
  brokit waits on its own: for fonts and two frames after load, a frame after each
  input. That's part of what it is, and it's in its numbers.
- **Measured from outside**, identically: wall time from starting the tool's process to
  its end; CPU as user + system time of the tool and every Chrome process it started;
  memory as the peak of their summed resident memory (read from `/proc` every 20 ms, so
  this runs on Linux; summing double-counts memory Chrome's processes share, the same
  for every tool). One warm-up run per tool isn't counted; then tools take turns, in a
  different order each run. Medians of 5, with the range.

## Results

2026-10-27 · Intel Core i7-1165G7 (8 threads), 16 GB, Linux 5.19, Node 26.5, Chrome 155 ·
brokit 0.1.0, Playwright 1.64.1, Puppeteer 25.16.0 ·
[raw data](results/2026-10-27-linux.json)

**One check** (start Chrome, a form, close; like `brokit run`):

| | wall | CPU | peak memory |
|---|---|---|---|
| brokit | 0.53 s | 0.86 s | 1154 MB |
| Playwright | 0.63 s | 1.19 s | 1118 MB |
| Puppeteer | **0.46 s** | **0.72 s** | **1031 MB** |

**A suite of 20 checks** in one Chrome (10 forms, 5 canvas, 5 phone; like `brokit check`):

| | wall | CPU | peak memory |
|---|---|---|---|
| brokit | 5.94 s | **4.20 s** | 1238 MB |
| Playwright | 6.53 s | 12.04 s | 1180 MB |
| Puppeteer | **4.58 s** | 4.27 s | **1083 MB** |

**Install** (what `npm install` adds, without a browser):

| | packages | size |
|---|---|---|
| brokit | 1 | **163 KB** |
| playwright-core | 1 | 13.8 MB |
| puppeteer-core | 25 | 27.6 MB |

## What it says

- Puppeteer is the quickest, and the lightest on memory. brokit uses the least CPU for
  a suite (with Puppeteer close) and about a third of Playwright's.
- brokit spends about 70 ms more per check than Puppeteer, mostly waiting (fonts and
  frames after load, a frame after each input): idle time, not CPU. Those waits are what
  make its screenshots match run after run without the check asking for them. Checking
  that a page is still before a screenshot (no fade or smooth scroll under way) costs
  under 2 ms per check when nothing moves (within the noise).
- brokit's install is 85 to 170 times smaller, with no npm dependencies.

## How it got here

The first run of this benchmark found brokit far behind: 9.7 s of CPU for the suite
and 1.4–1.6 GB of memory. Two causes, both fixed:

- **A window per page.** Each page opened in a new window, which costs Chrome far more
  than a tab. Pages are now tabs, and a window only when another page is open at the
  same time: suite CPU 9.6 s → 4.1 s.
- **Chrome's built-in extensions.** `--disable-extensions` spares the component
  extensions with background pages: two more processes. Now off: about 200 MB less.
