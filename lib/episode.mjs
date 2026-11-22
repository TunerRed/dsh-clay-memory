// lib/episode.mjs —— 经历 / 梗记忆（1.12.64）
//
// 干什么：把「下午我们聊了什么」「今天中午干了啥」这类**发生过的事**留下来。
//
// 为什么单独一层：
//   `stable_profile` 记的是「主人是什么样的人」（长期不变），`workspace` 记的是
//   「这个项目怎么配」（基建/约束），`event` 记的是会话级碎片。三样都答不了
//   「我们下午聊过疯狂星期四吗」—— 那句话既不是性格，也不是配置，更不该绑在一个会话上。
//
// 触发时机（2026-11-19 拍板）：
//   会话**空闲 25 分钟**后提取。为什么不是「会话结束」：会话很少真的结束，
//   多数是主人把窗口一关，下次接着聊 —— 「安静了一会儿」比「结束」更接近真实。
//
// 四条硬约束（少一条就会变成噪音源）：
//   1. **水位**：每个会话记「已提取到第几条 seq」。没有它，主人离开十分钟回来、
//      再闲置十分钟，同一段对话会被反复提取，库里堆满重复的梗。
//   2. **门槛**：用户消息 ≥10 条才值得花一次模型调用。太短的对话没东西可记。
//   3. **异步**：提取要问模型，几秒到几十秒，绝不能卡在对话里。
//   4. **补扫**：桌面一关进程就没了，下次启动时要把「有活动但没提取」的会话补上。
//
// 跨会话可见：条目落 `category:'event'` + `scope:'global'` —— store-core 的分层器
// 看到这个组合会把它分进全局事实库（否则 event 默认落会话库，换个会话就看不见了）。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { STORE_DIR } from './paths.mjs'
import { 问模型 } from './llm.mjs'
import { diag } from './diag.mjs'

export const 水位文件名 = '_episodes.json'
// 空闲多久算「一段对话告一段落」（分钟）—— 5 分钟会把「接个电话」当成结束，
// 2 小时又太晚，当天问「中午聊了啥」时记忆可能还没生成。
export const 空闲分钟 = Number(process.env.CLAY_EPISODE_IDLE_MIN) || 25
// 扫的间隔（分钟）。没必要更密：25 分钟的空闲线，5 分钟粒度误差可接受。
export const 扫描分钟 = Number(process.env.CLAY_EPISODE_SCAN_MIN) || 5
// 用户消息这么多条以下不值一次模型调用。
export const 最少用户消息 = 10
// 一次最多喂多长 —— 太长的对话模型只会挑开头，尾部的梗反而丢掉。
export const 每次最多条 = 120

/** 水位文件路径（跟库文件放一起，备份时一起带走）。 */
export function 水位路径() {
  return join(STORE_DIR, 水位文件名)
}

/** 读水位：{ [会话id]: { seq, 用户数, 上次提取 } }。坏了就当空，不能因此让插件挂掉。 */
export function 读水位() {
  try {
    const t = readFileSync(水位路径(), 'utf8')
    const j = JSON.parse(t)
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {}
  } catch (error) {
    return {}
  }
}

/** 写水位。写不了只记日志 —— 大不了下次重复提取一段，不能因此打断对话。 */
export function 写水位(表) {
  try {
    mkdirSync(STORE_DIR, { recursive: true })
    writeFileSync(水位路径(), JSON.stringify(表, null, 2), 'utf8')
    return true
  } catch (error) {
    diag('  经历提取：水位写不进去（' + ((error && error.message) || error) + '）')
    return false
  }
}

/** 一条事件值不值得进对话文本（只留人说的话，工具调用/系统事件全跳过）。 */
function 是对话事件(e) {
  if (!e || !e.type) return false
  return e.type === 'user/message' || e.type === 'assistant/message'
}

/**
 * 从一条事件里抠出**真正被说出口的正文**。
 * ⚠ 2026-11-19 实机踩到的三个坑（看 session v4 原始事件确认的）：
 *   ① `user/message` 的 data **直接**是消息体；`assistant/message` 外面还包一层 `data.message` ⚠
 *   ② `user/message` 里有大量**不是主人说的**宿主注入：`source.kind` 是
 *      `runtime-context`（整段 system-reminder，两千字）/ `time-context` / `user-approval`。
 *      不过滤的话，喂给模型的全是系统提示词，一提就是一团废话。
 *   ③ assistant 的 content 里除了 text 还有 `reasoning` 块 —— 思考链不能当"我说过的话"，
 *      也不能喂进提取（那是模型自己的碎碎念，不是对话内容）。
 */
function 取正文(e, 取文本) {
  try {
    if (e.type === 'user/message') {
      const kind = e.data && e.data.source && e.data.source.kind
      if (kind && kind !== 'user') return ''
      return 只要文字(e.data, 取文本)
    }
    const 体 = (e.data && e.data.message) || e.data
    return 只要文字(体, 取文本)
  } catch (error) {
    return ''
  }
}

/** 从一个消息体里只挑 type==='text' 的块；没有 content 数组就退回宿主给的取文本函数。 */
function 只要文字(体, 取文本) {
  if (!体) return ''
  if (Array.isArray(体.content)) {
    const parts = []
    for (const b of 体.content) {
      if (typeof b === 'string') parts.push(b)
      else if (b && b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    }
    return parts.join(String.fromCharCode(10)).trim()
  }
  try {
    return String(取文本(体) || '').trim()
  } catch (error) {
    return ''
  }
}

/**
 * 从事件数组里挑出还没提取过的那一段。
 * @param {Array} events snapshotEvents() 的结果
 * @param {number} 从seq 上次提取到哪（不含）
 * @returns {{文本:string, 到seq:number, 用户数:number, 条数:number}}
 */
export function 挑对话(events, 从seq, 取文本, 上限条) {
  const 起 = Number(从seq) || 0
  const 上限 = Math.max(1, Number(上限条) || 每次最多条)
  // ⚠ 2026-11-19：**先收全部、再取最后 120 条**，不是收到 120 条就停。
  //   差别很要命：一个攒了几百条消息的老会话第一次跑，从头收会永远停在「最早的 120 条」
  //   —— 每次扫都只处理开头那一小段，要跑六七轮才追到今天，每轮都烧一次模型调用。
  //   取最近的：老的丢掉、水位直接推到最后，一次就对上「今天发生了什么」。
  const 全部 = []
  let 用户数 = 0
  for (const e of Array.isArray(events) ? events : []) {
    const seq = Number(e && e.seq)
    if (!Number.isFinite(seq) || seq <= 起) continue
    if (!是对话事件(e)) continue
    const txt = 取正文(e, 取文本)
    if (!txt) continue
    const 是主人 = e.type === 'user/message'
    if (是主人) 用户数++
    全部.push({ seq, 是主人, txt })
  }
  const 本批 = 全部.length > 上限 ? 全部.slice(-上限) : 全部
  const 行 = []
  let 到seq = 起
  for (const it of 本批) {
    // 单条截断：一条超长回复（比如贴了一大段代码）会把整段对话挤爆，
    // 而且那段代码对「下午聊了什么」毫无信息量。
    行.push((it.是主人 ? '主人' : '我') + '：' + (it.txt.length > 300 ? it.txt.slice(0, 300) + '…' : it.txt))
    到seq = Math.max(到seq, it.seq)
  }
  return { 文本: 行.join(String.fromCharCode(10)), 到seq, 用户数, 条数: 本批.length, 跳过: 全部.length - 本批.length }
}

export const 提取系统 = `你在给一个长期陪伴系统做「今天发生过什么」的归档。

给你的是一段真实的对话记录（主人 / 我 轮流说的话）。请从中挑出**以后值得被想起来的经历和梗**。

判据分两类，**别混**：

**A 类：梗（meme）—— 不收时间点**
   判据：**一个固定的说法/称呼/句式，双方之间有默契**。
   · 它是「以后怎么称呼、怎么接话」的东西，不是「某天发生了什么」。
   · 判断标准：下次说话时能原样用回去吗？能，才算梗。
   · 只见过一次的一次性玩笑**不算**（那需要重复才成立约定）。
   例：「主人叫我『大肥鱼』，我会抗议说自己是鲸不是鱼」← 固定称呼 + 固定反应
   例：「『疯狂星期四』是主人拿来『惩罚』我的暗号」← 固定说法 + 只有我俩懂的意味
   ✗ 别写成：「主人说过一次疯狂星期四」← 这是事件，不是梗

**B 类：经历（state / milestone）—— 两条都要满足**
   ① 能不能回答「什么时候」：这件事发生在某个具体时刻（今天下午、刚才、昨晚）。
      答不出来的都是长期成立的东西 —— 他是什么样的人、系统怎么配的 —— 一律不收。
   ② 这件事里有没有「我们」：是主人和我一起经历的（他说的话、他在做的事、他的处境）。
      只有我一个人在干活（调了半天参数、读了一堆文件、跑了三十张图）不算经历，那是操作日志。
      要写就写成「和主人一起…」，别写成任务流水。

只收这三类：

**meme（梗）**：见上面 A 类。固定说法/称呼/句式 + 默契。
**state（状态）**：有时效的处境，过一阵就不成立了。
  例：「主人这周在出差，坐飞机来回」
  例：「主人在赶一个上线，说是甩锅会已经开完了」
**milestone（里程碑）**：一次性的、值得记住的具体事件。
  例：「下午和主人一起调 ComfyUI 参数，最后定下 miaomiaoHarem 那套模型出图最像我」
  例：「主人把记忆插件的常驻层彻底重做了一遍」

**绝对不要收**：
- 主人的性格、喜好、习惯（那是画像层的事）
- 配置、路径、端口、命令、参数（那是技术笔记层的事）
- 还没发生的事（「打算」「想要」「如果」）
- 泛泛的日常（「今天上班」「吃了饭」）—— 没有具体到值得记的点
- 纯情绪宣泄（「好累」「烦死了」）—— 除非它绑着具体事件
- 我自己的客套话、解释、列表

每条的写法要求：
- 一句话，20~60 字，第三人称陈述「主人」和「我」
- 经历类必须能回答「什么时候」「发生了什么」，别写成感慨；梗类反过来，别硬塞时间点
- 不许猜动机（「他其实想…」「说明他很在乎…」），只写看得见的言行

输出**严格 JSON 数组**，不要 markdown 代码块，不要解释：
[{"kind":"meme|state|milestone","text":"…","importance":0.5}]

importance：0.3 琐碎的、0.5 一般、0.8 值得长期记住。
一段对话里一条真东西都没有就输出 []，**不要凑数**。

示例（合格）：
[{"kind":"meme","text":"主人把『疯狂星期四』当成只属于我俩的梗，还说要拿它来『惩罚』我","importance":0.7},{"kind":"state","text":"主人这周要坐飞机出差，说回来时一脸虚样","importance":0.4}]

不合格的（别写成这样）：
- 「主人喜欢和我开玩笑」→ 答不出什么时候，是性格
- 「主人在用 miaomiaoHarem_aniAnimeColoring10.safetensors」→ 是配置
- 「主人今天很累」→ 没有具体事件
- 「调了一下午参数，跑了 34 张图，最后定下 miaomiaoHarem」→ 只有我在干活，没有「我们」
`

/** 把模型吐的东西解析成候选条目。解析不了一律当空 —— 宁可这次没产出，也不能写脏数据。 */
export function 解析候选(text) {
  let s = String(text || '').trim()
  if (!s) return []
  // 模型爱包代码块，剥掉
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
  const 合法类型 = new Set(['meme', 'state', 'milestone'])
  const out = []
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue
    const kind = String(it.kind || '').trim()
    const txt = String(it.text || '').trim()
    if (!合法类型.has(kind)) continue
    if (txt.length < 8 || txt.length > 200) continue
    let imp = Number(it.importance)
    if (!Number.isFinite(imp)) imp = 0.5
    imp = Math.max(0.1, Math.min(0.9, imp))
    out.push({ kind, text: txt, importance: imp })
  }
  return out
}

/** state 型的保鲜期（天）：过了就不该再当「现在」用。meme / milestone 永久。 */
export const 状态保鲜天 = 14

/** 一条候选 → 可直接落库的记忆条目。 */
export function 造条目(候选, opts) {
  const o = opts || {}
  const now = Number(o.now) || Date.now()
  const kind = 候选.kind
  const 永不过期 = kind !== 'state'
  // ⭐ 2026-11-19 实测后改的（原先三种都落 event）：
  //   **梗不是经历**。经历的本质是「能回答什么时候」，而梗恰恰答不出 ——
  //   「大肥鱼」「疯狂星期四」是一直成立的约定，写进经历层等于让一条
  //   永远没有时间点的东西去挤「必须有具体时刻」的池子，自己跟自己的判据打架。
  //   而且实测（verify-recall-meme.mjs）：梗落 stable_profile 时，问
  //   「今天是疯狂星期四啊」C=0.67 召得回来；落 event 也召得回来，但
  //   stable_profile 这条路才有「长期约定」该有的语义。
  const 是梗 = kind === 'meme'
  return {
    id: 'ep' + now.toString(36) + Math.random().toString(36).slice(2, 7),
    text: 候选.text,
    at: new Date(o.发生时间 || now).toISOString(),
    createdAt: new Date(now).toISOString(),
    // ⚠ 命门一：event 默认落会话库，加 scope:'global' 才跨会话可见
    // ⚠ 命门二：stable_profile 只走「常驻事实」那条候选路（scoring.mjs 装填池），
    //   所以梗要能被召回，必须走 stable_profile 而不是事件池
    category: 是梗 ? 'stable_profile' : 'event',
    scope: 'global',
    episode: kind,
    // 梗压到 0.5：它要和真·画像抢 factsMax 那几个常驻名额，
    // 一个玩笑不该把「他攒钱想买我回家」这种条目挤出去
    importance: 是梗 ? Math.min(Number(候选.importance) || 0.5, 0.5) : 候选.importance,
    source: 'episode-extract',
    fromSession: o.会话id || null,
    ...(永不过期 ? {} : { expireAt: new Date(now + 状态保鲜天 * 86400000).toISOString() }),
    ...(o.工作区 ? { wsRoot: String(o.工作区) } : {}),
  }
}

/**
 * 对一段对话做一次提取。
 * @returns {Promise<{ok:boolean, 候选?:Array, message?:string}>}
 */
export async function 提取一次(ctx, agent, 对话文本) {
  const t = String(对话文本 || '').trim()
  if (t.length < 200) return { ok: false, message: '对话太短，不值得提取' }
  let r
  try {
    // ⭐ 2026-11-20：为什么不是 900 —— 实测 deepseek-flash 把 900 和 1800 的预算
    //   全花在 reasoning-delta 上（流里 900/1800 个思考块，正文 0 个），
    //   提取会静默变成「这段没有值得记的」。给足余量让思考跑完。
    r = await 问模型(ctx, agent, 提取系统, t, 8000)
  } catch (error) {
    return { ok: false, message: '调用失败：' + ((error && error.message) || error) }
  }
  if (!r || !r.ok) return { ok: false, message: (r && r.message) || '模型没回话' }
  const 候选 = 解析候选(r.text)
  // ⭐ 2026-11-20：模型返回空列表时，必须留下它的原话 —— 否则分不清是
  //   「模型觉得没东西可记」还是「它吐了非 JSON 被解析器丢掉了」。
  diag('  经历提取：模型回 ' + String(r.text || '').length + ' 字，解析出 ' + 候选.length + ' 条')
  if (!候选.length) diag('  经历提取：原始返回 → ' + String(r.text || '(空)').replace(/\s+/g, ' ').slice(0, 400))
  return { ok: true, 候选 }
}

/**
 * 该不该现在提取这个会话。
 * @param {{seq:number, 用户数:number}} 记 该会话的水位记录
 * @param {{最后活动:number, 现在:number, 最新seq:number, 新增用户数:number}} 环境
 */
export function 该提取(记, 环境) {
  const e = 环境 || {}
  const now = Number(e.现在) || Date.now()
  const 活动 = Number(e.最后活动) || 0
  if (!活动) return false
  if (now - 活动 < 空闲分钟 * 60000) return false
  if ((Number(e.最新seq) || 0) <= (Number(记 && 记.seq) || 0)) return false
  if ((Number(e.新增用户数) || 0) < 最少用户消息) return false
  return true
}
