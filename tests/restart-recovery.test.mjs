// 1.8.39 C：独立子进程的多文件保存中断恢复测试（GPT 任务书）。
// 关键点：故障注入在**子进程**里发生、子进程被强杀后，所有验证都由父进程
// （本测试进程 = 全新内存状态）完成 —— 证明恢复不依赖旧进程的任何状态。
// 覆盖场景：
//   1. 全局（事实）写成功，会话写时被强杀
//   2. 全局 + 会话写成功，工作区写时被强杀
//   3. JSON 保存成功，SQLite 镜像完成不了（db 占位目录）
//   4. 墓碑删除后正常退出 → 重启后墓碑仍在、重试保存不复活
//   5. 正常写入正常退出（对照）
// 机制限制（与 tests/save-fault.test.mjs 一致）：三文件不是跨文件事务；
// 保证 = 单文件原子 + 事实先写 + 重跑收敛，不静默丢失/复活/重复/串库。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const child脚本 = fileURLToPath(new URL('./helpers/restart-child.mjs', import.meta.url))

const home = mkdtempSync(join(tmpdir(), 'fish-restart-'))
process.env.DSH_HOME = home
const paths = await import('../lib/paths.mjs')
const store = await import('../lib/store-core.mjs')
store.接报信(() => {})
const dir = join(home, 'clay-memory')
mkdirSync(dir, { recursive: true })

const 起 = (场景, sid, cwd = '') => spawnSync(process.execPath, [child脚本], {
  env: { ...process.env, DSH_HOME: home, RT_SCENARIO: 场景, RT_SID: sid, RT_CWD: cwd },
  encoding: 'utf8', timeout: 60000,
})

const 写库 = (p, 内存) => writeFileSync(p, JSON.stringify({
  version: 2, purgeEpoch: 'e-' + Math.random().toString(36).slice(2, 8),
  policy: {}, memories: 内存, traces: [], deleted: [],
}), 'utf8')

// 每个场景用不同 sid 与 cwd，避免场景间互相污染
const 备基础 = (sid, cwd) => {
  写库(join(dir, sid + '.json'), [{ id: 's0', text: '会话旧条目', category: 'event', scope: 'session' }])
  写库(join(dir, '_facts.json'), [{ id: 'f0', text: '事实旧条目', category: 'stable_profile', scope: 'global', importance: 1 }])
  if (cwd) {
    const 名 = paths.工作区文件(cwd)
    writeFileSync(名, JSON.stringify({
      version: 2, purgeEpoch: 'e-ws', wsRoot: cwd, policy: {},
      memories: [{ id: 'w0', text: '工区旧条目', category: 'workspace', scope: 'workspace:' + cwd }],
      traces: [], deleted: [],
    }), 'utf8')
  }
}

const ids = (视) => (视.memories || []).map((m) => m.id).sort()

test('C 场景 1：全局写成功、会话写被强杀 → 新进程读不丢事实、重跑补齐收敛', () => {
  const sid = 'rt-s1'
  备基础(sid, '')
  const r = 起('kill-session-write', sid)
  assert.equal(r.status, 9, '子进程应被强杀（exit 9）')

  // 盘上：事实有新条目（先写已成功）、会话没有
  const 事实盘 = JSON.parse(readFileSync(join(dir, '_facts.json'), 'utf8'))
  assert.ok(事实盘.memories.some((m) => m.id === 'new-fact-1'), '事实层已写入新条目')
  const 会话盘 = JSON.parse(readFileSync(join(dir, sid + '.json'), 'utf8'))
  assert.ok(!会话盘.memories.some((m) => m.id === 'new-sess-1'), '会话层被杀，新条目未写入')

  // 全新进程读：事实新 + 会话旧 都能看见（不丢）
  const 视 = store.loadStoreJSON(sid)
  assert.ok(ids(视).includes('f0') && ids(视).includes('s0') && ids(视).includes('new-fact-1'), '重启后合并视图不丢')
  assert.ok(!ids(视).includes('new-sess-1'), '被杀掉的那一层不假装存在')

  // 重跑同一保存：收敛 —— 事实按 id 唯一、会话补齐
  视.memories.push({ id: 'new-fact-1', text: '新事实', category: 'stable_profile', scope: 'global', importance: 1 })
  视.memories.push({ id: 'new-sess-1', text: '新会话条目', category: 'event', scope: 'session' })
  store.saveStoreJSON(sid, 视, {})
  const 视2 = store.loadStoreJSON(sid)
  assert.equal(视2.memories.filter((m) => m.id === 'new-fact-1').length, 1, '重跑不得重复事实')
  assert.ok(ids(视2).includes('new-sess-1'), '重跑补齐会话层')
})

test('C 场景 2：全局+会话写成功、工区写被强杀 → 重启不丢、重跑补齐、异 cwd 仍隔离', () => {
  const sid = 'rt-s2'
  const cwd = 'C:/work/restart-ws'
  备基础(sid, cwd)
  const r = 起('kill-ws-write', sid, cwd)
  assert.equal(r.status, 9, '子进程应被强杀（exit 9）')

  const 事实盘 = JSON.parse(readFileSync(join(dir, '_facts.json'), 'utf8'))
  const 会话盘 = JSON.parse(readFileSync(join(dir, sid + '.json'), 'utf8'))
  assert.ok(事实盘.memories.some((m) => m.id === 'new-fact-2'), '事实已写')
  assert.ok(会话盘.memories.some((m) => m.id === 'new-sess-2'), '会话已写')
  const ws盘 = JSON.parse(readFileSync(paths.工作区文件(cwd), 'utf8'))
  assert.ok(!ws盘.memories.some((m) => m.id === 'new-ws-1'), '工区层被杀，新条目未写入')

  const 视 = store.loadStoreJSON(sid, cwd)
  assert.ok(['f0', 's0', 'w0', 'new-fact-2', 'new-sess-2'].every((x) => ids(视).includes(x)), '重启后三层旧+已写新都不丢')
  assert.ok(!ids(视).includes('new-ws-1'), '未写成的工区条目不假装存在')

  // 重跑补齐工区
  视.memories.push({ id: 'new-ws-1', text: '新工区条目', category: 'workspace', scope: 'workspace:' + cwd })
  store.saveStoreJSON(sid, 视, {}, cwd)
  const 视2 = store.loadStoreJSON(sid, cwd)
  assert.ok(ids(视2).includes('new-ws-1'), '重跑补齐工区层')
  // 隔离仍有效
  const 别的 = store.loadStoreJSON(sid, 'C:/work/other-ws')
  assert.ok(!ids(别的).includes('new-ws-1'), '异 cwd 不可见')
})

test('C 场景 3：JSON 保存成功、镜像完成不了 → 正常退出后 JSON 完好、读侧不受影响', () => {
  const sid = 'rt-s3'
  备基础(sid, '')
  const r = 起('mirror-broken', sid)
  assert.equal(r.status, 0, 'JSON 保存成功应正常退出')
  const 会话盘 = JSON.parse(readFileSync(join(dir, sid + '.json'), 'utf8'))
  assert.ok(会话盘.memories.some((m) => m.id === 'new-m1'), 'JSON 盘有新条目')
  assert.ok(existsSync(join(dir, 'clay-memory.db')), 'db 占位目录还在')
  const 视 = store.loadStoreJSON(sid)
  assert.ok(ids(视).includes('new-m1'), '新进程读 JSON 正常')
  // 清理占位目录（避免影响后续场景/真机）
  rmSync(join(dir, 'clay-memory.db'), { recursive: true, force: true })
})

test('C 场景 4：墓碑删除后正常退出 → 重启墓碑仍在、重试保存不复活', () => {
  const sid = 'rt-s4'
  备基础(sid, '')
  const r = 起('tombstone-restart', sid)
  assert.equal(r.status, 0)
  const 视 = store.loadStoreJSON(sid)
  assert.ok(!ids(视).includes('t1'), '已删条目不在活记忆里')
  assert.ok((视.deleted || []).some((d) => d.id === 't1'), '墓碑跨进程保留')
  // 重试同一保存（带墓碑的视图）：不复活
  store.saveStoreJSON(sid, 视, {})
  const 视2 = store.loadStoreJSON(sid)
  assert.ok(!ids(视2).includes('t1'), '重跑保存不得复活已删记忆')
  assert.ok((视2.deleted || []).some((d) => d.id === 't1'), '墓碑仍在')
})

test('C 场景 5（对照）：正常写入正常退出 → 重启后记忆完整', () => {
  const sid = 'rt-s5'
  备基础(sid, '')
  const r = 起('normal', sid)
  assert.equal(r.status, 0)
  const 视 = store.loadStoreJSON(sid)
  assert.ok(['f0', 's0', 'n1'].every((x) => ids(视).includes(x)), '正常路径记忆完整')
})
