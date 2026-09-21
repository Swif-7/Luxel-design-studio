import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTheme, audit, contrast, adaptAccent, toMarkdown, hexToLch, harmonyIssues, recommend, recommendTonal, deltaE, normalizeRubricState, resizeRubricPalette, toggleRubricLink, buildRubricThemes, themeHarmonyIssues, TYPE_RELATIONS, typographyBounds, updateTypography, toggleTypographyLink, lchHex, typographyAdvice, rubricEditorState, updateRubricColors, recommendBackgrounds, backgroundTextWarnings} from '../src/spec.js';

const params = {hue: 250, chroma: 2, contrast: 1, accents: ['#3b5bdb', '#e8590c']};
const type = [{label:'正文',weight:400,size:15,mono:false},{label:'强调',weight:600,size:15,mono:false},
  {label:'标题',weight:650,size:24,mono:false},{label:'等宽',weight:400,size:14,mono:true}];

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
  assert.match(md, /\| 等宽 \| 400 \| 14px \| 等宽 \|/, '每一行都应直接给出字重与字号');
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


test('同色推荐保持主色色相，并提供五个可区分的深浅层次', () => {
  for (const baseHex of ['#3b5bdb', '#e8590c', '#2f9e44', '#c2255c']) {
    const base = hexToLch(baseHex), colors = recommendTonal(baseHex);
    assert.equal(colors.length, 5);
    assert.equal(new Set(colors.map(c => c.hex)).size, 5);
    let previousL = 0;
    for (const {hex} of colors) {
      const color = hexToLch(hex);
      const gap = Math.abs(color.h - base.h);
      assert.ok(Math.min(gap, 360 - gap) < 5, `${hex} 应属于 ${baseHex} 的同一色系`);
      assert.ok(color.L > previousL);
      assert.ok(Math.abs(color.L - base.L) > .12);
      assert.ok(deltaE(hex, baseHex) > .1);
      previousL = color.L;
    }
  }
});

test('黑白灰的同色推荐保持中性，不凭空引入彩色', () => {
  for (const base of ['#000000', '#888888', '#ffffff']) {
    const colors = recommendTonal(base);
    assert.equal(new Set(colors.map(c => c.hex)).size, 5);
    for (const {hex} of colors) assert.ok(hexToLch(hex).C < .005);
  }
});


test('切换单色再切回多色，保留数量与用户配色，刷新后也不丢失', () => {
  let state = normalizeRubricState({count: 4, accents: ['#112233', '#334455', '#556677', '#778899']});
  const saved = [...state.accents];
  state = resizeRubricPalette(state, 1);
  assert.deepEqual(state.accents, [saved[0]]);
  state = normalizeRubricState(JSON.parse(JSON.stringify(state)));
  state = resizeRubricPalette(state, state.multiCount);
  assert.deepEqual(state.accents, saved);
  state = resizeRubricPalette(state, 2);
  state = resizeRubricPalette(state, 4);
  assert.deepEqual(state.accents, saved);
});

test('深色锁定冻结全部配色参数，恢复联动后重新同步', () => {
  let state = normalizeRubricState();
  const initial = buildRubricThemes(state);
  state = toggleRubricLink(state);
  state.hue = 30; state.chroma = 6; state.contrast = .8;
  state.adaptAccents = false; state.accents[0] = '#abcdef';
  const frozen = buildRubricThemes(state);
  assert.deepEqual(frozen.dark, initial.dark);
  assert.notDeepEqual(frozen.light, initial.light);
  state = normalizeRubricState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(buildRubricThemes(state).dark, initial.dark);
  state = toggleRubricLink(state);
  assert.equal(buildRubricThemes(state).dark.accent, '#abcdef');
});

test('本地设置恢复过滤无效色值、坏类型、越界数值与多余字段', () => {
  for (const bad of [null, [], 'broken', {accents: []}, {accents: ['no', null], count: 80,
    hue: -20, chroma: 'broken', bodySize: 1000, linked: false, darkSnapshot: {}, unexpected: 'x'}]) {
    const state = normalizeRubricState(bad);
    const {light, dark} = buildRubricThemes(state);
    assert.ok(state.count >= 1 && state.count <= 6);
    assert.equal(state.accents.length, state.count);
    assert.ok(state.bodySize <= 40);
    assert.equal(state.unexpected, undefined);
    for (const hex of [...Object.values(light), ...Object.values(dark)]) assert.match(hex, /^#[0-9a-f]{6}$/);
  }
});

test('保留原色在两个主题中精确保留同色层次，并报告不合格用途', () => {
  const colors = ['#3b5bdb', ...recommendTonal('#3b5bdb').map(c => c.hex)];
  for (const theme of ['light', 'dark']) {
    const tokens = buildTheme({...params, accents: colors, adaptAccents: false}, theme);
    const result = Object.entries(tokens).filter(([key]) => /^accent(?:-\d+)?$/.test(key)).map(([, hex]) => hex);
    assert.deepEqual(result, colors);
    assert.ok(audit(tokens).some(c => !c.pass));
    assert.ok(audit(tokens).filter(c => /-fg$/.test(c.key)).every(c => c.pass));
  }
});

test('悬停背景参与文字和控件对比度检查', () => {
  const tokens = buildTheme(params, 'light');
  const altered = {...tokens, 'surface-3': tokens['text-3']};
  assert.equal(audit(altered).find(c => c.key === 'text-3').pass, false);
  const border = {...tokens, 'surface-3': tokens['border-strong']};
  assert.equal(audit(border).find(c => c.key === 'border-strong').pass, false);
});

test('导出描述实际锁定状态、颜色策略以及检查范围', () => {
  const state = toggleRubricLink(normalizeRubricState({adaptAccents: false}));
  const {light, dark} = buildRubricThemes(state);
  const md = toMarkdown({params: state, light, dark, type});
  assert.match(md, /浅深色独立编辑/);
  assert.match(md, /当前颜色处理：保留原色/);
  assert.match(md, /悬停/);
  assert.doesNotMatch(md, /所有组合均满足 WCAG AA/);
  assert.match(md, /项目字体须提供对应字重/);
});

test('实际生成色的相似性参与配色提示，提示标明所属主题', () => {
  const light = buildTheme(params, 'light'), dark = buildTheme(params, 'dark');
  const adjusted = {...light, 'accent-2': light.accent};
  assert.ok(themeHarmonyIssues(adjusted, dark).some(i => i.theme === '浅色' && i.kind === '彼此难分'));
});


test('近灰色一档 RGB 变化不会导致推荐整组跳色，也不误称互补色', () => {
  const expected = recommend('#888888').map(c => c.hex);
  for (const base of ['#888889', '#888988', '#898888']) {
    const colors = recommend(base);
    assert.deepEqual(colors.map(c => c.hex), expected);
    assert.ok(colors.every(c => c.neutral && c.label.includes('点缀')));
    assert.equal(colors.filter(c => c.kind === 'contrast').length, 5);
  }
});

test('低饱和主色的对比推荐保持低饱和，不强行加艳', () => {
  const base = lchHex({L: .65, C: .04, h: 250});
  for (const color of recommend(base)) assert.ok(hexToLch(color.hex).C < .06);
});

test('不同明度和色相的对比色推荐不会自荐冲突或重复色', () => {
  for (let h = 0; h < 360; h += 30) for (const L of [.2, .45, .7, .9]) for (const C of [.02, .1, .22]) {
    const base = lchHex({L, C, h});
    const colors = recommend(base).filter(c => c.kind === 'contrast');
    assert.equal(colors.length, 5);
    assert.equal(new Set(colors.map(c => c.hex)).size, 5);
    for (const color of colors) assert.deepEqual(harmonyIssues([base, color.hex]), [], `${base} → ${color.hex}`);
  }
});

test('任意字号均可联动其他字号，且字重不受影响', () => {
  const state = toggleTypographyLink(normalizeRubricState());
  for (const role of Object.keys(TYPE_RELATIONS)) {
    const next = updateTypography(state, role + 'Size', 21);
    const bounds = typographyBounds(role + 'Size', true);
    assert.equal(next[role + 'Size'], Math.max(bounds.min, Math.min(bounds.max, 21)));
    for (const [name, {ratio}] of Object.entries(TYPE_RELATIONS)) {
      assert.equal(next[name + 'Size'], Math.round(next.typeSizeBase * ratio));
      assert.equal(next[name + 'Weight'], state[name + 'Weight']);
    }
  }
});

test('任意字重均按差值联动，各行不单独撞上限破坏层级', () => {
  const state = toggleTypographyLink(normalizeRubricState());
  for (const role of Object.keys(TYPE_RELATIONS)) for (const value of [-100, 600, 1000]) {
    const next = updateTypography(state, role + 'Weight', value);
    for (const [name, {offset}] of Object.entries(TYPE_RELATIONS)) {
      assert.equal(next[name + 'Weight'] - next.bodyWeight, offset);
      assert.ok(next[name + 'Weight'] >= 300 && next[name + 'Weight'] <= 800);
      assert.equal(next[name + 'Size'], state[name + 'Size']);
    }
  }
});

test('联动字号边界安全，反复更新与重新加载不累计取整误差', () => {
  let state = toggleTypographyLink(normalizeRubricState());
  for (const role of Object.keys(TYPE_RELATIONS)) for (const value of [-100, 37, 1000]) {
    state = updateTypography(state, role + 'Size', value);
    const sizes = Object.keys(TYPE_RELATIONS).map(key => state[key + 'Size']);
    assert.ok(sizes.every(size => size >= 11 && size <= 40));
    for (let i = 0; i < 10; i++) state = normalizeRubricState(JSON.parse(JSON.stringify(state)));
    assert.deepEqual(Object.keys(TYPE_RELATIONS).map(key => state[key + 'Size']), sizes);
  }
});

test('关闭联动保留当前数值，之后只修改被拖动的参数，导出反映联动状态', () => {
  let state = toggleTypographyLink(normalizeRubricState());
  state = updateTypography(state, 'headingSize', 32);
  const before = {...state};
  state = toggleTypographyLink(state);
  assert.equal(state.headingSize, before.headingSize);
  const changed = updateTypography(state, 'bodySize', 16);
  assert.equal(changed.bodySize, 16);
  assert.equal(changed.headingSize, before.headingSize);
  const md = toMarkdown({params: before, ...buildRubricThemes(before), type});
  assert.match(md, /推荐联动已开启/);
});

test('颜色胶囊允许选中主色，减少色位后选中项仍在有效范围', () => {
  let state = normalizeRubricState({count: 3, selectedAccent: 0});
  assert.equal(state.selectedAccent, 0);
  state.selectedAccent = 2;
  state = resizeRubricPalette(state, 2);
  assert.equal(state.selectedAccent, 1);
  state = resizeRubricPalette(state, 1);
  assert.equal(state.selectedAccent, 0);
  state = resizeRubricPalette(state, 3);
  assert.equal(state.selectedAccent, 1);
});


test('排版提示按字号与字重组合触发，不把所有粗体都当问题', () => {
  assert.equal(typographyAdvice([{label:'强调', size:14, weight:700}])[0].kind, '小字偏重');
  assert.equal(typographyAdvice([{label:'正文', size:16, weight:800}])[0].kind, '小字偏重');
  assert.equal(typographyAdvice([{label:'等宽', size:12, weight:300}])[0].kind, '小字偏细');
  assert.deepEqual(typographyAdvice([{label:'标题', size:24, weight:800}, {label:'强调',size:14,weight:600}]), []);
  assert.deepEqual(typographyAdvice(type), []);
});

test('联动也能触发排版提示，调整改善后提示消失，导出标为建议', () => {
  let state = toggleTypographyLink(normalizeRubricState());
  state = updateTypography(state, 'bodySize', 12);
  state = updateTypography(state, 'bodyWeight', 550);
  const rows = Object.keys(TYPE_RELATIONS).map(key => ({key,label:key,size:state[key+'Size'],weight:state[key+'Weight']}));
  assert.ok(typographyAdvice(rows).some(item => item.key === 'strong'));
  const md = toMarkdown({params:state, ...buildRubricThemes(state), type:rows});
  assert.match(md, /### 排版建议/);
  assert.match(md, /不是 WCAG 不合格判定/);
  state = updateTypography(state, 'bodySize', 20);
  const larger = rows.map(row => ({...row,size:state[row.key+'Size']}));
  assert.deepEqual(typographyAdvice(larger), []);
});


test('独立编辑深色与浅色互不影响，刷新保留编辑对象与两套参数', () => {
  let state = toggleRubricLink(normalizeRubricState({count: 3, accents: ['#112233', '#445566', '#778899']}));
  const initial = buildRubricThemes(state);
  state.editingTheme = 'dark';
  state = updateRubricColors(state, editor => {
    editor.hue = 40; editor.chroma = 5; editor.contrast = .8;
    editor.adaptAccents = false; editor.accents[0] = '#abcdef';
    return resizeRubricPalette(editor, 2);
  });
  assert.deepEqual(buildRubricThemes(state).light, initial.light);
  assert.equal(buildRubricThemes(state).dark.accent, '#abcdef');
  assert.equal(rubricEditorState(state).count, 2);
  assert.equal(state.count, 3);
  const dark = buildRubricThemes(state).dark;
  state = normalizeRubricState(JSON.parse(JSON.stringify(state)));
  assert.equal(state.editingTheme, 'dark');
  assert.deepEqual(buildRubricThemes(state).dark, dark);
  state.editingTheme = 'light';
  state = updateRubricColors(state, editor => ({...editor, hue: 300, chroma: 8}));
  assert.deepEqual(buildRubricThemes(state).dark, dark);
  assert.notDeepEqual(buildRubricThemes(state).light, initial.light);
});

test('恢复联动以当前编辑的深色为准，之后继续编辑两边同步', () => {
  let state = toggleRubricLink(normalizeRubricState());
  state.editingTheme = 'dark';
  state = updateRubricColors(state, editor => ({...editor, accents: ['#123456'], adaptAccents: false}));
  state = toggleRubricLink(state);
  assert.equal(state.linked, true);
  assert.equal(state.darkSnapshot, null);
  for (const tokens of Object.values(buildRubricThemes(state))) assert.equal(tokens.accent, '#123456');
  state = updateRubricColors(state, editor => ({...editor, accents: ['#abcdef']}));
  for (const tokens of Object.values(buildRubricThemes(state))) assert.equal(tokens.accent, '#abcdef');
});

test('旧版深色快照可独立编辑，浅深两套各自记住缩减前的色位', () => {
  let state = normalizeRubricState({linked: false, count: 2, accents: ['#112233','#445566'],
    darkSnapshot: {hue: 60, accents: ['#abcdef','#123456','#654321']}});
  state.editingTheme = 'dark';
  state = updateRubricColors(state, editor => resizeRubricPalette(editor, 1));
  state = normalizeRubricState(JSON.parse(JSON.stringify(state)));
  state = updateRubricColors(state, editor => resizeRubricPalette(editor, 3));
  assert.deepEqual(rubricEditorState(state).accents, ['#abcdef','#123456','#654321']);
  assert.deepEqual(state.accents, ['#112233','#445566']);
});


test('自定义浅深背景独立保存，联动强调色不把两套背景混成同色', () => {
  let state = normalizeRubricState();
  state = updateRubricColors(state, editor => ({...editor, backgrounds: {
    light: {mode: 'custom', color: '#eef4fa'}, dark: {mode: 'custom', color: '#192a3b'}}}));
  assert.equal(buildRubricThemes(state).light.bg, '#eef4fa');
  assert.equal(buildRubricThemes(state).dark.bg, '#192a3b');
  state = toggleRubricLink(state); state.editingTheme = 'dark';
  state = updateRubricColors(state, editor => ({...editor, backgrounds: {...editor.backgrounds,
    dark: {mode: 'custom', color: '#101d24'}}}));
  state = normalizeRubricState(JSON.parse(JSON.stringify(state)));
  state = toggleRubricLink(state);
  assert.equal(buildRubricThemes(state).light.bg, '#eef4fa');
  assert.equal(buildRubricThemes(state).dark.bg, '#101d24');
});

test('推荐背景跟随指定强调色，浅色保持明亮、深色保持深暗', () => {
  let state = normalizeRubricState({count: 2, accents: ['#ff0000', '#0000ff'],
    backgrounds: {light: {mode: 'linked', accentIndex: 1, variant: 2}, dark: {mode: 'linked', accentIndex: 1, variant: 2}}});
  const before = buildRubricThemes(state);
  state = updateRubricColors(state, editor => { editor.accents[1] = '#00ff00'; return editor; });
  const after = buildRubricThemes(state);
  for (const theme of ['light', 'dark']) {
    assert.notEqual(before[theme].bg, after[theme].bg);
    assert.equal(after[theme].bg, recommendBackgrounds('#00ff00', theme)[2].hex);
    assert.equal(backgroundTextWarnings(after[theme]).length, 0);
  }
  assert.ok(hexToLch(after.light.bg).L > .9);
  assert.ok(hexToLch(after.dark.bg).L < .3);
  state = resizeRubricPalette(state, 1);
  assert.match(buildRubricThemes(state).dark.bg, /^#[0-9a-f]{6}$/);
});

test('背景接近文字时精确报告用途，换回默认背景后警告消失', () => {
  let state = normalizeRubricState();
  for (const theme of ['light', 'dark']) {
    const original = buildRubricThemes(state)[theme];
    state.backgrounds[theme] = {mode: 'custom', color: original.text};
    const tokens = buildRubricThemes(state)[theme];
    assert.equal(tokens.text, original.text, '不偷偷更改字体颜色');
    assert.ok(backgroundTextWarnings(tokens).some(w => w.key === 'text' && w.ratio === 1));
    assert.equal(audit(tokens).find(c => c.key === 'text').pass, false);
    state.backgrounds[theme] = {mode: 'default'};
    assert.equal(backgroundTextWarnings(buildRubricThemes(state)[theme]).length, 0);
  }
  const restored = normalizeRubricState({backgrounds: {light: {mode: 'custom', color: 'bad'}}});
  assert.equal(buildRubricThemes(restored).light.bg, '#ffffff');
});
