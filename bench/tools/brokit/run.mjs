// brokit, through its library, as a scenario file would drive it.
//   node run.mjs <base URL> <plan>   (CHROME: the browser to use)

import { readFileSync } from 'node:fs';
import { launch } from '../../../src/index.mjs';
import { PLANS, SCENARIOS } from '../../scenarios.mjs';

const [base, plan] = process.argv.slice(2);
const t0 = performance.now();
const browser = await launch({ chrome: process.env.CHROME });
const launchMs = performance.now() - t0;
const scenarioMs = [];
for (const name of PLANS[plan]) {
  const s = SCENARIOS[name];
  const t = performance.now();
  const page = await browser.newPage({ size: [s.viewport.width, s.viewport.height], dpr: s.viewport.dpr, mobile: s.viewport.mobile });
  await page.goto(base + s.page, { ready: s.ready ?? "document.readyState === 'complete'" });
  if (name === 'form') {
    await page.click({ selector: s.field });
    await page.type(s.text);
    await page.key('Enter');
  } else if (name === 'canvas') {
    for (const [x0, y0, x1, y1] of s.drags) await page.drag([x0, y0], [x1, y1], { steps: 8 });
    await page.key(s.key);
    await page.wheel([s.wheel[0], s.wheel[1]], { dy: s.wheel[2] });
  } else await page.tap({ selector: s.tap });
  const got = String(await page.eval(s.read));
  if (got !== s.expect) throw new Error(`${name}: expected ${s.expect}, got ${got}`);
  await page.screenshot(name === 'canvas' ? { selector: 'canvas' } : {});
  await page.close();
  scenarioMs.push(performance.now() - t);
}
const t1 = performance.now();
await browser.close();
const closeMs = performance.now() - t1;
const version = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;
console.log(JSON.stringify({ tool: 'brokit', version, launchMs, scenarioMs, closeMs }));
