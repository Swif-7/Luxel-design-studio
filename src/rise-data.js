// Rise 的数据解析：把粘贴进来的文字拆成最多 7 组数。纯函数，不碰 DOM，Node 里直接测。
//
// 一行一组。行内拆分规则：
//   · 永远算分隔符：空白、Tab、全角逗号「，」、顿号「、」、分号「;；」、竖线「|」
//   · 英文逗号后面跟空格 → 分隔符；逗号挨着文字（「销售额,12」）→ 分隔符
//   · 英文逗号夹在数字中间（「2,000」）要看上下文：
//       - 逗号后不是正好 3 位数（「12,30」）→ 分隔符
//       - 这一行还有别的数（「2,000 3,500」）、出现以 0 开头的三位组（「2,000」）、
//         后面接着小数（「1,234.5」）、被引号包着（CSV 的 "1,200"）、
//         或者按千分位读正好对上表头的列数 → 千分位
//       - 其余（「100,200,300」整行只用逗号）→ 默认按分隔符拆，标记为「有歧义」，页面上可一键改成千分位
//   · 小数点、负号（含全角 −）、括号负数 (12)、科学计数 1e3 都认成一个数
//   · 前后缀单独记下：¥ $ € £ 前缀，% ‰ 元 等后缀；k / 千 / w / 万 / M / 亿 / B 按倍数换算成数值

export const MAX_GROUPS = 7;

const SEP = /[\s，、;；|]+/;
const NUM = /^([^\d\-−+.(]*?)(\(?)([-−+]?)(\d[\d,]*(?:\.\d+)?|\.\d+)(?:[eE]([-+]?\d+))?(\)?)(.*)$/;
const MULT = { k: 1e3, K: 1e3, '千': 1e3, '천': 1e3, w: 1e4, W: 1e4, '万': 1e4, '만': 1e4, M: 1e6, '百万': 1e6, '亿': 1e8, '億': 1e8, '억': 1e8, B: 1e9 };
/* 「1月」「2월」「3日」「2024年」这类是标签（横轴上的日期），不是带单位的数 */
const DATE_SUFFIX = /^(月|日|年|号|号|월|일|년|時|点|分|秒|시)$/;
const PREFIX_OK = /^[¥￥$€£₩₹]?$/;

/* 单个记号 → 数。千分位的逗号在这之前已经决定好（thousands=true 时去掉逗号）。
   不是数就返回 null。 */
export function parseNumber(token) {
  const m = NUM.exec(String(token).trim());
  if (!m) return null;
  const [, prefix, open, sign, digits, exp, close, rest] = m;
  if (!PREFIX_OK.test(prefix.trim())) return null;
  if (!!open !== !!close) return null;                                       // 括号要成对：(12) 是负数
  let suffix = rest.trim();
  let mult = 1, scaled = '';
  for (const key of Object.keys(MULT).sort((a, b) => b.length - a.length)) {
    if (suffix.startsWith(key)) { mult = MULT[key]; scaled = key; suffix = suffix.slice(key.length).trim(); break; }
  }
  if (suffix && !/^[%‰a-zA-Z一-鿿°℃]{1,4}$/.test(suffix)) return null;
  if (DATE_SUFFIX.test(suffix) && !scaled) return null;
  let value = Number(digits.replace(/,/g, '')) * (exp ? 10 ** Number(exp) : 1) * mult;
  if (!Number.isFinite(value)) return null;
  if (sign === '-' || sign === '−' || open) value = -value;
  return { value, prefix: prefix.trim(), suffix, scaled };
}

const isNumeric = (t) => parseNumber(t) !== null;

/* 数字串里的逗号能不能读成千分位：1–3 位开头，后面每组正好 3 位，可带小数。 */
const THOUSANDS = /^[^\d\-−+.(]*?\(?[-−+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?\)?[^\d,]*$/;
const clearlyThousands = (chain) => /,0\d\d/.test(chain) || /,\d{3}\.\d/.test(chain);

/* 把一行切成记号：先把引号里的内容整个保护起来（CSV 的 "1,200"），再按分隔符拆，
   然后把「挨着文字的英文逗号」和「逗号 + 空格」也当分隔符。 */
function tokenize(line) {
  const quoted = [];
  const safe = line.replace(/"([^"]*)"/g, (_, q) => { quoted.push(q); return `\u0000${quoted.length - 1}\u0000`; });
  const parts = safe.replace(/,\s+/g, ' ').split(SEP).flatMap(p => p.split(/,(?=[^\d\-−+.(]|$)|(?<=[^\d%)]),/)).filter(Boolean);
  return parts.map(p => {
    const m = /^\u0000(\d+)\u0000$/.exec(p);
    return m ? { text: quoted[+m[1]], quoted: true } : { text: p.replace(/\u0000(\d+)\u0000/g, (_, i) => quoted[+i]), quoted: false };
  });
}

/* 「名称：12 30」「苹果:12」这种冒号：行首的是组名，记号里的是「标签:值」。 */
function splitName(line) {
  const m = /^\s*([^:：\d\-−+.$¥￥€£(][^:：]*?)\s*[:：]\s*(?=\S)/.exec(line);
  if (m && !isNumeric(m[1])) return { name: m[1].trim(), body: line.slice(m[0].length) };
  return { name: '', body: line };
}

/* 一行 → { name, items:[{ label, value, prefix, suffix }], ambiguous, mode }。
   mode：这一行歧义逗号最终怎么读（'thousands' | 'list'）；override 是页面上用户点过的选择。 */
export function parseLine(line, { override = null, columns = 0 } = {}) {
  let { name, body } = splitName(line);
  if (name && /[:：]/.test(body)) { name = ''; body = line; }              // 「苹果:12 香蕉:30」：每个数都带标签，开头那个也不是组名
  const tokens = tokenize(body).flatMap(t => {
    if (t.quoted) return [t];
    const m = /^([^:：\d]+)[:：](.+)$/.exec(t.text);           // 苹果:12
    return m ? [{ text: m[1], quoted: false }, { text: m[2], quoted: false }] : [t];
  });
  // 一行里有几个「数」记号（按千分位的读法算）——决定歧义逗号怎么读
  const numericCount = tokens.filter(t => isNumeric(t.text)).length;
  const chains = tokens.filter(t => !t.quoted && t.text.includes(',') && THOUSANDS.test(t.text));
  let ambiguous = false, mode = 'list';
  if (chains.length) {
    if (numericCount >= 2 || chains.some(c => clearlyThousands(c.text))) mode = 'thousands';
    else {
      ambiguous = true;
      const asList = chains.reduce((n, c) => n + c.text.split(',').length, 0) + numericCount - chains.length;
      mode = columns && numericCount === columns && asList !== columns ? 'thousands' : 'list';
    }
    if (ambiguous && override) mode = override;
  }
  const items = [];
  let pending = '', headCell = false;
  for (const t of tokens) {
    const pieces = t.quoted || !t.text.includes(',') ? [t.text]
      : THOUSANDS.test(t.text) && mode === 'thousands' ? [t.text]
        : t.text.split(',').filter(Boolean);
    for (const piece of pieces) {
      const n = parseNumber(piece);
      if (n) { items.push({ label: pending, ...n }); pending = ''; }
      else if (!items.length && !name && !pending) { name = piece.replace(/[:：]$/, ''); headCell = true; }   // 第一个不是数的记号：组名（表格粘贴时的行头）
      else pending = (pending ? pending + ' ' : '') + piece.replace(/[:：]$/, '');
    }
  }
  // 「苹果 12 香蕉 30」：后面每个数都带标签，那开头那个文字其实是第一个数的标签，不是组名
  if (headCell && items.length > 1 && !items[0].label && items.slice(1).every(x => x.label)) { items[0].label = name; name = ''; }
  return { name, items, ambiguous, mode };
}

/* 整段文字 → { labels, groups, dropped, ambiguousLines }。
   labels：表头（第一行全是文字、且不止一个），或第一组自带的「标签:值」。
   overrides：{ 行号: 'thousands' | 'list' }，行号是原文里的行（从 0 起）。 */
export function parseData(text, overrides = {}) {
  const lines = String(text || '').split(/\r?\n/).map((l, i) => ({ l: l.trim(), i })).filter(x => x.l);
  let labels = null, start = 0;
  if (lines.length) {
    const head = tokenize(splitName(lines[0].l).body);
    const allText = head.length >= 2 && head.every(t => !isNumeric(t.text));
    if (allText) {
      // 表头第一格常是「月份」「项目」这类列名，后面一行的行头也是文字时就把它去掉
      labels = head.map(t => t.text);
      start = 1;
    }
  }
  const groups = [], ambiguousLines = [];
  let dropped = 0;
  for (const { l, i } of lines.slice(start)) {
    const g = parseLine(l, { override: overrides[i] || null, columns: labels ? labels.length : 0 });
    if (!g.items.length) continue;
    if (groups.length >= MAX_GROUPS) { dropped++; continue; }
    if (g.ambiguous) ambiguousLines.push({ line: i, mode: g.mode });
    const prefix = g.items.find(x => x.prefix)?.prefix || '';
    const suffix = g.items.find(x => x.suffix)?.suffix || '';
    const scaled = g.items.find(x => x.scaled)?.scaled || '';
    groups.push({ line: i, name: g.name || `第 ${groups.length + 1} 组`, values: g.items.map(x => x.value), itemLabels: g.items.map(x => x.label), prefix, suffix, scaled, ambiguous: g.ambiguous, mode: g.mode });
  }
  // 表头比数据多一格、而且各组都有行头 → 表头第一格是列名，去掉
  if (labels && groups.length) {
    const n = Math.max(...groups.map(g => g.values.length));
    if (labels.length === n + 1) labels = labels.slice(1);
  }
  if (!labels && groups[0]?.itemLabels.some(Boolean)) labels = groups[0].itemLabels.map((x, i) => x || String(i + 1));
  return { labels, groups, dropped, ambiguousLines };
}

export const SAMPLE = `月份 一月 二月 三月 四月 五月 六月
新用户：1,280 1,960 1,720 2,640 2,310 3,480
回访：860 1,120 1,340 1,500 1,980 2,210`;

/* ── 按行填写 ─────────────────────────────────────────────────────────
   页面上数据是一行一个输入框，其中哪一行是横轴由用户点按钮指定（axisRow，可以没有）。
   横轴那一行只拆成文字标签（年份这类数字也当标签）；其余非空行各是一组，照 parseLine 拆数。
   overrides 按行号记：{ 行号: 'thousands' | 'list' }。 */
export const MIN_ROWS = 5, MAX_ROWS = MAX_GROUPS + 1;

export function axisLabels(line) {
  let { name, body } = splitName(line);
  const labels = tokenize(body).map(t => t.text.trim()).filter(Boolean);
  return { name, labels };
}

/* groupName(n)：没写组名时怎么叫第 n 组（页面按界面语言给） */
export function parseRows(rows, axisRow = null, overrides = {}, groupName = (n) => `第 ${n} 组`) {
  let labels = null, axisName = '';
  if (axisRow !== null && (rows[axisRow] || '').trim()) ({ name: axisName, labels } = axisLabels(rows[axisRow]));
  const groups = [], ambiguousLines = [];
  let dropped = 0;
  rows.forEach((raw, i) => {
    const line = (raw || '').trim();
    if (!line || i === axisRow) return;
    const g = parseLine(line, { override: overrides[i] || null, columns: labels ? labels.length : 0 });
    if (!g.items.length) return;
    if (groups.length >= MAX_GROUPS) { dropped++; return; }
    if (g.ambiguous) ambiguousLines.push({ line: i, mode: g.mode });
    groups.push({ line: i, name: g.name || groupName(groups.length + 1), values: g.items.map(x => x.value), itemLabels: g.items.map(x => x.label),
      prefix: g.items.find(x => x.prefix)?.prefix || '', suffix: g.items.find(x => x.suffix)?.suffix || '', scaled: g.items.find(x => x.scaled)?.scaled || '',
      ambiguous: g.ambiguous, mode: g.mode });
  });
  // 横轴那行比数据多一格：第一格是列名（「月份 一月 … 六月」），挪去当横轴名称
  if (labels && groups.length) {
    const n = Math.max(...groups.map(g => g.values.length));
    if (n >= 2 && labels.length === n + 1 && !axisName) { axisName = labels[0]; labels = labels.slice(1); }
  }
  if (!labels && groups[0]?.itemLabels.some(Boolean)) labels = groups[0].itemLabels.map((x, i) => x || String(i + 1));
  return { labels, axisName, groups, dropped, ambiguousLines };
}

/* 一段文字（粘贴 / CSV / 旧版存档）→ 行，并猜横轴：第一行全是文字（且不止一格）就当横轴 */
export function rowsFromText(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let axisRow = null;
  if (lines.length > 1) {
    const head = tokenize(splitName(lines[0]).body);
    if (head.length >= 2 && head.every(t => !isNumeric(t.text))) axisRow = 0;
  }
  return { rows: lines.slice(0, MAX_ROWS), axisRow, extra: Math.max(0, lines.length - MAX_ROWS) };
}
/* 一行里一个数都没有、但有文字 —— 多半是横轴，页面上提示「设为横轴？」 */
export const looksLikeAxis = (line) => { const t = tokenize(splitName(line).body); return t.length >= 2 && t.every(x => !isNumeric(x.text)); };
