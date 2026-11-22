#!/usr/bin/env node
// tools/doctor.mjs —— 记忆库结构体检（默认只读，--fix 才动文件）
// ---------------------------------------------------------------------------
// 起因：2026-11-14 主库里有一个会话文件缺 `purgeEpoch`，于是每次读盘都拿随机 UUID 兜底，
// 跟盘上的空代际永远对不上 —— 这个库从此「一写就报 MEMORY_PURGED」，而且没有任何提示。
// 这类静默病用眼睛看不出来，得有一个能扫全库的工具。
//
//   node tools/doctor.mjs                          # 看主库
//   node tools/doctor.mjs --home <别的实例的 DSH_HOME>  # 看别的实例
//   node tools/doctor.mjs --json                   # JSON（给脚本吃）
//   node tools/doctor.mjs --fix                    # 只补「缺 purgeEpoch」，其余只报
//
// 只做检查，不改语义：除了补一个随机代际，别的一概不碰。
// ---------------------------------------------------------------------------
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const 参 = process.argv.slice(2)
const 取参 = (名, 缺省 = '') => {
  const i = 参.indexOf(名)
  return i >= 0 && 参[i + 1] ? 参[i + 1] : 缺省
}
const 要JSON = 参.includes('--json')
const 要修 = 参.includes('--fix')

const 家 = (() => {
  const 根 = 取参('--home') || process.env.DSH_HOME || ''
  return 根 ? join(根, 'clay-memory') : ''
})()
if (!家 || !existsSync(家)) {
  console.error('找不到记忆库目录：' + (家 || '（没给 --home，也没有 DSH_HOME）'))
  process.exit(2)
}

// 参数范围表：能从 lib/cfg.mjs 拿就拿，拿不到就用宽范围兜底（只报明显离谱的）
let 范围 = {}
try {
  const cfg = await import(new URL('../lib/cfg.mjs', import.meta.url).href)
  for (const s of cfg.POLICY_SPEC || []) 范围[s.key] = { min: s.min, max: s.max, label: s.label }
} catch (error) {
  /* 拿不到就跳过越界检查 */
}

const 读 = (p) => {
  try {
    return { ok: true, v: JSON.parse(readFileSync(p, 'utf8')) }
  } catch (error) {
    return { ok: false, e: String((error && error.message) || error) }
  }
}
const 是会话文件 = (f) => f.endsWith('.json') && !f.startsWith('_') && !f.includes('.bak')

const 问题 = []
const 修过 = []
const 加 = (级别, 哪, 说什么) => 问题.push({ 级别, 哪, 说什么 })

// ---------- 主流程 ----------
const 文件 = readdirSync(家).filter(是会话文件)
const 事实 = 读(join(家, '_facts.json'))
const 事实盘 = 事实.ok ? 事实.v : null
const 工作区 = {}
for (const f of readdirSync(家)) {
  if (!f.startsWith('_ws-') || !f.endsWith('.json')) continue
  const r = 读(join(家, f))
  if (r.ok) 工作区[f] = r.v
}

let 总记忆 = 0
let 知识 = 0
let 画像 = 0
const id表 = new Map() // id -> 出现位置
const 待恢复 = new Map() // 被谁 -> [id]

// 单条记忆层面的检查（全局事实库和会话库都要过一遍）
const 看记忆 = (ms, 哪) => {
  for (const m of ms) {
    if (!m || typeof m !== 'object') continue
    if (m.is_knowledge === true) 知识++
    else 画像++
    总记忆++

    // 2. 重复 id
    if (m.id) {
      if (id表.has(m.id)) 加('提示', 哪, '重复 id ' + m.id + '（另见 ' + id表.get(m.id) + '）')
      else id表.set(m.id, 哪)
    } else {
      加('提示', 哪, '有条记忆没有 id')
    }

    // 3. 时间锚：全无 = 衰减只能取常数（不是错，但值得知道）
    if (!m.at && !m.createdAt && !m.activationAnchor && !m.importAt) {
      加('提示', 哪, '记忆「' + String(m.text || '').slice(0, 18) + '…」没有任何时间锚')
    }

    // 4. 已被取代指向的 id 不存在
    const 被谁 = m.已被取代 && m.已被取代.被谁
    if (被谁 && 被谁 !== '清洗补键' && 被谁 !== '销毁') {
      if (!待恢复.has(被谁)) 待恢复.set(被谁, [])
      待恢复.get(被谁).push(m.id || '')
    }
  }
}

// 全局事实库是主库，先算它
if (事实盘 && Array.isArray(事实盘.memories)) 看记忆(事实盘.memories, '_facts.json')

for (const fn of 文件) {
  const r = 读(join(家, fn))
  if (!r.ok) {
    加('错', fn, '文件读不出来：' + r.e)
    continue
  }
  const d = r.v
  if (!d || typeof d !== 'object') {
    加('错', fn, '不是对象')
    continue
  }

  // 1. 结构：这几个字段缺了会让读盘走兜底，最容易变成「永远写不进去」
  //    注意：空字符串是合法值（= 没 purge 过），只有「字段不存在 / 类型不对」才是病。
  if (typeof d.purgeEpoch !== 'string') {
    加('严重', fn, '缺 purgeEpoch（读盘每次随机兜底 → 这个库会一直报 MEMORY_PURGED）')
    if (要修) {
      d.purgeEpoch = randomUUID()
      if (typeof d.factsPurgeEpoch !== 'string') d.factsPurgeEpoch = ''
      if (!Array.isArray(d.traces)) d.traces = []
      if (!Array.isArray(d.deleted)) d.deleted = []
      writeFileSync(join(家, fn), JSON.stringify(d, null, 2))
      修过.push(fn + ' → 补了 purgeEpoch ' + d.purgeEpoch)
    }
  }
  if (!Array.isArray(d.memories)) 加('严重', fn, 'memories 不是数组')
  if (!Array.isArray(d.traces)) 加('提示', fn, '缺 traces 数组（会影响回放与统计）')
  if (!Array.isArray(d.deleted)) 加('提示', fn, '缺 deleted 数组')

  const ms = Array.isArray(d.memories) ? d.memories : []
  看记忆(ms, fn)

  // 5. 代际对不上（盘上的事实库代际 vs 库里记的）
  const f来 = typeof d.factsPurgeEpoch === 'string' ? d.factsPurgeEpoch : ''
  const 事实代 = 事实盘 && typeof 事实盘.purgeEpoch === 'string' ? 事实盘.purgeEpoch : ''
  if (f来 && 事实代 && f来 !== 事实代) {
    加('严重', fn, 'factsPurgeEpoch 与 _facts.json 的代际不一致（' + f来.slice(0, 8) + ' vs ' + 事实代.slice(0, 8) + '）')
  }
}

// 孤儿引用：A 说自己被 B 取代，但 B 在库里找不到
if (id表.size) {
  for (const [被谁, ids] of 待恢复) {
    if (!id表.has(被谁)) {
      加('提示', '全库', '有 ' + ids.length + ' 条记着「被 ' + 被谁.slice(0, 8) + '… 取代」，但那个 id 不在库里')
    }
  }
}

// 6. policy 越界
const 参数源 = [['全局', 事实盘 && 事实盘.policy]]
for (const [k, v] of Object.entries(工作区)) 参数源.push([k, v && v.policy])
for (const [哪, p] of 参数源) {
  if (!p || typeof p !== 'object') continue
  for (const [key, s] of Object.entries(范围)) {
    const v = p[key]
    if (typeof v === 'number' && isFinite(v) && (v < s.min || v > s.max)) {
      加('提示', 哪, '参数 ' + (s.label || key) + ' = ' + v + ' 超出范围 ' + s.min + '~' + s.max)
    }
  }
}

// ---------- 输出 ----------
const 严重 = 问题.filter((x) => x.级别 === '严重').length
const 提示 = 问题.filter((x) => x.级别 === '提示').length

if (要JSON) {
  console.log(JSON.stringify({ 家, 会话文件: 文件.length, 记忆: 总记忆, 知识, 画像, 严重, 提示, 修过, 问题 }, null, 2))
} else {
  console.log('# 记忆库体检：' + 家)
  console.log('')
  console.log('- 会话文件 ' + 文件.length + ' 个，记忆 ' + 总记忆 + ' 条（知识 ' + 知识 + ' / 画像 ' + 画像 + '）')
  console.log('- 严重 ' + 严重 + ' 项，提示 ' + 提示 + ' 项' + (修过.length ? '，已修 ' + 修过.length + ' 项' : ''))
  console.log('')
  if (!问题.length) {
    console.log('全库没有被检查出的问题。')
  } else {
    console.log('| 级别 | 位置 | 什么 |')
    console.log('| --- | --- | --- |')
    for (const x of 问题) console.log('| ' + x.级别 + ' | ' + x.哪 + ' | ' + x.说什么 + ' |')
  }
  if (修过.length) {
    console.log('')
    console.log('## 已修')
    for (const s of 修过) console.log('- ' + s)
  }
  if (!要修 && 严重) {
    console.log('')
    console.log('有严重项。加 `--fix` 只会补「缺 purgeEpoch」这一类，其余请人工看。')
  }
}
process.exit(严重 ? 1 : 0)
