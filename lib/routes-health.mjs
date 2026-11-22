// 自检路由（1.12.78）
//   GET  /dsh-clay-memory/selfcheck        浅检（零 token，毫秒级）
//   POST /dsh-clay-memory/selfcheck/deep   深度检（真发一次模型请求，验证 provider/model 通不通）
//
// 为什么浅检和深检分两个入口：浅检要能随便点、随时看；深检花 token，得是用户明确要「再确认一下」时才跑。

import { 读日志尾部, 默认库文件们, 跑浅检, 自检版本 } from './health.mjs'
import { loadCfg } from './cfg.mjs'
import { 问模型 } from './llm.mjs'

/** 浅检：把「当前事实」喂给纯判断函数。环.自检 由 index.js 注入（它才拿得到 apply 期间接住的服务）。 */
export function 浅检(环) {
  const 时刻 = new Date().toISOString()
  if (环 && typeof 环.自检 === 'function') {
    const 结果 = 环.自检()
    return { 版本: 自检版本, 上次检查: 时刻, ...结果 }
  }
  // 兜底：自检闭包没挂上（极早期或版本不匹配），至少把能查的查了
  const 项 = 跑浅检({
    cfg: loadCfg(),
    行们: 读日志尾部(),
    现在: Date.now(),
    库文件们: 默认库文件们(),
  })
  return { ok: true, 版本: 自检版本, 兜底: true, 上次检查: 时刻, ...项 }
}

/** 深度检：浅检 + 一次真实模型往返。 */
export async function 深度检(环) {
  const 浅 = 浅检(环)
  const 项们 = (浅.项们 || []).slice()
  const ctx = 环 && 环.ctx

  let 状态 = 'fail'
  let 说明 = ''
  let 细节 = ''
  try {
    let 代理 = null
    try {
      if (ctx && ctx.agents && typeof ctx.agents.list === 'function') 代理 = ctx.agents
    } catch (e1) {
      /* inactive context：退回 apply 期间接住的服务引用 */
    }
    if (!代理 && 环 && 环.代理服务 && typeof 环.代理服务.list === 'function') 代理 = 环.代理服务
    const agents = 代理 ? (代理.list() || []) : []
    const agent = agents && agents[0] ? agents[0] : null
    if (!agent) {
      说明 = '当前没有活动会话，试不了模型（这不一定是故障）'
      状态 = 'warn'
    } else {
      const 起 = Date.now()
      // 预算给足：deepseek-flash 这类思考型模型会先把预算吃在 reasoning 上（1.12.66 的教训），
      // 300 这种小预算全被思考吃掉、正文是 0 字，会误报成「模型不通」。
      const r = await 问模型(ctx, agent, '你是连通性测试。只回两个字：好用。', '连通性测试', 2000)
      const 耗时 = Date.now() - 起
      const 正文 = String((r && r.text) || '').trim()
      const 模型名 = (r && r.provider && r.model) ? r.provider + '/' + r.model : '未知'
      if (!r || !r.ok) {
        状态 = 'fail'
        说明 = String((r && r.message) || '模型调用失败') + '（' + 耗时 + 'ms）'
        细节 = 模型名 !== '未知' ? '用 ' + 模型名 : ''
      } else if (正文) {
        状态 = 'ok'
        说明 = '模型回得来：' + 正文.slice(0, 20) + '（' + 耗时 + 'ms）'
        细节 = '用 ' + 模型名
      } else {
        状态 = 'fail'
        说明 = '模型回了空正文（' + 耗时 + 'ms）—— 可能是预算被思考吃光，也可能 provider 不通'
        细节 = '用 ' + 模型名
      }
    }
  } catch (error) {
    说明 = '模型调用抛错：' + String((error && error.message) || error).slice(0, 200)
  }

  项们.push({ 名: '模型通路（深度检查）', 状态, 说明, 细节 })
  const fail = 项们.filter((x) => x.状态 === 'fail').length
  const warn = 项们.filter((x) => x.状态 === 'warn').length
  const ok = 项们.filter((x) => x.状态 === 'ok').length
  const skip = 项们.filter((x) => x.状态 === 'skip').length
  return {
    ok: true,
    版本: 自检版本,
    深度: true,
    上次检查: new Date().toISOString(),
    项们,
    统计: { 结论: fail ? 'fail' : warn ? 'warn' : 'ok', fail, warn, ok, skip, 共: 项们.length },
  }
}

// mroute 的 handler 是 (req, res)，必须自己写响应。
// 2026-11-22 真机教训：先写成 `async () => 浅检(环)`（只返回值不写响应），
// 请求就一直挂着不结束 —— curl 超时、前端 fetch 永不 resolve、按钮停在「跑着…」、
// 页面还显示「还没跑过」。单测测不出来（只测纯函数），只能 curl 真实端口才发现。
function 写JSON(res, 值) {
  const 文 = JSON.stringify(值 === undefined ? null : 值)
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(文)
}

export function 注册自检路由(mroute, 环) {
  // 路径避开 /dsh-clay-memory/health —— 那条早在 routes-core.mjs 里注册过（回复体检统计）。
  // 2026-11-22 真机教训：同名重复注册 → 后注册的这条静默失效，前端拿到的却是回复体检的 JSON，
  // 于是自检页显示「✗ 有东西坏了 / 正常 undefined」。
  mroute('/dsh-clay-memory/selfcheck', async (req, res) => {
    let r
    try {
      r = await 浅检(环)
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e) }
    }
    写JSON(res, r)
  })
  mroute('/dsh-clay-memory/selfcheck/deep', async (req, res) => {
    let r
    try {
      r = await 深度检(环)
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e) }
    }
    写JSON(res, r)
  })
}
