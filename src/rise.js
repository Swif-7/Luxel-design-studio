// Rise 页面：① 数据 → ② 图表 → ③ 风格 → ④ 动效 → ⑤ 背景 → ⑥ 排版 → ⑦ 导出。
// 一次只显示一步的控件（底部面板）；中间的预览一直在播。预览和所有导出共用 rise-render.js 的 drawFrame。
import { parseData, SAMPLE, MAX_GROUPS } from './rise-data.js';
import { CHARTS, STYLES, LAYOUTS, RATIOS, recommend, styleById, chartById, exportSize, cycle, clamp, chartsToDraw, PER_ITEM } from './rise-core.js';
import { drawFrame, prepare, clearStatic } from './rise-render.js';
import { makeCanvas, clearCache } from './relief-render.js';
import { parseRheoStyle } from './relief-core.js';
import { makeZip } from './recast-core.js';
import { defaults, generate, randomizePalette } from './model.js';

const $ = (id) => document.getElementById(id);

/* ── 主题：与其他页面共用 rheo-theme ─────────────────────────────── */
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

/* ── 状态 ─────────────────────────────────────────────────────────
   数据和全部设置记在 localStorage，下次打开沿用；导入的背景图 / Rheo 画面只在内存里。 */
const STEPS = ['数据', '图表', '风格', '动效', '背景', '排版', '导出'];
const SOLIDS = ['#f1f3f5', '#ffffff', '#16202e', '#eef1ff', '#fff4e6', '#e6fcf5', '#f8f0fc'];
const SETTINGS_KEY = 'rise-settings';
const DEFAULTS = {
  text: SAMPLE, overrides: {},
  mode: 'merge', splitView: 'each', current: 0,
  chart: 'bar', style: 'glass', panel: false, grid: true, values: true, decimals: 'auto', abbr: 'auto',
  anim: { effect: 'grow', dur: 1.6, stagger: 45, ease: 'out', hold: 1.6, loop: true },
  src: 'rheo', rheo: { ...defaults, particles: false }, solid: '#f1f3f5', blur: 30, rheoSize: 100, imageSize: 100, frameSize: 100,
  ratio: '4:3', layout: 'top', scale: 90, title: '点击修改标题', sub: '点击修改副标题', note: '数据来源：点击修改',
  fmt: 'png', size: 1920, fps: 30,
};
let s = structuredClone(DEFAULTS);
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  s = { ...s, ...saved, anim: { ...s.anim, ...(saved.anim || {}) }, rheo: { ...s.rheo, ...(saved.rheo || {}) } };
  if (s.src === 'image') s.src = 'rheo';               // 导入的背景图不会保存
} catch {}
let saveTimer;
const flushSettings = () => { clearTimeout(saveTimer); try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} };
const saveSettings = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flushSettings, 250); };   // 拖滑块时别每一下都写
addEventListener('pagehide', flushSettings);

let data = parseData(s.text, s.overrides);
let step = 0;
let bgImage = null, bgImageId = 0, rheoFrame = null;
let editing = null;

/* ── 场景：交给 rise-render 的完整描述 ─────────────────────────────── */
function bgScene() {
  const rheo = { ...s.rheo, scale: clamp(s.rheo.scale * s.rheoSize / 100, 0.25, 3) };
  let bg;
  if (s.src === 'none') bg = { key: 'none', src: 'none' };
  else if (s.src === 'solid') bg = { key: 'solid:' + s.solid, src: 'solid', solid: s.solid };
  else if (s.src === 'image' && bgImage) bg = { key: `image:${bgImageId}:${s.imageSize}`, src: 'image', image: bgImage, zoom: s.imageSize / 100 };
  else if (s.src === 'rheo' && rheoFrame) bg = { key: `frame:${bgImageId}:${s.frameSize}`, src: 'image', image: rheoFrame, zoom: s.frameSize / 100 };
  else bg = { key: 'rheo:' + JSON.stringify(rheo), src: 'rheo', rheo };
  return { ...bg, blur: s.blur };
}
/* 渲染需要的那部分设置（数据原文、导出选项这些不影响画面，不进缓存键） */
const viewSettings = (over = {}) => {
  const { text, overrides, fmt, size, fps, ...rest } = s;
  return { ...rest, ...over };
};
const sceneOf = (over = {}) => {
  const bg = bgScene();
  return { data, s: viewSettings(over), bg, bgKey: bg.key + '|' + bg.blur, dataKey: s.text + JSON.stringify(s.overrides) };
};
const aspect = () => RATIOS[s.ratio] || 4 / 3;
const transparentBg = () => s.src === 'none';

/* ── 视图 ───────────────────────────────────────────────────────── */
function render() {
  $('editor').hidden = step !== 0;
  paintSteps();
  paintDock();
  paintTabs();
  if (step === 0) paintParsed();
  schedulePreview();
}
function paintSteps() {
  $('steps').innerHTML = STEPS.map((name, i) =>
    `<button type="button" data-step="${i}" class="${i < step ? 'done' : ''}" ${i === step ? 'aria-current="step"' : ''}><i>${i < step ? '✓' : i + 1}</i>${name}</button>`).join('');
}
$('steps').onclick = (e) => { const b = e.target.closest('[data-step]'); if (b) go(+b.dataset.step); };
function go(n) { if (editing) endEdit(true); step = clamp(n, 0, STEPS.length - 1); render(); }

/* ── 数据栏 ─────────────────────────────────────────────────────── */
const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function setText(text) {
  s.text = text;
  // 行号变了，旧的千分位选择对不上了：只保留仍然有歧义的那几行
  data = parseData(s.text, s.overrides);
  const live = new Set(data.ambiguousLines.map(a => String(a.line)));
  for (const k of Object.keys(s.overrides)) if (!live.has(k)) delete s.overrides[k];
  data = parseData(s.text, s.overrides);
  if (s.current >= data.groups.length) s.current = 0;
  saveSettings();
}
function paintParsed() {
  const pal = styleById(s.style).palette;
  const n = data.groups.length;
  $('ed-count').textContent = n ? `${n} / ${MAX_GROUPS} 组${data.labels ? ` · ${data.labels.length} 列` : ''}` : '';
  const fmtN = (v) => (Number.isInteger(v) ? v : +v.toFixed(6)).toLocaleString('en-US', { maximumFractionDigits: 6 });
  let html = data.groups.map((g, i) => {
    const amb = g.ambiguous ? `<div class="amb">${g.mode === 'list' ? '逗号按分隔符拆开了' : '逗号当成了千分位'}<button type="button" class="pill" data-line="${g.line}" data-mode="${g.mode === 'list' ? 'thousands' : 'list'}">${g.mode === 'list' ? '改为千分位' : '改为分隔符'}</button></div>` : '';
    return `<div class="grp"><div class="grp-head"><i style="background:${pal[i % 7]}"></i><span>${esc(g.name)}</span><small>${g.values.length} 个数${g.prefix || g.suffix ? ` · ${esc(g.prefix + '…' + g.suffix)}` : ''}</small></div>
      <div class="chips">${g.values.map((v, k) => `<span>${data.labels?.[k] ? `<em>${esc(data.labels[k])}</em>` : g.itemLabels[k] ? `<em>${esc(g.itemLabels[k])}</em>` : ''}${fmtN(v)}</span>`).join('')}</div>${amb}</div>`;
  }).join('');
  if (data.dropped) html += `<p class="drop-note">还有 ${data.dropped} 行没用上：最多 ${MAX_GROUPS} 组</p>`;
  if (!n) html = '<p class="ed-tip">还没有认出数字。每行写一组数，比如「12 30 45」。</p>';
  $('parsed').innerHTML = html;
}
$('data').value = s.text;
$('data').addEventListener('input', () => { setText($('data').value); paintParsed(); paintTabs(); schedulePreview(); });
$('parsed').addEventListener('click', (e) => {
  const b = e.target.closest('[data-line]');
  if (!b) return;
  s.overrides[b.dataset.line] = b.dataset.mode;
  setText(s.text); paintParsed(); schedulePreview();
});
$('sample').onclick = () => { $('data').value = SAMPLE; s.overrides = {}; setText(SAMPLE); render(); };
$('clear').onclick = () => { $('data').value = ''; s.overrides = {}; setText(''); render(); $('data').focus(); };

/* ── 底部面板 ─────────────────────────────────────────────────────── */
const seg = (act, opts, cur, disabled = []) => `<div class="seg" role="group">${opts.map(([v, t]) => `<button type="button" data-act="${act}" data-v="${v}" aria-pressed="${String(v) === String(cur)}" ${disabled.includes(v) ? 'disabled' : ''}>${t}</button>`).join('')}</div>`;
const range = (act, label, v, min, max, show = v, step = 1) => `<label class="ctl"><span class="lab">${label}<output data-out="${act}">${show}</output></span><input type="range" data-act="${act}" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
const ctl = (label, inner) => `<div class="ctl"><span class="lab">${label}</span>${inner}</div>`;
const toggle = (act, label, on) => `<label class="toggle">${label}<input type="checkbox" data-act="${act}" ${on ? 'checked' : ''}></label>`;
const secs = (v) => `${(+v).toFixed(1)} s`;

function controls() {
  switch (step) {
    case 0: return [
      ctl('多组数据', seg('mode', [['merge', '合成一张图'], ['split', '每组一张图']], s.mode)),
      ctl('数字缩写', seg('abbr', [['auto', '自动'], ['none', '不缩写'], ['cn', '万 / 亿'], ['en', 'k / M']], s.abbr)),
      ctl('小数位', seg('decimals', [['auto', '自动'], ['0', '0'], ['1', '1'], ['2', '2']], s.decimals))];
    case 1: {
      const rec = recommend(data.groups);
      return [`<div class="ctl grow"><span class="lab">图表类型<span>${s.mode === 'merge' && data.groups.length > 1 && chartById(s.chart).multi === 'first' ? '这种图只画第一组 —— 想每组都画，回第一步选「每组一张图」' : ''}</span></span><div class="thumbs" id="chart-thumbs" style="--cols:${Math.ceil(CHARTS.length / 2)}">${CHARTS.map(c => `<button type="button" data-act="chart" data-v="${c.id}" aria-pressed="${c.id === s.chart}" title="${c.name}"><canvas></canvas><span>${c.name}</span>${rec.slice(0, 3).includes(c.id) ? '<b>推荐</b>' : ''}</button>`).join('')}</div></div>`];
    }
    case 2: return [
      `<div class="ctl grow"><span class="lab">风格</span><div class="thumbs" id="style-thumbs" style="--cols:${Math.ceil(STYLES.length / 2)}">${STYLES.map(st => `<button type="button" data-act="style" data-v="${st.id}" aria-pressed="${st.id === s.style}" title="${st.name}"><canvas></canvas><span>${st.name}</span></button>`).join('')}</div></div>`,
      `<div class="toggles">${toggle('panel', '卡片底板', s.panel)}${toggle('grid', '网格与刻度', s.grid)}${toggle('values', '数值标签', s.values)}</div>`];
    case 3: return [
      ctl('入场', seg('effect', [['grow', '生长'], ['fade', '淡入'], ['pop', '弹跳']], s.anim.effect)),
      range('dur', '时长', s.anim.dur, .4, 4, secs(s.anim.dur), .1),
      range('stagger', '错峰', s.anim.stagger, 0, 100),
      ctl('缓动', seg('ease', [['out', '缓出'], ['inout', '缓入缓出'], ['linear', '匀速']], s.anim.ease, s.anim.effect === 'pop' ? ['out', 'inout', 'linear'] : [])),
      range('hold', '结尾停留', s.anim.hold, 0, 4, secs(s.anim.hold), .1),
      ctl('播放', seg('loop', [['1', '循环'], ['0', '只播一次']], s.anim.loop ? '1' : '0')),
      ctl('&nbsp;', '<button type="button" class="pill" data-act="replay">重播</button>')];
    case 4: return [
      ctl('来源', seg('src', [['rheo', 'Rheo'], ['solid', '纯色'], ['image', '导入图片'], ['none', '透明']], s.src)),
      s.src === 'rheo' && rheoFrame ? ctl('Rheo', `<div class="row"><span class="chip">已导入画面 · ${rheoFrame.naturalWidth} × ${rheoFrame.naturalHeight}</span><button type="button" class="pill" data-act="importStyle">重新导入</button><button type="button" class="pill ghost" data-act="clearFrame">改回随机生成</button></div>`)
      : s.src === 'rheo' ? ctl('Rheo', '<div class="row"><button type="button" class="pill" data-act="rndColor">随机颜色</button><button type="button" class="pill" data-act="rndStyle">随机样式</button><button type="button" class="pill" data-act="importStyle">导入样式</button></div>')
        : s.src === 'solid' ? ctl('颜色', `<div class="swatches">${SOLIDS.map(c => `<button type="button" data-act="solid" data-v="${c}" style="background:${c}" aria-label="${c}" aria-pressed="${c === s.solid}"></button>`).join('')}<label title="自定义颜色"><input type="color" data-act="solidPick" value="${s.solid}" aria-label="自定义颜色"></label></div>`)
          : s.src === 'image' ? ctl('图片', `<label class="pill" style="cursor:pointer;border:1px solid var(--border-control);border-radius:999px;background:var(--surface-2)">${bgImage ? '换一张图…' : '选择图片…'}<input type="file" accept="image/*" data-act="bgFile" hidden></label>`)
            : `<p class="hint" style="max-width:260px">背景透明：导出 PNG、PNG 序列和 HTML 时保留透明通道。${styleById(s.style).fill === 'glass' ? '玻璃风格没有东西可透，建议打开卡片底板。' : ''}</p>`,
      s.src === 'rheo' && rheoFrame ? range('frameSize', '背景大小', s.frameSize, 30, 300, s.frameSize + '%')
        : s.src === 'rheo' ? range('rheoSize', '背景大小', s.rheoSize, 30, 200, s.rheoSize + '%')
          : s.src === 'image' ? range('imageSize', '背景大小', s.imageSize, 30, 300, s.imageSize + '%') : '',
      s.src === 'none' || s.src === 'solid' ? '' : range('blur', '模糊', s.blur, 0, 100)];
    case 5: return [
      `<div class="ctl grow"><span class="lab">排版<span>${s.layout === 'plain' ? '纯图不带文字' : '点画面里的文字直接改'}</span></span><div class="thumbs" id="layout-thumbs" style="--cols:${Math.ceil(LAYOUTS.length / 2)}">${LAYOUTS.map(l => `<button type="button" data-act="layout" data-v="${l.id}" aria-pressed="${l.id === s.layout}" title="${l.name}"><canvas></canvas><span>${l.name}</span></button>`).join('')}</div></div>`,
      `<div class="col">${ctl('画幅', seg('ratio', Object.keys(RATIOS).map(k => [k, k]), s.ratio))}${range('scale', '内容大小', s.scale, 60, 100, s.scale + '%')}</div>`,
      s.mode === 'split' && data.groups.length > 1 ? ctl('每组一张图', seg('splitView', [['each', '分开导出'], ['grid', '拼成一张']], s.splitView)) : ''];
    case 6: {
      const { width, height } = exportSize(aspect(), s.size);
      const n = exportCount();
      const frames = Math.round(cycle(s.anim) * s.fps) + 1;
      const noAlpha = transparentBg() ? ['jpg', 'video'] : [];
      if (noAlpha.includes(s.fmt)) s.fmt = 'png';
      if (s.fmt === 'video' && !videoType) s.fmt = 'png';
      const moving = s.fmt === 'seq' || s.fmt === 'video';
      const note = s.fmt === 'seq' ? `${frames} 帧 · ${secs(cycle(s.anim))}，打包成 zip，剪辑软件里按图片序列导入${transparentBg() ? '；背景透明' : '；背景选「透明」可带透明通道'}`
        : s.fmt === 'video' ? `${secs(cycle(s.anim))} · ${videoType?.includes('mp4') ? 'MP4' : 'WebM'}，按实际时长录制`
          : s.fmt === 'html' ? `单个 .html 文件，滚动到它时播放、点击重播${transparentBg() ? '，背景透明' : ''}`
            : s.fmt === 'jpg' ? '不带透明通道' : transparentBg() ? '带透明通道' : '动画最后一帧';
      return [
        ctl('格式', seg('fmt', [['png', 'PNG'], ['jpg', 'JPG'], ['seq', 'PNG 序列'], ['video', '视频'], ['html', 'HTML']], s.fmt, [...noAlpha, ...(videoType ? [] : ['video'])])),
        `<div class="col">${ctl('长边', seg('size', [['1280', '1280'], ['1920', '1920'], ['3840', '3840']], s.size))}${moving ? ctl('帧率', seg('fps', [['30', '30'], ['60', '60']], s.fps)) : ''}</div>`,
        `<div class="col" style="max-width:220px">${ctl('尺寸', `<span class="readout">${width} × ${height} px${n > 1 ? ` · ${n} 份` : ''}</span>`)}<p class="hint">${note}${videoType ? '' : '（这个浏览器录不了视频）'}</p>`
          + `<div class="row">${s.fmt === 'png' && n === 1 ? '<button type="button" class="pill" data-act="copy">复制</button>' : ''}<button type="button" class="pill primary" data-act="download">${n > 1 || s.fmt === 'seq' ? '下载 zip' : '下载'}</button></div></div>`];
    }
  }
}

function paintDock() {
  $('dock').innerHTML = (step ? '<button type="button" class="nav back" data-act="prev">‹ 上一步</button>' : '')
    + `<div class="ctls">${controls().join('')}</div>`
    + (step < STEPS.length - 1 ? '<button type="button" class="nav primary" data-act="next">下一步 ›</button>' : '');
  scheduleThumbs();
}

const ANIM_KEYS = new Set(['effect', 'dur', 'stagger', 'ease', 'hold', 'loop']);
$('dock').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act, v = b.dataset.v;
  switch (act) {
    case 'next': return go(step + 1);
    case 'prev': return go(step - 1);
    case 'replay': restart(); return;
    case 'copy': return copyImage(b);
    case 'download': return download(b);
    case 'importStyle': return importStyle();
    case 'clearFrame': rheoFrame = null; break;
    case 'rndColor': rheoFrame = null; s.rheo = randomizePalette(randomSeed(), s.rheo).state; break;
    case 'rndStyle': rheoFrame = null; s.rheo = { ...generate(randomSeed(), { ...s.rheo, lockColors: true, lockMode: false }), lockColors: s.rheo.lockColors, lockMode: s.rheo.lockMode, particles: false }; break;
    case 'style': s.style = v; s.panel = styleById(v).panelOn; break;
    case 'chart': s.chart = v; restart(); break;
    case 'layout': s.layout = v; break;
    case 'loop': s.anim.loop = v === '1'; break;
    case 'size': case 'fps': s[act] = +v; break;
    case 'mode': s.mode = v; s.current = 0; restart(); break;
    default:
      if (ANIM_KEYS.has(act)) { s.anim[act] = v; restart(); }
      else if (v !== undefined) s[act] = v;
  }
  saveSettings();
  render();
});
$('dock').addEventListener('input', (e) => {
  const el = e.target, act = el.dataset.act;
  if (!act) return;
  if (el.type === 'range') {
    const val = +el.value;
    if (ANIM_KEYS.has(act)) s.anim[act] = val; else s[act] = val;
    const out = $('dock').querySelector(`[data-out="${act}"]`);
    if (out) out.textContent = act === 'dur' || act === 'hold' ? secs(val) : act === 'stagger' || act === 'blur' ? String(val) : val + '%';
    saveSettings();
    if (ANIM_KEYS.has(act)) restart();
    schedulePreview();
    if (act === 'scale') scheduleThumbs();
    return;
  }
  if (el.type === 'checkbox') { s[act] = el.checked; saveSettings(); schedulePreview(); scheduleThumbs(); return; }
  if (act === 'solidPick') { s.solid = el.value; saveSettings(); schedulePreview(); }
});
$('dock').addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.act === 'solidPick') render();
  if (el.dataset.act === 'bgFile' && el.files[0]) {
    try { bgImage = await loadImage(URL.createObjectURL(el.files[0])); bgImageId++; s.src = 'image'; }
    catch { toast('这张图读不出来'); }
    render();
  }
});
const randomSeed = () => Math.random().toString(36).slice(2, 10);
const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(Error('decode failed'));
  img.src = url;
});

/* 每组一张图时，预览哪一组 */
function paintTabs() {
  const on = s.mode === 'split' && s.splitView !== 'grid' && data.groups.length > 1;
  const pal = styleById(s.style).palette;
  $('tabs').hidden = !on;
  $('tabs').innerHTML = on ? data.groups.map((g, i) => `<button type="button" data-i="${i}" aria-pressed="${i === s.current}"><i style="background:${pal[i % 7]}"></i>${esc(g.name)}</button>`).join('') : '';
}
$('tabs').onclick = (e) => { const b = e.target.closest('[data-i]'); if (!b) return; s.current = +b.dataset.i; saveSettings(); paintTabs(); restart(); };

/* ── 缩略图：用当前数据画最后一帧 ─────────────────────────────────── */
let thumbsQueued = false;
function scheduleThumbs() { if (thumbsQueued) return; thumbsQueued = true; setTimeout(() => { thumbsQueued = false; paintThumbs(); }, 60); }
function paintThumbs() {
  const a = aspect(), tw = a >= 4 / 3 ? 144 : Math.round(108 * a), th = Math.round(tw / a);
  const draw = (cv, over) => {
    cv.width = tw; cv.height = th;
    cv.style.width = tw / 2 + 'px'; cv.style.height = th / 2 + 'px';
    drawFrame(cv.getContext('2d'), sceneOf(over), tw, th, 99, {});
  };
  document.querySelectorAll('#chart-thumbs canvas').forEach((cv, i) => draw(cv, { chart: CHARTS[i].id, layout: 'plain', splitView: 'each' }));
  document.querySelectorAll('#style-thumbs canvas').forEach((cv, i) => draw(cv, { style: STYLES[i].id, panel: STYLES[i].panelOn, layout: 'plain', splitView: 'each' }));
  document.querySelectorAll('#layout-thumbs canvas').forEach((cv, i) => draw(cv, { layout: LAYOUTS[i].id }));
}

/* ── 预览：按画幅比例塞进舞台，持续播放 ──────────────────────────────
   时间轴：t 从 0 走到「动画 + 停留」，循环时回到 0。拖进度条会暂停在那一帧。 */
let playing = true, t0 = performance.now(), tPaused = 0;
const now = () => (playing ? (performance.now() - t0) / 1000 : tPaused);
function timeAt(raw) {
  const len = cycle(s.anim);
  if (!s.anim.loop) return Math.min(raw, len);
  return len > 0 ? raw % (len + .35) : 0;            // 循环之间留一小段空白，像重新开始
}
function restart() { t0 = performance.now(); if (!playing) { tPaused = 0; } schedulePreview(); }
function paintPlay() {
  $('play').querySelector('svg').innerHTML = playing ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>' : '<path d="M7 5.5v13l11-6.5z"/>';
  $('play').setAttribute('aria-label', playing ? '暂停' : '播放');
}
$('play').onclick = () => {
  if (playing) { tPaused = timeAt(now()); playing = false; }
  else { playing = true; t0 = performance.now() - tPaused * 1000; }
  paintPlay(); schedulePreview();
};
$('scrub').addEventListener('input', (e) => {
  playing = false; tPaused = +e.target.value / 1000 * cycle(s.anim); paintPlay(); schedulePreview();
});
paintPlay();

let previewQueued = false, loopOn = false;
function schedulePreview() {
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => { previewQueued = false; paintPreview(); });
}
let lastRegions = [], lastK = 1, lastInk = '#16202e';
function paintPreview() {
  const wrap = $('canvas-wrap').getBoundingClientRect(), a = aspect();
  if (wrap.width < 10 || wrap.height < 10) return;
  let w = wrap.width, h = w / a;
  if (h > wrap.height) { h = wrap.height; w = h * a; }
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const cv = $('preview');
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  Object.assign(cv.style, { width: Math.round(w) + 'px', height: Math.round(h) + 'px', left: Math.round((wrap.width - w) / 2) + 'px', top: Math.round((wrap.height - h) / 2) + 'px' });
  const t = timeAt(now());
  const out = drawFrame(cv.getContext('2d'), sceneOf(), W, H, t, { interactive: step === 5, hide: editing });
  lastRegions = out.regions; lastK = W / w; lastInk = out.frame.statics.ink;
  const len = cycle(s.anim);
  $('scrub').value = String(Math.round(Math.min(1, t / (len || 1)) * 1000));
  $('clock').textContent = `${Math.min(t, len).toFixed(1)} / ${len.toFixed(1)} s`;
  paintTextLayer();
  // 还在动就继续：只播一次且已经播完、或暂停时停下
  if (playing && (s.anim.loop || now() < len)) schedulePreview();
}

/* ── 在画面上直接改字（照搬 Relief）───────────────────────────────── */
function paintTextLayer() {
  const layer = $('text-layer'), cv = $('preview');
  const on = step === 5 && s.layout !== 'plain';
  layer.hidden = !on;
  if (!on) { if (editing) endEdit(true); return; }
  Object.assign(layer.style, { left: cv.style.left, top: cv.style.top, width: cv.style.width, height: cv.style.height });
  const k = lastK, px = (v) => (v / k) + 'px';
  const names = { title: '标题', sub: '副标题', note: '来源' };
  const sig = JSON.stringify([lastRegions.map(r => [r.field, r.x, r.y, r.w, r.h]), editing, k]);
  if (layer.dataset.sig === sig) return;                  // 每帧都会走到这里：区域没变就不重建，免得光标动画被打断
  layer.dataset.sig = sig;
  $('text-hits').innerHTML = lastRegions.map(r => `<button type="button" class="txt-hit" data-field="${r.field}" aria-label="修改${names[r.field]}"
    style="left:${px(r.x - r.size * .15)};top:${px(r.y - r.size * .1)};width:${px(r.w + r.size * .3)};height:${px(r.h + r.size * .2)}"></button>`
    + (editing === r.field ? '' : `<i class="txt-caret" style="left:${px(r.caret.x + r.size * .06)};top:${px(r.caret.y)};height:${px(r.caret.h)};background:${lastInk}"></i>`)).join('');
  if (editing) placeEditor();
}
const measureCtx = document.createElement('canvas').getContext('2d');
function placeEditor() {
  const r = lastRegions.find(x => x.field === editing), ed = $('text-editor');
  if (!r) return;
  const k = lastK, size = r.size / k, font = r.font.replace(/[\d.]+px/, size + 'px');
  const maxW = r.edit.w / k, x0 = r.edit.x / k;
  measureCtx.font = font;
  const widest = Math.max(0, ...ed.value.split('\n').map(line => measureCtx.measureText(line).width));
  const width = Math.min(maxW, Math.max(widest + size * .6, size * 2));
  const left = r.align === 'center' ? x0 + (maxW - width) / 2 : x0;
  Object.assign(ed.style, { left: left + 'px', top: (r.edit.y / k) + 'px', width: width + 'px', font, lineHeight: String(r.lh), textAlign: r.align, color: lastInk, opacity: String(r.alpha) });
  ed.style.height = 'auto'; ed.style.height = ed.scrollHeight + 'px';
}
let editOriginal = '';
function startEdit(field) {
  if (editing === field) return;
  if (editing) endEdit(true);
  editing = field; editOriginal = s[field];
  const ed = $('text-editor');
  ed.value = s[field]; ed.hidden = false;
  ed.setAttribute('aria-label', { title: '标题', sub: '副标题', note: '来源' }[field]);
  $('text-layer').dataset.sig = '';
  schedulePreview();
  requestAnimationFrame(() => { placeEditor(); ed.focus(); ed.select(); });
}
function endEdit(commit) {
  if (!editing) return;
  if (!commit) s[editing] = editOriginal;
  s[editing] = s[editing].replace(/\s*\n\s*/g, ' ');
  editing = null;
  $('text-editor').hidden = true;
  $('text-layer').dataset.sig = '';
  saveSettings(); schedulePreview(); scheduleThumbs();
}
$('text-hits').addEventListener('click', (e) => { const b = e.target.closest('.txt-hit'); if (b) startEdit(b.dataset.field); });
$('text-editor').addEventListener('input', (e) => { s[editing] = e.target.value; placeEditor(); schedulePreview(); });
$('text-editor').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); endEdit(true); }
  else if (e.key === 'Escape') { e.preventDefault(); endEdit(false); }
});
$('text-editor').addEventListener('blur', () => endEdit(true));

/* ── 导入 Rheo 画面（同 Relief）───────────────────────────────────── */
async function useFrame(blob) {
  const img = await loadImage(URL.createObjectURL(blob));
  if (rheoFrame) URL.revokeObjectURL(rheoFrame.src);
  rheoFrame = img; bgImageId++; s.src = 'rheo';
  saveSettings(); render();
  toast(`已导入 Rheo 画面 · ${img.naturalWidth} × ${img.naturalHeight}`);
}
function useStyleText(text) {
  s.rheo = { ...parseRheoStyle(text), particles: false };
  rheoFrame = null; s.src = 'rheo'; saveSettings(); render(); toast('已导入 Rheo 样式');
}
async function importStyle() {
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (type) return await useFrame(await item.getType(type));
      if (item.types.includes('text/plain')) { try { return useStyleText(await (await item.getType('text/plain')).text()); } catch {} }
    }
  } catch {}
  $('import-error').textContent = '';
  $('import-dialog').showModal();
  $('import-paste').focus();
}
async function takeImportFile(file) {
  if (!file?.type.startsWith('image/')) { $('import-error').textContent = '剪贴板里没有图片：请先在 Rheo 页点「复制到 Relief」'; return; }
  try { await useFrame(file); $('import-dialog').close(); } catch { $('import-error').textContent = '这张图读不出来'; }
}
$('import-file').onchange = (e) => { if (e.target.files[0]) takeImportFile(e.target.files[0]); e.target.value = ''; };

/* ── 导出 ─────────────────────────────────────────────────────────
   「每组一张图 · 分开导出」时每组各出一份，打成 zip；其余情况一份。 */
const exportScenes = () => {
  if (s.mode === 'split' && s.splitView !== 'grid' && data.groups.length > 1) return data.groups.map((g, i) => ({ name: g.name, over: { current: i } }));
  return [{ name: '', over: {} }];
};
const exportCount = () => exportScenes().length;
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
const safeName = (n) => String(n).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40) || 'chart';

function renderAt(over, t, W, H, matte = null) {
  const cv = makeCanvas(W, H), ctx = cv.getContext('2d');
  drawFrame(ctx, sceneOf(over), W, H, t, {});
  if (!matte) return cv;
  const out = makeCanvas(W, H), o = out.getContext('2d');
  o.fillStyle = matte; o.fillRect(0, 0, W, H); o.drawImage(cv, 0, 0);
  return out;
}
const toBlob = (cv, type, q = .92) => new Promise((resolve, reject) => cv.toBlob(b => (b ? resolve(b) : reject(Error('导出失败'))), type, q));
const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
function save(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const mb = (n) => (n / 1024 / 1024).toFixed(n > 10 * 1024 * 1024 ? 0 : 1) + ' MB';

/* 视频：能录哪种先试出来（Safari 出 MP4，Chrome 新版本也能出 MP4，老一些的出 WebM） */
const videoType = (() => {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  return ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) || null;
})();

async function recordVideo(over, W, H, onTick) {
  const cv = makeCanvas(W, H), ctx = cv.getContext('2d');
  // captureStream(0) + requestFrame：每画完一帧就明确交一帧给编码器，页面在后台时也不会只录到第一帧
  let stream = cv.captureStream(0), track = stream.getVideoTracks()[0];
  if (typeof track.requestFrame !== 'function') { stream = cv.captureStream(s.fps); track = null; }
  const rec = new MediaRecorder(stream, { mimeType: videoType, videoBitsPerSecond: Math.round(W * H * s.fps * .12) });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((resolve) => { rec.onstop = resolve; });
  const scene = sceneOf(over), len = cycle(s.anim);
  drawFrame(ctx, scene, W, H, 0, {});
  rec.start(250);
  track?.requestFrame();
  const start = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      drawFrame(ctx, scene, W, H, Math.min(t, len), {});
      track?.requestFrame();
      onTick(Math.min(1, t / len));
      if (t >= len + .15) resolve(); else setTimeout(tick, 1000 / s.fps);
    };
    tick();                                         // 用定时器而不是 rAF：切到别的标签页时 rAF 会停，录到一半就卡住
  });
  rec.stop();
  await done;
  stream.getTracks().forEach(tr => tr.stop());
  return new Blob(chunks, { type: videoType.split(';')[0] });
}

/* HTML：背景 + 卡片 + 文字烘成一张图（透明背景时保留透明），图表本身由内联的绘制代码实时画 */
let bundleCache = null;
async function drawBundle() {
  if (bundleCache) return bundleCache;
  const [core, draw] = await Promise.all(['/src/rise-core.js', '/src/rise-draw.js'].map(u => fetch(u).then(r => r.text())));
  const strip = (src) => src.replace(/^import .*$/gm, '').replace(/^export \{[^}]*\};?$/gm, '').replace(/^export /gm, '');
  const fonts = {};
  for (const [name, url] of [['sans400', '/fonts/IBMPlexSans-Regular.woff2'], ['sans600', '/fonts/IBMPlexSans-SemiBold.woff2'], ['mono400', '/fonts/IBMPlexMono-Regular.woff2']]) {
    try {
      const b = new Uint8Array(await (await fetch(url)).arrayBuffer());
      let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
      fonts[name] = 'data:font/woff2;base64,' + btoa(bin);
    } catch {}
  }
  bundleCache = { code: strip(core) + '\n' + strip(draw), fonts };
  return bundleCache;
}
async function htmlFile(over, W, H, title) {
  const { code, fonts } = await drawBundle();
  const p = prepare(sceneOf(over), W, H, {});
  const layer = await toBlob(p.layer, 'image/png');
  const layerUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(layer); });
  const face = (fam, w, url) => url ? `@font-face{font-family:"${fam}";src:url(${url}) format("woff2");font-weight:${w};font-display:block}` : '';
  const dyn = JSON.stringify(p.frame.dyn).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title || 'Rise 图表')}</title>
<style>${face('IBM Plex Sans', 400, fonts.sans400)}${face('IBM Plex Sans', 600, fonts.sans600)}${face('IBM Plex Mono', 400, fonts.mono400)}
html,body{margin:0;background:transparent}
.rise-chart{display:block;width:100%;max-width:${Math.round(W / 2)}px;aspect-ratio:${W}/${H};margin:0 auto;cursor:pointer}</style></head>
<body>
<!-- Rise · Luxel 导出。整段 <canvas> 和 <script> 可以直接嵌进任何网页；点击图表重播。 -->
<canvas class="rise-chart" width="${W}" height="${H}" role="img" aria-label="${esc(title || '图表')}"></canvas>
<script>
(() => {
${code}
const DYN = ${dyn};
const LOOP = ${s.anim.loop ? 'true' : 'false'};
const cv = document.currentScript.previousElementSibling, ctx = cv.getContext('2d');
const bg = new Image(); bg.src = ${JSON.stringify(layerUrl)};
let start = null, raf = 0;
const len = cycle(DYN.anim);
function frame(now) {
  if (start === null) start = now;
  let t = (now - start) / 1000;
  if (LOOP) t %= len + .35; else t = Math.min(t, len);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(bg, 0, 0, cv.width, cv.height);
  drawDynamic(ctx, DYN, t);
  if (LOOP || t < len) raf = requestAnimationFrame(frame);
}
const play = () => { cancelAnimationFrame(raf); start = null; raf = requestAnimationFrame(frame); };
cv.addEventListener('click', play);
Promise.all([bg.decode().catch(() => {}), document.fonts ? Promise.all(['400 20px "IBM Plex Sans"', '600 20px "IBM Plex Sans"', '400 20px "IBM Plex Mono"'].map(f => document.fonts.load(f))).catch(() => {}) : 0]).then(() => {
  ctx.drawImage(bg, 0, 0, cv.width, cv.height);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting)) { io.disconnect(); play(); } }, { threshold: .35 });
    io.observe(cv);
  } else play();
});
})();
</script>
</body></html>
`;
}

let busy = false;
async function download(btn) {
  if (busy) return;
  busy = true; btn.disabled = true;
  const scenes = exportScenes();
  const { width: W, height: H } = exportSize(aspect(), s.size);
  const base = `rise-${stamp()}`;
  const len = cycle(s.anim);
  try {
    const files = [];                               // { name, data:Uint8Array }，多于一个就打 zip
    const single = scenes.length === 1;
    for (const [k, sc] of scenes.entries()) {
      const tag = single ? '' : `-${String(k + 1).padStart(2, '0')}-${safeName(sc.name)}`;
      if (s.fmt === 'png' || s.fmt === 'jpg') {
        const jpg = s.fmt === 'jpg';
        const blob = await toBlob(renderAt(sc.over, len, W, H, jpg ? '#ffffff' : null), jpg ? 'image/jpeg' : 'image/png');
        files.push({ name: `${base}${tag}.${s.fmt}`, data: await bytes(blob) });
      } else if (s.fmt === 'seq') {
        const frames = Math.round(len * s.fps) + 1, dir = single ? base : `${base}${tag}`;
        const cv = makeCanvas(W, H), ctx = cv.getContext('2d'), scene = sceneOf(sc.over);
        for (let f = 0; f < frames; f++) {
          drawFrame(ctx, scene, W, H, f / s.fps, {});
          files.push({ name: `${dir}/${String(f + 1).padStart(4, '0')}.png`, data: await bytes(await toBlob(cv, 'image/png')) });
          if (f % 3 === 0) toast(`正在导出 PNG 序列${single ? '' : ` · 第 ${k + 1} / ${scenes.length} 组`} · ${f + 1} / ${frames} 帧`, true);
        }
      } else if (s.fmt === 'video') {
        const blob = await recordVideo(sc.over, W, H, (p) => toast(`正在录制视频${single ? '' : ` · 第 ${k + 1} / ${scenes.length} 组`} · ${Math.round(p * 100)}%`, true));
        files.push({ name: `${base}${tag}.${videoType.includes('mp4') ? 'mp4' : 'webm'}`, data: await bytes(blob) });
      } else if (s.fmt === 'html') {
        const html = await htmlFile(sc.over, W, H, s.title);
        files.push({ name: `${base}${tag}.html`, data: new TextEncoder().encode(html) });
      }
    }
    if (files.length === 1) {
      const f = files[0], ext = f.name.split('.').pop();
      const type = { png: 'image/png', jpg: 'image/jpeg', mp4: 'video/mp4', webm: 'video/webm', html: 'text/html' }[ext] || 'application/octet-stream';
      save(new Blob([f.data], { type }), f.name);
      toast(`已导出 ${mb(f.data.length)}`);
    } else {
      const zip = makeZip(files);
      save(new Blob([zip], { type: 'application/zip' }), `${base}.zip`);
      toast(`已导出 ${files.length} 个文件 · ${mb(zip.length)}`);
    }
  } catch (e) { console.error(e); toast(e.message || '导出失败'); }
  finally { busy = false; btn.disabled = false; }
}

async function copyImage(btn) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') { toast('当前浏览器不支持复制图片，请用下载'); return; }
  btn.disabled = true;
  try {
    const { width: W, height: H } = exportSize(aspect(), s.size);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': toBlob(renderAt({}, cycle(s.anim), W, H), 'image/png') })]);
    toast('已复制，可以直接粘贴到 Figma / Keynote / 聊天里');
  } catch (e) { toast(e && e.name === 'NotAllowedError' ? '浏览器没有给剪贴板权限，请用下载' : '复制失败，请用下载'); }
  finally { btn.disabled = false; }
}

/* ── 读入文件：拖入 CSV / TSV / TXT ─────────────────────────────── */
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('veil').hidden = false; });
addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('veil').hidden = true; } });
addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $('veil').hidden = true;
  const f = [...e.dataTransfer.files][0];
  if (!f) return;
  if (f.type.startsWith('image/') && step === 4) { try { bgImage = await loadImage(URL.createObjectURL(f)); bgImageId++; s.src = 'image'; render(); } catch { toast('这张图读不出来'); } return; }
  if (!/\.(csv|tsv|txt)$/i.test(f.name) && !f.type.startsWith('text/')) { toast('只能读 CSV / TSV / TXT 文本'); return; }
  const text = (await f.text()).replace(/^﻿/, '');
  $('data').value = text; s.overrides = {}; setText(text); step = 0; render();
  toast(`已读入 ${f.name}`);
});
addEventListener('paste', (e) => {
  if ($('import-dialog').open) {
    e.preventDefault();
    const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
    if (f) { takeImportFile(f); return; }
    try { useStyleText(e.clipboardData?.getData('text/plain')); $('import-dialog').close(); } catch { $('import-error').textContent = '剪贴板里没有图片：请先在 Rheo 页点「复制到 Relief」'; }
  }
});

let toastTimer;
function toast(text, sticky = false) {
  const t = $('toast');
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, sticky ? 6000 : 2600);
}

new ResizeObserver(() => { $('text-layer').dataset.sig = ''; schedulePreview(); }).observe($('canvas-wrap'));
/* 字体没加载完就画，canvas 会用后备字体 —— Plex 就绪后清掉缓存重画 */
Promise.all(['400 20px "IBM Plex Sans"', '600 20px "IBM Plex Sans"', '400 20px "IBM Plex Mono"'].map(f => document.fonts?.load(f))).then(() => { clearStatic(); clearCache(); schedulePreview(); scheduleThumbs(); }).catch(() => {});
render();
