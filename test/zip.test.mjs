import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import { entryPath, readZip, unzip } from '../src/zip.mjs';

/**
 * A zip from entries { name, data, deflate, mode, link, crc, declared } (crc and declared
 * override the true CRC and size, to make broken archives).
 */
function makeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.from(e.link ?? e.data ?? '');
    const body = e.deflate ? deflateRawSync(data) : data;
    const name = Buffer.from(e.name);
    const crc = e.crc ?? crc32(data) >>> 0;
    const size = e.declared ?? data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(e.encrypted ? 1 : 0, 6);
    lh.writeUInt16LE(e.method ?? (e.deflate ? 8 : 0), 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, body);
    const mode = e.link ? 0o120777 : e.name.endsWith('/') ? 0o040755 : 0o100000 | (e.mode ?? 0o644);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE((3 << 8) | 20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(e.encrypted ? 1 : 0, 8);
    ch.writeUInt16LE(e.method ?? (e.deflate ? 8 : 0), 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE((mode << 16) >>> 0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

describe('unzip', () => {
  let dir;
  let n = 0;
  before(() => (dir = mkdtempSync(join(tmpdir(), 'brokit-zip-test-'))));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const unpack = async (entries) => {
    const file = join(dir, `a${++n}.zip`);
    writeFileSync(file, makeZip(entries));
    const dest = join(dir, `out${n}`);
    await unzip(file, dest);
    return dest;
  };

  it('stored and deflated files, folders, an empty file, executables', async () => {
    const big = 'chrome '.repeat(50000);
    const dest = await unpack([
      { name: 'chrome-linux64/' },
      { name: 'chrome-linux64/chrome', data: big, deflate: true, mode: 0o755 },
      { name: 'chrome-linux64/resources.pak', data: 'pak' },
      { name: 'chrome-linux64/empty', data: '' },
      { name: 'chrome-linux64/locales/en-US.pak', data: 'en', deflate: true },
    ]);
    assert.equal(readFileSync(join(dest, 'chrome-linux64/chrome'), 'utf8'), big);
    assert.equal(readFileSync(join(dest, 'chrome-linux64/locales/en-US.pak'), 'utf8'), 'en');
    assert.equal(readFileSync(join(dest, 'chrome-linux64/empty'), 'utf8'), '');
    if (process.platform !== 'win32') {
      assert.ok(statSync(join(dest, 'chrome-linux64/chrome')).mode & 0o100, 'executable');
      assert.equal(statSync(join(dest, 'chrome-linux64/resources.pak')).mode & 0o111, 0, 'not executable');
    }
  });

  it('symbolic links inside the archive, as a macOS app bundle has', { skip: process.platform === 'win32' && 'no symbolic links on Windows' }, async () => {
    const dest = await unpack([
      { name: 'App.app/Versions/1/Framework', data: 'binary' },
      { name: 'App.app/Versions/Current', link: '1' },
      { name: 'App.app/Framework', link: 'Versions/Current/Framework' },
    ]);
    assert.ok(lstatSync(join(dest, 'App.app/Versions/Current')).isSymbolicLink());
    assert.equal(readlinkSync(join(dest, 'App.app/Framework')), 'Versions/Current/Framework');
    assert.equal(readFileSync(join(dest, 'App.app/Framework'), 'utf8'), 'binary');
  });

  it('refuses paths and links that leave the folder', async () => {
    for (const name of ['../evil', 'a/../../evil', '/etc/evil', 'C:/evil', 'a\\..\\evil', 'a/\0b']) {
      await assert.rejects(unpack([{ name, data: 'x' }]), /unsafe path/, name);
    }
    if (process.platform !== 'win32') {
      await assert.rejects(unpack([{ name: 'link', link: '../../etc/passwd' }]), /a link pointing outside the archive/);
      await assert.rejects(unpack([{ name: 'link', link: '/etc/passwd' }]), /a link pointing outside the archive/);
    }
    assert.equal(existsSync(join(dir, 'evil')), false);
  });

  it('refuses damaged, lying, encrypted and unknown entries', async () => {
    await assert.rejects(unpack([{ name: 'a', data: 'hello', crc: 1234 }]), /CRC mismatch/);
    await assert.rejects(unpack([{ name: 'bomb', data: 'x'.repeat(100000), deflate: true, declared: 10 }]), /unpacks to more than it declares/);
    await assert.rejects(unpack([{ name: 'short', data: 'hello', declared: 50 }]), /5 bytes, 50 declared/);
    await assert.rejects(unpack([{ name: 'secret', data: 'x', encrypted: true }]), /encrypted/);
    await assert.rejects(unpack([{ name: 'odd', data: 'x', method: 12 }]), /unknown compression method 12/);
  });

  it('refuses what isn\'t a zip, or is cut short', async () => {
    const file = join(dir, 'not.zip');
    writeFileSync(file, 'just text, no zip here');
    await assert.rejects(readZip(file), /not a zip file/);
    const whole = makeZip([{ name: 'a', data: 'hello world' }]);
    writeFileSync(file, whole.subarray(20));
    await assert.rejects(readZip(file), /bad|past the end/);
  });

  it('entryPath keeps entries inside', () => {
    const dest = join(dir, 'x');
    assert.equal(entryPath(dest, 'a/b.txt'), join(dest, 'a', 'b.txt'));
    assert.throws(() => entryPath(dest, ''), /unsafe/);
  });
});
