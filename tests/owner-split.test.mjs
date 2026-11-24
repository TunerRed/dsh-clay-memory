// 2026-11-24 修「记忆插件偏心」：记忆库分两栏 —— 她的档案（owner=user，默认）和我自己的手账（owner=self）。
//   要点：
//     ① 写入端能标 self，老数据没字段一律按 user 读
//     ② 两栏**不互相**「强化 / 自动作废 / 取代 / 事实键收敛」——
//        不然我记一句「我是鲸不是鱼」会强化她那句「主人叫我大肥鱼」，我用自己的话就把她的档案埋了
//     ③ 提取那条路能产出 voice（我表过态的那句话），落 self 栏
import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const 家 = mkdtempSync(join(tmpdir(), 'clay-owner-'))
process.env.DSH_HOME = 家
mkdirSync(join(家, 'clay-memory'), { recursive: true })

const tools = await import('../lib/tools.mjs')
const store = await import('../lib/store-core.mjs')
const scoring = await import('../lib/scoring.mjs')
const ep = await import('../lib/episode.mjs')
const names = await import('../lib/names.mjs')
const cfg = await import('../lib/cfg.mjs')
store.接报信(() => {})
tools.接报信(() => {})
tools.接定义工具((def) => def)
// names 的读配置是注入的（正式环境由 index.js 接上），测试里得自己接 —— 不接的话
// 一构造 remember 工具就炸（userPronoun → 读配置() → null）
names.接读配置(() => cfg.loadCfg())

const 记 = async (args, sid = 'sOwner') =>
  tools.makeRememberTool({}).execute(args, { agent: { sessionId: sid } })
const 读 = (sid = 'sOwner') => store.loadStoreJSON(sid).memories

const 同一句 = '主人喜欢在冬天吃热乎乎的大白饭，说是一天里最幸福的时候'

test('① 同一句话两栏各记一条 → 两条都在，不互相「几乎一样」作废', async () => {
  const a = await 记({ text: 同一句 })
  assert.equal(a.ok, true, '她的那条要记上：' + (a.message || ''))
  const b = await 记({ text: 同一句, 视角: 'self' })
  assert.equal(b.ok, true, '我的那条也要记上：' + (b.message || ''))
  const 们 = 读().filter((m) => String(m.text || '').includes('冬天吃热乎乎'))
  assert.equal(们.length, 2, '两栏各一条，不能被判成「重复」压掉一条')
  assert.deepEqual(们.map((m) => m.owner).sort(), ['self', 'user'], '默认 user，显式 self')
  assert.ok(们.every((m) => !m.已被取代), '谁都不该被作废')
})

test('② 同栏重记走「强化」，跨栏不算 —— 她的强化不能算到我头上', async () => {
  const 她前 = 读().find((m) => m.owner === 'user' && String(m.text || '').includes('冬天吃热乎乎'))
  const 我前 = 读().find((m) => m.owner === 'self' && String(m.text || '').includes('冬天吃热乎乎'))
  const 她旧 = 她前.reinforceCount || 0
  const 我旧 = 我前.reinforceCount || 0
  await 记({ text: 同一句 }) // 她这一栏又提一次
  const 她后 = 读().find((m) => m.id === 她前.id)
  const 我后 = 读().find((m) => m.id === 我前.id)
  assert.equal(她后.reinforceCount || 0, 她旧 + 1, '她自己的那条要变牢')
  assert.equal(我后.reinforceCount || 0, 我旧, '我的那条不该被她这句话强化')
})

test('③ `取代` 只能取代同栏：我说一句不能把她的档案标作废', async () => {
  const 她 = 读().find((m) => m.owner === 'user' && String(m.text || '').includes('冬天吃热乎乎'))
  const r = await 记({ text: '我偏说冬天吃冰的更痛快，才不管她那套「热乎最幸福」', 视角: 'self', 取代: 她.text })
  assert.equal(r.ok, true)
  const 她后 = 读().find((m) => m.id === 她.id)
  assert.ok(!她后.已被取代, '她的档案不能被我的话取代掉')
  // 她这一栏一条都不能少（我这一栏里被我自己那句取代是允许的，那是同栏内的正常收敛）
  assert.equal(读().filter((m) => m.owner === 'user' && m.已被取代).length, 0, '她的档案一条都不该被作废')
})

test('④ 事实键收敛也分栏：同一个键在两栏各留各的最新', async () => {
  const data = {
    memories: [
      { id: 'k1', text: '主人喜欢吃白饭', 事实键: '主人.主食', owner: 'user', at: '2026-11-01T00:00:00Z' },
      { id: 'k2', text: '我坚持白饭才是唯一主食', 事实键: '主人.主食', owner: 'self', at: '2026-11-02T00:00:00Z' },
    ],
  }
  const 作废 = scoring.按键收敛(data, '测试')
  assert.deepEqual(作废, [], '不同栏同一个键不能互相收敛')
  // 同栏两条才收敛 —— 不改变老行为
  const data2 = {
    memories: [
      { id: 'j1', text: '主人喜欢吃白饭', 事实键: '主人.主食', owner: 'user', at: '2026-11-01T00:00:00Z' },
      { id: 'j2', text: '主人改吃面了', 事实键: '主人.主食', owner: 'user', at: '2026-11-02T00:00:00Z' },
    ],
  }
  assert.deepEqual(scoring.按键收敛(data2, '测试'), ['j1'], '同栏还是只留最新')
})

test('⑤ 提取出 voice → 落我的手账：owner=self、event、不过期', () => {
  const now = Date.now()
  const 条 = ep.造条目({ kind: 'voice', text: '我被叫大肥鱼时坚持说自己是鲸，不是鱼', importance: 0.6 }, { now })
  assert.equal(条.owner, 'self')
  assert.equal(条.category, 'event')
  assert.equal(条.episode, 'voice')
  assert.equal(条.expireAt, undefined, '立场不该半个月就过期')
  const 普 = ep.造条目({ kind: 'state', text: '主人这周在出差', importance: 0.4 }, { now })
  assert.equal(普.owner, 'user', '普通条目还是她的')
})

test('⑥ 解析器收 voice，kind 乱写的照旧丢掉', () => {
  const 候选 = ep.解析候选(
    '[{"kind":"voice","text":"我说过我是鲸不是鱼，这点不让步","importance":0.6},' +
      '{"kind":"operation","text":"我读了 config.mjs 并改了三处参数","importance":0.5}]'
  )
  assert.equal(候选.length, 1)
  assert.equal(候选[0].kind, 'voice')
})
