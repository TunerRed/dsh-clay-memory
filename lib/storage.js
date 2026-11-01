// C 轮 S2：存储接口的第一层
//
// 这一步**只做只读影子比对**，不改任何调用方 —— JSON 还是唯一真相，
// SQLite 只是被偷偷读一遍，用来验证「同一份数据、两种读法，读出来是不是一模一样」。
// 等影子稳了，S2 后半段再把 loadStore/saveStore 收进这里，S3 再按组切换。
//
// 为什么单独一个文件：index.js 已经七千多行，存储的事再往里塞就彻底没法看了。
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let 同步库类 = null
let 同步库模块 = null

// S3 用：注入路径是同步函数，不能 await import。
// 启动时调一次这个，之后 读SQL视图同步 就能用；拿不到就返回 false，调用方退回 JSON。
export function 准备SQLite同步() {
  if (同步库类) return true
  try {
    const m = require('node:sqlite')
    if (m && m.DatabaseSync) {
      同步库类 = m.DatabaseSync
      同步库模块 = m
      return true
    }
  } catch (error) {}
  return false
}

// 写路径要用模块本身（prepare / exec / close），不能只用 DatabaseSync 构造函数
export function 取SQLite模块() {
  准备SQLite同步()
  return 同步库模块
}

let 已试过 = false
let 库模块 = null

// node:sqlite 是实验 API，不同 Node 版本行为不一样 —— 拿不到就当没这功能，
// 不能让「影子」把正事拖垮（这是诊断工具，不是依赖）。
async function 拿库() {
  if (库模块 || 已试过) return 库模块
  已试过 = true
  try {
    const m = await import('node:sqlite')
    库模块 = m && m.DatabaseSync ? m : null
  } catch (error) {
    库模块 = null
  }
  return 库模块
}

// 与 loadStore 同构的「SQL 读视图」：事实在前（按 ord）、然后是本报会话的事件。
// sid 传空字符串 = 只要全局那部分。
// 镜像「有货」标记：写路径完成一次全量同步/回填后写 kv。读视图没见标记时一律当没数据
// —— 不然新装机/删库后读侧把「刚建的空表」当成有效镜像，注入直接空了。
export function 镜像有货(db) {
  try {
    const row = db.prepare("select v from kv where k = 'mirrored'").get()
    return !!(row && row.v)
  } catch (error) {
    return false
  }
}

export function 记镜像有货(db) {
  try {
    db.prepare("insert or replace into kv (k, v) values ('mirrored', ?)").run(String(Date.now()))
  } catch (error) {}
}

// 组视图：把「活行 + 坟行」按 loadStoreJSON 的口径合成视图 ——
//   ① 坟按 id 并集去重；② 同 id 的活条目只要坟里有就摘掉（JSON 侧 memories.filter(!坟们.has(id))）；
//   ③ 全局先行、本会话随后，已见 id 去重（同 id 跨会话副本取先见者）；
//   ④ stable_profile 按归一化文本去重（loadStoreJSON 的 已见文 逻辑）。
function 组视图(rows, 坟行, sid, 工作区) {
  const 坟ids = new Set()
  const 坟 = []
  for (const r of 坟行 || []) {
    const id = String(r.id)
    if (坟ids.has(id)) continue
    坟ids.add(id)
    坟.push({ id, text: r.text, deletedAt: r.deleted_at })
  }
  const 看得见的 = new Set()
  const 文表 = new Map()
  const 我的 = []
  for (const r of rows || []) {
    const id = String(r.id)
    if (坟ids.has(id)) continue
    const 是全局 = String(r.scope) === 'global'
    if (!是全局) {
      // GPT 整改 P2（workspace）：三层过滤 —— session 行认 sid、workspace 行认工作区根、
      // 老数据的 scope 兜底按 session_id===sid。
      if (String(r.scope) === 'workspace') {
        if (!工作区 || String(r.session_id || '') !== 工作区) continue
      } else if (!sid || String(r.session_id || '') !== sid) {
        continue
      }
    }
    if (sid && 看得见的.has(id)) continue
    if (是全局 && r.category === 'stable_profile') {
      const 文 = String(r.text || '').replace(/\s+/g, '')
      if (文) {
        if (文表.has(文)) continue
        文表.set(文, id)
      }
    }
    看得见的.add(id)
    我的.push(一行为记忆(r))
  }
  return { memories: 我的, deleted: 坟 }
}

export async function 读SQL视图(库路径, sid, 工作区) {
  const m = await 拿库()
  if (!m) return null
  if (!库路径) return null
  try {
    const db = new m.DatabaseSync(库路径)
    if (!镜像有货(db)) {
      db.close()
      return null
    }
    const rows = db
      .prepare(
        "select id, scope, session_id, text, at, created_at, importance, source, category, type, fact_key, related_json, extra_json, text_before, refined, refined_skip, superseded_why, wrong, ord, deleted_at from memory where deleted_at is null order by (scope = 'global') desc, ord",
      )
      .all()
    const 坟行 = db
      .prepare("select id, text, deleted_at, ord from memory where deleted_at is not null and (scope = 'global' or session_id = ? or (scope = 'workspace' and session_id = ?)) order by ord")
      .all(String(sid || ''), String(工作区 || ''))
    db.close()
    return 组视图(rows, 坟行, sid, 工作区)
  } catch (error) {
    return null
  }
}

export function 一行为记忆(r) {
  let related = []
  if (r.related_json) {
    try {
      const v = JSON.parse(r.related_json)
      if (Array.isArray(v)) related = v
    } catch (error) {}
  }
  // GPT 整改 P2（inference）：推测专属字段打包在 extra_json ——
  //   只对 type='inference' 解包，保证 json/sql 两侧形状一致
  let extra = null
  if (r.extra_json) {
    try {
      const v = JSON.parse(r.extra_json)
      if (v && typeof v === 'object') extra = v
    } catch (error) {}
  }
  const 底 = {
    id: String(r.id),
    text: String(r.text || ''),
    at: r.at || undefined,
    createdAt: r.created_at || undefined,
    importance: typeof r.importance === 'number' ? r.importance : undefined,
    source: r.source || undefined,
    category: r.category || undefined,
    type: r.type || undefined,
    事实键: r.fact_key || undefined,
    related: related.length ? related : undefined,
    textBefore: r.text_before || undefined,
    refined: !!r.refined,
    refinedSkip: !!r.refined_skip,
    已被取代: r.superseded_why ? { 为什么: String(r.superseded_why) } : undefined,
    别记: r.wrong ? { 原因: String(r.wrong) } : undefined,
    scope:
      String(r.scope) === 'global'
        ? 'global'
        : String(r.scope) === 'workspace'
          ? 'workspace:' + String(r.session_id || '')
          : 'session',
    ...(r.type === 'inference' && extra
      ? {
          evidence: Array.isArray(extra.evidence) ? extra.evidence : [],
          confidence: typeof extra.confidence === 'string' ? extra.confidence : '低',
          status: typeof extra.status === 'string' ? extra.status : 'pending',
          推断域: typeof extra.推断域 === 'string' ? extra.推断域 : '',
          provenance: typeof extra.provenance === 'string' ? extra.provenance : 'model_inference',
          ...(typeof extra.confirmedAt === 'string' ? { confirmedAt: extra.confirmedAt } : {}),
          ...(typeof extra.rejectedAt === 'string' ? { rejectedAt: extra.rejectedAt } : {}),
        }
      : {}),
  }
  return 底
}

// 比对：先比 id 序列（顺序错就是错，注入顺序是有意义的），再比关键字段。
// 只报差异，不抛错 —— 影子是诊断，不是测试。
export function 比对视图(甲的, 乙的) {
  if (!甲的) return { 全等: false, 差异: ['JSON 视图不存在'] }
  if (!乙的) return { 全等: false, 差异: ['SQL 视图读不出来'] }
  const 差异 = []
  const a = 甲的.memories || []
  const b = 乙的.memories || []
  if (a.length !== b.length) 差异.push('条数不同 JSON ' + a.length + ' / SQL ' + b.length)
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (String(a[i].id) !== String(b[i].id)) {
      差异.push('第 ' + i + ' 条 id 不同 ' + a[i].id + ' / ' + b[i].id)
      break
    }
  }
  // 字段抽样：只比会进注入文本的（text / importance / 事实键 / related），
  // 时间与出处只影响展示，先不比 —— 免得一批时区/格式差异淹掉真问题。
  let 字段差异 = 0
  for (let i = 0; i < n && 字段差异 < 3; i++) {
    const x = a[i]
    const y = b[i]
    if (String(x.id) !== String(y.id)) continue
    if (String(x.text || '') !== String(y.text || '')) {
      差异.push('文本不同（' + String(x.id).slice(0, 10) + '）')
      字段差异++
    }
    const ix = typeof x.importance === 'number' ? x.importance : null
    const iy = typeof y.importance === 'number' ? y.importance : null
    if (ix !== iy) {
      差异.push('重要度不同（' + String(x.id).slice(0, 10) + '）：' + ix + ' / ' + iy)
      字段差异++
    }
    if (String(x.事实键 || '') !== String(y.事实键 || '')) {
      差异.push('事实键不同（' + String(x.id).slice(0, 10) + '）')
      字段差异++
    }
  }
  return { 全等: 差异.length === 0, 差异 }
}

export function 库文件路径(目录) {
  return path.join(目录, 'clay-memory.db')
}

// 同步版：逻辑与 读SQL视图 一致（全局先行按 ord，再本会话事件）。
// 注入路径必须同步，所以单列一份；两处逻辑要同步维护。

// ⭐ 1.8.18（架构师审查 H3）：建表与 PRAGMA 以前只在 tools/migrate-to-sqlite.mjs 里做，
//    插件自己的写路径从不 CREATE TABLE —— 新装机 / 删过 clay-memory.db 的机器上，
//    每次保存都报 no such table，被 diag 吞掉，镜像永久空转（而 1.8.7–1.8.16 全在修这个镜像）。
//    这里补齐：幂等 DDL + WAL + busy_timeout，插件一启动就有表可用。
const 镜像DDL = `
  CREATE TABLE IF NOT EXISTS memory (
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
    PRIMARY KEY (scope, session_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory(scope);
  CREATE INDEX IF NOT EXISTS idx_memory_session ON memory(session_id);
  CREATE INDEX IF NOT EXISTS idx_memory_ord ON memory(ord);
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
`

// 1.8.29：主键从「id 全局唯一」改成「(scope, session_id, id)」。
//   背景：1.4.0 迁移前的老库有「同 id 跨会话副本」（copy-to 也造这种），
//   旧主键下后灌的会话把先灌会话的同 id 行 REPLACE 掉 —— 先灌的会话读 SQL 视图直接少条目
//   （真机差分：4c622978 库 233 条镜像里只剩 17 行，200 条被 b168bef6 的同 id 行挤走）。
export function 镜像主键是新模型(db) {
  if (!db) return false
  try {
    const row = db.prepare("select sql from sqlite_master where type = 'table' and name = 'memory'").get()
    return !!(row && row.sql && /PRIMARY KEY\s*\(\s*scope\s*,\s*session_id\s*,\s*id\s*\)/.test(String(row.sql)))
  } catch (error) {
    return false
  }
}

// 旧主键的表没法 ALTER 改主键 —— 只能重建。镜像本来就是影子，数据丢了没关系：
// 调用方重建后必须做一次全量回填（index.js 里做）。
export function 重建镜像表(db) {
  if (!db) return false
  try {
    db.exec('DROP TABLE IF EXISTS memory')
    db.exec(镜像DDL)
    return true
  } catch (error) {
    return false
  }
}

// 旧库迁移：CREATE TABLE IF NOT EXISTS 不会给已存在的表补列（1.8.19 之前建的库没有
// refined_skip/superseded_why/wrong），缺哪列补哪列 —— SQLite 没有 ADD COLUMN IF NOT EXISTS。
export function 补镜像列(db) {
  if (!db) return false
  try {
    const 现有 = new Set(db.prepare('PRAGMA table_info(memory)').all().map((c) => String(c.name)))
    const 补 = [
      ['refined_skip', 'INTEGER NOT NULL DEFAULT 0'],
      ['superseded_why', 'TEXT'],
      ['wrong', 'TEXT'],
      ['extra_json', 'TEXT'],
    ]
    for (const [名, 型] of 补) {
      if (!现有.has(名)) db.exec('ALTER TABLE memory ADD COLUMN ' + 名 + ' ' + 型)
    }
    return true
  } catch (error) {
    return false
  }
}

export function 确保镜像表(db) {
  if (!db) return false
  try {
    db.exec(镜像DDL)
    补镜像列(db)
    try { db.exec('PRAGMA journal_mode = wal') } catch (e) {}
    try { db.exec('PRAGMA busy_timeout = 500') } catch (e) {}
    return true
  } catch (error) {
    return false
  }
}

export function 读SQL视图同步(库路径, sid, 工作区) {
  if (!同步库类 && !准备SQLite同步()) return null
  if (!库路径) return null
  try {
    const db = new 同步库类(库路径)
    if (!镜像有货(db)) {
      db.close()
      return null
    }
    const rows = db
      .prepare(
        "select id, scope, session_id, text, at, created_at, importance, source, category, type, fact_key, related_json, extra_json, text_before, refined, refined_skip, superseded_why, wrong, ord, deleted_at from memory where deleted_at is null order by (scope = 'global') desc, ord",
      )
      .all()
    const 坟行 = db
      .prepare("select id, text, deleted_at, ord from memory where deleted_at is not null and (scope = 'global' or session_id = ? or (scope = 'workspace' and session_id = ?)) order by ord")
      .all(String(sid || ''), String(工作区 || ''))
    db.close()
    return 组视图(rows, 坟行, sid, 工作区)
  } catch (error) {
    return null
  }
}
