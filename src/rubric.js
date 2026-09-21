// SPDX-License-Identifier: MIT
// Rubric 的界面层。配色数学全在 spec.js，这里只管控件、渲染和复制。
import {audit, toMarkdown, roleOf, themeHarmonyIssues, recommend, recommendTonal, deltaE,
        normalizeRubricState, resizeRubricPalette, toggleRubricLink, buildRubricThemes, rubricThemeParams, updateTypography, toggleTypographyLink, typographyBounds, typographyAdvice, rubricEditorState, updateRubricColors, recommendBackgrounds, backgroundTextWarnings} from './spec.js';

const $ = id => document.getElementById(id);
const STORE = 'luxel-rubric-v3';

/* 字体四行，每行自己的字重与字号。
   原先等宽行没有任何滑块、标题字号由「基准 × 字阶」推导，滑块和样本对不上号；
   现在每个样本格里就放着控制它的那两个滑块。 */
const TYPE_ROWS = [
  {key: 'body', label: '正文', mono: false},
  {key: 'strong', label: '强调', mono: false},
  {key: 'heading', label: '标题', mono: false},
  {key: 'mono', label: '等宽', mono: true},
];
let state = normalizeRubricState();
try {
  const saved = localStorage.getItem(STORE);
  if (saved) state = normalizeRubricState(JSON.parse(saved));
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
  ['contrast', '文字对比', .6, 1.3, .01, 'neutral-controls', v => v.toFixed(2) + '×'],
];
for (const [key, label, min, max, step, parent] of sliders) {
  const field = document.createElement('div');
  field.className = 'range-field';
  field.innerHTML = `<div class="range-head"><label for="${key}">${label}</label><output id="${key}-value" for="${key}"></output></div>`
    + `<input type="range" id="${key}" min="${min}" max="${max}" step="${step}">`;
  $(parent).append(field);
  $(key).addEventListener('input', e => { editColors(editor => ({...editor, [key]: Number(e.target.value)})); });
}
const format = Object.fromEntries(sliders.map(([key, , , , , , fmt]) => [key, fmt]));

/* ── 模式与数量 ─────────────────────────────────────────────────────
   单色 1 个强调色，多色由输入框决定 2–6 个。
   增减时保留已选的颜色，只补齐或截断，切换单色时保留多色的数量与已选色值。 */
function editColors(update) { state = updateRubricColors(state, update); render(); save(); }
function setCount(n) { state = updateRubricColors(state, editor => resizeRubricPalette(editor, n)); }
const modeOf = () => rubricEditorState(state).count === 1 ? 'mono' : 'multi';
for (const button of document.querySelectorAll('.seg'))
  button.onclick = () => {
    const mode = button.dataset.mode;
    setCount(mode === 'mono' ? 1 : rubricEditorState(state).multiCount);
    render(); save();
  };
document.querySelector('.segment').addEventListener('keydown', e => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const buttons = [...document.querySelectorAll('.seg')];
  const index = buttons.indexOf(document.activeElement);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
    : (index + (['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1) + buttons.length) % buttons.length;
  buttons[next].focus({preventScroll: true}); buttons[next].click();
});
$('count').addEventListener('input', e => {
  if (e.target.value === '' || !e.target.validity.valid) return;
  setCount(Number(e.target.value)); render(); save();
});
$('count').addEventListener('change', e => { setCount(Math.max(2, Number(e.target.value) || 2)); e.target.value = rubricEditorState(state).count; render(); save(); });
$('accent-policy').addEventListener('change', e => { editColors(editor => ({...editor, adaptAccents: e.target.value === 'auto'})); });

function editBackground(patch) {
  editColors(editor => {
    const theme = state.editingTheme;
    const previous = rubricThemeParams(editor).backgrounds;
    return {...editor, backgrounds: {...previous, [theme]: {...previous[theme], ...patch}}};
  });
  const warnings = backgroundTextWarnings(themes()[state.editingTheme]);
  if (warnings.length) toast(`背景与${warnings.map(w => roleOf(w.key)).join('、')}对比度不足，请调整背景或文字对比。`);
  else if ($('toast').textContent.startsWith('背景与')) { clearTimeout(toastTimer); $('toast').classList.remove('show'); }
}
$('background-color').addEventListener('input', e => editBackground({mode: 'custom', color: e.target.value}));
$('background-hex').addEventListener('change', e => {
  const value = e.target.value.trim();
  if (/^#?[\da-f]{6}$/i.test(value)) {
    e.target.setCustomValidity(''); editBackground({mode: 'custom', color: (value.startsWith('#') ? value : '#' + value).toLowerCase()});
  } else { e.target.setCustomValidity('请输入六位 HEX 色值，例如 #F3F6FA'); e.target.reportValidity(); }
});
$('background-hex').addEventListener('input', e => e.target.setCustomValidity(''));
$('background-reset').onclick = () => editBackground({mode: 'default'});
$('background-link').onclick = () => {
  const editor = rubricEditorState(state), background = rubricThemeParams(editor).backgrounds[state.editingTheme];
  editBackground(background.mode === 'linked' && background.accentIndex === editor.selectedAccent
    ? {mode: 'custom', color: themes()[state.editingTheme].bg}
    : {mode: 'linked', accentIndex: editor.selectedAccent});
};

$('type-link').onclick = () => { state = toggleTypographyLink(state); render(); save(); };
function selectEditingTheme(theme) { state.editingTheme = theme; render(); save(); }
$('edit-theme').addEventListener('input', e => selectEditingTheme(Number(e.target.value) ? 'dark' : 'light'));
for (const button of document.querySelectorAll('[data-edit-theme]')) button.onclick = () => selectEditingTheme(button.dataset.editTheme);
$('link').onclick = () => { state = toggleRubricLink(state); render(); save(); };
$('reset').onclick = () => { state = normalizeRubricState(); render(); save(); toast('已恢复默认规范'); };

/* ── 生成两套主题：断开时锁定完整深色方案，联动后恢复同步。 ── */
let themeCache, themeCacheKey;
function themes() {
  const key = JSON.stringify([rubricThemeParams(state), state.linked, state.darkSnapshot]);
  if (key !== themeCacheKey) { themeCache = buildRubricThemes(state); themeCacheKey = key; }
  return themeCache;
}
let recCache, recCacheBase;
function recommendations() {
  const base = rubricEditorState(state).accents[0];
  if (base !== recCacheBase) {
    recCacheBase = base;
    recCache = [
      ['rec-list', '对比色', recommend(base).filter(r => r.kind === 'contrast')],
      ['tonal-list', '同色阶', recommendTonal(base)],
    ];
  }
  return recCache;
}

/* ── 渲染 ───────────────────────────────────────────────────────────── */
function dress(sheet, t) {
  sheet.style.setProperty('--sheet-bg', t.bg);
  sheet.style.setProperty('--sheet-text', t.text);
  sheet.style.setProperty('--sheet-dim', t['text-2']);
}
const esc = s => s.replace(/[<>&"]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'}[c]));
const warnMark = (text, advice = false) =>
  `<span class="warn${advice ? ' advice' : ''}" tabindex="0" role="button" aria-label="${esc(text)}">${advice ? 'i' : '!'}<span class="tip">${esc(text)}</span></span>`;

// Keep keyed DOM nodes alive: color changes must not replace the focused
// button, native color picker or a range input being dragged.
function reconcile(container, items, keyOf, create, update) {
  const existing = new Map([...container.children].map(node => [node.dataset.key, node]));
  const retained = new Set();
  items.forEach((item, index) => {
    const key = String(keyOf(item, index));
    let node = existing.get(key);
    if (!node) { node = create(item, index); node.dataset.key = key; }
    existing.delete(key);
    retained.add(node);
    if (container.children[index] !== node) container.insertBefore(node, container.children[index] || null);
    update(node, item, index);
  });
  // Inspect the actual children: a Map hides duplicate keys, so cleaning only
  // its remaining values leaves duplicate DOM nodes behind on every render.
  for (const node of [...container.children]) if (!retained.has(node)) node.remove();
}
function renderRows(container, tokens, checks) {
  const by = Object.fromEntries(checks.map(c => [c.key, c]));
  reconcile(container, Object.entries(tokens), ([key]) => key, () => {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = '<span class="chip"></span><span class="name"></span><span class="role"></span>'
      + '<span class="value"><span class="ratio"></span>'
      + warnMark('') + '<span class="hex"></span></span>';
    return row;
  }, (row, [key, hex]) => {
    const c = by[key], ratio = row.querySelector('.ratio'), warning = row.querySelector('.warn');
    row.querySelector('.chip').style.background = hex;
    row.querySelector('.name').textContent = '--' + key;
    row.querySelector('.role').textContent = roleOf(key);
    row.querySelector('.hex').textContent = hex;
    ratio.hidden = !c; ratio.textContent = c ? c.ratio : ''; ratio.classList.toggle('low', Boolean(c && !c.pass));
    warning.hidden = !c || c.pass;
    const message = c && !c.pass ? `对比度 ${c.ratio}，低于${c.kind}要求的 ${c.need}。把这个颜色的明度朝远离底色的方向调。` : '';
    warning.setAttribute('aria-label', message); warning.querySelector('.tip').textContent = message;
  });
}

const typeSlider = (id, label, min, max, step, value, shown) =>
  `<div class="range-field"><div class="range-head"><label for="${id}">${label}</label>`
  + `<output for="${id}">${shown}</output></div>`
  + `<input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;

function render() {
  const editor = rubricEditorState(state);
  document.querySelector('.console').dataset.editingTheme = state.editingTheme;
  $('edit-theme').value = state.editingTheme === 'dark' ? 1 : 0;
  $('edit-theme').setAttribute('aria-valuetext', state.editingTheme === 'dark' ? '深色' : '浅色');
  $('edit-status').textContent = state.linked ? '浅深联动' : '独立编辑';
  for (const button of document.querySelectorAll('[data-edit-theme]')) button.setAttribute('aria-pressed', String(button.dataset.editTheme === state.editingTheme));
  for (const [key] of sliders) { $(key).value = editor[key]; $(key + '-value').textContent = format[key](editor[key]); }
  const mode = modeOf();
  for (const button of document.querySelectorAll('.seg'))
    { button.setAttribute('aria-checked', String(button.dataset.mode === mode)); button.tabIndex = button.dataset.mode === mode ? 0 : -1; }
  $('count-row').hidden = mode !== 'multi';
  if (document.activeElement !== $('count')) $('count').value = editor.count;
  $('accent-policy').value = editor.adaptAccents ? 'auto' : 'original';
  $('policy-note').textContent = editor.adaptAccents
    ? '自动调整明度以适配浅深背景；想保留同色的深浅层次，可选保留原色。'
    : '保留所选色值；对比度不足时会提示，不会替你改色。';
  $('accent-policy').title = $('policy-note').textContent;
  // One hit target: select on the first activation, edit on the next.
  reconcile($('accents'), editor.accents, (_, i) => i, (_, i) => {
    const chip = document.createElement('div'); chip.className = 'accent-chip';
    const name = i ? '强调色 ' + (i + 1) : '主色';
    chip.innerHTML = `<button type="button" class="accent-select" aria-label="选中${name}" aria-pressed="false"><span class="accent-swatch" aria-hidden="true"></span><span class="tag">${i ? String(i + 1).padStart(2, '0') : '主'}</span><code></code><span class="accent-edit" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m4 13 9-9 3 3-9 9-4 1zM11 6l3 3"/></svg></span></button>`
      + `<input class="accent-picker" type="color" data-i="${i}" tabindex="-1" aria-hidden="true">`;
    chip.querySelector('.accent-select').onclick = () => {
      if (rubricEditorState(state).selectedAccent !== i) {
        editColors(current => ({...current, selectedAccent: i}));
        return;
      }
      const input = chip.querySelector('input');
      if (typeof input.showPicker === 'function') input.showPicker();
      else input.click();
    };
    chip.querySelector('input').addEventListener('input', e => { editColors(current => { current.accents[i] = e.target.value; current.selectedAccent = i; return current; }); });
    return chip;
  }, (chip, hex, i) => {
    const input = chip.querySelector('input');
    if (input.value !== hex) input.value = hex;
    const selected = i === editor.selectedAccent;
    chip.classList.toggle('is-selected', selected);
    const button = chip.querySelector('.accent-select');
    const action = `${selected ? '修改' : '选中'}${i ? '强调色 ' + (i + 1) : '主色'}`;
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-label', action);
    button.title = selected ? '再次点击打开调色板' : '点击选中，再次点击修改颜色';
    chip.querySelector('.accent-swatch').style.background = hex;
    chip.querySelector('code').textContent = hex.toUpperCase();
  });

  // Each recommendation has a stable slot, even when the base color changes.
  // Labels repeat (two split complements, triads and neighbors), so use the
  // slot as identity to keep focus without duplicating or moving buttons.
  $('recommend').hidden = editor.accents.length < 2;
  $('rec-note').textContent = recommendations()[0][2][0].neutral
    ? '主色接近黑白灰：对比色提供彩色点缀，同色阶提供深浅灰。相近颜色仍可选用。'
    : '对比色是跨色相搭配，同色阶是同一色系的深浅变化。相近颜色仍可选用。';
  $('recommend').title = $('rec-note').textContent;
  for (const [id, scheme, colors] of recommendations()) reconcile($(id), colors, (_, i) => i, () => {
    const button = document.createElement('button'); button.className = 'rec';
    button.onclick = () => { editColors(current => { current.accents[current.selectedAccent] = button.dataset.hex; return current; }); };
    return button;
  }, (button, r) => {
    button.style.background = r.hex; button.dataset.hex = r.hex;
    const duplicate = editor.accents.findIndex((hex, index) => index !== editor.selectedAccent && deltaE(hex, r.hex) < .055);
    // Similarity is advice, not a constraint: pastel palettes intentionally
    // share lightness and chroma, and manual color editing already allows it.
    const same = duplicate >= 0 && editor.accents[duplicate].toLowerCase() === r.hex.toLowerCase();
    const advice = duplicate >= 0 ? `；与${duplicate ? '强调色 ' + (duplicate + 1) : '主色'}${same ? '相同' : '相近'}，仍可选用` : '';
    button.disabled = false;
    button.setAttribute('aria-pressed', String(editor.accents[editor.selectedAccent].toLowerCase() === r.hex.toLowerCase()));
    button.title = `${scheme} · ${r.label} · ${r.hex.toUpperCase()}${advice}`;
    button.setAttribute('aria-label', `套用${scheme} · ${r.label} ${r.hex} 到${editor.selectedAccent ? '强调色 ' + (editor.selectedAccent + 1) : '主色'}${advice}`);
  });

  // 配色冲突：挂在「强调色」这一组的标题上，鼠标移上去说明原因和改法
  const {light, dark} = themes();
  const activeTokens = state.editingTheme === 'dark' ? dark : light;
  const background = rubricThemeParams(editor).backgrounds[state.editingTheme];
  const sourceIndex = editor.selectedAccent;
  $('background-color').value = activeTokens.bg;
  if (document.activeElement !== $('background-hex')) { $('background-hex').value = activeTokens.bg.toUpperCase(); $('background-hex').setCustomValidity(''); }
  $('background-link').setAttribute('aria-pressed', String(background.mode === 'linked' && Math.min(background.accentIndex, editor.accents.length - 1) === sourceIndex));
  $('background-link').title = background.mode === 'linked' ? `当前背景随${background.accentIndex ? '强调色 ' + (background.accentIndex + 1) : '主色'}联动；可关闭或改为当前选中的颜色` : '背景随当前选中的强调色变化';
  $('background-source').textContent = `随${sourceIndex ? '强调色 ' + (sourceIndex + 1) : '主色'}推荐`;
  reconcile($('background-recommend'), recommendBackgrounds(editor.accents[sourceIndex], state.editingTheme), (_, i) => i, (_, i) => {
    const button = document.createElement('button'); button.className = 'rec'; button.type = 'button';
    button.onclick = () => {
      const current = rubricEditorState(state);
      editBackground({mode: 'linked', variant: i, accentIndex: current.selectedAccent});
    };
    return button;
  }, (button, rec, i) => {
    button.style.background = rec.hex;
    button.setAttribute('aria-label', `套用背景 · ${rec.label} ${rec.hex}`);
    button.title = `${rec.label} · ${rec.hex.toUpperCase()} · 随强调色联动`;
    button.setAttribute('aria-pressed', String(background.mode === 'linked' && Math.min(background.accentIndex, editor.accents.length - 1) === sourceIndex && background.variant === i));
  });
  const backgroundWarnings = backgroundTextWarnings(activeTokens);
  const backgroundMessage = backgroundWarnings.map(w => `${roleOf(w.key)}与主体背景对比度 ${w.ratio}:1，低于 4.5:1。`).join('\n');
  $('background-warning').innerHTML = backgroundWarnings.length ? warnMark(backgroundMessage) : '';
  $('background-alert').hidden = !backgroundWarnings.length;
  $('background-alert').textContent = backgroundWarnings.length ? backgroundMessage : '';
  const issues = themeHarmonyIssues(light, dark);
  $('harmony-slot').innerHTML = issues.length
    ? warnMark(issues.map(i => `${i.theme} · ${i.kind}（强调 ${i.pair[0] + 1} 与 ${i.pair[1] + 1}）：${i.text}`).join('\n\n'), true)
    : '';

  $('link').setAttribute('aria-pressed', String(state.linked));
  $('link').setAttribute('aria-label', state.linked ? '解除浅深联动，分别编辑' : '以当前编辑方案恢复浅深联动');
  document.querySelector('.linkbar').dataset.linked = String(state.linked);
  $('link-label').textContent = state.linked ? '浅深联动' : '独立编辑';

  const lc = audit(light), dc = audit(dark);
  renderRows($('light-rows'), light, lc);
  renderRows($('dark-rows'), dark, dc);
  dress($('light-sheet'), light);
  dress($('dark-sheet'), dark);
  $('light-state').textContent = `${Object.keys(light).length} TOKENS`;
  $('dark-state').textContent = state.linked ? '随当前配色生成' : '独立配色';

  $('type-link').setAttribute('aria-pressed', String(state.typeLinked));
  $('type-link').textContent = state.typeLinked ? '推荐联动 · 开' : '推荐联动 · 关';
  $('type-link').title = state.typeLinked
    ? '任意项均可带动同类参数：字号按比例、字重按差值联动；到达边界时整组停止。'
    : '开启后以当前正文为基准，按下方推荐关系对齐；关闭后可逐项调整。';
  const typeHints = typographyAdvice(TYPE_ROWS.map(row => ({...row, size: state[row.key + 'Size'], weight: state[row.key + 'Weight']})));
  reconcile($('type-rows'), TYPE_ROWS, row => row.key, ({key, label, mono}) => {
    const cell = document.createElement('div'); cell.className = 'type-cell';
    cell.innerHTML = `<span class="sample" style="font-family:${mono ? 'var(--mono)' : 'var(--sans)'}">设计规范 Design Spec</span><span class="meta">${label}<span class="type-warning" hidden>${warnMark('', true)}</span></span>`
      + typeSlider(key + 'Weight', '字重', 300, 800, 50, state[key + 'Weight'], '')
      + typeSlider(key + 'Size', '字号', 11, 40, 1, state[key + 'Size'], '');
    for (const input of cell.querySelectorAll('input'))
      input.addEventListener('input', e => { state = updateTypography(state, e.target.id, Number(e.target.value)); render(); save(); });
    return cell;
  }, (cell, {key}) => {
    const weight = state[key + 'Weight'], size = state[key + 'Size'];
    const hint = typeHints.find(item => item.key === key), warning = cell.querySelector('.type-warning');
    warning.hidden = !hint;
    const message = hint ? `${hint.kind}：${hint.text}\n\n这是工具的经验性建议，不是无障碍不合格判定。` : '';
    warning.querySelector('.warn').setAttribute('aria-label', message);
    warning.querySelector('.tip').textContent = message;
    cell.querySelector('.sample').style.fontWeight = weight;
    cell.querySelector('.sample').style.fontSize = size + 'px';
    for (const [suffix, value, shown] of [['Weight', weight, String(weight)], ['Size', size, size + 'px']]) {
      const input = $(key + suffix), bounds = typographyBounds(key + suffix, state.typeLinked);
      input.min = bounds.min; input.max = bounds.max; input.step = bounds.step;
      if (Number(input.value) !== value) input.value = value;
      cell.querySelector(`output[for="${key + suffix}"]`).textContent = shown;
    }
  });

  const failed = [...lc.map(c => ({...c, theme: '浅'})), ...dc.map(c => ({...c, theme: '深'}))].filter(c => !c.pass);
  const parts = [];
  if (failed.length) parts.push(`<span class="bad">${failed.length} 处对比度不足</span>`);
  if (typeHints.length) parts.push(`<span>${typeHints.length} 条排版建议</span>`);
  if (issues.length) parts.push(`<span>${issues.length} 条配色建议</span>`);
  $('audit-summary').innerHTML = parts.length ? parts.join(' · ') : '已检查的对比度达标';
  const section = (title, items) => items.length
    ? `<section><h3>${title}</h3><ul>${items.map(([label, text]) => `<li><strong>${esc(label)}</strong><p>${esc(text)}</p></li>`).join('')}</ul></section>` : '';
  const colorName = index => index ? `强调色 ${index + 1}` : '主色';
  $('audit-panel').innerHTML = section('对比度不足', failed.map(c => [
    `${c.theme}色 · ${roleOf(c.key)}`,
    `对比度 ${c.ratio}，低于${c.kind}要求的 ${c.need}。可拉开与背景的明度差，或启用颜色自动适配。`,
  ])) + section('排版建议', typeHints.map(hint => [`${hint.label} · ${hint.kind}`, hint.text]))
    + section('配色建议', issues.map(issue => [
      `${issue.theme} · ${colorName(issue.pair[0])}与${colorName(issue.pair[1])} · ${issue.kind}`, issue.text,
    ]))
    + (parts.length ? '<p class="audit-footnote">配色与排版建议仅供参考，可按实际用途保留。</p>'
      : '<p class="audit-empty">已检查的文字与控件对比度达标，当前没有配色或排版建议。</p>');
}

// The panel floats below the header; hovering into it keeps it readable and
// scrollable. Clicking pins it for touch users; Escape/outside click dismisses.
let auditPinned = false;
function showAudit(open) {
  $('audit-panel').hidden = !open;
  $('audit-summary').setAttribute('aria-expanded', String(open));
}
$('audit-wrap').addEventListener('mouseenter', () => showAudit(true));
$('audit-wrap').addEventListener('mouseleave', () => {
  if (!auditPinned && !$('audit-wrap').contains(document.activeElement)) showAudit(false);
});
$('audit-wrap').addEventListener('focusin', () => showAudit(true));
$('audit-wrap').addEventListener('focusout', e => {
  if (!$('audit-wrap').contains(e.relatedTarget)) { auditPinned = false; showAudit(false); }
});
$('audit-summary').addEventListener('click', () => { auditPinned = !auditPinned; showAudit(auditPinned); });
document.addEventListener('click', e => {
  if (!$('audit-wrap').contains(e.target)) { auditPinned = false; showAudit(false); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('audit-panel').hidden) {
    if ($('audit-panel').contains(document.activeElement)) $('audit-summary').focus({preventScroll: true});
    auditPinned = false; showAudit(false);
  }
});

// Scrollable cards can clip hover tips. A click or keyboard activation opens
// the same explanation in a dialog outside the clipped preview region.
let warningTrigger;
document.addEventListener('click', e => {
  const warning = e.target.closest('.warn');
  if (!warning) return;
  warningTrigger = warning;
  $('audit-message').textContent = warning.getAttribute('aria-label');
  $('audit-detail').showModal();
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.warn')) {
    e.preventDefault(); e.target.click();
  }
});
$('close-audit').onclick = () => $('audit-detail').close();
$('audit-detail').addEventListener('close', () => {
  if (warningTrigger?.isConnected) warningTrigger.focus({preventScroll: true});
});

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
    params: {...rubricThemeParams(state), typeLinked: state.typeLinked, linked: state.linked, darkSnapshot: state.darkSnapshot},
    light, dark,
    type: TYPE_ROWS.map(r => ({key: r.key, label: r.label, mono: r.mono,
      weight: state[r.key + 'Weight'], size: state[r.key + 'Size']})),
  });
}
$('close-copy').onclick = () => $('copy-fallback').close();
$('copy-fallback').addEventListener('close', () => $('copy').focus({preventScroll: true}));
$('copy').onclick = async () => {
  const text = markdown();
  try {
    await navigator.clipboard.writeText(text);
    toast('规范已复制，可粘贴到项目设计文档');
  } catch {
    $('copy-text').value = text;
    $('copy-fallback').showModal();
    $('copy-text').focus(); $('copy-text').select();
  }
};

function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { toast('浏览器未能保存设置；可复制规范保留当前结果'); } }
render();
