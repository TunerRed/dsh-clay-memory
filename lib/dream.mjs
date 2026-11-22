// dream 归纳管线 —— 1.12.55 起
//
// 干什么：从「一条一条的记忆」里，找出**跨会话、跨时间、带触发条件**的行为模式。
//
// 它 ≠ 摘要：摘要把 N 条压成 1 条会丢信息（实测 661 字画像压到 317 字，
// 问「推荐点视频」的词面覆盖率直接从 0.331 掉到 0）。dream 不压缩、不替换，
// 它只**新增**一种叫「模式」的东西，原文一个字都不动。
//
// 它 ≠ 画像提取：像「对黑盒零容忍、要求每对记账」这种，是用户在交互里直接说过的
// 显性偏好，该在写入/提取那一刻收成画像，不该等到 dream 阶段来「梦」。
// dream 只负责那些**单次对话里根本写不出来**的东西 —— 比如
// 「加班夜会从技术话题滑向闲聊」「白天闲下来才发歌单」。
//
// ⚠ 两次外部评审定的口径（别改）：
//   1. 只找规律，绝不替换原始碎片
//   2. 每条必须过 lib/patterns.mjs 的四道约束（三段式 / 禁动机 / 证据跨天 / 可路由）
//   3. 入库前跑反证检索（tools/check-hypothesis.mjs 的同一套思路）
//   4. 产出一律 candidate，不进 prompt —— 要不要用它，是人的决定

import { 读模式, 加模式, 校验模式, 读模式 as _读 } from './patterns.mjs'
import { loadCfg, saveCfg } from './cfg.mjs'
import { 问模型 } from './llm.mjs'
import { diag } from './diag.mjs'

// 一次喂多少条 —— 太多模型会抓不住重点，太少归纳不出跨条目规律
export const 每批条数 = 40
// 最多产出几条候选（宁可少，也别一次灌一堆真假参半的）
export const 候选上限 = 5

export const 归纳系统 = `你在给一个长期记忆系统做「模式归纳」。

给你的是一批记忆条目（每条带 id、时间、正文、类别）。请找出**跨会话、跨时间、带触发条件**的行为模式。

严格标准（不满足就一条都别给）：
1. 必须是「在<什么情境/状态>下，他倾向于<做什么>；建议<我该怎么应对>」三段式。
2. 不能是单条记忆的复述 —— 复述叫事实，不叫模式。
3. **不许猜动机**。不许出现「他其实想」「他在测试我」「说明他很看重」「因为他怕」这类句子。
   证据只能证明「他做了」，证不了「他为什么做」。
4. 每条至少要有 3 条证据，而且证据必须来自**至少 2 个不同日期**。
   同一天里他连说四遍同一件事，不算规律。
5. 必须能说清「什么时候这条模式才该生效」（触发条件：意图 life/tech、关键词、或时段）。
6. 宁可一条不给，也不要给「他有时候放松、有时候严肃」这种正确的废话。

输出**严格 JSON 数组**，不要 markdown 代码块，不要解释。每项：
{"text":"当<触发>时，他倾向于<行为>；建议<策略>","trigger":{"intent":"life|tech|any","keywords":["词"],"hours":[22,23]},"evidence":["记忆id","记忆id","记忆id"],"evidenceDates":["2026-11-01","2026-11-02"]}

示例（合格，照这个粒度写）：
[{"text":"当涉及自动改数据、清理、迁移这类不可逆操作时，他倾向于先要证据和回滚路径；建议先出改动预览与回滚方式，再问要不要做","trigger":{"intent":"any","keywords":["自动","清理","删除","迁移"],"hours":[]},"evidence":["id1","id2","id3"],"evidenceDates":["2026-10-27","2026-11-12","2026-11-15"]}]

不合格的（别写成这样）：
- 「他其实很没安全感」→ 猜动机，直接作废
- 「主人爱吃西红柿鸡蛋盖浇饭」→ 单条事实，不是跨会话规律
- 「他会用玩笑表达真实需求」→ 只有 1 条证据撑不住

**只要有一条真正站得住就给一条**，不必凑数；但也不要因为「不够完美」就全部给空 ——
真实库里确实很少见教科书式的规律，能挖出一条是一条。

没有符合条件的才输出 []。`

/** 把一批记忆压成喂给模型的文本（只给 id/日期/类别/正文，不带重要性噪音）。 */
export function 拼素材(条们) {
  return 条们
    .map((m) => {
      const 日期 = String(m.createdAt || '').slice(0, 10) || '?'
      const 类 = m.is_knowledge ? '知识' : '画像'
      const 文 = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 220)
      return `- [${m.id}] ${日期} ${类}｜${文}`
    })
    .join('\n')
}

/**
 * 按日期分散挑素材。
 *
 * 为什么不能直接 `slice(0, N)`：库里的记忆是**按导入批次**排的，最早那批
 * （2026-10-27 一次性导入的画像）会一直占满前 40 条 —— 1.12.55 真机第一次跑
 * 就是 40 条里 **31 条来自同一天**，而归纳的硬标准要求「证据跨 ≥2 个日期」，
 * 模型每次都只能回空数组（产出 0 条）。挑素材必须按日期打散，让它看到
 * 「不同日子里的他」，否则 dream 永远只能看见同一个下午。
 */
export function 挑素材(画像, 知识, 上限 = 每批条数) {
  // 一轮一轮地取：每轮每个日期各取一条，直到够数或全取完
  const 打散 = (池, 预算) => {
    const 按日 = new Map()
    for (const m of 池) {
      const d = String(m.createdAt || '').slice(0, 10) || '?'
      if (!按日.has(d)) 按日.set(d, [])
      按日.get(d).push(m)
    }
    const 日们 = [...按日.values()]
    // 单个日期不许占太多：否则「30 条导入日 + 10 个 1 条的日子」时，
    // 那个大户照样能吃掉一半预算，等于没打散
    const 每日上限 = Math.max(2, Math.ceil(预算 / Math.min(日们.length || 1, 8)))
    const 出 = []
    const 已取 = new Map()
    for (let 轮 = 0; 出.length < 预算; 轮 += 1) {
      let 有取到 = false
      for (let i = 0; i < 日们.length; i += 1) {
        const 条们 = 日们[i]
        if (!条们[轮]) continue
        if ((已取.get(i) || 0) >= 每日上限) continue
        出.push(条们[轮])
        已取.set(i, (已取.get(i) || 0) + 1)
        有取到 = true
        if (出.length >= 预算) break
      }
      if (!有取到) break
    }
    // 第二趟：单日上限会让「大户 + 一堆一条的日子」凑不满预算（第一趟只拿到 12 条），
    // 这时才放开上限从剩余里补 —— 均衡是手段，凑够素材才是目的
    if (出.length < 预算) {
      const 已选 = new Set(出)
      for (const 条们 of 日们) {
        for (const m of 条们) {
          if (已选.has(m)) continue
          出.push(m)
          if (出.length >= 预算) break
        }
        if (出.length >= 预算) break
      }
    }
    return 出
  }
  const 画像预算 = Math.min(画像.length, Math.ceil(上限 * 0.67))
  const 出 = 打散(画像, 画像预算)
  const 余 = 上限 - 出.length
  if (余 > 0) 出.push(...打散(知识, 余))
  return 出
}

/**
 * 逐条抠：JSON 数组被截断时，把前面已经完整的 `{...}` 一条条救回来。
 *
 * ⚠ 2026-11-21：以前是 all-or-nothing —— 模型把正文写到第 551 个字符断了，
 *   整个数组就废掉、一条都救不回（那次就是这么丢的）。这里按大括号配平逐条
 *   parse：断在最后一条就只丢最后一条，前面的全收。
 *   字符串里的 `{` `}` 和转义引号必须跳过，否则正文里带花括号的候选会被切错。
 */
export function 逐条抠(s) {
  const 起 = s.indexOf('[')
  if (起 < 0) return []
  const 出 = []
  let i = 起 + 1
  while (i < s.length) {
    const 对象起 = s.indexOf('{', i)
    if (对象起 < 0) break
    let 深 = 0
    let 串中 = false
    let 转义 = false
    let 止 = -1
    for (let j = 对象起; j < s.length; j++) {
      const ch = s[j]
      if (串中) {
        if (转义) 转义 = false
        else if (ch === '\\') 转义 = true
        else if (ch === '"') 串中 = false
        continue
      }
      if (ch === '"') 串中 = true
      else if (ch === '{') 深 += 1
      else if (ch === '}') {
        深 -= 1
        if (深 === 0) {
          止 = j
          break
        }
      }
    }
    if (止 < 0) break // 断在半路，后面不会再有完整对象了
    try {
      const v = JSON.parse(s.slice(对象起, 止 + 1))
      if (v && typeof v === 'object' && !Array.isArray(v)) 出.push(v)
    } catch {
      // 这条切得不对（极少见），跳过继续找下一个 `{`
    }
    i = 止 + 1
  }
  return 出
}

/** 从模型的输出里抠出 JSON 数组（容忍它包了 ``` 或前后带话）。 */
export function 抠候选(text) {
  return 抠候选详细(text).候选
}

/**
 * 抠候选的「带状态」版本 —— 用来区分「模型确实回了空数组」和「JSON 坏了」。
 *
 * ⚠ 2026-11-21 真机踩到的坑：`抠候选` 只返回数组，所以「模型回了 []」
 *   和「正文被截断、数组没闭合」都是空数组，可观测性那一层直接把两种都记成
 *   「JSON 没抠出来」，连模型正确回 [] 的正常情况也误报（写完测试立刻被抓住）。
 *   状态码：
 *     ok          —— 拿到非空数组（完整解析）
 *     partial     —— 数组不完整，逐条救回来 N 条（截断但不至于全丢）
 *     empty-array —— 模型确实回了 `[]`（正常：没找到规律）
 *     no-array    —— 正文里根本没有 `[`，或只有 `[` 且一条都没救回
 *     not-array   —— 能 parse 但不是数组
 *     bad-json    —— 截下来的那段不是合法 JSON，且逐条也救不回来
 */
export function 抠候选详细(text) {
  const s = String(text || '')
  const 起 = s.indexOf('[')
  const 止 = s.lastIndexOf(']')
  if (起 < 0) return { 候选: [], 状态: 'no-array' }
  if (止 <= 起) {
    // 只有 `[`、没有闭合的 `]`：多半是被截断了，能救几条是几条
    const 救回 = 逐条抠(s)
    if (救回.length) {
      diag('  dream 输出被截断（数组没闭合），逐条救回 ' + 救回.length + ' 条')
      return { 候选: 救回, 状态: 'partial' }
    }
    return { 候选: [], 状态: 'no-array' }
  }
  try {
    const v = JSON.parse(s.slice(起, 止 + 1))
    if (!Array.isArray(v)) return { 候选: [], 状态: 'not-array' }
    return { 候选: v, 状态: v.length ? 'ok' : 'empty-array' }
  } catch (error) {
    const 救回 = 逐条抠(s)
    if (救回.length) {
      diag(
        '  dream 输出不是合法 JSON，逐条救回 ' + 救回.length + ' 条：' + ((error && error.message) || error),
      )
      return { 候选: 救回, 状态: 'partial' }
    }
    diag('  dream 输出不是合法 JSON，丢弃：' + ((error && error.message) || error))
    return { 候选: [], 状态: 'bad-json' }
  }
}

/**
 * 跑一次归纳。只读记忆、只写候选模式，不碰 memories。
 * 返回 { ok, 候选: [...], 问题: [...] }。
 */
export async function 归纳一次(ctx, agent, data, 选项 = {}) {
  const 现在 = Date.now()
  const 全部 = (data && Array.isArray(data.memories) ? data.memories : []).filter(
    (m) => m && !m.refinedSkip && !m.已被取代,
  )
  // 优先拿画像（它们最像「这个人」），再补一部分知识 —— 但**按日期打散**取，
  // 不能直接排前面全拿（那样每次都只能看见同一批导入日，见 挑素材 的注释）
  const 画像 = 全部.filter((m) => !m.is_knowledge)
  const 知识 = 全部.filter((m) => m.is_knowledge)
  const 素材 = 挑素材(画像, 知识, 每批条数)
  if (素材.length < 5) return { ok: false, 候选: [], 问题: ['活跃记忆不足 5 条，没什么可归纳的'] }

  // ⭐ 2026-11-21：预算 1500 → 8000。
  //   真机铁证（22:08 那次 diag）：1500 全被 reasoning-delta 吃光、正文 0 字；
  //   翻倍到 3000 后正文有了，但只写到 550 字符就截断，JSON 没闭合 → 抠候选 拿到 []
  //   → 记成「产出 0 被拦 0」，日志还打「正常，料还没攒够」，骗了三天。
  //   ⚠ 8000 是 问模型 内部翻倍的上限（Math.min(8000, …)），传满意味着不指望它的二次重试，
  //     所以这里只当「探针」用：先确认预算是不是瓶颈，确认了再谈素材瘦身/截断容错。
  const r = await 问模型(ctx, agent, 归纳系统, '记忆条目：\n' + 拼素材(素材), 8000)
  if (!r || !r.ok) return { ok: false, 候选: [], 问题: [r && r.message ? r.message : '模型没回'] }

  const { 候选: 抠出, 状态 } = 抠候选详细(r.text)
  const 问题 = []
  // ⭐ 2026-11-21：可观测性 —— 「模型有正文但抠不出候选」不能说成「没找到规律」。
  //   以前这条只 diag、不进 问题，于是 _归纳历史 里的「被拦」永远是 0，
  //   跟「模型确实回了 []」长得一模一样，坏了三天没一个人发现。
  //   ⚠ 只有 no-array / bad-json 才记；empty-array 是「模型看了觉得没规律」，
  //     那是正常结果，不许误报（第一版用 !抠出.length 判断，连 [] 都报，被测试抓住）。
  if (状态 === 'no-array' || 状态 === 'bad-json') {
    const 正文 = String(r.text || '').trim()
    问题.push('JSON 没抠出来（正文 ' + 正文.length + ' 字，尾部…' + 正文.slice(-40) + '）')
  } else if (状态 === 'partial') {
    // 2026-11-21：截断容错救回了一部分，但数据是不完整的 —— 必须让账上看得见，
    // 否则「救回 1 条」和「完整回了 1 条」在 _归纳历史 里长得一模一样。
    问题.push('JSON 被截断，只救回 ' + 抠出.length + ' 条（预算或素材量压到了）')
  }
  const 原始 = 抠出.slice(0, 候选上限)
  const 过 = []
  const 已有 = new Set(读模式().patterns.map((p) => String(p.text || '').slice(0, 40)))

  for (const c of 原始) {
    const 候选 = {
      text: String((c && c.text) || '').trim(),
      trigger: (c && c.trigger) || {},
      evidence: Array.isArray(c && c.evidence) ? c.evidence.filter(Boolean) : [],
      evidenceDates: Array.isArray(c && c.evidenceDates) ? c.evidenceDates : [],
      counter: [],
    }
    // 证据 id 必须真在库里（模型会编 id）
    const 真id = new Set(全部.map((m) => String(m.id)))
    候选.evidence = 候选.evidence.filter((id) => 真id.has(String(id)))
    // 日期不靠模型给，直接从证据条目的 createdAt 反推（它给的日子经常瞎写）
    候选.evidenceDates = [...new Set(
      候选.evidence
        .map((id) => 全部.find((m) => String(m.id) === String(id)))
        .filter(Boolean)
        .map((m) => String(m.createdAt || '').slice(0, 10))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    )]

    const 检查 = 校验模式(候选, 现在)
    if (!检查.ok) {
      问题.push(候选.text.slice(0, 30) + '… → ' + 检查.问题.join('；'))
      continue
    }
    if (已有.has(候选.text.slice(0, 40))) {
      问题.push(候选.text.slice(0, 30) + '… → 已经有过类似的')
      continue
    }
    过.push(候选)
  }

  return { ok: true, 候选: 过, 问题, 用了: r.provider + '/' + r.model }
}

/** 把候选落库（一律 candidate，不进 prompt）。 */
export function 落库(候选们, 现在 = Date.now()) {
  const 记录 = []
  for (const c of 候选们) {
    const r = 加模式(c, 现在)
    if (r.ok) 记录.push({ id: r.id, text: c.text })
  }
  return 记录
}

/**
 * 该不该跑一次自动归纳。
 *
 * 为什么挂自动：dream 是「跨时间」归纳 —— 库里得先攒出「他不同日子做了类似的事」，
 * 才可能有东西可挖。如果只靠人手动点，没人会记得点；而且 1.12.55~57 三次手动跑
 * 都是 0 条（库里确实还没料），更需要它自己定期来看一眼，等料够了自动抓出来。
 *
 * 隔 24 小时：一天跑一次就够，每次花一次短模型调用（约 9 秒、几分钱）。
 */
export function 该归纳了(间隔小时 = 24) {
  try {
    const t = Number(loadCfg()._上次归纳 || 0)
    if (!Number.isFinite(t) || t <= 0) return true
    return Date.now() - t >= 间隔小时 * 3600 * 1000
  } catch {
    return false
  }
}

/** 记一笔「跑过了」，免得每条消息都重跑。 */
export function 记归纳结果(产出数, 问题数 = 0) {
  try {
    const c = loadCfg()
    c._上次归纳 = Date.now()
    c._归纳历史 = [
      { 时间: new Date().toISOString(), 产出: 产出数, 被拦: 问题数 },
      ...(Array.isArray(c._归纳历史) ? c._归纳历史 : []),
    ].slice(0, 20)
    saveCfg(c)
  } catch {
    /* 记不上就算了，不该因此让监听挂掉 */
  }
}
