import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 1.12.1 回归：evidence 是**对象**（1.11.0 的「拼证据」形状），不是数组。
//   以前校验器只认数组 → 一条带证据的记忆（梦/虚构/假设）就把整个会话库判「已损坏」：
//     ① loadStore 丢掉这条，注入里再也看不到；
//     ② saveStore 拒绝写回 → 之后所有 remember 静默失败。
//   2026-11-11 真机 360 轮里，第 2 条（一个梦）之后日志刷了 1022 条「拒绝写回」。
const home = mkdtempSync(join(tmpdir(), 'fish-ev-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')

const { loadCfg } = await import('../lib/cfg.mjs')
const names = await import('../lib/names.mjs')
names.接读配置(loadCfg)
const tools = await import('../lib/tools.mjs')
tools.接定义工具((def) => def)
tools.接报信(() => {})
const { loadStore } = await import('../lib/store-core.mjs')
const scoring = await import('../lib/scoring.mjs')

mkdirSync(join(home, 'clay-memory'), { recursive: true })

const 造工具 = () => tools.makeRememberTool({ agents: { list: () => [] }, interval: () => () => {}, on: () => {} })
const 会话 = (sid, 文本) => ({
  agent: {
    session: {
      id: sid,
      snapshotEvents: () => [{ type: 'user/message', data: { text: 文本, source: { kind: 'user' } } }],
    },
  },
})

test('evidence 是对象时不该被判成坏库', async () => {
  const sid = 'ev-a'
  const 梦 = '我梦见剧场的舞台变成了一片森林，观众席上全是树'
  const r = await 造工具().execute({ text: 梦, 性质: 'dream' }, 会话(sid, 梦))
  assert.equal(r.ok, true)
  const 库 = loadStore(sid).memories
  assert.equal(库.length, 1, '带证据的那条必须能被读回来')
  assert.equal(typeof 库[0].evidence, 'object', 'evidence 应该是个对象')
  assert.ok(库[0].evidence.excerpt.length > 0, '证据里要有原话片段')
})

test('带证据的记忆写进去之后，后面的记忆还能继续写', async () => {
  const sid = 'ev-b'
  const 梦 = '我梦见自己在雨里等一班永远不来的车'
  await 造工具().execute({ text: 梦, 性质: 'dream' }, 会话(sid, 梦))
  const r2 = await 造工具().execute({ text: '阿岑借了我一把活动扳手' }, 会话(sid, '阿岑借了我一把活动扳手'))
  assert.equal(r2.ok, true, '第二条不该被坏库拦住')
  assert.equal(loadStore(sid).memories.length, 2)
})

test('原话兜底能吃到 evidence 里的 excerpt（对象形状）', async () => {
  const sid = 'ev-c'
  const 梦 = '梦见舞台上长满了树，观众席也全是树'
  await 造工具().execute({ text: 梦, 性质: 'dream' }, 会话(sid, 梦))
  const data = loadStore(sid)
  const now = Date.now()
  const 兜底 = scoring.原话兜底(data, '舞台上那些树是怎么回事', now)
  assert.ok(兜底, '应该在证据池里撞到')
  assert.equal(兜底.kind, 'excerpt')
})
