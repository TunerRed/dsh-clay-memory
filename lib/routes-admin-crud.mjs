// 管理路由 · 称呼 / 记忆增删改 / 清空 / 骨架投影 / 候选 / 选文件
import { join, basename, dirname } from 'node:path'
import { 是会话文件, STORE_DIR, storePath, 规范化, factPath, 会话工作区 } from './paths.mjs'
import { archiveDir, changeUserPronoun, normalizePerson, selfNameOf, userPronoun, 不是名字列表, 找她的称呼, 用户名字列表 } from './names.mjs'
import { 选定模型 } from './llm.mjs'
import { 像度, 词集 } from './scoring.mjs'
import { 标trace状态 } from './trace-log.mjs'
import { backupStore, 销毁前另存, backupFile } from './backup.mjs'
import { 写挑选目录, 当前工作区根, 目录在, 读挑选目录 } from './ui.mjs'
import { loadCfg, saveCfg } from './cfg.mjs'
import { loadStore, saveStore, corruptSnapshots, 读一份, 全量回填镜像 } from './store-core.mjs'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { writeFileAtomicSync } from './atomic-file.mjs'
import { 读骨架, 骨架文件 } from './core-memory.mjs'
import { 骨架候选, 比对骨架, 并入骨架, 规范骨架 } from './core-projection.mjs'
import { diag } from './diag.mjs'
import { 真重复门槛 } from './scoring.mjs'

export function 注册记忆维护路由(mroute, 环) {
  const { 读JSON体, 路径在允许范围 } = 环

    mroute('/dsh-clay-memory/names', async (req, res) => {
      const b = await 读JSON体(req)
      const c = loadCfg()
      const 改了几条 = []
      const 换了称呼的 = []
      const 称呼旧值 = userPronoun()
      let 称呼新值 = null
      if (typeof b.userPronoun === 'string') {
        const p = b.userPronoun.trim()
        if (p) c.userPronoun = p
        else delete c.userPronoun
        称呼新值 = p || 'ta'
        diag('用户的称呼设成：' + (c.userPronoun || '（默认 ta）'))
      }
      if (typeof b.archiveDir === 'string') {
        const d = b.archiveDir.trim()
        if (d) c.archiveDir = d
        else delete c.archiveDir
        diag('档案目录设成：' + (c.archiveDir || '（还没选）'))
      }
      if (Array.isArray(b.notNames)) {
        c.notNames = b.notNames
          .filter((x) => typeof x === 'string' && x.trim())
          .map((x) => x.trim())
        diag('标成「不是名字」的：' + JSON.stringify(c.notNames))
      }
      if (Array.isArray(b.userNames)) {
        c.userNames = b.userNames
          .filter((x) => typeof x === 'string' && x.trim())
          .map((x) => x.trim())
        diag('档案里指她的名字：' + JSON.stringify(c.userNames))
      }
      if (b.llmModel !== undefined) {
        if (b.llmModel && b.llmModel.provider && b.llmModel.model) {
          c.llmModel = { provider: String(b.llmModel.provider), model: String(b.llmModel.model) }
        } else {
          delete c.llmModel
        }
        diag('选用的模型：' + (c.llmModel ? c.llmModel.provider + '/' + c.llmModel.model : '（用会话自己的）'))
      }
      if (b.session && typeof b.ownerName === 'string') {
        // ⭐ 1.2.9：这个会话里「怎么称呼对方」
        if (!c.ownerNames || typeof c.ownerNames !== 'object') c.ownerNames = {}
        const sid0 = String(b.session)
        const 称呼 = b.ownerName.trim()
        if (称呼) c.ownerNames[sid0] = 称呼
        else delete c.ownerNames[sid0]
        diag('这个会话里怎么称呼对方：' + sid0 + ' → 「' + (称呼 || '（用全局）') + '」')
      }
      if (b.session) {
        if (!c.selfNames || typeof c.selfNames !== 'object') c.selfNames = {}
        const sid = String(b.session)
        const name = typeof b.selfName === 'string' ? b.selfName.trim() : ''
        if (name) c.selfNames[sid] = name
        else delete c.selfNames[sid]
        saveCfg(c)
        // 洗一遍这个会话已有的记忆（有名字才洗）
        if (name) {
          try {
            const data = loadStore(sid)
            let 动 = false
            for (const 区 of ['memories', 'deleted']) {
              for (const m of data[区] || []) {
                const 新 = normalizePerson(m.text, name)
                if (新 !== m.text) {
                  改了几条.push(m.id)
                  m.text = 新
                  动 = true
                }
              }
            }
            if (动) saveStore(sid, data)
          } catch (error) {}
        }
        diag('她自己叫什么：' + sid + ' → 「' + (name || '（清掉了）') + '」' + (改了几条.length ? '，顺手洗了 ' + 改了几条.length + ' 条' : ''))
      } else {
        saveCfg(c)
      }

      // 称呼变了 → 已有记忆里那个字要不要跟着变？
      // 默认**只报数不落手**，她点「一起改」才真改 ✓
      // ⚠ 点「一起改」的时候称呼**已经存过了**，所以不能靠「变了没变」判断，得看 applyToExisting ✓
      let 称呼影响几条 = 0
      let 称呼例子 = []
      const 要改 = b.applyToExisting === true
      const 目标称呼 = 要改 ? userPronoun() : 称呼新值 !== null && 称呼新值 !== 称呼旧值 ? 称呼新值 : null
      if (目标称呼 !== null) {
        try {
          for (const fn of readdirSync(STORE_DIR)) {
            if (!是会话文件(fn)) continue
            const sid = fn.replace(/\.json$/, '')
            const data = loadStore(sid)
            let 动 = false
            for (const 区 of ['memories', 'deleted']) {
              for (const m of data[区] || []) {
                const 新 = changeUserPronoun(m.text, 目标称呼)
                if (新 !== m.text) {
                  称呼影响几条++
                  if (称呼例子.length < 3) 称呼例子.push({ id: m.id, 旧: m.text, 新: 新 })
                  if (要改) {
                    m.text = 新
                    动 = true
                  }
                }
              }
            }
            if (要改 && 动) saveStore(sid, data)
          }
        } catch (error) {}
        if (要改) diag('称呼改成「' + 目标称呼 + '」，顺手改了 ' + 称呼影响几条 + ' 条记忆')
        else diag('称呼从「' + 称呼旧值 + '」改成「' + 目标称呼 + '」，有 ' + 称呼影响几条 + ' 条旧记忆还写着旧字（等要不要一起改）')
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(
        JSON.stringify({
          ok: true,
          selfName: selfNameOf(b.session || ''),
          userPronoun: userPronoun(),
          archiveDir: archiveDir(),
          userNames: 用户名字列表(),
          llmModel: 选定模型(),
          洗了: 改了几条.length,
          称呼影响几条,
          称呼例子,
          称呼已改: b.applyToExisting === true && 称呼影响几条 > 0,
        }),
      )
    })

    // ⚠ 删记忆 —— 只给设置页用。
    // 插件**没有**给模型注册任何删除工具，所以模型那边调不到这个能力 ✓
    // 而且「删」是收进 deleted 里（不是销毁），手滑也找得回来 ✓
    // ⭐ 1.10.2（F19）：规划 §4.4「一键清空（全部 / 仅本会话）」
    //
    //   语义跟「删一条」一致：**收进回收站**（deleted + deletedAt），不是真销毁 ——
    //   历史上「清空」连坐销毁过 157 条（规划 §4.5 的教训），宁可多一步去找回。
    //   真要彻底销毁，去「回收站」页点「把已删掉的清空」。
    //
    //   ⚠ 直接读写**原始库文件**，不经 loadStore/saveStore 合并视图：
    //     合并视图带着事实 / 工作区两层，写回时按 category 重新分层 ——「仅本会话」
    //     一不小心就把别的层也带走（历史上串库正是这么来的）。这里按**文件归属**清，
    //     一个文件只动它自己的 memories。
    //   ⚠ 读不出来（I/O 失败 / 结构坏 / 坏 JSON）的库一律跳过，绝不当空库清掉。
    // ---------- 候选（1.11.0 一期 §4.8）----------
    //
    // 正则钩子在「本回合没调 remember」时把像该记的话放进候选区，**不写正式记忆**。
    // 这里给界面两个动作：列出 / 采纳（转成正式记忆）/ 丢弃。
    // 候选表独立文件 `<DSH_HOME>\clay-memory\_candidates.json`，不进召回池、不占日额度。
    // ⭐ 1.12.0 一期决策四：`_core.json` 降为「主库的投影」
    //   只做单向预览 + 手动写回：骨架里手写的措辞（风格、边界、关系）主库挑不出来，
    //   自动覆盖会把它们冲掉，冲掉还没后悔药。所以这里只算「差在哪」。
    mroute('/dsh-clay-memory/core-preview', async (req, res) => {
      const 骨架 = 读骨架()
      const 事实 = (读一份(factPath()) || { memories: [] }).memories || []
      const 候选 = 骨架候选(事实)
      const 预览 = 比对骨架(骨架, 候选)
      if (req.method === 'GET' || !req.method) {
        // ⭐ F10 阶段 0（1.12.26）：骨架为空但主库已经有够格的条目 → 给一条提醒。
        //   口径按 Gemini 复核改过：不要等到 ≥5 条（轻量用户要 2~3 个月才攒够），
        //   够格 2 条就提示；且**只算画像**——导入批几十条 importance 全是 1，会把提示炸成常驻噪音。
        const 够格 = 候选.filter((c) => c.is_knowledge !== true)
        const 提示 =
          骨架.length === 0 && 够格.length >= 2
            ? { 够格: 够格.length, 最重: 够格[0] ? Math.round(Number(够格[0].importance) * 100) / 100 : 0 }
            : null
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(
          JSON.stringify({
            ok: true,
            骨架条数: 骨架.length,
            候选条数: 候选.length,
            提示,
            // ⭐ 1.12.22：把骨架原文整条带出去 —— 预览页要能就地改、就地删。
            //   去重（跟 AGENTS.md 重复、跟自己重复）交给用户自己判断，这里不给建议。
            items: 骨架.map((it) => ({
              id: it.id || '',
              content: it.content,
              core: it.core === true,
              importance: Number(it.importance) || 0,
            })),
            新增: 预览.新增.map((c) => ({ content: c.content, importance: c.importance })),
            已有: 预览.已有.map((x) => ({ 主库: x.主库.content, 骨架: x.骨架.content })),
            可下线: 预览.可下线.map((it) => it.content),
          }),
        )
        return
      }
      let b = {}
      try {
        b = (await 读JSON体(req)) || {}
      } catch (error) {
        b = {}
      }
      // ⭐ 1.12.22：两个动作 —— apply（照主库投影并入）/ save（用户手改后整份覆盖）
      let 新 = null
      if (b.action === 'apply') {
        新 = 并入骨架(骨架, 预览)
      } else if (b.action === 'save') {
        const 规 = 规范骨架(b.items, 骨架)
        if (!规.ok) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: 规.message }))
          return
        }
        新 = 规.items
      } else {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, message: '只有两个动作：apply（写回投影）/ save（保存手改）' }))
        return
      }
      try {
        backupFile(骨架文件())
        writeFileAtomicSync(骨架文件(), JSON.stringify({ items: 新 }, null, 2) + String.fromCharCode(10))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, message: '写骨架失败：' + String(error && error.message) }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(
        JSON.stringify({
          ok: true,
          写入: 新.length,
          新增: b.action === 'apply' ? 预览.新增.length : 0,
          下线: b.action === 'apply' ? 预览.可下线.length : 0,
          message:
            b.action === 'apply'
              ? '骨架已更新（旧文件留了 .bak）'
              : '骨架已保存（' + 新.length + ' 条，旧文件留了 .bak）',
        }),
      )
    })

    mroute('/dsh-clay-memory/candidates', async (req, res) => {
      const 答 = (o) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(o))
      }
      try {
        const 候选 = await import('./candidates.mjs')
        if (req.method === 'GET') {
          const items = 候选.候选列表().map((x) => ({
            id: x.id,
            text: x.text,
            hint: x.hint || '',
            session: x.session || '',
            hitAt: x.hitAt,
            expireAt: x.expireAt || '',
          }))
          return 答({ ok: true, count: items.length, items })
        }
        const b = await 读JSON体(req)
        const 动 = String(b.action || '')
        const id = String(b.id || '')
        if (动 === 'adopt') {
          const it = 候选.采纳候选(id)
          if (!it) return 答({ ok: false, message: '这条候选已经不在了（过期或被处理过）' })
          // 落成正式记忆：走跟 remember 一样的去重口径（≥真重复门槛就只强化，不新增）
          const sid = String(it.session || '')
          if (!sid) return 答({ ok: false, message: '这条候选没有会话归属，没法入账' })
          const data = loadStore(sid)
          // ⚠ selfNameOf 依赖宿主注入的读配置；单测/冷启动时可能还没接上 → 拿不到就当没名字
          let 她名字 = ''
          try { 她名字 = selfNameOf(sid) } catch (error) { 她名字 = '' }
          const text = normalizePerson(String(it.text || '').trim(), 她名字)
          const 新词集 = 词集(text)
          let 重 = false
          for (const m of data.memories) {
            if (m.已被取代) continue
            if (像度(新词集, 词集(String(m.text || ''))) >= 真重复门槛) { 重 = true; break }
          }
          if (!重) {
            const now2 = Date.now()
            data.memories.push({
              id: 'm' + now2.toString(36) + Math.floor(Math.random() * 1000),
              text,
              at: new Date(now2).toISOString(),
              createdAt: new Date(now2).toISOString(),
              category: 'event',
              importance: 0.5,
              emotion: null,
              tags: [],
              source: '候选采纳',
              reinforcedAt: null,
              lastReinforcedDay: null,
            })
            saveStore(sid, data)
          }
          return 答({ ok: true, message: 重 ? '库里已经有几乎一样的了，没重复记' : '已记下', text })
        }
        if (动 === 'drop') {
          const it = 候选.丢弃候选(id, String(b.reason || 'user'))
          if (!it) return 答({ ok: false, message: '这条候选已经不在了' })
          return 答({ ok: true })
        }
        return 答({ ok: false, message: '不认识的 action：' + 动 })
      } catch (error) {
        return 答({ ok: false, message: '候选处理失败：' + ((error && error.message) || error) })
      }
    })

    mroute('/dsh-clay-memory/clear', async (req, res) => {
      const b = await 读JSON体(req)
      const 范围 = b.scope === 'session' ? 'session' : 'all'
      const sid = String(b.session || '')
      const 答 = (o) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(o))
      }
      // 二次确认：前端要用户亲手打这个词，防手滑（后端也认，光调接口没用）
      if (String(b.confirm || '') !== '清空') {
        return 答({ ok: false, message: '要清空得先确认（confirm 里写「清空」）' })
      }
      if (范围 === 'session' && !sid) return 答({ ok: false, message: '缺会话 id' })
      let 文件们 = []
      if (范围 === 'session') {
        文件们 = [{ path: storePath(sid), 名: sid, 会话: true }]
      } else {
        文件们 = readdirSync(STORE_DIR)
          .filter((f) => f.endsWith('.json'))
          .sort()
          .map((f) => ({ path: join(STORE_DIR, f), 名: f, 会话: 是会话文件(f) }))
      }
      let 清 = 0
      let 份 = 0
      let 事实条 = 0
      const 跳过 = []
      for (const it of 文件们) {
        if (!existsSync(it.path)) {
          跳过.push(it.名 + '（文件不在）')
          continue
        }
        const 验 = 读一份(it.path)
        if (corruptSnapshots.get(验)) {
          跳过.push(it.名 + '（读不出来，不动它）')
          continue
        }
        if (!验.memories.length) continue
        let 盘 = null
        try {
          盘 = JSON.parse(readFileSync(it.path, 'utf8'))
        } catch (error) {
          跳过.push(it.名 + '（读不出来，不动它）')
          continue
        }
        if (!盘 || !Array.isArray(盘.memories) || !盘.memories.length) continue
        backupFile(it.path) // 动之前留 .bak
        if (!Array.isArray(盘.deleted)) 盘.deleted = []
        const 批次 = new Date().toISOString()
        const 会话号 = it.会话 ? basename(it.path, '.json') : ''
        for (const m of 盘.memories) {
          if (!m || typeof m !== 'object') continue
          m.deletedAt = 批次
          m.批量删的 = true
          m.清空的 = true
          盘.deleted.push(m)
          if (会话号) 标trace状态(会话号, String(m.id), 'invalidated')
          if (m.category === 'stable_profile') 事实条++
          清++
        }
        盘.memories = []
        writeFileAtomicSync(it.path, JSON.stringify(盘))
        份++
      }
      if (份) {
        try {
          全量回填镜像()
        } catch (error) {
          diag('清空后重建镜像失败：' + String((error && error.message) || error))
        }
      }
      diag('一键清空（' + (范围 === 'session' ? '仅本会话 ' + sid : '全部') + '）：' + 份 + ' 个库 / ' + 清 + ' 条')
      答({
        ok: true,
        清空: 清,
        库: 份,
        跳过,
        message: 清
          ? '清空了 ' + 清 + ' 条（' + 份 + ' 个库），都在回收站里，能找回' +
            (事实条 ? '；其中 ' + 事实条 + ' 条是「事实」，所有工作区都不再看到它们' : '')
          : '没有要清空的（本来就没记着东西）' + (跳过.length ? '；跳过了 ' + 跳过.length + ' 个读不出来的库' : ''),
      })
    })

    mroute('/dsh-clay-memory/delete', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      const id = String(b.id || '')
      const action = String(b.action || 'delete')
      let out = { ok: false, message: '没找到' }
      try {
        const data = loadStore(sid)
        // 无 bytes 毒快照（磁盘错误/结构损坏，写回必被 saveStore 挡）上不许做任何删除操作——
        // 会把「读不出来」当「空库」误操作；坏 JSON 自愈毒（有 bytes）走 1.4.0 自愈语义，不拦
        const 毒凭据们 = corruptSnapshots.get(data)
        if (毒凭据们 && [...毒凭据们.values()].every((候) => !候.bytes)) {
          out = { ok: false, message: '记忆库当前读不出来（磁盘错误或文件损坏），拒绝操作以免误删' }
        } else {
        if (!Array.isArray(data.deleted)) data.deleted = []
        if (action === 'delete') {
          const i = data.memories.findIndex((m) => String(m.id) === id)
          if (i >= 0) {
            const m = data.memories.splice(i, 1)[0]
            m.deletedAt = new Date().toISOString()
            data.deleted.push(m)
            标trace状态(sid, id, 'invalidated') // 以前的召回记录里它失效了 ✓
            saveStore(sid, data)
            diag('删了一条（收起来）：' + sid + ' / ' + id + ' 「' + String(m.text).slice(0, 30) + '」')
            // ⚠ 1.4.0：事实是全工作区共享的，删一条影响的不止这个会话 —— 得说清楚
            out = m.category === 'stable_profile'
              ? { ok: true, 全局: true, message: '收起来了，还能找回来（这是「事实」，所有工作区都看不到了）' }
              : { ok: true, message: '收起来了，还能找回来' }
          }
        } else if (action === 'restore') {
          const i = data.deleted.findIndex((m) => String(m.id) === id)
          if (i >= 0) {
            const m = data.deleted.splice(i, 1)[0]
            delete m.deletedAt
            data.memories.push(m)
            // GPT 整改 P1：带「读盘时刻」——盘上墓碑比它新 = 别处刚删，不复活
            saveStore(sid, data, { restoreIds: [id], 读盘于: new Date().toISOString() })
            diag('找回来一条：' + sid + ' / ' + id)
            out = { ok: true, message: '找回来了' }
          }
        } else if (action === 'restorebatch') {
          // ⭐⭐ 2026-09-23（反馈：「那这里没有批量找回呀」）：
          //   「已删掉的」那一栏只有**批量清掉**，没有**批量找回** ——
          //   合错了一批想全捞回来，只能一条条点「找回来」✗
          //   → 补一个（界面上二次确认，免得手滑把不想要的也捞回来）
          //   ⚠ `只找回合并掉的: true` 时，只捞「合并掉的」那批 ——
          //     等于**一键撤销整次合并**，不用一条条勾 ✓
          const 只合并 = b.只找回合并掉的 === true
          const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 2000) : []
          const 要回 = new Set(ids)
          const 回 = []
          data.deleted = data.deleted.filter((m) => {
            if (只合并 ? m.合并掉的 !== true : !要回.has(String(m.id))) return true
            回.push(m)
            return false
          })
          const n = 回.length
          if (n > 0) {
            try {
              backupStore(sid) // ⚠ 动数据之前先备份
            } catch (error) {}
            for (const m of 回) {
              // ⚠ 记号要一起清掉 —— 捞回来之后它就不是「合并掉的」了
              delete m.deletedAt
              delete m.合并掉的
              delete m.批量删的
              data.memories.push(m)
            }
            saveStore(sid, data, { restoreIds: 回.map((m) => String(m.id)), 读盘于: new Date().toISOString() })
            diag('批量找回：' + sid + ' 找回 ' + n + ' 条（「已删」里还剩 ' + data.deleted.length + ' 条）')
            out = { ok: true, 找回: n, 剩: data.deleted.length, message: '找回 ' + n + ' 条（还在库里，跟原来一样）' }
          } else {
            out = { ok: false, message: 只合并 ? '「已删」里没有「合并掉的」那批' : '没有要找回的' }
          }
        } else if (action === 'unsupersede') {
          // ⭐⭐ 2026-09-23：「已被取代」撤销 —— 标错了 / 状态又变回来了 ✓
          //   ⚠ 放在 /delete 这条路上只是图省事（它本来就是「按 action 分派」的），
          //     这个动作**不删任何东西**，只是把那面小旗子摘掉
          const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 2000) : [id].filter(Boolean).map(String)
          const 要摘 = new Set(ids)
          let n = 0
          for (const m of data.memories || []) {
            if (!m.已被取代) continue
            if (要摘.size && !要摘.has(String(m.id))) continue
            delete m.已被取代
            n++
          }
          if (n > 0) {
            saveStore(sid, data)
            diag('撤销「已被取代」：' + sid + ' 摘掉 ' + n + ' 条')
            out = { ok: true, 撤销: n, message: '撤销了 ' + n + ' 条（它们又能被想起来了）' }
          } else {
            out = { ok: false, message: '没有要撤销的' }
          }
        } else if (action === 'purge') {
          const n = data.deleted.length
          data.deleted = data.deleted.filter((m) => String(m.id) !== id)
          if (data.deleted.length !== n) {
            saveStore(sid, data, { raw: true }) // 真销毁：不许合并把盘上的捡回来
            diag('彻底清掉一条：' + sid + ' / ' + id)
            out = { ok: true, message: '彻底清掉了' }
          }
        } else if (action === 'purgeall') {
          const n = data.deleted.length
          // ⚠⚠ 2026-09-23：**真销毁** —— 动之前另存一份带时间戳的（见 销毁前另存 的说明）✓
          if (n > 0) {
            销毁前另存(sid)
            data.deleted = []
            saveStore(sid, data, { raw: true }) // 真销毁：不许合并把盘上的捡回来
          }
          diag('清空已删掉的：' + sid + '（' + n + ' 条）')
          out = { ok: true, message: n ? '清掉了 ' + n + ' 条（清空前的整份另存在「销毁前」里）' : '没有要清掉的' }
        } else if (action === 'batchdelete') {
          // ⭐⭐ 2026-09-22（她要的）：**批量删除**（界面上是二次确认的）
          //   跟单条删一样：**收进 deleted**（不是销毁），手滑找得回来 ✓
          const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 2000) : []
          const 要删 = new Set(ids)
          const 留着 = []
          let n = 0
          let 删了事实 = 0
          for (const m of data.memories) {
            if (要删.has(String(m.id))) {
              m.deletedAt = new Date().toISOString()
              m.批量删的 = true // 跟「合并掉的」一样，留个记号好认
              data.deleted.push(m)
              标trace状态(sid, m.id, 'invalidated')
              n++
              if (m.category === 'stable_profile') 删了事实++
            } else 留着.push(m)
          }
          if (n > 0) {
            try {
              backupStore(sid) // ⚠ 动数据之前先备份
            } catch (error) {}
            data.memories = 留着
            saveStore(sid, data)
            diag('批量删：' + sid + ' 删了 ' + n + ' 条，剩 ' + 留着.length + ' 条')
            out = { ok: true, 删了: n, 剩: 留着.length, 全局: 删了事实 > 0,
              message: '删掉 ' + n + ' 条（收在「已删」里，能找回来）' +
                (删了事实 ? '，其中 ' + 删了事实 + ' 条是「事实」—— 所有工作区都看不到了' : '') }
          } else {
            out = { ok: false, message: '没有要删的' }
          }
        } else if (action === 'purgebatch') {
          // ⭐ 2026-09-22（反馈「回收站还没有批量删除，就批量清空」）：
          //   「已删掉的」那一栏原来**只有「一条条清」和「全清空」**，
          //   想清掉其中几条就得一条条点 ✗
          //   → 补一个**批量清掉**（界面上是二次确认的）✓
          //   ⚠ 这个是真销毁（不是收起来）—— 所以界面必须问两遍
          const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 2000) : []
          const 要清 = new Set(ids)
          const 前 = data.deleted.length
          data.deleted = data.deleted.filter((m) => !要清.has(String(m.id)))
          const n = 前 - data.deleted.length
          if (n > 0) {
            try {
              backupStore(sid) // ⚠ 动数据之前先备份
            } catch (error) {}
            // ⚠⚠ 2026-09-23：**真销毁** —— 再另存一份带时间戳的 ✓
            销毁前另存(sid)
            saveStore(sid, data, { raw: true })
            diag('批量清掉：' + sid + ' 清掉 ' + n + ' 条（「已删」里还剩 ' + data.deleted.length + ' 条）')
            out = {
              ok: true,
              清掉: n,
              剩: data.deleted.length,
              message: '彻底清掉 ' + n + ' 条（找不回来了；清空前的整份另存在「销毁前」里）',
            }
          } else {
            out = { ok: false, message: '没有要清的' }
          }
        }
        }
      } catch (error) {
        out = { ok: false, message: String((error && error.message) || error) }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(out))
    })

    // ⚠ 改记忆 —— 也只给设置页用（跟删除一样，模型那边没有这个工具）✓
    mroute('/dsh-clay-memory/edit', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      const id = String(b.id || '')
      const 新文本 = String(b.text || '').trim()
      // ⭐ 1.5.0 A 轮（F1/F16）：**改作用域** —— 在全局事实库、工作区库、会话库之间搬一条
      //   category 是唯一权威（saveStore 就是按它分流两份文件的），所以这里**只改标记**，
      //   搬库交给 saveStore：改成 event 时它会从事实库撤掉，改成 stable_profile 时写进事实库 ✓
      //   ⭐ 2026-11-04：支持 workspace（写当前会话的工作区根）；改重要度不再顺手重算 category ✓
      const 改域 = typeof b.scope === 'string' ? b.scope.trim() : ''
      let out = { ok: false, message: '没找到' }
      if (改域 && 改域 !== 'global' && 改域 !== 'workspace' && 改域 !== 'session') {
        out = { ok: false, message: 'scope 只认 global（全局记忆）、workspace（工作区）或 session（指定会话）' }
      } else if (!新文本) {
        out = { ok: false, message: '不能改成空的（要删就用「删」）' }
      } else {
        try {
          const data = loadStore(sid)
          const m =
            (data.memories || []).find((x) => String(x.id) === id) ||
            (data.deleted || []).find((x) => String(x.id) === id)
          if (m) {
            const 旧 = String(m.text || '')
            // 跟 remember 一样的机械保证（「叫小明」那种说名字的不动）✓
            m.text = normalizePerson(新文本, selfNameOf(sid))
            m.editedAt = new Date().toISOString()
            m.source = '她改过的'
            if (String(旧) !== String(m.text)) 标trace状态(sid, id, 'invalidated') // 内容变了，以前那条就不算数了 ✓
            if (typeof b.importance === 'number' && isFinite(b.importance)) {
              m.importance = Math.max(0, Math.min(1, b.importance))
            }
            // ⭐ 2026-11-04（解耦）：改重要度不再重算 category；落哪个库只看 scope ✓
            let 域错 = ''
            if (改域 === 'global') {
              m.category = 'stable_profile'
              delete m.scope
            } else if (改域 === 'workspace') {
              const 根 = 规范化(会话工作区(sid))
              if (!根) 域错 = '拿不到这条会话的工作区（会话没在项目目录里打开过？）'
              else {
                m.category = 'workspace'
                m.scope = 'workspace:' + 根
              }
            } else if (改域 === 'session') {
              m.category = 'event'
              delete m.scope
            }
            if (域错) {
              out = { ok: false, message: 域错 }
            } else {
              saveStore(sid, data)
              diag(
                '改了一条：' + sid + ' / ' + id +
                  '  「' + 旧.slice(0, 30) + '」→「' + m.text.slice(0, 30) + '」' +
                  (改域 ? '（作用域 → ' + 改域 + '）' : ''),
              )
              out = {
                ok: true,
                message: '改好了',
                text: m.text,
                importance: m.importance,
                category: m.category,
                scope: m.category === 'stable_profile' ? 'global' : m.category === 'workspace' ? 'workspace' : 'session',
              }
            }
          }
        } catch (error) {
          out = { ok: false, message: String((error && error.message) || error) }
        }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(out))
    })

    // 自动找「她」的称呼 —— 她懒得一个个手打 ✓
    mroute('/dsh-clay-memory/names/scan', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      const dir = typeof b.dir === 'string' && b.dir.trim() ? b.dir.trim() : archiveDir()
      const 排除 = 用户名字列表().slice()
      for (const n of 不是名字列表()) 排除.push(n) // 她标掉的，别再冒出来 ✓
      const self = selfNameOf(sid)
      if (self) 排除.push(self)
      const out = { ok: true, dir: dir, 候选: [], 互称: [], 不是名字: 不是名字列表() }
      try {
        if (!dir || !existsSync(dir)) {
          out.ok = false
          out.message = '还没选档案文件夹'
        } else {
          const 全部 = 找她的称呼(dir, 排除, self)
          // 分开给：只指她的 → 可以填进「指她的名字」；互相都叫的 → 换掉反而别扭，单列出来 ✓
          out.候选 = 全部.filter((x) => !x.互).map((x) => ({ name: x.name, n: x.n }))
          out.互称 = 全部.filter((x) => x.互).map((x) => ({ name: x.name, n: x.n }))
          diag(
            '自动找名字：' + dir + ' → 只指她 ' + out.候选.map((x) => x.name + '(' + x.n + ')').join(' ') +
              ' ｜ 互相都叫 ' + out.互称.map((x) => x.name + '(' + x.n + ')').join(' '),
          )
        }
      } catch (error) {
        out.ok = false
        out.message = String((error && error.message) || error)
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(out))
    })

    // 扫旧档案 → 只出候选，**不落库** ✓
    // ⭐ 1.8.0：选档案用的文件浏览 —— 只列 Markdown、只单选一个文件
    //   起点顺序：上次选过的目录 → 当前工作区根 → 文档目录（见设计 §4.1）
    mroute('/dsh-clay-memory/browse-files', async (req, res) => {
      const b = await 读JSON体(req)
      const out = { ok: true, path: '', parent: '', files: [], truncated: false, 起点: '' }
      try {
        const 上次 = 读挑选目录()
        let 起 = typeof b.path === 'string' ? b.path.trim() : ''
        if (!起) {
          if (上次 && 目录在(上次)) { 起 = 上次; out.起点 = '上次选过的目录' }
          else { 起 = 当前工作区根(); out.起点 = '当前工作区' }
        }
        if (!目录在(起)) { 起 = 当前工作区根(); out.起点 = '当前工作区（上次那个找不到）' }
        // 架构师审查 #23：以前 b.path 可以是任意目录（信息泄漏面）
        if (!路径在允许范围(起)) return res.end(JSON.stringify({ ok: false, message: '只能在工作区 / 文档 / 桌面里找档案' }))
        out.path = 起
        out.parent = dirname(起)
        const 认得 = /\.(md|markdown)$/i
        for (const d of readdirSync(起, { withFileTypes: true })) {
          if (!d.isFile()) continue
          if (d.name.startsWith('.')) continue
          if (!认得.test(d.name)) continue
          let st = null
          try { st = statSync(join(起, d.name)) } catch (error) { continue }
          out.files.push({ name: d.name, path: join(起, d.name), bytes: st.size, at: st.mtimeMs })
        }
        out.files.sort((x, y) => String(x.name).localeCompare(String(y.name), 'zh'))
        if (out.files.length > 500) { out.files = out.files.slice(0, 500); out.truncated = true }
      } catch (error) {
        out.ok = false
        out.message = String((error && error.message) || error)
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(out))
    })

    // 记「上次选档案的目录」—— 只有真选中文件时才写
    mroute('/dsh-clay-memory/remember-pick', async (req, res) => {
      const b = await 读JSON体(req)
      const dir = typeof b.dir === 'string' ? b.dir.trim() : ''
      const out = { ok: false }
      try {
        if (dir && 目录在(dir)) { 写挑选目录(dir); out.ok = true }
        else out.message = '目录不存在'
      } catch (error) { out.message = String((error && error.message) || error) }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(out))
    })
}
