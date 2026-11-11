// 1.10.3 F15 健康度：近 N 天注入了多少次、有几次真有东西、平均几条几个字
//   要点：① 只算窗口内的记录（旧的不能混进来）
//        ② 「有着落」= picked 非空；空注入里还分被问句门挡的
//        ③ 一条 trace 都读不出来时不许炸（给 0，而不是 500）
import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const 家 = mkdtempSync(join(tmpdir(), 'clay-health-'))
process.env.DSH_HOME = 家
const 库目录 = join(家, 'clay-memory')
mkdirSync(库目录, { recursive: true })

const { 注册管理路由 } = await import('../lib/routes-admin.mjs')

function 起路由() {
  const 表 = new Map()
  注册管理路由((p, h) => 表.set(p, h), {
    ctx: {},
    读JSON体: async (req) => req.body || {},
    路径在允许范围: () => true,
  })
  return 表
}

function 调(表, 路径) {
  return new Promise((resolve) => {
    const res = {
      writeHead() {},
      end(t) {
        resolve(JSON.parse(String(t)))
      },
    }
    表.get('/dsh-clay-memory/health')({ url: 路径, body: {} }, res)
  })
}

const 现在 = Date.now()
const 天前 = (n) => new Date(现在 - n * 86400000).toISOString()
const 行 = (o) => JSON.stringify(o) + '\n'

// 三个会话文件：s1 两条命中、一条空注入（被门挡）、一条太旧
writeFileSync(
  join(库目录, 's1.traces.jsonl'),
  行({ at: 天前(0), picked: [{ id: 'a' }, { id: 'b' }], 条: 2, 字: 120 }) +
    行({ at: 天前(1), picked: [{ id: 'c' }], 条: 1, 字: 60 }) +
    行({ at: 天前(2), picked: [], gate: true, 条: 0, 字: 0 }) +
    行({ at: 天前(30), picked: [{ id: 'z' }], 条: 1, 字: 40 }),
)
// 另一个会话：一条命中
writeFileSync(join(库目录, 's2.traces.jsonl'), 行({ at: 天前(3), picked: [{ id: 'd' }], 条: 1, 字: 80 }))
// 坏行混在里面：跳过，不许炸
writeFileSync(join(库目录, 's3.traces.jsonl'), '{oops\n' + 行({ at: 天前(4), picked: [], 条: 0, 字: 0 }))

test('近 7 天：次数 / 有着落 / 空注入 / 平均条数字数', async () => {
  const 表 = 起路由()
  const r = await 调(表, '/dsh-clay-memory/health?days=7')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.days, 7)
  assert.strictEqual(r.汇总.次数, 5, '窗口内 5 条（30 天前那条不算）')
  assert.strictEqual(r.汇总.有命中, 3)
  assert.strictEqual(r.汇总.空注入, 2)
  assert.strictEqual(r.汇总.被门挡, 1)
  assert.strictEqual(r.汇总.命中率, 0.6)
  assert.strictEqual(r.汇总.平均条数, 1.3, '(2+1+1)/3 = 1.33 → 一位小数 1.3')
  assert.strictEqual(r.汇总.平均字数, 52, '(120+60+0+80+0)/5 = 52')
})

test('天数收口：0 → 1 天，999 → 90 天', async () => {
  const 表 = 起路由()
  assert.strictEqual((await 调(表, '/dsh-clay-memory/health?days=0')).days, 1)
  assert.strictEqual((await 调(表, '/dsh-clay-memory/health?days=999')).days, 90)
})

test('一条记录都不在窗口内：次数 0、命中率 null', async () => {
  const 表 = 起路由()
  const r = await 调(表, '/dsh-clay-memory/health?days=1')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.汇总.次数, 1, '只有今天那条')
  assert.strictEqual(r.汇总.有命中, 1)
})
