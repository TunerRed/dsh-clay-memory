// tests/recall-cap.test.mjs —— 审查 P2-3：「按 P 排序后用第一条 C 决定召回上限」疑点的最小测试
// 2026-10-30
//
// 业务定义（recall 注释）：上限看「这一趟有没有一句真正贴的」—— 贴不贴是 C（证据），
// 不是 P（总分，含鲜活度乘数）。所以上限取所有够格条目里的**最高 C**。
import test from 'node:test'
import assert from 'node:assert/strict'
import { 事件本趟上限 } from '../lib/recall-cap.mjs'

const 行 = (P, C) => ({ m: { id: String(Math.random()) }, s: { P, C } })

test('最高 C 不在 P 排序第一条时，上限按最高 C 算（不按第一条的 C）', () => {
  // 反例：B 新鲜（P 高）但证据弱（C 低）；A 不新鲜（P 低）但证据强（C 高）。
  // P 排序：B 第一。旧实现拿 B.C=0.38 → [0.4,3] 档给 3 条；新实现看最高 C=0.61 → maxItems。
  const 事件们 = [行(0.9, 0.38), 行(0.6, 0.61), 行(0.5, 0.55)]
  assert.equal(事件本趟上限(事件们, 6), 6, '最高 C 0.61 ≥ 0.6 → maxItems，而不是被第一条的 0.38 压到 3')
})

test('档位边界与旧分档一致', () => {
  assert.equal(事件本趟上限([行(1, 0.6)], 6), 6, '0.6 恰好进 maxItems 档')
  assert.equal(事件本趟上限([行(1, 0.599)], 6), 4, '0.599 → 4 档')
  assert.equal(事件本趟上限([行(1, 0.5)], 6), 4, '0.5 → 4 档')
  assert.equal(事件本趟上限([行(1, 0.4)], 6), 3, '0.4 → 3 档')
  assert.equal(事件本趟上限([行(1, 0.399)], 6), 1, '低于 0.4 → 1 档')
  assert.equal(事件本趟上限([行(1, 0)], 6), 1, '全低分 → 1 条，不硬凑')
})

test('空候选与坏数据不炸', () => {
  assert.equal(事件本趟上限([], 6), 0, '空候选 → 0')
  assert.equal(事件本趟上限(null, 6), 0, 'null → 0')
  assert.equal(事件本趟上限([null, { s: null }, { m: 1 }], 6), 1, '坏行 C 按 0 算')
})

test('最高 C 高时上限受 maxItems 截断（调用方 Math.min 语义）', () => {
  const 上限 = 事件本趟上限([行(1, 0.7)], 2)
  assert.equal(Math.min(上限, 2), 2, 'maxItems=2 时最多 2')
})
