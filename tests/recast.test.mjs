import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { resolveFormat, fitSize, outputName, formatBytes, savings, preferOriginal, crc32, makeZip, formatOfMime } from '../src/recast-core.js';

const all = new Set(['webp', 'jpeg', 'png']);

test('resolveFormat honours an explicit choice only when the browser can encode it', () => {
  assert.equal(resolveFormat('webp', 'image/png', all), 'webp');
  assert.equal(resolveFormat('avif', 'image/png', all), null);
});

test('keep maps each source to something encodable', () => {
  assert.equal(resolveFormat('keep', 'image/jpeg', all), 'jpeg');
  assert.equal(resolveFormat('keep', 'image/png', all), 'png');
  assert.equal(resolveFormat('keep', 'image/gif', all), 'png');
  assert.equal(resolveFormat('keep', 'image/heic', all), 'jpeg');
  // Safari 导不出 WEBP：原格式是 WEBP 时退到 JPG
  assert.equal(resolveFormat('keep', 'image/webp', new Set(['jpeg', 'png'])), 'jpeg');
});

test('fitSize only ever shrinks and keeps the aspect ratio', () => {
  assert.deepEqual(fitSize(4032, 3024, 0), { width: 4032, height: 3024 });
  assert.deepEqual(fitSize(800, 600, 1920), { width: 800, height: 600 });
  assert.deepEqual(fitSize(4032, 3024, 1920), { width: 1920, height: 1440 });
  assert.deepEqual(fitSize(1000, 4000, 1280), { width: 320, height: 1280 });
  assert.deepEqual(fitSize(5000, 1, 100), { width: 100, height: 1 });
});

test('outputName swaps the extension, adds the suffix and de-duplicates case-insensitively', () => {
  assert.equal(outputName('IMG_2041.PNG', 'webp'), 'IMG_2041.webp');
  assert.equal(outputName('no-extension', 'jpg'), 'no-extension.jpg');
  assert.equal(outputName('.hidden', 'png'), '.hidden.png');
  assert.equal(outputName('a.b.jpeg', 'jpg', { suffix: '-min' }), 'a.b-min.jpg');
  const taken = new Set();
  assert.equal(outputName('photo.png', 'webp', { taken }), 'photo.webp');
  assert.equal(outputName('photo.jpg', 'webp', { taken }), 'photo (2).webp');
  assert.equal(outputName('PHOTO.gif', 'webp', { taken }), 'PHOTO (3).webp');
});

test('formatBytes and savings read the way the UI shows them', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(393 * 1024), '393 KB');
  assert.equal(formatBytes(2.4 * 1024 * 1024), '2.40 MB');
  assert.equal(formatBytes(33.4 * 1024 * 1024), '33.4 MB');
  assert.equal(savings(1000, 160), 84);
  assert.equal(savings(1000, 1120), -12);
  assert.equal(savings(0, 10), 0);
});

test('the original wins only when nothing but the bytes would change', () => {
  assert.equal(preferOriginal({ originalSize: 100, encodedSize: 120, sameFormat: true, resized: false }), true);
  assert.equal(preferOriginal({ originalSize: 100, encodedSize: 80, sameFormat: true, resized: false }), false);
  assert.equal(preferOriginal({ originalSize: 100, encodedSize: 120, sameFormat: false, resized: false }), false);
  assert.equal(preferOriginal({ originalSize: 100, encodedSize: 120, sameFormat: true, resized: true }), false);
});

test('formatOfMime accepts the jpg alias', () => {
  assert.equal(formatOfMime('image/jpg'), 'jpeg');
  assert.equal(formatOfMime('IMAGE/PNG'), 'png');
  assert.equal(formatOfMime('image/gif'), null);
});

test('crc32 matches zlib', () => {
  for (const s of ['', 'a', 'Recast', '图片压缩'.repeat(50)]) {
    const bytes = new TextEncoder().encode(s);
    assert.equal(crc32(bytes), zlib.crc32(bytes));
  }
});

/* 按规范把 zip 读回来：中央目录里每一项都要能指回本地头，数据与 CRC 一致。 */
function readZip(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = buf.length - 22;
  assert.equal(v.getUint32(eocd, true), 0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  let at = v.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(v.getUint32(at, true), 0x02014b50);
    const flags = v.getUint16(at + 8, true), crc = v.getUint32(at + 16, true), size = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true), local = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(buf.subarray(at + 46, at + 46 + nameLen));
    assert.equal(v.getUint32(local, true), 0x04034b50);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = buf.subarray(start, start + size);
    assert.equal(zlib.crc32(data), crc);
    out.push({ name, flags, data });
    at += 46 + nameLen;
  }
  return out;
}

test('makeZip writes a stored archive that reads back byte for byte, UTF-8 names included', () => {
  const files = [
    { name: 'photo.webp', data: new Uint8Array([1, 2, 3, 4, 5]) },
    { name: '海报 最终版.jpg', data: new Uint8Array(3000).map((_, i) => i % 251) },
    { name: 'empty.png', data: new Uint8Array(0) },
  ];
  const back = readZip(makeZip(files, new Date(2026, 8, 22, 10, 30)));
  assert.equal(back.length, 3);
  back.forEach((entry, i) => {
    assert.equal(entry.name, files[i].name);
    assert.equal(entry.flags & 0x0800, 0x0800);
    assert.deepEqual([...entry.data], [...files[i].data]);
  });
});
