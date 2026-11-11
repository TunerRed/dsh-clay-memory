// 回复体检的 HTTP 路由（从 dsh-persona-growth 的 web.js action=analyze 搬来，独立挂成 clay-memory 路由）。
// GET  /dsh-clay-memory/reply-check?days=14&limit=20 —— 扫最近会话的助手发言，跑规则，返回命中与汇总
// POST /dsh-clay-memory/reply-check/rules {disabled:[...]} —— 保存规则开关
import { recentAssistantMessages } from './session-log.js'
import { analyzeBatch, ALL_RULES } from './analyze.js'
import { loadDisabled, saveDisabled } from './rules.js'

function 写JSON(res, body) {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function 注册回复体检路由(mroute, 环) {
  const { 读JSON体 } = 环

  mroute('/dsh-clay-memory/reply-check', (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1')
    const days = Math.min(60, Math.max(1, Number(u.searchParams.get('days') ?? 14) || 14))
    const limit = Math.min(80, Math.max(1, Number(u.searchParams.get('limit') ?? 20) || 20))
    try {
      const { files, messages } = recentAssistantMessages({ days, limit })
      const disabled = loadDisabled()
      const result = analyzeBatch(messages, { disabled })
      const counts = result.summary.perRule
      const rules = ALL_RULES.map((rule) => ({
        id: rule.id,
        label: rule.label,
        count: counts[rule.id] ?? 0,
        enabled: !disabled.includes(rule.id),
      })).sort((a, b) => Number(a.enabled) - Number(b.enabled) || b.count - a.count)
      写JSON(res, { ok: true, files, ...result, rules, disabled })
    } catch (error) {
      写JSON(res, { ok: false, message: String((error && error.message) || error) })
    }
  })

  mroute('/dsh-clay-memory/reply-check/rules', async (req, res) => {
    try {
      const b = await 读JSON体(req)
      const list = Array.isArray(b && b.disabled) ? b.disabled : []
      const ok = saveDisabled(list)
      写JSON(res, { ok, disabled: loadDisabled() })
    } catch (error) {
      写JSON(res, { ok: false, message: String((error && error.message) || error) })
    }
  })
}
