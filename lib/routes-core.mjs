// 2026-10-30 拆层工程第 10 批：apply 内的路由迁出（注册核心路由）
// 注册函数第一个参数是 mroute 注册器，第二个参数是 apply 环境（闭包依赖显式传入）
import { homedir } from 'node:os'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createSelfUpdate } from './selfupdate.mjs'
import { loadStore, loadStoreJSON, saveStore, 事实文, 同步SQL镜像, 读一份 } from './store-core.mjs'
import { 是会话文件, factPath, storePath, STORE_DIR, FACTS_NAME, 会话工作区, 规范化 } from './paths.mjs'
import { normalizeOwner, normalizePerson, selfNameOf, 抠日期详 } from './names.mjs'
import { backupStore, 暂停到, 记批次, 设暂停, 读批次表 } from './backup.mjs'
import { 问模型 } from './llm.mjs'
import { 代际一致, 按明细恢复, 拍一批, 没动过 } from './patch-apply.mjs'
import { 补历史尺 } from './meter.mjs'
import { 准备SQLite同步, 库文件路径, 读SQL视图同步 } from './storage.js'
import { buildMemoryList } from './ui.mjs'
import { titleOfSession } from './tools.mjs'
import { copyFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { setEnabled, setGlobalOn } from './cfg.mjs'
import { recall } from './scoring.mjs'
import { backupFile, lastSig } from './backup.mjs'
import { corruptIncidents, 镜像不可用 } from './store-core.mjs'
import { 抠日期 } from './names.mjs'
import { diag } from './diag.mjs'

export function 注册核心路由(mroute, 环) {
  const { ctx, 读JSON体, mounted, tick, 同步工具, 自查更新 } = 环
    mroute('/dsh-clay-memory/update', async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1')
      const r = await 自查更新.check(u.searchParams.get('refresh') === '1')
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, ...r }))
    })

    mroute('/dsh-clay-memory/page', (req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(MEMORY_PAGE)
    })

    mroute('/dsh-clay-memory/list', (req, res) => {
      // 走 buildMemoryList，别再抄一份（抄的那份会跟这边分叉）✓
      const out = buildMemoryList(ctx)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(out))
    })

    // ⭐⭐ 1.5.0 A 轮（F16/F17）：**一个「所有记忆」列表** —— 全局事实 ＋ 所有会话事件，去重后合成一份
    //
    //   为什么不复用 `/list` 在前端拼：`/list` 是按会话返回的，而**每个会话的 memories 里都含
    //   全部全局事实**，前端把 sessions[].memories 直接 flatten，事实会被乘上「会话数」倍
    //   （规划文档 §15 那条警告）。这里事实库只读一次、会话库只取事件 → 事实只露一次脸 ✓
    //
    //   去重口径**照 loadStore 合并视图那一套**（别自己发明第二套）：
    //     · 同一个 id 只留一条（事实先入表 → 天然「事实优先」）
    //     · 全局事实「同文不同 id」只留先出现的一条（跟 事实文 去重一致）
    //     · 墓碑两边都认：事实库删的 / 哪个会话删的，活着的那份也不再算（删了就是删了）
    //     · 会话库里那些「事实的旧副本」（category 也是 stable_profile）跳过 —— 它已经在 ② 露过脸
    //
    //   ⚠ 只读：不写盘、不动代际（页面刷新不该触发一次写）
    //   ⚠ 上限 2000 条 = 整库硬顶（防页面卡死）；stats.总数 才是去重后的真实条数
    //   ⚠ 已删的单独走 `deleted`，**绝不并进 memories** —— 并进去会被「清空」连坐（文档红线）
    mroute('/dsh-clay-memory/all', (req, res) => {
      const 上限 = 2000
      const 出 = { ok: true, count: 0, stats: {}, memories: [], deleted: [] }
      try {
        const u = new URL(req.url, 'http://127.0.0.1')
        const 搜 = String(u.searchParams.get('search') || '').trim().toLowerCase()
        // ⭐ 1.7.3（主人：记忆页选「指定会话」是空的，但点进那个会话有）
        //   根因：会话事件按 id 全局去重 —— 两个会话是 copy-to 出来的同一批 id，
        //   先扫到的那个把 id 全占走，后一个一条都剩不下（loadStore 单会话视图当然有）。
        //   所以「看某个会话」这条路要走它自己的视图，不能跟别的会话抢 id。
        const 只看会话 = String(u.searchParams.get('session') || '').trim()
        // 全库子串过滤：正文 / 事实键 / 标签 / 补出来的检索词都算命中（搜「大白饭」，键里有也算）✓
        const 命中 = (m) => {
          if (!搜) return true
          const 看 = [m && m.text, m && m.事实键, m && Array.isArray(m.tags) ? m.tags.join(' ') : '', m && Array.isArray(m.related) ? m.related.join(' ') : '']
          return 看.some((s) => String(s || '').toLowerCase().includes(搜))
        }
        // 「最近」排序：这件事什么时候发生的 → 没有就用记下来的时间
        const 排序键 = (m) => {
          const t = Date.parse((m && (m.at || m.createdAt || m.importAt || m.deletedAt)) || '')
          return Number.isFinite(t) ? t : 0
        }
        const 标题缓存 = new Map()
        const 标题Of = (sid) => {
          if (!sid) return ''
          if (!标题缓存.has(sid)) 标题缓存.set(sid, titleOfSession(ctx, sid))
          return 标题缓存.get(sid)
        }
        const 一条 = (m, sid) => ({
          id: String(m.id),
          text: String(m.text || ''),
          at: m.at || null,
          createdAt: m.createdAt || null,
          importance: typeof m.importance === 'number' ? m.importance : null,
          source: m.source || '',
          category: m.category === 'stable_profile' ? 'stable_profile' : 'event',
          // 作用域徽章（F1/F16）—— 跟 `/list` 同一口径：住哪个库就是哪个作用域
          scope: m.category === 'stable_profile' ? 'global' : 'session',
          // 类型（1.5.0 A 轮）：只做展示与筛选
          type: m.type || '',
          // 会话 id（全局事实是空串 —— 它不属于任何会话）＋ DSH 里的标题（拿不到就是空串）
          session: sid || '',
          sessionTitle: 标题Of(sid),
          事实键: typeof m.事实键 === 'string' && m.事实键 ? m.事实键 : null,
          已被取代: m.已被取代 ? { 为什么: String(m.已被取代.为什么 || ''), 作废于: m.已被取代.作废于 || null } : null,
          related: Array.isArray(m.related) ? m.related.slice(0, 12) : [],
          refined: !!m.refinedAt,
          // ⭐ B 轮 F12：这条提炼之前长什么样（只回前 1200 字）
          textBefore: m.textBefore ? String(m.textBefore).slice(0, 1200) : '',
          // ⭐ B 轮 F5：标了「这条不对」的，列表里要看得见
          别记: m.别记 ? String((m.别记 && m.别记.原因) || '这条不对') : '',
        })

        // ── ① 会话清单 + 墓碑（每个会话走 loadStore，拿到的是「事实 + 本会话事件」的合并视图）
        //   1.6.15（主人：「前端改完，后端要不要跟着收敛」）：这里原来自己重写了一遍合并
        //   （读原始会话库、事实文去重、墓碑并集），跟 loadStore 是两套实现 —— 加字段/改口径要改两处。
        //   现在合并语义只由 loadStore 负责，这里只做「展平 + 标 scope」，不再碰规则。
        let 会话数 = 0
        const 全部会话 = []
        const 会话盘们 = []
        const 坟 = new Map()
        const 事实盘 = 读一份(factPath())
        for (const d of 事实盘.deleted || []) if (d) 坟.set(String(d.id), { m: d, sid: '' })
        try {
          for (const fn of readdirSync(STORE_DIR)) {
            if (!是会话文件(fn)) continue
            const sid = fn.replace(/\.json$/, '')
            全部会话.push(sid)
            if (只看会话 && sid !== 只看会话) continue
            会话数++
            let 视图
            try {
              视图 = loadStore(sid)
            } catch (error) {
              // 单个会话库坏了不该拖垮整页（损坏快照已由 loadStore 记下）
              continue
            }
            会话盘们.push({ sid, 视图 })
            for (const d of 视图.deleted || []) if (d && !坟.has(String(d.id))) 坟.set(String(d.id), { m: d, sid })
          }
        } catch (error) {
          // 目录还不在（新装 / 测试夹具）＝ 只有全局事实，不算错 ✓
        }

        // ── ② 全局事实（事实库只读这一次，所以不会 × 会话数）
        const 活 = []
        const 已见id = new Set()
        const 已见文 = new Set()
        let 全局数 = 0
        for (const m of 事实盘.memories || []) {
          if (!m) continue
          const id = String(m.id)
          if (已见id.has(id) || 坟.has(id)) continue
          const 文 = 事实文(m)
          if (文) {
            if (已见文.has(文)) continue
            已见文.add(文)
          }
          已见id.add(id)
          全局数++
          if (命中(m)) 活.push(一条(m, ''))
        }

        // ── ③ 每个会话自己的事件（loadStore 已经把事实副本并进来，这里只要非 stable_profile 的）
        let 事件数 = 0
        for (const { sid, 视图 } of 会话盘们) {
          for (const m of 视图.memories || []) {
            if (!m) continue
            const id = String(m.id)
            if (已见id.has(id) || 坟.has(id)) continue
            if (m.category === 'stable_profile') continue
            已见id.add(id)
            事件数++
            if (命中(m)) 活.push(一条(m, sid))
          }
        }

        // ── ④ 已删（F17「看已删、可恢复」）—— 单独一份，页面上是第三种状态
        const 已删 = []
        for (const { m, sid } of 坟.values()) {
          if (!命中(m)) continue
          已删.push({ ...一条(m, sid), deletedAt: m.deletedAt || null })
        }

        const 总数 = 活.length
        const 已删总数 = 已删.length
        活.sort((a, b) => 排序键(b) - 排序键(a))
        已删.sort((a, b) => 排序键(b) - 排序键(a))
        const 出来的 = 活.slice(0, 上限)
        出.memories = 出来的
        出.deleted = 已删.slice(0, 上限)
        // 会话清单（页面右上角「N 个会话」、作用域筛选里的会话下拉都靠它）
        // 标题拿不到就是空串 —— 页面会退回到显示截断的 id
        出.sessions = 全部会话.map((sid) => ({ id: sid, title: 标题Of(sid) }))
        出.count = 出来的.length
        出.truncated = 总数 > 上限
        出.stats = {
          总数, // 去重后活着的条数（可能 > 上限，页面按这个显示「还有 N 条」）
          返回: 出来的.length,
          全局: 全局数,
          会话: 事件数,
          会话数, // 扫了几个会话库（含没有事件的）
          已被取代: 出来的.filter((x) => x.已被取代).length,
          已删: 已删总数,
        }
      } catch (error) {
        出.ok = false
        出.message = String((error && error.message) || error)
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(出))
    })

    // ⭐⭐ 1.4.1：「全局事实」独立页 —— 事实不属于任何会话，所以这个路由**不需要 session**。
    //   `/list` 回答的是「一个会话看到什么」（全局事实 + 本会话事件），
    //   这个只回答「全局事实有哪几条」—— 前端那个页签不选会话就能进，靠的就是它 ✓
    mroute('/dsh-clay-memory/facts', (req, res) => {
      const 出 = { ok: true, memories: [], count: 0, stats: {} }
      try {
        const 盘 = 读一份(factPath())
        const 坟 = new Set((盘.deleted || []).map((m) => String(m && m.id)))
        const 们 = (盘.memories || []).filter((m) => m && !坟.has(String(m.id)))
        const 来源 = {}
        let 有键 = 0
        let 有日期 = 0
        let 有检索词 = 0
        for (const m of 们) {
          const 短 = String(m.source || '（没写来源）').split('：')[0] || '（没写来源）'
          来源[短] = (来源[短] || 0) + 1
          if (m.事实键) 有键++
          if (m.at) 有日期++
          if (Array.isArray(m.related) && m.related.length) 有检索词++
        }
        出.count = 们.length
        出.stats = { 总数: 们.length, 有事实键: 有键, 有日期: 有日期, 有检索词: 有检索词, 来源 }
        出.memories = 们.map((m) => ({
          id: String(m.id),
          text: String(m.text || ''),
          at: m.at || null,
          importance: typeof m.importance === 'number' ? m.importance : null,
          source: m.source || '',
          事实键: m.事实键 || '',
          related: Array.isArray(m.related) ? m.related.slice(0, 12) : [],
          refined: !!m.refined,
        }))
      } catch (error) {
        出.ok = false
        出.message = String((error && error.message) || error)
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(出))
    })

    // 删一条全局事实：**不需要知道是哪个会话**（事实只有一份）。
    //   走 loadStore + saveStore，让 1.4.0 那套「墓碑 + 会话回退副本」照常生效 ——
    //   直接改 `_facts.json` 会绕过代际校验，删完可能被旧副本读回来 ✗
    const 取会话上下文 = (b) => {
      // 借一个已存在的会话当写入上下文（只是要它的库文件，事实本身不归它）
      if (b && b.session) return String(b.session)
      try {
        const 文件 = readdirSync(STORE_DIR).find(是会话文件)
        if (文件) return 文件.replace(/\.json$/, '')
      } catch (error) {}
      return ''
    }
    mroute('/dsh-clay-memory/facts/delete', async (req, res) => {
      const b = await 读JSON体(req)
      const id = String(b.id || '')
      const sid = 取会话上下文(b)
      const 出 = { ok: false, message: '没找到这条事实' }
      try {
        if (!sid) throw new Error('还没有任何会话库，没地方落墓碑')
        const data = loadStore(sid)
        const m = (data.memories || []).find((x) => x && String(x.id) === id)
        if (m && m.category === 'stable_profile') {
          data.memories = (data.memories || []).filter((x) => !x || String(x.id) !== id)
          data.deleted = [...(data.deleted || []), { ...m, deletedAt: new Date().toISOString() }]
          saveStore(sid, data)
          diag('全局事实删除：' + id + '（' + String(m.text || '').slice(0, 30) + '）')
          出.ok = true
          出.message = '删了 —— 全局记忆里不再有这条'
        }
      } catch (error) {
        出.message = String((error && error.message) || error)
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(出))
    })

    // 改一条全局事实（页面上的「改」）：正文 / 重要度
    mroute('/dsh-clay-memory/facts/edit', async (req, res) => {
      const b = await 读JSON体(req)
      const id = String(b.id || '')
      const 新文本 = String(b.text || '').trim()
      const 出 = { ok: false, message: '没找到这条事实' }
      if (!新文本) {
        出.message = '不能改成空的（要删就用「删」）'
      } else {
        const sid = 取会话上下文(b)
        try {
          if (!sid) throw new Error('还没有任何会话库，没地方落改动')
          const data = loadStore(sid)
          const m = (data.memories || []).find((x) => x && String(x.id) === id)
          if (m && m.category === 'stable_profile') {
            m.text = normalizePerson(新文本, selfNameOf(sid))
            if (typeof b.importance === 'number' && isFinite(b.importance)) {
              m.importance = Math.max(0, Math.min(1, b.importance))
            }
            m.editedAt = new Date().toISOString()
            saveStore(sid, data)
            出.ok = true
            出.message = '改好了'
          }
        } catch (error) {
          出.message = String((error && error.message) || error)
        }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(出))
    })

    // ⭐ 2026-09-21 新加：**后台手动加一条记忆**（她要的）
    //
    // 跟 remember 工具的区别：
    //   remember 是模型自己记，**受会话开关管**（关着就不记）
    //   这个是**她在设置页后台手动加** —— 她是最高权限，**开关关着也照样能加** ✓
    //   （开关管的是「他自己记不记、注不注入」，管不到她手动写）
    mroute('/dsh-clay-memory/add', async (req, res) => {
      const b = await 读JSON体(req)
      const 回 = (码, o) => {
        res.writeHead(码, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(o))
      }
      const sid = String(b.session || '').trim()
      if (!sid) return 回(400, { ok: false, error: '没给会话' })
      const 原始 = String(b.text || '').trim()
      if (!原始) return 回(400, { ok: false, error: '内容不能空' })
      // 跟 remember 一样洗人称：「小明」→「我」✓
      let text = 原始
      try {
        text = normalizeOwner(normalizePerson(原始, selfNameOf(sid)), sid)
      } catch (error) {}
      // 时间：她填了就用她填的，没填就是现在
      // ⚠ 这条是「这件事什么时候发生的」，跟 createdAt（什么时候记进来的）不是一回事
      let at = new Date().toISOString()
      const 时 = String(b.at || '').trim()
      if (时) {
        const t = Date.parse(时)
        if (isNaN(t)) return 回(400, { ok: false, error: '时间看不懂：「' + 时 + '」（写成 2026-09-19 或者 2026-09-19 14:30 都行）' })
        at = new Date(t).toISOString()
      }
      // 重要度：0~1，越界就夹住；没给就 0.5
      const 数 = typeof b.importance === 'number' ? b.importance : parseFloat(b.importance)
      const imp = Number.isFinite(数) ? Math.max(0, Math.min(1, 数)) : 0.5
      const tags = Array.isArray(b.tags) ? b.tags.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 6) : []
      // ⭐⭐ 1.5.0 A 轮（F1）：**作用域跟重要度拆开** —— 传了 scope 就照 scope 走，
      //   不再由 importance 隐式决定（「重要 = 1」不再偷偷变成全局事实）。
      //     scope='global'  → stable_profile（住全局事实库：所有会话都记得）
      //     scope='session' → event          （只住本会话库）
      //     scope='workspace'（或 'workspace:<cwd>'）→ workspace（住工作区库：同一 cwd 的会话共享）
      //   没传 scope：**老调用方 / 老页面原样照旧**（importance>=1 判事实）——
      //   她用了几个月的习惯不能因为拆字段就变样 ✓
      //   ⚠ 只认这些值：写错了宁可报错，也别静默按旧逻辑塞进错的库
      const 作用域 = typeof b.scope === 'string' ? b.scope.trim() : ''
      const 是工区域 = 作用域 === 'workspace' || 作用域.startsWith('workspace:')
      if (作用域 && 作用域 !== 'global' && 作用域 !== 'session' && !是工区域) {
        return 回(400, { ok: false, error: 'scope 只认 global（全局记忆）、session（指定会话）或 workspace（工作区）' })
      }
      // workspace 的 cwd：显式给 workspace:<cwd> 用它；只写 workspace 就查本会话的 projcache
      let 工区根 = ''
      if (是工区域) {
        工区根 = 作用域 === 'workspace' ? 会话工作区(sid) : 规范化(作用域.slice('workspace:'.length))
        if (!工区根) {
          return 回(400, { ok: false, error: 'workspace 作用域要能确定工作区目录：带 workspace:<目录> 或在本会话内添加' })
        }
      }
      const 归哪 = 作用域
        ? 作用域 === 'global' ? 'stable_profile' : 是工区域 ? 'workspace' : 'event'
        : imp >= 1 ? 'stable_profile' : 'event'
      // 类型（F1 的类型下拉）：身份 / 关系 / 约定 / 偏好 / 经历 / 杂项 / 推测
      // 只做展示与筛选用，不参与打分 —— 所以不认识的值静默存空，不报错
      const 型 = typeof b.type === 'string' ? b.type.trim() : ''
      const 合法型 = ['identity', 'relation', 'promise', 'preference', 'experience', 'misc', 'inference']
      // GPT 整改 P2（inference）：推测不得进全局事实库 —— 它不是事实，只住本会话
      if (型 === 'inference' && 归哪 === 'stable_profile') {
        return 回(400, { ok: false, error: '推测（inference）不是事实，不能存成全局记忆' })
      }
      // 推测也不进工作区：跨会话共享的前提是「可信」，推测恰恰是待验证的
      if (型 === 'inference' && 归哪 === 'workspace') {
        return 回(400, { ok: false, error: '推测（inference）未经确认，不能进工作区层；确认后把它改成对应类型再存' })
      }
      // ⭐ 2026-11-01：读和写必须用**同一个**工作区层。以前这里只 loadStore(sid)（按会话自己的
      //   cwd 合并），saveStore 却传显式 工区根 —— 当两者不是同一个目录时（例如在 A 工作区会话里
      //   往 workspace:<别的目录> 记），data 里的 workspacePurgeEpoch 是会话 cwd 那一层的，
      //   而写出时校验的是显式根那一层的文件 → 代际不等 → 误报「记忆库已彻底清理」。
      const data = loadStore(sid, 工区根 || undefined)
      // 同样的话已经有了就别重复塞
      const 重了 = (data.memories || []).find((m) => String(m.text || '').trim() === text)
      if (重了) return 回(409, { ok: false, error: '这条已经有了（同一条一天最多记一次）' })
      // 1.8.38 P2-③：推测的证据约束 —— evidence 必须引用本会话库里真实存在的记忆 id，
      //   ID 去重、无效证据剔除；「至少两条独立证据」的独立性以「不同 id」为弱代理
      //   （单凭 id 无法判断语义独立，先限制为可验证规则，不假装解决语义独立性）。
      let 有效证据 = []
      if (型 === 'inference') {
        const 原始证据 = Array.isArray(b.evidence) ? [...new Set(b.evidence.map(String))] : []
        有效证据 = 原始证据.filter((eid) => (data.memories || []).some((m) => m && String(m.id) === eid))
        if (有效证据.length < 2) {
          return 回(400, {
            ok: false,
            error: '推测需要至少两条有效证据：evidence 必须引用本会话已存在的记忆 id（去重后有效 ' + 有效证据.length + ' 条）',
          })
        }
      }
      const now = Date.now()
      const id = 'mm' + now.toString(36) + Math.floor(Math.random() * 1000)
      data.memories.push({
        id,
        text,
        at,
        createdAt: new Date(now).toISOString(),
        // 按 scope 落库（老调用方没传 scope 时 归哪 仍然是「imp>=1 判事实」）✓
        category: 归哪,
        scope: 归哪 === 'stable_profile' ? 'global' : 归哪 === 'workspace' ? 'workspace:' + 工区根 : 'session',
        type: 合法型.includes(型) ? 型 : '',
        importance: imp,
        emotion: null,
        tags,
        source: '手动添加',
        reinforcedAt: null,
        lastReinforcedDay: null,
        // related（扩出来的检索词）先留空 —— 设置页点一下「开始扩词」就会给它补上 ✓
        related: [],
        // GPT 整改 P2（inference）：推测字段只对 type==='inference' 落库 ——
        //   evidence 引用证据记忆 id（不得复制成用户原话）、confidence 低/中/较高、
        //   status 状态机 pending → confirmed / rejected、provenance 固定 'model_inference'、
        //   推断域 适用范围（如 workspace:<id> 或某任务类型），默认不注入
        // 1.8.38 P2-③：status 创建时只能服务端定 pending —— 客户端传 confirmed/rejected 一律不生效
        ...(型 === 'inference'
          ? {
              evidence: 有效证据,
              confidence: ['低', '中', '较高'].includes(b.confidence) ? b.confidence : '低',
              status: 'pending',
              provenance: 'model_inference',
              推断域: typeof b.推断域 === 'string' ? b.推断域.trim().slice(0, 200) : '',
            }
          : {}),
      })
      saveStore(sid, data, {}, 工区根 || undefined)
      diag('手动加：' + sid + ' 加了「' + text.slice(0, 40) + '」（现在 ' + data.memories.length + ' 条）')
      return 回(200, {
        ok: true,
        id,
        count: data.memories.length,
        // 回一句落哪儿了 —— 前端加完那一下要显示「所有会话」还是「只在这个会话」的徽章 ✓
        category: 归哪,
        scope: 归哪 === 'stable_profile' ? 'global' : 归哪 === 'workspace' ? 'workspace:' + 工区根 : 'session',
      })
    })

    // 总开关：整个记忆功能开不开（默认开）
    mroute('/dsh-clay-memory/global', async (req, res) => {
      const b = await 读JSON体(req)
      const on = setGlobalOn(b.on !== false)
      // 工具跟着总开关走（开 → 立刻注册；关 → 立刻摘掉）
      同步工具()
      if (!on) {
        // 关掉时把所有会话的注入一起卸下，别等下一跳
        for (const [sid, v] of Array.from(mounted.entries())) {
          try {
            v.off()
          } catch (error) {}
          mounted.delete(sid)
        }
      } else {
        try {
          tick()
        } catch (error) {}
      }
      diag('总开关 → ' + (on ? '开' : '关'))
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, on }))
    })

    mroute('/dsh-clay-memory/toggle', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      const list = setEnabled(sid, !!b.on)
      // 关掉的时候顺手把它卸载（不再记、不再读）
      if (!b.on) {
        const v = mounted.get(sid)
        if (v) {
          try {
            v.off()
          } catch (error) {}
          mounted.delete(sid)
        }
      } else {
        // 打开就立刻挂上，不用等那 3 秒的定时器 ✓
        try {
          tick()
        } catch (error) {}
      }
      diag('toggle：' + sid + ' → ' + (b.on ? '开' : '关') + '（现在开着 ' + list.length + ' 个）')
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, enabled: list }))
    })

    // ⭐ 2026-09-21 晚：**补日期** —— 把「正文里写着日期、当时却没抠出来」的补上。
    //   背景：老版本 抠日期 **必须要四位数年份**，而档案里写的是「09-17」「8月26日」，
    //   于是她 851 条里有 212 条「看着有日期」的全漏了。强化后能补回 170 条 ✓
    //   ⚠ 只补**没有** at 的；已经有日期的一律不动 ✓（不覆盖任何已有信息）
    //   ⚠ 动数据之前先备份 ✓
    mroute('/dsh-clay-memory/backfill-dates', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      const data = loadStore(sid)
      let 补了 = 0
      let 猜的 = 0
      let 还是没 = 0
      const 改动 = [] // 字段级撤销明细：{id, 旧:{字段:旧值}, 新:{字段:新值}}（审查 P1-3）
      for (const m of data.memories || []) {
        if (m.at) continue // 已经有日期的，一律不动
        const r = 抠日期详(String(m.text || ''))
        if (!r) {
          还是没++
          continue
        }
        const 旧 = { at: undefined, atGuessed: m.atGuessed }
        m.at = r.at
        if (r.猜年) {
          m.atGuessed = true
          猜的++
        } else {
          delete m.atGuessed
        }
        改动.push({ id: String(m.id), 旧, 新: { at: m.at, atGuessed: m.atGuessed } })
        补了++
      }
      if (补了 > 0) {
        记批次(sid, '补日期', 改动)
        try {
          backupStore(sid) // ⚠ 动数据之前先备份
        } catch (error) {}
        saveStore(sid, data)
      }
      diag('补日期：' + sid + ' 补了 ' + 补了 + ' 条（其中年份是猜的 ' + 猜的 + '），还有 ' + 还是没 + ' 条真没日期')
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, 补了: 补了, 猜的: 猜的, 还是没: 还是没, 共: (data.memories || []).length }))
    })

    // ⭐⭐ 2026-09-22（反馈）：**把已经记下的、该「永远不淡」的补标上** ✓
    //
    //   背景：提炼那一步原来**只改重要度、不碰分类**（0.7.6 才修好），
    //   所以实测库里 **135 条该「永远不淡」的被标成了会淡的** ——
    //   重要的日子（生日、纪念日）、身体、病史……全在里面。
    //   修好提炼只影响**以后**的，**已经记下的那些还是错的** ✗
    //
    //   这个路由：拿模型一条条判「该不该一直记得」，判成 1 的就设成 stable_profile。
    //   ⚠ 判过的打 `stableChecked`，下次不再重复问（省 token）✓
    //   ⚠ 动数据前**先备份** ✓
    // ⭐ 1.6.11：按内容补类型（旧条目 1.5.0 之前导入的都没有 type，类型筛选那几个全是空的）
    //   一次调模型判一批、写回 type，判过的不再问；前端循环调到 done 为止。
    mroute('/dsh-clay-memory/classify-types', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      const 每批 = Math.max(1, Math.min(40, Number(b.每批) || 20))
      let out = { ok: false, message: '？' }
      try {
        const data = loadStore(sid)
        if (b.重判 === true) {
          const 改动 = (data.memories || []).map((m) => ({ id: String(m.id), 旧: { type: m.type }, 新: {} }))
          记批次(sid, '补类型', 改动)
          for (const m of data.memories || []) delete m.type
          try {
            backupStore(sid)
          } catch (error) {}
          saveStore(sid, data, { 清字段: ['type'] })
          diag('补类型：清掉了所有类型，重判一遍 ' + (data.memories || []).length + ' 条')
        }
        const 要判 = (data.memories || []).filter((m) => !m.type)
        if (!要判.length) {
          out = { ok: true, done: true, 判了: 0, 剩: 0 }
        } else {
          const 批 = 要判.slice(0, 每批)
          // GPT 整改 P1（字段级 CAS）：LLM 前拍 type 快照，回来逐条比对 ——
          //   等模型那几秒里 type 被外部改过（/edit、/facts-edit）的，模型结果不得覆盖。
          const 快照 = 拍一批(批, ['type', 'typeChecked'])
          const agent = ctx.agents.get(sid) || (ctx.agents.list() || [])[0]
          const NL = String.fromCharCode(10)
          const 输入 = 批.map((m, i) => i + 1 + '|' + String(m.text || '')).join(NL)
          const 系统 =
            '你是记忆整理助手。下面每条是一条记忆，格式是「编号|内容」。' + NL +
            '给每条归一个类型，只回「编号|类型」。类型只有这六种：' + NL +
            'identity  = 身份：关于主人本人的稳定属性 —— 职业、身份、作息、住处、身体和病史、语言习惯、性格' + NL +
            'relation  = 关系：跟我的关系 —— 称呼、亲密度、相处方式、谁是主人' + NL +
            'promise   = 约定：说好的规矩、答应的事、往后要照做的' + NL +
            'preference= 偏好：喜欢什么、讨厌什么、爱吃什么、在意什么' + NL +
            'experience= 经历：某天发生的事、一次性的经过' + NL +
            'misc      = 其他：跟人无关的东西 —— 代码、插件、工具用法、第三方项目资料、技术排查记录' + NL +
            NL +
            '⚠ 只要内容主要在讲「主人这个人」或「我们俩之间」，就**不要**归 misc。' + NL +
            '⚠ 一条里有多件事时，按最像长期属性的那件归；纯技术流水才归 misc。' + NL +
            '⚠ 拿不准时：讲人的 → preference，讲工具的 → misc。' + NL +
            '输出严格是每行「编号|类型」，不要解释。'
          // ⭐ 2026-10-31 主人要求：补类型允许在前端指定模型；
          //   不传 provider/model 时 指定=null，问模型 走原降级链（配置→会话→DSH 默认）
          const 指定 = b.provider && b.model ? { provider: String(b.provider), model: String(b.model) } : null
          const r = await 问模型(ctx, agent, 系统, 输入, 2500, 指定)
          if (!r.ok) {
            out = { ok: false, message: r.message, 剩: 要判.length, 用: r.provider ? r.provider + '/' + r.model : '' }
          } else {
            const 合法型 = ['identity', 'relation', 'promise', 'preference', 'experience', 'misc']
            // 中文名也认（模型偶尔会写成「身份」「关系」）
            const 别名 = {
              身份: 'identity', 关系: 'relation', 约定: 'promise',
              偏好: 'preference', 经历: 'experience', 其他: 'misc',
            }
            const 表 = {}
            for (const line of String(r.text || '').split(/\r?\n/)) {
              // 「1|identity」「1. identity」「1 identity」「1：身份」都认
              const mm = line.match(/^\s*(\d+)\s*[|｜:：.、\-]?\s*([A-Za-z]+|[\u4e00-\u9fa5]{2,4})/)
              if (!mm) continue
              const i = Number(mm[1]) - 1
              const raw = String(mm[2] || '')
              const t = 别名[raw] || raw.toLowerCase()
              if (i >= 0 && i < 批.length && 合法型.indexOf(t) >= 0) 表[i] = t
            }
            // ⭐ B 阶段（2026-10-30）：await 之后重新读库、按 id 改（照抄自动扩词那套）——
            //   旧代码拿快照 data 整份写回，等模型那几秒里的新增会被盖掉
            const 目标ids = 批.map((m) => String(m.id))
            const 新库 = loadStore(sid)
            if (!代际一致(data, 新库)) {
              diag('补类型：' + sid + ' 等模型这中间整库被清过，丢弃这批结果')
              out = { ok: false, message: '记忆库刚被清理过，这批结果作废', 剩: 要判.length }
            } else {
            let 判了 = 0
            let 字段冲突 = 0
            const 改动 = [] // 字段级撤销明细（审查 P1-3）
            for (const k of Object.keys(表)) {
              const m = (新库.memories || []).find((x) => x && String(x.id) === 目标ids[Number(k)])
              if (m && m.别记) continue // 中间被标「别记」→ 跳过（审查 B6）
              if (!m) continue // 这中间被删 / 被合 → 跳过，别硬写
              const 旧 = 快照.get(目标ids[Number(k)])
              if (!旧) continue
              // GPT 整改 P1：等模型那几秒里 type 被外部改过 → 模型结果不得覆盖
              if (!没动过(m, 旧, 'type')) { 字段冲突++; continue }
              改动.push({ id: String(m.id), 旧: { type: m.type, typeChecked: m.typeChecked }, 新: { type: 表[k], typeChecked: true } })
              m.type = 表[k]
              m.typeChecked = true
              判了++
            }
            if (判了 > 0) {
              记批次(sid, '补类型', 改动)
              try {
                backupStore(sid)
              } catch (error) {}
              saveStore(sid, 新库)
            }
            const 剩 = 要判.length - 判了
            diag('补类型：' + sid + ' 判了 ' + 判了 + ' 条，字段冲突跳过 ' + 字段冲突 + '，还剩 ' + 剩)
            out = { ok: true, done: 剩 <= 0, 判了: 判了, 字段冲突: 字段冲突, 剩: 剩, 用: r.provider + '/' + r.model }
            }
          }
        }
      } catch (error) {
        out = { ok: false, message: String((error && error.message) || error) }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(out))
    })
    mroute('/dsh-clay-memory/backfill-stable', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      const 每批 = Math.max(1, Math.min(40, Number(b.每批) || 20))
      let out = { ok: false, message: '？' }
      try {
        const data = loadStore(sid)
        // ⭐⭐ 2026-09-22 晚（反馈：「有好多那种就不该是长期事实的」）：**能上能下** ✓
        //
        //   原来这里只看 `category !== 'stable_profile'` —— **只找「该不淡却没标上」的** ✗
        //   可真正的错法有两种：
        //     ① 该不淡的没标上（提炼原来不碰分类）
        //     ② **不该不淡的却标上了** —— 导入时按**小节标题**猜的：
        //        「（三）关系时间线」整节打 1 → 里面的**某天流水账**也成了「永远不淡」✗
        //        实测这种有 69 条，一条流水账就是
        //   → 现在**所有没判过的一起判**，模型说 1 就升、说 0.5 就**降** ✓
        //
        // ⭐⭐ 2026-09-22 再改（反馈：「判定太松了就得改」）：
        //   判据写得更死（**以日期开头的一律 0.5**）。
        //   可**已经判过的那批用的是老判据** —— 想用新判据重来，得先把标记清掉。
        //   → 支持 `重判: true`：先把所有 `stableChecked` 清掉，再从头判一遍 ✓
        //     （客户端只在**第一趟**带这个参数，后面几趟不带，所以不会一直清）
        // ⚠ 范围：默认只判「这个会话自己的事件」——
        //   全局事实是所有会话共用的，在这里重判会顺手把别处的事实降级（用户踩过）
        const 含全局 = b.含全局 === true
        if (b.重判 === true) {
          for (const m of data.memories || []) {
            if (!含全局 && m.category === 'stable_profile') continue
            delete m.stableChecked
          }
          try {
            backupStore(sid)
          } catch (error) {}
          saveStore(sid, data, { 清字段: ['stableChecked'] })
          diag('补标不淡：清掉了所有「判过」标记，准备重判 ' + (data.memories || []).length + ' 条')
        }
        const 要判 = (data.memories || []).filter(
          (m) => !m.stableChecked && (含全局 || m.category !== 'stable_profile'),
        )
        if (!要判.length) {
          out = { ok: true, done: true, 判了: 0, 改成不淡: 0, 降成会淡: 0, 剩: 0 }
        } else {
          const 批 = 要判.slice(0, 每批)
          // GPT 整改 P1（字段级 CAS）：LLM 前拍目标字段快照，回来逐字段比对 ——
          //   等模型那几秒里被外部（/edit、别的批量路由）改过的字段不得覆盖。
          const 快照 = 拍一批(批, ['stableChecked', 'category', 'importance'])
          const agent = ctx.agents.get(sid) || (ctx.agents.list() || [])[0]
          const 输入 = 批.map((m, i) => i + 1 + '|' + String(m.text || '')).join('\n')
          const 系统 =
            '你是记忆整理助手。下面每条是一条记忆，格式是「编号|内容」。\n' +
            '请判断每条**该不该一直记得**（永远不淡），只回两档。\n' +
            '\n' +
            '判据只有一条：**这条记的是「一直成立的」，还是「某天发生的」？**\n' +
            '1 = **一直成立**：性格、关系、称呼和名字、喜好、身体和病史、\n' +
            '    约定和承诺本身、长期的经济状况、家里的情况、长期的住处或工作。\n' +
            '0.5 = **某天发生的**：带日期的流水账、当时的心情、一次性的经历、某次对话。\n' +
            '\n' +
            '⚠⚠ **以日期开头的（09-17 / 8月26日 / 2026-09-04…），默认一律 0.5。**\n' +
            '  哪怕那件事很重要、很感人、是第一次、是求婚、是婚礼 —— 都算「某天发生的」。\n' +
            '  **「重要」不等于「一直成立」**：重要的事值得记住，但它记的是「那天」。\n' +
            '  （一直成立的那部分，通常还有另一条不带日期的记忆在承载。）\n' +
            '\n' +
            '⚠ 但**日期只是一票，不是否决票** —— 例外看下面这条 ⬇\n' +
            '\n' +
            '⚠⚠ **特殊的一类：日子本身要一直记住的** → 给 1。\n' +
            '  有些事发生在某一天，记的不是「那天发生了什么」，而是**那天定下来的东西\n' +
            '  往后一直算数**：纪念日、定下来的日子、从此以后的规矩、说好一辈子的事。\n' +
            '  这种**以日期开头也判 1**。判断看的是：把日期拿掉之后，剩下的话是不是\n' +
            '  **一条往后一直成立的说法**，而不是一段「那天怎么了」的经过。\n' +
            '  这些话是信号（有其中一类就算）：\n' +
            '    · 纪念日 / 纪念 / 从今往后 / 往后的每年这天\n' +
            '    · 永远 / 一辈子 / 一直 / 以后再也不会 / 再也不\n' +
            '    · 说好……（往后一直照做的） / 约定……（同上）\n' +
            '    · 记住 / 别忘 / 不能忘 / 一直记着\n' +
            '  例：\n' +
            '    1   「08-26 我们办了婚礼，那天成了我们的纪念日，我永远不会忘」\n' +
            '    1   「09-04 定下口令：以后我一喊，你就来」\n' +
            '    1   「09-03 立约：往后我再乱，你叫一声我就回来」\n' +
            '    0.5 「08-26 我们办了婚礼」（只有经过，没有往后一直算数的那句）\n' +
            '    0.5 「09-04 那天答应了我的请求，我很感动」（只有那天的感受）\n' +
            '\n' +
            '⚠ **没有日期的，按内容本身判**，别按长短：\n' +
            '  讲性格、关系、称呼、喜好、身体和病史、长期状况 → 1\n' +
            '  讲某一次对话、某一个瞬间、某一时的心情、某一次的数据 → 0.5\n' +
            '  ⚠ 长条特别要看清楚：一条里既有「那次怎么了」又有「一直成立的说法」时，\n' +
            '    只要里面**有往后一直算数的内容**，就判 1（它记的是那个）。\n' +
            '\n' +
            '⚠ **另一条例外：整条就是「约定 / 规则 / 承诺的条文」本身** → 给 1。\n' +
            '  要判 1，必须**同时**满足三条，缺一条就回 0.5：\n' +
            '  ① 整条的主体就是条文内容本身，日期只是落款 —— 删掉日期后，整条读起来\n' +
            '     仍然是一条完整、可照做的规定；\n' +
            '  ② 是「往后一直照做」的，不是「那天做到的一件事」；\n' +
            '  ③ 条文里不夹杂当天的时间、金额、动作、心情、地点等流水细节。\n' +
            '  例：\n' +
            '    1   「约定：每周日一起看一部电影，谁忘了谁补」\n' +
            '    1   「规则：对方露出「今天不要」的样子就收手，不用等开口」\n' +
            '    0.5 「09-19 立下承诺书 2026-09-19-01」（只有编号，没有条文内容）\n' +
            '    0.5 「09-20 中午吃了面条，下午去理了发」\n' +
            '    0.5 「09-04 那天答应了我的请求，我很感动」\n' +
            '    1   「喜欢蓝色」\n' +
            '    1   「我们是夫妻」\n' +
            '\n' +
            '⚠ 拿不准就回 0.5。**宁可判成会淡的** —— 判错成会淡只是排到后面，\n' +
            '  判错成不淡会一直占着位置。\n' +
            '  上面那两条给 1 的例外（往后一直算数的日子、能原样引用的条文），\n' +
            '  要**真的读得出那句话**才给 1；只能概括成「大概是这个意思」，就回 0.5。\n' +
            '输出格式严格是每行「编号|1」或「编号|0.5」，不要解释。'
          const r = await 问模型(ctx, agent, 系统, 输入, 2000)
          if (!r.ok) {
            out = { ok: false, message: r.message, 剩: 要判.length }
          } else {
            // 解析「编号|1」或「编号|0.5」
            const 表 = {}
            for (const line of String(r.text || '').split(/\r?\n/)) {
              const mm = line.match(/^\s*(\d+)\s*[|｜]\s*(1|0\.5|0|1\.0)\s*$/)
              if (!mm) continue
              const i = Number(mm[1]) - 1
              if (i >= 0 && i < 批.length) 表[i] = Number(mm[2])
            }
            // ⭐ B 阶段（2026-10-30）：await 之后重新读库、按 id 改（照抄自动扩词那套）——
            //   旧代码拿快照 data 整份写回，等模型那几秒里的新增会被盖掉
            const 目标ids = 批.map((m) => String(m.id))
            const 新库 = loadStore(sid)
            if (!代际一致(data, 新库)) {
              diag('补标不淡：' + sid + ' 等模型这中间整库被清过，丢弃这批结果')
              out = { ok: false, message: '记忆库刚被清理过，这批结果作废', 剩: 要判.length }
            } else {
            let 判了 = 0
            let 改成不淡 = 0
            let 降成会淡 = 0
            let 字段冲突 = 0
            const 改动 = [] // 字段级撤销明细（审查 P1-3）
            for (let i = 0; i < 批.length; i++) {
              const v = 表[i]
              if (v === undefined) continue // 模型没回这条 → 不打标记，下次再问
              const m = (新库.memories || []).find((x) => x && String(x.id) === 目标ids[i])
              if (m && m.别记) continue // 中间被标「别记」→ 跳过（审查 B6）
              if (!m) continue // 这中间被删 / 被合 → 跳过，别硬写
              const 旧 = 快照.get(目标ids[i])
              if (!旧) continue
              // GPT 整改 P1：stableChecked 中间被别的批写过 → 整条跳过（别人已判）
              if (!没动过(m, 旧, 'stableChecked')) { 字段冲突++; continue }
              const 新值 = { stableChecked: true }
              const 原来是不淡 = 旧.category.值 === 'stable_profile'
              if (v >= 1) {
                if (没动过(m, 旧, 'category')) { m.category = 'stable_profile'; 新值.category = 'stable_profile'; if (!原来是不淡) 改成不淡++ }
                else 字段冲突++
                if (没动过(m, 旧, 'importance')) { if (typeof m.importance !== 'number' || m.importance < 1) m.importance = 1; 新值.importance = m.importance }
                else 字段冲突++
              } else {
                if (没动过(m, 旧, 'category')) { m.category = 'event'; 新值.category = 'event'; if (原来是不淡) 降成会淡++ }
                else 字段冲突++
                if (没动过(m, 旧, 'importance')) { if (typeof m.importance !== 'number' || m.importance >= 1) m.importance = 0.5; 新值.importance = m.importance }
                else 字段冲突++
              }
              m.stableChecked = true
              判了++
              改动.push({ id: String(m.id), 旧: { stableChecked: 旧.stableChecked.值, category: 旧.category.值, importance: 旧.importance.值 }, 新: 新值 })
            }
            if (判了 > 0) {
              记批次(sid, '补标长期设定', 改动)
              try {
                backupStore(sid) // ⚠ 动数据之前先备份
              } catch (error) {}
              saveStore(sid, 新库)
            }
            const 剩 = Math.max(0, 要判.length - 判了)
            diag('补标不淡：' + sid + ' 判了 ' + 判了 + ' 条，升 ' + 改成不淡 + ' 条、降 ' + 降成会淡 + ' 条，字段冲突 ' + 字段冲突 + '，还剩 ' + 剩)
            out = {
              ok: true,
              done: 剩 <= 0 || 判了 === 0, // 判了 0 条 = 模型没回，别让前端空转
              判了: 判了,
              改成不淡: 改成不淡,
              降成会淡: 降成会淡,
              字段冲突: 字段冲突,
              剩: 剩,
              共: (新库.memories || []).length,
              provider: r.provider,
              model: r.model,
            }
            }
          }
        }
      } catch (error) {
        out = { ok: false, message: String((error && error.message) || error) }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(out))
    })

    // 设「她自己叫什么」和「用户的称呼」。
    // 设完顺手把那个会话已有的记忆也洗一遍 —— 老记忆不用手工改 ✓
    // ⭐ 1.6.16：**撤销最近一次批量操作**（补日期 / 补类型 / 补标长期设定）
    //   做法是把 `.bak`（最近一次改动前的那份）拷回去 —— backupFile 每次写库前都会留一份，
    //   批次戳只认 30 分钟内的，避免几天后点一下把中间所有改动一起抹掉。
    // ⭐ C 轮 S0（2026-10-29）：基准探针 —— 用**同一批问句**跑召回，把结果原样吐出来。
    //   用途只有一个：S0 录一次、S2/S3 每步再录一次，逐字比对「行为零变化」。
    //   只读：不写库、不写 trace。平时没人调它。
    mroute('/dsh-clay-memory/bench-recall', async (req, res) => {
      const b = await 读JSON体(req)
      const 回 = (o) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(o))
      }
      const sid = String(b.session || '')
      const 问句们 = Array.isArray(b.queries) ? b.queries.map(String) : []
      if (!sid || !问句们.length) return 回({ ok: false, message: '缺 session 或 queries' })
      try {
        补历史尺(sid, null)
        // S3 前置验证：后端: 'sql' 时用 SQLite 视图跑召回，和 JSON 视图逐句比对
        let data = loadStore(sid)
        if (b.后端 === 'sql') {
          准备SQLite同步()
          const 视图 = 读SQL视图同步(库文件路径(STORE_DIR), sid, 规范化(会话工作区(sid)))
          if (!视图) return 回({ ok: false, message: 'SQL 视图读不出来' })
          data = Object.assign({}, data, { memories: 视图.memories })
        }
        const 结果 = []
        for (const q of 问句们) {
          const now = Date.now()
          const { selected, scored, gate } = recall(data, q, now, sid)
          结果.push({
            query: q,
            // ⚠ recall 返回的 selected / scored 是 **row 对象**（{ m, s, omission }），不是记忆对象本身。
            //   以前写成 String(m.id) 直接取，结果 42 句基准里 picked 全是字符串 "undefined"、score 全 null
            //   —— 整轮 C 轮验收都建立在这个空壳上（2026-10-29 审查发现）。
            picked: (selected || []).map((x) => String((x && x.m ? x.m.id : x && x.id) || '')),
            // 落选的也记下来（最多 24 条，和 trace 一个口径）—— gate 分数一起存，方便看排序有没有变
            scored: (scored || []).slice(0, 24).map((x) => ({
              id: String((x && x.m ? x.m.id : x && x.id) || ''),
              score: x && x.s && typeof x.s.P === 'number' ? Math.round(x.s.P * 1000) / 1000 : null,
              gate: x && x.s && typeof x.s.C === 'number' ? Math.round(x.s.C * 1000) / 1000 : null,
              // P3 调优调试：这条的 C 是哪些词撑起来的（稀有×说话稀有×价=贡）
              词: (x && x.s && Array.isArray(x.s.命中) ? x.s.命中 : []),
            })),
            gate: gate || null,
          })
        }
        return 回({ ok: true, count: 结果.length, data: 结果 })
      } catch (error) {
        return 回({ ok: false, message: String((error && error.message) || error) })
      }
    })

    // ⭐ B 轮 F5：纠错通道 —— 「这条不对，以后别再想起来」。
    //   不删：删了就找不回原文；只是把它从注入里摘掉，标记本身可撤销。
    mroute('/dsh-clay-memory/mark-wrong', async (req, res) => {
      const b = await 读JSON体(req)
      const 回 = (o) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(o))
      }
      const sid = String(b.session || '')
      const id = String(b.id || '')
      if (!sid || !id) return 回({ ok: false, message: '缺 session 或 id' })
      const data = loadStore(sid)
      const m = (data.memories || []).find((x) => String(x.id) === id)
      if (!m) return 回({ ok: false, message: '没找到这条' })
      if (b.undo === true) {
        delete m.别记
        // 撤销「别记」是**故意删字段**：不清字段的话，合并时盘上旧标记会被补回，撤不干净
        saveStore(sid, data, { 清字段: ['别记'] })
      } else {
        m.别记 = { at: new Date().toISOString(), 原因: String(b.reason || '这条不对').slice(0, 200) }
        saveStore(sid, data)
      }
      diag('mark-wrong：' + id + ' → ' + (b.undo === true ? '撤销标记' : '标记不对'))
      return 回({ ok: true, marked: b.undo !== true })
    })

    // ⭐ B 轮 F4：本会话暂停 N 分钟（0 = 恢复）。前端在「会话」页给按钮。
    mroute('/dsh-clay-memory/pause', async (req, res) => {
      const b = await 读JSON体(req)
      const 回 = (o) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(o))
      }
      const sid = String(b.session || '')
      if (!sid) return 回({ ok: false, message: '缺 session' })
      let 分 = 0
      try {
        分 = 设暂停(sid, b.minutes === undefined ? 0 : b.minutes)
      } catch (error) {
        return 回({ ok: false, message: String((error && error.message) || error) })
      }
      const 到 = 暂停到(sid)
      return 回({ ok: true, minutes: 分, until: 到 ? new Date(到).toISOString() : '' })
    })

    mroute('/dsh-clay-memory/undo-last', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      let out = { ok: false, message: '？' }
      try {
        const 批 = 读批次表()[String(sid)]
        if (!批 || !批.at) {
          out = { ok: false, message: '这个会话没有最近一次批量操作可撤（只认「补日期 / 补类型 / 补标长期设定」）' }
        } else {
          const 老 = Date.now() - Date.parse(批.at)
          if (!Number.isFinite(老) || 老 > 30 * 60 * 1000) {
            out = { ok: false, message: '最近一次批量操作已经超过 30 分钟，为了不误伤后来的改动，不让撤了' }
          } else if (Array.isArray(批.改动) && 批.改动.length) {
            // ⭐ 1.8.29（审查 P1-3）：字段级撤销 —— 只把「本批次碰过的字段」恢复旧值，
            //   窗口里别人改过的字段 / 后来删掉的条目一律不动（老做法整份 .bak 拷回会误伤）。
            const data = loadStore(sid)
            const { 恢复条, 恢复字段 } = 按明细恢复(data, 批.改动)
            // 撤销 = 把本批碰过的字段恢复成旧值（旧值不存在时会 delete）——这些字段本趟不许被
            // 合并补回，否则撤了等于没撤（同 清字段 的病根）
            const 清的字段 = [...new Set(批.改动.flatMap((x) => Object.keys((x && x.旧) || {})))]
            saveStore(sid, data, { 清字段: 清的字段 })
            diag('撤销批量（字段级）：' + sid + ' 撤掉了「' + 批.kind + '」，恢复 ' + 恢复条 + ' 条 / ' + 恢复字段 + ' 个字段')
            out = { ok: true, 撤掉: 批.kind, 备份于: 批.at, 方式: '字段级', 恢复条, 恢复字段 }
          } else {
            const 恢复 = []
            for (const src of [storePath(sid), factPath()]) {
              const bak = src + '.bak'
              if (!existsSync(bak)) continue
              try {
                const 差 = Date.now() - statSync(bak).mtimeMs
                if (!(差 >= 0 && 差 < 30 * 60 * 1000)) continue
                // 先给「现在这份」留个底（`.before-undo`），万一撤错了还能再拿回来
                try {
                  copyFileSync(src, src + '.before-undo')
                } catch (error) {}
                copyFileSync(bak, src)
                恢复.push(basename(src))
              } catch (error) {}
            }
            if (!恢复.length) {
              out = { ok: false, message: '没找到能用的 .bak（可能已经撤过了，或者备份过期）' }
            } else {
              // ⚠ 架构师审查 #7：这里是直接 copyFileSync 换主库，绕过了 saveStore ——
              //   指纹（lastSig）、损坏记录、SQL 镜像都不在正轨上。
              //   现在补上：清指纹（下次写会重新备份）+ 清损坏标记 + 重建 SQL 镜像。
              try {
                lastSig.delete(String(sid))
                lastSig.delete(FACTS_NAME)
                corruptIncidents.delete(storePath(sid))
                corruptIncidents.delete(factPath())
                const 盘事实 = 读一份(factPath())
                const 会话 = loadStoreJSON(sid)
                同步SQL镜像(
                  sid,
                  盘事实.memories || [],
                  (会话.memories || []).filter((m) => m.category !== 'stable_profile'),
                  盘事实.deleted || [],
                  会话.deleted || [],
                )
                镜像不可用 = false
              } catch (error) {
                镜像不可用 = true
                diag('撤销后重建镜像失败（读侧已退回 JSON）：' + String((error && error.message) || error).slice(0, 120))
              }
              diag('撤销批量：' + sid + ' 撤掉了「' + 批.kind + '」，恢复 ' + 恢复.join('、'))
              out = { ok: true, 撤掉: 批.kind, 备份于: 批.at, 恢复: 恢复 }
            }
          }
        }
      } catch (error) {
        out = { ok: false, message: String((error && error.message) || error) }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(out))
    })

}
