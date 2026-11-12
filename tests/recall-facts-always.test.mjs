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

// 1.12.21：免门只给画像 —— 知识条目（is_knowledge: true）永远要证据
const 带知识 = [
  { id: 'k1', category: 'stable_profile', importance: 1, is_knowledge: true, text: '生产环境 nginx 限流写在 conf.d/limit.conf' },
  ...两条,
]

test('知识条目不因免门被放行（哪怕它排最前）', () => {
  const sid = 'always-knowledge'
  seed(sid, 带知识, { factsAlwaysTopN: 2 })
  const out = 注入文本(sid, '今天天气怎么样')
  assert.doesNotMatch(out, /nginx/, '知识条目没有证据就不能进，即使 importance=1')
  assert.match(out, /TypeScript/, '画像照常免门')
  assert.match(out, /泰拉瑞亚/, '画像照常免门')
})

test('知识条目不吃免门名额', () => {
  const sid = 'always-knowledge-slot'
  seed(sid, 带知识, { factsAlwaysTopN: 1 })
  const out = 注入文本(sid, '今天天气怎么样')
  assert.doesNotMatch(out, /nginx/, '知识不进')
  assert.match(out, /TypeScript/, '唯一的名额给画像第一条')
  assert.doesNotMatch(out, /泰拉瑞亚/, '第二条画像不该因为名额被知识占掉而一起进')
})

// ⭐ 1.12.23（F10 阶段 0 第三）：知识退出常驻（knowledgeStaysOut）
const 知识与画像 = [
  {
    id: 'k1',
    category: 'stable_profile',
    importance: 1,
    is_knowledge: true,
    text: 'Kafka 消息队列部署在 9092 端口，日志目录是 /var/log/kafka',
  },
  { id: 'p1', category: 'stable_profile', importance: 1, text: '主人是程序员，主要写 TypeScript' },
]

test('knowledgeStaysOut=0（默认）：知识条目照旧能进常驻层', () => {
  const sid = 'kso-off'
  seed(sid, 知识与画像, { knowledgeStaysOut: 0 })
  const out = 注入文本(sid, 'Kafka 端口是多少')
  assert.match(out, /Kafka/, '默认不隔离知识，命中了就该进')
})

test('knowledgeStaysOut=1：知识不占常驻名额，画像的免门不受影响', () => {
  const sid = 'kso-on'
  seed(sid, 知识与画像, { knowledgeStaysOut: 1, factsAlwaysTopN: 2 })
  const out = 注入文本(sid, 'Kafka 端口是多少')
  assert.doesNotMatch(out, /9092/, '知识不该再无条件占常驻位')
  assert.match(out, /TypeScript/, '画像的免证据名额照旧生效')
})
