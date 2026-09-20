// SPDX-License-Identifier: MIT
// Rubric 的纯逻辑层：由少量参数生成两套主题、算对比度、导出 Markdown。
// 不碰 DOM，便于单独测试。
import {hexToLab, lchToHex} from './color.js';

/* ── 对比度（WCAG 2.1 相对亮度） ─────────────────────────────────────── */
const channel = v => (v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
export function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return .2126 * r + .7152 * g + .0722 * b;
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + .05) / (lo + .05);
}

/* ── OKLCH ──────────────────────────────────────────────────────────── */
export function hexToLch(hex) {
  const [L, a, b] = hexToLab(hex);
  return {L, C: Math.hypot(a, b), h: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360};
}
export const lchHex = ({L, C, h}) => lchToHex(Math.max(0, Math.min(1, L)), Math.max(0, C), h);

/* ── 主题生成 ────────────────────────────────────────────────────────
   两套主题由同一组参数生成，所以「link」不是去反推另一套颜色，而是让两边
   共用参数后各自重算 —— 逐个色去反相很难保持层级关系，从同一处生成则天然一致。

   每个 token 给的是明度位置，contrast 参数把正文与底色的距离整体拉开或收紧。 */
const LIGHT = {bg: 1, surface: .975, 'surface-2': 1, 'surface-3': .945,
  border: .905, 'border-strong': .80, text: .20, 'text-2': .47, 'text-3': .54};
const DARK = {bg: .17, surface: .215, 'surface-2': .255, 'surface-3': .305,
  border: .30, 'border-strong': .43, text: .93, 'text-2': .73, 'text-3': .66};
const TEXT_KEYS = ['text', 'text-2', 'text-3'];

export const ROLES = {
  bg: '页面底', surface: '面板 / 卡片', 'surface-2': '输入框 / 按钮', 'surface-3': '悬停',
  border: '分隔线', 'border-strong': '控件描边',
  text: '正文', 'text-2': '次级文字', 'text-3': '元信息',
  accent: '主操作 / 激活', 'accent-fg': '强调色上的文字',
  'accent-2': '次要强调', 'accent-2-fg': '次要强调上的文字',
};

/* 在给定色相色度上扫明度，找刚好够到目标对比度的那一个。
   达标者优先；都达标时取最接近目标的，避免冲过头把颜色洗白或压死。 */
function solveForContrast(h, C, bg, target, near = null) {
  let best = null;
  for (let i = 0; i <= 200; i++) {
    const L = i / 200;
    const hex = lchHex({L, C, h});
    const ratio = contrast(hex, bg);
    const ok = ratio >= target;
    const score = ok ? (near === null ? ratio - target : Math.abs(L - near)) : target - ratio;
    if (!best || (ok && !best.ok) || (ok === best.ok && score < best.score)) best = {hex, ratio, ok, score};
  }
  return best.hex;
}

// 强调色落到目标主题：保住色相，按需要调明度去够对比度，深底上略降色度避免发光。
export function adaptAccent(hex, theme, bg, target = 4.5) {
  const {h, C, L} = hexToLch(hex);
  return solveForContrast(h, theme === 'dark' ? C * .92 : C, bg, target, L);
}

export function buildTheme(params, theme) {
  const {hue, chroma, contrast: spread, accent, accent2, duo} = params;
  const base = theme === 'dark' ? DARK : LIGHT;
  const out = {};
  for (const [key, L] of Object.entries(base)) {
    // 中性色带一点点所选色相，成为有倾向的灰，而不是死灰
    const tint = key.startsWith('text') ? chroma * .4 : chroma;
    const shifted = TEXT_KEYS.includes(key)
      ? (theme === 'dark' ? L + (1 - L) * (spread - 1) : L * (2 - spread))
      : L;
    out[key] = lchHex({L: Math.max(0, Math.min(1, shifted)), C: tint / 100, h: hue});
  }
  /* 控件描边按 WCAG 1.4.11 的 3:1 解出来，而不是写死一个明度 ——
     色相、色度、对比强度怎么动它都自洽，不会悄悄掉到标准以下。 */
  out['border-strong'] = solveForContrast(hue, chroma / 100, out['surface-2'], 3.05,
    theme === 'dark' ? .62 : .60);
  out.accent = adaptAccent(accent, theme, out.bg, 4.5);
  out['accent-fg'] = contrast('#ffffff', out.accent) >= contrast('#0d0d0d', out.accent) ? '#ffffff' : '#0d0d0d';
  if (duo) {
    out['accent-2'] = adaptAccent(accent2, theme, out.bg, 4.5);
    out['accent-2-fg'] = contrast('#ffffff', out['accent-2']) >= contrast('#0d0d0d', out['accent-2']) ? '#ffffff' : '#0d0d0d';
  }
  return out;
}

/* ── 检查 ────────────────────────────────────────────────────────────
   每个 token 对着它实际会出现的底色比，取最差的一种；非文本按 3.0 判。 */
export function audit(tokens) {
  const on = (fg, ...backgrounds) =>
    Math.min(...backgrounds.map(bg => contrast(tokens[fg], tokens[bg])));
  const rows = [
    ...TEXT_KEYS.map(key => ({key, ratio: on(key, 'bg', 'surface', 'surface-2'), need: 4.5, kind: '文本'})),
    {key: 'border-strong', ratio: on('border-strong', 'surface-2', 'surface'), need: 3, kind: '非文本'},
    {key: 'accent-fg', ratio: contrast(tokens['accent-fg'], tokens.accent), need: 4.5, kind: '文本'},
    {key: 'accent', ratio: on('accent', 'bg', 'surface'), need: 3, kind: '非文本'},
  ];
  if (tokens['accent-2']) rows.push(
    {key: 'accent-2-fg', ratio: contrast(tokens['accent-2-fg'], tokens['accent-2']), need: 4.5, kind: '文本'},
    {key: 'accent-2', ratio: on('accent-2', 'bg', 'surface'), need: 3, kind: '非文本'});
  return rows.map(r => ({...r, ratio: Math.round(r.ratio * 100) / 100, pass: r.ratio >= r.need}));
}

/* ── Markdown ────────────────────────────────────────────────────────
   写给 agent 看，所以给的是可直接落地的 token 和规则，不是形容词。 */
const table = (tokens, checks) => {
  const by = Object.fromEntries(checks.map(c => [c.key, c]));
  return ['| Token | 值 | 用途 | 对比度 |', '|---|---|---|---|',
    ...Object.entries(tokens).map(([key, hex]) => {
      const c = by[key];
      const note = c ? `${c.ratio}${c.pass ? '' : ' ⚠ 低于 ' + c.need}` : '—';
      return `| \`--${key}\` | \`${hex.toUpperCase()}\` | ${ROLES[key] || ''} | ${note} |`;
    })].join('\n');
};

export function toMarkdown({params, light, dark, type}) {
  const lc = audit(light), dc = audit(dark);
  // 同名 token 分属两套主题，告警必须带上是哪一套
  const failed = [...lc.map(c => ({...c, theme: '浅色'})), ...dc.map(c => ({...c, theme: '深色'}))].filter(c => !c.pass);
  return `# UI 设计规范

由 Luxel Rubric 生成。把本文件内容贴进项目的 \`agent.md\`，让 agent 按此实现界面。

## 色彩

模式：${params.duo ? '双色' : '单色'}${params.duo ? `（主强调 \`${params.accent.toUpperCase()}\`，次强调 \`${params.accent2.toUpperCase()}\`）` : `（强调色 \`${params.accent.toUpperCase()}\`）`}

### 浅色

${table(light, lc)}

### 深色

${table(dark, dc)}

深色由浅色的同一组参数重算得出，不是逐色反相 —— 所以两套的层级关系一致。

## 字体

| 用途 | 字重 | 字号 |
|---|---|---|
| 正文 | ${type.body} | ${type.size}px |
| 强调 | ${type.strong} | ${type.size}px |
| 标题 | ${type.heading} | ${Math.round(type.size * type.scale)}px |
| 等宽 | ${type.body} | ${type.size - 1}px |

字号按 ${type.scale} 倍逐级放大。机器值（ID、色值、时间、数字读数）一律等宽字体，人读文案一律比例字体。

## 实现规则

1. 所有颜色以 CSS 自定义属性定义在 \`:root\`，深色模式用 \`prefers-color-scheme\` 覆盖，并允许 \`[data-theme]\` 手动覆盖。
2. 不要为深色模式单独写一套组件样式，只换 token。
3. 正文类文字对底色至少 4.5:1，大字与非文本元素至少 3:1。
4. 焦点态用 \`--text\` 实色描边，不要只靠改变底色表示焦点。
5. 激活 / 选中状态不能只用颜色区分，同时改变填充或字重，保证色觉障碍下仍可分辨。
${failed.length ? `\n> ⚠ 本规范有 ${failed.length} 处未达标：${failed.map(c => `${c.theme} \`--${c.key}\`(${c.ratio})`).join('、')}。落地前请调整。` : '\n所有组合均满足 WCAG AA。'}
`;
}
