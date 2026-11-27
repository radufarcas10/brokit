// Every docs page the side bar lists (the guides, references, examples and project
// pages): their links, their images and their layout, on a laptop and a phone; and how a
// few of them look. Run with: npm run site:check
import { BROKEN_LINKS } from './links.mjs';

export const url = '/docs.html';
export const ready = "document.readyState === 'complete'";
export const viewport = { size: '1280x800', reducedMotion: 'reduce' };

// Pages kept as baselines: one of each kind, to keep the repository small.
const PICTURED = ['docs', 'cli', 'example-form', 'security', 'changelog', 'benchmark'];

export default async ({ page, expect, screenshot }) => {
  const pages = await page.eval("[...document.querySelectorAll('.docs-pages a')].map((a) => a.getAttribute('href').replace(/\\.html$/, ''))");
  expect.atLeast(pages.length, 15, 'the side bar lists every page');
  for (const name of pages) {
    await page.goto(new URL(`/${name}.html`, await page.eval('location.href')).href, { ready });
    for (const [size, mobile] of [['1280x800', false], ['390x844', true]]) {
      await page.emulate({ size, mobile });
      expect.equal(await page.eval(BROKEN_LINKS), [], `${name} at ${size}: every link answers`);
      expect.ok(await page.eval('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), `${name} at ${size}: nothing wider than the screen`);
    }
    // Images load lazily (as they near the screen): load them all now, then look.
    expect.equal(await page.eval("Promise.all([...document.images].map((img) => ((img.loading = 'eager'), img.decode().then(() => null, () => img.getAttribute('src'))))).then((bad) => bad.filter(Boolean))"), [], `${name}: every image loads`);
    expect.equal(await page.eval("document.querySelector('.docs-pages [aria-current=page]')?.getAttribute('href')"), `${name}.html`, `${name}: the side bar marks it`);
    await page.emulate({ size: '1280x800', mobile: false });
    // A few stray pixels may differ: the edge of an inline code box inside a link
    // (cli.html's command table) is anti-aliased one of two ways from run to run, a
    // single pixel off by up to 14. Any real change differs by thousands.
    if (PICTURED.includes(name)) await screenshot(`${name}-top`, { baseline: true, tolerance: { '>2': 10 } });
  }
};
