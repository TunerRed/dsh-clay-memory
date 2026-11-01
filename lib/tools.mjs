// lib/tools.mjs —— 工具构造器层：remember/forget/recall 三个宿主工具 + 会话身份/标题
// ============================================================================
// 2026-10-30 从 index.js 抽出（拆层工程第 8 批）。依赖方向：
//   paths(CFG_DIR)、time(dayKey/relTime)、names(userPronoun/selfNameOf/normalizeOwner/normalizePerson)、
//   store-core(loadStore/saveStore)、cfg(isEnabled/clampNum)、scoring(recall/render/归一键)、meter(textOfMessage)
// 注入槽：接定义工具(defineTool —— hostDeps 产物)、接报信(diag)
// ============================================================================
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CFG_DIR, 宿主数据根 } from './paths.mjs'
import { dayKey, relTime } from './time.mjs'
import { userPronoun, selfNameOf, normalizeOwner, normalizePerson } from './names.mjs'
import { loadStore, saveStore } from './store-core.mjs'
import { isEnabled, clampNum } from './cfg.mjs'
import { recall, render, 归一键, 词集, 像度, 标作废, 按键收敛, 真重复门槛 } from './scoring.mjs'
import { textOfMessage } from './meter.mjs'
import { 自动扩词 } from './llm.mjs'

let 定义工具 = null
export function 接定义工具(fn) { 定义工具 = fn }
let 报 = () => {}
export function 接报信(fn) { if (typeof fn === 'function') 报 = fn }
const diag = (msg) => { try { 报(msg) } catch { /* 日志失败不影响主流程 */ } }
const DAY = 86400000 // 从 index.js 随段搬来（原 :65）

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
        description: '0 = 随口提过；0.5 = 比较重要；1 = 非常重要（约定、关系、她的核心状态）。不确定就写 0.5。',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '几个关键词，方便以后被想起来（比如 ["睡觉","熬夜","约定"]）。',
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

      const data = loadStore(sid)
      const policy = data.policy
      const now = Date.now()

      // 配额（每天最多几条，先宽松）
      const today = dayKey(now)
      const todayCount = data.memories.filter((m) => m.createdAt && dayKey(Date.parse(m.createdAt)) === today).length
      if (todayCount >= policy.dailyQuota) {
        return { ok: false, message: '今天记满了（' + policy.dailyQuota + ' 条），明天再说。' }
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
          const I0 = typeof m.importance === 'number' ? m.importance : 0
          const H0 = policy.baseHalfLifeDays * (1 + 2 * I0)
          const 旧锚 = m.activationAnchor ? Date.parse(m.activationAnchor) : m.at ? Date.parse(m.at) : now
          const 旧A0 = typeof m.activation0 === 'number' && isFinite(m.activation0) ? Math.max(0, Math.min(1, m.activation0)) : 1
          // ⚠ 这里必须和 evaluate 用**同一套规则**，否则「涨」的起点不对：
          //   没时间戳又还没锚的，起点是那个常数（她设 0.5 就从 0.5 往上涨）；
          //   以前只特判了 stable_profile，对它们算出 旧A=1 → 新A 还是 1 → 记了个寂寞 ✗
          const 没时间又没锚 = !m.at && !m.activationAnchor
          const 旧A = m.category === 'stable_profile'
            ? 1
            : 没时间又没锚
              ? clampNum(typeof policy.unknownActivation === 'number' ? policy.unknownActivation : 1, 0, 1)
              : 旧A0 * Math.pow(2, -Math.max(0, (now - 旧锚) / DAY) / H0)
          const 新A = 旧A + 0.2 * (1 - 旧A) // ⭐ A' = A + 0.2(1-A)
          m.activation0 = Math.max(0, Math.min(1, 新A))
          m.activationAnchor = new Date(now).toISOString()
          m.reinforcedAt = new Date(now).toISOString()
          m.lastReinforcedDay = dayKey(now)
          m.reinforceCount = (typeof m.reinforceCount === 'number' ? m.reinforceCount : 0) + 1
          saveStore(sid, data)
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
          if (a && 找 && (a === 找 || (a.length > 6 && 找.length > 6 && (a.includes(找) || 找.includes(a))))) {
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

      data.memories.push({
        id: 新id,
        text: text,
        at: new Date(now).toISOString(), // ⭐ 真实时间（系统给的）
        createdAt: new Date(now).toISOString(),
        category: imp >= 1 ? 'stable_profile' : 'event',
        importance: imp,
        emotion: null,
        tags: Array.isArray(args.tags) ? args.tags.slice(0, 6).map(String) : [],
        source: '她自己记的',
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
      return {
        ok: true,
        message:
          '记下了（' + relTime(now, now) + '）。' +
          (作废的.length ? '顺手把 ' + 作废的.length + ' 条被这条取代的旧记忆标成「已被取代」（不再想起来，东西还留着）。' : ''),
      }
    },
  })
}

// 会话名字（DSH 给每个会话起的标题）
//
// ⭐ 2026-10-28（主人反馈：「列表里全是 session-id，DSH 里搜不到，也不知道对应哪个」）：
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


// ⭐⭐ B 轮 F3（2026-10-29）：**忘掉** —— 主人说「忘掉这个」「别记这个了」时，
//   她自己就能删，不用让主人去设置页翻半分钟。
//   删之前必须说清删的是哪条（模型自己核对一遍再调），不然删错一条比没删更糟。
//   走的是现成的墓碑机制：进 data.deleted，设置页「已删」里还能找回来 ✓
function makeForgetTool(ctx) {
  return 定义工具({
    name: 'forget',
    description:
      '忘掉一条记忆。主人说「忘掉这个」「别记这个了」「这个不对」时用。' +
      '**只删一条**：给片段就按关键词找（会挑最像的那条），给 id 就直接删。' +
      '删之前先想清楚是哪条 —— 在回复里说一句「我把「…」那条忘了」，别默默删。' +
      '删掉不是销毁：进「已删」，主人还能找回来。',
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
          // 多条命中：挑**最新**那条（主人多半在说刚聊的），并告诉她还有别的
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

// ⭐⭐ B 轮 F11（2026-10-29）：**你记得我什么** —— 主人当场问起，
//   她能自己翻一遍再答，而不是「我先去设置里看看」。
//   只读：不写库、不动 trace。
function makeRecallTool(ctx) {
  return 定义工具({
    name: 'recall',
    description:
      '当场翻一遍你的记忆库，用来回答「你记得我什么」「你还记得…吗」这类问题。' +
      '可以按关键词筛，也可以看全部（最多列 40 条）。**只读**，不改任何东西。' +
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
      if (q) 们 = 们.filter((m) => String(m.text || '').includes(q))
      const 排 = 们.slice().sort((a, b) => {
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

export { sessionIdOf, lastUserTextOf, sessionIdFromExec, makeRememberTool, makeForgetTool, makeRecallTool, titleOfSession }
