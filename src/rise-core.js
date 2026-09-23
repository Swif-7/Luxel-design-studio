// Rise 的纯逻辑：图表类型、风格预设、排版、刻度、数字格式、动画时间。
// 这个文件不 import 任何东西 —— 导出 HTML 时会把它和 rise-draw.js 一起原样内联进去。

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ── 图表类型 ──────────────────────────────────────────────────────────
   multi：多组数据时怎么画 —— group 并排、stack 堆叠、overlay 叠在同一坐标里、first 只画第一组。 */
export const CHARTS = [
  { id: 'bar', name: '柱状', multi: 'group' },
  { id: 'hbar', name: '条形', multi: 'group' },
  { id: 'stack', name: '堆叠柱', multi: 'stack' },
  { id: 'lollipop', name: '棒棒糖', multi: 'group' },
  { id: 'line', name: '折线', multi: 'overlay' },
  { id: 'smooth', name: '曲线', multi: 'overlay' },
  { id: 'area', name: '面积', multi: 'overlay' },
  { id: 'radar', name: '雷达', multi: 'overlay' },
  { id: 'pie', name: '饼图', multi: 'first' },
  { id: 'donut', name: '环形', multi: 'first' },
  { id: 'rose', name: '玫瑰', multi: 'first' },
  { id: 'polar', name: '极坐标柱', multi: 'first' },
  { id: 'treemap', name: '矩形树图', multi: 'first' },
  { id: 'waffle', name: '华夫格', multi: 'first' },
  { id: 'funnel', name: '漏斗', multi: 'first' },
  { id: 'rings', name: '进度环', multi: 'first' },
  { id: 'gauge', name: '仪表盘', multi: 'first' },
  { id: 'bignum', name: '大数字', multi: 'first' },
];
export const chartById = (id) => CHARTS.find(c => c.id === id) || CHARTS[0];
/* 按类别着色（每一项一个颜色）的图：图例列的是类别，不是组 */
export const PER_ITEM = new Set(['pie', 'donut', 'rose', 'polar', 'treemap', 'waffle', 'funnel', 'rings']);

/* 多组数据合成一张图时，哪些图画不了、为什么（悬停在灰掉的缩略图上显示）。
   这些图表达的是「一组数里的各项」或「一个数」，第二组数据没有地方放。 */
const ONE_GROUP = {
  pie: '饼图表示一组数里各项各占多少，几组数据叠不进同一个圆',
  donut: '环形图表示一组数里各项各占多少，几组数据叠不进同一个环',
  rose: '玫瑰图的每一瓣是同一组里的一项，放不下第二组',
  polar: '极坐标柱的每一圈是同一组里的一项，放不下第二组',
  treemap: '矩形树图按一组数的占比切分面积，放不下第二组',
  waffle: '华夫格的 100 格按一组数的占比分配，放不下第二组',
  funnel: '漏斗表示同一组数逐级减少的过程，放不下第二组',
  rings: '进度环每个环是同一组里的一项，放不下第二组',
  gauge: '仪表盘只显示一个数',
  bignum: '大数字只显示一个数',
};
/* → { ok, reason, tag }：tag 是缩略图角上的短标签 */
export function chartSupport(id, data, mode) {
  const groups = data.groups.length, n = Math.max(0, ...data.groups.map(g => g.values.length));
  if (id === 'radar' && n > 0 && n < 3) return { ok: false, tag: '至少 3 项', reason: `雷达图至少要 3 项（3 个方向）才围得成形状，现在每组只有 ${n} 项` };
  if (mode !== 'split' && groups > 1 && ONE_GROUP[id]) {
    const alt = ['pie', 'donut', 'treemap', 'waffle'].includes(id) ? '；想对比几组的构成，可以用堆叠柱' : '';
    return { ok: false, tag: '仅单组', reason: `${ONE_GROUP[id]}。想用它，回第一步选「每组一张图」${alt}` };
  }
  return { ok: true, tag: '', reason: '' };
}

/* 按数据形状推荐：返回图表 id，最合适的在前。 */
export function recommend(groups) {
  const g = groups[0];
  if (!g) return ['bar'];
  const n = g.values.length;
  if (groups.length > 1) return ['bar', 'line', 'stack', 'radar', 'area'];
  if (n === 1) return ['gauge', 'rings', 'bignum'];
  const sum = g.values.reduce((a, b) => a + b, 0);
  const parts = g.values.every(v => v >= 0) && n <= 8 && (g.suffix === '%' || Math.abs(sum - 100) <= 5);
  if (parts) return ['donut', 'pie', 'waffle', 'rose', 'bar'];
  if (n >= 8) return ['line', 'area', 'smooth', 'bar'];
  return ['bar', 'hbar', 'lollipop', 'donut'];
}

/* ── 风格预设 ──────────────────────────────────────────────────────────
   palette：7 色，正好对应最多 7 组；panel：卡片底板的颜色（panelOn 是默认开不开）；
   fill：solid 纯色 / gradient 渐变 / glass 玻璃 / hatch 斜线 / sketch 手绘 / outline 描边；
   radius：柱子圆角占柱宽的比例；glow：辉光；font：sans / serif / mono / hand。 */
export const STYLES = [
  { id: 'glass', name: '玻璃', palette: ['#94d82d', '#748ffc', '#3bc9db', '#f783ac', '#ffa94d', '#9775fa', '#63e6be'],
    panel: '#ffffff80', panelOn: false, ink: '#161b33', grid: '#161b3322', fill: 'glass', radius: .32, font: 'sans', weight: 600 },
  { id: 'neon', name: '霓虹', palette: ['#ff2d95', '#00e5ff', '#b4ff39', '#ffd600', '#a66bff', '#ff7a00', '#00ffa3'],
    panel: '#0d0e1f', panelOn: true, ink: '#eef0ff', grid: '#ffffff17', fill: 'gradient', radius: .2, glow: true, font: 'sans', weight: 600 },
  { id: 'mono', name: '极简', palette: ['#111111', '#6b6b6b', '#a3a3a3', '#3d3d3d', '#c9c9c9', '#8a8a8a', '#565656'],
    panel: '#ffffff', panelOn: true, ink: '#111111', grid: '#0000000f', fill: 'solid', radius: 0, font: 'sans', weight: 600 },
  { id: 'swiss', name: '瑞士', palette: ['#e10600', '#111111', '#f5a300', '#0050b5', '#8c8c8c', '#00875a', '#c4c4c4'],
    panel: '#f3f1ec', panelOn: true, ink: '#111111', grid: '#11111126', fill: 'solid', radius: 0, font: 'sans', weight: 700, heavy: true },
  { id: 'pastel', name: '粉彩', palette: ['#ffadc0', '#9cc3ff', '#b7efa6', '#ffd29d', '#c4b5ff', '#96ecf5', '#f6f09a'],
    panel: '#fffaf6', panelOn: true, ink: '#4a3f55', grid: '#4a3f5514', fill: 'solid', radius: .5, font: 'sans', weight: 600 },
  { id: 'sketch', name: '手绘', palette: ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#6741d9', '#0c8599', '#c2255c'],
    panel: '#fffdf5', panelOn: true, ink: '#222222', grid: '#2222221f', fill: 'sketch', radius: 0, font: 'hand', weight: 600 },
  { id: 'blueprint', name: '蓝图', palette: ['#ffffff', '#8fd0ff', '#ffd43b', '#63e6be', '#ffa8a8', '#d0bfff', '#a5d8ff'],
    panel: '#0b3d91', panelOn: true, ink: '#e7f1ff', grid: '#ffffff2e', fill: 'hatch', radius: 0, font: 'mono', weight: 400, dashed: true },
  { id: 'editorial', name: '报刊', palette: ['#1d3557', '#e63946', '#457b9d', '#a8a29e', '#2a9d8f', '#e9c46a', '#6d597a'],
    panel: '#f4eee2', panelOn: true, ink: '#1b1b1b', grid: '#1b1b1b1f', fill: 'solid', radius: 0, font: 'serif', weight: 700 },
  { id: 'dashboard', name: '仪表盘', palette: ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#22d3ee', '#fb7185'],
    panel: '#111827', panelOn: true, ink: '#e5e7eb', grid: '#ffffff14', fill: 'gradient', radius: .25, font: 'sans', weight: 600 },
  { id: 'vivid', name: '渐变', palette: ['#7950f2', '#f06595', '#20c997', '#fd7e14', '#339af0', '#fcc419', '#e64980'],
    panel: '#ffffff', panelOn: true, ink: '#1f1d2b', grid: '#1f1d2b12', fill: 'gradient', radius: .3, font: 'sans', weight: 600 },
];
export const styleById = (id) => STYLES.find(s => s.id === id) || STYLES[0];
export const FONTS = {
  sans: '"IBM Plex Sans","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif',
  serif: 'Georgia,"Songti SC","STSong","Times New Roman",serif',
  mono: '"IBM Plex Mono",ui-monospace,Menlo,"PingFang SC",monospace',
  hand: '"Chalkboard SE","Comic Sans MS","Kaiti SC","KaiTi",cursive',
};

/* ── 数字格式 ──────────────────────────────────────────────────────────
   fmt：{ decimals:'auto'|0|1|2, abbr:'none'|'cn'|'en', group:true|false, prefix, suffix } */
const ABBR = { cn: [[1e8, '亿'], [1e4, '万']], en: [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']] };
export function formatValue(v, fmt = {}) {
  let n = v, unit = '';
  for (const [k, u] of ABBR[fmt.abbr] || []) if (Math.abs(v) >= k) { n = v / k; unit = u; break; }
  const d = fmt.decimals === 'auto' || fmt.decimals === undefined
    ? (Number.isInteger(n) ? 0 : Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2)
    : fmt.decimals;
  let text = Math.abs(n).toFixed(d);
  if (fmt.decimals === 'auto' || fmt.decimals === undefined) text = text.includes('.') ? text.replace(/\.?0+$/, '') : text;
  if (fmt.group !== false) { const [i, f] = text.split('.'); text = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : ''); }
  return (v < 0 ? '−' : '') + (fmt.prefix || '') + text + unit + (fmt.suffix || '');
}

/* 坐标轴刻度：把最大最小值扩到 1 / 2 / 5 × 10ⁿ 的整数倍。柱状图的起点必须是 0。 */
function niceNum(x, round) {
  const e = Math.floor(Math.log10(x)), f = x / 10 ** e;
  const nf = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10);
  return nf * 10 ** e;
}
export function niceScale(min, max, count = 5) {
  min = Math.min(0, min); max = Math.max(0, max);
  if (max === min) max = min + 1;
  const step = niceNum(niceNum(max - min, false) / (count - 1), true);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { min: lo, max: hi, step, ticks };
}

/* ── 动画 ──────────────────────────────────────────────────────────────
   anim：{ effect:'grow'|'fade'|'pop', dur 秒, stagger 0–100, ease:'spring'|'out'|'inout'|'linear', hold 秒, loop }
   第 i 个元素（共 n 个）的原始进度 phase：错峰 0 时同时动，越大越像一道波从左扫到右。
   「自然」是一个从静止出发的阻尼弹簧：起步是缓的（不会猛地弹出来），收尾略冲过 3% 再落回，像有重量的东西停下来。
   「弹跳」是同一个弹簧、阻尼更小，冲过约 17%。 */
const spring = (k, w) => (x) => (x >= 1 ? 1 : 1 - Math.exp(-k * x) * (Math.cos(w * x) + k / w * Math.sin(w * x)));
export const EASES = {
  spring: spring(6, 5.2),
  out: (x) => 1 - (1 - x) ** 4,
  inout: (x) => (x < .5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2),
  linear: (x) => x,
  back: spring(5, 9),
};
export const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
/* 错峰只占总时长的一部分（最多 60%）：不管有几个元素，每个都有至少 40% 的时长慢慢走完，
   元素多的时候也不会一个个「咔咔」地快速弹出 */
export function phase(t, i, n, anim) {
  if (anim.dur <= 0) return 1;
  const spread = n > 1 ? clamp(anim.stagger, 0, 100) / 100 * .6 * anim.dur : 0;
  const w = anim.dur - spread;
  return clamp((t - (n > 1 ? i / (n - 1) * spread : 0)) / w, 0, 1);
}
export const easeOf = (anim) => (anim.effect === 'pop' ? EASES.back : EASES[anim.ease] || EASES.spring);
export const progress = (t, i, n, anim) => easeOf(anim)(phase(t, i, n, anim));
/* 数字往上数：先快后慢地逼近终值（四次方缓出），最后一段只动个位，读起来不跳 */
export const countEase = (x) => 1 - (1 - clamp(x, 0, 1)) ** 4;
/* 一轮的时长：动画 + 结尾停留 */
export const cycle = (anim) => anim.dur + anim.hold;
/* 循环播放：停留结束后整张图淡出，再从头开始，而不是一下子清空 */
export const EXIT = .5, GAP = .15;
export function loopFrame(raw, anim) {
  const len = cycle(anim);
  if (!anim.loop) return { t: Math.min(raw, len), fade: 1 };
  const t = raw % (len + EXIT + GAP);
  if (t <= len) return { t, fade: 1 };
  return { t: len, fade: 1 - smooth((t - len) / EXIT) };
}

/* ── 画幅与导出尺寸 ─────────────────────────────────────────────────── */
export const RATIOS = { '4:3': 4 / 3, '16:9': 16 / 9, '1:1': 1, '3:4': 3 / 4, '9:16': 9 / 16 };
export function exportSize(aspect, long = 1920) {
  const even = (v) => Math.round(v / 2) * 2;        // 视频编码要求偶数边长
  return aspect >= 1 ? { width: long, height: even(long / aspect) } : { width: even(long * aspect), height: long };
}

/* ── 排版 ──────────────────────────────────────────────────────────────
   背景上先放一块「内容区」（开了卡片底板就画成卡片），内容区里再排文字、图例、图表。
   单位 u = √(宽×高)/100，横竖画幅观感一致。 */
export const LAYOUTS = [
  { id: 'plain', name: '纯图' },
  { id: 'top', name: '标题在上' },
  { id: 'side', name: '左文右图' },
  { id: 'kpi', name: '大数字' },
  { id: 'poster', name: '居中海报' },
  { id: 'legend', name: '图例在右' },
  { id: 'caption', name: '底部说明' },
];
export const TEXT = { title: 4.4, sub: 2.2, note: 1.5, kpi: 9, legend: 1.7, label: 1.55 };

/* 多张图拼在一起：挑列数让每格最接近 4:3。 */
export function gridOf(n, w, h) {
  let best = { cols: 1, rows: n, score: Infinity };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols), a = (w / cols) / (h / rows), score = Math.abs(Math.log(a / 1.25)) + (cols * rows - n) * .08;
    if (score < best.score) best = { cols, rows, score };
  }
  return best;
}

/* o：{ W, H, layout, scale(60–100), count(几张图), legend(有没有图例), has:{ title, sub, note } }
   返回每块的位置：card（内容区）、charts[{ x,y,w,h, head }]、title / sub / note / legend / kpi（没有则 null）、align。 */
export function layoutScene(o) {
  const { W, H } = o;
  const u = Math.sqrt(W * H) / 100;
  const k = clamp(o.scale ?? 88, 60, 100) / 100;
  const m = Math.min(W, H) * (1 - k) / 2;
  const card = { x: m, y: m, w: W - 2 * m, h: H - 2 * m, r: k >= 1 ? 0 : Math.min(W, H) * .035 };
  const p = Math.min(card.w, card.h) * .075;
  let R = { x: card.x + p, y: card.y + p, w: card.w - 2 * p, h: card.h - 2 * p };
  const id = LAYOUTS.some(l => l.id === o.layout) ? o.layout : 'plain';
  const has = o.has || {};
  const out = { u, card, title: null, sub: null, note: null, legend: null, kpi: null, align: 'left', charts: [] };
  const take = (h, from = 'top') => {                  // 从 R 的上 / 下边切出一条
    const box = from === 'top' ? { x: R.x, y: R.y, w: R.w, h } : { x: R.x, y: R.y + R.h - h, w: R.w, h };
    R = from === 'top' ? { ...R, y: R.y + h, h: R.h - h } : { ...R, h: R.h - h };
    return box;
  };
  const titleH = (scale = 1) => TEXT.title * u * scale * 1.25;
  const subH = TEXT.sub * u * 1.45, noteH = TEXT.note * u * 2.2, legendH = TEXT.legend * u * 2.4;

  if (id === 'side') {
    const col = { x: R.x, y: R.y, w: R.w * .34, h: R.h };
    R = { x: R.x + R.w * .38, y: R.y, w: R.w * .62, h: R.h };
    let y = col.y + col.h * .22;
    if (has.title) { out.title = { x: col.x, y, w: col.w, h: titleH() * 2 }; y += titleH() * 2 + u; }
    if (has.sub) { out.sub = { x: col.x, y, w: col.w, h: subH * 3 }; y += subH * 3 + u * 2; }
    if (o.legend) out.legend = { x: col.x, y, w: col.w, h: col.y + col.h - y - noteH, vertical: true };
    if (has.note) out.note = { x: col.x, y: col.y + col.h - noteH, w: col.w, h: noteH };
  } else if (id === 'legend') {
    if (has.title) out.title = take(titleH());
    if (has.sub) out.sub = take(subH + u);
    if (has.note) out.note = take(noteH, 'bottom');
    take(u * 2);
    if (o.legend) { out.legend = { x: R.x + R.w * .76, y: R.y, w: R.w * .24, h: R.h, vertical: true }; R = { ...R, w: R.w * .72 }; }
  } else if (id === 'caption') {
    if (has.note) out.note = take(noteH, 'bottom');
    if (has.sub) out.sub = take(subH, 'bottom');
    if (has.title) out.title = take(titleH(), 'bottom');
    if (has.title || has.sub) take(u * 2, 'bottom');
    if (o.legend) { out.legend = take(legendH); }
  } else if (id === 'poster') {
    out.align = 'center';
    if (has.title) out.title = take(titleH(1.5));
    if (has.sub) out.sub = take(subH + u);
    if (has.note) out.note = take(noteH, 'bottom');
    take(u * 2);
    if (o.legend) out.legend = take(legendH);
  } else if (id === 'kpi') {
    if (has.title) out.title = take(TEXT.sub * u * 1.6);
    out.kpi = take(TEXT.kpi * u * 1.2);
    if (has.sub) out.sub = take(subH);
    if (has.note) out.note = take(noteH, 'bottom');
    take(u * 2);
    if (o.legend) out.legend = take(legendH);
  } else if (id === 'top') {
    if (has.title) out.title = take(titleH());
    if (has.sub) out.sub = take(subH + u);
    if (has.note) out.note = take(noteH, 'bottom');
    if (has.title || has.sub) take(u * 2);
    if (o.legend) out.legend = take(legendH);
  } else {
    if (o.legend) out.legend = take(legendH);
  }

  const n = Math.max(1, o.count || 1);
  if (n === 1) out.charts = [{ x: R.x, y: R.y, w: R.w, h: R.h, head: null }];
  else {
    const { cols, rows } = gridOf(n, R.w, R.h), gap = u * 3, headH = TEXT.label * u * 2;
    const cw = (R.w - gap * (cols - 1)) / cols, ch = (R.h - gap * (rows - 1)) / rows;
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const x = R.x + c * (cw + gap), y = R.y + r * (ch + gap);
      out.charts.push({ x, y: y + headH, w: cw, h: ch - headH, head: { x, y, w: cw, h: headH } });
    }
  }
  return out;
}

/* ── 一帧的完整描述 ────────────────────────────────────────────────────
   data：parseData 的结果；s：页面设置；opts：{ interactive, bgLight（背景亮不亮，决定没有卡片时的文字颜色） }。
   返回 { layout, statics（静态层）, dyn（动态层） }，分别交给 drawStatic / drawDynamic。 */
export function resolveAbbr(abbr, groups) {
  if (abbr !== 'auto') return abbr;
  const scaled = groups.map(g => g.scaled).find(Boolean) || '';
  return /[万亿千]/.test(scaled) ? 'cn' : scaled ? 'en' : 'none';
}
export function chartsToDraw(data, s) {
  const groups = data.groups;
  if (!groups.length) return [];
  if (s.mode !== 'split') return [groups.map((g, i) => ({ g, i }))];
  if (s.splitView === 'grid') return groups.map((g, i) => [{ g, i }]);
  const k = clamp(s.current || 0, 0, groups.length - 1);
  return [[{ g: groups[k], i: k }]];
}
export function buildFrame(data, s, W, H, opts = {}) {
  const style = styleById(s.style), type = chartById(s.chart).id;
  const sets = chartsToDraw(data, s);
  const abbr = resolveAbbr(s.abbr, data.groups);
  const fmtOf = (g) => ({ prefix: g.prefix, suffix: g.suffix, decimals: s.decimals, abbr, group: true });
  const perItem = PER_ITEM.has(type);
  const multi = sets.length === 1 && sets[0].length > 1;
  const labels = data.labels || null;
  const n = Math.max(0, ...data.groups.map(g => g.values.length));
  const catNames = Array.from({ length: n }, (_, i) => labels?.[i] ?? String(i + 1));
  let legend = [];
  if (perItem) legend = catNames.slice(0, type === 'rings' ? 6 : n).map((name, i) => ({ name, color: style.palette[i % 7] }));
  else if (multi && !['gauge', 'bignum'].includes(type)) legend = sets[0].map(({ g, i }) => ({ name: g.name, color: style.palette[i % 7] }));
  const has = {};
  for (const f of ['title', 'sub', 'note']) has[f] = !!(s[f] || '').trim() || !!opts.interactive;
  const layout = layoutScene({ W, H, layout: s.layout, scale: s.scale, count: sets.length, legend: legend.length > 1, has });
  const onPanel = !!s.panel;
  const ink = onPanel ? style.ink : opts.bgLight === false ? '#ffffff' : '#16202e';
  const charts = sets.map((set, k) => ({
    box: layout.charts[k], type,
    series: set.map(({ g, i }) => ({ name: g.name, values: g.values, color: style.palette[i % 7] })),
    labels, fmt: fmtOf(set[0].g),
  }));
  let kpi = null;
  if (layout.kpi && sets.length) {
    const g = sets[0][0].g, v = g.values.at(-1) ?? 0, prev = g.values.length > 1 ? g.values.at(-2) : null;
    kpi = { box: layout.kpi, value: v, change: prev ? (v - prev) / Math.abs(prev) * 100 : null, fmt: fmtOf(g) };
  }
  const u = layout.u;
  return {
    layout,
    statics: { layout, style, ink, u, panel: onPanel ? style.panel : null, texts: { title: s.title || '', sub: s.sub || '', note: s.note || '' }, legend, heads: sets.length > 1 ? sets.map(set => set[0].g.name) : [], hide: opts.hide || null },
    dyn: { u, style, ink, panel: style.panel, onPanel, anim: s.anim, show: { grid: s.grid, values: s.values }, charts, kpi, align: layout.align },
  };
}
