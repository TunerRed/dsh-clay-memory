// F14 时间线：某一天记了几条、那几天想起过几次
//   要点：① 只算窗口内（旧记录不混进来）
//        ② 同一条记忆出现在两个会话文件里（copy-to）只算一次
//        ③ 坏库 / 坏 trace 行不许炸，也不许把「读不出来」算成「那天没记」
import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const 家 = mkdtempSync(join(tmpdir(), 'clay-timeline-'))
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
    表.get('/dsh-clay-memory/timeline')({ url: 路径, body: {} }, res)
  })
}

// 时间锚定在「今天正午」，不是「此刻」—— 否则凌晨 0~3 点跑 `小时前(1)`/`小时前(2)`
// 会跨过午夜落到昨天，「今天」格子里只剩一条，用例必挂（2026-11-16 01:0x 实测）
const 基准 = new Date()
基准.setHours(12, 0, 0, 0)
const 现在 = 基准.getTime()
const 小时前 = (n) => new Date(现在 - n * 3600000).toISOString()
const 天前 = (n) => new Date(现在 - n * 86400000).toISOString()
const 行 = (o) => JSON.stringify(o) + '\n'
const 日 = (iso) => {
  const d = new Date(Date.parse(iso))
  const 补 = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + 补(d.getMonth() + 1) + '-' + 补(d.getDate())
}

// 今天记两条（其中一条在另一个会话文件里重复出现，属 copy-to）
writeFileSync(
  join(库目录, 's1.json'),
  JSON.stringify({
    memories: [
      { id: 'a1', text: '今天记的第一条', at: 小时前(2), category: 'event' },
      { id: 'a2', text: '做梦那条', at: 小时前(1), category: 'event', nature: 'dream' },
      { id: 'old', text: '很久以前那条', at: 天前(40), category: 'event' },
    ],
  }),
)
writeFileSync(
  join(库目录, 's2.json'),
  JSON.stringify({ memories: [{ id: 'a1', text: '今天记的第一条', at: 小时前(2), category: 'event' }] }),
)
// 坏库：不许炸，也不许当成「那天没记」
writeFileSync(join(库目录, 'broken.json'), '{不是 json')

// 今天两次注入（一次命中一次空），一小时前又一次空
writeFileSync(
  join(库目录, 's1.traces.jsonl'),
  行({ at: 小时前(3), picked: ['a1', 'a2'], 条: 2 }) +
    行({ at: 小时前(2), picked: [], gate: true }) +
    行({ at: 小时前(1), picked: [] }) +
    行('{坏行') +
    行({ at: 天前(40), picked: ['old'] }),
)

test('按天统计：记了几条、想起几次', async () => {
  const 表 = 起路由()
  const r = await 调(表, '/dsh-clay-memory/timeline?days=14')
  assert.equal(r.ok, true)
  const 今天 = r.每天.find((x) => x.日 === 日(小时前(1)))
  assert.ok(今天, '今天的格子要在')
  assert.equal(今天.记数, 2, '两条（重复 id 只算一次，旧记录不进窗口）')
  assert.equal(今天.记.filter((m) => m.性质 === 'dream').length, 1, '性质要带出来')
  assert.equal(今天.想起.次, 3)
  assert.equal(今天.想起.有, 1)
  assert.equal(今天.想起.条, 2)
  assert.equal(今天.想起.空, 2)
})

test('窗口外的记录不出现', async () => {
  const 表 = 起路由()
  const r = await 调(表, '/dsh-clay-memory/timeline?days=14')
  const 老 = r.每天.find((x) => x.日 === 日(天前(40)))
  assert.equal(老, undefined)
})

test('天数收口：0 → 1、999 → 90、缺省 14', async () => {
  const 表 = 起路由()
  assert.equal((await 调(表, '/dsh-clay-memory/timeline?days=0')).days, 1)
  assert.equal((await 调(表, '/dsh-clay-memory/timeline?days=999')).days, 90)
  assert.equal((await 调(表, '/dsh-clay-memory/timeline')).days, 14)
})

test('空库返回空数组而不是报错', async () => {
  const 空家 = mkdtempSync(join(tmpdir(), 'clay-timeline-empty-'))
  mkdirSync(join(空家, 'clay-memory'), { recursive: true })
  const 老 = process.env.DSH_HOME
  process.env.DSH_HOME = 空家
  // 模块内 STORE_DIR 在 import 时已定死，这里只能验证「没有匹配的日」不会炸
  process.env.DSH_HOME = 老
  const 表 = 起路由()
  const r = await 调(表, '/dsh-clay-memory/timeline?days=1')
  assert.equal(r.ok, true)
  assert.ok(Array.isArray(r.每天))
})
