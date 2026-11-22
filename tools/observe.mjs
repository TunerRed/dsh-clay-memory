#!/usr/bin/env node
// 只读观测：node tools/observe.mjs --home <DSH_HOME> [--days 14] [--json]
// 导入无 I/O；analyzeTraces 接收内存中的文件文本、事实快照和显式观测时间。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DAY = 86400000
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const chars = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
const identity = (v) => typeof v === 'string' && v.trim() ? v.trim()
  : typeof v === 'number' && Number.isFinite(v) ? String(v) : null
const round = (v, digits = 1) => +v.toFixed(digits)
const average = (sum, count, digits = 1) => count ? round(sum / count, digits) : null
const percent = (part, all) => average(part * 100, all)
const iso = (v) => v === null ? null : new Date(v).toISOString()
const stable = (v) => Array.isArray(v) ? v.map(stable) : object(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v

export function parseTraceTime(value) {
  let time = null
  if (typeof value === 'number') time = value
  else if (typeof value === 'string' && value.trim()) {
    const text = value.trim()
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) time = Number(text)
    else {
      const date = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(text)
      if (date) {
        const [, year, month, day, hour = '0', minute = '0', second = '0'] = date
        const monthDays = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()
        if (+month >= 1 && +month <= 12 && +day >= 1 && +day <= monthDays && +hour < 24 && +minute < 60 && +second < 60) time = Date.parse(text)
      }
    }
  }
  return Number.isFinite(time) && time > 0 && time <= 8640000000000000 ? time : null
}

// files: [{ name, text }]；text 为 null 表示 CLI 未能读取该文件。
export function analyzeTraces({ files = [], facts = null, now, days = 0, home = '' } = {}) {
  if (parseTraceTime(now) === null || typeof now !== 'number') throw new TypeError('now 必须为有效的毫秒时间')
  if (!Number.isFinite(days) || days < 0) throw new TypeError('days 必须为非负有限数字')
  const start = days ? Math.max(0, now - days * DAY) : null
  const snapshot = object(facts) && Array.isArray(facts.memories)
  const memories = snapshot ? facts.memories.filter((m) => object(m) && !m.refinedSkip && !m.已被取代 && !m.别记) : []
  const byId = new Map(memories.filter((m) => identity(m.id) !== null).map((m) => [String(m.id), m]))
  const policy = object(facts?.policy) ? facts.policy : {}
  const coverage = {
    请求起点: iso(start), 请求终点: iso(now), 覆盖起点: null, 覆盖终点: null,
    文件数: files.length, 原始条数: 0, 有效时间条数: 0, 窗内原始条数: 0,
    去重轮数: 0, 合并step条数: 0, 非法JSON条数: 0, 非法时间条数: 0,
    未来时间条数: 0, 窗外条数: 0, 无turn轮数: 0, 无会话标识轮数: 0,
    读取失败文件: [], 完整两周可证明: false,
    说明: '覆盖起止仅为现存日志中的观测范围；日志滚动、缺失及无请求时段不可区分，即使跨度两周也不能证明完整两周。',
  }
  const turns = new Map()
  let order = 0
  for (const file of files) {
    if (typeof file.text !== 'string') {
      coverage.读取失败文件.push(file.name)
      continue
    }
    for (const line of file.text.split(/\r?\n/)) {
      if (!line.trim()) continue
      coverage.原始条数++
      let trace
      try { trace = JSON.parse(line) } catch { coverage.非法JSON条数++; continue }
      const at = object(trace) ? parseTraceTime(trace.at ?? trace.时间 ?? trace.time) : null
      if (at === null) { coverage.非法时间条数++; continue }
      if (at > now) { coverage.未来时间条数++; continue }
      coverage.有效时间条数++
      if (start !== null && at < start) { coverage.窗外条数++; continue }
      coverage.窗内原始条数++
      const turn = identity(trace.turn)
      const session = identity(trace.sessionId) ?? identity(trace.session) ?? identity(trace.conversationId)
      const step = identity(trace.step) !== null && Number.isFinite(Number(trace.step)) ? Number(trace.step) : -Infinity
      // 不跨文件/会话猜测 turn；无 turn 的记录各自独立，避免静默合并。
      const key = JSON.stringify(turn === null ? [file.name, session, null, order] : [file.name, session, turn])
      const record = { trace, at, step, order: order++, turn, session }
      const previous = turns.get(key)
      if (!previous || at > previous.at || (at === previous.at && (step > previous.step || (step === previous.step && record.order > previous.order)))) {
        turns.set(key, record)
      }
    }
  }
  const records = [...turns.values()].sort((a, b) => a.at - b.at || a.order - b.order)
  const count = records.length
  coverage.去重轮数 = count
  coverage.合并step条数 = coverage.窗内原始条数 - count
  coverage.覆盖起点 = count ? iso(records[0].at) : null
  coverage.覆盖终点 = count ? iso(records[count - 1].at) : null
  coverage.无turn轮数 = records.filter((r) => r.turn === null).length
  coverage.无会话标识轮数 = records.filter((r) => r.session === null).length

  const quality = {
    事实快照可用: snapshot, selectedMeta轮数: 0, 旧trace估计轮数: 0, 事实unknown轮数: 0,
    无版本轮数: 0, 无配置快照轮数: 0, 无查询诊断轮数: 0,
    无完整上下文字数轮数: 0, 无记忆渲染字数轮数: 0, 无picked信息轮数: 0,
    无法判断空注入轮数: 0, 未归类picked条次: 0, 无效selectedMeta条次: 0,
    selectedMeta与picked不一致轮数: 0, 事实缺字符条次: 0, 淘汰未归类条次: 0,
  }
  const itemCounts = { 知识: 0, 画像: 0, unknown: 0 }
  const charCounts = { 知识: 0, 画像: 0, unknown: 0 }
  const missingChars = { 知识: 0, 画像: 0, unknown: 0 }
  const hits = new Set()
  const omissions = { 知识: {}, 画像: {} }
  const groups = new Map()
  let selected = 0, selectedRounds = 0, empty = 0, nonempty = 0, fallbackRounds = 0, zeroRecall = 0
  let zeroRecallTurn = 0, zeroRecallTurnBase = 0
  let totalChars = 0, totalRounds = 0, memoryChars = 0, memoryRounds = 0
  let exactFactChars = 0, estimatedFactChars = 0, budgetUsage = 0, budgetRounds = 0
  let factRounds = 0

  function addFact(id, kind, length, estimated) {
    itemCounts[kind]++
    if (length === null) { missingChars[kind]++; quality.事实缺字符条次++ }
    else {
      charCounts[kind] += length
      if (estimated) estimatedFactChars += length
      else exactFactChars += length
    }
    hits.add(String(id))
  }

  for (const { trace: t, at } of records) {
    const meta = Array.isArray(t.selectedMeta) ? t.selectedMeta : null
    const picked = Array.isArray(t.picked) ? t.picked : null
    const selectedCount = picked ? picked.length : meta ? meta.length : null
    const rendered = chars(t.字)
    const total = chars(t.totalChars)
    const fallback = t.fallback === true || (typeof t.fallback === 'string' && t.fallback.trim().length > 0)
    if (fallback) fallbackRounds++
    if (selectedCount === null) quality.无picked信息轮数++
    else { selected += selectedCount; selectedRounds++ }
    if (total === null) quality.无完整上下文字数轮数++
    else { totalChars += total; totalRounds++ }
    if (rendered === null) quality.无记忆渲染字数轮数++
    else { memoryChars += rendered; memoryRounds++ }
    if (selectedCount > 0 || rendered > 0 || total > 0) nonempty++
    else if (rendered === 0 || total === 0 || (selectedCount === 0 && t.fallback === false)) empty++
    else quality.无法判断空注入轮数++
    // 「注入区有没有字」和「有没有召回到记忆」是两件事：兜底文案会往注入区写几十个字，
    // 于是一个记忆都没召回的轮次在空注入里看不出来。零召回单独数，才不会被兜底盖住。
    if (selectedCount === 0) {
      zeroRecall++
      // 老记录（没有 turn 字段，11-04 那批）一条就是一条，会把分母撑大几十倍；
      // 单独再数一份「只算有 turn 的轮」，才是能跟人对话对照的真实召回率。
      if (t.turn !== null && t.turn !== undefined) zeroRecallTurn++
    }
    if (selectedCount !== null && t.turn !== null && t.turn !== undefined) zeroRecallTurnBase++

    if (meta) {
      quality.selectedMeta轮数++
      factRounds++
      const metaIds = meta.map((m) => String(m?.id)).sort()
      if (picked && (picked.length !== meta.length || picked.map(String).sort().some((id, i) => id !== metaIds[i]))) {
        quality.selectedMeta与picked不一致轮数++
      }
      for (const m of meta) {
        if (!object(m) || identity(m.id) === null || typeof m.scope !== 'string' || !m.scope.trim()) {
          quality.无效selectedMeta条次++
          continue
        }
        if (m.scope !== 'global') continue
        const kind = m.isKnowledge === true ? '知识' : m.isKnowledge === false ? '画像' : 'unknown'
        addFact(m.id, kind, chars(m.chars), false)
      }
    } else if (picked && (snapshot || !picked.length)) {
      quality.旧trace估计轮数++
      factRounds++
      for (const id of picked) {
        const m = byId.get(String(id))
        if (!m) { quality.未归类picked条次++; continue }
        addFact(id, m.is_knowledge === true ? '知识' : '画像', typeof m.text === 'string' ? m.text.length : null, true)
      }
    } else quality.事实unknown轮数++

    // rows 不带历史 scope/isKnowledge，不能用当前快照冒充历史分类。
    for (const r of Array.isArray(t.rows) ? t.rows : []) {
      const m = object(r) ? byId.get(String(r.id)) : null
      if (!m) { quality.淘汰未归类条次++; continue }
      const kind = m.is_knowledge === true ? '知识' : '画像'
      const reason = r.omission === undefined ? '其它' : r.omission === null ? '选中' : String(r.omission)
      Object.defineProperty(omissions[kind], reason, { value: (Object.hasOwn(omissions[kind], reason) ? omissions[kind][reason] : 0) + 1, enumerable: true, configurable: true })
    }
    const version = typeof t.algorithmVersion === 'string' && t.algorithmVersion.trim() ? t.algorithmVersion : null
    const config = object(t.policySnapshot) ? stable(t.policySnapshot) : null
    if (version === null) quality.无版本轮数++
    if (config === null) quality.无配置快照轮数++
    if (!object(t.queryDiagnostics)) quality.无查询诊断轮数++
    if (rendered !== null && chars(config?.maxChars) > 0) {
      budgetUsage += 100 * rendered / config.maxChars
      budgetRounds++
    }
    const groupKey = JSON.stringify([version, config])
    if (!groups.has(groupKey)) groups.set(groupKey, {
      algorithmVersion: version, policySnapshot: config, 轮数: 0,
      覆盖起点: iso(at), 覆盖终点: iso(at), 完整上下文字合计: 0, 完整上下文字覆盖轮数: 0,
      记忆渲染字合计: 0, 记忆渲染字覆盖轮数: 0,
    })
    const group = groups.get(groupKey)
    group.轮数++
    group.覆盖终点 = iso(at)
    if (total !== null) { group.完整上下文字合计 += total; group.完整上下文字覆盖轮数++ }
    if (rendered !== null) { group.记忆渲染字合计 += rendered; group.记忆渲染字覆盖轮数++ }
  }

  const knowledge = memories.filter((m) => m.is_knowledge === true)
  const profiles = memories.filter((m) => m.is_knowledge !== true)
  const knowledgeHits = knowledge.filter((m) => hits.has(String(m.id))).length
  const profileHits = profiles.filter((m) => hits.has(String(m.id))).length
  const factItems = itemCounts.知识 + itemCounts.画像 + itemCounts.unknown
  const factChars = charCounts.知识 + charCounts.画像 + charCounts.unknown
  const factInjection = {
    口径: '仅可识别的全局事实；新 trace 使用 selectedMeta 的历史 scope/isKnowledge/chars，旧 trace 用当前有效事实快照估计。均值分母为事实可统计轮数，未归类 picked 不冒充零条事实；不是整体上下文。',
    统计轮数: factRounds, selectedMeta轮数: quality.selectedMeta轮数, 当前快照估计轮数: quality.旧trace估计轮数,
    unknown轮数: quality.事实unknown轮数, 未归类picked条次: quality.未归类picked条次,
    条次: itemCounts, 字次: charCounts, 缺字符条次: quality.事实缺字符条次,
    历史元数据字合计: exactFactChars, 当前快照估计字合计: estimatedFactChars,
    每轮条数: average(factItems, factRounds, 2),
    每轮字数: quality.事实缺字符条次 ? null : average(factChars, factRounds),
    每轮知识字: missingChars.知识 ? null : average(charCounts.知识, factRounds),
    每轮画像字: missingChars.画像 ? null : average(charCounts.画像, factRounds),
    知识字占比: quality.事实缺字符条次 ? null : percent(charCounts.知识, factChars),
    画像字占比: quality.事实缺字符条次 ? null : percent(charCounts.画像, factChars),
  }
  const overall = {
    口径: 'picked 不按事实 ID 过滤（缺 picked 时用 selectedMeta 条数）；完整上下文仅使用 totalChars，含骨架/项目/兜底；字仅为记忆或兜底渲染。均值仅针对对应字段已知的轮，缺失不补零。',
    空注入口径: 'picked/selectedMeta 有条目，或 字/totalChars > 0 即非空；缺少判断依据计 unknown。空注入率分母为已知空/非空轮数。注意这是「注入区有没有字」——兜底文案也会让注入区有字，想看「有没有召回到记忆」请看零召回。',
    零召回口径: 'picked/selectedMeta 一条都没有的轮次占比，分母为有 picked 信息的轮。兜底文案（fallback）写进注入区但不是记忆，所以零召回不会被兜底盖住。',
    零召回双口径说明: '零召回的轮 / 零召回率 用的是全部去重轮（含没有 turn 的老记录，一条算一轮，会把分母撑大）；零召回轮数按turn / 零召回率按turn 只算有 turn 字段的轮，那一份才对应「每轮对话」的真实比例，看召回健康请用这一对。',
    每轮条数: average(selected, selectedRounds, 2), 条次: selected, 条数覆盖轮数: selectedRounds,
    每轮字数: average(totalChars, totalRounds), 完整上下文字合计: totalRounds ? totalChars : null,
    完整上下文字覆盖轮数: totalRounds, 完整上下文字unknown轮数: count - totalRounds,
    每轮记忆渲染字: average(memoryChars, memoryRounds), 记忆渲染字合计: memoryRounds ? memoryChars : null,
    记忆渲染字覆盖轮数: memoryRounds, 记忆渲染字unknown轮数: count - memoryRounds,
    空注入: empty, 非空注入: nonempty, unknown轮数: quality.无法判断空注入轮数,
    空注入率: percent(empty, empty + nonempty), 兜底轮数: fallbackRounds,
    零召回的轮: zeroRecall, 零召回率: percent(zeroRecall, selectedRounds),
    零召回轮数按turn: zeroRecallTurn, 零召回率按turn: percent(zeroRecallTurn, zeroRecallTurnBase),
    按turn分母: zeroRecallTurnBase, 无turn记录轮数: records.filter((r) => r.turn === null || r.turn === undefined).length,
    预算利用率: average(budgetUsage, budgetRounds), 预算覆盖轮数: budgetRounds,
    预算口径: '仅计算 字 / 同轮 policySnapshot.maxChars；不以当前配置或 totalChars 替代记忆预算。',
  }
  const versions = new Set([...groups.values()].map((g) => g.algorithmVersion))
  const configs = new Set([...groups.values()].map((g) => JSON.stringify(g.policySnapshot)))
  quality.版本混用 = versions.size > 1
  quality.配置混用 = configs.size > 1
  const warnings = [coverage.说明, '低 ActiveRatio 只能作为参考，不是迁出许可；需独立的长期留存、召回质量与遗漏评估。']
  if (quality.旧trace估计轮数) warnings.push('旧 trace 的全局事实分类与字数仅按当前快照估计，无法还原历史文本、已删除事实或当时的池。')
  if (!snapshot) warnings.push('当前事实快照缺失或格式无效，池与 ActiveRatio 不可计算。')
  if (quality.无版本轮数 || quality.无配置快照轮数) warnings.push('存在 algorithmVersion/policySnapshot unknown 轮；不把当前参数补作历史版本或配置。')
  if (quality.版本混用 || quality.配置混用) warnings.push('存在算法版本或配置混用；总体读数不可视作单一算法实验，请查看分组。')
  if (quality.无完整上下文字数轮数) warnings.push('存在缺少 totalChars 的轮；旧 trace 的 字 或事实估算字数不能代表完整上下文字符数。')
  if (coverage.无turn轮数) warnings.push('无 turn 记录保守独立计数，去重轮数可能高估真实对话轮数。')
  if (coverage.非法JSON条数 || coverage.非法时间条数 || coverage.未来时间条数 || coverage.读取失败文件.length) warnings.push('损坏 JSON、非法/未来时间或不可读文件已排除，详见覆盖诊断。')
  if (quality.事实unknown轮数 || quality.未归类picked条次 || quality.无效selectedMeta条次 || quality.事实缺字符条次 || itemCounts.unknown || quality.selectedMeta与picked不一致轮数) warnings.push('事实分项存在缺失或未归类数据，只能代表可识别部分；不能把缺项当作零或完整历史事实。')
  if (quality.无法判断空注入轮数) warnings.push('存在无法判断是否空注入的 unknown 轮，空注入率仅覆盖已知轮。')

  return {
    库: home, 时间窗: days ? '最近 ' + days + ' 天' : '全部现存日志（排除非法及未来时间）', 轮数: count,
    池: {
      口径: '当前有效全局事实快照，不是历史池', 总条: snapshot ? memories.length : null,
      知识: { 条: snapshot ? knowledge.length : null, 占比: snapshot ? percent(knowledge.length, memories.length) : null },
      画像: { 条: snapshot ? profiles.length : null, 占比: snapshot ? percent(profiles.length, memories.length) : null },
    },
    ActiveRatio: {
      口径: '当前有效事实中在现存窗口日志被选中的唯一 ID 占比；受快照变化、日志滚动和 unknown 影响。低值仅供参考，不是迁出许可。',
      知识: snapshot && factRounds ? percent(knowledgeHits, knowledge.length) : null,
      画像: snapshot && factRounds ? percent(profileHits, profiles.length) : null,
      知识被选中条: snapshot ? knowledgeHits : null, 知识总条: snapshot ? knowledge.length : null,
    },
    注入: {
      口径: '兼容旧 key：条数/字数及知识画像占比为事实分项（可能是当前快照估计），不是整体；空注入改为整体已知轮口径，预算改用同轮历史配置。详见事实注入与整体注入。',
      每轮条数: factInjection.每轮条数, 每轮字数: factInjection.每轮字数,
      每轮知识字: factInjection.每轮知识字, 每轮画像字: factInjection.每轮画像字,
      知识字占比: factInjection.知识字占比, 画像字占比: factInjection.画像字占比,
      空注入: empty, 空注入率: overall.空注入率, 预算利用率: overall.预算利用率,
    },
    事实注入: factInjection, 整体注入: overall, 淘汰分布: omissions,
    淘汰分布口径: 'rows 仅按当前有效事实快照估计分类，不代表完整候选集或历史分类。',
    当前参数: {
      maxItems: policy.maxItems, maxChars: policy.maxChars, factsMax: policy.factsMax,
      factsAlwaysTopN: policy.factsAlwaysTopN, knowledgeStaysOut: policy.knowledgeStaysOut,
    },
    覆盖: coverage, 质量: quality,
    分组: [...groups.values()].map((g) => ({ ...g,
      每轮完整上下文字数: average(g.完整上下文字合计, g.完整上下文字覆盖轮数),
      每轮记忆渲染字数: average(g.记忆渲染字合计, g.记忆渲染字覆盖轮数),
    })),
    警告: warnings,
  }
}

export function formatReport(result) {
  const show = (v) => v === null || v === undefined ? 'unknown' : v
  const c = result.覆盖, f = result.事实注入, all = result.整体注入
  return [
    '# 记忆库观测报告', '',
    '- 库：' + result.库,
    '- 时间窗：' + result.时间窗 + '；请求截止：' + c.请求终点,
    '- 现存覆盖：' + show(c.覆盖起点) + ' 至 ' + show(c.覆盖终点),
    '- 原始条数：' + c.原始条数 + '；窗内条数：' + c.窗内原始条数 + '；去重轮数：' + result.轮数 + '；合并 step：' + c.合并step条数,
    '- 排除：非法 JSON ' + c.非法JSON条数 + ' / 非法时间 ' + c.非法时间条数 + ' / 未来时间 ' + c.未来时间条数 + ' / 窗外 ' + c.窗外条数,
    '- 无 turn 独立记录：' + c.无turn轮数 + '；无会话标识（仅按文件隔离）：' + c.无会话标识轮数,
    '', '## 事实注入（不是整体上下文）', '', f.口径,
    '- 当前池：' + show(result.池.总条) + ' 条；知识 ' + show(result.池.知识.条) + ' / 画像 ' + show(result.池.画像.条),
    '- ActiveRatio：知识 ' + show(result.ActiveRatio.知识) + '% / 画像 ' + show(result.ActiveRatio.画像) + '%；仅供参考，不是迁出许可。',
    '- 每轮可识别事实：' + show(f.每轮条数) + ' 条 / ' + show(f.每轮字数) + ' 字；知识 ' + show(f.每轮知识字) + ' 字 / 画像 ' + show(f.每轮画像字) + ' 字',
    '- 历史元数据轮：' + f.selectedMeta轮数 + '；当前快照估计轮：' + f.当前快照估计轮数 + '；unknown 轮：' + f.unknown轮数,
    '', '## 整体注入', '', all.口径,
    '- 每轮选中：' + show(all.每轮条数) + ' 条；完整上下文：' + show(all.每轮字数) + ' 字（覆盖 ' + all.完整上下文字覆盖轮数 + '/' + result.轮数 + ' 轮）',
    '- 记忆或兜底渲染：' + show(all.每轮记忆渲染字) + ' 字（覆盖 ' + all.记忆渲染字覆盖轮数 + '/' + result.轮数 + ' 轮）',
    '- 空注入：' + all.空注入 + '；非空：' + all.非空注入 + '；unknown：' + all.unknown轮数 + '；空注入率：' + show(all.空注入率) + '%',
    '- 零召回（一条记忆都没进来）：全量 ' + all.零召回的轮 + ' 轮 / ' + show(all.零召回率) + '%；**按 turn 口径 ' + all.零召回轮数按turn + ' / ' + all.按turn分母 + ' 轮 = ' + show(all.零召回率按turn) + '%**（无 turn 的老记录 ' + all.无turn记录轮数 + ' 条没算进这个分母）；带兜底文案的轮：' + all.兜底轮数 + '（兜底会让注入区有字，所以零召回不等于空注入）',
    '- 预算利用率：' + show(all.预算利用率) + '%（历史配置覆盖 ' + all.预算覆盖轮数 + ' 轮）',
    all.空注入口径, all.预算口径,
    '', '## 算法/配置分组（null 表示 unknown）', '',
    '```json', JSON.stringify(result.分组, null, 2), '```',
    '', '## 质量诊断', '', '```json', JSON.stringify(result.质量, null, 2), '```',
    '', '## 淘汰分布（当前快照估计）', '', '```json', JSON.stringify(result.淘汰分布, null, 2), '```',
    '', '## 当前参数（不代表历史配置）', '', '```json', JSON.stringify(result.当前参数, null, 2), '```',
    '', '## 限制与警告', '', ...result.警告.map((s) => '- ' + s),
    '- ' + result.注入.口径,
  ].join('\n')
}

export function runCli(args = process.argv.slice(2), env = process.env) {
  try {
    let home = env.DSH_HOME || '', days = 0, json = false
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === '--json') { json = true; continue }
      if (arg !== '--home' && arg !== '--days') throw new Error('未知参数：' + arg)
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error(arg + ' 缺少参数')
      if (arg === '--home') home = value
      else {
        days = Number(value)
        if (!value.trim() || !Number.isFinite(days) || days < 0) throw new Error('--days 必须为非负有限数字')
      }
    }
    const dir = home ? join(home, 'clay-memory') : ''
    if (!dir || !existsSync(dir)) throw new Error('找不到记忆库：' + (dir || '(未给 DSH_HOME)') + '\n用 --home <DSH_HOME 目录> 指定')
    let facts = null
    try { facts = JSON.parse(readFileSync(join(dir, '_facts.json'), 'utf8')) } catch { /* 在质量诊断中报告快照缺失。 */ }
    const files = readdirSync(dir).filter((f) => f.endsWith('.traces.jsonl')).sort().map((name) => {
      let text = null
      try { text = readFileSync(join(dir, name), 'utf8') } catch { /* 保留不可读文件诊断。 */ }
      return { name, text }
    })
    const result = analyzeTraces({ files, facts, now: Date.now(), days, home: dir })
    console.log(json ? JSON.stringify(result, null, 2) : formatReport(result))
    return 0
  } catch (error) {
    console.error(error.message)
    return 2
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = runCli()
}
