// 修剪已有的召回轨迹：每个 <会话>.traces.jsonl 只留最近 N 行。
// 用法：node tools/trim-traces.mjs <存储目录> [保留行数=2000]
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const 目录 = process.argv[2]
const 保留 = Number(process.argv[3] || 2000)
if (!目录) {
  console.error('用法：node tools/trim-traces.mjs <存储目录> [保留行数]')
  process.exit(2)
}

let 文件数 = 0
let 剪掉行 = 0
let 省字节 = 0
for (const f of readdirSync(目录)) {
  if (!f.endsWith('.traces.jsonl')) continue
  const p = join(目录, f)
  const 前 = statSync(p).size
  const raw = readFileSync(p, 'utf8')
  const 行 = raw.split(String.fromCharCode(10)).filter(Boolean)
  if (行.length <= 保留) continue
  const 留 = 行.slice(-保留)
  writeFileSync(p, 留.join(String.fromCharCode(10)) + String.fromCharCode(10))
  const 后 = statSync(p).size
  文件数 += 1
  剪掉行 += 行.length - 留.length
  省字节 += 前 - 后
  console.log(`${f}  ${行.length} → ${留.length} 行  ${(前 / 1048576).toFixed(1)}M → ${(后 / 1048576).toFixed(1)}M`)
}
console.log(`合计：${文件数} 个文件，剪掉 ${剪掉行} 行，省 ${(省字节 / 1048576).toFixed(1)}M`)
