import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// 1.10.1 回归（chat-memory-benchmark PUB01 实测）：
//   召回的安全垫「退回」以前无条件退回 `q全部.filter(算线索)`，
//   于是「更喜欢哪种热饮」筛完只剩一个库里根本不存在的「饮」→ 全库 C=0，
//   一条都想不起来（偏好那条实测全丢）。
//   现在：只有在「退回的那批词在库里一个落点都没有」时才宽退，
//   且宽退只放行**这个库里有落点、而且不多**的词（0 < df ≤ 稀有门）。
const home = fs.mkdtempSync(join(tmpdir(), 'fish-fallback-test-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')
const { apply } = await import('../lib/index.js')
const directory = join(home, 'clay-memory')
fs.mkdirSync(directory, { recursive: true })
const file = (sid) => join(directory, sid + '.json')

function seed(sid, memories) {
  fs.writeFileSync(file(sid), JSON.stringify({ version: 2, policy: { factsMax: 0, threshold: 0.35 }, memories, deleted: [], traces: [] }))
}

function 注入文本(sid, 句子) {
  let recallText
  const agent = {
    session: { id: sid, snapshotEvents: () => [{ type: 'user/message', data: { text: 句子 } }] },
    ctx: { on: () => () => {}, tools: { register: () => () => {} }, systemPrompt: {
      section: () => () => {}, context: ({ text }) => { recallText = text; return () => {} },
    } },
  }
  apply({ agents: { list: () => [agent], get: () => agent }, sessions: { list: () => [] },
    get: () => null, on: () => () => {}, interval: () => () => {}, effect: (fn) => fn(),
    webServer: { register: () => () => {} } })
  assert.equal(typeof recallText, 'function')
  return recallText() || ''
}

test('同义替换不再全丢：「更喜欢哪种热饮」能想起「更喜欢热麦茶」', () => {
  const sid = 'fallback-drink'
  seed(sid, [{ id: 'a1', category: 'event', text: '当时说更喜欢热麦茶。' }])
  const out = 注入文本(sid, '我说过更喜欢哪种热饮？')
  assert.match(out, /热麦茶/, '「喜欢/热」在库里只出现在这一条，宽退要能指回来')
})

test('动词变体不再全丢：「发送消息」能想起「不要代发消息」', () => {
  const sid = 'fallback-send'
  seed(sid, [{ id: 'a1', category: 'event', text: '未经用户同意不要代发消息给同事。' }])
  const out = 注入文本(sid, '我当时关于替我发送消息设了什么边界？')
  assert.match(out, /代发消息/, '「消息」在库里只有这一条，必须召回')
})

test('宽退不许满屏噪声：问候语不靠通用词拉一堆无关记忆', () => {
  const sid = 'fallback-greet'
  seed(sid, [
    { id: 'a1', category: 'event', text: '主人的团险是单位报的，走 App「好福利」。' },
    { id: 'b1', category: 'event', text: '解释插件配置项时别假设有 config 字段就有界面入口。' },
  ])
  const out = 注入文本(sid, '早上好')
  assert.doesNotMatch(out, /团险|config/, '这句没有内容词，宁可不注入也不许拿通用词凑数')
})
