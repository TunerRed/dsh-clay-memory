// lib/tools.mjs —— 工具构造器层：remember/forget/recall 三个宿主工具 + 会话身份/标题
// ============================================================================
// 2026-10-30 从 index.js 抽出（拆层工程第 8 批）。依赖方向：
//   paths(CFG_DIR)、time(dayKey/relTime)、names(userPronoun/selfNameOf/normalizeOwner/normalizePerson)、
//   store-core(loadStore/saveStore)、cfg(isEnabled/clampNum)、scoring(recall/render/归一键)、meter(textOfMessage)
// 注入槽：接定义工具(defineTool —— hostDeps 产物)、接报信(diag)
// ============================================================================
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CFG_DIR, 宿主数据根, 会话工作区, 规范化 } from './paths.mjs'
import { dayKey, relTime } from './time.mjs'
import { userPronoun, selfNameOf, normalizeOwner, normalizePerson } from './names.mjs'
import { loadStore, saveStore } from './store-core.mjs'
import { isEnabled } from './cfg.mjs'
import { recall, render, 归一键, 词集, 像度, 标作废, 按键收敛, 真重复门槛, 结算活跃度 } from './scoring.mjs'
import { textOfMessage } from './meter.mjs'
import { 自动扩词 } from './llm.mjs'
import { 读追溯 } from './trace-log.mjs'
import { 找最像, 像提示 } from './write-peek.mjs' // 写入可见（1.10.4）：「最像的那条」提示
import { 归性质, 该留原话, 拼证据 } from './nature.mjs' // 性质与证据原话（1.11.0 一期）
import { 标本回合记过 } from './candidates.mjs' // 候选钩子要知道「本回合记过没」
import { 语义开, 取向量 } from './embed.mjs' // 1.12.41：她 remember 进来的那条立刻算向量，不用等下一轮

let 定义工具 = null
export function 接定义工具(fn) { 定义工具 = fn }
let 报 = () => {}
export function 接报信(fn) { if (typeof fn === 'function') 报 = fn }
const diag = (msg) => { try { 报(msg) } catch { /* 日志失败不影响主流程 */ } }

// ---------- 会话身份 ----------
// Session 上到底哪个字段是 id，各家版本可能不同 —— 挨个试
function sessionIdOf(session) {
  if (!session) return ''
  for (const k of ['id', 'sessionId', 'key', 'sessionKey', 'sid']) {
    try {
      const v = session[k]
      if (typeof v === 'string' && v) return v
    } catch (error) {}
  }
  return ''
}

// 把一条消息的内容抽成文字

/**
 * 只有真正由人打出来的那条才算「用户消息」。
 *
 * ⚠️ 2026-11-11 真机实测踩到的坑：DSH 每一轮会往会话里塞好几条 role='user' 的消息 ——
 *   `runtime-context`（工作区/权限/沙箱那坨）、`skill-catalog`（<system-reminder> 技能目录）、
 *   `time-context`（Time sampled while preparing…），还有插件递的 `plugin:*`（主动开口的信号）。
 *   旧版只认 `type === 'user/message'`，于是「最近一条用户消息」永远是
 *   `Time sampled while preparing turn 1…` —— F12 存下来的「原话」全是系统文本
 *   （真机实测：3 条记忆 3 条原话全脏）✓
 *   宿主给真用户消息打的标记是 `source.kind === 'user'`，所以按 kind 过滤；老宿主无 source 时放行。
 */
function 是真人消息(payload) {
  const kind = payload && payload.source && payload.source.kind
  if (kind === undefined || kind === null || kind === '') return true
  return kind === 'user'
}

// 线索：从「这个 agent 自己的会话」里取最近一条用户消息 ✓
function lastUserTextOf(session) {
  try {
    if (!session || typeof session.snapshotEvents !== 'function') return ''
    const ev = session.snapshotEvents() || []
    for (let i = ev.length - 1; i >= 0; i--) {
      const e = ev[i]
      const type = e && (e.type || e.kind)
      if (type !== 'user/message') continue
      const p = e.payload !== undefined ? e.payload : e.data
      if (!是真人消息(p)) continue
      const txt = textOfMessage(p)
      if (txt) return txt
    }
  } catch (error) {}
  return ''
}


// ---------- remember 工具（她自己记）----------
// 时间戳用「系统当前时间」—— 这是这个工具存在的全部意义：
// 手写的时间会错（我今天编了两次），系统给的不会错 ✓

function sessionIdFromExec(exec) {
  try {
    const a = exec && (exec.agent || exec.caller || exec.agentRef)
    if (a && a.session) return sessionIdOf(a.session)
    if (a && typeof a === 'object') {
      for (const k of ['sessionId', 'id']) if (typeof a[k] === 'string') return a[k]
    }
  } catch (error) {}
  return ''
}

// ⭐ 2026-11-04 importance 与 category 解耦（需求总纲原则）：
//   重要性回答「多重要」，类型回答「是什么、怎么参与生命周期」，两者独立。
//   以前 category 由 imp>=1 隐式决定，导致「重要的一次性事件」被当成永久稳定事实。
//   现在改为：有显式类型就用；否则按长寿特征判定，判不出来就归事件（宁漏勿滥）。
function 判稳定事实(text) {
  const t = String(text || '')
  const 临时时间词 = /(今天|明天|后天|昨晚|刚刚|刚才|这次|那次|本周|这周|这个月)/
  // 长效指令：记住 / 以后都 / 永远 / 别再 / 一直 / 必须 …
  if (/(记住|以后都|以后每|永远|再也别|别再|一直|始终|必须|别忘)/.test(t) && !临时时间词.test(t)) return true
  // 关系 / 称呼 / 身份约定
  if (/(称呼|叫我|我是你的|你是我的|关系|身份)/.test(t)) return true
  // 长期偏好（没有临时时间词才算长期）
  if (/(喜欢|不喜欢|讨厌|偏好|习惯|爱玩|常玩|经常)/.test(t) && !临时时间词.test(t)) return true
  return false
}

function makeRememberTool(ctx) {
  return 定义工具({
    name: 'remember',
    description:
      '把一件事记进长期记忆（以后每轮都可能想起来）。' +
      '**一条只装一件事** —— 一件事 = 一个属性、一个约定、一次事件；' +
      '「她身高一米七、体重52.5、平时侧睡」是**三件事**，分三次记（或一次说清一条），别挤在一条里。' +
      '只记长期有价值的事：她明确说的重要的话、约定、她的喜好、她的状态（生病/很累/很开心）、你们之间发生的事。' +
      '不要记日常琐事（吃了什么、今天天气怎样）、不要记你自己做过的事、不要记重复的东西。' +
      '同一条一天最多记一次。**记的时候安静地记，不要在回复里说「记下了」「我记住了」这种话** —— 那很像在汇报工作。',
    parameters: {
      text: {
        type: 'string',
        required: true,
        description:
          '要记住的事，一句话说清。**人称**：你自己是「我」，用户是「' + userPronoun() + '」，' +
          '别人和别的 AI 直接写名字 —— 别把别人也写成「' + userPronoun() + '」。',
      },
      importance: {
        type: 'number',
        description:
          '0 = 随口提过；0.5 = 比较重要；1 = 非常重要（约定、关系、她的核心状态）。**别习惯性填 1**——重要性是区分度不是礼貌分；不确定就写 0.5 或不填（默认 0.5）。',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '几个关键词，方便以后被想起来（比如 ["睡觉","熬夜","约定"]）。',
      },
      // ⭐ 工作区上下文层（2026-11-04，需求 §3.2）：这条属于「当前项目」时填分类。
      //   填了就落工作区层（只在本项目可见），goal/stack/constraint 会常驻注入；
      //   progress/decision/todo 走按需召回。不填 = 普通记忆，行为不变。
      项目分类: {
        type: 'string',
        enum: ['goal', 'stack', 'constraint', 'progress', 'decision', 'todo'],
        description:
          '可选。这条讲的是**当前项目**的事时填分类（不填就是普通记忆）：' +
          '`goal` 项目目标 / `stack` 技术栈 / `constraint` 架构约束 / ' +
          '`progress` 任务进度 / `decision` 决策 / `todo` 待办。' +
          '前三个会一直出现在上下文里（最多 4 条），后三个只在该想起来时召回。' +
          '**项目私事别记成普通记忆** —— 普通的会跨工作区可见。',
      },
      // ⭐ 2026-11-04 importance/category 解耦：类型是独立维度，不再由 importance 推导。
      类型: {
        type: 'string',
        enum: ['stable', 'event'],
        description:
          '可选。这条记忆的类型：`stable` = 长期稳定（约定/关系/长期偏好，进全局事实库、不随时间淡忘）；' +
          '`event` = 一次性事件（进本次会话、会随时间淡忘）。不填按规则自动判断；' +
          '**重要性不等于稳定性** —— 今天发生了件大事，仍然是一次性事件。',
      },
      // ⭐ 1.11.0 一期：性质。决定这条能不能进事实池、渲染时要不要加短标签、要不要存原话。
      性质: {
        type: 'string',
        enum: ['fact', 'event', 'dream', 'fiction', 'hypothesis', 'process'],
        description:
          '可选。这条记忆**是什么性质**：`fact` 事实 / `event` 发生过的事 / `dream` 梦 / ' +
          '`fiction` 编的故事或虚构 / `hypothesis` 假设或「如果…」 / `process` 做过某事的过程（花了多久、怎么做的）。' +
          '不填会按词面规则判断（梦见→梦、编一个/假如→虚构/假设、花了…小时→过程），判不出来按事实处理。' +
          '**梦和假设一定要标**，不然以后会被当成真事想起来。',
      },
      // ⭐⭐ 2026-09-23：「过期条目标作废」的来源二 —— **只有它自己知道**的那部分 ✓
      //   像「拼团开了」更新「拼团还没开」，本地算法判不出来（两句话词面上不像），
      //   但它记的时候**心里清楚**这条是在更新哪条 → 顺手填一下就行，零额外开销 ✓
      取代: {
        type: 'string',
        description:
          '可选。如果这次记的**是在更新一件以前记过的事**（状态变了：还没→已经、暂时→现在能了、' +
          '第几晚→第几晚），把**旧那条**的大意或原文片段填这儿（比如「拼团还没开」）。' +
          '那条会标成「已被取代」—— 不再被想起来，但东西还留着、能撤销。' +
          '**不是在更新旧的就别填**（只是相关、是另一件事，填了会把好记忆埋掉）。',
      },
      // ⭐⭐ 2026-09-23（反馈第二点）：**事实键** —— 「同一个 key 只留最新一条」✓
      //   跟「取代」的区别：
      //     取代 = **这一次**在更新**那一条**（指认具体是谁）
      //     事实键 = 这条讲的是**哪件事**（不指认谁，但键一样就自动只留最新）
      //     两个都能用，不冲突 ✓
      事实键: {
        type: 'string',
        description:
          '可选。这条讲的是**哪一件事**，用「对象.方面」写，像 `她.身高`、`她.职业`、`约定.身边位置`。' +
          '**同一个键 = 同一件事** → 以后只留最新那条，旧的自动标「已被取代」（还留得住、能恢复）。' +
          '⚠ **键里不许写具体的值**：写 `她.身高`，不许写 `她.身高170` —— 写了值身高一变键就变，永远对不上。' +
          '⚠ **键要稳**（过一年还这么叫：`她.睡姿` ✓、`她.最近睡姿` ✗）。' +
          // ⚠⚠ 2026-09-24（真数据审出来的两处）——
          //   工具说明里也得写，不然「记的时候顺手填」这一路照样填歪 ✗
          '⚠⚠ **不许用「万能键」**：`…话.内容`、`…相关`、`…其他`、`…的事` 这种什么都能装的一个都不许用 —— ' +
          '那会把几句毫不相干的话归成一件、收起来好几条。' +
          '⚠⚠ **每天都会记的流水不许给键**（作息、吃了什么、当天做了什么）—— ' +
          '那些是一件一件的事，不是同一个值的不同版本；给了同一个键就等于把流水删到只剩最后一天。' +
          '口诀：**这个键是给「会变的那一个值」用的吗？** 是就给，不是就留空。' +
          '⚠ 一次性的、以后不会再变的（某天发生的事），**留空就好** —— 拿不准就别填，别硬编。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean' }, message: { type: 'string' } },
      },
      // 记成功了就一个 ✓，不多冒一句「记下了」✗
      //
      // ⚠⚠ 2026-09-21 修：原来写的是 `render()` —— 不接参数，所以**永远返回 ✓**，
      //    哪怕 execute 明确返回了 { ok: false }（比如「这个会话的记忆是关着的」）。
      //    实测就是这么被坑的：开关关着 → 实际跳过 → 界面照样打勾 →
      //    她以为记上了，去列表里翻半天找不到 ✗
      //    DSH 调用的是 render(exec.arguments, value)，value 就是 execute 的结果 ✓
      render(_args, value) {
        if (value && value.ok === false) {
          return [{ type: 'text', text: '✗ ' + String(value.message || '没记住') }]
        }
        return [{ type: 'text', text: '✓' }]   // 不能返回空 —— 空结果会让界面卡住 ✗
      },
    },
    async execute(args, exec) {
      const sid = sessionIdFromExec(exec)
      if (!sid) {
        diag('remember：拿不到会话 id（exec 的字段：' + (exec ? Object.keys(exec).join(',') : 'null') + '）')
        return { ok: false, message: '没记住（拿不到会话）' }
      }
      // 这个会话没开记忆 → 不记（关掉就是真的不想用）✓
      if (!isEnabled(sid)) {
        diag('remember：' + sid + ' 没开记忆，跳过')
        return { ok: false, message: '这个会话的记忆是关着的，先到设置里打开' }
      }
      const 原始 = String((args && args.text) || '').trim()
      // ⭐ 机械保证：她自己写成「小明」也换成「我」✓
      const text = normalizeOwner(normalizePerson(原始, selfNameOf(sid)), sid)
      if (!text) return { ok: false, message: '没记住（内容是空的）' }
      if (text !== 原始) diag('remember：人称换过了 →「' + text + '」')
      // ⭐ 1.10.3（F12）：顺手存一句「你说的话」当出处 —— 她记的是转述，原文得留住。
      //   口径：记这条的那一刻，这个会话里最近一条你说的话（截 300 字）。
      //   ⚠️ 只是「当时最近的一句」，不保证就是这件事的原始出处（她可能隔几轮才补记），
      //      界面上也按「你说」而不是「原文出处」来讲。
      const 原话 = lastUserTextOf(exec && exec.agent && exec.agent.session).trim().slice(0, 300)

      const data = loadStore(sid)
      const policy = data.policy
      const now = Date.now()

      // ⭐ importance/category 解耦：显式类型 > 长寿特征规则 > 默认事件
      //   ⚠ 必须在配额检查**之前**算：稳定事实不占日额度，不知道类型就没法判额度
      const 显式类型 = String((args && args.类型) || '').trim()
      let 稳定 = 显式类型 === 'stable' ? true : 显式类型 === 'event' ? false : 判稳定事实(text)
      // ⭐ 1.11.0 一期：性质（梦/虚构/假设/过程）永远不是「稳定事实」——
      //   梦不会因为像长期约定就被当成长久资料存着，它是记一次、答一次的东西。
      const 性质 = 归性质(text, args && args.性质)
      if (!显式类型 && 性质.nature && 性质.nature !== 'fact' && 性质.nature !== 'event') 稳定 = false

      // 配额（每天最多几条 —— 只数事件类；稳定事实一天也就一两条，还最该被记住，不该跟流水抢额度）
      const today = dayKey(now)
      const todayCount = data.memories.filter(
        (m) => m.createdAt && dayKey(Date.parse(m.createdAt)) === today && m.category !== 'stable_profile'
      ).length
      if (!稳定 && todayCount >= policy.dailyQuota) {
        return { ok: false, message: '今天记满了（' + policy.dailyQuota + ' 条事件），明天再说。稳定的事还能记。' }
      }

      // 去重：内容太像的不重复记 —— 但**强化**它（照 AAAAGENT）
      // 「她又提到这件事了」说明这件事还在她心里，该记得更牢一点 ✓
      // （注意：只有她真的又提一次才强化；光是召回想起来**不**强化 ——
      //   「仅浏览、搜索不会把记忆越看越重要」✓）
      const norm = (s) => String(s || '').replace(/[\s，。、！？,.!?]/g, '')
      const nt = norm(text)
      for (const m of data.memories) {
        const a = norm(m.text)
        if (a && (a === nt || (a.length > 8 && nt.length > 8 && (a.includes(nt) || nt.includes(a))))) {
          // ⭐ 1.12.18（F9 收尾）：**直接调公共结算函数**。
          //   以前这里手抄了一遍「旧A0 × 2^(-天数/H)」，还多两条特判（stable_profile 恒 1、
          //   「没时间又没锚」取常数）；注释早就写着「必须和 evaluate 用同一套规则」，
          //   但实现各写各的 —— 改个半衰期口径要改三处，还容易漂。
          //   两条特判没丢：它们以「选项」的形式保留下来 —— 写路径对长期事实固定 1、
          //   只认显式锚（不拿 createdAt 兜底），跟 1.12.17 及以前的行为完全一致。
          const 旧A = 结算活跃度(m, policy, now, { 稳定值: 1, 只认显式锚: true })
          const 新A = 旧A + 0.2 * (1 - 旧A) // ⭐ A' = A + 0.2(1-A)
          m.activation0 = Math.max(0, Math.min(1, 新A))
          m.activationAnchor = new Date(now).toISOString()
          m.reinforcedAt = new Date(now).toISOString()
          m.lastReinforcedDay = dayKey(now)
          m.reinforceCount = (typeof m.reinforceCount === 'number' ? m.reinforceCount : 0) + 1
          saveStore(sid, data)
          // 1.12.41：向量跟着补一下（这条的原话/标签可能刚变过）
          if (语义开()) { try { 取向量(data.memories, CFG_DIR).catch(() => {}) } catch (error) {} }
          diag('remember：这条记过了，强化一下 → 活跃度 ' + 旧A.toFixed(2) + ' → ' + m.activation0.toFixed(2))
          return { ok: true, message: '这条记过了，已经把它记得更牢一点（第 ' + m.reinforceCount + ' 次）。' }
        }
      }

      const imp = typeof args.importance === 'number' ? Math.max(0, Math.min(1, args.importance)) : 0.5
      const 新id = 'm' + now.toString(36) + Math.floor(Math.random() * 1000)

      // ⭐⭐ 2026-09-23：**过期条目标作废** —— 两个来源 ✓
      //
      //   来源一：**本地自动** —— 新记的这条如果跟旧的「几乎一样」，旧的作废。
      //     这就是反馈里说的「同一个 key 只留最新一条」。
      //     ⚠ 口径用**词像度 ≥0.85 而且长短差不多** —— 跟查重的「真重复」同一档；
      //       实测那一档 31 组逐组人眼核过，**没有一组是误合** ✓
      //       比这更松的不敢自动标：标错了会**悄悄**让一条正经记忆不再被想起来 ✗
      //   来源二：**AI 自己说** —— 它调 remember 时填了「取代」。
      //     像「拼团开了」更新「拼团还没开」这种，**只有它自己知道**，本地判不出来 ✓
      const 作废的 = []
      try {
        const 新词集 = 词集(text)
        for (const m of data.memories) {
          if (m.已被取代) continue
          const 像 = 像度(新词集, 词集(String(m.text || '')))
          if (像 < 真重复门槛) continue
          const 长比 =
            Math.min(text.length, String(m.text || '').length) / Math.max(text.length, String(m.text || '').length)
          if (长比 < 0.8) continue
          if (标作废(m, 新id, '跟新记的几乎一样')) 作废的.push(String(m.id))
        }
      } catch (error) {}
      // 来源二：它明确说了「这条取代了那条」
      if (args && args.取代) {
        const 指 = String(args.取代).trim()
        const 找 = norm(指)
        let 最好 = null
        let 最好像 = 0
        for (const m of data.memories) {
          if (m.已被取代) continue
          if (String(m.id) === 指) {
            最好 = m
            最好像 = 1
            break
          }
          const a = norm(m.text)
          // 2026-11-22：原来只要任一方是另一方的子串就直接认成同一条 —— 记忆写长一点，
          //   里面随口带一句「取代了 XXX」，整条长记忆就被当目标标作废了。
          //   子串命中必须「长度相当」才算数；不然就交给下面的 像度 慢慢比。
          if (a && 找 && (a === 找 || (a.length > 6 && 找.length > 6 && 相当(找, a) && (a.includes(找) || 找.includes(a))))) {
            最好 = m
            最好像 = 1
            break
          }
          const 像 = 像度(词集(指), 词集(String(m.text || '')))
          if (像 > 最好像) {
            最好像 = 像
            最好 = m
          }
        }
        // ⚠ 门槛 0.5：它给的是「大意」不是原文，太严会找不到；
        //   太低又会误伤不相干的 —— 0.5 是「同一件事」的下限（跟查重候选 0.75 同量级但更松）
        if (最好 && 最好像 >= 0.5 && 标作废(最好, 新id, '新记的这条说它取代了它')) 作废的.push(String(最好.id))
      }
      // ⭐⭐ 2026-09-23（反馈第二点）：**事实键** —— 它填了就收下 ✓
      //   收下之后**先只挂在新条上**，等它进库了再统一收敛（见下面 按键收敛）
      const 键 = 归一键(args && args.事实键)

      // ⭐ 工作区上下文层（2026-11-04，需求 §3.2）：带了项目分类 → 落工作区库 + 带 ctx。
      //   写进工作区库靠 category === 'workspace'（saveStoreJSON 按它分层）；scope 记 cwd 根。
      const 项目分类名 = String((args && args.项目分类) || '').trim()
      const 分类白名单 = ['goal', 'stack', 'constraint', 'progress', 'decision', 'todo']
      const 用项目分类 = 分类白名单.includes(项目分类名) ? 项目分类名 : ''
      let 工区根 = ''
      if (用项目分类) {
        工区根 = 规范化(会话工作区(sid))
        if (!工区根) return { ok: false, message: '没记住（拿不到当前工作区，分类条目只能落工作区层）' }
      }


      // ⭐ 写入可见（1.10.4）：在 push 之前先看一眼「库里最像的那条」。
      //   ⚠ 必须在 push 前面：否则会拿新条自己跟自己比（像度 1 → 恒被过滤也算白算）
      //   ⚠ 排除这次已经被标作废的：那些马上就不算数了，拿它们提示等于指错人
      //   门槛 0.5~0.85 才有意义（≥0.85 上面已经自动作废，<0.5 太泛，喊狼来了）
      let 最像 = null
      try {
        最像 = 找最像(data.memories, text, 作废的)
      } catch (error) {}

      // ⭐ 1.11.0 一期：证据原话 —— fact / event 一律不存（结构上杜绝「有原话就被当成经历」）
      const 留话 = 该留原话({ nature: 性质.nature, text, 原话, 显式别记: /别记|不要记|别写下|不要写下来/.test(String(原话 || '')) })
      const 证据 = 拼证据({ 存: 留话.存, excerpt: 留话.excerpt, sid, now })

      data.memories.push({
        id: 新id,
        text: text,
        ...(性质.nature ? { nature: 性质.nature } : {}),
        ...(证据 ? { evidence: 证据 } : {}),
        at: new Date(now).toISOString(), // ⭐ 真实时间（系统给的）
        createdAt: new Date(now).toISOString(),
        category: 用项目分类 ? 'workspace' : 稳定 ? 'stable_profile' : 'event',
        importance: imp,
        ...(用项目分类 ? { ctx: 用项目分类, scope: 'workspace:' + 工区根 } : {}),
        emotion: null,
        tags: Array.isArray(args.tags) ? args.tags.slice(0, 6).map(String) : [],
        source: '她自己记的',
        ...(原话 ? { 原话 } : {}),
        reinforcedAt: null,
        lastReinforcedDay: null,
        // ⭐ 事实键只在真给了的时候才写字段（没给就不留空字段，老数据长什么样它长什么样）✓
        ...(键 ? { 事实键: 键 } : {}),
      })
      // ⭐⭐ 同一个键只留最新那条 —— 新条**已经进库了**再收敛，
      //   这样「最新」的比较里包含它自己，一定留的是它 ✓
      //   （顺序很要紧：先 push 再收敛，反过来会把新条自己也算成旧的 ✗）
      if (键) {
        try {
          for (const id of 按键收敛(data, 新id)) if (作废的.indexOf(id) < 0) 作废的.push(id)
        } catch (error) {}
      }
      saveStore(sid, data)
      // 1.12.41：她刚记的这条也要有向量 —— 不然同一轮里想起来的还是「老库」的语义。
      //   异步、失败静默：绝不能让向量化拖慢或打断记账本身。
      if (语义开()) { try { 取向量(data.memories, CFG_DIR).catch(() => {}) } catch (error) {} }
      try { 标本回合记过(sid) } catch (error) {}
      diag('remember：' + sid + ' 记了「' + text.slice(0, 40) + '」' + (键 ? '（事实键 ' + 键 + '）' : '') + '（今天第 ' + (todayCount + 1) + ' 条）')
      // ⭐ 自动补「检索词」：以前得她去设置页点「开始扩词」，现在记完就顺手补上
      //    ⚠️ 不 await（模型调用要几秒，不能卡住记账）；但**必须 .catch** ——
      //      裸的 rejected promise 会被 Node 当致命错误，整个宿主退出（今天早上刚踩过）
      try {
        Promise.resolve()
          .then(() => 自动扩词(ctx, sid, 2))
          .catch((error) => diag('自动扩词失败：' + ((error && error.message) || error)))
      } catch (error) {}
      if (作废的.length) diag('remember：顺手把 ' + 作废的.length + ' 条旧的标成「已被取代」：' + 作废的.join(','))
      // ⭐ 1.12.51（写入端收长度）：在**记账这一刻**提醒，而不是等注入时截断 ——
      //   此刻手里有完整上下文，能判断「该拆两条」还是「这条就该这么长」；
      //   等到了注入阶段再动刀，等于让一个不知道上下文的人替她决定砍哪半句。
      const 长度提醒 = (() => {
        const 线 = Number(policy && policy.写入长度提醒)
        if (!Number.isFinite(线) || 线 <= 0) return ''
        const n = Array.from(text).length // 按码点算，emoji 不会算成两个
        if (n <= 线) return ''
        return (
          '（这条 ' + n + ' 字，比提醒线 ' + 线 + ' 字长 —— 长笔记在每轮注入时会整条占预算，' +
          '考虑拆成两条、或者把结论压到前面；不拆也行，库里照样存全条）'
        )
      })()
      return {
        ok: true,
        message:
          '记下了（' + relTime(now, now) + '）。' +
          (作废的.length ? '顺手把 ' + 作废的.length + ' 条被这条取代的旧记忆标成「已被取代」（不再想起来，东西还留着）。' : '') +
          // ⭐ 写入可见：没自动合并的「像但不够像」，只提一句，判断权交回给它自己
          //   （作废的已经说了就不要同时念叨「跟某某有点像」，读者会晕）
          (作废的.length ? '' : 像提示(最像)) +
          长度提醒,
      }
    },
  })
}

// 会话名字（DSH 给每个会话起的标题）
//
// ⭐ 2026-10-28（用户反馈：「列表里全是 session-id，DSH 里搜不到，也不知道对应哪个」）：
//   `ctx.sessionTitle.get()` 只对**已加载**的会话有效 —— 一个没打开的会话，
//   `ctx.sessions.get(sid)` 就是 undefined，标题直接空 → 前端只能退化成短 id ✗
//   补救：直接去 DSH 存会话投影的地方读标题
//   （`<DSH_HOME>/storages/session_projcache/sessions/<sid>.json` 的 `record.rows.title.val`，
//   就是会话列表上显示的那个名字）。两种来源都拿不到才返回空串（前端再退化成短 id）。
const 标题文件候选 = (sid) => [
  join(宿主数据根(), 'session_projcache', 'sessions', sid + '.json'),
  join(宿主数据根(), 'sessions', sid + '.json'),
  join(CFG_DIR, 'sessions', sid + '.json'),
]


// ⭐⭐ B 轮 F3（2026-10-29）：**忘掉** —— 用户说「忘掉这个」「别记这个了」时，
//   她自己就能删，不用让用户去设置页翻半分钟。
//   删之前必须说清删的是哪条（模型自己核对一遍再调），不然删错一条比没删更糟。
//   走的是现成的墓碑机制：进 data.deleted，设置页「已删」里还能找回来 ✓
function makeForgetTool(ctx) {
  return 定义工具({
    name: 'forget',
    description:
      '忘掉一条记忆。用户说「忘掉这个」「别记这个了」「这个不对」时用。' +
      '**只删一条**：给片段就按关键词找（会挑最像的那条），给 id 就直接删。' +
      '删之前先想清楚是哪条 —— 在回复里说一句「我把「…」那条忘了」，别默默删。' +
      '删掉不是销毁：进「已删」，用户还能找回来。',
    parameters: {
      text: {
        type: 'string',
        description: '要忘掉的那条记忆里的一段原文（挑几个词就够，越具体越准）。',
      },
      id: {
        type: 'string',
        description: '可选。知道记忆 id 就直接给（比 text 准）。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean' }, message: { type: 'string' } },
      },
      render(_args, value) {
        if (value && value.ok === false) return [{ type: 'text', text: '✗ ' + String(value.message || '没删掉') }]
        return [{ type: 'text', text: '✓ ' + String((value && value.message) || '') }]
      },
    },
    async execute(args, exec) {
      const sid = sessionIdFromExec(exec)
      if (!sid) return { ok: false, message: '拿不到会话' }
      if (!isEnabled(sid)) return { ok: false, message: '这个会话的记忆是关着的' }
      const 要 = String((args && args.id) || '').trim()
      const 片段 = String((args && args.text) || '').trim()
      if (!要 && !片段) return { ok: false, message: '没说忘掉哪条' }

      const data = loadStore(sid)
      const 们 = data.memories || []
      let 目标 = null
      if (要) 目标 = 们.find((m) => String(m.id) === 要) || null
      if (!目标 && 片段) {
        const 命中 = 们.filter((m) => String(m.text || '').includes(片段))
        if (命中.length === 1) 目标 = 命中[0]
        else if (命中.length > 1) {
          // 多条命中：挑**最新**那条（用户多半在说刚聊的），并告诉她还有别的
          const 排 = 命中.slice().sort((a, b) => Date.parse(b.at || b.createdAt || 0) - Date.parse(a.at || a.createdAt || 0))
          目标 = 排[0]
          diag('forget：片段「' + 片段 + '」命中 ' + 命中.length + ' 条，删最新那条')
        }
      }
      if (!目标) return { ok: false, message: '没找到要忘的那条（要不要说得再具体一点？）' }

      const 文 = String(目标.text || '').slice(0, 40)
      data.memories = 们.filter((m) => m !== 目标)
      data.deleted = [...(data.deleted || []), { ...目标, deletedAt: new Date().toISOString(), 删因: 'forget 工具' }]
      saveStore(sid, data)
      diag('forget：删了「' + 文 + '」(' + 目标.id + ')')
      return { ok: true, message: '忘了「' + 文 + '」—— 在设置「会话 → 已删」里还能找回来' }
    },
  })
}

// ⭐⭐ B 轮 F11（2026-10-29）：**你记得我什么** —— 用户当场问起，
//   她能自己翻一遍再答，而不是「我先去设置里看看」。
//   只读：不写库、不动 trace。
function makeRecallTool(ctx) {
  return 定义工具({
    name: 'recall',
    description:
      '当场翻一遍你的记忆库，用来回答「你记得我什么」「你还记得…吗」这类问题。' +
      '可以按关键词筛（给一句话也行：整串找不到会按空格拆词、按命中词数排），' +
      '也可以看全部（最多列 40 条）。**只读**，不改任何东西。' +
      '用它比凭印象瞎猜好 —— 记得就记得，不记得就老实说不记得，别编。',
    parameters: {
      query: {
        type: 'string',
        description: '可选。关键词（比如「睡觉」「吃饭」「约定」）；不填就列最近的一批。',
      },
      only: {
        type: 'string',
        description: '可选。只看哪一类：global = 全局记忆 / session = 指定会话 / all（默认）。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          message: { type: 'string' },
          items: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render(_args, value) {
        if (value && value.ok === false) return [{ type: 'text', text: '✗ ' + String(value.message || '') }]
        const 条 = (value && value.items) || []
        if (!条.length) return [{ type: 'text', text: '（没有记着的）' }]
        return [{ type: 'text', text: 条.map((m) => '- ' + m.text).join(String.fromCharCode(10)) }]
      },
    },
    async execute(args, exec) {
      const sid = sessionIdFromExec(exec)
      if (!sid) return { ok: false, message: '拿不到会话' }
      const q = String((args && args.query) || '').trim()
      const only = String((args && args.only) || 'all')
      const data = loadStore(sid)
      let 们 = data.memories || []
      if (only === 'global') 们 = 们.filter((m) => m.category === 'stable_profile')
      else if (only === 'session') 们 = 们.filter((m) => m.category !== 'stable_profile')
      // ⭐ 2026-11-15：整串优先，不中再拆词兜底。
      //   原来只有一句整串 includes —— 「fish-memory-dev 开发仓库 装机副本」这种把三个词
      //   连起来问的，一个字都不命中（三个词单独都在，连着就不在）。
      //   recall 的定位是「列给我看」，宁多勿漏，所以兜底按**任一命中**，
      //   再按「命中几个词」排前面；单词查询的路径一个字没变。
      let 词权重 = new Map()
      if (q) {
        const 整串 = 们.filter((m) => String(m.text || '').includes(q))
        if (整串.length) {
          们 = 整串
        } else {
          const 词们 = q.split(/\s+/).filter(Boolean)
          if (词们.length > 1) {
            const 中 = []
            for (const m of 们) {
              const t = String(m.text || '')
              let n = 0
              for (const w of 词们) if (t.includes(w)) n++
              if (n) {
                中.push(m)
                词权重.set(m, n)
              }
            }
            们 = 中
          } else {
            们 = []
          }
        }
      }
      const 排 = 们.slice().sort((a, b) => {
        // 拆词兜底时命中词多的排前面（整串命中时大家都是 0，不影响原排序）
        const wa = 词权重.get(a) || 0
        const wb = 词权重.get(b) || 0
        if (wb !== wa) return wb - wa
        const ia = typeof a.importance === 'number' ? a.importance : 0
        const ib = typeof b.importance === 'number' ? b.importance : 0
        if (ib !== ia) return ib - ia
        return Date.parse(b.at || b.createdAt || 0) - Date.parse(a.at || a.createdAt || 0)
      })
      const items = 排.slice(0, 40).map((m) => ({
        id: m.id,
        text: m.text,
        at: m.at || m.createdAt || '',
        importance: m.importance,
        scope: m.category === 'stable_profile' ? 'global' : 'session',
      }))
      return { ok: true, message: '共有 ' + 们.length + ' 条，列最重/最新的 ' + items.length + ' 条', items }
    },
  })
}

// ⭐⭐ 2026-11-04（需求 §5 可追溯 / §9 可观测）：**trace** —— 一条记忆的来龙去脉。
//   用户问「你还记得这个？哪来的？」「这条是啥时候记的」「为什么没想起来」时，
//   她自己能翻出来：哪来的、什么时候、被强化过几次、有没有被取代/别记、
//   最近几轮被想起来（当时的 C/P 分数）。只读：不动库、不改 trace。
function makeTraceTool(ctx) {
  return 定义工具({
    name: 'trace',
    description:
      '查一条记忆的来龙去脉：哪来的、什么时候记的、被强化过几次、' +
      '有没有被标「已被取代」或「别记」、最近哪几轮被想起来（当时的相关度分数）。' +
      '用户问「你怎么记得这个」「这条是啥时候记的」「为什么没想起来」时用。**只读**，不改任何东西。',
    parameters: {
      id: { type: 'string', description: '记忆 id（知道就直接给，最准）' },
      text: { type: 'string', description: '可选。记得片段但没记 id 时给几个词（越具体越准）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          message: { type: 'string' },
          detail: { type: 'object', additionalProperties: true },
        },
      },
      render(_args, value) {
        if (value && value.ok === false) return [{ type: 'text', text: '✗ ' + String(value.message || '') }]
        return [{ type: 'text', text: String((value && value.message) || '') }]
      },
    },
    async execute(args, exec) {
      const sid = sessionIdFromExec(exec)
      if (!sid) return { ok: false, message: '拿不到会话' }
      const 要 = String((args && args.id) || '').trim()
      const 片段 = String((args && args.text) || '').trim()
      if (!要 && !片段) return { ok: false, message: '要给 id 或片段' }

      const data = loadStore(sid)
      const 们 = data.memories || []
      let 目标 = null
      if (要) 目标 = 们.find((m) => String(m.id) === String(要)) || null
      if (!目标 && 片段) {
        const 命中 = 们.filter((m) => String(m.text || '').includes(片段))
        if (命中.length) {
          const 排 = 命中.slice().sort((a, b) => Date.parse(b.at || b.createdAt || 0) - Date.parse(a.at || a.createdAt || 0))
          目标 = 排[0]
        }
      }
      if (!目标) return { ok: false, message: '没找到这条记忆（被删了？还是片段不够具体？）' }

      // 召回记录：这个会话里它被带上过哪几轮（.traces.jsonl 只存最近 30 轮）
      const 召 = []
      try {
        for (const tr of 读追溯(sid, 200)) {
          for (const row of (tr && tr.rows) || []) {
            if (String(row.id) !== String(目标.id)) continue
            召.push({
              at: tr.at || '',
              query: String(tr.query || '').slice(0, 60),
              picked: Array.isArray(tr.picked) && tr.picked.indexOf(目标.id) >= 0,
              C: row.C,
              P: row.P,
            })
          }
        }
      } catch (error) {}

      const 类 = 目标.category === 'stable_profile' ? '全局' : 目标.category === 'workspace' ? '工作区' : '会话'
      const 行 = []
      行.push('「' + String(目标.text || '').slice(0, 80) + '」')
      行.push('id ' + 目标.id + ' ｜ ' + 类 + (目标.ctx ? '（' + 目标.ctx + '）' : '') + ' ｜ 重要性 ' + (typeof 目标.importance === 'number' ? 目标.importance : '未标'))
      行.push('记于 ' + String(目标.at || 目标.createdAt || '未知') + (目标.source ? ' ｜ 来源：' + String(目标.source) : ''))
      if (typeof 目标.reinforceCount === 'number' && 目标.reinforceCount > 0) {
        行.push('被强化 ' + 目标.reinforceCount + ' 次（最近 ' + String(目标.reinforcedAt || '未知') + '）')
      }
      if (目标.事实键) 行.push('事实键：' + String(目标.事实键))
      if (目标.已被取代) {
        行.push('已被取代：' + String((目标.已被取代 && 目标.已被取代.为什么) || '') + '（作废于 ' + String((目标.已被取代 && 目标.已被取代.作废于) || '未知') + '）')
      } else if (!目标.别记) {
        行.push('状态：正常参与召回')
      }
      if (目标.别记) 行.push('已标别记：' + String((目标.别记 && 目标.别记.原因) || '') + '（' + String((目标.别记 && 目标.别记.at) || '') + '）')
      if (召.length) {
        行.push('最近被想起来 ' + 召.length + ' 轮：')
        for (const r of 召.slice(-6)) {
          行.push('  ' + String(r.at) + ' 问「' + r.query + '」→ ' + (r.picked ? '选入' : '进了候选') + '（C ' + r.C + ' / P ' + r.P + '）')
        }
      } else {
        行.push('这个会话里还没被想起来过')
      }
      return {
        ok: true,
        message: 行.join(String.fromCharCode(10)),
        detail: {
          id: 目标.id,
          text: 目标.text,
          category: 目标.category,
          importance: 目标.importance,
          at: 目标.at || 目标.createdAt,
          source: 目标.source,
          已被取代: 目标.已被取代 || null,
          别记: 目标.别记 || null,
          强化次数: 目标.reinforceCount || 0,
          召回轮次: 召.length,
        },
      }
    },
  })
}

// ⭐⭐ 2026-11-04（需求 §5 删除/禁止）：**suppress** —— 把一条记忆标成「别记」。
//   用户说「这条不对」「别用这个」时用。以前只能在设置页点，现在她自己就能标。
//   标了就不再注入（index.js 注入前 filter 掉了），但**东西留着**、能撤销。
function makeSuppressTool(ctx) {
  return 定义工具({
    name: 'suppress',
    description:
      '把一条记忆标成「别记」——以后不再注入它，但东西留着、能撤销。' +
      '用户说「这条不对」「这个别用」「记错了」时用。只标一条。',
    parameters: {
      text: { type: 'string', description: '那条记忆里的一段原文（挑几个词就够）。' },
      id: { type: 'string', description: '可选。知道 id 就直接给（比 text 准）。' },
      reason: { type: 'string', description: '可选。为什么别记（比如「这条过时了」「记错了」）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean' }, message: { type: 'string' } },
      },
      render(_args, value) {
        if (value && value.ok === false) return [{ type: 'text', text: '✗ ' + String(value.message || '') }]
        return [{ type: 'text', text: '✓ ' + String((value && value.message) || '') }]
      },
    },
    async execute(args, exec) {
      const sid = sessionIdFromExec(exec)
      if (!sid) return { ok: false, message: '拿不到会话' }
      if (!isEnabled(sid)) return { ok: false, message: '这个会话的记忆是关着的' }
      const 要 = String((args && args.id) || '').trim()
      const 片段 = String((args && args.text) || '').trim()
      if (!要 && !片段) return { ok: false, message: '没说标哪条' }

      const data = loadStore(sid)
      const 们 = data.memories || []
      let 目标 = null
      if (要) 目标 = 们.find((m) => String(m.id) === String(要)) || null
      if (!目标 && 片段) {
        const 命中 = 们.filter((m) => String(m.text || '').includes(片段))
        if (命中.length) {
          const 排 = 命中.slice().sort((a, b) => Date.parse(b.at || b.createdAt || 0) - Date.parse(a.at || a.createdAt || 0))
          目标 = 排[0]
        }
      }
      if (!目标) return { ok: false, message: '没找到要标的那条（说得再具体一点？）' }
      if (目标.别记) return { ok: true, message: '这条之前就标过别记了（' + String((目标.别记 && 目标.别记.原因) || '') + '）' }

      目标.别记 = { at: new Date().toISOString(), 原因: String((args && args.reason) || '用户说这条不对').slice(0, 200) }
      saveStore(sid, data)
      diag('suppress：标了别记「' + String(目标.text || '').slice(0, 40) + '」(' + 目标.id + ')')
      return { ok: true, message: '标了「别记」：' + String(目标.text || '').slice(0, 40) + ' —— 以后不再注入它，东西还在，能撤销' }
    },
  })
}

// ⭐⭐ 1.12.28（F10 阶段 1 的兜底件）：**memory_search** —— 知识按需检索。
//   记忆块只有 800 字，技术笔记一旦不常驻，模型就得有路自己去找。
//   和 recall 的区别：recall 是「列给我看」（子串筛 + 按重量排），search 是「按这句话找对得上的」
//   —— 切词、算覆盖率、按相关度排，并且明确区分「知识」和「画像」。
function makeSearchTool(ctx) {
  return 定义工具({
    name: 'memory_search',
    description:
      '按相关度搜记忆库 —— 不是列全部，是按你这句话找对得上的那几条。' +
      '技术笔记、环境约定、排错记录这类「知识」不在每轮提示词里，要查具体怎么做、当时怎么配的就用这个。' +
      '**只读**，不改任何东西。',
    parameters: {
      query: { type: 'string', description: '要查的内容，一句话或几个关键词都行。' },
      kind: {
        type: 'string',
        description: '可选。any（默认）/ knowledge（只看技术知识）/ profile（只看关于人的画像）。',
      },
      limit: { type: 'number', description: '可选。最多返回几条，默认 8，最多 30。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          message: { type: 'string' },
          items: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render(_args, value) {
        if (value && value.ok === false) return [{ type: 'text', text: '✗ ' + String(value.message || '') }]
        const 条 = (value && value.items) || []
        if (!条.length) return [{ type: 'text', text: '（没有对得上的）' }]
        return [
          {
            type: 'text',
            text: 条
              .map((m) => '- [' + (m.kind === 'knowledge' ? '知识' : '画像') + '] ' + String(m.text || ''))
              .join(String.fromCharCode(10)),
          },
        ]
      },
    },
    async execute(args, exec) {
      const sid = sessionIdFromExec(exec)
      if (!sid) return { ok: false, message: '拿不到会话' }
      const q = String((args && args.query) || '').trim()
      if (!q) return { ok: false, message: '给一句要查的内容' }
      // 问句里的虚词不参与匹配：「主人喜欢吃什么」如果带着「什么」，几乎每条都能撞上
      const 虚词 = new Set([
        '怎么', '什么', '如何', '为什么', '哪里', '哪些', '哪个', '可以', '一下', '我的', '你的',
        '是不', '不是', '有没有', '请问', '告诉', '帮我', '这个', '那个', '现在', '然后', '还是',
        '就是', '因为', '所以', '如果', '但是', '我还', '你还', '记得', '知道', '一个', '这样', '那样',
      ])
      let q词 = 词集(q)
      const 实词 = new Set()
      for (const w of q词) if (!虚词.has(w)) 实词.add(w)
      // 多字实词够两个时丢掉单字（「满」「吃」这类单字噪声太大）；
      // 只有单字时才留着 —— 否则「吃」这种一两个字的查询会直接查不到东西
      const 多字 = new Set([...实词].filter((w) => String(w).length > 1))
      if (多字.size >= 2) q词 = 多字
      else if (实词.size) q词 = 实词
      if (!q词.size) return { ok: false, message: '这句里没有能查的词' }
      const 条数 = Math.max(1, Math.min(30, Math.floor(Number((args && args.limit) || 8)) || 8))
      const kind = String((args && args.kind) || 'any')
      const data = loadStore(sid)
      let 们 = (data.memories || []).filter((m) => !m.已被取代 && !m.refinedSkip && !m.别记)
      if (kind === 'knowledge') 们 = 们.filter((m) => m.is_knowledge === true)
      else if (kind === 'profile') 们 = 们.filter((m) => m.is_knowledge !== true)

      const 结果 = []
      for (const m of 们) {
        const t = String(m.text || '')
        if (!t) continue
        const t词 = 词集(t)
        let 交 = 0
        for (const w of q词) if (t词.has(w)) 交++
        if (!交) continue
        // 覆盖率为主、绝对命中词数为辅：短条目不该因为词少就吃亏，长条目也不该因为词多就霸榜
        const 覆盖 = 交 / q词.size
        const 分 = 覆盖 * 0.7 + Math.min(1, 交 / 6) * 0.3
        结果.push({ m, 分, 交 })
      }
      结果.sort((a, b) => {
        if (Math.abs(b.分 - a.分) > 0.0001) return b.分 - a.分
        const ia = Number(a.m.importance) || 0
        const ib = Number(b.m.importance) || 0
        if (ib !== ia) return ib - ia
        return Date.parse(b.m.at || b.m.createdAt || 0) - Date.parse(a.m.at || a.m.createdAt || 0)
      })
      const 取 = 结果.slice(0, 条数)
      return {
        ok: true,
        message: '「' + q + '」命中 ' + 结果.length + ' 条，取前 ' + 取.length + ' 条',
        items: 取.map((x) => ({
          id: x.m.id,
          text: x.m.text,
          at: x.m.at || x.m.createdAt || '',
          kind: x.m.is_knowledge === true ? 'knowledge' : 'profile',
          type: x.m.type || '',
          score: Math.round(x.分 * 100) / 100,
        })),
      }
    },
  })
}

function titleOfSession(ctx, sid) {
  if (!sid) return ''
  // ① 先问 DSH 要（会话已经加载时，这里最准、也是官方口径）
  try {
    const s = ctx.sessions.get(sid)
    if (s) {
      const snap = ctx.sessionTitle.get(s)
      const t = snap && snap.title ? String(snap.title).trim() : ''
      if (t) return t
    }
  } catch (error) {}
  // ② 会话没加载（或者标题服务没准备好）→ 去它的投影缓存文件里翻
  for (const p of 标题文件候选(sid)) {
    try {
      if (!existsSync(p)) continue
      const j = JSON.parse(readFileSync(p, 'utf8'))
      const 标题 =
        (j && j.record && j.record.rows && j.record.rows.title && j.record.rows.title.val) ||
        (j && j.title) ||
        ''
      const t = typeof 标题 === 'string' ? 标题.trim() : ''
      if (t) return t
    } catch (error) {}
  }
  return ''
}
// 2026-11-22：「取代」的子串命中必须长度相当 —— 长记忆里随口带一句短句，
//   原来整条会被当成「被取代的那条」标作废。长度差太大就交给 像度 慢慢比。
function 相当(a, b) {
  const 短 = Math.min(a.length, b.length)
  const 长 = Math.max(a.length, b.length)
  return 短 >= Math.max(6, Math.floor(长 * 0.7))
}

export { sessionIdOf, lastUserTextOf, sessionIdFromExec, makeRememberTool, makeForgetTool, makeRecallTool, makeSearchTool, makeTraceTool, makeSuppressTool, titleOfSession }
