// dream 的素材挑选：按日期打散，不许某个导入日吃掉一半预算
//
// 背景（1.12.55 真机跑出来的）：库里的记忆按导入批次排，最早那批 2026-10-27
// 一次性导入的画像一直占满前 40 条 —— 40 条里 31 条来自同一天，而归纳的硬标准
// 要求「证据跨 ≥2 个日期」，模型每次只能回空数组。这组测试盯的就是这件事。
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.DSH_HOME = process.env.DSH_HOME || 'G:/tmp/clay-dream-test-home'
const { 挑素材 } = await import('../lib/dream.mjs')

const 造条 = (id, 日期, 知识 = false) => ({
  id,
  createdAt: 日期 + 'T10:00:00.000Z',
  text: '记忆 ' + id,
  category: 'stable_profile',
  is_knowledge: 知识,
})

test('挑素材：极端偏斜的库（31 条同一天）不会让那天吃掉一半', () => {
  const 画像 = []
  for (let i = 0; i < 31; i += 1) 画像.push(造条('big' + i, '2026-10-27'))
  for (let i = 0; i < 10; i += 1) 画像.push(造条('other' + i, '2026-11-' + String(10 + i).padStart(2, '0')))
  const 出 = 挑素材(画像, [], 40)
  const 日日 = {}
  for (const m of 出) {
    const d = String(m.createdAt).slice(0, 10)
    日日[d] = (日日[d] || 0) + 1
  }
  assert.ok(日日['2026-10-27'] <= 20, '10-27 占比该明显降下来，实际 ' + 日日['2026-10-27'])
  assert.ok(Object.keys(日日).length >= 8, '该覆盖到 8 个以上日期，实际 ' + Object.keys(日日).length)
  assert.ok(出.length >= 20, '总条数不该太少，实际 ' + 出.length)
})

test('挑素材：每个日期都至少有 2 条额度（不会被大户挤没）', () => {
  const 画像 = []
  for (let i = 0; i < 30; i += 1) 画像.push(造条('big' + i, '2026-10-27'))
  画像.push(造条('one', '2026-11-01'))
  画像.push(造条('two', '2026-11-02'))
  const 出 = 挑素材(画像, [], 40)
  const ids = new Set(出.map((m) => m.id))
  assert.ok(ids.has('one'), '11-01 那条该被选中')
  assert.ok(ids.has('two'), '11-02 那条该被选中')
})

test('挑素材：知识条补足剩余预算', () => {
  const 画像 = [造条('p1', '2026-10-27'), 造条('p2', '2026-10-28')]
  const 知识 = []
  for (let i = 0; i < 20; i += 1) 知识.push(造条('k' + i, '2026-11-' + String(10 + (i % 8)).padStart(2, '0'), true))
  const 出 = 挑素材(画像, 知识, 12)
  assert.ok(出.length > 2, '该拿知识条补上来，实际 ' + 出.length)
  assert.ok(
    出.some((m) => m.is_knowledge),
    '补的应该是知识条',
  )
})

test('挑素材：空池不崩，返回空数组', () => {
  assert.deepEqual(挑素材([], [], 40), [])
})

test('挑素材：没 createdAt 的条不崩', () => {
  const 画像 = [{ id: 'x', text: '无日期', category: 'stable_profile' }]
  const 出 = 挑素材(画像, [], 5)
  assert.equal(出.length, 1)
  assert.equal(出[0].id, 'x')
})
