// In a real Chrome: every action against the three fixture pages (a DOM form, a 2D canvas
// app, WebGL), screenshots, failures, and that the same run gives the same pixels.
// Skipped when there's no Chrome. Uses the software renderer: the same pixels everywhere.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { decodePng, diffImages, findChrome, launch, runScenario, serve } from '../src/index.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const skip = findChrome() ? false : 'no Chrome on this computer';

describe('in Chrome', { skip }, () => {
  let browser, server, out;
  before(async () => {
    [browser, server] = await Promise.all([launch({ gpu: 'software' }), serve(FIXTURES)]);
    out = mkdtempSync(join(tmpdir(), 'brokit-test-'));
  });
  after(async () => {
    await browser?.close();
    await server?.close();
    if (out) rmSync(out, { recursive: true, force: true });
  });
  const run = (scenario, options = {}) => runScenario(browser, scenario, { base: server.url, outDir: out, ...options });
  const values = (r) => r.steps.filter((s) => 'value' in s).map((s) => s.value);
  const failed = (r) => JSON.stringify({ steps: r.steps.filter((s) => !s.ok), errors: r.errors });
  const pixel = (img, x, y) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

  describe('a DOM form', () => {
    it('clicks, typing, keys, Enter', async () => {
      const r = await run({
        url: 'form.html',
        steps: [
          { click: { selector: '#email' } },
          { type: 'ana@example.com' },
          { key: 'Tab' },
          { type: 'secrett', perKey: true },
          { key: 'Backspace' },
          { eval: "[document.getElementById('email').value, document.getElementById('password').value, document.activeElement.id]" },
          { key: 'Enter' },
          { eval: "document.getElementById('greeting').textContent" },
        ],
      });
      assert.ok(r.ok, failed(r));
      assert.deepEqual(values(r), [['ana@example.com', 'secret', 'password'], 'Signed in as ana@example.com']);
      assert.deepEqual(r.console, [{ type: 'log', text: 'form ready' }]);
      assert.equal(r.ready.by, 'load + network idle');
    });

    it('key events as a page sees them: key, code, keyCode, modifiers', async () => {
      const r = await run({
        url: 'form.html',
        steps: [{ click: { selector: '#email' } }, { key: 'a' }, { key: 'Enter' }, { key: 'Ctrl+a' }, { key: 'Tab', shift: true }, { key: '?' }, { eval: 'state.keys' }],
      });
      assert.ok(r.ok, failed(r));
      assert.deepEqual(values(r)[0], ['a:KeyA:65', 'Enter:Enter:13', 'Ctrl+Control:ControlLeft:17', 'Ctrl+a:KeyA:65', 'Shift+Shift:ShiftLeft:16', 'Shift+Tab:Tab:9', '?:Slash:191']);
    });

    it('selecting: Ctrl+A, a double click on a word', async () => {
      const r = await run({
        url: 'form.html',
        steps: [
          { click: { selector: '#email' } },
          { type: 'hello world' },
          { key: 'Mod+a', note: 'select all: Cmd on macOS, Ctrl elsewhere' },
          { eval: "[email.selectionStart, email.selectionEnd]" },
          { dblclick: { selector: '#email', offset: [12, 16] } },
          { eval: "email.value.slice(email.selectionStart, email.selectionEnd)" },
        ],
      });
      assert.ok(r.ok, failed(r));
      assert.deepEqual(values(r), [[0, 11], 'hello']);
    });

    it('an input method composing, then committing', async () => {
      const r = await run({
        url: 'form.html',
        steps: [{ click: { selector: '#email' } }, { ime: 'かな' }, { eval: 'email.value' }, { type: '仮名' }, { eval: '[email.value, state.composition]' }],
      });
      assert.ok(r.ok, failed(r));
      const [composing, [committed, events]] = values(r);
      assert.equal(composing, 'かな');
      assert.equal(committed, '仮名');
      assert.deepEqual([events[0], events.at(-1)], ['start:', 'end:仮名']);
    });

    it('a right click, the wheel, a selector scrolled into view', async () => {
      const r = await run({
        url: 'form.html',
        steps: [
          { click: { selector: '#list' }, button: 'right' },
          { wheel: { at: { selector: '#list' }, dy: 200 } },
          { waitFor: "document.getElementById('list').scrollTop > 0" },
          { click: { selector: '#far' } },
          { eval: '[state.contextmenu, state.farClicks, scrollY > 500]' },
        ],
      });
      assert.ok(r.ok, failed(r));
      assert.deepEqual(values(r), [[1, 1, true]]);
    });

    it('a phone: viewport, touch, a tap, a swipe, the notch', async () => {
      const r = await run({
        url: 'form.html',
        viewport: { size: '393x852', dpr: 3, mobile: true },
        steps: [
          { tap: { selector: '#count' } },
          { eval: "[innerWidth, devicePixelRatio, document.getElementById('count').textContent, state.pointerTypes, getComputedStyle(document.forms[0]).flexDirection]" },
          { swipe: { from: { selector: '#list', offset: [100, 110] }, to: { selector: '#list', offset: [100, 10] }, ms: 200 } },
          { waitFor: "document.getElementById('list').scrollTop > 0", note: 'the finger scrolled the list' },
          { safeArea: [47, 0, 34, 0] },
          { eval: "getComputedStyle(document.querySelector('header')).paddingTop" },
          { emulate: { size: '1280x800', dpr: 1, mobile: false } },
          { eval: 'innerWidth' },
        ],
      });
      assert.ok(r.ok, failed(r));
      assert.deepEqual(values(r), [[393, 3, '1', ['touch'], 'column'], '47px', 1280]);
    });

    it('screenshots: the viewport, an element, the full page, scaled; device pixels', async () => {
      const r = await run({
        url: 'form.html',
        viewport: { size: '800x600', dpr: 2 },
        steps: [
          { screenshot: 'view' },
          { screenshot: 'header', selector: 'header' },
          { screenshot: 'full', fullPage: true },
          { screenshot: 'half', scale: 0.5 },
          { eval: "document.querySelector('header').getBoundingClientRect().width" },
        ],
      });
      assert.ok(r.ok, failed(r));
      const sizes = Object.fromEntries(r.steps.filter((s) => s.file).map((s) => [basename(s.file), s.size]));
      assert.deepEqual(sizes['view.png'], [1600, 1200]);
      assert.equal(sizes['header.png'][0], 2 * values(r)[0]);
      assert.ok(sizes['full.png'][1] > 3000, `full page ${sizes['full.png']}`);
      assert.deepEqual(sizes['half.png'], [800, 600]);
      const header = decodePng(readFileSync(join(out, 'header.png')));
      assert.deepEqual(pixel(header, 2, 2), [0x22, 0x33, 0x44, 255]);
    });

    it('a full page taller than Chrome draws at once (8192 device pixels) is whole', async () => {
      // Stripes 100 px tall, each its own color; past 8192 px Chrome's one capture starts
      // the page over, so the stripe at 9000 px would have the color of the one at 800.
      const color = (k) => [k % 256, (k * 7) % 256, (k * 13) % 256];
      const r = await run({
        url: 'form.html',
        viewport: { size: '400x600', dpr: 1 },
        steps: [
          { eval: `document.body.innerHTML = ''; document.body.style.margin = 0; for (let k = 0; k < 100; k++) { const d = document.createElement('div'); d.style.cssText = 'height: 100px; background: rgb(' + [k % 256, (k * 7) % 256, (k * 13) % 256] + ')'; document.body.append(d); } 1` },
          { screenshot: 'tall', fullPage: true },
          { eval: 'document.documentElement.clientWidth' },
        ],
      });
      assert.ok(r.ok, failed(r));
      const img = decodePng(readFileSync(r.steps[1].file));
      assert.equal(img.height, 10000);
      for (const k of [0, 40, 81, 82, 90, 99]) assert.deepEqual(pixel(img, 5, k * 100 + 50).slice(0, 3), color(k), `stripe ${k}`);
      assert.equal(values(r).at(-1), 385, 'the screen is as it was after (its scrollbar back)');
    });

    it('screenshots wait for transitions, animations and smooth scrolling to end', async () => {
      const r = await run({
        url: 'motion.html',
        viewport: { size: '400x300' },
        steps: [
          { click: { selector: '#toggle' } },
          { screenshot: 'faded' },
          { eval: "document.querySelector('#slide').classList.add('go'); 1" },
          { screenshot: 'slid' },
          { click: { selector: '#jump' } },
          { screenshot: 'scrolled' },
          { eval: "[scrollY, document.querySelector('#far').offsetTop]" },
          // An element out of view when the shot starts (a capture beyond the viewport would
          // stop the scroll), and a clipped capture (scaled):
          ...['far', 'scaled'].flatMap((name) => [
            { eval: "scrollTo({ top: 0, behavior: 'instant' }); 1" },
            { click: { selector: '#jump' } },
            name === 'far' ? { screenshot: name, selector: '#far' } : { screenshot: name, scale: 0.5 },
            { eval: "[scrollY, document.querySelector('#far').offsetTop]" },
          ]),
        ],
      });
      assert.ok(r.ok, failed(r));
      const [faded, slid, scrolled, far, scaled] = r.steps.filter((s) => s.file);
      const [, atFar, atScaled] = r.steps.filter((s) => s.action === 'eval' && Array.isArray(s.value)).map((s) => s.value);
      assert.equal(atFar[0], atFar[1], `the element shot waited for the scroll (${far.ms} ms)`);
      assert.equal(atScaled[0], atScaled[1], `the scaled shot waited for the scroll (${scaled.ms} ms)`);
      assert.deepEqual(pixel(decodePng(readFileSync(far.file)), 10, 10), [0, 128, 0, 255]);
      assert.ok(faded.ms >= 400, `waited for the transition (${faded.ms} ms)`);
      assert.deepEqual(pixel(decodePng(readFileSync(faded.file)), 200, 100), [0, 0, 255, 255], 'the transition had ended');
      assert.ok(slid.ms >= 300, `waited for the animation (${slid.ms} ms)`);
      assert.deepEqual(pixel(decodePng(readFileSync(slid.file)), 350, 250), [255, 0, 0, 255], 'the animation had ended');
      const [y, farTop] = r.steps.find((s) => s.action === 'eval' && Array.isArray(s.value)).value;
      assert.equal(y, farTop, 'the smooth scroll had ended at #far');
      assert.deepEqual(pixel(decodePng(readFileSync(scrolled.file)), 200, 50), [0, 128, 0, 255], 'and the shot shows it');
      for (const s of [faded, slid, scrolled, far, scaled]) assert.equal(s.note, undefined);
    });

    it('a screenshot with "still": false is taken at once; endless animations are named for baselines', async () => {
      const baselines = { dir: join(out, 'baselines-motion'), update: 'missing' };
      const r = await run(
        {
          url: 'motion.html',
          viewport: { size: '400x300' },
          steps: [
            { click: { selector: '#toggle' } },
            { screenshot: 'at-once', still: false },
            { eval: "document.querySelector('#spinner').classList.add('on'); 1" },
            { screenshot: 'spinning', selector: '#panel', baseline: true },
            { eval: "document.querySelector('#toggle').click(); 1" },
            { screenshot: 'cut-short', still: 100 },
          ],
        },
        { baselines },
      );
      assert.ok(r.ok, failed(r));
      const [atOnce, spinning, cutShort] = r.steps.filter((s) => s.file);
      assert.ok(atOnce.ms < 300, `no wait (${atOnce.ms} ms)`);
      const mid = pixel(decodePng(readFileSync(atOnce.file)), 200, 100);
      assert.notDeepEqual(mid, [0, 0, 255, 255], 'taken while the transition ran');
      assert.match(spinning.note, /^never stops: div#spinner\.on: spin \(emulate reducedMotion/);
      assert.match(cutShort.note, /^still moving when the wait ran out: div#panel: background-color$/);
    });

    it('a failing step stops the run and says why', async () => {
      const r = await run({ url: 'form.html', steps: [{ click: { selector: '#nope' } }, { key: 'a' }] });
      assert.equal(r.ok, false);
      assert.equal(r.steps.length, 1);
      assert.match(r.steps[0].error, /no element matches #nope/);
    });

    it('a waitFor that never comes true times out', async () => {
      const r = await run({ url: 'form.html', steps: [{ waitFor: 'window.never', timeout: 200 }] });
      assert.equal(r.ok, false);
      assert.match(r.steps[0].error, /"window.never" wasn't truthy after 200 ms/);
    });

    it('uncaught exceptions and HTTP errors fail the run', async () => {
      const thrown = await run({ url: 'form.html', steps: [{ eval: "setTimeout(() => { throw new Error('boom') }); 1" }, { wait: 50 }] });
      assert.equal(thrown.ok, false);
      assert.match(thrown.errors.join(), /uncaught Error: boom/);
      const missing = await run({ url: 'missing.html' });
      assert.equal(missing.ok, false);
      assert.match(missing.errors.join(), /HTTP 404/);
    });

    it('a ready expression, and a page that never gets ready', async () => {
      const ok = await run({ url: 'form.html', ready: "document.getElementById('list').children.length === 50" });
      assert.ok(ok.ok, failed(ok));
      assert.match(ok.ready.by, /^ready:/);
      const never = await run({ url: 'form.html', ready: 'window.notThere.at', timeout: 300 });
      assert.equal(never.ok, false);
      assert.match(never.errors[0], /not ready after 300 ms: "window.notThere.at" wasn't truthy \(last error: TypeError/);
      const title = await run({ url: 'form.html', readyTitle: 'form' });
      assert.ok(title.ok, failed(title));
    });

    it('a server that isn\'t there', async () => {
      // A port that was free a moment ago.
      const gone = await serve(FIXTURES);
      await gone.close();
      const r = await runScenario(browser, { url: gone.url }, { outDir: out });
      assert.equal(r.ok, false);
      assert.match(r.errors[0], /ERR_CONNECTION_REFUSED/);
    });

    it('pages elsewhere need --allow-host', async () => {
      await assert.rejects(runScenario(browser, { url: 'https://example.com/' }), /allow it with --allow-host/);
    });
  });

  describe('a 2D canvas app', () => {
    const scenario = {
      url: 'canvas.html',
      ready: 'app.ready',
      steps: [
        { drag: { from: { selector: 'canvas', offset: [50, 50] }, to: { selector: 'canvas', offset: [350, 50] } } },
        { key: 'g' },
        { drag: [70, 220, 370, 220] },
        { wheel: [200, 150, -100] },
        { eval: '[app.strokes.length, app.strokes.map((s) => s.color), app.strokes[0].points.length, app.zoom]' },
        { screenshot: 'canvas-from', from: "document.querySelector('canvas')" },
        { screenshot: 'canvas-shot', selector: 'canvas' },
      ],
    };

    it('drags draw, keys pick colors, the wheel zooms', async () => {
      const r = await run(scenario);
      assert.ok(r.ok, failed(r));
      const [[strokes, colors, points, zoom]] = values(r);
      assert.equal(strokes, 2);
      assert.deepEqual(colors, ['#e00000', '#00c000']);
      assert.equal(points, 9); // the press and 8 moves
      assert.equal(zoom, 1.25);
    });

    it('reads the canvas itself, and the browser\'s view of it', async () => {
      await run(scenario);
      const own = decodePng(readFileSync(join(out, 'canvas-from.png')));
      const shot = decodePng(readFileSync(join(out, 'canvas-shot.png')));
      assert.deepEqual([own.width, own.height], [400, 300]);
      assert.deepEqual([shot.width, shot.height], [400, 300]);
      // Zoomed 1.25: the red line at y 50 is drawn at 62.5, the green one at 200 × 1.25 = 250.
      assert.deepEqual(pixel(own, 200, 62), [224, 0, 0, 255]);
      assert.deepEqual(pixel(own, 300, 250), [0, 192, 0, 255]);
      assert.deepEqual(pixel(own, 10, 10), [255, 255, 255, 255]);
      assert.ok(diffImages(own, shot).pass, 'the canvas and the screenshot of it agree');
    });

    it('a touch drag draws with pointerType touch', async () => {
      const r = await run({
        url: 'canvas.html',
        ready: 'app.ready',
        viewport: { size: '600x400', mobile: true },
        steps: [{ swipe: [70, 70, 270, 120] }, { tap: [100, 200] }, { eval: 'app.strokes.map((s) => [s.type, s.points.length > 1])' }],
      });
      assert.ok(r.ok, failed(r));
      assert.deepEqual(values(r)[0], [['touch', true], ['touch', false]]);
    });

    it('the same steps give the same pixels, run after run', async () => {
      await run(scenario);
      const first = decodePng(readFileSync(join(out, 'canvas-shot.png')));
      await run(scenario);
      const second = decodePng(readFileSync(join(out, 'canvas-shot.png')));
      const d = diffImages(first, second);
      assert.ok(d.pass, d.failures.join());
    });
  });

  describe('WebGL', () => {
    it('the browser\'s screenshot sees what WebGL drew; a click redraws', async () => {
      const r = await run({
        url: 'webgl.html',
        ready: 'app.ready || app.error',
        steps: [{ eval: 'app.error' }, { screenshot: 'gl-1', selector: 'canvas' }, { click: { selector: 'canvas', offset: [5, 5] } }, { frames: 2 }, { screenshot: 'gl-2', selector: 'canvas' }],
      });
      assert.ok(r.ok, failed(r));
      assert.equal(values(r)[0], null, 'WebGL is available');
      const one = decodePng(readFileSync(join(out, 'gl-1.png')));
      const two = decodePng(readFileSync(join(out, 'gl-2.png')));
      assert.deepEqual(pixel(one, 5, 5), [0, 0, 255, 255]);
      assert.deepEqual(pixel(one, 100, 110), [255, 255, 0, 255]);
      assert.deepEqual(pixel(two, 5, 5), [0, 255, 0, 255]);
      assert.deepEqual(pixel(two, 100, 110), [255, 255, 0, 255]);
    });
  });

  describe('expectations', () => {
    it('pass, fail without stopping the run, and wait for slow pages', async () => {
      const r = await run({
        url: 'form.html',
        steps: [
          { expect: "document.getElementById('count').textContent", equals: '0' },
          { expect: "document.getElementById('count').textContent", equals: '5', timeout: 100 },
          { click: { selector: '#count' } },
          { expect: "document.getElementById('count').textContent", equals: '1' },
          { eval: "setTimeout(() => document.getElementById('greeting').textContent = 'later', 300); 1" },
          { expect: "document.getElementById('greeting').textContent", matches: '^later$' },
          { expect: 'document.querySelector("header").getBoundingClientRect().height', atLeast: 20 },
          { expect: 'window.nothing.here', timeout: 50 },
        ],
      });
      assert.equal(r.ok, false);
      assert.deepEqual(r.steps.map((s) => s.ok), [true, false, true, true, true, true, true, false]);
      assert.equal(r.steps[1].label, "expect document.getElementById('count').textContent equals \"5\"");
      assert.match(r.steps[1].error, /expected "5", got "0"/);
      assert.equal(r.steps[1].value, '0');
      assert.ok(r.steps[5].ms >= 200, `waited ${r.steps[5].ms} ms for the slow change`);
      assert.match(r.steps[7].error, /TypeError: Cannot read properties of undefined/);
    });

    it('a failed action still stops the run', async () => {
      const r = await run({ url: 'form.html', steps: [{ click: { selector: '#nope' } }, { expect: '1' }] });
      assert.equal(r.steps.length, 1);
    });
  });

  describe('baselines', () => {
    it('written, matched, then a change fails with a difference image', async () => {
      const baselines = { dir: join(out, 'baselines'), update: 'missing' };
      const scenario = (count) => ({
        url: 'canvas.html',
        ready: 'app.ready',
        steps: [{ drag: [70, 70, 270, 70] }, ...(count === 2 ? [{ drag: [70, 120, 270, 120] }] : []), { screenshot: 'drawn', selector: 'canvas', baseline: true }, { eval: 'app.strokes.length' }],
      });
      const first = await run(scenario(1), { baselines });
      assert.ok(first.ok, failed(first));
      assert.equal(first.steps.at(-2).baseline, 'new');
      const again = await run(scenario(1), { baselines });
      assert.ok(again.ok, failed(again));
      assert.equal(again.steps.at(-2).baseline, 'match');
      const changed = await run(scenario(2), { baselines });
      assert.equal(changed.ok, false);
      const shot = changed.steps.at(-2);
      assert.equal(shot.baseline, 'differs');
      assert.match(shot.error, /differs from .*drawn\.png: \d+ pixels differ by more than 2 \(up to 255\)/);
      assert.ok(shot.diff.endsWith('drawn.diff.png'));
      assert.equal(changed.steps.at(-1).value, 2, 'the step after a differing baseline still ran');
    });

    it('a new baseline waits for the page to stop changing (a transition running)', async () => {
      const baselines = { dir: join(out, 'baselines-settle'), update: 'missing' };
      const r = await run(
        {
          url: 'form.html',
          steps: [
            { eval: "document.body.style.transition = 'background-color 600ms linear'; requestAnimationFrame(() => document.body.style.backgroundColor = 'rgb(0, 0, 255)'); 1" },
            { screenshot: 'settled', baseline: true },
          ],
        },
        { baselines },
      );
      assert.ok(r.ok, failed(r));
      assert.ok(r.steps[1].ms >= 400, `it waited for the transition (${r.steps[1].ms} ms)`);
      const img = decodePng(readFileSync(join(baselines.dir, 'settled.png')));
      assert.deepEqual(pixel(img, 5, 700), [0, 0, 255, 255], 'the baseline is the end of the transition');
    });

    it('by default a baseline allows 2 of 255 (invisible); {"max": 0} is exact', async () => {
      const baselines = { dir: join(out, 'baselines-tolerance'), update: 'missing' };
      const shot = (color, tolerance) => run({ url: 'form.html', steps: [{ eval: `document.body.style.background = '${color}'; 1` }, { screenshot: 'bg', baseline: true, ...(tolerance ? { tolerance } : {}) }] }, { baselines });
      assert.ok((await shot('rgb(200, 200, 200)')).ok);
      assert.ok((await shot('rgb(201, 199, 200)')).ok, 'off by 1: passes');
      const off = await shot('rgb(206, 200, 200)');
      assert.equal(off.ok, false, 'off by 6: fails');
      assert.match(off.steps[1].error, /pixels differ by more than 2 \(up to 6\)/);
      assert.equal((await shot('rgb(201, 200, 200)', { max: 0 })).ok, false, 'exact when asked');
    });

    it('a page with errors (a 404) never becomes a baseline, even with update', async () => {
      const dir = join(out, 'baselines-unfit');
      const shot = (url, update) => run({ url, steps: [{ screenshot: 'page', baseline: true }] }, { baselines: { dir, update } });
      const missing = await shot('nope.html', 'missing');
      assert.equal(missing.ok, false);
      assert.match(missing.steps[0].error, /no baseline .*page\.png, and none made from a page with errors \(the page answered HTTP 404/);
      assert.equal(existsSync(join(dir, 'page.png')), false);
      assert.ok((await shot('form.html', 'missing')).ok);
      const good = readFileSync(join(dir, 'page.png'));
      const updated = await shot('nope.html', 'all');
      assert.equal(updated.ok, false);
      assert.match(updated.steps[0].error, /; not replaced: the page has errors \(the page answered HTTP 404/);
      assert.ok(readFileSync(join(dir, 'page.png')).equals(good), 'the good baseline is kept');
    });

    it('a baseline step without a baseline folder says so', async () => {
      const r = await run({ url: 'form.html', steps: [{ screenshot: 'x', baseline: true }] });
      assert.equal(r.ok, false);
      assert.match(r.steps[0].error, /no baseline folder/);
    });
  });

  describe('JS scenarios', () => {
    it('page methods, expect helpers, steps and screenshots, all in the report', async () => {
      const r = await run({
        url: 'form.html',
        viewport: { size: '393x852', mobile: true },
        run: async ({ page, expect, step, screenshot }) => {
          await page.tap({ selector: '#count' });
          expect.equal(await page.eval("document.getElementById('count').textContent"), '1', 'a tap counts');
          expect.near(await page.eval('innerWidth'), 393, 0, 'phone width');
          expect.matches('Signed in', /^Signed/);
          expect.ok(false, 'this one fails');
          await step({ type: 'x' });
          await screenshot('phone');
        },
      });
      assert.equal(r.ok, false);
      assert.deepEqual(r.steps.map((s) => [s.label, s.ok]), [['a tap counts', true], ['phone width', true], ['expect matches /^Signed/', true], ['this one fails', false], ['type "x"', true], ['screenshot phone', true]]);
    });

    it('an exception in the script stops it and says where', async () => {
      const file = join(out, 'boom.check.mjs');
      const r = await run({ url: 'form.html', run: async () => { throw new Error('nope'); } }, { file });
      assert.equal(r.ok, false);
      assert.match(r.steps[0].error, /^nope/);
    });
  });

  describe('the page API', () => {
    it('one Chrome, several pages at once', async () => {
      const pages = await Promise.all([browser.newPage(), browser.newPage({ size: '320x480' })]);
      try {
        await Promise.all(pages.map((p) => p.goto(`${server.url}form.html`)));
        assert.deepEqual(await Promise.all(pages.map((p) => p.eval('innerWidth'))), [1280, 320]);
        await pages[0].click({ selector: '#count' });
        assert.deepEqual(await Promise.all(pages.map((p) => p.eval("document.getElementById('count').textContent"))), ['1', '0']);
      } finally {
        await Promise.all(pages.map((p) => p.close()));
      }
    });

    it('the port fallback (BROKIT_CHROME_TRANSPORT=port) works too', async () => {
      const viaPort = await launch({ transport: 'port', gpu: 'software' });
      try {
        const r = await runScenario(viaPort, { url: 'form.html', steps: [{ click: { selector: '#count' } }, { expect: "document.getElementById('count').textContent", equals: '1' }] }, { base: server.url, outDir: out });
        assert.ok(r.ok, failed(r));
      } finally {
        await viaPort.close();
      }
      await assert.rejects(launch({ transport: 'carrier-pigeon' }), /transport: "pipe" or "port"/);
    });

    it('rect, frames, a CPU profile', async () => {
      const page = await browser.newPage();
      try {
        await page.startProfile();
        await page.goto(`${server.url}canvas.html`, { ready: 'app.ready' });
        assert.deepEqual(await page.rect('canvas'), { x: 20, y: 20, width: 400, height: 300 });
        assert.equal(await page.frames(3), true);
        const profile = await page.stopProfile();
        assert.ok(profile.nodes.length > 1 && profile.samples.length > 0);
      } finally {
        await page.close();
      }
    });
  });
});
