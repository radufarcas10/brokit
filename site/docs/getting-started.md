# Getting started

From nothing to a check that clicks through a page, checks what it shows and compares a
screenshot with one you approved. It takes about ten minutes, and everything here runs on
your computer.

## What you need

- **Node.js 22.4 or newer.** `node --version` tells you which you have.
- **Chrome, Chromium or Edge.** brokit finds the one installed on your computer. No
  browser? `npx brokit install-chrome` downloads one for brokit alone.
- **A page to check.** Any page works: a file on disk, your dev server
  (`http://localhost:3000/`), any framework or none, DOM or canvas.

## 1. Install

In your project:

```sh
npm install --save-dev brokit
```

brokit has no npm dependencies, so this adds one package and nothing else.

### Before brokit is on npm

brokit isn't published on npm yet. Until it is, install it one of these ways; everything
after that (`npx brokit ...`, `import ... from 'brokit'`) works the same.

**From GitHub**, into your project. No clone needed; run it again to update:

```sh
npm install --save-dev github:radufarcas10/brokit
```

**From a clone**, into your project. npm links the folder rather than copying it, so a
`git pull` in the clone updates every project that uses it:

```sh
git clone https://github.com/radufarcas10/brokit.git
cd my-project
npm install --save-dev ../brokit       # the path to your clone
```

**From a clone, as a command** you can run anywhere, without `npx`:

```sh
cd brokit
npm link                                # puts brokit on your PATH
brokit doctor
```

To try it without installing anything: `npx github:radufarcas10/brokit run index.html`.

### Check your setup

Ask brokit whether everything it needs is there:

```sh
npx brokit doctor
```

`doctor` checks Node, finds Chrome, starts it with its sandbox on, makes it draw text, a
screenshot and WebGL, and looks for fonts. When something is missing, it says what to run
on your system to fix it. It exits 0 when brokit can work.

> **Note:** the commands below write `brokit`; in a project where you installed it with
> npm, that's `npx brokit`. After `npm link`, `brokit` works as written.

## 2. Open a page

Say your project has a sign-up page, `signup.html`:

```sh
brokit run signup.html
```

brokit serves the page's folder on `127.0.0.1`, opens the page in a headless Chrome,
waits until it's ready, and tells you what happened: when it was ready, what the page
wrote to its console, and any errors it threw. Add `--out shot.png` to see it:

```sh
brokit run signup.html --out shot.png
brokit run signup.html --out phone.png --size 393x852 --dpr 3 --mobile
```

The second one is the page as a phone shows it: a phone's screen, three device pixels per
CSS pixel, a mobile viewport and touch.

From a dev server, give the URL instead: `brokit run http://localhost:3000/signup`.

## 3. Use it, as a person would

Steps say what to do on the page. Put them in `steps.json`:

```json
[
  { "click": { "selector": "#email" } },
  { "type": "ana@example.com" },
  { "key": "Enter" },
  { "expect": "document.querySelector('#greeting').textContent", "equals": "Welcome, ana" },
  { "screenshot": "signed-in" }
]
```

```sh
brokit run signup.html --steps steps.json
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

These are real input events: the click is a mouse press and release at the element's
center, the typing goes where the focus is, Enter is a key press. The page can't tell
brokit from a person. The `expect` step checks a value in the page, and if the page
takes a moment to update, it tries again for up to two seconds before it fails.

[Steps and expectations](steps.md) lists every step: drags, the wheel, touch, keyboard
shortcuts, input methods, screen changes and more.

## 4. Make it a check

A check is a scenario file that brokit runs whenever you ask: the page, its screen and
its steps together. Make a `checks/` folder and save this as `checks/signup.check.json`:

```json
{
  "url": "/signup.html",
  "ready": "document.readyState === 'complete'",
  "steps": [
    { "click": { "selector": "#email" } },
    { "type": "ana@example.com" },
    { "key": "Enter" },
    { "expect": "document.querySelector('#greeting').textContent", "equals": "Welcome, ana" },
    { "screenshot": "welcome", "baseline": true }
  ]
}
```

Two things are new. The `ready` expression tells brokit when the page is ready, which
is faster and steadier than waiting for the network to go quiet. And
`"baseline": true` means this screenshot is compared with one you approved.

Run every check in the project:

```sh
brokit check
```

The first time, there is no approved screenshot yet, so brokit writes it to
`checks/baselines/signup/welcome.png` and the check passes. Look at that picture: if
it's right, commit it with your code. From now on, `brokit check` compares the page
with it.

## 5. See a difference

Change something on the page (a color, a margin, a word) and run the check again:

```
$ brokit check
brokit check: 1 scenario, Chrome 158.0.8127.36, software drawing
✗ checks/signup  5 steps, 0.5 s
    ✗ screenshot welcome → brokit-out/checks/signup/welcome.png (1280×800)  210 ms
        differs from checks/baselines/signup/welcome.png: 1840 pixels differ by more than 2 (up to 243)
        difference → brokit-out/checks/signup/welcome.diff.png
1 scenario: 0 passed, 1 FAILED in 0.5 s
```

It exits 1. `brokit-out/` has the new screenshot and a difference image: your baseline
faded, with the pixels that changed in red. If the change is what you meant, take the new
screenshot as the baseline:

```sh
brokit check --update
```

[Checks and baselines](checks.md) explains how screenshots are compared, how brokit waits
for animations to end, and how to leave out parts of a page that change every time.

## 6. Run it in CI

The same command runs in CI. Where the `CI` variable is set (GitHub, GitLab and most
others set it), a missing baseline fails instead of being written, since a check with
nothing to compare with checks nothing. For GitHub Actions:

```yaml
- run: npm ci
- run: npx brokit check
- if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: brokit-out
    path: brokit-out/
```

Screenshots match only where the fonts and the Chrome version match, so make your
baselines where CI runs. [CI and containers](ci.md) has full recipes for GitHub Actions,
GitLab CI and Docker.

## Where next

- [Examples](../../examples/README.md): small apps with their checks: a form, a phone
  in dark mode, a canvas, keyboard and input methods, a JS scenario, the library.
- [Scenarios](scenarios.md): scenario files, readiness, and JS scenarios for checks that
  need loops and logic.
- [Command line](cli.md) and [Node.js library](library.md): every command, option and
  function.
- **Using an AI agent?** Tell it to run `npx brokit doctor --json` first, then
  `brokit run` with `--json`: it gets what the page did as data, and the screenshots as
  files it can look at.
