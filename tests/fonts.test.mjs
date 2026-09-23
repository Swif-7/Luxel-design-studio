// 画进图片 / 导出的文字只用项目自带的 IBM Plex（SIL OFL，随仓库分发）。
// 汉字、假名、谚文 Plex 没有，落到用户系统自带的无衬线字体 —— 那不是我们分发的，没关系；
// 但不能再指定任何衬线、手写之类的第三方字体（Georgia、宋体、楷体、Comic Sans……）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { STYLES, FONTS } from '../src/rise-core.js';

test('every Rise style uses a font stack that starts with IBM Plex', () => {
  for (const [key, stack] of Object.entries(FONTS)) assert.match(stack, /^"IBM Plex (Sans|Mono)"/, key);
  for (const st of STYLES) assert.ok(FONTS[st.font], `${st.id} uses unknown font "${st.font}"`);
});

test('no source file names a third-party display, serif or handwriting typeface', () => {
  const banned = /Georgia|Times New Roman|Songti|STSong|SimSun|Kaiti|KaiTi|STKaiti|Comic Sans|Chalkboard|Baskerville|Didot|Palatino|Garamond|cursive|fantasy/;
  const root = new URL('../', import.meta.url);
  const files = [...readdirSync(root).filter(f => /\.(html|css)$/.test(f)), ...readdirSync(new URL('src/', root)).filter(f => f.endsWith('.js')).map(f => 'src/' + f)];
  for (const f of files) {
    // 注释里提到这些名字（比如解释为什么不用）没关系，只看代码
    const code = readFileSync(new URL(f, root), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, banned, f);
  }
});
