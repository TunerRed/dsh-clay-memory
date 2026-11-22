// tools/_check-refs.mjs —— 粗粒度「模块内调用了没定义/没导入的标识符」扫描器
// 2026-10-31 新增：拆层之后多次踩「运行时 ReferenceError（node --check 查不出、测试没覆盖到）」
//   —— tools.mjs 漏 import 归一键、routes-core 漏 loadStore、scoring 漏 DAY 都是这么来的。
// 用法：node tools/_check-refs.mjs [目录]
// 输出每个可疑标识符（文件:行:名字）。人工确认；确认干净的可以加进 LEGACY_OK 白名单。
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const 目录 = process.argv[2] || fileURLToPath(new URL('../lib', import.meta.url))
const 关键字 = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'await', 'async', 'function',
  'do', 'else', 'try', 'throw', 'delete', 'void', 'in', 'of', 'instanceof', 'yield', 'super', 'this',
])
const 内置 = new Set([
  'console', 'JSON', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Promise', 'Map', 'Set',
  'WeakMap', 'WeakSet', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'Infinity',
  'NaN', 'undefined', 'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'encodeURIComponent',
  'decodeURIComponent', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'structuredClone',
  'BigInt', 'Symbol', 'Intl', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'Buffer', 'process',
  'require', 'import', 'export', 'Object', 'Reflect', 'Proxy', 'Atomics', 'queueMicrotask',
])

function 文件们(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.mjs') || f.endsWith('.js')).map((f) => join(dir, f))
}

function 扫描(file) {
  const src = readFileSync(file, 'utf8')
  const 定义 = new Set()
  const 可疑 = []

  // 1) import 进来的名字
  for (const m of src.matchAll(/import\s+([^'"]+?)\s+from\s+['"][^'"]+['"]/g)) {
    const seg = m[1]
    const 花 = seg.match(/\{([\s\S]*?)\}/)
    if (花) {
      for (const part of 花[1].split(',')) {
        const p = part.trim()
        if (!p) continue
        const as = p.split(/\s+as\s+/)
        定义.add((as[1] || as[0]).trim())
      }
    }
    const 默认 = seg.match(/^([A-Za-z_$][\w$]*)\s*(?:,|$)/)
    if (默认 && !默认[1].includes('{')) 定义.add(默认[1])
    const 星 = seg.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)
    if (星) 定义.add(星[1])
  }

  // 2) function / class / const / let / var 定义
  for (const m of src.matchAll(/(?:^|\s)(?:async\s+)?function\s*\*?\s*([一-鿿A-Za-z_$][一-鿿\w$]*)/g)) 定义.add(m[1])
  for (const m of src.matchAll(/(?:^|\s)class\s+([一-鿿A-Za-z_$][一-鿿\w$]*)/g)) 定义.add(m[1])
  for (const m of src.matchAll(/(?:^|\s)(?:const|let|var)\s+([一-鿿A-Za-z_$][一-鿿\w$]*)\s*=/g)) 定义.add(m[1])
  for (const m of src.matchAll(/(?:^|\s)(?:const|let|var)\s+\{([^}]+)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const p = part.trim().split(':').pop().trim()
      if (/^[一-鿿A-Za-z_$][一-鿿\w$]*$/.test(p)) 定义.add(p)
    }
  }
  for (const m of src.matchAll(/(?:^|\s)(?:const|let|var)\s+\[([^\]]+)\]\s*=/g)) {
    for (const part of m[1].split(',')) {
      const p = part.trim()
      if (/^[一-鿿A-Za-z_$][一-鿿\w$]*$/.test(p)) 定义.add(p)
    }
  }

  // 3) 函数参数名（含中文）——减少误报
  for (const m of src.matchAll(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(?:=>|\{)/g)) {
    for (const part of m[1].split(',')) {
      const p = part.trim().replace(/^\.\.\./, '').split('=')[0].trim()
      if (/^[一-鿿A-Za-z_$][一-鿿\w$]*$/.test(p)) 定义.add(p)
    }
  }

  // 4) 扫描调用（先把字符串字面量剥掉，避免 CSS/文本里的 rgba( 之类噪声）
  const 行们 = src.split('\n')
  for (let i = 0; i < 行们.length; i++) {
    const 原文行 = 行们[i]
    if (/^\s*\/\//.test(原文行)) continue // 纯注释行跳过
    const line = 原文行.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/`(?:[^`\\]|\\.)*`/g, '``')
    // 中文标识符不能用 \b 做边界（拆层时踩过）。这里连中文也纳入词字符，
    // 保证「...全局参数(」「…一条(」这种 spread/前缀不会被截成「局参数(」「条(」。
    for (const m of line.matchAll(/(?<![一-鿿A-Za-z_$.\d])([一-鿿A-Za-z_$][一-鿿\w$]*)\s*\(/g)) {
      const name = m[1]
      if (关键字.has(name) || 内置.has(name) || 定义.has(name)) continue
      可疑.push({ 文件: file.split(/[\\/]/).pop(), 行: i + 1, 名字: name })
    }
  }
  return 可疑
}

const 全部 = []
for (const f of 文件们(目录)) 全部.push(...扫描(f))
if (!全部.length) {
  console.log('✓ 没扫到可疑引用')
} else {
  for (const s of 全部) console.log(`${s.文件}:${s.行} → ${s.名字}(`)
  console.log(`\n共 ${全部.length} 处可疑（可能是误报：局部变量名、对象方法简写、模板拼接等，逐个看）`)
}
