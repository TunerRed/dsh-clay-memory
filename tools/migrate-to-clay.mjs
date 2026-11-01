#!/usr/bin/env node
// 从「鱼的记忆 / 可塑记忆」时期的目录名搬到「黏土记忆」的目录名。
//
// 1.5.x 及更早：DSH_HOME/fish-memory/、fish-memory-backup/、fish-memory-config.json、fish-memory-diag.log
// 1.6.0 起：     DSH_HOME/clay-memory/、clay-memory-backup/、clay-memory-config.json、clay-memory-diag.log
//
// 用法：
//   node tools/migrate-to-clay.mjs            # 预演（只说会做什么）
//   node tools/migrate-to-clay.mjs --apply    # 真的复制（源目录保留，不删）
//
// 注意：只「复制」，不删老目录。确认新目录能用之后，自己决定要不要删老目录。

import { existsSync, cpSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const 应用 = process.argv.includes('--apply')

// DSH_HOME：优先环境变量，其次 ~/.dsh
const 家 = process.env.DSH_HOME || join(homedir(), '.dsh')
const 根 = resolve(家)

const 清单 = [
  ['fish-memory', 'clay-memory', '会话 / 事实库目录'],
  ['fish-memory-backup', 'clay-memory-backup', '备份目录'],
  ['fish-memory-config.json', 'clay-memory-config.json', '配置（开关、称呼、权重）'],
  ['fish-memory-diag.log', 'clay-memory-diag.log', '诊断日志（可不要）'],
]

console.log(`DSH_HOME = ${根}`)
console.log(应用 ? '模式：真的复制（源目录保留）' : '模式：预演（加 --apply 才真做）')
console.log('')

let 做 = 0
for (const [旧名, 新名, 说明] of 清单) {
  const 旧 = join(根, 旧名)
  const 新 = join(根, 新名)
  if (!existsSync(旧)) {
    console.log(`跳过  ${旧名}  —— 不存在`)
    continue
  }
  if (existsSync(新)) {
    console.log(`跳过  ${旧名} → ${新名}  —— 新目录已经有了，不覆盖`)
    continue
  }
  console.log(`${应用 ? '复制' : '将复制'}  ${旧名} → ${新名}  （${说明}）`)
  做++
  if (应用) cpSync(旧, 新, { recursive: true, errorOnExist: false, force: false })
}

console.log('')
if (!做) {
  console.log('没有要搬的东西 —— 要么已经搬过，要么本来就没用过老版本。')
} else if (应用) {
  console.log(`搬完 ${做} 项。老目录还在，确认插件能读到数据之后再自己删。`)
} else {
  console.log(`有 ${做} 项要搬。确认没问题后加 --apply 真的跑一次。`)
}
