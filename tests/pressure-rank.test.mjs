import test from 'node:test';
import assert from 'node:assert/strict';
import { 默认参数, 新鲜度, 算挤占, 挤占排序, 第一层, 从追溯数已写 } from '../lib/pressure-rank.mjs';

const 一天 = 24 * 3600 * 1000;
const NOW = Date.parse('2026-11-11T01:00:00+08:00');

test('新鲜度线性掉，12 天归零', () => {
  assert.equal(新鲜度({ at: NOW }, NOW), 6);
  assert.equal(新鲜度({ at: NOW - 6 * 一天 }, NOW), 3);
  assert.equal(新鲜度({ at: NOW - 12 * 一天 }, NOW), 0);
  assert.equal(新鲜度({ at: NOW - 40 * 一天 }, NOW), 0);
  assert.equal(新鲜度({}, NOW), 0);
});

test('承重能压过新鲜度：旧但承重的事实排前面', () => {
  const 旧重 = { id: 'a', text: '她是我的人', at: NOW - 30 * 一天, 承重: 1 };
  const 新轻 = { id: 'b', text: '今天吃了饺子', at: NOW };
  const 排好 = 挤占排序([新轻, 旧重], NOW);
  assert.equal(排好[0].id, 'a');
});

test('已写过扣分封顶 3 分', () => {
  const 条 = { id: 'x', text: 't', at: NOW, importance: 1 };
  const 一次 = 算挤占(条, NOW, 默认参数, 1).明细.已写扣;
  const 二十次 = 算挤占(条, NOW, 默认参数, 20).明细.已写扣;
  assert.equal(一次, 0.75);
  assert.equal(二十次, 3);
});

test('第一层卡条数与字数', () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, text: 'x'.repeat(300), at: NOW - i * 一天 }));
  const 层 = 第一层(items, NOW, { ...默认参数, 第一层条数: 30, 第一层字数: 6000 });
  assert.ok(层.length <= 20, `字数上限应把它截到 20 条以内，实际 ${层.length}`);
  assert.ok(层.length > 0);
});

test('只换顺序，不增不减', () => {
  const items = [
    { id: 'a', text: 'a', at: NOW - 10 * 一天 },
    { id: 'b', text: 'b', at: NOW },
    { id: 'c', text: 'c', at: NOW - 3 * 一天 },
  ];
  const 排好 = 挤占排序(items, NOW);
  assert.deepEqual(new Set(排好.map((x) => x.id)), new Set(['a', 'b', 'c']));
  assert.equal(排好.length, 3);
  assert.equal(排好[0].id, 'b');
});

test('空输入不炸', () => {
  assert.deepEqual(挤占排序([], NOW), []);
  assert.deepEqual(第一层(undefined, NOW), []);
});

test('从追溯数已写：picked 里出现几次就是几次', () => {
  const 表 = 从追溯数已写([{ picked: ['a', 'b'] }, { picked: ['a'] }, { picked: [] }, {}]);
  assert.equal(表.get('a'), 2);
  assert.equal(表.get('b'), 1);
  assert.equal(表.get('zzz'), undefined);
});

test('类型加成生效', () => {
  const 事实 = { id: 'f', text: 't', at: NOW, category: 'stable_profile' };
  const 普通 = { id: 'n', text: 't', at: NOW, category: 'event' };
  assert.ok(算挤占(事实, NOW).分 > 算挤占(普通, NOW).分);
});
