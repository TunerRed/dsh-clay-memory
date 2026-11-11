// tests/helpers/restart-child.mjs —— restart-recovery.test.mjs spawn 的故障注入子进程。
// 每个场景跑在独立 Node 进程里（独立模块实例/内存状态），父进程再验证时
// 视角就是「进程被强杀后全新启动」的视角。
import fs, { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { syncBuiltinESMExports } from 'node:module'

const 场景 = process.env.RT_SCENARIO
const sid = process.env.RT_SID
const cwd = process.env.RT_CWD || ''
const home = process.env.DSH_HOME

const paths = await import('../../lib/paths.mjs')
const store = await import('../../lib/store-core.mjs')
store.接报信(() => {})

const dir = join(home, 'clay-memory')

// 在写盘 syscall 层打断：命中目标 .tmp 文件时 process.exit(9) —— 模拟断电/强杀，
// 不跑任何清理逻辑（没有 finally、没有 rename、没有镜像同步）。
// 注意顺序照 tests/save-fault.test.mjs：先赋值再 syncBuiltinESMExports（静态 import 的 fs 才可写）。
const 打断写 = (命中) => {
  const 原open = fs.openSync
  fs.openSync = (...a) => {
    const p = String(a[0])
    if (命中(p)) process.exit(9)
    return 原open(...a)
  }
  syncBuiltinESMExports()
}

if (场景 === 'normal') {
  // 正常写入 + 正常退出（对照场景：重启后记忆完整）
  const 视 = store.loadStoreJSON(sid)
  视.memories.push({ id: 'n1', text: '正常写入的条目', category: 'event', scope: 'session' })
  store.saveStoreJSON(sid, 视, {})
  process.exit(0)
}

if (场景 === 'kill-session-write') {
  // 场景 1：全局（事实）写成功，会话写时被强杀
  // tmp 名 = <target>.<uuid>.tmp（atomic-file.mjs:7），命中靠 前缀 sid + 后缀 .tmp
  打断写((p) => p.includes(sid + '.json.') && p.endsWith('.tmp'))
  const 视 = store.loadStoreJSON(sid)
  视.memories.push({ id: 'new-fact-1', text: '新事实', category: 'stable_profile', scope: 'global', importance: 1 })
  视.memories.push({ id: 'new-sess-1', text: '新会话条目', category: 'event', scope: 'session' })
  store.saveStoreJSON(sid, 视, {})
  process.exit(0)
}

if (场景 === 'kill-ws-write') {
  // 场景 2：全局 + 会话写成功，工作区写时被强杀
  打断写((p) => p.includes('_ws-') && p.endsWith('.tmp'))
  const 视 = store.loadStoreJSON(sid, cwd)
  视.memories.push({ id: 'new-fact-2', text: '新事实二', category: 'stable_profile', scope: 'global', importance: 1 })
  视.memories.push({ id: 'new-sess-2', text: '新会话条目二', category: 'event', scope: 'session' })
  视.memories.push({ id: 'new-ws-1', text: '新工区条目', category: 'workspace', scope: 'workspace:' + cwd })
  store.saveStoreJSON(sid, 视, {}, cwd)
  process.exit(0)
}

if (场景 === 'mirror-broken') {
  // 场景 3：JSON 保存成功、SQLite 镜像完成不了（db 被占成目录）—— 正常退出
  // 先清掉可能已存在的 db 文件（父进程场景 1/2 重跑 saveStoreJSON 时已建过镜像），再占位成目录
  rmSync(join(dir, 'clay-memory.db'), { force: true, recursive: true })
  mkdirSync(join(dir, 'clay-memory.db'), { recursive: true })
  const 视 = store.loadStoreJSON(sid)
  视.memories.push({ id: 'new-m1', text: '镜像坏时的条目', category: 'event', scope: 'session' })
  store.saveStoreJSON(sid, 视, {})
  process.exit(0)
}

if (场景 === 'tombstone-restart') {
  // 场景 4：删除（墓碑）→ 正常退出；父进程验证重启后墓碑还在、重试保存不复活
  const 视 = store.loadStoreJSON(sid)
  视.memories.push({ id: 't1', text: '要删的', category: 'event', scope: 'session' })
  store.saveStoreJSON(sid, 视, {})
  const 视2 = store.loadStoreJSON(sid)
  视2.deleted.push({ id: 't1', text: '要删的', category: 'event', deletedAt: new Date().toISOString() })
  store.saveStoreJSON(sid, 视2, {})
  process.exit(0)
}

process.exit(1)
