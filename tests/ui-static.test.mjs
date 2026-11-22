// UI 静态行为测试：页签覆盖、路由存在性、关键交互参数（不依赖浏览器）
import { test } from 'node:test'
import assert from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-11-11：前端拆到 src/client/ 了，lib/client.js 变成 esbuild 产物（会被重排版、改引号）。
// 静态结构测试改读**源码**，否则 esbuild 一重排就全红。
// 2026-11-16：仓库从本地临时目录迁到固定仓库目录，路径改成按测试文件位置算，别再写死盘符。
const 仓库根 = join(dirname(fileURLToPath(import.meta.url)), '..')
const 根 = join(仓库根, 'src/client')
const 收集JS = (目录) =>
  readdirSync(目录, { withFileTypes: true }).flatMap((d) => {
    const p = join(目录, d.name)
    if (d.isDirectory()) return 收集JS(p)
    return d.name.endsWith('.js') ? [p] : []
  })
const src =
  readFileSync(根 + '/app.js', 'utf8') +
  '\n' +
  收集JS(根 + '/pages')
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n')
const 服务端 = readdirSync(join(仓库根, 'lib'))
  .filter((f) => /^routes-.*\.mjs$/.test(f))
  .map((f) => readFileSync(join(仓库根, 'lib', f), 'utf8'))
  .concat([readFileSync(join(仓库根, 'lib', 'reply-check', 'routes.js'), 'utf8')])
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

// ⭐⭐ 2026-11-15：**所有记忆页的数据源契约**。
//   为什么要有这两条：页面原来走 `/list`，而 `/list` 会按「DSH 里还认得的会话」过滤——
//   测试实例那种「记忆文件是灌进去的、会话没在 DSH 里开过」的场景，
//   实测 44 个有记忆的会话**一个都不在册**，全被当幽灵藏掉：库里 725 条、页面一条不剩。
//   这种 bug 从渲染结构上完全看不出来（页面确实空态、也确实没报错），
//   只有「装载到底调了哪个接口、那个接口给不给这几个字段」这一层能挡住。
test('所有记忆页必须走 POST /all（不能用 /list）', () => {
  const 记忆页 = readFileSync(根 + '/pages/memories.js', 'utf8')
  assert.match(记忆页, /post\('\/all'/, '装载必须调 POST /all')
  assert.doesNotMatch(记忆页, /get\('\/list'\)/, '不许退回 /list：它按会话注册过滤，灌进去的记忆会整片消失')
  // 字段契约：页面真正用到的字段，/all 必须给得出来
  for (const 字段 of ['memories', 'deleted', 'sessions', 'stats']) {
    assert.match(记忆页, new RegExp('r\\.' + 字段), '装载要用 /all 返回的 ' + 字段)
  }
})

test('/all 服务端真的给这几个字段，且直接扫库（不依赖会话注册）', () => {
  const 路由 = readFileSync(join(仓库根, 'lib', 'routes-core.mjs'), 'utf8')
  const 段 = 路由.slice(路由.indexOf("mroute('/dsh-clay-memory/all'"))
  for (const 字段 of ['出.memories', '出.deleted', '出.sessions', '出.stats']) {
    assert.ok(段.includes(字段), '/all 没给 ' + 字段)
  }
  assert.match(段, /readdirSync\(STORE_DIR\)/, '/all 必须直接扫库，不能依赖会话注册')
})
