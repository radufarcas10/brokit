import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deflateSync } from 'node:zlib';
import { chunk, decodePng, encodePng } from '../src/png.mjs';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** A PNG from parts, rows unfiltered: for testing every format and every malformation. */
function rawPng({ width, height, depth = 8, colorType = 6, interlace = 0, rows, plte, trns, idat, extra = [] }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([depth, colorType, 0, 0, interlace], 8);
  const data = idat ?? deflateSync(Buffer.concat(rows.map((r) => Buffer.concat([Buffer.from([0]), r]))));
  return Buffer.concat([SIG, chunk('IHDR', ihdr), ...(plte ? [chunk('PLTE', plte)] : []), ...(trns ? [chunk('tRNS', trns)] : []), chunk('IDAT', data), ...extra, chunk('IEND', Buffer.alloc(0))]);
}

/** Pack samples of `depth` bits into bytes, high bits first. */
function pack(samples, depth) {
  if (depth === 8) return Buffer.from(samples);
  if (depth === 16) {
    const b = Buffer.alloc(samples.length * 2);
    samples.forEach((s, i) => b.writeUInt16BE(s, i * 2));
    return b;
  }
  const b = Buffer.alloc(Math.ceil((samples.length * depth) / 8));
  samples.forEach((s, i) => (b[(i * depth) >> 3] |= s << (8 - depth - ((i * depth) & 7))));
  return b;
}

const px = (img, x, y) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

describe('encodePng / decodePng', () => {
  it('round-trips RGBA exactly, at odd sizes too', () => {
    for (const [w, h] of [[1, 1], [7, 3], [64, 48]]) {
      const data = Buffer.alloc(w * h * 4);
      for (let i = 0; i < data.length; i++) data[i] = (i * 37 + (i >> 5) * 11) & 255;
      const back = decodePng(encodePng({ width: w, height: h, data }));
      assert.equal(back.width, w);
      assert.equal(back.height, h);
      assert.ok(back.data.equals(data));
    }
  });

  it('picks filters that compress a gradient well', () => {
    const w = 256;
    const h = 256;
    const data = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([x, y, (x + y) >> 1, 255], (y * w + x) * 4);
    const png = encodePng({ width: w, height: h, data });
    assert.ok(png.length < 4000, `gradient PNG is ${png.length} bytes`);
    assert.ok(decodePng(png).data.equals(data));
  });

  it('refuses data that doesn\'t match the size', () => {
    assert.throws(() => encodePng({ width: 2, height: 2, data: Buffer.alloc(15) }), /needs 16 bytes/);
    assert.throws(() => encodePng({ width: 0, height: 2, data: Buffer.alloc(0) }), /bad size/);
  });
});

describe('decodePng formats', () => {
  it('gray at 1, 2, 4, 8 and 16 bits', () => {
    for (const depth of [1, 2, 4, 8, 16]) {
      const max = 2 ** depth - 1;
      const img = decodePng(rawPng({ width: 3, height: 1, depth, colorType: 0, rows: [pack([0, max, max >> 1], depth)] }));
      assert.deepEqual(px(img, 0, 0), [0, 0, 0, 255], `depth ${depth}`);
      assert.deepEqual(px(img, 1, 0), [255, 255, 255, 255], `depth ${depth}`);
      const mid = depth === 16 ? max >> 9 : Math.round(((max >> 1) * 255) / max);
      assert.equal(px(img, 2, 0)[0], mid, `depth ${depth}`);
    }
  });

  it('gray with a transparent value', () => {
    const img = decodePng(rawPng({ width: 2, height: 1, depth: 8, colorType: 0, rows: [Buffer.from([10, 20])], trns: Buffer.from([0, 20]) }));
    assert.deepEqual(px(img, 0, 0), [10, 10, 10, 255]);
    assert.deepEqual(px(img, 1, 0), [20, 20, 20, 0]);
  });

  it('gray + alpha at 8 and 16 bits', () => {
    assert.deepEqual(px(decodePng(rawPng({ width: 1, height: 1, colorType: 4, rows: [Buffer.from([100, 50])] })), 0, 0), [100, 100, 100, 50]);
    assert.deepEqual(px(decodePng(rawPng({ width: 1, height: 1, depth: 16, colorType: 4, rows: [pack([0x6400, 0x3200], 16)] })), 0, 0), [100, 100, 100, 50]);
  });

  it('RGB at 8 and 16 bits, with a transparent color', () => {
    const img = decodePng(rawPng({ width: 2, height: 1, colorType: 2, rows: [Buffer.from([1, 2, 3, 4, 5, 6])], trns: Buffer.from([0, 4, 0, 5, 0, 6]) }));
    assert.deepEqual(px(img, 0, 0), [1, 2, 3, 255]);
    assert.deepEqual(px(img, 1, 0), [4, 5, 6, 0]);
    const deep = decodePng(rawPng({ width: 1, height: 1, depth: 16, colorType: 2, rows: [pack([0xff00, 0x8000, 0x0100], 16)] }));
    assert.deepEqual(px(deep, 0, 0), [255, 128, 1, 255]);
  });

  it('RGBA at 16 bits', () => {
    assert.deepEqual(px(decodePng(rawPng({ width: 1, height: 1, depth: 16, colorType: 6, rows: [pack([0xff00, 0, 0x8000, 0x4000], 16)] })), 0, 0), [255, 0, 128, 64]);
  });

  it('palettes at 1, 2, 4 and 8 bits, with alpha', () => {
    const plte = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    for (const depth of [1, 2, 4, 8]) {
      const indexes = depth === 1 ? [0, 1, 1, 0] : [0, 1, 2, 1];
      const img = decodePng(rawPng({ width: 4, height: 1, depth, colorType: 3, rows: [pack(indexes, depth)], plte, trns: Buffer.from([128]) }));
      assert.deepEqual(px(img, 0, 0), [255, 0, 0, 128], `depth ${depth}`);
      assert.deepEqual(px(img, 1, 0), [0, 255, 0, 255], `depth ${depth}`);
    }
  });

  it('several IDAT chunks and unknown chunks', () => {
    const data = deflateSync(Buffer.from([0, 9, 8, 7, 6]));
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr.set([8, 6, 0, 0, 0], 8);
    const png = Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('tEXt', Buffer.from('a\0b')), chunk('IDAT', data.subarray(0, 3)), chunk('IDAT', data.subarray(3)), chunk('IEND', Buffer.alloc(0))]);
    assert.deepEqual(px(decodePng(png), 0, 0), [9, 8, 7, 6]);
  });
});

describe('decodePng refuses bad files', () => {
  const good = encodePng({ width: 2, height: 2, data: Buffer.alloc(16, 200) });
  const cases = {
    'not a PNG': [Buffer.from('GIF89a........'), /not a PNG/],
    'empty': [Buffer.alloc(0), /not a PNG/],
    'truncated': [good.subarray(0, good.length - 6), /truncated|past the end|no IEND/],
    'a chunk longer than the file': [(() => {
      const b = Buffer.from(good);
      b.writeUInt32BE(0x7fffffff, 8);
      return b;
    })(), /past the end/],
    'a bad CRC': [(() => {
      const b = Buffer.from(good);
      b[29] ^= 1;
      return b;
    })(), /bad CRC/],
    'no IHDR first': [Buffer.concat([SIG, chunk('IDAT', Buffer.alloc(1)), chunk('IEND', Buffer.alloc(0))]), /IHDR must come first/],
    'a huge size': [rawPng({ width: 100000, height: 100000, rows: [], idat: Buffer.alloc(1) }), /more than/],
    'zero width': [rawPng({ width: 0, height: 1, rows: [], idat: Buffer.alloc(1) }), /bad size/],
    'interlacing': [rawPng({ width: 1, height: 1, interlace: 1, rows: [Buffer.alloc(4)] }), /interlaced/],
    'a bad depth': [rawPng({ width: 1, height: 1, depth: 4, colorType: 2, rows: [Buffer.alloc(2)] }), /bit depth/],
    'a bad filter': [rawPng({ width: 1, height: 1, rows: [], idat: deflateSync(Buffer.from([7, 0, 0, 0, 0])) }), /bad filter/],
    'too much image data': [rawPng({ width: 1, height: 1, rows: [], idat: deflateSync(Buffer.alloc(1000)) }), /more than the header/],
    'too little image data': [rawPng({ width: 4, height: 4, rows: [], idat: deflateSync(Buffer.alloc(3)) }), /shorter/],
    'garbage image data': [rawPng({ width: 1, height: 1, rows: [], idat: Buffer.from('not zlib') }), /bad image data/],
    'a palette index out of range': [rawPng({ width: 1, height: 1, colorType: 3, rows: [Buffer.from([5])], plte: Buffer.from([1, 2, 3]) }), /out of range/],
    'a palette image without a palette': [rawPng({ width: 1, height: 1, colorType: 3, rows: [Buffer.from([0])] }), /without a palette/],
  };
  for (const [name, [bytes, message]] of Object.entries(cases)) it(name, () => assert.throws(() => decodePng(bytes), message));

  it('a pixel cap the caller sets', () => {
    assert.throws(() => decodePng(good, { maxPixels: 3 }), /more than 3 pixels/);
  });
});
