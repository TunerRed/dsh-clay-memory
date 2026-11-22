// ============================================================================
// lib/backfill.mjs —— F25：历史会话补记
//
// 目标：挑一个**以前聊过的会话**，按现在的规则重新提取一遍长期记忆候选，
//       跟库里已有的全局记忆对齐（新增 / 改写 / 没变化），**先给你看**，
//       你点确认才写进库，而且整批可以一次撤销。
//
// 为什么不复用「经历提取」那条路：
//   经历提取（episode.mjs）专门抽有时效的事件和梗，提示词明确禁止收性格/喜好/习惯；
//   补记要的是**长期记忆**（喜好、约定、设定、事实），得落 stable_profile 并带
//   `事实键 / 词 / 重要度 / 类型`。两者协议与判据不同，所以补记有自己的提示词与解析器。
//
// 为什么不能重跑一次就一定一样：模型有随机性，同一段对话两次提取出来的
//   条数、措辞都可能不同。所以**预览必须是真的预览**（跑完先存着给人看），
//   不能点一下就直接写库。
// ============================================================================
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { 读会话归档, 取对话 } from './archive-reader.mjs'
import { blank, corruptSnapshots, loadStore, saveStore, 全量回填镜像, 读一份 } from './store-core.mjs'
import { STORE_DIR, factPath, 宿主数据根 } from './paths.mjs'
import { writeFileAtomicSync } from './atomic-file.mjs'
import { backupFile } from './backup.mjs'
import { 问模型 } from './llm.mjs'
import { diag } from './diag.mjs'
import { 像度, 词集, 归一键, 是万能键 } from './scoring.mjs'

// 太短的会话不值得跑（一句话来回问不出什么长期记忆）
const 最少条 = 6
// 一次最多喂给模型多少条对话 —— 模型窗口有限，而且长会话本来就是「超长 turn」的重灾区
const 默认上限条 = 200
// 判「跟已有的太像」的线。0.85 是库内查重一直在用的口径，这里对齐它。
const 像的线 = 0.85

const 合法类型 = new Set(['identity', 'relation', 'promise', 'preference', 'experience', 'misc'])
const 键空词 = /^(跳过|无|没有|留空|none|null|na|n[/.]a|不详|未知)$/i

/**
 * 词面像度。
 * ⚠ `像度()` 比的是**词集**，而且词集不足 3 个时它按设计返回 0（一两个词的碰撞是假重复）。
 *   补记里大量条目是短句（「主人喜欢白饭」这种就三四个词），光靠它会把
 *   「一模一样的两条」判成不重复 → 重复写库。所以这里先兜一层「字面完全相同 = 1」。
 */
function 像的(a, b) {
  const ta = String(a == null ? '' : a).trim()
  const tb = String(b == null ? '' : b).trim()
  if (ta && ta === tb) return 1
  return 像度(词集(ta), 词集(tb))
}

function 规整事实键(原) {
  const s = String(原 == null ? '' : 原).trim()
  if (!s || 键空词.test(s)) return null
  const k = 归一键(s)
  if (!k || 键空词.test(k)) return null
  if (!/^[^.]{1,12}\.[^.]{1,12}$/.test(k) || /[0-9]/.test(k)) return null
  if (是万能键(k)) return null
  return k
}

function 读事实盘() {
  const fp = factPath()
  const 盘 = 读一份(fp)
  const 毒 = corruptSnapshots.get(盘)
  if (毒 && [...毒.values()].every((候) => !候.bytes)) {
    throw new Error('全局事实库当前读不出来（磁盘错误或文件损坏），拒绝操作以免丢数据')
  }
  return { fp, 盘 }
}

function 写事实盘(fp, 盘, opts) {
  const 换代 = !!(opts && opts.换代)
  mkdirSync(STORE_DIR, { recursive: true })
  if (existsSync(fp)) backupFile(fp)
  const 写 = {
    ...blank(),
    ...盘,
    version: 2,
    purgeEpoch: 换代 || !盘.purgeEpoch ? randomUUID() : 盘.purgeEpoch,
    traces: [],
  }
  writeFileAtomicSync(fp, JSON.stringify(写, null, 2))
  try {
    全量回填镜像()
  } catch {
    // 镜像落后不影响主 JSON 落盘
  }
}

/** 读全局事实库里的活着记忆（不触发 null.json 会话读）。 */
export function 读全局事实() {
  const 盘 = 读一份(factPath())
  const 坟 = new Set((盘.deleted || []).map((d) => String(d && d.id)))
  return (盘.memories || []).filter((m) => m && !坟.has(String(m.id)))
}

/** 会话归档的根目录：<DSH_HOME>/data/sessions */
export function 会话根() {
  return join(dirname(宿主数据根()), 'sessions')
}

/** 这个会话补记过没有（看库里有没有它的 bfb 补记批次）。 */
export function 补记过吗(现有, sid) {
  for (const m of 现有 || []) {
    if (m && m.fromSession === sid && m.importBatch && String(m.importBatch).startsWith('bfb')) return true
  }
  return false
}

/**
 * 单一会话「能不能补记」的诊断（不花 token、不写库）。
 */
export function 体检会话(文件) {
  if (!文件) return { 够: false, 为什么: '没有给会话文件' }
  let st
  try {
    st = statSync(文件)
  } catch (error) {
    return { 够: false, 为什么: '找不到这个会话的文件（可能已经被清理了）' }
  }
  const 大小 = st.size >= 1048576 ? (st.size / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(st.size / 1024)) + 'KB'
  if (st.size < 8000) return { 够: false, 条数: 0, 用户: 0, 助手: 0, 字节: st.size, 时间: st.mtimeMs, 为什么: '这个会话只有 ' + 大小 + '，里面没什么对话可补' }
  if (st.size > 32 * 1024 * 1024) return { 够: false, 条数: 0, 用户: 0, 助手: 0, 字节: st.size, 时间: st.mtimeMs, 为什么: '这个会话有 ' + 大小 + '，超过 32MB 上限了' }
  let 对 = []
  try {
    对 = 取对话(读会话归档(文件).事件)
  } catch (error) {
    return { 够: false, 为什么: '读不动这个会话：' + ((error && error.message) || String(error)) }
  }
  const 用户 = 对.filter((m) => m.role === 'user').length
  const 助手 = 对.filter((m) => m.role === 'assistant').length
  const 基础 = { 条数: 对.length, 用户, 助手, 字节: st.size, 时间: st.mtimeMs }
  if (对.length < 最少条) return Object.assign({}, 基础, { 够: false, 为什么: '这个会话只有 ' + 对.length + ' 条真正对话（你 ' + 用户 + ' 句、我 ' + 助手 + ' 句），补记至少要 ' + 最少条 + ' 条' })
  if (助手 < 2) return Object.assign({}, 基础, { 够: false, 为什么: '这个会话里我只回过 ' + 助手 + ' 句，补记至少要 2 句 —— 只有你单方面说的话，补记不出「交代」类的记忆' })
  return Object.assign({}, 基础, { 够: true, 为什么: '' })
}

/** 按会话 id 找它的归档文件（找不到给空串）。给体检会话用 —— 前端手里只有 id 没有路径。 */
export function 找会话文件(会话, 根 = 会话根()) {
  const id = String(会话 || '').trim()
  if (!id || id === '.' || id === '..' || /[/\\]/.test(id)) return ''
  let 工作区们 = []
  try {
    工作区们 = readdirSync(根)
  } catch (error) {
    return ''
  }
  for (const 区 of 工作区们) {
    const 文件 = join(根, 区, id, 'session.v4.jsonl.zstd')
    try {
      if (statSync(文件).isFile()) return 文件
    } catch (error) {
      continue
    }
  }
  return ''
}

export function 挑历史会话(最多 = 60, 现有 = [], 根 = 会话根()) {
  // 根可传：补记通常读「主库的历史会话」但写「当前实例的库」，两边不一定是同一个 DSH_HOME
  const 出 = []
  let 工作区们 = []
  try {
    工作区们 = readdirSync(根)
  } catch (error) {
    return 出
  }
  for (const 区 of 工作区们) {
    const 区路径 = join(根, 区)
    let 是目录 = false
    try {
      是目录 = statSync(区路径).isDirectory()
    } catch (error) {
      continue
    }
    if (!是目录) continue
    let 会话们 = []
    try {
      会话们 = readdirSync(区路径)
    } catch (error) {
      continue
    }
    for (const 会话 of 会话们) {
      const 文件 = join(区路径, 会话, 'session.v4.jsonl.zstd')
      let st
      try {
        st = statSync(文件)
      } catch (error) {
        continue
      }
      // 太小没内容，太大（>32MB）读起来慢且多半是超长 turn，先跳过
      if (st.size < 8000 || st.size > 32 * 1024 * 1024) continue
      出.push({
        会话,
        区,
        文件,
        字节: st.size,
        时间: st.mtimeMs,
        已补记: 补记过吗(现有, 会话),
      })
    }
  }
  出.sort((a, b) => b.时间 - a.时间)
  // 只看前 最多 个的正文（读文件有成本，别一上来扫几千个）
  const 取样 = 出.slice(0, Math.max(最多, 20))
  const 好 = []
  for (const x of 取样) {
    let 对 = []
    try {
      对 = 取对话(读会话归档(x.文件).事件)
    } catch (error) {
      continue
    }
    const 用户 = 对.filter((m) => m.role === 'user').length
    const 助手 = 对.filter((m) => m.role === 'assistant').length
    if (对.length < 最少条) continue
    // 只有主人独白、没有回答的会话不补（提取不出「交代」类的记忆）
    if (助手 < 2) continue
    好.push({
      会话: x.会话,
      区: x.区,
      文件: x.文件,
      条数: 对.length,
      用户,
      助手,
      字节: x.字节,
      时间: x.时间,
      已补记: x.已补记,
    })
  }
  return 好.slice(0, 最多)
}

/** 把一个会话的对话拼成给模型看的文本。 */
export function 读对话文本(文件, 上限条 = 默认上限条) {
  // 1.12.86：取**最近**的上限条，不是最前面那几条 —— 会话聊得越长，
  //   最早那几句越没有补记价值（那会儿该记的已经记过了）。
  const 对 = 取对话(读会话归档(文件).事件).slice(-上限条)
  let 文 = 对.map((m) => (m.role === 'user' ? '主人：' : '我：') + m.text).join('\n\n')
  // 200 条聊满能到 9 万多字，一次喂不进模型 —— 超了就**从前面砍**，保最近的（1.12.86）
  if (文.length > 40000) 文 = 文.slice(-40000)
  return 文
}

export function 补记提取系统(已有键 = []) {
  const 键段 =
    Array.isArray(已有键) && 已有键.length
      ? '\n\n下面这些事实键**库里已经用过了**。如果某条记忆讲的正是其中一件事，**必须原样复用该键**，不要另起同义词：\n' +
        已有键.slice(0, 60).join('、')
      : ''
  return (
    '你在帮一个长期陪伴系统做「历史会话补记」：从一段历史对话里，挑出**值得长期记住、放进全局档案**的信息。\n\n' +
    '只收这些：**过了一周甚至一个月后依然成立**的东西：\n' +
    '- 主人的性格、喜好、饮食禁忌/过敏、习惯、长期生活/工作处境\n' +
    '- 双方定下来的称呼、规矩、边界、约定、纪念日、口令\n' +
    '- 重要的长期技术前提或双方确认过的关键关系事实\n\n' +
    '绝对不要收：\n' +
    '- 一次性寒暄、当天吃了什么/几点睡、泛泛的情绪感叹\n' +
    '- 临时性的排错过程、工具调用流水账、尚未确认的猜测或随口玩笑\n' +
    '- 助手单方面提议但主人未认可的内容\n\n' +
    '字段规范（输出**严格 JSON 数组**，不要 markdown 代码块，不要解释；没有值得收的就输出 []）：\n' +
    '[{"text":"一句话陈述（15~80字，写清主体）","类型":"identity|relation|promise|preference|experience|misc","事实键":"主体.方面 或 null","词":["检索词1","检索词2"],"重要度":0.5}]\n\n' +
    '说明：\n' +
    '- `事实键`：可选，格式必须是 `主体.方面`（中间一个点、无空格、无数字，如 `主人.忌口`、`约定.称呼`）；一次性的或拿不准就填 `null`。\n' +
    '- `词`：2~6 个以后可能用来搜到这条的具体中文实词（避免「陪伴」「承诺」「喜欢」这类泛词）。\n' +
    '- `重要度`：核心边界/身份/约定填 `1`，一般喜好/背景填 `0.5`。' +
    键段
  )
}

/** 解析补记模型输出。解析失败一律当空，防止写脏数据。 */
export function 解析补记候选(rawText) {
  let s = String(rawText || '').trim()
  if (!s) return []
  const 块 = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (块) s = 块[1].trim()
  const 起 = s.indexOf('[')
  const 止 = s.lastIndexOf(']')
  if (起 < 0 || 止 <= 起) return []
  let arr
  try {
    arr = JSON.parse(s.slice(起, 止 + 1))
  } catch (error) {
    return []
  }
  if (!Array.isArray(arr)) return []
  const out = []
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue
    const 文 = String(it.text || '').trim()
    if (!文 || 文.length < 4 || 文.length > 240) continue
    if (/^(跳过|无)$/.test(文)) continue
    const rawType = String(it.类型 || it.type || '').trim()
    const 类型 = 合法类型.has(rawType) ? rawType : 'misc'
    const 事实键 = 规整事实键(it.事实键 !== undefined ? it.事实键 : it.factKey)
    const rawWords = Array.isArray(it.词)
      ? it.词
      : Array.isArray(it.related)
        ? it.related
        : typeof it.词 === 'string'
          ? it.词.split(/[\s,，、]+/)
          : []
    const 词 = rawWords
      .map((w) => String(w || '').trim())
      .filter((w) => w.length >= 1 && w.length <= 12)
      .slice(0, 8)
    let imp = Number(it.重要度 !== undefined ? it.重要度 : it.importance)
    if (!Number.isFinite(imp) || imp <= 0) imp = 0.5
    imp = Math.max(0.1, Math.min(1, imp))
    const rawDate = typeof (it.日期 ?? it.at) === 'string' ? String(it.日期 ?? it.at).trim() : ''
    const 日期 = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null
    out.push({ text: 文, 类型, 事实键, 词, 重要度: imp, 日期 })
  }
  return out
}

export async function 提取一次补记(ctx, agent, 对话文本, 已有键 = []) {
  const t = String(对话文本 || '').trim()
  if (t.length < 200) return { ok: false, message: '这段对话太短，不值得提取' }
  let r
  try {
    r = await 问模型(ctx, agent, 补记提取系统(已有键), t, 8000)
  } catch (error) {
    return { ok: false, message: '调用失败：' + ((error && error.message) || error) }
  }
  if (!r || !r.ok) return { ok: false, message: (r && r.message) || '模型没回话' }
  const 候选 = 解析补记候选(r.text)
  diag('  历史补记：模型回 ' + String(r.text || '').length + ' 字，解析出 ' + 候选.length + ' 条')
  if (!候选.length) diag('  历史补记：原始返回 → ' + String(r.text || '(空)').replace(/\s+/g, ' ').slice(0, 400))
  return { ok: true, 候选 }
}

/**
 * 判一条候选跟现有记忆的关系。
 * @returns {{ 动作:'add'|'update'|'noop', 撞上?:object, 为什么?:string }}
 */
export function 判新旧(候选, 现有) {
  const 文 = String((候选 && 候选.text) || '').trim()
  if (!文) return { 动作: 'noop', 为什么: '空条目' }
  const 活 = (现有 || []).filter((m) => m && !m.已被取代 && !m.supersededBy && !m.别记)
  const 键 = 规整事实键(候选.事实键 !== undefined ? 候选.事实键 : 候选.factKey)
  // ① 有事实键的，先按键找同一条命 —— 这是最准的判据（键一样 = 同一件事）
  if (键) {
    const 同键 = 活.filter((m) => {
      const mk = 规整事实键(m.事实键 !== undefined ? m.事实键 : m.factKey)
      return mk === 键
    })
    if (同键.length) {
      const 最新 = 同键.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0]
      if (像的(最新.text, 文) >= 像的线) {
        return { 动作: 'noop', 撞上: 最新, 为什么: '同键同义' }
      }
      return { 动作: 'update', 撞上: 最新, 为什么: '同键、内容变了（旧的要标已被取代）' }
    }
  }
  // ② 没键（或键是新的）：退回词面像度，撞上了就算没变化
  let 最像 = null
  let 最高 = 0
  for (const m of 活) {
    const s = 像的(m.text, 文)
    if (s > 最高) {
      最高 = s
      最像 = m
    }
  }
  if (最像 && 最高 >= 像的线) return { 动作: 'noop', 撞上: 最像, 为什么: '像度 ' + 最高.toFixed(3) }
  return { 动作: 'add' }
}

/** 造一条能直接进 stable_profile 的记忆。 */
export function 造补记条目(候选, opts) {
  const o = opts || {}
  const 会话 = String(o.会话 || '')
  const 现在 = Number(o.现在) || Date.now()
  const 文 = String((候选 && 候选.text) || '').trim()
  const id = 'bf' + 现在.toString(36) + Math.random().toString(36).slice(2, 7)
  const 词 = Array.isArray(候选 && 候选.词) ? 候选.词.filter((w) => typeof w === 'string' && w) : []
  const 重要度 = Number(候选 && 候选.重要度)
  const rawType = String((候选 && (候选.类型 || 候选.type)) || '').trim()
  const 类型 = 合法类型.has(rawType) ? rawType : 'misc'
  const 键 = 规整事实键(候选 && (候选.事实键 !== undefined ? 候选.事实键 : 候选.factKey))
  const 条目 = {
    id,
    text: 文,
    category: 'stable_profile',
    scope: 'global',
    type: 类型,
    // 重要度缺了按 0.5 —— 宁可淡一点，也别让它把常驻名额占了
    importance: Number.isFinite(重要度) && 重要度 > 0 ? 重要度 : 0.5,
    at: (候选 && 候选.日期) || null,
    createdAt: new Date(现在).toISOString(),
    source: '历史补记' + (会话 ? '：' + 会话.slice(0, 16) : ''),
    fromSession: 会话 || null,
    importBatch: o.批次 || null,
    importAt: new Date(现在).toISOString(),
  }
  if (词.length) 条目.related = 词
  if (键) 条目.事实键 = 键
  if (o.证据) 条目.evidence = o.证据
  return 条目
}

/**
 * 试提取：跑模型、跟现有库对齐，**不写库**。
 * @returns {Promise<{ok:boolean, 候选?:Array, message?:string}>}
 */
export async function 试提取(ctx, agent, 会话, 文件, opts) {
  const o = opts || {}
  const 文本 = 读对话文本(文件, Number(o.上限条) || 默认上限条)
  if (文本.length < 200) return { ok: false, message: '这段对话太短，不值得提取' }
  const 现有 = Array.isArray(o.现有) ? o.现有 : 读全局事实()
  const 已有键 = [
    ...new Set(
      现有
        .filter((m) => m && !m.已被取代 && !m.supersededBy && !m.别记)
        .map((m) => 规整事实键(m.事实键 !== undefined ? m.事实键 : m.factKey))
        .filter(Boolean),
    ),
  ]
  const r = typeof o.提取器 === 'function' ? await o.提取器(文本, 已有键) : await 提取一次补记(ctx, agent, 文本, 已有键)
  if (!r || !r.ok) return { ok: false, message: (r && r.message) || '模型没回话' }
  const 候选 = []
  for (const c of r.候选 || []) {
    if (!c || !c.text) continue
    if (/^(跳过|无)$/.test(String(c.text).trim())) continue
    const 判 = 判新旧(c, 现有)
    候选.push({
      text: c.text,
      类型: c.类型 || 'misc',
      词: Array.isArray(c.词) ? c.词 : [],
      日期: c.日期 || null,
      重要度: c.重要度,
      事实键: 规整事实键(c.事实键 !== undefined ? c.事实键 : c.factKey),
      动作: 判.动作,
      撞上: 判.撞上 ? { id: 判.撞上.id, text: 判.撞上.text } : null,
      为什么: 判.为什么 || null,
    })
  }
  const 计 = { add: 0, update: 0, noop: 0 }
  for (const c of 候选) 计[c.动作] = (计[c.动作] || 0) + 1
  return { ok: true, 候选, 计, 文本长度: 文本.length }
}

/**
 * 把用户勾选通过的候选写进库，打成一个批次。
 * sid 为空/null 时直接写全局事实库 `_facts.json`，绝不制造假会话 `null.json`。
 */
export function 应用(sid, 通过, opts) {
  const o = opts || {}
  const 批次 = o.批次 || 'bfb' + Date.now().toString(36)
  const 现在 = Number(o.现在) || Date.now()
  const 加了的 = []
  const 改了的 = []

  if (!sid) {
    const { fp, 盘 } = 读事实盘()
    const 坟 = new Set((盘.deleted || []).map((d) => String(d && d.id)))
    const 旧表 = Array.isArray(盘.memories) ? 盘.memories : []
    for (const c of 通过 || []) {
      const 条目 = 造补记条目(c, { 会话: o.会话 || '', 批次, 现在, 证据: o.证据 })
      if (c.动作 === 'update' && c.撞上 && c.撞上.id) {
        const 旧 = 旧表.find((m) => m && m.id === c.撞上.id && !坟.has(String(m.id)) && !m.已被取代)
        if (旧) {
          旧.已被取代 = {
            被谁: '历史补记:' + 批次,
            为什么: String(c.为什么 || '历史补记同键改写'),
            作废于: 条目.createdAt,
            新id: 条目.id,
          }
          旧.editedAt = 条目.createdAt
          改了的.push(旧.id)
        }
      }
      旧表.push(条目)
      加了的.push(条目.id)
    }
    盘.memories = 旧表
    写事实盘(fp, 盘)
    return { ok: true, 批次, 加了: 加了的.length, 取代: 改了的.length, id们: 加了的 }
  }

  const 库 = loadStore(sid)
  const 旧表 = Array.isArray(库.memories) ? 库.memories : []
  for (const c of 通过 || []) {
    const 条目 = 造补记条目(c, { 会话: o.会话 || sid, 批次, 现在, 证据: o.证据 })
    if (c.动作 === 'update' && c.撞上 && c.撞上.id) {
      const 旧 = 旧表.find((m) => m && m.id === c.撞上.id && !m.已被取代)
      if (旧) {
        旧.已被取代 = {
          被谁: '历史补记:' + 批次,
          为什么: String(c.为什么 || '历史补记同键改写'),
          作废于: 条目.createdAt,
          新id: 条目.id,
        }
        旧.editedAt = 条目.createdAt
        改了的.push(旧.id)
      }
    }
    旧表.push(条目)
    加了的.push(条目.id)
  }
  库.memories = 旧表
  saveStore(sid, 库)
  return { ok: true, 批次, 加了: 加了的.length, 取代: 改了的.length, id们: 加了的 }
}

/**
 * 撤销一个批次：删掉这次新加的，把被取代的恢复。
 * @returns {{ok:boolean, 删了:number, 恢复了:number, message?:string}}
 */
export function 撤销(sid, 批次) {
  if (!批次) return { ok: false, 删了: 0, 恢复了: 0, message: '没给批次号' }
  const 时间 = new Date().toISOString()

  const 还原取代 = (表, 新加id) => {
    let 恢复 = 0
    for (const m of 表) {
      if (!m) continue
      let 命中 = false
      if (m.已被取代) {
        if (m.已被取代.被谁 === '历史补记:' + 批次 || (m.已被取代.新id && 新加id.has(m.已被取代.新id))) {
          delete m.已被取代
          if (!Array.isArray(m.撤销记录)) m.撤销记录 = []
          m.撤销记录.push({ 被谁: '历史补记', 撤销于: 时间, 原因: '撤销补记批次 ' + 批次 })
          m.editedAt = 时间
          命中 = true
        }
      }
      if (m.supersededBy && 新加id.has(m.supersededBy)) {
        delete m.supersededBy
        delete m.supersededAt
        delete m.supersededReason
        m.editedAt = 时间
        命中 = true
      }
      if (命中) 恢复++
    }
    return 恢复
  }

  if (!sid) {
    const { fp, 盘 } = 读事实盘()
    const 旧表 = Array.isArray(盘.memories) ? 盘.memories : []
    const 新加 = 旧表.filter((m) => m && m.importBatch === 批次)
    if (!新加.length) return { ok: false, 删了: 0, 恢复了: 0, message: '找不到这个批次（可能已经撤过了）' }
    const 新加id = new Set(新加.map((m) => m.id))
    const 恢复 = 还原取代(旧表, 新加id)
    盘.memories = 旧表.filter((m) => !新加id.has(m.id))
    写事实盘(fp, 盘, { 换代: true })
    return { ok: true, 删了: 新加.length, 恢复了: 恢复 }
  }

  const 库 = loadStore(sid)
  const 旧表 = Array.isArray(库.memories) ? 库.memories : []
  const 新加 = 旧表.filter((m) => m && m.importBatch === 批次)
  if (!新加.length) return { ok: false, 删了: 0, 恢复了: 0, message: '找不到这个批次（可能已经撤过了）' }
  const 新加id = new Set(新加.map((m) => m.id))
  const 恢复 = 还原取代(旧表, 新加id)
  库.memories = 旧表.filter((m) => !新加id.has(m.id))
  saveStore(sid, 库, { raw: true })
  return { ok: true, 删了: 新加.length, 恢复了: 恢复 }
}

/** 库里现有的补记批次一览（页面用）。 */
export function 列批次(sid) {
  const 列表 = sid ? (loadStore(sid).memories || []) : 读全局事实()
  const 表 = new Map()
  for (const m of 列表) {
    if (!m || !m.importBatch) continue
    // ⭐ 1.12.85：只列**补记自己的**批次（bfb 前缀），不把档案导入批次混进来
    if (String(m.importBatch).slice(0, 3) !== 'bfb') continue
    const k = m.importBatch
    if (!表.has(k)) 表.set(k, { 批次: k, 条数: 0, 会话: m.fromSession || '', 时间: m.importAt || m.createdAt || '' })
    const v = 表.get(k)
    v.条数++
  }
  return [...表.values()].sort((a, b) => String(b.时间).localeCompare(String(a.时间)))
}
