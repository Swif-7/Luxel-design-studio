import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { keysOf, jsStrings, segments } from './i18n-extract.mjs';
import { register, setLang, translateText } from '../src/i18n.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const LANG_FILES = readdirSync(new URL('src/lang/', root)).filter(f => f.endsWith('.js'));
const tables = Object.fromEntries(await Promise.all(LANG_FILES.map(async f => [f, (await import(new URL(`src/lang/${f}`, root))).default])));
Object.values(tables).forEach(register);

// 不是界面文字的中文：字形素材、示例数据、旧版本存下的默认文字（用来迁移）、数量级单位（按语言单独处理）
const IGNORE = new Set([
  '山水风云光影流动星月花海梦雨', '流光01ABC+-', '点',
  '让截图自己会说话', '本地处理 · 一键复制 · 8 种排版',
  '千', '万', '百万', '亿', '億',
]);
const isSample = (s) => /\n/.test(s) && /[\d,]{4,}/.test(s);           // Rise 的示例数据
const isForeignDefault = (s) => /[぀-ヿ]/.test(s);               // 日语版的默认文字 / 示例

const SOURCES = [
  ...readdirSync(root).filter(f => f.endsWith('.html')),
  ...readdirSync(new URL('src/', root)).filter(f => f.endsWith('.js') && !f.startsWith('i18n')).map(f => `src/${f}`),
];

test('every lang row has four non-missing translations', () => {
  for (const [file, table] of Object.entries(tables))
    for (const [key, row] of Object.entries(table)) {
      assert.equal(row.length, 4, `${file}: ${key}`);
      row.forEach((v, i) => assert.equal(typeof v, 'string', `${file}: ${key} [${i}]`));
    }
});

test('placeholders survive translation', () => {
  for (const [file, table] of Object.entries(tables))
    for (const [key, row] of Object.entries(table)) {
      const want = [...key.matchAll(/\{\d\}/g)].map(m => m[0]).sort().join();
      row.forEach((v, i) => assert.equal([...v.matchAll(/\{\d\}/g)].map(m => m[0]).sort().join(), want, `${file}: ${key} [${i}]`));
    }
});

test('every Chinese UI string in the pages has a translation', () => {
  const known = new Set(Object.values(tables).flatMap(t => Object.keys(t).map(k => k.replace(/^[a-z]+\|/, '').replace(/ /g, ' '))));
  const covered = (s) => known.has(s) || known.has(s.trim()) || IGNORE.has(s) || isSample(s) || isForeignDefault(s);
  const missing = [];
  for (const lang of ['en', 'ko', 'ja', 'fr']) {
    setLang(lang);
    for (const file of SOURCES) {
      const src = read(file);
      // 整句在表里（比如带 <canvas> 标签、带前导空格的片段）：它按标签切出来的那几段就不再逐段查。
      // 只认「切出来的段」，不认任意子串 —— 否则「流动」会因为出现在另一句已翻译的话里被误判为有译文
      const pieces = new Set(file.endsWith('.js') ? jsStrings(src).map(s => s.text).filter(covered).flatMap(segments) : []);
      for (const key of keysOf(src, file.endsWith('.html') ? 'html' : 'js')) {
        if (covered(key) || pieces.has(key)) continue;
        if (!/\{\d\}/.test(key) && translateText(key) !== null) continue;   // 句式能拼出来
        missing.push(`${lang} ${file}: ${JSON.stringify(key)}`);
      }
    }
  }
  setLang('zh');
  assert.deepEqual(missing, []);
});
