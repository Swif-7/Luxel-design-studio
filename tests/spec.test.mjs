import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTheme, audit, contrast, adaptAccent, toMarkdown, hexToLch} from '../src/spec.js';

const params = {hue: 250, chroma: 2, contrast: 1, accent: '#3b5bdb', accent2: '#e8590c', duo: true};
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
  const t = buildTheme({...params, duo: false}, 'light');
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
          const t = buildTheme({hue, chroma, contrast: spread, accent: '#3b5bdb', duo: false}, theme);
          const row = audit(t).find(c => c.key === 'border-strong');
          assert.ok(row.pass, `hue${hue} c${chroma} s${spread} ${theme} → ${row.ratio}`);
        }
});

test('滑块推到极端时告警会出现，而不是静默放行', () => {
  // 对比强度压到最低，正文必然贴近底色
  const t = buildTheme({hue: 0, chroma: 0, contrast: .3, accent: '#888888', duo: false}, 'light');
  assert.ok(audit(t).some(c => !c.pass), '极端参数下应当报出未达标');
});
