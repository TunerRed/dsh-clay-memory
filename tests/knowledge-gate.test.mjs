import test from 'node:test'
import assert from 'node:assert/strict'
import { recall, 判意图 } from '../lib/scoring.mjs'

// 2026-11-18（1.12.59）知识硬上限 + 闲聊不带知识：
//   起因（observe 14 天实测）：每轮注入 3.23 条 / 636 字里知识占 581 字 = 91%，
//   画像只剩 55 字。主人当天的原话是「对我来说知识反而是最不重要的」。
//   1.12.49 的降权只是让知识排后面，没有画像命中时它照样吃满 —— 这里换成两道硬闸：
//   ①闲聊/判不出意图的轮次，知识条一条都不装；②技术轮知识也最多占 知识预算上限 字。

const 画像 = (id, text) => ({ id, category: 'stable_profile', importance: 1, text })
const 知识 = (id, text) => ({
  id,
  category: 'stable_profile',
  is_knowledge: true,
  importance: 1,
  text,
})

function 库(memories, policy = {}) {
  return {
    version: 2,
    policy: {
      factsMax: 6,
      maxItems: 6,
      threshold: 0.35,
      queryGate: 0,
      factsAlwaysTopN: 3,
      // 知识条要进「事件队」才谈得上被拦/被装：knowledgeStaysOut=1 是它的入场条件
      // （不设的话 stable_profile 的知识两条队都进不去，测的就不是闸门了）。
      knowledgeStaysOut: 1,
      ...policy,
    },
    memories,
    deleted: [],
    traces: [],
  }
}

const 画像条 = 画像('p1', '主人喜欢吃西红柿炒蛋，每次都要多放一个鸡蛋')
const 知识条 = 知识('k1', '西红柿鸡蛋派的做法是先把番茄炒出汁再加蛋液')

test('闲聊轮：知识条一条都不装（默认）', () => {
  const r = recall(库([画像条, 知识条]), '我今天好累', Date.now(), 'kg-1', null, null)
  const ids = r.selected.map((x) => String(x.m.id))
  assert.ok(!ids.includes('k1'), '闲聊轮不该注入知识条，实际注入了 ' + ids.join(','))
})

test('技术轮：知识条照常能进', () => {
  const r = recall(库([画像条, 知识条]), '西红柿鸡蛋派的做法报错怎么办', Date.now(), 'kg-2', null, null)
  const ids = r.selected.map((x) => String(x.m.id))
  assert.ok(ids.includes('k1'), '技术轮知识条该能进，实际只有 ' + ids.join(','))
})

test('闲聊带知识 = 1 时，闲聊轮也允许知识进（回到旧行为）', () => {
  // 只放知识条：加画像条之后这两句的词面分会因为 IDF 被互相拉平（实测 C 直接变 0，
  // 这是词面打分的既有特性，不是本闸门的问题），所以这里只验「闸门开没开」。
  const r = recall(
    库([知识条], { 闲聊带知识: 1 }),
    '我今天好累，想吃西红柿鸡蛋派做的菜',
    Date.now(),
    'kg-3',
    null,
    null,
  )
  const ids = r.selected.map((x) => String(x.m.id))
  assert.ok(ids.includes('k1'), '显式放开后闲聊轮该能带知识，实际只有 ' + ids.join(','))
})

test('知识预算上限生效：技术轮知识总字数不超过上限', () => {
  const 长知识 = 知识('k2', '西红柿鸡蛋派的详细做法'.repeat(20))
  const r = recall(
    库([长知识], { 知识预算上限: 30, 单条注入上限: 0 }),
    '西红柿鸡蛋派的做法报错怎么办',
    Date.now(),
    'kg-4',
    null,
    null,
  )
  const 知识行 = r.selected.filter((x) => x.m && x.m.is_knowledge === true)
  const 总字 = 知识行.reduce((s, x) => s + String(x.m.text || '').length, 0)
  assert.equal(知识行.length, 0, '超过上限的长知识不该被装进来，实际装了 ' + 总字 + ' 字')
})

test('知识预算上限 = 0 表示不限（技术轮照旧）', () => {
  const r = recall(
    库([知识条], { 知识预算上限: 0 }),
    '西红柿鸡蛋派的做法报错怎么办',
    Date.now(),
    'kg-5',
    null,
    null,
  )
  const ids = r.selected.map((x) => String(x.m.id))
  assert.ok(ids.includes('k1'), '0 该表示不限，实际只有 ' + ids.join(','))
})

test('判意图：技术词命中算 tech，生活词命中算 life', () => {
  assert.equal(判意图('Kafka 消费组一直重复消费怎么办'), 'tech')
  assert.equal(判意图('我今天好累啊'), 'life')
})
