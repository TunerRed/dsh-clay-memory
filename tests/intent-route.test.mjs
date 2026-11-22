import test from 'node:test'
import assert from 'node:assert/strict'
import { recall, 判意图 } from '../lib/scoring.mjs'
import { DEFAULT_POLICY } from '../lib/cfg.mjs'

// 2026-11-18（1.12.49）意图路由 + 条件兜底：
//   真机实测「我今天好累」注入 0 条 —— `factsAlwaysTopN` 是 0 时画像必须有词面证据才进得来，
//   而情绪句一个词都命不中画像，于是整轮空白，模型完全不知道该用什么态度说话。
//   这里钉住三件事：意图分档稳定、零命中时兜 1 条画像、兜底不会在技术问句上乱塞。
const 画像 = (id, text, importance = 1) => ({ id, category: 'stable_profile', importance, text })
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
    policy: { factsMax: 6, maxItems: 6, threshold: 0.35, queryGate: 0, ...policy },
    memories,
    deleted: [],
    traces: [],
  }
}

const 高画 = 画像('p-hi', '主人加班回家那天会先躺着不说话，缓十分钟才有力气聊天', 1)
const 低画 = 画像('p-lo', '主人喜欢在周末早上把窗帘拉开一半再刷牙', 0.4)
const 知 = 知识('k1', 'Kafka 消费组重复消费要先看 rebalance 日志和 offset 提交时机')

test('判意图：技术句、生活句、模糊句各归各档', () => {
  assert.equal(判意图('Kafka 消费组老重复消费怎么办'), 'tech')
  assert.equal(判意图('客户端程序装在哪'), 'tech')
  assert.equal(判意图('我今天好累'), 'life')
  assert.equal(判意图('在吗'), 'life')
  assert.equal(判意图('周末想看电影'), 'life')
  assert.equal(判意图(''), 'unknown')
  // >40 字一律 unknown：长句往往混合意图，保守不降权
  assert.equal(判意图('啊'.repeat(41)), 'unknown')
})

test('生活句零命中：兜底给 1 条画像，且取 importance 最高的那条', () => {
  const r = recall(库([高画, 低画, 知]), '我今天好累', Date.now(), 'intent-1', null, null)
  assert.equal(r.selected.length, 1)
  assert.equal(r.selected[0].m.id, 'p-hi')
  assert.equal(r.selected[0].兜底, 'portrait')
  assert.equal(r.selected[0].omission, null)
})

test('技术句零命中：不兜底，宁可空着也不塞画像', () => {
  const r = recall(库([高画, 低画, 知]), 'k8s 集群节点 NotReady', Date.now(), 'intent-2', null, null)
  const 兜底条 = r.selected.filter((row) => row.兜底 === 'portrait')
  assert.equal(兜底条.length, 0)
})

test('正常命中时不兜底：兜底只补「本来一条都没有」的空白', () => {
  const r = recall(库([高画, 低画, 知]), 'Kafka 消费组重复消费', Date.now(), 'intent-3', null, null)
  assert.ok(r.selected.length > 0)
  assert.equal(r.selected.filter((row) => row.兜底 === 'portrait').length, 0)
})

test('知识降权：默认 0.6，设成 0 或 1 都不崩', () => {
  assert.equal(DEFAULT_POLICY.知识降权, 0.6)
  for (const 系数 of [0, 0.5, 1]) {
    const r = recall(
      库([高画, 低画, 知], { 知识降权: 系数 }),
      '我平时喜欢吃什么',
      Date.now(),
      'intent-4',
      null,
      null,
    )
    assert.ok(Array.isArray(r.selected))
  }
})

test('空库：不崩，也不产生兜底条', () => {
  const r = recall(库([]), '我今天好累', Date.now(), 'intent-5', null, null)
  assert.equal(r.selected.length, 0)
})
