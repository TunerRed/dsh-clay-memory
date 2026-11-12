import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// 1.12.19（F10 阶段 0）：「画像免证据名额」回归 ——
//   factsAlwaysTopN > 0 时，排序最前的 N 条稳定事实不看证据也进常驻层；
//   0（默认）时行为必须跟 11-04「无关问句别被事实塞满」完全一致。
const home = fs.mkdtempSync(join(tmpdir(), 'fish-facts-always-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')
const { apply } = await import('../lib/index.js')
const directory = join(home, 'clay-memory')
fs.mkdirSync(directory, { recursive: true })
const file = sid => join(directory, sid + '.json')

function seed(sid, memories, policy = {}) {
  fs.writeFileSync(file(sid), JSON.stringify({
    version: 2,
    policy: { factsMax: 6, threshold: 0.35, queryGate: 0, ...policy },
    memories,
    deleted: [],
    traces: [],
  }))
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
    get: () => null, on: () => () => {}, interval: () => () => {}, effect: fn => fn(),
    webServer: { register: () => () => {} },
  })
  assert.equal(typeof recallText, 'function')
  return recallText() || ''
}

const 两条 = [
  { id: 'p1', category: 'stable_profile', importance: 1, text: '主人是程序员，主要写 TypeScript' },
  { id: 'p2', category: 'stable_profile', importance: 0.5, text: '喜欢泰拉瑞亚挖矿和看视频' },
]

test('免证据名额 2：无关问句也带上两条画像', () => {
  const sid = 'always-2'
  seed(sid, 两条, { factsAlwaysTopN: 2 })
  const out = 注入文本(sid, '今天天气怎么样')
  assert.match(out, /TypeScript/, '第一条免门画像要在')
  assert.match(out, /泰拉瑞亚/, '第二条免门画像也要在')
})

test('免证据名额 0（默认）：无关问句一条都不带', () => {
  const sid = 'always-0'
  seed(sid, 两条, { factsAlwaysTopN: 0 })
  const out = 注入文本(sid, '今天天气怎么样')
  assert.doesNotMatch(out, /TypeScript/, '默认行为不能变：没证据就不进')
  assert.doesNotMatch(out, /泰拉瑞亚/, '默认行为不能变：没证据就不进')
})

test('免证据名额 1：只免排序最前的那条', () => {
  const sid = 'always-1'
  seed(sid, 两条, { factsAlwaysTopN: 1 })
  const out = 注入文本(sid, '今天天气怎么样')
  assert.match(out, /TypeScript/, '重要度最高的那条免门进')
  assert.doesNotMatch(out, /泰拉瑞亚/, '第二条没证据就不进')
})

test('免门名额也受 factsMax 限制', () => {
  const sid = 'always-cap'
  seed(sid, 两条, { factsAlwaysTopN: 2, factsMax: 1 })
  const out = 注入文本(sid, '今天天气怎么样')
  assert.match(out, /TypeScript/, '第一条进')
  assert.doesNotMatch(out, /泰拉瑞亚/, 'factsMax=1 只肯放一条')
})
