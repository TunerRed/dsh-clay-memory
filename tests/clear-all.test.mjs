// 1.10.2 F19 一键清空：全部 / 仅本会话
//   要点：① 清空 = 收进回收站（deleted + deletedAt + 清空的 标记），不是真销毁
//        ② 「仅本会话」只动那一个库文件，事实 / 工作区一行都不许少
//        ③ 没确认（confirm）不许动；读不出来的库一律跳过，绝不当空库清掉
import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const 家 = mkdtempSync(join(tmpdir(), 'clay-clear-'))
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

function 调(表, 路径, 体) {
  return new Promise((resolve) => {
    const res = {
      writeHead() {},
      end(t) {
        resolve(JSON.parse(String(t)))
      },
    }
    表.get(路径)({ body: 体 }, res)
  })
}

const 写 = (名, 数据) => writeFileSync(join(库目录, 名), JSON.stringify(数据))
const 读 = (名) => JSON.parse(readFileSync(join(库目录, 名), 'utf8'))
const 库 = (memories) => ({ version: 2, purgeEpoch: '', policy: {}, memories, deleted: [], traces: [] })

写('s1.json', 库([
  { id: 'e1', text: '借了阿岑一把调音扳手', at: '2026-01-05T11:10:00.000Z' },
  { id: 'e2', text: '下周三还', at: '2026-01-05T11:11:00.000Z' },
]))
写('_facts.json', 库([{ id: 'f1', text: '更喜欢热麦茶', category: 'stable_profile' }]))
写('_ws-abc.json', { ...库([{ id: 'w1', text: '项目用 pnpm', category: 'workspace', scope: 'workspace:C:/x' }]), wsRoot: 'C:/x' })
// 坏 JSON：读不出来，清空时必须跳过（否则等于把未知内容直接灭掉）
writeFileSync(join(库目录, '_ws-bad.json'), '{oops')

test('没在 confirm 里写「清空」→ 一个字节都不动', async () => {
  const 表 = 起路由()
  const r = await 调(表, '/dsh-clay-memory/clear', { scope: 'all' })
  assert.strictEqual(r.ok, false)
  assert.match(r.message, /确认/)
  assert.strictEqual(读('s1.json').memories.length, 2)
  assert.strictEqual(读('_facts.json').memories.length, 1)
})

test('仅本会话：只清 s1 的事件，事实和工作区不动', async () => {
  const 表 = 起路由()
  const r = await 调(表, '/dsh-clay-memory/clear', { scope: 'session', session: 's1', confirm: '清空' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.清空, 2)
  const s1 = 读('s1.json')
  assert.strictEqual(s1.memories.length, 0, '本会话事件应清空')
  assert.strictEqual(s1.deleted.length, 2, '清掉的两条要进回收站')
  assert.ok(s1.deleted.every((m) => m.deletedAt && m.批量删的 === true && m.清空的 === true))
  assert.strictEqual(读('_facts.json').memories.length, 1, '事实不许被「仅本会话」带走')
  assert.strictEqual(读('_ws-abc.json').memories.length, 1, '工作区不许被「仅本会话」带走')
})

test('全部：事实 / 会话 / 工作区一起收走，坏库跳过且原样保留', async () => {
  const 表 = 起路由()
  const r = await 调(表, '/dsh-clay-memory/clear', { scope: 'all', confirm: '清空' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.清空, 2, '上一轮已清空的 s1 不算，这轮是 f1 + w1')
  for (const 名 of ['s1.json', '_facts.json', '_ws-abc.json']) {
    assert.strictEqual(读(名).memories.length, 0, 名 + ' 应清空')
  }
  assert.strictEqual(读('_facts.json').deleted[0].category, 'stable_profile')
  assert.strictEqual(readFileSync(join(库目录, '_ws-bad.json'), 'utf8'), '{oops', '读不出来的库不许被覆盖')
  assert.ok(r.跳过.some((x) => x.includes('_ws-bad.json')), '跳过的库要报出来')
})

test('已经空了的库不算数，也不写盘（不会把坏库洗干净）', async () => {
  const 表 = 起路由()
  const r = await 调(表, '/dsh-clay-memory/clear', { scope: 'all', confirm: '清空' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.清空, 0)
  assert.match(r.message, /没有要清空的/)
  assert.strictEqual(readFileSync(join(库目录, '_ws-bad.json'), 'utf8'), '{oops')
  // 清空过的库要留 .bak（动数据之前先备份）
  assert.ok(readdirSync(库目录).some((f) => f.startsWith('s1.json.bak')), '清空前后应留 .bak')
})
