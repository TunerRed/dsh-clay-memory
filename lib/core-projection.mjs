// 骨架投影（1.12.0）—— 把 `_core.json` 从「独立维护的事实源」降成「主库的投影」
//
// 为什么：
//   现在那份骨架是手写的：内容只有人知道、跟主库里的记忆完全脱节 ——
//   同一条事在骨架里写一遍、在记忆里又记一遍，改了一边另一边还是旧的。
//   一期决策（2026-11-10）定的是：保留它的**高优先级注入**能力，但**不再当独立事实源**。
//
// 为什么只做「预览 + 手动写回」，不自动覆盖：
//   骨架里有大量手写的、刻意措辞的东西（风格、边界、关系），主库挑不出来；
//   自动覆盖会把它们冲掉，而且冲掉之后没有后悔药。所以这里只算「差在哪」，
//   写不写、写哪几条，人点按钮决定。

import { 词集, 像度 } from './scoring.mjs'

// 够格进骨架的门槛：事实层、重要度够高、还活着
export const 骨架重要度门 = 0.8
export const 骨架最多 = 6
// 跟已有骨架「算不算同一条」的门槛（跟库里去重用的是同一个口径）
export const 同条门槛 = 0.85

const 能用 = (m) => m && !m.deletedAt && !m.已被取代 && !m.别记 && typeof m.text === 'string' && m.text.trim()

// 从主库挑「够格进骨架」的条目。只认事实层（stable_profile）：
//   事件/工作区记忆是「某天发生过什么」，不适合每轮都在场上。
export function 骨架候选(memories, { 上限 = 骨架最多, 重要度门 = 骨架重要度门 } = {}) {
  const 条 = (Array.isArray(memories) ? memories : [])
    .filter((m) => 能用(m) && m.category === 'stable_profile')
    .filter((m) => (Number(m.importance) || 0) >= 重要度门)
    .sort((a, b) => (Number(b.importance) || 0) - (Number(a.importance) || 0))
  const 出 = []
  for (const m of 条) {
    if (出.length >= 上限) break
    // 候选之间也去重：主库里同一件事可能被记了两遍
    const 重 = 出.some((x) => 像度(词集(x.content), 词集(m.text)) >= 同条门槛)
    if (!重) 出.push({ content: m.text.trim(), importance: Number(m.importance) || 0, ids: [m.id] })
  }
  return 出
}

// 比对：现有骨架 vs 主库候选 → 新增 / 已有 / 可以下线
//   现有条目 core:true 的（核心画像）永不下线 —— 那是人特意钉住的。
export function 比对骨架(现有, 候选) {
  const 旧 = (Array.isArray(现有) ? 现有 : []).filter((it) => it && typeof it.content === 'string' && it.content.trim())
  const 新 = Array.isArray(候选) ? 候选 : []
  const 新增 = []
  const 已有 = []
  for (const c of 新) {
    const 撞 = 旧.find((it) => 像度(词集(it.content), 词集(c.content)) >= 同条门槛)
    if (撞) 已有.push({ 主库: c, 骨架: 撞 }) // eslint-disable-line camelcase
    else 新增.push(c)
  }
  const 可下线 = 旧.filter(
    (it) => it.core !== true && !新.some((c) => 像度(词集(it.content), 词集(c.content)) >= 同条门槛),
  )
  return { 新增, 已有, 可下线 }
}

// 生成写回用的新骨架（保留原顺序：核心在前、其余按原顺序，新条目追加在末尾）
export function 并入骨架(现有, 预览) {
  const 旧 = (Array.isArray(现有) ? 现有 : []).filter((it) => it && typeof it.content === 'string' && it.content.trim())
  const 下线 = new Set((预览 && 预览.可下线 ? 预览.可下线 : []).map((it) => it.content.trim()))
  const 留 = 旧.filter((it) => !下线.has(it.content.trim()))
  const 新条 = (预览 && 预览.新增 ? 预览.新增 : []).map((c) => ({ content: c.content, importance: c.importance, 来源: '主库投影' }))
  return 留.concat(新条)
}
