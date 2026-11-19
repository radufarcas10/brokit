// Playwright (playwright-core: no browser of its own), with its usual API.
//   node run.mjs <base URL> <plan>   (CHROME: the browser to use)

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { PLANS, SCENARIOS } from '../../scenarios.mjs';

const [base, plan] = process.argv.slice(2);
const t0 = performance.now();
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
const launchMs = performance.now() - t0;
const scenarioMs = [];
for (const name of PLANS[plan]) {
  const s = SCENARIOS[name];
  const t = performance.now();
  const context = await browser.newContext({
    viewport: { width: s.viewport.width, height: s.viewport.height },
    deviceScaleFactor: s.viewport.dpr,
    isMobile: s.viewport.mobile,
    hasTouch: s.viewport.mobile,
  });
  const page = await context.newPage();
  await page.goto(base + s.page, { waitUntil: 'load' });
  if (s.ready) await page.waitForFunction(s.ready);
  if (name === 'form') {
    await page.click(s.field);
    await page.keyboard.insertText(s.text);
    await page.keyboard.press('Enter');
  } else if (name === 'canvas') {
    for (const [x0, y0, x1, y1] of s.drags) {
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x1, y1, { steps: 8 });
      await page.mouse.up();
    }
    await page.keyboard.press(s.key);
    await page.mouse.move(s.wheel[0], s.wheel[1]);
    await page.mouse.wheel(0, s.wheel[2]);
  } else await page.tap(s.tap);
  // Playwright doesn't wait after input; wait for the page to show it, as a test would.
  await page.waitForFunction(`String(${s.read}) === ${JSON.stringify(s.expect)}`, null, { timeout: 5000 }).catch(() => {});
  const got = String(await page.evaluate(s.read));
  if (got !== s.expect) throw new Error(`${name}: expected ${s.expect}, got ${got}`);
  if (name === 'canvas') await page.locator('canvas').screenshot();
  else await page.screenshot();
  await context.close();
  scenarioMs.push(performance.now() - t);
}
const t1 = performance.now();
await browser.close();
const closeMs = performance.now() - t1;
const version = JSON.parse(readFileSync(new URL('./node_modules/playwright-core/package.json', import.meta.url), 'utf8')).version;
console.log(JSON.stringify({ tool: 'playwright', version, launchMs, scenarioMs, closeMs }));
