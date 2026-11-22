// 2026-10-30 拆层工程第 10 批：诊断日志从 index.js 抽出
// 1MB 轮转、只留一代；同步写（宿主事件循环里没有 await，见 index.js 原注释）
import { writeFileSync, mkdirSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { CFG_DIR, STORE_DIR } from './paths.mjs'

export const DIAG = join(CFG_DIR, 'clay-memory-diag.log')

export function diag(msg) {
  try {
    mkdirSync(STORE_DIR, { recursive: true })
    // 2026-10-25（issue #2）：以前只 append、没有上限 —— 实测一天长 1.2MB、一年上百 MB，
    // 而且这是宿主事件循环里的同步写。现在超过 1MB 就轮转成 `.1`（只留一代，覆盖旧的）。
    let 多大 = 0
    try { 多大 = statSync(DIAG).size } catch (error) { 多大 = 0 }
    if (多大 > 1024 * 1024) {
      try { renameSync(DIAG, DIAG + '.1') } catch (error) {}
    }
    writeFileSync(DIAG, new Date().toISOString() + '  ' + msg + '\n', { flag: 'a' })
  } catch (error) {}
}
