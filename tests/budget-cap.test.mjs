import test from 'node:test'
import assert from 'node:assert/strict'
import { recall } from '../lib/scoring.mjs'
import { DEFAULT_POLICY } from '../lib/cfg.mjs'

// 2026-11-16（1.12.45）预算治理回归：
//   a) 常驻预算占比 —— 长期事实每轮必带，但长条目能把预算吃干（真库实测 6 条占 605/668 字），
//      给常驻层一个配额，剩下强制留给「这趟真正相关的记忆」。
//   b) 单条注入上限 —— 真库最长一条 1224 字技术笔记，前 180 字只是背景介绍，
//      真正的命令参数全在末尾。所以截断取**头 60% + 尾 40%**，头按句末收口。
//      库里 m.text 始终是全条，只有注入文本变短 —— 设置页点开仍是全文。
const 画像 = (id, text) => ({ id, category: 'stable_profile', importance: 1, text })
const 知识 = (id, text) => ({ id, category: 'stable_profile', is_knowledge: true, importance: 1, text })

function 库(memories, policy = {}) {
  return {
    version: 2,
    policy: { factsMax: 6, maxItems: 6, threshold: 0.35, queryGate: 0, ...policy },
    memories,
    deleted: [],
    traces: [],
  }
}

const 跑 = (memories, policy, q = '西红柿鸡蛋派') =>
  recall(库(memories, policy), q, Date.now(), 'cap', null, null)

test('单条注入上限：超长条目注入时变短，头尾都在，只砍中间', () => {
  const 长文 = '开头点名主题。' + '中'.repeat(300) + '末尾是关键参数。'
  const 条 = 画像('long', 长文)
  const r = 跑([条], { factsAlwaysTopN: 1, maxChars: 800, 单条注入上限: 100 })
  assert.equal(r.selected.length, 1)
  const 注入 = r.selected[0].注入文本
  assert.ok(注入, '截断后应该把注入文本挂到行上')
  assert.ok(注入.length <= 100, '注入文本不能超过上限，实际 ' + 注入.length)
  assert.ok(注入.includes('开头点名主题'), '头部要保留（讲这条是什么）')
  assert.ok(注入.includes('末尾是关键参数'), '尾部要保留（结论/命令通常在末尾）')
  assert.ok(注入.includes('…'), '中间要出现省略号，让人知道被截过')
  assert.equal(r.selected[0].m.text, 长文, '库里的原文必须仍是全条，只截注入')
})

test('单条注入上限：不劈 emoji（代理对不从中间切断）', () => {
  const 长文 = '前面一段话。' + '🐟'.repeat(120) + '最后一句。'
  const r = 跑([画像('e', 长文)], { factsAlwaysTopN: 1, maxChars: 800, 单条注入上限: 90 })
  const 注入 = r.selected[0].注入文本
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(注入), '不能留孤立高代理')
  assert.ok(!/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(注入), '不能留孤立低代理')
})

test('单条注入上限：0 = 不限，注入文本跟原文一样', () => {
  const 长文 = '一句话。' + '中'.repeat(300)
  const r = 跑([画像('long', 长文)], { factsAlwaysTopN: 1, maxChars: 800, 单条注入上限: 0 })
  assert.equal(r.selected.length, 1)
  assert.equal(r.selected[0].注入文本, undefined, '不限时不该挂注入文本（走原路径）')
})

test('常驻预算占比：常驻层装不下超过配额的那部分', () => {
  // 预算 800 → 可用 668；占比 50 → 常驻只能用到 334。
  // 两条画像各 200 字（+16 前缀 = 216），两条就是 432 > 334 ⇒ 只能进一条。
  const p1 = 画像('p1', '甲'.repeat(200))
  const p2 = 画像('p2', '乙'.repeat(200))
  const r = 跑([p1, p2], { factsAlwaysTopN: 2, maxChars: 800, 常驻预算占比: 50 })
  assert.equal(r.selected.length, 1, '配额 334 字只够装一条 216 字的画像')
  const 没进 = r.scored.find((x) => !r.selected.some((s) => String(s.m?.id) === String(x.m?.id)))
  assert.equal(没进.omission, 'budget', '被配额挡掉的也要标 budget，设置页才说得清')
})

test('常驻预算占比：0 = 不限，两条都能进', () => {
  const p1 = 画像('p1', '甲'.repeat(200))
  const p2 = 画像('p2', '乙'.repeat(200))
  const r = 跑([p1, p2], { factsAlwaysTopN: 2, maxChars: 800, 常驻预算占比: 0 })
  assert.equal(r.selected.length, 2)
})

test('常驻预算占比 = 100 时行为等同不限（配额就是全部可用）', () => {
  const p1 = 画像('p1', '甲'.repeat(200))
  const p2 = 画像('p2', '乙'.repeat(200))
  const r = 跑([p1, p2], { factsAlwaysTopN: 2, maxChars: 800, 常驻预算占比: 100 })
  assert.equal(r.selected.length, 2)
})

test('常驻占比与单条上限一起用：截断后的长度才是真正占的预算', () => {
  // 每条 600 字，上限 100 ⇒ 实际占 100+16；两条 232 字，配额 334 装得下
  const p1 = 画像('p1', '甲'.repeat(600))
  const p2 = 画像('p2', '乙'.repeat(600))
  const r = 跑([p1, p2], { factsAlwaysTopN: 2, maxChars: 800, 常驻预算占比: 50, 单条注入上限: 100 })
  assert.equal(r.selected.length, 2, '按截断后长度算预算，两条都该进')
  for (const row of r.selected) assert.ok(row.注入文本.length <= 100)
})

test('显式把单条注入上限设 0 = 关掉截断（行为回到 1.12.44）', () => {
  const 长文 = '正文。' + '中'.repeat(300)
  const r = 跑([画像('p1', 长文), 知识('k1', '主人吃盖浇饭是西红柿鸡蛋派')], {
    knowledgeStaysOut: 1,
    factsAlwaysTopN: 1,
    maxChars: 800,
    单条注入上限: 0,
  })
  const 长行 = r.selected.find((x) => String(x.m?.id) === 'p1')
  assert.ok(长行, '长条在预算够时仍该进')
  assert.equal(长行.注入文本, undefined, '显式关掉就不该有注入文本')
})

test('出厂默认：单条注入上限 300、常驻预算占比 0', () => {
  // b 默认开 300 是有意的：300 以下一律不碰（画像中位才 80 字），
  // 只兜那 68 条「一条顶三条」的超长知识。a 默认关 —— 实测配额会让总注入条数下降。
  assert.equal(DEFAULT_POLICY.单条注入上限, 300)
  assert.equal(DEFAULT_POLICY.常驻预算占比, 0)
})
