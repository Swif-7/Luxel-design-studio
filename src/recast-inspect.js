// Inspect file signatures before decoding: no extension-based format assumptions.
export const MAX_PIXELS = 32_000_000;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export function inspectBytes(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (p, n) => String.fromCharCode(...bytes.subarray(p, p + n));
  const need = (p, n) => { if (p < 0 || p + n > bytes.length) throw new Error('invalid-image'); };
  let mime, width, height;
  if (text(0, 6) === 'GIF87a' || text(0, 6) === 'GIF89a') throw new Error('gif-unsupported');
  if (bytes[0] === 137 && text(1, 7) === 'PNG\r\n\x1a\n') {
    mime = 'image/png'; need(8, 25);
    if (text(12, 4) !== 'IHDR') throw new Error('invalid-image');
    width = v.getUint32(16); height = v.getUint32(20);
    let ended = false;
    for (let p = 8; p < bytes.length;) {
      need(p, 12); const n = v.getUint32(p); need(p + 12, n);
      const type = text(p + 4, 4);
      if (type === 'acTL') throw new Error('animated-image');
      if (type === 'IEND') { ended = true; break; }
      p += n + 12;
    }
    if (!ended) throw new Error('invalid-image');
  } else if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    mime = 'image/webp'; need(0, 12);
    const end = v.getUint32(4, true) + 8; need(0, end);
    const u24 = p => bytes[p] | bytes[p + 1] << 8 | bytes[p + 2] << 16;
    for (let p = 12; p < end;) {
      need(p, 8); const n = v.getUint32(p + 4, true), q = p + 8;
      if (q + n > end) throw new Error('invalid-image');
      const type = text(p, 4);
      if (type === 'ANIM' || type === 'ANMF') throw new Error('animated-image');
      if (type === 'VP8X') { if (n < 10) throw new Error('invalid-image'); if (bytes[q] & 2) throw new Error('animated-image'); width = u24(q + 4) + 1; height = u24(q + 7) + 1; }
      if (!width && type === 'VP8 ') { if (n < 10 || text(q + 3, 3) !== '\x9d\x01\x2a') throw new Error('invalid-image'); width = v.getUint16(q + 6, true) & 16383; height = v.getUint16(q + 8, true) & 16383; }
      if (!width && type === 'VP8L') { if (n < 5 || bytes[q] !== 47) throw new Error('invalid-image'); const bits = v.getUint32(q + 1, true); width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1; }
      p = q + n + (n & 1);
    }
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    mime = 'image/jpeg';
    for (let p = 2; p < bytes.length;) {
      if (bytes[p++] !== 255) throw new Error('invalid-image');
      while (bytes[p] === 255) p++;
      need(p, 1); const marker = bytes[p++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      need(p, 2); const n = v.getUint16(p); if (n < 2) throw new Error('invalid-image'); need(p, n);
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) { if (n < 8) throw new Error('invalid-image'); height = v.getUint16(p + 3); width = v.getUint16(p + 5); break; }
      p += n;
    }
  } else throw new Error('input-unsupported');
  if (!width || !height) throw new Error('invalid-image');
  if (width * height > MAX_PIXELS || Math.max(width, height) > 16384) throw new Error('image-too-large');
  return { mime, width, height };
}
export async function inspectImage(blob) {
  if (blob.size > MAX_FILE_BYTES) throw new Error('file-too-large');
  return inspectBytes(new Uint8Array(await blob.arrayBuffer()));
}
