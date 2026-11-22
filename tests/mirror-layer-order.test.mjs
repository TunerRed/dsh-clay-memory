// tests/mirror-layer-order.test.mjs —— S2 层序回归（2026-11-15）
//
// 真库实测发现的 bug：42/62 个会话的「SQL 读视图」与「JSON 读视图」从第 455 条起错位。
// 根因两条，都在镜像这一侧：
//
//   ① 写路径 同步SQL镜像 的 ord 分配顺序是 global → session → workspace，
//      而 loadStoreJSON 的合并顺序是 global → workspace → session。
//      读视图只按 ord 排，于是工区和会话两层对调。
//   ② 会话段的 DELETE 没带 scope='session'，全量回填灌工作区库时 sid 传的就是 ws根，
//      刚插进去的 workspace 行会被同一个 session_id 的 DELETE 顺手清光（真库实测 workspace 归零）。
//
// S3 把 SQL 换成真相后，ord 就是注入顺序本身 —— ①再错就不是「影子对不上」而是注入顺序错，
// 所以这两条必须钉在测试里。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// 只用合成的库和假宿主；绝不碰调用方的 DSH_HOME。
const home = mkdtempSync(join(tmpdir(), 'clay-order-'))
process.env.DSH_HOME = home
const store = await import('../lib/store-core.mjs')
const sql = await import('../lib/storage.js')
const dir = join(home, 'clay-memory')
mkdirSync(dir, { recursive: true })

const SID = 'session-order-1'
const CWD = 'G:/proj/order'

function 造假工作区(sid, cwd) {
  const p = join(home, 'storages', 'session_projcache', 'sessions', sid + '.json')
  mkdirSync(join(home, 'storages', 'session_projcache', 'sessions'), { recursive: true })
  writeFileSync(p, JSON.stringify({ record: { identity: { cwd } } }), 'utf8')
}

test('写路径：镜像 ord 按 global → workspace → session 分配，与 loadStoreJSON 同序', () => {
  造假工作区(SID, CWD)
  // 故意打乱送入顺序：会话事件、全局事实、工作区条目交错
  const 造 = (id, text, category, scope) => ({
    id,
    text,
    category,
    scope,
    importance: category === 'stable_profile' ? 0.9 : 0.6,
    source: 'user',
    at: '2026-11-15T08:00:00.000Z',
    createdAt: '2026-11-15T08:00:00.000Z',
  })
  const data = store.loadStoreJSON(SID, CWD)
  data.memories = [
    造('s1', '会话事件一', 'event', 'session'),
    造('g1', '全局事实一', 'stable_profile', 'global'),
    造('w1', '工作区条目一', 'workspace', 'workspace:' + CWD),
    造('g2', '全局事实二', 'stable_profile', 'global'),
    造('s2', '会话事件二', 'event', 'session'),
    造('w2', '工作区条目二', 'workspace', 'workspace:' + CWD),
  ]
  store.saveStore(SID, data, {}, CWD)

  const json视图 = store.loadStoreJSON(SID, CWD)
  const 视图 = sql.读SQL视图同步(sql.库文件路径(dir), SID, CWD)
  assert.ok(视图, '镜像应可读（写路径会盖 mirrored 标记）')

  const jsonid = json视图.memories.map((m) => String(m.id))
  const sqlid = 视图.memories.map((m) => String(m.id))
  assert.deepEqual(sqlid, jsonid, 'SQL 视图顺序必须与 JSON 视图一致')

  // 层序显式断言：global 全在前，然后 workspace，最后 session
  const 层 = (m) => (m.__层 ? m.__层 : m.category === 'stable_profile' ? 'global' : m.category === 'workspace' ? 'workspace' : 'session')
  const 层序列 = json视图.memories.map(层)
  assert.deepEqual(层序列, ['global', 'global', 'workspace', 'workspace', 'session', 'session'])
  assert.deepEqual(sqlid, ['g1', 'g2', 'w1', 'w2', 's1', 's2'])
})

test('读视图：ord 交错时仍按 global → workspace → session 排', () => {
  const 文件 = join(fsTemp(), 'interleave.db')
  const db = new DatabaseSync(文件)
  sql.确保镜像表(db)
  const 插 = db.prepare(
    'INSERT OR REPLACE INTO memory (id,scope,session_id,text,at,created_at,importance,source,category,type,fact_key,related_json,extra_json,text_before,refined,refined_skip,superseded_why,wrong,ord,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  )
  // 故意让 ord 跨层交错：workspace 的 ord 比 session 还小、global 的比谁都大
  const 行 = [
    ['G1', 'global', '', '全局一', null, null, 0.9, 'user', 'stable_profile', '', '', '[]', null, '', 1, 0, '', '', 9, null],
    ['W1', 'workspace', CWD, '工作区一', null, null, 0.6, 'user', 'workspace', '', '', '[]', null, '', 0, 0, '', '', 0, null],
    ['S1', 'session', SID, '会话一', null, null, 0.6, 'user', 'event', '', '', '[]', null, '', 0, 0, '', '', 1, null],
    ['G2', 'global', '', '全局二', null, null, 0.9, 'user', 'stable_profile', '', '', '[]', null, '', 1, 0, '', '', 5, null],
    ['W2', 'workspace', CWD, '工作区二', null, null, 0.6, 'user', 'workspace', '', '', '[]', null, '', 0, 0, '', '', 3, null],
    ['S2', 'session', SID, '会话二', null, null, 0.6, 'user', 'event', '', '', '[]', null, '', 0, 0, '', '', 2, null],
  ]
  for (const r of 行) 插.run(...r)
  db.prepare("insert or replace into kv (k, v) values ('mirrored', '1')").run()
  db.close()

  const 视图 = sql.读SQL视图同步(文件, SID, CWD)
  assert.ok(视图, '视图能读出来')
  assert.deepEqual(
    视图.memories.map((m) => String(m.id)),
    ['G2', 'G1', 'W1', 'W2', 'S1', 'S2'],
    '层序优先于 ord：global → workspace → session，层内才按 ord（G2 ord=5 在 G1 ord=9 前）',
  )
})

test('全量回填：会话段的 DELETE 不许清掉刚插的工作区行', () => {
  // 清掉上一个用例留下的东西，造一份干净的盘
  for (const fn of existsSync(dir) ? readdirSync(dir) : []) rmSync(join(dir, fn), { force: true, recursive: true })
  mkdirSync(dir, { recursive: true })
  const 写 = (名, 体) => writeFileSync(join(dir, 名), JSON.stringify(体, null, 2), 'utf8')
  const 条 = (id, text, category, scope) => ({ id, text, category, scope, importance: 0.6, source: 'user', at: '2026-11-15T08:00:00.000Z' })
  // 会话库 + 工作区库（wsRoot 写在文件里）
  写('session-回填.json', { version: 2, wsRoot: '', memories: [条('s1', '会话事件', 'event', 'session')], deleted: [], traces: [] })
  写('_ws-回填.json', { version: 2, wsRoot: CWD, memories: [条('w1', '工作区条目', 'workspace', 'workspace:' + CWD)], deleted: [], traces: [] })

  store.接报信(() => {})
  store.全量回填镜像()

  const db = new DatabaseSync(sql.库文件路径(dir), { readOnly: true })
  const 数 = db.prepare("select count(*) c from memory where scope = 'workspace' and deleted_at is null").get().c
  const 活 = db.prepare('select count(*) c from memory where deleted_at is null').get().c
  db.close()
  assert.equal(数, 1, '工作区行必须活下来（session 段的 DELETE 带 scope 条件）')
  assert.equal(活, 2, '会话行 + 工作区行都在')
})

function fsTemp() {
  return mkdtempSync(join(tmpdir(), 'clay-order-t-'))
}
