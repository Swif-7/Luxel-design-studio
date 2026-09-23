// 多语言：界面以简体中文写成，其余语言按「中文原句 → 译文」对照。
// 这个文件不碰 DOM，Node 里也能用（Rubric 生成规范文本、测试）；页面上的自动翻译在 i18n-dom.js。
//
// 对照表的写法：{ '中文原句': ['English', '한국어', '日本語', 'Français'] }。
// 原句里可以带占位符 {0} {1} …，匹配时代表任意一段文字；占位的那段如果本身也在对照表里，会一并翻译。
// 品牌名、工具名、格式名（PNG、HEX、CSV …）、CSS 变量名等在所有语言里都保持英文原样，不进对照表。

export const LANGS = [
  { id: 'zh', name: '简体中文', short: '中', html: 'zh-CN' },
  { id: 'en', name: 'English', short: 'EN', html: 'en' },
  { id: 'ko', name: '한국어', short: '한', html: 'ko' },
  { id: 'ja', name: '日本語', short: '日', html: 'ja' },
  { id: 'fr', name: 'Français', short: 'FR', html: 'fr' },
];
const COLUMN = { en: 0, ko: 1, ja: 2, fr: 3 };
export const LANG_KEY = 'luxel-lang';

/* 当前语言：用户选过的优先；否则按浏览器语言；五种以外的一律英文 */
export function detectLang(saved, preferred = []) {
  if (LANGS.some(l => l.id === saved)) return saved;
  for (const tag of preferred) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (LANGS.some(l => l.id === base)) return base;
  }
  return preferred.length ? 'en' : 'zh';
}

let lang = 'zh';
export const getLang = () => lang;
export const setLang = (id) => { lang = LANGS.some(l => l.id === id) ? id : 'zh'; };

const exact = new Map();          // 原句 → [en, ko, ja, fr]
const patterns = [];              // { re, keys:[占位名…], row }
const norm = (s) => s.replace(/\u00a0/g, ' ');          // 不换行空格按普通空格对照（HTML 里的 &nbsp;）
export function register(table) {
  for (let [key, row] of Object.entries(table)) {
    key = norm(key);
    if (/\{\d+\}/.test(key)) {
      const names = [];
      const re = new RegExp('^' + key.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\d+)\}/g, (_, n) => { names.push(n); return '([\\s\\S]*?)'; }).replace(/[{}]/g, '\\$&') + '$');
      patterns.push({ re, names, row, key });
    } else exact.set(key, row);
  }
}

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));

/* t('已导出 {0} 个文件', { 0: 3 })：先按原句找译文，再把占位符填回去。中文或没有译文时返回原句。 */
/* 已经翻好的句子：页面上的自动翻译看到它们就跳过（日文译文里也有汉字，不然会被当成没翻的中文） */
export const produced = new Set();
/* 几段译文拼成的一句：整句也记下来，自动翻译看到时一样跳过 */
export function joined(...parts) {
  const out = parts.join('');
  if (lang !== 'zh') produced.add(out.trim());
  return out;
}
export function t(key, vars = {}) {
  if (lang === 'zh') return fill(key, vars);
  const row = exact.get(key) || patterns.find(p => p.key === key)?.row;
  // 传进来的可能是已经拼好的一句（比如 roleOf 给的「强调色 2」）：对照表里没有原句时按句式再找一次
  const loose = row ? null : translateText(key);
  const out = loose ?? fill(row && row[COLUMN[lang]] !== undefined ? row[COLUMN[lang]] : key, vars);   // 译文可以是空串（比如日语里用不上的介词）
  produced.add(out.trim());
  return out;
}

/* 同一个词在不同位置译法不同时（比如按钮上的 Default 和句子里的 default）：先找「上下文|原句」，没有再找原句 */
export function tc(ctx, key, vars = {}) {
  if (lang === 'zh') return fill(key, vars);
  return exact.has(`${ctx}|${key}`) ? t(`${ctx}|${key}`, vars) : t(key, vars);
}

/* 一段已经拼好的中文 → 译文：先整句对照，再试占位句式（占位的内容也递归翻译）。找不到返回 null。 */
export function translateText(text, depth = 0) {
  if (lang === 'zh') return null;
  text = norm(text);
  const col = COLUMN[lang];
  const hit = exact.get(text);
  if (hit) return hit[col] ?? null;
  if (depth > 3) return null;
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (!m) continue;
    const vars = {};
    p.names.forEach((n, i) => {
      const v = m[i + 1], core = v.trim();
      // 占位的那段：是中文就再翻一次（可能本身也是一句带占位符的句子），保留原来的首尾空白
      const tr = core && hasCJK(core) ? translateText(core, depth + 1) : null;
      vars[n] = tr === null ? v : v.replace(core, tr);
    });
    const out = p.row[col];
    return out === undefined ? null : fill(out, vars);
  }
  return null;
}

// 连中文标点一起算：单独一个「。」的文字节点也要换成对应语言的句号
export const hasCJK = (s) => /[㐀-鿿豈-﫿\u3001\u3002\u300c-\u300f]/.test(s);

/* 画布上的文字没有 CSS 的 :lang 可用：按语言把本语言的汉字 / 谚文字体排在中文字体前面 */
export function cjkFonts(id = lang) {
  if (id === 'ja') return '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo","PingFang SC"';
  if (id === 'ko') return '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR","PingFang SC"';
  return '"PingFang SC","Hiragino Sans GB","Microsoft YaHei"';
}
/* 页面加载时（语言还没初始化）先按 <html lang> 猜：头部的内联脚本已经把它设好了 */
export const pageLang = () => (typeof document !== 'undefined' ? (document.documentElement.lang || 'zh').slice(0, 2) : 'zh');
