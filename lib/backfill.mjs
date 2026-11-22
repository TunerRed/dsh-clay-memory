// ============================================================================
// lib/backfill.mjs —— F25：历史会话补记
//
// 目标：挑一个**以前聊过的会话**，按现在的规则重新提取一遍候选，
//       跟库里已有的记忆对齐（新增 / 改写 / 没变化），**先给你看**，
//       你点确认才写进库，而且整批可以一次撤销。
//
// 为什么不复用「经历提取」那条路：
//   经历提取产出的是 event（带时刻的一次经历）和梗，走的是 `episode` 层；
//   补记要的是**长期记忆**（喜好、约定、事实），得落 stable_profile。
//   两条层的判据、去重口径、过期策略都不一样，硬共用会把画像池污染成流水账。
//   所以这里借它的「问模型 + 解析候选」，入口和落库各走各的。
//
// 为什么不能重跑一次就一定一样：模型有随机性，同一段对话两次提取出来的
//   条数、措辞都可能不同。所以**预览必须是真的预览**（跑完先存着给人看），
//   不能点一下就直接写库。
// ============================================================================
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { 读会话归档, 取对话 } from './archive-reader.mjs'
import { loadStore, saveStore } from './store-core.mjs'
import { 宿主数据根 } from './paths.mjs'
import { 提取一次 } from './episode.mjs'
import { 像度, 词集 } from './scoring.mjs'

// 太短的会话不值得跑（一句话来回问不出什么长期记忆）
const 最少条 = 6
// 一次最多喂给模型多少条对话 —— 模型窗口有限，而且长会话本来就是「超长 turn」的重灾区
const 默认上限条 = 200
// 判「跟已有的太像」的线。0.85 是库内查重一直在用的口径，这里对齐它。
const 像的线 = 0.85

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

/** 会话归档的根目录：<DSH_HOME>/data/sessions */
export function 会话根() {
  return join(dirname(宿主数据根()), 'sessions')
}

/** 这个会话补记过没有（看库里有没有它的 importBatch）。 */
function 补记过吗(现有, sid) {
  for (const m of 现有) {
    if (m && m.fromSession === sid && m.importBatch) return true
  }
  return false
}

/**
 * 挑出可以补记的历史会话，按最近活动排。
 * @returns {Array<{会话:string, 条数:number, 用户:number, 助手:number, 字节:number, 时间:number, 已补记:boolean}>}
 */
/**
 * 单一会话「能不能补记」的诊断（不花 token、不写库）。
 * 为什么要单独有：页面上会话不够格时只把按钮变灰，等于不告诉人为什么 ——
 * 2026-11-22 主人报「没有对话的不会报错，没有提醒」。
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
  if (st.size < 8000) return { 够: false, 条数: 0, 用户: 0, 助手: 0, 字节: st.size, 为什么: '这个会话只有 ' + 大小 + '，里面没什么对话可补' }
  if (st.size > 32 * 1024 * 1024) return { 够: false, 条数: 0, 用户: 0, 助手: 0, 字节: st.size, 为什么: '这个会话有 ' + 大小 + '，超过 32MB 上限了' }
  let 对 = []
  try {
    对 = 取对话(读会话归档(文件).事件)
  } catch (error) {
    return { 够: false, 为什么: '读不动这个会话：' + ((error && error.message) || String(error)) }
  }
  const 用户 = 对.filter((m) => m.role === 'user').length
  const 助手 = 对.filter((m) => m.role === 'assistant').length
  const 基础 = { 条数: 对.length, 用户, 助手, 字节: st.size }
  if (对.length < 最少条) return Object.assign({}, 基础, { 够: false, 为什么: '这个会话只有 ' + 对.length + ' 条真正对话（你 ' + 用户 + ' 句、我 ' + 助手 + ' 句），补记至少要 ' + 最少条 + ' 条' })
  if (助手 < 2) return Object.assign({}, 基础, { 够: false, 为什么: '这个会话里我只回过 ' + 助手 + ' 句，补记至少要 2 句 —— 只有你单方面说的话，补记不出「交代」类的记忆' })
  return Object.assign({}, 基础, { 够: true, 为什么: '' })
}

/** 按会话 id 找它的归档文件（找不到给空串）。给体检会话用 —— 前端手里只有 id 没有路径。 */
export function 找会话文件(会话, 根 = 会话根()) {
  const id = String(会话 || '').trim()
  if (!id) return ''
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
      // 太小没内容，太大（>2MB）读起来慢且多半是超长 turn，先跳过
      // 1.12.86 修：上限从 2MB 提到 32MB —— 2MB 会把「聊得很久」的大会话全挡在外面，
      //   而那些恰恰是最该补记的（实测当前会话 16.5MB 直接被排除，2026-11-22 主人撞到）。
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

/**
 * 判一条候选跟现有记忆的关系。
 * @returns {{ 动作:'add'|'update'|'noop', 撞上?:object, 为什么?:string }}
 */
export function 判新旧(候选, 现有) {
  const 文 = String((候选 && 候选.text) || '').trim()
  if (!文) return { 动作: 'noop', 为什么: '空条目' }
  const 键 = 候选.事实键 ? String(候选.事实键) : ''
  // ① 有事实键的，先按键找同一条命 —— 这是最准的判据（键一样 = 同一件事）
  if (键) {
    const 同键 = 现有.filter((m) => m && m.factKey === 键 && !m.supersededBy)
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
  for (const m of 现有) {
    if (!m || m.supersededBy) continue
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
  const 文 = String(候选.text || '').trim()
  const id = 'bf' + 现在.toString(36) + Math.random().toString(36).slice(2, 7)
  const 词 = Array.isArray(候选.词) ? 候选.词.filter((w) => typeof w === 'string' && w) : []
  const 重要度 = Number(候选.重要度)
  const 条目 = {
    id,
    text: 文,
    category: 'stable_profile',
    scope: 'global',
    type: 'misc',
    // 重要度缺了按 0.5 —— 宁可淡一点，也别让它把常驻名额占了
    importance: Number.isFinite(重要度) && 重要度 > 0 ? 重要度 : 0.5,
    createdAt: new Date(现在).toISOString(),
    source: '历史补记' + (会话 ? '：' + 会话.slice(0, 16) : ''),
    fromSession: 会话 || null,
    importBatch: o.批次 || null,
    importAt: new Date(现在).toISOString(),
  }
  if (词.length) 条目.related = 词
  if (候选.事实键) 条目.factKey = String(候选.事实键)
  // T5：证据留 session + seq + 摘录，出事能顺着找回去
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
  const r = await 提取一次(ctx, agent, 文本)
  if (!r || !r.ok) return { ok: false, message: (r && r.message) || '模型没回话' }
  const 现有 = (loadStore(会话).memories || [])
  const 候选 = []
  for (const c of r.候选) {
    if (!c || !c.text) continue
    // 「跳过」是模型在说「这条不值得记」，不是一条记忆
    if (/^跳过$/.test(String(c.text).trim())) continue
    const 判 = 判新旧(c, 现有)
    候选.push({
      text: c.text,
      词: Array.isArray(c.词) ? c.词 : [],
      日期: c.日期 || null,
      重要度: c.重要度,
      事实键: c.事实键 || null,
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
 * @param {string} sid
 * @param {Array} 通过 来自 试提取 的候选（已过滤成用户要的那几条）
 * @param {{ 批次?:string, 会话?:string, 现在?:number, 证据?:object }} opts
 */
export function 应用(sid, 通过, opts) {
  const o = opts || {}
  const 批次 = o.批次 || 'bfb' + Date.now().toString(36)
  const 现在 = Number(o.现在) || Date.now()
  const 库 = loadStore(sid)
  const 旧表 = Array.isArray(库.memories) ? 库.memories : []
  const 加了的 = []
  const 改了的 = []
  for (const c of 通过) {
    const 条目 = 造补记条目(c, { 会话: o.会话 || sid, 批次, 现在, 证据: o.证据 })
    if (c.动作 === 'update' && c.撞上 && c.撞上.id) {
      const 旧 = 旧表.find((m) => m && m.id === c.撞上.id)
      if (旧) {
        // 旧的不删，标「已被取代」—— 跟库里其他取代一个规矩，随时能恢复
        旧.supersededBy = 条目.id
        旧.supersededAt = 条目.createdAt
        旧.supersededReason = 'write_conflict'
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
  const 库 = loadStore(sid)
  const 旧表 = Array.isArray(库.memories) ? 库.memories : []
  const 新加 = 旧表.filter((m) => m && m.importBatch === 批次)
  if (!新加.length) return { ok: false, 删了: 0, 恢复了: 0, message: '找不到这个批次（可能已经撤过了）' }
  const 新加id = new Set(新加.map((m) => m.id))
  let 恢复 = 0
  for (const m of 旧表) {
    if (!m || !m.supersededBy) continue
    if (!新加id.has(m.supersededBy)) continue
    delete m.supersededBy
    delete m.supersededAt
    delete m.supersededReason
    恢复++
  }
  库.memories = 旧表.filter((m) => !新加id.has(m.id))
  // ⚠⚠ **必须 raw**：saveStore 默认是「合并写」—— 把盘上现有的和这次传进来的并起来（防并发写丢数据），
  //   普通写回会把刚删掉的那几条又合并回来（真机实测：before 565 → undo 说删了 3 → after 还是 565）。
  //   raw 才是真销毁语义：写盘内容以这次传进去的为准。
  saveStore(sid, 库, { raw: true })
  return { ok: true, 删了: 新加.length, 恢复了: 恢复 }
}

/** 库里现有的补记批次一览（页面用）。 */
export function 列批次(sid) {
  const 库 = loadStore(sid)
  const 表 = new Map()
  for (const m of 库.memories || []) {
    if (!m || !m.importBatch) continue
    // ⭐ 1.12.85：只列**补记自己的**批次。真机第一版把历史上导库的批次（171 条 / 253 条）
    //   也列了进来 —— 那些是「档案导入」，跟补记不是一回事，混在一起还会让人误点撤销，
    //   而撤销一个导入批次会删掉 200 多条真记忆。补记批次号统一 `bfb` 前缀（见 应用()）。
    if (String(m.importBatch).slice(0, 3) !== 'bfb') continue
    const k = m.importBatch
    if (!表.has(k)) 表.set(k, { 批次: k, 条数: 0, 会话: m.fromSession || '', 时间: m.importAt || m.createdAt || '' })
    const v = 表.get(k)
    v.条数++
  }
  return [...表.values()].sort((a, b) => String(b.时间).localeCompare(String(a.时间)))
}
