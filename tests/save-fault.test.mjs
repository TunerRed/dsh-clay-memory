import test from 'node:test'
import assert from 'node:assert/strict'
import fs, { mkdtempSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// GPT 1.8.38 P2-⑤：多文件保存故障注入。
// 只测「现有机制的真实行为」：单文件原子 + 事实先写 + 抛错可诊断 + 重跑收敛 + 镜像降级。
// 不造假桩让失败场景「通过」——测不过就说明机制有缺口，记录限制进交付说明。

const home = mkdtempSync(join(tmpdir(), 'fish-fault-'))
process.env.DSH_HOME = home
const store = await import('../lib/store-core.mjs')
const 接报 = await import('../lib/diag.mjs')
const dir = join(home, 'clay-memory')
mkdirSync(dir, { recursive: true })

// 收集诊断（store-core 的 接报信）
const 报过的 = []
store.接报信((m) => 报过的.push(String(m)))

const sid = 'session-fault'
const 会话文件 = join(dir, sid + '.json')
const 事实文件 = join(dir, '_facts.json')

function 原始(sid2) {
  return JSON.parse(readFileSync(join(dir, sid2 + '.json'), 'utf8'))
}
function 事实原始() {
  return JSON.parse(readFileSync(事实文件, 'utf8'))
}

// —— 故障注入：让某个目标文件的原子写（openSync 建 .tmp）失败 ——
function 让文件写失败(目标路径, 码 = 'EIO') {
  const 原open = fs.openSync
  fs.openSync = (...args) => {
    const p = String(args[0] || '')
    if (p.startsWith(目标路径) && p.endsWith('.tmp')) {
      throw Object.assign(new Error('synthetic write failure'), { code: 码 })
    }
    return 原open(...args)
  }
  syncBuiltinESMExports()
  return () => {
    fs.openSync = 原open
    syncBuiltinESMExports()
  }
}

// 造基础数据：一条会话事件 + 一条全局事实 + 一条工作区条目
function 造基础() {
  const data = store.loadStoreJSON(sid, 'G:/fault/ws')
  data.memories = [
    { id: 'mm-event', text: '会话事件', category: 'event', scope: 'session' },
    { id: 'mm-fact', text: '全局事实', category: 'stable_profile', scope: 'global' },
  ]
  store.saveStoreJSON(sid, data, {})
  const data2 = store.loadStoreJSON(sid, 'G:/fault/ws')
  data2.memories.push({ id: 'mm-ws', text: '工作区条目', category: 'workspace', scope: 'workspace:G:/fault/ws' })
  store.saveStoreJSON(sid, data2, {}, 'G:/fault/ws')
  return store.loadStoreJSON(sid, 'G:/fault/ws')
}

test('事实成、会话败：抛错可诊断，重跑收敛不重复', () => {
  const data = 造基础()
  data.memories.push({ id: 'mm-new-event', text: '新会话事件', category: 'event', scope: 'session' })
  data.memories.push({ id: 'mm-new-fact', text: '新全局事实', category: 'stable_profile', scope: 'global' })
  const 解除 = 让文件写失败(会话文件)
  assert.throws(() => store.saveStoreJSON(sid, data, {}), /synthetic write failure/)
  解除()
  // 事实先写：新事实已落盘，会话原样（不静默丢失——调用方拿到了异常）
  const 盘事实 = 事实原始()
  assert.ok(盘事实.memories.some((m) => m.id === 'mm-new-fact'), '事实层已生效')
  assert.ok(!盘事实.memories.some((m) => m.id === 'mm-new-event'), '会话条目不进事实层')
  const 盘会话 = 原始(sid)
  assert.ok(!盘会话.memories.some((m) => m.id === 'mm-new-event'), '会话文件未被改写')
  // 重跑同一保存：收敛——会话补齐、事实按 id 唯一、不重复不复活
  store.saveStoreJSON(sid, data, {})
  const 盘会话2 = 原始(sid)
  const 盘事实2 = 事实原始()
  assert.ok(盘会话2.memories.some((m) => m.id === 'mm-new-event'), '重跑后会话补齐')
  assert.equal(盘事实2.memories.filter((m) => m.id === 'mm-new-fact').length, 1, '事实不重复')
})

test('工区败：抛错，工区原样，重跑收敛', () => {
  const data = 造基础()
  data.memories.push({ id: 'mm-ws2', text: '工作区新条目', category: 'workspace', scope: 'workspace:G:/fault/ws' })
  // 工区文件名是 sha256 名：直接扫目录拿（_ws- 前缀只有它）
  const 工区文件名 = readdirSync(dir).find((f) => f.startsWith('_ws-') && f.endsWith('.json'))
  assert.ok(工区文件名, '工区文件存在')
  const 工区路径 = join(dir, 工区文件名)
  const 原工区 = readFileSync(工区路径, 'utf8')
  const 解除 = 让文件写失败(工区路径)
  assert.throws(() => store.saveStoreJSON(sid, data, {}, 'G:/fault/ws'), /synthetic write failure/)
  解除()
  assert.equal(readFileSync(工区路径, 'utf8'), 原工区, '工区文件未被改写')
  store.saveStoreJSON(sid, data, {}, 'G:/fault/ws')
  const 工区盘 = JSON.parse(readFileSync(工区路径, 'utf8'))
  assert.equal(工区盘.memories.filter((m) => m.id === 'mm-ws2').length, 1, '重跑后工区补齐不重复')
})

test('镜像败：JSON 照常成功，不抛错，读侧退回 JSON', () => {
  const data = 造基础()
  data.memories.push({ id: 'mm-mirror', text: '镜像失败场景', category: 'event', scope: 'session' })
  // 把 clay-memory.db 占成一个目录 → DatabaseSync 打不开 → ⑥ catch → 镜像不可用
  const db路径 = join(dir, 'clay-memory.db')
  if (fs.existsSync(db路径)) fs.rmSync(db路径, { recursive: true })
  mkdirSync(db路径, { recursive: true })
  store.saveStoreJSON(sid, data, {})
  assert.ok(原始(sid).memories.some((m) => m.id === 'mm-mirror'), 'JSON 写成功')
  assert.equal(store.镜像不可用, true, '镜像标记为不可用')
  const 视 = store.loadStoreJSON(sid)
  assert.ok(视.memories.some((m) => m.id === 'mm-mirror'), '读侧退回 JSON 正常读')
})

test('部分残留：事实有新条目、会话没有 → 合并视图不丢，重跑补齐', () => {
  // 模拟「事实写成功、会话写失败后重启」的残留态：事实文件里有新条目，会话文件没有
  const data = 造基础()
  const 盘事实 = 事实原始()
  盘事实.memories.push({ id: 'mm-leftover', text: '残留事实', category: 'stable_profile', scope: 'global' })
  fs.writeFileSync(事实文件, JSON.stringify(盘事实, null, 2))
  // 重启后（模块状态没变，等价于全新读盘）loadStoreJSON 必须看得到残留事实
  const 视 = store.loadStoreJSON(sid, 'G:/fault/ws')
  assert.ok(视.memories.some((m) => m.id === 'mm-leftover'), '合并视图不丢残留事实')
  // 重跑同一保存 → 会话库补齐（权威事实同步），事实仍唯一
  store.saveStoreJSON(sid, 视, {}, 'G:/fault/ws')
  assert.equal(事实原始().memories.filter((m) => m.id === 'mm-leftover').length, 1, '事实唯一')
})

test('墓碑不复活：删除 → 重跑同一保存 → 条目不回来', () => {
  const data = 造基础()
  const 目标 = data.memories.find((m) => m.id === 'mm-event')
  data.memories = data.memories.filter((m) => m.id !== 'mm-event')
  data.deleted.push({ id: 'mm-event', text: 目标.text, deletedAt: new Date().toISOString() })
  store.saveStoreJSON(sid, data, {})
  // 重跑同一保存（模拟重启重跑）
  const 再 = store.loadStoreJSON(sid, 'G:/fault/ws')
  store.saveStoreJSON(sid, 再, {}, 'G:/fault/ws')
  const 最终 = store.loadStoreJSON(sid, 'G:/fault/ws')
  assert.ok(!最终.memories.some((m) => m && m.id === 'mm-event'), '墓碑条目不复活')
})
