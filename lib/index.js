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
// ⭐ 1.12.64：经历 / 梗记忆（空闲提取）
import { 挑对话, 提取一次, 该提取, 读水位, 写水位, 造条目, 空闲分钟, 扫描分钟, 最少用户消息 } from './episode.mjs'
import { 鲜活度, 标作废, 归一键, 是万能键, 按键收敛, 词集, 像度, 重复门槛, 真重复门槛, recall, 用上了, render, render项目上下文, 原话兜底, 判意图, 净长, 建注入账本 } from './scoring.mjs'
// ⭐ 2026-11-15（P1-1）：语义路。CLAY_EMBED=0（默认）时这里所有函数都直接返回空，零开销。
import { 语义开, 取查询向量, 相似度表, 模型状态, 取向量 } from './embed.mjs'
import { 找线索, 加候选, 本回合记过没 } from './candidates.mjs' // 候选钩子（1.11.0 §4.8）
import { 该自动收, 拆片段, 撞旧条, 自动重要度, 细节重要度, 性质重要度, 细节每天上限 } from './auto-capture.mjs' // 自动入库（1.12.1：写入归代码，不等模型心情）
import { 记原话, 回捞原话 } from './span-index.mjs' // 原话索引（1.12.1：零命中时按词回捞，不再只翻 72h 内一条）
import { 整理一次, 归档最少条数, 是主人说的 } from './archive-gate.mjs' // 归档闸门（1.12.0 一期决策二）
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

// ⭐ 1.12.62：常驻层注入账本（仅内存，不落盘）。
//   它只回答「这一程里谁露过几次面」，用来给同分条目排队轮换 ——
//   重启清零不会算错，只是重新轮一遍，所以不值得为它加字段/写 IO。
const 项目注入账本 = 建注入账本()

// ⭐ 1.12.64（经历/梗）：每个会话「最后说了话」的时间和它的 agent。
//   为什么放模块级而不是 mountFor 里：定时器是全局的，要能横着扫所有会话。
//   会话关掉后 agent 引用会失效，所以取不到就跳过，靠下次启动补扫。
const 会话活动 = new Map()

export const name = 'memory'
export const inject = ['systemPrompt', 'agents', 'timer', 'tools', 'webServer', 'sessions', 'sessionTitle', 'llm']

import { CFG_DIR, STORE_DIR, BACKUP_DIR, CFG_PATH, FACTS_NAME, factPath, 是会话文件, storePath, 会话工作区 } from './paths.mjs' // 2026-10-30 拆层第5a批：路径层；1.12.70 加 会话工作区
import { 读骨架, render骨架, 骨架预算 } from './core-memory.mjs' // 2026-11-04 决议四：骨架层（_core.json）
import { 标回血 } from './reinforce.mjs' // F7（1.10.3）：注入时攒「这轮用上了」，写盘时落下去
import { DEFAULT_POLICY, POLICY_SPEC, clampNum, fitPolicy, 全局参数, 合并参数, loadCfg, saveCfg, globalOn, setGlobalOn, 是子代理, isEnabled, setEnabled, enabledList, migrateSwitch, 接报信 as 接cfg报, 接读库 as 接cfg读 } from './cfg.mjs' // 2026-10-30 拆层第5b批：配置层
import { 取临场提醒, 拼记忆块 } from './hint.mjs' // 1.12.41：临场提醒（主人自己写的、每轮拼在最后的固定文字）
import { 取匹配模式, 渲染模式, 记命中 } from './patterns.mjs' // 1.12.55：行为模式（dream 的产物，条件路由注入）
import { 找可合的, 执行合并, 该整理了, 记整理结果 } from './dedupe.mjs' // 1.12.46：存量重复的自查自合
import { 归纳一次, 落库, 该归纳了, 记归纳结果 } from './dream.mjs' // 1.12.58：dream 自己定期来看一眼
import { 跑一次 as 陈旧查一次, 全库记忆, 该查了 as 该查陈旧了 } from './stale.mjs' // 1.12.74：路径陈旧检测（不吃模型，纯 fs 判定）
import { 取规则, 造守卫 } from './guard.mjs' // 1.12.69：工具拦截（机制层，规则全部来自用户配置）
import { tracePath, 读追溯, 标trace状态, 标最近一轮, 重写追溯, 追加trace, 接报信 as 接trace报 } from './trace-log.mjs' // 2026-10-30 拆层第6a批：召回记录
import { todayKey, memSig, 条签名, lastSig, 销毁前另存, backupFile, backupStore, 读批次表, 读暂停表, 暂停到, 设暂停, 记批次, 接报信 as 接备报 } from './backup.mjs' // 2026-10-30 拆层第6b批：备份/批次/暂停
import { blank, purgeEpochOf, 事实代际, corruptSnapshots, corruptIncidents, 读一份, 事实文, 读注入数据, loadStoreJSON, adoptTargetEpoch, backupCorruptStore, 读盘校验, 已清理错, 坟归事实, loadStore, saveStore, 镜像不可用, 同步SQL镜像, 全量回填镜像, saveStoreJSON, 滤掉推测, 接报信 as 接存报 } from './store-core.mjs' // 2026-10-30 拆层第6c批：核心读写层
import { sessionIdOf, lastUserTextOf, sessionIdFromExec, makeRememberTool, makeForgetTool, makeRecallTool, makeSearchTool, makeTraceTool, makeSuppressTool, titleOfSession, 接定义工具 as 接工具定义, 接报信 as 接工具报 } from './tools.mjs' // 2026-10-30 拆层第8批：工具构造器层
import { 挑选目录文件, 读挑选目录, 写挑选目录, 目录在, 当前工作区根, 工作区号, 归档名单, 已知会话ids, 分支来处Of, 是事实条, buildMemoryList, MEMORY_PAGE, 接报信 as 接ui报 } from './ui.mjs' // 2026-10-30 拆层第9批：展示层
import { 自动扩词, 问模型, 取模型, 选定模型, 取日期, 解析提炼, 解析扩词, 解析洗键, 提炼系统, 洗键系统, 扩词系统, 扩词系统_v2, 接造消息 as 接llm消息, 接报信 as 接llm报, 接模型服务 } from './llm.mjs' // 2026-10-30 拆层第7批：LLM 层；2026-11-20 加 接模型服务（定时器里上下文失效）
import { 注册核心路由 } from './routes-core.mjs' // 2026-10-30 拆层第10批：核心读写路由（update/add/global/toggle/backfill/bench/mark-wrong/pause/undo-last）
import { 注册管理路由 } from './routes-admin.mjs' // 2026-10-30 拆层第10批：管理/导入路由（names/duplicates/delete/edit/import/dirs）
import { 注册生成路由 } from './routes-gen.mjs' // 2026-10-30 拆层第10批：生成/LLM 路由（models/gen/refine/wash-keys/copy-to/llm-check/expand/policy）
import { 注册自检路由 } from './routes-health.mjs' // 1.12.78：兼容性自检（体检页「点一下看接口通不通」）
import { 跑浅检 as 跑自检浅检, 读日志尾部 as 读自检日志, 读经历 as 读自检经历, 默认库文件们 as 自检库文件们 } from './health.mjs' // 1.12.78：自检判据（纯函数）
import { 注册回复体检路由 } from './reply-check/routes.js' // 2026-11-10：FuckAIWords 词面规则体检（从 dsh-persona-growth 搬来）
import { 注册拦截路由 } from './routes-guard.mjs' // 2026-11-21：工具拦截的设置页路由（读/存/干跑）
import { 注册陈旧路由 } from './routes-stale.mjs' // 1.12.74：陈旧检查（_stale.json 的读/处置/手动扫）
import { DIAG, diag } from './diag.mjs' // 2026-10-30 拆层第10批：诊断日志（DIAG 路径 + diag 写轮转日志）

// ⚠️ 2026-11-22 主人给插件瘦身：这两块**默认不启用**（代码和测试都留着，想开回来只改下面两个 false）。
// 摘的是「入口」：guard 不挂、定时器不跑、路由不注册、页签和折叠区不显示。
// 配置里的 toolGuard 与 _stale.json 已一并清掉，重新启用时重新配即可。
export const 启用工具拦截 = false
export const 启用陈旧检查 = false

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

  // ⭐ 2026-11-20：apply 期间上下文是活的，这一刻把 llm 服务接住。
  //   定时器（经历提取）跑在 apply 之后，那时 ctx.llm 会抛
  //   `cannot get required service "llm" in inactive context`。
  try {
    接模型服务(ctx && ctx.llm)
  } catch (error) {
    diag('接 llm 服务失败（定时任务会跟着不可用）：' + ((error && error.message) || error))
  }

  // ⭐ 1.12.69：工具拦截（B 组）—— **只挂机制，一条规则都不内置**。
  //   规则全在 clay-memory-config.json 的 toolGuard.rules 里由用户自己写，
  //   这个插件不认识任何人的习惯、目录、工具集。
  //   为什么用 ctx.tools.guard() 而不是 tools/pre-execute（DSH 官方 Stability 指南）：
  //   必须「不管监听顺序都拦住」的拒绝要用 guard（同步）；pre-execute 留给要问用户的 ask。
  //   规则是懒读 + 按文件 mtime 缓存：用户改完配置文件当场生效，不用重启。
  try {
    if (启用工具拦截 && ctx.tools && typeof ctx.tools.guard === 'function') {
      let 缓存规则 = []
      let 缓存时 = NaN
      function 当前拦截规则() {
        let m = -1
        try { m = statSync(CFG_PATH).mtimeMs } catch (error) { m = -1 }
        if (m !== 缓存时) {
          缓存时 = m
          try {
            const 态 = 取规则(loadCfg())
            缓存规则 = 态.规则们
            if (态.错误.length) diag('  工具拦截：有 ' + 态.错误.length + ' 条规则写法不对，已跳过 —— ' + 态.错误.join('；'))
          } catch (error) { /* 读坏了就继续用上一份 */ }
        }
        return 缓存规则
      }
      // 1.12.70：分工作区 —— 规则里的 `workspace` 比的是「这次调用所在会话的工作区根」。
      //   会话 id 从 exec.agent 拿（agent.id / agent.session.id 两种形状都兜）；
      //   查法复用 paths.mjs 的 会话工作区()（读宿主 projcache 的 record.identity.cwd）。
      //   guard 是同步的，所以这里必须同步查 + 内存缓存（cwd 一个会话内不会变）。
      const 工作区缓存 = new Map()
      function 会话工作区Of(exec) {
        try {
          const a = exec && exec.agent
          const sid = a && (a.id || (a.session && a.session.id))
          if (!sid) return ''
          const k = String(sid)
          if (工作区缓存.has(k)) return 工作区缓存.get(k)
          const w = 会话工作区(k) || ''
          if (工作区缓存.size > 500) 工作区缓存.clear() // 防长期跑涨内存
          工作区缓存.set(k, w)
          return w
        } catch (error) { return '' }
      }
      ctx.tools.guard(造守卫(当前拦截规则, diag, 3, 会话工作区Of))
      diag('  工具拦截已挂载（规则 ' + 当前拦截规则().length + ' 条；改配置文件即生效，不需要重启）')
    } else {
      diag('  工具拦截：当前上下文没有 tools.guard，跳过挂载')
    }
  } catch (error) {
    diag('  工具拦截挂载失败：' + ((error && error.message) || error))
  }

  // 开关默认改成「关」了，先把老配置搬一次家（存过记忆的会话留开）✓
  migrateSwitch()

  // ⭐ 1.12.64（经历 / 梗）：空闲到达就离线提取。
  //   为什么这里破例开 setInterval（库里别处一律挂在「收到消息」上）：
  //   要触发的恰恰是**没有消息**的时候 —— 挂在消息事件上永远等不到那一下。
  //   踩过的坑写在这里：插件卸载后定时器容易漏清，所以 unref 掉；
  //   而且整轮扫描包在 try 里，一个会话抛错不能把定时器打死。
  async function 扫经历一轮() {
    const 现在 = Date.now()
    const 水位 = 读水位()
    for (const [sid, 活] of 会话活动) {
      try {
        const agent = 活 && 活.agent
        if (!agent || !agent.session || typeof agent.session.snapshotEvents !== 'function') continue
        const ev = agent.session.snapshotEvents() || []
        const 记 = 水位[sid] || {}
        const { 文本, 到seq, 用户数 } = 挑对话(ev, 记.seq, textOfMessage)
        // 失败冷却：模型报错时水位不推进，但也不能每 5 分钟重试一次烧 token
        const 上次试 = Number(记.上次尝试) || 0
        if (上次试 && 现在 - 上次试 < 30 * 60000) continue
        if (!该提取(记, { 最后活动: 活.最后活动, 现在, 最新seq: 到seq, 新增用户数: 用户数 })) continue
        diag('  经历提取：' + String(sid).slice(0, 8) + ' 安静够 ' + 空闲分钟 + ' 分钟了，' + 用户数 + ' 条主人话')
        水位[sid] = { ...记, 上次尝试: 现在 }
        写水位(水位)
        const r = await 提取一次(ctx, agent, 文本)
        if (!r || !r.ok) {
          diag('  经历提取失败：' + ((r && r.message) || '？'))
          continue
        }
        if (!r.候选.length) {
          // ⚠ 没东西可记也必须推进水位 —— 否则这同一段会被反复重提，天天烧一遍
          diag('  经历提取：这段没有值得记的（正常）')
          水位[sid] = { seq: 到seq, 用户数, 上次提取: 现在 }
          写水位(水位)
          continue
        }
        const d = loadStore(sid)
        if (!d || !Array.isArray(d.memories)) continue
        const 已有 = new Set(d.memories.map((m) => String((m && m.text) || '').replace(/\s+/g, '')))
        let 加了 = 0
        for (const c of r.候选) {
          const 键 = String(c.text).replace(/\s+/g, '')
          if (已有.has(键)) continue
          d.memories.push(造条目(c, { now: 现在, 会话id: sid }))
          已有.add(键)
          加了++
        }
        if (加了) {
          saveStore(sid, d)
          diag('  经历提取：落库 ' + 加了 + ' 条（' + r.候选.map((c) => c.kind).join('/') + '）')
        }
        水位[sid] = { seq: 到seq, 用户数, 上次提取: 现在 }
        写水位(水位)
      } catch (error) {
        diag('  经历提取出错（不影响对话）：' + ((error && error.message) || error))
      }
    }
  }
  // 启动先补扫一次：桌面关掉时错过的那些会话，下一次开机就该补上。
  // 推迟 20 秒，别跟启动时的词表装载/模型初始化抢 CPU。
  setTimeout(() => {
    void 扫经历一轮()
  }, 20000).unref?.()
  const 经历定时器 = setInterval(() => {
    void 扫经历一轮()
  }, 扫描分钟 * 60000)
  if (typeof 经历定时器.unref === 'function') 经历定时器.unref()

  function mountFor(agent, sid) {
    // ⭐ 在这个 agent 自己的上下文上监听 —— 只会收到「这个会话」的消息 ✓
    // ⚠⚠ 事件名踩过的坑：DSH 里**没有** `user/message` / `assistant/message` 这两个 Cordis 事件 ✗
    //   `user/message` / `assistant/message` 是 **SessionEvent 的 type**（走 `session/event`），
    //   而 agent 作用域上真正能收到的是 `agent/inbox/inserted` 和 `agent/turn-stopping` ✓
    //   （上一版挂了两个不存在的事件，所以线索一直是慢一轮的快照、consumed 也永远不触发）
    let lastText = ''
    // ⭐ 1.12.81：同一句输入的注入结果缓存（{ 键, 值 }），收到新消息时清空
    let 注入缓存 = { 键: '', 值: null }
    let 回合起 = 0 // 这一轮从什么时候开始（候选钩子要判「本回合记没记过」）
    // ⭐ 1.12.0 归档闸门用：攒下来的用户原话（只在内存里，重启就没了 —— 归档本来就是「24h + 10 条」才动）
    const 最近话 = []
    let probed = false
    // ⭐ 1.12.46：自动整理（存量重复自查自合）的并发闸
    let 整理中 = false
    let 梦过中 = false
    let 陈旧查过中 = false
    // ⭐ 2026-11-15（P1-1）：收到消息时**异步预热**查询向量。
    //   不能等 text() 里再算 —— 那个回调是同步的（宿主签名如此），await 不了。
    //   这里先算，算完塞进表；text() 里同步取。没算完 / 返回空就退回纯词面。
    const 查询向量表 = new Map()
    try {
      agent.ctx.on('agent/inbox/inserted', (payload) => {
        const msg = payload && payload.message ? payload.message : payload
        // ⚠ 2026-11-14：这个事件不只收主人打字 —— 主动开口递进来的 (`plugin:*`)、
        //   子代理回调 (`agent-message` / `subagent-settled`) 也走这里。不过滤的话
        //   它们会被当成「用户原话」：刷新 lastText / 喂候选区 / 攒进最近话，
        //   真库上已经逮到一条整段助手口气的「建议：不换……」躺在 `_candidates.json` 里。
        if (!是主人说的(msg)) {
          diag('  跳过非主人消息（' + String((msg && msg.source && msg.source.kind) || '?') + '）')
          return
        }
        const txt = textOfMessage(msg)
        if (txt) {
          lastText = txt
         注入缓存 = { 键: '', 值: null } // 新一句进来了，上一条的注入结果作废
          回合起 = Date.now()
          记一句话(sid, txt) // ⭐ 喂给「她自己怎么说话」那把尺子（治太敏感用）✓
          if (最近话.length < 200) 最近话.push(txt)
          // ⭐ 1.12.64：经历/梗提取的活动时钟。只记「主人说了话」的时间，
          //   定时器拿它判「这段对话是不是安静够了」。agent 也一起存 —— 提取时要
          //   用它拿 snapshotEvents（会话关掉以后拿不到，只能靠下次启动补扫）。
          会话活动.set(sid, { 最后活动: Date.now(), agent })
          diag('  收到本会话消息：' + txt.length + ' 字')
          // 语义路预热：算好了 text() 就有得用，算不好也不阻塞（catch 掉）
          if (语义开()) {
            const 本句 = txt
            取查询向量(本句)
              .then((v) => {
                if (v && lastText === 本句) 查询向量表.set(sid, { 文本: 本句, 向量: v })
              })
              .catch((error) => diag('  语义向量算失败：' + (error && error.message)))
          }
        }
        // ⭐ 1.12.46 自动整理：存量里已经重复的条目，自己查、自己合（24h 一次）。
        //   为什么挂在这个事件上：收到消息是唯一稳定发生的时机，而且天然错峰；
        //   不开 setInterval —— 插件卸载后定时器容易漏清，留着是个隐患。
        //   推迟 3 秒：别跟这一轮的首字延迟抢时间；整理本身只扫几百条，几十毫秒。
        //   ⚠ 只合「真重复（短条的内容长条全有）」，汇总型一概不碰 —— 见 lib/dedupe.mjs。
        if (!整理中 && 该整理了(24)) {
          整理中 = true
          const 本sid = sessionIdOf(agent.session)
          setTimeout(() => {
            try {
              const d = 本sid ? loadStore(本sid) : null
              if (d && Array.isArray(d.memories)) {
                const { 明细, 扫过 } = 找可合的(d)
                if (明细.length) {
                  const { 记录, 省下 } = 执行合并(d, 明细)
                  saveStore(本sid, d)
                  记整理结果(记录, 省下)
                  diag('  自动整理：' + 扫过 + ' 条里合了 ' + 记录.length + ' 对，省 ' + 省下 + ' 字')
                } else {
                  记整理结果([], 0) // 记一笔「跑过了」，免得每条消息都重扫一遍
                  diag('  自动整理：' + 扫过 + ' 条里没有可合的')
                }
              }
            } catch (error) {
              diag('  自动整理失败：' + (error && error.message))
            } finally {
              整理中 = false
            }
          }, 3000)
        }
        // ⭐ 1.12.58 自动 dream：24h 一次，自己来看一眼库里有没攒出跨天规律。
        //   为什么挂自动：dream 是跨时间归纳，料要慢慢攒；靠人手点没人记得点，
        //   而且前三版手动跑全是 0 条 —— 更需要它自己定期来看，等料够了自动抓出来。
        //   产出 0 条就只记一笔日志，不打扰主人；有产出才是 candidate（还得人点头）。
        if (!梦过中 && 该归纳了(24)) {
          梦过中 = true
          const 本sid梦 = sessionIdOf(agent.session)
          setTimeout(() => {
            void (async () => {
              try {
                const d = 本sid梦 ? loadStore(本sid梦) : null
                if (!d || !Array.isArray(d.memories)) return
                const 主 = ctx.agents && ctx.agents.list ? ctx.agents.list()[0] : null
                if (!主) return
                const r = await 归纳一次(ctx, 主, d)
                if (r && r.ok && r.候选 && r.候选.length) {
                  const 记录 = 落库(r.候选)
                  diag('  自动 dream：产出 ' + r.候选.length + ' 条，落库 ' + 记录.length + ' 条')
                  记归纳结果(记录.length, (r.问题 || []).length)
                } else {
                  记归纳结果(0, (r && r.问题 ? r.问题.length : 0))
                  diag('  自动 dream：这次没找到站得住的规律（正常，料还没攒够）')
                }
              } catch (error) {
                diag('  自动 dream 失败：' + (error && error.message))
              } finally {
                梦过中 = false
              }
            })()
          }, 5000)
        }
        // ⭐ 1.12.74 陈旧检查：24h 一次，扫记忆正文里的路径「现在还存不存在」。
        //   为什么和 dream 分开：dream 要调模型归纳规律（可能误报、要花 token），这条
        //   是 fs 判定（existsSync 说在就在、不在就不在，不调模型），成本与确定性不在
        //   一个量级；混在一个定时器里会互相拖累，也分不清日志是谁的（Gemini 评审）。
        //   产出只进 `_stale.json` 的待确认清单，**不自动改任何记忆** —— 人在页面上点
        //   「历史属实」才算数。推迟 8 秒：和整理（3s）、dream（5s）错开，别抢首字。
        if (启用陈旧检查 && !陈旧查过中 && 该查陈旧了(loadCfg())) {
          陈旧查过中 = true
          setTimeout(() => {
            try {
              // 1.12.75：扫**所有层**（全局 + 每个工作区 + 每个会话），不只当前会话那一层。
              //   原来用 loadStore(本sid) 只合并了 global + 该 sid 的 ws/session，别的层看不见。
              const 记忆们 = 全库记忆()
              if (记忆们.length) {
                const r = 陈旧查一次(记忆们, new Date())
                const c = loadCfg()
                c._上次陈旧检查 = Date.now()
                saveCfg(c)
                if (r && r.ok) diag('  陈旧检查：待确认 ' + r.待确认数 + ' 条（见 _stale.json）')
              }
            } catch (error) {
              diag('  陈旧检查失败：' + (error && error.message))
            } finally {
              陈旧查过中 = false
            }
          }, 8000)
        }
      })
    } catch (error) {
      diag('  监听 agent/inbox/inserted 失败：' + (error && error.message))
    }

    // ⭐⭐ 1.12.52（记忆使用效率）：回答说出口之后，回头看一眼「刚注入的那几条有没有真被用上」。
    //   背景：`用上了()` 这个判定函数 2026-10 就写好了，设置页「会话详情」里也有
    //   「像是用上了」这一栏 —— 但**从来没有任何地方调用它**，于是那一栏永远是空的。
    //   为什么挂 session/event 而不是 turn-stopping：turn-stopping 那一刻回答可能还没落进
    //   事件流，而 `assistant/message` 正好是「这句话真的说出口了」的瞬间。
    //   ⚠ 这是**猜的**（实词重合），所以状态叫 consumed、界面写「像是用上了」，不写成事实。
    try {
      agent.ctx.on('session/event', (session, event) => {
        try {
          if (!event || event.type !== 'assistant/message') return
          const 段 = Array.isArray(event.data && event.data.content) ? event.data.content : []
          const 文 = 段
            .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
            .map((c) => c.text)
            .join('\n')
            .trim()
          if (!文) return
          const 最近 = 读追溯(sid, 1)
          const 最后 = 最近[最近.length - 1]
          const 注入过 = ((最后 && 最后.picked) || []).map(String)
          if (!注入过.length) return
          const 库 = loadStore(sid).memories
          const 用了 = []
          for (const id of 注入过) {
            const m = 库.find((x) => String(x.id) === id)
            if (!m) continue
            if (用上了(文, String(m.text || ''))) 用了.push(id)
          }
          if (用了.length) 标最近一轮(sid, 用了, 'consumed')
          diag('  使用判定：注入 ' + 注入过.length + ' 条，像用上 ' + 用了.length + ' 条')
        } catch (error) {}
      })
    } catch (error) {
      diag('  session/event 监听挂不上：' + (error && error.message))
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
                // ⭐ 2026-11-15（P1-1）：新条目的向量异步补算，下次召回语义路才用得上。
                //   算失败无所谓（下次再算），绝不能拖慢/打断这一轮。
                if (语义开()) {
                  try {
                    const 存后 = loadStore(sid)
                    取向量(存后.memories, CFG_DIR).catch(() => {})
                  } catch (error) {}
                }
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
      text: (() => {
        // ⭐ 1.12.81（2026-11-22）：同一句输入只算一次注入。
        //   病根：宿主 RuntimeContextProjection 只在 sections 逐字节不同时才追加快照，
        //   而这段 text 每次组装提示词都重算 → 同一轮里 memory 抖一下就是一条新快照，
        //   真机一个 turn 追加过 11 条（memory 段只有 3 个版本在循环）。
        //   缓存键 = 输入原话 + 暂停状态；收到新消息时清空（见 agent/inbox/inserted）。
        const 原算 = () => {
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
          // ⭐ 1.12.50（2026-11-18）：宿主每轮会先塞两种**不是主人说的话**进来 —— runtime-context
          //   快照（「Current runtime context. …」）和时间戳（「Time sampled while preparing turn …」）。
          //   实测 13,536 轮 trace 里有 2,221 轮（16.4%）的 query 就是这两类：召回拿这种字符串去分词，
          //   搜出来的记忆跟当轮真实输入零关系，等于那些轮次白注入噪声（还占额度）。
          //   命中就直接跳过本轮回注入 —— 这一轮本来也没有人在跟说话。
          if (/^(Current runtime context\.|Time sampled while preparing|Current time is|\[time\])/i.test(query)) {
            diag('  query 是宿主注入的上下文，跳过本轮注入：' + query.slice(0, 40))
            return ''
          }
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
          // ⭐ 2026-11-15（P1-1）：语义路。查询向量（inbox 钩子预热）和记忆向量（缓存）都就绪才算，
          //   否则传 null —— recall 内部会退回纯词面，行为跟 1.12.40 完全一致。
          let 语义映射 = null
          if (语义开()) {
            try {
              const 预 = 查询向量表.get(sid)
              if (预 && 预.文本 === query) 语义映射 = 相似度表(预.向量, data.memories, CFG_DIR)
            } catch (error) {
              diag('  语义相似度算失败：' + (error && error.message))
            }
          }
          const { selected, scored, gate } = recall(data, query, now, sid, selfNameOf(sid), 语义映射)
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
                字: 净长(注入文本),
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
            // ⭐ 1.12.60：这里的「字」是**估计口径**（URL / Windows 路径不占字），
            //   实际注入的原文会比它长 —— 主人明确接受这个偏差。
            //   想看真实长度可以用 `实字`。
            字: 净长(注入文本),
            实字: 注入文本.length,
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
          //   ⭐ 1.12.62：带上注入账本，让同分条目按「谁最久没露过面」轮换
          //   （importance 默认全 0.5，不轮换就是新的永远压旧的、老条目被饿死）。
          const 项目上下文 = render项目上下文(data.memories, undefined, 项目注入账本, now)
          // （注入文本在上面就算好了：1.10.3 起 trace 里要记它多少字）
          // ⭐ 2026-10-22 她要能看见「这一轮到底注入了什么」：
          //    搬到官方桌面端之后界面上看不到了，那就写进 diag.log，一眼能翻。
          //    只记一行、截断 400 字，不占空间。
          try {
            diag('骨架 ' + 骨架文本.length + ' 字：' + (骨架文本 || '（无）').split(String.fromCharCode(10)).join(' ⏎ ').slice(0, 200))
            diag('注入 ' + selected.length + ' 条：' + (注入文本 || '（空）').split(String.fromCharCode(10)).join(' ⏎ ').slice(0, 400))
          } catch (error) {}
          // ⭐ 1.12.41（临场提醒）：主人在体检页写的一段固定文字，**拼在最后**。
          //   为什么最后：越贴近生成点越管用（自检也在注入之后，同理）。
          //   它不占 maxItems、不占 maxChars、不参与打分 —— 纯附加，
          //   空着的时候一个字都不多花（拼记忆块 会把它过滤掉）。
          const 临场提醒 = 取临场提醒()
          if (临场提醒) {
            try {
              diag('临场提醒 ' + 临场提醒.length + ' 字（拼在最后）')
            } catch (error) {}
          }
          // ⭐ 1.12.55（模式层）：每轮**最多一条**行为模式，且只走条件路由。
          //   为什么最多一条：一条完整模式（触发 + 规律 + 策略）要 80~120 字，
          //   无脑塞 2~3 条就是 30~40% 的 800 字预算，把真该召回的挤没了。
          //   为什么只认 tentative / verified：candidate 是「我的一点猜测」，
          //   还没经人点头，不该影响说话方式。
          const 模式文本 = (() => {
            try {
              const m = 取匹配模式(判意图(query), query, new Date(now))
              if (!m) return ''
              记命中(m.id)
              diag('模式 ' + m.id + '（' + m.status + '）命中：' + String(m.text || '').slice(0, 60))
              return 渲染模式(m)
            } catch (error) {
              return '' // 模式层坏了也不能影响对话
            }
          })()
          return 拼记忆块({ 骨架: 骨架文本, 项目上下文, 注入: 注入文本, 自检: 自检文本, 模式: 模式文本, 临场提醒 })
        } catch (error) {
          return '' // 记忆坏了也不能影响对话
        }
        }
        return () => {
          const 键 = (lastText || lastUserTextOf(agent.session)) + '\u0000' + String(暂停到(sid) || '')
          if (注入缓存.键 === 键) {
            diag('  注入命中同句缓存，不再重算')
            return 注入缓存.值
          }
          const 值 = 原算()
          注入缓存 = { 键, 值 }
          return 值
        }
      })(),
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
        工具off = [makeRememberTool(ctx), makeForgetTool(ctx), makeRecallTool(ctx), makeSearchTool(ctx), makeTraceTool(ctx), makeSuppressTool(ctx)].map((t) => ctx.tools.register(t))
        工具在 = true
        diag('工具挂上了（remember / forget / recall / search / trace / suppress）')
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
    // 1.12.77：跨站防护 —— 恶意网页可以对 127.0.0.1 发 no-cors 请求，响应虽然读不到，
    // 副作用照样发生（改记忆、触发扫描）。只比主机名不比端口：同机前端跨端口部署本来就是
    // 同源场景，不能误伤；没有 Origin/Referer 的本机脚本和 curl 也不拦。
    const 跨站请求 = (req) => {
      const 头 = (req && req.headers) || {}
      const 源 = 头.origin || 头.referer
      if (!源) return false
      let 主名 = ''
      let 本名 = ''
      try { 主名 = new URL(String(源)).hostname } catch (error) { return false }
      try { 本名 = new URL('http://' + String(头.host || '')).hostname } catch (error) { return false }
      if (!主名 || !本名) return false
      return 主名.toLowerCase() !== 本名.toLowerCase()
    }

    const mroute = (path, handler) =>
      ctx.effect(() =>
        ctx.webServer.register({
          kind: 'exact',
          path: path,
          handler: async (req, res) => {
            try {
              if (跨站请求(req)) {
                res.writeHead(403, { 'content-type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: '拒绝了跨站请求（Origin/Referer 与 Host 不一致）' }))
                return
              }
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
    // ⭐ 1.12.78：兼容性自检。核心难点是「服务快照只能在 apply 里取」——apply 返回后 ctx
    //   变 inactive，再访问 ctx.llm 会抛 `cannot get required service "llm" in inactive
    //   context`（1.12.67 踩过）。所以这里当场把八个服务探一遍存成快照；读库这种随时能重跑
    //   的动作则放进闭包现跑。判据不是「有没有报错」而是「该发生的事最近发生过没有」——
    //   事件被改名时插件不崩不报错，只是那件事永远不发生（1.12.66 前 dream 静默失败三天）。
    const 服务快照 = (() => {
      const 名们 = ['systemPrompt', 'agents', 'timer', 'tools', 'webServer', 'sessions', 'sessionTitle', 'llm']
      const 表 = {}
      for (const 名 of 名们) {
        try { 表[名] = !!(ctx[名] !== undefined && ctx[名] !== null) } catch (error) { 表[名] = false }
      }
      return 表
    })()

    let 代理服务 = null
    try {
      if (ctx.agents && typeof ctx.agents.list === 'function') 代理服务 = ctx.agents
    } catch (error) {}

    const 记忆探针 = () => {
      try {
        const d = loadStore(null)
        const m = d && d.memories
        if (!m) return { ok: false, 说明: '读库拿到了对象但没有 memories 字段（库结构可能变了）' }
        const 条 = Array.isArray(m) ? m.length : Object.keys(m).length
        return { ok: true, 说明: '读库正常：' + 条 + ' 条' }
      } catch (error) {
        return { ok: false, 说明: '读库抛错：' + String((error && error.message) || error).slice(0, 160) }
      }
    }

    const 自检 = () => {
      const 项 = 跑自检浅检({
        服务: 服务快照,
        cfg: loadCfg(),
        行们: 读自检日志(),
        现在: Date.now(),
        库文件们: 自检库文件们({ 含陈旧: 启用陈旧检查 }),
        探针: 记忆探针,
        经历: 读自检经历(),
      })
      return { ok: true, 兜底: false, 服务快照: 服务快照, 上次检查: new Date().toISOString(), ...项 }
    }

    const 环 = { ctx, 代理服务, 读JSON体, mounted, tick, 同步工具, 自查更新, 路径在允许范围, 自检 }
    注册核心路由(mroute, 环)
    注册管理路由(mroute, 环)
    注册生成路由(mroute, 环)
    注册回复体检路由(mroute, 环)
    if (启用工具拦截) 注册拦截路由(mroute, 环) // 2026-11-21：工具拦截（读/存/干跑）
 if (启用陈旧检查) 注册陈旧路由(mroute, 环) // 1.12.74：陈旧检查（清单/处置/手动扫）
  注册自检路由(mroute, 环) // 1.12.78：兼容性自检（浅检/深度检）
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
