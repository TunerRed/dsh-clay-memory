// 2026-10-30 拆层工程第 10 批：apply 内的路由迁出（注册管理路由）
// 注册函数第一个参数是 mroute 注册器，第二个参数是 apply 环境（闭包依赖显式传入）
import { homedir } from 'node:os'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createSelfUpdate } from './selfupdate.mjs'
import { 是会话文件, STORE_DIR, storePath, 工作区文件, 工作区文件旧, 工作区文件id, 规范化, factPath } from './paths.mjs'
import { archiveDir, changeUserPronoun, normalizePerson, selfNameOf, userPronoun, 不是名字列表, 导入时改人称, 找她的称呼, 用户名字列表, 解析档案 } from './names.mjs'
import { 选定模型 } from './llm.mjs'
import { 像度, 词集 } from './scoring.mjs'
import { 标trace状态 } from './trace-log.mjs'
import { backupStore, 销毁前另存, backupFile } from './backup.mjs'
import { 写挑选目录, 工作区号, 归档名单, 当前工作区根, 目录在, 读挑选目录 } from './ui.mjs'
import { loadCfg, saveCfg } from './cfg.mjs'
import { loadStore, saveStore, corruptSnapshots, 读一份, 同步SQL镜像 } from './store-core.mjs'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { writeFileAtomicSync } from './atomic-file.mjs'
import { titleOfSession } from './tools.mjs'
import { diag } from './diag.mjs'
import { 重复门槛, 真重复门槛 } from './scoring.mjs'

export function 注册管理路由(mroute, 环) {
  const { ctx, 读JSON体, 路径在允许范围 } = 环
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
    const 找重复组 = (memories) => {
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

    // ⚠ 删记忆 —— 只给设置页用。
    // 插件**没有**给模型注册任何删除工具，所以模型那边调不到这个能力 ✓
    // 而且「删」是收进 deleted 里（不是销毁），手滑也找得回来 ✓
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
      // ⭐ 1.5.0 A 轮（F1/F16）：**改作用域** —— 在全局事实库和会话库之间搬一条
      //   category 是唯一权威（saveStore 就是按它分流两份文件的），所以这里**只改标记**，
      //   搬库交给 saveStore：改成 event 时它会从事实库撤掉，改成 stable_profile 时写进事实库 ✓
      //   传了就以它为准 —— 不许再被下面「改重要度顺手重算 category」覆盖（那正是 F1 要拆的耦合）
      const 改域 = typeof b.scope === 'string' ? b.scope.trim() : ''
      let out = { ok: false, message: '没找到' }
      if (改域 && 改域 !== 'global' && 改域 !== 'session') {
        out = { ok: false, message: 'scope 只认 global（全局记忆）或 session（指定会话）' }
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
              const imp = Math.max(0, Math.min(1, b.importance))
              m.importance = imp
              m.category = imp >= 1 ? 'stable_profile' : 'event'
            }
            // ⭐ 1.5.0（F1）：显式 scope **放最后**，盖住上面那条「改重要度顺手重算 category」——
            //   拆开之后这两件事各管各的：重要度只是重要度，落哪个库只看 scope ✓
            if (改域) m.category = 改域 === 'global' ? 'stable_profile' : 'event'
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
              scope: m.category === 'stable_profile' ? 'global' : 'session',
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

    // 工作区列表（选目标会话的第一级）
    mroute('/dsh-clay-memory/workspaces', async (req, res) => {
      const out = { ok: true, workspaces: [], 当前: String(process.cwd() || '') }
      try {
        const wr = ctx.get('workspaceRegistry')
        const list = wr && typeof wr.list === 'function' ? (wr.list() || []) : []
        // ⭐ 2026-10-31 主实例：数字按「实际会列出来的会话」算 —— 减归档、减空壳
        //   （没标题且没存过记忆的会话），和切进去的列表完全一致
        const 归档 = 归档名单(ctx)
        // ⭐ 2026-11-01 主人反馈：「工作区记忆的下拉框里显示的数字是会话数量，不是工作区级记忆数量」。
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

    // ⭐ 2026-11-01 主人要求：1.8.37 加的工作区记忆层（scope=workspace:<cwd>）一直没有界面，
    //   在「会话」页签里补一个并列的「工作区记忆」只读视图。数据直接读该工作区自己的
    //   _ws-<hash>.json（不走合并视图 —— 那会混进全局事实和当前会话的事件，看不出这一层）。
    mroute('/dsh-clay-memory/workspace-memories', async (req, res) => {
      const u = new URL(String(req.url || ''), 'http://127.0.0.1')
      // ⭐ 2026-11-01 主人：「工作区记忆能加个删除吗，现有 api 支不支持？」
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
            // ⭐ 2026-11-01 主人问「回收站在哪个地方」：回收站就是本文件里的 deleted 数组，
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
    // ⭐ 2026-11-01 主人：「回收站的条目好多，是会话和工作区共用的吗？如果是，能不能换到顶部页签
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

    // 单文件扫描（1.8.0）：只读导出的那一份 .md，拆成候选条目
    // ⭐ 1.8.0（主人：「选 markdown 调用系统的文件浏览器就行」）
    //   前端用 <input type="file"> 读到文本，这里只负责解析 —— 不用路径、不用目录枚举，
    //   系统弹窗由浏览器原生负责（Electron 里就是系统那个「打开」）。
    mroute('/dsh-clay-memory/import/scan-text', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      const 名 = String(b.name || '导入.md')
      const out = { ok: false, file: null, items: [], 用户名字: 用户名字列表(), selfName: selfNameOf(sid) }
      try {
        if (!/(md|markdown)$/i.test(名)) throw new Error('只支持 Markdown（.md / .markdown）')
        const text = typeof b.text === 'string' ? b.text : ''
        if (!text.trim()) throw new Error('文件是空的')
        const 行数 = text.split(String.fromCharCode(10)).length
        if (行数 > 8000) throw new Error('文件太长（' + 行数 + ' 行），上限 8000 行')
        const 候选 = 解析档案(text, 名)
        const 名字们 = 用户名字列表()
        const 已有文 = new Set(((loadStore(sid) || {}).memories || []).map((m) => String(m.text || '').trim()))
        out.file = { name: 名, bytes: Buffer.byteLength(text, 'utf8'), lines: 行数, 候选: 候选.length }
        for (const c of 候选) {
          const 改 = 导入时改人称(c.text, sid, 名字们)
          out.items.push({
            key: 名 + '#' + c.line,
            file: 名,
            line: c.line,
            section: c.section,
            text: c.text,
            改后: 改,
            importance: c.importance,
            at: c.at,
            重复: 已有文.has(String(改 || c.text || '').trim()),
          })
        }
        out.ok = true
        if (!out.items.length) out.提示 = '这一份里没拆出条目：常见原因是整篇一大段、或每行太短（不到 8 个字）、或内容都在表格/代码块里。'
        diag('扫文本：' + 名 + ' → ' + out.items.length + ' 条候选')
      } catch (error) { out.ok = false; out.message = String((error && error.message) || error) }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(out))
    })

    mroute('/dsh-clay-memory/import/scan-file', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      const 路径 = typeof b.path === 'string' ? b.path.trim() : ''
      const out = { ok: false, file: null, items: [], 用户名字: 用户名字列表(), selfName: selfNameOf(sid) }
      try {
        if (!路径) throw new Error('没给文件路径')
        if (!/.(md|markdown)$/i.test(路径)) throw new Error('只支持 Markdown（.md / .markdown）')
        let st = null
        try { st = statSync(路径) } catch (error) { throw new Error('文件不存在：' + 路径) }
        if (!st.isFile()) throw new Error('这不是一个文件')
        if (st.size > 2 * 1024 * 1024) throw new Error('文件太大（' + (st.size / 1024 / 1024).toFixed(1) + ' MB），上限 2 MB')
        const text = readFileSync(路径, 'utf8')
        const 行数 = text.split(String.fromCharCode(10)).length
        if (行数 > 8000) throw new Error('文件太长（' + 行数 + ' 行），上限 8000 行')
        const 名 = basename(路径)
        const 候选 = 解析档案(text, 名)
        const 名字们 = 用户名字列表()
        // 重复的标出来：前端默认不勾它（回勾也能导，apply 那边还会再拦一道）
        const 已有文 = new Set(((loadStore(sid) || {}).memories || []).map((m) => String(m.text || '').trim()))
        out.file = { path: 路径, name: 名, bytes: st.size, lines: 行数, 候选: 候选.length }
        for (const c of 候选) {
          out.items.push({
            key: 名 + '#' + c.line,
            file: 名,
            line: c.line,
            section: c.section,
            text: c.text,
            改后: 导入时改人称(c.text, sid, 名字们),
            importance: c.importance,
            at: c.at,
            重复: 已有文.has(String(导入时改人称(c.text, sid, 名字们) || c.text || '').trim()),
          })
        }
        out.ok = true
        if (!out.items.length) out.提示 = '这一份里没拆出条目：常见原因是整篇一大段、或每行太短（不到 8 个字）、或内容都在表格/代码块里。'
        diag('扫单文件：' + 路径 + ' → ' + out.items.length + ' 条候选')
      } catch (error) { out.ok = false; out.message = String((error && error.message) || error) }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(out))
    })
    mroute('/dsh-clay-memory/import/scan', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      const dir = typeof b.dir === 'string' && b.dir.trim() ? b.dir.trim() : archiveDir()
        if (!路径在允许范围(dir)) {
          return res.end(JSON.stringify({ ok: false, message: '只能在工作区 / 文档 / 桌面里扫档案' }))
        }
      const 名字们 = 用户名字列表()
      const out = { ok: true, dir: dir, files: [], items: [], 用户名字: 名字们, selfName: selfNameOf(sid) }
      try {
        // ⭐⭐ 2026-09-21（反馈：「别人导入会踩什么坑」时改的）：
        //   ① 原来只 readdirSync 一层 —— **子文件夹里的档案一条都扫不到**，
        //      界面上还只显示「0 条」，别人会以为档案没找对 ✗
        //      → 往下递归两层（够用，也不至于扫爆）✓
        //   ② 原来只认 .md/.markdown/.txt —— .text、.log、没扩展名都不认 ✗
        //      → 多认几个纯文本类型 ✓（docx/pdf 是二进制，认了也读不出，不碰）
        const 认得 = /\.(md|markdown|mdown|mkd|txt|text|log|rst|org)$/i
        const 扫 = (根, 相对, 层) => {
          let 名们 = []
          try {
            名们 = readdirSync(join(根, 相对))
          } catch (error) {
            return
          }
          for (const fn of 名们) {
            const 相对路径 = 相对 ? 相对 + '/' + fn : fn
            let st = null
            try {
              st = statSync(join(根, 相对路径))
            } catch (error) {
              continue
            }
            if (st && st.isDirectory()) {
              // 跳过常见的无关目录，别把 node_modules 也扫了
              if (/^(node_modules|\.git|\.svn|\.dsh|备份|backup)$/i.test(fn)) continue
              if (层 < 2) 扫(根, 相对路径, 层 + 1)
              continue
            }
            if (!认得.test(fn)) continue
            let text = ''
            try {
              text = readFileSync(join(根, 相对路径), 'utf8')
            } catch (error) {
              continue
            }
            const 候选 = 解析档案(text, 相对路径)
            out.files.push({ name: 相对路径, 字数: text.length, 候选: 候选.length })
            for (const c of 候选) {
              out.items.push({
                key: 相对路径 + '#' + c.line,
                file: 相对路径,
                line: c.line,
                section: c.section,
                text: c.text,
                改后: 导入时改人称(c.text, sid, 名字们),
                importance: c.importance,
                at: c.at,
              })
            }
          }
        }
        扫(dir, '', 0)
        // ⭐ 扫到 0 条时**说清为什么** —— 静默的「0 条」最坑人 ✗
        //   （「别人导入档案」场景：档案是一大段话、或者格式完全不一样）
        if (!out.files.length) {
          out.提示 =
            '这个文件夹里没找到能读的档案。只认纯文本：.md .markdown .txt .text .log .rst .org' +
            '（Word/PDF 是二进制，读不出来）；子文件夹会往下找两层。'
        } else if (!out.items.length) {
          const 最长的 = out.files.slice().sort((a, b) => b.字数 - a.字数)[0]
          out.提示 =
            '读了 ' + out.files.length + ' 个文件，但一条候选都没拆出来。' +
            '常见原因：整篇是一大段话（没有分行）、或者每行太短（不到 8 个字）、' +
            '或者内容都在表格/代码块/引用里。最大的文件是「' + 最长的.name + '」（' + 最长的.字数 + ' 字）。'
        }
        diag('扫档案：' + dir + ' → ' + out.items.length + ' 条候选（' + out.files.length + ' 个文件）')
      } catch (error) {
        out.ok = false
        out.message = String((error && error.message) || error)
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(out))
    })

    // 落库 —— 挑完点「导入」才走这里 ✓
    mroute('/dsh-clay-memory/import/apply', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      const items = Array.isArray(b.items) ? b.items : []
      // ⭐ 每一批导入一个批次号 —— 这样**整批能一次撤掉** ✓
      const batch = 'b' + Date.now().toString(36) + Math.floor(Math.random() * 100)
      let added = 0
      let 重复 = 0
      let 删过 = 0
      let 近似 = 0
      let 补全 = 0
      try {
        const data = loadStore(sid)
        const 现有 = new Set((data.memories || []).map((m) => String(m.text || '').trim()))
        // ⚠ 已遗忘的内容不能因为再导一次就复活（照 AAAAGENT 的原则）
        const 删过的 = new Set((data.deleted || []).map((m) => String(m.text || '').trim()))
        // ⭐⭐ 2026-09-22（反馈）：**导入时也做近似去重** ✓
        //
        //   她那次导入的两份档案（记忆卡 + 总档案）内容本来就重叠，
        //   而这里原来只按「一字不差」去重 → 换个说法的同一件事两条都进来了 ✗
        //   实测：实测库里 131 对几乎重复、牵涉 226 条（27%），113 对就是这两份档案之间的。
        //
        //   ⚠ 阈值取 **0.9**（比召回去重的 0.85 高）—— 导入是**不可逆**的，
        //     宁可漏掉几条重复，也不许把「相关但不同」的当重复丢掉 ✗
        //
        //   ⚠⚠ 光用「长度比」区分「换个说法」和「更全的」**不靠谱** ——
        //     实测：换个说法的 1.31 倍、真更全的 1.62 倍，中间太挤，
        //     卡 1.3 会把「换个说法」也当成「更全」放过去 ✗（自检逮到的）
        //   → 改成：**像度够了之后，新的更长就「把旧的补全」，否则跳过** ✓
        //     这样**信息不丢、也不重复** —— 比单纯跳过好
        const 已有 = (data.memories || []).map((m) => ({
          m,
          文: String(m.text || '').trim(),
          片段: 词集(m.text),
        }))
        const 找近似 = (t) => {
          const 新片段 = 词集(t)
          for (const 旧 of 已有) {
            if (像度(新片段, 旧.片段) >= 0.9) return 旧
          }
          return null
        }
        const now = Date.now()
        for (const it of items) {
          const t = String((it && (it.改后 || it.text)) || '').trim()
          if (!t) continue
          if (删过的.has(t)) {
            删过++
            continue
          }
          if (现有.has(t)) {
            重复++
            continue
          }
          const 撞上 = 找近似(t)
          if (撞上) {
            // 新的更全 → 把旧的补全（保留旧的 id 和来源，只换正文）
            if (t.length > 撞上.文.length) {
              撞上.m.text = t
              撞上.m.source = '档案导入：' + String(it.file || '') + ' 第 ' + String(it.line || '') + ' 行（补全）'
              撞上.m.editedAt = new Date(now).toISOString()
              撞上.片段 = 词集(t)
              撞上.文 = t
              现有.add(t)
              补全++
            } else {
              近似++
            }
            continue
          }
          const imp = typeof it.importance === 'number' ? Math.max(0, Math.min(1, it.importance)) : 0.5
          data.memories.push({
            id: 'i' + (now + added).toString(36) + Math.floor(Math.random() * 1000),
            text: t,
            at: it.at || null, // 猜不到就 null，绝不编 ✓
            createdAt: new Date(now).toISOString(),
            category: imp >= 1 ? 'stable_profile' : 'event',
            importance: imp,
            emotion: null,
            tags: [],
            source: '档案导入：' + String(it.file || '') + ' 第 ' + String(it.line || '') + ' 行',
            importBatch: batch,
            importAt: new Date(now).toISOString(),
            reinforcedAt: null,
            lastReinforcedDay: null,
          })
          现有.add(t)
          已有.push({ m: data.memories[data.memories.length - 1], 文: t, 片段: 词集(t) })
          added++
        }
        if (added || 补全) saveStore(sid, data)
        diag('导入档案：加了 ' + added + ' 条（一字不差 ' + 重复 + '，几乎一样 ' + 近似 + '，补全 ' + 补全 + '，删过 ' + 删过 + '），批次 ' + batch)
      } catch (error) {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, message: String((error && error.message) || error) }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, added: added, 重复: 重复, 近似: 近似, 补全: 补全, 删过: 删过, batch: added ? batch : null }))
    })

    // ⭐ 撤销一整批导入 —— 也是**收起来**（进 deleted），不是销毁 ✓
    // ⭐ 1.8.0：导入记录（只读）—— 这个会话导过哪几批、每批几条、导进来的前几条长什么样
    mroute('/dsh-clay-memory/import/batches', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      if (!sid) return res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: '缺少 session' }))
      try {
        const data = loadStore(sid)
        const 组 = new Map()
        for (const m of data.memories || []) {
          const k = String(m.importBatch || '')
          if (!k) continue
          if (!组.has(k)) 组.set(k, [])
          组.get(k).push(m)
        }
        const 名从来源 = (m) => {
          const src = String((m && m.source) || '')
          const i = src.indexOf('：')
          if (i < 0) return src || '（没说从哪儿导的）'
          return src.slice(i + 1).split(' 第')[0].trim() || '（没说从哪儿导的）'
        }
        const batches = [...组.entries()]
          .map(([batch, 们]) => ({
            batch,
            名: 名从来源(们[0]),
            时间: Math.min(...们.map((m) => Date.parse(m.at || m.createdAt) || Date.now())),
            条数: 们.length,
            items: 们.slice(0, 300).map((m) => ({
              id: m.id,
              text: String(m.text || '').slice(0, 240),
              source: String(m.source || ''),
            })),
          }))
          .sort((x, y) => y.时间 - x.时间)
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, batches }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }))
      }
    })

    mroute('/dsh-clay-memory/import/undo', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      const batch = String(b.batch || '')
      let 撤了 = 0
      try {
        const data = loadStore(sid)
        if (!Array.isArray(data.deleted)) data.deleted = []
        const 留下 = []
        const 撤销时间 = new Date().toISOString()
        for (const m of data.memories || []) {
          if (batch && String(m.importBatch || '') === batch) {
            m.deletedAt = 撤销时间
            m.撤销原因 = '导入撤销'
            data.deleted.push(m)
            标trace状态(sid, m.id, 'invalidated')
            撤了++
          } else {
            留下.push(m)
          }
        }
        if (撤了) {
          data.memories = 留下
          saveStore(sid, data)
          diag('撤销导入批次 ' + batch + '：收起了 ' + 撤了 + ' 条')
        }
      } catch (error) {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, message: String((error && error.message) || error) }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, 撤了: 撤了 }))
    })

    // 列一个目录下的子文件夹 —— 给她「选」，不用手打 ✓

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
