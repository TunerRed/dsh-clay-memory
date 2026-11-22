#!/usr/bin/env node
// 扫 src/client/pages/*.js：找出「用了、但既没声明也没从参数/import 拿到」的名字。
//
// 为什么需要它：client.js 拆成模块后，页面里用到的东西必须显式传参或 import。
// 漏一个，真机上点开那一页就是整块白掉（2026-11-11 连踩三次：进度、选择器、洗键进度）。
//
// 做法（刻意保守，不追求精确作用域）：把一个模块里「所有绑定位置出现过的名字」都当作已绑定，
// 其余标识符里，去掉 import、属性名、全局白名单，剩下的就是可疑的自由变量。
// 这样宁可漏报，不会误报——误报会让人不再信这个检查。
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse } from 'acorn'

const 全局白名单 = new Set([
  'React', 'require', 'module', 'exports', 'globalThis', 'console', 'window', 'document', 'navigator',
  'localStorage', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'fetch', 'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'FormData', 'AbortController',
  'JSON', 'Math', 'Date', 'Promise', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'Intl', 'crypto',
  'undefined', 'NaN', 'Infinity', 'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'structuredClone',
  'encodeURIComponent', 'decodeURIComponent', 'escape', 'unescape', 'alert', 'confirm', 'prompt',
  'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'HTMLElement', 'Element', 'Node', 'Image',
  'performance', 'queueMicrotask', 'getComputedStyle', 'history', 'location', 'atob', 'btoa',
  'Buffer', 'process', 'AbortSignal', 'Float32Array',
])

// 把「模式」里出现的标识符都记成绑定：let { a, b: c } = x / function f({ el, get }) / catch (e)
const 收模式名 = (节点, 收集) => {
  if (!节点) return
  if (节点.type === 'Identifier') { 收集(节点.name); return }
  if (节点.type === 'ObjectPattern') { for (const p of 节点.properties) 收模式名(p.type === 'RestElement' ? p : p.value, 收集); return }
  if (节点.type === 'ArrayPattern') { for (const x of 节点.elements) 收模式名(x, 收集); return }
  if (节点.type === 'AssignmentPattern') { 收模式名(节点.left, 收集); return }
  if (节点.type === 'RestElement') { 收模式名(节点.argument, 收集) }
}

const 走 = (node, 回调, parent = null) => {
  if (!node || typeof node.type !== 'string') return
  回调(node, parent)
  for (const 键 of Object.keys(node)) {
    if (键 === 'type' || 键 === 'start' || 键 === 'end') continue
    const 值 = node[键]
    if (Array.isArray(值)) 值.forEach((x) => 走(x, 回调, node))
    else if (值 && typeof 值.type === 'string') 走(值, 回调, node)
  }
}

const 扫一个文件 = (路径) => {
  const 源码 = readFileSync(路径, 'utf8')
  const ast = parse(源码, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const 已绑定 = new Set()
  const 引用 = new Map() // 名字 → 首次出现行号
  走(ast, (node) => {
    if (node.type === 'VariableDeclarator') 收模式名(node.id, (n) => 已绑定.add(n))
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      if (node.id) 收模式名(node.id, (n) => 已绑定.add(n))
      for (const p of node.params) 收模式名(p, (n) => 已绑定.add(n))
    }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') { if (node.id) 收模式名(node.id, (n) => 已绑定.add(n)) }
    if (node.type === 'CatchClause') 收模式名(node.param, (n) => 已绑定.add(n))
    if (node.type === 'ImportSpecifier' || node.type === 'ImportDefaultSpecifier' || node.type === 'ImportNamespaceSpecifier') {
      if (node.local) 已绑定.add(node.local.name)
    }
  })
  走(ast, (node, parent) => {
    if (node.type !== 'Identifier') return
    // 绑定位置、属性名、成员访问的属性不算「使用」
    if (parent && (parent.type === 'VariableDeclarator' && parent.id === node)) return
    if (parent && parent.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand) return
    if (parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return
    if (parent && (parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier' || parent.type === 'ImportNamespaceSpecifier')) return
    if (parent && parent.type === 'MetaProperty') return
    if (!引用.has(node.name)) 引用.set(node.name, node.loc?.start?.line ?? 0)
  })
  const 可疑 = [...引用.entries()].filter(([名]) => !已绑定.has(名) && !全局白名单.has(名))
  return 可疑
}

const 收集JS = (p) =>
  readdirSync(p, { withFileTypes: true }).flatMap((d) => {
    const full = join(p, d.name)
    if (d.isDirectory()) return 收集JS(full)
    return d.name.endsWith('.js') ? [full] : []
  })

const 目录 = process.argv[2] ?? 'src/client'
const 页目录 = join(目录, 'pages')
const 文件们 = 收集JS(页目录)
let 有问题 = false
for (const fp of 文件们) {
  const 可疑 = 扫一个文件(fp)
  if (!可疑.length) continue
  有问题 = true
  const 标签 = relative(页目录, fp)
  for (const [名, 行] of 可疑) console.log(`${标签}:${行}  「${名}」既没声明也没传进来`)
}
// 默认模式下顺带扫 lib/（不含打包产物 client.js），防拆层漏 import（如 TZ_OFFSET / MEMORY_PAGE / 生成档案）
let 后端数 = 0
if (!process.argv[2]) {
  const 后端文件 = [
    ...readdirSync('lib').filter((f) => (f.endsWith('.js') || f.endsWith('.mjs')) && f !== 'client.js').map((f) => join('lib', f)),
    ...readdirSync('lib/reply-check').filter((f) => f.endsWith('.js') || f.endsWith('.mjs')).map((f) => join('lib/reply-check', f)),
  ]
  后端数 = 后端文件.length
  for (const fp of 后端文件) {
    const 可疑 = 扫一个文件(fp)
    if (!可疑.length) continue
    有问题 = true
    for (const [名, 行] of 可疑) console.log(`${fp}:${行}  「${名}」既没声明也没传进来`)
  }
}
if (有问题) {
  console.log('\n✗ 有模块引用了拿不到的名字，运行时会抛 ReferenceError。')
  process.exitCode = 1
} else {
  console.log(`✓ ${文件们.length} 个页面模块` + (后端数 ? ` + ${后端数} 个后端模块` : '') + '都没有未绑定的名字')
}
