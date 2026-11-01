#!/usr/bin/env node
// ============================================================================
// dsh-clay-memory 1.3.7 → 1.4.0「双层记忆」迁移工具
// ----------------------------------------------------------------------------
// 1.3.7 把**所有**记忆都存进 `<DSH_HOME>/clay-memory/<会话id>.json`。
// 1.4.0 起拆成两层：
//     `_facts.json`   全局事实（category === 'stable_profile'）· 跨工作区 / 跨会话共享
//     `<会话id>.json` 事件 + 召回记录 + 已删 + 库级参数（各是各的）
// 升级之后**事实读不到了**（还躺在各自的会话库里）—— 这个脚本就是把它们搬过去。
//
// 规矩（照方案定的）：
//   · **默认只读（dry-run）**，什么盘面都不动；要真搬必须显式 `--apply`
//   · **不删原库副本** —— 迁移完会话库里的那几条事实**原样留着**
//     （`--purge` 才删；旧版回退时那份就是命）
//   · 动盘之前先把整个 clay-memory 目录拷一份到 `clay-memory-backup/<时间戳>/`
//   · 可重跑（幂等）：按 id + 归一化文本去重，第二次跑只会报 0 条新增
//   · 只搬**还在用**的事实；各会话里「已软删」的事实不动（那属于某个会话的选择，
//     搬到全局库会让它在所有会话里一起消失）
//
// 用法：
//   node tools/migrate-facts.mjs                       # 看一眼，什么都不改
//   node tools/migrate-facts.mjs --apply               # 真搬（会话库里的副本留着）
//   node tools/migrate-facts.mjs --apply --purge       # 搬完把会话库里的副本删掉
//   node tools/migrate-facts.mjs --home G:\tmp\home\.dsh --apply
//   node tools/migrate-facts.mjs --apply --force       # 标记说搬过了也再扫一遍
//
// 退出码：0 成功（含 dry-run）/ 1 出错
// ============================================================================
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, renameSync, statSync, rmSync, openSync, fsyncSync, closeSync, unlinkSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
// 合并逻辑**复用插件自己那份**（纯函数、不摸盘），别在这儿另写一套口径
import { 合并库 } from '../lib/store-merge.mjs'

const FACTS_NAME = '_facts.json'
const MARK_NAME = '_facts.migration.json' // 迁移标记：插件永远不碰这个文件（`_` 开头也不算会话库）

// ---------- 参数 ----------
const 参 = { apply: false, purge: false, force: false, home: null, help: false }
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a === '--apply') 参.apply = true
  else if (a === '--dry-run' || a === '--dry' || a === '-n') 参.apply = false
  else if (a === '--purge') 参.purge = true
  else if (a === '--force') 参.force = true
  else if (a === '--home' || a === '--dsh-home') 参.home = process.argv[++i] || null
  else if (a === '--help' || a === '-h') 参.help = true
  else if (a.startsWith('--home=')) 参.home = a.slice(7)
  else {
    console.error('不认识的参数：' + a)
    console.error('用 --help 看用法')
    process.exit(1)
  }
}

if (参.help) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 34).map((s) => s.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(0)
}

const CFG_DIR = 参.home || process.env.DSH_HOME || join(homedir(), '.dsh')
const STORE_DIR = join(CFG_DIR, 'clay-memory')
const BACKUP_DIR = join(CFG_DIR, 'clay-memory-backup')
const FACT_PATH = join(STORE_DIR, FACTS_NAME)
const MARK_PATH = join(STORE_DIR, MARK_NAME)

const 说 = (s) => console.log(s)
const 叹 = (s) => console.error(s)
const 行 = (s) => 说('  ' + s)

// ---------- 小工具 ----------

// 归一化文本：全角/半角、大小写、多余空白都不该让同一条事实被当成两条
const 归一 = (s) => String(s || '').normalize('NFKC').replace(/[\s\u200b\u200c\u200d\ufeff]+/g, ' ').trim().toLowerCase()

// 「这一条什么时候动过」—— 跟 lib/store-merge.mjs 里同一个口径（那边是私有的，抄一份保持独立）
const 更新时间 = (m) => Math.max(
  Date.parse((m && m.editedAt) || 0) || 0,
  Date.parse((m && m.relatedAt) || 0) || 0,
  Date.parse((m && m.reinforcedAt) || 0) || 0,
  Date.parse((m && m.deletedAt) || 0) || 0,
  Date.parse((m && m.createdAt) || 0) || 0,
)

const 是会话文件 = (fn) => typeof fn === 'string' && fn.endsWith('.json') && fn.charAt(0) !== '_'

function 读json(path) {
  const 字节 = readFileSync(path)
  let 文 = 字节.toString('utf8')
  if (文.charCodeAt(0) === 0xfeff) 文 = 文.slice(1) // 带 BOM 的也认
  return JSON.parse(文)
}

// 原子写：同目录 staging → fsync → rename（跟插件 lib/atomic-file.mjs 一个套路，
// 但这里刻意不 import —— 免得迁移脚本跟插件的内部结构绑死）
function 写原子(path, 文) {
  const tmp = join(dirname(path), '.' + basename(path) + '.tmp-' + process.pid)
  let fd = null
  try {
    fd = openSync(tmp, 'w')
    writeFileSync(fd, 文)
    try { fsyncSync(fd) } catch (error) {}
    closeSync(fd)
    fd = null
    renameSync(tmp, path)
  } catch (error) {
    try { if (fd !== null) closeSync(fd) } catch (error2) {}
    try { unlinkSync(tmp) } catch (error2) {}
    throw error
  }
}

const 备份时刻 = new Date().toISOString().replace(/[:.]/g, '-')

// ---------- 开跑 ----------
if (!existsSync(STORE_DIR)) {
  叹('记忆库目录不存在：' + STORE_DIR)
  叹('（DSH_HOME 指错了？用 --home <DSH_HOME> 明确指一下）')
  process.exit(1)
}

说('')
说('dsh-clay-memory 双层记忆迁移（1.3.7 → 1.4.0）')
说('  DSH_HOME   ' + CFG_DIR)
说('  记忆库     ' + STORE_DIR)
说('  全局事实库 ' + FACT_PATH)
说('  模式       ' + (参.apply ? (参.purge ? 'APPLY + PURGE（会删会话库里的副本）' : 'APPLY（会话库副本保留）') : 'DRY-RUN（只读，什么都不改）'))
说('')

let 会话文件们 = []
try {
  会话文件们 = readdirSync(STORE_DIR).filter(是会话文件).sort()
} catch (error) {
  叹('读不了记忆库目录：' + (error && error.message))
  process.exit(1)
}

const 标记 = existsSync(MARK_PATH) ? (() => { try { return 读json(MARK_PATH) } catch (error) { return null } })() : null
if (标记 && !参.force) {
  说('这个 DSH_HOME 已经迁移过了：' + (标记.at || '（没记时间）') + '（当时新增 ' + (标记.added ?? '?') + ' 条）')
  说('  · 想再扫一遍（比如回退过旧版、又产生了新的事实）：加 --force')
  说('  · 迁移本身是幂等的，重跑只会报「去重 / 跳过」，不会重复新增')
  process.exit(0)
}

// ---------- 1. 读现有的全局事实库 ----------
let 事实盘 = null
if (existsSync(FACT_PATH)) {
  try {
    事实盘 = 读json(FACT_PATH)
  } catch (error) {
    叹('全局事实库读不了（坏 JSON？）：' + FACT_PATH)
    叹('  ' + (error && error.message))
    叹('先手工处理它，或者把它挪走再跑 —— 这个脚本不会覆盖看不懂的库。')
    process.exit(1)
  }
}
const 已有 = {
  version: 2,
  purgeEpoch: typeof (事实盘 && 事实盘.purgeEpoch) === 'string' ? 事实盘.purgeEpoch : '',
  policy: (事实盘 && 事实盘.policy) || {},
  memories: Array.isArray(事实盘 && 事实盘.memories) ? 事实盘.memories : [],
  traces: [],
  deleted: Array.isArray(事实盘 && 事实盘.deleted) ? 事实盘.deleted : [],
}
const 已有id = new Set(已有.memories.map((m) => String(m && m.id)))
const 坟id = new Set(已有.deleted.map((m) => String(m && m.id)))
const 已有文 = new Map() // 归一化文本 → 事实库里那条
for (const m of 已有.memories) 已有文.set(归一(m && m.text), m)

// ---------- 2. 扫会话库，挑出事实 ----------
const 要进 = [] // 搬进全局库的事实（保留原 id）
const 见文 = new Map() // 这一轮里按文本去重（多个会话里同一条事实很常见）
const 处理 = [] // 每个会话的账
let 跳过已迁移 = 0
let 跳过已删 = 0
let 跳过软删 = 0
let 跳过坏库 = 0
let 去重命中 = 0
let 去重更新 = 0
const 会话改动 = new Map() // sid → { path, data, 搬走的 id 们 }

for (const fn of 会话文件们) {
  const path = join(STORE_DIR, fn)
  let data = null
  try {
    data = 读json(path)
  } catch (error) {
    跳过坏库++
    叹('！跳过（读不了）：' + fn + ' —— ' + (error && error.message))
    continue
  }
  const 记忆们 = Array.isArray(data && data.memories) ? data.memories : []
  const 事实们 = 记忆们.filter((m) => m && m.category === 'stable_profile')
  // ⚠ 每个会话里「已软删」的事实不搬：那是**这个会话**的选择，
  //   搬到全局库等于让它在所有工作区一起消失（比不搬更糟）
  const 软删id = new Set((Array.isArray(data && data.deleted) ? data.deleted : []).map((m) => String(m && m.id)))
  let 本会话搬 = 0
  const 搬走的id = []
  for (const m of 事实们) {
    const id = String(m.id)
    if (软删id.has(id)) { 跳过软删++; continue }
    if (坟id.has(id)) { 跳过已删++; continue } // 全局库里已经删掉了这条，别复活
    if (已有id.has(id)) { 跳过已迁移++; 搬走的id.push(id); continue } // 上次搬过 / 插件已经写过
    const 文 = 归一(m.text)
    if (!文) { 跳过软删++; continue } // 空文本没法去重，也不值得进全局库
    const 另有 = 已有文.get(文) || 见文.get(文)
    if (另有) {
      // 去重：同一条事实已经进了全局库（或本轮先被别的会话搬过去了）。
      // 「更新的那份赢」—— 但 **id 用先到的那个**，别让同一条事实在全局库里换 id。
      去重命中++
      if (更新时间(m) > 更新时间(另有)) {
        去重更新++
        for (const k of ['text', 'at', 'importance', 'createdAt', 'editedAt', 'relatedAt', 'reinforcedAt', 'source', '事实键', '键来源']) {
          if (m[k] !== undefined) 另有[k] = m[k]
        }
      }
      搬走的id.push(id)
      continue
    }
    已有文.set(文, m)
    见文.set(文, m)
    要进.push(m)
    搬走的id.push(id)
    本会话搬++
  }
  处理.push({ fn, 事实: 事实们.length, 软删: 事实们.filter((m) => 软删id.has(String(m.id))).length, 新增: 本会话搬 })
  if (搬走的id.length) 会话改动.set(fn, { path, data, 搬走的id })
}

const 软删总数 = 处理.reduce((s, x) => s + x.软删, 0)

// ---------- 3. 报告 ----------
说('会话库 ' + 会话文件们.length + ' 个（读不了 ' + 跳过坏库 + ' 个），里面的事实：')
const 有事实的 = 处理.filter((x) => x.事实 > 0)
if (!有事实的.length) 行('（一个都没有 —— 本来就没有稳定事实，不用迁）')
for (const x of 有事实的) {
  行(x.fn.padEnd(30) + ' 事实 ' + String(x.事实).padStart(4) + ' 条 · 本次新增 ' + String(x.新增).padStart(4) + ' 条' + (x.软删 ? ' · 软删跳过 ' + x.软删 : ''))
}
说('')
说('结果：')
行('新增进全局库    ' + 要进.length + ' 条')
行('去重（同文已有）' + 去重命中 + ' 条' + (去重更新 ? '（其中 ' + 去重更新 + ' 条内容更新过）' : ''))
行('跳过·已迁移过   ' + 跳过已迁移 + ' 条')
行('跳过·全局库已删 ' + 跳过已删 + ' 条')
行('跳过·会话内软删 ' + 跳过软删 + ' 条' + (软删总数 === 跳过软删 ? '' : '（另有 ' + (软删总数 - 跳过软删) + ' 条空文本）'))
行('迁移后全局事实  ' + (已有.memories.length + 要进.length) + ' 条（原 ' + 已有.memories.length + ' 条）')
说('')

if (!参.apply) {
  说('DRY-RUN：**一个字节都没写**。')
  说('要真搬：node tools/migrate-facts.mjs' + (参.home ? ' --home ' + 参.home : '') + ' --apply')
  if (参.purge) 说('（--purge 在 dry-run 下不生效：先看报告，确认了再 --apply --purge）')
  process.exit(0)
}

const 要动事实 = 要进.length > 0 || !existsSync(FACT_PATH)
const 要动会话 = 参.purge && 会话改动.size > 0
let 备份目录 = ''
let 清掉 = 0

// 标记：插件永远不碰这个文件；有了它，之后再跑就不用白扫一遍（--force 除外）
function 写标记() {
  try {
    mkdirSync(STORE_DIR, { recursive: true })
    写原子(MARK_PATH, JSON.stringify({
      version: 1,
      at: new Date().toISOString(),
      tool: 'migrate-facts.mjs',
      plugin: '1.4.0',
      added: 要进.length,
      deduped: 去重命中,
      dedupedUpdated: 去重更新,
      skippedMigrated: 跳过已迁移,
      skippedGloballyDeleted: 跳过已删,
      skippedSoftDeleted: 跳过软删,
      purged: 清掉,
      backup: 备份目录,
    }, null, 2))
  } catch (error) {
    叹('写迁移标记失败（不影响已搬的数据）：' + (error && error.message))
  }
}

if (!要动事实 && !要动会话) {
  说('没有要搬的，也不删副本 —— 不写盘、不备份。')
  写标记()
  process.exit(0)
}

// ---------- 4. 备份整个记忆库目录（要动盘了）----------
备份目录 = join(BACKUP_DIR, 备份时刻)
try {
  mkdirSync(备份目录, { recursive: true })
  let 份数 = 0
  for (const fn of readdirSync(STORE_DIR)) {
    const src = join(STORE_DIR, fn)
    try {
      if (!statSync(src).isFile()) continue // 子目录（销毁前/）不拷，那边本来就是备份
    } catch (error) { continue }
    copyFileSync(src, join(备份目录, fn))
    份数++
  }
  说('已备份 ' + 份数 + ' 个文件 → ' + 备份目录)
} catch (error) {
  叹('备份失败，**没有动任何库文件**：' + (error && error.message))
  process.exit(1)
}

// ---------- 5. 写全局事实库 ----------
if (要动事实) {
  // 复用插件的合并口径：按 id 取并集、更新时间新的赢、被墓碑删掉的不会被捡回来
  const 合 = 合并库(已有, { memories: 要进, deleted: [], traces: [], policy: 已有.policy })
  const 写盘 = {
    version: 2,
    purgeEpoch: 已有.purgeEpoch || randomUUID(), // 新建才给代际；已有的**不动**（别把在飞的任务全判死）
    policy: 合.policy || 已有.policy,
    memories: 合.memories,
    traces: [],
    deleted: 合.deleted,
  }
  try {
    写原子(FACT_PATH, JSON.stringify(写盘, null, 2))
  } catch (error) {
    叹('写全局事实库失败（会话库一个字都没动，事实库也没动）：' + (error && error.message))
    叹('备份在：' + 备份目录)
    process.exit(1)
  }
  // 读回来核对 —— 「改完必须读回原文核对」，别凭写的时候以为成功
  const 复核 = 读json(FACT_PATH)
  const 复核id = new Set((Array.isArray(复核.memories) ? 复核.memories : []).map((m) => String(m && m.id)))
  const 漏 = 写盘.memories.filter((m) => !复核id.has(String(m && m.id)))
  if (漏.length) {
    叹('❗核对失败：写下去 ' + 写盘.memories.length + ' 条，读回来少 ' + 漏.length + ' 条')
    叹('  用备份恢复：' + 备份目录)
    process.exit(1)
  }
  说('全局事实库已写：' + FACT_PATH + '（' + 复核.memories.length + ' 条，读回核对通过）')
} else {
  说('全局事实库没有要新增的，跳过写入')
}

// ---------- 6. --purge：把会话库里的副本删掉（默认不删）----------
if (参.purge) {
  // 只删「确实已经在全局库里」的那些 id —— 删之前先读一遍，别凭内存
  let 事实id = new Set()
  try {
    事实id = new Set((读json(FACT_PATH).memories || []).map((m) => String(m && m.id)))
  } catch (error) {
    叹('读不了全局事实库，不做 purge：' + (error && error.message))
    process.exit(1)
  }
  for (const [fn, 改] of 会话改动) {
    const 留 = (改.data.memories || []).filter((m) => !事实id.has(String(m && m.id)))
    const 删几条 = (改.data.memories || []).length - 留.length
    if (!删几条) continue
    const 新 = { ...改.data, version: 2, memories: 留 }
    try {
      写原子(改.path, JSON.stringify(新, null, 2))
      清掉 += 删几条
    } catch (error) {
      叹('！清副本失败（原文件没动）：' + fn + ' —— ' + (error && error.message))
    }
  }
  说('会话库里的副本已清掉 ' + 清掉 + ' 条（.bak 和整目录备份都还在）')
}

// ---------- 7. 标记 ----------
写标记()

说('')
说('完成 ✓  备份：' + 备份目录)
说('  回退办法：把备份里的文件拷回 ' + STORE_DIR + '（并删掉 ' + MARK_NAME + '）')
