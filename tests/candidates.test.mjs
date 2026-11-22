// 1.11.0 一期 §4.8 候选钩子：只标候选、不写正式记忆
//   要点：① 只在本回合没调 remember 时才记候选（调过了说明她自己判断过）
//        ② 同文本 30 天不重复、一天最多 10 条
//        ③ 采纳才进正式记忆，且走跟 remember 一样的去重口径（近乎重复只提示不新增）
//        ④ 丢弃留痕，7 天后列表里不再出现
import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const 家 = mkdtempSync(join(tmpdir(), 'clay-cand-'))
process.env.DSH_HOME = 家
const 库目录 = join(家, 'clay-memory')
mkdirSync(库目录, { recursive: true })

const 候选 = await import('../lib/candidates.mjs')
// 每个用例从空候选表开始（候选有「一天最多 10 条」的额度，共用一张表会互相挤）
const 清空候选 = () => writeFileSync(join(库目录, '_candidates.json'), JSON.stringify({ items: [] }))
const { 注册管理路由 } = await import('../lib/routes-admin.mjs')

test('线索：承诺 / 偏好 / 身份 / 性质四类认得出来，闲聊不认', () => {
  assert.equal(候选.找线索('我下周三去北京出差').类, 'commitment')
  assert.equal(候选.找线索('我更喜欢热麦茶').类, 'preference')
  assert.equal(候选.找线索('我在剧场后台做灯光').类, 'identity')
  assert.equal(候选.找线索('今天中午吃了盖浇饭'), null, '日常琐事不记候选')
  assert.equal(候选.找线索(''), null)
})

test('候选：同文本 30 天不重复，一天最多 10 条', () => {
  清空候选()
  const now = Date.now()
  const a = 候选.加候选({ text: '下周三把扳手还她', hint: { 类: 'commitment' }, session: 's1', now })
  assert.equal(a.ok, true)
  const b = 候选.加候选({ text: '下周三把扳手还她！', hint: { 类: 'commitment' }, session: 's1', now })
  assert.equal(b.ok, false)
  assert.equal(b.why, 'dup')
  // 塞满当天额度
  for (let i = 0; i < 12; i++) 候选.加候选({ text: '第 ' + i + ' 条不同的偏好：喜欢 ' + i, session: 's2', now })
  const list = 候选.候选列表(now)
  assert.ok(list.length <= 候选.候选一天上限, '一天最多 ' + 候选.候选一天上限 + ' 条，实际 ' + list.length)
})

test('采纳：转成正式记忆；近乎重复的不重复新增', async () => {
  清空候选()
  const now = Date.now()
  // 准备一个会话库
  writeFileSync(
    join(库目录, 's9.json'),
    JSON.stringify({
      version: 2,
      purgeEpoch: '',
      policy: {},
      memories: [{ id: 'm1', text: '借了阿岑一把活动扳手', at: '2026-01-05T11:10:00.000Z' }],
      deleted: [],
      traces: [],
    }),
  )
  const r1 = 候选.加候选({ text: '我住四楼，楼梯很窄', hint: { 类: 'identity' }, session: 's9', now })
  assert.equal(r1.ok, true)

  const 表 = new Map()
  注册管理路由((p, h) => 表.set(p, h), {
    ctx: {},
    读JSON体: async (req) => req.body || {},
    路径在允许范围: () => true,
  })
  const 调 = (路径, 体) =>
    new Promise((resolve) => {
      const res = { writeHead() {}, end: (t) => resolve(JSON.parse(String(t))) }
      表.get(路径)({ body: 体 }, res)
    })

  const ok = await 调('/dsh-clay-memory/candidates', { action: 'adopt', id: r1.item.id, session: 's9' })
  assert.equal(ok.ok, true)
  const 库 = JSON.parse(readFileSync(join(库目录, 's9.json'), 'utf8'))
  assert.ok(库.memories.some((m) => m.text.indexOf('四楼') >= 0), '采纳后要进库')
  assert.ok(库.memories.some((m) => m.source === '候选采纳'))

  // 跟库里已有的几乎一样 → 不新增
  const r2 = 候选.加候选({ text: '借了阿岑一把活动扳手', hint: { 类: 'commitment' }, session: 's9', now })
  const dup = await 调('/dsh-clay-memory/candidates', { action: 'adopt', id: r2.item.id, session: 's9' })
  assert.equal(dup.ok, true)
  assert.ok(dup.message.indexOf('已经有几乎一样的') >= 0, dup.message)
  const 库2 = JSON.parse(readFileSync(join(库目录, 's9.json'), 'utf8'))
  assert.equal(库2.memories.filter((m) => m.text.indexOf('活动扳手') >= 0).length, 1)
})

test('丢弃：列表里不再出现，但文件里留痕', async () => {
  清空候选()
  const now = Date.now()
  const r = 候选.加候选({ text: '我讨厌香菜', hint: { 类: 'preference' }, session: 's3', now })
  const 表 = new Map()
  注册管理路由((p, h) => 表.set(p, h), {
    ctx: {},
    读JSON体: async (req) => req.body || {},
    路径在允许范围: () => true,
  })
  const 调 = (路径, 体) =>
    new Promise((resolve) => {
      const res = { writeHead() {}, end: (t) => resolve(JSON.parse(String(t))) }
      表.get(路径)({ body: 体 }, res)
    })
  const d = await 调('/dsh-clay-memory/candidates', { action: 'drop', id: r.item.id })
  assert.equal(d.ok, true)
  assert.equal(候选.候选列表(now).some((x) => x.id === r.item.id), false)
  const 原 = JSON.parse(readFileSync(join(库目录, '_candidates.json'), 'utf8'))
  assert.ok(原.items.some((x) => x.id === r.item.id && x.droppedAt), '丢弃要留痕')
})

test('本回合记没记过：remember 打点之后算记过', () => {
  const t0 = Date.now() - 1000
  assert.equal(候选.本回合记过没('sX', t0), false)
  候选.标本回合记过('sX')
  assert.equal(候选.本回合记过没('sX', t0), true)
  assert.equal(候选.本回合记过没('sY', t0), false, '别的会话不受影响')
})
