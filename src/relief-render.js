// Relief 的绘制：背景 → 截图（含外框、圆角、阴影）→ 文字，全部画在一张 2D canvas 上。
// 预览和导出走同一个 renderScene，只是像素尺寸不同 —— 看到的就是导出的。
import { Renderer } from './shader.js';
import { cjkFonts, pageLang } from './i18n.js';
import { TEMPLATES, frameAspect, placeShot, textBox, bulletsOf, wrapLines, browserBar, phoneBezel, PHONE_BAND, BROWSER_BAR as BROWSER_UNIT, isLight, clamp } from './relief-core.js';

// 汉字 / 谚文的后备字体按页面语言排（日文、韩文页面不借中文字形）
export const FONT = `"IBM Plex Sans",${cjkFonts(pageLang())},sans-serif`;
export const MONO = '"IBM Plex Mono",ui-monospace,Menlo,monospace';

const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

/* ── 背景 ─────────────────────────────────────────────────────────────
   Rheo 走 WebGL 渲染器；纯色直接填；导入图片按「铺满」裁。
   模糊优先用 ctx.filter 的高斯模糊；Safari 不支持时退回逐级缩放。
   原始背景和模糊后的背景各缓存几个尺寸，拖别的滑块时不必重画。 */
let rheo = null, rheoCanvas = null;
function rheoRenderer() {
  if (rheo === false) return null;
  if (!rheo) {
    try { rheoCanvas = document.createElement('canvas'); rheo = new Renderer(rheoCanvas); }
    catch { rheo = false; return null; }
  }
  return rheo;
}

const cache = new Map();
function remember(key, make) {
  if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
  const v = make();
  cache.set(key, v);
  while (cache.size > 8) cache.delete(cache.keys().next().value);
  return v;
}
export const clearCache = () => cache.clear();

function drawCover(ctx, img, W, H, align = 'center', zoom = 1) {
  const iw = img.width, ih = img.height, k = Math.max(W / iw, H / ih) * zoom;
  const w = iw * k, h = ih * k;
  // 缩到铺满以下时四周不补：保持透明，预览里显示棋盘格，用户一眼能看出露白了多少
  ctx.drawImage(img, (W - w) / 2, align === 'top' ? 0 : (H - h) / 2, w, h);
}

function rawBackground(bg, W, H) {
  return remember(`raw|${bg.key}|${W}x${H}`, () => {
    const c = canvas(W, H), ctx = c.getContext('2d');
    if (bg.src === 'solid') { ctx.fillStyle = bg.solid; ctx.fillRect(0, 0, W, H); return c; }
    if (bg.src === 'image' && bg.image) { drawCover(ctx, bg.image, W, H, 'center', bg.zoom); return c; }
    const r = rheoRenderer();
    if (r) {
      r.draw({ ...bg.rheo, particles: false }, 6, c.width, c.height);
      ctx.drawImage(rheoCanvas, 0, 0, W, H);
    } else {                                           // 没有 WebGL：用 Rheo 的配色画一张柔和渐变
      const g = ctx.createLinearGradient(0, 0, W, H);
      const cols = bg.rheo.colors;
      cols.forEach((col, i) => g.addColorStop(i / Math.max(1, cols.length - 1), col));
      ctx.fillStyle = bg.rheo.background; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = .8; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    }
    return c;
  });
}

const supportsFilter = (() => { try { const c = document.createElement('canvas').getContext('2d'); c.filter = 'blur(2px)'; return c.filter === 'blur(2px)'; } catch { return false; } })();

function blurred(bg, W, H) {
  const raw = rawBackground(bg, W, H);
  if (!bg.blur) return raw;
  return remember(`blur|${bg.key}|${bg.blur}|${W}x${H}`, () => {
    const out = canvas(W, H), o = out.getContext('2d');
    const radius = (bg.blur / 100) * Math.min(W, H) * 0.08;
    // 边缘取样会混进透明像素、拉出一圈暗边：四周多画出一圈再模糊
    const pad = radius * 2;
    if (supportsFilter) {
      o.filter = `blur(${radius}px)`;
      o.drawImage(raw, -pad, -pad, W + pad * 2, H + pad * 2);
      o.filter = 'none';
      return out;
    }
    // Safari 的 2D canvas 不支持 filter：逐级缩一半、再逐级放大一倍，
    // 每级都是双线性采样，叠起来接近高斯；一步放大会出方块，所以必须一级一级来。
    const levels = Math.max(1, Math.round(Math.log2(1 + radius)));
    // 每级再把上下左右各错 1px 的自己以一半透明度叠上去，消掉双线性放大留下的方块。
    // 不先清空：边缘错出去的那 1px 没有像素可叠，就保留原色，不会混进透明、泛出亮边。
    const smooth = (c) => {
      const tmp = canvas(c.width, c.height); tmp.getContext('2d').drawImage(c, 0, 0);
      const x = c.getContext('2d');
      x.globalAlpha = .5;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) x.drawImage(tmp, dx, dy);
      x.globalAlpha = 1;
    };
    let cur = canvas(W + pad * 2, H + pad * 2);
    cur.getContext('2d').drawImage(raw, 0, 0, cur.width, cur.height);
    const chain = [cur];
    for (let i = 0; i < levels; i++) {
      const next = canvas(cur.width / 2, cur.height / 2), n = next.getContext('2d');
      n.imageSmoothingQuality = 'high'; n.drawImage(cur, 0, 0, next.width, next.height);
      chain.push(next); cur = next;
    }
    smooth(cur); smooth(cur);
    for (let i = chain.length - 2; i >= 0; i--) {
      const up = canvas(chain[i].width, chain[i].height), u = up.getContext('2d');
      u.imageSmoothingQuality = 'high'; u.drawImage(cur, 0, 0, up.width, up.height);
      smooth(up);
      cur = up;
    }
    o.drawImage(cur, pad, pad, W, H, 0, 0, W, H);
    return out;
  });
}

/* 采样背景平均亮度，决定「自动」文字颜色。 */
function averageLight(img) {
  const c = canvas(8, 8), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 8, 8);
  const d = ctx.getImageData(0, 0, 8, 8).data;
  // 按不透明度加权：背景缩小后露出的透明区域不算进亮度里
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; r += d[i] * a; g += d[i + 1] * a; b += d[i + 2] * a; n += a; }
  return n ? isLight(r / n, g / n, b / n) : true;
}

/* ── 截图 ─────────────────────────────────────────────────────────── */
function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/* ── 手机：全部自己画，不用任何图片素材 ─────────────────────────────
   由外到内：侧键（压在机身后面）→ 钛金属中框（左右两道高光）→ 黑色玻璃边 → 屏幕 → 灵动岛（带镜头）。
   尺寸都按机身宽度 w 的比例算，导出多大都一样精细。 */
export const phoneRadius = (w) => w * 0.155;
function metal(ctx, x, w, dark = false) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  const [edge, hi, mid] = dark ? ['#2a2c30', '#6d7178', '#1f2124'] : ['#3b3e44', '#9a9ea6', '#2c2e33'];
  g.addColorStop(0, edge); g.addColorStop(.035, hi); g.addColorStop(.09, mid);
  g.addColorStop(.91, mid); g.addColorStop(.965, hi); g.addColorStop(1, edge);
  return g;
}
function drawPhone(ctx, shot, box, s) {
  const { x, y, w, h } = box, R = phoneRadius(w);
  const band = w * PHONE_BAND, bezel = w * phoneBezel(s.frameThick);
  // 侧键：左边操作键 + 音量两颗，右边电源键；凸出机身一点点，画在机身之前，被机身压住根部
  const p = w * 0.011, keyR = w * 0.006;
  const key = (kx, ky, kh) => { roundRect(ctx, kx, y + h * ky, p * 2, h * kh, keyR); ctx.fillStyle = metal(ctx, kx, p * 2, true); ctx.fill(); };
  key(x - p, .165, .032); key(x - p, .225, .058); key(x - p, .298, .058); key(x + w - p, .255, .092);
  // 中框
  roundRect(ctx, x, y, w, h, R); ctx.fillStyle = metal(ctx, x, w); ctx.fill();
  // 上下两端的弧面反光：一道很淡的竖向渐变
  const v = ctx.createLinearGradient(0, y, 0, y + h);
  v.addColorStop(0, '#ffffff1f'); v.addColorStop(.06, '#ffffff00'); v.addColorStop(.94, '#00000000'); v.addColorStop(1, '#00000033');
  ctx.fillStyle = v; ctx.fill();
  ctx.lineWidth = Math.max(1, w * .0025); ctx.strokeStyle = '#0000004d'; ctx.stroke();
  // 玻璃面板（黑边）
  const gx = x + band, gy = y + band, gw = w - band * 2, gh = h - band * 2, gr = R - band;
  roundRect(ctx, gx, gy, gw, gh, gr); ctx.fillStyle = '#050608'; ctx.fill();
  ctx.lineWidth = Math.max(1, w * .002); ctx.strokeStyle = '#ffffff17'; roundRect(ctx, gx + ctx.lineWidth, gy + ctx.lineWidth, gw - ctx.lineWidth * 2, gh - ctx.lineWidth * 2, gr - ctx.lineWidth); ctx.stroke();
  // 屏幕
  const sx = gx + bezel, sy = gy + bezel, sw = gw - bezel * 2, sh = gh - bezel * 2, sr = Math.max(w * .05, gr - bezel * .95);
  ctx.save(); roundRect(ctx, sx, sy, sw, sh, sr); ctx.clip();
  ctx.fillStyle = '#fff'; ctx.fillRect(sx, sy, sw, sh);
  ctx.translate(sx, sy); drawCover(ctx, shot, sw, sh, 'top');
  ctx.restore();
  // 灵动岛 + 前置镜头
  const iw = sw * 0.31, ih = sw * 0.09, ix = sx + (sw - iw) / 2, iy = sy + sw * 0.032;
  roundRect(ctx, ix, iy, iw, ih, ih / 2); ctx.fillStyle = '#000'; ctx.fill();
  const lr = ih * .27, lx = ix + iw - ih / 2, ly = iy + ih / 2;
  const lens = ctx.createRadialGradient(lx - lr * .3, ly - lr * .3, lr * .1, lx, ly, lr);
  lens.addColorStop(0, '#2b3a5c'); lens.addColorStop(.6, '#0d1322'); lens.addColorStop(1, '#05070c');
  ctx.beginPath(); ctx.arc(lx, ly, lr, 0, Math.PI * 2); ctx.fillStyle = lens; ctx.fill();
  ctx.beginPath(); ctx.arc(lx - lr * .35, ly - lr * .35, lr * .22, 0, Math.PI * 2); ctx.fillStyle = '#ffffff40'; ctx.fill();
}

function drawShot(ctx, shot, box, s, W) {
  const { x, y, w, h } = box;
  const radius = s.frame === 'phone' ? phoneRadius(w) : (s.radius / 400) * w;
  // 阴影：先用同形状的实心块投影，再把内容盖上去，内容本身不会被阴影染色
  const k = s.shadow / 100;
  if (k > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(10,16,30,${0.18 + 0.32 * k})`;
    ctx.shadowBlur = W * 0.07 * k;
    ctx.shadowOffsetY = W * 0.022 * k;
    roundRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = s.frame === 'phone' ? '#10151f' : '#ffffff';
    ctx.fill();
    ctx.restore();
  }
  if (s.frame === 'phone') { drawPhone(ctx, shot, box, s); return; }
  ctx.save();
  roundRect(ctx, x, y, w, h, radius); ctx.clip();
  let cy = y;
  if (s.frame === 'browser') {
    const bar = w * browserBar(s.frameThick);
    ctx.fillStyle = '#f4f5f7'; ctx.fillRect(x, y, w, bar);
    ctx.fillStyle = '#0000000f'; ctx.fillRect(x, y + bar - Math.max(1, w * .001), w, Math.max(1, w * .001));
    // 红黄绿三个点和地址栏跟着标题栏的高度走，但不超过默认大小的 1.25 倍，免得粗边框时显得笨重
    const u = Math.min(bar, w * BROWSER_UNIT * 1.25);
    const dot = u * 0.22, gap = u * 0.34;
    ['#ff6b6b', '#fcc419', '#51cf66'].forEach((c, i) => { ctx.beginPath(); ctx.arc(x + u * 0.62 + i * (dot * 2 + gap * .45), y + bar / 2, dot, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); });
    const uw = w * 0.36, uh = u * 0.5;
    roundRect(ctx, x + (w - uw) / 2, y + (bar - uh) / 2, uw, uh, uh / 2); ctx.fillStyle = '#0000000d'; ctx.fill();
    if (s.url) { ctx.fillStyle = '#5c5c5c'; ctx.font = `${uh * 0.58}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s.url, x + w / 2, y + bar / 2, uw * 0.9); }
    cy = y + bar;
  }
  ctx.drawImage(shot, x, cy, w, y + h - cy);
  ctx.restore();
}

/* ── 文字 ─────────────────────────────────────────────────────────
   一边画一边记下每段文字的位置（regions），页面据此在预览上叠点击 / 拖动区：
   { field:'title'|'sub', x, y, w, h（文字外框）, edit:{ x, y, w }（编辑框位置和换行宽度）,
     font, size, lh, align, alpha }
   s.pos：画面上拖动后的偏移 { title:[dx,dy], sub:[dx,dy] }（按画布宽高的比例）；s.titleSize / s.subSize：字号百分比。
   s.interactive：预览里，空字段也要留一块位置，好让用户点回去重新输入（导出时不画也不占位）。
   s.hide：正在编辑的字段，画布上先不画它，由编辑框原地显示。 */
function drawText(ctx, s, W, H, ink, alphaK, shotBox) {
  const t = TEMPLATES[s.tpl];
  const regions = [];
  if (!t || !s.tpl) return regions;
  const u = Math.sqrt(W * H) / 100;
  const kT = (s.titleSize ?? 100) / 100, kS = (s.subSize ?? 100) / 100;
  const off = (field) => { const p = s.pos?.[field] || [0, 0]; return [p[0] * W, p[1] * H]; };
  const title = (s.title || '').trim(), sub = (s.sub || '').trim();
  const shown = (field) => s.hide !== field;
  ctx.fillStyle = ink; ctx.textBaseline = 'alphabetic';

  if (t.tag) {                                        // 角标签：左上胶囊 + 右下署名
    const fs = t.title * u * kT, pad = fs * .7, m = Math.min(W, H) * .05, th = fs * 2;
    if (title || s.interactive) {
      const [ox, oy] = off('title'), x0 = m + ox, y0 = m + oy;
      const font = `600 ${fs}px ${MONO}`;
      ctx.font = font;
      const tw = Math.min(ctx.measureText(title).width, W * .6);
      if (title) {
        ctx.globalAlpha = alphaK;
        roundRect(ctx, x0, y0, tw + pad * 2, th, th / 2); ctx.fillStyle = ink === '#ffffff' ? '#ffffff26' : '#ffffffc7'; ctx.fill();
        ctx.fillStyle = ink;
        if (shown('title')) { ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(title, x0 + pad, y0 + th / 2, W * .6); }
        ctx.globalAlpha = 1;
      }
      regions.push({ field: 'title', x: x0, y: y0, w: Math.max(tw, fs) + pad * 2, h: th,
        edit: { x: x0 + pad, y: y0 + (th - fs * 1.3) / 2, w: W * .6 }, font, size: fs, lh: 1.3, align: 'left', alpha: 1 });
    }
    if (sub || s.interactive) {
      const [ox, oy] = off('sub');
      const size = t.sub * u * kS, font = `400 ${size}px ${FONT}`, right = W - m + ox, base = H - m + oy;
      ctx.font = font; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'right'; ctx.fillStyle = ink;
      const sw = Math.min(ctx.measureText(sub).width, W * .6);
      if (sub && shown('sub')) { ctx.globalAlpha = .75 * alphaK; ctx.fillText(sub, right, base, W * .6); ctx.globalAlpha = 1; }
      regions.push({ field: 'sub', x: right - Math.max(sw, size), y: base - size, w: Math.max(sw, size), h: size * 1.3,
        edit: { x: right - W * .6, y: base - size * 1.05, w: W * .6 }, font, size, lh: 1.3, align: 'right', alpha: .75 });
    }
    return regions;
  }

  const box = textBox(s.tpl, W, H);
  const blocks = [];                                  // [{ field, lines, font, size, alpha, gap, lh, ghost }]
  const measureWith = (font) => { ctx.font = font; return (txt) => ctx.measureText(txt).width; };
  if (t.quote) {
    const qs = t.title * kT * u;
    blocks.push({ owner: 'title', lines: ['“'], font: `700 ${qs * 2.6}px Georgia,"Times New Roman",serif`, size: qs * 2.6 * .55, alpha: .35, gap: qs * .2 });
  }
  if (t.behind) {
    // 杂志大字只占一行：按文字区宽度把字号收到正好放下，而不是折行（第二行会被截图挡住）；字号滑块在此基础上再放大缩小
    let size = t.title * u;
    const w = measureWith(`650 ${size}px ${FONT}`)(title || '点');
    if (w > box.w) size *= box.w / w;
    size *= kT;
    if (title || s.interactive) blocks.push({ field: 'title', lines: [title], font: `650 ${size}px ${FONT}`, size, alpha: .92, gap: 0, lh: 1.05, ghost: !title });
  } else if (title || s.interactive) {
    const size = t.title * u * kT, font = `${t.quote ? 500 : 600} ${size}px ${FONT}`;
    blocks.push({ field: 'title', lines: title ? wrapLines(title, box.w, measureWith(font), 3) : [''], font, size, alpha: 1, gap: title ? size * .45 : 0, lh: 1.18, ghost: !title });
  }
  if (t.bullets) {
    const size = t.sub * u * kS, font = `400 ${size}px ${FONT}`;
    const items = bulletsOf(sub);
    if (items.length || s.interactive) blocks.push({ field: 'sub', lines: items.length ? items.map(b => '✓  ' + b) : [''], font, size, alpha: .82, gap: 0, lh: 1.7, ghost: !items.length });
  } else if (!t.behind && (sub || s.interactive)) {
    const size = t.sub * u * kS, font = `400 ${size}px ${t.quote ? MONO : FONT}`;
    blocks.push({ field: 'sub', lines: sub ? wrapLines((t.quote ? '— ' : '') + sub, box.w, measureWith(font), 2) : [''], font, size, alpha: .72, gap: 0, lh: 1.4, ghost: !sub });
  }
  // 空字段（ghost）不占高度，导出和预览的排版因此完全一致
  const height = blocks.reduce((sum, b) => b.ghost ? sum : sum + b.lines.length * b.size * (b.lh || 1) + b.gap, 0);
  let y = t.valign === 'top' ? box.y : box.y + (box.h - height) / 2;
  // 杂志大字：让标题下缘约三分之一压在截图后面，不管画幅横竖都有「被截图挡住一截」的效果（跟着截图走）
  if (t.behind && shotBox && blocks[0]) y = clamp(shotBox.y - blocks[0].size * 0.72, H * 0.02, H * 0.9);
  const center = t.align === 'center';
  const x = center ? box.x + box.w / 2 : box.x;
  ctx.textAlign = center ? 'center' : 'left';
  for (const b of blocks) {
    const [ox, oy] = off(b.field || b.owner);
    ctx.font = b.font;
    const lh = b.size * (b.lh || 1), top = y;
    let maxW = 0;
    if (!b.ghost) {
      ctx.globalAlpha = b.alpha * alphaK;
      for (const line of b.lines) {
        y += lh;
        const base = y - b.size * (b.lh ? (b.lh - 1) / 2 + .18 : 0);
        if (!b.field || shown(b.field)) ctx.fillText(line, x + ox, base + oy);
        maxW = Math.max(maxW, ctx.measureText(line).width);
      }
      y += b.gap;
    }
    if (b.field) {
      const bw = Math.max(maxW, b.size);
      regions.push({ field: b.field, x: (center ? x - bw / 2 : x) + ox, y: top + oy, w: bw, h: b.ghost ? lh : b.lines.length * lh,
        edit: { x: box.x + ox, y: top + oy, w: box.w }, font: b.font, size: b.size, lh: b.lh || 1, align: center ? 'center' : 'left', alpha: b.alpha });
    }
  }
  ctx.globalAlpha = 1;
  return regions;
}

/* 文字颜色：'auto' 按背景亮度取深 / 浅；其余是十六进制色。旧设置里的 black / white 照旧能用。 */
export function resolveInk(ink, bgIsLight) {
  if (ink === 'black') return '#16202e';
  if (ink === 'white') return '#ffffff';
  if (/^#[0-9a-f]{6}$/i.test(ink || '')) return ink.toLowerCase();
  return bgIsLight ? '#16202e' : '#ffffff';
}

/* ── 整张 ─────────────────────────────────────────────────────────
   s：{ bg:{ key, src, solid, image, rheo, blur }, frame, frameThick, radius, shadow, scale, tpl, title, sub, ink, inkAlpha,
        pos:{ shot, title, sub }, titleSize, subSize, interactive, hide }
   shot：已经裁好的截图（canvas 或 ImageBitmap）。返回文字区域（见 drawText）和截图的框，预览用来做点选、拖动和编辑。 */
export function renderScene(ctx, W, H, s, shot) {
  const bg = blurred(s.bg, W, H);
  ctx.drawImage(bg, 0, 0, W, H);
  const aspect = frameAspect(s.frame, shot.width / shot.height, s.frameThick);
  const box = placeShot(s.tpl, W, H, aspect, s.scale, s.pos?.shot);
  const ink = resolveInk(s.ink, remember(`ink|${s.bg.key}|${s.bg.blur}`, () => averageLight(bg)));
  const alphaK = (s.inkAlpha ?? 100) / 100;
  const behind = TEMPLATES[s.tpl]?.behind;
  let regions = [];
  if (behind) regions = drawText(ctx, s, W, H, ink, alphaK, box);
  drawShot(ctx, shot, box, s, W);
  if (!behind) regions = drawText(ctx, s, W, H, ink, alphaK, box);
  return { regions, ink, shot: box };
}

/* Rise 复用同一套背景（Rheo / 纯色 / 导入图片 + 模糊 + 大小）：给出画好的背景层和它亮不亮 */
export function backgroundLayer(bg, W, H) {
  const layer = blurred(bg, W, H);
  return { canvas: layer, light: remember(`ink|${bg.key}|${bg.blur}|${W}x${H}`, () => averageLight(layer)) };
}

export { canvas as makeCanvas, roundRect };
