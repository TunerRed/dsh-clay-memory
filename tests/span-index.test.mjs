// 1.12.1 原话索引：每轮真人原话留一份，零命中时按词回捞
//   要点：① 太短/重复不记；② 按词重合捞回最像的；③ 只捞窗口内的；④ 行数超上限自动裁剪
import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const 家 = mkdtempSync(join(tmpdir(), 'clay-span-'))
process.env.DSH_HOME = 家
mkdirSync(join(家, 'clay-memory'), { recursive: true })

const span = await import('../lib/span-index.mjs')

const 天 = 86400000

test('记原话：太短的、跟上一句完全一样的不记', () => {
  const sid = 's1'
  assert.equal(span.记原话(sid, '嗯', 1000), false)
  assert.equal(span.记原话(sid, '我下周三要去北京出差，周日回来', 1000), true)
  assert.equal(span.记原话(sid, '我下周三要去北京出差，周日回来', 2000), false, '重复不记')
})

test('回捞：按词重合捞最像的那句', () => {
  const sid = 's2'
  span.记原话(sid, '我把活动扳手放工具包内侧了', 1000)
  span.记原话(sid, '周末想去河边书店看看', 2000)
  const 捞 = span.回捞原话(sid, '扳手放哪儿了', { now: 3000 })
  assert.equal(捞.length, 1)
  assert.ok(捞[0].text.includes('扳手'))
})

test('回捞：不相关的词捞不到，窗口外的不参与', () => {
  const sid = 's3'
  span.记原话(sid, '我把活动扳手放工具包内侧了', 1000)
  assert.equal(span.回捞原话(sid, '今天天气怎么样', { now: 2000 }).length, 0)
  assert.equal(span.回捞原话(sid, '扳手放哪儿了', { now: 1000 + 40 * 天, 天: 30 }).length, 0, '40 天前的不捞')
})

test('行数上限：超过 2000 行只留最近的', () => {
  const sid = 's4'
  const 行 = []
  for (let i = 0; i < 2005; i += 1) 行.push(JSON.stringify({ at: i, text: '第 ' + i + ' 句关于扳手的记录' }))
  writeFileSync(span.原话文件(sid), 行.join('\n') + '\n', 'utf8')
  span.记原话(sid, '最后一句：扳手在工具包里', 99999)
  const 捞 = span.回捞原话(sid, '扳手', { limit: 5, now: 100000, 天: 365000 })
  assert.equal(捞.length, 5)
  assert.ok(捞.some((x) => x.text.includes('最后一句')), '新写的必须在')
  const 全文 = require_read(sid)
  assert.equal(全文.filter(Boolean).length, 2000, '裁剪到 2000 行')
})

function require_read(sid) {
  // 用 fs 读回来数行数（不引 ESM 的 createRequire，保持测试简单）
  const { readFileSync } = process.getBuiltinModule ? process.getBuiltinModule('node:fs') : require('node:fs')
  return readFileSync(span.原话文件(sid), 'utf8').split('\n')
}
