// ============================================================================
// lib/routes-backfill.mjs —— F25 历史会话补记的路由（1.12.84）
//
//   GET  /dsh-clay-memory/backfill/sessions   候选会话列表（传 ?当前=id 时只检该会话，不扫 40 份归档）
//   POST /dsh-clay-memory/backfill/preview    跑一次提取，返回候选 + 与现有库的判定（花一次模型）
//   POST /dsh-clay-memory/backfill/apply      把勾选的写进库，打成一个批次
//   GET  /dsh-clay-memory/backfill/batches    已有批次一览
//   POST /dsh-clay-memory/backfill/undo       撤销一个批次（删新增 + 恢复被取代的）
//
// ⚠ 2026-11-22 教训（自检那条踩过）：mroute 的 handler **必须自己写响应**。
// ============================================================================
import { 挑历史会话, 试提取, 应用, 撤销, 列批次, 会话根, 体检会话, 找会话文件, 读全局事实, 补记过吗 } from './backfill.mjs'
import { 宿主数据根 } from './paths.mjs'
import { basename, dirname, resolve, sep } from 'node:path'
import { existsSync, realpathSync } from 'node:fs'

function 写JSON(res, 值) {
  const 文 = JSON.stringify(值)
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(文)
}

/** 补记读哪个库的会话：默认当前实例；给了 会话根 就用它（补记主库历史时用）。 */
function 解析会话根(给定) {
  const t = String(给定 || '').trim()
  if (t && existsSync(t)) return t
  return 会话根()
}

/**
 * 校验请求里给的归档文件路径是否严格落在允许的会话归档目录里，
 * 且文件名与会话目录匹配，防任意文件读取。
 */
export function 校验会话文件路径(文件, 根, 会话) {
  const 原文 = String(文件 || '').trim()
  const id = String(会话 || '').trim()
  if (!原文 || !根 || !id || id === '.' || id === '..' || /[/\\]/.test(id)) return ''
  try {
    const 根绝对 = resolve(根)
    const 目标绝对 = resolve(原文)
    if (!目标绝对.startsWith(根绝对 + sep)) return ''
    if (basename(目标绝对) !== 'session.v4.jsonl.zstd') return ''
    if (basename(dirname(目标绝对)) !== id) return ''
    if (!existsSync(目标绝对)) return ''
    const 真根 = realpathSync(根绝对)
    const 真目标 = realpathSync(目标绝对)
    if (!真目标.startsWith(真根 + sep)) return ''
    return 真目标
  } catch (error) {
    return ''
  }
}

/** 当前实例的库 id：传空串，由 backfill.mjs 直接操作全局事实库 `_facts.json`，避免制造 null.json。 */
function 库主() {
  return ''
}

export function 注册补记路由(mroute, 环) {
  // ① 候选会话（不花 token）
  mroute('/dsh-clay-memory/backfill/sessions', async (req, res) => {
    let r
    try {
      const 现有 = 读全局事实()
      const 根 = 解析会话根((环 && 环.补记会话根) || '')
      let 当前 = ''
      let 全量 = false
      try {
        const 问 = new URL(String((req && req.url) || ''), 'http://x')
        当前 = String(问.searchParams.get('当前') || '').trim()
        全量 = 问.searchParams.get('全量') === '1'
      } catch (error) {
        当前 = ''
      }

      if (当前 && !全量) {
        // 详情页只看当前这一个会话：避免同步解压 40 个高达 32MB 的历史归档
        const 文件 = 找会话文件(当前, 根)
        const 诊 = 体检会话(文件)
        const 当前诊断 = Object.assign({ 会话: 当前 }, 诊)
        const 会话们 = 诊.够
          ? [
              {
                会话: 当前,
                条数: 诊.条数,
                用户: 诊.用户,
                助手: 诊.助手,
                字节: 诊.字节,
                时间: 诊.时间 || 0,
                已补记: 补记过吗(现有, 当前),
                文件,
              },
            ]
          : []
        r = {
          ok: true,
          会话根: 根,
          本实例的数据根: 宿主数据根(),
          数量: 会话们.length,
          会话们,
          当前诊断,
        }
      } else {
        const 列 = 挑历史会话(40, 现有, 根)
        let 当前诊断 = null
        if (当前) {
          const 在列表 = 列.find((x) => x.会话 === 当前)
          if (在列表) 当前诊断 = { 会话: 当前, 够: true, 条数: 在列表.条数, 用户: 在列表.用户, 助手: 在列表.助手, 字节: 在列表.字节, 为什么: '' }
          else 当前诊断 = Object.assign({ 会话: 当前 }, 体检会话(找会话文件(当前, 根)))
        }
        r = {
          ok: true,
          会话根: 根,
          本实例的数据根: 宿主数据根(),
          数量: 列.length,
          会话们: 列.map((x) => ({
            会话: x.会话,
            条数: x.条数,
            用户: x.用户,
            助手: x.助手,
            字节: x.字节,
            时间: x.时间,
            已补记: x.已补记,
            文件: x.文件,
          })),
          当前诊断,
        }
      }
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e) }
    }
    写JSON(res, r)
  })

  // ② 试提取（花一次模型；**不写库**）
  mroute('/dsh-clay-memory/backfill/preview', async (req, res) => {
    let r
    try {
      const 体 = (环 && typeof 环.读JSON体 === 'function' ? await 环.读JSON体(req) : {}) || {}
      const 会话 = String(体.会话 || '').trim()
      const 原始文件 = String(体.文件 || '').trim()
      const 根 = 解析会话根((环 && 环.补记会话根) || '')
      if (!会话 || !原始文件) {
        r = { ok: false, error: '要给我「会话」和「文件」' }
      } else {
        const 安全文件 = 校验会话文件路径(原始文件, 根, 会话)
        if (!安全文件) {
          r = { ok: false, error: '会话文件不存在或不在允许的归档目录内' }
        } else {
          // 补记要调模型：优先用活着的 agent，没有就用「选定的模型 / 默认模型」那条路
          let 代理 = null
          try {
            const 服务 = 环 && 环.ctx && 环.ctx.agents
            if (服务 && typeof 服务.get === 'function') 代理 = 服务.get(会话)
            if (!代理 && 服务 && typeof 服务.list === 'function') {
              const 列 = 服务.list() || []
              代理 = 列[0] || null
            }
          } catch (e) {
            /* agents 服务不可用就走默认模型那条路 */
          }
          const t0 = Date.now()
          const 出 = await 试提取(环 && 环.ctx, 代理, 会话, 安全文件, {})
          r = { ...出, 会话, 秒: Number(((Date.now() - t0) / 1000).toFixed(1)) }
        }
      }
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e) }
    }
    写JSON(res, r)
  })

  // ③ 应用（写库，打批次）
  mroute('/dsh-clay-memory/backfill/apply', async (req, res) => {
    let r
    try {
      const 体 = (环 && typeof 环.读JSON体 === 'function' ? await 环.读JSON体(req) : {}) || {}
      const 会话 = String(体.会话 || '').trim()
      const 通过 = Array.isArray(体.通过) ? 体.通过 : []
      if (!会话) r = { ok: false, error: '要给我「会话」' }
      else if (!通过.length) r = { ok: false, error: '一条都没勾，没什么可写的' }
      else {
        const 出 = 应用(库主(), 通过, { 会话 })
        r = { ...出, 会话 }
      }
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e) }
    }
    写JSON(res, r)
  })

  // ④ 批次一览
  mroute('/dsh-clay-memory/backfill/batches', async (req, res) => {
    let r
    try {
      r = { ok: true, 批次们: 列批次(库主()) }
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e) }
    }
    写JSON(res, r)
  })

  // ⑤ 撤销
  mroute('/dsh-clay-memory/backfill/undo', async (req, res) => {
    let r
    try {
      const 体 = (环 && typeof 环.读JSON体 === 'function' ? await 环.读JSON体(req) : {}) || {}
      const 批次 = String(体.批次 || '').trim()
      r = 撤销(库主(), 批次)
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e) }
    }
    写JSON(res, r)
  })
}
