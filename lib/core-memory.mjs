// 骨架层（_core.json）—— 2026-11-04 决议四/七：不动 AGENTS.md，在插件里单独准备一个分类
//
// 为什么单独一层：
//   骨架是「每轮都要在场的长期背景」（关系、风格、边界），但不是相关性召回能保证的 ——
//   它不依赖「这句话问了什么」，也不走事实池的 factsMax / 相关性门。
//
// 数据放哪：
//   $DSH_HOME/clay-memory/_core.json（跟 _facts.json / clay-memory.db 同目录）
//   不进插件包 —— 这是用户本地数据，发布时别人看到的是自己的骨架。
//
// 渲染格式：
//   核心画像（core: true，最多 2 条）→ 【核心画像】
//   其余骨架条目 → 【长期背景】
//   都排在「你记得的事」前面。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CFG_DIR } from './paths.mjs'

export function 骨架文件() {
  return join(CFG_DIR, 'clay-memory', '_core.json')
}

// 读骨架条目。文件不存在 / JSON 坏 / items 不是数组 → 空数组，不抛。
export function 读骨架(路径) {
  let raw
  try {
    raw = JSON.parse(readFileSync(路径 || 骨架文件(), 'utf8'))
  } catch {
    return []
  }
  const items = raw && Array.isArray(raw.items) ? raw.items : []
  return items.filter((it) => it && typeof it.content === 'string' && it.content.trim())
}

// 渲染成注入文本块。空骨架返回空串（调用方过滤掉）。
//
// ⭐ 1.10.3（F6）：骨架有**独立字数预算**（规划 §4.2 原本建议 maxChars 的 40%；
//   2026-11-19 实测后提到 60%，见下面常量的注释）。
//   以前骨架不限字数，条目一多就白占每轮上下文 —— 而它又不受 maxItems / factsMax 管。
//   现在：核心画像先占位（最多 3 条，永远不丢），其余按 importance 从高到低往里塞，
//   塞不下就整条不收（不切半句 —— 半条骨架比没有更误导）。
// ⭐ 2026-11-19：0.4 → 0.6。实测 12 条骨架（445 字）在 320 预算下只渲染出 7 条，
//   剩下 5 条被「塞不下就跳过」静默丢掉（大肥鱼 / 妈妈称呼 / 先证明再收尾 / 工具偏好 / 证据要求）。
//   骨架是「每轮都必须在场」的长期人设，不该像检索池那样按预算裁 —— 445 字全进要 480，
//   800 × 0.6 = 480 刚好，还留 35 字余量；再加第 13 条就会淘汰最不重要的那条，
//   这正是要的 One-in-One-out 摩擦力（见 docs/交接-2026-11-19.md 的 A 组清单）。
export const 骨架预算比 = 0.6

export function 骨架预算(policy) {
  const 总 = Number(policy && policy.maxChars)
  const 基数 = Number.isFinite(总) && 总 > 0 ? 总 : 800
  return Math.max(80, Math.round(基数 * 骨架预算比))
}

export function render骨架(items, 字数上限) {
  const 条 = Array.isArray(items) ? items.filter((it) => it && typeof it.content === 'string' && it.content.trim()) : []
  if (!条.length) return ''
  const 限 = Number.isFinite(字数上限) && 字数上限 > 0 ? 字数上限 : 0
  const 按重 = (a, b) => (Number(b.importance) || 0) - (Number(a.importance) || 0)
  // 2 → 3（2026-11-18，1.12.48）：骨架里第 3 条 core（core-relationship-bonds，关系那段）
  //   原来永远进不来 —— 文件里有 3 条 core:true，这里只取 2，渲染出的【核心画像】少了它。
  //   实测：改前渲染 300 字里没有它。腾位置的办法是删掉了 core-relationship-nicknames
  //   （称呼细节 AGENTS.md 本来就有），所以不是「多塞一条」，是「把重复的换成缺的」。
  const 核心 = 条.filter((it) => it.core === true).sort(按重).slice(0, 3)
  const 其余 = 条.filter((it) => it.core !== true).sort(按重)
  const 留 = []
  let 已用 = 核心.reduce((s, it) => s + it.content.trim().length, 0)
  for (const it of 其余) {
    const n = it.content.trim().length
    if (限 && 已用 + n > 限) continue // 塞不下就跳过（后面更短的还能进来）
    留.push(it)
    已用 += n
  }
  const 段 = []
  if (核心.length) 段.push(`【核心画像】\n${核心.map((it) => `- ${it.content.trim()}`).join('\n')}`)
  if (留.length) 段.push(`【长期背景】\n${留.map((it) => `- ${it.content.trim()}`).join('\n')}`)
  return 段.join('\n\n')
}
