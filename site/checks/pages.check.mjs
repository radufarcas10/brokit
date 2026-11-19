// The other docs pages (security, changelog, benchmark): their links and their layout,
// on a laptop and a phone. Run with: npm run site:check
import { BROKEN_LINKS } from './links.mjs';

export const url = '/security.html';
export const ready = "document.readyState === 'complete'";
export const viewport = { size: '1280x800', reducedMotion: 'reduce' };

export default async ({ page, expect, screenshot }) => {
  for (const name of ['security', 'changelog', 'benchmark']) {
    await page.goto(new URL(`/${name}.html`, await page.eval('location.href')).href, { ready });
    for (const [size, mobile] of [['1280x800', false], ['390x844', true]]) {
      await page.emulate({ size, mobile });
      expect.equal(await page.eval(BROKEN_LINKS), [], `${name} at ${size}: every link answers`);
      expect.ok(await page.eval('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), `${name} at ${size}: nothing wider than the screen`);
    }
    await page.emulate({ size: '1280x800', mobile: false });
    await screenshot(`${name}-top`, { baseline: true });
  }
};
