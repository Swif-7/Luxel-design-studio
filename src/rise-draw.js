// Rise 的绘制：静态层（卡片、文字、图例）和动态层（图表本身，随时间 t 生长）。
// 只依赖 rise-core.js —— 导出 HTML 时这两个文件原样内联，页面里预览、PNG、视频、HTML 用的是同一份代码。
import { clamp, progress, niceScale, formatValue, FONTS, TEXT } from './rise-core.js';

const TAU = Math.PI * 2;

/* ── 小工具 ────────────────────────────────────────────────────────── */
function rr(ctx, x, y, w, h, r) {
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  const [a, b, c, d] = Array.isArray(r) ? r : [r, r, r, r];
  const k = (v) => Math.max(0, Math.min(v, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + k(a), y);
  ctx.arcTo(x + w, y, x + w, y + h, k(b)); ctx.arcTo(x + w, y + h, x, y + h, k(c));
  ctx.arcTo(x, y + h, x, y, k(d)); ctx.arcTo(x, y, x + w, y, k(a)); ctx.closePath();
}
function rng(seed) {                                   // mulberry32：手绘抖动每帧一致，不会闪
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const alpha = (hex, a) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
  return '#' + full + Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, '0');
};
const font = (st, size, weight = st.weight) => `${weight} ${size}px ${FONTS[st.font] || FONTS.sans}`;

/* 填充一个形状：path() 负责描路径，dir 是「长出来」的方向（渐变沿它走）。 */
function paint(ctx, path, color, st, u, bounds, seed = 1, dir = 'up') {
  const { x, y, w, h } = bounds;
  ctx.save();
  if (st.glow) { ctx.shadowColor = color; ctx.shadowBlur = u * 1.6; }
  if (st.fill === 'glass') {
    // 玻璃：先在形状后面垫一团同色光晕（用投影画，Safari 也支持），再盖一层白色半透明渐变和高光描边
    ctx.save();
    ctx.shadowColor = alpha(color, .9); ctx.shadowBlur = u * 2.2; ctx.shadowOffsetX = 10000;
    ctx.translate(-10000, 0); path(); ctx.fillStyle = color; ctx.fill();
    ctx.restore();
    path();
    const g = ctx.createLinearGradient(x, y, x, y + Math.max(1, h));
    g.addColorStop(0, '#ffffffc0'); g.addColorStop(.55, '#ffffff52'); g.addColorStop(1, '#ffffff7a');
    ctx.fillStyle = alpha(color, .35); ctx.fill();
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = Math.max(1, u * .12); ctx.strokeStyle = '#ffffffd0'; ctx.stroke();
  } else if (st.fill === 'gradient') {
    const g = dir === 'right' ? ctx.createLinearGradient(x, 0, x + Math.max(1, w), 0)
      : dir === 'radial' ? null : ctx.createLinearGradient(0, y + h, 0, y);
    if (g) { g.addColorStop(0, alpha(color, .45)); g.addColorStop(1, color); }
    path(); ctx.fillStyle = g || color; ctx.fill();
  } else if (st.fill === 'hatch' || st.fill === 'sketch') {
    const r = rng(seed), sketch = st.fill === 'sketch';
    path(); ctx.fillStyle = alpha(color, sketch ? .12 : .16); ctx.fill();
    ctx.save(); path(); ctx.clip();
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, u * (sketch ? .22 : .14));
    const gap = u * (sketch ? .9 : .7), span = w + h;
    ctx.beginPath();
    for (let d = -h; d < span; d += gap) {
      const j = sketch ? (r() - .5) * gap * .5 : 0;
      ctx.moveTo(x + d + j, y + h + 2); ctx.lineTo(x + d + h + j + (sketch ? (r() - .5) * gap : 0), y - 2);
    }
    ctx.stroke(); ctx.restore();
    ctx.lineWidth = Math.max(1, u * (sketch ? .3 : .2)); ctx.strokeStyle = color;
    if (sketch) {
      for (let pass = 0; pass < 2; pass++) { ctx.save(); ctx.translate((r() - .5) * u * .35, (r() - .5) * u * .35); path(); ctx.stroke(); ctx.restore(); }
    } else { path(); ctx.stroke(); }
  } else {
    path(); ctx.fillStyle = color; ctx.fill();
  }
  ctx.restore();
}

/* 线条（折线、雷达边）：手绘风格描两遍、各自抖一点。 */
function strokeLine(ctx, pts, color, st, u, { smooth = false, width = .42, seed = 1 } = {}) {
  const trace = (dx = 0, dy = 0) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      if (!i) return ctx.moveTo(x + dx, y + dy);
      if (!smooth) return ctx.lineTo(x + dx, y + dy);
      const p0 = pts[i - 2] || pts[i - 1], p1 = pts[i - 1], p2 = pts[i], p3 = pts[i + 1] || p2;
      ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6 + dx, p1[1] + (p2[1] - p0[1]) / 6 + dy, p2[0] - (p3[0] - p1[0]) / 6 + dx, p2[1] - (p3[1] - p1[1]) / 6 + dy, p2[0] + dx, p2[1] + dy);
    });
  };
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = u * width * (st.heavy ? 1.5 : 1);
  if (st.glow) { ctx.shadowColor = color; ctx.shadowBlur = u * 1.6; }
  if (st.fill === 'sketch') { const r = rng(seed); for (let k = 0; k < 2; k++) { trace((r() - .5) * u * .4, (r() - .5) * u * .4); ctx.stroke(); } }
  else { trace(); ctx.stroke(); }
  ctx.restore();
  return trace;
}

function text(ctx, str, x, y, { size, st, color, align = 'left', base = 'alphabetic', weight, a = 1, max }) {
  ctx.save();
  ctx.font = font(st, size, weight ?? 400); ctx.fillStyle = color; ctx.globalAlpha *= a;
  ctx.textAlign = align; ctx.textBaseline = base;
  if (max) ctx.fillText(str, x, y, max); else ctx.fillText(str, x, y);
  ctx.restore();
}

/* ── 坐标轴（柱、线、面积、棒棒糖、堆叠）───────────────────────────── */
function cartesian(ctx, c, d, horizontal = false) {
  const { box } = c, u = d.u, st = d.style;
  const N = Math.max(...c.series.map(s => s.values.length));
  const stacked = c.type === 'stack';
  const all = stacked
    ? Array.from({ length: N }, (_, i) => c.series.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0)).concat(Array.from({ length: N }, (_, i) => c.series.reduce((a, s) => a + Math.min(0, s.values[i] || 0), 0)))
    : c.series.flatMap(s => s.values);
  const sc = niceScale(Math.min(...all), Math.max(...all), 5);
  const ls = TEXT.label * u;
  ctx.font = font(st, ls, 400);
  const tickW = Math.max(...sc.ticks.map(v => ctx.measureText(formatValue(v, { ...c.fmt, decimals: 'auto' })).width));
  const labels = Array.from({ length: N }, (_, i) => c.labels?.[i] ?? String(i + 1));
  const labelW = Math.max(...labels.map(l => ctx.measureText(l).width));
  const P = horizontal
    ? { x: box.x + Math.min(labelW + u * 1.5, box.w * .3), y: box.y + u, w: 0, h: box.h - ls * 2.4 - u }
    : { x: box.x + (d.show.grid ? tickW + u * 1.4 : u), y: box.y + (d.show.values ? ls * 2 : u), w: 0, h: 0 };
  if (horizontal) P.w = box.x + box.w - P.x - (d.show.values ? tickW + u * 2 : u);
  else { P.w = box.x + box.w - P.x - u * .5; P.h = box.y + box.h - P.y - ls * 2.2; }
  const toV = (v) => horizontal ? P.x + (v - sc.min) / (sc.max - sc.min) * P.w : P.y + P.h - (v - sc.min) / (sc.max - sc.min) * P.h;
  // 网格与刻度
  const gp = progress(d.t, 0, 1, { ...d.anim, dur: Math.min(.5, d.anim.dur), effect: 'grow', ease: 'out' });
  ctx.save(); ctx.globalAlpha *= gp;
  if (d.show.grid) {
    ctx.strokeStyle = st.grid && d.onPanel ? st.grid : alpha(d.ink, .14); ctx.lineWidth = Math.max(1, u * .1);
    if (st.dashed) ctx.setLineDash([u * .6, u * .5]);
    for (const v of sc.ticks) {
      const p = toV(v);
      ctx.beginPath();
      if (horizontal) { ctx.moveTo(p, P.y); ctx.lineTo(p, P.y + P.h); } else { ctx.moveTo(P.x, p); ctx.lineTo(P.x + P.w, p); }
      ctx.stroke();
      if (horizontal) text(ctx, formatValue(v, { ...c.fmt, decimals: 'auto' }), p, P.y + P.h + ls * 1.5, { size: ls, st, color: d.ink, a: .5, align: 'center' });
      else text(ctx, formatValue(v, { ...c.fmt, decimals: 'auto' }), P.x - u * .8, p, { size: ls, st, color: d.ink, a: .5, align: 'right', base: 'middle' });
    }
    ctx.setLineDash([]);
  }
  // 零线
  ctx.strokeStyle = alpha(d.ink, .35); ctx.lineWidth = Math.max(1, u * .14);
  ctx.beginPath();
  const z = toV(0);
  if (horizontal) { ctx.moveTo(z, P.y); ctx.lineTo(z, P.y + P.h); } else { ctx.moveTo(P.x, z); ctx.lineTo(P.x + P.w, z); }
  ctx.stroke();
  // 类别标签：放不下就隔几个显示一个
  const slot = (horizontal ? P.h : P.w) / N;
  const every = horizontal ? Math.max(1, Math.ceil(ls * 1.4 / slot)) : Math.max(1, Math.ceil((labelW + u) / slot));
  labels.forEach((l, i) => {
    if (i % every) return;
    const m = (horizontal ? P.y : P.x) + slot * (i + .5);
    if (horizontal) text(ctx, l, P.x - u * .8, m, { size: ls, st, color: d.ink, a: .7, align: 'right', base: 'middle', max: P.x - box.x - u });
    else text(ctx, l, m, P.y + P.h + ls * 1.55, { size: ls, st, color: d.ink, a: .7, align: 'center', max: slot * every * .95 });
  });
  ctx.restore();
  return { P, sc, N, toV, slot, ls, labels };
}

function valueLabel(ctx, d, c, v, p, x, y, align = 'center', base = 'alphabetic') {
  if (!d.show.values || p <= .02) return;
  text(ctx, formatValue(v * Math.min(1, p), c.fmt), x, y, { size: TEXT.label * d.u, st: d.style, color: d.ink, a: Math.min(1, p) * .85, align, base, weight: d.style.weight });
}

function bars(ctx, c, d, horizontal) {
  const { P, N, toV, slot } = cartesian(ctx, c, d, horizontal);
  const S = c.series.length, u = d.u, st = d.style, stacked = c.type === 'stack';
  const groupW = slot * (stacked ? .56 : .72), bw = stacked ? groupW : groupW / S;
  const dense = N * (stacked ? 1 : S) > 28;
  const base = toV(0);
  for (let i = 0; i < N; i++) {
    const p = progress(d.t, i, N, d.anim), grow = d.anim.effect === 'fade' ? 1 : p, a = d.anim.effect === 'fade' ? p : 1;
    if (p <= 0) continue;
    let acc = 0, accNeg = 0;
    c.series.forEach((s, k) => {
      const v = s.values[i];
      if (v === undefined) return;
      const start = stacked ? (v >= 0 ? acc : accNeg) : 0;
      if (stacked) { if (v >= 0) acc += v; else accNeg += v; }
      const off = (horizontal ? P.y : P.x) + slot * i + (slot - groupW) / 2 + (stacked ? 0 : k * bw);
      const from = toV(start * grow), to = toV((start + v) * grow);        // 堆叠时下面的段也在长，起点跟着一起缩放，不会悬空
      const len = to - from, th = bw * (dense || S === 1 ? .82 : .88);
      const rad = Math.min(th * st.radius, Math.abs(len));
      const b = horizontal ? { x: Math.min(from, to), y: off + (bw - th) / 2, w: Math.abs(len), h: th } : { x: off + (bw - th) / 2, y: Math.min(from, to), w: th, h: Math.abs(len) };
      const positive = v >= 0;
      const corners = horizontal ? (positive ? [0, rad, rad, 0] : [rad, 0, 0, rad]) : (positive ? [rad, rad, 0, 0] : [0, 0, rad, rad]);
      ctx.save(); ctx.globalAlpha *= a;
      if (c.type === 'lollipop') {
        const mid = horizontal ? b.y + b.h / 2 : b.x + b.w / 2, r = Math.min(th * .5, u * 1.3);
        ctx.strokeStyle = s.color; ctx.lineWidth = Math.max(1, u * .32);
        if (st.glow) { ctx.shadowColor = s.color; ctx.shadowBlur = u; }
        ctx.beginPath();
        if (horizontal) { ctx.moveTo(from, mid); ctx.lineTo(to, mid); } else { ctx.moveTo(mid, from); ctx.lineTo(mid, to); }
        ctx.stroke();
        const cx = horizontal ? to : mid, cy = horizontal ? mid : to;
        paint(ctx, () => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); }, s.color, st, u, { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }, i * 7 + k);
      } else {
        paint(ctx, () => rr(ctx, b.x, b.y, b.w, b.h, stacked && k < c.series.length - 1 ? 0 : corners), s.color, st, u, b, i * 7 + k, horizontal ? 'right' : 'up');
      }
      ctx.restore();
      if (!stacked && !dense) {
        const pad = c.type === 'lollipop' ? Math.min(th * .5, u * 1.3) + u * .6 : u * .8;      // 棒棒糖的数值要让开圆头
        if (horizontal) valueLabel(ctx, d, c, v, p, to + (positive ? pad : -pad), b.y + b.h / 2, positive ? 'left' : 'right', 'middle');
        else valueLabel(ctx, d, c, v, p, b.x + b.w / 2, positive ? to - pad : to + pad + TEXT.label * u * .9);
      }
    });
    if (stacked && !dense) {
      const tot = c.series.reduce((sum, s) => sum + (s.values[i] || 0), 0);
      const end = toV(acc * grow);
      const mid = (horizontal ? P.y : P.x) + slot * (i + .5);
      if (horizontal) valueLabel(ctx, d, c, tot, p, end + u * .8, mid, 'left', 'middle');
      else valueLabel(ctx, d, c, tot, p, mid, end - u * .8);
    }
  }
}

function lines(ctx, c, d) {
  const { P, N, toV, slot } = cartesian(ctx, c, d, false);
  const u = d.u, st = d.style, S = c.series.length;
  c.series.forEach((s, k) => {
    const p = progress(d.t, k, S, d.anim), fade = d.anim.effect === 'fade';
    if (p <= 0) return;
    const pts = s.values.map((v, i) => [P.x + slot * (i + .5), toV(v)]);
    const reach = fade ? Infinity : P.x + (pts.at(-1)[0] - P.x + u) * Math.min(1, p);
    ctx.save();
    if (fade) ctx.globalAlpha *= Math.min(1, p);
    ctx.beginPath(); ctx.rect(P.x - u * 2, P.y - u * 6, reach - P.x + u * 2, P.h + u * 12); ctx.clip();
    const smooth = c.type === 'smooth' || c.type === 'area';
    if (c.type === 'area') {
      const trace = () => {
        ctx.beginPath(); ctx.moveTo(pts[0][0], toV(0));
        pts.forEach(([x, y], i) => {
          if (!i) return ctx.lineTo(x, y);
          const p0 = pts[i - 2] || pts[i - 1], p1 = pts[i - 1], p3 = pts[i + 1] || [x, y];
          ctx.bezierCurveTo(p1[0] + (x - p0[0]) / 6, p1[1] + (y - p0[1]) / 6, x - (p3[0] - p1[0]) / 6, y - (p3[1] - p1[1]) / 6, x, y);
        });
        ctx.lineTo(pts.at(-1)[0], toV(0)); ctx.closePath();
      };
      const top = Math.min(...pts.map(q => q[1]));
      if (st.fill === 'hatch' || st.fill === 'sketch' || st.fill === 'glass') paint(ctx, trace, s.color, { ...st, glow: false }, u, { x: P.x, y: top, w: P.w, h: toV(0) - top }, k + 3);
      else {
        const g = ctx.createLinearGradient(0, top, 0, toV(0));
        g.addColorStop(0, alpha(s.color, S > 1 ? .38 : .5)); g.addColorStop(1, alpha(s.color, 0));
        trace(); ctx.fillStyle = g; ctx.fill();
      }
    }
    strokeLine(ctx, pts, s.color, st, u, { smooth, seed: k + 11 });
    ctx.restore();
    // 数据点：线画到哪，点就冒到哪
    const dots = N <= 16;
    pts.forEach(([x, y], i) => {
      const on = fade ? Math.min(1, p) : clamp((reach - x) / (u * 2), 0, 1);
      if (on <= 0) return;
      if (dots) {
        ctx.save(); ctx.globalAlpha *= on;
        ctx.beginPath(); ctx.arc(x, y, u * .62 * (st.heavy ? 1.3 : 1), 0, TAU);
        ctx.fillStyle = d.onPanel ? d.panel : '#ffffff'; if (d.style.fill === 'glass') ctx.fillStyle = '#ffffff';
        ctx.fill(); ctx.lineWidth = u * .32; ctx.strokeStyle = s.color; ctx.stroke();
        ctx.restore();
      }
      if (S <= 2 && N <= 12) valueLabel(ctx, d, c, s.values[i], on, x, y - u * 1.4);
    });
  });
}

/* ── 饼 / 环 / 玫瑰 ──────────────────────────────────────────────────── */
const firstSeries = (c) => c.series[0] || { values: [], color: '#888' };
const itemColor = (c, d, i) => d.style.palette[i % d.style.palette.length];

function pies(ctx, c, d) {
  const s = firstSeries(c), u = d.u, st = d.style, box = c.box;
  const vals = s.values.map(v => Math.max(0, v)), total = vals.reduce((a, b) => a + b, 0) || 1;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2, R = Math.min(box.w, box.h) / 2 * .88;
  const donut = c.type === 'donut', rose = c.type === 'rose', inner = donut ? R * .6 : 0;
  const max = Math.max(...vals) || 1;
  const sweep = progress(d.t, 0, 1, { ...d.anim, stagger: 0 });
  let a0 = -Math.PI / 2;
  vals.forEach((v, i) => {
    const share = rose ? 1 / vals.length : v / total;
    const pi = progress(d.t, i, vals.length, d.anim);
    const fade = d.anim.effect === 'fade';
    const span = share * TAU * (rose || fade ? 1 : clamp(sweep, 0, 1.2));
    const r = rose ? inner + (R - inner) * (.18 + .82 * Math.sqrt(v / max)) * (fade ? 1 : Math.max(0, pi)) : R;
    const gap = vals.length > 1 ? Math.min(u * .25, span * r * .1) / Math.max(r, 1) : 0;
    const from = a0 + gap / 2, to = a0 + span - gap / 2;
    if (to > from && r > inner) {
      ctx.save(); if (fade) ctx.globalAlpha *= Math.min(1, pi);
      paint(ctx, () => { ctx.beginPath(); ctx.arc(cx, cy, r, from, to); if (inner) ctx.arc(cx, cy, inner, to, from, true); else ctx.lineTo(cx, cy); ctx.closePath(); },
        itemColor(c, d, i), st, u, { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }, i + 21, 'radial');
      ctx.restore();
      // 占比标签：扇区够大才放
      const shown = fade ? Math.min(1, pi) : clamp((sweep - (a0 + Math.PI / 2) / TAU - share * .5) * 6, 0, 1);
      if (d.show.values && shown > 0 && (rose || share >= .06)) {
        const mid = (from + to) / 2, lr = rose ? r + u * 2.2 : donut ? (R + inner) / 2 : R * .64;
        const label = rose ? formatValue(v, c.fmt) : Math.round(v / total * 100) + '%';
        const onShape = !rose;
        text(ctx, label, cx + Math.cos(mid) * lr, cy + Math.sin(mid) * lr, { size: TEXT.label * u * (onShape ? 1.05 : 1), st, color: onShape ? contrastOn(itemColor(c, d, i), st) : d.ink, align: 'center', base: 'middle', weight: st.weight, a: shown });
      }
    }
    a0 += share * TAU * (rose || fade ? 1 : clamp(sweep, 0, 1.2));
  });
  if (donut) {
    const p = Math.min(1, sweep);
    text(ctx, formatValue(total * p, c.fmt), cx, cy + u * .4, { size: TEXT.title * u * .9 * Math.min(1, R / (u * 22)), st, color: d.ink, align: 'center', base: 'middle', weight: st.weight });
    text(ctx, '合计', cx, cy + TEXT.title * u * .75 * Math.min(1, R / (u * 22)), { size: TEXT.label * u, st, color: d.ink, align: 'center', base: 'middle', a: .55 });
  }
}
/* 扇区里的文字：浅色块上用深字，深色块上用白字（玻璃风格的块是泛白的，一律深字） */
function contrastOn(hex, st) {
  if (st.fill === 'glass' || st.fill === 'hatch' || st.fill === 'sketch') return st.ink;
  const n = parseInt(hex.slice(1, 7), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#161b33' : '#ffffff';
}

/* ── 雷达 ─────────────────────────────────────────────────────────── */
function radar(ctx, c, d) {
  const N = Math.max(...c.series.map(s => s.values.length));
  if (N < 3) return bars(ctx, { ...c, type: 'bar' }, d, false);
  const u = d.u, st = d.style, box = c.box, ls = TEXT.label * u;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2 + ls * .3, R = Math.min(box.w, box.h) / 2 - ls * 2.6;
  const sc = niceScale(0, Math.max(...c.series.flatMap(s => s.values)), 5);
  const ang = (i) => -Math.PI / 2 + i / N * TAU;
  const gp = progress(d.t, 0, 1, { ...d.anim, dur: Math.min(.5, d.anim.dur), ease: 'out', effect: 'grow' });
  ctx.save(); ctx.globalAlpha *= gp;
  ctx.strokeStyle = d.onPanel ? st.grid : alpha(d.ink, .14); ctx.lineWidth = Math.max(1, u * .1);
  if (st.dashed) ctx.setLineDash([u * .6, u * .5]);
  for (let ring = 1; ring <= 4; ring++) {
    ctx.beginPath();
    for (let i = 0; i <= N; i++) { const r = R * ring / 4; ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r); }
    ctx.stroke();
  }
  for (let i = 0; i < N; i++) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang(i)) * R, cy + Math.sin(ang(i)) * R); ctx.stroke(); }
  ctx.setLineDash([]);
  for (let i = 0; i < N; i++) {
    const a = ang(i), x = cx + Math.cos(a) * (R + ls * 1.3), y = cy + Math.sin(a) * (R + ls * 1.3);
    text(ctx, c.labels?.[i] ?? String(i + 1), x, y, { size: ls, st, color: d.ink, a: .7, align: Math.abs(Math.cos(a)) < .2 ? 'center' : Math.cos(a) > 0 ? 'left' : 'right', base: 'middle' });
  }
  ctx.restore();
  c.series.forEach((s, k) => {
    const p = progress(d.t, k, c.series.length, d.anim), fade = d.anim.effect === 'fade';
    if (p <= 0) return;
    const pts = s.values.map((v, i) => { const r = R * (v - sc.min) / (sc.max - sc.min) * (fade ? 1 : p); return [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r]; });
    ctx.save(); if (fade) ctx.globalAlpha *= Math.min(1, p);
    const path = () => { ctx.beginPath(); pts.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y)); ctx.closePath(); };
    if (st.fill === 'hatch' || st.fill === 'sketch') paint(ctx, path, s.color, { ...st, glow: false }, u, { x: cx - R, y: cy - R, w: 2 * R, h: 2 * R }, k + 5);
    else { path(); ctx.fillStyle = alpha(s.color, st.fill === 'glass' ? .3 : .22); ctx.fill(); }
    strokeLine(ctx, [...pts, pts[0]], s.color, st, u, { width: .36, seed: k + 3 });
    for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(x, y, u * .5, 0, TAU); ctx.fillStyle = s.color; ctx.fill(); }
    ctx.restore();
  });
}

/* ── 极坐标柱：每一项一圈，弧长表示大小 ───────────────────────────── */
function polar(ctx, c, d) {
  const s = firstSeries(c), u = d.u, st = d.style, box = c.box, n = s.values.length, ls = TEXT.label * u;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2, R = Math.min(box.w, box.h) / 2 * .92;
  const inner = R * .28, band = (R - inner) / Math.max(1, n), th = band * .7;
  const max = niceScale(0, Math.max(...s.values), 4).max, full = TAU * .75;
  s.values.forEach((v, i) => {
    const r = R - band * (i + .5), p = progress(d.t, i, n, d.anim), fade = d.anim.effect === 'fade';
    ctx.save(); ctx.lineCap = st.radius > 0 ? 'round' : 'butt';
    ctx.strokeStyle = d.onPanel ? st.grid : alpha(d.ink, .12); ctx.lineWidth = th;
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + full); ctx.stroke();
    if (p > 0) {
      if (fade) ctx.globalAlpha *= Math.min(1, p);
      const end = -Math.PI / 2 + full * Math.max(0, v) / max * (fade ? 1 : p);
      if (st.glow) { ctx.shadowColor = itemColor(c, d, i); ctx.shadowBlur = u * 1.4; }
      ctx.strokeStyle = itemColor(c, d, i);
      if (st.fill === 'glass') { ctx.strokeStyle = alpha(itemColor(c, d, i), .75); }
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, end); ctx.stroke();
    }
    ctx.restore();
    const size = Math.min(ls, th * .8);
    text(ctx, `${c.labels?.[i] ?? i + 1}`, cx - u * .9, cy - r, { size, st, color: d.ink, a: .75, align: 'right', base: 'middle', max: box.w / 2 - u });
    valueLabel(ctx, { ...d, u: u * Math.min(1, size / ls) }, c, v, p, cx + Math.cos(-Math.PI / 2 + full * v / max * Math.min(1, p)) * r, cy + Math.sin(-Math.PI / 2 + full * v / max * Math.min(1, p)) * r - th * .9, 'center', 'middle');
  });
}

/* ── 矩形树图（squarified）──────────────────────────────────────────── */
export function squarify(values, box) {
  const items = values.map((v, i) => ({ v: Math.max(0, v), i })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  const total = items.reduce((a, b) => a + b.v, 0);
  const out = [];
  if (!total) return out;
  let rect = { ...box }, rest = items.map(x => ({ ...x, area: x.v / total * box.w * box.h }));
  const worst = (row, side) => { const s = row.reduce((a, b) => a + b.area, 0), mx = Math.max(...row.map(r => r.area)), mn = Math.min(...row.map(r => r.area)); return Math.max(side * side * mx / (s * s), s * s / (side * side * mn)); };
  while (rest.length) {
    const side = Math.min(rect.w, rect.h);
    let row = [rest[0]], k = 1;
    while (k < rest.length && worst([...row, rest[k]], side) <= worst(row, side)) row.push(rest[k++]);
    rest = rest.slice(k);
    const s = row.reduce((a, b) => a + b.area, 0);
    if (rect.w >= rect.h) {
      const w = s / rect.h; let y = rect.y;
      for (const r of row) { const h = r.area / w; out.push({ i: r.i, x: rect.x, y, w, h }); y += h; }
      rect = { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h };
    } else {
      const h = s / rect.w; let x = rect.x;
      for (const r of row) { const w = r.area / h; out.push({ i: r.i, x, y: rect.y, w, h }); x += w; }
      rect = { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h };
    }
  }
  return out;
}
function treemap(ctx, c, d) {
  const s = firstSeries(c), u = d.u, st = d.style, gap = u * .5, ls = TEXT.label * u;
  const tiles = squarify(s.values, c.box);
  tiles.forEach((t, k) => {
    const p = progress(d.t, k, tiles.length, d.anim), fade = d.anim.effect === 'fade';
    if (p <= 0) return;
    const sc = fade ? 1 : Math.max(0, p);
    const w = (t.w - gap) * sc, h = (t.h - gap) * sc, x = t.x + gap / 2 + (t.w - gap - w) / 2, y = t.y + gap / 2 + (t.h - gap - h) / 2;
    const col = itemColor(c, d, t.i);
    ctx.save(); if (fade) ctx.globalAlpha *= Math.min(1, p);
    paint(ctx, () => rr(ctx, x, y, w, h, Math.min(w, h) * st.radius * .25 + (st.radius ? u * .6 : 0)), col, st, u, { x, y, w, h }, t.i + 31);
    ctx.restore();
    if (w > ls * 4 && h > ls * 3.4) {
      const ink = contrastOn(col, st), a = Math.min(1, p);
      text(ctx, c.labels?.[t.i] ?? String(t.i + 1), x + u * 1.1, y + ls * 1.7, { size: ls, st, color: ink, a: a * .8, max: w - u * 2 });
      if (d.show.values) text(ctx, formatValue(s.values[t.i] * Math.min(1, p), c.fmt), x + u * 1.1, y + ls * 1.7 + ls * 1.5, { size: ls * 1.25, st, color: ink, a, weight: st.weight, max: w - u * 2 });
    }
  });
}

/* ── 华夫格：100 格，按占比分配（最大余数法，保证总数正好 100） ──────── */
export function waffleCells(values, cells = 100) {
  const vals = values.map(v => Math.max(0, v)), total = vals.reduce((a, b) => a + b, 0);
  if (!total) return vals.map(() => 0);
  const raw = vals.map(v => v / total * cells), base = raw.map(Math.floor);
  let left = cells - base.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { base[i]++; left--; } });
  return base;
}
function waffle(ctx, c, d) {
  const s = firstSeries(c), u = d.u, st = d.style, box = c.box;
  const counts = waffleCells(s.values);
  const side = Math.min(box.w, box.h), cell = side / 10, x0 = box.x + (box.w - side) / 2, y0 = box.y + (box.h - side) / 2, g = cell * .14;
  const owner = counts.flatMap((n, i) => Array(n).fill(i));
  const p = progress(d.t, 0, 1, { ...d.anim, stagger: 0 });
  for (let k = 0; k < 100; k++) {
    const col = k % 10, row = Math.floor(k / 10);
    const x = x0 + col * cell + g / 2, y = y0 + row * cell + g / 2, w = cell - g;
    const on = d.anim.effect === 'fade' ? Math.min(1, p) : clamp(p * 110 - k, 0, 1);
    ctx.save();
    rr(ctx, x, y, w, w, w * Math.max(.18, st.radius * .6)); ctx.fillStyle = d.onPanel ? st.grid : alpha(d.ink, .1); ctx.fill();
    if (on > 0 && owner[k] !== undefined) {
      ctx.globalAlpha *= on;
      const sc = d.anim.effect === 'fade' ? 1 : .4 + .6 * on, ww = w * sc;
      paint(ctx, () => rr(ctx, x + (w - ww) / 2, y + (w - ww) / 2, ww, ww, ww * Math.max(.18, st.radius * .6)), itemColor(c, d, owner[k]), { ...st, glow: false }, u * .6, { x, y, w, h: w }, k);
    }
    ctx.restore();
  }
}

/* ── 漏斗 ─────────────────────────────────────────────────────────── */
function funnel(ctx, c, d) {
  const s = firstSeries(c), u = d.u, st = d.style, box = c.box, n = s.values.length, ls = TEXT.label * u;
  const max = Math.max(...s.values.map(v => Math.max(0, v))) || 1;
  ctx.font = font(st, ls, 400);
  const labW = Math.min(box.w * .28, Math.max(...s.values.map((_, i) => ctx.measureText(c.labels?.[i] ?? String(i + 1)).width)) + u * 1.5);
  const area = { x: box.x + labW, y: box.y, w: box.w - labW, h: box.h };
  const bh = area.h / n, th = bh * .78;
  s.values.forEach((v, i) => {
    const p = progress(d.t, i, n, d.anim), fade = d.anim.effect === 'fade';
    const w = area.w * Math.max(.04, Math.max(0, v) / max) * (fade ? 1 : Math.max(0, p));
    const x = area.x + (area.w - w) / 2, y = area.y + bh * i + (bh - th) / 2;
    if (p > 0) {
      ctx.save(); if (fade) ctx.globalAlpha *= Math.min(1, p);
      paint(ctx, () => rr(ctx, x, y, w, th, th * st.radius), itemColor(c, d, i), st, u, { x, y, w, h: th }, i + 41, 'right');
      ctx.restore();
    }
    text(ctx, c.labels?.[i] ?? String(i + 1), box.x + labW - u * 1.2, y + th / 2, { size: ls, st, color: d.ink, a: .75, align: 'right', base: 'middle', max: labW - u });
    if (d.show.values && p > 0) {
      const inside = w > ls * 6, conv = i && v <= s.values[0] && s.values[0] > 0 ? ` · ${Math.round(v / s.values[0] * 100)}%` : '';   // 转化率只在逐级变小时才有意义
      text(ctx, formatValue(v * Math.min(1, p), c.fmt) + conv, inside ? x + w / 2 : x + w + u, y + th / 2, { size: ls, st, color: inside ? contrastOn(itemColor(c, d, i), st) : d.ink, align: inside ? 'center' : 'left', base: 'middle', weight: st.weight, a: Math.min(1, p) });
    }
  });
}

/* ── 进度环 / 仪表盘 / 大数字 ────────────────────────────────────────── */
const ratioOf = (v, c) => (c.fmt.suffix === '%' ? v / 100 : v / (niceScale(0, v, 5).max || 1));

function rings(ctx, c, d) {
  const s = firstSeries(c), u = d.u, st = d.style, box = c.box, n = Math.min(s.values.length, 6);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2, R = Math.min(box.w, box.h) / 2 * .92;
  const band = R * .62 / n, th = band * .76;
  const max = c.fmt.suffix === '%' ? 100 : niceScale(0, Math.max(...s.values), 4).max;
  s.values.slice(0, n).forEach((v, i) => {
    const r = R - band * (i + .5), p = progress(d.t, i, n, d.anim), fade = d.anim.effect === 'fade', col = itemColor(c, d, i);
    ctx.save(); ctx.lineCap = st.radius > 0 || st.fill === 'glass' ? 'round' : 'butt'; ctx.lineWidth = th;
    ctx.strokeStyle = alpha(col, .16); ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    if (p > 0) {
      if (fade) ctx.globalAlpha *= Math.min(1, p);
      if (st.glow) { ctx.shadowColor = col; ctx.shadowBlur = u * 1.5; }
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(v / max, 0, 1) * (fade ? 1 : p)); ctx.stroke();
    }
    ctx.restore();
  });
  const p0 = progress(d.t, 0, n, d.anim), inner = R - band * n;
  text(ctx, formatValue(s.values[0] * Math.min(1, p0), c.fmt), cx, cy, { size: Math.min(TEXT.title * u, inner * .55), st, color: d.ink, align: 'center', base: 'middle', weight: st.weight });
  if (c.labels?.[0]) text(ctx, c.labels[0], cx, cy + Math.min(TEXT.title * u, inner * .55) * .9, { size: Math.min(TEXT.label * u, inner * .22), st, color: d.ink, align: 'center', base: 'middle', a: .55 });
}

function gauge(ctx, c, d) {
  const s = firstSeries(c), u = d.u, st = d.style, box = c.box, v = s.values[0] ?? 0;
  const max = c.fmt.suffix === '%' ? 100 : niceScale(0, v, 5).max;
  // 270° 的弧：上沿到圆心是 R，圆心往下还有 R·sin45°，外加线宽 —— 整体高度约 1.78R，按它塞进框里再上下居中
  const R = Math.min(box.w / 2.1, box.h / 1.8) * .94, th = R * .15;
  const cx = box.x + box.w / 2, cy = box.y + (box.h - R * 1.78) / 2 + R + th / 2;
  const a0 = Math.PI * .75, span = Math.PI * 1.5, p = progress(d.t, 0, 1, d.anim), fade = d.anim.effect === 'fade';
  ctx.save(); ctx.lineCap = st.radius > 0 || st.fill === 'glass' ? 'round' : 'butt'; ctx.lineWidth = th;
  ctx.strokeStyle = d.onPanel ? st.grid : alpha(d.ink, .12); ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + span); ctx.stroke();
  const col = s.color;
  if (p > 0) {
    if (fade) ctx.globalAlpha *= Math.min(1, p);
    if (st.fill === 'gradient' || st.fill === 'glass') {
      const g = ctx.createLinearGradient(cx - R, 0, cx + R, 0); g.addColorStop(0, alpha(col, .45)); g.addColorStop(1, col); ctx.strokeStyle = g;
    } else ctx.strokeStyle = col;
    if (st.glow) { ctx.shadowColor = col; ctx.shadowBlur = u * 1.8; }
    ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + span * clamp(v / max, 0, 1) * (fade ? 1 : p)); ctx.stroke();
  }
  ctx.restore();
  // 刻度
  for (let k = 0; k <= 10; k++) {
    const a = a0 + span * k / 10, r1 = R - th * .9, r2 = R - th * (k % 5 ? 1.25 : 1.6);
    ctx.save(); ctx.strokeStyle = alpha(d.ink, .35); ctx.lineWidth = Math.max(1, u * .14);
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke(); ctx.restore();
  }
  text(ctx, formatValue(v * Math.min(1, p), c.fmt), cx, cy - R * .05, { size: R * .34, st, color: d.ink, align: 'center', base: 'middle', weight: st.weight });
  text(ctx, formatValue(0, c.fmt), cx + Math.cos(a0) * R, cy + Math.sin(a0) * R + th * 1.3, { size: TEXT.label * u, st, color: d.ink, a: .5, align: 'center', base: 'middle' });
  text(ctx, formatValue(max, c.fmt), cx + Math.cos(a0 + span) * R, cy + Math.sin(a0 + span) * R + th * 1.3, { size: TEXT.label * u, st, color: d.ink, a: .5, align: 'center', base: 'middle' });
  if (c.labels?.[0] || s.name) text(ctx, c.labels?.[0] || s.name, cx, cy + R * .32, { size: TEXT.label * u * 1.1, st, color: d.ink, a: .6, align: 'center', base: 'middle' });
}

/* 大数字：最后一个值往上数，旁边是相对上一个值的涨跌，下面一条迷你走势 */
function bignum(ctx, c, d) {
  const s = firstSeries(c), u = d.u, st = d.style, box = c.box, vals = s.values;
  const v = vals.at(-1) ?? 0, prev = vals.length > 1 ? vals.at(-2) : null;
  const p = progress(d.t, 0, 1, d.anim);
  const hasSpark = vals.length >= 3;
  const size = Math.min(box.h * (hasSpark ? .3 : .42), box.w * .2);
  const cy = box.y + box.h * (hasSpark ? .36 : .5);
  text(ctx, s.name, box.x + box.w / 2, cy - size * .85, { size: Math.max(TEXT.label * u, size * .2), st, color: d.ink, a: .6, align: 'center', base: 'middle' });
  text(ctx, formatValue(v * Math.min(1, p), c.fmt), box.x + box.w / 2, cy, { size, st, color: d.ink, align: 'center', base: 'middle', weight: st.weight, max: box.w * .96 });
  if (prev !== null && prev !== 0) {
    const ch = (v - prev) / Math.abs(prev) * 100, up = ch >= 0, fs = Math.max(TEXT.label * u, size * .2);
    const label = `${up ? '▲' : '▼'} ${Math.abs(ch).toFixed(Math.abs(ch) < 10 ? 1 : 0)}%`;
    ctx.save(); ctx.globalAlpha *= clamp(p * 2 - .6, 0, 1);
    ctx.font = font(st, fs, st.weight);
    const w = ctx.measureText(label).width + fs * 1.4, h = fs * 1.9, x = box.x + box.w / 2 - w / 2, y = cy + size * .62;
    rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = up ? '#2f9e4429' : '#e0313129'; ctx.fill();
    text(ctx, label, x + w / 2, y + h / 2, { size: fs, st, color: up ? '#2b8a3e' : '#c92a2a', align: 'center', base: 'middle', weight: st.weight });
    ctx.restore();
  }
  if (hasSpark) {
    const sb = { x: box.x + box.w * .18, y: box.y + box.h * .74, w: box.w * .64, h: box.h * .2 };
    const mn = Math.min(...vals), mx = Math.max(...vals), span = mx - mn || 1;
    const pts = vals.map((val, i) => [sb.x + i / (vals.length - 1) * sb.w, sb.y + sb.h - (val - mn) / span * sb.h]);
    ctx.save(); ctx.beginPath(); ctx.rect(sb.x - u, sb.y - u * 2, sb.w * Math.min(1, p) + u * 2, sb.h + u * 4); ctx.clip();
    strokeLine(ctx, pts, s.color, st, u, { smooth: true, width: .4 });
    ctx.restore();
    const [lx, ly] = pts.at(-1);
    if (p >= 1) { ctx.beginPath(); ctx.arc(lx, ly, u * .7, 0, TAU); ctx.fillStyle = s.color; ctx.fill(); }
  }
}

const DRAW = { bar: (x, c, d) => bars(x, c, d, false), hbar: (x, c, d) => bars(x, c, d, true), stack: (x, c, d) => bars(x, c, d, false), lollipop: (x, c, d) => bars(x, c, d, false),
  line: lines, smooth: lines, area: lines, radar, pie: pies, donut: pies, rose: pies, polar, treemap, waffle, funnel, rings, gauge, bignum };

/* ── 动态层：所有图表 + 大数字 ───────────────────────────────────────
   dyn：{ u, style, ink, panel, onPanel, anim, show:{ grid, values }, charts:[{ box, type, series:[{ name, values, color }], labels, fmt }], kpi } */
export function drawDynamic(ctx, dyn, t) {
  for (const c of dyn.charts) {
    if (!c.series.length || !c.series.some(s => s.values.length)) continue;
    ctx.save();
    (DRAW[c.type] || DRAW.bar)(ctx, c, { ...dyn, t });
    ctx.restore();
  }
  if (dyn.kpi) {
    const k = dyn.kpi, p = progress(t, 0, 1, dyn.anim), st = dyn.style, size = k.box.h / 1.2;
    const x = dyn.align === 'center' ? k.box.x + k.box.w / 2 : k.box.x;
    text(ctx, formatValue(k.value * Math.min(1, p), k.fmt), x, k.box.y + k.box.h * .52, { size, st, color: dyn.ink, align: dyn.align === 'center' ? 'center' : 'left', base: 'middle', weight: st.weight, max: k.box.w });
    if (k.change !== null) {
      ctx.save(); ctx.font = font(st, size, st.weight);
      const w = Math.min(k.box.w, ctx.measureText(formatValue(k.value, k.fmt)).width), fs = size * .26, up = k.change >= 0;
      ctx.globalAlpha *= clamp(p * 2 - .6, 0, 1);
      const label = `${up ? '▲' : '▼'} ${Math.abs(k.change).toFixed(Math.abs(k.change) < 10 ? 1 : 0)}%`;
      ctx.font = font(st, fs, st.weight);
      const pw = ctx.measureText(label).width + fs * 1.4, ph = fs * 1.9;
      const px = dyn.align === 'center' ? x + w / 2 + fs : x + w + fs, py = k.box.y + k.box.h * .52 - ph / 2;
      rr(ctx, px, py, pw, ph, ph / 2); ctx.fillStyle = up ? '#2f9e4429' : '#e0313129'; ctx.fill();
      text(ctx, label, px + pw / 2, py + ph / 2, { size: fs, st, color: up ? '#2b8a3e' : '#c92a2a', align: 'center', base: 'middle', weight: st.weight });
      ctx.restore();
    }
  }
}

/* ── 静态层：卡片底板、标题 / 副标题 / 来源、图例、拼版时每格的组名 ──────
   返回文字区域（和 Relief 一样用来在预览上叠点击编辑）：
   { field, x, y, w, h, caret:{ x, y, h }, edit:{ x, y, w }, font, size, lh, align, alpha } */
const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/;
function wrap(ctx, str, max, lines) {
  const toks = [];
  for (const part of String(str).split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) { toks.push(' '); continue; }
    let w = '';
    for (const ch of part) { if (CJK.test(ch)) { if (w) toks.push(w); w = ''; toks.push(ch); } else w += ch; }
    if (w) toks.push(w);
  }
  const out = []; let line = '';
  for (const t of toks) {
    if (ctx.measureText(line + t).width <= max || !line.trim()) line += t;
    else { out.push(line.trim()); line = t === ' ' ? '' : t; }
  }
  if (line.trim()) out.push(line.trim());
  if (out.length > lines) { const kept = out.slice(0, lines); let last = kept[lines - 1]; while (last && ctx.measureText(last + '…').width > max) last = last.slice(0, -1); kept[lines - 1] = last + '…'; return kept; }
  return out;
}

export function drawStatic(ctx, stc) {
  const { layout: L, style: st, ink, u } = stc;
  if (stc.panel) {
    ctx.save();
    ctx.shadowColor = 'rgba(10,16,30,.22)'; ctx.shadowBlur = u * 5; ctx.shadowOffsetY = u * 1.4;
    rr(ctx, L.card.x, L.card.y, L.card.w, L.card.h, L.card.r); ctx.fillStyle = stc.panel; ctx.fill();
    ctx.restore();
    if (st.fill === 'glass') { ctx.save(); rr(ctx, L.card.x, L.card.y, L.card.w, L.card.h, L.card.r); ctx.lineWidth = Math.max(1, u * .15); ctx.strokeStyle = '#ffffffb0'; ctx.stroke(); ctx.restore(); }
  }
  const regions = [];
  const center = L.align === 'center';
  const block = (field, box, str, size, weight, a, lines) => {
    if (!box) return;
    const f = font(st, size, weight);
    ctx.font = f;
    const rows = str ? wrap(ctx, str, box.w, lines) : [''];
    const lh = size * 1.22, x = center ? box.x + box.w / 2 : box.x;
    let y = box.y;
    ctx.save(); ctx.fillStyle = ink; ctx.globalAlpha = a; ctx.textAlign = center ? 'center' : 'left'; ctx.textBaseline = 'alphabetic';
    let widest = 0, lastW = 0;
    for (const r of rows) {
      y += lh;
      if (str && stc.hide !== field) ctx.fillText(r, x, y - size * .26);
      lastW = ctx.measureText(r).width; widest = Math.max(widest, lastW);
    }
    ctx.restore();
    const w = Math.max(widest, size);
    regions.push({ field, x: center ? x - w / 2 : x, y: box.y, w, h: rows.length * lh,
      caret: { x: center ? x + lastW / 2 : x + lastW, y: y - lh + size * .08, h: size * 1.1 },
      edit: { x: box.x, y: box.y + (lh - size * 1.22) / 2, w: box.w }, font: f, size, lh: 1.22, align: center ? 'center' : 'left', alpha: a });
  };
  const side = L.legend?.vertical && !L.kpi && L.title && L.title.w < L.card.w * .5;
  const titleSize = L.kpi ? TEXT.sub * u * 1.1 : TEXT.title * u * (center ? 1.5 : 1);
  block('title', L.title, stc.texts.title, titleSize, L.kpi ? 400 : st.weight, L.kpi ? .7 : 1, side ? 2 : 1);
  block('sub', L.sub, stc.texts.sub, TEXT.sub * u, 400, .7, side ? 3 : 1);
  block('note', L.note, stc.texts.note, TEXT.note * u, 400, .5, 1);
  // 图例
  if (L.legend && stc.legend.length) {
    const ls = TEXT.legend * u, sw = ls * .8, gap = ls * 1.2;
    ctx.save(); ctx.font = font(st, ls, 400); ctx.textBaseline = 'middle';
    if (L.legend.vertical) {
      let y = L.legend.y + ls;
      for (const it of stc.legend) {
        if (y > L.legend.y + L.legend.h) break;
        rr(ctx, L.legend.x, y - sw / 2, sw, sw, sw * .3); ctx.fillStyle = it.color; ctx.fill();
        ctx.fillStyle = ink; ctx.globalAlpha = .8; ctx.fillText(it.name, L.legend.x + sw + ls * .5, y, L.legend.w - sw - ls * .5); ctx.globalAlpha = 1;
        y += ls * 1.9;
      }
    } else {
      const widths = stc.legend.map(it => sw + ls * .5 + ctx.measureText(it.name).width);
      const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
      let x = center ? L.legend.x + (L.legend.w - Math.min(total, L.legend.w)) / 2 : L.legend.x;
      const y = L.legend.y + L.legend.h / 2 - ls * .2;
      stc.legend.forEach((it, i) => {
        if (x + widths[i] > L.legend.x + L.legend.w + 1) return;
        rr(ctx, x, y - sw / 2, sw, sw, sw * .3); ctx.fillStyle = it.color; ctx.fill();
        ctx.fillStyle = ink; ctx.globalAlpha = .8; ctx.fillText(it.name, x + sw + ls * .5, y); ctx.globalAlpha = 1;
        x += widths[i] + gap;
      });
    }
    ctx.restore();
  }
  // 拼版：每格的组名
  L.charts.forEach((c, i) => {
    if (!c.head || !stc.heads[i]) return;
    text(ctx, stc.heads[i], c.head.x, c.head.y + c.head.h * .6, { size: TEXT.label * u * 1.1, st, color: ink, weight: st.weight, max: c.head.w });
  });
  return regions;
}
