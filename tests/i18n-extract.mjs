// 从源码里找出所有要翻译的中文：HTML 的文字和属性，JS 的字符串 / 模板字符串（模板里的 ${…} 记成 {0} {1} …）。
// 字符串里要是带 HTML 标签，就按标签切开 —— 页面上它们会是分开的文字节点，逐段翻译。
// 注释不算；正则字面量跳过。给测试用：保证每一段中文在对照表里都有四种语言。
const ATTRS = ['title', 'aria-label', 'placeholder', 'data-tip', 'alt', 'content'];
const CJK = /[㐀-鿿豈-﫿]/;

/* 一个够用的 JS 扫描器：认得注释、三种字符串、模板里的 ${}（可以嵌套）、正则字面量 */
export function jsStrings(src) {
  const out = [];
  let i = 0;
  const prevSignificant = (k) => { while (k >= 0 && /\s/.test(src[k])) k--; return k; };
  function code(stopAtBrace) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i], n = src[i + 1];
      if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? src.length : i + 2; continue; }
      if (c === '"' || c === "'") { out.push({ text: quoted(c), template: false }); continue; }
      if (c === '`') { out.push(template()); continue; }
      if (c === '/') {
        const p = prevSignificant(i - 1), pc = src[p];
        const word = /[\w$]/.test(pc || '') ? src.slice(0, p + 1).match(/[\w$]+$/)[0] : '';
        if (p < 0 || '(,=:[!&|?{};+-*%<>~^'.includes(pc) || ['return', 'typeof', 'case', 'of', 'in'].includes(word)) { regex(); continue; }
      }
      if (stopAtBrace) {
        if (c === '{') depth++;
        else if (c === '}') { if (depth === 0) { i++; return; } depth--; }
      }
      i++;
    }
  }
  function quoted(q) {
    let s = ''; i++;
    while (i < src.length && src[i] !== q) { if (src[i] === '\\') { s += unescape(src[i + 1]); i += 2; } else s += src[i++]; }
    i++; return s;
  }
  function template() {
    let s = '', k = 0; i++;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { s += unescape(src[i + 1]); i += 2; }
      else if (src[i] === '$' && src[i + 1] === '{') { i += 2; s += `{${k++}}`; code(true); }
      else s += src[i++];
    }
    i++; return { text: s, template: true };
  }
  function regex() {
    i++; let cls = false;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '[') cls = true; else if (c === ']') cls = false;
      else if (c === '/' && !cls) { i++; while (/[a-z]/i.test(src[i] || '')) i++; return; }
      else if (c === '\n') return;
      i++;
    }
  }
  const unescape = (c) => ({ n: '\n', t: '\t', "'": "'", '"': '"', '`': '`', '\\': '\\', $: '$' })[c] ?? c;
  code(false);
  return out;
}

/* 一段可能夹着 HTML 的文字 → 要翻译的片段（去掉首尾空白，占位符从 {0} 重新编号） */
export function segments(text) {
  const segs = [];
  const add = (s) => {
    s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
    if (!CJK.test(s)) return;
    let k = 0; const map = {};
    segs.push(s.replace(/\{(\d+)\}/g, (_, n) => `{${map[n] ??= k++}}`));
  };
  if (!/<[a-z!/]/i.test(text)) { add(text); return segs; }
  const re = /<([a-z][\w-]*|\/[a-z][\w-]*|!--)([^>]*)>/gi;
  let last = 0, m;
  while ((m = re.exec(text))) {
    add(text.slice(last, m.index));
    for (const a of ATTRS) {
      const am = new RegExp(`\\s${a}="([^"]*)"`).exec(m[2]);
      if (am) add(am[1]);
    }
    last = re.lastIndex;
  }
  add(text.slice(last));
  return segs;
}

export function htmlStrings(src) {
  const body = src.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const title = /<title>([^<]*)<\/title>/.exec(body)?.[1];
  const list = segments(body);
  if (title && CJK.test(title)) list.push(title.trim());
  return list;
}

/* 一个文件 → 去重后的片段 */
export function keysOf(src, kind) {
  const set = new Set();
  if (kind === 'html') htmlStrings(src).forEach(s => set.add(s));
  else for (const s of jsStrings(src)) segments(s.text).forEach(k => set.add(k));
  return [...set];
}
