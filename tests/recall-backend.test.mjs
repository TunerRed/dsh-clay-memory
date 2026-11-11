// tests/recall-backend.test.mjs —— C 阶段回归：SQL 镜像与 JSON 视图的召回口径差分（2026-10-30）
//
// 背景：1.8.19 之前镜像表没有 refined_skip/superseded_why/wrong 三列，且墓碑从不进镜像
// （造坟 定义了但没被调用，2026-10-29 实测「墓碑盖活条目」后干脆把坟全排除了）。
// 结果：SQL 侧把「提炼跳过 / 已被取代 / 别记」的条目都当活条目召回，与 JSON 侧必炸。
// 1.8.25：三列入库 + 坟先插、活后插（同 id 活赢）+ 读视图还原三状态字段。
//
// 本测试不 import lib/index.js（顶层 await loadHostDeps 有宿主副作用），
// 直接用 node:sqlite 建临时镜像库 → 读SQL视图同步 与 手造 JSON 视图 两边各跑一遍
// 「注入路径的过滤口径」（别记 → recall 的 refinedSkip/已被取代），picked 必须一致。
import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { 读SQL视图同步, 一行为记忆, 确保镜像表, 补镜像列, 镜像主键是新模型 } from '../lib/storage.js'

const SID = 'session-测试'

// 造一份「真库该有的样子」：活条目里混着三种「不该被召回」的状态，墓碑与活条目同 id 冲突。
function 建库(文件) {
  const db = new DatabaseSync(文件)
  确保镜像表(db)
  const 插 = db.prepare(
    'INSERT OR REPLACE INTO memory (id,scope,session_id,text,at,created_at,importance,source,category,type,fact_key,related_json,text_before,refined,refined_skip,superseded_why,wrong,ord,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  )
  const 行 = [
    // 活条目
    ['g1', 'global', '', '全局事实一', '2026-10-29T00:00:00Z', null, 0.8, 'user', 'stable_profile', 'fact', '键1', '[]', null, 1, 0, '', '', 0, null],
    ['g2', 'global', '', '全局事实二', '2026-10-29T00:00:00Z', null, 0.8, 'user', 'stable_profile', 'fact', '键2', '[]', null, 1, 0, '', '', 1, null],
    ['g3', 'global', '', '全局事实三', '2026-10-29T00:00:00Z', null, 0.8, 'user', 'stable_profile', 'fact', '键3', '[]', null, 1, 1, '', '', 2, null],
    ['g4', 'global', '', '全局事实四', '2026-10-29T00:00:00Z', null, 0.8, 'user', 'stable_profile', 'fact', '键4', '[]', null, 1, 0, '被新的事实取代了', '', 3, null],
    ['g5', 'global', '', '全局事实五', '2026-10-29T00:00:00Z', null, 0.8, 'user', 'stable_profile', 'fact', '键5', '[]', null, 1, 0, '', '这条不对', 4, null],
    ['s1', 'session', SID, '本会话事件一', '2026-10-29T00:00:00Z', null, 0.6, 'user', 'event', '', '', '[]', null, 0, 0, '', '', 5, null],
    ['s9', 'session', 'session-别的会话', '别人的会话事件（不该被我看见）', '2026-10-29T00:00:00Z', null, 0.6, 'user', 'event', '', '', '[]', null, 0, 0, '', '', 8, null],
    // 独立墓碑（不属于任何活条目）
    ['d1', 'global', '', '已经删掉的全局', '2026-10-28T00:00:00Z', null, 0.5, 'user', 'event', '', '', '[]', null, 0, 0, '', '', 6, '2026-10-29T01:00:00Z'],
    // 同 id 冲突墓碑（g1 先删又复活那种脏数据 —— JSON 口径：坟按 id 并集摘活，坟赢）
    ['g1', 'global', '', '全局事实一（坟）', '2026-10-28T00:00:00Z', null, 0.5, 'user', 'event', '', '', '[]', null, 0, 0, '', '', 7, '2026-10-29T01:00:00Z'],
  ]
  // 模拟真实写入顺序（1.8.29）：活先插、坟后插（坟 REPLACE 压过同键活行 → 坟赢，与 JSON 一致）
  for (const r of 行.filter((x) => x[18] === null)) 插.run(...r)
  for (const r of 行.filter((x) => x[18] !== null)) 插.run(...r)
  db.close()
}

// 写路径同步完成后会盖「镜像有货」标记；读视图没标记一律当没数据（防空表注入）。
function 标记有货(文件) {
  const db = new DatabaseSync(文件)
  db.prepare("insert or replace into kv (k, v) values ('mirrored', '1')").run()
  db.close()
}

// 与 lib/index.js 注入路径同款口径：
//   ① 别记 先摘掉（:4628 注入前）② recall 里再摘 refinedSkip / 已被取代（:3366）
function 召回过滤(memories) {
  return (memories || [])
    .filter((m) => !(m && m.别记))
    .filter((m) => !m || (!m.refinedSkip && !m.已被取代))
}

test('镜像列迁移：旧表（无三列）能被 补镜像列 补上', () => {
  const 文件 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'clay-')), 'old.db')
  const db = new DatabaseSync(文件)
  // 建 1.8.19 时代的旧表（没有 refined_skip/superseded_why/wrong）
  db.exec(`CREATE TABLE memory (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL, session_id TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL, at TEXT, created_at TEXT, importance REAL, source TEXT,
    category TEXT, type TEXT, fact_key TEXT, related_json TEXT, text_before TEXT,
    refined INTEGER NOT NULL DEFAULT 0, ord INTEGER NOT NULL, deleted_at TEXT)`)
  assert.equal(补镜像列(db), true)
  const 列 = new Set(db.prepare('PRAGMA table_info(memory)').all().map((c) => String(c.name)))
  assert.ok(列.has('refined_skip'), '补上 refined_skip')
  assert.ok(列.has('superseded_why'), '补上 superseded_why')
  assert.ok(列.has('wrong'), '补上 wrong')
  // 幂等：再补一次不炸
  assert.equal(补镜像列(db), true)
  db.close()
})

test('读SQL视图同步：三状态字段还原回 JSON 形状，与 JSON 视图全等', () => {
  const 文件 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'clay-')), 'full.db')
  建库(文件)
  // 没盖「镜像有货」标记时，读视图必须拒绝（1.8.28：防空表被当成有效镜像）
  assert.equal(读SQL视图同步(文件, SID), null, '无标记 → 视图不可用')
  标记有货(文件)
  const 视图 = 读SQL视图同步(文件, SID)
  assert.ok(视图, '视图能读出来')
  // 手造 JSON 视图（loadStoreJSON 的口径：墓碑按 id 并集后把活条目里的同 id 摘掉 —— g1 坟赢，不进活）
  const jsonMemories = [
    { id: 'g2', text: '全局事实二', refined: true, refinedSkip: false, scope: 'global', 事实键: '键2' },
    { id: 'g3', text: '全局事实三', refined: true, refinedSkip: true, scope: 'global', 事实键: '键3' },
    { id: 'g4', text: '全局事实四', refined: true, refinedSkip: false, 已被取代: { 为什么: '被新的事实取代了' }, scope: 'global', 事实键: '键4' },
    { id: 'g5', text: '全局事实五', refined: true, refinedSkip: false, 别记: { 原因: '这条不对' }, scope: 'global', 事实键: '键5' },
    { id: 's1', text: '本会话事件一', refined: false, refinedSkip: false, scope: 'session', 事实键: '' },
  ]
  const jsonDeleted = [{ id: 'd1', text: '已经删掉的全局' }, { id: 'g1', text: '全局事实一（坟）' }]
  // ① id 序列必须一致（顺序就是注入顺序）
  assert.deepEqual(
    视图.memories.map((m) => m.id),
    jsonMemories.map((m) => m.id),
    '活条目 id 序列一致',
  )
  // ② 墓碑进读视图：d1 在，g1 坟压过同 id 活条目（坟赢，与 JSON 口径全等）
  assert.deepEqual(
    视图.deleted.map((d) => d.id).sort(),
    ['d1', 'g1'],
    '独立墓碑进视图，同 id 冲突时坟赢',
  )
  // ③ 三状态字段逐一还原
  const sqlById = new Map(视图.memories.map((m) => [m.id, m]))
  assert.equal(sqlById.get('g3').refinedSkip, true, 'refinedSkip 还原')
  assert.deepEqual(sqlById.get('g4').已被取代, { 为什么: '被新的事实取代了' }, '已被取代 还原')
  assert.deepEqual(sqlById.get('g5').别记, { 原因: '这条不对' }, '别记 还原')
  assert.equal(sqlById.get('g2').refinedSkip, false, '干净条目不带状态')
  assert.equal(sqlById.get('g2').已被取代, undefined)
  assert.equal(sqlById.get('g2').别记, undefined)
  // ④ 两边跑同一套注入过滤口径，picked 必须一致
  const sqlPicked = 召回过滤(视图.memories).map((m) => m.id)
  const jsonPicked = 召回过滤(jsonMemories).map((m) => m.id)
  assert.deepEqual(sqlPicked, ['g2', 's1'], 'SQL 侧把三状态条目摘掉')
  assert.deepEqual(jsonPicked, ['g2', 's1'], 'JSON 侧同口径')
  // ⑤ 会话隔离（审查 C9）：本会话视图不含别的会话的行；别的会话能看到 global 事实 + 自己的事件，但看不到我的事件
  assert.ok(!视图.memories.some((m) => m.id === 's9'), '本会话看不到别人的事件')
  const 别人视图 = 读SQL视图同步(文件, 'session-别的会话')
  assert.deepEqual(
    别人视图.memories.map((m) => m.id).sort(),
    ['g2', 'g3', 'g4', 'g5', 's9'].sort(),
    '别的会话：global 事实全局共享 + 自己的事件；不含 s1（g1 已坟赢摘掉）',
  )
  assert.ok(!别人视图.memories.some((m) => m.id === 's1'), '别人的视图里没有我的事件')
})

test('一行为记忆：superseded_why / wrong 为空的行不造出空对象', () => {
  const m = 一行为记忆({ id: 'x', text: 't', scope: 'global', session_id: '', refined: 0, refined_skip: 0, superseded_why: '', wrong: '', ord: 0, deleted_at: null })
  assert.equal(m.refinedSkip, false)
  assert.equal(m.已被取代, undefined)
  assert.equal(m.别记, undefined)
  // null 与 '' 同口径（TEXT 列两种空值都可能出现）
  const m2 = 一行为记忆({ id: 'y', text: 't', scope: 'global', session_id: '', refined: 0, refined_skip: 0, superseded_why: null, wrong: null, ord: 1, deleted_at: null })
  assert.equal(m2.已被取代, undefined)
  assert.equal(m2.别记, undefined)
})

test('1.8.29 跨会话同 id 副本：新主键下两行共存，各自视图全等', () => {
  const 文件 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'clay-')), 'dup.db')
  const db = new DatabaseSync(文件)
  确保镜像表(db)
  assert.ok(镜像主键是新模型(db), '新主键 (scope, session_id, id)')
  const 插 = db.prepare(
    'INSERT OR REPLACE INTO memory (id,scope,session_id,text,at,created_at,importance,source,category,type,fact_key,related_json,text_before,refined,refined_skip,superseded_why,wrong,ord,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  )
  // 老库时代：两条会话各有一份同 id 副本（1.4.0 迁移 / copy-to 的产物）
  const 行 = [
    ['dup1', 'session', 'session-甲', '甲会话的副本', null, null, 0.5, 'user', 'event', '', '', '[]', null, 0, 0, '', '', 0, null],
    ['dup1', 'session', 'session-乙', '乙会话的副本', null, null, 0.5, 'user', 'event', '', '', '[]', null, 0, 0, '', '', 1, null],
    ['g1', 'global', '', '全局事实', null, null, 0.8, 'user', 'stable_profile', 'fact', '', '[]', null, 1, 0, '', '', 2, null],
  ]
  for (const r of 行) 插.run(...r)
  标记有货(文件)
  const 甲 = 读SQL视图同步(文件, 'session-甲')
  const 乙 = 读SQL视图同步(文件, 'session-乙')
  assert.deepEqual(甲.memories.map((m) => m.id), ['g1', 'dup1'], '甲视图：全局 + 自己的副本')
  assert.deepEqual(乙.memories.map((m) => m.id), ['g1', 'dup1'], '乙视图：全局 + 自己的副本（旧主键下这里会被甲挤掉）')
  db.close()
})

test('1.8.29 坟摘活：墓碑按 id 并集摘掉一切同 id 活条目（与 JSON 口径一致）', () => {
  const 文件 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'clay-')), 'grave.db')
  const db = new DatabaseSync(文件)
  确保镜像表(db)
  const 插 = db.prepare(
    'INSERT OR REPLACE INTO memory (id,scope,session_id,text,at,created_at,importance,source,category,type,fact_key,related_json,text_before,refined,refined_skip,superseded_why,wrong,ord,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  )
  const 行 = [
    // 全局坟 + 本会话同 id 活条目（历史撞 id：事实库删了 X，会话库里还留着同 id 活条目）
    ['x1', 'global', '', '坟', null, null, 0.5, 'user', 'event', '', '', '[]', null, 0, 0, '', '', 0, '2026-10-29T00:00:00Z'],
    ['x1', 'session', SID, '活', null, null, 0.5, 'user', 'event', '', '', '[]', null, 0, 0, '', '', 1, null],
    // 本会话坟 + 本会话同 id 活条目（同 (scope,sid,id) 主键 → 活后插赢，坟不剩）
    ['x2', 'session', SID, '坟2', null, null, 0.5, 'user', 'event', '', '', '[]', null, 0, 0, '', '', 2, '2026-10-29T00:00:00Z'],
    ['x2', 'session', SID, '活2', null, null, 0.5, 'user', 'event', '', '', '[]', null, 0, 0, '', '', 3, null],
    // 普通独立坟
    ['x3', 'global', '', '独立坟', null, null, 0.5, 'user', 'event', '', '', '[]', null, 0, 0, '', '', 4, '2026-10-29T00:00:00Z'],
  ]
  // 活先插、坟后插（1.8.29 真实写路径顺序：坟 REPLACE 压过同键活行）
  for (const r of 行.filter((x) => x[18] === null)) 插.run(...r)
  for (const r of 行.filter((x) => x[18] !== null)) 插.run(...r)
  标记有货(文件)
  const 视图 = 读SQL视图同步(文件, SID)
  assert.deepEqual(视图.memories.map((m) => m.id), [], 'x1 被全局坟摘掉、x2 同键坟压过活行——坟优先口径与 JSON 全等')
  assert.deepEqual(视图.deleted.map((d) => d.id).sort(), ['x1', 'x2', 'x3'], '坟视图：x1（global）+ x2（同键坟赢）+ x3（独立）')
  db.close()
})
