import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasAspect, exportSize, frameAspect, PHONE_SCREEN, TEMPLATES, placeShot, textBox, snapBox, SCALE_MIN, SCALE_MAX, bulletsOf, wrapLines,
  fitRatioBox, dragBox, MIN_CROP, trimBounds, parseRheoStyle, isLight } from '../src/relief-core.js';
import { defaults } from '../src/model.js';

test('auto ratio follows the content but is clamped to 9:16 … 16:9', () => {
  assert.equal(canvasAspect('4:3', 5), 4 / 3);
  assert.equal(canvasAspect('auto', 1.5), 1.5);
  assert.equal(canvasAspect('auto', 5), 16 / 9);
  assert.equal(canvasAspect('auto', .2), 9 / 16);
});

test('export size keeps the long edge at 1600 × scale', () => {
  assert.deepEqual(exportSize(4 / 3, 1), { width: 1600, height: 1200 });
  assert.deepEqual(exportSize(9 / 16, 2), { width: 1800, height: 3200 });
});

test('frames change the outer aspect: browser adds a title bar, phone ignores the content', () => {
  assert.equal(frameAspect('none', 1.6), 1.6);
  assert.ok(frameAspect('browser', 1.6) < 1.6);
  assert.equal(frameAspect('phone', 1.6), frameAspect('phone', .4));
});

test('border thickness: thicker browser bar and phone bezel, default matches the old browser bar', () => {
  assert.ok(frameAspect('browser', 1.6, 100) < frameAspect('browser', 1.6, 50));
  assert.ok(frameAspect('browser', 1.6, 0) > frameAspect('browser', 1.6, 50));
  assert.ok(Math.abs(frameAspect('browser', 1.6) - 1 / (1 / 1.6 + .055)) < 1e-12);
  // 手机：玻璃边越宽，机身越接近方形（边框在短边上占比更大）；屏幕比例本身不变
  const thin = frameAspect('phone', 1, 0), thick = frameAspect('phone', 1, 100);
  assert.ok(thin > PHONE_SCREEN && thick > thin && thick < .6);
});

test('every template keeps the shot and text inside the canvas (except the bleed one)', () => {
  for (const [W, H] of [[1600, 1200], [1600, 900], [1200, 1200], [900, 1600]]) {
    TEMPLATES.forEach((t, i) => {
      for (const aspect of [1.6, frameAspect('phone', 1)]) {
        const s = placeShot(i, W, H, aspect, 95);
        assert.ok(s.x >= 0 && s.x + s.w <= W + .5, `${t.name} x ${W}x${H}`);
        assert.ok(s.y >= 0, `${t.name} top`);
        if (t.anchor !== 'top') assert.ok(s.y + s.h <= H + .5, `${t.name} bottom ${W}x${H}`);
        assert.ok(Math.abs(s.w / s.h - aspect) < 1e-6);
      }
      const b = textBox(i, W, H);
      if (b) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= W && b.y + b.h <= H);
    });
  }
});

test('the bleed template really bleeds off the bottom at full size', () => {
  const i = TEMPLATES.findIndex(t => t.anchor === 'top');
  const s = placeShot(i, 1600, 1200, 1.6, 95);
  assert.ok(s.y + s.h > 1200);
});

test('scale is clamped to its range and the offset moves the shot by a fraction of the canvas', () => {
  assert.deepEqual(placeShot(0, 1000, 1000, 1, 1), placeShot(0, 1000, 1000, 1, SCALE_MIN));
  assert.deepEqual(placeShot(0, 1000, 1000, 1, 999), placeShot(0, 1000, 1000, 1, SCALE_MAX));
  const a = placeShot(1, 1600, 1200, 1.5, 74), b = placeShot(1, 1600, 1200, 1.5, 74, [.1, -.05]);
  assert.equal(b.x - a.x, 160); assert.equal(b.y - a.y, -60); assert.equal(b.w, a.w);
});

test('bullets split on the usual separators', () => {
  assert.deepEqual(bulletsOf('本地处理 · 一键复制 / 8 种排版'), ['本地处理', '一键复制', '8 种排版']);
  assert.deepEqual(bulletsOf('只有一条'), ['只有一条']);
});

test('wrapLines breaks CJK per character and Latin per word, and ellipsises overflow', () => {
  const m = (s) => [...s].length;                      // 每个字符宽 1
  assert.deepEqual(wrapLines('让截图自己会说话', 4, m), ['让截图自', '己会说话']);
  assert.deepEqual(wrapLines('hello brave new world', 11, m), ['hello brave', 'new world']);
  assert.deepEqual(wrapLines('supercalifragilistic', 8, m), ['supercal', 'ifragili', 'stic']);
  const out = wrapLines('一二三四五六七八九十', 3, m, 2);
  assert.equal(out.length, 2);
  assert.ok(out[1].endsWith('…') && m(out[1]) <= 3);
});

test('fitRatioBox centres the largest box of that ratio', () => {
  assert.deepEqual(fitRatioBox(1600, 1000, 1), { x: 300, y: 0, w: 1000, h: 1000 });
  assert.deepEqual(fitRatioBox(1600, 1000, null), { x: 0, y: 0, w: 1600, h: 1000 });
});

test('dragBox moves within bounds and never shrinks below the minimum', () => {
  const start = { x: 100, y: 100, w: 400, h: 300 };
  assert.deepEqual(dragBox(start, 'move', 5000, -5000, 1000, 800), { x: 600, y: 0, w: 400, h: 300 });
  const tiny = dragBox(start, 'se', -1000, -1000, 1000, 800);
  assert.equal(tiny.w, MIN_CROP); assert.equal(tiny.h, MIN_CROP);
  assert.deepEqual(dragBox(start, 'nw', -500, -500, 1000, 800), { x: 0, y: 0, w: 500, h: 400 });
});

test('dragBox with a locked ratio keeps the ratio and stays inside the image', () => {
  const W = 1000, H = 800, r = 16 / 9;
  const start = fitRatioBox(W, H, r);
  for (const [handle, dx, dy] of [['e', -200, 0], ['s', 0, -100], ['nw', 150, 40], ['se', 400, 400], ['n', 0, -300], ['w', -300, 0]]) {
    const b = dragBox(start, handle, dx, dy, W, H, r);
    assert.ok(Math.abs(b.w / b.h - r) < .02, `${handle} ratio ${b.w}/${b.h}`);
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= W && b.y + b.h <= H, `${handle} bounds ${JSON.stringify(b)}`);
  }
});

function image(W, H, fill, rect, color) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inside = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
    d.set(inside ? color : fill, (y * W + x) * 4);
  }
  return d;
}

test('trimBounds finds content inside a solid margin', () => {
  const d = image(40, 30, [255, 255, 255, 255], { x: 5, y: 3, w: 20, h: 10 }, [30, 60, 90, 255]);
  assert.deepEqual(trimBounds(d, 40, 30), { x: 5, y: 3, w: 20, h: 10 });
});

test('trimBounds keeps a near-white panel that sits on a white margin', () => {
  const d = image(40, 30, [255, 255, 255, 255], { x: 4, y: 4, w: 32, h: 22 }, [246, 247, 249, 255]);
  assert.deepEqual(trimBounds(d, 40, 30), { x: 4, y: 4, w: 32, h: 22 });
});

test('trimBounds treats transparent corners as the macOS shadow margin', () => {
  const d = image(40, 30, [0, 0, 0, 0], { x: 8, y: 6, w: 24, h: 18 }, [240, 240, 240, 255]);
  assert.deepEqual(trimBounds(d, 40, 30), { x: 8, y: 6, w: 24, h: 18 });
});

test('trimBounds leaves a uniform image alone', () => {
  const d = image(10, 10, [9, 9, 9, 255], { x: 0, y: 0, w: 0, h: 0 }, [0, 0, 0, 0]);
  assert.deepEqual(trimBounds(d, 10, 10), { x: 0, y: 0, w: 10, h: 10 });
});

test('parseRheoStyle accepts a copied Rheo state and rejects anything else', () => {
  const s = parseRheoStyle(JSON.stringify({ ...defaults, mode: 2, seed: 'from-rheo' }));
  assert.equal(s.mode, 2); assert.equal(s.seed, 'from-rheo');
  assert.throws(() => parseRheoStyle('hello'), /复制到 Relief/);
  assert.throws(() => parseRheoStyle(JSON.stringify({ ...defaults, glow: 99 })), /参数超出范围/);
});

test('isLight separates light and dark backgrounds', () => {
  assert.equal(isLight(255, 253, 253), true);
  assert.equal(isLight(8, 12, 19), false);
});

test('snapBox pulls a box onto the canvas centre line and reports the guide', () => {
  const W = 1600, H = 1200;
  const r = snapBox({ x: 700, y: 100, w: 196, h: 80 }, W, H, [], 8);   // 中心 798：离中轴 2px
  assert.equal(r.dx, 2); assert.equal(r.guides.x, 800);
  assert.equal(r.guides.y, null);
  const far = snapBox({ x: 600, y: 500, w: 100, h: 100 }, W, H, [], 8);
  assert.deepEqual([far.dx, far.dy], [0, 0]);
  // 对齐其他元素的左边
  const o = snapBox({ x: 205, y: 500, w: 100, h: 40 }, W, H, [{ x: 200, y: 50, w: 400, h: 60 }], 8);
  assert.equal(o.dx, -5); assert.equal(o.guides.x, 200);
  // 最近的那条优先：左边离 96 差 3，中线离中轴差 6 —— 取 3
  const near = snapBox({ x: 99, y: 700, w: 1390, h: 10 }, W, H, [{ x: 96, y: 0, w: 40, h: 10 }], 8);
  assert.equal(near.dx, -3);
});

test('parseRheoFile reads parameters and progress back out of a Rheo HTML export', async () => {
  const { parseRheoFile } = await import('../src/relief-core.js');
  const { createStandaloneHtml } = await import('../src/export.js');
  const state = { ...defaults, mode: 1, seed: 'flow-</script>-seed', speed: 1.4 };
  const html = createStandaloneHtml({ state, time: 12.75, paused: false, sources: ['export class Renderer{}'], license: 'MIT' });
  const out = parseRheoFile(html);
  assert.equal(out.state.seed, 'flow-</script>-seed');
  assert.equal(out.state.mode, 1);
  assert.equal(out.state.speed, 1.4);
  assert.equal(out.time, 12.75);
  // 参数 JSON 也认，进度从 0 开始
  assert.equal(parseRheoFile(JSON.stringify(state)).time, 0);
  assert.throws(() => parseRheoFile('<html><body>not rheo</body></html>'), /Rheo 导出/);
});
