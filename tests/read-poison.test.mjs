// 1.8.34 A 阶段：读失败 / 结构坏 → 毒快照（三态语义：干净 / 缺失 / 毒），
// 毒快照一律拒绝写回（含 raw 真销毁），镜像回填跳过毒会话。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { DatabaseSync } from 'node:sqlite'

const home = mkdtempSync(join(tmpdir(), 'fish-poison-test-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'empty-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')
const plugin = await import('../lib/index.js')
const core = await import('../lib/store-core.mjs')
const dir = join(home, 'clay-memory')
mkdirSync(dir, { recursive: true })
const file = (sid) => join(dir, sid + '.json')
const okJson = (sid, ids) => writeFileSync(file(sid), JSON.stringify({
  version: 2, policy: {},
  memories: ids.map(id => ({ id, text: '合成记忆 ' + id, createdAt: '2026-10-01T00:00:00Z', related: [] })),
  traces: [], deleted: [],
}))
const bytesOf = (sid) => readFileSync(file(sid), 'utf8')

function 读坏(code) {
  const realRead = fs.readFileSync
  fs.readFileSync = (path, ...args) => {
    if (String(path) === file('bad-sid')) {
      throw Object.assign(new Error('synthetic read failure'), { code })
    }
    return realRead(path, ...args)
  }
  syncBuiltinESMExports()
  return () => { fs.readFileSync = realRead; syncBuiltinESMExports() }
}

for (const code of ['EACCES', 'EIO', 'EBUSY']) {
  test(`read failure ${code} yields a poisoned snapshot, not an empty store`, () => {
    okJson('bad-sid', ['a'])
    const undo = 读坏(code)
    try {
      const data = plugin.loadStore('bad-sid')
      assert.ok(core.corruptSnapshots.has(data), '毒快照必须挂凭据')
      assert.ok(data.purgeEpoch, '毒快照带随机代际，杜绝拿它当空库写回')
      assert.deepEqual(data.memories, [])
    } finally { undo() }
  })
}

for (const raw of ['null', '[]', '5', '"text"']) {
  test(`structurally broken store (${raw}) yields a poisoned snapshot`, () => {
    writeFileSync(file('bad-sid'), raw)
    const data = plugin.loadStore('bad-sid')
    assert.ok(core.corruptSnapshots.has(data), '结构坏必须挂凭据')
    assert.ok(data.purgeEpoch)
  })
}

test('a missing store is still a clean empty store', () => {
  const data = plugin.loadStore('never-existed')
  assert.ok(!core.corruptSnapshots.has(data), '缺失不是毒：允许正常从空库开始写')
  assert.deepEqual(data.memories, [])
})

test('writing back a poisoned snapshot is refused (normal path)', () => {
  okJson('bad-sid', ['a'])
  const before = bytesOf('bad-sid')
  const undo = 读坏('EACCES')
  try {
    const data = plugin.loadStore('bad-sid')
    assert.throws(() => plugin.saveStore('bad-sid', data), /清理|损坏|不可写/)
  } finally { undo() }
  assert.equal(bytesOf('bad-sid'), before, '盘上内容必须原样')
})

test('raw destruction is also refused on a poisoned snapshot', () => {
  okJson('bad-sid', ['a'])
  const before = bytesOf('bad-sid')
  const undo = 读坏('EACCES')
  try {
    const data = plugin.loadStore('bad-sid')
    assert.throws(() => plugin.saveStore('bad-sid', data, { raw: true }), /清理|损坏|不可写/)
  } finally { undo() }
  assert.equal(bytesOf('bad-sid'), before, '真销毁也不能在看不见的库上执行')
})

test('full mirror backfill skips a poisoned session store', () => {
  okJson('s1', ['a', 'b'])
  okJson('s2', ['c'])
  core.全量回填镜像()
  const dbPath = join(dir, 'clay-memory.db')
  const count = (sid) => {
    const db = new DatabaseSync(dbPath)
    const n = db.prepare('SELECT COUNT(*) AS n FROM memory WHERE session_id = ?').get(sid).n
    db.close()
    return n
  }
  const s1前 = count('s1')
  const s2前 = count('s2')
  assert.ok(s1前 >= 2 && s2前 >= 1, '回填先建好镜像')
  const realRead = fs.readFileSync
  fs.readFileSync = (path, ...args) => {
    if (String(path) === file('s1')) throw Object.assign(new Error('synthetic read failure'), { code: 'EACCES' })
    return realRead(path, ...args)
  }
  syncBuiltinESMExports()
  try {
    core.全量回填镜像()
  } finally { fs.readFileSync = realRead; syncBuiltinESMExports() }
  assert.equal(count('s1'), s1前, '毒会话的镜像行不能被 DELETE 光')
  assert.equal(count('s2'), s2前, '别的会话照常回填')
})
