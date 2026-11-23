// lib/handoff.mjs
//
// 「上一段对话的语感」交接：把最近几轮真人原话留一份，新会话冷启动时贴上去，
// 让新窗口接得上气氛，又不用把整段历史搬过去（fork 搬全史会撞上下文满灯）。
//
// 1.12.91 起多了「来源选择」：页面上（新会话空白页那行）可以选
//   最近那段 / 不加载 / 挑一个以前的会话。选择按会话存 `_handoff_choice.json`，
//   挑老会话时把它的最后几轮**预先抽好存在选择里** —— 注入路径只读小 json，
//   不去解 zstd 归档（text() 是同步的，不能 await）。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { STORE_DIR, 宿主数据根 } from './paths.mjs'
import { writeFileAtomicSync } from './atomic-file.mjs'
import { 读会话归档, 取对话 } from './archive-reader.mjs'

const HANDOFF_PATH = join(STORE_DIR, '_handoff.json')
const CHOICE_PATH = join(STORE_DIR, '_handoff_choice.json')
const MAX_TURNS = 6 // 保留最近 6 轮健康原话
const MAX_CHOICE = 200 // 选择表最多留多少个会话（按时间淘汰，免得无限涨）

// 熔断词表：命中任意一条视为“本轮已受风控/冷启动污染”，不写入热尾
const 污染词 = [
  /作为一个人工智能/,
  /我无法(回答|满足|继续|提供)/,
  /换个话题/,
  /违反.*(安全|政策|准则|规范)/,
  /我不能(协助|讨论|生成)/,
]

export function 是健康一轮(userText, assistantText) {
  const u = String(userText || '').trim()
  const a = String(assistantText || '').trim()
  if (!u || a.length < 4) return false
  // 跳过宿主注入的上下文/时间戳
  if (/^(Current runtime context\.|Time sampled while preparing)/i.test(u)) return false
  // 跳过宿主注入的「附件已落地」通知：里面带本机绝对路径（收件目录 + 文件名），
  // 接进新会话的热尾既占预算、又跟语感毫无关系。用户自己说「我发了附件」不会被这条误伤。
  if (/附件已保存到工作区/.test(u) || /\.dsh-inbox[\\/]/.test(u)) return false
  // 跳过乱码轮（编码抽风时会留下 U+FFFD），这种接上去只会让新会话一脸问号
  if (u.indexOf('\uFFFD') >= 0 || a.indexOf('\uFFFD') >= 0) return false
  for (const re of 污染词) {
    if (re.test(a)) return false
  }
  return true
}

export function 读热尾库() {
  try {
    if (!existsSync(HANDOFF_PATH)) return { lastSid: '', turns: [], updatedAt: 0 }
    const raw = JSON.parse(readFileSync(HANDOFF_PATH, 'utf8'))
    return raw && Array.isArray(raw.turns) ? raw : { lastSid: '', turns: [], updatedAt: 0 }
  } catch (e) {
    return { lastSid: '', turns: [], updatedAt: 0 }
  }
}

export function 记热尾(sid, userText, assistantText) {
  if (!是健康一轮(userText, assistantText)) return false
  const cur = 读热尾库()
  // 如果换了会话说话，清空旧会话的尾巴，从新会话开始攒
  const base = cur.lastSid === sid ? cur.turns : []
  const u = String(userText).trim().slice(0, 600)
  const a = String(assistantText).trim().slice(0, 800)
  // 同一个用户句下又来一条回复（模型重试、或一个 turn 里落了多条 assistant/message）
  // → 覆盖最后那轮，别再追加一条。否则热尾里会出现「同一个主人句 + 两个我」的鬼影。
  const 上一条 = base[base.length - 1]
  const 续写 = 上一条 && 上一条.u === u
  const next = (续写 ? base.slice(0, -1) : base).concat([{ u, a, at: Date.now() }])
  const trimmed = next.length > MAX_TURNS ? next.slice(next.length - MAX_TURNS) : next
  writeFileAtomicSync(HANDOFF_PATH, JSON.stringify({
    lastSid: sid,
    turns: trimmed,
    updatedAt: Date.now(),
  }, null, 2))
  return true
}

export function 渲染热尾(turns) {
  if (!Array.isArray(turns) || !turns.length) return ''
  const 行 = [
    '【上一段对话的近期原话（用于无缝衔接语感与氛围，不要生硬复述）】',
  ]
  for (const t of turns) {
    行.push('主人：' + t.u)
    行.push('我：' + t.a)
  }
  return 行.join('\n')
}

// ---------- 来源选择（1.12.91） ----------

/** 读某会话的选择：{ load, from, turns, at }；没选过给 null。 */
export function 读选择(sid) {
  const id = String(sid || '').trim()
  if (!id) return null
  try {
    if (!existsSync(CHOICE_PATH)) return null
    const 表 = JSON.parse(readFileSync(CHOICE_PATH, 'utf8'))
    const 选 = 表 && 表[id]
    if (!选 || typeof 选 !== 'object') return null
    return {
      load: 选.load !== false,
      from: String(选.from || ''),
      turns: Array.isArray(选.turns) ? 选.turns : [],
      at: Number(选.at) || 0,
    }
  } catch (e) {
    return null
  }
}

/** 写某会话的选择。turns 由调用方抽好（见 从归档取热尾），这里只存。 */
export function 写选择(sid, 选) {
  const id = String(sid || '').trim()
  if (!id) return false
  let 表 = {}
  try {
    if (existsSync(CHOICE_PATH)) {
      const 旧 = JSON.parse(readFileSync(CHOICE_PATH, 'utf8'))
      if (旧 && typeof 旧 === 'object') 表 = 旧
    }
  } catch (e) {
    表 = {}
  }
  表[id] = {
    load: !!(选 && 选.load),
    from: String((选 && 选.from) || ''),
    turns: Array.isArray(选 && 选.turns) ? 选.turns.slice(-MAX_TURNS) : [],
    at: Date.now(),
  }
  // 按时间淘汰，只留最近 MAX_CHOICE 个会话
  const 键们 = Object.keys(表)
  if (键们.length > MAX_CHOICE) {
    键们.sort((a, b) => (Number(表[a] && 表[a].at) || 0) - (Number(表[b] && 表[b].at) || 0))
    for (const k of 键们.slice(0, 键们.length - MAX_CHOICE)) delete 表[k]
  }
  writeFileAtomicSync(CHOICE_PATH, JSON.stringify(表, null, 2))
  return true
}

/** 会话目录根（`<DSH_HOME>/sessions`）。 */
function 会话根() {
  return join(dirname(宿主数据根()), 'sessions')
}

/**
 * 从某个历史会话的归档里抽最后 N 轮「用户 → 助手」原话。
 * 给「挑一个以前的会话」用；抽到的存进选择里，注入时不再碰归档。
 */
export function 从归档取热尾(fromSid, 轮数 = MAX_TURNS) {
  const id = String(fromSid || '').trim()
  if (!id || id === '.' || id === '..' || /[/\\]/.test(id)) return []
  let 区们 = []
  try {
    区们 = readdirSync(会话根())
  } catch (e) {
    return []
  }
  for (const 区 of 区们) {
    const 文件 = join(会话根(), 区, id, 'session.v4.jsonl.zstd')
    try {
      if (!statSync(文件).isFile()) continue
    } catch (e) {
      continue
    }
    let 对 = []
    try {
      对 = 取对话(读会话归档(文件).事件)
    } catch (e) {
      return []
    }
    const turns = []
    for (let i = 0; i < 对.length; i++) {
      if (!对[i] || 对[i].role !== 'user') continue
      const 次 = 对[i + 1]
      if (!次 || 次.role !== 'assistant') continue
      const u = String(对[i].text || '').trim()
      const a = 剪重复(String(次.text || '').trim())
      // 和 记热尾 走同一道闸：宿主注入句（附件落地通知）、乱码轮、风控轮、
      // 空/过短回复一律不接。这里原来只查乱码，于是「请查看附件 + 本机收件路径」
      // 这种纯宿主噪音会原样被抽进新会话的热尾里。
      if (!是健康一轮(u, a)) continue
      const 现 = { u: u.slice(0, 600), a: a.slice(0, 800), at: Number(对[i].time) || 0 }
      // 同一个主人句出现多次（重试 / 多 step 落了两条 assistant）→ 只留最后一版，
      // 与 记热尾 的口径保持一致，免得抽出来的热尾里同一句话配两版回复。
      const 上 = turns[turns.length - 1]
      if (上 && 上.u === 现.u) turns[turns.length - 1] = 现
      else turns.push(现)
    }
    return turns.slice(-轮数)
  }
  return []
}

/**
 * 一条回复里塞了两版（宿主把两次输出并进了同一条 text，2026-11-23 主实例实测：
 * 前版「崩了？哪边出的问题…」后版「崩了？是网页端还是模型那边…」中间用 \n\n\n 隔开）。
 * 认法：找两行「10 字以上、前 3 字相同」的行，且隔了 40 字以上、第二行在文本 30% 之后
 * —— 那就从第二行开始留（后一版通常更完整）。
 * 这三道闸是为了别把正常回复剪坏：短回复不碰；列表里相邻同前缀的两行不碰；
 * 只剪掉后面一大截才认为是重播，否则原样返回。
 */
function 剪重复(文本) {
  const s = String(文本 || '').trim()
  if (s.length < 120) return s
  const 行们 = s.split('\n')
  const 长 = []
  let 起 = 0
  for (const 行 of 行们) {
    const 字 = 行.trim()
    if (字.length >= 10) 长.push({ 字, 起 })
    起 += 行.length + 1
  }
  for (let a = 0; a < 长.length; a += 1) {
    for (let b = a + 1; b < 长.length; b += 1) {
      if (长[a].字.slice(0, 3) !== 长[b].字.slice(0, 3)) continue
      if (长[b].起 - 长[a].起 < 40) continue
      if (长[b].起 / s.length < 0.3) continue
      return s.slice(长[b].起).trim()
    }
  }
  return s
}

/**
 * 注入前的最后一道净水：把存量的脏轮滤掉。
 * 写入侧（记热尾 / 从归档取热尾）已经各拦一次，这里再兜一次是为了**旧数据** ——
 * 1.12.91 之前抽的快照里可能还躺着宿主注入句、同一句话配的两版回复。
 * 每次最多 6 轮、几条正则，开销可以忽略。
 */
function 净化轮(turns) {
  const 净 = []
  for (const t of Array.isArray(turns) ? turns : []) {
    if (!t) continue
    const u = String(t.u || '').trim()
    const a = 剪重复(String(t.a || '').trim())
    if (!是健康一轮(u, a)) continue
    const 上 = 净[净.length - 1]
    if (上 && 上.u === u) 净[净.length - 1] = { u, a, at: t.at }
    else 净.push({ u, a, at: t.at })
  }
  return 净
}

/**
 * 决定这个会话这一轮注入什么热尾文本（同步，注入路径每轮调一次）。
 * 模式：'latest' 自动接最近那段 / 'ask' 等你选 / 'off' 不接。
 * 选择优先于模式；选「不加载」直接给空串。
 */
export function 热尾文本(sid, 模式 = 'latest') {
  const 选 = 读选择(sid)
  if (选) {
    if (!选.load) return ''
    const 包 = 读热尾库()
    // from 为空 = 「最近那段」：跟着热尾库的 lastSid 实时走
    const 源 = 选.from || 包.lastSid
    if (!源 || 源 === sid) return ''
    const turns = (源 === 包.lastSid && 包.turns.length) ? 包.turns : (选.turns || [])
    return 渲染热尾(净化轮(turns))
  }
  if (模式 === 'off' || 模式 === 'ask') return ''
  const 包 = 读热尾库()
  if (!包.lastSid || 包.lastSid === sid || !包.turns.length) return ''
  return 渲染热尾(净化轮(包.turns))
}

/**
 * 一个会话这一轮该注入什么文本，外加「锁不锁」的决定（注入路径每轮调一次）。
 *
 * 为什么要单独抽出来：宿主可能在空白页就预热求值一次 text()，那时还没发第一句。
 * 如果在那时就 lock 成空串，用户在页面上再选「最近那段」也永远不生效
 * （2026-11-23 外部评审指出）。所以：
 *   - 已开聊（> 1 句）→ 永久不接，lock ''
 *   - 第一句已发出（>= 1 句）→ 算出来并锁定，之后不再变
 *   - 空白页（0 句）→ 照算，但**不锁**，下次求值重新读选择
 *
 * @returns {{ 文: string, 锁定: string|null }}  锁定 null = 还没定，下次继续算
 */
export function 算热尾与锁(sid, 模式, 已有用户句数, 锁定 = null) {
  if (锁定 !== null) return { 文: 锁定, 锁定 }
  if (已有用户句数 > 1) return { 文: '', 锁定: '' }
  const 文 = 热尾文本(sid, 模式)
  return { 文, 锁定: 已有用户句数 >= 1 ? 文 : null }
}
