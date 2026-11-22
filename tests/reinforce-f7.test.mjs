import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// F7（1.10.3）回归：
//   ① 回血挂 picked（真进提示词的那几条），不是 scored.slice(0,24)；
//   ② 每会话每小时只攒一次，攒下的搭下一次写盘的便车落进活跃度；
//   ③ trace 带 turn / step（宿主不给，自己合成）。
const home = mkdtempSync(join(tmpdir(), 'fish-f7-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')

const { loadCfg } = await import('../lib/cfg.mjs')
const names = await import('../lib/names.mjs')
names.接读配置(loadCfg)
const tools = await import('../lib/tools.mjs')
tools.接定义工具((def) => def)
tools.接报信(() => {})
const reinforce = await import('../lib/reinforce.mjs')
const { loadStore, saveStore } = await import('../lib/store-core.mjs')
const { 读追溯 } = await import('../lib/trace-log.mjs')
const { apply } = await import('../lib/index.js')

mkdirSync(join(home, 'clay-memory'), { recursive: true })

const 造工具 = () => tools.makeRememberTool({ agents: { list: () => [] }, interval: () => () => {}, on: () => {} })
const argv = (sid) => ({ agent: { session: { id: sid } } })

test('标回血：一小时只攒一次；上一批没落盘就合并', () => {
  const t0 = Date.parse('2026-05-01T10:00:00Z')
  assert.equal(reinforce.标回血('s1', ['a', 'b'], t0), true)
  assert.equal(reinforce.标回血('s1', ['c'], t0 + 10 * 60 * 1000), false, '一小时内不重复攒')
  assert.equal(reinforce.标回血('s1', ['c'], t0 + 61 * 60 * 1000), true, '过一小时再攒，旧的合并进来')
  const ids = reinforce.取回血('s1').sort()
  assert.deepEqual(ids, ['a', 'b', 'c'])
  assert.deepEqual(reinforce.取回血('s1'), [], '取一次就清空')
})

test('应用回血：只抬被选中的那几条，跳过已被取代 / 标了不对', () => {
  const now = Date.parse('2026-05-01T12:00:00Z')
  const data = {
    policy: {},
    memories: [
      { id: 'x', text: '用上了的', category: 'event', at: '2026-05-01T10:00:00Z' },
      { id: 'y', text: '没选中的', category: 'event', at: '2026-05-01T10:00:00Z' },
      { id: 'z', text: '选中的但作废了', category: 'event', at: '2026-05-01T10:00:00Z', 已被取代: { 为什么: '被覆盖' } },
    ],
  }
  reinforce.标回血('s2', ['x', 'z'], now)
  const n = reinforce.应用回血(data, 's2', now, {})
  assert.equal(n, 1, '只回血一条')
  const x = data.memories[0]
  assert.equal(x.reinforceCount, 1)
  assert.ok(x.activationAnchor, '锚点要挪到现在')
  assert.equal(data.memories[1].reinforceCount, undefined, '没选中的不动')
  assert.equal(data.memories[2].reinforceCount, undefined, '作废的不回血')
})

test('攒下的回血会跟着下一次 saveStore 落库', async () => {
  const sid = 'f7-a'
  await 造工具().execute({ text: '我养了一只叫团子的猫', importance: 0.8 }, argv(sid))
  const before = loadStore(sid).memories.find((m) => m.text.includes('团子'))
  reinforce.标回血(sid, [before.id], Date.now())
  const data = loadStore(sid)
  saveStore(sid, data)
  const after = loadStore(sid).memories.find((m) => m.id === before.id)
  assert.ok(after.reinforceCount >= 1, '写盘时要把攒的回血落下去')
})

test('注入：trace 带 turn/step，回血只挂 picked', async () => {
  const sid = 'f7-b'
  await 造工具().execute({ text: '我对香菜过敏', importance: 0.9 }, argv(sid))
  let recallText
  const session = {
    id: sid,
    snapshotEvents: () => [
      { type: 'user/message', data: { text: '你好' } },
      { type: 'assistant/message', data: { text: '在的' } },
      { type: 'user/message', data: { text: '我对香菜过敏，别给我点' } },
    ],
  }
  const agent = {
    session,
    ctx: {
      on: () => () => {},
      tools: { register: () => () => {} },
      systemPrompt: {
        section: () => () => {},
        context: ({ text }) => {
          recallText = text
          return () => {}
        },
      },
    },
  }
  apply({
    agents: { list: () => [agent], get: () => agent },
    sessions: { list: () => [] },
    get: () => null,
    on: () => () => {},
    interval: () => () => {},
    effect: (fn) => fn(),
    webServer: { register: () => () => {} },
  })
  const out = recallText() || ''
  assert.match(out, /香菜/, '这句该想起过敏那条')
  const 记录 = 读追溯(sid)
  const 最后 = 记录[记录.length - 1]
  assert.ok(最后, '应该有 trace')
  assert.equal(最后.turn, 2, 'turn = 你是第几条消息')
  assert.ok(最后.step >= 1, 'step 要有个号')
  assert.equal(最后.回血, true, '第一次注入要攒回血')
  assert.ok(Array.isArray(最后.picked) && 最后.picked.length >= 1)
})
