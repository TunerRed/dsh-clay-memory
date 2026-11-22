// 管理路由 · 语义嵌入 / 临场提醒 / 自动去重 / 归纳 / 推测确认
import { join, basename } from 'node:path'
import { 是会话文件, STORE_DIR } from './paths.mjs'
import { CFG_DIR } from './paths.mjs'
import { backupStore } from './backup.mjs'
import { loadCfg, saveCfg } from './cfg.mjs'
import { 收临场提醒, 临场提醒上限 } from './hint.mjs'
import { 找可合的, 执行合并, 记整理结果 } from './dedupe.mjs'
import { 模型状态, 下载状态, 下载模型 } from './embed.mjs'
import { loadStore, saveStore } from './store-core.mjs'
import { readdirSync } from 'node:fs'
import { diag } from './diag.mjs'

export function 注册语义与整理路由(mroute, 环) {
  const { ctx, 读JSON体 } = 环

    // ⭐ 1.12.41（P1-1）：语义召回的开关 / 模型目录 / 一键下载
    //   配置落在 clay-memory-config.json 顶层（语义召回 / 模型目录 / 语义模型），
    //   不进 policy —— policy 那份 spec 只认数字参数，混进去会被 fitPolicy 洗掉。
    mroute('/dsh-clay-memory/embed-status', async (req, res) => {
      const c = loadCfg()
      const st = 模型状态()
      const 下 = 下载状态()
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(
        JSON.stringify({
          ok: true,
          开: c.语义召回 === true,
          模型目录: String(c.模型目录 || ''),
          模型名: st.名,
          默认目录: join(CFG_DIR, 'models'),
          维度: st.维度,
          加载过: st.加载过,
          失败: st.失败,
          下载中: 下.下载中,
          下载结果: 下.结果,
        }),
      )
    })

    mroute('/dsh-clay-memory/embed-config', async (req, res) => {
      const b = await 读JSON体(req)
      const c = loadCfg()
      if (typeof b.开 === 'boolean') c.语义召回 = b.开
      if (typeof b.模型目录 === 'string') c.模型目录 = b.模型目录.trim()
      if (typeof b.模型名 === 'string') c.语义模型 = b.模型名.trim()
      const ok = saveCfg(c)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok, 配置: { 开: c.语义召回 === true, 模型目录: String(c.模型目录 || ''), 模型名: String(c.语义模型 || '') } }))
    })

    // 下载默认模型（bge-small-zh-v1.5，~24MB）：后台跑，前端轮询 embed-status 看进度
    mroute('/dsh-clay-memory/embed-download', async (req, res) => {
      下载模型().catch(() => {})
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, started: true }))
    })
    // ⭐ 1.12.41（临场提醒）：体检页里那段固定文字的读写。
    //   落 clay-memory-config.json 顶层（临场提醒），**不进 policy** ——
    //   跟上面 embed 同一个理由：policy 那份 spec 只认数字参数，字符串混进去会被 fitPolicy 洗掉。
    //   GET 读、POST 存（同一个路径；GET 时绝不读 body，否则会挂在那里等数据）。
    mroute('/dsh-clay-memory/hint', async (req, res) => {
      const 是POST = String((req && req.method) || '').toUpperCase() === 'POST'
      const c = loadCfg()
      let 被截断 = false
      if (是POST) {
        const b = await 读JSON体(req)
        if (b && typeof b.文字 === 'string') {
          被截断 = Array.from(b.文字).length > 临场提醒上限
          c.临场提醒 = 收临场提醒(b.文字)
          saveCfg(c)
        }
      }
      const 现 = String(c.临场提醒 || '')
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, 文字: 现, 上限: 临场提醒上限, 字数: Array.from(现).length, 被截断 }))
    })

    // ⭐ 1.12.46：自动整理 —— 查上次合了什么、也能立刻手动跑一次。
    //   为什么要有这个路由：自动合并是「没人看着就动数据」，必须让主人能翻账
    //   （他最烦黑盒）。GET 只读预览，POST 才真合，且合之前先 backupStore。
    mroute('/dsh-clay-memory/dedupe', async (req, res) => {
      const 是POST = String((req && req.method) || '').toUpperCase() === 'POST'
      const 回 = (体) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(体))
      }
      const c = loadCfg()
      const 历史 = Array.isArray(c._整理记录) ? c._整理记录.slice(0, 5) : []
      // 不传 session 就把磁盘上所有会话库都过一遍 —— 设置页没有「当前会话」这个概念，
      // 而主人点的是「整理一下」，当然是指整个库。
      const 所有库 = () => {
        try {
          return readdirSync(STORE_DIR)
            .filter((f) => f.endsWith('.json') && 是会话文件(f))
            .map((f) => basename(f, '.json'))
            .slice(0, 12)
        } catch (error) {
          return []
        }
      }
      const 选库 = (sid) => (sid ? [sid] : 所有库())
      if (!是POST) {
        // 只读预览：扫一遍看现在有几对能合，不写盘
        let 待合 = 0
        let 扫过 = 0
        let 库数 = 0
        for (const sid of 选库(String((req && req.url && new URL(req.url, 'http://x').searchParams.get('session')) || ''))) {
          try {
            const r = 找可合的(loadStore(sid))
            待合 += r.明细.length
            扫过 += r.扫过
            库数 += 1
          } catch (error) {}
        }
        return 回({ ok: true, 上次: c._上次整理 || null, 历史, 待合, 扫过, 库数 })
      }
      const b = await 读JSON体(req)
      const sid参数 = String((b && b.session) || '')
      const 合计 = { 扫过: 0, 合了: 0, 省下: 0, 记录们: [], 库数: 0 }
      const 全部记录 = []
      try {
        for (const sid of 选库(sid参数)) {
          let data
          try {
            data = loadStore(sid)
          } catch (error) {
            continue
          }
          const { 明细, 扫过 } = 找可合的(data)
          合计.扫过 += 扫过
          合计.库数 += 1
          if (!明细.length) continue
          backupStore(sid) // 动数据之前先备份
          const { 记录, 省下 } = 执行合并(data, 明细)
          saveStore(sid, data)
          合计.合了 += 记录.length
          合计.省下 += 省下
          合计.记录们.push(...记录)
          全部记录.push(...记录)
          diag('  手动整理：' + sid + ' 扫 ' + 扫过 + ' 条，合 ' + 记录.length + ' 对，省 ' + 省下 + ' 字')
        }
        记整理结果(全部记录, 合计.省下)
        return 回({
          ok: true,
          ...合计,
          上次: new Date().toISOString(),
          历史: (loadCfg()._整理记录 || []).slice(0, 5),
        })
      } catch (error) {
        diag('  手动整理失败：' + (error && error.message))
        return 回({ ok: false, error: String((error && error.message) || error) })
      }
    })

    // ⭐ 1.12.55：模式层（dream 的产物）—— 看候选 / 手动跑一次归纳 / 改状态
    //   为什么这里只给「看」和「跑」，不给「大批量自动入库」：
    //   模式是我对他行为的一点猜测，不是事实。猜错了会直接影响每一轮的说话方式，
    //   所以默认只落 candidate，要不要升级成 tentative（开始参与注入）得人来点头。
    mroute('/dsh-clay-memory/dream', async (req, res) => {
      const 是POST = String((req && req.method) || '').toUpperCase() === 'POST'
      const 回 = (体) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(体))
      }
      const { 读模式, 改状态 } = await import('./patterns.mjs')
      const 数据 = 读模式()
      const 统计 = { candidate: 0, tentative: 0, verified: 0, deprecated: 0 }
      for (const p of 数据.patterns) 统计[p.status] = (统计[p.status] || 0) + 1

      if (!是POST) {
        return 回({ ok: true, 模式: 数据.patterns, 统计, 上限: 数据.patterns.length })
      }
      const b = await 读JSON体(req)
      const 动作 = String((b && b.动作) || '归纳')
      if (动作 === '改状态') {
        const r = 改状态(String(b.id || ''), String(b.到 || ''), String(b.原因 || ''))
        return 回({ ok: r.ok, 问题: r.问题 || [] })
      }
      // 跑一次归纳
      const { 归纳一次, 落库 } = await import('./dream.mjs')
      const sid参数 = String((b && b.session) || '')
      let sid = sid参数
      if (!sid) {
        try {
          sid = readdirSync(STORE_DIR).filter((f) => f.endsWith('.json') && 是会话文件(f)).map((f) => basename(f, '.json'))[0] || ''
        } catch (error) {}
      }
      const agent = (ctx.agents && typeof ctx.agents.list === 'function' ? ctx.agents.list() || [] : [])[0]
      if (!agent) return 回({ ok: false, 问题: ['没有活着的 agent，归纳需要它来拿模型'] })
      try {
        backupStore(sid)
        const r = await 归纳一次(ctx, agent, loadStore(sid))
        if (!r.ok) return 回({ ok: false, 问题: r.问题 })
        const 记录 = 落库(r.候选)
        diag('  dream 归纳：模型=' + r.用了 + ' 产出=' + r.候选.length + ' 落库=' + 记录.length + ' 丢弃=' + r.问题.length)
        return 回({ ok: true, 产出: r.候选.length, 落库: 记录, 丢弃: r.问题, 用了: r.用了 })
      } catch (error) {
        return 回({ ok: false, 问题: [String((error && error.message) || error)] })
      }
    })

    // GPT 整改 P2（inference）：推测型记忆的管理入口 —— 查看 / 确认 / 拒绝 / 撤销标记。
    //   推测不是用户事实：默认不注入；只有她显式来看，才原样露脸（带「推测」标）。
    //   status 状态机：pending（默认）→ confirmed（确认采信）/ rejected（拒绝，不再召回）。
    mroute('/dsh-clay-memory/inference', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      const action = String(b.action || 'list')
      const id = String(b.id || '')
      try {
        const data = loadStore(sid)
        const 推测们 = (data.memories || []).filter((m) => m && m.type === 'inference')
        if (action === 'list') {
          // 1.8.38 P2-③：失效证据可识别 —— 证据引用的记忆被删/失效后，list 里能看到哪些证据已不在库
          const 活着 = new Set((data.memories || []).map((m) => m && String(m.id)))
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({
            ok: true,
            推测: 推测们.map((m) => {
              const 证据 = Array.isArray(m.evidence) ? m.evidence : []
              return {
                id: String(m.id),
                text: String(m.text || ''),
                confidence: m.confidence || '低',
                status: m.status || 'pending',
                evidence: 证据,
                失效证据: 证据.filter((eid) => !活着.has(eid)),
                推断域: m.推断域 || '',
                provenance: m.provenance || 'model_inference',
                createdAt: m.createdAt || '',
              }
            }),
          }))
          return
        }
        if (action !== 'list' && action !== 'confirm' && action !== 'reject' && action !== 'promote') {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: 'action 只认 list / confirm / reject / promote' }))
          return
        }
        const m = 推测们.find((x) => String(x.id) === id)
        if (!m) {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: '没找到这条推测' }))
          return
        }
        if (action === 'confirm') {
          m.status = 'confirmed'
          m.confirmedAt = new Date().toISOString()
          saveStore(sid, data)
          diag('推测确认采信：' + sid + ' / ' + id)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, status: 'confirmed', message: '确认采信（仍按推测措辞使用，不会自动注入）' }))
        } else if (action === 'reject') {
          m.status = 'rejected'
          m.rejectedAt = new Date().toISOString()
          saveStore(sid, data)
          diag('推测被拒绝：' + sid + ' / ' + id)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, status: 'rejected', message: '已拒绝，不再召回' }))
        } else {
          // 1.8.38 P2-④：转正（promote）才从推测转成正式类型、进入正常注入流程；
          //   可追溯：promotedFrom/promotedAt 落盘，证据（evidence）保留不丢来源。
          const 转 = typeof b.type === 'string' && ['identity', 'relation', 'promise', 'preference', 'experience', 'misc'].includes(b.type.trim())
            ? b.type.trim()
            : 'experience'
          m.type = 转
          m.status = 'confirmed'
          m.confirmedAt = m.confirmedAt || new Date().toISOString()
          m.promotedAt = new Date().toISOString()
          m.promotedFrom = 'inference'
          saveStore(sid, data)
          diag('推测转正：' + sid + ' / ' + id + ' → ' + 转)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, status: 'confirmed', type: 转, message: '已转正为 ' + 转 + '，进入正常注入流程（来源证据保留）' }))
        }
      } catch (error) {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, message: String((error && error.message) || error) }))
      }
    })
}
