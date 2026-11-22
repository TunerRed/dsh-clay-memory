import test from 'node:test'
import assert from 'node:assert/strict'
import { recall } from '../lib/scoring.mjs'

// 2026-11-16（1.12.43）预算装填顺序回归：
//   原来「常驻事实先装满、事件队再上」，真库实测 6 条常驻事实自己吃掉 605 字，
//   剩 63 字连一条 78 字的知识都装不下 —— 事件队形同虚设：C=0.41 的知识进不来，
//   装进去的是 C=0.19~0.30 的常驻条。现在两者一起按 C 竞争同一份字数预算。
//
// 夹具为什么用 factsAlwaysTopN:1：
//   常驻事实默认要求 C > 0，而词面分带 IDF（两条记忆都含「西红柿」时这个词的权重会被拉平），
//   小语料里很难同时凑出「常驻 C>0 但更低」和「知识 C 更高」。factsAlwaysTopN 是现成的
//   「不看证据直接进常驻」通道（免门只给画像、不给知识），正好把两条路分清楚。
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
      // ⭐ 1.12.59：这里测的是「预算怎么抢」，不是「闲聊要不要带知识」。
      //   新加的闸门默认关着闲聊轮的知识，而这几句 query（「西红柿鸡蛋派」）判不出意图，
      //   不显式放开的话整条知识会被拦掉，测的就不是预算了。
      闲聊带知识: 1,
      ...policy,
    },
    memories,
    deleted: [],
    traces: [],
  }
}

// 预算 150 → 可用 85 字（扣掉抬头估 65，1.12.60 前是 132）；每条再加前缀估 16。
// 画像 27 字 → 43；知识 34 字 → 50：只装得下一条。
const 画像条 = 画像('p1', '主人喜欢吃西红柿炒蛋，每次都要多放一个鸡蛋才觉得够味')
const 知识条 = 知识('k1', '主人吃盖浇饭是西红柿鸡蛋派，卤肉也接受，西红柿鸡蛋派最稳')

test('预算只够一条时按 C 竞争：贴得准的知识条挤掉不贴的常驻条', () => {
  const r = recall(
    库([画像条, 知识条], { knowledgeStaysOut: 1, factsAlwaysTopN: 1, maxChars: 150 }),
    '西红柿鸡蛋派',
    Date.now(),
    'budget-1',
    null,
    null,
  )
  const ids = r.selected.map((x) => String(x.m.id))
  assert.deepEqual(ids, ['k1'], '只装得下一条时，装进去的该是 C 更高那条')
  const 画像行 = r.scored.find((x) => String(x.m?.id) === 'p1')
  assert.equal(画像行.omission, 'budget', '被挤掉的常驻条要标 budget，设置页才说得清为什么没注入')
})

test('预算够时两条都进，输出顺序仍是常驻在前、事件在后', () => {
  const r = recall(
    库([知识条, 画像条], { knowledgeStaysOut: 1, factsAlwaysTopN: 1, maxChars: 800 }),
    '西红柿鸡蛋派',
    Date.now(),
    'budget-2',
    null,
    null,
  )
  const ids = r.selected.map((x) => String(x.m.id))
  assert.deepEqual(ids, ['p1', 'k1'], '装填顺序不该改变注入顺序')
})

test('单条就超预算时谁都不装，标 budget 而不是崩', () => {
  const 超长 = 画像('long', '主'.repeat(300))
  const r = recall(
    库([超长], { knowledgeStaysOut: 1, factsAlwaysTopN: 1, maxChars: 1 }),
    '西红柿鸡蛋派',
    Date.now(),
    'budget-3',
    null,
    null,
  )
  assert.deepEqual(r.selected, [])
  const 行 = r.scored.find((x) => String(x.m?.id) === 'long')
  assert.equal(行.omission, 'budget')
})
