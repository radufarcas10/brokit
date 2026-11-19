// Unpacking a zip file (a downloaded Chrome) with node:zlib, nothing else.
//
// The archive is untrusted: every entry must land inside the target folder (no absolute
// paths, no "..", no drive letters, no symbolic link pointing out); only stored and
// deflated entries, never encrypted ones; every entry is checked against its CRC-32 and
// may not inflate past the size it declares; and the number of entries and the total
// size are capped. File modes are kept (Chrome's executables need theirs) and symbolic
// links are made (a macOS app bundle has them), except on Windows, whose zips have none.
// Entries are streamed from the file, so memory stays small whatever the archive's size.

import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, open, symlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw, crc32 } from 'node:zlib';

const MAX_ENTRIES = 50_000;
const MAX_TOTAL = 4 * 1024 ** 3; // 4 GB unpacked

/** Read a zip's central directory: its entries, checked, with where their data is. */
export async function readZip(file) {
  const fh = await open(file, 'r');
  try {
    const { size } = await fh.stat();
    // The end-of-central-directory record: in the last 22 bytes, or up to 64 KB before
    // them if the archive has a comment.
    const tailSize = Math.min(size, 22 + 65535);
    const tail = Buffer.alloc(tailSize);
    await fh.read(tail, 0, tailSize, size - tailSize);
    let eocd = -1;
    for (let i = tailSize - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
    if (eocd < 0) throw new Error('not a zip file (no end of central directory)');
    const count = tail.readUInt16LE(eocd + 10);
    const dirSize = tail.readUInt32LE(eocd + 12);
    const dirOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) throw new Error('zip64 archives aren\'t supported');
    if (count > MAX_ENTRIES) throw new Error(`more than ${MAX_ENTRIES} entries`);
    if (dirOffset + dirSize > size) throw new Error('central directory runs past the end of the file');
    const dir = Buffer.alloc(dirSize);
    await fh.read(dir, 0, dirSize, dirOffset);
    const entries = [];
    let total = 0;
    for (let at = 0, k = 0; k < count; k++) {
      if (at + 46 > dir.length || dir.readUInt32LE(at) !== 0x02014b50) throw new Error('bad central directory');
      const madeBy = dir.readUInt16LE(at + 4) >> 8; // 3: Unix, so the attributes are a mode
      const flags = dir.readUInt16LE(at + 8);
      const method = dir.readUInt16LE(at + 10);
      const crc = dir.readUInt32LE(at + 16);
      const compressed = dir.readUInt32LE(at + 20);
      const uncompressed = dir.readUInt32LE(at + 24);
      const nameLength = dir.readUInt16LE(at + 28);
      const extraLength = dir.readUInt16LE(at + 30);
      const commentLength = dir.readUInt16LE(at + 32);
      const attributes = dir.readUInt32LE(at + 38);
      const local = dir.readUInt32LE(at + 42);
      if (at + 46 + nameLength > dir.length) throw new Error('bad central directory');
      const name = dir.toString('utf8', at + 46, at + 46 + nameLength);
      at += 46 + nameLength + extraLength + commentLength;
      if (compressed === 0xffffffff || uncompressed === 0xffffffff || local === 0xffffffff) throw new Error('zip64 archives aren\'t supported');
      if (flags & 1) throw new Error(`${name}: encrypted`);
      if (method !== 0 && method !== 8) throw new Error(`${name}: unknown compression method ${method}`);
      if (local + 30 + compressed > size) throw new Error(`${name}: data runs past the end of the file`);
      total += uncompressed;
      if (total > MAX_TOTAL) throw new Error('unpacks to more than 4 GB');
      const mode = madeBy === 3 ? attributes >>> 16 : 0;
      const kind = name.endsWith('/') ? 'directory' : (mode & 0o170000) === 0o120000 ? 'symlink' : 'file';
      entries.push({ name, kind, method, crc, compressed, uncompressed, local, mode: mode & 0o777 });
    }
    // Where each entry's data starts: after its local header, whose name and extra field
    // lengths can differ from the central directory's.
    const header = Buffer.alloc(30);
    for (const e of entries) {
      await fh.read(header, 0, 30, e.local);
      if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`${e.name}: bad local header`);
      e.data = e.local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      if (e.data + e.compressed > size) throw new Error(`${e.name}: data runs past the end of the file`);
    }
    return entries;
  } finally {
    await fh.close();
  }
}

/** Where an entry may go inside `dest`, or an error: only relative paths that stay inside. */
export function entryPath(dest, name) {
  if (!name || name.includes('\0') || name.includes('\\') || isAbsolute(name) || /^[a-z]:/i.test(name)) throw new Error(`unsafe path in the archive: ${JSON.stringify(name)}`);
  if (name.split('/').some((part) => part === '..')) throw new Error(`unsafe path in the archive: ${JSON.stringify(name)}`);
  const full = normalize(join(dest, name));
  const rel = relative(dest, full);
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new Error(`unsafe path in the archive: ${JSON.stringify(name)}`);
  return full;
}

/** Unpack `file` into the folder `dest` (made if needed). `onEntry(done, count)` reports progress. */
export async function unzip(file, dest, { onEntry } = {}) {
  const entries = await readZip(file);
  await mkdir(dest, { recursive: true });
  const links = [];
  let done = 0;
  for (const e of entries) {
    const target = entryPath(dest, e.name);
    if (e.kind === 'directory') await mkdir(target, { recursive: true });
    else {
      await mkdir(dirname(target), { recursive: true });
      if (e.kind === 'symlink') {
        // Made after the files, once its target is checked to be inside.
        const chunks = [];
        await pipeline(entryStream(file, e), new Transform({ transform: (c, _, next) => (chunks.push(c), next()) }));
        links.push({ target, to: Buffer.concat(chunks).toString('utf8'), name: e.name });
      } else {
        await pipeline(entryStream(file, e), createWriteStream(target, { mode: e.mode & 0o111 ? 0o755 : 0o644 }));
        if (e.mode & 0o111) await chmod(target, 0o755);
      }
    }
    onEntry?.(++done, entries.length);
  }
  for (const l of links) {
    if (process.platform === 'win32') throw new Error(`${l.name}: symbolic links can't be made here`);
    if (isAbsolute(l.to) || l.to.includes('\0')) throw new Error(`${l.name}: a link pointing outside the archive`);
    const resolved = normalize(join(dirname(l.target), l.to));
    const rel = relative(dest, resolved);
    if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new Error(`${l.name}: a link pointing outside the archive`);
    await symlink(l.to, l.target);
  }
  return entries.length;
}

/** An entry's bytes, inflated if need be, checked against its size and CRC-32 as they pass. */
function entryStream(file, e) {
  const raw = e.compressed ? createReadStream(file, { start: e.data, end: e.data + e.compressed - 1 }) : Readable.from([]);
  let crc = 0;
  let size = 0;
  const check = new Transform({
    transform(chunk, _, next) {
      size += chunk.length;
      if (size > e.uncompressed) return next(new Error(`${e.name}: unpacks to more than it declares`));
      crc = crc32(chunk, crc);
      next(null, chunk);
    },
    flush(next) {
      if (size !== e.uncompressed) return next(new Error(`${e.name}: ${size} bytes, ${e.uncompressed} declared`));
      if ((crc >>> 0) !== e.crc) return next(new Error(`${e.name}: CRC mismatch (damaged download?)`));
      next();
    },
  });
  const parts = [raw];
  if (e.method === 8) parts.push(createInflateRaw());
  parts.push(check);
  return composeStreams(parts);
}

// A pipeline of streams as one readable stream (errors from any part reach the end).
function composeStreams([first, ...rest]) {
  let stream = first;
  for (const next of rest) {
    stream.on('error', (err) => next.destroy(err));
    stream = stream.pipe(next);
  }
  return stream;
}
