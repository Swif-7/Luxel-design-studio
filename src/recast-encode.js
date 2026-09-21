// Recast 的编解码：浏览器自带的 createImageBitmap 解码，canvas 缩放，canvas 编码。
// Worker 和主线程共用这一份 —— 有 OffscreenCanvas 就用它，没有就退回 <canvas>。
import { fitSize } from './recast-core.js';

const hasOffscreen = typeof OffscreenCanvas !== 'undefined' && 'convertToBlob' in OffscreenCanvas.prototype;

function makeCanvas(width, height) {
  if (hasOffscreen) return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  return c;
}

const toBlob = (canvas, type, quality) => canvas.convertToBlob
  ? canvas.convertToBlob({ type, quality })
  : new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality));

/* 浏览器编不了某个格式时不会报错，而是悄悄换成 PNG —— 所以要编一张小图，
   看回来的 type 对不对，才知道到底支不支持。 */
export async function probeEncoders(mimes) {
  const canvas = makeCanvas(2, 2);
  canvas.getContext('2d').fillRect(0, 0, 1, 1);
  const ok = new Set();
  for (const mime of mimes) {
    try { if ((await toBlob(canvas, mime, 0.8)).type === mime) ok.add(mime); } catch {}
  }
  return ok;
}

/* 一次缩太多，双线性采样会丢细节、出摩尔纹。每次最多缩一半，
   逐级缩到目标尺寸 —— 大图缩成缩略尺寸时差别很明显，尤其在 Safari。 */
function drawScaled(source, width, height) {
  let src = source, w = source.width, h = source.height;
  while (w / 2 >= width && h / 2 >= height) {
    const half = makeCanvas(Math.round(w / 2), Math.round(h / 2));
    const hctx = half.getContext('2d');
    hctx.imageSmoothingQuality = 'high';
    hctx.drawImage(src, 0, 0, half.width, half.height);
    src = half; w = half.width; h = half.height;
  }
  return src;
}

/* fill：输出没有透明通道（JPG）时，透明区域垫的底色，否则会变成黑底。 */
export async function encodeImage(blob, { mime, quality, maxEdge, fill = '#ffffff' }) {
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = fitSize(bitmap.width, bitmap.height, maxEdge);
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (mime === 'image/jpeg') { ctx.fillStyle = fill; ctx.fillRect(0, 0, width, height); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(drawScaled(bitmap, width, height), 0, 0, width, height);
    const out = await toBlob(canvas, mime, quality);
    if (out.type !== mime) throw new Error('unsupported-format');
    return { blob: out, width, height, srcWidth: bitmap.width, srcHeight: bitmap.height };
  } finally {
    bitmap.close?.();
  }
}

export const canUseWorkers = hasOffscreen && typeof Worker !== 'undefined';
