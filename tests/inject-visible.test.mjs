// 1.10.2 F8 注入可见：每轮注入开头报「这轮想起了 N 条」
//   规划 §4.2 原话是「聊天里留『想起了 3 条』小标记」。插件拿不到聊天气泡，
//   能做到的是把数字放进注入文本 —— 主人在设置页「召回记录」里能看到同一条数据。
import { test } from 'node:test'
import assert from 'node:assert'

const { render } = await import('../lib/scoring.mjs')

const now = Date.parse('2026-05-01T00:00:00.000Z')
const 条 = (id, text) => ({ m: { id, text, at: '2026-04-20T00:00:00.000Z' } })

test('想起了 1 条 → 开头写「这轮想起了 1 条」', () => {
  const out = render([条('a', '喜欢热麦茶')], now, '她')
  assert.match(out, /【你记得的事】（这轮想起了 1 条）/)
  assert.match(out, /喜欢热麦茶/)
})

test('想起了 3 条 → 数字跟着变，条目一条不少', () => {
  const out = render([条('a', '喜欢热麦茶'), 条('b', '猫叫团险'), 条('c', '周五去北京')], now, '她')
  assert.match(out, /这轮想起了 3 条/)
  assert.strictEqual(out.split('\n').filter((l) => l.startsWith('- ')).length, 3)
})

test('一条都没想起来 → 整段不注入（连标题都不留）', () => {
  assert.strictEqual(render([], now, '她'), '')
})
