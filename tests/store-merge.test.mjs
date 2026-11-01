import test from 'node:test'
import assert from 'node:assert/strict'
import { 合并库 } from '../lib/store-merge.mjs'

const memory = (id, extra = {}) => ({ id, text: 'fixture ' + id, createdAt: '2026-10-01T00:00:00Z', ...extra })
const store = (memories = [], deleted = []) => ({ version: 2, policy: {}, memories, deleted, traces: [] })
const ids = (items) => items.map((m) => m.id).sort()

test('manual expansion stale snapshot cannot resurrect a later deletion', () => {
  const stale = store([memory('a'), memory('b')])
  const disk = store([memory('b')], [memory('a', { deletedAt: '2026-10-25T00:00:00Z' })])
  stale.memories[1].related = ['expanded']
  stale.memories[1].relatedAt = '2026-10-25T00:01:00Z'
  const result = 合并库(disk, stale)
  assert.deepEqual(ids(result.memories), ['b'])
  assert.deepEqual(ids(result.deleted), ['a'])
  assert.deepEqual(result.memories[0].related, ['expanded'])
})

test('even a later expansion timestamp cannot override deletion', () => {
  const result = 合并库(store([], [memory('a', { deletedAt: '2026-10-25T00:00:00Z' })]),
    store([memory('a', { relatedAt: '2026-10-25T00:01:00Z' })]))
  assert.equal(result.memories.length, 0)
  assert.deepEqual(ids(result.deleted), ['a'])
})

test('an explicit restore restores only selected records', () => {
  const result = 合并库(store([], [memory('a'), memory('b')]), store([memory('a'), memory('b')]), { restoreIds: ['a'] })
  assert.deepEqual(ids(result.memories), ['a'])
  assert.deepEqual(ids(result.deleted), ['b'])
})

test('batch restore preserves unrelated tombstones', () => {
  const result = 合并库(store([], [memory('a'), memory('b'), memory('c')]), store([memory('a'), memory('b')]), { restoreIds: ['a', 'b'] })
  assert.deepEqual(ids(result.memories), ['a', 'b'])
  assert.deepEqual(ids(result.deleted), ['c'])
})

test('a restore id without an active record cannot erase a tombstone', () => {
  const result = 合并库(store([], [memory('a')]), store(), { restoreIds: ['a'] })
  assert.deepEqual(ids(result.deleted), ['a'])
})

test('newly added records and newer disk edits survive an older snapshot', () => {
  const disk = store([memory('a', { text: 'new', editedAt: '2026-10-25T00:00:00Z' }), memory('new')])
  const result = 合并库(disk, store([memory('a')]))
  assert.deepEqual(ids(result.memories), ['a', 'new'])
  assert.equal(result.memories.find(m => m.id === 'a').text, 'new')
})

test('deletion in the current write is also respected', () => {
  const result = 合并库(store([memory('a')]), store([], [memory('a')]))
  assert.equal(result.memories.length, 0)
  assert.deepEqual(ids(result.deleted), ['a'])
})

test('merging the same store is idempotent and does not mutate inputs', () => {
  const input = store([memory('a')], [memory('b')])
  const before = structuredClone(input)
  assert.deepEqual(合并库(input, input), input)
  assert.deepEqual(input, before)
})

// ⭐ B 阶段（2026-10-30）：状态字段（refine/洗键/补类型/别记）不受「更新时间」裁决 ——
//   它们不更新 editedAt，两边拿旧快照交错写时，A 刚提炼的成果不许被 B 的旧快照盖掉。
test('refine state on disk survives a stale write snapshot', () => {
  const 盘 = store([memory('a', { text: '提炼过的', refinedAt: '2026-10-30T10:00:00Z', textBefore: '原文' })])
  const 写 = store([memory('a', { text: '原文' })]) // 旧快照：还没提炼
  const result = 合并库(盘, 写)
  const a = result.memories.find((m) => m.id === 'a')
  assert.equal(a.refinedAt, '2026-10-30T10:00:00Z')
  assert.equal(a.textBefore, '原文')
})

test('wash-key state survives a stale snapshot from the other side', () => {
  // 盘：洗过了（有键）；写：旧快照（没键、更新时间更旧被整条顶掉）
  const 盘 = store([memory('a', { 事实键: '她.生日', 洗键过: '2026-10-30T10:00:00Z', 键来源: '清洗补键' })])
  const 写 = store([memory('a')])
  const result = 合并库(盘, 写)
  const a = result.memories.find((m) => m.id === 'a')
  assert.equal(a.事实键, '她.生日')
  assert.equal(a.洗键过, '2026-10-30T10:00:00Z')
  assert.equal(a.键来源, '清洗补键')
})

test('stale snapshot cannot erase type / stableChecked / 别记 from disk', () => {
  const 盘 = store([memory('a', { type: 'identity', typeChecked: true, stableChecked: true, 别记: { at: 't', 原因: '这条不对' } })])
  const 写 = store([memory('a')])
  const result = 合并库(盘, 写)
  const a = result.memories.find((m) => m.id === 'a')
  assert.equal(a.type, 'identity')
  assert.equal(a.typeChecked, true)
  assert.equal(a.stableChecked, true)
  assert.deepEqual(a.别记, { at: 't', 原因: '这条不对' })
})

test('the newer side wins conflicts on its own fields; stale fields are only filled in', () => {
  // 盘比写新（editedAt 更新）→ 盘的 text 胜；写带 refinedAt（盘没有）→ 补上
  const 盘 = store([memory('a', { text: '新文本', editedAt: '2026-10-30T12:00:00Z' })])
  const 写 = store([memory('a', { text: '旧文本', refinedAt: '2026-10-30T11:00:00Z' })])
  const result = 合并库(盘, 写)
  const a = result.memories.find((m) => m.id === 'a')
  assert.equal(a.text, '新文本')
  assert.equal(a.refinedAt, '2026-10-30T11:00:00Z')
})

test('GPT P1：盘上墓碑比「读盘时刻」新 → 旧快照不得复活（别处刚删）', () => {
  // 调用方读盘于 10:00，但盘上这条 10:05 才被别处删掉 → 不该被我们的 restoreIds 复活
  const 盘 = store([], [memory('a', { deletedAt: '2026-10-25T10:05:00Z' })])
  const 写 = store([memory('a')])
  const result = 合并库(盘, 写, { restoreIds: ['a'], 读盘于: '2026-10-25T10:00:00Z' })
  assert.deepEqual(ids(result.memories), [])
  assert.deepEqual(ids(result.deleted), ['a'])
})

test('GPT P1：盘上墓碑早于「读盘时刻」 → 正常找回', () => {
  const 盘 = store([], [memory('a', { deletedAt: '2026-10-25T09:00:00Z' })])
  const 写 = store([memory('a')])
  const result = 合并库(盘, 写, { restoreIds: ['a'], 读盘于: '2026-10-25T10:00:00Z' })
  assert.deepEqual(ids(result.memories), ['a'])
  assert.deepEqual(ids(result.deleted), [])
})

test('GPT P1：没传「读盘时刻」→ 行为不变（无条件找回）', () => {
  const 盘 = store([], [memory('a', { deletedAt: '2026-10-25T10:05:00Z' })])
  const 写 = store([memory('a')])
  const result = 合并库(盘, 写, { restoreIds: ['a'] })
  assert.deepEqual(ids(result.memories), ['a'])
})
