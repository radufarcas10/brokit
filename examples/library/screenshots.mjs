// Screenshots of one page on three screens, each compared with the last run's.
//
//   node screenshots.mjs
//
// Writes out/laptop.png, out/tablet.png and out/phone.png. When a shot from an
// earlier run is there, it's compared first; a changed one also gets a difference image
// (out/<name>.diff.png), and the script exits 1.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodePng, diffImages, encodePng, launch, serve } from 'brokit';

const screens = [
  { name: 'laptop', size: '1280x800', dpr: 1 },
  { name: 'tablet', size: '820x1180', dpr: 1, mobile: true },
  { name: 'phone', size: '393x852', dpr: 2, mobile: true },
];
const out = join(import.meta.dirname, 'out');

const server = await serve(import.meta.dirname); // this folder, on 127.0.0.1
const browser = await launch({ gpu: 'software' }); // the same pixels on every machine
let changed = 0;
try {
  await mkdir(out, { recursive: true });
  for (const { name, size, dpr, mobile } of screens) {
    const page = await browser.newPage({ size, dpr, mobile });
    await page.goto(new URL('index.html', server.url).href, { ready: "document.readyState === 'complete'" });
    const { png, width, height } = await page.screenshot();
    await page.close();

    const file = join(out, `${name}.png`);
    const diffFile = join(out, `${name}.diff.png`);
    const before = await readFile(file).catch(() => null);
    await writeFile(file, png);
    await rm(diffFile, { force: true });

    let verdict = 'new';
    if (before) {
      // Up to 2 of 255 in a channel: what Chrome's drawing varies by, and nobody can see.
      const d = diffImages(decodePng(before), decodePng(png), { tolerance: { max: 2 } });
      if (d.pass) verdict = 'same as last run';
      else {
        changed++;
        verdict = `changed: ${d.failures.join('; ')}`;
        if (d.image) {
          await writeFile(diffFile, encodePng(d.image));
          verdict += ` (difference: out/${name}.diff.png)`;
        }
      }
    }
    console.log(`${name.padEnd(6)} ${size} at ${dpr}x → out/${name}.png, ${width}×${height}, ${verdict}`);
  }
} finally {
  await browser.close();
  await server.close();
}
if (changed) {
  console.log(`${changed} of ${screens.length} changed`);
  process.exitCode = 1;
}
