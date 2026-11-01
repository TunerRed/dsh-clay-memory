// tests/patch-apply.test.mjs —— B 阶段回归：并发写回不再盖掉 await 期间的新增（2026-10-30）
import test from 'node:test'
import assert from 'node:assert/strict'
import { purgeEpochOf, 代际一致, 按id改写, 中间被改过, 按明细恢复, 拍字段, 拍一批, 没动过 } from '../lib/patch-apply.mjs'

// 场景还原（自动扩词 2026-10-24 踩过的「记忆静默丢失」）：
//   路由 await 问模型前 loadStore 拿快照，挑出批（旧对象引用）；
//   等模型那几秒里，另一路 remember 新记了一条；
//   旧代码 saveStore(sid, 旧快照) → 新记的那条被盖掉。
//   新代码 saveStore(sid, 新库)（重新读的），只改批内 id → 新增保得住。

test('按id改写：只改目标条目，await 期间新增的保留', () => {
  const 新库 = {
    purgeEpoch: 'e1',
    memories: [
      { id: 'a', text: '旧的' },
      { id: 'b', text: '旧的' },
      { id: '新增', text: '等模型那几秒里新记的' }, // ← 旧快照里没有
    ],
  }
  const 目标ids = ['a', 'b']
  const 改了 = 按id改写(新库, 目标ids, (m) => {
    m.text = '提炼过的'
    m.refinedAt = 't'
    return true
  })
  assert.equal(改了, 2)
  assert.equal(新库.memories[2].text, '等模型那几秒里新记的') // 新增没被盖
  assert.equal(新库.memories[0].text, '提炼过的')
  assert.equal(新库.memories[1].text, '提炼过的')
})

test('按id改写：目标条目中间被删/被合 → 跳过不硬写', () => {
  const 新库 = { purgeEpoch: 'e1', memories: [{ id: 'a', text: 'x' }] }
  const 改了 = 按id改写(新库, ['a', 'b'], (m) => { m.text = 'y'; return true })
  assert.equal(改了, 1) // b 不存在，跳过
  assert.equal(新库.memories.length, 1)
})

test('按id改写：改法返回 false 不计入「改了」', () => {
  const 新库 = { purgeEpoch: 'e1', memories: [{ id: 'a', text: 'x' }, { id: 'b', text: 'x' }] }
  const 改了 = 按id改写(新库, ['a', 'b'], (m) => (m.id === 'a' ? true : false))
  assert.equal(改了, 1)
})

test('代际一致：整库被清过（purgeEpoch 变了）→ 结果作废', () => {
  assert.equal(代际一致({ purgeEpoch: 'e1' }, { purgeEpoch: 'e1' }), true)
  assert.equal(代际一致({ purgeEpoch: 'e1' }, { purgeEpoch: 'e2' }), false)
  assert.equal(代际一致({}, {}), true) // 都没有代际 = 兼容老库
})

test('对照：旧「快照整份写回」模式会丢新增（证明改动的必要性）', () => {
  // 旧模式：await 前拿快照（含 a、b），await 期间新增 c，写回快照 → c 没了
  const 快照 = { purgeEpoch: 'e1', memories: [{ id: 'a' }, { id: 'b' }] }
  const 新增 = { id: 'c' }
  // 模拟旧代码 saveStore(sid, 快照)：快照里没有 c
  assert.equal(快照.memories.some((m) => m.id === 'c'), false)
  // 新代码：重新读库（含 c），按 id 改 a、b，saveStore 后 c 还在
  const 新库 = { purgeEpoch: 'e1', memories: [{ id: 'a' }, { id: 'b' }, 新增] }
  按id改写(新库, ['a', 'b'], () => true)
  assert.equal(新库.memories.some((m) => m.id === 'c'), true)
})

test('purgeEpochOf：缺字段 / 非字符串按空处理', () => {
  assert.equal(purgeEpochOf(null), '')
  assert.equal(purgeEpochOf({}), '')
  assert.equal(purgeEpochOf({ purgeEpoch: 123 }), '')
  assert.equal(purgeEpochOf({ purgeEpoch: 'e9' }), 'e9')
})

test('D-12 迁移：1.3.7 老库（无 version/purgeEpoch）不误判「被清理过」', () => {
  // 1.3.7 形状：只有 memories/deleted，没有 version、purgeEpoch、factsPurgeEpoch
  const 老库快照 = { memories: [{ id: 'a', text: '老记忆' }], deleted: [] }
  // 升级到 1.8.x 后 loadStore 按空库模板归一：version=2、purgeEpoch=''
  const 新库 = { version: 2, purgeEpoch: '', memories: [{ id: 'a', text: '老记忆' }, { id: 'b' }] }
  assert.equal(purgeEpochOf(老库快照), '') // 缺省 = 空代际
  assert.equal(代际一致(老库快照, 新库), true) // 都没清过 → 老快照正常放行，不误伤
  // 中间真被 purge 过（代际变 uuid）→ 老快照作废
  assert.equal(代际一致(老库快照, { ...新库, purgeEpoch: 'f3a1c9' }), false)
})

test('审查 B6：中间被标「别记」的目标 → 跳过不硬写', () => {
  // await 问模型那几秒里，她点了「这条不对」→ 新库里的目标带 别记
  const 新库 = {
    purgeEpoch: 'e1',
    memories: [
      { id: 'a', text: '旧的' },
      { id: 'b', text: '旧的', 别记: { at: 't', 原因: '这条不对' } },
    ],
  }
  const 改了 = 按id改写(新库, ['a', 'b'], (m) => {
    m.text = '提炼过的'
    return true
  })
  assert.equal(改了, 1) // 只有 a 被改
  assert.equal(新库.memories[1].text, '旧的') // b 原样（别记标记也还在）
  assert.deepEqual(新库.memories[1].别记, { at: 't', 原因: '这条不对' })
})

test('审查 B5：中间被改过的事实键不许覆盖（/refine、/wash-keys 的守卫）', () => {
  // 等模型那几秒里 facts/edit 把键 A 改成 B → 旧任务回来时新库当前键 ≠ 旧快照键
  assert.equal(中间被改过('键B', '键A'), true) // 被动过 → 守卫拦住，不写
  assert.equal(中间被改过('键A', '键A'), false) // 没动过 → 正常收键
  assert.equal(中间被改过(undefined, '键A'), true) // 中间被清掉也算被动过
  assert.equal(中间被改过('', undefined), false) // 一直都没有 → 不算
})

test('审查 P1-3：字段级撤销只动本批字段，别人改过的不动、删掉的不复活', () => {
  const data = {
    purgeEpoch: 'e1',
    memories: [
      // a：本批改过 type，中间没人再动 → 恢复旧值
      { id: 'a', text: '甲', type: 'preference', typeChecked: true, 事实键: 'x' },
      // b：本批改了 type，但中间又被改成别的 → 不动
      { id: 'b', text: '乙', type: 'misc', typeChecked: true },
      // c：本批补了日期，中间删了字段 → 不动（当前值 undefined ≠ 新值）
      { id: 'c', text: '丙' },
      // d：本批改了 category+importance → 全恢复
      { id: 'd', text: '丁', category: 'stable_profile', importance: 1, stableChecked: true },
    ],
  }
  const 改动 = [
    { id: 'a', 旧: { type: undefined }, 新: { type: 'preference' } },
    { id: 'b', 旧: { type: undefined }, 新: { type: 'identity' } },
    { id: 'c', 旧: { at: undefined }, 新: { at: '2026-10-30' } },
    { id: 'd', 旧: { category: 'event', importance: 0.5 }, 新: { category: 'stable_profile', importance: 1 } },
    { id: '没了', 旧: { type: undefined }, 新: { type: 'preference' } },
  ]
  const r = 按明细恢复(data, 改动)
  assert.equal(r.恢复条, 2) // a、d
  assert.equal(r.恢复字段, 3) // a.type + d.category + d.importance
  assert.equal(data.memories[0].type, undefined) // a 的 type 被删（旧值 undefined）
  assert.equal(data.memories[0].typeChecked, true) // 本批没碰过的字段不动
  assert.equal(data.memories[1].type, 'misc') // b 中间被改过 → 不动
  assert.equal('at' in data.memories[2], false) // c 当前没值 ≠ 新值 → 不动
  assert.equal(data.memories[3].category, 'event') // d 恢复
  assert.equal(data.memories[3].importance, 0.5)
  assert.equal(data.memories[3].stableChecked, true) // 没列进「新」的字段不动
  // 幂等：再跑一遍还是那几处（a.type 已经 undefined，新值 preference ≠ undefined → 跳过）
  const r2 = 按明细恢复(data, 改动)
  assert.deepEqual([r2.恢复条, r2.恢复字段], [0, 0])
})

test('审查 P1-3：空改动明细 / 没有明细时不动库', () => {
  const data = { purgeEpoch: 'e1', memories: [{ id: 'a', text: '甲', type: 'preference' }] }
  assert.deepEqual(按明细恢复(data, []), { 恢复条: 0, 恢复字段: 0 })
  assert.deepEqual(按明细恢复(data, undefined), { 恢复条: 0, 恢复字段: 0 })
  assert.equal(data.memories[0].type, 'preference')
})

test('GPT P1：拍字段 区分「不存在」与「=undefined」', () => {
  const m1 = { id: 'a', type: undefined }
  const m2 = { id: 'b' }
  assert.deepEqual(拍字段(m1, 'type'), { 有: true, 值: undefined })
  assert.deepEqual(拍字段(m2, 'type'), { 有: false, 值: undefined })
})

test('GPT P1：拍一批 建 id → 字段快照 Map', () => {
  const 批 = [{ id: 'a', type: 'event' }, { id: 'b' }]
  const 快照 = 拍一批(批, ['type', 'category'])
  assert.equal(快照.get('a').type.有, true)
  assert.equal(快照.get('a').type.值, 'event')
  assert.equal(快照.get('b').type.有, false)
  assert.equal(快照.get('b').category.有, false)
  assert.equal(快照.has('c'), false)
})

test('GPT P1：没动过 字段级 compare-and-set 语义', () => {
  const 快照 = 拍一批([{ id: 'a', type: 'event', importance: 1 }], ['type', 'importance', 'category']).get('a')
  // 没改过 → true
  assert.equal(没动过({ type: 'event', importance: 1 }, 快照, 'type'), true)
  // 值被改 → false（数组字段用深比较）
  assert.equal(没动过({ type: 'preference', importance: 1 }, 快照, 'type'), false)
  // 从「不存在」变「存在」→ false
  assert.equal(没动过({ type: 'event', importance: 1, category: 'x' }, 快照, 'category'), false)
  // 从「不存在」还是「不存在」→ true
  assert.equal(没动过({ type: 'event', importance: 1 }, 快照, 'category'), true)
  // 快照里没拍过的字段 → 查不了，保守当动过（false）
  assert.equal(没动过({ type: 'event' }, 快照, 'other'), false)
  // 「=undefined」被改成别的 → false；还等于 undefined → true（undefined/null 语义保留）
  const 快照2 = 拍一批([{ id: 'a', related: undefined }], ['related']).get('a')
  assert.equal(没动过({ related: ['x'] }, 快照2, 'related'), false)
  assert.equal(没动过({ related: undefined }, 快照2, 'related'), true)
})
