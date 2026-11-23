// tests/mirror-pack-fields.test.mjs —— 镜像「杂项打包」的黑名单口径（2026-11-23）
//
// 事故：`打包杂项()` 原来是**白名单**（22 个键），白名单还在三处手抄
// （lib/store-core.mjs / tools/migrate-to-sqlite.mjs / tools/check-mirror-coverage.mjs）。
// 测试库实测：47 个实际字段漏了 7 个，其中
//   · `expireAt` 是**打分输入**（scoring.mjs 按它判是否过期）→ 读切后 state 型经历永不过期
//   · `fromSession` 参与注入路径的会话归属（routes-core.mjs 的 sid || m.fromSession）
// 以后再往条目上加字段，没人记得同步白名单就会再漏一次。
// 现在反过来：**除主列键外一律打包**。这两条测试钉住「新字段默认不丢」。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// 只用合成的库和假宿主；绝不碰调用方的 DSH_HOME。
const home = mkdtempSync(join(tmpdir(), 'clay-pack-'))
process.env.DSH_HOME = home
const store = await import('../lib/store-core.mjs')
const dir = join(home, 'clay-memory')
mkdirSync(dir, { recursive: true })

test('打包杂项：没见过的字段也进包，主列键不进包', () => {
  const m = {
    id: 'mem-1',
    text: '正文',
    category: 'event',
    expireAt: '2026-12-01T00:00:00.000Z',
    fromSession: 'session-x',
    未来才加的新字段: '值',
    已被取代: { 为什么: '被新事实取代', 被谁: 'mem-2', 作废于: '2026-11-01' },
  }
  const 包 = JSON.parse(store.打包杂项(m))
  assert.equal(包.expireAt, '2026-12-01T00:00:00.000Z', 'expireAt 是打分输入，必须进包')
  assert.equal(包.fromSession, 'session-x', 'fromSession 决定注入路径归属，必须进包')
  assert.equal(包.未来才加的新字段, '值', '没见过的新字段也要自动收进来（黑名单口径）')
  assert.equal(包.id, undefined, '主列键有独立列，不该在 meta_json 里重复')
  assert.equal(包.text, undefined)
  assert.deepEqual(包.已被取代, { 为什么: '被新事实取代', 被谁: 'mem-2', 作废于: '2026-11-01' }, '已被取代 要整对象，列里只存了「为什么」')
})

test('端到端：带 expireAt / fromSession 的条目写盘后，镜像 meta_json 里也在', () => {
  const 数据 = store.blank()
  数据.memories = [
    {
      id: 'mem-pack-1',
      text: '这条带过期时间和来源会话',
      category: 'event',
      at: '2026-11-23T00:00:00.000Z',
      expireAt: '2026-12-01T00:00:00.000Z',
      fromSession: 'session-y',
    },
  ]
  store.saveStore('session-pack-1', 数据)
  const db = new DatabaseSync(join(dir, 'clay-memory.db'))
  try {
    const row = db.prepare('select meta_json from memory where id = ?').get('mem-pack-1')
    assert.ok(row, '条目应该已经同步进镜像')
    const 包 = JSON.parse(row.meta_json)
    assert.equal(包.expireAt, '2026-12-01T00:00:00.000Z')
    assert.equal(包.fromSession, 'session-y')
  } finally {
    db.close()
  }
})
