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

const BASE_ROLES = {
  bg: '页面底', surface: '面板 / 卡片', 'surface-2': '输入框 / 按钮', 'surface-3': '悬停',
  border: '分隔线', 'border-strong': '控件描边',
  text: '正文', 'text-2': '次级文字', 'text-3': '元信息',
  accent: '主操作 / 激活', 'accent-fg': '强调色上的文字',
};
export function roleOf(key) {
  if (BASE_ROLES[key]) return BASE_ROLES[key];
  const m = key.match(/^accent-(\d+)(-fg)?$/);
  if (m) return m[2] ? `强调 ${m[1]} 上的文字` : `强调色 ${m[1]}`;
  return '';
}
export const ROLES = new Proxy({}, {get: (_, key) => roleOf(String(key))});

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
  const {hue, chroma, contrast: spread} = params;
  // accents 是数组：单色一个，双色两个，多色 n 个。第一个永远是主强调。
  const accents = params.accents || [params.accent];
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
  accents.forEach((hex, i) => {
    const key = i === 0 ? 'accent' : `accent-${i + 1}`;
    out[key] = adaptAccent(hex, theme, out.bg, 4.5);
    out[key + '-fg'] = contrast('#ffffff', out[key]) >= contrast('#0d0d0d', out[key]) ? '#ffffff' : '#0d0d0d';
  });
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
  for (const key of Object.keys(tokens).filter(k => /^accent-\d+$/.test(k))) rows.push(
    {key: key + '-fg', ratio: contrast(tokens[key + '-fg'], tokens[key]), need: 4.5, kind: '文本'},
    {key, ratio: on(key, 'bg', 'surface'), need: 3, kind: '非文本'});
  return rows.map(r => ({...r, ratio: Math.round(r.ratio * 100) / 100, pass: r.ratio >= r.need}));
}

/* ── 配色关系 ────────────────────────────────────────────────────────
   只报三种能说清「为什么不好」的情况，不做笼统的审美评判。
   每条都给出可执行的修法，因为规范是要交给 agent 落地的。 */
const hueGap = (a, b) => {const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d;};
// OKLab 欧氏距离，约等于感知色差
export function deltaE(a, b) {
  const x = hexToLab(a), y = hexToLab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

export function harmonyIssues(accents) {
  const lch = accents.map(hexToLch);
  const issues = [];
  for (let i = 0; i < accents.length; i++) {
    for (let j = i + 1; j < accents.length; j++) {
      const a = lch[i], b = lch[j], dh = hueGap(a.h, b.h), dL = Math.abs(a.L - b.L);
      const pair = [i, j];
      if (dh >= 7 && dh <= 28)
        issues.push({pair, kind: '色相过近', text:
          `两色色相只差 ${Math.round(dh)}°，读起来像没调准而不是有意为之。要么统一成同一色相靠明度区分，要么拉开到 40° 以上。`});
      else if (a.C > .085 && b.C > .085 && dh >= 150 && dL < .1)
        issues.push({pair, kind: '边缘振动', text:
          `两个高饱和的近互补色明度只差 ${dL.toFixed(2)}，相邻时边界会发抖。把其中一个的明度拉开，或降低其饱和度。`});
      // 用 OKLab 色差而不是亮度对比：强调色都被拉到对底色约 4.5，彼此亮度本就接近，
      // 拿亮度判「能否区分」会把蓝和橙也算成一样。色差才反映看不看得出不同。
      if (deltaE(accents[i], accents[j]) < .055)
        issues.push({pair, kind: '彼此难分', text:
          `两色的感知差异只有 ${deltaE(accents[i], accents[j]).toFixed(3)}，并排出现时几乎分不出来。换一个色相或拉开明度。`});
    }
  }
  return issues;
}

// 某个明度上这个色相最多能有多艳：借 lchToHex 自带的色域收敛，给足色度让它夹回来
const maxChromaAt = (L, h) => hexToLch(lchHex({L, C: .4, h})).C;

/* 以主强调色为基准的配色建议。
   不能照搬原色的明度 —— 同一色度在不同色相上未必可达：蓝可以又暗又艳，
   黄在同样的暗度下会被色域夹成脏橄榄色。所以每个目标色相自己挑一个
   能撑住相近色度的明度，只在同分时才偏向贴近原色明度。 */
export function recommend(baseHex) {
  const {L, h} = hexToLch(baseHex);
  // 无彩度的基色转色相不会有任何变化，七个推荐会全是同一个灰。
  // 这种情况下给一个可用的色度，让推荐真的是颜色。
  const C = Math.max(hexToLch(baseHex).C, .16);
  return [
    ['互补', 180], ['分裂互补', 150], ['分裂互补', 210],
    ['三分', 120], ['三分', 240], ['邻近', 32], ['邻近', -32],
  ].map(([label, delta]) => {
    const hue = (h + delta + 360) % 360;
    let best = null;
    for (let i = 30; i <= 88; i++) {
      const cand = i / 100;
      const reach = Math.min(C, maxChromaAt(cand, hue));
      const score = reach - Math.abs(cand - L) * .05;
      if (!best || score > best.score) best = {score, L: cand, C: reach};
    }
    // 近互补且两边都艳时，明度必须错开 —— 否则推出来的组合会正好撞上
    // 「边缘振动」那条告警，等于自荐一个自己要警告的配色。
    const near = Math.abs(delta) >= 150 && Math.abs(delta) <= 210;
    if (near && best.C > .085 && C > .085 && Math.abs(best.L - L) < .12) {
      const up = Math.min(.88, L + .14), down = Math.max(.3, L - .14);
      const pick = maxChromaAt(up, hue) >= maxChromaAt(down, hue) ? up : down;
      best = {L: pick, C: Math.min(C, maxChromaAt(pick, hue))};
    }
    // 最后兜一道：推荐色不能落进「彼此难分」的范围，否则就是自荐一个要被警告的配色
    let hex = lchHex({L: best.L, C: best.C, h: hue});
    for (let step = 1; step <= 6 && deltaE(baseHex, hex) < .07; step++) {
      const away = best.L >= L ? Math.min(.9, best.L + step * .05) : Math.max(.28, best.L - step * .05);
      hex = lchHex({L: away, C: Math.min(C, maxChromaAt(away, hue)), h: hue});
    }
    return {label, delta, hex};
  });
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
  const issues = harmonyIssues(params.accents);
  return `# UI 设计规范

由 Luxel Rubric 生成。把本文件内容贴进项目的 \`agent.md\`，让 agent 按此实现界面。

## 色彩

模式：${['单色', '双色', '多色'][Math.min(params.accents.length, 3) - 1]}（${params.accents.map((c, i) => `${i ? '强调 ' + (i + 1) : '主强调'} \`${c.toUpperCase()}\``).join('，')}）

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
${issues.length ? `\n### 配色关系\n\n${issues.map(i => `- **${i.kind}**（强调 ${i.pair[0] + 1} 与 强调 ${i.pair[1] + 1}）：${i.text}`).join('\n')}\n` : ''}${failed.length ? `\n> ⚠ 本规范有 ${failed.length} 处未达标：${failed.map(c => `${c.theme} \`--${c.key}\`(${c.ratio})`).join('、')}。落地前请调整。` : '\n所有组合均满足 WCAG AA。'}
`;
}
