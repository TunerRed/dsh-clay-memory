// 1.12.0 归档闸门：24h + 10 条才整理，整理只做「线索预筛 → 候选区」
import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const 家 = mkdtempSync(join(tmpdir(), 'clay-arch-'))
process.env.DSH_HOME = 家
mkdirSync(join(家, 'clay-memory'), { recursive: true })

const { 该整理了, 整理一次, 读归档状态, 归档文件, 是主人说的 } = await import('../lib/archive-gate.mjs')
const { 候选列表 } = await import('../lib/candidates.mjs')

const 小时 = 3600 * 1000

test('闸门：只有两个条件都满足才触发', () => {
  const now = Date.parse('2026-11-10T20:00:00+08:00')
  assert.strictEqual(该整理了({ lastRunAt: now - 23 * 小时, now, 未归档条数: 50 }), false) // 不够久
  assert.strictEqual(该整理了({ lastRunAt: now - 25 * 小时, now, 未归档条数: 9 }), false) // 不够多
  assert.strictEqual(该整理了({ lastRunAt: now - 25 * 小时, now, 未归档条数: 10 }), true)
  assert.strictEqual(该整理了({ lastRunAt: 0, now, 未归档条数: 10 }), true) // 从没跑过
})

test('整理一次：命中的进候选，状态落盘；重复调用不再触发', () => {
  // 候选文件是共享的（同一天 10 条上限），先清一遍
  try { rmSync(join(家, 'clay-memory', '_candidates.json')) } catch (error) {}
  const now = Date.parse('2026-11-10T21:00:00+08:00')
  const 文本们 = [
    '我答应阿岑这周三还她扳手',
    '我更喜欢热麦茶',
    '我在小剧场做灯光',
    '昨晚梦到舞台变成温室',
    '今天吃了盖浇饭',
    '天气有点冷',
    '中午睡过头了',
    '地铁上人很多',
    '本子用完了要买',
    '检查那批灯花了九十分钟', // process 线索
  ]
  const r = 整理一次({ 文本们, now, 会话: 's-arch' })
  assert.strictEqual(r.跑了, true)
  assert.strictEqual(r.扫了, 10)
  assert.strictEqual(r.挑出, 5) // 承诺 / 偏好 / 身份 / 梦 / 耗时
  assert.strictEqual(候选列表(now).length, 5)

  const 状态 = 读归档状态()
  assert.strictEqual(状态.lastRunAt, now)
  assert.strictEqual(状态.runs.length, 1)
  assert.ok(existsSync(归档文件()))

  const r2 = 整理一次({ 文本们, now: now + 小时, 会话: 's-arch' })
  assert.strictEqual(r2.跑了, false) // 才过 1 小时
})

test('凑不够 10 条就不碰状态：别把 lastRunAt 推进，否则永远攒不满', () => {
  const 现在 = Date.parse('2026-11-12T21:00:00+08:00')
  const 前 = 读归档状态().lastRunAt
  const r = 整理一次({ 文本们: ['我答应她周三还扳手'], now: 现在, 会话: 's-arch' })
  assert.strictEqual(r.跑了, false)
  assert.strictEqual(读归档状态().lastRunAt, 前)
})

test('状态文件坏了当没跑过（不抛）', () => {
  const p = 归档文件()
  writeFileSync(p, '{oops')
  const 状态 = 读归档状态()
  assert.strictEqual(状态.lastRunAt, 0)
  assert.deepStrictEqual(状态.runs, [])
  // 坏文件也能正常整理（覆盖写回）
  const now = Date.now()
  const r = 整理一次({ 文本们: new Array(10).fill('我答应周三还扳手'), now, 会话: 's-arch' })
  assert.strictEqual(r.跑了, true)
  assert.ok(readFileSync(p, 'utf8').includes('lastRunAt'))
})

test('只收主人说的话：插件/子代理递进来的消息不算用户原话', () => {
  // 主人亲手打的
  assert.strictEqual(是主人说的({ source: { kind: 'user' }, content: [] }), true)
  // 主动开口插件自己递的、子代理回调 —— 都不该进候选区
  assert.strictEqual(是主人说的({ source: { kind: 'plugin:dsh-proactive-msg' } }), false)
  assert.strictEqual(是主人说的({ source: { kind: 'agent-message' } }), false)
  assert.strictEqual(是主人说的({ source: { kind: 'subagent-settled' } }), false)
  // 老宿主没带 source / kind 为空 —— 按主人算，否则升级后一句话都收不到
  assert.strictEqual(是主人说的({ content: [] }), true)
  assert.strictEqual(是主人说的({ source: {} }), true)
  assert.strictEqual(是主人说的(null), true)
})
