// PNG decoding and encoding with node:zlib, nothing else.
//
// Decoding treats every file as untrusted: chunk lengths are checked against the file,
// every chunk's CRC is checked, the image's size is capped before anything is allocated,
// and the compressed data may only inflate to exactly the size the header promises.
// Reads every non-interlaced PNG (gray, gray + alpha, RGB, RGBA, palette; 1 to 16 bits);
// interlaced files are refused with a message saying so.
//
// An image is { width, height, data } with `data` a Buffer of 8-bit RGBA, row by row.

import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** The most pixels an image may have unless the caller allows more (160 MB of RGBA). */
export const MAX_PIXELS = 40_000_000;

// Bit depths allowed for each color type, and its channels.
const COLOR_TYPES = {
  0: { channels: 1, depths: [1, 2, 4, 8, 16] }, // gray
  2: { channels: 3, depths: [8, 16] }, // RGB
  3: { channels: 1, depths: [1, 2, 4, 8] }, // palette
  4: { channels: 2, depths: [8, 16] }, // gray + alpha
  6: { channels: 4, depths: [8, 16] }, // RGBA
};

/** Decode a PNG file's bytes into an RGBA image. Throws on anything malformed. */
export function decodePng(buf, { maxPixels = MAX_PIXELS } = {}) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');
  let header = null;
  let palette = null;
  let trns = null;
  const idat = [];
  let idatBytes = 0;
  let ended = false;
  for (let at = 8; at < buf.length; ) {
    if (buf.length - at < 12) throw new Error('PNG: truncated chunk');
    const len = buf.readUInt32BE(at);
    if (len > buf.length - at - 12) throw new Error('PNG: chunk runs past the end of the file');
    const type = buf.toString('latin1', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if ((crc32(buf.subarray(at + 4, at + 8 + len)) >>> 0) !== buf.readUInt32BE(at + 8 + len)) throw new Error(`PNG: bad CRC in ${JSON.stringify(type)}`);
    at += 12 + len;
    if (!header && type !== 'IHDR') throw new Error('PNG: IHDR must come first');
    if (type === 'IHDR') {
      if (header) throw new Error('PNG: two IHDR chunks');
      header = readHeader(data, maxPixels);
    } else if (type === 'PLTE') {
      if (len % 3 || len === 0 || len > 768) throw new Error('PNG: bad palette');
      palette = data;
    } else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') {
      idat.push(data);
      idatBytes += len;
    } else if (type === 'IEND') {
      ended = true;
      break;
    }
    // Other chunks (text, gamma, color profiles) don't change the pixels we compare.
  }
  if (!header) throw new Error('PNG: no IHDR');
  if (!ended) throw new Error('PNG: no IEND (truncated file?)');
  if (!idatBytes) throw new Error('PNG: no image data');
  const { width, height, depth, colorType } = header;
  if (colorType === 3 && !palette) throw new Error('PNG: palette image without a palette');

  const bitsPerPixel = COLOR_TYPES[colorType].channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const expected = (stride + 1) * height;
  let raw;
  try {
    raw = inflateSync(Buffer.concat(idat, idatBytes), { maxOutputLength: expected });
  } catch (e) {
    throw new Error(`PNG: bad image data (${e.code === 'ERR_BUFFER_TOO_LARGE' ? 'more than the header says' : e.message})`);
  }
  if (raw.length !== expected) throw new Error('PNG: image data is shorter than the header says');
  const rows = unfilter(raw, stride, height, Math.max(1, bitsPerPixel >> 3));
  return { width, height, data: toRgba(rows, header, stride, palette, trns) };
}

function readHeader(data, maxPixels) {
  if (data.length !== 13) throw new Error('PNG: bad IHDR');
  const width = data.readUInt32BE(0);
  const height = data.readUInt32BE(4);
  const [depth, colorType, compression, filter, interlace] = data.subarray(8, 13);
  if (!width || !height || width > 0x7fffffff || height > 0x7fffffff) throw new Error('PNG: bad size');
  if (width * height > maxPixels) throw new Error(`PNG: ${width}×${height} is more than ${maxPixels} pixels`);
  const type = COLOR_TYPES[colorType];
  if (!type || !type.depths.includes(depth)) throw new Error(`PNG: bad color type ${colorType} / bit depth ${depth}`);
  if (compression !== 0 || filter !== 0) throw new Error('PNG: unknown compression or filter method');
  if (interlace === 1) throw new Error('PNG: interlaced images aren\'t supported; save it without interlacing');
  if (interlace !== 0) throw new Error('PNG: bad interlace method');
  return { width, height, depth, colorType };
}

/** Undo each row's filter; the rows without their filter bytes. */
function unfilter(raw, stride, height, bpp) {
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error(`PNG: bad filter ${filter} on row ${y}`);
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const up = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[row + x - bpp] : 0;
      const b = y ? out[up + x] : 0;
      const c = x >= bpp && y ? out[up + x - bpp] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) pred = paeth(a, b, c);
      out[row + x] = (raw[src + x] + pred) & 255;
    }
  }
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function toRgba(rows, { width, height, depth, colorType }, stride, palette, trns) {
  const rgba = Buffer.alloc(width * height * 4);
  const { channels } = COLOR_TYPES[colorType];
  const max = (1 << depth) - 1;
  // Sample `i` of a row (sub-byte depths packed from the high bits; 16 bits keeps the high byte).
  const sample = (row, i) => {
    if (depth === 8) return rows[row + i];
    if (depth === 16) return rows[row + i * 2];
    const bit = i * depth;
    return (rows[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & max;
  };
  // A 16-bit (or scaled) value, for comparing with tRNS, which stores full-depth values.
  const full = (row, i) => (depth === 16 ? rows.readUInt16BE(row + i * 2) : sample(row, i));
  const scale = depth < 8 ? 255 / max : 1;
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = x * channels;
      if (colorType === 3) {
        const index = sample(row, s);
        if (index * 3 >= palette.length) throw new Error('PNG: palette index out of range');
        palette.copy(rgba, o, index * 3, index * 3 + 3);
        rgba[o + 3] = trns && index < trns.length ? trns[index] : 255;
      } else if (colorType === 0 || colorType === 4) {
        const g = Math.round(sample(row, s) * scale);
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        if (colorType === 4) rgba[o + 3] = sample(row, s + 1);
        else rgba[o + 3] = trns?.length === 2 && full(row, s) === trns.readUInt16BE(0) ? 0 : 255;
      } else {
        rgba[o] = sample(row, s);
        rgba[o + 1] = sample(row, s + 1);
        rgba[o + 2] = sample(row, s + 2);
        if (colorType === 6) rgba[o + 3] = sample(row, s + 3);
        else {
          const clear = trns?.length === 6 && [0, 1, 2].every((k) => full(row, s + k) === trns.readUInt16BE(k * 2));
          rgba[o + 3] = clear ? 0 : 255;
        }
      }
    }
  }
  return rgba;
}

/** Encode an RGBA image as a PNG file's bytes (8-bit RGBA, each row's filter chosen to compress well). */
export function encodePng({ width, height, data }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('encodePng: bad size');
  if (data.length !== width * height * 4) throw new Error(`encodePng: ${width}×${height} RGBA needs ${width * height * 4} bytes, got ${data.length}`);
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const candidates = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const up = row - stride;
    // Each filter's output for the row; keep the one whose bytes, read as signed, sum
    // smallest (the PNG specification's suggested heuristic).
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = candidates[f];
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? data[row + x - 4] : 0;
        const b = y ? data[up + x] : 0;
        const c = x >= 4 && y ? data[up + x - 4] : 0;
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (data[row + x] - pred) & 255;
        out[x] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) [best, bestSum] = [f, sum];
    }
    raw[y * (stride + 1)] = best;
    candidates[best].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** One PNG chunk: length, type, data, CRC of type and data. */
export function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
  return out;
}
