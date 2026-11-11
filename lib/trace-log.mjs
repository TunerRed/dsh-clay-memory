// 召回记录（traces）单独存 .jsonl：只追加，注入路径不再写整库 —— 2026-10-30 从 index.js 抽出（拆层工程第 6a 批）
// 依赖注入：报 = 诊断日志，由 index.js 注入。
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { STORE_DIR } from './paths.mjs'

let 报 = null
/** index.js 在 import 后调用：注入诊断日志函数 */
export function 接报信(fn) { if (typeof fn === 'function') 报 = fn }

function tracePath(sid) {
  return join(STORE_DIR, String(sid) + '.traces.jsonl')
}

function 读追溯(sid, 最多 = 30) {
  try {
    const raw = readFileSync(tracePath(sid), 'utf8')
    return raw
      .split(String.fromCharCode(10))
      .filter(Boolean)
      .slice(-最多)
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch (error) {
          return null
        }
      })
      .filter(Boolean)
  } catch (error) {
    return []
  }
}

/** traces 已经搬到 <sid>.traces.jsonl，状态也改那边 —— 别再只改内存。
 *  同一批 trace 在 JSON 旧库里也可能有一份，但读的时候以 jsonl 为准（见 loadStoreJSON）。 */
function 标trace状态(sid, id, status) {
  const 全部 = 读追溯(sid, 200)
  let 动 = false
  for (const tr of 全部) {
    for (const row of (tr && tr.rows) || []) {
      if (String(row.id) !== String(id)) continue
      if (row.status === status) continue
      row.status = status
      动 = true
    }
  }
  if (动) 重写追溯(sid, 全部)
  return 动
}

function 重写追溯(sid, 全部) {
  try {
    writeFileSync(tracePath(sid), 全部.map((x) => JSON.stringify(x)).join(String.fromCharCode(10)) + String.fromCharCode(10))
  } catch (error) {
    报('trace 重写失败：' + (error && error.message))
  }
}

// ⭐ 1.12.7：轨迹文件会一直涨 —— 实测一个会话的 traces.jsonl 到 8710 行 / 21M，
//   25 个文件合计 77M。这里只保留最近 2000 行：够查「最近几轮为什么没想起来」，
//   再老的留着也没人翻。每追加 200 条顺手剪一次（读一次文件，很便宜）。
const 追溯上限行 = 500
const 剪的间隔 = 200
const 追加计数 = new Map()

function 轮转追溯(sid) {
  try {
    const p = tracePath(sid)
    const raw = readFileSync(p, 'utf8')
    const 行 = raw.split(String.fromCharCode(10)).filter(Boolean)
    if (行.length <= 追溯上限行) return 0
    const 留 = 行.slice(-追溯上限行)
    writeFileSync(p, 留.join(String.fromCharCode(10)) + String.fromCharCode(10))
    return 行.length - 留.length
  } catch (error) {
    return 0
  }
}

function 追加trace(sid, 记录) {
  try {
    appendFileSync(tracePath(sid), JSON.stringify(记录) + String.fromCharCode(10))
  } catch (error) {
    报('trace 写不进去：' + (error && error.message))
  }
  // 每个进程每 200 条剪一次（第一次写也剪一刀，把上次留下的胖文件收掉）
  const n = (追加计数.get(String(sid)) || 0) + 1
  追加计数.set(String(sid), n)
  if (n === 1 || n % 剪的间隔 === 0) {
    const 剪掉 = 轮转追溯(sid)
    if (剪掉 > 0 && typeof 报 === 'function') 报('轨迹轮转：剪掉 ' + 剪掉 + ' 行（只留最近 ' + 追溯上限行 + '）')
  }
}

export { tracePath, 读追溯, 标trace状态, 重写追溯, 追加trace }
