import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// 只用合成的库和假宿主；绝不碰调用方的 DSH_HOME。
const home = mkdtempSync(join(tmpdir(), 'fish-infer-'))
process.env.DSH_HOME = home
const core = await import('../lib/routes-core.mjs')
const admin = await import('../lib/routes-admin.mjs')
const store = await import('../lib/store-core.mjs')
const sql = await import('../lib/storage.js')
const dir = join(home, 'clay-memory')
mkdirSync(dir, { recursive: true })

// —— 假宿主：mroute 收集器 + 假 res ——
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
const 管理环 = { ctx: {}, 读JSON体: async (req) => JSON.parse(req.body), 路径在允许范围: () => true }
const 核心路由 = 收集路由(core.注册核心路由, 核心环)
const 管理路由 = 收集路由(admin.注册管理路由, 管理环)

const 读会话 = (sid) => JSON.parse(readFileSync(join(dir, sid + '.json'), 'utf8'))

// 读视图只认「镜像有货」标记（1.8.28）
function 标记有货(文件) {
  const db = new DatabaseSync(文件)
  db.prepare("insert or replace into kv (k, v) values ('mirrored', '1')").run()
  db.close()
}

// ---------- 1. 默认不注入 ----------
test('滤掉推测：只摘 type=inference，普通记忆和坏行保留', () => {
  const 进去 = [
    { id: 'a', type: 'event', text: '普通' },
    { id: 'b', type: 'inference', text: '推测' },
    null,
    { id: 'c', text: '没类型' },
  ]
  const 出来 = store.滤掉推测(进去)
  assert.deepEqual(出来.map((m) => m && m.id), ['a', null, 'c'], '坏行保留给下游处理（与注入路径旧逻辑一致）')
})

// ---------- 2. /add 透传 + 全局拒绝 ----------
test('/add inference：证据引用真实记忆、字段透传落库，status 强制 pending', async () => {
  // 先造两条真实证据记忆
  const 甲 = await 打(核心路由.get('/dsh-clay-memory/add'), { session: 's-infer', text: '用户用命令行跑过很多次任务' })
  const 乙 = await 打(核心路由.get('/dsh-clay-memory/add'), { session: 's-infer', text: '用户说终端比界面顺手' })
  assert.equal(甲.码, 200)
  assert.equal(乙.码, 200)
  const { 码, 体 } = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 's-infer',
    text: '用户可能更喜欢命令行操作',
    type: 'inference',
    scope: 'session',
    evidence: [甲.体.id, 乙.体.id],
    confidence: '中',
    status: 'confirmed', // 客户端想直接采信 —— 不生效，服务端强制 pending
    推断域: 'workspace:命令行工具',
  })
  assert.equal(码, 200)
  const 条 = 读会话('s-infer').memories.find((m) => m.id === 体.id)
  assert.equal(条.type, 'inference')
  assert.equal(条.category, 'event')
  assert.deepEqual(条.evidence, [甲.体.id, 乙.体.id])
  assert.equal(条.confidence, '中')
  assert.equal(条.status, 'pending', '创建时状态只能服务端定 pending')
  assert.equal(条.provenance, 'model_inference')
  assert.equal(条.推断域, 'workspace:命令行工具')
})

test('/add inference + global：400 拒绝（推测不是事实）', async () => {
  const { 码, 体 } = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 's-infer',
    text: '用户可能更喜欢命令行操作',
    type: 'inference',
    scope: 'global',
  })
  assert.equal(码, 400)
  assert.match(体.error, /不能存成全局记忆/)
})

test('/add inference 证据不足两条 / 全无效：400 拒绝', async () => {
  // 不传证据
  let { 码, 体 } = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 's-infer',
    text: '用户最近工作节奏偏快',
    type: 'inference',
    confidence: '极高', // 不在白名单 → 低
  })
  assert.equal(码, 400)
  assert.match(体.error, /至少两条有效证据/)
  // 传不存在的 id（全无效）
  ;({ 码, 体 } = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 's-infer',
    text: '用户最近工作节奏偏快',
    type: 'inference',
    evidence: ['不存在的记忆', '也没有这条'],
  }))
  assert.equal(码, 400)
  assert.match(体.error, /至少两条有效证据/)
  // 同一条 id 传两次：去重后只有一条 → 仍不足两条
  const 甲 = await 打(核心路由.get('/dsh-clay-memory/add'), { session: 's-infer', text: '证据甲' })
  ;({ 码, 体 } = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 's-infer',
    text: '用户最近工作节奏偏快',
    type: 'inference',
    evidence: [甲.体.id, 甲.体.id],
  }))
  assert.equal(码, 400)
  assert.match(体.error, /至少两条有效证据/)
})

// ---------- 3. 镜像 round-trip ----------
test('镜像：extra_json 打包/解包，推测字段 json↔sql 形状一致', () => {
  const 文件 = join(mkdtempSync(join(tmpdir(), 'clay-')), 'infer.db')
  const db = new DatabaseSync(文件)
  sql.确保镜像表(db)
  const 插 = db.prepare(
    'INSERT OR REPLACE INTO memory (id,scope,session_id,text,at,created_at,importance,source,category,type,fact_key,related_json,extra_json,text_before,refined,refined_skip,superseded_why,wrong,ord,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  )
  插.run(
    'inf1', 'session', 's-infer', '用户可能更喜欢命令行操作', '2026-10-31T00:00:00Z', null, 0.5, '模型',
    'event', 'inference', '', '[]',
    JSON.stringify({ evidence: ['mm-1', 'mm-2'], confidence: '中', status: 'confirmed', 推断域: 'cli', provenance: 'model_inference', confirmedAt: '2026-10-31T01:00:00Z' }),
    null, 0, 0, '', '', 0, null,
  )
  插.run(
    'inf2', 'session', 's-infer', '普通事件', null, null, 0.5, '', 'event', '', '', '[]', null,
    null, 0, 0, '', '', 1, null,
  )
  sql.记镜像有货(db)
  db.close()
  const 视图 = sql.读SQL视图同步(文件, 's-infer')
  const inf = 视图.memories.find((m) => m.id === 'inf1')
  const 普通 = 视图.memories.find((m) => m.id === 'inf2')
  assert.deepEqual(inf.evidence, ['mm-1', 'mm-2'])
  assert.equal(inf.confidence, '中')
  assert.equal(inf.status, 'confirmed')
  assert.equal(inf.推断域, 'cli')
  assert.equal(inf.provenance, 'model_inference')
  assert.equal(inf.confirmedAt, '2026-10-31T01:00:00Z')
  assert.equal(普通.evidence, undefined, '非推测条目不该有推测字段')
})

// ---------- 4. /inference 管理路由 ----------
test('/inference list：只列推测条目', async () => {
  const { 码, 体 } = await 打(管理路由.get('/dsh-clay-memory/inference'), { session: 's-infer', action: 'list' })
  assert.equal(码, 200)
  const ids = 体.推测.map((m) => m.id).sort()
  assert.deepEqual(ids, [读会话('s-infer').memories.filter((m) => m.type === 'inference').map((m) => m.id)].flat().sort())
  const 条 = 体.推测[0]
  assert.ok('confidence' in 条 && 'status' in 条 && 'evidence' in 条)
})

test('/inference confirm/reject：状态机落盘', async () => {
  const 全部 = 读会话('s-infer').memories
  const 目标 = 全部.find((m) => m.type === 'inference')
  // confirm
  let { 码, 体 } = await 打(管理路由.get('/dsh-clay-memory/inference'), { session: 's-infer', action: 'confirm', id: 目标.id })
  assert.equal(码, 200)
  assert.equal(体.status, 'confirmed')
  let 盘 = 读会话('s-infer').memories.find((m) => m.id === 目标.id)
  assert.equal(盘.status, 'confirmed')
  assert.ok(盘.confirmedAt)
  // reject
  ;({ 码, 体 } = await 打(管理路由.get('/dsh-clay-memory/inference'), { session: 's-infer', action: 'reject', id: 目标.id }))
  assert.equal(码, 200)
  assert.equal(体.status, 'rejected')
  盘 = 读会话('s-infer').memories.find((m) => m.id === 目标.id)
  assert.equal(盘.status, 'rejected')
  assert.ok(盘.rejectedAt)
})

test('/inference 非法 action / 找不到 id：明确报错', async () => {
  const { 码, 体 } = await 打(管理路由.get('/dsh-clay-memory/inference'), { session: 's-infer', action: 'hack' })
  assert.equal(码, 200)
  assert.equal(体.ok, false)
  assert.match(体.message, /只认 list \/ confirm \/ reject \/ promote/)
  const 二 = await 打(管理路由.get('/dsh-clay-memory/inference'), { session: 's-infer', action: 'confirm', id: '不存在' })
  assert.equal(二.码, 200)
  assert.equal(二.体.ok, false)
  assert.match(二.体.message, /没找到/)
})

test('/inference 失效证据可识别：删掉证据记忆后 list 标出', async () => {
  // 造证据 + 推测
  const 甲 = await 打(核心路由.get('/dsh-clay-memory/add'), { session: 's-infer2', text: '证据甲' })
  const 乙 = await 打(核心路由.get('/dsh-clay-memory/add'), { session: 's-infer2', text: '证据乙' })
  const 推 = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 's-infer2',
    text: '推测条目',
    type: 'inference',
    evidence: [甲.体.id, 乙.体.id],
  })
  assert.equal(推.码, 200)
  // 删掉一条证据（进墓碑）
  const 删 = await 打(管理路由.get('/dsh-clay-memory/delete'), { session: 's-infer2', id: 甲.体.id })
  assert.equal(删.码, 200)
  // list：失效证据要标出来
  const { 码, 体 } = await 打(管理路由.get('/dsh-clay-memory/inference'), { session: 's-infer2', action: 'list' })
  assert.equal(码, 200)
  const 条 = 体.推测.find((m) => m.id === 推.体.id)
  assert.ok(条, '推测还在')
  assert.deepEqual(条.失效证据, [甲.体.id], '被删的证据要标为失效')
})

test('/inference promote：转正才进正常流程，来源可追溯', async () => {
  const 甲 = await 打(核心路由.get('/dsh-clay-memory/add'), { session: 's-promo', text: '证据甲' })
  const 乙 = await 打(核心路由.get('/dsh-clay-memory/add'), { session: 's-promo', text: '证据乙' })
  const 推 = await 打(核心路由.get('/dsh-clay-memory/add'), {
    session: 's-promo',
    text: '用户偏好终端',
    type: 'inference',
    evidence: [甲.体.id, 乙.体.id],
  })
  assert.equal(推.码, 200)
  // 转正前：默认不注入
  let 盘 = 读会话('s-promo')
  assert.equal(store.滤掉推测(盘.memories).some((m) => m && m.id === 推.体.id), false, '转正前不注入')
  // confirm 只改状态：仍按推测处理
  const 确 = await 打(管理路由.get('/dsh-clay-memory/inference'), { session: 's-promo', action: 'confirm', id: 推.体.id })
  assert.equal(确.码, 200)
  盘 = 读会话('s-promo')
  const 确认后 = 盘.memories.find((m) => m.id === 推.体.id)
  assert.equal(确认后.status, 'confirmed')
  assert.equal(确认后.type, 'inference')
  assert.equal(store.滤掉推测(盘.memories).some((m) => m && m.id === 推.体.id), false, '确认后仍不注入')
  // promote：转正进入正常流程，证据保留
  const 转 = await 打(管理路由.get('/dsh-clay-memory/inference'), { session: 's-promo', action: 'promote', id: 推.体.id, type: 'preference' })
  assert.equal(转.码, 200)
  assert.equal(转.体.type, 'preference')
  盘 = 读会话('s-promo')
  const 转正后 = 盘.memories.find((m) => m.id === 推.体.id)
  assert.equal(转正后.type, 'preference')
  assert.equal(转正后.promotedFrom, 'inference')
  assert.ok(转正后.promotedAt)
  assert.deepEqual(转正后.evidence, [甲.体.id, 乙.体.id], '来源证据保留')
  assert.equal(store.滤掉推测(盘.memories).some((m) => m && m.id === 推.体.id), true, '转正后进入正常注入视图')
})
