// SPDX-License-Identifier: MIT
// Rubric 的界面层。配色数学全在 spec.js，这里只管控件、渲染和复制。
import {buildTheme, audit, adaptAccent, toMarkdown, roleOf,
        harmonyIssues, recommend} from './spec.js';

const $ = id => document.getElementById(id);
const STORE = 'luxel-rubric-v3';
const PALETTE = ['#3b5bdb', '#e8590c', '#2f9e44', '#c2255c', '#7048e8', '#0c8599'];

/* 字体四行，每行自己的字重与字号。
   原先等宽行没有任何滑块、标题字号由「基准 × 字阶」推导，滑块和样本对不上号；
   现在每个样本格里就放着控制它的那两个滑块。 */
const TYPE_ROWS = [
  {key: 'body', label: '正文', mono: false},
  {key: 'strong', label: '强调', mono: false},
  {key: 'heading', label: '标题', mono: false},
  {key: 'mono', label: '等宽', mono: true},
];
const defaults = {
  hue: 250, chroma: 2, contrast: 1, count: 1, linked: true,
  accents: ['#3b5bdb'],
  bodyWeight: 400, bodySize: 15,
  strongWeight: 600, strongSize: 15,
  headingWeight: 650, headingSize: 24,
  monoWeight: 400, monoSize: 14,
};
let state = {...defaults, accents: [...defaults.accents]};
try {
  const saved = localStorage.getItem(STORE);
  if (saved) { const p = JSON.parse(saved); state = {...defaults, ...p, accents: [...(p.accents || defaults.accents)]}; }
} catch {}

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
];
for (const [key, label, min, max, step, parent] of sliders) {
  const field = document.createElement('div');
  field.className = 'range-field';
  field.innerHTML = `<div class="range-head"><label for="${key}">${label}</label><output id="${key}-value" for="${key}"></output></div>`
    + `<input type="range" id="${key}" min="${min}" max="${max}" step="${step}">`;
  $(parent).append(field);
  $(key).addEventListener('input', e => { state[key] = Number(e.target.value); render(); save(); });
}
const format = Object.fromEntries(sliders.map(([key, , , , , , fmt]) => [key, fmt]));

/* ── 模式与数量 ─────────────────────────────────────────────────────
   单色 1 个强调色，双色 2 个，多色由输入框决定 2–6 个。
   增减时保留已选的颜色，只补齐或截断，免得切一下模式配色就全没了。 */
function setCount(n) {
  n = Math.max(1, Math.min(6, Math.round(n) || 1));
  state.count = n;
  while (state.accents.length < n) state.accents.push(PALETTE[state.accents.length % PALETTE.length]);
  state.accents.length = n;
}
const modeOf = () => state.count === 1 ? 'mono' : state.count === 2 ? 'duo' : 'multi';
for (const button of document.querySelectorAll('.seg'))
  button.onclick = () => {
    const mode = button.dataset.mode;
    setCount(mode === 'mono' ? 1 : mode === 'duo' ? 2 : Math.max(3, state.count));
    render(); save();
  };
$('count').addEventListener('input', e => { setCount(Number(e.target.value)); render(); save(); });

$('link').onclick = () => { state.linked = !state.linked; render(); save(); };
$('reset').onclick = () => { state = {...defaults, accents: [...defaults.accents]}; render(); save(); toast('已恢复默认规范'); };

/* ── 生成两套主题 ───────────────────────────────────────────────────
   联动时深色由浅色的强调色推算；断开时深色保留自己那份，各调各的。 */
function themes() {
  const base = {hue: state.hue, chroma: state.chroma, contrast: state.contrast};
  const light = buildTheme({...base, accents: state.accents}, 'light');
  const probe = buildTheme({...base, accents: state.accents}, 'dark');
  const darkAccents = state.linked
    ? state.accents
    : (state.darkAccents || state.accents).slice(0, state.accents.length);
  const dark = buildTheme({...base, accents: darkAccents}, 'dark');
  return {light, dark, probe};
}

/* ── 渲染 ───────────────────────────────────────────────────────────── */
function dress(sheet, t) {
  sheet.style.setProperty('--sheet-bg', t.bg);
  sheet.style.setProperty('--sheet-text', t.text);
  sheet.style.setProperty('--sheet-dim', t['text-2']);
}
const esc = s => s.replace(/[<>&"]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'}[c]));
const warnMark = text =>
  `<span class="warn" tabindex="0" role="button" aria-label="${esc(text)}">!<span class="tip">${esc(text)}</span></span>`;

function rowsFor(tokens, checks) {
  const by = Object.fromEntries(checks.map(c => [c.key, c]));
  return Object.entries(tokens).map(([key, hex]) => {
    const c = by[key];
    const warn = c && !c.pass
      ? warnMark(`对比度 ${c.ratio}，低于${c.kind}要求的 ${c.need}。把这个颜色的明度朝远离底色的方向调。`) : '';
    const ratio = c ? `<span class="ratio${c.pass ? '' : ' low'}">${c.ratio}</span>` : '';
    return `<div class="row"><span class="chip" style="background:${hex}"></span>`
      + `<span class="name">--${key}</span><span class="role">${roleOf(key)}</span>`
      + `<span class="value">${ratio}${warn}<span class="hex">${hex}</span></span></div>`;
  }).join('');
}

const typeSlider = (id, label, min, max, step, value, shown) =>
  `<div class="range-field"><div class="range-head"><label for="${id}">${label}</label>`
  + `<output for="${id}">${shown}</output></div>`
  + `<input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;

function render() {
  for (const [key] of sliders) { $(key).value = state[key]; $(key + '-value').textContent = format[key](state[key]); }
  const mode = modeOf();
  for (const button of document.querySelectorAll('.seg'))
    button.setAttribute('aria-checked', String(button.dataset.mode === mode));
  $('count-row').hidden = mode !== 'multi';
  $('count').value = state.count;

  // 强调色：每个一枚胶囊，第一个是主色
  $('accents').innerHTML = state.accents.map((hex, i) =>
    `<label class="accent-chip"><input type="color" data-i="${i}" value="${hex}" aria-label="${i ? '强调色 ' + (i + 1) : '主强调色'}">`
    + `<span class="tag">${i ? String(i + 1).padStart(2, '0') : '主'}</span><code>${hex.toUpperCase()}</code></label>`).join('');
  for (const input of $('accents').querySelectorAll('input[type=color]'))
    input.addEventListener('input', e => { state.accents[Number(e.target.dataset.i)] = e.target.value; render(); save(); });

  // 推荐色只在多于一色时有意义 —— 它给的是「和主色搭什么」
  $('recommend').hidden = state.accents.length < 2;
  if (state.accents.length >= 2) {
    $('rec-list').innerHTML = recommend(state.accents[0]).map(r =>
      `<button class="rec" style="background:${r.hex}" data-hex="${r.hex}" title="${r.label} · ${r.hex.toUpperCase()}" aria-label="套用${r.label}配色 ${r.hex}"></button>`).join('');
    for (const b of $('rec-list').querySelectorAll('.rec'))
      b.onclick = () => { state.accents[state.accents.length - 1] = b.dataset.hex; render(); save(); };
  }

  // 配色冲突：挂在「强调色」这一组的标题上，鼠标移上去说明原因和改法
  const issues = harmonyIssues(state.accents);
  $('harmony-slot').innerHTML = issues.length
    ? warnMark(issues.map(i => `${i.kind}（强调 ${i.pair[0] + 1} 与 ${i.pair[1] + 1}）：${i.text}`).join('\n\n'))
    : '';

  $('link').setAttribute('aria-pressed', String(state.linked));
  $('link').setAttribute('aria-label', state.linked ? '已联动，点击断开' : '未联动，点击关联');
  document.querySelector('.linkbar').dataset.linked = String(state.linked);
  $('link-label').textContent = state.linked ? '已关联' : '已断开';

  const {light, dark} = themes();
  const lc = audit(light), dc = audit(dark);
  $('light-rows').innerHTML = rowsFor(light, lc);
  $('dark-rows').innerHTML = rowsFor(dark, dc);
  dress($('light-sheet'), light);
  dress($('dark-sheet'), dark);
  $('light-state').textContent = `${Object.keys(light).length} TOKENS`;
  $('dark-state').textContent = state.linked ? '由浅色推算' : '单独设定';

  const sample = '设计规范 Design Spec';
  $('type-rows').innerHTML = TYPE_ROWS.map(({key, label, mono}) => {
    const weight = state[key + 'Weight'], size = state[key + 'Size'];
    const family = mono ? 'var(--mono)' : 'var(--sans)';
    return `<div class="type-cell">`
      + `<span class="sample" style="font-weight:${weight};font-size:${size}px;font-family:${family}">${sample}</span>`
      + `<span class="meta">${label}</span>`
      + typeSlider(key + 'Weight', '字重', 300, 800, 50, weight, String(weight))
      + typeSlider(key + 'Size', '字号', 11, 40, 1, size, size + 'px')
      + `</div>`;
  }).join('');
  for (const input of $('type-rows').querySelectorAll('input[type=range]'))
    input.addEventListener('input', e => { state[e.target.id] = Number(e.target.value); render(); save(); });

  const failed = [...lc.map(c => ({...c, theme: '浅'})), ...dc.map(c => ({...c, theme: '深'}))].filter(c => !c.pass);
  const parts = [];
  if (failed.length) parts.push(`<span class="bad">${failed.length} 处对比度不足</span>`);
  if (issues.length) parts.push(`<span class="bad">${issues.length} 处配色冲突</span>`);
  $('audit-summary').innerHTML = parts.length ? parts.join(' · ') : '满足 WCAG AA';
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
    params: {accents: state.accents},
    light, dark,
    type: TYPE_ROWS.map(r => ({label: r.label, mono: r.mono,
      weight: state[r.key + 'Weight'], size: state[r.key + 'Size']})),
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
    toast(ok ? '规范已复制，粘贴到项目的 agent.md 即可' : '浏览器拒绝了剪贴板，请手动选中复制');
  }
};

function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {} }
render();
