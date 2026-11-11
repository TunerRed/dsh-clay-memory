// 备份（.bak + 每天一份 + 销毁前另存）、批量批次戳、会话暂停 —— 2026-10-30 从 index.js 抽出（拆层工程第 6b 批）
// 依赖注入：报 = 诊断日志，由 index.js 注入。
import { existsSync, mkdirSync, copyFileSync, readdirSync, rmSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { STORE_DIR, BACKUP_DIR, storePath, factPath } from './paths.mjs'
import { TZ_OFFSET } from './time.mjs'
import { 清理旧备份 } from './backup-rotate.mjs'
import { writeFileAtomicSync } from './atomic-file.mjs'

let 报 = null
/** index.js 在 import 后调用：注入诊断日志函数 */
export function 接报信(fn) { if (typeof fn === 'function') 报 = fn }

// ---------- 备份（记忆变了才备，不然每轮写 trace 会堆一堆）----------

function todayKey() {
  return new Date(Date.now() + TZ_OFFSET).toISOString().slice(0, 10)
}

// 记忆的指纹：加一条 / 删一条 / 改一条 都会变 ✓
function memSig(memories) {
  let h = 0
  for (const m of memories || []) {
    const s = String(m.id) + '|' + String(m.text) + '|' + String(m.at) + '|' + String(m.importance) + '|' + String(m.category)
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return (memories || []).length + ':' + h
}

// 单条记忆的稳定签名（1.4.0）。用来判断「会话库里的旧事实副本」还是不是**权威事实的原文**：
//   · 一样 → 留着（迁移时故意保留了原库副本，回退到 1.3.7 还能读到）
//   · 事实改过 / 删了 / 彻底清了 → 副本跟着这次写入消失（否则 purge 之后它会原文复活 ✗）
function 条签名(m) {
  return [m && m.id, m && m.text, m && m.at, m && m.importance, m && m.category]
    .map((v) => String(v)).join('|')
}

const lastSig = new Map()

// ⭐⭐ 2026-09-23（真出过一次事）：**「清空」是真销毁，得另存一份** ——
//   那天把「已删掉的」清空，连同刚合掉的 157 条一起没了。
//   而常规的两道备份都指望不上：
//     `.bak`     只留**最后一次改动前**那一版（清空之后又被下一次写入覆盖了）
//     每天那份   只留**当天最早**那一版
//   最后是靠「每天那份」正好是当天最早，才整条救回来 ✗（运气好而已）
//   → 凡是**真销毁**的动作（清空、批量清掉），动之前**另存一份带时间戳的**，
//     放在 `clay-memory\销毁前\` 里，只留最近 20 份 ✓
function 销毁前另存(sid) {
  try {
    // ⚠ 1.4.0：双层库 → 会话库和全局事实库都要另存。
    //   清空「已删」这件事在两边都可能发生（事实的墓碑在 _facts.json 里）。
    const 源们 = [storePath(sid), factPath()].filter((p) => existsSync(p))
    if (!源们.length) return
    const dir = join(STORE_DIR, '销毁前')
    mkdirSync(dir, { recursive: true })
    // ⚠⚠ 时间戳要**到毫秒** —— 第一版只到秒，自检里连着清 25 次
    //   全落在同一秒 → **文件名一样、互相覆盖**，最后只剩 1 份 ✗
    //   （自检逮到的。真出事的时候正好是连着点几下，就会踩这个）
    const ts = new Date(Date.now() + TZ_OFFSET).toISOString().replace(/[:.]/g, '-').slice(0, 23)
    for (const src of 源们) {
      const 前缀 = basename(src).replace(/\.json$/, '')
      const 头 = 前缀 + '·' + ts
      let 名 = 头 + '.json'
      for (let i = 2; existsSync(join(dir, 名)); i++) 名 = 头 + '·' + i + '.json' // 撞了就加序号，绝不覆盖 ✓
      copyFileSync(src, join(dir, 名))
      // ⚠ 20 份的额度要**按库名分开数**：混在一起排，`_facts·…` 一直排在最前面
      //   （`_` 的码位小于字母），最先被砍光的正是事实 —— 那才是最难重建的东西 ✗
      const 我家的 = readdirSync(dir).filter((f) => f.endsWith('.json') && f.startsWith(前缀 + '·')).sort()
      for (const f of 我家的.slice(0, Math.max(0, 我家的.length - 20))) {
        try {
          rmSync(join(dir, f), { force: true })
        } catch (error) {}
      }
      报('销毁前另存：' + 名)
    }
  } catch (error) {}
}

// 备份**单份文件**（会话库 / 全局事实库通用）。1.3.7 只认会话库那一个路径。
function backupFile(src) {
  if (!existsSync(src)) return
  // ① 上一版（永远只有一份，最近一次改动前）
  try {
    copyFileSync(src, src + '.bak')
  } catch (error) {}
  // ② 每天一份（存当天最早的那一版）
  const dir = join(BACKUP_DIR, todayKey())
  mkdirSync(dir, { recursive: true })
  const dst = join(dir, basename(src))
  if (!existsSync(dst)) copyFileSync(src, dst)
  // ③ 按备份自身时间清理：只砍真过期的；新鲜不足 7 份时保底留最近 7 份；
  //    真要砍之前先校验「将保留的」可解析，有坏文件这次就不砍（D-11）
  const 清 = 清理旧备份(BACKUP_DIR, todayKey(), {})
  if (清.跳过) 报('每日备份清理跳过：' + 清.跳过)
}

// 两份库各自备份（某一侧不存在就跳过 —— 新装环境的事实库一开始还没有）
function backupStore(sid) {
  for (const src of [storePath(sid), factPath()]) {
    try {
      backupFile(src)
    } catch (error) {}
  }
}

// ⭐ 1.6.16（用户：「把需要修补的地方都做了」）：**批量操作要能撤**
//   补日期 / 补类型 / 补标 这些跑一次会改动几十上百条，改错了以前只能从 .bak 手工拼回来
//   （2026-10-29 凌晨补标把事实库 47 → 43 就是这么救的）。
//   现在每次批量写库前在库上盖一个「最近一批」的戳，`/undo-last` 认这个戳 + 时间窗才允许回滚。
//   ⚠ 只认**批量**，普通改一条不加戳 —— 免得误点撤销把刚记的那条也回退掉
// ⚠ 文件名必须带 `_` 前缀 —— `是会话文件()` 会把 STORE_DIR 里所有 .json 当会话库，
//   不带下划线的话 /all 会多扫出一个「last-batch 会话」，会话数也跟着涨 ✗
const BATCH_MARK = join(STORE_DIR, '_last-batch.json')
function 读批次表() {
  // ⚠ 不能用 读一份() —— 它会把任何文件规范化成记忆库结构（未知字段全丢），
  //   这个文件只是个小 map（sid → { at, kind }），原样 JSON.parse 就行
  try {
    if (!existsSync(BATCH_MARK)) return {}
    const v = JSON.parse(readFileSync(BATCH_MARK, 'utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch (error) {
    return {}
  }
}
// ---------- ⭐ B 轮 F4（2026-10-29）：本会话暂停「先别记」 ----------
// 状态单独一个文件。不塞记忆库的原因：saveStore 只写固定几个字段，
// 库顶层随手加的字段会被静默丢掉（1.6.16 的批次戳就丢过一次）。
const PAUSE_FILE = join(STORE_DIR, '_paused.json')

function 读暂停表() {
  try {
    const j = JSON.parse(readFileSync(PAUSE_FILE, 'utf8'))
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {}
  } catch (error) {
    return {}
  }
}

function 暂停到(sid) {
  const t = 读暂停表()[String(sid || '')]
  const v = t ? Date.parse(t) : 0
  return isFinite(v) && v > 0 ? v : 0
}

// 返回设了多少分钟（0 = 取消暂停）
function 设暂停(sid, 分钟) {
  const key = String(sid || '')
  if (!key) throw new Error('没有会话')
  const 表 = 读暂停表()
  const 分 = Math.max(0, Math.min(24 * 60, Math.round(Number(分钟) || 0)))
  if (分 <= 0) delete 表[key]
  else 表[key] = new Date(Date.now() + 分 * 60000).toISOString()
  try {
    writeFileAtomicSync(PAUSE_FILE, JSON.stringify(表, null, 2))
  } catch (error) {
    报('设暂停写文件失败：' + (error && error.message))
  }
  return 分
}

function 记批次(sid, kind, 改动) {
  if (!sid) return
  try {
    mkdirSync(STORE_DIR, { recursive: true })
    const 表 = 读批次表()
    // 1.8.29：带改动明细（[{id, 旧:{字段:旧值}, 新:{字段:新值}}]）——
    //   undo-last 优先字段级恢复，只动本批次碰过的字段，别把窗口里别人的改动也回掉。
    表[String(sid)] = { at: new Date().toISOString(), kind: String(kind || '') }
    if (Array.isArray(改动)) 表[String(sid)].改动 = 改动.slice(0, 2000)
    writeFileAtomicSync(BATCH_MARK, JSON.stringify(表, null, 2))
  } catch (error) {
    报('记批次失败：' + ((error && error.message) || error))
  }
}

export { todayKey, memSig, 条签名, lastSig, 销毁前另存, backupFile, backupStore, 读批次表, 读暂停表, 暂停到, 设暂停, 记批次 }
