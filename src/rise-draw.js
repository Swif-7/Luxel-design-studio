// Rise 的绘制：静态层（卡片、文字、图例）和动态层（图表本身，随时间 t 生长）。
// 只依赖 rise-core.js —— 导出 HTML 时这两个文件原样内联，页面里预览、PNG、视频、HTML 用的是同一份代码。
import { clamp, phase, easeOf, smooth, countEase, EASES, niceScale, formatValue, FONTS, TEXT } from './rise-core.js';

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

/* ── 液态玻璃（通透版）───────────────────────────────────────────────
   参考首页 Rubric 封面的胶囊和 macOS 自带的液态玻璃：不磨砂、不模糊、没有大块高光，
   靠「半透明的同色胶囊 + 一像素内亮边 + 很淡的顶部光泽 + 柔和投影」托起来。
   ① 投影只画在形状外面（先把形状挖掉再投影），不然会透过半透明的玻璃把它压灰
   ② 玻璃本体：先垫一层半透明白把背后提亮，再上同色、半透明的一层，上稍透下稍实，背景色能隐约透出来
   ③ 顶部一层很淡的光泽，只占上沿一小段
   ④ 一像素内亮边：上沿亮、往下渐淡 —— 相当于 Rubric 胶囊的 inset 0 0 0 1px #fff4 */
function clipOutside(ctx, path) {
  ctx.beginPath(); ctx.rect(-1e5, -1e5, 2e5, 2e5);
  const begin = ctx.beginPath;                                   // path() 自己会 beginPath：临时让它不清空，形状就成了大矩形里的洞
  ctx.beginPath = () => {};
  try { path(); } finally { ctx.beginPath = begin; }
  ctx.clip('evenodd');
}
function liquidGlass(ctx, path, color, u, b, lite, shadow = true) {
  const { x, y, w, h } = b, s = Math.max(1, Math.min(w, h));
  if (shadow) {
  ctx.save();                                                    // ①
  clipOutside(ctx, path);
  ctx.shadowColor = '#0f172a33'; ctx.shadowBlur = u * 1.1; ctx.shadowOffsetY = u * .45;
  path(); ctx.fillStyle = '#000'; ctx.fill();
  ctx.restore();
  }
  ctx.save();
  path(); ctx.clip();
  const full = (c) => { ctx.fillStyle = c; ctx.fillRect(x - 2, y - 2, w + 4, h + 4); };
  full('#ffffff5c');                                             // ② 先把背后提亮一层（和 macOS 玻璃一样），再染色：
  let g = ctx.createLinearGradient(x, y, x, y + Math.max(1, h));   //    否则半透明的橙色压在蓝底上会混成棕色
  g.addColorStop(0, alpha(color, .5)); g.addColorStop(1, alpha(color, .72));
  full(g);
  const L = Math.max(1, Math.min(h, s * 1.4));                      // ③
  g = ctx.createLinearGradient(x, y, x, y + L);
  g.addColorStop(0, '#ffffff38'); g.addColorStop(1, '#ffffff00');
  full(g);
  if (!lite) {                                                   // ④ 描 2 像素宽的线，裁切后只剩里面那 1 像素
    g = ctx.createLinearGradient(x, y, x, y + Math.max(1, Math.min(h, s * 3)));
    g.addColorStop(0, '#ffffffcc'); g.addColorStop(1, '#ffffff40');
    ctx.lineWidth = Math.max(2, u * .2); ctx.strokeStyle = g; path(); ctx.stroke();
  }
  ctx.restore();
}

/* 填充一个形状：path() 负责描路径，dir 是「长出来」的方向（渐变沿它走）。 */
function paint(ctx, path, color, st, u, bounds, seed = 1, dir = 'up') {
  const { x, y, w, h } = bounds;
  ctx.save();
  if (st.glow) { ctx.shadowColor = color; ctx.shadowBlur = u * 1.6; }
  if (st.fill === 'glass') {
    liquidGlass(ctx, path, color, u, bounds, st.lite, dir !== 'radial');      // 扇区挨在一起：各自投影会压在邻居身上，整张饼的投影在 pies() 里画一次
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
  if (st.fill === 'glass') { ctx.shadowColor = '#0f172a2e'; ctx.shadowBlur = u * .9; ctx.shadowOffsetY = u * .35; }
  if (st.fill === 'sketch') { const r = rng(seed); for (let k = 0; k < 2; k++) { trace((r() - .5) * u * .4, (r() - .5) * u * .4); ctx.stroke(); } }
  else { trace(); ctx.stroke(); }
  if (st.fill === 'glass') {                                     // 玻璃管：线条中间偏上一道细白高光
    ctx.shadowColor = 'transparent'; ctx.lineWidth *= .3; ctx.strokeStyle = '#ffffff59';
    ctx.translate(0, -u * width * .14); trace(); ctx.stroke();
  }
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

/* ── 入场节奏 ────────────────────────────────────────────────────────
   每个元素（一根柱、一段扇区、一格……）按自己的窗口走一遍：
   x 原始进度；g 形状进度（带缓动，「自然」「弹跳」会略冲过 1 再落回）；
   a 透明度 —— 前 40% 淡入，所以不会凭空「啪」地出现；lab 数值标签在后半程才浮上来；
   lift 淡入效果时往上浮的量（0→1）。「淡入」只动透明度和一点位移，形状一开始就是完整的。 */
function enter(d, i, n, anim = d.anim) {
  const x = phase(d.t, i, n, anim), fade = anim.effect === 'fade';
  const a = smooth(x / (fade ? .8 : .4));
  return { x, fade, g: fade ? 1 : easeOf(anim)(x), a, lab: smooth((x - .5) / .45), lift: fade ? 1 - smooth(x / .9) : 0 };
}
/* 画线、扫开饼图用正弦缓入缓出：两头柔和，但不像四次方那样前三成几乎不动 */
const sweepEase = (x) => .5 - .5 * Math.cos(Math.PI * clamp(x, 0, 1));
/* 跟着形状走的数字：形状长到哪，数就数到哪（淡入效果没有形状变化，就按指数缓出自己数） */
const counted = (e) => (e.fade ? countEase(e.x) : clamp(e.g, 0, 1));
/* 坐标轴、网格这些「舞台」元素：比数据早一点、快一点出场 */
const stage = (d) => smooth(phase(d.t, 0, 1, { ...d.anim, dur: Math.min(.7, d.anim.dur * .45) }));

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
  // 网格线从左往右（条形图从下往上）划出来，一条比一条稍晚；刻度字跟着淡入
  const gp = stage(d);
  ctx.save();
  if (d.show.grid) {
    ctx.strokeStyle = st.grid && d.onPanel ? st.grid : alpha(d.ink, .14); ctx.lineWidth = Math.max(1, u * .1);
    if (st.dashed) ctx.setLineDash([u * .6, u * .5]);
    sc.ticks.forEach((v, j) => {
      const q = smooth(gp * 1.5 - j / sc.ticks.length * .5);
      if (q <= 0) return;
      const p = toV(v);
      ctx.globalAlpha = q;
      ctx.beginPath();
      if (horizontal) { ctx.moveTo(p, P.y + P.h); ctx.lineTo(p, P.y + P.h - P.h * q); } else { ctx.moveTo(P.x, p); ctx.lineTo(P.x + P.w * q, p); }
      ctx.stroke();
      if (horizontal) text(ctx, formatValue(v, { ...c.fmt, decimals: 'auto' }), p, P.y + P.h + ls * 1.5, { size: ls, st, color: d.ink, a: .5 * q, align: 'center' });
      else text(ctx, formatValue(v, { ...c.fmt, decimals: 'auto' }), P.x - u * .8, p, { size: ls, st, color: d.ink, a: .5 * q, align: 'right', base: 'middle' });
    });
    ctx.setLineDash([]);
  }
  // 零线：从中间向两头展开
  ctx.globalAlpha = gp;
  ctx.strokeStyle = alpha(d.ink, .35); ctx.lineWidth = Math.max(1, u * .14);
  ctx.beginPath();
  const z = toV(0);
  if (horizontal) { const m = P.y + P.h / 2, h = P.h / 2 * gp; ctx.moveTo(z, m - h); ctx.lineTo(z, m + h); }
  else { const m = P.x + P.w / 2, w = P.w / 2 * gp; ctx.moveTo(m - w, z); ctx.lineTo(m + w, z); }
  ctx.stroke();
  ctx.restore();
  // 类别标签：放不下就隔几个显示一个；和自己那根柱同一拍淡入
  const slot = (horizontal ? P.h : P.w) / N;
  const every = horizontal ? Math.max(1, Math.ceil(ls * 1.4 / slot)) : Math.max(1, Math.ceil((labelW + u) / slot));
  labels.forEach((l, i) => {
    if (i % every) return;
    const a = .7 * Math.max(gp * .4, enter(d, i, N).a);
    const m = (horizontal ? P.y : P.x) + slot * (i + .5);
    if (horizontal) text(ctx, l, P.x - u * .8, m, { size: ls, st, color: d.ink, a, align: 'right', base: 'middle', max: P.x - box.x - u });
    else text(ctx, l, m, P.y + P.h + ls * 1.55, { size: ls, st, color: d.ink, a, align: 'center', max: slot * every * .95 });
  });
  return { P, sc, N, toV, slot, ls, labels };
}

/* 数值标签：后半程才浮上来（往上滑一点、淡入），数字按指数缓出往上数 */
function valueLabel(ctx, d, c, v, e, x, y, align = 'center', base = 'alphabetic', rise = true) {
  if (!d.show.values || e.lab <= 0) return;
  const dy = rise ? (1 - e.lab) * d.u * .9 : 0;
  text(ctx, formatValue(v * counted(e), c.fmt), x, y + dy, { size: TEXT.label * d.u, st: d.style, color: d.ink, a: e.lab * .85, align, base, weight: d.style.weight });
}

function bars(ctx, c, d, horizontal) {
  const { P, N, toV, slot } = cartesian(ctx, c, d, horizontal);
  const S = c.series.length, u = d.u, st = d.style, stacked = c.type === 'stack';
  const groupW = slot * (stacked ? .56 : .72), bw = stacked ? groupW : groupW / S;
  const dense = N * (stacked ? 1 : S) > 28;
  for (let i = 0; i < N; i++) {
    let acc = 0, accNeg = 0, top = null;
    c.series.forEach((s, k) => {
      const v = s.values[i];
      if (v === undefined) return;
      // 同一类别里的几根：并排的稍微错开一点；堆叠的一段接一段往上长
      const e = stacked ? enter(d, i, N) : enter(d, i + k / S * .5, N + .5);       // 同一类别的几根错开半拍
      if (e.x <= 0) return;
      const start = stacked ? (v >= 0 ? acc : accNeg) : 0;
      if (stacked) { if (v >= 0) acc += v; else accNeg += v; }
      const g = e.g;
      const from = toV(start * g), to = toV((start + v) * g);         // 堆叠时下面的段也在长，起点跟着一起缩放，不会悬空
      const off = (horizontal ? P.y : P.x) + slot * i + (slot - groupW) / 2 + (stacked ? 0 : k * bw);
      const len = to - from, th = bw * (dense || S === 1 ? .82 : .88);
      const rad = Math.min(th * st.radius, Math.abs(len));
      const lift = e.lift * u * 1.6;
      const b = horizontal ? { x: Math.min(from, to), y: off + (bw - th) / 2, w: Math.abs(len), h: th } : { x: off + (bw - th) / 2, y: Math.min(from, to) + lift, w: th, h: Math.abs(len) };
      const positive = v >= 0;
      const corners = horizontal ? (positive ? [0, rad, rad, 0] : [rad, 0, 0, rad]) : (positive ? [rad, rad, 0, 0] : [0, 0, rad, rad]);
      ctx.save(); ctx.globalAlpha *= e.a;
      if (c.type === 'lollipop') {
        // 棒棒糖：杆先长，圆头在杆长到位时「落」上去（弹一下）
        const mid = horizontal ? b.y + b.h / 2 : b.x + b.w / 2, r0 = Math.min(th * .5, u * 1.3);
        const r = r0 * (e.fade ? 1 : EASES.back(smooth((e.x - .25) / .75)));
        ctx.strokeStyle = s.color; ctx.lineWidth = Math.max(1, u * .32);
        if (st.glow) { ctx.shadowColor = s.color; ctx.shadowBlur = u; }
        ctx.beginPath();
        if (horizontal) { ctx.moveTo(from, mid); ctx.lineTo(to, mid); } else { ctx.moveTo(mid, from + lift); ctx.lineTo(mid, to + lift); }
        ctx.stroke();
        const cx = horizontal ? to : mid, cy = horizontal ? mid : to + lift;
        if (r > 0) paint(ctx, () => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); }, s.color, st, u, { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }, i * 7 + k);
      } else {
        paint(ctx, () => rr(ctx, b.x, b.y, b.w, b.h, stacked && k < c.series.length - 1 ? 0 : corners), s.color, st, u, b, i * 7 + k, horizontal ? 'right' : 'up');
      }
      ctx.restore();
      top = { e, to, b, positive, th };
      if (!stacked && !dense) {
        // 数值标签跟着柱顶走（柱子弹一下，标签也跟着弹），但数字只从 0 数到终值
        const pad = c.type === 'lollipop' ? Math.min(th * .5, u * 1.3) + u * .6 : u * .8;      // 棒棒糖的数值要让开圆头
        if (horizontal) valueLabel(ctx, d, c, v, e, to + (positive ? pad : -pad), b.y + b.h / 2, positive ? 'left' : 'right', 'middle', false);
        else valueLabel(ctx, d, c, v, e, b.x + b.w / 2, positive ? to - pad + lift : to + pad + lift + TEXT.label * u * .9);
      }
    });
    if (stacked && !dense && top) {
      const tot = c.series.reduce((sum, s) => sum + (s.values[i] || 0), 0);
      const end = toV(acc * top.e.g);
      const mid = (horizontal ? P.y : P.x) + slot * (i + .5);
      if (horizontal) valueLabel(ctx, d, c, tot, top.e, end + u * .8, mid, 'left', 'middle', false);
      else valueLabel(ctx, d, c, tot, top.e, mid, end - u * .8 + top.e.lift * u * 1.6);
    }
  }
}

/* 沿折线取某个 x 处的 y（线性插值，给「笔尖」用） */
function yAt(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0 || 1); }
  return pts.at(-1)[1];
}

function lines(ctx, c, d) {
  const { P, N, toV, slot } = cartesian(ctx, c, d, false);
  const u = d.u, st = d.style, S = c.series.length;
  c.series.forEach((s, k) => {
    const e = enter(d, k, S);
    if (e.x <= 0) return;
    const pts = s.values.map((v, i) => [P.x + slot * (i + .5), toV(v)]);
    // 画线用缓入缓出：笔尖起步和收尾都慢，中间快 —— 比匀速划过去柔和得多（匀速选项照旧匀速）
    const draw = e.fade ? 1 : d.anim.ease === 'linear' ? e.x : sweepEase(e.x);
    const x0 = pts[0][0], x1 = pts.at(-1)[0];
    const reach = e.fade ? Infinity : x0 + (x1 - x0) * draw;
    const lift = e.lift * u * 1.6;
    ctx.save();
    ctx.translate(0, lift);
    ctx.globalAlpha *= e.fade ? e.a : 1;
    ctx.save();
    ctx.beginPath(); ctx.rect(P.x - u * 2, P.y - u * 6, e.fade ? P.w + u * 4 : reach - P.x + u * 2 + (draw >= 1 ? u * 2 : 0), P.h + u * 12); ctx.clip();
    const smoothLine = c.type === 'smooth' || c.type === 'area';
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
      ctx.save();
      ctx.globalAlpha *= e.fade ? 1 : smooth(draw * 1.4);         // 面积比线晚半拍、慢慢铺满
      if (st.fill === 'hatch' || st.fill === 'sketch' || st.fill === 'glass') paint(ctx, trace, s.color, { ...st, glow: false }, u, { x: P.x, y: top, w: P.w, h: toV(0) - top }, k + 3);
      else {
        const g = ctx.createLinearGradient(0, top, 0, toV(0));
        g.addColorStop(0, alpha(s.color, S > 1 ? .38 : .5)); g.addColorStop(1, alpha(s.color, 0));
        trace(); ctx.fillStyle = g; ctx.fill();
      }
      ctx.restore();
    }
    strokeLine(ctx, pts, s.color, st, u, { smooth: smoothLine, seed: k + 11 });
    ctx.restore();
    // 笔尖：画线的时候有一个发光的点领着走，画完就收起来
    if (!e.fade && draw > 0 && draw < 1) {
      const hx = reach, hy = yAt(pts, hx), glow = Math.sin(Math.PI * Math.min(1, draw * 1.2));
      ctx.save();
      ctx.globalAlpha *= glow;
      ctx.shadowColor = s.color; ctx.shadowBlur = u * 1.6;
      ctx.beginPath(); ctx.arc(hx, hy, u * .75, 0, TAU); ctx.fillStyle = s.color; ctx.fill();
      ctx.restore();
    }
    // 数据点：笔尖经过时弹出来；数值标签再晚一点浮上来
    const dots = N <= 16;
    // 弹出按「笔尖越过这个点多远」算；笔尖最后停在末点上，所以给它多走一个弹出宽度，末点才能完整弹出
    const pop = slot * .9 + u, popReach = x0 + (x1 - x0 + pop) * draw;
    pts.forEach(([x, y], i) => {
      const passed = e.fade ? e.x : clamp((popReach - x) / pop, 0, 1);
      if (passed <= 0) return;
      if (dots) {
        const r = u * .62 * (st.heavy ? 1.3 : 1) * (e.fade ? 1 : EASES.back(passed));
        ctx.save(); ctx.globalAlpha *= smooth(passed * 2);
        ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, TAU);
        ctx.fillStyle = d.onPanel ? d.panel : '#ffffff'; if (d.style.fill === 'glass') ctx.fillStyle = '#ffffff';
        ctx.fill(); ctx.lineWidth = u * .32; ctx.strokeStyle = s.color; ctx.stroke();
        ctx.restore();
      }
      if (S <= 2 && N <= 12) valueLabel(ctx, d, c, s.values[i], { x: passed, g: countEase(passed), lab: smooth((passed - .35) / .65) }, x, y - u * 1.4);
    });
    ctx.restore();
  });
}

/* ── 饼 / 环 / 玫瑰 ──────────────────────────────────────────────────── */
const firstSeries = (c) => c.series[0] || { values: [], color: '#888' };
const itemColor = (c, d, i) => d.style.palette[i % d.style.palette.length];

function pies(ctx, c, d) {
  const s = firstSeries(c), u = d.u, st = d.style, box = c.box;
  const vals = s.values.map(v => Math.max(0, v)), total = vals.reduce((a, b) => a + b, 0) || 1;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const donut = c.type === 'donut', rose = c.type === 'rose';
  const max = Math.max(...vals) || 1;
  // 占比标签：放得进扇区就写在里面，放不下就写在环外；有块要写到外面时饼缩小一点，给外圈的字留地方
  const pctOf = (v) => { const p = v / total * 100; return (p >= 1 ? Math.round(p) : p >= .1 ? p.toFixed(1) : '<0.1') + '%'; };
  const lsize = TEXT.label * u * 1.05;
  ctx.font = font(st, lsize, st.weight);
  const fitsIn = (v, R) => {
    const inner = donut ? R * .6 : 0, lr = donut ? (R + inner) / 2 : R * .64;
    return (v / total) * TAU * lr >= ctx.measureText(pctOf(v)).width + lsize * .7;
  };
  let R = Math.min(box.w, box.h) / 2 * .88;
  if (!rose && d.show.values && vals.some(v => v > 0 && !fitsIn(v, R))) R *= .86;
  const inner = donut ? R * .6 : 0;
  // 饼 / 环：扇区大小一开始就是对的，由一道从 12 点钟方向顺时针扫开的「幕」揭出来；
  // 同时整张饼从 -40° 转回原位、从 88% 放大到 100% —— 像被轻轻推进画面
  const all = enter(d, 0, 1, { ...d.anim, stagger: 0 });
  const sweep = rose || all.fade ? 1 : d.anim.ease === 'linear' ? all.x : sweepEase(all.x);
  const spin = rose || all.fade ? 0 : (1 - all.g) * -.7;
  const zoom = all.fade ? .96 + .04 * all.a : rose ? 1 : .88 + .12 * all.g;
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(spin); ctx.scale(zoom, zoom); ctx.translate(-cx, -cy);
  if (all.fade) ctx.globalAlpha *= all.a;
  if (sweep < 1) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R * 1.2, -Math.PI / 2, -Math.PI / 2 + TAU * sweep); ctx.closePath(); ctx.clip(); }
  if (st.fill === 'glass' && !rose) {                              // 玻璃：整张饼只投一次影
    ctx.save(); clipOutside(ctx, () => { ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); });
    ctx.shadowColor = '#0f172a33'; ctx.shadowBlur = u * 1.1; ctx.shadowOffsetY = u * .45;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fillStyle = '#000'; ctx.fill(); ctx.restore();
  }
  let a0 = -Math.PI / 2;
  const labels = [];
  vals.forEach((v, i) => {
    const share = rose ? 1 / vals.length : v / total;
    const e = enter(d, i, vals.length);
    const span = share * TAU;
    // 玫瑰：每一瓣按顺序从圆心长出来（半径弹一下）
    const r = rose ? inner + (R - inner) * (.18 + .82 * Math.sqrt(v / max)) * (e.fade ? 1 : Math.max(0, e.g)) : R;
    const gap = vals.length > 1 ? Math.min(u * .25, span * r * .1) / Math.max(r, 1) : 0;
    const from = a0 + gap / 2, to = a0 + span - gap / 2;
    if (to > from && r > inner && (!rose || e.x > 0)) {
      ctx.save(); if (rose) ctx.globalAlpha *= e.a;
      paint(ctx, () => { ctx.beginPath(); ctx.arc(cx, cy, r, from, to); if (inner) ctx.arc(cx, cy, inner, to, from, true); else ctx.lineTo(cx, cy); ctx.closePath(); },
        itemColor(c, d, i), st, u, { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }, i + 21, 'radial');
      ctx.restore();
      // 占比标签：幕扫过这一块的中线之后才浮出来
      const midFrac = (a0 + span / 2 + Math.PI / 2) / TAU;
      // 淡入跨 1/7 圈；离终点不足 1/7 的块（最后一两块）按剩下的那段走完，扫完时正好全显，不会一直半透明
      const shown = rose ? e.lab : all.fade ? all.lab : smooth((sweep - midFrac) / Math.max(1e-3, Math.min(1 / 7, 1 - midFrac)));
      if (d.show.values && shown > 0 && v > 0) {
        const mid = (from + to) / 2, inside = rose || fitsIn(v, R);
        const lr = rose ? r + u * 2.2 : !inside ? R + lsize * 1.25 : donut ? (R + inner) / 2 : R * .64;
        labels.push({ label: rose ? formatValue(v * counted(e), c.fmt) : pctOf(v), x: cx + Math.cos(mid) * lr, y: cy + Math.sin(mid) * lr, shown, outside: !inside,
          color: rose || !inside ? d.ink : contrastOn(itemColor(c, d, i), st), size: rose ? TEXT.label * u : lsize });
      }
    }
    a0 += span;
  });
  ctx.restore();
  // 标签画在幕外面，不被裁掉；位置跟着饼一起转、一起缩放。
  // 环外的字彼此可能挨着（连着几块小扇区）：和已经放下的外圈字重叠就不画
  const placed = [];
  ctx.font = font(st, lsize, st.weight);
  for (const l of labels) {
    const dx = l.x - cx, dy = l.y - cy, cs = Math.cos(spin), sn = Math.sin(spin);
    const x = cx + (dx * cs - dy * sn) * zoom, y = cy + (dx * sn + dy * cs) * zoom;
    if (l.outside) {
      const w = ctx.measureText(l.label).width + lsize * .4, h = lsize * 1.2;
      if (placed.some(p => Math.abs(p.x - x) < (p.w + w) / 2 && Math.abs(p.y - y) < (p.h + h) / 2)) continue;
      placed.push({ x, y, w, h });
    }
    text(ctx, l.label, x, y, { size: l.size, st, color: l.color, align: 'center', base: 'middle', weight: st.weight, a: l.shown });
  }
  if (donut) {
    const k = Math.min(1, R / (u * 22));
    text(ctx, formatValue(total * (all.fade ? countEase(all.x) : sweep), c.fmt), cx, cy + u * .4,        // 合计跟着幕走：揭开多少，就数到多少
      { size: TEXT.title * u * .9 * k, st, color: d.ink, align: 'center', base: 'middle', weight: st.weight, a: smooth(all.x * 2.5) });
    text(ctx, d.words?.total ?? '合计', cx, cy + TEXT.title * u * .75 * k, { size: TEXT.label * u, st, color: d.ink, align: 'center', base: 'middle', a: .55 * smooth(all.x * 2.5) });
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
  // 网格一圈圈从里往外扩，辐条跟着伸出去
  const gp = stage(d);
  ctx.save();
  ctx.strokeStyle = d.onPanel ? st.grid : alpha(d.ink, .14); ctx.lineWidth = Math.max(1, u * .1);
  if (st.dashed) ctx.setLineDash([u * .6, u * .5]);
  for (let ring = 1; ring <= 4; ring++) {
    const q = smooth(gp * 1.6 - (ring - 1) * .15);
    if (q <= 0) continue;
    ctx.globalAlpha = q;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) { const r = R * ring / 4 * (.85 + .15 * q); ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r); }
    ctx.stroke();
  }
  ctx.globalAlpha = gp;
  for (let i = 0; i < N; i++) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang(i)) * R * gp, cy + Math.sin(ang(i)) * R * gp); ctx.stroke(); }
  ctx.setLineDash([]);
  for (let i = 0; i < N; i++) {
    const a = ang(i), x = cx + Math.cos(a) * (R + ls * 1.3), y = cy + Math.sin(a) * (R + ls * 1.3);
    text(ctx, c.labels?.[i] ?? String(i + 1), x, y, { size: ls, st, color: d.ink, a: .7 * gp, align: Math.abs(Math.cos(a)) < .2 ? 'center' : Math.cos(a) > 0 ? 'left' : 'right', base: 'middle' });
  }
  ctx.restore();
  c.series.forEach((s, k) => {
    const e = enter(d, k, c.series.length);
    if (e.x <= 0) return;
    // 每个顶点比前一个稍晚一点出发：多边形像顺时针「充气」展开，而不是整块等比放大
    const pts = s.values.map((v, i) => {
      const q = e.fade ? 1 : easeOf(d.anim)(clamp(e.x * 1.35 - i / N * .35, 0, 1));
      const r = R * (v - sc.min) / (sc.max - sc.min) * q;
      return [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r];
    });
    ctx.save(); ctx.globalAlpha *= e.a; ctx.translate(0, e.lift * u * 1.6);
    const path = () => { ctx.beginPath(); pts.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y)); ctx.closePath(); };
    if (st.fill === 'hatch' || st.fill === 'sketch') paint(ctx, path, s.color, { ...st, glow: false }, u, { x: cx - R, y: cy - R, w: 2 * R, h: 2 * R }, k + 5);
    else { path(); ctx.fillStyle = alpha(s.color, st.fill === 'glass' ? .3 : .22); ctx.fill(); }
    strokeLine(ctx, [...pts, pts[0]], s.color, st, u, { width: .36, seed: k + 3 });
    for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(x, y, u * .5 * smooth(e.x * 2), 0, TAU); ctx.fillStyle = s.color; ctx.fill(); }
    ctx.restore();
  });
}

/* 弧形进度（极坐标柱、进度环、仪表盘共用）：弧从起点扫到终点，末端弹一下；
   扫动中弧头带一个亮点，停稳后收起 */
function arcTo(ctx, cx, cy, r, a0, span, frac, e, color, st, u, th) {
  const k = e.fade ? 1 : e.g;
  const end = a0 + span * clamp(frac * k, 0, 1.04);
  if (end <= a0 + 1e-4) return end;
  ctx.save();
  ctx.globalAlpha *= e.a;
  if (st.glow) { ctx.shadowColor = color; ctx.shadowBlur = u * 1.5; }
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, end); ctx.stroke();
  if (st.fill === 'glass' && th) {                               // 玻璃弧：外侧一道细白高光，像一根弯着的玻璃管
    ctx.shadowColor = 'transparent'; ctx.lineWidth = Math.max(1, th * .08); ctx.strokeStyle = '#ffffff73';
    ctx.beginPath(); ctx.arc(cx, cy, r + th * .38, a0, end); ctx.stroke();
  }
  ctx.restore();
  if (!e.fade && e.x < 1 && th) {
    const glow = Math.sin(Math.PI * Math.min(1, e.x * 1.15)) * .8;
    ctx.save(); ctx.globalAlpha *= glow; ctx.shadowColor = color; ctx.shadowBlur = th;
    ctx.beginPath(); ctx.arc(cx + Math.cos(end) * r, cy + Math.sin(end) * r, th * .32, 0, TAU); ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.restore();
  }
  return end;
}

/* ── 极坐标柱：每一项一圈，弧长表示大小 ───────────────────────────── */
function polar(ctx, c, d) {
  const s = firstSeries(c), u = d.u, st = d.style, box = c.box, n = s.values.length, ls = TEXT.label * u;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2, R = Math.min(box.w, box.h) / 2 * .92;
  const inner = R * .28, band = (R - inner) / Math.max(1, n), th = band * .7;
  const max = niceScale(0, Math.max(...s.values), 4).max, full = TAU * .75, gp = stage(d);
  s.values.forEach((v, i) => {
    const r = R - band * (i + .5), e = enter(d, i, n), col = itemColor(c, d, i);
    ctx.save(); ctx.lineCap = st.radius > 0 ? 'round' : 'butt'; ctx.lineWidth = th;
    ctx.globalAlpha = gp;
    ctx.strokeStyle = d.onPanel ? st.grid : alpha(d.ink, .12);
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + full * smooth(gp * 1.3 - i / n * .3)); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = st.fill === 'glass' ? alpha(col, .75) : col;
    const end = e.x > 0 ? arcTo(ctx, cx, cy, r, -Math.PI / 2, full, Math.max(0, v) / max, e, col, st, u, th) : -Math.PI / 2;
    ctx.restore();
    const size = Math.min(ls, th * .8);
    text(ctx, `${c.labels?.[i] ?? i + 1}`, cx - u * .9, cy - r, { size, st, color: d.ink, a: .75 * Math.max(gp * .5, e.a), align: 'right', base: 'middle', max: box.w / 2 - u });
    valueLabel(ctx, { ...d, u: u * Math.min(1, size / ls) }, c, v, e, cx + Math.cos(end) * r, cy + Math.sin(end) * r - th * .9, 'center', 'middle', false);
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
    const e = enter(d, k, tiles.length);
    if (e.x <= 0) return;
    // 每块从 70% 大小弹到原位（不是从一个点长出来），同时淡入
    const sc = e.fade ? 1 : .7 + .3 * e.g;
    const w = (t.w - gap) * sc, h = (t.h - gap) * sc, x = t.x + gap / 2 + (t.w - gap - w) / 2, y = t.y + gap / 2 + (t.h - gap - h) / 2 + e.lift * u * 1.6;
    const col = itemColor(c, d, t.i);
    ctx.save(); ctx.globalAlpha *= e.a;
    paint(ctx, () => rr(ctx, x, y, w, h, Math.min(w, h) * st.radius * .25 + (st.radius ? u * .6 : 0)), col, st, u, { x, y, w, h }, t.i + 31);
    ctx.restore();
    if (w > ls * 4 && h > ls * 3.4) {
      const ink = contrastOn(col, st);
      text(ctx, c.labels?.[t.i] ?? String(t.i + 1), x + u * 1.1, y + ls * 1.7, { size: ls, st, color: ink, a: e.a * .8, max: w - u * 2 });
      if (d.show.values) text(ctx, formatValue(s.values[t.i] * counted(e), c.fmt), x + u * 1.1, y + ls * 1.7 + ls * 1.5 + (1 - e.lab) * u * .8, { size: ls * 1.25, st, color: ink, a: e.lab, weight: st.weight, max: w - u * 2 });
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
  // 从左上角沿对角线一波一波铺过去：每格有自己的小窗口，弹一下落位
  const T = phase(d.t, 0, 1, { ...d.anim, stagger: 0 }), fade = d.anim.effect === 'fade', gp = stage(d);
  for (let k = 0; k < 100; k++) {
    const col = k % 10, row = Math.floor(k / 10);
    const x = x0 + col * cell + g / 2, y = y0 + row * cell + g / 2, w = cell - g;
    const wave = (row + col) / 18 * (.25 + clamp(d.anim.stagger, 0, 100) / 100 * .45);
    const cx = clamp((T - wave) / (1 - wave * .9), 0, 1);
    ctx.save();
    ctx.globalAlpha = gp;
    rr(ctx, x, y, w, w, w * Math.max(.18, st.radius * .6)); ctx.fillStyle = d.onPanel ? st.grid : alpha(d.ink, .1); ctx.fill();
    if (cx > 0 && owner[k] !== undefined) {
      ctx.globalAlpha = smooth(cx / (fade ? .9 : .45));
      const sc = fade ? 1 : Math.max(0, easeOf(d.anim)(cx)), ww = w * sc;
      paint(ctx, () => rr(ctx, x + (w - ww) / 2, y + (w - ww) / 2, ww, ww, ww * Math.max(.18, st.radius * .6)), itemColor(c, d, owner[k]), { ...st, glow: false, lite: true }, u * .6, { x, y, w, h: w }, k);
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
    const e = enter(d, i, n);
    // 从中线向两边展开
    const w = area.w * Math.max(.04, Math.max(0, v) / max) * (e.fade ? 1 : Math.max(0, e.g));
    const x = area.x + (area.w - w) / 2, y = area.y + bh * i + (bh - th) / 2 + e.lift * u * 1.6;
    if (e.x > 0) {
      ctx.save(); ctx.globalAlpha *= e.a;
      paint(ctx, () => rr(ctx, x, y, w, th, th * st.radius), itemColor(c, d, i), st, u, { x, y, w, h: th }, i + 41, 'right');
      ctx.restore();
    }
    text(ctx, c.labels?.[i] ?? String(i + 1), box.x + labW - u * 1.2, y + th / 2, { size: ls, st, color: d.ink, a: .75 * Math.max(.3, e.a), align: 'right', base: 'middle', max: labW - u });
    if (d.show.values && e.lab > 0) {
      const inside = area.w * Math.max(0, v) / max > ls * 6, full = area.w * Math.max(.04, Math.max(0, v) / max);
      const conv = i && v <= s.values[0] && s.values[0] > 0 ? ` · ${Math.round(v / s.values[0] * 100)}%` : '';   // 转化率只在逐级变小时才有意义
      text(ctx, formatValue(v * counted(e), c.fmt) + conv, inside ? area.x + area.w / 2 : area.x + (area.w + full) / 2 + u, y + th / 2, { size: ls, st, color: inside ? contrastOn(itemColor(c, d, i), st) : d.ink, align: inside ? 'center' : 'left', base: 'middle', weight: st.weight, a: e.lab });
    }
  });
}

/* ── 进度环 / 仪表盘 / 大数字 ────────────────────────────────────────── */
function rings(ctx, c, d) {
  const s = firstSeries(c), u = d.u, st = d.style, box = c.box, n = Math.min(s.values.length, 6);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2, R = Math.min(box.w, box.h) / 2 * .92;
  const band = R * .62 / n, th = band * .76, gp = stage(d);
  const max = c.fmt.suffix === '%' ? 100 : niceScale(0, Math.max(...s.values), 4).max;
  s.values.slice(0, n).forEach((v, i) => {
    const r = R - band * (i + .5), e = enter(d, i, n), col = itemColor(c, d, i);
    ctx.save(); ctx.lineCap = st.radius > 0 || st.fill === 'glass' ? 'round' : 'butt'; ctx.lineWidth = th;
    ctx.globalAlpha = gp;
    ctx.strokeStyle = alpha(col, .16); ctx.beginPath(); ctx.arc(cx, cy, r * (.9 + .1 * gp), 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1; ctx.strokeStyle = col;
    if (e.x > 0) arcTo(ctx, cx, cy, r, -Math.PI / 2, TAU, clamp(v / max, 0, 1), e, col, st, u, th);
    ctx.restore();
  });
  const e0 = enter(d, 0, n), inner = R - band * n, size = Math.min(TEXT.title * u, inner * .55);
  text(ctx, formatValue(s.values[0] * counted(e0), c.fmt), cx, cy, { size, st, color: d.ink, align: 'center', base: 'middle', weight: st.weight, a: smooth(e0.x * 3) });
  if (c.labels?.[0]) text(ctx, c.labels[0], cx, cy + size * .9, { size: Math.min(TEXT.label * u, inner * .22), st, color: d.ink, align: 'center', base: 'middle', a: .55 * gp });
}

function gauge(ctx, c, d) {
  const s = firstSeries(c), u = d.u, st = d.style, box = c.box, v = s.values[0] ?? 0;
  const max = c.fmt.suffix === '%' ? 100 : niceScale(0, v, 5).max;
  // 270° 的弧：上沿到圆心是 R，圆心往下还有 R·sin45°，外加线宽 —— 整体高度约 1.78R，按它塞进框里再上下居中
  const R = Math.min(box.w / 2.1, box.h / 1.8) * .94, th = R * .15;
  const cx = box.x + box.w / 2, cy = box.y + (box.h - R * 1.78) / 2 + R + th / 2;
  const a0 = Math.PI * .75, span = Math.PI * 1.5, e = enter(d, 0, 1), gp = stage(d);
  ctx.save(); ctx.lineCap = st.radius > 0 || st.fill === 'glass' ? 'round' : 'butt'; ctx.lineWidth = th;
  ctx.globalAlpha = gp;
  ctx.strokeStyle = d.onPanel ? st.grid : alpha(d.ink, .12); ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + span * smooth(gp * 1.2)); ctx.stroke();
  ctx.globalAlpha = 1;
  const col = s.color;
  if (st.fill === 'gradient' || st.fill === 'glass') { const g = ctx.createLinearGradient(cx - R, 0, cx + R, 0); g.addColorStop(0, alpha(col, .45)); g.addColorStop(1, col); ctx.strokeStyle = g; }
  else ctx.strokeStyle = col;
  if (e.x > 0) arcTo(ctx, cx, cy, R, a0, span, clamp(v / max, 0, 1), e, col, st, u, th);
  ctx.restore();
  // 刻度：跟着底轨一格一格亮起来
  for (let k = 0; k <= 10; k++) {
    const q = smooth(gp * 1.4 - k / 10 * .4);
    if (q <= 0) continue;
    const a = a0 + span * k / 10, r1 = R - th * .9, r2 = R - th * (k % 5 ? 1.25 : 1.6);
    ctx.save(); ctx.globalAlpha = q; ctx.strokeStyle = alpha(d.ink, .35); ctx.lineWidth = Math.max(1, u * .14);
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke(); ctx.restore();
  }
  text(ctx, formatValue(v * counted(e), c.fmt), cx, cy - R * .05, { size: R * .34, st, color: d.ink, align: 'center', base: 'middle', weight: st.weight, a: smooth(e.x * 3) });
  text(ctx, formatValue(0, c.fmt), cx + Math.cos(a0) * R, cy + Math.sin(a0) * R + th * 1.3, { size: TEXT.label * u, st, color: d.ink, a: .5 * gp, align: 'center', base: 'middle' });
  text(ctx, formatValue(max, c.fmt), cx + Math.cos(a0 + span) * R, cy + Math.sin(a0 + span) * R + th * 1.3, { size: TEXT.label * u, st, color: d.ink, a: .5 * gp, align: 'center', base: 'middle' });
  if (c.labels?.[0] || s.name) text(ctx, c.labels?.[0] || s.name, cx, cy + R * .32, { size: TEXT.label * u * 1.1, st, color: d.ink, a: .6 * gp, align: 'center', base: 'middle' });
}

/* 涨跌小胶囊：数字数到八成时从左边滑进来 */
function delta(ctx, st, change, x, y, fs, show, align = 'left') {
  if (show <= 0) return;
  const up = change >= 0, label = `${up ? '▲' : '▼'} ${Math.abs(change).toFixed(Math.abs(change) < 10 ? 1 : 0)}%`;
  ctx.save(); ctx.globalAlpha *= show;
  ctx.font = font(st, fs, st.weight);
  const w = ctx.measureText(label).width + fs * 1.4, h = fs * 1.9;
  const px = (align === 'center' ? x - w / 2 : x) - (1 - show) * fs * 1.2;
  rr(ctx, px, y - h / 2, w, h, h / 2); ctx.fillStyle = up ? '#2f9e4429' : '#e0313129'; ctx.fill();
  text(ctx, label, px + w / 2, y, { size: fs, st, color: up ? '#2b8a3e' : '#c92a2a', align: 'center', base: 'middle', weight: st.weight });
  ctx.restore();
}

/* 大数字：最后一个值往上数，旁边是相对上一个值的涨跌，下面一条迷你走势 */
function bignum(ctx, c, d) {
  const s = firstSeries(c), u = d.u, st = d.style, box = c.box, vals = s.values;
  const v = vals.at(-1) ?? 0, prev = vals.length > 1 ? vals.at(-2) : null;
  const e = enter(d, 0, 1);
  const hasSpark = vals.length >= 3;
  const size = Math.min(box.h * (hasSpark ? .3 : .42), box.w * .2);
  const cy = box.y + box.h * (hasSpark ? .36 : .5), rise = (1 - smooth(e.x * 2)) * size * .25;
  text(ctx, s.name, box.x + box.w / 2, cy - size * .85, { size: Math.max(TEXT.label * u, size * .2), st, color: d.ink, a: .6 * smooth(e.x * 3), align: 'center', base: 'middle' });
  text(ctx, formatValue(v * countEase(e.x), c.fmt), box.x + box.w / 2, cy + rise, { size, st, color: d.ink, align: 'center', base: 'middle', weight: st.weight, max: box.w * .96, a: smooth(e.x * 2.5) });
  if (prev !== null && prev !== 0) delta(ctx, st, (v - prev) / Math.abs(prev) * 100, box.x + box.w / 2, cy + size * .62 + Math.max(TEXT.label * u, size * .2) * .95, Math.max(TEXT.label * u, size * .2), smooth((e.x - .55) / .35), 'center');
  if (hasSpark) {
    const sb = { x: box.x + box.w * .18, y: box.y + box.h * .74, w: box.w * .64, h: box.h * .2 };
    const mn = Math.min(...vals), mx = Math.max(...vals), span = mx - mn || 1;
    const pts = vals.map((val, i) => [sb.x + i / (vals.length - 1) * sb.w, sb.y + sb.h - (val - mn) / span * sb.h]);
    const draw = e.fade ? 1 : sweepEase(e.x * 1.15);
    ctx.save(); ctx.globalAlpha *= e.fade ? e.a : 1;
    ctx.beginPath(); ctx.rect(sb.x - u, sb.y - u * 2, sb.w * draw + u * (draw >= 1 ? 2 : 0), sb.h + u * 4); ctx.clip();
    strokeLine(ctx, pts, s.color, st, u, { smooth: true, width: .4 });
    ctx.restore();
    const [lx, ly] = pts.at(-1), dot = smooth((draw - .9) / .1);
    if (dot > 0) { ctx.beginPath(); ctx.arc(lx, ly, u * .7 * EASES.back(dot), 0, TAU); ctx.fillStyle = s.color; ctx.fill(); }
  }
}

const DRAW = { bar: (x, c, d) => bars(x, c, d, false), hbar: (x, c, d) => bars(x, c, d, true), stack: (x, c, d) => bars(x, c, d, false), lollipop: (x, c, d) => bars(x, c, d, false),
  line: lines, smooth: lines, area: lines, radar, pie: pies, donut: pies, rose: pies, polar, treemap, waffle, funnel, rings, gauge, bignum };

/* ── 动态层：所有图表 + 大数字 ───────────────────────────────────────
   dyn：{ u, style, ink, panel, onPanel, anim, show:{ grid, values }, charts:[{ box, type, series:[{ name, values, color }], labels, fmt }], kpi }
   fade：循环播放时，一轮结束后整张图淡出（1 = 不透明） */
export function drawDynamic(ctx, dyn, t, fade = 1) {
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;
  for (const c of dyn.charts) {
    if (!c.series.length || !c.series.some(s => s.values.length)) continue;
    ctx.save();
    (DRAW[c.type] || DRAW.bar)(ctx, c, { ...dyn, t });
    ctx.restore();
  }
  if (dyn.kpi) {
    const k = dyn.kpi, e = enter({ ...dyn, t }, 0, 1), st = dyn.style, size = k.box.h / 1.2;
    const x = dyn.align === 'center' ? k.box.x + k.box.w / 2 : k.box.x, y = k.box.y + k.box.h * .52;
    text(ctx, formatValue(k.value * countEase(e.x), k.fmt), x, y + (1 - smooth(e.x * 2)) * size * .2, { size, st, color: dyn.ink, align: dyn.align === 'center' ? 'center' : 'left', base: 'middle', weight: st.weight, max: k.box.w, a: smooth(e.x * 2.5) });
    if (k.change !== null) {
      ctx.save(); ctx.font = font(st, size, st.weight);
      const w = Math.min(k.box.w, ctx.measureText(formatValue(k.value, k.fmt)).width), fs = size * .26;
      ctx.restore();
      delta(ctx, st, k.change, dyn.align === 'center' ? x + w / 2 + fs : x + w + fs, y, fs, smooth((e.x - .55) / .35));
    }
  }
  ctx.restore();
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
    if (st.fill === 'glass') {                                   // 玻璃风格的卡片：半透明白 + 一像素内亮边，和工具栏胶囊一样通透
      const { x, y, w, h, r } = L.card, card = () => rr(ctx, x, y, w, h, r);
      ctx.save(); card(); ctx.clip();
      const g = ctx.createLinearGradient(x, y, x, y + Math.min(h, u * 24)); g.addColorStop(0, '#ffffffb3'); g.addColorStop(1, '#ffffff4d');
      ctx.lineWidth = Math.max(2, u * .22); ctx.strokeStyle = g; card(); ctx.stroke();
      ctx.restore();
    }
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
