import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectBytes, inspectImage, MAX_FILE_BYTES } from '../src/recast-inspect.js';
const ascii = s => new TextEncoder().encode(s);
function png(width = 100, height = 100, animated = false) {
  const chunk = (name, data) => { const out = new Uint8Array(data.length + 12); new DataView(out.buffer).setUint32(0, data.length); out.set(ascii(name),4); out.set(data,8); return out; };
  const header = new Uint8Array(13), v = new DataView(header.buffer); v.setUint32(0,width); v.setUint32(4,height);
  return new Uint8Array([137,...ascii('PNG\r\n\x1a\n'),...chunk('IHDR',header),...(animated ? chunk('acTL',new Uint8Array(8)) : []),...chunk('IEND',new Uint8Array())]);
}
function webp(animated = false) {
  const b = new Uint8Array(30), v = new DataView(b.buffer); b.set(ascii('RIFF')); v.setUint32(4,22,true); b.set(ascii('WEBPVP8X'),8); v.setUint32(16,10,true); b[20] = animated ? 2 : 0; b[24] = 99; b[27] = 49; return b;
}
test('actual bytes determine format even with misleading MIME', async () => {
  assert.deepEqual(await inspectImage(new Blob([png()],{type:'image/jpeg'})),{mime:'image/png',width:100,height:100});
  assert.deepEqual(inspectBytes(webp()),{mime:'image/webp',width:100,height:50});
  const jpeg = new Uint8Array([255,216,255,192,0,8,8,0,50,0,100,0]);
  assert.deepEqual(inspectBytes(jpeg),{mime:'image/jpeg',width:100,height:50});
});
test('animation and unsupported formats are rejected before bitmap decode', () => {
  assert.throws(()=>inspectBytes(png(100,100,true)), /animated-image/);
  assert.throws(()=>inspectBytes(webp(true)), /animated-image/);
  assert.throws(()=>inspectBytes(ascii('GIF89a')), /gif-unsupported/);
  assert.throws(()=>inspectBytes(ascii('<svg></svg>')), /input-unsupported/);
});
test('pixel, byte and malformed chunk limits are checked before decode', async () => {
  assert.throws(()=>inspectBytes(png(8000,8000)), /image-too-large/);
  assert.throws(()=>inspectBytes(png(20000,1)), /image-too-large/);
  assert.throws(()=>inspectBytes(png().slice(0,35)), /invalid-image/);
  const b = webp(); new DataView(b.buffer).setUint32(16,0xfffffff0,true);
  assert.throws(()=>inspectBytes(b), /invalid-image/);
  await assert.rejects(inspectImage({size:MAX_FILE_BYTES+1,arrayBuffer(){throw Error('must not read')}}), /file-too-large/);
});
