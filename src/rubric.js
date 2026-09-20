// SPDX-License-Identifier: MIT
// Rubric 的界面层。所有配色数学在 spec.js，这里只负责控件、渲染和复制。
import {buildTheme, audit, adaptAccent, toMarkdown, ROLES, contrast} from './spec.js';

const $ = id => document.getElementById(id);
const STORE = 'luxel-rubric-v1';

const defaults = {
  hue: 250, chroma: 2, contrast: 1, duo: false, linked: true,
  accent: '#3b5bdb', accentDark: '#5275ec',
  accent2: '#e8590c', accent2Dark: '#d65415',
  body: 400, strong: 600, heading: 650, size: 15, scale: 1.6,
};
let state = {...defaults};
try { const saved = localStorage.getItem(STORE); if (saved) state = {...defaults, ...JSON.parse(saved)}; } catch {}

/* ── 主题切换，与其它页共用同一个键 ────────────────────────────────── */
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function paintTheme() {
  const forced = document.documentElement.dataset.theme;
  const dark = forced ? forced === 'dark' : darkQuery.matches;
  $('theme').querySelector('svg').innerHTML = dark
    ? '<circle cx="12" cy="12" r="4.2"/><path d="M12 3.4v2.1M12 18.5v2.1M3.4 12h2.1M18.5 12h2.1M6 6l1.5 1.5M16.5 16.5 18 18M18 6l-1.5 1.5M7.5 16.5 6 18"/>'
    : '<path d="M20 13.6A8.2 8.2 0 0 1 10.4 4a8.6 8.6 0 1 0 9.6 9.6z"/>';
  $('theme').setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色模式');
  document.querySelector('meta[name=theme-color]').content = dark ? '#0f0f0f' : '#ffffff';
}
$('theme').onclick = () => {
  const forced = document.documentElement.dataset.theme;
  const next = (forced ? forced === 'dark' : darkQuery.matches) ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('rheo-theme', next); } catch {}
  paintTheme();
};
darkQuery.addEventListener('change', () => { if (!document.documentElement.dataset.theme) paintTheme(); });
paintTheme();

/* ── 滑块 ───────────────────────────────────────────────────────────── */
const sliders = [
  ['hue', '色相', 0, 360, 1, 'neutral-controls', v => Math.round(v) + '°'],
  ['chroma', '色度', 0, 10, .1, 'neutral-controls', v => v.toFixed(1)],
  ['contrast', '对比强度', .6, 1.3, .01, 'neutral-controls', v => v.toFixed(2) + '×'],
  ['body', '正文字重', 300, 600, 50, 'type-controls', v => String(v)],
  ['strong', '强调字重', 400, 800, 50, 'type-controls', v => String(v)],
  ['heading', '标题字重', 400, 800, 50, 'type-controls', v => String(v)],
  ['size', '基准字号', 13, 18, 1, 'type-controls', v => v + 'px'],
  ['scale', '字阶比例', 1.2, 2, .05, 'type-controls', v => v.toFixed(2) + '×'],
];
for (const [key, label, min, max, step, parent, fmt] of sliders) {
  const field = document.createElement('div');
  field.className = 'range-field';
  field.innerHTML = `<div class="range-head"><label for="${key}">${label}</label><output id="${key}-value" for="${key}"></output></div>`
    + `<input type="range" id="${key}" min="${min}" max="${max}" step="${step}">`;
  $(parent).append(field);
  $(key).addEventListener('input', e => { state[key] = Number(e.target.value); render(); save(); });
}
const format = Object.fromEntries(sliders.map(([key, , , , , , fmt]) => [key, fmt]));

/* ── 模式与联动 ─────────────────────────────────────────────────────── */
for (const button of document.querySelectorAll('.seg'))
  button.onclick = () => { state.duo = button.dataset.mode === 'duo'; render(); save(); };

// 联动即「深色的强调色由浅色推算」。关掉后深色那两个色值变成独立可改的。
$('link').onclick = () => {
  state.linked = !state.linked;
  if (state.linked) syncDark();
  render(); save();
};
function syncDark() {
  const dark = themes().dark;
  state.accentDark = adaptAccent(state.accent, 'dark', dark.bg, 4.5);
  state.accent2Dark = adaptAccent(state.accent2, 'dark', dark.bg, 4.5);
}
for (const [id, key] of [['accent', 'accent'], ['accent2', 'accent2']])
  $(id).addEventListener('input', e => {
    state[key] = e.target.value;
    if (state.linked) syncDark();
    render(); save();
  });

$('reset').onclick = () => { state = {...defaults}; render(); save(); toast('已恢复默认规范'); };

/* ── 生成两套主题 ───────────────────────────────────────────────────── */
function themes() {
  const base = {hue: state.hue, chroma: state.chroma, contrast: state.contrast, duo: state.duo};
  const light = buildTheme({...base, accent: state.accent, accent2: state.accent2}, 'light');
  // 未联动时深色用自己的强调色；adaptAccent 仍会把它拉到够对比度的明度
  const darkAccent = state.linked ? state.accent : state.accentDark;
  const darkAccent2 = state.linked ? state.accent2 : state.accent2Dark;
  const dark = buildTheme({...base, accent: darkAccent, accent2: darkAccent2}, 'dark');
  return {light, dark};
}

/* ── 渲染 ───────────────────────────────────────────────────────────── */
function rowsFor(tokens, checks) {
  const by = Object.fromEntries(checks.map(c => [c.key, c]));
  return Object.entries(tokens).map(([key, hex]) => {
    const c = by[key];
    const warn = c && !c.pass
      ? `<span class="warn" role="img" title="对比度 ${c.ratio}，低于${c.kind}要求的 ${c.need}">!</span>` : '';
    const ratio = c ? `<span class="ratio${c.pass ? '' : ' low'}">${c.ratio}</span>` : '';
    return `<div class="row"><span class="chip" style="background:${hex}"></span>`
      + `<span class="name">--${key}</span><span class="role">${ROLES[key] || ''}</span>`
      + `<span class="value">${ratio}${warn}<span class="hex">${hex}</span></span></div>`;
  }).join('');
}

// 把一套 token 挂成卡片自己的局部变量，卡内取色一律走这些，与站点主题无关
function dress(sheet, t) {
  sheet.style.setProperty('--sheet-bg', t.bg);
  sheet.style.setProperty('--sheet-text', t.text);
  sheet.style.setProperty('--sheet-dim', t['text-2']);
  sheet.style.setProperty('--sheet-border', t.border);
}

function render() {
  for (const [key] of sliders) { $(key).value = state[key]; $(key + '-value').textContent = format[key](state[key]); }
  for (const button of document.querySelectorAll('.seg'))
    button.setAttribute('aria-checked', String((button.dataset.mode === 'duo') === state.duo));
  $('accent2-row').hidden = !state.duo;
  $('accent').value = state.accent; $('accent-hex').textContent = state.accent.toUpperCase();
  $('accent2').value = state.accent2; $('accent2-hex').textContent = state.accent2.toUpperCase();
  $('link').setAttribute('aria-pressed', String(state.linked));
  $('link-label').textContent = state.linked ? '深色随浅色自动规划' : '深色单独设定';

  const {light, dark} = themes();
  const lc = audit(light), dc = audit(dark);
  $('light-rows').innerHTML = rowsFor(light, lc);
  $('dark-rows').innerHTML = rowsFor(dark, dc);
  // 每张卡套上自己那套颜色，于是它本身就是这套主题的预览
  dress($('light-sheet'), light);
  dress($('dark-sheet'), dark);
  $('light-state').textContent = `${Object.keys(light).length} TOKENS`;
  $('dark-state').textContent = state.linked ? '由浅色推算' : '单独设定';

  const sample = '设计规范 Design Spec';
  $('type-state').textContent = `${state.size}PX · ${state.scale.toFixed(2)}×`;
  $('type-rows').innerHTML = [
    ['正文', state.body, state.size, 'var(--sans)'],
    ['强调', state.strong, state.size, 'var(--sans)'],
    ['标题', state.heading, Math.round(state.size * state.scale), 'var(--sans)'],
    ['等宽', state.body, state.size - 1, 'var(--mono)'],
  ].map(([name, weight, size, family]) =>
    `<div class="type-cell"><span class="sample" style="font-weight:${weight};font-size:${size}px;font-family:${family}">${sample}</span>`
    + `<span class="meta">${name} · ${weight} · ${size}px</span></div>`).join('');

  // 两套主题的 token 同名，汇总里必须标出是哪一套，否则只会看到重复的名字
  const failed = [...lc.map(c => ({...c, theme: '浅'})), ...dc.map(c => ({...c, theme: '深'}))]
    .filter(c => !c.pass);
  $('audit-summary').innerHTML = failed.length
    ? `<span class="bad">${failed.length} 处对比度不足：${failed.map(c => `${c.theme} --${c.key}`).join('、')}</span>`
    : '<span class="good">所有组合满足 WCAG AA</span>';
}

/* ── 导出 ───────────────────────────────────────────────────────────── */
let toastTimer;
function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3200);
}
function markdown() {
  const {light, dark} = themes();
  return toMarkdown({
    params: {duo: state.duo, accent: state.accent, accent2: state.accent2},
    light, dark,
    type: {body: state.body, strong: state.strong, heading: state.heading, size: state.size, scale: state.scale},
  });
}
$('copy').onclick = async () => {
  const text = markdown();
  try {
    await navigator.clipboard.writeText(text);
    toast('规范已复制，粘贴到项目的 agent.md 即可');
  } catch {
    // 剪贴板在非安全上下文或被拒时不可用，退回选中让用户自己按复制
    const area = document.createElement('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;top:50%;left:50%;width:1px;height:1px;opacity:0';
    document.body.append(area); area.select();
    const ok = document.execCommand && document.execCommand('copy');
    area.remove();
    toast(ok ? '规范已复制，粘贴到项目的 agent.md 即可' : '浏览器拒绝了剪贴板，请改用导出后手动复制');
  }
};

function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {} }
render();
