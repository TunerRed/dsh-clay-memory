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
  const next = base.concat([{
    u: String(userText).trim().slice(0, 600),
    a: String(assistantText).trim().slice(0, 800),
    at: Date.now(),
  }])
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
      const a = String(次.text || '').trim()
      if (!u || !a) continue
      // 乱码轮不接（见 是健康一轮 的说明）
      if (u.indexOf('\uFFFD') >= 0 || a.indexOf('\uFFFD') >= 0) continue
      turns.push({ u: u.slice(0, 600), a: a.slice(0, 800), at: Number(对[i].time) || 0 })
    }
    return turns.slice(-轮数)
  }
  return []
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
    return 渲染热尾(turns)
  }
  if (模式 === 'off' || 模式 === 'ask') return ''
  const 包 = 读热尾库()
  if (!包.lastSid || 包.lastSid === sid || !包.turns.length) return ''
  return 渲染热尾(包.turns)
}
