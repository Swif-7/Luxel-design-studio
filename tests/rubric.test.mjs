import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {recommend} from '../src/spec.js';

const source = await readFile(new URL('../src/rubric.js', import.meta.url), 'utf8');
const start = source.indexOf('function reconcile(');
const end = source.indexOf('\nfunction renderRows(', start);
assert.ok(start >= 0 && end > start);
const reconcile = vm.runInNewContext(`(${source.slice(start, end)})`);

// Minimal DOM fixture for identity and orphan-node regression checks.
function fixture(keys = []) {
  const container = {children: [], insertBefore(node, next) {
    node.remove();
    const index = next ? this.children.indexOf(next) : this.children.length;
    this.children.splice(index, 0, node);
  }};
  const create = () => ({dataset: {}, remove() {
    const index = container.children.indexOf(this);
    if (index >= 0) container.children.splice(index, 1);
  }});
  container.children = keys.map(key => Object.assign(create(), {dataset: {key}}));
  return {container, create};
}

test('recommendation rerenders keep seven stable buttons despite repeated harmony labels', () => {
  const {container, create} = fixture();
  let original;
  for (let i = 0; i < 100; i++) {
    const palette = recommend(i % 2 ? '#3b5bdb' : '#c2255c');
    reconcile(container, palette, (_, index) => index, create, (node, item) => {node.hex = item.hex;});
    assert.equal(container.children.length, 7);
    if (!original) original = [...container.children];
    container.children.forEach((node, index) => {
      assert.equal(node, original[index], 'existing buttons must retain their identity');
      assert.equal(node.hex, palette[index].hex);
    });
  }
});

test('reconcile removes duplicate and legacy nodes rather than leaving orphans', () => {
  const keys = Array.from({length: 70}, (_, i) => i % 2 ? '分裂互补' : String(i % 7));
  const {container, create} = fixture(keys);
  reconcile(container, recommend('#3b5bdb'), (_, index) => index, create, () => {});
  assert.equal(container.children.length, 7);
  assert.deepEqual(container.children.map(node => node.dataset.key), ['0', '1', '2', '3', '4', '5', '6']);
});
