// lib/routes-stale.mjs —— 陈旧检查的路由（1.12.74 起）
// ============================================================================
// 只做一件事：把 `_stale.json` 里的「路径失效」清单拿给体检页，用户拍板后改记忆。
// 三条路由：
//   GET  /dsh-clay-memory/stale          读清单（待确认 / 已恢复 / 已忽略 / 已处置）
//   POST /dsh-clay-memory/stale/action   { 键, 动作: 'confirm' | 'ignore', ids?, session? }
//   POST /dsh-clay-memory/stale/scan     手动立刻扫一遍（不吃模型）
//
// ⚠ 为什么 confirm 是「标 已被取代」而不是删：
//   「路径不存在」不等于「这条记忆错了」——可能是东西搬走了、也可能是当年记错了位置。
//   标 已被取代 之后召回不再出它，但原件还在，随时能恢复（这是 1.12.59 那套现成的语义）。
// ============================================================================
import { 全库记忆, 标失效路径数, 跨层标取代, 跨层撤销取代, 读清单, 清单路径, 跑一次, 写清单 } from './stale.mjs'
import { loadCfg, saveCfg } from './cfg.mjs'

function 发(回复, 体, 码 = 200) {
  try {
    回复.writeHead(码, { 'content-type': 'application/json; charset=utf-8' })
    回复.end(JSON.stringify(体))
  } catch (error) {}
}

function 现在() {
  return new Date().toISOString()
}

/** 读清单并整理成体检页能直接画的三组。 */
export function 概览() {
  try {
    const 清 = 标失效路径数(读清单())
    const 全部 = Object.entries(清.记录 || {}).map(([键, 记录]) => Object.assign({ 键 }, 记录))
    const 按 = (状态) => 全部.filter((x) => x && x.状态 === 状态)
    return {
      ok: true,
      清单: 清单路径(),
      上次检查: 清.上次检查 || '',
      统计: {
        待确认: 按('pending').length,
        已恢复: 按('recovered').length,
        已忽略: 按('ignored').length,
        已处置: 按('confirmed').length,
      },
      待确认: 按('pending'),
      已恢复: 按('recovered'),
      已忽略: 按('ignored'),
      已处置: 按('confirmed'),
    }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
}

/**
 * 处置一条：confirm = 标「已被取代」（记忆还在，召回不再出）；
 *           ignore  = 记进这条路径的 ignoredIds（同样的路径以后不再烦你，但新记忆会重新拉回来）。
 */
export function 处置(体) {
  const 键 = String((体 && 体.键) || '')
  const 动作 = String((体 && 体.动作) || '')
  const 指定 = Array.isArray(体 && 体.ids) ? 体.ids.map(String) : null
  if (!键) return { ok: false, error: '缺 键' }
  if (动作 !== 'confirm' && 动作 !== 'ignore' && 动作 !== 'undo') {
    return { ok: false, error: '动作只有 confirm / ignore / undo' }
  }

  const 清 = 读清单()
  标失效路径数(清)
  const 条 = 清.记录 && 清.记录[键]
  if (!条) return { ok: false, error: '清单里没有这条了（可能被下一次扫描清掉）' }

  const 全部id = Array.from(
    new Set([
      ...(条.命中记忆 || []).map((x) => x && x.id).filter(Boolean),
      ...(动作 === 'undo' && Array.isArray(条.已处置) ? 条.已处置.filter(Boolean) : []),
    ]),
  )
  const 目标 = 指定 && 指定.length ? 指定.filter((id) => 全部id.includes(id)) : 全部id
  if (!目标.length) return { ok: false, error: '没有可处置的记忆' }

  if (动作 === 'ignore') {
    const 旧 = Array.isArray(条.ignoredIds) ? 条.ignoredIds.slice() : []
    for (const id of 目标) if (!旧.includes(id)) 旧.push(id)
    条.ignoredIds = 旧
    // 全部命中都被忽略了才算 ignored；还剩没忽略的就留在待确认里
    条.状态 = 全部id.length && 全部id.every((id) => 旧.includes(id)) ? 'ignored' : 'pending'
    清.记录[键] = 条
    写清单(清)
    return { ok: true, 动作, 条, 改了记忆: 0 }
  }

  const 时间 = 现在()
  // 2026-11-22：护栏不再「硬禁用」。机械规则（举例/列举）只是提醒，最后一下该由人拍 ——
  //   前端会弹二次确认，确认过再带 强制: true 过来，这里就放行。
  const 强制 = !!(体 && 体.强制 === true)

  // undo：撤销「陈旧检查」标的 已被取代；若条目原本是「已恢复（路径又在了）」，
  //   撤销后保持 recovered（已恢复），不再反过来丢进「待确认（路径失效）」里。
  if (动作 === 'undo') {
    const 层 = 跨层撤销取代(目标, 时间)
    const 改了 = 层.reduce((n, x) => n + x.改了, 0)
    if (!改了) return { ok: false, error: '没找到「被陈旧检查标过、还没撤」的记忆（可能已经撤过了）。' }
    if (!Array.isArray(条.已撤销)) 条.已撤销 = []
    for (const id of 目标) if (!条.已撤销.includes(id)) 条.已撤销.push(id)
    // 撤销掉的那几条不再算「已处置」，否则状态判定会一直以为它们处理完了
    if (Array.isArray(条.已处置)) 条.已处置 = 条.已处置.filter((id) => !目标.includes(id))
    if (条.状态 !== 'recovered') 条.状态 = 'pending'
    delete 条.处置于
    清.记录[键] = 条
    写清单(清)
    return { ok: true, 动作, 条, 改了记忆: 改了, 层 }
  }

  // confirm：跨层标「已被取代」，不删原件。
  //
  // ⚠ 2026-11-22 踩过的坑：原来用 loadStore(体.session) 单层视图，前端不传 session 时
  //   工作区层的记忆根本不在视图里 → 改了 0 条却照样记 confirmed（假账）。
  //   现在用 跨层标取代 直接按 id 找到它所在的层；改了 0 条就报错，不写 confirmed。
  //
  // 两道机械护栏（不猜语义，只在「明显像举例」时收手）：
  //   a. 这条记忆同一段话里还有别的有效路径 → 多半在说「A 没了但 B 还在」，别一键标过时。
  //   b. 这条记忆一共出现在 ≥2 条失效路径里 → 多半在列举（「只探测 A、B、C 这几个」），
  //      标掉它连排坑知识一起丢（真机踩过：detectQq 那条就是这么被误杀的）。
  if (!强制 && 条.伴随有效路径) {
    return {
      ok: false,
      error: '这段记忆里还有别的有效路径，像是在举例或对比，先别标过时（可以点「留着，别管它」）。',
    }
  }
  const 列举 = (条.命中记忆 || []).filter((x) => x && 目标.includes(x.id) && Number(x.失效路径数 || 1) >= 2)
  if (!强制 && 列举.length) {
    return {
      ok: false,
      error: '这条记忆提到了不止一个失效路径，像是在列举，标过时会连带着把排坑知识一起丢掉（可以点「留着，别管它」）。',
    }
  }

  const 为什么 = '这条里写的路径在磁盘上已经不存在了：' + (条.字面 || 键)
  const 层 = 跨层标取代(目标, 为什么, 时间)
  const 改了 = 层.reduce((n, x) => n + x.改了, 0)
  if (!改了) return { ok: false, error: '一条记忆都没改到（可能已经不在了），这次不算处置，状态没动。' }
  // 2026-11-22：状态要按「这次到底处置了几条」来定，不能再无条件 confirmed。
  //   前端支持只勾一部分 ids（体.ids）；原来哪怕只处置了 3 条中的 1 条，整条路径也标 confirmed，
  //   没处置的那 2 条就跟着从「待确认」里消失了 —— 相当于替用户做主了。
  const 处置过 = new Set(Array.isArray(条.已处置) ? 条.已处置 : [])
  for (const id of 目标) 处置过.add(id)
  条.已处置 = Array.from(处置过)
  const 全处置 = 全部id.length > 0 && 全部id.every((id) => 处置过.has(id))
  条.状态 = 全处置 ? 'confirmed' : 'pending'
  条.处置于 = 时间
  清.记录[键] = 条
  写清单(清)
  return { ok: true, 动作, 条, 改了记忆: 改了, 层 }
}

/** 手动立刻扫一遍（顺手把 _上次陈旧检查 记上，免得定时器马上又来一遍）。 */
export function 立刻扫() {
  // 扫所有层的记忆，不只是 global —— 否则工作区/会话层的路径要等它自己那条会话才扫到。
  const 记忆们 = 全库记忆()
  if (!记忆们.length) return { ok: false, error: '读不到记忆库' }
  const r = 跑一次(记忆们, new Date())
  try {
    const c = loadCfg()
    c._上次陈旧检查 = Date.now()
    saveCfg(c)
  } catch (error) {}
  return { ok: true, 统计: r.统计, 待确认数: r.待确认数 }
}

export function 注册陈旧路由(mroute, 环) {
  const 读JSON体 = 环 && 环.读JSON体

  mroute('/dsh-clay-memory/stale', (req, res) => {
    发(res, 概览())
  })

  mroute('/dsh-clay-memory/stale/action', async (req, res) => {
    let 体 = null
    try {
      体 = 读JSON体 ? await 读JSON体(req) : null
    } catch (error) {
      return 发(res, { ok: false, error: '请求体读不出来：' + String((error && error.message) || error) })
    }
    try {
      发(res, 处置(体))
    } catch (error) {
      发(res, { ok: false, error: String((error && error.message) || error) })
    }
  })

  mroute('/dsh-clay-memory/stale/scan', async (req, res) => {
    let 体 = null
    try {
      体 = 读JSON体 ? await 读JSON体(req) : null
    } catch (error) {
      体 = null
    }
    try {
      发(res, 立刻扫(体))
    } catch (error) {
      发(res, { ok: false, error: String((error && error.message) || error) })
    }
  })
}
