// Relief 页面：放入截图 → ① 裁切 → ② 背景 → ③ 构图 → ④ 文字 → ⑤ 导出。
// 一次只显示一步的控件（底部面板），预览和导出共用 relief-render.js 的 renderScene。
import { RATIOS, RATIO_LABELS, canvasAspect, exportSize, frameAspect, TEMPLATES, fitRatioBox, dragBox, trimBounds, parseRheoStyle, clamp } from './relief-core.js';
import { renderScene, makeCanvas, clearCache } from './relief-render.js';
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
   设置（背景、构图、文字、导出）记在 localStorage，下次打开沿用；
   截图本身、裁切框和导入的背景图只在内存里。 */
const STEPS = ['裁切', '背景', '构图', '文字', '导出'];
const SOLIDS = ['#f1f3f5', '#ffffff', '#16202e', '#ffe066', '#a5d8ff', '#ffc9c9', '#b2f2bb'];
const INKS = ['#16202e', '#ffffff', '#3b5bdb', '#e8590c'];
const SETTINGS_KEY = 'relief-settings';
const DEFAULTS = {
  cropRatio: 'free', radius: 14,
  src: 'rheo', rheo: { ...defaults, particles: false }, solid: '#f1f3f5', blur: 0,
  rheoSize: 100, imageSize: 100, frameSize: 100,   // 背景大小：生成的 Rheo 30–200%；导入的图片 / Rheo 画面 30–300%（缩到 100% 以下时四周透明，预览显示棋盘格）
  frame: 'browser', shadow: 55, ratio: '4:3', scale: 74,
  tpl: 1, title: '点击修改文本', sub: '点击修改副标题', ink: 'auto', inkAlpha: 100, textShift: 0,
  fmt: 'png', x: 2,
};
let s = { ...DEFAULTS };
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  s = { ...DEFAULTS, ...saved, rheo: { ...DEFAULTS.rheo, ...(saved.rheo || {}) } };
  if (s.src === 'image') s.src = 'rheo';               // 导入的背景图不会保存
  // 旧版默认文案和「深 / 浅」颜色迁移到新版
  if (s.title === '让截图自己会说话') s.title = DEFAULTS.title;
  if (s.sub === '本地处理 · 一键复制 · 8 种排版') s.sub = DEFAULTS.sub;
  if (s.ink === 'black') s.ink = '#16202e'; else if (s.ink === 'white') s.ink = '#ffffff';
} catch {}
const saveSettings = () => {
  const { cropRatio, radius, src, rheo, solid, blur, rheoSize, imageSize, frameSize, frame, shadow, ratio, scale, tpl, title, sub, ink, inkAlpha, textShift, fmt, x } = s;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ cropRatio, radius, src, rheo, solid, blur, rheoSize, imageSize, frameSize, frame, shadow, ratio, scale, tpl, title, sub, ink, inkAlpha, textShift, fmt, x })); } catch {}
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
    frame: s.frame, radius: s.radius, shadow: s.shadow, scale: s.scale, tpl: step >= 3 ? s.tpl : 0,
    title: s.title, sub: s.sub, ink: s.ink, inkAlpha: s.inkAlpha, textShift: s.textShift,
    interactive: step === 3, hide: editing,
  };
};
const aspectNow = () => canvasAspect(s.ratio, frameAspect(s.frame, crop.w / crop.h));

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
function go(n) { if (editing) endEdit(true); step = clamp(n, 0, 4); render(); }

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
    case 2: return [
      ctl('外框', seg('frame', [['none', '无'], ['browser', '浏览器'], ['phone', '手机']], s.frame)),
      range('shadow', '阴影', s.shadow, 0, 100),
      ctl('画幅', seg('ratio', Object.keys(RATIOS).map(k => [k, RATIO_LABELS[k]]), s.ratio)),
      range('scale', '内容大小', s.scale, 30, 95, '%')];
    case 3: return [
      `<div class="ctl"><span class="lab">排版</span><div class="tpls" id="tpls">${TEMPLATES.map((t, i) => `<button type="button" data-act="tpl" data-v="${i}" aria-pressed="${i === s.tpl}" title="${t.name}"><canvas></canvas><span>${t.name}</span></button>`).join('')}</div></div>`,
      `<div class="col">`
      + ctl('文字颜色', `<div class="swatches"><button type="button" class="auto" data-act="ink" data-v="auto" aria-pressed="${s.ink === 'auto'}" title="按背景自动选深 / 浅">自动</button>${INKS.map(c => `<button type="button" data-act="ink" data-v="${c}" style="background:${c}" aria-label="${c}" aria-pressed="${s.ink === c}"></button>`).join('')}<label title="自定义颜色"><input type="color" data-act="inkPick" value="${/^#/.test(s.ink) ? s.ink : '#16202e'}" aria-label="自定义文字颜色"></label></div>`)
      + range('inkAlpha', '透明度', s.inkAlpha, 10, 100, '%')
      + (TEMPLATES[s.tpl].nudge ? range('textShift', TEMPLATES[s.tpl].nudge === 'y' ? '垂直位置' : '水平位置', s.textShift, -100, 100) : '')
      + `<p class="hint">${s.tpl ? '点击画面里的文字即可直接修改' : '选一种排版后，点击画面里的文字修改'}</p></div>`];
    case 4: {
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
    + (step < 4 ? '<button type="button" class="nav primary" data-act="next">下一步 ›</button>' : '');
  if (step === 3) paintTemplates();
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
    case 'tpl': if (s.tpl !== +v) s.textShift = 0; s.tpl = +v; break;   // 换排版时位置微调归零
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
    if (out) out.textContent = (act === 'textShift' && +el.value > 0 ? '+' : '') + el.value + (['scale', 'rheoSize', 'imageSize', 'frameSize', 'inkAlpha'].includes(act) ? '%' : '');
    saveSettings();
    if (step === 0) layoutCrop(); else schedulePreview();   // 拖滑块不重建面板，否则拖不动
    return;
  }
  if (act === 'inkPick') { s.ink = el.value; saveSettings(); schedulePreview(); scheduleTemplates(); return; }
  if (act === 'solidPick') { s.solid = el.value; saveSettings(); schedulePreview(); }
});
// 双击「位置」滑块回到默认位置
$('dock').addEventListener('dblclick', (e) => {
  const el = e.target.closest('input[data-act=textShift]');
  if (!el) return;
  el.value = 0; el.dispatchEvent(new Event('input', { bubbles: true }));
});
$('dock').addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.act === 'solidPick' || el.dataset.act === 'inkPick') render();
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
let previewQueued = false;
function schedulePreview() {
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => { previewQueued = false; paintPreview(); });
}
function paintPreview() {
  if (!source || step === 0) return;
  const st = $('stage').getBoundingClientRect(), a = aspectNow();
  let w = st.width, h = w / a;
  if (h > st.height) { h = st.height; w = h * a; }
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const cv = $('preview');
  cv.style.width = Math.round(w) + 'px'; cv.style.height = Math.round(h) + 'px';
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const out = renderScene(cv.getContext('2d'), cv.width, cv.height, scene(), shot());
  paintTextLayer(out, cv.width / w);
}

/* ── 在画面上直接改字 ───────────────────────────────────────────────
   预览画布上叠一层：每段文字一块透明点击区 + 末尾一根闪烁光标（提示「这里能点」）。
   点进去在原位打开编辑框，字体、字号、颜色、对齐都和画布一致；编辑期间画布不画这一段，
   由编辑框原地显示，看起来就是在图上打字。回车 / 点别处确认，Esc 放弃。 */
let lastRegions = [], lastK = 1, lastInk = '#16202e', editOriginal = '';
function paintTextLayer(out, k) {
  lastRegions = out.regions; lastK = k; lastInk = out.ink;
  const layer = $('text-layer'), cv = $('preview');
  const on = step === 3 && !!s.tpl;
  layer.hidden = !on;
  if (!on) { if (editing) endEdit(true); return; }
  Object.assign(layer.style, { left: cv.offsetLeft + 'px', top: cv.offsetTop + 'px', width: cv.style.width, height: cv.style.height });
  const px = (v) => (v / k) + 'px';
  $('text-hits').innerHTML = lastRegions.map(r => `<button type="button" class="txt-hit" data-field="${r.field}" aria-label="修改${r.field === 'title' ? '标题' : '副标题'}"
    style="left:${px(r.x - r.size * .15)};top:${px(r.y - r.size * .1)};width:${px(r.w + r.size * .3)};height:${px(r.h + r.size * .2)}"></button>`
    + (editing === r.field ? '' : `<i class="txt-caret" style="left:${px(r.caret.x + r.size * .06)};top:${px(r.caret.y)};height:${px(r.caret.h)};background:${out.ink}"></i>`)).join('');
  if (editing) placeEditor();
}
/* 编辑框贴着文字本身：宽度随输入伸缩（最多到这段文字的换行宽度），
   居中的往两边长，右对齐的往左长 —— 不再是一整条从左到右的长框，看起来才像「就在这段字上改」。 */
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
$('text-hits').addEventListener('click', (e) => { const b = e.target.closest('.txt-hit'); if (b) startEdit(b.dataset.field); });
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
    renderScene(cv.getContext('2d'), tw, th, { ...scene(), tpl: i, interactive: false, hide: null }, shot());
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
