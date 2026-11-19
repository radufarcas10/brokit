// Compare two RGBA images pixel by pixel.
//
// A pixel's difference is its largest difference in any channel (0 to 255). The result
// counts pixels in buckets (identical, ≤2, ≤8, ≤32, >32), the mean and the worst, says
// whether the tolerance holds, and draws a difference image: the first image faded, with
// differing pixels in red (stronger the more they differ) and ignored regions in blue.
//
// Tolerance (all given limits must hold; none given means identical):
//   { "max": 2 }          no pixel differs by more than 2
//   { "mean": 0.5 }       the mean difference is at most 0.5
//   { ">8": "0.1%" }      at most 0.1 % of the pixels differ by more than 8
//   { ">0": 20 }          at most 20 pixels differ at all
// Ignored regions: [[x, y, width, height], ...] in image pixels.

const BUCKETS = [
  ['identical', 0],
  ['≤2', 2],
  ['≤8', 8],
  ['≤32', 32],
  ['>32', 255],
];

/** Check a tolerance object; the list of limits it sets. Throws on a typo. */
export function parseTolerance(tolerance = {}) {
  if (tolerance === null || typeof tolerance !== 'object' || Array.isArray(tolerance)) throw new Error('tolerance: an object, like {"max": 2}');
  const limits = [];
  for (const [key, value] of Object.entries(tolerance)) {
    if (key === 'max' || key === 'mean') {
      if (typeof value !== 'number' || !(value >= 0)) throw new Error(`tolerance ${key}: a number ≥ 0`);
      limits.push({ key, value });
    } else if (/^>\d{1,3}$/.test(key) && Number(key.slice(1)) <= 255) {
      const pct = typeof value === 'string' && /^\d+(\.\d+)?%$/.test(value);
      if (!pct && !(Number.isInteger(value) && value >= 0)) throw new Error(`tolerance ${key}: a pixel count or a percentage like "0.1%"`);
      limits.push({ key, above: Number(key.slice(1)), value });
    } else throw new Error(`tolerance: unknown limit ${JSON.stringify(key)} (max, mean, or ">N")`);
  }
  return limits;
}

/**
 * Compare images `a` and `b` ({width, height, data}); `tolerance` and `ignore` as above.
 * Images of different sizes don't pass (and have no difference image).
 */
export function diffImages(a, b, { tolerance = {}, ignore = [] } = {}) {
  const limits = parseTolerance(tolerance);
  if (a.width !== b.width || a.height !== b.height) {
    return { pass: false, size: [a.width, a.height], otherSize: [b.width, b.height], failures: [`sizes differ: ${a.width}×${a.height} vs ${b.width}×${b.height}`] };
  }
  const { width, height } = a;
  const mask = ignoreMask(width, height, ignore);
  const counts = new Float64Array(BUCKETS.length);
  // How many pixels differ by exactly d, for the ">N" limits.
  const histogram = new Float64Array(256);
  const image = Buffer.alloc(width * height * 4);
  let compared = 0;
  let sum = 0;
  let worst = 0;
  for (let i = 0, o = 0; i < width * height; i++, o += 4) {
    const luma = (a.data[o] * 54 + a.data[o + 1] * 183 + a.data[o + 2] * 19) >> 8;
    const faded = 200 + ((luma * 55) >> 8); // 200 (black) to 254 (white)
    if (mask?.[i]) {
      image[o] = faded >> 1;
      image[o + 1] = faded >> 1;
      image[o + 2] = 255;
      image[o + 3] = 255;
      continue;
    }
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(a.data[o + c] - b.data[o + c]));
    compared++;
    sum += d;
    if (d > worst) worst = d;
    histogram[d]++;
    let k = 0;
    while (d > BUCKETS[k][1]) k++;
    counts[k]++;
    if (d === 0) {
      image[o] = image[o + 1] = image[o + 2] = faded;
    } else {
      // Even a difference of 1 shows; 64 and more is full red.
      const t = 0.4 + 0.6 * Math.min(1, d / 64);
      image[o] = 255;
      image[o + 1] = image[o + 2] = Math.round(faded * (1 - t));
    }
    image[o + 3] = 255;
  }
  const mean = compared ? sum / compared : 0;
  const pct = (n) => (compared ? (100 * n) / compared : 0);
  const failures = [];
  for (const limit of limits) {
    if (limit.key === 'max' && worst > limit.value) {
      let n = 0;
      for (let d = limit.value + 1; d < 256; d++) n += histogram[d];
      failures.push(`${n} pixels differ by more than ${limit.value} (up to ${worst})`);
    }
    else if (limit.key === 'mean' && mean > limit.value) failures.push(`the mean difference is ${mean.toFixed(3)} (max ${limit.value})`);
    else if (limit.above !== undefined) {
      let n = 0;
      for (let d = limit.above + 1; d < 256; d++) n += histogram[d];
      const allowed = typeof limit.value === 'string' ? (parseFloat(limit.value) / 100) * compared : limit.value;
      if (n > allowed) failures.push(`${n} pixels (${pct(n).toFixed(3)} %) differ by more than ${limit.above} (allowed ${limit.value})`);
    }
  }
  if (!limits.length && worst > 0) failures.push(`${compared - counts[0]} pixels differ (up to ${worst})`);
  return {
    pass: failures.length === 0,
    size: [width, height],
    compared,
    ignored: width * height - compared,
    pixels: Object.fromEntries(BUCKETS.map(([name], k) => [name, counts[k]])),
    percent: Object.fromEntries(BUCKETS.map(([name], k) => [name, +pct(counts[k]).toFixed(3)])),
    mean: +mean.toFixed(4),
    worst,
    failures,
    image: { width, height, data: image },
  };
}

function ignoreMask(width, height, regions) {
  if (!Array.isArray(regions)) throw new Error('ignore: a list of [x, y, width, height]');
  if (!regions.length) return null;
  const mask = new Uint8Array(width * height);
  for (const r of regions) {
    if (!Array.isArray(r) || r.length !== 4 || !r.every((v) => Number.isInteger(v) && v >= 0)) throw new Error(`ignore: bad region ${JSON.stringify(r)}`);
    const [x0, y0] = r;
    const x1 = Math.min(width, x0 + r[2]);
    const y1 = Math.min(height, y0 + r[3]);
    for (let y = y0; y < y1; y++) mask.fill(1, y * width + x0, y * width + x1);
  }
  return mask;
}
