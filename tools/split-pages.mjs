// 通用拆分器：把 app.js 里若干顶层函数整块搬到 src/client/pages/<文件>.js
// 用法：node tools/split-pages.mjs <模块名> <文件> <导出名1,导出名2,...> <要搬的函数名1,函数名2,...>
// 规则：搬走的函数之间可以互相调用（都在同一模块内）；主装配层里只保留用得到的那几个导出。
import { readFileSync, writeFileSync } from 'node:fs'

const [模块名, 文件, 导出串, 搬走串] = process.argv.slice(2)
if (!模块名 || !文件 || !导出串 || !搬走串) {
  console.error('用法：node tools/split-pages.mjs <模块名> <文件> <导出名,..> <函数名,..>')
  process.exit(1)
}
const 导出名们 = 导出串.split(',').map((s) => s.trim()).filter(Boolean)
const 搬走名们 = 搬走串.split(',').map((s) => s.trim()).filter(Boolean)

const 路径 = 'src/client/app.js'
let 行 = readFileSync(路径, 'utf8').split('\n')

function 找函数(名) {
  const 起 = 行.findIndex((l) => new RegExp('^\\s{2,6}function ' + 名 + '\\(').test(l))
  if (起 < 0) throw new Error('找不到函数 ' + 名)
  let 深 = 0
  for (let i = 起; i < 行.length; i++) {
    for (const ch of 行[i]) {
      if (ch === '{') 深++
      else if (ch === '}') {
        深--
        if (深 === 0) return { 起, 止: i }
      }
    }
  }
  throw new Error(名 + ' 没闭合')
}

// 收集所有正文顶层名字，用来判断依赖
const 顶层名 = []
for (const l of 行) {
  const m = /^ {4}(?:functions+([A-Za-z一-龥_$][w一-龥$]*)|(?:const|let|var)s+([A-Za-z一-龥_$][w一-龥$]*)s*=)/.exec(l)
  if (m) 顶层名.push(m[1] || m[2])
}

const 区间们 = 搬走名们.map((n) => ({ 名: n, ...找函数(n) })).sort((a, b) => a.起 - b.起)
const 搬走文本 = 区间们.map((r) => 行.slice(r.起, r.止 + 1).join('\n')).join('\n')

// 依赖：被搬走的函数引用、但不在搬走集合里的顶层名
const 依赖 = [...new Set(顶层名)].filter(
  (n) => !搬走名们.includes(n) && new RegExp('(^|[^\\w\\u4e00-\\u9fa5$])' + n + '([^\\w\\u4e00-\\u9fa5$]|$)').test(搬走文本),
)
// React / el / get / post 这类也一并看看
for (const 基础 of ['React', 'el', 'get', 'post', 'B', 'S', 'G', 'fmt', 'rel', 'impName', 'toPct', 'fromPct', '类型名', '类型表', '同日', '由id猜时间', '归整', '合并成一份', '一次最多画', '重要色']) {
  if (依赖.includes(基础)) continue
  if (new RegExp('(^|[^\\w\\u4e00-\\u9fa5$])' + 基础 + '([^\\w\\u4e00-\\u9fa5$]|$)').test(搬走文本)) 依赖.push(基础)
}

const 依赖参数 = '{ ' + 依赖.join(', ') + ' }'
writeFileSync(
  'src/client/pages/' + 文件 + '.js',
  `// ${模块名} —— 2026-11-11 从 lib/client.js 拆出来（逻辑未改）\n` +
    `// 依赖由正文注入；模块内部自成一体。\n` +
    `export function 造${模块名}(${依赖参数}) {\n` +
    搬走文本.replace(/^/gm, '  ') +
    `\n  return { ${导出名们.join(', ')} }\n}\n`,
  'utf8',
)

// 从正文删掉（从后往前），并在第一个位置放解构
for (const r of [...区间们].sort((a, b) => b.起 - a.起)) 行.splice(r.起, r.止 - r.起 + 1)
const 插入点 = 区间们[0].起
行.splice(插入点, 0, `  const { ${导出名们.join(', ')} } = 造${模块名}(${依赖参数})`)

// 顶部补 import
行.unshift(`import { 造${模块名} } from './pages/${文件}.js'`)
writeFileSync(路径, 行.join('\n'), 'utf8')
console.log(模块名, '→ pages/' + 文件 + '.js；依赖', 依赖.join(', '), '；正文剩', 行.length, '行')
