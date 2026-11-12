#!/usr/bin/env node
// F10 阶段 0：给事实池打 is_knowledge 标（知识 vs 画像）。
//
// 口径（2026-11-12 与真库核对后定）：
//   · type === 'misc'  → 知识（技术笔记 / 环境配置 / 工具用法 / 报错处理）
//   · 其余（identity / preference / promise / relation / experience / 未标）→ 画像
//   ⚠ 未标不等于知识：真库里 8 条未标全是「主人爱吃西红柿鸡蛋盖浇饭」「句末不点句号」这类画像。
//     v1 曾把「未标」算进知识，抽样发现会误伤，已改。
//
// 用法：
//   node tools/tag-knowledge.mjs <clay-memory 目录>            # 只统计，不写
//   node tools/tag-knowledge.mjs <clay-memory 目录> --write    # 落盘（先备份）
//
// 只动 _facts.json 的 memories[] 里每条的记忆对象，加一个布尔字段 is_knowledge；
// 其它字段一个字不动（updatedAt 也不碰 —— 那样会盖掉并发写入里更新的一份）。

import fs from 'node:fs'
import path from 'node:path'
import { writeFileAtomicSync } from '../lib/atomic-file.mjs'

const 目录 = process.argv[2]
const 写 = process.argv.includes('--write')
if (!目录) {
  console.error('用法: node tools/tag-knowledge.mjs <clay-memory 目录> [--write]')
  process.exit(2)
}
const 文件 = path.join(目录, '_facts.json')
if (!fs.existsSync(文件)) {
  console.error('找不到', 文件)
  process.exit(2)
}

const 库 = JSON.parse(fs.readFileSync(文件, 'utf8'))
const 记忆们 = Array.isArray(库.memories) ? 库.memories : []
if (!记忆们.length) {
  console.error('库里没有 memories')
  process.exit(2)
}

const 判 = (m) => m.type === 'misc'
let 知识 = 0
let 画像 = 0
let 已打过 = 0
const 会改 = []
for (const m of 记忆们) {
  const 值 = 判(m)
  if (值) 知识 += 1
  else 画像 += 1
  if (m.is_knowledge === 值) 已打过 += 1
  else 会改.push(m)
}

const 字 = (n) => String(n).padStart(6)
console.log(`库文件    ${文件}`)
console.log(`总条数    ${字(记忆们.length)}`)
console.log(`知识      ${字(知识)}  (${((知识 / 记忆们.length) * 100).toFixed(1)}%)  type=misc`)
console.log(`画像      ${字(画像)}  (${((画像 / 记忆们.length) * 100).toFixed(1)}%)  其余类型 + 未标`)
console.log(`已带标记  ${字(已打过)}`)
console.log(`本次要改  ${字(会改.length)}`)

const 未标 = 记忆们.filter((m) => !m.type)
if (未标.length) {
  console.log(`\n未标 type 的 ${未标.length} 条（按画像处理）：`)
  for (const m of 未标.slice(0, 10)) console.log('  -', String(m.text).slice(0, 50))
}

if (!写) {
  console.log('\n（预览模式。加 --write 才落盘）')
  process.exit(0)
}
if (!会改.length) {
  console.log('\n全部已带正确标记，无需写入')
  process.exit(0)
}

const 备份 = 文件 + '.bak-tag-' + new Date().toISOString().replace(/[:.]/g, '-')
fs.copyFileSync(文件, 备份)
for (const m of 会改) m.is_knowledge = 判(m)
writeFileAtomicSync(文件, JSON.stringify(库, null, 2) + '\n')
console.log(`\n已写入 ${会改.length} 条；备份 ${path.basename(备份)}`)
