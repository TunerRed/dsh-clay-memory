// lib/routes-guard.mjs —— 工具拦截（1.12.70 起）的设置页路由
// ============================================================================
// 三条路由，全部只读写 clay-memory-config.json 的 `toolGuard` 那一块：
//   GET  /dsh-clay-memory/guard       读当前配置 + 可用的工作区列表 + 规则编译错误
//   POST /dsh-clay-memory/guard       保存（坏规则**整批拒收**，返回逐条错误）
//   POST /dsh-clay-memory/guard/test  干跑一次：给「工具名 + 参数 + 工作区」，看会命中哪条
//
// 为什么要「干跑」：正则里转义的坑太多（`[\\/]` 只匹配正斜杠这种），
// 用户写完根本不知道会不会命中。页面上填个假参数就能当场验证，比让他去猜强。
//
// 这里的规则**全部来自用户**：插件不内置任何一条，也不替用户预填默认值。
// ============================================================================
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadCfg, saveCfg } from './cfg.mjs'
import { 编译规则组, 找命中, 一条命中, 规范工作区, 取规则 } from './guard.mjs'
import { 宿主数据根 } from './paths.mjs'
import { 问模型 } from './llm.mjs'
import { 逐条抠 } from './dream.mjs'

// 扫宿主 projcache 里出现过的会话 cwd —— 这就是「实际用过的工作区」列表。
// 结果缓存 60 秒：页面刷新几次没必要每次都把几百个 session 文件读一遍。
let 工作区缓存 = { at: 0, 值: [] }

export function 可用工作区们(刷新 = false) {
  const 现在 = Date.now()
  if (!刷新 && 工作区缓存.值.length && 现在 - 工作区缓存.at < 60 * 1000) return 工作区缓存.值
  const 出 = new Map()
  try {
    const 目录 = join(宿主数据根(), 'session_projcache', 'sessions')
    if (existsSync(目录)) {
      for (const 名 of readdirSync(目录)) {
        if (!名.endsWith('.json')) continue
        try {
          const j = JSON.parse(readFileSync(join(目录, 名), 'utf8'))
          const cwd = j && j.record && j.record.identity && j.record.identity.cwd
          const 规 = typeof cwd === 'string' ? cwd.trim() : ''
          if (!规) continue
          const k = 规范工作区(规)
          if (!出.has(k)) 出.set(k, 规)
        } catch (error) { /* 单个会话读坏不影响列表 */ }
      }
    }
  } catch (error) { /* 目录不在就空列表 */ }
  const 值 = [...出.values()].sort((a, b) => a.localeCompare(b))
  工作区缓存 = { at: 现在, 值 }
  return 值
}

/** 读当前 toolGuard 配置（不做编译，原样给页面回显）。 */
export function 读拦截配置() {
  const c = loadCfg() || {}
  const 区 = c.toolGuard && typeof c.toolGuard === 'object' ? c.toolGuard : {}
  return {
    enabled: 区.enabled === true, // 没写 = 关（跟取规则() 的「没写当开」不同：页面回显要老实）
    rules: Array.isArray(区.rules) ? 区.rules : [],
  }
}

/** 保存 toolGuard：先编译校验，有一条坏的就整批拒收（避免「看着存上了、实际没生效」）。 */
export function 写拦截配置(体) {
  const 源 = 体 && typeof 体 === 'object' ? 体 : {}
  const raws = Array.isArray(源.rules) ? 源.rules : []
  if (raws.length > 200) return { ok: false, error: '规则太多了（上限 200 条）' }
  const { 规则们, 错误 } = 编译规则组(raws)
  if (错误.length) return { ok: false, error: '有 ' + 错误.length + ' 条规则写坏了，一条都没保存：', 错误 }
  // 额外校验：args 里的正则能不能编译。编译规则组只存不验，这里替用户先验一遍。
  const 正则错 = []
  for (let i = 0; i < 规则们.length; i++) {
    const 规 = 规则们[i]
    if (!规.args) continue
    for (const 键 of Object.keys(规.args)) {
      const 表 = Array.isArray(规.args[键]) ? 规.args[键] : [规.args[键]]
      for (const r of 表) {
        if (typeof r !== 'string') continue
        try { new RegExp(r) } catch (e) {
          正则错.push('[' + 规.id + '] 参数 ' + 键 + ' 的正则编译不过：' + ((e && e.message) || e))
        }
      }
    }
  }
  if (正则错.length) return { ok: false, error: '有正则写坏了，一条都没保存：', 错误: 正则错 }
  const c = loadCfg() || {}
  c.toolGuard = { enabled: 源.enabled === true, rules: raws }
  saveCfg(c)
  return { ok: true, 保存了: raws.length }
}

/**
 * 干跑：拿一组规则（默认用已存的）配上「工具名 + 参数 + 工作区」，看会不会命中。
 * 不落盘、不影响真实拦截。
 */
export function 试拦一次(体) {
  const 源 = 体 && typeof 体 === 'object' ? 体 : {}
  const 用草稿 = Array.isArray(源.rules)
  const { 规则们, 错误 } = 用草稿
    ? 编译规则组(源.rules)
    : { 规则们: 取规则(loadCfg()).规则们, 错误: [] }
  const 工具 = String(源.tool || '').trim()
  if (!工具) return { ok: false, error: '要填工具名（比如 read / write / bash）' }
  const 参数 = 源.args && typeof 源.args === 'object' ? 源.args : {}
  const 工作区 = typeof 源.workspace === 'string' ? 源.workspace : ''
  const exec = { name: 工具, arguments: 参数 }
  const 中 = 找命中(规则们, exec, 工作区)
  // 顺带告诉页面「每条规则各自命没命中」，方便一条条排查
  const 逐条 = 规则们.map((规) => ({
    id: 规.id,
    中: !!一条命中(规, exec, 工作区),
    workspace: 规.workspace || null,
  }))
  return {
    ok: true,
    拦不拦: !!中,
    命中的: 中 ? { id: 中.id, reason: 中.reason } : null,
    条数: 规则们.length,
    逐条,
    错误,
    工作区: 工作区 || '',
  }
}

// ── 自然语言 → 规则（1.12.72）────────────────────────────────────────────
// 「把一句话翻成规则」这一步可以问模型；**执行的时候不行** ——
// guard 是同步热路径，每次工具调用都当场判一次，塞不进模型推理（会把每个工具调用拖慢，
// 还可能在 deny 判定里卡住）。所以自然语言只负责「翻译」，翻完必须给人看过
// （页面上的干跑测试 + 手动确认）才存 —— 翻歪了要在存之前就能看出来。
//
// 为什么不让模型直接执行「语义判断」：拦截是硬规则，必须是确定的、可复现的、
// 不花钱的。模型只用在「一次性把话翻成规则」上。

export function 翻译系统() {
  const NL = String.fromCharCode(10)
  return [
    '你把用户的一句中文要求，翻译成「工具拦截规则」的 JSON 数组。',
    '用户装的是一个 AI 助手的插件；规则的作用是：助手想调用某个工具时，命中就当场拦下、不让执行。',
    '',
    '每条规则长这样：',
    '{"id":"名字","tools":["read","write"],"args":{"file_path":["正则"]},"workspace":"工作区","reason":"拦下时给助手看的一句话"}',
    '',
    '字段说明：',
    '- id：短名字，中文或英文都行，别重复。',
    '- tools：工具名数组。常见工具：read(读文件)、write(写文件/新建)、edit(改文件)、bash(跑命令)、',
    '  grep(搜文件内容)、glob(按名字找文件)、web_fetch(抓网页)、web_search(搜网)。',
    '  支持通配："*" = 全部工具；"bash*" = 所有名字以 bash 开头的工具。',
    '  shell 类工具（跑命令）不同版本叫法不同：bash / pwsh / powershell / ops_bash / sh，',
    '  写 "bash*" 或 "shell*" 都能一次覆盖这一族，不用逐个列。',
    '- args：可选，{参数名: [正则]}。键之间是「且」（都要命中），同一个键里多个正则是「或」。',
    '  参数没出现就不算命中（宁可少拦）。正则用 JS 语法。',
    '  要匹配路径分隔符（反斜杠或斜杠都算）时写成 [\\\\\\\\/]；拿不准就用 .* 顶，宁可宽也别写坏。',
    '- workspace：可选，只在某个工作区里生效，比的是会话的工作区根目录（如 G:\\DSH_WORKSPACE\\需求开发）。',
    '  支持前缀通配 "G:\\DSH_WORKSPACE\\*"；不写 = 所有工作区。',
    '- reason：一句话说明为什么拦，助手会看到。',
    '',
    '⚠ 这套规则**只能表达「拦什么」，表达不了「除了某处以外都放行」**。',
    '  用户要是说「除了我的项目目录，别处别读」，就翻成「拦他明确提到的危险位置」（如 Windows 目录），',
    '  并在 reason 里点明「只拦了明确提到的位置，其它没管」。',
    '⚠ 一句话能翻成一条就别拆成三条；但明显是两件不相干的事，就翻成两条。',
    '⚠ 话里没有可拦的动作（闲聊、或要求本身不涉及工具），回 []。',
    '⚠ 只回 JSON 数组，不要解释，不要 ```json 围栏。',
  ].join(NL)
}

/** 把模型回的文字解成规则数组。纯函数，不碰网络、不碰配置。 */
export function 解析翻译(文本) {
  let s = String(文本 || '').trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  if (!s) return { ok: false, error: '模型一个字都没回' }
  const 起 = s.indexOf('[')
  const 止 = s.lastIndexOf(']')
  if (起 < 0) return { ok: false, error: '模型没按格式回 JSON 数组', 原文: s.slice(0, 400) }
  if (止 <= 起) {
    const 救 = 逐条抠(s)
    if (救.length) return { ok: true, 规则们: 救, 截断: true }
    return { ok: false, error: '模型的 JSON 没写完，一条完整的也没抠出来', 原文: s.slice(0, 400) }
  }
  let 原
  try {
    原 = JSON.parse(s.slice(起, 止 + 1))
  } catch (e) {
    const 救 = 逐条抠(s)
    if (救.length) return { ok: true, 规则们: 救, 截断: true }
    return { ok: false, error: '模型的 JSON 不合法：' + ((e && e.message) || e), 原文: s.slice(0, 400) }
  }
  if (!Array.isArray(原)) return { ok: false, error: '模型回的不是数组', 原文: s.slice(0, 400) }
  return { ok: true, 规则们: 原 }
}

/**
 * 问模型把一句话翻成规则。**只翻译，不保存** —— 翻出来的东西要人确认。
 * 预算 4000：deepseek-flash 是思考型，1500 这种小预算会全被 reasoning 吃光
 * （1.12.66 在 dream 上踩过，见交接文档七节坑表）。
 */
export async function 翻译一句(ctx, 文本) {
  const 话 = String(文本 || '').trim()
  if (!话) return { ok: false, error: '先写一句要求' }
  if (话.length > 500) return { ok: false, error: '这句话太长了（上限 500 字），拆成几句分别翻' }
  let agent = null
  try {
    agent = (ctx.agents && ctx.agents.list ? ctx.agents.list() : [])[0] || null
  } catch (error) { /* 没有 agent 也能翻：问模型内部会退到全局默认 */ }
  const r = await 问模型(ctx, agent, 翻译系统(), 话, 4000)
  const 用 = r && r.provider ? r.provider + '/' + r.model : ''
  if (!r || !r.ok) return { ok: false, error: '模型没回：' + String((r && r.message) || '（没给原因）'), 用 }
  const 解 = 解析翻译(r.text)
  if (!解.ok) return { ok: false, error: 解.error, 原文: 解.原文 || '', 用 }
  const { 错误 } = 编译规则组(解.规则们)
  return {
    ok: true,
    规则们: 解.规则们,
    编译错误: 错误,
    截断: !!解.截断,
    用,
    话,
  }
}

export function 注册拦截路由(mroute, 环) {
  const { 读JSON体 } = 环

  // 读配置 + 工作区列表
  mroute('/dsh-clay-memory/guard', async (req, res) => {
    const 置 = 读拦截配置()
    const { 错误 } = 编译规则组(置.rules)
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify({
      ok: true,
      enabled: 置.enabled,
      rules: 置.rules,
      工作区们: 可用工作区们(),
      编译错误: 错误,
      配置文件: 'clay-memory-config.json → toolGuard',
    }))
  })

  // 保存
  mroute('/dsh-clay-memory/guard/save', async (req, res) => {
    const 体 = await 读JSON体(req)
    const r = 写拦截配置(体)
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(r))
  })

  // 干跑
  mroute('/dsh-clay-memory/guard/test', async (req, res) => {
    const 体 = await 读JSON体(req)
    const r = 试拦一次(体)
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(r))
  })

  // 一句话 → 规则草稿（只翻译，不保存；页面会把草稿摆给人看、再手动并入）
  mroute('/dsh-clay-memory/guard/translate', async (req, res) => {
    let 体 = null
    try {
      体 = await 读JSON体(req)
    } catch (error) {
      体 = null
    }
    let r
    try {
      r = await 翻译一句(环.ctx, 体 && 体.text)
    } catch (error) {
      r = { ok: false, error: '翻译时出错了：' + String((error && error.message) || error) }
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(r))
  })
}
