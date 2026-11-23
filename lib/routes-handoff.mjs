// ============================================================================
// lib/routes-handoff.mjs —— 「新会话继承语感」的路由（1.12.91）
//
//   GET  /dsh-clay-memory/handoff?sid=...     当前状态：默认模式 + 这个会话的选择 + 最近那段是谁
//   GET  /dsh-clay-memory/handoff/candidates  可选来源（最近 10 个会话 + 标题）
//   POST /dsh-clay-memory/handoff/choose      存这个会话的选择 {sid, load, from}
//   GET  /dsh-clay-memory/handoff/mode        读默认模式
//   POST /dsh-clay-memory/handoff/mode        存默认模式 {mode: 'latest'|'ask'|'off'}
//
// ⚠ 沿用 routes-backfill.mjs 的教训：mroute 的 handler **必须自己写响应**。
// ⚠ 这里**不解 zstd 归档**给前端 —— 挑会话时后台抽好（从归档取热尾）存进选择，
//   注入路径只读小 json。
// ============================================================================
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { 宿主数据根 } from './paths.mjs'
import { 读选择, 写选择, 读热尾库, 从归档取热尾 } from './handoff.mjs'

const 候选上限 = 10

function 写JSON(res, 值) {
  const 文 = JSON.stringify(值)
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(文)
}

function 问参(req) {
  try {
    return new URL(String((req && req.url) || ''), 'http://x').searchParams
  } catch (error) {
    return new URLSearchParams()
  }
}

function 是会话id(v) {
  const s = String(v || '').trim()
  return !!s && s !== '.' && s !== '..' && !/[/\\]/.test(s)
}

/** 扫会话归档目录，列出最近用过的会话（按目录 mtime）。 */
function 最近会话(上限) {
  const 根 = join(dirname(宿主数据根()), 'sessions')
  let 区们 = []
  try {
    区们 = readdirSync(根)
  } catch (error) {
    return []
  }
  const 出 = []
  for (const 区 of 区们) {
    let 名们 = []
    try {
      名们 = readdirSync(join(根, 区))
    } catch (error) {
      continue
    }
    for (const sid of 名们) {
      const 目录 = join(根, 区, sid)
      const 归档 = join(目录, 'session.v4.jsonl.zstd')
      try {
        if (!statSync(归档).isFile()) continue
        const st = statSync(归档)
        出.push({ sid, 字节: st.size, 时间: st.mtimeMs || 0 })
      } catch (error) {
        continue
      }
    }
  }
  出.sort((a, b) => b.时间 - a.时间)
  return 出.slice(0, 上限)
}

export function 注册热尾路由(mroute, 环) {
  const 取模式 = () => {
    try {
      return typeof 环.热尾模式 === 'function' ? String(环.热尾模式() || 'latest') : 'latest'
    } catch (error) {
      return 'latest'
    }
  }

  // ① 状态
  mroute('/dsh-clay-memory/handoff', async (req, res) => {
    let r
    try {
      const sid = String(问参(req).get('sid') || '').trim()
      const 包 = 读热尾库()
      const 选 = 是会话id(sid) ? 读选择(sid) : null
      const 最近标题 = 包.lastSid ? 会话标题(环.ctx, 包.lastSid) : ''
      r = {
        ok: true,
        模式: 取模式(),
        最近: 包.lastSid ? { sid: 包.lastSid, 轮数: 包.turns.length, 标题: 最近标题 } : null,
        选择: 选 ? { load: 选.load, from: 选.from, 轮数: 选.turns.length } : null,
      }
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e) }
    }
    写JSON(res, r)
  })

  // ② 可选来源
  mroute('/dsh-clay-memory/handoff/candidates', async (req, res) => {
    let r
    try {
      const 包 = 读热尾库()
      const 列 = 最近会话(候选上限).map((x) => ({
        sid: x.sid,
        标题: 会话标题(环.ctx, x.sid) || '(没有标题)',
        时间: x.时间,
        是热尾: x.sid === 包.lastSid,
      }))
      r = {
        ok: true,
        模式: 取模式(),
        最近: 包.lastSid ? { sid: 包.lastSid, 轮数: 包.turns.length, 标题: 会话标题(环.ctx, 包.lastSid) } : null,
        候选: 列,
      }
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e) }
    }
    写JSON(res, r)
  })

  // ③ 存选择
  mroute('/dsh-clay-memory/handoff/choose', async (req, res) => {
    let r
    try {
      const 体 = (环 && typeof 环.读JSON体 === 'function' ? await 环.读JSON体(req) : {}) || {}
      const sid = String(体.sid || '').trim()
      if (!是会话id(sid)) {
        r = { ok: false, error: '要给我『sid』（哪条新会话的选择）' }
      } else {
        const load = 体.load !== false
        const from = String(体.from || '').trim()
        let turns = []
        if (load && from && 是会话id(from)) {
          // 只有「挑一个以前的会话」才需要抽归档；抽不到就给空（前端可以提示）
          turns = 从归档取热尾(from)
        }
        写选择(sid, { load, from: load ? from : '', turns })
        r = { ok: true, load, from: load ? from : '', 轮数: turns.length }
      }
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e) }
    }
    写JSON(res, r)
  })

  // ④ 默认模式（设置页里选）
  mroute('/dsh-clay-memory/handoff/mode', async (req, res) => {
    let r
    try {
      const 体 = (环 && typeof 环.读JSON体 === 'function' ? await 环.读JSON体(req) : {}) || {}
      const 给了 = Object.prototype.hasOwnProperty.call(体, 'mode')
      if (给了) {
        if (typeof 环.set热尾模式 !== 'function') r = { ok: false, error: '这个版本没有设置入口' }
        else r = { ok: true, 模式: String(环.set热尾模式(体.mode) || 'latest') }
      } else {
        r = { ok: true, 模式: 取模式() }
      }
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e) }
    }
    写JSON(res, r)
  })
}

/** 会话标题：拿得到就给，拿不到给空串（不抛）。 */
export function 会话标题(ctx, sid) {
  try {
    const 服务 = ctx && ctx.sessionTitle
    const 会话 = ctx && ctx.sessions && typeof ctx.sessions.get === 'function' ? ctx.sessions.get(sid) : null
    if (服务 && 会话 && typeof 服务.get === 'function') {
      const snap = 服务.get(会话)
      const t = snap && snap.title ? String(snap.title).trim() : ''
      if (t) return t
    }
  } catch (error) {
    /* 落到下面读投影缓存 */
  }
  // 会话没加载（历史会话）→ 读投影缓存里的标题
  try {
    // ⚠ 宿主数据根() 已经指到 .../storages 这一层，别再拼一次（拼了会静默拿不到标题）
    const p = join(宿主数据根(), 'session_projcache', 'sessions', sid + '.json')
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, 'utf8'))
      const t = j && j.record && j.record.rows && j.record.rows.title && j.record.rows.title.val
      if (typeof t === 'string' && t.trim()) return t.trim()
    }
  } catch (error) {
    /* 没有标题就没有，交给前端显示 sid */
  }
  return ''
}
