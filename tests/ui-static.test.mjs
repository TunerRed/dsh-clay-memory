// UI 静态行为测试：页签覆盖、路由存在性、关键交互参数（不依赖浏览器）
import { test } from 'node:test'
import assert from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'

// 2026-11-11：前端拆到 src/client/ 了，lib/client.js 变成 esbuild 产物（会被重排版、改引号）。
// 静态结构测试改读**源码**，否则 esbuild 一重排就全红。
const 根 = 'G:/tmp/fish-memory-dev/src/client'
const src =
  readFileSync(根 + '/正文.js', 'utf8') +
  '\n' +
  readdirSync(根 + '/pages')
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(根 + '/pages/' + f, 'utf8'))
    .join('\n')
const 服务端 = readdirSync('G:/tmp/fish-memory-dev/lib')
  .filter((f) => /^routes-.*\.mjs$/.test(f))
  .map((f) => readFileSync('G:/tmp/fish-memory-dev/lib/' + f, 'utf8'))
  .concat([readFileSync('G:/tmp/fish-memory-dev/lib/reply-check/routes.js', 'utf8')])
  .join('\n')

test('主面板 5 个页签都有渲染分支（记忆/会话/回收站/体检/高级）', () => {
  assert.match(src, /if \(页签 === '记忆'\)/)
  assert.match(src, /else if \(页签 === '会话'\)/)
  assert.match(src, /else if \(页签 === '回收站'\)/)
  assert.match(src, /else if \(页签 === '体检'\)/)
  assert.match(src, /else 内容 = el\(高级区/, '高级页签必须有兜底渲染分支，否则点了空白')
})

test('会话详情 4 个页签都有渲染条件（记忆/称呼/导入记录/召回记录）', () => {
  for (const k of ['记忆', '称呼', '导入记录', '召回记录']) {
    const re = new RegExp(`详情页 === '${k}'`)
    assert.match(src, re, `页签「${k}」没有渲染条件`)
  }
})

test('所有 post 的路由都能在服务端找到', () => {
  const 路由 = new Set()
  for (const m of src.matchAll(/post\('(\/[^'"]+)'/g)) 路由.add(m[1])
  assert.ok(路由.size > 10, `post 路由太少: ${路由.size}`)
  // 服务端路由（mroute('/dsh-clay-memory/xxx', ...) 统一注册）
  const 服务端路由 = new Set()
  for (const m of 服务端.matchAll(/mroute\('(\/dsh-clay-memory\/[^'?]+)'/g)) 服务端路由.add(m[1].replace('/dsh-clay-memory', ''))
  const 未注册 = [...路由].filter((r) => !服务端路由.has(r) && !服务端路由.has(r.split('?')[0]))
  // /facts/edit 走另一套路由注册，单独放行
  const 放行 = ['/facts/edit']
  const 真缺 = 未注册.filter((r) => !放行.includes(r))
  assert.deepStrictEqual(真缺, [], '这些 post 路由在服务端找不到: ' + 真缺.join(', '))
})

test('改层级：/edit 调用带 scope，且服务端支持 workspace', () => {
  assert.match(src, /scope: edit\.层级/, '会话详情改记忆时必须传层级')
  assert.match(src, /scope: 新层/, '所有记忆页改层级时必须传层级')
  assert.match(服务端, /改域 !== 'workspace'/, '服务端 /edit 必须接受 workspace')
})

test('同一 id 两条记忆不串：行键用 id+session，删除/编辑按行键匹配', () => {
  assert.match(src, /const 行键 = \(m\) =>/, '缺少行键函数')
  assert.match(src, /在改 === 行键\(m\)|在改 === 行键/, '编辑高亮应按行键匹配')
  assert.match(src, /要删 === 行键\(m\)|要删 === 行键/, '删除确认应按行键匹配')
})

test('页签 key 与筛选值一致：召回记录页签 key 不能写成「记录」', () => {
  assert.ok(!/详情页 === '记录'/.test(src), '页签 key 写错了，渲染条件匹配不上')
})
