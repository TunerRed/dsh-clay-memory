// 归档闸门（1.12.0 一期决策二：24h + 10）—— 「该整理了」的触发器
//
// 为什么需要闸门：
//   钩子只在本回合没调 remember 时看一眼，漏掉的那些话就彻底过去了；
//   而「延迟整理」如果每轮都跑，等于每轮多烧一次模型调用（贵且打扰）。
//   所以定一个硬条件：**距上次整理超过 24 小时，且手上未归档的话够 10 条**才动。
//
// 这一版整理做什么：
//   不调模型 —— 只把攒下来的话过一遍线索规则（承诺/偏好/身份/性质），命中的丢进候选区。
//   候选区本来就要人过目，所以这一步是零风险的预筛；真抽取（模型读历史自己记）留到二期。
//
// 状态放哪：
//   <DSH_HOME>\clay-memory\_archive.json —— 只有 lastRunAt 和最近几次记录，坏了当没跑过。

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { STORE_DIR } from './paths.mjs'
import { 找线索, 加候选 } from './candidates.mjs'

export const 归档文件 = () => join(STORE_DIR, '_archive.json')
export const 归档间隔小时 = 24
export const 归档最少条数 = 10

export function 读归档状态() {
  try {
    const p = 归档文件()
    if (!existsSync(p)) return { lastRunAt: 0, runs: [] }
    const d = JSON.parse(readFileSync(p, 'utf8'))
    return {
      lastRunAt: Number((d && d.lastRunAt) || 0) || 0,
      runs: Array.isArray(d && d.runs) ? d.runs.slice(-20) : [],
    }
  } catch (error) {
    return { lastRunAt: 0, runs: [] }
  }
}

export function 写归档状态(状态) {
  const p = 归档文件()
  try {
    mkdirSync(STORE_DIR, { recursive: true })
  } catch (error) {}
  try {
    writeFileSync(p, JSON.stringify({ lastRunAt: 状态.lastRunAt, runs: (状态.runs || []).slice(-20) }, null, 2), 'utf8')
  } catch (error) {}
}

// 这条消息是不是「主人亲手打的字」—— 归档闸门和候选区只该收这种
//
// `agent/inbox/inserted` 不只收主人打字：插件自己递的消息（主动开口 `plugin:*`）、
// 子代理回调（`agent-message` / `subagent-settled`）也会走同一个事件。
// 不过滤的话，它们会被当成「用户原话」喂进候选区 —— 2026-11-14 真库上逮到过
// 一条整段助手口气的「建议：不换……」被收进 `_candidates.json`。
//
// 来源 kind 为空时**按主人算**（老宿主没带 source 字段），否则升级后可能一句话都收不到；
// 这个口径与 dsh-proactive-msg 0.2.1 一致（那边 2026-11-10 也踩过同一个坑）。
export function 是主人说的(msg) {
  const 源 = msg && msg.source ? msg.source : null
  const 类 = 源 && 源.kind !== undefined && 源.kind !== null ? String(源.kind) : ''
  return !(类 && 类 !== 'user')
}

// 该不该整理：两个硬条件都满足才算
export function 该整理了({ lastRunAt, now, 未归档条数, 间隔小时 = 归档间隔小时, 最少条数 = 归档最少条数 }) {
  const 距 = Number(now) - (Number(lastRunAt) || 0)
  if (!(距 >= 间隔小时 * 3600 * 1000)) return false
  return Number(未归档条数) >= 最少条数
}

// 整理一次：把攒下来的话过线索 → 命中的进候选
//   返回 { 跑了, 扫了, 挑出, 写了 } —— 调用方拿它写 diag
export function 整理一次({ 文本们, now = Date.now(), 会话 = '', 参数 = {} } = {}) {
  const 句们 = (Array.isArray(文本们) ? 文本们 : []).map((t) => String(t || '').trim()).filter(Boolean)
  const 状态 = 读归档状态()
  if (!该整理了({ lastRunAt: 状态.lastRunAt, now, 未归档条数: 句们.length, ...参数 })) {
    return { 跑了: false, 扫了: 句们.length, 挑出: 0, 写了: 0 }
  }
  let 挑出 = 0
  let 写了 = 0
  for (const t of 句们) {
    const 线 = 找线索(t)
    if (!线) continue
    挑出++
    const r = 加候选({ text: t, hint: 线, session: 会话, now })
    if (r && r.ok) 写了++
  }
  const 新状态 = {
    lastRunAt: Number(now) || Date.now(),
    runs: (状态.runs || []).concat([{ at: new Date(now).toISOString(), 扫了: 句们.length, 挑出, 写了 }]),
  }
  写归档状态(新状态)
  return { 跑了: true, 扫了: 句们.length, 挑出, 写了 }
}
