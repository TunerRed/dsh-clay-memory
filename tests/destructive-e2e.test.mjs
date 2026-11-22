// tests/destructive-e2e.test.mjs —— 破坏性操作端到端（2026-11-15）
//
// 为什么要这一层：今天漏掉的 bug 全在「链路」上——单测各自绿，
// 但没人真的跑过「清空 → 去回收站 → 找回来」这条路径。
// 这里只用**临时 DSH_HOME** 里的合成数据，绝不碰调用方的库。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'fish-destr-'))
process.env.DSH_HOME = home
const store = await import('../lib/store-core.mjs')
const paths = await import('../lib/paths.mjs')
const admin = await import('../lib/routes-admin.mjs')
const dir = join(home, 'clay-memory')
mkdirSync(dir, { recursive: true })
store.接报信(() => {})

const 读文件 = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null)
const 读会话 = (sid) => 读文件(paths.storePath(sid))

function 造一条(sid, id, 附加 = {}) {
  const data = store.loadStoreJSON(sid)
  data.memories.push({
    id,
    text: '这条是 ' + id + ' 的内容',
    category: 'event',
    importance: 0.5,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...附加,
  })
  store.saveStore(sid, data)
}

function 收集路由(注册, 环) {
  const 表 = new Map()
  注册((path, handler) => 表.set(path, handler), 环)
  return 表
}
function 假响应() {
  const r = { 码: 0, 头: {}, 体: '' }
  r.writeHead = (码, 头) => {
    r.码 = 码
    r.头 = 头 || {}
  }
  r.end = (s) => {
    r.体 = s
  }
  return r
}
async function 打(handler, body) {
  const res = 假响应()
  await handler({ url: '/x', method: 'POST', body: JSON.stringify(body || {}) }, res)
  return { 码: res.码, 体: JSON.parse(res.体) }
}
async function 取(handler, url = '/x') {
  const res = 假响应()
  await handler({ url, method: 'GET', body: '' }, res)
  return { 码: res.码, 体: JSON.parse(res.体) }
}

// 环 只给路由自己用得到的东西；ctx 给空壳，取不到标题会退回短号
const 环 = {
  ctx: {},
  读JSON体: async (req) => JSON.parse(req.body || '{}'),
  mounted: new Map(),
  tick: () => {},
  同步工具: () => {},
  自查更新: { check: async () => ({}) },
}
const 表 = 收集路由(admin.注册管理路由, 环)

test('清空：没写「清空」二字就拒绝，且一条都不许动', async () => {
  造一条('de-s1', 'm1')
  const r = await 打(表.get('/dsh-clay-memory/clear'), { scope: 'session', session: 'de-s1' })
  assert.equal(r.体.ok, false)
  assert.equal(读会话('de-s1').memories.length, 1, '拒绝后库里必须原样')
})

test('清空 → 进回收站 → 找回来（整链路）', async () => {
  造一条('de-s2', 'm1')
  造一条('de-s2', 'm2')

  const 清 = await 打(表.get('/dsh-clay-memory/clear'), { scope: 'session', session: 'de-s2', confirm: '清空' })
  assert.equal(清.体.ok, true, 清.体.message)
  assert.equal(清.体.清空, 2, '两条都该被清')

  const 盘 = 读会话('de-s2')
  assert.equal(盘.memories.length, 0, '活跃区清空')
  assert.equal(盘.deleted.length, 2, '两条都进回收站')
  assert.ok(
    盘.deleted.every((m) => m.deletedAt && m.批量删的 && m.清空的),
    '回收站里要留时间与来源标记',
  )
  assert.ok(existsSync(paths.storePath('de-s2') + '.bak'), '动之前留了 .bak')

  // 回收站接口能查到（页面就靠它）
  const 站 = await 取(表.get('/dsh-clay-memory/recycle-bin'))
  assert.equal(站.体.ok, true)
  assert.ok(
    站.体.items.some((it) => it.id === 'm1' && it.file === 'de-s2.json' && it.来源类型 === 'session'),
    '回收站里要能看到 m1',
  )

  // 找回一条
  const 找 = await 打(表.get('/dsh-clay-memory/recycle-bin'), { file: 'de-s2.json', id: 'm1' })
  assert.equal(找.体.ok, true, 找.体.message)
  const 盘2 = 读会话('de-s2')
  assert.equal(盘2.memories.length, 1, 'm1 回到活跃区')
  assert.equal(盘2.memories[0].id, 'm1')
  assert.equal(盘2.deleted.length, 1, '回收站少一条')
})

test('重复清空是幂等的：第二次只清掉剩下那条，第三次就是 0', async () => {
  const 二 = await 打(表.get('/dsh-clay-memory/clear'), { scope: 'session', session: 'de-s2', confirm: '清空' })
  assert.equal(二.体.ok, true)
  assert.equal(二.体.清空, 1, '只剩 m1 在活跃区')

  const 三 = await 打(表.get('/dsh-clay-memory/clear'), { scope: 'session', session: 'de-s2', confirm: '清空' })
  assert.equal(三.体.ok, true)
  assert.equal(三.体.清空, 0, '空库再清是 0')
  assert.equal(读会话('de-s2').deleted.length, 2, '回收站里还是原来那两条，没重复入站')
})

test('清空全部：只动库文件，不留半个文件', async () => {
  造一条('de-s3', 'm3')
  const 全 = await 打(表.get('/dsh-clay-memory/clear'), { confirm: '清空' })
  assert.equal(全.体.ok, true)
  assert.ok(全.体.库 >= 2, '至少两个库被清')
  assert.equal(读会话('de-s3').memories.length, 0)
  assert.equal(读会话('de-s3').deleted.length, 1)
})

test('找回不存在的条目：报错但不改库', async () => {
  const 前 = 读会话('de-s3')
  const r = await 打(表.get('/dsh-clay-memory/recycle-bin'), { file: 'de-s3.json', id: '不存在' })
  assert.equal(r.体.ok, false)
  assert.ok(/没有/.test(r.体.message), '应该说明回收站没这条：' + r.体.message)
  assert.deepEqual(读会话('de-s3'), 前, '库必须原样')
})
