// DSH 鱼的记忆 · 宿主半边（v0.2：按会话分开）
//
// 和 v0.1 的区别：
//   v0.1：所有会话共用一份记忆 + 一份线索  →  会串（我的记忆会跑到别的会话那边）
//   v0.2：**每个 agent（会话）挂它自己的一段记忆** —— 用 agent.ctx 注册，
//         所以天然知道「我是谁」，读自己的库、用自己的线索 ✓
//
// 干三件事：
//   1. 存   —— 每个会话一份会淡忘的长期记忆（memory\<会话id>.json）
//   2. 取   —— 用「它自己会话里最近一句用户消息」当线索，按 P = C×(基础+鲜活+重要+情绪) 选几条
//   3. 注   —— 注入到它自己的系统提示词里，**每条都带时间**

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, rmSync, statSync, renameSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createSelfUpdate } from './selfupdate.mjs'
import { 合并库 } from './store-merge.mjs'
import { writeFileAtomicSync } from './atomic-file.mjs'
import { 读SQL视图, 读SQL视图同步, 准备SQLite同步, 取SQLite模块, 比对视图, 库文件路径, 确保镜像表, 记镜像有货, 镜像主键是新模型, 重建镜像表 } from './storage.js'
import { 事件本趟上限 } from './recall-cap.mjs'
import { 鲜活度, 标作废, 归一键, 是万能键, 按键收敛, 词集, 像度, 重复门槛, 真重复门槛, recall, 用上了, render, render项目上下文, 原话兜底 } from './scoring.mjs'
import { 找线索, 加候选, 本回合记过没 } from './candidates.mjs' // 候选钩子（1.11.0 §4.8）
import { 该自动收, 拆片段, 撞旧条, 自动重要度, 细节重要度, 性质重要度, 细节每天上限 } from './auto-capture.mjs' // 自动入库（1.12.1：写入归代码，不等模型心情）
import { 记原话, 回捞原话 } from './span-index.mjs' // 原话索引（1.12.1：零命中时按词回捞，不再只翻 72h 内一条）
import { 整理一次, 归档最少条数 } from './archive-gate.mjs' // 归档闸门（1.12.0 一期决策二）
import { NOT_A_NAME, NAME_IS_DEFINED, normalizePerson, normalizePersonAs, 接读配置, 接标题, selfNameOf, titleNameOf, ownerNameOf, userPronoun, normalizeOwner, changeUserPronoun, 抠日期详, 抠日期, 猜重要度, 解析档案, archiveDir, 用户名字列表, 不是名字列表, 找她的称呼, 导入时改人称 } from './names.mjs' // 2026-10-30 拆层第4批：人称/档案导入/自动找称呼
接读配置(loadCfg) // loadCfg 是函数声明，模块级提升，这里可直接注入
接标题(titleOfSession) // titleOfSession 也是函数声明，可直接注入
// ⭐ 2026-10-20 修「漏依赖」：这两样原来是**裸 import**，而 package.json 里一个都没声明
//    ⇒ 在没装它们的机器上，整条插件 `failed to import` 不激活，DSH 会把 bundle 条目摘掉、页面 404。
//    现在改成跟 bili 那套一致：从**宿主那棵树**取 → 取不到用自己依赖 → 再取不到就用本地等价实现。
//    插件在任何情况下都能加载，功能按能拿到的降级。
import { loadHostDeps } from './hostdeps.mjs'
const hostDeps = await loadHostDeps()
const defineTool = hostDeps.defineTool
const createUserMessage = hostDeps.createUserMessage
// 把「从哪儿取到的」记进 diag.log —— 以后哪台机器上降级了，一眼看得出来
try { for (const n of (hostDeps.notes || [])) diag('hostdeps: ' + n) } catch (e) {}
// ⭐ 2026-09-22（她的第十件）：「从会话生成档案」那一块单独放一个文件 ——
//   整料 / 切批 / 拼提示词 / 出档案 都在里面，能单独测，不用全塞进这个 4300 行的文件
import * as 生成档案 from './archive-gen.js'
// ⭐ B 阶段（2026-10-30）：并发写回保护 —— await 问模型那几秒里的新增不许被快照盖掉
import { 代际一致, 中间被改过, 按明细恢复 } from './patch-apply.mjs'
import { 清理旧备份 } from './backup-rotate.mjs'
import { normalize, 中文片段, 装词表, 装词频, 通用稀有, 算线索, 正文价, 片价, 分词, tokenize, 接报信 } from './lexicon.mjs' // 2026-10-30 拆层第1批：词门
import { TZ_OFFSET, dayKey, relTime } from './time.mjs' // 2026-10-30 拆层第3a批：时间工具
import { 自检, 按轮去重 } from './selfcheck.mjs' // 1.10.5：自检摘要（纯函数，不吃宿主接口）；1.12.17 加按轮去重
接报信(diag)
import { textOfMessage, 扩词集, 切词, 词面, 记忆词集, 稀有表, 稀有度, 拿尺, 记一句话, 装搭配, 补历史尺, 问句信息量, 搭配集, 说话尺, 接诊断 } from './meter.mjs' // 2026-10-30 拆层第2批：说话尺/稀有表
接诊断(diag) // 说话尺/切词相关日志仍进诊断 // 词门装载成功/失败仍进诊断日志（diag 是函数声明，模块级提升可用）

export const name = 'memory'
export const inject = ['systemPrompt', 'agents', 'timer', 'tools', 'webServer', 'sessions', 'sessionTitle', 'llm']

import { CFG_DIR, STORE_DIR, BACKUP_DIR, CFG_PATH, FACTS_NAME, factPath, 是会话文件, storePath } from './paths.mjs' // 2026-10-30 拆层第5a批：路径层
import { 读骨架, render骨架, 骨架预算 } from './core-memory.mjs' // 2026-11-04 决议四：骨架层（_core.json）
import { 标回血 } from './reinforce.mjs' // F7（1.10.3）：注入时攒「这轮用上了」，写盘时落下去
import { DEFAULT_POLICY, POLICY_SPEC, clampNum, fitPolicy, 全局参数, 合并参数, loadCfg, saveCfg, globalOn, setGlobalOn, 是子代理, isEnabled, setEnabled, enabledList, migrateSwitch, 接报信 as 接cfg报, 接读库 as 接cfg读 } from './cfg.mjs' // 2026-10-30 拆层第5b批：配置层
import { tracePath, 读追溯, 标trace状态, 重写追溯, 追加trace, 接报信 as 接trace报 } from './trace-log.mjs' // 2026-10-30 拆层第6a批：召回记录
import { todayKey, memSig, 条签名, lastSig, 销毁前另存, backupFile, backupStore, 读批次表, 读暂停表, 暂停到, 设暂停, 记批次, 接报信 as 接备报 } from './backup.mjs' // 2026-10-30 拆层第6b批：备份/批次/暂停
import { blank, purgeEpochOf, 事实代际, corruptSnapshots, corruptIncidents, 读一份, 事实文, 读注入数据, loadStoreJSON, adoptTargetEpoch, backupCorruptStore, 读盘校验, 已清理错, 坟归事实, loadStore, saveStore, 镜像不可用, 同步SQL镜像, 全量回填镜像, saveStoreJSON, 滤掉推测, 接报信 as 接存报 } from './store-core.mjs' // 2026-10-30 拆层第6c批：核心读写层
import { sessionIdOf, lastUserTextOf, sessionIdFromExec, makeRememberTool, makeForgetTool, makeRecallTool, makeTraceTool, makeSuppressTool, titleOfSession, 接定义工具 as 接工具定义, 接报信 as 接工具报 } from './tools.mjs' // 2026-10-30 拆层第8批：工具构造器层
import { 挑选目录文件, 读挑选目录, 写挑选目录, 目录在, 当前工作区根, 工作区号, 归档名单, 已知会话ids, 分支来处Of, 是事实条, buildMemoryList, MEMORY_PAGE, 接报信 as 接ui报 } from './ui.mjs' // 2026-10-30 拆层第9批：展示层
import { 自动扩词, 问模型, 取模型, 选定模型, 取日期, 解析提炼, 解析扩词, 解析洗键, 提炼系统, 洗键系统, 扩词系统, 扩词系统_v2, 接造消息 as 接llm消息, 接报信 as 接llm报 } from './llm.mjs' // 2026-10-30 拆层第7批：LLM 层
import { 注册核心路由 } from './routes-core.mjs' // 2026-10-30 拆层第10批：核心读写路由（update/add/global/toggle/backfill/bench/mark-wrong/pause/undo-last）
import { 注册管理路由 } from './routes-admin.mjs' // 2026-10-30 拆层第10批：管理/导入路由（names/duplicates/delete/edit/import/dirs）
import { 注册生成路由 } from './routes-gen.mjs' // 2026-10-30 拆层第10批：生成/LLM 路由（models/gen/refine/wash-keys/copy-to/llm-check/expand/policy）
import { 注册回复体检路由 } from './reply-check/routes.js' // 2026-11-10：FuckAIWords 词面规则体检（从 dsh-persona-growth 搬来）
import { DIAG, diag } from './diag.mjs' // 2026-10-30 拆层第10批：诊断日志（DIAG 路径 + diag 写轮转日志）
接存报(diag) // 存储层日志仍进诊断（diag 是函数声明，模块级提升可用）
接备报(diag) // 备份层日志仍进诊断（diag 是函数声明，模块级提升可用）
接trace报(diag) // trace 日志仍进诊断（diag 是函数声明，模块级提升可用）
接cfg报(diag) // 配置层日志仍进诊断（diag 是函数声明，模块级提升可用）
接cfg读(loadStore) // migrateSwitch 用（loadStore 是函数声明，模块级提升可用）
接工具报(diag) // 工具层日志仍进诊断（diag 是函数声明，模块级提升可用）
接工具定义(defineTool) // 三个宿主工具用（hostDeps 产物）
接ui报(diag) // 展示层日志仍进诊断（diag 是函数声明，模块级提升可用）

// ⭐ F7（1.10.3）：trace 里的 turn / step —— 宿主钩子不给这两个号，只能自己合成。
//   turn = 这个会话里「你发的第几条消息」（数 snapshotEvents 里的 user/message）；
//   step = 同一轮里第几次注入（context 的 text() 一轮可能被求值好几次）。
const 轮步表 = new Map() // sid -> { turn, step }
// 1.12.17：自检按轮去重（同一条消息会走多个 step，每个 step 都 recall 一次）
const 自检轮 = 按轮去重()
function 记轮步(sid, session) {
  let turn = 0
  try {
    if (session && typeof session.snapshotEvents === 'function') {
      for (const e of session.snapshotEvents() || []) {
        const t = e && (e.type || e.kind)
        if (t === 'user/message') turn++
      }
    }
  } catch (error) {}
  const 前 = 轮步表.get(sid)
  const 真轮 = turn || (前 ? 前.turn : 0) || 1
  const step = 前 && 前.turn === 真轮 ? (前.step || 0) + 1 : 1
  轮步表.set(sid, { turn: 真轮, step })
  return { turn: 真轮, step }
}
接llm报(diag) // LLM 层日志仍进诊断（diag 是函数声明，模块级提升可用）
接llm消息(createUserMessage) // 问模型 用的消息构造器（hostDeps 产物）
const DAY = 86400000

// ---------- ⭐⭐ 1.4.0：双层库（全局事实 + 会话事件）----------
//
//   <DSH_HOME>/clay-memory/
//     _facts.json      ← 全局事实库（category === 'stable_profile'）· 跨工作区 / 跨会话共享
//     <sid>.json       ← 会话库（事件 + 召回记录 traces + 已删 deleted + 库级参数 policy）
//     *.json.bak / *.json.corrupt-<时间>  ← 备份按**文件**走，两份库各备各的
//
//   **为什么只分这两层**：真正「我是谁 / 偏好 / 约定」全在事实层（主库 525 条里 202 条
//   stable_profile、323 条 event）；事件跨工作区反而会串味 —— IM 群聊里的事流进代码工作区。
//
//   **为什么改这里就够**：上层（召回 / 注入 / 删除 / 导入 / 设置页 / copy-to）只经
//   loadStore / saveStore 两个口子碰存储 —— 分层就落在这一层，别处零改动。
//
//   ⚠ saveStore 依然**全同步**：Node 单线程里没有 await，多会话并发写全局库不会交错；
//     换个异步/加锁的写法反而会把这层保护拆掉（硬约束，别动）。

/** 读路由的 JSON body，带长度上限（架构师审查 #12：之前 40 处无上限的 for-await，
 *  本机任意进程 POST 一个超大 body 就能把内存撑爆）。 */
async function 读JSON体(req, 上限 = 64 * 1024) {
  let 文 = ''
  let 长 = 0
  for await (const chunk of req) {
    长 += chunk.length
    if (长 > 上限) throw new Error('body 太大')
    文 += chunk
  }
  if (!文) return {}
  try {
    const j = JSON.parse(文)
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {}
  } catch (error) {
    return {}
  }
}

// ⭐ C 轮 S2（2026-10-29）：影子只读比对
//
//   JSON 仍是唯一真相；这里只是偷偷用 SQLite 再读一遍同一个会话的视图，
//   和 JSON 视图逐条比 —— 全等就什么都不做，有差异就记一行 diag。
//   默认关（CLAY_SHADOW=1 才开），因为它纯属诊断，不能让它把正事拖慢或拖挂。
function 影子开() {
  return process.env.CLAY_SHADOW === '1'
}

function 影子比对(sid, json视图) {
  if (!影子开()) return
  try {
    const 库 = 库文件路径(STORE_DIR)
    if (!existsSync(库)) return
    读SQL视图(库, sid)
      .then((视图) => {
        if (!视图) {
          diag('影子：SQL 视图读不出来，跳过这次比对')
          return
        }
        const r = 比对视图(json视图, 视图)
        const 条 = (json视图.memories || []).length
        if (r.全等) diag('影子比对 ' + String(sid).slice(0, 12) + '：全等 ✓（' + 条 + ' 条）')
        else diag('影子比对 ' + String(sid).slice(0, 12) + '：差异 ' + r.差异.length + ' 处 → ' + r.差异.slice(0, 3).join('；'))
      })
      .catch(() => {})
  } catch (error) {}
}

/** 文件读写的白名单（架构师审查 #21-#24）：
 *  只允许落在工作区根、文档、桌面这几个地方的路径 ——
 *  以前 /gen-save 能写任意绝对路径、/import/scan 能递归读任意目录，这是一个本机任意文件读写面。
 *  （插件只在 loopback 上，但仍不该让任意进程借它读写文件。） */
function 路径在允许范围(给的) {
  try {
    const 目标 = 规范化路径(String(给的 || ''))
    if (!目标) return false
    const 根们 = [
      process.cwd(),
      join(homedir(), 'Documents'),
      join(homedir(), 'Desktop'),
      join(homedir(), 'Downloads'),
    ].map((x) => 规范化路径(x))
    return 根们.some((根) => 目标 === 根 || 目标.startsWith(根.endsWith('/') ? 根 : 根 + '/'))
  } catch (error) {
    return false
  }
}

function 规范化路径(x) {
  const 文 = String(x || '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (!文) return ''
  // Windows 盘符大小写不敏感
  return /^[a-zA-Z]:/.test(文) ? 文[0].toUpperCase() + 文.slice(1) : 文
}

// 取消一个注册（DSH 那套返回的是**函数**，个别地方是 { off }）
function 卸掉效果(d) {
  try {
    if (typeof d === 'function') d()
    else if (d && typeof d.off === 'function') d.off()
  } catch (error) {}
}






// 被她「归档」的会话：不再注入、也不在清单里露出来 ✓

// ---------- 插件 ----------

/** 细节档每天上限：policy 优先，缺省回落到常量；0 = 不限。 */
function 细节上限(policy) {
  const raw = policy ? Number(policy.细节每天上限) : Number.NaN
  if (!Number.isFinite(raw)) return 细节每天上限
  if (raw <= 0) return Number.POSITIVE_INFINITY
  return raw
}

export function apply(ctx) {
  const mounted = new Map() // session 对象 -> { sid, off }

  // 开关默认改成「关」了，先把老配置搬一次家（存过记忆的会话留开）✓
  migrateSwitch()

  function mountFor(agent, sid) {
    // ⭐ 在这个 agent 自己的上下文上监听 —— 只会收到「这个会话」的消息 ✓
    // ⚠⚠ 事件名踩过的坑：DSH 里**没有** `user/message` / `assistant/message` 这两个 Cordis 事件 ✗
    //   `user/message` / `assistant/message` 是 **SessionEvent 的 type**（走 `session/event`），
    //   而 agent 作用域上真正能收到的是 `agent/inbox/inserted` 和 `agent/turn-stopping` ✓
    //   （上一版挂了两个不存在的事件，所以线索一直是慢一轮的快照、consumed 也永远不触发）
    let lastText = ''
    let 回合起 = 0 // 这一轮从什么时候开始（候选钩子要判「本回合记没记过」）
    // ⭐ 1.12.0 归档闸门用：攒下来的用户原话（只在内存里，重启就没了 —— 归档本来就是「24h + 10 条」才动）
    const 最近话 = []
    let probed = false
    try {
      agent.ctx.on('agent/inbox/inserted', (payload) => {
        const msg = payload && payload.message ? payload.message : payload
        const txt = textOfMessage(msg)
        if (txt) {
          lastText = txt
          回合起 = Date.now()
          记一句话(sid, txt) // ⭐ 喂给「她自己怎么说话」那把尺子（治太敏感用）✓
          if (最近话.length < 200) 最近话.push(txt)
          diag('  收到本会话消息：' + txt.length + ' 字')
        }
      })
    } catch (error) {
      diag('  监听 agent/inbox/inserted 失败：' + (error && error.message))
    }

    // ⭐ 召回记录的状态：assemble 进去之后，看她回复里有没有真的用上 ✓
    // 这是个**猜测**（靠实词重合），所以设置页上写的是「像是用上了」，不写成事实 ✓
    try {
      agent.ctx.on('agent/turn-stopping', () => {
        // ⭐ 1.11.0 一期（§4.8）候选钩子：本回合她没调 remember，但这句话像该记的
        //   → 只放进候选区，不写正式记忆（采纳与否交给人/下次整理）。
        // ⭐ 1.12.1：六类明确线索（约束/决定/偏好/日期/地点/物品）改成**直接入库**。
        //   理由：真会话 360 轮实测，模型只主动记了 11 次，候选区 8 条没人点；
        //   而 dsh-soul 的教训是「写入该是代码的事」。它们只标 importance 0.4、source 写明
        //   「自动抽取」，并用 像度 去重，不跟模型自己写的高价值条抢位置。
        try {
          if (lastText && isEnabled(sid)) {
            // 原话索引：不管这次记不记，先把这轮真人说的话留一份（零命中时回捞用）
            try {
              记原话(sid, lastText, Date.now())
            } catch (error) {}
            if (!本回合记过没(sid, 回合起)) {
              // ⭐ 1.12.2：长消息按句子拆开逐段判定。
              //   旧版对整条消息调 该自动收 —— 而它有「> 400 字直接不收」的上限，
              //   实测真会话（PUB01 360 轮）里正是长消息把偏好/日期整段吞掉：
              //   「加班回来我更喜欢喝热麦茶…」被拆进候选区，「我生日是五月十二日」整条丢掉。
              // ⭐ 1.12.4：**默认改回整条判定**（配置 `自动收拆句: true` 才拆）。
              //   实测两组成绩打平（都是 93/108）：拆句救回「梦/假设」两组，但也把
              //   「阿岑会修老式收音机。她说旋钮比芯片还难找。」拆成无主语的短句，
              //   C003/C011 两组反而丢了。主人 2026-11-11 拍板：先按拆句之前的来。
              let 要拆 = false
              try { 要拆 = loadCfg().自动收拆句 === true } catch (error) {}
              const 片们 = 要拆 ? 拆片段(lastText) : [lastText]
              const 落了 = []
              let data = null
              try {
                const 今天 = new Date().toISOString().slice(0, 10)
                let 细节已收 = 0
                for (const 片 of 片们) {
                  const 判 = 该自动收(片)
                  if (!判) continue
                  if (data === null) {
                    data = loadStore(sid)
                    细节已收 = data.memories.filter(
                      (m) => m && m.source === '自动抽取' && Array.isArray(m.tags) && m.tags.includes('细节') &&
                        typeof m.at === 'string' && m.at.slice(0, 10) === 今天,
                    ).length
                  }
                  // 低置信「细节」档每天封顶，免得碎片叙事把库灌满。
                  // ⭐ 1.12.3：上限改由 policy 控制（设置页可调），0 = 不限 ——
                  //   以前写死 60，benchmark 一天 360 轮时会卡满，真实使用又用不着这么紧。
                  const 上限 = 细节上限(data.policy)
                  if ((判.档 === 'detail' || 判.档 === 'nature') && 细节已收 >= 上限) continue
                  if (撞旧条(data.memories, 片)) continue
                  data.memories.push({
                    id: 'auto-' + randomUUID().slice(0, 12),
                    text: 片.trim().slice(0, 400),
                    at: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                    category: 'event',
                    importance: 判.档 === 'detail' ? 细节重要度 : 判.档 === 'nature' ? 性质重要度 : 自动重要度,
                    emotion: null,
                    tags: ['自动抽取', 判.档 === 'detail' ? '细节' : 判.档 === 'nature' ? 判.名 : 判.类],
                    source: '自动抽取',
                    // 梦/虚构/假设必须带 nature —— 渲染时加「（梦）」，召回也不许当事实念
                    ...(判.档 === 'nature' ? { nature: 判.性质 } : {}),
                    原话: 片.trim().slice(0, 300),
                  })
                  落了.push(判.类 + '/' + 判.档 + (判.档 === 'nature' ? '(' + 判.名 + ')' : ''))
                  if (判.档 === 'detail' || 判.档 === 'nature') 细节已收 += 1
                }
                if (data !== null && 落了.length) saveStore(sid, data)
              } catch (error) {
                // 别把异常吞成「什么都没发生」——2026-11-11 就是因为忘 import 拆片段，
                // ReferenceError 被这个空 catch 吃掉，237 轮一条都没进库，还查了半天
                diag('  自动入库失败：' + String((error && error.message) || error))
              }
              if (落了.length) {
                diag('  自动入库 ' + 落了.length + ' 条（' + 落了.join('、') + '）：' + lastText.slice(0, 40))
              } else {
                const 线 = 找线索(lastText)
                if (线) {
                  const r = 加候选({ text: lastText, hint: 线, session: sid })
                  if (r && r.ok) diag('  候选 +1（' + 线.类 + '）：' + lastText.slice(0, 30))
                }
              }
            }
          }
        } catch (error) {}
        // ⭐ 1.12.0 一期决策二（归档闸门 24h + 10）：够了才动，动了只做「线索预筛 → 候选区」，
        //   不调模型 —— 真抽取留二期。闸门没过就不碰状态（否则 lastRunAt 一直被推，永远攒不满）。
        try {
          if (isEnabled(sid) && 最近话.length >= 归档最少条数) {
            const r = 整理一次({ 文本们: 最近话.slice(), now: Date.now(), 会话: sid })
            if (r.跑了) {
              diag('  归档闸门：扫了 ' + r.扫了 + ' 句，挑出 ' + r.挑出 + '，进候选 ' + r.写了)
              最近话.length = 0
            }
          }
        } catch (error) {}
        try {
          const ev = (agent.session && agent.session.snapshotEvents ? agent.session.snapshotEvents() : []) || []
          let 回复 = ''
          for (let i = ev.length - 1; i >= 0; i--) {
            const e = ev[i]
            if (e && e.type === 'assistant/message') {
              回复 = textOfMessage(e.data && e.data.message)
              break
            }
          }
          if (!回复) return
          // traces 已经拆到 <sid>.traces.jsonl（S3-②），状态也写那边 —— 不再碰整库
          const 全部 = 读追溯(sid, 200)
          const tr = 全部[全部.length - 1]
          if (!tr || !Array.isArray(tr.rows)) return
          const data = loadStore(sid)
          let 动 = false
          for (const row of tr.rows) {
            if (row.status !== 'assembled') continue
            const m = data.memories.find((x) => String(x.id) === String(row.id))
            if (!m) continue
            if (用上了(回复, m.text)) {
              row.status = 'consumed'
              动 = true
            }
          }
          if (动) {
            全部[全部.length - 1] = tr
            重写追溯(sid, 全部)
            diag('  这一轮像是用上了记忆')
          }
        } catch (error) {}
      })
    } catch (error) {
      diag('  agent/turn-stopping 监听挂不上：' + (error && error.message))
    }

    // 常驻提示：告诉她「你可以自己记」，不用等「记住」✓
    //
    // ⚠⚠ 2026-09-21 修（反馈：「我给它关了，照样注入」的真凶）：
    //   DSH 的 `systemPrompt.section()` / `.context()` 返回的是
    //   **一个函数**（Cordis 的 effect disposer），**不是 `{ off() }` 对象** ✗
    //   源码里写得很清楚：`@returns the exact Cordis effect disposer`，
    //   实现是 `return this.layers.effect(...)`。
    //   而我们原来写的是 `if (x && typeof x.off === 'function') x.off()` ——
    //   函数身上没有 `.off`，那个判断**永远不成立** → **一次都没卸掉过** ✗✗
    //   后果：把开关从「开」改成「关」，注册还活着 → 照样注入；
    //   再打开时又因为「already registered」挂不上 → 每 3 秒失败一次，永远修不好。
    //   而且原来**连 section 的返回值都没接**，所以 memory-hint 也永远卸不掉。
    //   → 改成：返回值都接住，卸的时候**函数就直接调** ✓
    let 提示off = null
    try {
      提示off = agent.ctx.systemPrompt.section({
        name: 'memory-hint',
        // ⚠ 排在**最后面** —— 系统提示词是按 order 拼的，而 DSH 自己那些段
        //   （工具说明、persona）一直排到 10200。以前这里用 1001，等于插在
        //   「工具说明」那一大块**正中间**；下面那段记忆每轮都变，
        //   一变就把后面几千字全变成缓存未命中 → 一轮从 0.003 飙到 0.02 ✗
        //   放到 10200 之后，前面全部命中缓存，只有这最后一小段按全价算 ✓
        order: 89990,
        // ⭐ 1.3.5：跟下面注入那段一样 —— 纯文本，别让宿主当模板解析
        //   （这里会把用户设的「称呼」拼进去，称呼里带 {{ }} 一样会炸）
        interpolate: false,
        text: () => {
          const p = ownerNameOf(sid) || userPronoun()
          const self = selfNameOf(sid)
          return (
            '【记忆】这一轮如果有值得长期记住的事（' + p + '重要的话、约定、' + p + '的喜好、' + p + '的状态），' +
            '直接调用 remember 工具记下来 —— **不用等' + p + '提醒**。' +
            '日常琐事（吃了什么、今天天气）不用记。' +
            '**人称**：你自己是「我」，用户是「' + p + '」，别人和别的 AI 直接写名字' +
            (self ? '（你写成「' + self + '」也会自动换成「我」）' : '') +
            '；也不要写「今天/昨天」，时间交给系统。'
          )
        },
      })
    } catch (error) {
      diag('  常驻提示挂不上：' + (error && error.message))
    }

    // ⚠⚠ 这里必须用 **context**，不能用 **section**（2026-09-20 实测踩到，代价很大）
    //
    // 实测数字（同一句短消息，记忆开 / 关各一次）：
    //   记忆关：未缓存 107  /  缓存读取 11,392   → 0.001
    //   记忆开：未缓存 12,055 / 缓存读取 0       → 0.02   （20 倍）
    // 提示词只多了 550 token，但**整段一万二的缓存全废了**。
    //
    // 原因：section 是拼进**系统提示词**的，系统提示词一变，DeepSeek 就把整段当新的。
    //   context 是 DSH 给「每轮都变」的内容准备的：它把这段作为**一条消息追加到对话末尾**，
    //   而且只在内容真的变了才追加（dsh-agent-loop 里写着 "only when the retained value differs"）。
    //   沙箱策略 / 审批策略 / 子代理派发用的都是它。
    //   → 系统提示词保持不变 = 缓存一直命中；只有末尾那条快照按新内容算 ✓
    // （下面这段的返回值先存着，跟工具那个 disposer 一起交给上面 return）
    const 注入off = agent.ctx.systemPrompt.context({
      name: 'memory',
      order: 900, // 排在沙箱/审批/子代理那几条（110/115/120）后面
      // ⭐ 1.3.5：**这段是纯文本，不许被当提示词模板解析**。
      //   宿主的 context / section 默认会做变量替换：`{{time}}` 这种会被当成变量名，
      //   查不到就抛 `unknown prompt variable` —— 记忆里只要存了一句带双花括号的话
      //   （代码片段、模板、日志都可能有），整间会话每一轮都直接失败，用户只能关插件。
      //   `interpolate: false` 是宿主自己给的开关（dsh-tools / working-directory 都在用）。
      interpolate: false,
      text: () => {
        try {
          const now = Date.now()
          const query = lastText || lastUserTextOf(agent.session) // ⭐ 优先用监听收到的最新一条

          // 探针：看看 requestContext() 里有没有「当前输入」（只记一次）
          if (!probed) {
            probed = true
            try {
              const rc = agent.session && agent.session.requestContext ? agent.session.requestContext() : null
              diag('探针 requestContext: ' + (rc ? Object.keys(rc).join(',') : '拿不到'))
              if (rc) diag('探针内容: ' + JSON.stringify(rc).slice(0, 500))
            } catch (error) {
              diag('探针出错: ' + (error && error.message))
            }
          }
          diag('  注入被调用：query 长度=' + query.length)
          if (!query) return ''
          // ⭐ B 轮 F4（2026-10-29）：「先别记」—— 用户说了之后，这个会话静音一段时间。
          //   状态单独存一份小文件（不塞进记忆库：saveStore 只认固定几个字段，
          //   随手加个顶层字段会被它丢掉，1.6.16 的批次戳就是这么丢过一次 ✗）。
          {
            const 静 = 暂停到(sid)
            if (静 && Date.now() < 静) {
              diag('  这个会话暂停中，跳过注入（到 ' + new Date(静).toLocaleString('zh-CN') + '）')
              return ''
            }
          }
          const data = 读注入数据(sid)
          影子比对(sid, data)
          // ⭐ 1.10.3（F6）：骨架有独立字数预算（maxChars 的 40%），而且**不再被
          //   「这个会话一条记忆都没有」拦下** —— 骨架是长期背景，跟本会话记没记过东西无关。
          const 骨架文本 = render骨架(读骨架(), 骨架预算(data.policy))
          if (!data.memories.length) return 骨架文本
          // ⭐ B 轮 F5：标了「这条不对」的，别再想起来（不删，留着让人能撤销标记）
          data.memories = data.memories.filter((m) => !(m && m.别记))
          // GPT 整改 P2（inference）：推测默认不注入 —— 它不是用户事实，
          //   只在设置页显式查看 / 显式相关查询时露脸，且措辞必须保留「推测」。
          data.memories = 滤掉推测(data.memories)
          补历史尺(sid, agent.session) // ⭐ 第一次用到时把她的会话历史补成尺子（只做一次）✓
          const { selected, scored, gate } = recall(data, query, now, sid)
          // ⭐ F7（1.10.3）：回血挂在 **picked**（真正进提示词的那几条）上 ——
          //   拿 scored.slice(0,24) 充数的话，常驻/核心条目永远回不了血。
          //   注入这条路不写盘，只攒在内存里，搭下一次 saveStore 的便车（lib/reinforce.mjs）。
          const 攒了回血 = 标回血(sid, selected.map((r) => r.m.id), now)
          // ⭐ F7：trace 带 turn / step —— 宿主钩子不给，只能自己合成：
          //   turn = 这个会话里你是第几条消息；step = 同一轮里第几次注入。
          const 轮步 = 记轮步(sid, agent.session)
          // ⭐ F15（1.10.3）：注入字符数要记进 trace，健康度才说得清「配额用了几成」
          //
          // ⭐ 1.11.0 一期（§4.4）：结构化召回一条都没选中时走零命中兜底链 ——
          //   ① 证据原话池（evidence.excerpt）再撞一次字面；② 72h 内最近一条「你说的」。
          //   兜底只带 1 条，且**如实说是原话**，不许包装成「她想起来了」。
          let 兜底信息 = null
          let 注入文本 = render(selected, now, selfNameOf(sid))
          if (!selected.length) {
            try {
              兜底信息 = 原话兜底(data, query, now)
            } catch (error) {}
            // ⭐ 1.12.1：原话兜底（72h 内一条）也翻不到时，去原话索引里按词回捞。
            //   真会话实测 90.8% 的注入走了兜底，而 72h 窗口一过就彻底没材料 —— 索引补的就是这段。
            if (!兜底信息) {
              try {
                const 捞 = 回捞原话(sid, query, { limit: 1, now })
                if (捞.length) {
                  const 一 = 捞[0]
                  兜底信息 = { kind: 'span', m: { at: 一.at || now }, text: 一.text }
                }
              } catch (error) {}
            }
            if (兜底信息) {
              const 何 = relTime(Date.parse(兜底信息.m.at) || now, now)
              注入文本 =
                '【当时的原话】（这轮没找到对得上的记忆，翻到一句原话）' +
                String.fromCharCode(10) +
                '下面只是' + 何 + '你说过的原话，不一定就是答案，别当成「她记得」：' +
                String.fromCharCode(10) +
                '- ' +
                String(兜底信息.text || '').trim()
            }
          }
          // ⭐ 1.10.5（自检摘要）：只在「这轮记忆不对劲」时冒一句 ——
          //   空注入 + 人家在问 / 塞满上限还有没进来的 / 字数快吃满预算。
          //   判据全来自这次 recall 的内存结果：**不读 traces、不扫库、不发请求**。
          //   正常时是空串，注入文本一个字都不多（省白饭的底线）。
          let 自检文本 = ''
          // 1.12.17：同一 turn 只喊一次 —— 一条消息会走多个 step，每个 step 都 recall 一次，
          //   不去重就是同一条消息被复印三份（真机：step 167/168/169 连着喊同一句）
          if (自检轮.该喊(sid, 轮步.turn)) {
            try {
              // 候选 = 分数真过线的条数（含被条数/字数上限挤掉的）。
              // ⚠ 不能用 `!omission` 数 —— 被上限挤掉的会被标成 'limit'，那样候选恒等于选中 ✗
              const 门 = (data.policy && data.policy.threshold) || 0.35
              const 候选 = scored.filter((r) => r.s && Number(r.s.C) >= 门).length
              自检文本 = 自检({
                query,
                选中: selected.length,
                候选,
                gate,
                字: 注入文本.length,
                ...(兜底信息 ? { fallback: 兜底信息.kind } : {}),
                骨架字: 骨架文本.length,
                maxItems: data.policy && data.policy.maxItems,
                预算: data.policy && data.policy.maxChars,
              })
            } catch (error) {}
            if (自检文本) 自检轮.喊了(sid, 轮步.turn)
          }

          // ⚠ 只存**最相关的前 24 条**，别把 850 条全存进来 ✗
          //   全存的话：一条 trace ≈ 50 KB，留 100 条 = 5 MB，
          //   而每轮都要把整份读进来再整份写回去 → 每轮白白多花几十毫秒
          //   （每轮开销大就是这儿）
          //   scored 已经按 P 排好序了，所以前 24 条 = 挑中的 + 最接近的落选 ✓
          追加trace(sid, {
            at: now,
            session: sid,
            // ⭐ F7：轮次信息（自己合成，见记轮步）
            turn: 轮步.turn,
            step: 轮步.step,
            回血: 攒了回血,
            query: query.slice(0, 200),
            // 这道门挡下来的时候记一笔，设置页上就能看见「为什么这次没翻记忆」✓
            gate: gate ? gate.信息量 : null,
            gateLimit: gate ? gate.门槛 : null,
            picked: selected.map((r) => r.m.id),
            条: selected.length,
            字: 注入文本.length,
            // ⭐ 1.12.1：走了零命中兜底就在 trace 里留个痕（excerpt / quote），
            //   否则事后翻 trace 只看得到「picked: 0、注入 91 字」，说不清那 91 字是什么 ✗
            fallback: 兜底信息 ? 兜底信息.kind : null,
            自检: 自检文本 || null,
            rows: scored.slice(0, 24).map((r) => ({
              id: r.m.id,
              C: Number(r.s.C.toFixed(3)),
              P: Number(r.s.P.toFixed(3)),
              omission: r.omission,
              timeHit: r.s.timeHit,
              // 进到提示词里的算 assembled；后面她回复里用上了就变 consumed ✓
              status: r.omission ? null : 'assembled',
            })),
          })
          // traces 已经追加进 .jsonl 了 —— 注入路径不再写整库（S3-② 的目的就是这个）
          // ⭐ 骨架层（2026-11-04 决议四）：_core.json 每轮固定注入，排在一切记忆前。
          //   它不依赖这句话问了什么，也不占 factsMax 名额 —— 骨架就是「一直都在」那层。
          //   （骨架文本在上面就算好了：1.10.3 起它同时要过独立字数预算）
          // ⭐ 工作区上下文层（2026-11-04）：goal/stack/constraint 常驻（最多 4 条），
          //   放在「你记得的事」前面 —— 项目上下文比往事更该一直知道。
          const 项目上下文 = render项目上下文(data.memories)
          // （注入文本在上面就算好了：1.10.3 起 trace 里要记它多少字）
          // ⭐ 2026-10-22 她要能看见「这一轮到底注入了什么」：
          //    搬到官方桌面端之后界面上看不到了，那就写进 diag.log，一眼能翻。
          //    只记一行、截断 400 字，不占空间。
          try {
            diag('骨架 ' + 骨架文本.length + ' 字：' + (骨架文本 || '（无）').split(String.fromCharCode(10)).join(' ⏎ ').slice(0, 200))
            diag('注入 ' + selected.length + ' 条：' + (注入文本 || '（空）').split(String.fromCharCode(10)).join(' ⏎ ').slice(0, 400))
          } catch (error) {}
          return [骨架文本, 项目上下文, 注入文本, 自检文本].filter(Boolean).join('\n\n')
        } catch (error) {
          return '' // 记忆坏了也不能影响对话
        }
      },
    })

    // ⭐⭐ 1.3.4：remember 工具**挪回全局**（见下面「同步工具」那一段）。
    //
    // 从前它挂在这里（`agent.ctx.tools.register`），会话开关一关就跟着卸掉。
    // 代价是：默认关 + 要等 0.5 秒的扫描才挂到新会话上 ——
    // 表现就是「我开了会话，工具列表里根本没有 remember」。
    // 现在工具全局常驻，这个函数只管**注入**（每轮想起来几条）。
    // 会话开关关着的会话调 remember 时，execute 会明确回一句「这间没开记忆」，
    // 不会假打 ✓（render 认 ok:false 那条早就修好了）。

    // 两样一起卸（注入 + 常驻提示）—— 工具是全局的，不在这里管
    //
    // ⚠⚠⚠ 2026-09-21 修（反馈：「开关关了照样注入」的**真凶**，一共两层错）：
    //
    //   【第一层】DSH 的 `systemPrompt.section()` / `.context()` / `tools.register()`
    //     返回的是**一个函数**（Cordis 的 effect disposer），**不是 `{ off() }` 对象**。
    //     源码写着 `@returns the exact Cordis effect disposer`，实现是 `return this.layers.effect(...)`。
    //     而这里原来写的是 `if (x && typeof x.off === 'function') x.off()` ——
    //     函数身上没有 `.off`，判断**永远不成立** ✗
    //
    //   【第二层】`mountFor` 原来返回的是 `{ off() {...} }`（一个**对象**），
    //     而调用方是 `const off = mountFor(...); mounted.set(sid, {sid, off})`，
    //     于是 `v.off` 是那个**对象**、不是方法 → `v.off()` = 拿对象当函数调 → **TypeError**
    //     → 被外面的 try/catch 吃掉 → **静默什么都没做** ✗✗
    //
    //   两层叠起来的结果：**开关从来没能"立刻"卸下来过**。
    //   以前看着有用，是因为 DSH 重启后插件重新加载、看到关着就不挂了。
    //   → 现在：**返回一个函数**（跟 DSH 的约定一致），调用方 `v.off()` 就能直接用 ✓
    return function off() {
      卸掉效果(注入off)
      卸掉效果(提示off)
    }
  }

  // ⚠️ 2026-10-22 她叫停了「每 15 分钟自动补一条」：
  //    那是一个真实的模型调用（每次几秒 + 烧 token），还会跟她那一轮抢资源 —— 不值当。
  //    现在只保留「她自己记完一条时顺手补」那一条路子；**历史遗留的没扩词的，她去设置页点一下「开始扩词」就行**。
  // ---------- 分支继承 ----------
  // 分支会话会不会继承记忆
  // 原来不会 —— 记忆按会话 id 存，分支出来的是新 id，等于从零开始（而且开关默认关）。
  // 现在：认出这是**分支**出来的会话，就把来处那份记忆复制一份过来 ✓
  //
  // 判断依据是会话头（实测：分支出来的会话头里有 parentSession、isSeeded=true、delegationDepth=0）
  // ⚠ 子代理也有 parentSession，但那是「派出去干活」，不该继承别的会话的记忆
  //    → 靠 origin === 'subagent' 和 delegationDepth > 0 排掉
  function 分支来处(agent) {
    try {
      const h = agent && agent.session && agent.session.header
      if (!h || !h.parentSession) return ''
      if (h.origin === 'subagent') return ''
      if (typeof h.delegationDepth === 'number' && h.delegationDepth > 0) return ''
      const p = String(h.parentSession)
      return p && p !== String(h.id) ? p : ''
    } catch (error) {}
    return ''
  }

  const 查过分支 = new Set()

  function 继承分支记忆(agent, sid) {
    const 来处 = 分支来处(agent)
    if (!来处) return false
    const 我的 = loadStore(sid)
    // ⚠⚠ 1.4.0：`我的.memories` 里**永远**装着全部全局事实 —— 拿它判断「我有没有记忆」
    //   会让分支继承永远跳过 ✗。只认**本会话自己的事件**。
    if ((我的.memories || []).some((m) => m.category !== 'stable_profile')) return false
    const 母的 = loadStore(来处)
    // 事实是全局的，本来就看得见，不用继承；继承的只是「那场对话发生过什么」
    const 事件们 = (母的.memories || []).filter((m) => m.category !== 'stable_profile')
    if (!事件们.length) return false // 来处也没有事件，没什么可继承
    const 副本 = JSON.parse(JSON.stringify({
      ...母的,
      memories: 事件们,
      deleted: (母的.deleted || []).filter((m) => m.category !== 'stable_profile'),
    }))
    adoptTargetEpoch(副本, 我的) // 明确的跨会话复制使用目标库代际
    for (const m of 副本.memories || []) {
      m.source = m.source ? m.source + '｜分支继承' : '分支继承'
    }
    副本.traces = [] // 召回历史不跟着走，分支是新的开始
    saveStore(sid, 副本)
    if (isEnabled(来处)) setEnabled(sid, true) // 开关也跟着来处
    diag('分支继承：' + sid + ' ← ' + 来处 + '（' + (副本.memories || []).length + ' 条事件）')
    return true
  }

  // ---------- remember 工具：全局注册（1.3.4 起）----------
  //
  // 以前是**按会话挂**（`agent.ctx.tools.register`），会话开关一关就跟着卸掉。
  // 好处是「关掉就真的不出现」，坏处很实际：
  //   ① 默认关的那些版本里，一堆人开了会话也找不到这个工具；
  //   ② 挂载靠 tick 每 0.5 秒扫一遍，刚打开的会话那一小段里没有工具；
  //   ③ 开关一抖，工具列表就变 → 提示词前缀跟着变 → 那一轮全量重算。
  // 现在改成插件级全局注册：所有会话都看得见 remember；
  // 会话开关只决定「注不注入」和「调了记不记」（关着的会话 execute 会明确回一句）。
  // 总开关关掉时这里会把它摘下来 —— 那是用户自己说不要，就别留个点不动的符号。
  //
  // ⚠️ `工具在` / `工具off` 的声明**必须在这之前**：tick() 在下面就会调 同步工具()，
  //    声明放到后面就是 TDZ（抛错还会被外层 try/catch 吃掉，表现成「工具莫名其妙不在」）。
  // ⭐ B 轮（2026-10-29）：现在挂三个工具 —— remember（记）/ forget（忘）/ recall（当场翻）。
  //   所以 off 变成一组；卸的时候要挨个卸，不然删一个留两个。
  let 工具off = null
  let 工具在 = false

  function 同步工具() {
    try {
      if (!ctx.tools || typeof ctx.tools.register !== 'function') return
      const 要 = globalOn()
      if (要 && !工具在) {
        工具off = [makeRememberTool(ctx), makeForgetTool(ctx), makeRecallTool(ctx), makeTraceTool(ctx), makeSuppressTool(ctx)].map((t) => ctx.tools.register(t))
        工具在 = true
        diag('工具挂上了（remember / forget / recall / trace / suppress）')
      } else if (!要 && 工具在) {
        for (const off of Array.isArray(工具off) ? 工具off : [工具off]) {
          try { 卸掉效果(off) } catch (error) {}
        }
        工具off = null
        工具在 = false
        diag('工具卸下了（总开关关着）')
      }
    } catch (error) {
      diag('同步工具失败：' + (error && error.message))
    }
  }

  // 给每个活着的 agent 挂它自己的那段记忆
  let 上次心跳 = ''        // 只用来判断「agents 数变了没」，不再每 3 秒写一行日志
  function tick() {
    try {
      // 总开关跟着配置走：开着就保证工具在，关掉就把工具摘下来
      同步工具()
      const list = ctx.agents.list() || []
      const 归档的 = 归档名单(ctx)
      // 2026-10-25（issue #2）：这行以前每 3 秒无条件写，占整个日志的 97%；
      // 心跳没什么诊断价值 —— 只在「agent 数变了」时记一条。
      const 心跳 = 'agents=' + list.length
      if (心跳 !== 上次心跳) { 上次心跳 = 心跳; diag('tick：' + 心跳) }
      for (const agent of list) {
        const sid = sessionIdOf(agent.session)
        if (!sid) { diag('  跳过：拿不到会话 id'); continue }
        // 归档了就不再注入，而且把它卸下来 —— 归档=藏起来，不该还占她的上下文 ✓
        if (归档的.has(sid)) {
          const v = mounted.get(sid)
          if (v) {
            try {
              v.off()
            } catch (error) {}
            mounted.delete(sid)
            diag('  归档了，卸下 ' + sid)
          }
          continue
        }
        // 子代理（派出去干活的）不挂记忆：它只做一件事，给它建一份库既没用又白写文件
        if (是子代理(agent)) {
          const v = mounted.get(sid)
          if (v) {
            try {
              v.off()
            } catch (error) {}
            mounted.delete(sid)
            diag('  子代理，卸下 ' + sid)
          }
          continue
        }
        // 分支出来的会话：先把来处的记忆继承过来（每个会话只查一次）
        if (!查过分支.has(sid)) {
          查过分支.add(sid)
          try {
            继承分支记忆(agent, sid)
          } catch (error) {
            diag('  分支继承失败：' + (error && error.message))
          }
        }
        // ⭐ 2026-09-21 修：**关掉了就要卸下来**
        //
        // 原来这两句的顺序是反的：
        //     if (mounted.has(sid)) continue     ← 挂着就直接跳过
        //     if (!isEnabled(sid)) continue      ← 关着的只是「不挂新的」
        // 所以**把开关从开改成关，它不会卸** —— 已经挂上的注入和工具会一直留着，
        // 只有「归档」那条路才会卸。「插件关了怎么还在写」
        // 就是这个：关掉之后工具还在她的工具列表里 ✗
        if (!isEnabled(sid)) {
          const v = mounted.get(sid)
          if (v) {
            try {
              v.off()
            } catch (error) {}
            mounted.delete(sid)
            diag('  关了，卸下 ' + sid)
          }
          continue
        }
        // ⭐⭐ 2026-10-24 修（用户报：「已经有消息的会话，开记忆拿不到 remember 工具」）：
        //   原来这里只按**会话 id** 记账（`mounted.has(sid)`）——只要挂过一次，
        //   以后这个会话就再也不挂。可 **agent 实例是会被换掉的**
        //   （会话重开、插件重载、宿主重建 agent 都会换一个新对象），
        //   旧注册跟着旧 ctx 一起没了，而我们这边的账还写着「已挂上」⇒ 永远不重挂 ✗
        //   症状正好是：空会话开记忆→当场挂在活着的那个 agent 上→能用；
        //   有消息的会话→早就被换过实例→记账说挂上了、实际那个实例上没有工具。
        //   → 现在连**实例**一起记：实例变了就卸旧的、重新挂。
        const 已挂 = mounted.get(sid)
        if (已挂 && 已挂.agent === agent) continue // 还是同一个 agent，不用重挂
        if (已挂) {
          try {
            已挂.off()
          } catch (error) {}
          mounted.delete(sid)
          diag('  agent 实例换过了，重挂 ' + sid)
        }
        diag('  试挂 ' + sid)
        try {
          const off = mountFor(agent, sid)
          mounted.set(sid, { sid, agent, off })
          diag('  ✓ 挂上 ' + sid + '（' + loadStore(sid).memories.length + ' 条）')
        } catch (error) {
          diag('  ✗ 挂 ' + sid + ' 失败：' + (error && error.message))
        }
      }
    } catch (error) {}
  }

  tick()
  // 定时器不可用时也不能让 DSH 起不来
  try {
    // ⚠️ 2026-10-25：3 秒 → **0.5 秒**。
    //   起因：DSH 在「打开会话」时会新建 agent 实例，我们那条「实例变了就重挂」要等到下一跳才挂上；
    //   窗口内如果先跑了一轮（比如 QQ 桥转进来一条），那一轮的工具列表里就没有 remember，
    //   等挂上之后工具列表变了 → 下一轮前缀对不上 → **全量重算一次**。
    //   tick 本身很便宜（`agents.list()` 读内存 + 归档名单优先走服务），0.5 秒完全扛得住。
    ctx.effect(() => ctx.interval(tick, 500))
  } catch (error) {
    console.error('[记忆] 定时器不可用（不影响对话）：' + (error && error.message))
  }
  ctx.effect(() => () => {
    for (const v of mounted.values()) {
      try {
        v.off()
      } catch (error) {}
    }
    mounted.clear()
    卸掉效果(工具off)
    工具off = null
    工具在 = false
  })

  // remember 工具是**全局注册**的，见上面「同步工具」那一段。
  // （这里留个记号，免得以后有人以为漏了。）

  // 诊断：看看每次组装时「模型能看到哪些工具」—— 查 remember 到底有没有出现
  let lastToolSig = ''
  try {
    ctx.on('system-prompt/assemble', (assembly, context, next) => {
      try {
        const names = (assembly && assembly.tools ? assembly.tools : [])
          .map((x) => (x && (x.name || (x.function && x.function.name))) || '?')
          .sort()
        const sig = names.join(',')
        if (sig !== lastToolSig) {
          lastToolSig = sig
          diag('assemble 的工具（' + names.length + ' 个）：' + sig)
          diag('  ↑ 里面有 remember 吗：' + (names.indexOf('remember') >= 0 ? '有 ✓' : '没有 ✗'))
        }
      } catch (error) {}
      return next()
    })
  } catch (error) {
    diag('assemble 钩子挂不上：' + (error && error.message))
  }

  // ---------- 设置页的路由 ----------
  try {
    const mroute = (path, handler) =>
      ctx.effect(() =>
        ctx.webServer.register({
          kind: 'exact',
          path: path,
          handler: async (req, res) => {
            try {
              await handler(req, res)
            } catch (error) {
              try {
                res.writeHead(500, { 'content-type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: String(error && error.message) }))
              } catch (e2) {}
            }
          },
        }),
      )

    // ⭐ 设置页那个「检查更新」：查这个插件自己的仓库（地址从 package.json 读）
    const 自查更新 = createSelfUpdate({
      packageRoot: join(dirname(fileURLToPath(import.meta.url)), '..'),
      diag,
    })
    // 拆层第 10 批：48 条路由迁到三个注册模块（核心/管理/生成），闭包依赖走环显式传
    const 环 = { ctx, 读JSON体, mounted, tick, 同步工具, 自查更新, 路径在允许范围 }
    注册核心路由(mroute, 环)
    注册管理路由(mroute, 环)
    注册生成路由(mroute, 环)
    注册回复体检路由(mroute, 环)
  } catch (error) {
    diag('设置页路由挂不上：' + (error && error.message))
  }

  // 首启就把盘上的 JSON 库灌进 SQL 镜像（审查 P1-5），失败不影响主流程
  try { 全量回填镜像() } catch (error) {
    diag('全量镜像回填失败：' + String((error && error.message) || error).slice(0, 120))
  }

  diag('apply 跑完（v0.2）')
}

export {
  // 2026-10-25：给自测用（诊断日志轮转、配置去 BOM）
  diag,
  loadCfg,
  DIAG,
  recall,
  render,
  relTime,
  tokenize,
  loadStore,
  saveStore, // 内部自测接口，不注册宿主工具或路由
  自动扩词,
  blank,
  全局参数,
  合并参数,
  ownerNameOf,
  selfNameOf,
  normalizeOwner,
  解析档案,
  抠日期,
  抠日期详,
  猜重要度,
  // 2026-09-21 新加的，给自检脚本用 ✓
  稀有表,
  稀有度,
  词面,
  记一句话,
  问句信息量,
  说话尺,
  // 2026-09-21 中午加的：搭配度（治跨词碎片）✓
  切词,
  搭配集,
  装搭配,
  中文片段,
  // 2026-09-21 傍晚加的：幽灵会话（会话没了、记忆文件还在）✓
  buildMemoryList,
  已知会话ids,
  归档名单,
  // ⭐⭐ 2026-09-23 新加的：事实键（给自检脚本 + 老数据清洗用）✓
  提炼系统,
  解析提炼,
  洗键系统,
  解析洗键,
  归一键,
  按键收敛,
  词集,
  像度,
  标作废,
  真重复门槛,
  // ⭐ 1.4.0 双层记忆：事实库路径 / 文件名 / 「哪份是会话库」的判据
  //   （迁移脚本 tools/migrate-facts.mjs 和自测都要按这三样认文件）
  factPath,
  FACTS_NAME,
  是会话文件,
  是事实条,
  条签名,
}
