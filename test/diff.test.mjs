import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diffImages, parseTolerance } from '../src/diff.mjs';

const image = (w, h, fill = 100) => ({ width: w, height: h, data: Buffer.alloc(w * h * 4, fill) });
const set = (img, x, y, rgba) => img.data.set(rgba, (y * img.width + x) * 4);

describe('diffImages', () => {
  it('identical images pass, by default and with any tolerance', () => {
    const d = diffImages(image(10, 10), image(10, 10));
    assert.equal(d.pass, true);
    assert.equal(d.percent.identical, 100);
    assert.equal(d.worst, 0);
    assert.equal(d.mean, 0);
  });

  it('one pixel off by 3: fails by default, buckets and tolerances', () => {
    const b = image(10, 10);
    set(b, 4, 5, [103, 100, 100, 100]);
    const d = diffImages(image(10, 10), b);
    assert.equal(d.pass, false);
    assert.match(d.failures[0], /1 pixels differ \(up to 3\)/);
    assert.equal(d.pixels['≤8'], 1);
    assert.equal(d.worst, 3);
    assert.equal(diffImages(image(10, 10), b, { tolerance: { max: 3 } }).pass, true);
    assert.equal(diffImages(image(10, 10), b, { tolerance: { max: 2 } }).pass, false);
    assert.equal(diffImages(image(10, 10), b, { tolerance: { '>2': 1 } }).pass, true);
    assert.equal(diffImages(image(10, 10), b, { tolerance: { '>2': 0 } }).pass, false);
    assert.equal(diffImages(image(10, 10), b, { tolerance: { '>2': '1%' } }).pass, true);
    assert.equal(diffImages(image(10, 10), b, { tolerance: { '>2': '0.5%' } }).pass, false);
    assert.equal(diffImages(image(10, 10), b, { tolerance: { mean: 0.03 } }).pass, true);
    assert.equal(diffImages(image(10, 10), b, { tolerance: { mean: 0.02 } }).pass, false);
  });

  it('alpha differences count', () => {
    const b = image(2, 2);
    set(b, 0, 0, [100, 100, 100, 0]);
    assert.equal(diffImages(image(2, 2), b).worst, 100);
  });

  it('ignored regions aren\'t compared', () => {
    const b = image(10, 10);
    set(b, 4, 5, [0, 0, 0, 255]);
    const d = diffImages(image(10, 10), b, { ignore: [[3, 4, 2, 2]] });
    assert.equal(d.pass, true);
    assert.equal(d.ignored, 4);
    assert.equal(d.compared, 96);
    // Ignored pixels are blue in the difference image.
    assert.deepEqual([...d.image.data.subarray((5 * 10 + 4) * 4, (5 * 10 + 4) * 4 + 4)].slice(2), [255, 255]);
  });

  it('the difference image shows differing pixels in red', () => {
    const b = image(3, 1);
    set(b, 1, 0, [0, 0, 0, 255]);
    const { data } = diffImages(image(3, 1), b).image;
    const [r, g, bl] = data.subarray(4, 8);
    assert.equal(r, 255);
    assert.ok(g < 100 && bl < 100);
    assert.equal(data[0], data[1]); // unchanged: gray
  });

  it('unchanged pixels are faded light gray, whatever their color', () => {
    for (const fill of [0, 128, 255]) {
      const { data } = diffImages(image(1, 1, fill), image(1, 1, fill)).image;
      assert.ok(data[0] >= 200 && data[0] <= 255 && data[0] === data[1] && data[1] === data[2], `fill ${fill}: ${data[0]}`);
    }
    assert.ok(diffImages(image(1, 1, 255), image(1, 1, 255)).image.data[0] > diffImages(image(1, 1, 0), image(1, 1, 0)).image.data[0]);
  });

  it('different sizes don\'t pass', () => {
    const d = diffImages(image(10, 10), image(10, 11));
    assert.equal(d.pass, false);
    assert.match(d.failures[0], /sizes differ: 10×10 vs 10×11/);
  });

  it('bad tolerances and regions are errors, not silent passes', () => {
    assert.throws(() => parseTolerance({ maxx: 2 }), /unknown limit "maxx"/);
    assert.throws(() => parseTolerance({ max: -1 }), /≥ 0/);
    assert.throws(() => parseTolerance({ '>8': '1 percent' }), /percentage/);
    assert.throws(() => parseTolerance({ '>300': 1 }), /unknown limit/);
    assert.throws(() => parseTolerance([1]), /an object/);
    assert.throws(() => diffImages(image(2, 2), image(2, 2), { ignore: [[0, 0, 1]] }), /bad region/);
  });
});
