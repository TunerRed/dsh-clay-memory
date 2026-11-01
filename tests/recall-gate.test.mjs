import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// 通用门安全垫修复（1.8.32 P3 调优）回归：
//   recall 的线索词兜底「退回全部」时必须再过一遍通用中文门 ——
//   疑问词（怎么/什么/如何…）在记忆库里 df 极低（记忆是陈述句），库里稀有度虚高，
//   修前它们会在兜底时满血复活成噪声主力（P3：「称呼主人时要注意什么」的「什么」
//   把「不翻个人文件」顶到 0.488，压过真目标）。
const home = fs.mkdtempSync(join(tmpdir(), 'fish-gate-test-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')
const { apply } = await import('../lib/index.js')
const directory = join(home, 'clay-memory')
fs.mkdirSync(directory, { recursive: true })
apply({
  agents: { list: () => [], get: () => null }, sessions: { list: () => [] },
  get: () => null, on: () => () => {}, interval: () => () => {}, effect: fn => fn(),
  webServer: { register: () => () => {} },
})
const file = sid => join(directory, sid + '.json')

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
    get: () => null, on: () => () => {}, interval: () => () => {}, effect: fn => fn(),
    webServer: { register: () => () => {} } })
  assert.equal(typeof recallText, 'function')
  return recallText() || ''
}

test('兜底退回时疑问词不放回：「怎么做红烧肉」不再靠「怎么/做」召回无关条目', () => {
  const sid = 'gate-fallback'
  seed(sid, [
    { id: 'a1', category: 'event', text: 'MCP 协议怎么配置的备忘' },
  ])
  const out = 注入文本(sid, '怎么做红烧肉')
  assert.doesNotMatch(out, /MCP/, '「怎么/做」是疑问虚词，兜底退回也不能当线索')
})

test('真线索词不受影响：「你的模型是什么」照样靠「模型」召回', () => {
  const sid = 'gate-real'
  seed(sid, [
    { id: 'a1', category: 'event', text: '主人问模型相关的问题时要答 deepseek-r1 系列' },
  ])
  const out = 注入文本(sid, '你的模型是什么')
  assert.match(out, /deepseek/, '「模型」是实线索，必须召回')
})
