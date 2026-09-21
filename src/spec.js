// SPDX-License-Identifier: MIT
// Rubric 的纯逻辑层：由少量参数生成两套主题、算对比度、导出 Markdown。
// 不碰 DOM，便于单独测试。
import {hexToLab, lchToHex} from './color.js';

const PALETTE = ['#3b5bdb', '#e8590c', '#2f9e44', '#c2255c', '#7048e8', '#0c8599'];
export const RUBRIC_DEFAULTS = {
  hue: 250, chroma: 2, contrast: 1, count: 1, linked: true, adaptAccents: true,
  accents: ['#3b5bdb'], multiCount: 2, selectedAccent: 0, typeLinked: false,
  bodyWeight: 400, bodySize: 15, strongWeight: 600, strongSize: 15,
  headingWeight: 650, headingSize: 24, monoWeight: 400, monoSize: 14,
};
const hexValue = (value, fallback) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
const numeric = (value, fallback, min, max, step = 1) => Number.isFinite(value)
  ? Math.min(max, Math.max(min, Math.round(value / step) * step)) : fallback;

// A starting hierarchy for this tool, not a universal typography standard.
export const TYPE_RELATIONS = {
  body: {ratio: 1, offset: 0}, strong: {ratio: 1, offset: 200},
  heading: {ratio: 1.6, offset: 250}, mono: {ratio: 14 / 15, offset: 0},
};
export function typographyBounds(key, linked) {
  const match = key.match(/^(body|strong|heading|mono)(Size|Weight)$/);
  if (!match) throw new Error('Unknown typography control');
  const [, role, property] = match;
  if (property === 'Weight') return linked
    ? {min: 300 + TYPE_RELATIONS[role].offset, max: 550 + TYPE_RELATIONS[role].offset, step: 50}
    : {min: 300, max: 800, step: 50};
  return linked
    ? {min: Math.round((11 / TYPE_RELATIONS.mono.ratio) * TYPE_RELATIONS[role].ratio), max: Math.round(25 * TYPE_RELATIONS[role].ratio), step: 1}
    : {min: 11, max: 40, step: 1};
}
export function updateTypography(state, key, value) {
  const {min, max, step} = typographyBounds(key, state.typeLinked);
  const next = {...state};
  const requested = numeric(value, state[key], min, max, step);
  if (!state.typeLinked) { next[key] = requested; return next; }
  const [, role, property] = key.match(/^(body|strong|heading|mono)(Size|Weight)$/);
  if (property === 'Size') {
    const base = Math.max(11 / TYPE_RELATIONS.mono.ratio, Math.min(25, requested / TYPE_RELATIONS[role].ratio));
    next.typeSizeBase = base;
    for (const [name, {ratio}] of Object.entries(TYPE_RELATIONS)) next[name + 'Size'] = Math.round(base * ratio);
  } else {
    const base = requested - TYPE_RELATIONS[role].offset;
    next.typeWeightBase = base;
    for (const [name, {offset}] of Object.entries(TYPE_RELATIONS)) next[name + 'Weight'] = base + offset;
  }
  return next;
}
export function toggleTypographyLink(state) {
  const next = {...state, typeLinked: !state.typeLinked};
  // On enable, use current body settings as the anchor for the preset.
  return next.typeLinked ? updateTypography(updateTypography(next, 'bodySize', next.bodySize), 'bodyWeight', next.bodyWeight) : next;
}

// Product heuristics for inspection, not WCAG thresholds or font-independent
// failures. Real legibility also depends on glyph design, spacing and content.
export function typographyAdvice(rows) {
  return rows.flatMap(row => {
    if ((row.size <= 14 && row.weight >= 700) || (row.size <= 16 && row.weight >= 800))
      return [{key: row.key, label: row.label, kind: '小字偏重', text:
        `${row.size}px 搭配 ${row.weight} 字重，部分字体尤其笔画复杂的汉字可能显得拥挤。可试着降低一到两档字重，或增大字号；短标签需要强调时也可以保留，并用实际字体确认。`}];
    if (row.size <= 14 && row.weight < 400)
      return [{key: row.key, label: row.label, kind: '小字偏细', text:
        `${row.size}px 搭配 ${row.weight} 字重，细笔画在小尺寸下可能显得偏淡。可试着提高到 400 字重或增大字号，并检查实际文字与背景的对比度。`}];
    return [];
  });
}
export function rubricThemeParams(state) {
  return {hue: state.hue, chroma: state.chroma, contrast: state.contrast,
    adaptAccents: state.adaptAccents, accents: [...state.accents], backgrounds: cleanBackgrounds(state.backgrounds)};
}
function cleanBackgrounds(raw) {
  return Object.fromEntries(['light', 'dark'].map(theme => {
    const setting = raw?.[theme] || {};
    return [theme, {mode: ['custom', 'linked'].includes(setting.mode) ? setting.mode : 'default',
      color: hexValue(setting.color, theme === 'dark' ? '#0f0f0f' : '#ffffff'),
      variant: numeric(setting.variant, 1, 0, 4), accentIndex: numeric(setting.accentIndex, 0, 0, 5)}];
  }));
}
export function recommendBackgrounds(accent, theme) {
  const {h, C} = hexToLch(accent);
  const dark = theme === 'dark';
  return ['素色', '微染', '柔染', '色雾', '浓染'].map((label, i) => ({label,
    hex: lchHex({L: dark ? .14 + i * .022 : .992 - i * .012,
      C: Math.min(C * (.06 + i * .08), dark ? .012 + i * .006 : .004 + i * .005), h})}));
}
export function backgroundTextWarnings(tokens) {
  return TEXT_KEYS.map(key => ({key, ratio: contrast(tokens[key], tokens.bg)}))
    .filter(item => item.ratio < 4.5)
    .map(item => ({...item, ratio: Math.round(item.ratio * 100) / 100}));
}
// Top-level color settings belong to light; the old dark snapshot also serves
// as an independently editable palette. Typography remains shared.
const paletteFields = state => ({...rubricThemeParams(state), count: state.count,
  multiCount: state.multiCount, selectedAccent: state.selectedAccent,
  paletteMemory: [...state.paletteMemory]});
export function rubricEditorState(state) {
  return !state.linked && state.editingTheme === 'dark' ? state.darkSnapshot : state;
}
export function updateRubricColors(state, update) {
  const editor = rubricEditorState(state);
  const next = update({...editor, accents: [...editor.accents], paletteMemory: [...editor.paletteMemory]});
  return !state.linked && state.editingTheme === 'dark'
    ? {...state, darkSnapshot: paletteFields(next)} : {...state, ...paletteFields(next)};
}
function cleanThemeParams(raw, fallback) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    hue: numeric(input.hue, fallback.hue, 0, 360),
    chroma: numeric(input.chroma, fallback.chroma, 0, 10, .1),
    contrast: numeric(input.contrast, fallback.contrast, .6, 1.3, .01),
    adaptAccents: typeof input.adaptAccents === 'boolean' ? input.adaptAccents : fallback.adaptAccents,
    backgrounds: cleanBackgrounds(input.backgrounds),
    accents: Array.isArray(input.accents) && input.accents.length
      ? input.accents.slice(0, 6).map((hex, i) => hexValue(hex, PALETTE[i])) : [...fallback.accents],
  };
}
export function normalizeRubricState(raw = {}) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const state = {...RUBRIC_DEFAULTS, ...cleanThemeParams(input, RUBRIC_DEFAULTS)};
  state.count = numeric(input.count, state.accents.length, 1, 6);
  state.linked = input.linked !== false;
  state.editingTheme = input.editingTheme === 'dark' ? 'dark' : 'light';
  state.typeLinked = input.typeLinked === true;
  state.paletteMemory = PALETTE.map((hex, i) => hexValue(input.paletteMemory?.[i], hex));
  state.accents.forEach((hex, i) => { state.paletteMemory[i] = hex; });
  state.accents = state.paletteMemory.slice(0, state.count);
  state.multiCount = numeric(input.multiCount, Math.max(2, state.count), 2, 6);
  state.selectedAccent = numeric(input.selectedAccent, Math.max(0, state.count - 1), 0, state.count - 1);
  for (const key of ['body', 'strong', 'heading', 'mono']) {
    state[key + 'Weight'] = numeric(input[key + 'Weight'], RUBRIC_DEFAULTS[key + 'Weight'], 300, 800, 50);
    state[key + 'Size'] = numeric(input[key + 'Size'], RUBRIC_DEFAULTS[key + 'Size'], 11, 40);
  }
  if (state.typeLinked) {
    state.typeSizeBase = Math.max(11 / TYPE_RELATIONS.mono.ratio, Math.min(25,
      Number.isFinite(input.typeSizeBase) ? input.typeSizeBase : state.bodySize));
    state.typeWeightBase = numeric(input.typeWeightBase, Math.min(550, state.bodyWeight), 300, 550, 50);
    for (const [key, {ratio, offset}] of Object.entries(TYPE_RELATIONS)) {
      state[key + 'Size'] = Math.round(state.typeSizeBase * ratio);
      state[key + 'Weight'] = state.typeWeightBase + offset;
    }
  }
  state.darkSnapshot = state.linked ? null : cleanThemeParams(input.darkSnapshot || {
    ...rubricThemeParams(state), accents: input.darkAccents || state.accents,
  }, state);
  if (state.darkSnapshot) {
    const dark = state.darkSnapshot, saved = input.darkSnapshot || {};
    dark.count = dark.accents.length;
    dark.multiCount = numeric(saved.multiCount, Math.max(2, dark.count), 2, 6);
    dark.selectedAccent = numeric(saved.selectedAccent, 0, 0, dark.count - 1);
    dark.paletteMemory = PALETTE.map((hex, i) => hexValue(saved.paletteMemory?.[i], hex));
    dark.accents.forEach((hex, i) => { dark.paletteMemory[i] = hex; });
  }
  return state;
}
export function resizeRubricPalette(state, count) {
  const n = numeric(count, state.count, 1, 6);
  const paletteMemory = [...state.paletteMemory];
  state.accents.forEach((hex, i) => { paletteMemory[i] = hex; });
  return {...state, count: n, paletteMemory, accents: paletteMemory.slice(0, n),
    multiCount: n > 1 ? n : state.multiCount,
    selectedAccent: Math.min(state.count === 1 && n > 1 ? 1 : state.selectedAccent, n - 1)};
}
export function toggleRubricLink(state) {
  // Relinking takes the visible editor as the source, avoiding silently
  // throwing away the dark adjustments the user was just working on.
  return state.linked
    ? {...state, linked: false, darkSnapshot: paletteFields(state)}
    : {...state, ...paletteFields(rubricEditorState(state)),
      backgrounds: {light: cleanBackgrounds(state.backgrounds).light, dark: cleanBackgrounds(state.darkSnapshot.backgrounds).dark},
      linked: true, darkSnapshot: null};
}
export function buildRubricThemes(state) {
  const current = rubricThemeParams(state);
  return {light: buildTheme(current, 'light'), dark: buildTheme(state.linked ? current : state.darkSnapshot, 'dark')};
}

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
  border: .905, 'border-strong': .80, text: .20, 'text-2': .47, 'text-3': .525};
const DARK = {bg: .17, surface: .215, 'surface-2': .255, 'surface-3': .305,
  border: .30, 'border-strong': .43, text: .93, 'text-2': .73, 'text-3': .675};
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
    const ratio = Math.min(...(Array.isArray(bg) ? bg : [bg]).map(background => contrast(hex, background)));
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
  // 单色一个，多色 2–6 个。第一个永远是主强调。
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
  const background = cleanBackgrounds(params.backgrounds)[theme];
  if (background.mode === 'custom') out.bg = background.color;
  if (background.mode === 'linked') out.bg = recommendBackgrounds(
    accents[Math.min(background.accentIndex, accents.length - 1)], theme)[background.variant].hex;
  /* 控件描边按 WCAG 1.4.11 的 3:1 解出来，而不是写死一个明度 ——
     色相、色度、对比强度怎么动它都自洽，不会悄悄掉到标准以下。 */
  out['border-strong'] = solveForContrast(hue, chroma / 100, [out.bg, out.surface, out['surface-2'], out['surface-3']], 3.05,
    theme === 'dark' ? .62 : .60);
  accents.forEach((hex, i) => {
    const key = i === 0 ? 'accent' : `accent-${i + 1}`;
    out[key] = params.adaptAccents === false ? hex : adaptAccent(hex, theme, out.bg, 4.5);
    out[key + '-fg'] = contrast('#ffffff', out[key]) >= contrast('#000000', out[key]) ? '#ffffff' : '#000000';
  });
  return out;
}

/* ── 检查 ────────────────────────────────────────────────────────────
   每个 token 对着它实际会出现的底色比，取最差的一种；非文本按 3.0 判。 */
export function audit(tokens) {
  const on = (fg, ...backgrounds) =>
    Math.min(...backgrounds.map(bg => contrast(tokens[fg], tokens[bg])));
  const rows = [
    ...TEXT_KEYS.map(key => ({key, ratio: on(key, 'bg', 'surface', 'surface-2', 'surface-3'), need: 4.5, kind: '文本'})),
    {key: 'border-strong', ratio: on('border-strong', 'bg', 'surface-2', 'surface', 'surface-3'), need: 3, kind: '非文本'},
    {key: 'accent-fg', ratio: contrast(tokens['accent-fg'], tokens.accent), need: 4.5, kind: '文本'},
    {key: 'accent', ratio: on('accent', 'bg', 'surface', 'surface-2', 'surface-3'), need: 3, kind: '非文本'},
  ];
  for (const key of Object.keys(tokens).filter(k => /^accent-\d+$/.test(k))) rows.push(
    {key: key + '-fg', ratio: contrast(tokens[key + '-fg'], tokens[key]), need: 4.5, kind: '文本'},
    {key, ratio: on(key, 'bg', 'surface', 'surface-2', 'surface-3'), need: 3, kind: '非文本'});
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
      if (a.C > .03 && b.C > .03 && dL < .1 && dh >= 7 && dh <= 28)
        issues.push({pair, kind: '色相过近', text:
          `两色色相只差 ${Math.round(dh)}°且明度接近。若需要表达不同状态，建议拉开明度或色相；有意使用相近色系时可保留。`});
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

export function themeHarmonyIssues(light, dark) {
  return [['浅色', light], ['深色', dark]].flatMap(([theme, tokens]) =>
    harmonyIssues(Object.entries(tokens).filter(([key]) => /^accent(?:-\d+)?$/.test(key)).map(([, hex]) => hex))
      .map(issue => ({...issue, theme})));
}

// 某个明度上这个色相最多能有多艳：借 lchToHex 自带的色域收敛，给足色度让它夹回来
const maxChromaAt = (L, h) => hexToLch(lchHex({L, C: .4, h})).C;

/* 以主强调色为基准的配色建议。
   不能照搬原色的明度 —— 同一色度在不同色相上未必可达：蓝可以又暗又艳，
   黄在同样的暗度下会被色域夹成脏橄榄色。所以每个目标色相自己挑一个
   能撑住相近色度的明度，只在同分时才偏向贴近原色明度。 */
export function recommend(baseHex) {
  const base = hexToLch(baseHex), {L} = base;
  // Near-neutral hue is numerically unstable and cannot define a meaningful
  // complement. Use a stable set of accent hues instead, and label it honestly.
  const neutral = base.C < .015;
  const h = neutral ? 250 : base.h;
  const C = neutral ? .14 : Math.max(base.C, .03);
  const slots = neutral ? [
    ['蓝色点缀', 0], ['橙色点缀', 165], ['绿色点缀', 255],
    ['紫色点缀', 55], ['红色点缀', 135], ['青色点缀', 305], ['黄色点缀', 195],
  ] : [
    ['互补', 180], ['分裂互补', 150], ['分裂互补', 210],
    ['三分', 120], ['三分', 240], ['邻近', 32], ['邻近', -32],
  ];
  return slots.map(([label, delta], index) => {
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
    if (near && best.C > .085 && base.C > .085 && Math.abs(best.L - L) < .12) {
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
    // Validate the actual rounded/gamut-mapped color. Clamping a lightness
    // adjustment at .88 can otherwise move a pale base closer, not farther.
    if (harmonyIssues([baseHex, hex]).length || deltaE(baseHex, hex) < .07) {
      let replacement = null;
      for (let i = 20; i <= 92; i++) {
        const candidate = lchHex({L: i / 100, C, h: hue});
        if (harmonyIssues([baseHex, candidate]).length || deltaE(baseHex, candidate) < .07) continue;
        const score = Math.abs(i / 100 - best.L) + Math.max(0, C - hexToLch(candidate).C) * .2;
        if (!replacement || score < replacement.score) replacement = {hex: candidate, score};
      }
      if (replacement) hex = replacement.hex;
    }
    return {label, delta, hex, kind: index < 5 ? 'contrast' : 'analogous', neutral};
  });
}

// Same hue, distinct lightness: avoid near-duplicates of the base and fit
// chroma into the gamut at each stop. Neutral bases remain neutral.
export function recommendTonal(baseHex) {
  const base = hexToLch(baseHex);
  const stops = Array.from({length: 21}, (_, i) => .18 + i * .039)
    .filter(L => Math.abs(L - base.L) >= .13);
  return ['浓墨', '深调', '中调', '浅调', '淡雾'].map((label, i) => {
    const L = stops[Math.round(i * (stops.length - 1) / 4)];
    const C = Math.min(base.C, maxChromaAt(L, base.h));
    return {label, delta: 0, hex: lchHex({L, C, h: base.h})};
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
  const issues = themeHarmonyIssues(light, dark);
  const typeAdvice = typographyAdvice(type);
  const backgroundNote = theme => {
    const source = theme === 'dark' && params.linked === false ? params.darkSnapshot : params;
    const setting = cleanBackgrounds(source?.backgrounds)[theme];
    return setting.mode === 'linked'
      ? `随${setting.accentIndex ? '强调色 ' + (setting.accentIndex + 1) : '主色'}推荐生成`
      : setting.mode === 'custom' ? '自定义' : '默认';
  };
  return `# UI 设计规范

由 Luxel Rubric 生成。可放入项目设计文档，作为实现界面的参考。

## 色彩

${params.linked === false ? '浅色原色' : '模式'}：${params.accents.length === 1 ? '单色' : '多色'}（${params.accents.map((c, i) => `${i ? '强调 ' + (i + 1) : '主强调'} \`${c.toUpperCase()}\``).join('，')}）

以上为所选原色；实际使用值以各主题下方的 token 为准。
当前颜色处理：${params.adaptAccents === false ? '保留原色，不自动修改明度。' : '自动适配浅深背景，可能调整强调色明度。'}

主体背景：浅色 ${backgroundNote('light')}，深色 ${backgroundNote('dark')}。背景与文字的对比度纳入下方检查。

### 浅色

${table(light, lc)}

### 深色

${table(dark, dc)}

${params.linked === false ? `浅深色独立编辑，分别保存参数，互不影响。深色原色：${params.darkSnapshot?.accents.map(c => `\`${c.toUpperCase()}\``).join('，')}。深色颜色处理：${params.darkSnapshot?.adaptAccents === false ? '保留原色' : '自动适配'}。` : '深色由同一组参数独立生成，与当前浅色设置联动，并非逐色反相。'}

## 字体

${params.typeLinked ? '推荐联动已开启：正文 / 强调 / 标题 / 等宽的字号比例为 1 / 1 / 1.6 / 0.9333，显示值取整；字重相对正文为 0 / +200 / +250 / 0。这是一组工具预设，不是通用排版标准。' : '字体参数独立设置。'}

| 用途 | 字重 | 字号 | 字族 |
|---|---|---|---|
${type.map(r => `| ${r.label} | ${r.weight} | ${r.size}px | ${r.mono ? '等宽' : '比例'} |`).join('\n')}

机器值（ID、色值、时间、数字读数）一律等宽字体，人读文案一律比例字体。
字重和字号为目标设定；项目字体须提供对应字重。工具中预览字体的可用字重有限，不代表任意字体都能精确呈现这些值。
${typeAdvice.length ? `\n### 排版建议\n\n以下是工具的经验性提醒，不是 WCAG 不合格判定；须结合实际字体与用途确认。\n\n${typeAdvice.map(item => `- ${item.label} · **${item.kind}**：${item.text}`).join('\n')}\n` : ''}

## 实现规则

1. 所有颜色以 CSS 自定义属性定义在 \`:root\`，深色模式用 \`prefers-color-scheme\` 覆盖，并允许 \`[data-theme]\` 手动覆盖。
2. 不要为深色模式单独写一套组件样式，只换 token。
3. 正文类文字对底色至少 4.5:1；大字（至少 24px，或粗体至少 18.67px）及有辨识需求的非文本控件至少 3:1。强调色按非文本填充检查，不代表可直接用于正文链接。
4. 焦点态用 \`--text\` 实色描边，不要只靠改变底色表示焦点。
5. 激活 / 选中状态不能只用颜色区分，同时改变填充或字重，保证色觉障碍下仍可分辨。
检查范围：正文 / 次级 / 元信息文字、控件描边、强调色及其文字；背景包括页面、面板、输入框和悬停。配色关系是设计建议，不是 WCAG 合规判定；此工具不检查键盘操作、语义或完整页面的无障碍要求。
${issues.length ? `\n### 配色关系\n\n${issues.map(i => `- ${i.theme} **${i.kind}**（强调 ${i.pair[0] + 1} 与 强调 ${i.pair[1] + 1}）：${i.text}`).join('\n')}\n` : ''}${failed.length ? `\n> ⚠ 本规范有 ${failed.length} 处对比度未达标：${failed.map(c => `${c.theme} \`--${c.key}\`(${c.ratio})`).join('、')}。落地前请调整。` : '\n已检查的颜色组合对比度达标；不代表整个界面通过 WCAG AA。'}
`;
}
