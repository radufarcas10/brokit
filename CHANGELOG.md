# Changelog

All notable changes to brokit. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

- Documentation site, published to GitHub Pages: guides (getting started, steps and
  expectations, scenarios, checks and baselines, Chrome, CI), references for the command
  line and the Node.js library, and runnable examples in `examples/` whose output on the
  site comes from real runs.

## [0.1.0] - not released yet

First version.

- `brokit run`: open a page (a URL, a file, or a scenario), wait until it's ready, run
  steps with real input (mouse, wheel, keys, typing, input methods, touch, swipes),
  read values back, take screenshots; report each step, the console and errors.
- `brokit check`: run every `*.check.json` and `*.check.mjs` in one Chrome, with
  expectations and baseline screenshots (written when missing, except in CI; replaced
  with `--update`); `--no-js` runs only JSON scenarios.
- `brokit diff`: compare two PNGs pixel by pixel, with tolerances, ignored regions and a
  difference image.
- `brokit serve`: serve a folder on 127.0.0.1.
- `brokit doctor`: whether brokit can work here (Node, Chrome, its sandbox, drawing,
  fonts, CI) and the exact fix when it can't (missing libraries and their packages,
  running as root, a blocked sandbox).
- `brokit install-chrome`: Google's Chrome for Testing into brokit's cache, checked
  (MD5, CRC-32, a strict unzip); `--pin` makes a project use that version everywhere.
- Screen emulation (size, pixel ratio, phone, safe areas, light and dark, reduced
  motion), `--gpu default | software | hardware`, `--json` results, and a library.
- Keys: `"Mod+a"` is Cmd on macOS and Ctrl elsewhere; on macOS, Cmd+A/C/X/V/Z edit as
  they do for a person.
- Baselines allow a channel off by up to 2 of 255 unless told otherwise (`{"max": 0}`
  is exact); new baselines and differing shots are retaken until two in a row match;
  phone emulation hides the transient overlay scrollbar.
- Screenshots wait until the page is still: CSS transitions and animations with an end,
  and smooth or animated scrolling, up to 5 s (`"still"` to change it); what couldn't
  be waited for (an endless animation, for a baseline) is named in the step's note.
- A page with errors (an HTTP error, an uncaught exception) never becomes a baseline,
  even with `--update`.
- Full-page and element screenshots taller than Chrome draws at once (8192 device
  pixels) are taken in strips and joined; before, the picture started over from the
  page's top past that point.
- `BROKIT_NO_SANDBOX=1`: Chrome without its sandbox, honored only inside a container
  (for CI containers whose settings forbid the sandbox); only local pages then, and a
  warning on every run.
- Chrome over a pipe, not a port; pages in tabs (a window only when another page is
  open); no npm dependencies.
