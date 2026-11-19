// The work every tool does, the same for all: what to open, where to click and drag, and
// what the page must say afterwards (a run that gets it wrong doesn't count).
// Pages are brokit's test fixtures (test/fixtures/), served by the harness.

export const SCENARIOS = {
  // A DOM form: click a field, type, press Enter, read the greeting, screenshot.
  form: {
    page: 'form.html',
    viewport: { width: 1280, height: 800, dpr: 1, mobile: false },
    field: '#email',
    text: 'ana@example.com',
    read: "document.getElementById('greeting').textContent",
    expect: 'Signed in as ana@example.com',
  },
  // A 2D canvas app: two drags (8 moves each), a key, the wheel, a screenshot of the canvas.
  canvas: {
    page: 'canvas.html',
    viewport: { width: 1280, height: 800, dpr: 1, mobile: false },
    ready: 'window.app && app.ready',
    drags: [
      [70, 70, 370, 70],
      [90, 240, 390, 240],
    ],
    key: 'g',
    wheel: [220, 170, -100],
    read: 'JSON.stringify([app.strokes.length, app.zoom])',
    expect: '[2,1.25]',
  },
  // A phone: a 393×852 screen at 3x with touch; tap a button, read it, screenshot.
  phone: {
    page: 'form.html',
    viewport: { width: 393, height: 852, dpr: 3, mobile: true },
    tap: '#count',
    read: "document.getElementById('count').textContent",
    expect: '1',
  },
};

// What a run does: one check (start, one scenario, close), like `brokit run`; or a suite
// of 20 in one browser, like `brokit check`.
export const PLANS = {
  single: ['form'],
  suite: [...Array(10).fill('form'), ...Array(5).fill('canvas'), ...Array(5).fill('phone')],
};
