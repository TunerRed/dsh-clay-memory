// 目录级对齐：开发仓库 → 装机副本
//
// 2026-11-16（1.12.41）新增。起因见 docs/已知问题清单-2026-11-15.md §4.2：
//   以前同步靠「手动 cp 改过的那几个文件」，2026-11-15 那次就漏了
//   tests/coverage 的 7 个文件、tests/decay.test.mjs、tools/observe.mjs，
//   结果装机副本跑出来 544 过、dev 跑出来 548 过，一看绿灯数不一样就以为代码坏了。
//
// 用法：
//   node tools/sync-installed.mjs              # 只看差异，不动文件
//   node tools/sync-installed.mjs --write      # 真同步（覆盖装机副本）
//   node tools/sync-installed.mjs --check      # 有差异就 exit 1（收尾自查用）
//
// 默认目录（可用环境变量覆盖）：
//   dev 侧   = 这个脚本所在仓库         CLAY_DEV_REPO
//  装机侧   = $DSH_HOME/plugins/<仓库目录名>   CLAY_INSTALLED
//
// ⚠ 只报不删：装机副本里「多出来的文件」只列出来，不自动删 ——
//   那里面可能有她自己的本地改动，删了就找不回来。
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const 本目录 = dirname(fileURLToPath(import.meta.url))
const 仓库根 = resolve(本目录, '..')
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const 源 = resolve(process.env.CLAY_DEV_REPO || 仓库根)
const 目标 = resolve(process.env.CLAY_INSTALLED || join(DSH_HOME, 'plugins', basename(仓库根)))

// 要同步的顶层条目。跟 package.json 的 files 白名单基本一致，
// 但**多带 tests/ 和 docs/** —— 这两样正是 11-15 那次漏掉的重灾区。
const 同步项 = [
  'lib',
  'src',
  'tests',
  'tools',
  'locale',
  'docs',
  'README.md',
  'CHANGELOG.md',
  'package.json',
  'icon.svg',
  'cordis.patch.yml',
  'LICENSE',
]

// 采集时的排除：依赖、git、本地临时物、以及**不进发布包的大数据文件**
// （后面对 tools/bench 那三个，跟 package.json files 的 ! 排除项对应）
const 排除目录 = new Set(['node_modules', '.git', 'tmp', '.claude', '.vscode'])
const 排除文件 = new Set(['.DS_Store', 'Thumbs.db'])
const 排除路径后缀 = [
  join('tools', 'bench', 'S0-data-snapshot.tar'),
  join('tools', 'bench', 'S0-baseline.json'),
  join('tools', 'bench', 'queries.json'),
]
function 该排除(相对) {
  const 段 = 相对.split(/[\\/]/)
  if (段.some((s) => 排除目录.has(s))) return true
  if (排除文件.has(段[段.length - 1])) return true
  if (/\.log$|\.db$|\.db-wal$|\.db-shm$/.test(段[段.length - 1])) return true
  return 排除路径后缀.some((p) => 相对 === p)
}

/** 把一个根下的文件收成 Map<相对路径, 字节数> */
function 采集(根) {
  const 表 = new Map()
  if (!existsSync(根)) return 表
  const 走 = (目录) => {
    let 项 = []
    try {
      项 = readdirSync(目录)
    } catch (error) {
      return
    }
    for (const 名 of 项) {
      const 全 = join(目录, 名)
      const 相对 = relative(根, 全)
      if (该排除(相对)) continue
      let st
      try {
        st = statSync(全)
      } catch (error) {
        continue
      }
      if (st.isDirectory()) 走(全)
      else if (st.isFile()) 表.set(相对, st.size)
    }
  }
  for (const 项名 of 同步项) {
    const 全 = join(根, 项名)
    if (!existsSync(全)) continue
    let st
    try {
      st = statSync(全)
    } catch (error) {
      continue
    }
    if (st.isDirectory()) 走(全)
    else 表.set(项名, st.size)
  }
  return 表
}

function 内容同(a, b) {
  try {
    const x = readFileSync(a)
    const y = readFileSync(b)
    if (x.length !== y.length) return false
    return x.equals(y)
  } catch (error) {
    return false
  }
}

const 源表 = 采集(源)
const 目标表 = 采集(目标)

if (!existsSync(源)) {
  console.error('源目录不存在：' + 源)
  process.exit(2)
}

const 缺 = [] // 装机副本没有（新增）
const 改 = [] // 两边都有但内容不同
const 多 = [] // 装机副本多出来（只报告，不删）

for (const 相对 of 源表.keys()) {
  const 目标文件 = join(目标, 相对)
  if (!目标表.has(相对)) 缺.push(相对)
  else if (!内容同(join(源, 相对), 目标文件)) 改.push(相对)
}
for (const 相对 of 目标表.keys()) {
  if (!源表.has(相对)) 多.push(相对)
}

缺.sort()
改.sort()
多.sort()

const 写 = process.argv.includes('--write')
const 仅检查 = process.argv.includes('--check')

console.log('源  ：' + 源)
console.log('目标：' + 目标)
console.log('')

if (!缺.length && !改.length && !多.length) {
  console.log('✓ 两边一致（' + 源表.size + ' 个文件）')
  process.exit(0)
}

if (缺.length) {
  console.log('装机副本缺 ' + 缺.length + ' 个文件：')
  for (const f of 缺) console.log('  + ' + f)
  console.log('')
}
if (改.length) {
  console.log('内容不同 ' + 改.length + ' 个文件：')
  for (const f of 改) console.log('  ~ ' + f)
  console.log('')
}
if (多.length) {
  console.log('装机副本多 ' + 多.length + ' 个文件（只报告，不自动删 —— 可能有本地改动）：')
  for (const f of 多) console.log('  - ' + f)
  console.log('')
}

if (写) {
  let 拷了 = 0
  for (const 相对 of [...缺, ...改]) {
    const 目标文件 = join(目标, 相对)
    mkdirSync(dirname(目标文件), { recursive: true })
    copyFileSync(join(源, 相对), 目标文件)
    拷了++
  }
  console.log('✓ 已同步 ' + 拷了 + ' 个文件')
  if (多.length) console.log('  （多出来的 ' + 多.length + ' 个没动，要删自己确认后删）')
  console.log('  改完记得重启桌面，插件才会重新加载')
  process.exit(0)
}

if (仅检查) {
  console.error('✗ 两边不一致（' + (缺.length + 改.length) + ' 个需要同步；多出来的不计）')
  process.exit(1)
}

console.log('（只是看，没动文件。要真同步加 --write，要收尾自查加 --check）')
