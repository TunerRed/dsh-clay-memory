// 2026-10-30 拆层工程第 10 批：apply 内的路由迁出（注册生成路由）
// 注册函数第一个参数是 mroute 注册器，第二个参数是 apply 环境（闭包依赖显式传入）
import { homedir } from 'node:os'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createSelfUpdate } from './selfupdate.mjs'
import { 取模型, 提炼系统, 洗键系统, 解析扩词, 解析提炼, 解析洗键, 选定模型, 问模型 } from './llm.mjs'
import { 已知会话ids, 归档名单 } from './ui.mjs'
import { 代际一致, 拍一批, 没动过 } from './patch-apply.mjs'
import { 归一键, 按键收敛, 是万能键 } from './scoring.mjs'
import { 销毁前另存 } from './backup.mjs'
import { 是会话文件, STORE_DIR } from './paths.mjs'
import { adoptTargetEpoch, loadStore, saveStore, 全量回填镜像 } from './store-core.mjs'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { titleOfSession } from './tools.mjs'
import { normalizePerson, selfNameOf, userPronoun } from './names.mjs'
import { fitPolicy, loadCfg, saveCfg, setEnabled, DEFAULT_POLICY } from './cfg.mjs'
import { diag } from './diag.mjs'
import { 扩词系统, 扩词系统_v2 } from './llm.mjs'

export function 注册生成路由(mroute, 环) {
  const { ctx, 读JSON体, 路径在允许范围 } = 环
    mroute('/dsh-clay-memory/dirs', async (req, res) => {
      const b = await 读JSON体(req)
      const out = { ok: true, path: '', parent: null, dirs: [] }
      try {
        const p = typeof b.path === 'string' ? b.path.trim() : ''
        if (!p) {
          // 没给路径 → 先列有哪些盘
          for (const 盘 of ['C:', 'D:', 'E:', 'F:', 'G:']) {
            try {
              if (existsSync(盘 + '\\')) out.dirs.push({ name: 盘, path: 盘 + '\\' })
            } catch (error) {}
          }
        } else if (!existsSync(p)) {
          out.ok = false
          out.message = '这个路径不存在：' + p
        } else {
          out.path = p
          const 上一级 = p.replace(/[\\/][^\\/]*[\\/]?$/, '')
          out.parent = 上一级 && 上一级 !== p ? 上一级 : null
          for (const name of readdirSync(p)) {
            try {
              if (statSync(join(p, name)).isDirectory()) out.dirs.push({ name: name, path: join(p, name) })
            } catch (error) {}
          }
          out.dirs.sort((a, c) => String(a.name).localeCompare(String(c.name), 'zh'))
        }
      } catch (error) {
        out.ok = false
        out.message = String((error && error.message) || error)
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(out))
    })

    // 列出 DSH 里能用哪些模型 —— 给她选 ✓
    mroute('/dsh-clay-memory/models', async (req, res) => {
      const b = await 读JSON体(req)
      const out = { ok: true, providers: [], 选中的: 选定模型(), 默认: null }
      try {
        const agent = ctx.agents.get(String(b.session || '')) || (ctx.agents.list() || [])[0]
        out.默认 = 取模型(ctx, agent)
        const ps = ctx.llm.listProviders() || []
        for (const p of ps) {
          const 条 = { id: p.id, name: p.name || p.id, models: [] }
          try {
            const ms = await ctx.llm.listModels(p.id)
            for (const m of ms || []) 条.models.push({ id: m.id, name: m.name || m.id })
          } catch (error) {
            条.错误 = String((error && error.message) || error)
          }
          out.providers.push(条)
        }
        diag('models：' + out.providers.length + ' 个 provider，默认 ' + (out.默认 ? out.默认.provider + '/' + out.默认.model : '？'))
      } catch (error) {
        out.ok = false
        out.message = String((error && error.message) || error)
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(out))
    })

    // ═══════════════════════════════════════════════════════════════
    // ⭐⭐ 2026-09-22（她的第十件）：**从会话生成档案** —— 给别人用的功能
    //
    //   用户导入自己的会话  →  模型读一遍，提炼出该长期记住的  →  出一份档案文件
    //                                                              ↓
    //                                          （已有的「从旧档案导入」把它变成记忆条目）
    //
    //   四步，界面循环调：
    //     gen-sessions  看这个工作区有哪些会话
    //     gen-plan      算要切几批、多少字、粗算多少 token
    //     gen-run       跑**一批**（⚠ 这一步才调模型、才花钱）
    //     gen-save      把攒下来的条目写成档案文件
    //
    //   ⚠ 整料（读会话 + 去重 + 切段）慢（一个会话约 1 秒），每批都做一遍太亏 → 缓存
    let 料缓存 = { 键: null, 值: null }
    // 会话概要缓存（标题/委派深度/话数）：翻文件要解 zstd → 读一次就记住 ✓
    const 生成档案概要缓存 = new Map()
    const 取料 = (sids) => {
      const 键 = (sids || []).slice().sort().join(',')
      if (料缓存.键 === 键 && 料缓存.值) return 料缓存.值
      const 值 = 生成档案.整料(CFG_DIR, sids)
      料缓存 = { 键, 值 }
      return 值
    }
    // ⚠⚠ 2026-09-22：原来这里有个「扫文件夹找当前工作区」的写法 —— **已经不用了**。
    //   反馈：「工作区就 3 个」—— 可扫文件夹扫出来 6 个。
    //   文件夹是**文件系统**的答案，DSH 自己认为的名单在 `workspaceRegistry` 里 ✗→✓
    //   （留着这段注释，免得下次又有人去扫文件夹）

    // 档案建议存到哪儿：这个会话的工作目录里（比 `.dsh` 里合适）
    const 建议档案路径 = (ctx, agent) => {
      try {
        const h = agent && agent.session && agent.session.header
        const cwd = (h && h.cwd) || (agent && agent.session && agent.session.cwd)
        if (cwd && typeof cwd === 'string') return join(cwd, '生成的档案.md')
      } catch (error) {}
      return join(CFG_DIR, '生成的档案.md')
    }

    mroute('/dsh-clay-memory/gen-sessions', async (req, res) => {
      const 回 = (o) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(o))
      }
      try {
        const agent = (ctx.agents.list() || [])[0]
        const 全部 = 生成档案.列会话(CFG_DIR)
        // ⚠⚠ 2026-09-22（反馈：「我工作区就3个」，可列表里冒出来 6 个）：
        //   我原来是**扫文件夹**扫出来的 —— 那是**文件系统**的答案，不是 **DSH 的答案** ✗
        //   → 改成用 `已知会话ids(ctx)`（插件里别处用的就是它，走 workspaceRegistry）✓
        //     ⚠ 它的约定是「**宁可多露，不可错藏**」：拿不到就 ok=false，那就一条都不藏
        const 已知 = 已知会话ids(ctx)
        // 归档名单 + 子代理 + 空壳（双保险；DSH 的名单一般已经不含子代理了）
        const 归档 = 归档名单(ctx)
        // ⚠⚠ 2026-09-22（反馈：「为什么我重启还在」）：
        //   光靠 workspaceRegistry 还不够 —— 那个 347 字节的**空壳会话**
        //   （只有个会话头、一句话都没说过）DSH 的名单里居然还在 ✗
        //   → 再加一道：**一句话都没说过的，不列** ✓
        //   （顺便：概要一次读完，标题/委派深度/话数一个文件只解一遍）
        const 概要缓存 = 生成档案概要缓存
        const 取概要 = (x) => {
          if (概要缓存.has(x.sid)) return 概要缓存.get(x.sid)
          const g = 生成档案.取概要(x.路径)
          // 标题：DSH 那份（当前加载着的会话）优先，读不到才用文件里的
          const t = titleOfSession(ctx, x.sid)
          if (t) g.标题 = t
          概要缓存.set(x.sid, g)
          return g
        }
        const 本区 = 全部
          .filter((x) => !已知.ok || 已知.ids.has(String(x.sid)))
          .filter((x) => !归档.has(String(x.sid)))
          .filter((x) => {
            const g = 取概要(x)
            if (g.委派深度 > 0) return false // 子代理跑出来的会话
            if (g.话数 <= 0) return false // 空壳：一句话都没说过
            return true
          })
        // ⚠ 诊断信息一起返回 —— 列表跟 DSH 对不上时，看这几个数就知道卡在哪一道
        const 诊断 = {
          文件夹里: 全部.length,
          DSH名单: 已知.ok ? 已知.ids.size : '（拿不到）',
          归档: 归档.size,
          筛完剩: 本区.length,
          被我筛掉的: 全部
            .filter((x) => !本区.some((y) => y.sid === x.sid))
            .map((x) => {
              const g = 取概要(x)
              const 因 = 归档.has(String(x.sid))
                ? '归档'
                : 已知.ok && !已知.ids.has(String(x.sid))
                  ? 'DSH名单里没有'
                  : g.委派深度 > 0
                    ? '子代理'
                    : g.话数 <= 0
                      ? '空壳'
                      : '？'
              return { sid: x.sid.slice(0, 12), 因, 标题: (g.标题 || '').slice(0, 20) }
            }),
        }
        // ⭐⭐ 2026-09-22（反馈：「不显示名字」）：
        //   列表里光有 session-xxxx 这种**没法挑** → 得显示标题。
        //   （标题在取概要里已经拿到了，这里直接用）
        回({
          ok: true,
          工作区: 已知.ok ? 'DSH 的名单（' + 已知.ids.size + ' 个）' : '（拿不到 DSH 的名单，按文件夹列的）',
          诊断,
          // ⭐⭐ 2026-09-22（反馈：「点存档案的地方应该自定义」）：
          //   原来存到哪儿是我**写死的**（`.dsh\生成的档案.md`）✗
          //   → 给个**建议路径**（放在这个会话的工作目录里，比 `.dsh` 里合适），
          //     界面上能打、能选文件夹 ✓
          建议存到: 建议档案路径(ctx, agent),
          会话: 本区.map((x) => {
            const g = 取概要(x)
            return { sid: x.sid, 标题: g.标题, 话数: g.话数, MB: +(x.大小 / 1048576).toFixed(1) }
          }),
        })
      } catch (error) {
        回({ ok: false, message: String((error && error.message) || error) })
      }
    })

    mroute('/dsh-clay-memory/gen-plan', async (req, res) => {
      const b = await 读JSON体(req)
      const 回 = (o) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(o))
      }
      try {
        const sids = Array.isArray(b.sids) ? b.sids.map(String) : []
        if (!sids.length) return 回({ ok: false, message: '没选会话' })
        const 料 = 取料(sids)
        const 批 = 生成档案.切批(料.按天)
        // 粗算：正文 + 提示词（每批都要带一遍）
        const 提示长 = 生成档案.提示词.length
        const token = Math.round((料.总字 + 提示长 * 批.length) * 0.7)
        回({
          ok: true,
          会话: 料.会话结果,
          天数: 料.按天.length,
          批数: 批.length,
          总字: 料.总字,
          挑出来: 料.材料堆.length,
          token,
          每批字上限: 生成档案.每批字上限,
        })
      } catch (error) {
        回({ ok: false, message: String((error && error.message) || error) })
      }
    })

    // ⚠⚠ 这一步**调模型、花钱**。界面必须一批一批调，跑完一批存一批。
    mroute('/dsh-clay-memory/gen-run', async (req, res) => {
      const b = await 读JSON体(req)
      const 回 = (o) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(o))
      }
      try {
        const sids = Array.isArray(b.sids) ? b.sids.map(String) : []
        const 批号 = Number(b.批号)
        if (!sids.length) return 回({ ok: false, message: '没选会话' })
        if (!(批号 >= 1)) return 回({ ok: false, message: '没给批号' })
        const 料 = 取料(sids)
        const 批 = 生成档案.切批(料.按天)
        if (批号 > 批.length) return 回({ ok: true, done: true, 批数: 批.length, 条目: [] })

        const 已记 = Array.isArray(b.已记) ? b.已记.map(String) : []
        const { system, user } = 生成档案.拼输入(批[批号 - 1], 已记)

        // 模型：用户自己选的优先，没选就用他会话里在用的那个
        const agent = ctx.agents.get(String(b.session || '')) || (ctx.agents.list() || [])[0]
        const 用户选的 = b.provider && b.model ? { provider: String(b.provider), model: String(b.model), from: '你选的' } : null
        const t = 用户选的 || 取模型(ctx, agent)
        if (!t) return 回({ ok: false, message: '拿不到模型 —— 去设置页读一下有哪些模型' })

        // ⚠ 2026-10-26：3000 太小了 —— 思考型模型的「思考」也计入 maxTokens，
        //   一整批 5000–7000 字喂进去，它先想很久，额度被思考吃光 → text 为空
        //   → 解析出 0 条（界面上就是「跑完了，攒了 0 条」）
        const r = await 问模型(ctx, agent, system, user, 8000, t)
        if (!r.ok) return 回({ ok: false, message: r.message, 批号, 批数: 批.length })

        const 条目 = 生成档案.解析条目(r.text)
        diag('生成档案：第 ' + 批号 + '/' + 批.length + ' 批（' + 批[批号 - 1].天 + '，' + 批[批号 - 1].字 + ' 字）→ ' + 条目.length + ' 条；回文 ' + r.text.length + ' 字' + (条目.length ? '' : '：' + r.text.replace(/\s+/g, ' ').slice(0, 200)))
        回({
          ok: true,
          done: 批号 >= 批.length,
          批号,
          批数: 批.length,
          天: 批[批号 - 1].天,
          这批字: 批[批号 - 1].字,
          条目,
          模型: r.provider + '/' + r.model,
        })
      } catch (error) {
        回({ ok: false, message: String((error && error.message) || error) })
      }
    })

    mroute('/dsh-clay-memory/gen-save', async (req, res) => {
      const b = await 读JSON体(req)
      const 回 = (o) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(o))
      }
      try {
        const 条目 = Array.isArray(b.条目) ? b.条目 : []
        if (!条目.length) return 回({ ok: false, message: '没有条目可存' })
        const 出 = 生成档案.出档案(
          条目.map((x) => ({ 章: String(x.章 || ''), 日期: String(x.日期 || '无'), 话: String(x.话 || '') })),
          '由会话自动整理（' + (b.来源 || '') + '）',
        )
        let 存到 = String(b.存到 || '').trim() || join(CFG_DIR, '生成的档案.md')
        // 只允许写进工作区 / 文档 / 桌面，且必须是 .md（别让人借这个接口覆盖任意文件）
        if (!/\.md$/i.test(存到)) return 回({ ok: false, message: '只能存成 .md' })
        const 目录部分 = /[\\/]$/.test(存到) ? 存到 : dirname(存到)
        if (!路径在允许范围(目录部分)) return 回({ ok: false, message: '只能存到工作区或文档目录里' })
        // ⚠⚠ 2026-09-22（反馈：「选了文件夹点了过后再想换就卡住」时看出来的）：
        //   她那个框里最后是 `C:\` —— 那是个**目录**，不是文件。
        //   原来我拿它当文件写 → EISDIR 报错；而且「目录不存在就建」会把 `C:\` 当目录建 ✗
        //   → **给的是目录（结尾是分隔符 / 本身是已存在的目录），就自动补上文件名** ✓
        try {
          const 结尾是分隔 = /[\\/]$/.test(存到)
          const 是目录 = 结尾是分隔 || (existsSync(存到) && statSync(存到).isDirectory())
          if (是目录) 存到 = join(存到, '生成的档案.md')
        } catch (error) {}
        if (!/[\\/]/.test(存到)) {
          return 回({ ok: false, message: '这个路径不像一条完整路径：' + 存到 + '（要带盘符或目录）' })
        }
        const 目录 = dirname(存到)
        try {
          if (!existsSync(目录)) mkdirSync(目录, { recursive: true })
        } catch (error) {
          return 回({ ok: false, message: '建不了这个目录：' + 目录 + '　' + ((error && error.message) || error) })
        }
        // ⚠ 动之前备份（跟别的功能一样）
        try {
          if (existsSync(存到)) {
            const 备 = 存到 + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-')
            copyFileSync(存到, 备)
          }
        } catch (error) {}
        writeFileSync(存到, 出.md, 'utf8')
        回({ ok: true, 存到, 条数: 出.条目.length, 去掉重复: 出.去掉了, 预览: 出.md.slice(0, 2000) })
      } catch (error) {
        回({ ok: false, message: String((error && error.message) || error) })
      }
    })

    // 提炼：把导入进来的档案原文改写成真正的记忆 —— 一次一批，界面循环调 ✓
    mroute('/dsh-clay-memory/refine', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      const 每批 = Math.max(1, Math.min(20, Number(b.每批) || 6))
      let out = { ok: false, message: '没找到会话' }
      try {
        const data = loadStore(sid)
        // 要提炼的：档案导入进来的、还没提炼过的
        // ⚠ 加一个「试过几次」的上限：模型偶尔整批回不出东西，
        //   那种批次**不标记**、留着下次重跑；试满 3 次才收进「跳过」，不然会死循环 ✗
        const 最多试 = 3
        // ⭐ 1.8.0：可以只整理某一批（批次 = importBatch），避免「只想整理刚导入的 5 条，
        //   结果把两百多条历史欠账全跑了 ✗」
        const 限批 = typeof b.批次 === 'string' ? b.批次.trim() : ''
        const 要提 = (data.memories || []).filter(
          (m) =>
            String(m.source || '').indexOf('档案导入') === 0 &&
            !m.refinedAt &&
            (Number(m.refineTries) || 0) < 最多试 &&
            (!限批 || String(m.importBatch || '') === 限批),
        )
        if (!要提.length) {
          out = { ok: true, done: true, 改了: 0, 跳过: 0, 剩: 0, 总数: (data.memories || []).length }
        } else {
          const 批 = 要提.slice(0, 每批)
          // GPT 整改 P1（字段级 CAS）：LLM 前拍这批条目的目标字段快照，
          //   LLM 回来逐字段比对 —— 等模型那几秒里被外部改过的字段一律不覆盖。
          const 快照 = 拍一批(批, ['text', 'related', 'at', 'atGuessed', 'importance', 'category', '事实键', 'refinedAt', 'refinedSkip', 'refineTries'])
          const agent = ctx.agents.get(sid) || (ctx.agents.list() || [])[0]
          const 输入 = 批.map((m, i) => i + 1 + '|' + String(m.text || '')).join('\n')
          const t0 = Date.now()
          // ⚠ 预算要给够：模型会先「思考」，思考的 token 也算在里面。
          //   给 2400 的时候实测被思考吃光、正文长度 0、整批被误判成「跳过」✗
          const r = await 问模型(ctx, agent, 提炼系统(userPronoun()), 输入, 6000)
          const ms = Date.now() - t0
          if (!r.ok) {
            out = { ok: false, message: r.message, 剩: 要提.length, provider: r.provider, model: r.model, ms: ms }
          } else {
            const 表 = 解析提炼(r.text, 批.length)
            // ⭐ B 阶段（2026-10-30）：await 之后重新读库、按 id 改 ——
            //   旧代码拿快照 data 整份写回，等模型那几秒里的新增会被盖掉
            //   （2026-10-24 自动扩词同款「记忆静默丢失」）。照抄自动扩词那套。
            const 目标ids = 批.map((m) => String(m.id))
            const 新库 = loadStore(sid)
            if (!代际一致(data, 新库)) {
              diag('提炼：' + sid + ' 等模型这中间整库被清过，丢弃这批结果')
              out = { ok: false, message: '记忆库刚被清理过，这批结果作废', 剩: 要提.length, provider: r.provider, model: r.model, ms: ms }
            } else {
            let 改了 = 0
            let 跳过 = 0
            let 出了词的 = 0
            let 出了日期的 = 0
            let 出了重要度 = 0
            let 出了键的 = 0
            let 没解析出来 = 0
            let 字段冲突 = 0
            const now = new Date().toISOString()
            for (let i = 0; i < 批.length; i++) {
              const m = (新库.memories || []).find((x) => x && String(x.id) === 目标ids[i])
              if (m && m.别记) continue // 中间被标「别记」→ 跳过（审查 B6）
              if (!m) continue // 这中间被删 / 被合 → 跳过，别硬写
              const 旧 = 快照.get(目标ids[i])
              if (!旧) continue
              // GPT 整改 P1：这中间已被别的提炼批处理过（refinedAt / refinedSkip 出现）→
              // 整条跳过，别用旧结果覆盖别人的结论
              if ('refinedAt' in m && !旧.refinedAt.有) continue
              if ('refinedSkip' in m && !旧.refinedSkip.有) continue
              const 格 = 表[i]
              const 句子 = 格 ? 格.正文 : ''
              // 模型整批没回出东西（思考吃光预算、截断、格式跑了）→
              // **不标记**，记一次「试过」，下次还会重跑 ✓
              if (!句子) {
                m.refineTries = (Number(m.refineTries) || 0) + 1
                没解析出来++
                if (m.refineTries >= 最多试) {
                  m.refinedAt = now
                  m.refinedSkip = true
                  m.refineFailed = true // 试满了还是不行，标出来让她看得见
                }
                continue
              }
              // 模型明说「跳过」→ 这是它判断这条不值得记，收下 ✓
              if (/^跳过$/.test(句子)) {
                跳过++
                m.refinedAt = now
                m.refinedSkip = true
                continue
              }
              // GPT 整改 P1（字段级 CAS）：正文等模型期间被外部改过 → 整条提炼结果作废
              // （提炼要替换的就是正文，正文都不是原来那条了，模型看的内容已过时）
              if (!没动过(m, 旧, 'text')) { 字段冲突++; continue }
              m.textBefore = String(m.text || '')
              m.text = normalizePerson(句子, selfNameOf(sid))
              // 顺手把检索词也收下 —— 有就不用再单独跑扩词了 ✓
              if (格 && 格.词 && 格.词.length && 没动过(m, 旧, 'related')) {
                m.related = 格.词.slice(0, 8)
                出了词的++
              }
              // ⭐ 顺手把日期也收下 —— **只补没日期的** ✓
              //   已经有日期的不动（导入时抠出来的那个更可信，是从原文抠的）
              if (格 && 格.日期 && !m.at && 没动过(m, 旧, 'at')) {
                m.at = 格.日期.at
                if (格.日期.猜年) m.atGuessed = true
                else delete m.atGuessed
                出了日期的++
              }
              // ⭐ 顺手把重要度也收下（2026-09-21 深夜，她的主意）✓
              //   **这条是覆盖** —— 导入时那个数按**小节标题**猜的（「关系/约定」那一节全打 1），
              //   是「这一小节」的分；模型看的是**这一条**，比标题准 → 就该让它说了算 ✓
              //   ⚠ 只在模型真给了合法值（1 或 0.5）时才动；它没给/给歪了就**保持原样**，
              //     不能因为模型抽风把整库的重要度洗成同一个数 ✗
              //
              // ⭐⭐ 2026-09-22（反馈）：**顺手把「永远不淡」也定了** ✓✓
              //
              //   原话：「很多条记忆，像**生日、纪念日、结婚**这种，
              //   就应该是长期事实，但是**从来就没有标记过**啊，我们这个压根就没有做到啊」
              //
              //   实测：库里 850 条，**135 条该「永远不淡」的被标成了会淡的**
              //   （重要的日子、身体、病史……全在里面）
              //
              //   根子：`/refine` 只写 `m.importance`，**不碰 `m.category`** ✗
              //   → 一条记忆永远停在「导入时按小节标题猜的那个分类」上，提炼判得再准也改不了它淡不淡。
              //
              //   修法（**不加格子、一个 token 都不多花**）：
              //     第五格「重要度」的含义本来就是「1 = 要一直记得的」，
              //     而导入那边本来就是 `category: imp >= 1 ? 'stable_profile' : 'event'`
              //     → 让「1」这个数**同时管两件事** ✓
              if (格 && typeof 格.重要度 === 'number' && 没动过(m, 旧, 'importance')) {
                m.importance = 格.重要度
                出了重要度++
              }
              if (格 && typeof 格.重要度 === 'number' && 没动过(m, 旧, 'category')) {
                // 判成 1 = 要一直记得的 → 永远不淡；判成 0.5 → 会淡
                m.category = 格.重要度 >= 1 ? 'stable_profile' : 'event'
              }
              // ⭐⭐ 2026-09-23：**顺手收下事实键**（反馈第二点「同一个 key 只留最新一条」）✓
              //   ⚠ 只在模型真给了**像键**的东西时才写；没给/给歪了就**保持原样**，
              //     不能因为模型抽风把整库的键洗成一样的 ✗
              //   ⚠ 2026-10-30 审查 B5 → 2026-10-31 GPT 整改 P1：等模型那几秒里别人改过
              //     事实键（facts/edit）的，旧任务回来不许覆盖 —— 字段级 CAS
              if (格 && 格.键 && 没动过(m, 旧, '事实键')) {
                m.事实键 = 格.键
                出了键的++
              }
              m.refinedAt = now
              delete m.refinedSkip
              delete m.refineTries
              改了++
            }
            // 成功提炼会顺手删掉 refineSkip / refineTries（重新开始计数）——本趟不许被合并补回
            saveStore(sid, 新库, { 清字段: ['refineSkip', 'refineTries'] })
            const 剩 = 要提.length - 批.length
            diag(
              '提炼：' + sid + ' 这批 ' + 批.length + ' 条，改写 ' + 改了 +
                '（其中 ' + 出了词的 + ' 条顺手出了检索词，' + 出了日期的 + ' 条顺手出了日期，' + 出了重要度 + ' 条顺手判了重要度，' + 出了键的 + ' 条顺手出了事实键），跳过 ' + 跳过 +
                (没解析出来 ? '，没解析出来 ' + 没解析出来 + '（留着重跑）' : '') +
                '，还剩 ' + Math.max(0, 剩) + '（' + ms + 'ms，' + r.provider + '/' + r.model + '）',
            )
            out = {
              ok: true,
              done: Math.max(0, 剩) <= 0,
              改了: 改了,
              这批没出词: 批.length - 改了,
              跳过: 跳过,
              出了词的: 出了词的,
              出了日期的: 出了日期的,
              出了重要度: 出了重要度,
              出了键的: 出了键的,
              没解析出来: 没解析出来,
              字段冲突: 字段冲突,
              剩: Math.max(0, 剩),
              总数: (新库.memories || []).length,
              provider: r.provider,
              model: r.model,
              ms: ms,
              示例: 目标ids.slice(0, 3).map((id) => (新库.memories || []).find((x) => x && String(x.id) === id)).filter(Boolean).map((m) => ({ 前: m.textBefore || null, 后: m.text, 跳过: !!m.refinedSkip })),
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

    // ---------- 老数据清洗：给已经躺在库里的条目补事实键 ----------
// ⭐⭐ 2026-09-23（第三步）：按一次跑一批，页面循环调（跟提炼同一个套路）✓
//
//   ⚠⚠ **只从设置页点按钮进来，绝不从对话里触发** —— 几百条要调几百次模型，
//     挂在对话那一轮上会把那一轮卡死。她的死规矩，也对。
//   ⚠ 动之前**先另存一份**（跟清空/批量清掉同一个道理）——
//     归并那一步会标「已被取代」，标错了一片就得能整份退回来 ✗
mroute('/dsh-clay-memory/wash-keys', async (req, res) => {
  const b = await 读JSON体(req)
  const sid = String(b.session || '')
  const 每批 = Math.max(1, Math.min(20, Number(b.每批) || 8))
  // 干跑：只报会怎么动，一个字都不写 ✓（先让她看一眼，别一上来就改库）
  const 干跑 = !!b.干跑
  let out = { ok: false, message: '没找到会话' }
  try {
    const data = loadStore(sid)
    // 要洗的：**还没有键**的活条目（有键的、已经作废的、删掉的不碰）✓
    //   ⚠ 提炼判「跳过」的不洗 —— 它们本来就不参与召回，给键没意义
    const 要洗 = (data.memories || []).filter(
      (m) =>
        m &&
        !m.已被取代 &&
        !m.refinedSkip &&
        // ⚠⚠ **洗过的就不再洗** —— 包括「模型判了留空」的那些 ✓
        //   原来这里只判「有没有键」→ 留空的那些下一批又被挑出来，
        //   **永远洗不完**（实测就是卡在「还剩 490 条」不动）✗
        !m.洗键过 &&
        !归一键(m.事实键) &&
        String(m.text || '').trim(),
    )
    if (!要洗.length) {
      const 有键的 = (data.memories || []).filter((m) => m && 归一键(m.事实键)).length
      out = { ok: true, done: true, 洗了: 0, 给了键: 0, 剩: 0, 已有键: 有键的, 总数: (data.memories || []).length }
    } else {
      const 批 = 要洗.slice(0, 每批)
      // GPT 整改 P1（字段级 CAS）：LLM 前拍目标字段快照，回来逐字段比对 ——
      //   等模型那几秒里被外部（/edit、别的批量路由）改过的字段不得覆盖。
      const 快照 = 拍一批(批, ['事实键', '键来源', '洗键过', 'text'])
      const agent = ctx.agents.get(sid) || (ctx.agents.list() || [])[0]
      const 输入 = 批.map((m, i) => i + 1 + '|' + String(m.text || '')).join('\n')
      // ⚠⚠⚠ 2026-09-24（真数据审出来的根子）：
      //   把**已经用过的键**一并给模型看 —— 不然每一批都自己造说法，
      //   同一件事会写出【她.网名】/【她.昵称】这种两个键，**永远合不上** ✗
      //   ⚠ 只给**这一批之前已经有的**（包括本次清洗前面几批刚标的）✓
      //   ⚠ 万能键不给（那些本来就不该存在）✗
      //   ⚠ 加个上限：键会越积越多，全塞进去 prompt 会撑爆（一次性的活，但也别浪费）
      const 已有键 = []
      {
        const 见过 = new Set()
        for (const m of data.memories || []) {
          if (!m || m.已被取代) continue
          const k = 归一键(m.事实键)
          if (!k || 是万能键(k) || 见过.has(k)) continue
          见过.add(k)
          已有键.push(k)
        }
        // ⚠ 排在前面的更可能是「已经定下来的」，超了就砍尾巴 ✓
        已有键.length = Math.min(已有键.length, 400)
      }
      const t0 = Date.now()
      const r = await 问模型(ctx, agent, 洗键系统(userPronoun(), 已有键), 输入, 6000)
      const ms = Date.now() - t0
      if (!r.ok) {
        out = { ok: false, message: r.message, 剩: 要洗.length, provider: r.provider, model: r.model, ms: ms }
      } else {
        const 表 = 解析洗键(r.text, 批.length)
        // ⭐ B 阶段（2026-10-30）：await 之后重新读库、按 id 改（照抄自动扩词那套）——
        //   旧代码拿快照 data 整份写回，等模型那几秒里的新增会被盖掉。
        //   干跑不落盘，不需要重读；真写才重读。
        const 目标ids = 批.map((m) => String(m.id))
        const 新库 = 干跑 ? data : loadStore(sid)
        if (!干跑 && !代际一致(data, 新库)) {
          diag('清洗补键：' + sid + ' 等模型这中间整库被清过，丢弃这批结果')
          out = { ok: false, message: '记忆库刚被清理过，这批结果作废', 剩: 要洗.length, provider: r.provider, model: r.model, ms: ms }
        } else {
        let 给了键 = 0
        let 留空 = 0
        let 键中间被改 = 0
        let 字段冲突 = 0
        // ⚠⚠ 「模型整批没回出东西」跟「模型判了留空」是**两件事**，必须分开数 ✗
        //   原来客户端拿「给了键 === 0」当失败信号 ——
        //   可模型**正常地**把一批全判成留空时也是 0 →
        //   连着 3 批就被当成「模型出问题了」停下来（实测踩到过）
        let 没回出东西 = 0
        const 示例 = []
        const now = new Date().toISOString()
        for (let i = 0; i < 批.length; i++) {
          // 干跑只读快照；真写从新库按 id 取 —— 被删 / 被合的跳过，别硬写
          const m = 干跑 ? 批[i] : (新库.memories || []).find((x) => x && String(x.id) === 目标ids[i])
          if (m && m.别记) continue // 中间被标「别记」→ 跳过（审查 B6）
          if (!m) continue
          // ⚠ 这一行模型压根没回 → **不标记**，下次重跑 ✓
          //   （这跟「回了但留空」不一样：那是它的判断，这是它没答上来）
          const 有行 = Object.prototype.hasOwnProperty.call(表, i)
          if (!有行) {
            没回出东西++
            continue
          }
          const k = 表[i]
          // ⚠ 干跑：一个字段都不写，只报告 ✓
          if (干跑) {
            if (k) {
              给了键++
              if (示例.length < 5) 示例.push({ id: m.id, 键: k, 正文: String(m.text || '').slice(0, 40) })
            } else {
              留空++
            }
            continue
          }
          // ⚠⚠ **只要模型回了这一行，就算「洗过」** —— 哪怕是留空 ✓
          //   这就是那个死循环的解药：留空也是一次**判断**，判过就不用再问 ✗
          // GPT 整改 P1：等模型那几秒里别人已经洗过这条 → 整条跳过，不重复标
          const 旧 = 快照.get(目标ids[i])
          if (!旧) continue
          if (!没动过(m, 旧, '洗键过')) { 字段冲突++; continue }
          m.洗键过 = now
          if (!k) {
            留空++
            continue
          }
          // 2026-10-30 审查 B5：等模型那几秒里别人改过事实键的，旧任务回来不许覆盖
          if (!没动过(m, 旧, '事实键')) {
            键中间被改++
            continue
          }
          m.事实键 = k
          // ⚠ 打个记号：只有**自动补的**键才带这个。
          //   她手工填的键不许被「整份撤回」那个按钮抹掉 ✗
          m.键来源 = '清洗补键'
          给了键++
        }
        // 归并：同一个键只留最新那条（1.0.7 那套「已被取代」现成的）✓
        let 作废的 = []
        if (!干跑) {
          if (给了键) {
            // ⚠ 动库之前先另存 —— 归并会标一片「已被取代」，标错了要能整份退回来 ✓
            try {
              销毁前另存(sid, data, '清洗补键之前')
            } catch (error) {}
            try {
              作废的 = 按键收敛(新库, '清洗补键')
            } catch (error) {}
          }
          // ⚠ 无条件存：这一批可能只有「留空」的标记要落盘 ✓
          saveStore(sid, 新库)
        }
        const 剩 = 要洗.length - 批.length
        out = {
          ok: true,
          done: Math.max(0, 剩) <= 0,
          干跑: 干跑,
          洗了: 批.length,
          给了键: 给了键,
          键中间被改: 键中间被改,
          字段冲突: 字段冲突,
          留空: 留空,
          没回出东西: 没回出东西,
          作废了: 作废的.length,
          剩: Math.max(0, 剩),
          总数: (新库.memories || []).length,
          provider: r.provider,
          model: r.model,
          ms: ms,
          示例: 示例,
        }
        if (!干跑) {
          diag(
            '清洗补键：' + sid + ' 这批 ' + 批.length + ' 条，给了键 ' + 给了键 + '、留空 ' + 留空 +
              (键中间被改 ? '、键中间被改 ' + 键中间被改 : '') +
              (字段冲突 ? '、字段冲突 ' + 字段冲突 : '') +
              (没回出东西 ? '、没回出东西 ' + 没回出东西 : '') +
              '、顺手作废 ' + 作废的.length + '，还剩 ' + Math.max(0, 剩) + '（' + ms + 'ms）',
          )
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

// 清洗补键：**整份撤回**（把这一轮补的键全摘掉、把这一轮标的作废全恢复）✓
//   ⚠ 界面上给一个「把补的键全摘掉」——
//     几百条自动补键，她要是看着不对，得能一键回到洗之前。
//     ⚠ 只摘「这一轮之外没人动过」的：她手工填的键不许被这个按钮抹掉 ✗
mroute('/dsh-clay-memory/wash-keys/undo', async (req, res) => {
  const b = await 读JSON体(req)
  const sid = String(b.session || '')
  let out = { ok: false, message: '没找到会话' }
  try {
    const data = loadStore(sid)
    let 摘了 = 0
    let 洗过清 = 0
    let 恢复 = 0
    for (const m of data.memories || []) {
      if (!m) continue
      // 摘键：只有**这一轮补的**才摘（打了个记号，见上面写键的地方）
      if (m.键来源 === '清洗补键') {
        delete m.事实键
        delete m.键来源
        摘了++
      }
      // ⚠⚠ **「洗过」的记号也要清掉** —— 不然撤回之后一个都洗不动了 ✗
      //   （那些「判了留空」的条目只带这个记号、没带键；
      //     不清的话撤回等于把整库标成「都洗过了」，再点按钮会说「没得洗」）
      //   ⚠ 她手工填的键**没有**这个记号（它压根没进过清洗），所以不会被误伤 ✓
      if (m.洗键过) {
        delete m.洗键过
        洗过清++
      }
      // 恢复作废：只有**清洗补键这一轮标的**才恢复（按 被谁 判，别按文案 ——
      //   文案「同一个「」只留最新」add 新记忆时也会写，按文案会把那批误恢复）
      if (m.已被取代 && m.已被取代.被谁 === '清洗补键') {
        delete m.已被取代
        恢复++
      }
    }
    // ⚠ 2026-10-30 审查 P2-3：undo 自己也是动库 —— 撤之前另存一份，撤错了还能退
    if (摘了 || 洗过清 || 恢复) {
      try {
        销毁前另存(sid, data, '清洗补键撤回之前')
      } catch (error) {}
    }
    // 洗键撤销是**故意删字段**（事实键/键来源/洗键过）——不清字段的话合并会把盘上旧值补回
    saveStore(sid, data, { 清字段: ['事实键', '键来源', '洗键过'] })
    out = { ok: true, 摘了: 摘了, 洗过清: 洗过清, 恢复: 恢复 }
  } catch (error) {
    out = { ok: false, message: String((error && error.message) || error) }
  }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(out))
})

// 提炼改坏了怎么办 —— 退回原文 ✓
    // 单条：{ session, id }；整批：{ session, all: true }
    // 退回之后它会重新变成「没提炼的」，想再提一遍随时可以
    mroute('/dsh-clay-memory/refine/undo', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      const 单条 = typeof b.id === 'string' ? b.id : ''
      const 整批 = !!b.all
      let out = { ok: false, message: '没找到会话' }
      try {
        const data = loadStore(sid)
        let 退了 = 0
        for (const m of data.memories || []) {
          if (typeof m.textBefore !== 'string') continue
          if (!整批 && m.id !== 单条) continue
          m.text = m.textBefore
          delete m.textBefore
          delete m.refinedAt
          delete m.refinedSkip
          m.refinedUndoAt = new Date().toISOString()
          退了++
        }
        if (退了) saveStore(sid, data, { 清字段: ['refinedAt', 'refinedSkip', 'refineTries', 'textBefore'] })
        diag('提炼退回原文：' + sid + (整批 ? '（全部）' : '（' + 单条 + '）') + ' → ' + 退了 + ' 条')
        out = { ok: true, 退了: 退了, 剩: (data.memories || []).filter((m) => typeof m.textBefore === 'string').length }
      } catch (error) {
        out = { ok: false, message: String((error && error.message) || error) }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(out))
    })

    // 把「跳过」的重新放回队列 —— 模型偶尔整批回不出东西，那些不该永远躺着 ✓
    // 只放回**没改写过的**（跳过的原文还在）；改写过的走「退回原文」那条路
    mroute('/dsh-clay-memory/refine/retry', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      let out = { ok: false, message: '没找到会话' }
      try {
        const data = loadStore(sid)
        let 放回 = 0
        for (const m of data.memories || []) {
          if (!m.refinedSkip) continue
          if (typeof m.textBefore === 'string') continue // 改写过的，走「退回原文」
          delete m.refinedAt
          delete m.refinedSkip
          delete m.refineFailed
          delete m.refineTries
          放回++
        }
        if (放回) saveStore(sid, data, { 清字段: ['refinedAt', 'refineSkip', 'refineFailed', 'refineTries'] })
        diag('提炼重跑：' + sid + ' 放回 ' + 放回 + ' 条')
        out = { ok: true, 放回: 放回 }
      } catch (error) {
        out = { ok: false, message: String((error && error.message) || error) }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(out))
    })

    // 把记忆复制到**另一个会话** —— 她想在新对话里测（新对话没有上下文，最干净）✓
    // { session: 从哪来, to: 到哪去 }
    // ⚠ 会**覆盖**目标那边的记忆（覆盖前 saveStore 会自动备份一份 .bak）
    // ⚠⚠ 1.4.0 双层库：**只复制事件**。事实住在全局库 `_facts.json` 里，
    //    哪个会话都看得见，复制它既不必要、还会在目标库留下重复副本 ✓
    mroute('/dsh-clay-memory/copy-to', async (req, res) => {
      const b = await 读JSON体(req)
      const 从 = String(b.session || '')
      const 到 = String(b.to || '')
      let out = { ok: false, message: '没找到会话' }
      try {
        if (!从 || !到) {
          out = { ok: false, message: '要指明从哪个会话、到哪个会话' }
        } else if (从 === 到) {
          out = { ok: false, message: '来源和目标不能是同一个会话' }
        } else {
          const 母的 = loadStore(从)
          const 事件们 = (母的.memories || []).filter((m) => m.category !== 'stable_profile')
          if (!事件们.length) {
            out = { ok: false, message: '来源那边没有事件，没什么可复制的（事实是全局的，不用复制）' }
          } else {
            const 副本 = JSON.parse(JSON.stringify({
              ...母的,
              memories: 事件们,
              // 墓碑也只搬事件的：事实的墓碑由全局库统一管，搬过来会变成目标会话的私货 ✗
              deleted: (母的.deleted || []).filter((m) => m.category !== 'stable_profile'),
            }))
            adoptTargetEpoch(副本, loadStore(到))
            for (const m of 副本.memories || []) {
              m.source = m.source ? m.source + '｜复制' : '复制'
            }
            副本.traces = [] // 召回历史不跟过去，那边是新的开始
            saveStore(到, 副本)
            setEnabled(到, true) // 复制过去了就顺手把开关打开，不然等于没复制
            diag('复制记忆：' + 从 + ' → ' + 到 + '（' + (副本.memories || []).length + ' 条事件）')
            out = { ok: true, 复制了: (副本.memories || []).length, 到: 到, 从: 从 }
          }
        }
      } catch (error) {
        out = { ok: false, message: String((error && error.message) || error) }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(out))
    })

    // 先验一下宿主模型通不通（诊断用）✓
    mroute('/dsh-clay-memory/llm-check', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      const agent = sid ? (ctx.agents.get(sid) || (ctx.agents.list() || [])[0]) : (ctx.agents.list() || [])[0]
      const t0 = Date.now()
      // ⚠ 预算别给太小：模型光「思考」就能吃掉 20 个 token，那样正文是空的 ✗
      const r = await 问模型(ctx, agent, '你只要回两个字：通了。', '测试一下', 300)
      const ms = Date.now() - t0
      diag('llm-check：' + JSON.stringify(r).slice(0, 160) + '（' + ms + 'ms）')
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(Object.assign({ ms: ms }, r)))
    })

    // 给记忆扩词 —— 一次一批，界面循环调它，显示进度 ✓
    mroute('/dsh-clay-memory/expand', async (req, res) => {
      const b = await 读JSON体(req)
      const sid = String(b.session || '')
      const 每批 = Math.max(1, Math.min(20, Number(b.每批) || 8))
      // ⭐ 1.5.0：可以只扩指定的几条（`ids`）—— 「记完一条顺手给它补检索词」用得上。
      //   指定时**不看它有没有 related**（哪怕是重扩），也不受「只扩没扩过的」限制 ✓
      const 指定 = Array.isArray(b.ids) ? b.ids.map((x) => String(x)).filter(Boolean) : []
      let out = { ok: false, message: '没找到会话' }
      try {
        const data = loadStore(sid)
        const 坟 = new Set(((data.deleted || []).map((m) => String(m && m.id))))
        const 限批 = typeof b.批次 === 'string' ? b.批次.trim() : ''
        const 要扩 = 指定.length
          ? (data.memories || []).filter((m) => m && 指定.includes(String(m.id)) && !坟.has(String(m.id)))
          : (data.memories || []).filter(
              (m) =>
                (!Array.isArray(m.related) || !m.related.length) &&
                !m.expandSkip &&
                (!限批 || String(m.importBatch || '') === 限批),
            )
        if (!要扩.length) {
          out = { ok: true, done: true, 改了: 0, 剩: 0, 总数: data.memories.length }
        } else {
          const 批 = 要扩.slice(0, 每批)
          // GPT 整改 P1（字段级 CAS）：LLM 前拍 related 快照，回来逐条比对 ——
          //   等模型那几秒里 related 被外部（自动扩词、别的批量路由）写过的，不得覆盖。
          const 快照 = 拍一批(批, ['related', 'relatedAt', 'expandTries', 'expandSkip', 'expandFailed'])
          const agent = ctx.agents.get(sid) || (ctx.agents.list() || [])[0]
          const 输入 = 批.map((m, i) => i + 1 + '|' + String(m.text || '')).join('\n')
          const t0 = Date.now()
          // ⚠ 预算要给够：模型会先「思考」，思考的 token 也算在里面。
          //   实测 6 条的时候：**正文 167 字，思考 2912 字**（思考是答案的 17 倍）——
          //   原来只给 900，连思考都不够，正文永远是空的，
          //   表现就是「连着几批没回可用的词，自己停了」✗（2026-09-20 踩到）
          const r = await 问模型(ctx, agent, 扩词系统_v2, 输入, 6000)
          const ms = Date.now() - t0
          if (!r.ok) {
            out = { ok: false, message: r.message, 剩: 要扩.length, provider: r.provider, model: r.model, ms: ms }
          } else {
            const 表 = 解析扩词(r.text, 批.length)
            // ⭐ B 阶段（2026-10-30）：await 之后重新读库、按 id 改 ——
            //   旧代码拿快照 data 整份写回，等模型那几秒里的新增会被盖掉
            //   （2026-10-24 自动扩词同款「记忆静默丢失」）。照抄自动扩词那套。
            const 目标ids = 批.map((m) => String(m.id))
            const 新库 = loadStore(sid)
            if (!代际一致(data, 新库)) {
              diag('扩词：' + sid + ' 等模型这中间整库被清过，丢弃这批结果')
              out = { ok: false, message: '记忆库刚被清理过，这批结果作废', 剩: 要扩.length, provider: r.provider, model: r.model, ms: ms }
            } else {
            let 改了 = 0
            let 字段冲突 = 0
            // ⭐ 1.8.0：模型对某条一直不给词时，不能让它害前端无限循环 ——
            //   每条记「试过几次」，满 2 次标 expandSkip，以后不再挑它。
            const 最多试 = 2
            const now = new Date().toISOString()
            for (let i = 0; i < 批.length; i++) {
              const m = (新库.memories || []).find((x) => x && String(x.id) === 目标ids[i])
              if (m && m.别记) continue // 中间被标「别记」→ 跳过（审查 B6）
              if (!m) continue // 这中间被删 / 被合 → 跳过，别硬写
              const 旧 = 快照.get(目标ids[i])
              if (!旧) continue
              const 词 = 表[i]
              if (!没动过(m, 旧, 'related')) { 字段冲突++; continue } // GPT 整改 P1：中间别人扩过 → 不覆盖不计数
              if (Array.isArray(词) && 词.length) {
                m.related = 词
                m.relatedAt = now
                改了++
              } else {
                m.expandTries = (Number(m.expandTries) || 0) + 1
                if (m.expandTries >= 最多试) {
                  m.expandSkip = true
                  m.expandFailed = true
                }
              }
            }
            // 成功与否都要落盘：成功的词要存，失败次数也要存（否则永远重来）
            if (批.length) saveStore(sid, 新库)
            const 剩 = 要扩.length - 改了
            diag('扩词：' + sid + ' 这批 ' + 批.length + ' 条，成功 ' + 改了 + ' 条，字段冲突 ' + 字段冲突 + '，还剩 ' + 剩 + '（' + ms + 'ms，' + r.provider + '/' + r.model + '）')
            out = {
              ok: true,
              done: 剩 <= 0,
              改了: 改了,
              字段冲突: 字段冲突,
              // 模型一个字都没回出来（多半是思考吃光预算被截断）——
              // 让界面能说清楚原因，而不是干巴巴「没回可用的词」✓
              没解析出来: 改了 === 0 ? 批.length : 0,
              剩: 剩,
              总数: (新库.memories || []).length,
              provider: r.provider,
              model: r.model,
              ms: ms,
              示例: 目标ids.slice(0, 3).map((id) => (新库.memories || []).find((x) => x && String(x.id) === id)).filter(Boolean).map((m) => ({ text: m.text, related: m.related || null })),
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

    mroute('/dsh-clay-memory/policy', async (req, res) => {
      const patch0 = await 读JSON体(req)
      let patch = patch0
      try {
        if (!patch || typeof patch !== 'object') patch = {}
      } catch (error) { patch = {} }
      // 恢复默认：直接把整份默认值当补丁送进 fitPolicy ✓
      if (patch && patch.reset === true) patch = { ...DEFAULT_POLICY }
      // pin = 她刚改的那一项，钉住它让其余三项让位 ✓
      const pin = patch && typeof patch.pin === 'string' ? patch.pin : null
      let n = 0
      let saved = null
      let notes = []
      // ⭐ 1.2.7：**先写全局** —— 这样哪怕一个记忆库都没有，参数也存得住
      try {
        const c = loadCfg()
        const r0 = fitPolicy(patch, { ...DEFAULT_POLICY, ...(c.policy || {}) }, pin)
        c.policy = r0.policy
        saveCfg(c)
        saved = r0.policy
        notes = r0.notes
      } catch (error) {}
      try {
        let files = []
        try { files = readdirSync(STORE_DIR) }
        catch (error) { if (error.code !== 'ENOENT') throw error }
        for (const fn of files) {
          if (!是会话文件(fn)) continue
          const sid = fn.replace(/\.json$/, '')
          const data = loadStore(sid)
          const r = fitPolicy(patch, data.policy, pin)
          data.policy = r.policy
          saveStore(sid, data)
          saved = r.policy
          notes = r.notes
          n++
        }
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, changed: n, error: String(error && error.message || error) }))
        return
      }
      if (!saved) {
        const r = fitPolicy(patch, DEFAULT_POLICY, pin)
        saved = r.policy
        notes = r.notes
      }
      diag('policy 改了 ' + n + ' 个库：' + JSON.stringify(saved) + (notes.length ? ' ｜ ' + notes.join('；') : ''))
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, changed: n, policy: saved, notes }))
    })
}
