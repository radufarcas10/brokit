// A page (a tab) in Chrome: go to a URL, wait until it's ready, give it real input, read
// from it, and take screenshots. What the page logs, throws and fails to load is kept.
//
// Input goes through Chrome's input pipeline, as a user's would: real mouse, wheel, key,
// touch and input-method events, which the page can't tell apart from a person's.
// After each input the page gets a frame (see `settle`), so what the input changed has
// been drawn before the next step looks.
//
// A point is [x, y] in CSS pixels from the viewport's top left, {"selector": "css"} (the
// element's center, scrolled into view if it's outside; "offset": [x, y] for a point from
// its top left instead), or a JS expression the page evaluates to [x, y].

import { decodePng, encodePng, MAX_PIXELS } from './png.mjs';
import { parseKey } from './keys.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_LOG = 1000; // entries kept per list
const MAX_DRAWN = 8192; // device pixels Chrome draws each way in one capture beyond the viewport
const STRIP = 4096; // device pixels per strip, for pages taller than that
const MAX_TEXT = 4000; // characters kept per entry

export class Page {
  #c;
  #session;
  #targetId;
  #onClose;
  #off;
  #loaded = 0; // when the load event came (0: not yet)
  #inflight = new Set();
  #netChange = 0;
  #buttons = 0;
  #touch = false;
  #viewport = { width: 1280, height: 800, dpr: 1, mobile: false };
  #media = {}; // emulated media features, e.g. { 'prefers-color-scheme': 'dark' }
  #navigated = false; // whether a page has been opened (before, there's nothing to redraw)
  #scrollbarsHidden = false; // as a phone (see emulate)

  /** What the page logged: { type, text } (console calls, and Chrome's own warnings and errors). */
  console = [];
  /** What went wrong: uncaught exceptions, failed loads, the main page's HTTP errors. */
  errors = [];
  /** Whether input waits a frame before the next step (default true). */
  settle = true;

  constructor(connection, sessionId, targetId, onClose) {
    this.#c = connection;
    this.#session = sessionId;
    this.#targetId = targetId;
    this.#onClose = onClose;
    this.#off = connection.on(sessionId, (method, params) => this.#event(method, params));
  }

  /** A DevTools Protocol call on this page, for anything brokit has no method for. */
  send(method, params = {}, timeout) {
    return this.#c.send(method, params, this.#session, timeout);
  }

  async init({ size, dpr = 1, mobile = false, colorScheme, reducedMotion } = {}) {
    await Promise.all([this.send('Runtime.enable'), this.send('Log.enable'), this.send('Page.enable'), this.send('Network.enable')]);
    await this.emulate({ size: size ?? [1280, 800], dpr, mobile, colorScheme, reducedMotion });
  }

  #event(method, p) {
    const log = (list, entry) => {
      if (list.length < MAX_LOG) list.push(entry);
      else if (list.length === MAX_LOG) list.push(typeof entry === 'string' ? '… (more not kept)' : { type: 'info', text: '… (more not kept)' });
    };
    const clip = (s) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s);
    if (method === 'Runtime.consoleAPICalled') {
      const text = p.args.map((a) => (a.type === 'string' ? a.value : a.value !== undefined ? JSON.stringify(a.value) : a.unserializableValue ?? a.description ?? a.type)).join(' ');
      log(this.console, { type: p.type, text: clip(text) });
    } else if (method === 'Runtime.exceptionThrown') {
      const d = p.exceptionDetails;
      log(this.errors, clip(`uncaught ${d.exception?.description ?? d.text}`));
    } else if (method === 'Log.entryAdded') {
      // Chrome asks every site for /favicon.ico on its own; a page without one isn't wrong.
      const ownFavicon = p.entry.source === 'network' && /^https?:\/\/[^/]+\/favicon\.ico$/.test(p.entry.url ?? '');
      if ((p.entry.level === 'error' || p.entry.level === 'warning') && !ownFavicon) log(this.console, { type: p.entry.level, text: clip(`${p.entry.text}${p.entry.url ? ` (${p.entry.url})` : ''}`) });
    } else if (method === 'Page.loadEventFired') this.#loaded = Date.now();
    else if (method === 'Network.requestWillBeSent') {
      this.#inflight.add(p.requestId);
      this.#netChange = Date.now();
    } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
      this.#inflight.delete(p.requestId);
      this.#netChange = Date.now();
    } else if (method === 'Network.responseReceived') {
      // The page itself (its top frame's document; the top frame's id is the tab's). This
      // can come before Page.navigate answers.
      if (p.type === 'Document' && p.frameId === this.#targetId && p.response.status >= 400) {
        log(this.errors, `the page answered HTTP ${p.response.status} ${p.response.statusText}`.trim());
      }
    }
  }

  /**
   * Go to `url` and wait until the page is ready:
   *   ready: "expression"   until it's truthy (awaited if it's a promise)
   *   readyTitle: "title"   until document.title is that
   *   (neither)             the load event, then no network requests for `idle` ms
   *                         (a page that never goes quiet is taken as ready 5 s after load)
   * Then, either way, until its fonts are loaded and it has drawn two frames, so what's
   * on screen is the page as it settled, not a first, partial paint.
   * Resolves to { by, ms, note? }. Throws if the page can't be reached or isn't ready in
   * `timeout` ms.
   */
  async goto(url, options = {}) {
    const start = Date.now();
    const result = await this.#ready(url, options);
    await this.eval('document.fonts ? document.fonts.ready.then(() => true) : true').catch(() => {});
    await this.frames(2);
    this.#navigated = true;
    return { ...result, ms: Date.now() - start };
  }

  async #ready(url, { ready, readyTitle, timeout = 30000, idle = 500 } = {}) {
    const start = Date.now();
    this.#loaded = 0;
    this.#inflight.clear();
    const nav = await this.send('Page.navigate', { url });
    if (nav.errorText) throw new Error(`couldn't load ${url}: ${nav.errorText}`);
    let lastError = null;
    for (;;) {
      if (ready) {
        try {
          if (await this.#truthy(ready)) return { by: `ready: ${ready}`, ms: Date.now() - start };
          lastError = null;
        } catch (e) {
          lastError = e.message;
        }
      } else if (readyTitle !== undefined) {
        if ((await this.title()) === readyTitle) return { by: `title "${readyTitle}"`, ms: Date.now() - start };
      } else if (this.#loaded) {
        if (!this.#inflight.size && Date.now() - this.#netChange >= idle) return { by: 'load + network idle', ms: Date.now() - start };
        if (Date.now() - this.#loaded > 5000) {
          return { by: 'load', ms: Date.now() - start, note: `the network never went quiet (${this.#inflight.size} requests open); give "ready" for a better signal` };
        }
      }
      if (Date.now() - start > timeout) {
        const what = ready ? `"${ready}" wasn't truthy${lastError ? ` (last error: ${lastError})` : ''}` : readyTitle !== undefined ? `the title was "${await this.title().catch(() => '?')}", not "${readyTitle}"` : 'it never loaded';
        throw new Error(`not ready after ${timeout} ms: ${what}`);
      }
      await sleep(25);
    }
  }

  /** document.title. */
  async title() {
    return this.eval('document.title');
  }

  /** Evaluate a JS expression in the page (awaited if it's a promise); its value, as JSON allows. */
  async eval(expression, { timeout } = {}) {
    if (typeof expression !== 'string') throw new Error('eval: a JS expression, as a string');
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  // Whether an expression is truthy, without bringing its value over (it may be an object).
  async #truthy(expression) {
    return this.eval(`(async () => Boolean(await (\n${expression}\n)))()`);
  }

  /** Where an element is: { x, y, width, height } in CSS pixels from the viewport's top left. */
  async rect(selector) {
    return this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('no element matches ' + ${JSON.stringify(selector)});
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()`);
  }

  /** A point (see the top of this file) as [x, y]. */
  async point(p) {
    if (typeof p === 'string') p = await this.eval(p);
    else if (p && typeof p === 'object' && !Array.isArray(p)) {
      if (typeof p.selector !== 'string') throw new Error(`point: [x, y], {"selector": "..."} or an expression; got ${JSON.stringify(p)}`);
      if (p.offset !== undefined && !isPoint(p.offset)) throw new Error('offset: [x, y]');
      p = await this.eval(`((sel, offset) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error('no element matches ' + sel);
        let r = el.getBoundingClientRect();
        if (!r.width && !r.height) throw new Error(sel + ' has no size (hidden?)');
        const at = () => (offset ? [r.left + offset[0], r.top + offset[1]] : [r.left + r.width / 2, r.top + r.height / 2]);
        let [x, y] = at();
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
          el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
          r = el.getBoundingClientRect();
          [x, y] = at();
        }
        return [x, y];
      })(${JSON.stringify(p.selector)}, ${JSON.stringify(p.offset ?? null)})`);
    }
    if (!isPoint(p)) throw new Error(`point: expected [x, y], got ${JSON.stringify(p)}`);
    return p;
  }

  #mouse(type, [x, y], extra = {}) {
    return this.send('Input.dispatchMouseEvent', { type, x, y, button: 'none', buttons: this.#buttons, ...extra });
  }

  /** Move the mouse to a point. */
  async move(p) {
    await this.#mouse('mouseMoved', await this.point(p));
    await this.#settled();
  }

  /** Click: button "left" (default), "right" or "middle"; count 2 for a double click; modifiers. */
  async click(p, { button = 'left', count = 1, ...mods } = {}) {
    const bit = { left: 1, right: 2, middle: 4 }[button];
    if (!bit) throw new Error('button: left, right or middle');
    const at = await this.point(p);
    const modifiers = modifierBits(mods);
    await this.#mouse('mouseMoved', at, { modifiers });
    for (let clickCount = 1; clickCount <= count; clickCount++) {
      await this.#mouse('mousePressed', at, { button, buttons: this.#buttons | bit, clickCount, modifiers });
      await this.#mouse('mouseReleased', at, { button, buttons: this.#buttons, clickCount, modifiers });
    }
    await this.#settled();
  }

  /** A double click. */
  dblclick(p, mods = {}) {
    return this.click(p, { ...mods, count: 2 });
  }

  /** Press the left button at `from`, move to `to` in `steps` moves, release. */
  async drag(from, to, { steps = 8, ...mods } = {}) {
    const [a, b] = [await this.point(from), await this.point(to)];
    const modifiers = modifierBits(mods);
    await this.#mouse('mouseMoved', a, { modifiers });
    this.#buttons = 1;
    try {
      await this.#mouse('mousePressed', a, { button: 'left', clickCount: 1, modifiers });
      for (let k = 1; k <= steps; k++) await this.#mouse('mouseMoved', lerp(a, b, k / steps), { modifiers });
    } finally {
      this.#buttons = 0;
      await this.#mouse('mouseReleased', b, { button: 'left', clickCount: 1, modifiers });
    }
    await this.#settled();
  }

  /** Turn the wheel at a point: dy down (positive) or up, dx sideways (a trackpad's). */
  async wheel(p, { dx = 0, dy = 0, ...mods } = {}) {
    await this.#mouse('mouseWheel', await this.point(p), { deltaX: dx, deltaY: dy, modifiers: modifierBits(mods) });
    await this.#settled();
  }

  /** Press and release a key ("Enter", "a", "Ctrl+Shift+Z"; see keys.mjs), holding any modifiers. */
  async key(spec, mods = {}) {
    const k = parseKey(spec, mods);
    let held = 0;
    const event = (type, key, modifiers) =>
      this.send('Input.dispatchKeyEvent', {
        type,
        key: key.key,
        code: key.code,
        windowsVirtualKeyCode: key.keyCode,
        nativeVirtualKeyCode: key.keyCode,
        modifiers,
        ...(type === 'keyDown' ? { text: key.text, unmodifiedText: key.text } : {}),
        ...(type !== 'keyUp' && key.commands ? { commands: key.commands } : {}),
      });
    for (const m of k.modifierKeys) {
      held |= MODIFIER_BITS[m.key];
      await event('rawKeyDown', m, held);
    }
    await event(k.text ? 'keyDown' : 'rawKeyDown', k, k.modifiers);
    await event('keyUp', k, k.modifiers);
    for (const m of k.modifierKeys.reverse()) {
      held &= ~MODIFIER_BITS[m.key];
      await event('keyUp', m, held);
    }
    await this.#settled();
  }

  /**
   * Type text. By default as one insertion (as an input method's commit or a paste does: an
   * `input` event, no key events); `perKey: true` presses a key for each character instead.
   */
  async type(text, { perKey = false } = {}) {
    if (typeof text !== 'string') throw new Error('type: a string');
    if (perKey) {
      const was = this.settle;
      this.settle = false;
      try {
        for (const ch of text) await this.key(ch === '\n' ? 'Enter' : ch);
      } finally {
        this.settle = was;
      }
    } else await this.send('Input.insertText', { text });
    await this.#settled();
  }

  /**
   * An input method composing `text` (shown underlined, not committed), with the caret at
   * `caret` (default: its end). Commit with type(), cancel with ime("").
   */
  async ime(text, caret = [...text].length) {
    await this.send('Input.imeSetComposition', { text, selectionStart: caret, selectionEnd: caret });
    await this.#settled();
  }

  async #touchOn() {
    if (this.#touch) return;
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    this.#touch = true;
  }

  /** A finger: down and up at a point. */
  async tap(p) {
    await this.#touchOn();
    const [x, y] = await this.point(p);
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await this.#settled();
  }

  /** A finger dragged from one point to another over about `ms` (a move every 16 ms), then lifted. */
  async swipe(from, to, { ms = 120 } = {}) {
    await this.#touchOn();
    const [a, b] = [await this.point(from), await this.point(to)];
    const steps = Math.max(1, Math.round(ms / 16));
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a[0], y: a[1] }] });
    for (let k = 1; k <= steps; k++) {
      await sleep(16);
      const [x, y] = lerp(a, b, k / steps);
      await this.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    }
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await this.#settled();
  }

  /**
   * The screen, as DevTools' device mode sets it: size ("393x852" or [w, h]), dpr (device
   * pixels per CSS pixel), mobile (a phone's viewport and touch), scale (the page drawn
   * smaller, as device mode's "fit to window"). And the user's settings, as CSS media
   * queries see them: colorScheme ("light" or "dark"), reducedMotion ("reduce" or
   * "no-preference"). What's left out stays as it was.
   */
  async emulate({ size, dpr, mobile, scale, colorScheme, reducedMotion } = {}) {
    if (colorScheme !== undefined || reducedMotion !== undefined) {
      if (colorScheme !== undefined && !['light', 'dark'].includes(colorScheme)) throw new Error('colorScheme: "light" or "dark"');
      if (reducedMotion !== undefined && !['reduce', 'no-preference'].includes(reducedMotion)) throw new Error('reducedMotion: "reduce" or "no-preference"');
      if (colorScheme !== undefined) this.#media['prefers-color-scheme'] = colorScheme;
      if (reducedMotion !== undefined) this.#media['prefers-reduced-motion'] = reducedMotion;
      await this.send('Emulation.setEmulatedMedia', { features: Object.entries(this.#media).map(([name, value]) => ({ name, value })) });
    }
    const v = this.#viewport;
    if (size !== undefined) [v.width, v.height] = parseSize(size);
    if (dpr !== undefined) {
      if (!(typeof dpr === 'number' && dpr > 0 && dpr <= 10)) throw new Error('dpr: a number from 0 to 10');
      v.dpr = dpr;
    }
    if (mobile !== undefined) v.mobile = Boolean(mobile);
    if (scale !== undefined && !(typeof scale === 'number' && scale > 0 && scale <= 10)) throw new Error('scale: a number from 0 to 10');
    // A phone's scrollbar is an overlay that shows for a moment after any scroll and fades:
    // no part of the page or its layout, only noise in screenshots (whether it's still
    // showing depends on timing), so it's hidden. A desktop's takes room in the layout, so
    // it stays; and since unhiding alone doesn't reliably bring it back (the page then
    // lays out 15 px wider, now and then), leaving phone mode clears the emulation first.
    if (v.mobile !== this.#scrollbarsHidden) {
      await this.send('Emulation.setScrollbarsHidden', { hidden: v.mobile });
      if (!v.mobile) await this.send('Emulation.clearDeviceMetricsOverride');
      this.#scrollbarsHidden = v.mobile;
    }
    await this.send('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: v.dpr, mobile: v.mobile, ...(scale ? { scale } : {}) });
    if (v.mobile) await this.#touchOn();
    // A new size or new colors: the page lays out and paints again over a few frames.
    if (this.#navigated && this.settle) await this.frames(3);
  }

  /** The current screen: { width, height, dpr, mobile }. */
  get viewport() {
    return { ...this.#viewport };
  }

  /** A phone's notch and bars, as env(safe-area-inset-*) sees them (with viewport-fit=cover). */
  async safeArea([top, right, bottom, left]) {
    await this.send('Emulation.setSafeAreaInsetsOverride', { insets: { top, right, bottom, left } });
    await this.#settled();
  }

  /** Wait `ms` milliseconds. Prefer frames() or waitFor(): they wait for what matters. */
  wait(ms) {
    return sleep(ms);
  }

  /** Wait for the page's next `n` frames. False if none came (a page that isn't drawing). */
  frames(n = 1) {
    return this.eval(`new Promise((done) => {
      let left = ${Number(n)};
      const tick = () => (--left > 0 ? requestAnimationFrame(tick) : done(true));
      requestAnimationFrame(tick);
      setTimeout(() => done(false), ${1000 + 100 * Number(n)});
    })`);
  }

  async #settled() {
    if (this.settle) await this.frames(1);
  }

  /** Wait until an expression is truthy (awaited if it's a promise); throws after `timeout` ms. */
  async waitFor(expression, { timeout = 10000 } = {}) {
    const start = Date.now();
    let lastError = null;
    for (;;) {
      try {
        if (await this.#truthy(expression)) return Date.now() - start;
        lastError = null;
      } catch (e) {
        lastError = e.message;
      }
      if (Date.now() - start > timeout) throw new Error(`"${expression}" wasn't truthy after ${timeout} ms${lastError ? ` (last error: ${lastError})` : ''}`);
      await sleep(25);
    }
  }

  /**
   * Wait until the page is still: no animation or transition with an end running (CSS
   * animations and transitions, Web Animations; their delays count) and nothing scrolling
   * (smooth scrolling), checked once a frame, for up to
   * `timeout` ms (`scrolling: true`: a scroll is known to be under way). Endless animations (a spinner, a blinking caret) can't be waited out,
   * and aren't; nor can what a page draws in its own requestAnimationFrame loop. Resolves
   * to { ms, moving, endless }: what still moved when the time ran out, and what never
   * ends, as short descriptions ("div.toast: fade-in").
   */
  async still({ timeout = 5000, scrolling = false } = {}) {
    return this.eval(`new Promise((done) => {
      ${MOTION}
      const start = performance.now();
      let scrolls = 0, quiet = 0, moved = false, over = false;
      // A scroll is over at its scrollend, or (where that never comes) once no scroll event
      // has come for 200 ms: frames alone don't tell, as Chrome may run two in a row
      // without moving a smooth scroll (right after a screenshot, for one).
      let lastScroll = ${scrolling ? 'start' : '-Infinity'};
      const onScroll = () => {
        scrolls++;
        lastScroll = performance.now();
      };
      const onScrollEnd = () => (lastScroll = -Infinity);
      addEventListener('scroll', onScroll, { capture: true, passive: true });
      addEventListener('scrollend', onScrollEnd, { capture: true, passive: true });
      const finish = (moving) => {
        if (over) return;
        over = true;
        removeEventListener('scroll', onScroll, { capture: true });
        removeEventListener('scrollend', onScrollEnd, { capture: true });
        const endless = document.getAnimations().filter((a) => timed(a) && !ends(a)).map(what);
        done({ ms: Math.round(performance.now() - start), moving, endless });
      };
      // Once a frame. Still once a frame has passed with nothing moving; after motion, two
      // (the last step drawn, then a frame with none).
      const tick = () => {
        const moving = document.getAnimations().filter((a) => timed(a) && ends(a));
        const scrolled = scrolls > 0 || performance.now() - lastScroll < 200;
        scrolls = 0;
        if (moving.length || scrolled) [moved, quiet] = [true, 0];
        else quiet++;
        if (quiet >= (moved ? 2 : 1)) return finish([]);
        if (performance.now() - start >= ${Number(timeout)}) return finish([...moving.map(what), ...(scrolled ? ['scrolling'] : [])]);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      // A page that draws no frames isn't moving either.
      setTimeout(() => finish([]), ${Number(timeout) + 1000});
    })`);
  }

  /**
   * A PNG screenshot: { png (bytes), width, height } in device pixels, of the page once
   * it's still (see still()): `still: false` takes it at once, a number waits up to that
   * many ms (5000). With `still`, it also has { moving, endless } when there were any.
   *   (nothing)           the viewport, as the browser shows it
   *   selector: "css"     just that element
   *   fullPage: true      the whole page, beyond the viewport
   *   scale: 0.5          drawn that much smaller (a 3x phone seen on a 1x monitor: 0.333)
   *   from: "expression"  what the page itself gives: a canvas (an OffscreenCanvas,
   *                       ImageData), a PNG data URL, or {width, height, base64} of RGBA
   *                       pixels. A WebGL canvas reads back empty unless it was made with
   *                       preserveDrawingBuffer; use selector for one. Taken at once.
   */
  async screenshot({ selector, fullPage = false, scale, from, still = true } = {}) {
    if (from !== undefined) return this.#pagePixels(from);
    if (still === false) return this.#capture({ selector, fullPage, scale });
    // Most pages are still already, and waiting a frame to see that costs one, so: no
    // animation running now? Then take the shot, watching for scrolling while it's taken,
    // and only if something moved, wait until it's still and take it again.
    const wait = async (scrolling = false) => {
      const { moving, endless } = await this.still({ scrolling, ...(typeof still === 'number' ? { timeout: still } : {}) });
      return { ...(moving.length ? { moving } : {}), ...(endless.length ? { endless } : {}) };
    };
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression: WATCH_MOTION, objectGroup: 'brokit-still' });
    let seen = { scrolled: false };
    try {
      if (!exceptionDetails && result.subtype !== 'null') {
        const shot = await this.#capture({ selector, fullPage, scale }, async () => {
          const r = await this.send('Runtime.callFunctionOn', { objectId: result.objectId, functionDeclaration: 'function () { return this.stop(); }', returnByValue: true });
          seen = r.exceptionDetails ? { animating: true, scrolled: false, endless: [] } : r.result.value;
        });
        if (shot && !seen.animating && !seen.scrolled) return { ...shot, ...(seen.endless.length ? { endless: seen.endless } : {}) };
      }
      const motion = await wait(seen.scrolled);
      return { ...(await this.#capture({ selector, fullPage, scale })), ...motion };
    } finally {
      // Nothing waits on it: the calls after it go to Chrome after it anyway.
      this.send('Runtime.releaseObjectGroup', { objectGroup: 'brokit-still' }).catch(() => {});
    }
  }

  // The capture itself. With `watched` (run as soon as Chrome has the pixels), a shot that
  // must capture beyond the viewport isn't taken: that resizes the page, which can stop a
  // smooth scroll or start one again, so its motion can't be watched. It calls `watched`
  // and gives null.
  async #capture({ selector, fullPage, scale }, watched) {
    let clip;
    // Capturing beyond the viewport makes Chrome lay the page out again at another size
    // (and, after, without its scrollbar), so it's only done when it has to be, and the
    // screen is set again after it.
    let beyond = false;
    if (selector !== undefined) {
      const r = await this.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('no element matches ' + ${JSON.stringify(selector)});
        const r = el.getBoundingClientRect();
        const inside = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
        return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height, inside };
      })()`);
      if (!r.width || !r.height) throw new Error(`${selector} has no size (hidden?)`);
      beyond = !r.inside;
      clip = { x: r.x, y: r.y, width: r.width, height: r.height, scale: scale ?? 1 };
    } else if (fullPage) {
      const { cssContentSize: s } = await this.send('Page.getLayoutMetrics');
      clip = { x: 0, y: 0, width: s.width, height: s.height, scale: scale ?? 1 };
      beyond = true;
    } else if (scale !== undefined) {
      const [x, y, width, height] = await this.eval('[scrollX, scrollY, innerWidth, innerHeight]');
      clip = { x, y, width, height, scale };
    }
    if (beyond && watched) {
      await watched();
      return null;
    }
    // Beyond the viewport, Chrome draws at most 8192 device pixels each way in one capture:
    // past that, the picture starts over from the page's top. A taller page is captured
    // in strips, which are joined here.
    const dpr = this.#viewport.dpr;
    if (beyond && clip.width * dpr > MAX_DRAWN) throw new Error(`too wide to capture beyond the viewport: ${Math.ceil(clip.width * dpr)} device pixels (Chrome draws at most ${MAX_DRAWN})`);
    const shoot = async (c) => Buffer.from((await this.send('Page.captureScreenshot', { format: 'png', ...(c ? { clip: c, captureBeyondViewport: beyond } : {}) }, 60000)).data, 'base64');
    let png;
    try {
      if (beyond && clip.height * dpr > MAX_DRAWN) {
        // Strips whose rows in the picture are whole numbers, each drawn under STRIP pixels.
        const rows = Math.floor(STRIP * clip.scale);
        const step = rows / (dpr * clip.scale);
        const strips = [];
        for (let y = 0; y < clip.height; y += step) strips.push(decodePng(await shoot({ ...clip, y: clip.y + y, height: Math.min(step, clip.height - y) })));
        const width = Math.min(...strips.map((s) => s.width));
        const height = strips.reduce((sum, s) => sum + s.height, 0);
        const data = Buffer.alloc(width * height * 4);
        let at = 0;
        for (const s of strips) {
          for (let r = 0; r < s.height; r++) s.data.copy(data, (at + r) * width * 4, r * s.width * 4, (r * s.width + width) * 4);
          at += s.height;
        }
        png = encodePng({ width, height, data });
      } else png = await shoot(clip);
      await watched?.();
    } finally {
      if (beyond) {
        await this.send('Emulation.clearDeviceMetricsOverride');
        await this.send('Emulation.setScrollbarsHidden', { hidden: this.#scrollbarsHidden });
        await this.emulate({});
      }
    }
    return { png, ...pngSize(png) };
  }

  async #pagePixels(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, awaitPromise: true, objectGroup: 'brokit' });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    try {
      let v;
      if (result.type === 'string') v = { dataUrl: result.value };
      else if (result.objectId) {
        const r = await this.send('Runtime.callFunctionOn', {
          objectId: result.objectId,
          awaitPromise: true,
          returnByValue: true,
          functionDeclaration: `async function () {
            const v = this;
            const read = (blob) => new Promise((done, fail) => {
              const f = new FileReader();
              f.onload = () => done(f.result);
              f.onerror = () => fail(f.error);
              f.readAsDataURL(blob);
            });
            if (typeof v.toDataURL === 'function') return { dataUrl: v.toDataURL('image/png') };
            if (typeof v.convertToBlob === 'function') return { dataUrl: await read(await v.convertToBlob({ type: 'image/png' })) };
            if (typeof ImageData !== 'undefined' && v instanceof ImageData) {
              let s = '';
              for (let i = 0; i < v.data.length; i += 0x8000) s += String.fromCharCode.apply(null, v.data.subarray(i, i + 0x8000));
              return { width: v.width, height: v.height, base64: btoa(s) };
            }
            if (typeof v.width === 'number' && typeof v.height === 'number' && typeof v.base64 === 'string') return { width: v.width, height: v.height, base64: v.base64 };
            throw new Error('from: give a canvas, an OffscreenCanvas, ImageData, a PNG data URL, or {width, height, base64}');
          }`,
        });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        v = r.result.value;
      } else throw new Error(`from: the expression gave ${result.type}, not an image`);
      if (v.dataUrl !== undefined) {
        const prefix = 'data:image/png;base64,';
        if (!v.dataUrl.startsWith(prefix)) throw new Error('from: a data URL must be a PNG (data:image/png;base64,...)');
        const png = Buffer.from(v.dataUrl.slice(prefix.length), 'base64');
        const { width, height } = decodePng(png); // checks it's a whole, valid PNG
        return { png, width, height };
      }
      const { width, height } = v;
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS) throw new Error(`from: bad size ${width}×${height}`);
      const data = Buffer.from(v.base64, 'base64');
      if (data.length !== width * height * 4) throw new Error(`from: ${width}×${height} RGBA is ${width * height * 4} bytes, got ${data.length}`);
      return { png: encodePng({ width, height, data }), width, height };
    } finally {
      await this.send('Runtime.releaseObjectGroup', { objectGroup: 'brokit' }).catch(() => {});
    }
  }

  /** Start sampling the page's main thread (JS and what it calls into). */
  async startProfile() {
    await this.send('Profiler.enable');
    await this.send('Profiler.setSamplingInterval', { interval: 100 }); // µs
    await this.send('Profiler.start');
  }

  /** Stop sampling: a .cpuprofile object (it opens in Chrome DevTools' Performance panel). */
  async stopProfile() {
    return (await this.send('Profiler.stop')).profile;
  }

  /** Close the tab. */
  async close() {
    this.#off();
    this.#onClose();
    await this.#c.send('Target.closeTarget', { targetId: this.#targetId }).catch(() => {});
  }
}

// In the page: what's moving. An animation is described as "div#id.class: its name".
// Only those on the page's clock count (scroll-driven ones move only when something
// scrolls); `ends` tells a fade from a spinner.
const MOTION = `
  const what = (a) => {
    const t = a.effect?.target;
    const el = t ? t.localName + (t.id ? '#' + t.id : '') + [...t.classList].slice(0, 2).map((c) => '.' + c).join('') + (a.effect.pseudoElement ?? '') : 'an animation';
    return el + ': ' + (a.animationName ?? a.transitionProperty ?? (a.id || 'animation'));
  };
  const timed = (a) => a.playState === 'running' && a.timeline instanceof DocumentTimeline;
  const ends = (a) => a.effect?.getComputedTiming().endTime !== Infinity;`;

// In the page: null if an animation with an end is running; else a watcher of scrolling
// whose stop() says whether anything moved since (it scrolled, an animation started) and
// which endless animations run.
const WATCH_MOTION = `(() => {
  ${MOTION}
  if (document.getAnimations().some((a) => timed(a) && ends(a))) return null;
  let scrolls = 0;
  const onScroll = () => scrolls++;
  addEventListener('scroll', onScroll, { capture: true, passive: true });
  return {
    stop() {
      removeEventListener('scroll', onScroll, { capture: true });
      const running = document.getAnimations().filter(timed);
      return { scrolled: scrolls > 0, animating: running.some(ends), endless: running.filter((a) => !ends(a)).map(what) };
    },
  };
})()`;

const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

function modifierBits({ alt, ctrl, meta, shift } = {}) {
  return (alt ? 1 : 0) | (ctrl ? 2 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0);
}

function isPoint(p) {
  return Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
}

function lerp([x0, y0], [x1, y1], t) {
  return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
}

/** "1280x800" or [1280, 800] as [w, h]. */
export function parseSize(size) {
  const [w, h] = typeof size === 'string' ? (/^\d+x\d+$/.test(size) ? size.split('x').map(Number) : []) : Array.isArray(size) ? size : [];
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 10000 || h > 10000) throw new Error(`size: like "1280x800" (each 1 to 10000); got ${JSON.stringify(size)}`);
  return [w, h];
}

/** A PNG's width and height, from its header. */
function pngSize(png) {
  if (png.length < 24 || png.toString('latin1', 12, 16) !== 'IHDR') throw new Error('Chrome sent a bad PNG');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
