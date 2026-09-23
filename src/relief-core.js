// Relief 的纯逻辑：画幅、外框比例、模板排版、裁切框、去白边、文字换行、Rheo 样式解析。
// 不碰 DOM 和 canvas，Node 里可以直接测试；绘制在 relief-render.js。
import { validate } from './model.js';

/* ── 画幅 ──────────────────────────────────────────────────────────────
   「自适应」跟随内容本身的比例，但夹在 9:16 与 16:9 之间，免得极端长图出一张细条。 */
export const RATIOS = { auto: null, '4:3': 4 / 3, '16:9': 16 / 9, '1:1': 1, '3:4': 3 / 4, '9:16': 9 / 16 };
export const RATIO_LABELS = { auto: '自适应', '4:3': '4:3', '16:9': '16:9', '1:1': '1:1', '3:4': '3:4', '9:16': '9:16' };
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function canvasAspect(ratio, contentAspect) {
  const fixed = RATIOS[ratio];
  return fixed ?? clamp(contentAspect, 9 / 16, 16 / 9);
}

/* 导出尺寸：长边 1600（1x）或 3200（2x），短边按比例取整。 */
export function exportSize(aspect, scale = 1) {
  const long = 1600 * scale;
  return aspect >= 1 ? { width: long, height: Math.round(long / aspect) } : { width: Math.round(long * aspect), height: long };
}

/* ── 外框 ──────────────────────────────────────────────────────────────
   浏览器窗口在内容上方加一条标题栏；手机是金属边 + 黑色玻璃边 + 固定比例的屏幕，
   截图按「铺满、顶部对齐」塞进屏幕，所以手机外框的比例与截图无关。
   thick 是「边框粗细」滑块 0–100，50 是默认：浏览器标题栏 0.5×–1.5×，手机玻璃边从很窄到很宽。 */
export const BROWSER_BAR = 0.055;                    // 默认标题栏高度，占窗口宽度的比例
export const PHONE_SCREEN = 9 / 19.5;                // 屏幕比例
export const PHONE_BAND = 0.014;                     // 金属中框，占机身宽度的比例
export const browserBar = (thick = 50) => BROWSER_BAR * (0.5 + clamp(thick, 0, 100) / 100);
export const phoneBezel = (thick = 50) => 0.012 + 0.045 * clamp(thick, 0, 100) / 100;
export function frameAspect(frame, contentAspect, thick = 50) {
  if (frame === 'browser') return 1 / (1 / contentAspect + browserBar(thick));
  if (frame === 'phone') { const b = PHONE_BAND + phoneBezel(thick); return 1 / ((1 - 2 * b) / PHONE_SCREEN + 2 * b); }
  return contentAspect;
}

/* ── 文字模板 ──────────────────────────────────────────────────────────
   每个模板给出两块区域（按画布宽高的比例）：截图放在 shot 区域里等比缩放居中，
   文字排在 text 区域里。尺寸单位 u = √(宽×高)/100，横竖画幅字号观感一致。 */
export const TEMPLATES = [
  { name: '无文字', shot: [0, 0, 1, 1] },
  { name: '标题居上', shot: [0, .3, 1, 1], text: [.08, .07, .92, .27], align: 'center', title: 6.2, sub: 2.6 },
  { name: '左文右图', shot: [.4, 0, 1, 1], text: [.07, .2, .38, .8], align: 'left', valign: 'middle', title: 5.4, sub: 2.4 },
  { name: '底部说明', shot: [0, 0, 1, .8], text: [.1, .8, .9, .95], align: 'center', valign: 'top', title: 3.4, sub: 2.2 },
  { name: '贴底露出', shot: [0, .3, 1, 1.45], anchor: 'top', text: [.08, .07, .92, .27], align: 'center', title: 6.4, sub: 2.6 },
  { name: '角标签', shot: [0, .06, 1, .94], tag: true, title: 2.2, sub: 2.2 },
  { name: '要点列表', shot: [.42, 0, 1, 1], text: [.07, .18, .4, .82], align: 'left', valign: 'middle', title: 4.8, sub: 2.4, bullets: true },
  { name: '引语', shot: [0, 0, .58, 1], text: [.6, .18, .93, .82], align: 'left', valign: 'middle', title: 3.8, sub: 2.2, quote: true },
  { name: '杂志大字', shot: [0, .12, 1, 1], text: [.04, .04, .96, .5], align: 'center', valign: 'top', title: 14, behind: true },
];

/* 截图在 shot 区域里的位置。scale 20–150 是占区域可用尺寸的百分比（超过 100 就溢出区域，可以做出血效果）；
   区域四周先留出短边 6% 的边距。贴底露出的模板顶部对齐，让截图溢出画布底边。
   off：在画面上拖动后的偏移 [dx, dy]，按画布宽高的比例记，导出任何尺寸都落在同一位置。 */
export const SCALE_MIN = 20, SCALE_MAX = 150;
export function placeShot(tpl, W, H, aspect, scale, off = [0, 0]) {
  const t = TEMPLATES[tpl] || TEMPLATES[0];
  const [x0, y0, x1, y1] = t.shot;
  const m = Math.min(W, H) * 0.06;
  const rx = x0 * W + m, ry = y0 * H + m, rw = (x1 - x0) * W - 2 * m, rh = (y1 - y0) * H - 2 * m;
  const k = clamp(scale, SCALE_MIN, SCALE_MAX) / 100;
  let w = rw * k, h = w / aspect;
  if (h > rh * k) { h = rh * k; w = h * aspect; }
  const x = rx + (rw - w) / 2;
  const y = t.anchor === 'top' ? ry : ry + (rh - h) / 2;
  return { x: x + (off?.[0] || 0) * W, y: y + (off?.[1] || 0) * H, w, h };
}

/* 文字区（模板默认位置）。拖动的偏移在绘制时按字段各自加上。 */
export function textBox(tpl, W, H) {
  const t = TEMPLATES[tpl];
  if (!t || !t.text) return null;
  const [x0, y0, x1, y1] = t.text;
  return { x: x0 * W, y: y0 * H, w: (x1 - x0) * W, h: (y1 - y0) * H };
}

/* ── 画面上拖动的磁吸 ─────────────────────────────────────────────────
   像 Photoshop 的智能参考线：移动中的框拿左 / 中 / 右（上 / 中 / 下）三条线去对齐目标线，
   离得最近且在阈值内的那条吸过去。目标线是画布中轴、四边、安全边距，以及其他元素的边和中线。
   box 是移动后的框，others 是其他元素的框；返回修正量和要显示的参考线（画布坐标）。 */
export function snapBox(box, W, H, others = [], threshold = 6) {
  const m = Math.min(W, H) * 0.06;
  const tx = [W / 2, 0, W, m, W - m], ty = [H / 2, 0, H, m, H - m];
  for (const o of others) { tx.push(o.x, o.x + o.w / 2, o.x + o.w); ty.push(o.y, o.y + o.h / 2, o.y + o.h); }
  const pick = (edges, targets) => {
    let best = null;
    for (const e of edges) for (const t of targets) {
      const d = t - e;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d) - 1e-9)) best = { d, at: t };
    }
    return best;
  };
  const bx = pick([box.x, box.x + box.w / 2, box.x + box.w], tx);
  const by = pick([box.y, box.y + box.h / 2, box.y + box.h], ty);
  return { dx: bx ? bx.d : 0, dy: by ? by.d : 0, guides: { x: bx ? bx.at : null, y: by ? by.at : null } };
}

/* 要点列表：副标题按 · / 、 ， | 或换行切成几条。 */
export const bulletsOf = (text) => String(text).split(/\s*[·/、，,|\n]\s*/).map(s => s.trim()).filter(Boolean).slice(0, 5);

/* ── 文字换行 ──────────────────────────────────────────────────────────
   中日韩字符逐字可断，拉丁单词整词换行；过长的单词再按字符硬切。
   measure(text) 返回宽度，由调用方传入（canvas 的 measureText），这里不依赖 canvas。 */
const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/;
export function wrapLines(text, maxWidth, measure, maxLines = 4) {
  const tokens = [];
  for (const part of String(text).split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) { tokens.push(' '); continue; }
    let word = '';
    for (const ch of part) {
      if (CJK.test(ch)) { if (word) tokens.push(word); word = ''; tokens.push(ch); } else word += ch;
    }
    if (word) tokens.push(word);
  }
  const lines = [];
  let line = '';
  const push = () => { if (line.trim()) lines.push(line.trim()); line = ''; };
  for (const tok of tokens) {
    const next = line + tok;
    if (measure(next) <= maxWidth || !line.trim()) {
      if (measure(tok) > maxWidth && tok !== ' ') {          // 单个词本身就太长：按字符硬切
        for (const ch of tok) { if (measure(line + ch) > maxWidth && line) push(); line += ch; }
      } else line = next;
    } else { push(); line = tok === ' ' ? '' : tok; }
  }
  push();
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && measure(last + '…') > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = last + '…';
    return kept;
  }
  return lines;
}

/* ── 裁切框 ────────────────────────────────────────────────────────────
   box 用原图像素：{ x, y, w, h }。handle 是 n/s/e/w 的组合（'nw'、'e'……）或 'move'。
   ratio 为 null 时自由拖；给了比例就锁住，以拖动的那条边为准推算另一边。 */
export const MIN_CROP = 16;

export function fitRatioBox(W, H, ratio) {
  if (!ratio) return { x: 0, y: 0, w: W, h: H };
  let w = W, h = w / ratio;
  if (h > H) { h = H; w = h * ratio; }
  return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w: Math.round(w), h: Math.round(h) };
}

export function dragBox(start, handle, dx, dy, W, H, ratio = null) {
  let { x, y, w, h } = start;
  if (handle === 'move') {
    x = clamp(x + dx, 0, W - w); y = clamp(y + dy, 0, H - h);
    return { x: Math.round(x), y: Math.round(y), w, h };
  }
  let left = x, top = y, right = x + w, bottom = y + h;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - MIN_CROP);
  if (handle.includes('e')) right = clamp(right + dx, left + MIN_CROP, W);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - MIN_CROP);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + MIN_CROP, H);
  if (ratio) {
    let nw = right - left, nh = bottom - top;
    const horizontal = handle.includes('e') || handle.includes('w');
    const vertical = handle.includes('n') || handle.includes('s');
    if (horizontal && !vertical) nh = nw / ratio;
    else if (vertical && !horizontal) nw = nh * ratio;
    else if (nw / nh > ratio) nw = nh * ratio; else nh = nw / ratio;
    // 锁比例后不能超出原图：按剩余空间等比收回
    const maxW = handle.includes('w') ? right : W - left;
    const maxH = handle.includes('n') ? bottom : H - top;
    const k = Math.min(1, maxW / nw, maxH / nh);
    nw *= k; nh *= k;
    if (handle.includes('w')) left = right - nw; else right = left + nw;
    if (handle.includes('n')) top = bottom - nh; else bottom = top + nh;
    if (!vertical) { const cy = y + h / 2; top = clamp(cy - nh / 2, 0, H - nh); bottom = top + nh; }
    if (!horizontal) { const cx = x + w / 2; left = clamp(cx - nw / 2, 0, W - nw); right = left + nw; }
  }
  return { x: Math.round(left), y: Math.round(top), w: Math.round(right - left), h: Math.round(bottom - top) };
}

/* ── 自动去白边 ────────────────────────────────────────────────────────
   以四个角的颜色为「背景」，从四边往里找第一行 / 列出现明显不同像素的位置。
   角是透明的（macOS 截图自带的阴影区）时，把「不透明度高于阈值」当作内容。 */
/* 阈值刻意取小：界面截图里常有 #f6f7f9 这种和白边只差几个色阶的浅灰面板，
   阈值一大就会被当成背景切掉。宁可少裁，不能切到内容。 */
export function trimBounds(data, W, H, tolerance = 4) {
  const at = (x, y) => (y * W + x) * 4;
  const corners = [at(0, 0), at(W - 1, 0), at(0, H - 1), at(W - 1, H - 1)];
  const transparent = corners.every(i => data[i + 3] < 16);
  const ref = [0, 1, 2].map(c => Math.round(corners.reduce((s, i) => s + data[i + c], 0) / 4));
  const isContent = (i) => transparent
    ? data[i + 3] > 200
    : data[i + 3] > 16 && (Math.abs(data[i] - ref[0]) > tolerance || Math.abs(data[i + 1] - ref[1]) > tolerance || Math.abs(data[i + 2] - ref[2]) > tolerance);
  const rowHas = (y) => { for (let x = 0; x < W; x++) if (isContent(at(x, y))) return true; return false; };
  const colHas = (x, y0, y1) => { for (let y = y0; y <= y1; y++) if (isContent(at(x, y))) return true; return false; };
  let top = 0; while (top < H && !rowHas(top)) top++;
  if (top === H) return { x: 0, y: 0, w: W, h: H };      // 整张都是背景色：不裁
  let bottom = H - 1; while (bottom > top && !rowHas(bottom)) bottom--;
  let left = 0; while (left < W && !colHas(left, top, bottom)) left++;
  let right = W - 1; while (right > left && !colHas(right, top, bottom)) right--;
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/* ── Rheo 样式（旧版兼容）──────────────────────────────────────────────
   现在 Rheo 的「复制到 Relief」复制的是画面 PNG；早先复制的是参数 JSON，
   剪贴板里要是这种文字（或导出的 .json 内容），仍按参数重新生成。
   交给 Rheo 自己的 validate 校验，范围不对会抛出带原因的错误。 */
export function parseRheoStyle(text) {
  let value;
  try { value = JSON.parse(String(text).trim()); } catch { throw Error('不是 Rheo 的样式：请在 Rheo 页导出菜单点「复制到 Relief」后再导入'); }
  return validate(value);
}

/* 背景亮不亮 —— 决定「自动」文字颜色用深还是浅。 */
export function isLight(r, g, b) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.4;
}
