import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// T 张力（2026-11-04，需求 §5「无关问句不应被固定记忆挤占上下文」）回归：
//   事实池里的常驻条目必须命中问句真证据（C > 0）才注入，不再无条件塞满 factsMax；
//   核心画像改由骨架层 _core.json 负责（每轮固定注入，见 tests/core-memory.test.mjs）。
const home = fs.mkdtempSync(join(tmpdir(), 'fish-facts-gate-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')
const { apply } = await import('../lib/index.js')
const directory = join(home, 'clay-memory')
fs.mkdirSync(directory, { recursive: true })
const file = sid => join(directory, sid + '.json')

// 骨架层：核心画像一条、长期背景一条
fs.writeFileSync(join(directory, '_core.json'), JSON.stringify({
  version: 1,
  items: [
    { id: 'core-portrait', subject: 'user', core: true, content: '我叫鲸鱼娘，主人叫我鲸鱼' },
  ],
}))

function seed(sid, memories) {
  fs.writeFileSync(file(sid), JSON.stringify({ version: 2, policy: { factsMax: 6, threshold: 0.35, queryGate: 0 }, memories, deleted: [], traces: [] }))
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

const 两份事实 = [
  { id: 'fact', category: 'stable_profile', importance: 1, text: '喜欢泰拉瑞亚挖矿和看视频' },
  { id: 'fact2', category: 'stable_profile', importance: 1, text: '住在杭州，靠近西湖' },
]

test('无关问句：骨架层核心画像在，事实池低证据条目不注入', () => {
  const sid = 'facts-gate-1'
  seed(sid, 两份事实)
  const out = 注入文本(sid, '今天天气怎么样')
  assert.match(out, /鲸鱼娘/, '骨架层核心画像必须每轮在')
  assert.doesNotMatch(out, /泰拉瑞亚/, '无关问句不该被事实塞满')
  assert.doesNotMatch(out, /杭州/, '无关问句不该被事实塞满')
})

test('相关问句仍注入对应事实', () => {
  const sid = 'facts-gate-2'
  seed(sid, 两份事实)
  const out = 注入文本(sid, '泰拉瑞亚的挖矿怎么安排')
  assert.match(out, /泰拉瑞亚/, '命中真证据的事实必须注入')
})

test('闲聊「早上好」：核心画像仍在，事实不占满', () => {
  const sid = 'facts-gate-3'
  seed(sid, 两份事实)
  const out = 注入文本(sid, '早上好')
  assert.match(out, /鲸鱼娘/, '闲聊时骨架层核心画像仍在')
  assert.doesNotMatch(out, /泰拉瑞亚/, '闲聊句不塞事实')
})
