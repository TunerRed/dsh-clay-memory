import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 1.12.51：写入端收长度。
// 起因：一直在优化「注入时怎么省预算」，但新的长笔记每天都在往库里灌
//   （2026-11-18 实测活跃 382 条里 45 条超 300 字、均长 195 字）。
// 这里测的是「提醒」而不是「截断」—— 写的时候手里有完整上下文，
// 拆不拆该由写的人判断，插件只负责把「这条偏长了」这句话说出口。
const home = mkdtempSync(join(tmpdir(), 'fish-wl-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')

const { loadCfg } = await import('../lib/cfg.mjs')
const names = await import('../lib/names.mjs')
names.接读配置(loadCfg)
const tools = await import('../lib/tools.mjs')
tools.接定义工具((def) => def)
tools.接报信(() => {})
const { loadStore, saveStore } = await import('../lib/store-core.mjs')

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

const 短 = '主人喜欢在晚上十一点之后喝水，说那时候水是甜的。'
const 长 = '这是一条测试用的长记忆，用来验证写入端会不会提醒它偏长了。'.repeat(14) // 约 380 字

test('默认提醒线是 300 字', async () => {
  const d = loadStore('wl-default')
  assert.equal(d.policy.写入长度提醒, 300)
})

test('短记忆不提醒', async () => {
  const r = await 造工具().execute({ text: 短 }, 会话('wl-a', 短))
  assert.equal(r.ok, true)
  assert.ok(!r.message.includes('偏长'), '短的不该冒出长度提醒')
})

test('长记忆提醒并报出实际字数和提醒线', async () => {
  const r = await 造工具().execute({ text: 长 }, 会话('wl-b', 长))
  assert.equal(r.ok, true)
  const n = Array.from(长).length
  assert.ok(n > 300, '夹具本身要超过 300 字，否则测不到')
  assert.ok(r.message.includes(String(n) + ' 字'), '要报出这条实际多少字')
  assert.ok(r.message.includes('300'), '要报出提醒线是多少')
  assert.ok(r.message.includes('拆'), '要给出「拆成两条」这个建议')
})

test('正好等于提醒线不算超', async () => {
  const 正好 = '字'.repeat(300)
  const r = await 造工具().execute({ text: 正好 }, 会话('wl-c', 正好))
  assert.equal(r.ok, true)
  assert.ok(!r.message.includes('偏长'), '等于线不该算超')
})

test('提醒线设成 0 就完全不提醒（回归老行为）', async () => {
  const sid = 'wl-d'
  await 造工具().execute({ text: 短 }, 会话(sid, 短))
  const d = loadStore(sid)
  d.policy.写入长度提醒 = 0
  saveStore(sid, d)
  const r = await 造工具().execute({ text: 长 }, 会话(sid, 长))
  assert.equal(r.ok, true)
  assert.ok(!r.message.includes('偏长'), '关掉以后不该再念叨')
  // 关掉提醒不影响记账本身
  assert.ok(loadStore(sid).memories.length >= 2, '提醒关着也照样记进去了')
})

test('提醒归提醒，内容一个字都不少存', async () => {
  const sid = 'wl-e'
  const r = await 造工具().execute({ text: 长 }, 会话(sid, 长))
  assert.equal(r.ok, true)
  const 存下来 = loadStore(sid).memories.find((m) => m.text === 长)
  assert.ok(存下来, '库里必须是全文，不能被提醒顺手截短')
  assert.equal(存下来.text.length, 长.length)
})
