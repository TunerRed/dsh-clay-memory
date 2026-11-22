import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// 回复体检（2026-11-10 从 dsh-persona-growth 搬进黏土记忆，FuckAIWords 词面规则）
//   规则引擎是纯函数；规则开关存在 $DSH_HOME/clay-memory/reply-check-rules.json。
const home = fs.mkdtempSync(join(tmpdir(), 'fish-reply-check-'))
process.env.DSH_HOME = home
fs.mkdirSync(join(home, 'clay-memory'), { recursive: true })
const { analyzeText, analyzeBatch, ALL_RULES } = await import('../lib/reply-check/analyze.js')
const { loadDisabled, saveDisabled } = await import('../lib/reply-check/rules.js')
const { splitFrames, extractAssistantMessages } = await import('../lib/reply-check/session-log.js')

test('analyzeText：翻译腔 / 列表腔命中', () => {
  const hits = analyzeText('首先，需要注意的是，总的来说这件事值得反思。')
  const ids = hits.map((h) => h.id)
  assert.ok(ids.includes('translationese'), '翻译腔要命中')
  assert.ok(ids.includes('list-tone'), '列表腔要命中')
})

test('analyzeText：技术语境豁免「不是A而是B」', () => {
  const tech = analyzeText('这个报错不是权限问题，而是路径写错了。')
  assert.ok(!tech.some((h) => h.id === 'formula-reversal'), '技术语境不该报公式化反转')
  const casual = analyzeText('这不是选择，而是命运。')
  assert.ok(casual.some((h) => h.id === 'formula-reversal'), '非技术语境照常报')
})

test('analyzeText：开关关掉的规则不报', () => {
  const hits = analyzeText('首先，需要注意的是。', { disabled: ['list-tone'] })
  assert.ok(!hits.some((h) => h.id === 'list-tone'))
})

test('analyzeBatch：连续三条同一种回应 → recent-act-reuse', () => {
  const r = analyzeBatch([{ text: '确实' }, { text: '确实啊' }, { text: '确实有道理' }])
  assert.ok(r.messages[2].hits.some((h) => h.id === 'recent-act-reuse'))
})

test('analyzeBatch：相邻两条同一开场 → repeated-opening', () => {
  const r = analyzeBatch([{ text: '这个事情我来看看' }, { text: '这个事情我来搞定' }])
  assert.ok(r.messages[1].hits.some((h) => h.id === 'repeated-opening'))
})

test('analyzeBatch：汇总 perRule 与命中率', () => {
  const r = analyzeBatch([{ text: '首先，需要指出的是。' }, { text: '嗯。' }])
  assert.equal(r.summary.count, 2)
  assert.equal(r.summary.hitRate, 50, '两条里一条有命中 = 50%')
  assert.ok(r.summary.perRule['translationese'] >= 1)
})

test('规则开关：saveDisabled / loadDisabled 往返', () => {
  saveDisabled(['list-tone', 'bit-ack'])
  assert.deepEqual(loadDisabled(), ['list-tone', 'bit-ack'])
  saveDisabled([])
  assert.deepEqual(loadDisabled(), [])
})

test('ALL_RULES：23 条正则 + 3 条跨条 = 26 条', () => {
  assert.equal(ALL_RULES.length, 26)
  assert.ok(ALL_RULES.some((r) => r.id === 'emoji-every'))
})

test('extractAssistantMessages：只取 assistant/message 的 text 块', () => {
  const line = JSON.stringify({ type: 'assistant/message', seq: 3, time: 1700000000000, data: { message: { content: [{ type: 'text', text: '你好呀' }, { type: 'reasoning', text: '不取这个' }] } } })
  const user = JSON.stringify({ type: 'user/message', seq: 2, data: { content: [{ type: 'text', text: '用户消息' }] } })
  const msgs = extractAssistantMessages([line, user].join('\n'), 's1')
  assert.equal(msgs.length, 1)
  assert.equal(msgs[0].text, '你好呀')
  assert.equal(msgs[0].sessionId, 's1')
})

test('splitFrames：空缓冲返回空数组', () => {
  assert.deepEqual(splitFrames(Buffer.alloc(0)), [])
})
