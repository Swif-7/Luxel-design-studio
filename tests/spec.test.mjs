import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTheme, audit, contrast, adaptAccent, toMarkdown, hexToLch, harmonyIssues, recommend, deltaE} from '../src/spec.js';

const params = {hue: 250, chroma: 2, contrast: 1, accents: ['#3b5bdb', '#e8590c']};
const type = {body: 400, strong: 600, heading: 650, size: 15, scale: 1.6};

test('两套主题产出完整且合法的 token', () => {
  for (const theme of ['light', 'dark']) {
    const t = buildTheme(params, theme);
    for (const key of ['bg','surface','surface-2','surface-3','border','border-strong','text','text-2','text-3','accent','accent-fg','accent-2','accent-2-fg'])
      assert.match(t[key], /^#[0-9a-f]{6}$/, `${theme}.${key} 不是合法色值：${t[key]}`);
  }
});

test('浅色底亮、深色底暗，正文方向相反', () => {
  const l = buildTheme(params, 'light'), d = buildTheme(params, 'dark');
  assert.ok(contrast(l.bg, '#000000') > contrast(d.bg, '#000000'), '浅色底应更亮');
  assert.ok(contrast(l.text, l.bg) >= 4.5, '浅色正文对比不足');
  assert.ok(contrast(d.text, d.bg) >= 4.5, '深色正文对比不足');
});

test('默认参数下两套主题都过 AA', () => {
  for (const theme of ['light', 'dark']) {
    const failed = audit(buildTheme(params, theme)).filter(c => !c.pass);
    assert.deepEqual(failed, [], `${theme} 未达标：${failed.map(f => f.key + ' ' + f.ratio)}`);
  }
});

test('强调色落到深底时保住色相并够到对比度', () => {
  const dark = buildTheme(params, 'dark');
  const adapted = adaptAccent('#3b5bdb', 'dark', dark.bg, 4.5);
  const before = hexToLch('#3b5bdb').h, after = hexToLch(adapted).h;
  assert.ok(Math.abs(before - after) < 12, `色相偏移过大：${before} → ${after}`);
  assert.ok(contrast(adapted, dark.bg) >= 4.4, '适配后仍不够对比度');
});

test('单色模式不产出第二强调色', () => {
  const t = buildTheme({...params, accents: ['#3b5bdb']}, 'light');
  assert.equal(t['accent-2'], undefined);
  assert.equal(audit(t).some(c => c.key.startsWith('accent-2')), false);
});

test('Markdown 含两套表格、字重与规则，未达标时给出告警', () => {
  const light = buildTheme(params, 'light'), dark = buildTheme(params, 'dark');
  const md = toMarkdown({params, light, dark, type});
  assert.match(md, /### 浅色/); assert.match(md, /### 深色/);
  assert.match(md, /\| `--accent` \| `#/);
  assert.match(md, /字重/); assert.match(md, /实现规则/);
  assert.equal((md.match(/\| `--/g) || []).length, 26, '两套各 13 个 token');

  // 造一个必然不达标的配色，告警必须出现
  const bad = {...light, text: light.bg};
  const md2 = toMarkdown({params, light: bad, dark, type});
  assert.match(md2, /⚠/);
});

test('控件描边在各种参数下都自动够到 3:1', () => {
  for (const hue of [0, 120, 250, 340])
    for (const chroma of [0, 3, 8])
      for (const spread of [.85, 1, 1.15])
        for (const theme of ['light', 'dark']) {
          const t = buildTheme({hue, chroma, contrast: spread, accents: ['#3b5bdb']}, theme);
          const row = audit(t).find(c => c.key === 'border-strong');
          assert.ok(row.pass, `hue${hue} c${chroma} s${spread} ${theme} → ${row.ratio}`);
        }
});

test('滑块推到极端时告警会出现，而不是静默放行', () => {
  // 对比强度压到最低，正文必然贴近底色
  const t = buildTheme({hue: 0, chroma: 0, contrast: .3, accents: ['#888888']}, 'light');
  assert.ok(audit(t).some(c => !c.pass), '极端参数下应当报出未达标');
});

test('多色模式按数量产出对应的 token', () => {
  const four = ['#3b5bdb', '#e8590c', '#2f9e44', '#c2255c'];
  const t = buildTheme({hue: 250, chroma: 2, contrast: 1, accents: four}, 'light');
  for (let i = 2; i <= 4; i++) {
    assert.match(t[`accent-${i}`], /^#[0-9a-f]{6}$/);
    assert.match(t[`accent-${i}-fg`], /^#[0-9a-f]{6}$/);
  }
  assert.equal(t['accent-5'], undefined);
  // 每个强调色都应被检查到
  const keys = audit(t).map(c => c.key);
  for (let i = 2; i <= 4; i++) assert.ok(keys.includes(`accent-${i}`), `accent-${i} 未被检查`);
});

test('色相过近会被判为冲突，拉开后不再报', () => {
  const near = harmonyIssues(['#3b5bdb', '#3b7ddb']);   // 同色系仅差十几度
  assert.ok(near.some(i => i.kind === '色相过近'), '未识别出色相过近');
  assert.match(near[0].text, /\d+°/, '说明里应给出实际度数');
  const apart = harmonyIssues(['#3b5bdb', '#e8590c']);  // 接近互补
  assert.equal(apart.some(i => i.kind === '色相过近'), false);
});

test('两色几乎同色时报彼此难分', () => {
  const issues = harmonyIssues(['#3b5bdb', '#3d5cdc']);
  assert.ok(issues.some(i => i.kind === '彼此难分'));
});

test('单色不产生配色冲突', () => {
  assert.deepEqual(harmonyIssues(['#3b5bdb']), []);
});

test('推荐色落在目标色相上，明度按色域自适应', () => {
  // 明度不再照搬主色：同一色度在不同色相上未必可达，硬搬会被夹成脏色。
  // 契约是色相准、色度不被夹垮，明度允许移动。
  const base = '#3b5bdb', got = recommend(base), src = hexToLch(base);
  assert.ok(got.length >= 6);
  for (const {hex, delta, label} of got) {
    const c = hexToLch(hex);
    const want = (src.h + delta + 360) % 360;
    const gap = Math.min(Math.abs(c.h - want), 360 - Math.abs(c.h - want));
    assert.ok(gap < 12, `${label} 色相没落在预期角度 ${hex}: ${c.h.toFixed(0)} vs ${want.toFixed(0)}`);
    assert.ok(c.C > src.C * .6, `${label} 色度被夹得过低 ${hex}`);
  }
});
test('Markdown 在有配色冲突时列出关系一节', () => {
  const p2 = {hue: 250, chroma: 2, contrast: 1, accents: ['#3b5bdb', '#3b7ddb']};
  const md = toMarkdown({params: p2, light: buildTheme(p2, 'light'), dark: buildTheme(p2, 'dark'), type});
  assert.match(md, /### 配色关系/);
  assert.match(md, /色相过近/);
});

test('「彼此难分」按感知色差判定，不被亮度接近误伤', () => {
  // 强调色都会被拉到对底色约 4.5，彼此亮度本就接近；用亮度判会把明显不同的色也算成一样
  assert.ok(contrast('#3b5bdb', '#e8590c') < 1.6, '蓝与橙的亮度对比确实很低');
  assert.ok(deltaE('#3b5bdb', '#e8590c') > .3, '但感知上差得很远');
  assert.equal(harmonyIssues(['#3b5bdb', '#e8590c']).some(i => i.kind === '彼此难分'), false,
    '蓝橙不该被判为难分');
  assert.ok(harmonyIssues(['#3b5bdb', '#3d5cdc']).some(i => i.kind === '彼此难分'),
    '几乎同色应被判为难分');
});

test('多色配色只报真正有问题的对，不是每对都报', () => {
  const five = ['#3b5bdb', '#e8590c', '#2f9e44', '#c2255c', '#0c8599'];
  const issues = harmonyIssues(five);
  const pairs = five.length * (five.length - 1) / 2;
  assert.ok(issues.length < pairs / 2, `${pairs} 对里报了 ${issues.length} 处，过于宽泛`);
});

test('推荐色不会自荐一个随即要被警告的组合', () => {
  const bases = ['#3b5bdb', '#e8590c', '#2f9e44', '#c2255c', '#7048e8', '#0c8599', '#888888', '#000000', '#ffffff'];
  for (const base of bases)
    for (const r of recommend(base)) {
      const issues = harmonyIssues([base, r.hex]);
      assert.deepEqual(issues, [], `${base} 的「${r.label}」推荐 ${r.hex} 触发了 ${issues.map(i => i.kind)}`);
    }
});

test('推荐色不被色域夹成脏色，保住相近的鲜艳度', () => {
  // 蓝可以又暗又艳，黄不行：照搬明度会把互补色夹成脏橄榄
  const base = '#3b5bdb', src = hexToLch(base);
  const comp = recommend(base).find(r => r.label === '互补');
  assert.ok(hexToLch(comp.hex).C > src.C * .7, `互补色被夹得太脏：${comp.hex}`);
});

test('无彩度基色仍给出真正的颜色，而不是七个同样的灰', () => {
  const hexes = recommend('#888888').map(r => r.hex);
  assert.ok(new Set(hexes).size >= 6, '推荐重复：' + hexes.join(' '));
  for (const hex of hexes) assert.ok(hexToLch(hex).C > .05, `${hex} 仍是灰的`);
});
