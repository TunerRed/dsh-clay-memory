import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trace时间 } from '../lib/trace-time.mjs'

test('trace 的 at 是毫秒数字时能认出来', () => {
  const t = 1794722625632
  assert.equal(trace时间({ at: t }), t)
})

test('at 是 ISO 字符串时也能认出来（记忆条目走这条）', () => {
  const s = '2026-11-15T06:03:45.632Z'
  assert.equal(trace时间({ at: s }), Date.parse(s))
})

test('缺 at / at 是垃圾时返回 0，不抛', () => {
  assert.equal(trace时间({}), 0)
  assert.equal(trace时间(null), 0)
  assert.equal(trace时间({ at: '不是时间' }), 0)
})

test('at 为 0 或 NaN 时返回 0（不能被当成 1970 年混进统计）', () => {
  assert.equal(trace时间({ at: 0 }), 0)
  assert.equal(trace时间({ at: Number.NaN }), 0)
})
