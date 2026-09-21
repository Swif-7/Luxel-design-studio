// Recast 页面：拖入 / 选择 / 粘贴图片 → 按控制条设置在本地编码 → 单张对比或批量网格 → 下载。
import { FORMATS, FORMAT_ORDER, formatOfMime, resolveFormat, formatBytes, savings, preferOriginal, outputName, makeZip } from './recast-core.js';
import { encodeImage, probeEncoders, canUseWorkers } from './recast-encode.js';

const $ = (id) => document.getElementById(id);

/* ── 主题：与首页、Rheo、Rubric 共用 rheo-theme ─────────────────────── */
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

/* ── 设置 ─────────────────────────────────────────────────────────── */
const SETTINGS_KEY = 'recast-settings';
const DEFAULTS = { format: 'webp', quality: 78, maxEdge: 0, fill: '#ffffff', suffix: false };
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch {}
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} };

/* 浏览器实际能导出哪些格式要现场测：不支持的格式会被悄悄编成 PNG。 */
const supported = new Set();
const UNSUPPORTED_TIP = {
  webp: '当前浏览器不能导出 WEBP（Safari 只能读取、不能导出）',
  avif: '当前浏览器不能导出 AVIF —— 目前主流浏览器都只能读取、不能导出',
  jpeg: '当前浏览器不能导出 JPG', png: '当前浏览器不能导出 PNG',
};

/* ── 图片队列 ─────────────────────────────────────────────────────────
   item：{ id, file, url, status: queued|busy|done|error, gen, out, error }
   out：{ blob, size, mime, width, height, srcWidth, srcHeight, kept, url }
   每次改设置 gen 加一，旧一轮的结果回来时对不上 gen 就丢掉。 */
let items = [];
let nextId = 1;
let generation = 0;
let selectedId = null;       // 单张视图正在看的那张；批量里点缩略图进入
let focusSingle = false;     // 批量时是否停在单张对比视图

const isImage = (f) => f.type.startsWith('image/') || /\.(heic|heif|avif|jxl)$/i.test(f.name);

function addFiles(list) {
  const files = [...list].filter(isImage);
  if (!files.length) { if (list.length) toast('没有可以处理的图片'); return; }
  for (const file of files) {
    const item = { id: nextId++, file, url: URL.createObjectURL(file), status: 'queued', gen: generation };
    items.push(item);
    enqueue(item);
  }
  if (items.length === files.length) selectedId = items[0].id;   // 从空状态进来，停在第一张
  render();
}

function removeItem(id) {
  const i = items.findIndex(it => it.id === id);
  if (i < 0) return;
  const [it] = items.splice(i, 1);
  URL.revokeObjectURL(it.url);
  if (it.out?.url) URL.revokeObjectURL(it.out.url);
  gridNodes.get(id)?.remove();
  gridNodes.delete(id);
  if (selectedId === id) selectedId = items[Math.min(i, items.length - 1)]?.id ?? null;
  if (items.length <= 1) focusSingle = false;
  render();
}

function clearAll() {
  for (const it of items) { URL.revokeObjectURL(it.url); if (it.out?.url) URL.revokeObjectURL(it.out.url); }
  items = []; selectedId = null; focusSingle = false;
  gridNodes.forEach(n => n.remove()); gridNodes.clear();
  generation++; queue.length = 0;
  render();
}

/* ── 编码池 ───────────────────────────────────────────────────────────
   有 OffscreenCanvas 就开几个 worker 并行；没有就在主线程一张一张来。 */
const queue = [];
const poolSize = canUseWorkers ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)) : 1;
const lanes = [];
const pending = new Map();   // job id → item

function makeLane() {
  const lane = { busy: false, job: null };
  const runHere = async (job) => {
    let data;
    try { data = { id: job.id, ok: true, ...(await encodeImage(job.blob, job.options)) }; }
    catch (e) { data = { id: job.id, ok: false, error: String(e && e.message || e) }; }
    lane.busy = false; finish(data); pump();
  };
  lane.run = runHere;
  if (canUseWorkers) {
    try {
      const worker = new Worker(new URL('./recast-worker.js', import.meta.url), { type: 'module' });
      lane.run = (job) => { lane.job = job; worker.postMessage(job); };
      worker.onmessage = ({ data }) => { lane.job = null; lane.busy = false; finish(data); pump(); };
      // worker 起不来（旧浏览器不支持模块 worker 等）：这条道改回主线程，手上那张重做
      worker.onerror = (e) => {
        e.preventDefault?.();
        worker.terminate();
        lane.run = runHere;
        if (lane.job) { const job = lane.job; lane.job = null; runHere(job); } else { lane.busy = false; pump(); }
      };
    } catch {}
  }
  return lane;
}

function enqueue(item) {
  item.status = 'queued';
  item.gen = generation;
  queue.push(item);
  pump();
}

let jobSeq = 0;
function pump() {
  while (queue.length) {
    const lane = lanes.find(l => !l.busy);
    if (!lane) break;
    const item = queue.shift();
    if (!items.includes(item) || item.gen !== generation) continue;
    const key = resolveFormat(settings.format, item.file.type, supported) || 'png';
    const fmt = FORMATS[key];
    const id = ++jobSeq;
    pending.set(id, { item, gen: generation, key });
    item.status = 'busy';
    lane.busy = true;
    lane.run({ id, blob: item.file, options: {
      mime: fmt.mime, quality: fmt.lossy ? settings.quality / 100 : undefined,
      maxEdge: Number(settings.maxEdge) || 0, fill: settings.fill } });
    paintItem(item);
  }
  paintSummary();
}

function finish(data) {
  const job = pending.get(data.id);
  pending.delete(data.id);
  if (!job) return;
  const { item, gen, key } = job;
  if (!items.includes(item) || gen !== item.gen) return;     // 设置已经变了，这一轮作废
  if (!data.ok) {
    item.status = 'error';
    const heic = /\.(heic|heif)$/i.test(item.file.name) || /hei[cf]/i.test(item.file.type);
    item.error = heic ? '当前浏览器读不了 HEIC（Safari 可以）' : data.error === 'unsupported-format' ? '当前浏览器不能导出这个格式' : '这张图读取或编码失败';
  } else {
    if (item.out?.url) URL.revokeObjectURL(item.out.url);
    const resized = data.width !== data.srcWidth || data.height !== data.srcHeight;
    const sameFormat = formatOfMime(item.file.type) === key;
    const kept = preferOriginal({ originalSize: item.file.size, encodedSize: data.blob.size, sameFormat, resized });
    item.out = { blob: kept ? item.file : data.blob, size: kept ? item.file.size : data.blob.size, key, kept,
      width: kept ? data.srcWidth : data.width, height: kept ? data.srcHeight : data.height,
      srcWidth: data.srcWidth, srcHeight: data.srcHeight, url: null };
    item.status = 'done';
    item.error = null;
  }
  paintItem(item);
  paintSummary();
  if (item.id === selectedId) paintSingle();
}

/* 设置一变，全部重新编码。滑块拖动时会连发，等停手 250ms 再开始。 */
let rerunTimer;
function rerunAll(delay = 0) {
  clearTimeout(rerunTimer);
  rerunTimer = setTimeout(() => {
    generation++;
    queue.length = 0;
    for (const it of items) enqueue(it);
    render();
  }, delay);
}

/* ── 视图 ────────────────────────────────────────────────────────── */
const view = () => (!items.length ? 'empty' : items.length === 1 || focusSingle ? 'single' : 'batch');
const selected = () => items.find(it => it.id === selectedId) || items[0];

function render() {
  const v = view();
  $('drop').hidden = v !== 'empty';
  $('single').hidden = v !== 'single';
  $('batch').hidden = v !== 'batch';
  $('add-wrap').hidden = $('clear').hidden = v === 'empty';
  if (v === 'batch') paintGrid();
  if (v === 'single') paintSingle();
  paintSummary();
}

/* 网格按 id 复用节点：重编码时只改角标和文字，缩略图 <img> 不重建，不会闪。 */
const gridNodes = new Map();
let addTile;
function paintGrid() {
  const grid = $('grid');
  for (const it of items) {
    let node = gridNodes.get(it.id);
    if (!node) {
      node = document.createElement('div');
      node.className = 'th';
      node.innerHTML = `<img alt="" loading="lazy" decoding="async"><button class="open" type="button"></button>`
        + `<span class="pct" hidden></span><span class="st"></span><span class="meta"></span>`
        + `<button class="rm" type="button" aria-label="移除">×</button>`;
      node.querySelector('img').src = it.url;
      node.querySelector('.open').onclick = () => { selectedId = it.id; focusSingle = true; render(); };
      node.querySelector('.rm').onclick = () => removeItem(it.id);
      gridNodes.set(it.id, node);
    }
    grid.appendChild(node);     // appendChild 会按 items 顺序把已有节点挪到位
    paintItem(it);
  }
  if (!addTile) {
    addTile = document.createElement('label');
    addTile.className = 'th add';
    addTile.innerHTML = '＋ 继续添加<input type="file" accept="image/*,.heic,.heif" multiple>';
    addTile.querySelector('input').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  }
  grid.appendChild(addTile);
}

function paintItem(it) {
  const node = gridNodes.get(it.id);
  if (!node) return;
  const st = node.querySelector('.st'), pct = node.querySelector('.pct'), meta = node.querySelector('.meta');
  st.className = 'st ' + it.status;
  node.querySelector('.open').setAttribute('aria-label', `${it.file.name}，查看对比`);
  node.title = it.error ? `${it.file.name} · ${it.error}` : it.file.name;
  if (it.status === 'done') {
    const p = savings(it.file.size, it.out.size);
    pct.hidden = false;
    pct.className = 'pct' + (it.out.kept ? ' kept' : p < 0 ? ' bad' : '');
    pct.textContent = it.out.kept ? '原图' : p < 0 ? `+${-p}%` : `−${p}%`;
    meta.textContent = `${formatBytes(it.file.size)} → ${formatBytes(it.out.size)}`;
  } else {
    pct.hidden = true;
    meta.textContent = it.status === 'error' ? it.error : formatBytes(it.file.size);
  }
}

function paintSingle() {
  const it = selected();
  if (!it) return;
  selectedId = it.id;
  const many = items.length > 1;
  $('back').hidden = $('prev').hidden = $('next').hidden = !many;
  $('back').textContent = `← 全部 ${items.length} 张`;
  $('single-name').textContent = it.file.name;
  if ($('before').dataset.id !== String(it.id)) { $('before').src = it.url; $('before').dataset.id = it.id; }
  const cmp = $('compare');
  const tagB = $('tag-before'), tagA = $('tag-after');
  tagB.textContent = `原图 · ${formatBytes(it.file.size)}`;
  if (it.status === 'done') {
    if (!it.out.url) it.out.url = URL.createObjectURL(it.out.blob);
    if ($('after').src !== it.out.url) $('after').src = it.out.url;
    const p = savings(it.file.size, it.out.size);
    tagA.textContent = it.out.kept ? '保留原图 · 已是最小' : `${FORMATS[it.out.key].label} · ${formatBytes(it.out.size)} · ${p < 0 ? '+' + -p : '−' + p}%`;
    tagA.className = 'tag r' + (p < 0 && !it.out.kept ? ' bad' : '');
    tagA.hidden = false;
    $('single-meta').textContent = it.out.width === it.out.srcWidth
      ? `${it.out.srcWidth} × ${it.out.srcHeight}`
      : `${it.out.srcWidth} × ${it.out.srcHeight} → ${it.out.width} × ${it.out.height}`;
    cmp.classList.remove('busy');
  } else {
    tagA.hidden = true;
    cmp.classList.toggle('busy', it.status !== 'error');
    $('single-meta').textContent = it.status === 'error' ? it.error : '';
    if (it.status === 'error') $('after').removeAttribute('src');
  }
}

function paintSummary() {
  const done = items.filter(it => it.status === 'done');
  const working = items.filter(it => it.status === 'queued' || it.status === 'busy').length;
  const before = done.reduce((s, it) => s + it.file.size, 0), after = done.reduce((s, it) => s + it.out.size, 0);
  const p = savings(before, after);
  const errors = items.length - done.length - working;
  $('totals').innerHTML = !items.length ? '' :
    `${items.length} 张 · ${formatBytes(before)} → <b>${formatBytes(after)}</b> <span class="${p >= 0 ? 'good' : ''}">${p >= 0 ? '−' + p : '+' + -p}%</span>`
    + (working ? ` · 处理中 ${working}` : '') + (errors ? ` · 失败 ${errors}` : '');
  const dl = $('download');
  const many = view() === 'batch';
  dl.disabled = !done.length || working > 0;
  dl.textContent = working ? `处理中 ${items.length - working}/${items.length}` : many ? '全部下载 .zip' : '下载';
}

/* ── 控制条 ──────────────────────────────────────────────────────── */
function paintControls() {
  const seg = $('formats');
  seg.innerHTML = '';
  for (const key of ['keep', ...FORMAT_ORDER]) {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.format = key;
    b.textContent = key === 'keep' ? '原格式' : FORMATS[key].label;
    const ok = key === 'keep' || supported.has(key);
    b.disabled = !ok;
    if (!ok) b.title = UNSUPPORTED_TIP[key];
    b.setAttribute('aria-checked', String(settings.format === key));
    b.onclick = () => { settings.format = key; saveSettings(); paintControls(); rerunAll(); };
    seg.appendChild(b);
  }
  const lossless = settings.format === 'png';
  $('quality').disabled = lossless;
  $('quality').value = settings.quality;
  $('quality-val').textContent = lossless ? '无损' : settings.quality;
  $('max-edge').value = String(settings.maxEdge);
  $('suffix').checked = settings.suffix;
  for (const b of document.querySelectorAll('[data-fill]')) b.setAttribute('aria-checked', String(b.dataset.fill === settings.fill));
}

$('quality').oninput = (e) => {
  settings.quality = Number(e.target.value);
  $('quality-val').textContent = settings.quality;
  saveSettings(); rerunAll(250);
};
$('max-edge').onchange = (e) => { settings.maxEdge = Number(e.target.value); saveSettings(); rerunAll(); };
$('suffix').onchange = (e) => { settings.suffix = e.target.checked; saveSettings(); };
for (const b of document.querySelectorAll('[data-fill]')) {
  b.onclick = () => { settings.fill = b.dataset.fill; saveSettings(); paintControls(); rerunAll(); };
}
$('more').onclick = () => {
  const open = $('more-panel').hidden;
  $('more-panel').hidden = !open;
  $('more').setAttribute('aria-expanded', String(open));
};
document.addEventListener('pointerdown', (e) => {
  if (!$('more-panel').hidden && !e.target.closest('.more-wrap')) { $('more-panel').hidden = true; $('more').setAttribute('aria-expanded', 'false'); }
});

/* ── 下载 ────────────────────────────────────────────────────────── */
function save(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const nameFor = (it, taken) => outputName(it.file.name, it.out.kept ? (it.file.name.split('.').pop() || FORMATS[it.out.key].ext) : FORMATS[it.out.key].ext,
  { suffix: settings.suffix ? '-min' : '', taken });

$('download').onclick = async () => {
  const done = items.filter(it => it.status === 'done');
  if (!done.length) return;
  if (view() !== 'batch') { const it = selected(); if (it.status === 'done') save(it.out.blob, nameFor(it)); return; }
  const dl = $('download');
  dl.disabled = true; dl.textContent = '打包中…';
  try {
    const taken = new Set();
    const files = [];
    for (const it of done) files.push({ name: nameFor(it, taken), data: new Uint8Array(await it.out.blob.arrayBuffer()) });
    const d = new Date(), p2 = (n) => String(n).padStart(2, '0');   // 本地时间，toISOString 是 UTC 会差一天
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
    save(new Blob([makeZip(files)], { type: 'application/zip' }), `recast-${stamp}.zip`);
    const skipped = items.length - done.length;
    toast(skipped ? `已打包 ${done.length} 张，${skipped} 张失败未包含` : `已打包 ${done.length} 张`);
  } catch {
    toast('打包失败，可能是图片太多太大，试试分批下载');
  } finally { paintSummary(); }
};

/* ── 单张视图的操作 ─────────────────────────────────────────────── */
$('split').oninput = (e) => $('compare').style.setProperty('--x', e.target.value + '%');
$('back').onclick = () => { focusSingle = false; render(); };
function step(dir) {
  if (items.length < 2) return;
  const i = items.findIndex(it => it.id === selectedId);
  selectedId = items[(i + dir + items.length) % items.length].id;
  paintSingle();
}
$('prev').onclick = () => step(-1);
$('next').onclick = () => step(1);
$('single-remove').onclick = () => removeItem(selectedId);
document.addEventListener('keydown', (e) => {
  if (view() !== 'single' || e.target.closest('input:not(#split),select,textarea')) return;
  if (e.key === 'ArrowLeft' && e.target.id !== 'split') { e.preventDefault(); step(-1); }
  else if (e.key === 'ArrowRight' && e.target.id !== 'split') { e.preventDefault(); step(1); }
  else if (e.key === 'Escape' && items.length > 1) { focusSingle = false; render(); }
});

/* ── 进图的三条路：点选、整页拖入、粘贴 ──────────────────────────── */
for (const input of [$('pick'), $('add')]) input.onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
$('clear').onclick = clearAll;

let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('veil').hidden = false; });
addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('veil').hidden = true; } });
addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $('veil').hidden = true;
  addFiles(e.dataTransfer.files);
});
addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addFiles(files); }
});

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ── 启动：先测编码能力，再画控制条、开编码池 ────────────────────── */
const probed = await probeEncoders(FORMAT_ORDER.map(k => FORMATS[k].mime));
for (const k of FORMAT_ORDER) if (probed.has(FORMATS[k].mime)) supported.add(k);
if (settings.format !== 'keep' && !supported.has(settings.format)) settings.format = supported.has('webp') ? 'webp' : 'jpeg';
for (let i = 0; i < poolSize; i++) lanes.push(makeLane());
paintControls();
render();
pump();   // 测编码能力的这一小会儿里如果已经拖进了图，现在开始处理
