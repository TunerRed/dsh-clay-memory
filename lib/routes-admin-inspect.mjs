// 管理路由 · 健康度 / 时间线 / 回收站
import { join, basename } from 'node:path'
import { 是会话文件, STORE_DIR, 工作区文件id } from './paths.mjs'
import { backupFile } from './backup.mjs'
import { 全局参数 } from './cfg.mjs'
import { corruptSnapshots, 读一份 } from './store-core.mjs'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { writeFileAtomicSync } from './atomic-file.mjs'
import { titleOfSession } from './tools.mjs'
import { diag } from './diag.mjs'
import { trace时间 } from './trace-time.mjs'

export function 注册检视路由(mroute, 环) {
  const { ctx, 读JSON体 } = 环

    mroute('/dsh-clay-memory/health', async (req, res) => {
      const u = new URL(String(req.url || ''), 'http://127.0.0.1')
      const 原文 = u.searchParams.get('days')
      const 原天 = 原文 === null ? Number.NaN : Number(原文)
      const 天 = Number.isFinite(原天) ? Math.max(1, Math.min(90, Math.round(原天))) : 7
      const 起 = Date.now() - 天 * 86400000
      const out = { ok: true, days: 天, 配额: {}, 汇总: {} }
      try {
        const 规 = 全局参数()
        out.配额 = {
          maxItems: 规.maxItems,
          maxChars: 规.maxChars,
          threshold: 规.threshold,
          factsMax: 规.factsMax,
          dailyQuota: 规.dailyQuota,
        }
        let 文件们 = []
        try {
          文件们 = readdirSync(STORE_DIR).filter((f) => f.endsWith('.traces.jsonl'))
        } catch (error) {}
        let 次数 = 0
        let 有命中 = 0
        let 被门挡 = 0
        let 条和 = 0
        let 字和 = 0
        let 有字 = 0
        let 行总 = 0
        let 裁条 = 0
        const 每天 = {}
        for (const f of 文件们) {
          let raw = ''
          try {
            raw = readFileSync(join(STORE_DIR, f), 'utf8')
          } catch (error) {
            continue
          }
          for (const 行 of raw.split(String.fromCharCode(10))) {
            if (!行) continue
            let tr
            try {
              tr = JSON.parse(行)
            } catch (error) {
              continue
            }
            const t = trace时间(tr)
            if (!t || t < 起) continue
            const 条 = Array.isArray(tr.picked) ? tr.picked.length : 0
            次数++
            if (条 > 0) {
              有命中++
              条和 += typeof tr.条 === 'number' ? tr.条 : 条
            } else if (tr.gate) {
              被门挡++
            }
            if (typeof tr.字 === 'number') {
              字和 += tr.字
              有字++
            }
            // ⭐ F10 阶段 0（1.12.24）：预算吃紧到什么程度 —— rows 里被 budget 裁掉的条数
            if (Array.isArray(tr.rows)) {
              for (const 行 of tr.rows) {
                if (!行 || typeof 行 !== 'object') continue
                行总++
                if (行.omission === 'budget') 裁条++
              }
            }
            const 日 = new Date(t).toISOString().slice(0, 10)
            if (!每天[日]) 每天[日] = { 次数: 0, 有: 0, 条: 0 }
            每天[日].次数++
            if (条) {
              每天[日].有++
              每天[日].条 += 条
            }
          }
        }
        out.汇总 = {
          次数,
          有命中,
          空注入: 次数 - 有命中,
          被门挡,
          命中率: 次数 ? Math.round((有命中 / 次数) * 100) / 100 : null,
          平均条数: 有命中 ? Math.round((条和 / 有命中) * 10) / 10 : 0,
          平均字数: 有字 ? Math.round(字和 / 有字) : 0,
        }
        const 均字 = out.汇总.平均字数
        if (均字 && 规.maxChars) {
          out.汇总.预算利用率 = Math.round((均字 / 规.maxChars) * 100)
        }
        if (行总) {
          out.汇总.被裁条数 = 裁条
          out.汇总.裁剪率 = Math.round((裁条 / 行总) * 1000) / 10
        }
        out.每天 = Object.keys(每天)
          .sort()
          .map((d) => ({ 日: d, 次数: 每天[d].次数, 有: 每天[d].有, 条: 每天[d].条 }))
      } catch (error) {
        out.ok = false
        out.message = String((error && error.message) || error)
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(out))
    })
    // ⭐ F14（1.12.12）：时间线 —— 「那天记了些什么、又想起过什么」。
    //   按条目看库（记忆页）能看出有什么，看不出**节奏**：哪天记得多、哪天一个字没记、
    //   哪天问了不少但一次都没想起来。这一页只回答这两件事，不做统计分析。
    mroute('/dsh-clay-memory/timeline', async (req, res) => {
      const u = new URL(String(req.url || ''), 'http://127.0.0.1')
      // ⚠ 参数没带时 searchParams.get 是 null，Number(null) === 0 —— 会被当成「要 1 天」。
      //   所以先判 null 再转数（health 那条也是同一个坑，一起改了）
      const 原文 = u.searchParams.get('days')
      const 原天 = 原文 === null ? Number.NaN : Number(原文)
      const 天 = Number.isFinite(原天) ? Math.max(1, Math.min(90, Math.round(原天))) : 14
      const 起 = Date.now() - 天 * 86400000
      const 日子 = new Map()
      const 取日 = (t) => {
        const d = new Date(t)
        const 补 = (n) => String(n).padStart(2, '0')
        return d.getFullYear() + '-' + 补(d.getMonth() + 1) + '-' + 补(d.getDate())
      }
      const 槽 = (k) => {
        if (!日子.has(k)) 日子.set(k, { 日: k, 记: [], 想起: { 次: 0, 有: 0, 条: 0, 空: 0, 兜底: 0 } })
        return 日子.get(k)
      }
      const out = { ok: true, days: 天, 每天: [] }
      try {
        // ① 记了什么：所有库文件里的 memories，按 id 去重（copy-to 出来的会话是同一批 id）
        const 见过 = new Set()
        let 库们 = []
        try {
          库们 = readdirSync(STORE_DIR).filter((f) => f.endsWith('.json'))
        } catch (error) {}
        for (const f of 库们) {
          let 盘
          try {
            盘 = JSON.parse(readFileSync(join(STORE_DIR, f), 'utf8'))
          } catch (error) {
            continue // 坏库不当空库：跳过，别把「读不出来」显示成「那天没记」
          }
          for (const m of (盘 && 盘.memories) || []) {
            if (!m || !m.id || 见过.has(m.id)) continue
            const t = Date.parse(m.at) || 0
            if (!t || t < 起) continue
            见过.add(m.id)
            槽(取日(t)).记.push({
              t: new Date(t).toISOString().slice(11, 16),
              text: String(m.text || '').slice(0, 80),
              类型: m.category || '',
              性质: m.nature || '',
            })
          }
        }
        // ② 想起过什么：追溯文件里每次注入一行
        let 追们 = []
        try {
          追们 = readdirSync(STORE_DIR).filter((f) => f.endsWith('.traces.jsonl'))
        } catch (error) {}
        for (const f of 追们) {
          let raw = ''
          try {
            raw = readFileSync(join(STORE_DIR, f), 'utf8')
          } catch (error) {
            continue
          }
          for (const 行 of raw.split(String.fromCharCode(10))) {
            if (!行) continue
            let tr
            try {
              tr = JSON.parse(行)
            } catch (error) {
              continue
            }
            const t = trace时间(tr)
            if (!t || t < 起) continue
            const 天槽 = 槽(取日(t)).想起
            const 条 = Array.isArray(tr.picked) ? tr.picked.length : 0
            天槽.次++
            if (条 > 0) {
              天槽.有++
              天槽.条 += 条
            } else {
              天槽.空++
            }
            if (tr.fallback) 天槽.兜底++
          }
        }
        out.每天 = [...日子.values()]
          .sort((a, b) => (a.日 < b.日 ? 1 : -1)) // 新的在上面
          .map((x) => ({
            日: x.日,
            记数: x.记.length,
            记: x.记.sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, 30), // 一天最多摆 30 条，再多交给记忆页
            想起: x.想起,
          }))
      } catch (error) {
        out.ok = false
        out.message = String((error && error.message) || error)
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(out))
    })
    // ⭐ 2026-11-01 用户：「回收站的条目好多，是会话和工作区共用的吗？如果是，能不能换到顶部页签
    //   做成一个独立的内容？顺便把搜索也做上，只搜内容就行了」→ 顶部独立「回收站」页签 + 本接口。
    //   回收站不是共用的：事实库 / 每个会话 / 每个工作区各自一个 deleted 数组。这里摊平成一张表带来源，
    //   点「找回来」按来源文件精确放回（只动那一个数组，不经过合并视图）。
    mroute('/dsh-clay-memory/recycle-bin', async (req, res) => {
      const u = new URL(String(req.url || ''), 'http://127.0.0.1')
      const 方法 = String((req && req.method) || 'GET').toUpperCase()
      if (方法 === 'POST') {
        const b = await 读JSON体(req)
        const 名 = basename(String(b.file || ''))
        const id = String(b.id || '')
        let out = { ok: false }
        try {
          const 实文件 = 名 && 名.endsWith('.json') ? join(STORE_DIR, 名) : ''
          const 盘 = 实文件 && existsSync(实文件) ? 读一份(实文件) : null
          if (!实文件) out.message = '缺文件名（这条不知道从哪来的）'
          else if (!盘 || !Array.isArray(盘.deleted)) out.message = '这个库读不出来'
          else if (corruptSnapshots.has(盘)) out.message = '库文件被判毒，拒绝写回'
          else {
            const i = 盘.deleted.findIndex((d) => d && String(d.id) === id)
            if (i < 0) out.message = '这个回收站里没有它（可能刚被别处找回了）'
            else {
              const m = 盘.deleted.splice(i, 1)[0]
              delete m.deletedAt
              if (!Array.isArray(盘.memories)) 盘.memories = []
              盘.memories.push(m)
              backupFile(实文件)
              writeFileAtomicSync(实文件, JSON.stringify(盘))
              diag('回收站找回：' + 名 + ' / ' + id)
              out = { ok: true, message: '找回来了（回到 ' + 名 + '）' }
            }
          }
        } catch (e) { out = { ok: false, message: String((e && e.message) || e) } }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(out))
        return
      }
      const out = { ok: true, total: 0, items: [] }
      try {
        const 全部 = readdirSync(STORE_DIR)
        // ⚠ 只认真正的库文件：`.json` 结尾。注意 `.json.bak`（备份File 留的底）也会进 readdir，
        //   1.8.49 首版把 .bak 也扫进来了 —— 回收站里出现一堆重复条目，点「找回来」还会因为
        //   basename 不以 .json 结尾报「缺文件名」。这里按后缀严格过滤。
        const 文件们 = 全部.filter((f) => f.endsWith('.json') && (是会话文件(f) || f === '_facts.json' || f.startsWith('_ws-')))
        const 会话标题 = new Map()
        for (const f of 文件们) {
          const 盘 = 读一份(join(STORE_DIR, f))
          const 坟 = 盘 && Array.isArray(盘.deleted) ? 盘.deleted : []
          if (!坟.length) continue
          let 类型 = 'session'
          let 名 = ''
          let sid = ''
          if (f === '_facts.json') {
            类型 = 'fact'
            名 = '全局事实'
          } else if (f.startsWith('_ws-')) {
            类型 = 'workspace'
            名 = String((盘 && 盘.wsRoot) || 工作区文件id(f) || '工作区')
          } else {
            sid = f.slice(0, -5)
          }
          for (const d of 坟) {
            if (!d || typeof d !== 'object' || !String(d.id || '')) continue
            out.items.push({
              id: String(d.id || ''),
              text: String(d.text || ''),
              importance: typeof d.importance === 'number' ? d.importance : 0.5,
              at: String(d.at || ''),
              deletedAt: String(d.deletedAt || ''),
              file: f,
              来源类型: 类型,
              来源: 名,
              session: sid,
            })
          }
        }
        // 会话那层的来源显示标题（取不到就用短号，不让一条取不到把整个接口拖慢/拖垮）
        const 要标题 = [...new Set(out.items.filter((x) => x.来源类型 === 'session' && x.session).map((x) => x.session))]
        for (const sid of 要标题) {
          let t = ''
          try { t = titleOfSession(ctx, sid) || '' } catch (e) { t = '' }
          会话标题.set(sid, t)
        }
        for (const it of out.items) {
          if (it.来源类型 === 'session' && it.session) it.来源 = 会话标题.get(it.session) || it.session.slice(0, 12)
        }
        out.items.sort((a, b) => String(b.deletedAt || '').localeCompare(String(a.deletedAt || '')))
        out.total = out.items.length
      } catch (e) {
        out.ok = false
        out.message = String((e && e.message) || e)
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(out))
    })
}
