// Recast 的纯逻辑：格式、尺寸、命名、体积与 zip 打包。
// 不碰 DOM 和 canvas，Node 里可以直接测试。

/* ── 格式 ──────────────────────────────────────────────────────────────
   lossy：质量滑块是否有意义。PNG 走 canvas 编码是无损的，滑块对它无效。 */
export const FORMATS = {
  webp: { mime: 'image/webp', ext: 'webp', label: 'WEBP', lossy: true },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPG', lossy: true },
  png:  { mime: 'image/png',  ext: 'png', label: 'PNG', lossy: false },
  avif: { mime: 'image/avif', ext: 'avif', label: 'AVIF', lossy: true },
};
export const FORMAT_ORDER = ['webp', 'jpeg', 'png', 'avif'];

const MIME_TO_KEY = { 'image/webp': 'webp', 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/png': 'png', 'image/avif': 'avif' };
export const formatOfMime = (mime) => MIME_TO_KEY[String(mime).toLowerCase()] || null;

// 原格式必须保持真实源格式，不能静默转 JPG 丢失透明度。
export function resolveFormat(choice, sourceMime, supported) {
  const key = choice === 'keep' ? formatOfMime(sourceMime) : choice;
  return supported.has(key) ? key : null;
}

/* ── 尺寸 ──────────────────────────────────────────────────────────────
   只缩不放：最长边超过上限才等比缩小，结果取整且至少 1px。 */
export function fitSize(width, height, maxEdge) {
  const long = Math.max(width, height);
  if (!maxEdge || long <= maxEdge) return { width, height };
  const k = maxEdge / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/* ── 命名 ──────────────────────────────────────────────────────────────
   换扩展名、可选加后缀；批量里同名时追加 (2)、(3)……，zip 里不能重名。 */
export function outputName(name, ext, { suffix = '', taken } = {}) {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name) + suffix;
  let candidate = `${base}.${ext}`;
  if (taken) {
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base} (${n}).${ext}`;
    taken.add(candidate.toLowerCase());
  }
  return candidate;
}

/* ── 体积 ────────────────────────────────────────────────────────────── */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(2) : mb.toFixed(1)} MB`;
}

/* 节省比例，正数为变小。原体积为 0 时没有意义，返回 0。 */
export const savings = (before, after) => (before > 0 ? Math.round((1 - after / before) * 100) : 0);

/* 编码结果比原图还大、且没有换格式也没有缩尺寸 —— 这时原图就是更好的结果，
   直接交回原文件，不要让用户下载一个更大的「压缩版」。 */
export function preferOriginal({ originalSize, encodedSize, sameFormat, resized }) {
  return sameFormat && !resized && encodedSize >= originalSize;
}

/* ── zip ───────────────────────────────────────────────────────────────
   只存不压（method 0）：图片已经是压缩格式，再 deflate 几乎省不下什么，
   反而要多带一个压缩库。文件名按 UTF-8 写并置位 bit 11，中文名不会乱码。 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(date) {
  const d = date instanceof Date ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function makeZip(files, now = new Date()) {
  const enc = new TextEncoder();
  const { time, date } = dosTime(now);
  const locals = [], centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);            // version needed
    local.setUint16(6, 0x0800, true);        // UTF-8 names
    local.setUint16(8, 0, true);             // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), name, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);          // version made by
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = centrals.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
