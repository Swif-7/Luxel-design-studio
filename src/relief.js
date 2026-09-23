// Relief 页面：放入截图 → ① 裁切 → ② 背景 → ③ 构图（外框、排版、文字，都在画面上直接调）→ ④ 导出。
// 一次只显示一步的控件（底部面板），预览和导出共用 relief-render.js 的 renderScene。
import { RATIOS, RATIO_LABELS, canvasAspect, exportSize, frameAspect, TEMPLATES, fitRatioBox, dragBox, trimBounds, parseRheoStyle, snapBox, SCALE_MIN, SCALE_MAX, clamp } from './relief-core.js';
import { renderScene, makeCanvas, clearCache } from './relief-render.js';
import { defaults, generate, randomizePalette } from './model.js';
import { initI18n, mountLangSwitch } from './i18n-dom.js';
import { t } from './i18n.js';
import relief from './lang/relief.js';

const $ = (id) => document.getElementById(id);
initI18n(relief);
mountLangSwitch($('theme'), { place: 'before' });

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
   设置（背景、构图、文字、导出）记在 localStorage，下次打开沿用；
   截图本身、裁切框和导入的背景图只在内存里。 */
const STEPS = ['裁切', '背景', '构图', '导出'];
const COMPOSE = 2, EXPORT = 3;
const SOLIDS = ['#f1f3f5', '#ffffff', '#16202e', '#ffe066', '#a5d8ff', '#ffc9c9', '#b2f2bb'];
const INKS = ['#16202e', '#ffffff', '#3b5bdb', '#e8590c'];
const SETTINGS_KEY = 'relief-settings';
const DEFAULT_TITLES = new Set(['点击修改文本', 'Click to edit text', '클릭해서 텍스트 수정', 'クリックしてテキストを編集', 'Cliquez pour modifier le texte']);
const DEFAULT_SUBS = new Set(['点击修改副标题', 'Click to edit subtitle', '클릭해서 부제목 수정', 'クリックしてサブタイトルを編集', 'Cliquez pour modifier le sous-titre']);
const DEFAULTS = {
  cropRatio: 'free', radius: 14,
  src: 'rheo', rheo: { ...defaults, particles: false }, solid: '#f1f3f5', blur: 0,
  rheoSize: 100, imageSize: 100, frameSize: 100,   // 背景大小：生成的 Rheo 30–200%；导入的图片 / Rheo 画面 30–300%（缩到 100% 以下时四周透明，预览显示棋盘格）
  frame: 'browser', frameThick: 50, shadow: 55, ratio: '4:3', scale: 74,
  tpl: 1, title: t('点击修改文本'), sub: t('点击修改副标题'), ink: 'auto', inkAlpha: 100,     // 画在图上的默认文字：跟界面语言走
  titleSize: 100, subSize: 100,
  pos: { shot: [0, 0], title: [0, 0], sub: [0, 0] },   // 画面上拖动后的偏移，按画布宽高的比例
  fmt: 'png', x: 2,
};
const ZERO_POS = () => ({ shot: [0, 0], title: [0, 0], sub: [0, 0] });
let s = { ...DEFAULTS, pos: ZERO_POS() };      // pos 要是自己的一份：拖动会改它，不能改到默认值
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  s = { ...DEFAULTS, ...saved, rheo: { ...DEFAULTS.rheo, ...(saved.rheo || {}) } };
  if (s.src === 'image') s.src = 'rheo';               // 导入的背景图不会保存
  // 旧版默认文案和「深 / 浅」颜色迁移到新版
  if (s.title === '让截图自己会说话') s.title = DEFAULTS.title;
  if (s.sub === '本地处理 · 一键复制 · 8 种排版') s.sub = DEFAULTS.sub;
  // 换了界面语言：还是某种语言的默认文字（没被改过）就换成当前语言的
  if (DEFAULT_TITLES.has(s.title)) s.title = DEFAULTS.title;
  if (DEFAULT_SUBS.has(s.sub)) s.sub = DEFAULTS.sub;
  if (s.ink === 'black') s.ink = '#16202e'; else if (s.ink === 'white') s.ink = '#ffffff';
  // 位置：只认三组两个数字；旧版的「位置」滑块（textShift，只能沿一个方向挪）换算成标题和副标题的偏移
  const pos = ZERO_POS();
  for (const k of Object.keys(pos)) { const v = saved.pos?.[k]; if (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite)) pos[k] = v; }
  if (Number.isFinite(saved.textShift) && saved.textShift) {
    const d = clamp(saved.textShift, -100, 100) / 100 * .2, axis = [2, 6, 7].includes(s.tpl) ? 0 : [1, 3, 4, 8].includes(s.tpl) ? 1 : -1;
    if (axis >= 0) for (const k of ['title', 'sub']) pos[k][axis] = d;
  }
  s.pos = pos;
  delete s.textShift;
  s.scale = clamp(+s.scale || DEFAULTS.scale, SCALE_MIN, SCALE_MAX);
} catch {}
const saveSettings = () => {
  const { cropRatio, radius, src, rheo, solid, blur, rheoSize, imageSize, frameSize, frame, frameThick, shadow, ratio, scale, tpl, title, sub, ink, inkAlpha, titleSize, subSize, pos, fmt, x } = s;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ cropRatio, radius, src, rheo, solid, blur, rheoSize, imageSize, frameSize, frame, frameThick, shadow, ratio, scale, tpl, title, sub, ink, inkAlpha, titleSize, subSize, pos, fmt, x })); } catch {}
};

let source = null;          // { img, width, height, url }
let crop = null;            // { x, y, w, h }，原图像素
let bgImage = null, bgImageId = 0;
let rheoFrame = null;      // 从 Rheo 页「复制到 Relief」导入的那一帧；有它时 Rheo 背景直接用这张图，不再重新渲染
let step = 0;
let editing = null;        // 正在画面上直接编辑的文字字段：'title' | 'sub' | null

const CROP_RATIOS = { free: null, orig: 'orig', '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9 };
const cropRatioValue = () => { const r = CROP_RATIOS[s.cropRatio]; return r === 'orig' ? source.width / source.height : r; };

/* ── 放入截图 ───────────────────────────────────────────────────────
   用 onload 而不是 img.decode()：页面在后台（标签页没激活）时 decode 可能一直不返回。 */
const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(Error('decode failed'));
  img.src = url;
});
const isImage = (f) => f && (f.type.startsWith('image/') || /\.(heic|heif|avif)$/i.test(f.name));
async function loadFile(file) {
  if (!isImage(file)) { toast('这不是图片'); return; }
  const url = URL.createObjectURL(file);
  let img;
  try { img = await loadImage(url); }
  catch { URL.revokeObjectURL(url); toast(/\.(heic|heif)$/i.test(file.name) ? '当前浏览器读不了 HEIC（Safari 可以）' : '这张图读不出来'); return; }
  if (source) URL.revokeObjectURL(source.url);
  source = { img, width: img.naturalWidth, height: img.naturalHeight, url };
  crop = fitRatioBox(source.width, source.height, s.cropRatio === 'free' || s.cropRatio === 'orig' ? null : cropRatioValue());
  shotCache = null;
  step = 0;
  $('crop-img').src = url;
  render();
}

/* ── 裁好的截图：每次裁切框变了才重新切 ─────────────────────────── */
let shotCache = null;
function shot() {
  const key = `${crop.x},${crop.y},${crop.w},${crop.h}`;
  if (shotCache?.key === key) return shotCache.canvas;
  const k = Math.min(1, 3200 / Math.max(crop.w, crop.h));          // 超大截图先压到长边 3200，够 2x 导出
  const c = makeCanvas(crop.w * k, crop.h * k), ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source.img, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
  shotCache = { key, canvas: c };
  return c;
}

/* 背景大小：Rheo 直接乘它自己的 scale（着色器里坐标除以 scale，越大图案越大，按原生分辨率重画不会糊，
   下限 0.25 是 Rheo 自己的范围）；导入图片以「铺满」为 100%，放大裁切、缩小则四周留透明。 */
const scene = () => {
  const rheo = { ...s.rheo, scale: clamp(s.rheo.scale * s.rheoSize / 100, 0.25, 3) };
  let bg;
  if (s.src === 'solid') bg = { key: 'solid:' + s.solid, src: 'solid', solid: s.solid };
  else if (s.src === 'image' && bgImage) bg = { key: `image:${bgImageId}:${s.imageSize}`, src: 'image', image: bgImage, zoom: s.imageSize / 100 };
  else if (s.src === 'rheo' && rheoFrame) bg = { key: `frame:${bgImageId}:${s.frameSize}`, src: 'image', image: rheoFrame, zoom: s.frameSize / 100 };
  else bg = { key: 'rheo:' + JSON.stringify(rheo), src: 'rheo', rheo };
  return {
    bg: { ...bg, blur: s.blur },
    frame: s.frame, frameThick: s.frameThick, radius: s.radius, shadow: s.shadow, scale: s.scale, tpl: s.tpl,
    title: s.title, sub: s.sub, ink: s.ink, inkAlpha: s.inkAlpha, titleSize: s.titleSize, subSize: s.subSize, pos: s.pos,
    interactive: step === COMPOSE, hide: editing,
  };
};
const aspectNow = () => canvasAspect(s.ratio, frameAspect(s.frame, crop.w / crop.h, s.frameThick));

/* ── 视图 ───────────────────────────────────────────────────────── */
function render() {
  const has = !!source;
  $('drop').hidden = has;
  $('steps').hidden = $('swap-wrap').hidden = $('dock').hidden = !has;
  $('crop').hidden = !has || step !== 0;
  $('preview').hidden = !has || step === 0;
  if (!has) return;
  paintSteps();
  paintDock();
  if (step === 0) layoutCrop(); else schedulePreview();
}

function paintSteps() {
  $('steps').innerHTML = STEPS.map((name, i) =>
    `<button type="button" data-step="${i}" class="${i < step ? 'done' : ''}" ${i === step ? 'aria-current="step"' : ''}><i>${i < step ? '✓' : i + 1}</i>${name}</button>`).join('');
}
$('steps').onclick = (e) => { const b = e.target.closest('[data-step]'); if (b) go(+b.dataset.step); };
function go(n) { if (editing) endEdit(true); select(null); step = clamp(n, 0, EXPORT); render(); }

/* ── 底部面板：每一步的控件 ─────────────────────────────────────── */
const seg = (act, opts, cur) => `<div class="seg" role="group">${opts.map(([v, t]) => `<button type="button" data-act="${act}" data-v="${v}" aria-pressed="${String(v) === String(cur)}">${t}</button>`).join('')}</div>`;
const range = (act, label, v, min, max, unit = '') => `<label class="ctl"><span class="lab">${label}<output data-out="${act}">${v}${unit}</output></span><input type="range" data-act="${act}" min="${min}" max="${max}" value="${v}"></label>`;
const ctl = (label, inner) => `<div class="ctl"><span class="lab">${label}</span>${inner}</div>`;
const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function controls() {
  switch (step) {
    case 0: return [
      ctl('比例', seg('cropRatio', [['free', '自由'], ['orig', '原比例'], ['1:1', '1:1'], ['4:3', '4:3'], ['16:9', '16:9']], s.cropRatio)),
      range('radius', '圆角', s.radius, 0, 48),
      ctl('&nbsp;', '<div class="row"><button type="button" class="pill" data-act="trim">自动去白边</button><button type="button" class="pill ghost" data-act="resetCrop">还原</button></div>')];
    case 1: return [
      ctl('来源', seg('src', [['rheo', 'Rheo'], ['solid', '纯色'], ['image', '导入图片']], s.src)),
      s.src === 'rheo' && rheoFrame ? ctl('Rheo', `<div class="row"><span class="chip">已导入画面 · ${rheoFrame.naturalWidth} × ${rheoFrame.naturalHeight}</span><button type="button" class="pill" data-act="importStyle">重新导入</button><button type="button" class="pill ghost" data-act="clearFrame">改回随机生成</button></div>`)
      : s.src === 'rheo' ? ctl('Rheo', '<div class="row"><button type="button" class="pill" data-act="rndColor">随机颜色</button><button type="button" class="pill" data-act="rndStyle">随机样式</button><button type="button" class="pill" data-act="importStyle">导入样式</button></div>')
        : s.src === 'solid' ? ctl('颜色', `<div class="swatches">${SOLIDS.map(c => `<button type="button" data-act="solid" data-v="${c}" style="background:${c}" aria-label="${c}" aria-pressed="${c === s.solid}"></button>`).join('')}<label title="自定义颜色"><input type="color" data-act="solidPick" value="${s.solid}" aria-label="自定义颜色"></label></div>`)
          : ctl('图片', `<label class="pill" style="cursor:pointer;border:1px solid var(--border-control);border-radius:999px;background:var(--surface-2)">${bgImage ? '换一张图…' : '选择图片…'}<input type="file" accept="image/*" data-act="bgFile" hidden></label>`),
      s.src === 'rheo' && rheoFrame ? range('frameSize', '背景大小', s.frameSize, 30, 300, '%')
        : s.src === 'rheo' ? range('rheoSize', '背景大小', s.rheoSize, 30, 200, '%')
        : s.src === 'image' ? range('imageSize', '背景大小', s.imageSize, 30, 300, '%') : '',
      range('blur', '模糊', s.blur, 0, 100)];
    case COMPOSE: return [
      `<div class="ctl"><span class="lab">排版</span><div class="tpls" id="tpls">${TEMPLATES.map((t, i) => `<button type="button" data-act="tpl" data-v="${i}" aria-pressed="${i === s.tpl}" title="${t.name}"><canvas></canvas><span>${t.name}</span></button>`).join('')}</div></div>`,
      `<div class="col">${ctl('外框', seg('frame', [['none', '无'], ['browser', '浏览器'], ['phone', '手机']], s.frame))}`
        + (s.frame !== 'none' ? range('frameThick', '边框粗细', s.frameThick, 0, 100) : '') + '</div>',
      `<div class="col">${ctl('画幅', `<span class="select-row"><select data-act="ratio" aria-label="画幅">${Object.keys(RATIOS).map(k => `<option value="${k}"${k === s.ratio ? ' selected' : ''}>${RATIO_LABELS[k]}</option>`).join('')}</select></span>`)}`
        + range('shadow', '阴影', s.shadow, 0, 100) + '</div>',
      s.tpl ? `<div class="col">${ctl('文字颜色', `<div class="swatches"><button type="button" class="auto" data-act="ink" data-v="auto" aria-pressed="${s.ink === 'auto'}" title="按背景自动选深 / 浅">自动</button>${INKS.map(c => `<button type="button" data-act="ink" data-v="${c}" style="background:${c}" aria-label="${c}" aria-pressed="${s.ink === c}"></button>`).join('')}<label title="自定义颜色"><input type="color" data-act="inkPick" value="${/^#/.test(s.ink) ? s.ink : '#16202e'}" aria-label="自定义文字颜色"></label></div>`)}`
        + range('inkAlpha', '透明度', s.inkAlpha, 10, 100, '%') + '</div>' : ''];
    case EXPORT: {
      const { width, height } = exportSize(aspectNow(), s.x);
      return [ctl('格式', seg('fmt', [['png', 'PNG'], ['jpg', 'JPG']], s.fmt)), ctl('倍率', seg('x', [['1', '1x'], ['2', '2x']], s.x)),
        ctl('尺寸', `<span class="readout">${width} × ${height} px</span>`),
        ctl('&nbsp;', '<div class="row"><button type="button" class="pill" data-act="copy">复制到剪贴板</button><button type="button" class="pill primary" data-act="download">下载</button></div>')];
    }
  }
}

function paintDock() {
  $('dock').innerHTML = `<button type="button" class="nav back" data-act="${step ? 'prev' : 'swap'}">${step ? '‹ 上一步' : '换一张'}</button>`
    + `<div class="ctls">${controls().join('')}</div>`
    + (step < EXPORT ? '<button type="button" class="nav primary" data-act="next">下一步 ›</button>' : '');
  if (step === COMPOSE) paintTemplates();
}

$('dock').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const act = b.dataset.act, v = b.dataset.v;
  switch (act) {
    case 'next': return go(step + 1);
    case 'prev': return go(step - 1);
    case 'swap': return $('swap').click();
    case 'cropRatio': s.cropRatio = v; crop = fitRatioBox(source.width, source.height, cropRatioValue()); break;
    case 'resetCrop': s.cropRatio = 'free'; crop = fitRatioBox(source.width, source.height, null); break;
    case 'trim': trim(); break;
    case 'clearFrame': rheoFrame = null; break;
    case 'rndColor': rheoFrame = null; s.rheo = randomizePalette(randomSeed(), s.rheo).state; break;
    case 'rndStyle': rheoFrame = null; s.rheo = { ...generate(randomSeed(), { ...s.rheo, lockColors: true, lockMode: false }), lockColors: s.rheo.lockColors, lockMode: s.rheo.lockMode, particles: false }; break;
    case 'importStyle': return importStyle();
    case 'solid': s.solid = v; break;
    case 'tpl': if (s.tpl !== +v) { s.pos = ZERO_POS(); select(null); } s.tpl = +v; break;   // 换排版：各元素回到这套排版的默认位置
    case 'x': s.x = +v; break;
    case 'copy': return copyImage(b);
    case 'download': return download(b);
    default: if (v !== undefined) s[act] = v;
  }
  saveSettings();
  render();
});

$('dock').addEventListener('input', (e) => {
  const el = e.target, act = el.dataset.act;
  if (!act) return;
  if (el.type === 'range') {
    s[act] = +el.value;
    const out = $('dock').querySelector(`[data-out="${act}"]`);
    if (out) out.textContent = el.value + (['rheoSize', 'imageSize', 'frameSize', 'inkAlpha'].includes(act) ? '%' : '');
    saveSettings();
    if (step === 0) layoutCrop(); else schedulePreview();   // 拖滑块不重建面板，否则拖不动
    if (act === 'frameThick' || act === 'shadow') scheduleTemplates();
    return;
  }
  if (act === 'inkPick') { s.ink = el.value; saveSettings(); schedulePreview(); scheduleTemplates(); return; }
  if (act === 'solidPick') { s.solid = el.value; saveSettings(); schedulePreview(); }
});
// 双击滑块回到默认值
$('dock').addEventListener('dblclick', (e) => {
  const el = e.target.closest('input[type=range][data-act]');
  if (!el || DEFAULTS[el.dataset.act] === undefined) return;
  el.value = DEFAULTS[el.dataset.act]; el.dispatchEvent(new Event('input', { bubbles: true }));
});
$('dock').addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.act === 'solidPick' || el.dataset.act === 'inkPick') render();
  if (el.dataset.act === 'ratio') { s.ratio = el.value; saveSettings(); render(); }
  if (el.dataset.act === 'bgFile' && el.files[0]) {
    try {
      bgImage = await loadImage(URL.createObjectURL(el.files[0])); bgImageId++; s.src = 'image';
    } catch { toast('这张图读不出来'); }
    render();
  }
});

const randomSeed = () => Math.random().toString(36).slice(2, 10);

/* ── 裁切 ───────────────────────────────────────────────────────────
   原图按舞台大小等比缩放显示，裁切框用原图像素记，显示时换算。 */
let view = { k: 1, w: 0, h: 0 };
function layoutCrop() {
  const stage = $('crop'), sr = stage.getBoundingClientRect();
  const k = Math.min((sr.width - 24) / source.width, (sr.height - 24) / source.height, 1.5);
  view = { k, w: Math.round(source.width * k), h: Math.round(source.height * k) };
  const frame = $('crop-frame');
  frame.style.width = view.w + 'px'; frame.style.height = view.h + 'px';
  paintCropBox();
}
function paintCropBox() {
  const { k } = view, box = $('crop-box'), shade = $('crop-shade');
  const r = Math.min(crop.w * k, crop.h * k) / 2, rad = Math.min(r, (s.radius / 400) * crop.w * k);
  for (const el of [box, shade]) Object.assign(el.style, { left: crop.x * k + 'px', top: crop.y * k + 'px', width: crop.w * k + 'px', height: crop.h * k + 'px' });
  shade.style.setProperty('--r', rad + 'px');
  $('crop-dims').textContent = `${source.width} × ${source.height}  →  ${crop.w} × ${crop.h}`;
}
let dragging = null;
$('crop-box').addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('[data-h]')?.dataset.h;
  if (!handle) return;
  e.preventDefault();
  $('crop-box').setPointerCapture(e.pointerId);
  dragging = { handle, x: e.clientX, y: e.clientY, start: { ...crop } };
});
$('crop-box').addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = (e.clientX - dragging.x) / view.k, dy = (e.clientY - dragging.y) / view.k;
  crop = dragBox(dragging.start, dragging.handle, dx, dy, source.width, source.height, cropRatioValue());
  shotCache = null;
  paintCropBox();
});
const endDrag = () => { dragging = null; };
$('crop-box').addEventListener('pointerup', endDrag);
$('crop-box').addEventListener('pointercancel', endDrag);

/* 自动去白边：在最长 1200 的缩小图上找边界再换算回原图，往外放 1px 免得切到内容。 */
function trim() {
  const k = Math.min(1, 1200 / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * k)), h = Math.max(1, Math.round(source.height * k));
  const c = makeCanvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source.img, 0, 0, w, h);
  const b = trimBounds(ctx.getImageData(0, 0, w, h).data, w, h);
  if (b.w === w && b.h === h) { toast('没有找到可以去掉的白边'); return; }
  const x = Math.max(0, Math.floor(b.x / k) - 1), y = Math.max(0, Math.floor(b.y / k) - 1);
  crop = { x, y, w: Math.min(source.width - x, Math.ceil(b.w / k) + 2), h: Math.min(source.height - y, Math.ceil(b.h / k) + 2) };
  s.cropRatio = 'free';
  shotCache = null;
  toast('已去掉四周的空白');
}

/* ── 预览：画布按画幅比例塞进舞台，按设备像素比绘制 ─────────────── */
let previewQueued = false, previewLift = 0;
function schedulePreview() {
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => { previewQueued = false; paintPreview(); });
}
function paintPreview() {
  if (!source || step === 0) return;
  const stage = $('stage'), st = stage.getBoundingClientRect(), a = aspectNow();
  // 构图这一步画布下方留一行给操作提示
  const room = step === COMPOSE ? 30 : 0;
  let w = st.width, h = w / a;
  if (h > st.height - room) { h = st.height - room; w = h * a; }
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const cv = $('preview');
  cv.style.width = Math.round(w) + 'px'; cv.style.height = Math.round(h) + 'px';
  cv.style.translate = room ? `0 ${-room / 2}px` : '';
  previewLift = room / 2;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const out = renderScene(cv.getContext('2d'), cv.width, cv.height, scene(), shot());
  paintLayer(out, cv.width / w);
}

/* ── 构图：在画面上直接点选、拖动、调大小、改字 ───────────────────────
   画布上叠一层透明的「对象」：截图、标题、副标题。
   点一下选中（描边 + 框外浮出一个大小滑块），拖动移动，靠近中轴 / 四边 / 其他元素的边和中线时吸住并显示参考线
   （按住 Option / Alt 暂时不吸）；再点一次或双击文字进入原位编辑。方向键逐像素挪，Shift + 方向键一次 10 像素。 */
let lastRegions = [], lastShot = null, lastK = 1, lastInk = '#16202e', editOriginal = '';
let selected = null;         // 'shot' | 'title' | 'sub' | null
let drag = null;
let popHeld = false;         // 正在拖浮层里的滑块：浮层先不跟着框挪，免得滑块从手底下跑开
const OBJS = ['shot', 'title', 'sub'];
const SIZE = { shot: ['scale', '大小', SCALE_MIN, SCALE_MAX], title: ['titleSize', '字号', 40, 250], sub: ['subSize', '字号', 40, 250] };
const HIT_LABEL = { shot: '截图：拖动移动，点击调整大小', title: '标题：拖动移动，双击修改文字', sub: '副标题：拖动移动，双击修改文字' };
const hits = Object.fromEntries(OBJS.map(o => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'obj' + (o === 'shot' ? ' is-shot' : ''); b.dataset.obj = o; b.hidden = true;
  b.setAttribute('aria-label', t(HIT_LABEL[o]));
  $('text-hits').append(b);
  return [o, b];
}));
const boxOf = (o) => o === 'shot' ? lastShot : lastRegions.find(r => r.field === o) || null;
const css = (v) => (v / lastK) + 'px';
// 文字的点击区比字本身宽一圈，好点；截图就是截图本身
const padOf = (o) => { const r = boxOf(o); return o === 'shot' || !r ? [0, 0] : [r.size * .15, r.size * .1]; };

function paintLayer(out, k) {
  lastRegions = out.regions; lastShot = out.shot; lastK = k; lastInk = out.ink;
  const layer = $('text-layer'), cv = $('preview');
  const on = step === COMPOSE;
  layer.hidden = $('compose-hint').hidden = !on;
  if (!on) { if (editing) endEdit(true); return; }
  Object.assign(layer.style, { left: cv.offsetLeft + 'px', top: (cv.offsetTop - previewLift) + 'px', width: cv.style.width, height: cv.style.height });
  for (const o of OBJS) {
    const r = boxOf(o), el = hits[o];
    el.hidden = !r || (o !== 'shot' && !s.tpl);
    if (el.hidden) continue;
    const [px, py] = padOf(o);
    Object.assign(el.style, { left: css(r.x - px), top: css(r.y - py), width: css(r.w + px * 2), height: css(r.h + py * 2) });
  }
  if (selected && hits[selected].hidden) select(null);
  paintSelection();
  if (editing) placeEditor();
}

function select(o) {
  if (selected === o) return;
  selected = o;
  for (const x of OBJS) hits[x].classList.toggle('is-selected', x === o);
  if (o) fillPop();
  paintSelection();
}
function fillPop() {
  const [key, label, min, max] = SIZE[selected], r = $('pop-range');
  $('pop-label').textContent = t(label);
  r.min = min; r.max = max; r.value = s[key];
  $('pop-out').textContent = s[key] + '%';
}
function paintSelection() {
  const r = selected && boxOf(selected);
  const sel = $('sel'), pop = $('pop');
  sel.hidden = !r || !!editing;
  pop.hidden = !r || !!editing || !!drag?.moved;
  if (!r) return;
  const [px, py] = padOf(selected);
  Object.assign(sel.style, { left: css(r.x - px), top: css(r.y - py), width: css(r.w + px * 2), height: css(r.h + py * 2) });
  if (!pop.hidden && !popHeld) placePop(r);
}
/* 浮层放在选中框外面，按「上 → 右 → 左 → 下」找第一个放得下的位置（下方最后，因为标题下面往往就是副标题）；
   都放不下就贴在框内顶部。坐标都夹在舞台里。 */
function placePop(r) {
  const pop = $('pop'), cv = $('preview'), stage = $('stage'), layer = $('text-layer');
  const ox = layer.offsetLeft, oy = layer.offsetTop, pw = pop.offsetWidth, ph = pop.offsetHeight;
  const cw = parseFloat(cv.style.width), ch = parseFloat(cv.style.height);
  // 只看框在画布里可见的那部分（截图可以溢出画布）
  const x0 = Math.max(0, r.x / lastK), y0 = Math.max(0, r.y / lastK), x1 = Math.min(cw, (r.x + r.w) / lastK), y1 = Math.min(ch, (r.y + r.h) / lastK);
  const [px, py] = padOf(selected), gy = 10 + py / lastK, gx = 10 + px / lastK;
  const minX = -ox + 6, maxX = stage.clientWidth - ox - pw - 6, minY = -oy + 6, maxY = stage.clientHeight - oy - ph - 6;
  const cx = clamp((x0 + x1) / 2 - pw / 2, minX, maxX), cy = clamp((y0 + y1) / 2 - ph / 2, minY, maxY);
  const spots = [[cx, y0 - ph - gy], [x1 + gx, cy], [x0 - gx - pw, cy], [cx, y1 + gy]];
  const [left, top] = spots.find(([l, t]) => l >= minX && l <= maxX && t >= minY && t <= maxY) || [cx, clamp(y0 + 8, minY, maxY)];
  Object.assign(pop.style, { left: left + 'px', top: top + 'px' });
}
function showGuides(g) {
  $('guides').innerHTML = (g?.x != null ? `<i class="gx" style="left:${css(g.x)}"></i>` : '') + (g?.y != null ? `<i class="gy" style="top:${css(g.y)}"></i>` : '');
}

$('text-hits').addEventListener('pointerdown', (e) => {
  const hit = e.target.closest('.obj');
  if (!hit || e.button > 0) return;
  e.preventDefault();
  const obj = hit.dataset.obj;
  if (editing) endEdit(true);
  const was = selected === obj;
  select(obj);
  hit.focus({ preventScroll: true });
  try { hit.setPointerCapture(e.pointerId); } catch {}
  drag = { obj, x: e.clientX, y: e.clientY, start: [...s.pos[obj]], box: { ...boxOf(obj) }, moved: false, was };
});
$('text-hits').addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3) return;
  if (!drag.moved) { drag.moved = true; $('text-layer').classList.add('dragging'); paintSelection(); }
  const cv = $('preview'), W = cv.width, H = cv.height;
  let dx = (e.clientX - drag.x) * lastK, dy = (e.clientY - drag.y) * lastK;
  // 杂志大字的标题跟着截图走：拖截图时不拿它当对齐目标，否则会自己追着自己吸
  const others = OBJS.filter(o => o !== drag.obj && !hits[o].hidden && !(drag.obj === 'shot' && o === 'title' && TEMPLATES[s.tpl]?.behind)).map(boxOf).filter(Boolean);
  const snap = e.altKey ? { dx: 0, dy: 0, guides: null } : snapBox({ ...drag.box, x: drag.box.x + dx, y: drag.box.y + dy }, W, H, others, 6 * lastK);
  dx += snap.dx; dy += snap.dy;
  // 中心不许离开画布：拖不丢
  const cx = drag.box.x + drag.box.w / 2 + dx, cy = drag.box.y + drag.box.h / 2 + dy;
  dx += clamp(cx, 0, W) - cx; dy += clamp(cy, 0, H) - cy;
  s.pos[drag.obj] = [drag.start[0] + dx / W, drag.start[1] + dy / H];
  showGuides(snap.guides);
  schedulePreview();
});
const endObjDrag = () => {
  if (!drag) return;
  const d = drag; drag = null;
  $('text-layer').classList.remove('dragging');
  showGuides(null);
  if (d.moved) saveSettings();
  else if (d.was && d.obj !== 'shot') { startEdit(d.obj); return; }
  paintSelection();
};
$('text-hits').addEventListener('pointerup', endObjDrag);
$('text-hits').addEventListener('pointercancel', endObjDrag);
$('text-hits').addEventListener('dblclick', (e) => { const hit = e.target.closest('.obj'); if (hit && hit.dataset.obj !== 'shot') startEdit(hit.dataset.obj); });
$('text-hits').addEventListener('focusin', (e) => { const hit = e.target.closest('.obj'); if (hit && !drag) select(hit.dataset.obj); });
$('text-hits').addEventListener('keydown', (e) => {
  const hit = e.target.closest('.obj');
  if (!hit) return;
  const obj = hit.dataset.obj, step1 = e.shiftKey ? 10 : 1;
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (d) {
    e.preventDefault();
    const cv = $('preview');
    s.pos[obj] = [s.pos[obj][0] + d[0] * step1 * lastK / cv.width, s.pos[obj][1] + d[1] * step1 * lastK / cv.height];
    saveSettings(); schedulePreview();
  } else if (e.key === 'Enter' && obj !== 'shot') { e.preventDefault(); startEdit(obj); }
  else if (e.key === 'Escape') { e.preventDefault(); hit.blur(); select(null); }
});
// 点画面空白处（或舞台外的空白）取消选中
$('stage').addEventListener('pointerdown', (e) => {
  if (step !== COMPOSE || e.target.closest('.obj, #pop, #text-editor')) return;
  if (editing) endEdit(true);
  select(null);
});

/* 大小浮层 */
$('pop-range').addEventListener('pointerdown', () => { popHeld = true; });
addEventListener('pointerup', () => { if (popHeld) { popHeld = false; saveSettings(); paintSelection(); scheduleTemplates(); } });
$('pop-range').addEventListener('input', (e) => {
  const [key] = SIZE[selected];
  s[key] = +e.target.value;
  $('pop-out').textContent = s[key] + '%';
  schedulePreview();
  if (!popHeld) saveSettings();          // 键盘调节：没有 pointerup，直接存
});
$('pop-range').addEventListener('dblclick', () => { const [key] = SIZE[selected]; s[key] = DEFAULTS[key]; fillPop(); saveSettings(); schedulePreview(); });
$('pop-reset').addEventListener('click', () => {
  const [key] = SIZE[selected];
  s.pos[selected] = [0, 0]; s[key] = DEFAULTS[key];
  fillPop(); saveSettings(); schedulePreview();
});

/* 原位编辑文字：编辑框贴着文字本身，宽度随输入伸缩（最多到这段文字的换行宽度），
   居中的往两边长，右对齐的往左长。编辑期间画布不画这一段，由编辑框原地显示。回车 / 点别处确认，Esc 放弃。 */
const measureCtx = document.createElement('canvas').getContext('2d');
function placeEditor() {
  const r = lastRegions.find(x => x.field === editing), ed = $('text-editor');
  if (!r) return;
  const k = lastK, size = r.size / k, font = r.font.replace(/[\d.]+px/, size + 'px');
  const maxW = r.edit.w / k, x0 = r.edit.x / k;
  measureCtx.font = font;
  const widest = Math.max(0, ...ed.value.split('\n').map(line => measureCtx.measureText(line).width));
  const width = Math.min(maxW, Math.max(widest + size * .6, size * 2));
  const left = r.align === 'center' ? x0 + (maxW - width) / 2 : r.align === 'right' ? x0 + maxW - width : x0;
  Object.assign(ed.style, {
    left: left + 'px', top: (r.edit.y / k) + 'px', width: width + 'px',
    font, lineHeight: String(r.lh), textAlign: r.align,
    color: lastInk, opacity: String(r.alpha * s.inkAlpha / 100),
  });
  ed.style.height = 'auto'; ed.style.height = ed.scrollHeight + 'px';
}
function startEdit(field) {
  if (editing === field) return;
  if (editing) endEdit(true);
  editing = field; editOriginal = s[field];
  const ed = $('text-editor');
  ed.value = s[field]; ed.hidden = false;
  ed.setAttribute('aria-label', field === 'title' ? '标题' : '副标题');
  paintSelection();
  placeEditor(); ed.focus(); ed.select();
  schedulePreview();
}
function endEdit(commit) {
  if (!editing) return;
  if (!commit) s[editing] = editOriginal;
  s[editing] = s[editing].replace(/\s*\n\s*/g, ' ');
  editing = null;
  $('text-editor').hidden = true;
  saveSettings(); schedulePreview(); scheduleTemplates();
}
$('text-editor').addEventListener('input', (e) => { s[editing] = e.target.value; placeEditor(); schedulePreview(); });
$('text-editor').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); endEdit(true); }
  else if (e.key === 'Escape') { e.preventDefault(); endEdit(false); }
});
$('text-editor').addEventListener('blur', () => endEdit(true));

/* 文字模板缩略图：用当前的背景和截图各画一张小图 */
let tplQueued = false;
function scheduleTemplates() { if (tplQueued) return; tplQueued = true; setTimeout(() => { tplQueued = false; paintTemplates(); }, 180); }
function paintTemplates() {
  const a = aspectNow();
  const tw = a >= 4 / 3 ? 120 : Math.round(90 * a), th = Math.round(tw / a);
  $('dock').querySelectorAll('#tpls canvas').forEach((cv, i) => {
    cv.width = tw; cv.height = th;
    renderScene(cv.getContext('2d'), tw, th, { ...scene(), tpl: i, pos: ZERO_POS(), titleSize: 100, subSize: 100, interactive: false, hide: null }, shot());
  });
}

/* ── 导入 Rheo 画面 ─────────────────────────────────────────────────
   Rheo 页「复制到 Relief」放进剪贴板的是当前那一帧 PNG（分辨率同 Rheo 的「保存图片」）。
   这里先直接读剪贴板；浏览器不给读（Firefox、未授权）就开弹窗，按 ⌘V 粘贴或选文件。
   剪贴板里要是旧版复制的参数 JSON，也照样认，按参数重新生成。 */
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
      if (item.types.includes('text/plain')) {
        try { return useStyleText(await (await item.getType('text/plain')).text()); } catch {}
      }
    }
  } catch {}
  $('import-error').textContent = '';
  $('import-dialog').showModal();
  $('import-paste').focus();
}
async function takeImportFile(file) {
  if (!isImage(file)) { $('import-error').textContent = '剪贴板里没有图片：请先在 Rheo 页点「复制到 Relief」'; return; }
  try { await useFrame(file); $('import-dialog').close(); }
  catch { $('import-error').textContent = '这张图读不出来'; }
}
$('import-file').onchange = (e) => { if (e.target.files[0]) takeImportFile(e.target.files[0]); e.target.value = ''; };
const importOpen = () => $('import-dialog').open;

/* ── 导出 ───────────────────────────────────────────────────────── */
function exportBlob(type) {
  const { width, height } = exportSize(aspectNow(), s.x);
  const cv = makeCanvas(width, height), ctx = cv.getContext('2d');
  // JPG 没有透明通道：背景缩小露白的地方垫白色，否则会变成黑色
  if (type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); }
  renderScene(ctx, width, height, { ...scene(), interactive: false, hide: null }, shot());   // 导出不带光标占位，也不隐藏任何字段
  return new Promise((resolve, reject) => cv.toBlob(b => (b ? resolve(b) : reject(Error('导出失败'))), type, 0.92));
}
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };

async function download(btn) {
  btn.disabled = true;
  try {
    const type = s.fmt === 'jpg' ? 'image/jpeg' : 'image/png';
    const blob = await exportBlob(type);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `relief-${stamp()}.${s.fmt}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`已导出 ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
  } catch (e) { toast(e.message || '导出失败'); }
  finally { btn.disabled = false; }
}

/* 剪贴板只收 PNG；ClipboardItem 直接给 Promise，Safari 要求在点击的同一拍里调用 write。 */
async function copyImage(btn) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') { toast('当前浏览器不支持复制图片，请用下载'); return; }
  btn.disabled = true;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': exportBlob('image/png') })]);
    toast('已复制，可以直接粘贴到 Figma / 聊天里');
  } catch (e) { toast(e && e.name === 'NotAllowedError' ? '浏览器没有给剪贴板权限，请用下载' : '复制失败，请用下载'); }
  finally { btn.disabled = false; }
}

/* ── 进图：点选、整页拖入、粘贴 ─────────────────────────────────── */
for (const input of [$('pick'), $('swap')]) input.onchange = (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; };
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('veil').hidden = false; });
addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('veil').hidden = true; } });
addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $('veil').hidden = true;
  const f = [...e.dataTransfer.files].find(isImage);
  if (f) loadFile(f); else toast('这不是图片');
});
addEventListener('paste', (e) => {
  if (importOpen()) {                                         // 导入弹窗开着：粘贴的是 Rheo 画面（或旧版参数），不是截图
    e.preventDefault();
    const f = [...(e.clipboardData?.files || [])].find(isImage);
    if (f) { takeImportFile(f); return; }
    const text = e.clipboardData?.getData('text/plain');
    try { useStyleText(text); $('import-dialog').close(); } catch { $('import-error').textContent = '剪贴板里没有图片：请先在 Rheo 页点「复制到 Relief」'; }
    return;
  }
  if (e.target.closest?.('input,textarea')) return;          // 在输入框里粘贴文字不拦
  const f = [...(e.clipboardData?.files || [])].find(isImage);
  if (f) { e.preventDefault(); loadFile(f); }
});

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* 窗口大小变了：重新排裁切框 / 重画预览 */
new ResizeObserver(() => { if (!source) return; if (step === 0) layoutCrop(); else schedulePreview(); }).observe($('stage'));

/* 字体没加载完就画，canvas 会用后备字体 —— 先等 Plex 就绪（失败也不阻塞） */
document.fonts?.load('600 20px "IBM Plex Sans"').then(() => { clearCache(); if (source && step) schedulePreview(); }).catch(() => {});
render();
