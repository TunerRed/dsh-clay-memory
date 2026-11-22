// 候选表（1.11.0 一期 §4.8）—— 正则钩子「只标记候选，不直接写正式记忆」
//
// 为什么要这块：
//   盲抽评测丢的 16 道，原因是那几件事**压根没进库** —— 模型不会主动为「她梦见…」调 remember。
//   钩子的作用就是在「本回合她没调 remember」时，把像需要记的话挑出来，**先放候选区**。
//
// 为什么只标候选、不直接写：
//   硬塞会把「今天不想聊这个」「随口一句喜欢」也记进去，污染比漏记更难收拾。
//   候选等于「排队等你过目」：采纳了才进正式库，7 天没人管就清掉。
//
// 触发条件（两条都满足才记候选）：
//   ① 本回合没调用过 remember（调过了就说明她自己判断过，不用钩子插手）；
//   ② 文本命中 承诺 / 偏好 / 身份 三类线索之一。
// 候选**不进召回池**、不占日额度、不参与每天记忆条数统计。

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { STORE_DIR } from './paths.mjs'
import { 归性质 } from './nature.mjs'

export const 候选文件 = () => join(STORE_DIR, '_candidates.json')
export const 候选一天上限 = 10
export const 候选保留天数 = 7

const 线索 = [
  { 类: 'commitment', 正则: /说好|答应|约好|约定|回头要|记得要|一定要|下周[一二三四五六日天]|周三|周末要|月底前/ },
  { 类: 'preference', 正则: /喜欢|不喜欢|讨厌|爱吃|受不了|最怕|偏爱|更喜欢/ },
  { 类: 'identity', 正则: /我是(?:做|干|搞)|我住|我今年|生日是|我在.{0,8}(?:做|干|搞|工作)|我的工作/ },
]

export function 找线索(text) {
  const 文 = String(text || '')
  if (!文.trim()) return null
  for (const l of 线索) if (l.正则.test(文)) return { 类: l.类 }
  // 第四类：性质线索 —— 梦 / 虚构 / 假设 / 过程。
  // 为什么并进来：正是这几种话模型最容易「觉得不用记」，而它们恰恰是盲抽丢分最多的地方
  // （PUB01-C004 梦、C012 编的故事、C016 检查灯九十分钟）。规则跟 nature.mjs 共用一份，避免两处漂移。
  const 性 = 归性质(文)
  if (性 && 性.nature && 性.by === 'rule') return { 类: 性.nature }
  return null
}

// ── 存储（够用就好：一个文件、原子写）──
function 读表() {
  try {
    const p = 候选文件()
    if (!existsSync(p)) return { items: [] }
    const d = JSON.parse(readFileSync(p, 'utf8'))
    return d && Array.isArray(d.items) ? d : { items: [] }
  } catch (error) {
    return { items: [] }
  }
}

function 写表(d) {
  const p = 候选文件()
  try {
    mkdirSync(STORE_DIR, { recursive: true })
  } catch (error) {}
  writeFileSync(p, JSON.stringify(d, null, 2), 'utf8')
}

const 日 = (t) => new Date(t).toISOString().slice(0, 10)

export function 候选列表(now = Date.now()) {
  return 读表().items.filter((x) => !x.droppedAt && (!x.expireAt || Date.parse(x.expireAt) > now))
}

// 加一条候选；同文本 30 天内不重复、当天最多 10 条
export function 加候选({ text, hint, session, turn, now = Date.now() }) {
  const 文 = String(text || '').trim().slice(0, 300)
  if (!文) return { ok: false, why: 'empty' }
  const d = 读表()
  const 今日 = d.items.filter((x) => x.hitAt && 日(Date.parse(x.hitAt)) === 日(now)).length
  if (今日 >= 候选一天上限) return { ok: false, why: 'daily-cap' }
  const 三十天 = now - 30 * 86400000
  const norm = (s) => String(s || '').replace(/[\s，。、！？,.!?]/g, '')
  if (d.items.some((x) => norm(x.text) === norm(文) && Date.parse(x.hitAt) > 三十天)) {
    return { ok: false, why: 'dup' }
  }
  const item = {
    id: 'c' + now.toString(36) + Math.floor(Math.random() * 1000),
    text: 文,
    hint: hint ? String(hint.类 || hint) : '',
    session: String(session || ''),
    ...(typeof turn === 'number' ? { turn } : {}),
    hitAt: new Date(now).toISOString(),
    expireAt: new Date(now + 候选保留天数 * 86400000).toISOString(),
  }
  d.items.push(item)
  // 顺手清掉早就过期/已丢弃的（别让文件无限长）
  d.items = d.items.slice(-200)
  写表(d)
  return { ok: true, item }
}

// 采纳：返回候选本身，调用方负责转成正式 remember
export function 采纳候选(id, now = Date.now()) {
  const d = 读表()
  const it = d.items.find((x) => x.id === String(id) && !x.droppedAt)
  if (!it) return null
  it.adoptedAt = new Date(now).toISOString()
  it.droppedAt = new Date(now).toISOString()
  it.droppedReason = 'adopted'
  写表(d)
  return it
}

export function 丢弃候选(id, 原因 = 'dropped', now = Date.now()) {
  const d = 读表()
  const it = d.items.find((x) => x.id === String(id) && !x.droppedAt)
  if (!it) return null
  it.droppedAt = new Date(now).toISOString()
  it.droppedReason = String(原因 || 'dropped')
  写表(d)
  return it
}

// 本回合记没记过 —— remember 成功时打点，钩子在轮末问一句
const 记过点 = new Map() // sid -> { at, turn }
export function 标本回合记过(sid, turn) {
  记过点.set(String(sid), { at: Date.now(), turn })
}
export function 本回合记过没(sid, 回合起点) {
  const p = 记过点.get(String(sid))
  if (!p) return false
  return 回合起点 ? p.at >= 回合起点 : true
}
