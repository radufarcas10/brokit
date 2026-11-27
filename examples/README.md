# Examples

Six small pages, each with the checks or the script that test it. Every folder runs on
its own: `cd` into it and run `npx brokit check` (or, for the library example,
`node screenshots.mjs`). The first run writes the baseline screenshots; the runs after
it compare against them.

| Example | Shows |
|---|---|
| [Sign-up form](form/README.md) | clicks, typing, Enter, `expect` with `equals` and `matches`, baselines; the same form on a phone with taps |
| [Phone, notch and dark mode](phone-dark/README.md) | `emulate` a phone, `safeArea` insets, `colorScheme: "dark"`, `reducedMotion`, measuring the layout |
| [Canvas drawing app](canvas/README.md) | `drag` between points on a canvas, reading pixels with `getImageData`, a screenshot `from` the canvas |
| [Keyboard and input methods](keyboard/README.md) | Tab focus, `type` with and without `perKey`, `Mod+z` undo, an `ime` composition |
| [Tabs in a JS scenario](js-scenario/README.md) | a `*.check.mjs` that loops over tabs, with `page`, `expect`, `step` and `screenshot` |
| [Screenshots from a script](library/README.md) | the Node.js library: `serve`, `launch`, three screen sizes, `diffImages` against the last run |

Run them from their own folder: brokit serves the folder it runs in, and each check
opens `/index.html` from there.
