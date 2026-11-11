// 1.12.0 骨架投影：`_core.json` 降为「主库的投影」
//   要点：① 只有事实层（stable_profile）里重要度够高的才够格进骨架
//        ② 比对只算「差在哪」：新增 / 已有 / 可下线（core:true 永不下线）
//        ③ 写回必须手动 apply，且先留 .bak
import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const 家 = mkdtempSync(join(tmpdir(), 'clay-coreproj-'))
process.env.DSH_HOME = 家
const 库目录 = join(家, 'clay-memory')
mkdirSync(库目录, { recursive: true })

const { 骨架候选, 比对骨架, 并入骨架 } = await import('../lib/core-projection.mjs')
const { 注册管理路由 } = await import('../lib/routes-admin.mjs')

const 库 = (memories) => ({ version: 2, purgeEpoch: '', policy: {}, memories, deleted: [], traces: [] })
const 写 = (名, d) => writeFileSync(join(库目录, 名), JSON.stringify(d))
const 读 = (名) => JSON.parse(readFileSync(join(库目录, 名), 'utf8'))

test('骨架候选：只认事实层、重要度够、还活着、最多 6 条', () => {
  const 候选 = 骨架候选([
    { id: 'a', text: '主人攒钱是为了买具身智能', category: 'stable_profile', importance: 0.9 },
    { id: 'b', text: '主人喜欢大白饭', category: 'stable_profile', importance: 0.85 },
    { id: 'c', text: '某天出差', category: 'event', importance: 0.95 },
    { id: 'd', text: '一般般的事', category: 'stable_profile', importance: 0.3 },
    { id: 'e', text: '已被取代的事', category: 'stable_profile', importance: 0.99, 已被取代: true },
    { id: 'f', text: '工具链用 pnpm', category: 'workspace', importance: 0.95 },
    { id: 'g', text: '别记的', category: 'stable_profile', importance: 0.95, 别记: true },
  ])
  assert.deepStrictEqual(候选.map((c) => c.content), ['主人攒钱是为了买具身智能', '主人喜欢大白饭'])
})

test('骨架候选：上限 6，且候选之间也去重', () => {
  // 注意：同一句话的近似改写会被 0.85 判成同一条 —— 这里故意用彼此不相干的句子
  const 句子 = [
    '主人喜欢大白饭',
    '主人在攒钱买具身智能',
    '主人家有只橘猫叫团子',
    '主人周五坐高铁去北京出差',
    '主人玩崩坏星穹铁道',
    '主人早上要喝热麦茶',
    '主人讨厌下雨天',
    '主人用的是 Windows 桌面',
    '主人午睡容易睡过头',
  ]
  const 多 = 句子.map((t, i) => ({ id: 'x' + i, text: t, category: 'stable_profile', importance: 0.9 - i * 0.01 }))
  多.unshift({ id: 'dup', text: '主人喜欢大白饭', category: 'stable_profile', importance: 0.99 })
  const 出 = 骨架候选(多)
  assert.strictEqual(出.length, 6)
  assert.strictEqual(出.filter((x) => x.content === '主人喜欢大白饭').length, 1)
  assert.strictEqual(出[0].content, '主人喜欢大白饭') // 重要度高的在前
})

test('比对：新增 / 已有 / 可下线，核心画像永不下线', () => {
  const 现有 = [
    { content: '她是鲸鱼娘，蓝色女仆装', core: true, importance: 1 },
    { content: '主人喜欢大白饭', importance: 0.7 },
    { content: '这段是我手写的、主库挑不出来的风格说明' },
  ]
  const 候选 = [
    { content: '主人喜欢大白饭', importance: 0.85 },
    { content: '主人攒钱是为了买具身智能', importance: 0.9 },
  ]
  const r = 比对骨架(现有, 候选)
  assert.strictEqual(r.新增.length, 1)
  assert.match(r.新增[0].content, /攒钱/)
  assert.strictEqual(r.已有.length, 1)
  assert.strictEqual(r.可下线.length, 1)
  assert.match(r.可下线[0].content, /手写的/)
})

test('并入：下线移走、已有保留原顺序、新增追加在末尾', () => {
  const 新 = 并入骨架(
    [{ content: 'A', core: true }, { content: 'B' }, { content: 'C' }],
    { 新增: [{ content: 'D', importance: 0.9 }], 可下线: [{ content: 'B' }] },
  )
  assert.deepStrictEqual(新.map((x) => x.content), ['A', 'C', 'D'])
  assert.strictEqual(新[2].来源, '主库投影')
})

test('路由：GET 只算不写；POST apply 才写，且留 .bak', async () => {
  写('_facts.json', 库([{ id: 'f1', text: '主人喜欢大白饭', category: 'stable_profile', importance: 0.9 }]))
  const 骨架路径 = join(库目录, '_core.json')
  writeFileSync(骨架路径, JSON.stringify({ items: [{ content: '她是鲸鱼娘', core: true }] }))
  const 原字节 = readFileSync(骨架路径, 'utf8')

  const 表 = new Map()
  注册管理路由((p, h) => 表.set(p, h), {
    ctx: {},
    读JSON体: async (req) => req.body || {},
    路径在允许范围: () => true,
  })
  const 调 = (体) =>
    new Promise((resolve) => {
      const res = { writeHead() {}, end: (t) => resolve(JSON.parse(String(t))) }
      表.get('/dsh-clay-memory/core-preview')({ method: 体 ? 'POST' : 'GET', body: 体 }, res)
    })

  const 预览 = await 调(null)
  assert.strictEqual(预览.ok, true)
  assert.strictEqual(预览.新增.length, 1)
  assert.strictEqual(readFileSync(骨架路径, 'utf8'), 原字节) // GET 不许动文件

  const r = await 调({ action: 'apply' })
  assert.strictEqual(r.ok, true)
  const 后 = JSON.parse(readFileSync(骨架路径, 'utf8'))
  assert.deepStrictEqual(后.items.map((x) => x.content), ['她是鲸鱼娘', '主人喜欢大白饭'])
  assert.ok(existsSync(骨架路径 + '.bak'))
})
