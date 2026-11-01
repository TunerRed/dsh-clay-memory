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

function 追加trace(sid, 记录) {
  try {
    appendFileSync(tracePath(sid), JSON.stringify(记录) + String.fromCharCode(10))
  } catch (error) {
    报('trace 写不进去：' + (error && error.message))
  }
}

export { tracePath, 读追溯, 标trace状态, 重写追溯, 追加trace }
