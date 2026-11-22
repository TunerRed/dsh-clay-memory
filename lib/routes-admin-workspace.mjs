// 管理路由 · 工作区记忆 / 会话筛选 / 重复检测与合并 / 清洗计划
import { 是会话文件, STORE_DIR, storePath, 工作区文件, 工作区文件旧, 规范化, factPath } from './paths.mjs'
import { 像度, 词集, 归一键 } from './scoring.mjs'
import { 标trace状态 } from './trace-log.mjs'
import { backupStore, backupFile } from './backup.mjs'
import { 工作区号, 归档名单 } from './ui.mjs'
import { loadStore, saveStore, corruptSnapshots, 读一份, 同步SQL镜像 } from './store-core.mjs'
import { existsSync, readdirSync } from 'node:fs'
import { writeFileAtomicSync } from './atomic-file.mjs'
import { titleOfSession } from './tools.mjs'
import { diag } from './diag.mjs'
import { 重复门槛, 真重复门槛 } from './scoring.mjs'

// ⭐⭐ 2026-09-22（反馈：「查重我们是不是还没做啊？我怎么没有找到按钮」）：
//   查重**本来就有**，但都是**自动**的 —— 召回时去重（注入前只留一条）、导入时去重。
//   **库里已经存着的重复，没人管** ✗ → 补一个能手动查、手动合的路由 ✓
//
//   ⚠⚠ **不能一键全合**：0.85 这套算法拿**短的那条**当分母，
//     所以「一条长的把几条短的包住」也判成重复（1.0 分）。
//     实测实测库里 69 对：**34 对是真重复**（两条长度差不多，合了安全），
//     **35 对是「汇总+明细」**（一长一短，合了会丢信息）✗
//     例：6 条一组里「她是全职代肝 / 她21岁 / 记错已改…」是 6 件**不同**的事，
//         自动合会压成 1 件 ✗
//     → 真重复给「一键合」，汇总+明细**只列出来让你挑** ✓
export const 找重复组 = (memories) => {
  const 带 = memories.map((m) => ({ m, 片段: 词集(m.text), 长: String(m.text || '').length }))
  // ⚠⚠ 2026-09-22 修（反馈：「把一些别的对的事实给删了」）：
  //   原来是**并查集**（A 像 B、B 像 C → A/B/C 算一组）——
  //   可 **A 和 C 可能根本不像**，一组就被串成杂烩 ✗✗
  //   实测实测库里一组 6 条：两条互不相关的事实毫不相干，
  //     只因为中间有别的条目连着 → 一键合把两条互不相关的事实
  //     这些**别的事实**一起合掉了 ✗
  //   → 改成**按种子归组**：每条只跟「种子那条」比，
  //     保证**组里每一条都真的像种子** ✓（不再有传递链）
  const 用过 = new Array(带.length).fill(false)
  const 组们 = []
  for (let i = 0; i < 带.length; i++) {
    if (用过[i]) continue
    用过[i] = true
    const 组 = [带[i]]
    for (let j = i + 1; j < 带.length; j++) {
      if (用过[j]) continue
      const 像 = 像度(带[i].片段, 带[j].片段)
      if (像 >= 重复门槛) {
        用过[j] = true
        组.push({ ...带[j], 像 })
      }
    }
    if (组.length > 1) 组们.push(组)
  }
  return (
    组们
      // ⭐⭐ 2026-09-23（反馈「这两处就是完全重复的呀，为什么他还是在汇总里面」）：
      //   原来**整组只看一个「长比」** —— 组里只要混进一条很短的、
      //   或者一条「把好几件事缝在一起」的长条，长比就掉到 0.8 以下，
      //   **整组**判成「汇总+明细」→ 明明 0.93 的两条也不给一键合 ✗
      //   实测那一组：36字 ↔ 33字 像度 0.93、长比 0.92（本该是真重复），
      //   可组里还混着一条 14 字的 → 长比 0.39 → 全组被降级 ✗
      //   → 改成**组内按「对」再分一次**：
      //     两两满足真重复（长比 ≥0.8 且像度 ≥真重复门槛）的，单独拎出来给一键合 ✓
      //     剩下的凑成「汇总+明细」（只剩 1 条的就不单独成组了）
      .flatMap((g) => {
        const 归过 = new Set()
        const 出 = []
        for (let i = 0; i < g.length; i++) {
          for (let j = i + 1; j < g.length; j++) {
            if (归过.has(i) || 归过.has(j)) continue
            const 像 = 像度(g[i].片段, g[j].片段)
            const 比 = Math.min(g[i].长, g[j].长) / Math.max(g[i].长, g[j].长)
            if (比 >= 0.8 && 像 >= 真重复门槛) {
              归过.add(i)
              归过.add(j)
              出.push({ 类型: '真重复', 条们: [g[i], g[j]] })
            }
          }
        }
        const 剩 = g.filter((_, i) => !归过.has(i))
        if (剩.length > 1) 出.push({ 类型: '汇总明细', 条们: 剩 })
        return 出
      })
      .map((g) => ({
        类型: g.类型,
        条们: g.条们.map((x) => ({
          id: x.m.id,
          text: String(x.m.text || ''),
          category: x.m.category,
          at: x.m.at || null,
          长: x.长,
        })),
      }))
      .sort((a, b) => (a.类型 === b.类型 ? b.条们.length - a.条们.length : a.类型 === '真重复' ? -1 : 1))
  )
}

export function 注册工作区与去重路由(mroute, 环) {
  const { ctx, 读JSON体 } = 环

    mroute('/dsh-clay-memory/duplicates', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      let out = { ok: false, message: '？' }
      try {
        const data = loadStore(sid)
        // 跟召回一样：跳过「提炼判跳过」的
        const 活的 = (data.memories || []).filter((m) => !m.refinedSkip)
        const 组们 = 找重复组(活的)
        out = {
          ok: true,
          组: 组们,
          真重复组数: 组们.filter((g) => g.类型 === '真重复').length,
          汇总组数: 组们.filter((g) => g.类型 !== '真重复').length,
          能少: 组们.reduce((n, g) => n + g.条们.length - 1, 0),
          参与: 活的.length,
          共: (data.memories || []).length,
        }
      } catch (error) {
        out = { ok: false, message: String((error && error.message) || error) }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(out))
    })

    // 合并：**逐条验过才收** —— 只把「真的像留下来那条」的收起来 ✓
    //   ⚠⚠ 2026-09-22 修（反馈：「把一些别的对的事实给删了」）：
    //     原来只收一份 id 名单，**服务端不验** —— 客户端算错了就真删错 ✗
    //     现在服务端**自己再算一遍相似度**：不像的**一条都不收**，并且报出来 ✓
    mroute('/dsh-clay-memory/duplicates/merge', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      const 组们 = Array.isArray(b.组) ? b.组.slice(0, 300) : []
      let out = { ok: false, message: '？' }
      try {
        const data = loadStore(sid)
        if (!Array.isArray(data.deleted)) data.deleted = []
        const 按id = new Map((data.memories || []).map((m) => [String(m.id), m]))
        const 要收 = new Set()
        const 没验过 = []
        for (const g of 组们) {
          const 留 = 按id.get(String((g && g.留) || ''))
          if (!留) continue
          const 留片 = 词集(留.text)
          for (const id of Array.isArray(g && g.删) ? g.删 : []) {
            const m = 按id.get(String(id))
            if (!m) continue
            const 像 = 像度(留片, 词集(m.text))
            // ⚠ 只有**真的像**才收；不像的一律保住（宁可留着重复，也不许删错）✓
            if (像 >= 重复门槛) 要收.add(String(m.id))
            else 没验过.push({ id: String(m.id), 像度: Number(像.toFixed(3)), text: String(m.text || '').slice(0, 60) })
          }
        }
        const 留着 = []
        let 收起来 = 0
        for (const m of data.memories || []) {
          if (要收.has(String(m.id))) {
            m.deletedAt = new Date().toISOString()
            m.合并掉的 = true // 跟普通「删」区分开，以后想找回来好认
            data.deleted.push(m)
            标trace状态(sid, m.id, 'invalidated')
            收起来++
          } else 留着.push(m)
        }
        if (收起来 > 0) {
          try {
            backupStore(sid) // ⚠ 动数据之前先备份
          } catch (error) {}
          data.memories = 留着
          saveStore(sid, data)
          diag('查重合并：' + sid + ' 合掉 ' + 收起来 + ' 条，验不过保住 ' + 没验过.length + ' 条，剩 ' + 留着.length + ' 条')
          out = {
            ok: true,
            收起来: 收起来,
            保住: 没验过.length,
            保住明细: 没验过.slice(0, 20),
            剩: 留着.length,
            message:
              '合掉了 ' + 收起来 + ' 条（收在「已删」里，能找回来）' +
              (没验过.length ? '；另有 ' + 没验过.length + ' 条**不够像、保住了**' : ''),
          }
        } else {
          out = { ok: false, message: 没验过.length ? '这些都不够像，一条都没合（保住了 ' + 没验过.length + ' 条）' : '没有要合的', 保住: 没验过.length, 保住明细: 没验过.slice(0, 20) }
        }
      } catch (error) {
        out = { ok: false, message: String((error && error.message) || error) }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(out))
    })

    // 工作区列表（选目标会话的第一级）
    mroute('/dsh-clay-memory/workspaces', async (req, res) => {
      const out = { ok: true, workspaces: [], 当前: String(process.cwd() || '') }
      try {
        const wr = ctx.get('workspaceRegistry')
        const list = wr && typeof wr.list === 'function' ? (wr.list() || []) : []
        // ⭐ 2026-10-31 主实例：数字按「实际会列出来的会话」算 —— 减归档、减空壳
        //   （没标题且没存过记忆的会话），和切进去的列表完全一致
        const 归档 = 归档名单(ctx)
        // ⭐ 2026-11-01 用户反馈：「工作区记忆的下拉框里显示的数字是会话数量，不是工作区级记忆数量」。
        //   → 每个工作区补一个 记忆数 = 它自己 _ws-<hash>.json 里的活条目数（哈希名优先、旧名兜底，
        //     和 /workspace-memories 同口径）。会话页下拉仍用 会话数，两处各取所需。
        const 数记忆 = (p) => {
          const cwd = 规范化(String(p || ''))
          if (!cwd) return 0
          const 新文件 = 工作区文件(cwd)
          const 旧文件 = 工作区文件旧(cwd)
          const 实文件 = existsSync(新文件) ? 新文件 : existsSync(旧文件) ? 旧文件 : ''
          if (!实文件) return 0
          try {
            const 盘 = 读一份(实文件)
            return (Array.isArray(盘 && 盘.memories) ? 盘.memories : []).filter((m) => m && typeof m === 'object').length
          } catch (e) {
            return 0
          }
        }
        out.workspaces = list.map((w, i) => {
          const sid们 = ((w && w.sessionIds) || []).map(String)
          let 有效 = 0
          for (const sid of sid们) {
            if (归档.has(sid)) continue
            const 标题 = titleOfSession(ctx, sid)
            if (!标题 && !existsSync(storePath(sid))) continue
            有效++
          }
          return {
            id: 工作区号(w, i),
            name: String((w && (w.name || w.title || w.path)) || ('工作区 ' + (i + 1))),
            path: String((w && w.path) || ''),
            会话数: 有效,
            记忆数: 数记忆(w && w.path),
          }
        })
        if (!list.length) { out.ok = false; out.message = '拿不到工作区列表' }
      } catch (error) { out.ok = false; out.message = String((error && error.message) || error) }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(out))
    })

    // ⭐ 2026-11-01 用户要求：1.8.37 加的工作区记忆层（scope=workspace:<cwd>）一直没有界面，
    //   在「会话」页签里补一个并列的「工作区记忆」只读视图。数据直接读该工作区自己的
    //   _ws-<hash>.json（不走合并视图 —— 那会混进全局事实和当前会话的事件，看不出这一层）。
    mroute('/dsh-clay-memory/workspace-memories', async (req, res) => {
      const u = new URL(String(req.url || ''), 'http://127.0.0.1')
      // ⭐ 2026-11-01 用户：「工作区记忆能加个删除吗，现有 api 支不支持？」
      //   GET = 只读列出；POST = 收起来（delete）/ 找回来（restore）。
      //   直接读写该工作区自己的 _ws-<hash>.json —— 和列表同口径，不经过会话合并视图，
      //   这样「哪个工作区的记忆」永远是明确的，不会误删别的层。
      const 方法 = String((req && req.method) || 'GET').toUpperCase()
      if (方法 === 'POST') {
        const b = await 读JSON体(req)
        const 动作 = String(b.action || 'delete')
        const id = String(b.id || '')
        const cwd = 规范化(String(b.workspace || ''))
        let out = { ok: false }
        try {
          if (!cwd || !id) {
            out.message = '缺工作区或条目 id'
          } else {
            const 实文件 = [工作区文件(cwd), 工作区文件旧(cwd)].find((f) => f && existsSync(f)) || ''
            const 盘 = 实文件 ? 读一份(实文件) : null
            if (!实文件) out.message = '这个工作区还没有记忆库文件'
            else if (!盘 || !Array.isArray(盘.memories)) out.message = '工作区记忆库读不出来，先不写'
            else if (corruptSnapshots.has(盘)) out.message = '工作区记忆库结构不合法（已判毒），拒绝写回'
            else {
              if (!Array.isArray(盘.deleted)) 盘.deleted = []
              const 写回 = () => {
                backupFile(实文件)
                writeFileAtomicSync(实文件, JSON.stringify(盘))
              }
              if (动作 === 'delete') {
                const i = 盘.memories.findIndex((m) => m && String(m.id) === id)
                if (i < 0) out.message = '没找到这一条（可能刚被别处删了）'
                else {
                  const m = 盘.memories.splice(i, 1)[0]
                  m.deletedAt = new Date().toISOString()
                  盘.deleted.push(m)
                  写回()
                  diag('工作区记忆收起来：' + cwd + ' / ' + id + ' 「' + String(m.text || '').slice(0, 30) + '」')
                  out = { ok: true, message: '收起来了（进了这个工作区的回收站，能找回来）' }
                }
              } else if (动作 === 'restore') {
                const i = 盘.deleted.findIndex((m) => m && String(m.id) === id)
                if (i < 0) out.message = '这个工作区的回收站里没有它'
                else {
                  const m = 盘.deleted.splice(i, 1)[0]
                  delete m.deletedAt
                  盘.memories.push(m)
                  写回()
                  diag('工作区记忆找回来：' + cwd + ' / ' + id)
                  out = { ok: true, message: '找回来了' }
                }
              } else {
                out.message = 'action 只认 delete / restore'
              }
              // 镜像层的 workspace 行跟着改（别的会话保存时 ws根 为空会跳过 workspace，
              // 不同步的话被删的行会一直残留在 SQL 镜像里）。global 行按真实事实库重插。
              if (out.ok) {
                try {
                  const 事实盘 = 读一份(factPath())
                  const 事实们 = Array.isArray(事实盘 && 事实盘.memories) ? 事实盘.memories : []
                  const 事实坟 = Array.isArray(事实盘 && 事实盘.deleted) ? 事实盘.deleted : []
                  同步SQL镜像(cwd, 事实们, [], 事实坟, [], cwd, 盘.memories, 盘.deleted)
                } catch (e) {
                  diag('工作区记忆镜像同步失败：' + ((e && e.message) || e))
                }
              }
            }
          }
        } catch (error) { out = { ok: false, message: String((error && error.message) || error) } }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(out))
        return
      }
      const cwd = 规范化(String(u.searchParams.get('workspace') || ''))
      const out = { ok: true, workspace: cwd, file: '', count: 0, memories: [], 回收站: [] }
      try {
        if (!cwd) {
          out.ok = false
          out.message = '先选一个工作区'
        } else {
          const 文件 = 工作区文件(cwd)
          // 1.8.38 之前存的是旧消毒名文件 —— 读的时候先看哈希名，没有再回旧名（同 loadStoreJSON 口径）
          const 旧文件 = 工作区文件旧(cwd)
          const 实文件 = existsSync(文件) ? 文件 : existsSync(旧文件) ? 旧文件 : ''
          out.file = 实文件 || 文件 || ''
          if (!实文件) {
            out.message = '这个工作区还没有记忆库文件（还没记过项目记忆）'
          } else {
            const 盘 = 读一份(实文件)
            const 列 = (盘 && Array.isArray(盘.memories) ? 盘.memories : []).filter((m) => m && typeof m === 'object')
            out.memories = 列
              .map((m) => ({
                id: String(m.id || ''),
                text: String(m.text || ''),
                importance: typeof m.importance === 'number' ? m.importance : 0.5,
                at: String(m.at || ''),
                createdAt: String(m.createdAt || ''),
                category: String(m.category || ''),
                type: String(m.type || ''),
                scope: String(m.scope || ''),
              }))
              .sort((a, b) => String(b.at || b.createdAt || '').localeCompare(String(a.at || a.createdAt || '')))
            out.count = out.memories.length
            // ⭐ 2026-11-01 用户问「回收站在哪个地方」：回收站就是本文件里的 deleted 数组，
            //   这里一并吐出来，界面上能看、能点「找回来」（POST action=restore）。
            out.回收站 = (Array.isArray(盘 && 盘.deleted) ? 盘.deleted : [])
              .filter((d) => d && typeof d === 'object' && String(d.id || ''))
              .map((d) => ({
                id: String(d.id || ''),
                text: String(d.text || ''),
                importance: typeof d.importance === 'number' ? d.importance : 0.5,
                at: String(d.at || ''),
                deletedAt: String(d.deletedAt || ''),
              }))
              .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))
            if (!out.count) {
              // 文件在但一条活的都没有：说清是「全进回收站了」还是「压根没记过」，别只给个空列表
              const 坟数 = Array.isArray(盘 && 盘.deleted) ? 盘.deleted.length : 0
              out.message = 坟数
                ? '这个工作区还没有活着的记忆（回收站里有 ' + 坟数 + ' 条）'
                : '这个工作区的记忆库文件还是空的（还没记过项目记忆）'
            }
          }
        }
      } catch (error) { out.ok = false; out.message = String((error && error.message) || error) }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(out))
    })
    // ⭐ F15（1.10.3）：健康度 —— 最近 N 天注入了几次、有几次真想起东西、平均几条几个字。
    //   以前设置页只看得见「最近一次召回」，看不出这几天到底有没有在工作（零命中也看不出）。
    // ⭐ F20（1.12.13）：整理搬到「记忆」页 —— 一次看全部会话的「真重复」，
    //   不用一个个会话点进去查。只读：合并仍走 /duplicates/merge（逐条验过才收）。
    mroute('/dsh-clay-memory/duplicates-all', async (req, res) => {
      const out = { ok: true, 会话: [], 总组: 0, 能少: 0 }
      try {
        let 文件们 = []
        try {
          文件们 = readdirSync(STORE_DIR).filter((f) => f.endsWith('.json') && 是会话文件(f))
        } catch (error) {}
        const 条们 = []
        for (const f of 文件们) {
          const sid = String(f).slice(0, -5) // 去掉 .json
          let data
          try {
            data = loadStore(sid)
          } catch (error) {
            continue
          }
          const 活的 = (data.memories || []).filter((m) => m && !m.refinedSkip)
          const 组们 = 找重复组(活的)
            .filter((g) => g.类型 === '真重复')
            .map((g) => ({ 类型: g.类型, 留: g.留, 删: g.删, 条们: (g.条们 || []).map((x) => ({ id: x.id, text: String(x.text || '').slice(0, 60) })) }))
          if (!组们.length) continue
          条们.push({
            session: sid,
            名称: (() => {
              try {
                return titleOfSession(sid) || sid
              } catch (error) {
                return sid
              }
            })(),
            组: 组们,
            能少: 组们.reduce((n, g) => n + (g.删 || []).length, 0),
          })
        }
        条们.sort((a, b) => b.能少 - a.能少)
        out.会话 = 条们
        out.总组 = 条们.reduce((n, x) => n + x.组.length, 0)
        out.能少 = 条们.reduce((n, x) => n + x.能少, 0)
      } catch (error) {
        out.ok = false
        out.message = String((error && error.message) || error)
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(out))
    })

    // ⭐ 1.12.15：补键（洗键）的入口从会话详情搬到「记忆 → 整理」，
    //   这一条只读：告诉前端「每个会话还剩多少条没键」—— 真正洗仍走 /wash-keys。
    //   以前 N 洗完变 0 按钮就消失，人以为功能没了；现在常显，剩 0 时明确写「都标过」。
    mroute('/dsh-clay-memory/wash-plan', async (req, res) => {
      const out = { ok: true, 会话: [], 总剩: 0, 可撤: 0, 带键: 0 }
      try {
        let 文件们 = []
        try {
          文件们 = readdirSync(STORE_DIR).filter((f) => f.endsWith('.json') && 是会话文件(f))
        } catch (error) {}
        for (const f of 文件们) {
          const sid = String(f).slice(0, -5)
          let data
          try {
            data = loadStore(sid)
          } catch (error) {
            continue
          }
          const 条们 = (data.memories || []).filter((m) => m && !m.已被取代 && !m.refinedSkip)
          // ⚠ 和 /wash-keys 的挑选口径**必须一致**（那边：没键、没洗过、没被提炼跳过、正文非空）
          const 剩 = 条们.filter((m) => !m.洗键过 && !归一键(m.事实键) && String(m.text || '').trim()).length
          const 可撤 = 条们.filter((m) => m.键来源 === '清洗补键' || m.洗键过).length
          const 带键 = 条们.filter((m) => 归一键(m.事实键)).length
          out.带键 += 带键
          out.可撤 += 可撤
          if (!剩) continue
          out.会话.push({
            session: sid,
            名称: (() => {
              try {
                return titleOfSession(sid) || sid
              } catch (error) {
                return sid
              }
            })(),
            剩,
            带键,
          })
        }
        out.会话.sort((a, b) => b.剩 - a.剩)
        out.总剩 = out.会话.reduce((n, x) => n + x.剩, 0)
      } catch (error) {
        out.ok = false
        out.message = String((error && error.message) || error)
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(out))
    })

    mroute('/dsh-clay-memory/sessions-by-workspace', async (req, res) => {
      const u = new URL(String(req.url || ''), 'http://127.0.0.1')
      const wid = String(u.searchParams.get('workspace') || '')
      const q = String(u.searchParams.get('q') || '').trim().toLowerCase()
      const out = { ok: true, workspace: wid, sessions: [], 筛掉: { 归档: 0, 空壳: 0 } }
      try {
        const wr = ctx.get('workspaceRegistry')
        const list = wr && typeof wr.list === 'function' ? (wr.list() || []) : []
        let w = null
        for (let i = 0; i < list.length; i++) if (工作区号(list[i], i) === wid) { w = list[i]; break }
        if (!w && list.length) w = list[0]
        const 归档 = 归档名单(ctx)
        const sid们 = ((w && w.sessionIds) || []).map(String)
        for (const sid of sid们) {
          if (归档.has(sid)) { out.筛掉.归档++; continue }
          const 标题 = titleOfSession(ctx, sid)
          // ⭐ 2026-10-31 主实例：藏「空壳」（没标题且没存过记忆的会话），
          //   别让列表里冒出一堆 session-id；/workspaces 的数字同口径
          let 事件 = 0
          const 有文件 = existsSync(storePath(sid))
          if (有文件) {
            try { 事件 = (loadStore(sid).memories || []).filter((m) => m.category !== 'stable_profile').length } catch (error) {}
          }
          if (!标题 && !有文件) { out.筛掉.空壳++; continue }
          out.sessions.push({ id: sid, title: 标题, 事件数: 事件 })
        }
        out.sessions.sort((x, y) => (y.事件数 || 0) - (x.事件数 || 0))
        if (q) out.sessions = out.sessions.filter((x) => (String(x.title || '') + ' ' + x.id).toLowerCase().indexOf(q) >= 0)
      } catch (error) { out.ok = false; out.message = String((error && error.message) || error) }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(out))
    })
}
