// Rise 的合成：背景（和 Relief 同一套）→ 静态层（卡片、文字、图例）→ 动态层（图表，随时间生长）。
// 背景和静态层不随时间变，按参数缓存成一张画布；每一帧只重画图表。
import { backgroundLayer, makeCanvas } from './relief-render.js';
import { buildFrame } from './rise-core.js';
import { drawStatic, drawDynamic } from './rise-draw.js';

/* 最近用过的几组静态层：预览一张、各种缩略图若干张，来回切换不必重画 */
const cache = new Map();
export const clearStatic = () => cache.clear();

/* scene：{ data, s（设置）, bg（Relief 格式的背景描述；src 为 'none' 表示透明） }
   opts：{ interactive, hide, withBackground（默认 true；导出 HTML 时背景和静态层单独烘成图） }
   返回 { regions, frame }：regions 用来在预览上叠点击编辑。 */
export function prepare(scene, W, H, opts = {}) {
  const key = JSON.stringify([W, H, scene.bgKey, scene.s, opts.interactive, opts.hide, scene.dataKey]);
  if (cache.has(key)) { const hit = cache.get(key); cache.delete(key); cache.set(key, hit); return hit; }
  let bgLayer = null, bgLight = true;
  if (scene.bg.src !== 'none') { const b = backgroundLayer(scene.bg, W, H); bgLayer = b.canvas; bgLight = b.light; }
  const frame = buildFrame(scene.data, scene.s, W, H, { interactive: opts.interactive, hide: opts.hide, bgLight });
  const layer = makeCanvas(W, H), ctx = layer.getContext('2d');
  if (bgLayer) ctx.drawImage(bgLayer, 0, 0, W, H);
  const regions = drawStatic(ctx, frame.statics);
  const entry = { key, layer, frame, regions };
  cache.set(key, entry);
  while (cache.size > 40) cache.delete(cache.keys().next().value);
  return entry;
}

export function drawFrame(ctx, scene, W, H, t, opts = {}) {
  const p = prepare(scene, W, H, opts);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(p.layer, 0, 0);
  drawDynamic(ctx, p.frame.dyn, t, opts.fade ?? 1);
  return p;
}
