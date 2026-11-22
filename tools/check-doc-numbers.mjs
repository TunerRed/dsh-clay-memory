// tools/check-doc-numbers.mjs —— 文档里的数字 vs 代码默认值
//
// 背景：README 里写过「一天最多记几条（默认 8 条）」「实测版本 1.12.0」这种会过期的数字，
// 代码改了文档忘了跟，用户照着 README 调参就会对不上。这个脚本把几处关键数字抓出来比一遍。
//
// 用法（在开发仓库根）：node tools/check-doc-numbers.mjs
// 退出码：0 全对得上 / 1 有过期数字
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const 仓库根 = fileURLToPath(new URL('..', import.meta.url))
const 读 = (p) => fs.readFileSync(path.join(仓库根, p), 'utf8')

const 版本 = JSON.parse(读('package.json')).version
const cfg = 读('lib/cfg.mjs')
const readme = 读('README.md')
const docs索引 = 读('docs/README.md')
const 规划 = 读('docs/记忆系统规划.md')

// 从 cfg.mjs 的默认 policy 里抓数值（`key: 值,` 形式）
const 取默认 = (键) => {
  const m = cfg.match(new RegExp('\\b' + 键 + ':\\s*([0-9.]+)'))
  return m ? Number(m[1]) : null
}

const 期望 = [
  ['README 实测版本', readme, /插件 \*\*(\d+\.\d+\.\d+)\*\* ↔ DSH/, 版本],
  ['README 半衰期', readme, /半衰期默认 (\d+) 天/, 取默认('baseHalfLifeDays')],
  ['README 每天最多记几条', readme, /一天最多记几条（默认 (\d+) 条）/, 取默认('dailyQuota')],
  ['README 一次最多注入几条', readme, /一次最多注入 (\d+) 条/, 取默认('maxItems')],
  ['README 事实最多几条', readme, /最多 (\d+) 条，设置页能改 0~6/, 取默认('factsMax')],
  ['docs 索引版本', docs索引, /代码版本 \*\*(\d+\.\d+\.\d+)\*\*/, 版本],
  ['需求文档版本', 规划, /^> \*\*版本\*\*：v(\d+\.\d+\.\d+)/m, 版本],
]

let 错 = 0
console.log('代码版本：' + 版本)
for (const [名, 文, 正则, 代码值] of 期望) {
  const m = 文.match(正则)
  if (!m) {
    console.log('  ? ' + 名 + '：文档里没找到这个说法（正则没匹配）')
    continue
  }
  const 文档值 = isNaN(Number(m[1])) ? m[1] : Number(m[1])
  const 对 = String(文档值) === String(代码值)
  if (!对) 错++
  console.log((对 ? '  ✓ ' : '  ✗ ') + 名 + '：文档 ' + 文档值 + ' / 代码 ' + 代码值)
}

console.log('')
// 顺手核对文档里点名的工具文件在不在
const 工具 = ['tools/check-mirror-coverage.mjs', 'tools/bench/shadow-compare.mjs', 'tools/bench/run-s0.mjs', 'tools/migrate-to-sqlite.mjs', 'tools/doctor.mjs']
for (const t of 工具) {
  const 在 = fs.existsSync(path.join(仓库根, t))
  if (!在) 错++
  console.log((在 ? '  ✓ ' : '  ✗ ') + '文档点名的工具：' + t)
}

console.log('')
console.log(错 ? '✗ ' + 错 + ' 处对不上' : '✓ 文档数字与代码一致')
process.exit(错 ? 1 : 0)
