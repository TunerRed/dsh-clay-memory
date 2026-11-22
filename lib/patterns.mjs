// 模式层（dream 的产物）—— 1.12.55 起
//
// 为什么单独一张表，而不是塞进 memories：
//   模式的元数据和普通记忆完全不同 —— 普通记忆是「内容 / 时间 / 事实键」，
//   模式是「触发条件 / 证据 / 反证 / 状态机」。混进去的话召回、注入、去重全要改，
//   而且模式绝不能默认参与检索 —— 外部评审判死的一条是：
//   「每轮最多注入 1 条，且只走条件路由；无脑塞 2~3 条会吃掉 30~40% 的 800 字预算」。
//
// 四条硬约束写在这个文件里（来自 2026-11-18 两次外部评审）：
//   1. **禁止心理/动机归因** —— 只能写「触发条件 + 观测规律 + 交互策略」三段式。
//      「他其实想…」「他在测试我」「说明他不信任…」这类，一律拒收。
//      理由：证据 ID 只能证明「事件发生过」，证不了「归因是对的」。
//   2. **跨天/跨会话独立性** —— 证据 ≥ 3 条，且必须来自 ≥ 2 个不同日期。
//      防止「某一天他连续吐槽同一个问题 4 次」被当成终身规律。
//   3. **强制反证检索** —— 入库前先拿关键词/反义词去全库找反例（tools/check-hypothesis.mjs）。
//   4. **生命周期状态机** —— candidate（不进注入）→ tentative（带弱语气）→ verified → deprecated。
//
// ⚠ 这张表是「我对他行为的一点猜测」，不是事实。任何一条被主人否掉，
//   都要走 deprecated，而不是删掉 —— 留着才能知道他为什么不喜欢这个猜法。

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { STORE_DIR } from './paths.mjs'
import { diag } from './diag.mjs'

export const 状态们 = ['candidate', 'tentative', 'verified', 'deprecated']
export const 证据下限 = 3
export const 日期下限 = 2

export function 模式路径() {
  return join(STORE_DIR, '_patterns.json')
}

// 禁止出现的动机归因词（约束 1）
// 这些词一出现，说明模型在替我「脑补他为什么这样做」，而证据只能证明他做了。
export const 动机词 =
  /(?:他其实想|其实是想|他在测试|是在测试|在试探|他嘴上说|嘴上说.{0,10}心里想|说明他|证明他|意味着他|因为他怕|因为他觉得|他担心|他不信任|他很看重)/

/** 读模式库（永远是只读副本，改完要写回）。 */
export function 读模式() {
  const p = 模式路径()
  if (!existsSync(p)) return { v: 1, patterns: [] }
  try {
    const 数据 = JSON.parse(readFileSync(p, 'utf8'))
    if (!数据 || !Array.isArray(数据.patterns)) return { v: 1, patterns: [] }
    return { v: 1, patterns: 数据.patterns }
  } catch (error) {
    diag('  模式库读失败，当成空的：' + ((error && error.message) || error))
    return { v: 1, patterns: [] }
  }
}

/** 写回模式库（先写临时文件再换名，避免写一半把库写坏）。 */
export function 写模式(数据) {
  const p = 模式路径()
  try {
    mkdirSync(STORE_DIR, { recursive: true })
    const 临时 = p + '.tmp'
    writeFileSync(临时, JSON.stringify({ v: 1, patterns: 数据.patterns || [] }, null, 2), 'utf8')
    renameSync(临时, p)
    return true
  } catch (error) {
    diag('  模式库写失败：' + ((error && error.message) || error))
    return false
  }
}

/**
 * 校验一条候选模式。返回 { ok, 问题: string[] }。
 * 四条硬约束里有三条在这里落地（反证检索在 lib/dream.mjs 里做）。
 */
export function 校验模式(p, 现在 = Date.now()) {
  const 问题 = []
  const 文 = String((p && p.text) || '').trim()

  if (!文) {
    问题.push('text 是空的')
  } else {
    // 约束 1：三段式
    if (!/触发|当|在.{0,20}时候/.test(文)) 问题.push('缺「触发条件」（什么时候这条模式才生效）')
    if (!/规律|倾向于|通常会|往往|容易/.test(文)) 问题.push('缺「观测规律」（他做了什么）')
    if (!/策略|建议|应该|可以/.test(文)) 问题.push('缺「交互策略」（我该怎么做）')
    // 约束 1：动机归因
    const m = 文.match(动机词)
    if (m) 问题.push('含动机归因「' + m[0] + '」—— 只能说可观测的前因后果，不能猜他为什么')
  }

  // 约束 2：证据条数与日期跨度
  const 证据 = Array.isArray(p && p.evidence) ? p.evidence.filter(Boolean) : []
  if (证据.length < 证据下限) 问题.push('证据只有 ' + 证据.length + ' 条，至少要 ' + 证据下限 + ' 条')
  const 日期集 = new Set(
    (Array.isArray(p && p.evidenceDates) ? p.evidenceDates : [])
      .map((d) => String(d || '').slice(0, 10))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
  )
  if (日期集.size < 日期下限) {
    问题.push('证据只来自 ' + 日期集.size + ' 个日期，至少要 ' + 日期下限 + ' 个（同一天连说四遍不算规律）')
  }

  // 触发条件必须可路由（否则没法做条件注入）
  const t = (p && p.trigger) || {}
  const 有触发 =
    (typeof t.intent === 'string' && t.intent && t.intent !== 'any') ||
    (Array.isArray(t.keywords) && t.keywords.length > 0) ||
    (Array.isArray(t.hours) && t.hours.length > 0)
  if (!有触发) 问题.push('trigger 里一个路由条件都没有（intent / keywords / hours 全空）')

  return { ok: 问题.length === 0, 问题 }
}

/** 生成一个稳定的 id。 */
export function 新id(现在 = Date.now()) {
  return 'pat-' + 现在.toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

/**
 * 加一条候选模式。
 * 返回 { ok, id?, 问题? , 重复? }。
 * 重复判定：同一 trigger 且文像度高（≥0.8）的已存在 → 不重复加，把证据并过去。
 */
export function 加模式(候选, 现在 = Date.now()) {
  const 数据 = 读模式()
  const 文 = String(候选.text || '').trim()

  // ⚠ 查重要在**校验之前**：同一条候选第二次来时可能只带一条新证据，
  //   单独看它连「证据 ≥3」都过不了；但它是并进一条已经过校验的老条目的，
  //   结果是让老条目更硬，不是新造一条弱的。
  for (const 老 of 数据.patterns) {
    if (String(老.text || '').slice(0, 40) === 文.slice(0, 40)) {
      const 旧证 = new Set(Array.isArray(老.evidence) ? 老.evidence : [])
      for (const id of 候选.evidence || []) 旧证.add(id)
      老.evidence = [...旧证]
      老.evidenceDates = [...new Set([...(老.evidenceDates || []), ...(候选.evidenceDates || [])])]
      老.updatedAt = new Date(现在).toISOString()
      写模式(数据)
      return { ok: true, id: 老.id, 合并: true }
    }
  }

  const 检查 = 校验模式(候选, 现在)
  if (!检查.ok) return { ok: false, 问题: 检查.问题 }

  const 条 = {
    id: 新id(现在),
    text: 文,
    trigger: 候选.trigger || {},
    evidence: 候选.evidence || [],
    evidenceDates: 候选.evidenceDates || [],
    counter: 候选.counter || [],
    status: 'candidate',
    hit: 0,
    correction: 0,
    createdAt: new Date(现在).toISOString(),
    updatedAt: new Date(现在).toISOString(),
  }
  数据.patterns.push(条)
  写模式(数据)
  return { ok: true, id: 条.id }
}

/** 改状态（带原因，留痕）。 */
export function 改状态(id, 新状态, 原因 = '', 现在 = Date.now()) {
  if (!状态们.includes(新状态)) return { ok: false, 问题: ['未知状态：' + 新状态] }
  const 数据 = 读模式()
  const 条 = 数据.patterns.find((p) => p.id === id)
  if (!条) return { ok: false, 问题: ['找不到 ' + id] }
  条.状态历史 = Array.isArray(条.状态历史) ? 条.状态历史 : []
  条.状态历史.push({ at: new Date(现在).toISOString(), from: 条.status, to: 新状态, 原因: String(原因 || '') })
  条.status = 新状态
  条.updatedAt = new Date(现在).toISOString()
  写模式(数据)
  return { ok: true }
}

/**
 * 按触发条件挑一条模式（条件路由，每轮最多 1 条）。
 * 只考虑 tentative / verified —— candidate 不进注入，deprecated 永不进。
 * 返回模式对象或 null。
 */
export function 取匹配模式(意图, query, 时刻 = new Date()) {
  const 数据 = 读模式()
  const 文 = String(query || '').toLowerCase()
  const 小时 = 时刻.getHours()
  let 最佳 = null
  let 最佳分 = 0
  for (const p of 数据.patterns) {
    if (p.status !== 'tentative' && p.status !== 'verified') continue
    const t = p.trigger || {}
    // ⚠ intent 是**硬过滤**，不是加分项：一条声明了 life 的模式，
    //   在 tech 意图下就算关键词撞上了也不该冒出来 ——
    //   「加班累了喜欢聊游戏」这条策略套到「Kafka 报错」上纯属噪音。
    if (t.intent && t.intent !== 'any' && 意图 && 意图 !== 'unknown' && t.intent !== 意图) continue
    let 分 = 0
    if (t.intent && t.intent !== 'any' && t.intent === 意图) 分 += 1
    // ⚠ 关键词用**子串包含**，不用分词 —— 中文短 query（「今天好累」）按空格切出来是一整个字符串，
    //   拿词集去比对永远命中不了单个「累」。
    if (Array.isArray(t.keywords) && t.keywords.some((k) => k && 文.includes(String(k).toLowerCase()))) 分 += 3
    if (Array.isArray(t.hours) && t.hours.includes(小时)) 分 += 2
    // 命中过但被纠正过的要压一压（打脸多的别老拿出来）
    const 校正 = Number(p.correction) || 0
    if (校正 > 0) 分 = 分 / (1 + 校正)
    if (分 > 最佳分) {
      最佳分 = 分
      最佳 = p
    }
  }
  if (!最佳 || 最佳分 < 2) return null
  return 最佳
}

/** 记账：这条被注入了。 */
export function 记命中(id) {
  const 数据 = 读模式()
  const 条 = 数据.patterns.find((p) => p.id === id)
  if (!条) return false
  条.hit = (Number(条.hit) || 0) + 1
  条.updatedAt = new Date().toISOString()
  写模式(数据)
  return true
}

/** 记账：这条被纠正了（主人明确否掉，或我判断用错了）。 */
export function 记纠正(id) {
  const 数据 = 读模式()
  const 条 = 数据.patterns.find((p) => p.id === id)
  if (!条) return false
  条.correction = (Number(条.correction) || 0) + 1
  条.updatedAt = new Date().toISOString()
  // 被纠正 2 次以上自动降级（生命周期状态机）
  if (条.correction >= 2 && 条.status !== 'deprecated') {
    条.状态历史 = Array.isArray(条.状态历史) ? 条.状态历史 : []
    条.状态历史.push({
      at: new Date().toISOString(),
      from: 条.status,
      to: 'deprecated',
      原因: '被纠正 ' + 条.correction + ' 次，自动打入冷宫',
    })
    条.status = 'deprecated'
  }
  写模式(数据)
  return true
}

/** 渲染成注入文本（很短，带「可能/倾向」的弱语气）。 */
export function 渲染模式(p) {
  if (!p) return ''
  const 弱 = p.status === 'tentative' ? '（这是观察到的一点倾向，不是定论）' : ''
  return '【行为模式】' + String(p.text || '').trim() + (弱 ? '\n' + 弱 : '')
}
