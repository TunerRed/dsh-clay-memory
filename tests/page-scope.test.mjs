// 页面模块作用域检查：每个 pages/*.js 用到的名字，必须能「自己声明」或「从参数/import 拿到」。
// 这条测试是补 2026-11-11 三个真机白屏（进度 / 选择器 / 洗键进度）的坑——
// 拆文件时少传一个依赖，页面在真机上整块白掉，而单元测试全绿。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'

const 根 = join(dirname(fileURLToPath(import.meta.url)), '..')

// acorn 是 devDependency：发布包里没有 node_modules，装机副本跑会 import 失败 → 跳过
const 有解析器 = existsSync(join(根, 'node_modules/acorn'))
const 跳过 = 有解析器 ? false : '没装 acorn（devDependency），跳过扫描器用例'

test('页面模块没有未绑定的名字', { skip: 跳过 }, () => {
  const 输出 = execFileSync(process.execPath, [join(根, 'tools/scan-page-scope.mjs')], { encoding: 'utf8' })
  assert.match(输出, /✓/, '扫描器应当报告通过')
  assert.doesNotMatch(输出, /既没声明也没传进来/, '不应该有未绑定的名字')
})

test('扫描器能抓到漏传的依赖（负向验证）', { skip: 跳过 }, () => {
  // 造一个「用了 el、但没从参数拿到」的页面模块，扫描器必须报出来
  const 临时 = mkdtempSync(join(tmpdir(), 'scope-'))
  const 页目录 = join(临时, 'pages')
  mkdirSync(页目录, { recursive: true })
  writeFileSync(join(页目录, '坏页面.js'), [
    'export function 造坏页面({ React }) {',
    '  return function 坏页面() { return el("div", null, "hi") }',
    '}',
  ].join(String.fromCharCode(10)))

  let 输出 = ''
  let 码 = 0
  try {
    输出 = execFileSync(process.execPath, [join(根, 'tools/scan-page-scope.mjs'), 临时], { encoding: 'utf8' })
  } catch (e) {
    码 = e.status ?? 1
    输出 = String((e.stdout || '') + (e.stderr || ''))
  }
  rmSync(临时, { recursive: true, force: true })
  assert.equal(码, 1, '有未绑定名字时应当非零退出')
  assert.match(输出, /「el」/, '应当点名 el')
})

test('扫描器不误报解构参数与 import', { skip: 跳过 }, () => {
  const 临时 = mkdtempSync(join(tmpdir(), 'scope-ok-'))
  const 页目录 = join(临时, 'pages')
  mkdirSync(页目录, { recursive: true })
  writeFileSync(join(页目录, '好页面.js'), [
    "import { 造选择器 } from '../components/select.js'",
    'export function 造好页面({ React, el, get }) {',
    '  const 选择器 = 造选择器({ React, el })',
    '  return function 好页面() {',
    '    const [x, setX] = React.useState(null)',
    '    get("/x").then((v) => setX(v))',
    '    return el(选择器, { 值: x })',
    '  }',
    '}',
  ].join(String.fromCharCode(10)))

  const 输出 = execFileSync(process.execPath, [join(根, 'tools/scan-page-scope.mjs'), 临时], { encoding: 'utf8' })
  rmSync(临时, { recursive: true, force: true })
  assert.match(输出, /✓/, '解构参数与 import 应当被认作已绑定')
})

test('扫描器扫的是真实页面目录', () => {
  const 文件们 = readdirSync(join(根, 'src/client/pages')).filter((f) => f.endsWith('.js'))
  assert.ok(文件们.length >= 6, '页面模块不应少于 6 个')
})
