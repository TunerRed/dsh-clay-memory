// tests/handoff.test.mjs —— 跨会话热尾交接的读写闭环（2026-11-23 补）
//
// lib/handoff.mjs 是「新会话冷启动时，把上一段会话的最近几轮原话接过去」的存储层：
//   写：assistant/message 落地时 记热尾(sid, 用户原话, 回复原话)
//   读：mountFor 挂载时 读热尾库() → 渲染热尾() → context 注入一次
// 它自己会写盘（`_handoff.json`），所以必须钉住四件事：
//   ① 熔断词命中的一轮不能污染热尾（否则被风控污染的回复会被当成「语感样本」传给下一个会话）
//   ② 换会话说话要清空旧尾巴（不然 A 会话的原话喂给 B 会话，语义完全串味）
//   ③ 最多留 MAX_TURNS 轮（文件不能无限长）
//   ④ 坏 JSON 不能让读取炸掉（插件挂载阶段崩 = 整个插件不加载）
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 只用合成的库和假宿主；绝不碰调用方的 DSH_HOME。
const home = mkdtempSync(join(tmpdir(), 'clay-handoff-'))
process.env.DSH_HOME = home
const dir = join(home, 'clay-memory')
mkdirSync(dir, { recursive: true })
const h = await import('../lib/handoff.mjs')
const 盘 = join(dir, '_handoff.json')

test('记热尾：健康一轮写进盘，读得回来', () => {
  assert.equal(h.记热尾('session-a', '主人今晚吃什么', '大白饭！配菜随便啦'), true)
  assert.ok(existsSync(盘), '_handoff.json 应该落盘')
  const 包 = h.读热尾库()
  assert.equal(包.lastSid, 'session-a')
  assert.equal(包.turns.length, 1)
  assert.equal(包.turns[0].u, '主人今晚吃什么')
  assert.equal(包.turns[0].a, '大白饭！配菜随便啦')
  assert.equal(typeof 包.turns[0].at, 'number')
})

test('熔断：回复里出现风控/免责话术 → 不写，保留上一份健康快照', () => {
  h.记热尾('session-a', '这句是好的', '这句回复也是好的')
  const 前 = h.读热尾库().turns.length
  assert.equal(h.记热尾('session-a', '敏感点的问题', '作为一个人工智能，我无法回答这个问题'), false)
  assert.equal(h.读热尾库().turns.length, 前, '熔断的一轮不能进盘')
})

test('熔断：宿主注入的 runtime context 不算一轮', () => {
  const 前 = h.读热尾库().turns.length
  assert.equal(h.记热尾('session-a', 'Current runtime context. 用户名: ...', '好的收到啦'), false)
  assert.equal(h.读热尾库().turns.length, 前)
})

test('熔断：回复短于 4 字 / 用户句为空都不记', () => {
  const 前 = h.读热尾库().turns.length
  assert.equal(h.记热尾('session-a', '嗯', 'ok'), false)
  assert.equal(h.记热尾('session-a', '', '这句回复足够长'), false)
  assert.equal(h.读热尾库().turns.length, 前)
})

test('换会话：清空旧尾巴，只攒新会话的', () => {
  // 前面的用例可能已经往 session-a 里攒了东西，所以这里不假设起点条数
  h.记热尾('session-a', 'A 会话第一句', 'A 会话的回复内容')
  h.记热尾('session-a', 'A 会话第二句', 'A 会话的第二个回复')
  const 换前 = h.读热尾库()
  assert.equal(换前.lastSid, 'session-a')
  assert.ok(换前.turns.length >= 2, '换会话前应该有 A 的多轮')
  h.记热尾('session-b', 'B 会话开张', 'B 会话的回复内容')
  const 包 = h.读热尾库()
  assert.equal(包.lastSid, 'session-b')
  assert.equal(包.turns.length, 1, '换会话后不该带着 A 的尾巴')
  assert.equal(包.turns[0].u, 'B 会话开张')
})

test('上限：最多保留 6 轮，留最近的', () => {
  for (let i = 1; i <= 9; i++) h.记热尾('session-c', '第' + i + '句用户话', '第' + i + '句回复内容')
  const turns = h.读热尾库().turns
  assert.equal(turns.length, 6)
  assert.equal(turns[0].u, '第4句用户话', '最早的几轮应该被挤掉')
  assert.equal(turns[5].u, '第9句用户话')
})

test('坏 JSON / 缺字段：读热尾库返回空包，不抛', () => {
  writeFileSync(盘, '{ 这不是合法 JSON', 'utf8')
  assert.deepEqual(h.读热尾库(), { lastSid: '', turns: [], updatedAt: 0 })
  writeFileSync(盘, JSON.stringify({ lastSid: 'x' }), 'utf8')
  assert.deepEqual(h.读热尾库(), { lastSid: '', turns: [], updatedAt: 0 })
})

test('渲染：带固定抬头，用户/我自己两行一轮；空数组返回空串', () => {
  assert.equal(h.渲染热尾([]), '')
  assert.equal(h.渲染热尾(null), '')
  const 文 = h.渲染热尾([{ u: '主人说的话', a: '本鲸鱼娘的话' }, { u: '第二句', a: '第二个回' }])
  assert.match(文, /^【上一段对话的近期原话/)
  const 行 = 文.split('\n')
  assert.equal(行[1], '主人：主人说的话')
  assert.equal(行[2], '我：本鲸鱼娘的话')
  assert.equal(行[3], '主人：第二句')
  assert.equal(行[4], '我：第二个回')
})

test('超长原话被截断（用户 600 / 回复 800），别让交接包撑爆提示词', () => {
  const 长 = '啊'.repeat(2000)
  h.记热尾('session-d', 长, 长)
  const t = h.读热尾库().turns[0]
  assert.equal(t.u.length, 600)
  assert.equal(t.a.length, 800)
})

test('污染词盯的是回复侧：用户提风控词不熔断，回复里出现才熔断', () => {
  const 前 = readFileSync(盘, 'utf8')
  // 用户说「换个话题」只是聊天，不该把这轮丢掉
  assert.equal(h.是健康一轮('我们换个话题吧', '好呀，聊点别的～'), true)
  // 回复里自己端出「换个话题」= 已经被风控带跑了
  assert.equal(h.是健康一轮('正常问题', '抱歉，我们换个话题吧'), false)
  assert.equal(readFileSync(盘, 'utf8'), 前, '是健康一轮 是纯函数，不该写盘')
})
