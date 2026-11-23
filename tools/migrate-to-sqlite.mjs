// C 轮 S1：把 JSON 库迁进 SQLite（最小可验证 schema）
//   出口标准：从 SQLite 读回来的读视图，与 loadStore 合并后的视图全等
//   （id 集合 + 顺序 + 关键字段），不是逐源文件比对 —— 合并里有去重、丢弃会话侧事实副本、墓碑并集。
//
// 用法（在开发目录下）：
//   node tools/migrate-to-sqlite.mjs                 # dry-run，只报告
//   node tools/migrate-to-sqlite.mjs --apply         # 真写库
//   node tools/migrate-to-sqlite.mjs --apply --force # 库已存在也重建（先备份成 .bak-<时间>）
//
// 幂等：库已存在且行数一致 → 直接跳过（退出码 0）；不一致 → 报错（退出码 2），不偷偷覆盖。
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
// 杂项/推理的打包口径与插件写路径**共用同一份实现** —— 以前这里抄了一份白名单，
// 2026-11-23 实测三处手同步漏了 7 个字段（expireAt / fromSession / 合并自 …）。
import { 打包杂项, 打包推理 } from '../lib/store-core.mjs'
import { 工作区文件id } from '../lib/paths.mjs'

const HOME = process.env.CLAY_HOME || path.join(process.env.DSH_HOME || '', 'clay-memory')
const DB_PATH = path.join(HOME, 'clay-memory.db')
const FACTS = path.join(HOME, '_facts.json')

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const FORCE = args.includes('--force')

function 读JSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch (error) {
    return null
  }
}

const NL = String.fromCharCode(10)
function 事实文(m) {
  return String((m && m.text) || '')
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\uFEFF]/g, '')
    .trim()
    .toLowerCase()
}

function 是会话文件(fn) {
  return fn.endsWith('.json') && fn.charAt(0) !== '_' && !fn.includes('.bak')
}

// ── 1. 读全部源（等价于 loadStore 的合并，只是把每个会话的视图都算出来）
if (!fs.existsSync(HOME)) {
  console.error('找不到库目录：' + HOME)
  process.exit(1)
}
const 事实盘 = 读JSON(FACTS) || { memories: [], deleted: [] }
const 会话文件们 = fs.readdirSync(HOME).filter(是会话文件).sort()
const 会话盘们 = []
for (const fn of 会话文件们) {
  const sid = fn.replace(/\.json$/, '')
  const 盘 = 读JSON(path.join(HOME, fn)) || { memories: [], deleted: [] }
  会话盘们.push({ sid, 盘 })
}

// 事实库去重（按 id + 事实文）
const 事实们 = []
const 见过id = new Set()
const 见过文 = new Map()
for (const m of 事实盘.memories || []) {
  if (!m || !m.id) continue
  const id = String(m.id)
  if (见过id.has(id)) continue
  if (m.category === 'stable_profile') {
    const 文 = 事实文(m)
    const 旧 = 见过文.get(文)
    if (旧) {
      // 同文换 id：保留先出现的那条（跟 loadStore 一致）
      continue
    }
    见过文.set(文, m)
  }
  见过id.add(id)
  事实们.push({ m, sid: '' })
}

// 工作区库：`_ws-*.json` 单独读（是会话文件 会排除 `_` 前缀文件）。
// ⭐ 2026-11-23：以前这里只迁「事实 + 会话」两层，工作区层的条目**整层没进镜像**
//   —— 测试库实测 session 视图 568 条 / 镜像 567 条，差的正是工作区那一条；
//   读切之后工作区记忆会凭空消失。wsRoot 优先取文件里的字段，老文件没有则从文件名反推。
const 工区盘们 = []
for (const fn of fs.readdirSync(HOME).filter((f) => f.startsWith('_ws-') && f.endsWith('.json'))) {
  const 盘 = 读JSON(path.join(HOME, fn)) || { memories: [], deleted: [] }
  const 根 = typeof 盘.wsRoot === 'string' && 盘.wsRoot ? 盘.wsRoot : 工作区文件id(fn)
  if (!根) continue
  工区盘们.push({ sid: 根, 盘 })
}

// 每个会话：事实（跳过已见）+ 本会话事件
// ⚠ 层次顺序必须跟读视图的 order by（global → workspace → session）一致，否则 ord 一乱、顺序全等就假红。
const 全 = []
let ord = 0
for (const { m } of 事实们) {
  全.push({ m, scope: 'global', sid: '', ord: ord++ })
}
for (const { sid, 盘 } of 工区盘们) {
  for (const m of 盘.memories || []) {
    if (!m || !m.id) continue
    const id = String(m.id)
    if (见过id.has(id)) continue
    见过id.add(id)
    全.push({ m, scope: 'workspace', sid, ord: ord++ })
  }
}
for (const { sid, 盘 } of 会话盘们) {
  for (const m of 盘.memories || []) {
    if (!m || !m.id) continue
    const id = String(m.id)
    if (见过id.has(id)) continue
    if (m.category === 'stable_profile') continue // 会话侧的事实副本要丢掉
    见过id.add(id)
    全.push({ m, scope: 'session', sid, ord: ord++ })
  }
}

// 墓碑并集
const 坟 = new Map()
for (const d of 事实盘.deleted || []) if (d && d.id) 坟.set(String(d.id), d)
for (const { 盘 } of 会话盘们) for (const d of 盘.deleted || []) if (d && d.id && !坟.has(String(d.id))) 坟.set(String(d.id), d)
for (const { 盘 } of 工区盘们) for (const d of 盘.deleted || []) if (d && d.id && !坟.has(String(d.id))) 坟.set(String(d.id), d)

const 活着 = 全.filter((x) => !坟.has(String(x.m.id)))
const 删了 = [...坟.values()].map((m) => {
  const 全条 = 全.find((x) => String(x.m.id) === String(m.id))
  return {
    m,
    scope: 全条 ? 全条.scope : m.category === 'stable_profile' ? 'global' : 'session',
    sid: 全条 ? 全条.sid : '',
    ord: 全条 ? 全条.ord : ord++,
  }
})

console.log('源目录：' + HOME)
console.log('  事实库 ' + (事实盘.memories || []).length + ' 条（去重后 ' + 事实们.length + '）')
console.log('  会话库 ' + 会话盘们.length + ' 个')
console.log('  工作区库 ' + 工区盘们.length + ' 个')
console.log('  合并后活着 ' + 活着.length + ' 条（全局 ' + 活着.filter((x) => x.scope === 'global').length + ' / 工作区 ' + 活着.filter((x) => x.scope === 'workspace').length + ' / 会话 ' + 活着.filter((x) => x.scope === 'session').length + '）')
console.log('  墓碑 ' + 删了.length + ' 条')

if (!APPLY) {
  console.log('')
  console.log('（dry-run，什么都没写。要真写：--apply）')
  process.exit(0)
}

// ── 2. 建库
if (fs.existsSync(DB_PATH)) {
  if (!FORCE) {
    // 已有库：只校验行数，不覆盖
    const db = new DatabaseSync(DB_PATH)
    const n = db.prepare('select count(*) c from memory').get().c
    db.close()
    if (n === 活着.length + 删了.length) {
      console.log('')
      console.log('库已存在且行数一致（' + n + ' 行），跳过。')
      process.exit(0)
    }
    console.error('')
    console.error('库已存在但行数不一致（库里 ' + n + '，源 ' + (活着.length + 删了.length) + '）。要重建加 --force')
    process.exit(2)
  }
  const bak = DB_PATH + '.bak-' + Date.now()
  fs.copyFileSync(DB_PATH, bak)
  fs.unlinkSync(DB_PATH)
  console.log('  旧库已备份：' + path.basename(bak))
}

const db = new DatabaseSync(DB_PATH)
db.exec(`
  PRAGMA journal_mode = wal;
  CREATE TABLE memory (
    id TEXT NOT NULL,
    scope TEXT NOT NULL,
    session_id TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL,
    at TEXT,
    created_at TEXT,
    importance REAL,
    source TEXT,
    category TEXT,
    type TEXT,
    fact_key TEXT,
    related_json TEXT,
    extra_json TEXT,
    text_before TEXT,
    refined INTEGER NOT NULL DEFAULT 0,
    refined_skip INTEGER NOT NULL DEFAULT 0,
    superseded_why TEXT,
    wrong TEXT,
    ord INTEGER NOT NULL,
    deleted_at TEXT,
    activation0 REAL,
    activation_anchor TEXT,
    reinforce_count INTEGER NOT NULL DEFAULT 0,
    is_knowledge INTEGER,
    meta_json TEXT,
    PRIMARY KEY (scope, session_id, id)
  );
  CREATE INDEX idx_memory_scope ON memory(scope);
  CREATE INDEX idx_memory_session ON memory(session_id);
  CREATE INDEX idx_memory_ord ON memory(ord);
  CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT);
`)

const ins = db.prepare(`INSERT INTO memory
  (id, scope, session_id, text, at, created_at, importance, source, category, type, fact_key, related_json, extra_json, text_before, refined, refined_skip, superseded_why, wrong, ord, deleted_at, activation0, activation_anchor, reinforce_count, is_knowledge, meta_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

// 杂项/推理打包直接复用 lib/store-core.mjs 的实现（见文件头 import）——这里不再保留副本。

const tx = db.transaction ? db.transaction(run) : null
function run() {
  for (const { m, scope, sid, ord } of [...活着, ...删了]) {
    ins.run(
      String(m.id),
      scope,
      String(sid || ''),
      String(m.text || ''),
      m.at || null,
      m.createdAt || null,
      typeof m.importance === 'number' ? m.importance : null,
      m.source || null,
      m.category || null,
      m.type || null,
      m.事实键 || null,
      Array.isArray(m.related) ? JSON.stringify(m.related) : null,
      打包推理(m),
      m.textBefore ? String(m.textBefore) : null,
      m.refined ? 1 : 0,
      m.refinedSkip ? 1 : 0,
      m.已被取代 ? String(m.已被取代.为什么 || '') : null,
      m.别记 ? String(m.别记.原因 || '') : null,
      ord,
      m.deletedAt || (全.find((x) => String(x.m.id) === String(m.id)) ? null : null) || m.deletedAt || null,
      // ⭐ 2026-11-15（S3-a）：打分输入必须一起迁 —— 缺了它们，迁移后的库召回结果和 JSON 对不上
      typeof m.activation0 === 'number' && isFinite(m.activation0) ? m.activation0 : null,
      typeof m.activationAnchor === 'string' && m.activationAnchor ? String(m.activationAnchor) : null,
      typeof m.reinforceCount === 'number' && m.reinforceCount > 0 ? m.reinforceCount : 0,
      m.is_knowledge === true ? 1 : m.is_knowledge === false ? 0 : null,
      打包杂项(m),
    )
  }
}
if (tx) tx()
else run()

db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').run('schema_version', '1')
db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').run('migrated_at', new Date().toISOString())
db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').run('src_dir', HOME)
// 读视图只认「镜像有货」标记（1.8.28），迁移产物也算有货
db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').run('mirrored', '1')

// ── 3. 出口校验：读回来的视图 vs 源（排序口径与 读SQL视图 一致：global → workspace → session，再按 ord）
const 读回 = db.prepare("select id, scope, session_id, ord from memory where deleted_at is null order by case scope when 'global' then 0 when 'workspace' then 1 else 2 end, ord").all()
const 源id = 活着.map((x) => String(x.m.id))
const 回id = 读回.map((r) => String(r.id))
let ok = true
if (源id.length !== 回id.length) { ok = false; console.error('行数不一致：源 ' + 源id.length + ' / 回 ' + 回id.length) }
else {
  for (let i = 0; i < 源id.length; i++) {
    if (源id[i] !== 回id[i]) { ok = false; console.error('第 ' + i + ' 条 id 不同：' + 源id[i] + ' vs ' + 回id[i]); break }
  }
}
const 回全局 = 读回.filter((r) => r.scope === 'global').length
const 回工区 = 读回.filter((r) => r.scope === 'workspace').length
const 回会话 = 读回.filter((r) => r.scope === 'session').length
console.log('')
console.log('写完了：' + DB_PATH)
console.log('  活着的行 ' + 读回.length + '（全局 ' + 回全局 + ' / 工作区 ' + 回工区 + ' / 会话 ' + 回会话 + '）')
console.log('  墓碑行 ' + db.prepare('select count(*) c from memory where deleted_at is not null').get().c)
console.log('  顺序全等：' + (ok ? '✓' : '✗'))
db.close()
process.exit(ok ? 0 : 3)
