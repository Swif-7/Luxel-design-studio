import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CHARTS, STYLES, LAYOUTS, niceScale, formatValue, progress, phase, cycle, EASES, loopFrame, EXIT, GAP, exportSize, layoutScene, gridOf, recommend, buildFrame, resolveAbbr } from '../src/rise-core.js';
import { squarify, waffleCells } from '../src/rise-draw.js';
import { parseData, SAMPLE } from '../src/rise-data.js';

test('catalogue: 18 chart types, 10 styles with 7-colour palettes, 7 layouts', () => {
  assert.equal(CHARTS.length, 18);
  assert.equal(new Set(CHARTS.map(c => c.id)).size, 18);
  assert.equal(STYLES.length, 10);
  for (const s of STYLES) assert.equal(s.palette.length, 7, s.id);
  assert.equal(LAYOUTS.length, 7);
});

test('nice scale starts at zero and ends on a round step', () => {
  assert.deepEqual(niceScale(0, 3480, 5).ticks, [0, 1000, 2000, 3000, 4000]);
  const neg = niceScale(-12, 30, 5);
  assert.ok(neg.min <= -12 && neg.max >= 30 && neg.ticks.includes(0));
  assert.deepEqual(niceScale(5, 5).ticks.slice(0, 1), [0]);
});

test('value formatting: grouping, decimals, abbreviations, prefix and suffix', () => {
  assert.equal(formatValue(3480, {}), '3,480');
  assert.equal(formatValue(12.345, { decimals: 'auto' }), '12.3');
  assert.equal(formatValue(1200, { prefix: '¥' }), '¥1,200');
  assert.equal(formatValue(35, { suffix: '%' }), '35%');
  assert.equal(formatValue(32000, { abbr: 'cn' }), '3.2万');
  assert.equal(formatValue(4.2e6, { abbr: 'en' }), '4.2M');
  assert.equal(formatValue(-3, {}), '−3');
  assert.equal(formatValue(2.5, { decimals: '2' }), '2.50');
});

test('staggered progress: first element leads, all finish exactly at the duration', () => {
  const anim = { effect: 'grow', dur: 2, stagger: 50, ease: 'linear', hold: 1 };
  assert.equal(progress(0, 0, 6, anim), 0);
  assert.ok(progress(.5, 0, 6, anim) > progress(.5, 5, 6, anim));
  for (let i = 0; i < 6; i++) assert.equal(progress(2, i, 6, anim), 1);
  assert.equal(progress(1, 3, 6, { ...anim, stagger: 0 }), .5);
  assert.ok(progress(.6, 0, 1, { ...anim, effect: 'pop' }) > .6);      // 弹跳会冲过头再回来
  assert.equal(cycle(anim), 3);
});

test('easing: the default spring starts from rest, overshoots a little and settles; loops fade out before restarting', () => {
  assert.ok(EASES.spring(.05) < .1);                              // 起步是缓的
  const peak = Math.max(...Array.from({ length: 101 }, (_, i) => EASES.spring(i / 100)));
  assert.ok(peak > 1.01 && peak < 1.05, `peak ${peak}`);
  assert.equal(EASES.spring(1), 1);
  const anim = { effect: 'grow', dur: 2, stagger: 50, ease: 'spring', hold: 1, loop: true };
  assert.deepEqual(loopFrame(1, anim), { t: 1, fade: 1 });
  const exiting = loopFrame(3 + EXIT / 2, anim);
  assert.equal(exiting.t, 3);
  assert.ok(exiting.fade > 0 && exiting.fade < 1);
  const again = loopFrame(3 + EXIT + GAP + .5, anim);
  assert.ok(Math.abs(again.t - .5) < 1e-9 && again.fade === 1);
  assert.deepEqual(loopFrame(9, { ...anim, loop: false }), { t: 3, fade: 1 });
  // 错峰：元素再多，每个也至少走 40% 的时长
  const w = (n) => { let first = null, last = null; for (let t = 0; t <= 2; t += .001) { const x = phase(t, 0, n, anim); if (x > 0 && first === null) first = t; if (x >= 1 && last === null) last = t; } return last - first; };
  assert.ok(w(40) >= .8 * .99 * 2 * .5);
});

test('export sizes keep the long edge and even pixel counts (video encoders need them)', () => {
  assert.deepEqual(exportSize(4 / 3, 1920), { width: 1920, height: 1440 });
  assert.deepEqual(exportSize(9 / 16, 1920), { width: 1080, height: 1920 });
  const odd = exportSize(1.37, 1280);
  assert.equal(odd.height % 2, 0);
});

test('every layout keeps its boxes inside the content card on every ratio', () => {
  const inside = (b, c, name) => {
    if (!b) return;
    assert.ok(b.x >= c.x - .5 && b.y >= c.y - .5 && b.x + b.w <= c.x + c.w + .5 && b.y + b.h <= c.y + c.h + .5, name);
    assert.ok(b.w > 0 && b.h > 0, name + ' is not empty');
  };
  for (const [W, H] of [[1920, 1440], [1920, 1080], [1440, 1440], [1080, 1920]]) {
    for (const l of LAYOUTS) for (const count of [1, 3, 7]) {
      const o = layoutScene({ W, H, layout: l.id, scale: 88, count, legend: true, has: { title: true, sub: true, note: true } });
      const name = `${l.id} ${W}x${H} ×${count}`;
      assert.equal(o.charts.length, count, name);
      for (const k of ['title', 'sub', 'note', 'legend', 'kpi']) inside(o[k], o.card, `${name} ${k}`);
      o.charts.forEach((c, i) => { inside(c, o.card, `${name} chart ${i}`); assert.ok(c.h > H * .08, `${name} chart ${i} tall enough`); });
    }
  }
});

test('grids for up to seven charts leave no empty row', () => {
  for (let n = 2; n <= 7; n++) {
    const { cols, rows } = gridOf(n, 1600, 1000);
    assert.ok(cols * rows >= n && (rows - 1) * cols < n, `n=${n}`);
  }
});

test('treemap tiles fill the box exactly; waffle always has 100 cells', () => {
  const box = { x: 10, y: 20, w: 400, h: 300 };
  const tiles = squarify([30, 20, 10, 25, 15], box);
  const area = tiles.reduce((a, t) => a + t.w * t.h, 0);
  assert.ok(Math.abs(area - box.w * box.h) < 1);
  for (const t of tiles) assert.ok(t.x >= box.x - .01 && t.y >= box.y - .01 && t.x + t.w <= box.x + box.w + .01 && t.y + t.h <= box.y + box.h + .01);
  assert.equal(waffleCells([33.3, 33.3, 33.4]).reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(waffleCells([1, 1, 2]), [25, 25, 50]);
});

test('recommendations follow the data shape', () => {
  assert.equal(recommend(parseData('35% 25% 40%').groups)[0], 'donut');
  assert.equal(recommend(parseData('72%').groups)[0], 'gauge');
  assert.equal(recommend(parseData(SAMPLE).groups)[0], 'bar');
  assert.equal(recommend(parseData('1 2 3 4 5 6 7 8 9 10').groups)[0], 'line');
});

test('frames: merge draws all groups in one chart, split draws one per group or a grid', () => {
  const data = parseData(SAMPLE);
  const s = { mode: 'merge', splitView: 'each', current: 1, chart: 'bar', style: 'glass', panel: false, grid: true, values: true, decimals: 'auto', abbr: 'auto',
    anim: { effect: 'grow', dur: 1.6, stagger: 45, ease: 'out', hold: 1.6, loop: true }, layout: 'top', scale: 90, title: 'T', sub: '', note: '' };
  const merged = buildFrame(data, s, 1600, 1200);
  assert.equal(merged.dyn.charts.length, 1);
  assert.equal(merged.dyn.charts[0].series.length, 2);
  assert.equal(merged.statics.legend.length, 2);
  const one = buildFrame(data, { ...s, mode: 'split' }, 1600, 1200);
  assert.equal(one.dyn.charts[0].series[0].name, '回访');
  const grid = buildFrame(data, { ...s, mode: 'split', splitView: 'grid' }, 1600, 1200);
  assert.equal(grid.dyn.charts.length, 2);
  assert.deepEqual(grid.statics.heads, ['新用户', '回访']);
  assert.equal(buildFrame(data, { ...s, chart: 'donut' }, 1600, 1200).statics.legend.length, 6);   // 按类别着色的图，图例列类别
  assert.equal(resolveAbbr('auto', parseData('3.2万 4万').groups), 'cn');
});

test('rise-core imports nothing and rise-draw imports only rise-core (both get inlined into exported HTML)', async () => {
  const core = await readFile(new URL('../src/rise-core.js', import.meta.url), 'utf8');
  const draw = await readFile(new URL('../src/rise-draw.js', import.meta.url), 'utf8');
  assert.equal((core.match(/^import /gm) || []).length, 0);
  const imports = draw.match(/^import .*$/gm);
  assert.equal(imports.length, 1);
  assert.match(imports[0], /from '\.\/rise-core\.js';$/);
});

test('merging several groups rules out the one-group charts, with a reason for each', async () => {
  const { chartSupport, CHARTS } = await import('../src/rise-core.js');
  const two = parseData(SAMPLE), one = parseData('12 30 45'), short = parseData('1 2\n3 4');
  const blocked = CHARTS.filter(c => !chartSupport(c.id, two, 'merge').ok).map(c => c.id);
  assert.deepEqual(blocked.sort(), ['bignum', 'donut', 'funnel', 'gauge', 'pie', 'polar', 'rings', 'rose', 'treemap', 'waffle']);
  for (const id of blocked) assert.ok(chartSupport(id, two, 'merge').reason.includes('每组一张图'), id);
  assert.ok(CHARTS.every(c => chartSupport(c.id, two, 'split').ok));        // 每组一张图：每张只有一组，都能画
  assert.ok(CHARTS.every(c => chartSupport(c.id, one, 'merge').ok));        // 只有一组时合成也没问题
  assert.equal(chartSupport('radar', short, 'split').ok, false);            // 雷达要 3 个方向
});
