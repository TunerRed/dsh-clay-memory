// lib/patch-apply.mjs —— 并发安全的「按 id 补丁写入」（2026-10-30 B 阶段）
//
// 背景：批量路由（refine / wash-keys / classify-types / expand / backfill-stable）
//   都是「await 问模型 → 改一批条目 → 整份写回」。等模型那几秒里，
//   别人可能新记 / 删 / 合了记忆；拿 await 前的快照整份写回会把中间的变化盖掉。
//   2026-10-24 自动扩词（lib/index.js:2038）因此踩出过「记忆静默丢失」，已在那边修好；
//   这里把同一套做法抽出来给五个批量路由共用。
//
// 正确姿势（照抄自动扩词）：
//   1. await 之后重新 loadStore 拿新库
//   2. 代际一致才继续（这中间整库被清过 = 结果作废）
//   3. 按 id 在新库里找到本批条目，只改它们
//   4. saveStore(sid, 新库)

export const purgeEpochOf = (data) =>
  typeof (data && data.purgeEpoch) === 'string' ? data.purgeEpoch : ''

// 等模型那几秒里，字段被别人改过没有：新库当前值 ≠ 旧快照值 = 中间被动过
// （审查 B5：旧任务回来不许覆盖中间的外部改动）
export function 中间被改过(新值, 旧值) {
  return String(新值 || '') !== String(旧值 || '')
}

// 旧快照与新库同代际 = 这中间没发生过整库清理
export function 代际一致(旧库, 新库) {
  return purgeEpochOf(旧库) === purgeEpochOf(新库)
}

/**
 * 在新库里按 id 找到条目并执行 改法(m)。
 * 找不到（这中间被删 / 被合）就跳过，绝不硬写。
 * 已标「别记」（这中间被她判了「这条不对」）也跳过 —— 审查 B6：
 * 旧任务回来不许动她已经否决的条目。
 * 返回实际改到的条数；改法(m) 返回 truthy 才计数（调用方用这个区分「改了」与「没动」）。
 */
export function 按id改写(新库, 目标ids, 改法) {
  const 表 = Array.isArray(新库 && 新库.memories) ? 新库.memories : []
  let 改了 = 0
  for (const id of 目标ids) {
    const m = 表.find((x) => x && String(x.id) === id)
    if (!m) continue
    if (m.别记) continue
    if (改法(m)) 改了++
  }
  return 改了
}

/**
 * 字段级撤销（审查 P1-3）：按批次改动明细恢复旧值。
 *   改动 = [{ id, 旧: {字段: 旧值}, 新: {字段: 新值} }]
 *   只动「当前值 === 本批写入的新值」的字段 —— 中间又被别人改过的字段不动；
 *   条目中间被删了也不复活（找不到就跳过）。旧值 undefined = 删除该字段。
 * 返回 { 恢复条, 恢复字段 }。
 */
export function 按明细恢复(data, 改动) {
  const 表 = Array.isArray(data && data.memories) ? data.memories : []
  let 恢复条 = 0
  let 恢复字段 = 0
  for (const c of Array.isArray(改动) ? 改动 : []) {
    const m = 表.find((x) => x && String(x.id) === String(c && c.id))
    if (!m) continue
    const 旧 = (c && c.旧) || {}
    const 新 = (c && c.新) || {}
    let 动了 = false
    for (const 字段 of Object.keys(新)) {
      if (JSON.stringify(m[字段]) !== JSON.stringify(新[字段])) continue
      if (旧[字段] === undefined) delete m[字段]
      else m[字段] = 旧[字段]
      恢复字段++
      动了 = true
    }
    if (动了) 恢复条++
  }
  return { 恢复条, 恢复字段 }
}

// ---------- GPT 整改 P1：字段级 compare-and-set ----------
//
// 五个批量路由都改「LLM 前拍目标字段快照 → LLM 后逐字段 CAS」：
//   等模型那几秒里某个字段被别人动过 → 该字段跳过（保留外部改动），
//   别的字段照常应用。旧版只有 事实键/别记 两处守卫，category/importance/related/
//   type/text 被外部改过照样会被模型旧结果覆盖。
//
// 快照形状：{ [字段]: { 有: 该字段是否存在于条目, 值: 当时的值 } }
//   「不存在」与「值是 undefined」语义不同（写回时一个要跳过、一个可以写），
//   所以用 有 标志区分，不能只存值。

/** 拍一条的一个字段快照 */
export function 拍字段(条目, 字段) {
  return { 有: 字段 in 条目, 值: 条目[字段] }
}

/** 拍一批条目的多个字段 → Map<id, {字段: 快照}> */
export function 拍一批(条目们, 字段们) {
  const 表 = new Map()
  for (const m of Array.isArray(条目们) ? 条目们 : []) {
    if (!m) continue
    const 行 = {}
    for (const f of 字段们) 行[f] = 拍字段(m, f)
    表.set(String(m.id), 行)
  }
  return 表
}

/** 快照之后字段被外部动过没有：当前对象同字段存在性一致、且值深比较相等 = 没动过 */
export function 没动过(当前, 快照行, 字段) {
  const 候 = 快照行 && 快照行[字段]
  if (!候) return false
  if ((字段 in 当前) !== 候.有) return false
  return JSON.stringify(当前[字段]) === JSON.stringify(候.值)
}
