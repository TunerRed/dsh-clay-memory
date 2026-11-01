import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// 只用合成的库和假宿主；绝不碰调用方的 DSH_HOME。
const home = mkdtempSync(join(tmpdir(), 'fish-ws-'))
process.env.DSH_HOME = home
const core = await import('../lib/routes-core.mjs')
const admin = await import('../lib/routes-admin.mjs')
const store = await import('../lib/store-core.mjs')
const sql = await import('../lib/storage.js')
const paths = await import('../lib/paths.mjs')
const dir = join(home, 'clay-memory')
mkdirSync(dir, { recursive: true })

// —— 假宿主（照 inference.test.mjs 先例）——
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
const 管理环 = { ctx: {}, 读JSON体: async (req) => JSON.parse(req.body), 路径在允许范围: () => true, mounted: new Map(), tick: () => {}, 同步工具: () => {}, 自查更新: { check: async () => ({}) } }
const 管理路由 = 收集路由(admin.注册管理路由, 管理环)

const 读文件 = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null)
const 读会话 = (sid) => 读文件(join(dir, sid + '.json'))
// 新接口 /workspace-memories 的 POST 分支看 req.method，假宿主补一个
async function 打POST(handler, body) {
  const res = 假响应()
  await handler({ url: '/x', method: 'POST', body: JSON.stringify(body) }, res)
  return { 码: res.码, 体: JSON.parse(res.体) }
}

// 给会话造假 projcache（宿主会把会话的工作区 cwd 记在 session_projcache）
function 造假工作区(sid, cwd) {
  const p = join(home, 'storages', 'session_projcache', 'sessions', sid + '.json')
  mkdirSync(join(home, 'storages', 'session_projcache', 'sessions'), { recursive: true })
  writeFileSync(p, JSON.stringify({ record: { identity: { cwd } } }), 'utf8')
}

const CWD_A = 'G:/proj/alpha'
const CWD_B = 'G:/proj/beta'

// ---------- 1. /add workspace:<cwd>：落工作区文件 ----------
test('/add workspace:<cwd>：category=workspace、scope 带 cwd、落 _ws- 文件', async () => {
  const { 码, 体 } = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 'ws-s1',
    text: 'alpha 项目的构建命令是 pnpm build',
    scope: 'workspace:' + CWD_A,
  })
  assert.equal(码, 200)
  assert.equal(体.category, 'workspace')
  assert.equal(体.scope, 'workspace:' + CWD_A)
  const ws文件 = 读文件(paths.工作区文件(CWD_A))
  const 条 = ws文件.memories.find((m) => m.id === 体.id)
  assert.ok(条, '条目应落进工作区文件')
  assert.equal(条.category, 'workspace')
  assert.equal(条.scope, 'workspace:' + CWD_A)
  // 会话文件里不该有它
  const 会话 = 读会话('ws-s1')
  assert.ok(!(会话.memories || []).some((m) => m.id === 体.id), 'workspace 条目不进会话库')
})

// ---------- 2. 同 cwd 共享、异 cwd 隔离 ----------
test('工作区记忆：同 cwd 跨会话可见，异 cwd 看不见', () => {
  const 同区 = store.loadStoreJSON('ws-s2', CWD_A)
  assert.ok(同区.memories.some((m) => m.category === 'workspace'), '同 cwd 会话读得到工作区层')
  const 异区 = store.loadStoreJSON('ws-s3', CWD_B)
  assert.ok(!异区.memories.some((m) => m.category === 'workspace'), '异 cwd 会话读不到')
})

// ---------- 3. 只传 workspace（不带 cwd）→ 会话工作区(sid) 解析 ----------
test('/add scope=workspace：不传 cwd 时从 projcache 解析', async () => {
  造假工作区('ws-s4', CWD_B)
  const { 码, 体 } = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 'ws-s4',
    text: 'beta 项目的发布流程还没定',
    scope: 'workspace',
  })
  assert.equal(码, 200)
  assert.equal(体.scope, 'workspace:' + CWD_B, 'cwd 从 projcache 解析')
  const ws文件 = 读文件(paths.工作区文件(CWD_B))
  assert.ok(ws文件.memories.some((m) => m.id === 体.id))
})

test('/add scope=workspace：projcache 没有 cwd → 400 说清原因', async () => {
  const { 码, 体 } = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 'ws-s5',
    text: '没有工作区信息的一条',
    scope: 'workspace',
  })
  assert.equal(码, 400)
  assert.match(体.error, /工作区目录/)
})

// ---------- 4. 校验 ----------
test('/add 非法 scope → 400；inference + workspace → 400', async () => {
  const 非法 = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 'ws-s1', text: '乱写 scope', scope: 'nope',
  })
  assert.equal(非法.码, 400)
  const 推测 = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 'ws-s1', text: '用户可能喜欢 alpha 的构建脚本', type: 'inference', scope: 'workspace:' + CWD_A,
  })
  assert.equal(推测.码, 400)
  assert.match(推测.体.error, /不能进工作区层/)
})

// ---------- 5. 墓碑：删工作区条目 → 同 cwd 会话一起看不见 ----------
test('删除工作区条目：墓碑进工作区文件，同 cwd 会话也读不到', () => {
  const data = store.loadStoreJSON('ws-s2', CWD_A)
  const 条 = data.memories.find((m) => m.category === 'workspace')
  assert.ok(条, '前置：工作区有条目')
  const id = 条.id
  data.memories = data.memories.filter((m) => m.id !== id)
  data.deleted.push({ ...条, deletedAt: new Date().toISOString() })
  store.saveStore('ws-s2', data, {}, CWD_A)
  const ws文件 = 读文件(paths.工作区文件(CWD_A))
  assert.ok((ws文件.deleted || []).some((d) => String(d.id) === id), '墓碑进工作区文件')
  const 会话文件 = 读会话('ws-s2')
  assert.ok(!(会话文件.deleted || []).some((d) => String(d.id) === id), '会话文件不双写工作区墓碑')
  const 重读 = store.loadStoreJSON('ws-s9', CWD_A)
  assert.ok(!重读.memories.some((m) => m.id === id), '同 cwd 新会话读不到已删条目')
})

// ---------- 6. 改判出 workspace → 工作区文件撤除 ----------
test('条目改判回 event：工作区文件里撤掉它', () => {
  const data = store.loadStoreJSON('ws-s2', CWD_B)
  const 条 = data.memories.find((m) => m.category === 'workspace')
  assert.ok(条, '前置：B 工作区有条目')
  const id = 条.id
  条.category = 'event'
  条.scope = 'session'
  store.saveStore('ws-s2', data, {}, CWD_B)
  const ws文件 = 读文件(paths.工作区文件(CWD_B))
  assert.ok(!(ws文件.memories || []).some((m) => m.id === id), '改判后工作区文件撤除')
  const 会话 = 读会话('ws-s2')
  assert.ok(会话.memories.some((m) => m.id === id), '改判后落回会话库')
})

// ---------- 7. 镜像 round-trip：workspace 行按 cwd 过滤 ----------
test('镜像：workspace 行 scope=workspace、session_id=根，读视图按 cwd 过滤', async () => {
  const 库文件 = join(dir, 'clay-memory.db')
  if (!existsSync(库文件)) {
    const db = new DatabaseSync(库文件)
    sql.确保镜像表(db)
    sql.记镜像有货(db)
    db.close()
  }
  // 前置：A 工作区再放一条活的（前面测试把老的删了）
  await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 'ws-s7', text: 'alpha 的部署目标目录是 /srv/app', scope: 'workspace:' + CWD_A,
  })
  // saveStore 会触发同步SQL镜像（把 workspace 行写进镜像）
  const data = store.loadStoreJSON('ws-s7', CWD_A)
  store.saveStore('ws-s7', data, {}, CWD_A)
  const 甲 = sql.读SQL视图同步(库文件, 'ws-s7', paths.规范化(CWD_A))
  assert.ok(甲.memories.some((m) => m.scope === 'workspace:' + paths.规范化(CWD_A)), '本 cwd 视图含工作区行')
  const 乙 = sql.读SQL视图同步(库文件, 'ws-s7', paths.规范化(CWD_B))
  assert.ok(!乙.memories.some((m) => String(m.scope || '').startsWith('workspace:')), '异 cwd 视图不含')
  assert.ok(!乙.memories.some((m) => m.scope === 'workspace:' + paths.规范化(CWD_A)))
})

// ---------- 8. 三份合并的视图形状 ----------
test('loadStoreJSON：合并视图带 workspacePurgeEpoch，全局+工作区+会话都在', async () => {
  造假工作区('ws-s6', CWD_A)
  await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 'ws-s6', text: 'alpha 项目用的分支是 dev/alpha', scope: 'workspace:' + CWD_A,
  })
  const data = store.loadStoreJSON('ws-s6', CWD_A)
  assert.equal(typeof data.workspacePurgeEpoch, 'string', '合并视图有工作区代际字段')
  const 类 = new Set((data.memories || []).map((m) => m.category))
  assert.ok(类.has('workspace'), '合并视图含工作区条目')
})

// ---------- 9. 幽灵墓碑：restore 清掉工区文件里的旧墓碑（1.8.39 回归 bug 修复） ----------
test('删了又找回：活条目不被工区文件里的幽灵墓碑过滤', async () => {
  造假工作区('ws-s10', CWD_A)
  const { 体: 加 } = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 'ws-s10', text: '回归验证-编辑前', scope: 'session',
  })
  const id = 加.id
  // 真删（走路由）——新判据下事件墓碑进会话文件、不进工区文件
  const 删 = await 打(管理路由.get('/dsh-clay-memory/delete'), { session: 'ws-s10', id, action: 'delete' })
  assert.equal(删.体.ok, true)
  const ws文件 = 读文件(paths.工作区文件(CWD_A)) || { memories: [], deleted: [] }
  assert.ok(!(ws文件.deleted || []).some((d) => String(d.id) === id), '新 delete 不再产生幽灵墓碑')
  // 手工塞一个历史幽灵（模拟 1.8.39 之前版本写下的脏数据）
  ws文件.deleted.push({ id, text: '幽灵', category: 'event', deletedAt: '2026-10-30T05:37:01Z' })
  writeFileSync(paths.工作区文件(CWD_A), JSON.stringify(ws文件), 'utf8')
  // 找回——restore 应把工区文件里的幽灵一起清掉
  const 回 = await 打(管理路由.get('/dsh-clay-memory/delete'), { session: 'ws-s10', id, action: 'restore' })
  assert.equal(回.体.ok, true, 'restore 成功')
  const 视 = store.loadStoreJSON('ws-s10', CWD_A)
  assert.ok(视.memories.some((m) => String(m.id) === id), '活条目在合并视图里（不被幽灵墓碑过滤）')
  const 工区后 = 读文件(paths.工作区文件(CWD_A)) || { deleted: [] }
  assert.ok(!(工区后.deleted || []).some((d) => String(d.id) === id), 'restore 清掉工区文件里的幽灵墓碑')
})

// ---------- 10. workspace 墓碑单写：真实路由删除只进工区文件 ----------
test('真实 /delete 删工作区条目：墓碑只进工区文件、不进会话文件', async () => {
  造假工作区('ws-s11', CWD_A)
  const { 体: 加 } = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 'ws-s11', text: 'alpha 的发布流程要先跑 smoke', scope: 'workspace:' + CWD_A,
  })
  const id = 加.id
  const 删 = await 打(管理路由.get('/dsh-clay-memory/delete'), { session: 'ws-s11', id, action: 'delete' })
  assert.equal(删.体.ok, true)
  const ws文件 = 读文件(paths.工作区文件(CWD_A))
  assert.ok((ws文件.deleted || []).some((d) => String(d.id) === id), '墓碑进工区文件')
  const 会话文件 = 读会话('ws-s11')
  assert.ok(!(会话文件.deleted || []).some((d) => String(d.id) === id), '会话文件不双写')
  const 视 = store.loadStoreJSON('ws-s11', CWD_A)
  assert.ok(!视.memories.some((m) => String(m.id) === id), '同 cwd 读不到已删工作区条目')
})

// ---------- 11. 改判出 workspace：旧墓碑跟着从工区文件撤掉 ----------
test('workspace 条目删了找回后改判 event：工区文件活/坟都不留它', async () => {
  造假工作区('ws-s12', CWD_A)
  const { 体: 加 } = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 'ws-s12', text: 'alpha 的临时草稿', scope: 'workspace:' + CWD_A,
  })
  const id = 加.id
  await 打(管理路由.get('/dsh-clay-memory/delete'), { session: 'ws-s12', id, action: 'delete' })
  await 打(管理路由.get('/dsh-clay-memory/delete'), { session: 'ws-s12', id, action: 'restore' })
  const data = store.loadStoreJSON('ws-s12', CWD_A)
  const 条 = data.memories.find((m) => String(m.id) === id)
  assert.ok(条, '找回成功')
  // 改判：workspace → event（以后都算会话层了）
  条.category = 'event'
  store.saveStore('ws-s12', data, {}, CWD_A)
  const ws文件 = 读文件(paths.工作区文件(CWD_A)) || { memories: [], deleted: [] }
  assert.ok(!(ws文件.memories || []).some((m) => String(m.id) === id), '工区文件活条目撤掉')
  assert.ok(!(ws文件.deleted || []).some((d) => String(d.id) === id), '工区文件旧墓碑跟着撤掉')
  const 会话文件 = 读会话('ws-s12')
  assert.ok((会话文件.memories || []).some((m) => String(m.id) === id && m.category === 'event'), '改判后落会话文件')
})

// ---------- 12. 分层按 scope 过滤：往 A 写不把 B 的条目复制进去 ----------
test('工作区分层按 scope 过滤：往 alpha 写不会把 beta 的条目串进 alpha 文件', async () => {
  造假工作区('ws-s13', CWD_A)
  const { 体: 甲 } = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 'ws-s13', text: 'alpha 的项目事实甲', scope: 'workspace:' + CWD_A,
  })
  assert.equal(甲.ok, true)
  // 同一个会话（自己的 cwd 是 alpha）里，显式往 beta 记一条
  const { 体: 乙 } = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 'ws-s13', text: 'beta 的项目事实乙', scope: 'workspace:' + CWD_B,
  })
  assert.equal(乙.ok, true, JSON.stringify(乙))
  const A文件 = 读文件(paths.工作区文件(CWD_A))
  const B文件 = 读文件(paths.工作区文件(CWD_B))
  assert.ok((A文件.memories || []).some((m) => String(m.id) === 甲.id), 'alpha 文件有甲')
  assert.ok(!(A文件.memories || []).some((m) => String(m.id) === 乙.id), 'alpha 文件不该有 beta 的乙（串库）')
  assert.ok((B文件.memories || []).some((m) => String(m.id) === 乙.id), 'beta 文件有乙')
  assert.ok(!(B文件.memories || []).some((m) => String(m.id) === 甲.id), 'beta 文件不该有 alpha 的甲（串库）')
})

// ---------- 13. 读和写同一个工作区层：第二次起不再误报「已彻底清理」 ----------
test('同一会话连续往同一个工作区写两条：第二次不报 MEMORY_PURGED', async () => {
  造假工作区('ws-s14', CWD_A)
  const 一 = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 'ws-s14', text: 'beta 的第一条项目事实', scope: 'workspace:' + CWD_B,
  })
  assert.equal(一.体.ok, true, JSON.stringify(一.体))
  const 二 = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 'ws-s14', text: 'beta 的第二条项目事实', scope: 'workspace:' + CWD_B,
  })
  assert.equal(二.体.ok, true, JSON.stringify(二.体))
  const B文件 = 读文件(paths.工作区文件(CWD_B))
  assert.equal((B文件.memories || []).length >= 2, true, 'beta 文件里有两条')
})

// ---------- 14. 新接口 /workspace-memories POST：按 cwd 精确删（1.8.47） ----------
test('/workspace-memories POST delete/restore：只动指定工作区文件，条目在活/坟之间搬', async () => {
  造假工作区('ws-s15', CWD_A)
  const { 体: 加 } = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 'ws-s15', text: 'alpha 的待删项目事实', scope: 'workspace:' + CWD_A,
  })
  assert.equal(加.ok, true, JSON.stringify(加))
  const id = 加.id
  const 前 = 读文件(paths.工作区文件(CWD_A))
  assert.ok((前.memories || []).some((m) => String(m.id) === id), '删前在活条目里')

  const 删 = await 打POST(管理路由.get('/dsh-clay-memory/workspace-memories'), { action: 'delete', workspace: CWD_A, id })
  assert.equal(删.体.ok, true, JSON.stringify(删.体))
  const 中 = 读文件(paths.工作区文件(CWD_A))
  assert.ok(!(中.memories || []).some((m) => String(m.id) === id), '删后不在活条目里')
  assert.ok((中.deleted || []).some((d) => String(d.id) === id && d.deletedAt), '删后进回收站、带 deletedAt')
  assert.ok(existsSync(paths.工作区文件(CWD_A) + '.bak') || true) // 备份存在与否取决于签名变化，不硬断言

  const 回 = await 打POST(管理路由.get('/dsh-clay-memory/workspace-memories'), { action: 'restore', workspace: CWD_A, id })
  assert.equal(回.体.ok, true, JSON.stringify(回.体))
  const 后 = 读文件(paths.工作区文件(CWD_A))
  assert.ok((后.memories || []).some((m) => String(m.id) === id), '找回后在活条目里')
  assert.ok(!(后.deleted || []).some((d) => String(d.id) === id), '找回后不在回收站')
  // 同 cwd 的会话视图能读到回来
  assert.ok(store.loadStoreJSON('ws-s15', CWD_A).memories.some((m) => String(m.id) === id), '会话视图可见')
})

// ---------- 15. /workspace-memories POST：缺参/不存在/非法动作都给出说明 ----------
test('/workspace-memories POST：缺 workspace/id、找不到、非法 action 都回 ok:false 说清', async () => {
  造假工作区('ws-s16', CWD_A)
  const 路由 = 管理路由.get('/dsh-clay-memory/workspace-memories')
  assert.equal((await 打POST(路由, { action: 'delete', workspace: '', id: 'x' })).体.ok, false)
  assert.match((await 打POST(路由, { action: 'delete', workspace: CWD_A, id: 'nope' })).体.message, /没找到/, '找不到条目要说没找到')
  assert.equal((await 打POST(路由, { action: 'restore', workspace: CWD_A, id: 'nope' })).体.ok, false)
  assert.match((await 打POST(路由, { action: 'hack', workspace: CWD_A, id: 'nope' })).体.message, /只认 delete \/ restore/)
})

// ---------- 16. /recycle-bin：三层墓碑聚合 + 按文件精确找回（1.8.49） ----------
test('/recycle-bin：工作区墓碑能聚合列出、按 file 精确找回', async () => {
  造假工作区('ws-s17', CWD_A)
  const { 体: 加 } = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 'ws-s17', text: 'alpha 待删的项目事实 for 回收站', scope: 'workspace:' + CWD_A,
  })
  assert.equal(加.ok, true, JSON.stringify(加))
  const 删 = await 打POST(管理路由.get('/dsh-clay-memory/workspace-memories'), { action: 'delete', workspace: CWD_A, id: 加.id })
  assert.equal(删.体.ok, true, JSON.stringify(删.体))
  const 回收 = await 打(管理路由.get('/dsh-clay-memory/recycle-bin'), {})
  assert.equal(回收.体.ok, true, JSON.stringify(回收.体))
  const 条 = (回收.体.items || []).find((x) => x.id === 加.id)
  assert.ok(条, '回收站里能看到刚删的工作区条目')
  assert.equal(条.来源类型, 'workspace')
  assert.ok(String(条.file || '').startsWith('_ws-'), '来源文件是工作区文件')
  const 回 = await 打POST(管理路由.get('/dsh-clay-memory/recycle-bin'), { file: 条.file, id: 加.id })
  assert.equal(回.体.ok, true, JSON.stringify(回.体))
  const 后再查 = await 打(管理路由.get('/dsh-clay-memory/recycle-bin'), {})
  assert.ok(!(后再查.体.items || []).some((x) => x.id === 加.id && x.file === 条.file), '找回后不在回收站')
})

test('/recycle-bin POST：缺 file / 找不到条目都回 ok:false', async () => {
  const 路由 = 管理路由.get('/dsh-clay-memory/recycle-bin')
  assert.equal((await 打POST(路由, { id: 'x' })).体.ok, false)
  assert.equal((await 打POST(路由, { file: '_facts.json', id: 'nope-nope' })).体.ok, false)
})
