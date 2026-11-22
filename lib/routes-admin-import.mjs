// 管理路由 · 旧档案扫描 / 导入 / 批次撤销
import { join, basename } from 'node:path'
import { archiveDir, selfNameOf, 导入时改人称, 用户名字列表, 解析档案 } from './names.mjs'
import { 像度, 词集 } from './scoring.mjs'
import { 标trace状态 } from './trace-log.mjs'
import { loadStore, saveStore } from './store-core.mjs'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { diag } from './diag.mjs'

export function 注册导入路由(mroute, 环) {
  const { 读JSON体, 路径在允许范围 } = 环

    // 单文件扫描（1.8.0）：只读导出的那一份 .md，拆成候选条目
    // ⭐ 1.8.0（用户：「选 markdown 调用系统的文件浏览器就行」）
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
}
