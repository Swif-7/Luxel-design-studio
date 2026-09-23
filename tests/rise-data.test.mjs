import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, parseLine, parseData, MAX_GROUPS, SAMPLE } from '../src/rise-data.js';

const vals = (line, opts) => parseLine(line, opts).items.map(x => x.value);

test('numbers: decimals, signs, units, currency, multipliers', () => {
  assert.equal(parseNumber('12.5').value, 12.5);
  assert.equal(parseNumber('-3').value, -3);
  assert.equal(parseNumber('−3').value, -3);
  assert.equal(parseNumber('(12)').value, -12);
  assert.equal(parseNumber('1e3').value, 1000);
  assert.equal(parseNumber('.5').value, .5);
  assert.deepEqual([parseNumber('35%').value, parseNumber('35%').suffix], [35, '%']);
  assert.deepEqual([parseNumber('¥1,200').value, parseNumber('¥1,200').prefix], [1200, '¥']);
  assert.equal(parseNumber('3.2万').value, 32000);
  assert.equal(parseNumber('3.2万').scaled, '万');
  assert.equal(parseNumber('1.5k').value, 1500);
  assert.equal(parseNumber('4M').value, 4e6);
  assert.equal(parseNumber('12件').suffix, '件');
  assert.equal(parseNumber('一月'), null);
  assert.equal(parseNumber('Q1'), null);
  assert.equal(parseNumber('(12'), null);
});

test('separators: spaces, tabs, full-width punctuation all split', () => {
  assert.deepEqual(vals('1 2   3'), [1, 2, 3]);
  assert.deepEqual(vals('1\t2\t3'), [1, 2, 3]);
  assert.deepEqual(vals('1，2、3；4;5|6'), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(vals('12, 30.5, 45'), [12, 30.5, 45]);
  assert.deepEqual(vals('12,30,45'), [12, 30, 45]);
  assert.deepEqual(vals('12%,30%,58%'), [12, 30, 58]);
});

test('thousands separators are kept together when the context says so', () => {
  assert.deepEqual(vals('2,000 3,500 1,200'), [2000, 3500, 1200]);
  assert.deepEqual(vals('2,000、3,500、1,200.5'), [2000, 3500, 1200.5]);
  assert.deepEqual(vals('2,000'), [2000]);                       // ,000 以 0 开头 → 千分位
  assert.deepEqual(vals('1,234.5'), [1234.5]);                   // 后面接小数 → 千分位
  assert.deepEqual(vals('1,234,567 89'), [1234567, 89]);
  assert.deepEqual(vals('"1,200","980","1,450"'), [1200, 980, 1450]);   // CSV 引号
  assert.deepEqual(vals('1,200,3'), [1, 200, 3]);                // 最后一组不是 3 位 → 不可能是千分位
});

test('an all-comma line of three-digit groups is ambiguous: list by default, thousands on request', () => {
  const g = parseLine('100,200,300');
  assert.equal(g.ambiguous, true);
  assert.deepEqual(g.items.map(x => x.value), [100, 200, 300]);
  assert.deepEqual(vals('100,200,300', { override: 'thousands' }), [100200300]);
  // 按千分位读正好对上表头的列数 → 默认千分位
  assert.deepEqual(vals('1,200', { columns: 1 }), [1200]);
});

test('group names from a colon or a leading text cell; labels from label:value pairs', () => {
  const a = parseLine('营收：¥1,200 ¥980 ¥1,450');
  assert.equal(a.name, '营收');
  assert.deepEqual(a.items.map(x => x.value), [1200, 980, 1450]);
  const b = parseLine('销售额,100,200,300');
  assert.equal(b.name, '销售额');
  assert.deepEqual(b.items.map(x => x.value), [100, 200, 300]);
  const c = parseLine('苹果 12 香蕉 30 橙子 18');
  assert.deepEqual(c.items.map(x => [x.label, x.value]), [['苹果', 12], ['香蕉', 30], ['橙子', 18]]);
  const d = parseLine('苹果:12 香蕉:30');
  assert.deepEqual(d.items.map(x => [x.label, x.value]), [['苹果', 12], ['香蕉', 30]]);
});

test('whole blocks: header row, up to 7 groups, prefixes and suffixes', () => {
  const r = parseData(SAMPLE);
  assert.deepEqual(r.labels, ['一月', '二月', '三月', '四月', '五月', '六月']);
  assert.equal(r.groups.length, 2);
  assert.equal(r.groups[0].name, '新用户');
  assert.deepEqual(r.groups[0].values, [1280, 1960, 1720, 2640, 2310, 3480]);
  const many = parseData(Array.from({ length: 10 }, (_, i) => `${i} ${i + 1}`).join('\n'));
  assert.equal(many.groups.length, MAX_GROUPS);
  assert.equal(many.dropped, 3);
  const pct = parseData('35% 25% 40%');
  assert.equal(pct.groups[0].suffix, '%');
  assert.equal(pct.labels, null);
  const pairs = parseData('苹果 12 香蕉 30');
  assert.deepEqual(pairs.labels, ['苹果', '香蕉']);
});

test('ambiguous lines are reported with their source line and can be overridden', () => {
  const text = '\n100,200,300\n1 2 3';
  const r = parseData(text);
  assert.deepEqual(r.ambiguousLines, [{ line: 1, mode: 'list' }]);
  assert.deepEqual(parseData(text, { 1: 'thousands' }).groups[0].values, [100200300]);
});

test('label:value pairs with spaces after the colon', () => {
  assert.deepEqual(parseLine('苹果: 12 香蕉: 30').items.map(x => [x.label, x.value]), [['苹果', 12], ['香蕉', 30]]);
});

test('rows: the chosen row becomes the axis, the others become groups', async () => {
  const { parseRows, rowsFromText, looksLikeAxis } = await import('../src/rise-data.js');
  const rows = ['月份 一月 二月 三月', '新用户：1,280 1,960 1,720', '回访：860 1,120 1,340', '', ''];
  const r = parseRows(rows, 0);
  assert.equal(r.axisName, '月份');
  assert.deepEqual(r.labels, ['一月', '二月', '三月']);
  assert.deepEqual(r.groups.map(g => [g.name, g.line]), [['新用户', 1], ['回访', 2]]);
  // 年份这类数字当横轴时是标签，不是数
  const years = parseRows(['2022 2023 2024', '营收 120 180 260'], 0);
  assert.deepEqual(years.labels, ['2022', '2023', '2024']);
  assert.equal(years.groups.length, 1);
  // 不指定横轴：每行都是一组，没有标签
  const none = parseRows(['1 2 3', '4 5 6'], null);
  assert.equal(none.groups.length, 2);
  assert.equal(none.labels, null);
  // 横轴换到别的行
  const swapped = parseRows(['一月 1 2', '二月 3 4', 'A B'], 2);
  assert.deepEqual(swapped.labels, ['A', 'B']);
  assert.equal(swapped.groups.length, 2);
  // 歧义按行号记
  assert.deepEqual(parseRows(['', '100,200,300'], null, { 1: 'thousands' }).groups[0].values, [100200300]);
  // 粘贴一整段：拆成行，第一行全是文字就当横轴
  assert.deepEqual(rowsFromText('月份 一月 二月\n新用户 1 2\n\n回访 3 4'), { rows: ['月份 一月 二月', '新用户 1 2', '回访 3 4'], axisRow: 0, extra: 0 });
  assert.equal(rowsFromText('1 2\n3 4').axisRow, null);
  assert.ok(looksLikeAxis('一月 二月 三月') && !looksLikeAxis('新用户 1 2'));
});
