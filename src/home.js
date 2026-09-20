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

/* ── 工具卡缩略图：跑 Rheo 的「交汇融流」 ───────────────────────────────
   静态 PNG 始终在底下。只有 WebGL 初始化成功才给容器加 .live 把画布淡入，
   所以任何失败路径（无 WebGL、着色器编译失败、上下文丢失）都自然退回静态图。
   缩略图只有一两百像素，质量倍率压到 1，避免为一张卡片付高分辨率的代价。 */
const BLEND_MODE = 1;                                   // 交汇融流 · Blend
const thumb = document.querySelector('.thumb');
const canvas = document.getElementById('thumb-canvas');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (thumb && canvas) {
  const state = { ...defaults, mode: BLEND_MODE, particles: false,
                  seedValue: hashSeed(defaults.seed) % 10000 };
  let renderer, elapsed = 0, last = 0, lost = false;

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
    if (!document.hidden && !lost) { elapsed += delta * state.speed; paint(); }
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
