import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// 只用合成的库和假宿主；绝不碰调用方的 DSH_HOME。
const home = mkdtempSync(join(tmpdir(), 'fish-clear-'))
process.env.DSH_HOME = home
const store = await import('../lib/store-core.mjs')
const paths = await import('../lib/paths.mjs')
const sql = await import('../lib/storage.js')
const core = await import('../lib/routes-core.mjs')
const dir = join(home, 'clay-memory')
mkdirSync(dir, { recursive: true })
store.接报信(() => {})

const 读文件 = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null)
const 读会话 = (sid) => 读文件(paths.storePath(sid))
const 盘上 = (sid, id) => {
  const data = 读文件(paths.storePath(sid)) || { memories: [] }
  const 事实 = 读文件(paths.factPath()) || { memories: [] }
  return [...(data.memories || []), ...(事实.memories || [])].find((m) => String(m.id) === id) || null
}

const 时间 = '2026-10-01T00:00:00.000Z'
function 造一条(sid, id, 附加 = {}, 类别 = 'stable_profile') {
  const data = store.loadStoreJSON(sid)
  data.memories.push({ id, text: '这条是 ' + id + ' 的内容', category: 类别, importance: 1, createdAt: 时间, ...附加 })
  const 工区 = 附加.scope && String(附加.scope).startsWith('workspace:') ? String(附加.scope).slice(10) : undefined
  store.saveStore(sid, data, {}, 工区)
}

// ---------- 1. 清字段：不带时补状态把旧标记补回（现状证据），带了才真清掉 ----------
test('清字段：普通 saveStore 会补回盘上旧标记；带 清字段 才真清掉', () => {
  造一条('cf-s1', 'm1', { stableChecked: true })
  assert.equal(盘上('cf-s1', 'm1').stableChecked, true, '前置：盘上有标记')

  // 模拟重判：内存里 delete，但没声明清字段
  const d1 = store.loadStoreJSON('cf-s1')
  delete d1.memories.find((m) => String(m.id) === 'm1').stableChecked
  store.saveStore('cf-s1', d1)
  assert.equal(盘上('cf-s1', 'm1').stableChecked, true, '不带 清字段：补状态把旧标记补回（已知盲区，现状证据）')

  // 声明清字段
  const d2 = store.loadStoreJSON('cf-s1')
  delete d2.memories.find((m) => String(m.id) === 'm1').stableChecked
  store.saveStore('cf-s1', d2, { 清字段: ['stableChecked'] })
  assert.equal(盘上('cf-s1', 'm1').stableChecked, undefined, '带 清字段：真清掉，重判筛得出来')
})

// ---------- 2. 普通保存：不带 清字段 时补状态行为不变（保护 B 阶段交错写） ----------
test('不带 清字段：旧快照写回仍被补状态保护（A 阶段判完的成果不丢）', () => {
  造一条('cf-s2', 'm2', {}, 'event')
  // A：判完写上标记
  const a = store.loadStoreJSON('cf-s2')
  a.memories.find((m) => String(m.id) === 'm2').stableChecked = true
  store.saveStore('cf-s2', a)
  assert.equal(盘上('cf-s2', 'm2').stableChecked, true)

  // B：拿的是 A 判之前的老快照（没有标记），整体写回
  const 旧快照 = 读文件(paths.storePath('cf-s2'))
  delete 旧快照.memories[0].stableChecked
  store.saveStore('cf-s2', 旧快照)
  assert.equal(盘上('cf-s2', 'm2').stableChecked, true, '不带 清字段：旧快照写回不会抹掉标记')
})

// ---------- 3. 并发写入：清标记期间盘上新增条目不丢（证明合并仍生效，不是 raw 覆盖） ----------
test('清标记期间别人新增的条目不被覆盖丢失（合并仍在，不是 raw 式覆盖）', () => {
  造一条('cf-s3', 'old', {}, 'event')
  const 我的快照 = store.loadStoreJSON('cf-s3') // 调用方 loadStore 拿的快照
  我的快照.memories.find((m) => String(m.id) === 'old').stableChecked = true
  store.saveStore('cf-s3', 我的快照)

  // 期间：别的路由新增一条
  const 别人 = store.loadStoreJSON('cf-s3')
  别人.memories.push({ id: 'new', text: '别人新记的一条', category: 'event', createdAt: 时间 })
  store.saveStore('cf-s3', 别人)
  assert.ok(盘上('cf-s3', 'new'), '前置：别人写的已落盘')

  // 我拿旧快照 + 清字段 写回
  delete 我的快照.memories.find((m) => String(m.id) === 'old').stableChecked
  store.saveStore('cf-s3', 我的快照, { 清字段: ['stableChecked'] })

  assert.ok(盘上('cf-s3', 'new'), '别人新增的没被覆盖删除（合并生效）')
  assert.equal(盘上('cf-s3', 'old').stableChecked, undefined, '清字段生效')
})

// ---------- 4. 重启恢复：清完落盘后重新 load 读回无标记 ----------
test('清完落盘后，重新 loadStore 读回无标记（重启恢复）', () => {
  造一条('cf-s4', 'm4', { stableChecked: true, type: 'misc' })
  const d = store.loadStoreJSON('cf-s4')
  const 条 = d.memories.find((m) => String(m.id) === 'm4')
  delete 条.stableChecked
  delete 条.type
  store.saveStore('cf-s4', d, { 清字段: ['stableChecked', 'type'] })

  const 重读 = store.loadStoreJSON('cf-s4')
  const 看 = 重读.memories.find((m) => String(m.id) === 'm4')
  assert.ok(看, '条目还在')
  assert.equal(看.stableChecked, undefined, '重启后读回无 stableChecked')
  assert.equal(看.type, undefined, '重启后读回无 type')
})

// ---------- 5. 镜像一致性：清标记前后 SQL memory 表逐行相同 ----------
test('清标记不改镜像：SQL memory 表前后逐行相同', () => {
  const 库 = sql.库文件路径(dir)
  造一条('cf-s5', 'm5', { stableChecked: true })
  const db = new DatabaseSync(库)
  try {
    const 前 = db.prepare('SELECT * FROM memory ORDER BY scope, session_id, id').all()
    assert.ok(前.length >= 1, '前置：镜像里有行')

    const d = store.loadStoreJSON('cf-s5')
    delete d.memories.find((m) => String(m.id) === 'm5').stableChecked
    store.saveStore('cf-s5', d, { 清字段: ['stableChecked'] })

    const 后 = db.prepare('SELECT * FROM memory ORDER BY scope, session_id, id').all()
    assert.deepEqual(后, 前, 'stableChecked 不在镜像列里，清标记不改变任何一行')
  } finally {
    db.close()
  }
})

// ---------- 6. 路由级：撤销「别记」真撤掉（同病根的另一个入口） ----------
function 收集路由(注册, 环) {
  const 表 = new Map()
  注册((path, handler) => 表.set(path, handler), 环)
  return 表
}
function 假响应() {
  const r = { 码: 0, 头: {}, 体: '' }
  r.writeHead = (码, 头) => { r.码 = 码; r.头 = 头 || {} }
  r.end = (s) => { r.体 = s }
  return r
}
async function 打(handler, body) {
  const res = 假响应()
  await handler({ url: '/x', body: JSON.stringify(body) }, res)
  return { 码: res.码, 体: JSON.parse(res.体) }
}
const 核心环 = { ctx: {}, 读JSON体: async (req) => JSON.parse(req.body), mounted: new Map(), tick: () => {}, 同步工具: () => {}, 自查更新: { check: async () => ({}) } }
const 核心路由 = 收集路由(core.注册核心路由, 核心环)

test('/mark-wrong undo：撤销别记真的撤掉了（不会被合并补回）', async () => {
  造一条('cf-s6', 'm6', {}, 'event')
  const 标 = await 打(核心路由.get('/dsh-clay-memory/mark-wrong'), { session: 'cf-s6', id: 'm6' })
  assert.equal(标.体.ok, true)
  assert.ok(盘上('cf-s6', 'm6').别记, '前置：标记落盘')

  const 撤 = await 打(核心路由.get('/dsh-clay-memory/mark-wrong'), { session: 'cf-s6', id: 'm6', undo: true })
  assert.equal(撤.体.ok, true)
  assert.equal(盘上('cf-s6', 'm6').别记, undefined, '撤销后盘上不再有别记（不被补状态补回）')
})
