// The examples in examples/: each folder is a small app with its checks, and its
// README.md is a page of the docs (example-<dir>.html). `node site/build.mjs --capture`
// runs `command` in a fresh copy of the folder and keeps what it printed
// (site/captured/examples/<dir>.txt, shown where the README says <!-- output -->) and the
// pictures named in `shots` (copied to site/assets/examples/<dir>/, which the README shows
// as images). test/examples.test.mjs runs every command too, so the examples keep working.

export const EXAMPLES = [
  {
    dir: 'form',
    name: 'Sign-up form',
    description: 'Clicks, typing and Enter, expectations and baselines; then the same form on a phone, with taps.',
    command: 'brokit check --verbose',
    shots: { 'checks/baselines/signup/error.png': 'error.png', 'checks/baselines/signup/welcome.png': 'welcome.png', 'checks/baselines/signup-phone/filled.png': 'phone.png' },
  },
  {
    dir: 'phone-dark',
    name: 'Phone, notch and dark mode',
    description: 'A phone screen mid-run, a notch and home bar, layout measured with expectations, reduced motion, and light and dark baselines.',
    command: 'brokit check --verbose',
    shots: { 'checks/baselines/trips/light.png': 'light.png', 'checks/baselines/trips/dark.png': 'dark.png' },
  },
  {
    dir: 'canvas',
    name: 'Canvas drawing app',
    description: 'Drags at points inside a canvas, pixel checks with getImageData, and a screenshot of the canvas\'s own pixels.',
    command: 'brokit check --verbose',
    shots: { 'checks/baselines/sketch/app.png': 'app.png', 'checks/baselines/sketch/drawing.png': 'drawing.png' },
  },
  {
    dir: 'keyboard',
    name: 'Keyboard and input methods',
    description: 'Tab focus, typing per key, Mod+z undo, an input method composing Japanese, Space and Enter.',
    command: 'brokit check --verbose',
    shots: { 'checks/baselines/todo/list.png': 'list.png' },
  },
  {
    dir: 'js-scenario',
    name: 'Tabs in a JS scenario',
    description: 'A *.check.mjs that loops over tabs, steps through them with the arrow keys and measures them on a phone.',
    command: 'brokit check --verbose',
    shots: { 'checks/baselines/settings/tab-general.png': 'general.png', 'checks/baselines/settings/tab-notifications.png': 'notifications.png', 'checks/baselines/settings/tab-privacy.png': 'privacy.png' },
  },
  {
    dir: 'library',
    name: 'Screenshots from a script',
    description: 'The Node.js library: serve a folder, screenshot a page at three sizes, and compare with the last run.',
    command: 'node screenshots.mjs',
    shots: { 'out/laptop.png': 'laptop.png', 'out/tablet.png': 'tablet.png', 'out/phone.png': 'phone.png' },
  },
];
