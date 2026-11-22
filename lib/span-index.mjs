// 原话索引（1.12.1 起）—— 每轮用户原话留一份，召回零命中时按关键词回捞
//
// 为什么需要：真会话 360 轮里，218 次注入有 198 次走了「翻一句原话」兜底，
// 而且只能在 72 小时内翻一条 —— 过了窗口就彻底没材料。
// dsh-soul 的做法是把原文另建 span 索引，召回时按词回捞。这里照这个思路做最小版：
//   · 只存用户自己说的话（剔除 runtime-context / skill-catalog / plugin:* 这类注入）
//   · 一条一行 JSONL，按会话分文件，单文件最多 2000 行（超了从最旧的删）
//   · 回捞用词集重合度排序，命中率门槛低（0.12）但要求至少撞上一个词

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { STORE_DIR } from './paths.mjs'
import { 词集 } from './scoring.mjs'

export const 原话上限行 = 2000
export const 回捞门槛 = 0.12

export const 原话文件 = (sid) => join(STORE_DIR, 'spans-' + String(sid).replace(/[^\w.-]/g, '_') + '.jsonl')

function 读行(sid) {
  const p = 原话文件(sid)
  try {
    if (!existsSync(p)) return []
    return readFileSync(p, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch (error) {
          return null
        }
      })
      .filter(Boolean)
  } catch (error) {
    return []
  }
}

/** 记一句原话。太短、纯空白、跟上一条完全一样都不记。 */
export function 记原话(sid, text, now = Date.now()) {
  const 文 = String(text || '').trim()
  if (文.length < 4) return false
  const 行 = 读行(sid)
  const 末 = 行[行.length - 1]
  if (末 && 末.text === 文) return false
  const 新行 = { at: now, text: 文.slice(0, 400) }
  try {
    mkdirSync(STORE_DIR, { recursive: true })
  } catch (error) {}
  try {
    appendFileSync(原话文件(sid), JSON.stringify(新行) + '\n', 'utf8')
  } catch (error) {
    return false
  }
  // 超上限就整份重写，只留最近 原话上限行 条
  if (行.length + 1 > 原话上限行) {
    const 留 = 行.concat([新行]).slice(-原话上限行)
    try {
      writeFileSync(原话文件(sid), 留.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8')
    } catch (error) {}
  }
  return true
}

/** 按关键词回捞最像的几句原话（返回 [{text, at, 分}]，最多 limit 条）。 */
export function 回捞原话(sid, query, { limit = 2, 天 = 30, now = Date.now() } = {}) {
  const 目标 = 词集(query)
  if (!目标.size) return []
  const 早于 = now - 天 * 86400000
  const 打分 = []
  for (const 行 of 读行(sid)) {
    if (!行 || typeof 行.text !== 'string') continue
    if (行.at && 行.at < 早于) continue
    const 词 = 词集(行.text)
    let 撞 = 0
    for (const k of 目标) if (词.has(k)) 撞 += 1
    if (撞 === 0) continue
    const 分 = 撞 / Math.max(1, 目标.size)
    if (分 < 回捞门槛) continue
    打分.push({ text: 行.text, at: 行.at || 0, 分 })
  }
  打分.sort((a, b) => b.分 - a.分 || b.at - a.at)
  return 打分.slice(0, Math.max(1, limit))
}
