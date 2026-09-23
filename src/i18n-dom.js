// 页面上的自动翻译 + 语言切换按钮。
// 页面照旧用中文写；这里在加载后把文字节点和 title / aria-label / placeholder / data-tip / alt 按对照表换掉，
// 之后动态生成的面板、提示条、悬停说明也由 MutationObserver 接着翻。标了 translate="no" 的区域（用户自己的数据）不碰。
import { LANGS, LANG_KEY, detectLang, getLang, setLang, register, translateText, hasCJK, produced } from './i18n.js';
import common from './lang/common.js';

const ATTRS = ['title', 'aria-label', 'placeholder', 'data-tip', 'alt'];
const done = new WeakMap();                 // 文字节点 → 翻过后的内容：再次触发时认得出是自己改的
export const misses = new Set();            // 没找到译文的中文（调试用：window.__i18nMisses）

function skip(el) { return !!el?.closest?.('[translate="no"], script, style, textarea'); }
// 属性另算：文本框里是用户内容，但它自己的 aria-label / placeholder 是界面文字
function skipAttrs(el) { return !!el?.closest?.('[translate="no"], script, style'); }

function translateTextNode(node) {
  const v = node.nodeValue;
  if (!v || !node.isConnected || !hasCJK(v) || done.get(node) === v || skip(node.parentElement)) return;
  const core = v.trim();
  if (produced.has(core)) return;
  const out = translateText(core);
  if (out === null) { misses.add(core); return; }
  produced.add(out.trim());
  const next = v.replace(core, out);
  done.set(node, next);
  node.nodeValue = next;
}
function translateAttrs(el) {
  if (skipAttrs(el)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (!v || !hasCJK(v)) continue;
    if (produced.has(v.trim())) continue;
    const out = translateText(v.trim());
    if (out === null) misses.add(v.trim()); else if (out !== v) { produced.add(out.trim()); el.setAttribute(a, out); }
  }
}
function translateTree(root) {
  if (root.nodeType === 3) return translateTextNode(root);
  if (root.nodeType !== 1 && root.nodeType !== 9) return;
  if (root.nodeType === 1) translateAttrs(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) n.nodeType === 3 ? translateTextNode(n) : translateAttrs(n);
}

/* 页面入口调用：注册对照表 → 定语言 → 翻译现有内容 → 盯住之后的变化 */
export function initI18n(...tables) {
  register(common);
  tables.forEach(register);
  let saved = null;
  try { saved = localStorage.getItem(LANG_KEY); } catch {}
  setLang(detectLang(saved, navigator.languages || [navigator.language]));
  const lang = getLang(), meta = LANGS.find(l => l.id === lang);
  document.documentElement.lang = meta.html;
  if (lang !== 'zh') {
    const title = translateText(document.title); if (title) document.title = title;
    const desc = document.querySelector('meta[name=description]');
    if (desc) { const d = translateText(desc.content); if (d) desc.content = d; }
    translateTree(document.body);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') translateTextNode(m.target);
        else if (m.type === 'attributes') translateAttrs(m.target);
        else m.addedNodes.forEach(translateTree);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    window.__i18nMisses = misses;
  }
  document.documentElement.classList.remove('i18n-wait');
  return lang;
}

/* 语言切换：一颗胶囊按钮（地球 + 当前语言缩写），点开是五种语言的小菜单；选了就记住并刷新页面 */
const GLOBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.6 5.4 3.6 8.5s-1.2 5.9-3.6 8.5M12 3.5C9.6 6.1 8.4 8.9 8.4 12s1.2 5.9 3.6 8.5"/></svg>';
export function mountLangSwitch(host, { place = 'append', compact = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'lang-switch' + (compact ? ' compact' : '');
  wrap.setAttribute('translate', 'no');
  const cur = LANGS.find(l => l.id === getLang());
  wrap.innerHTML = `<button type="button" class="lang-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Language · ${cur.name}">${GLOBE}<span>${compact ? cur.short : cur.name}</span></button>`
    + `<div class="lang-menu" role="menu" hidden>${LANGS.map(l => `<button type="button" role="menuitemradio" aria-checked="${l.id === cur.id}" lang="${l.html}" data-lang="${l.id}">${l.name}</button>`).join('')}</div>`;
  const btn = wrap.querySelector('.lang-btn'), menu = wrap.querySelector('.lang-menu');
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) menu.querySelector('[aria-checked=true]')?.focus(); };
  menu.onclick = (e) => {
    const b = e.target.closest('[data-lang]');
    if (!b) return;
    if (b.dataset.lang === getLang()) { close(); return; }
    try { localStorage.setItem(LANG_KEY, b.dataset.lang); } catch {}
    location.reload();
  };
  menu.onkeydown = (e) => {
    const items = [...menu.querySelectorAll('button')], i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Escape') { close(); btn.focus(); }
  };
  addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });
  if (place === 'prepend') host.prepend(wrap); else if (place === 'before') host.before(wrap); else host.append(wrap);
  return wrap;
}
