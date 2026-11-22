import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 1.12.52：记忆使用效率。
// 起因：`用上了()` 判定函数 2026-10 就写好了、设置页也有「像是用上了」那一栏，
//   但**没有任何地方调用它** —— 那一栏永远是空的。
// 这里测「按那一轮标」这个动作：同一条记忆在不同轮可能用/没用，
//   所以不能按 id 全局标（那是 标trace状态 干的事），只能标最近那一条 trace。
const home = mkdtempSync(join(tmpdir(), 'fish-use-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'clay-memory'), { recursive: true })

const { 追加trace, 读追溯, 标最近一轮, 标trace状态 } = await import('../lib/trace-log.mjs')

const 造 = (picked, id) => ({
  at: Date.now(),
  session: 's1',
  query: '测试问句',
  picked,
  rows: picked.map((x) => ({ id: x, C: 0.5, P: 0.5, omission: null, status: null })),
})

test('只在最近那一轮标：第一条 trace 原样不动', async () => {
  const sid = 'use-a'
  追加trace(sid, 造(['m1'], 'm1'))
  追加trace(sid, 造(['m1'], 'm1'))
  const 动 = 标最近一轮(sid, ['m1'], 'consumed')
  assert.equal(动, true)
  const 全部 = 读追溯(sid, 10)
  assert.equal(全部.length, 2, '两条 trace 都在')
  const 第一条状态 = (全部[0].rows.find((r) => r.id === 'm1') || {}).status
  const 第二条状态 = (全部[1].rows.find((r) => r.id === 'm1') || {}).status
  assert.equal(第二条状态, 'consumed', '最后一条必须标上')
  assert.equal(第一条状态, null, '前一条不许被顺手改（这正是不能复用 标trace状态 的原因）')
})

test('对比：按 id 标的老函数会把所有轮都改掉（所以有了新函数）', async () => {
  const sid = 'use-b'
  追加trace(sid, 造(['m2'], 'm2'))
  追加trace(sid, 造(['m2'], 'm2'))
  标trace状态(sid, 'm2', 'consumed')
  const 全部 = 读追溯(sid, 10)
  assert.equal((全部[0].rows[0] || {}).status, 'consumed', '老行为：两条都被改')
  assert.equal((全部[1].rows[0] || {}).status, 'consumed')
})

test('id 不匹配时不改任何东西', async () => {
  const sid = 'use-c'
  追加trace(sid, 造(['m3'], 'm3'))
  const 动 = 标最近一轮(sid, ['不存在的'], 'consumed')
  assert.equal(动, false)
  const 全部 = 读追溯(sid, 10)
  assert.equal((全部[0].rows[0] || {}).status, null)
})

test('空 ids 直接返回 false，不碰文件', async () => {
  const sid = 'use-d'
  追加trace(sid, 造(['m4'], 'm4'))
  assert.equal(标最近一轮(sid, [], 'consumed'), false)
  assert.equal(标最近一轮(sid, null, 'consumed'), false)
})

test('那条 trace 里没有 rows（没召回）时也不崩', async () => {
  const sid = 'use-e'
  追加trace(sid, { at: Date.now(), session: 's1', query: '空', picked: [], rows: [] })
  assert.equal(标最近一轮(sid, ['m5'], 'consumed'), false)
})

test('用上了() 的判定口径：两个实词以上才算，单字撞上不算', async () => {
  const { 用上了 } = await import('../lib/scoring.mjs')
  // 这条记忆的实词里有「西红柿」「鸡蛋」「卤肉」
  const 记忆 = '主人吃盖浇饭是西红柿鸡蛋派，卤肉也接受。'
  assert.equal(用上了('那给你点西红柿鸡蛋盖饭吧，卤肉也行', 记忆), true, '三个词都撞上，算用上')
  assert.equal(用上了('今天天气真好啊我们出去走走吧', 记忆), false, '一个词都不沾，不算')
  // 只有「吃」这种单字撞上，不该被算作用过
  assert.equal(用上了('你吃了吗', 记忆), false, '单字撞上不算（阈值要求 >= 2 个实词）')
})
