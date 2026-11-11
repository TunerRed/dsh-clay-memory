// 回血（F7，2026-11-10）
//
// 为什么单独一个模块、还要走「延迟落盘」：
//   注入发生在 systemPrompt.context 的 text() 里 —— 这条路**每轮都跑**，而它在
//   S3-② 之后的核心承诺是「不写盘」（写一次 850 条的库就是几十毫秒，每轮都写等于白烧）。
//   但「这条记忆这一轮真被用上了」又只有注入那一刻知道（要挂在 picked 上，不能拿
//   scored.slice(0,24) 充数 —— 那样 core/常驻条目永远回不了血）。
//
//   → 折中：注入时只把 id 记进内存（每会话每小时最多记一次，免得每轮都攒），
//     下一次真正要写盘时（remember / 设置页 / 任何 saveStore）顺手把这几条回血落下去。
//     进程中途退出最多丢掉这一小时的回血 —— 比每轮写盘便宜太多，也不影响正确性。

import { 鲜活度 } from './scoring.mjs'

const 待回血 = new Map() // sid -> { ids: Set<string>, at: number }
const 间隔 = 3600 * 1000 // 每会话每小时一次

// 注入时调用：把「这一轮真正进提示词的那几条」记下来。
// 返回 true = 这次真的记了（调用方可以写进 diag）。
export function 标回血(sid, ids, now) {
  if (!sid || !Array.isArray(ids) || !ids.length) return false
  const t = Number(now) || Date.now()
  const 前 = 待回血.get(sid)
  if (前 && t - 前.at < 间隔) return false
  const 集 = new Set(ids.map(String))
  // 上一批还没落盘就再攒：合并进去，别把人家丢了
  if (前) for (const id of 前.ids) 集.add(id)
  待回血.set(sid, { ids: 集, at: t })
  return true
}

export function 取回血(sid) {
  const 前 = 待回血.get(sid)
  if (!前) return []
  待回血.delete(sid)
  return [...前.ids]
}

export function 清回血(sid) {
  if (sid) 待回血.delete(sid)
  else 待回血.clear()
}

// 真正落盘前调用：把攒着的 id 挨个回血（A' = A + 0.2(1-A)，锚点挪到现在）。
// 只动**这一轮真被选中**的那几条；已被取代 / 标了不对 / 已经不存在的直接跳过。
export function 应用回血(data, sid, now, policy) {
  if (!data || !Array.isArray(data.memories)) return 0
  const ids = 取回血(sid)
  if (!ids.length) return 0
  const 候选 = new Set(ids)
  const t = Number(now) || Date.now()
  const 规 = typeof t === 'number' ? new Date(t).toISOString() : new Date().toISOString()
  let n = 0
  for (const m of data.memories) {
    if (!m || !候选.has(String(m.id))) continue
    if (m.已被取代 || m.别记) continue
    const 旧 = 鲜活度(m, policy || data.policy || {}, t)
    const 新 = 旧 + 0.2 * (1 - 旧)
    m.activation0 = Math.max(0, Math.min(1, 新))
    m.activationAnchor = 规
    m.reinforcedAt = 规
    m.reinforceCount = (typeof m.reinforceCount === 'number' ? m.reinforceCount : 0) + 1
    n++
  }
  return n
}
