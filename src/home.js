// 首页脚本：主题切换 ＋ 工具卡上的实时缩略图。
// 与 app.js 共用 rheo-theme 这个键，两页之间切换不会来回跳。
import { Renderer } from './shader.js';
import { defaults, hashSeed } from './model.js';

/* ── 主题 ───────────────────────────────────────────────────────────── */
const themeButton = document.getElementById('theme');
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function paintTheme() {
  const forced = document.documentElement.dataset.theme;
  const dark = forced ? forced === 'dark' : darkQuery.matches;
  themeButton.querySelector('svg').innerHTML = dark
    ? '<circle cx="12" cy="12" r="4.2"/><path d="M12 3.4v2.1M12 18.5v2.1M3.4 12h2.1M18.5 12h2.1M6 6l1.5 1.5M16.5 16.5 18 18M18 6l-1.5 1.5M7.5 16.5 6 18"/>'
    : '<path d="M20 13.6A8.2 8.2 0 0 1 10.4 4a8.6 8.6 0 1 0 9.6 9.6z"/>';
  themeButton.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色模式');
  document.querySelector('meta[name=theme-color]').content = dark ? '#0f0f0f' : '#ffffff';
}

themeButton.onclick = () => {
  const forced = document.documentElement.dataset.theme;
  const next = (forced ? forced === 'dark' : darkQuery.matches) ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('rheo-theme', next); } catch {}
  paintTheme();
};
darkQuery.addEventListener('change', () => { if (!document.documentElement.dataset.theme) paintTheme(); });
paintTheme();

/* ── 工具堆叠 ────────────────────────────────────────────────────────
   左栏是 PS 式工具条：点中谁，谁就到堆叠最前，其余按列表顺序循环叠在后方。
   深度用 (i - active + n) % n 算，所以未选中的始终保持相对次序，不会在
   切换时互相跳位。--d 交给 CSS 做位移、缩放、透明度和层级。 */
const buttons = [...document.querySelectorAll('.tool-btn')];
const cards = [...document.querySelectorAll('.tool-card')];
let active = 0;

function select(next) {
  active = next;
  buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === active)));
  cards.forEach((c, i) => {
    const depth = (i - active + cards.length) % cards.length;
    c.style.setProperty('--d', depth);
    c.dataset.front = String(depth === 0);
  });
  // 只有 Rheo 在最前时才跑着色器，卡片被压在后面没必要占 GPU
  if (renderer) running = cards[active] === rheoCard;
}

buttons.forEach((b, i) => { b.onclick = () => select(i); });

/* 轮播：深度已经是取模算的，所以越界绕回不需要额外判断，
   step 只管把下标加减后取模即可。 */
const step = (dir) => select((active + dir + cards.length) % cards.length);

/* 滚轮 / 触控板：一次手势只走一格。触控板的惯性滚动会连发几十个事件，
   不设节流会一路滑到底。取 X / Y 里绝对值大的那个，横竖两种手势都认。 */
const stage = document.querySelector('.stage');
let wheelAt = -Infinity;   // 不能用 0：页面刚加载时 performance.now() 可能还不到节流阈值，第一次滚动会被吞掉
stage.addEventListener('wheel', (e) => {
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (Math.abs(delta) < 2) return;
  e.preventDefault();
  const now = performance.now();
  if (now - wheelAt < 340) return;
  wheelAt = now;
  step(delta > 0 ? 1 : -1);
}, { passive: false });

/* 触摸横扫：手机上没有滚轮，补一个。40px 以上才算一次切换。 */
const deck = document.querySelector('.deck');
let startX = null;
deck.addEventListener('pointerdown', (e) => { startX = e.clientX; });
deck.addEventListener('pointerup', (e) => {
  if (startX === null) return;
  const dx = e.clientX - startX;
  startX = null;
  if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
});
deck.addEventListener('pointercancel', () => { startX = null; });

/* 键盘：工具条获得焦点后用方向键走 */
document.querySelector('.tool-list').addEventListener('keydown', (e) => {
  const back = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
  const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight';
  if (!back && !fwd) return;
  e.preventDefault();
  step(fwd ? 1 : -1);
  buttons[active].focus();
});

/* ── Rheo 卡片上的实时缩略图：跑「交汇融流」 ───────────────────────────
   静态 PNG 始终在底下。只有 WebGL 初始化成功才给容器加 .live 把画布淡入，
   所以任何失败路径（无 WebGL、着色器编译失败、上下文丢失）都自然退回静态图。
   缩略图只有一两百像素，质量倍率压到 1.5，避免为一张卡片付高分辨率的代价。 */
const BLEND_MODE = 1;                                   // 交汇融流 · Blend
const thumb = document.querySelector('.tool-card .thumb');
const canvas = document.getElementById('thumb-canvas');
const rheoCard = canvas ? canvas.closest('.tool-card') : null;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
let renderer, running = true;

if (thumb && canvas) {
  const state = { ...defaults, mode: BLEND_MODE, particles: false,
                  seedValue: hashSeed(defaults.seed) % 10000 };
  let elapsed = 0, last = 0, lost = false;

  const paint = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    renderer.draw(state, elapsed,
      Math.max(1, Math.round(rect.width * ratio)),
      Math.max(1, Math.round(rect.height * ratio)));
  };

  const frame = (now) => {
    const delta = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    if (!document.hidden && !lost && running) { elapsed += delta * state.speed; paint(); }
    requestAnimationFrame(frame);
  };

  try {
    renderer = new Renderer(canvas);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; thumb.classList.remove('live'); });
    canvas.addEventListener('webglcontextrestored', () => { lost = false; thumb.classList.add('live'); });
    paint();                       // 先画一帧再淡入，避免露出空画布
    thumb.classList.add('live');
    if (!still) requestAnimationFrame(frame);
  } catch {
    // 静态 PNG 已经在位，无需处理
  }
}

/* ── 封面读数 ────────────────────────────────────────────────────────
   Rubric 的 wght、Recast 的 quality / KB 由 CSS 动画驱动一个注册过的整数属性。
   原先用 counter(var(--x)) 直接显示，但 Safari 等浏览器不认，会一直读 0 ——
   改由这里每帧读出插值后的值写成文字。只更新最前那张卡，文字没变就不碰 DOM。 */
const readouts = [...document.querySelectorAll('[data-readout]')];
let readAll = true;           // 第一帧全部填上，后排卡片也不会是空的
const readTick = () => {
  for (const el of readouts) {
    if (!readAll && el.closest('.tool-card').dataset.front !== 'true') continue;
    const n = parseInt(getComputedStyle(el).getPropertyValue(el.dataset.readout), 10);
    if (Number.isNaN(n)) continue;
    // data-unit="size"：读数单位是 KB，满 1024 换成 MB 带一位小数
    const value = el.dataset.unit === 'size'
      ? (n >= 1024 ? (n / 1024).toFixed(1) + ' MB' : n + ' KB')
      : n;
    const text = (el.dataset.prefix || '') + value + (el.dataset.suffix || '');
    if (el.textContent !== text) el.textContent = text;
  }
  readAll = false;
  requestAnimationFrame(readTick);
};
if (readouts.length) requestAnimationFrame(readTick);

select(0);
