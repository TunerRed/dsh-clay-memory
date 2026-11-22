import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 生成/LLM 路由（lib/routes-gen.mjs）注册表快照 —— 这个模块 1084 行、**零测试覆盖**。
//
// ⚠ 为什么只测「注册了哪些路由」而不测 handler 的行为：
//   · 它只有一个导出 `注册生成路由(mroute, 环)`，内部注册 15 条 HTTP 路由；
//   · 每个 handler 都要真宿主 ctx（ctx.llm 调模型、ctx.agents 取会话）、真库、真读盘，
//     `/dirs` 甚至硬编码枚举 C:~G: 盘符（Windows 专属），单测里跑 handler 投入产出比极低；
//   · 真正的业务逻辑都在它 import 的 llm.mjs / backup.mjs / ui.mjs / scoring.mjs 里 ——
//     那几层已由本目录 cov-llm-parse / cov-backup / cov-ui 等测试覆盖。
//   所以这里守的是一条**结构性**不变量：**15 条路由一条都不能漏、不能改名**。
//
// 🔴 为什么这条值得守：前端（src/client）用 `post('/xxx')` 打这些路径，
//   服务端漏注册或改名 ⇒ 用户点「提炼 / 洗键 / 生成档案 / 复制记忆」就是 404，
//   而且**编译期发现不了**（前端是字符串拼接，没有类型约束）。
//   tests/ui-static.test.mjs 从前端那侧查「打的接口服务端有没有」，
//   但它读的是 routes-*.mjs 的**源码文本**（正则匹配），本测试则**真的调用注册函数**，
//   从运行时确认这 15 条确实挂上了 —— 两者互补：文本匹配会漏掉「注册函数没被调用」这类问题。
//
// ⚠ 全程不调 handler、不联网、不读真实库（只注册，注册本身不碰盘）。
const home = mkdtempSync(join(tmpdir(), 'fish-cov-routesgen-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')

const { 注册生成路由 } = await import('../../lib/routes-gen.mjs')

// 记录型 mroute：只把 (path, handler) 收下来，绝不调用 handler
function 收集路由() {
  const 表 = []
  const mroute = (path, handler) => { 表.push({ path, handler }) }
  // 环：handler 里才用到的三样，这里给最小桩（注册阶段不会碰它们）
  const 环 = {
    ctx: { get: () => undefined, agents: { list: () => [], get: () => null } },
    读JSON体: async () => ({}),
    路径在允许范围: () => true,
  }
  注册生成路由(mroute, 环)
  return 表
}

// 期望注册的 15 条（去掉统一前缀 /dsh-clay-memory 便于阅读）
const 应有 = [
  '/dirs', '/models',
  '/gen-sessions', '/gen-plan', '/gen-run', '/gen-save',
  '/refine', '/refine/undo', '/refine/retry',
  '/wash-keys', '/wash-keys/undo',
  '/copy-to', '/llm-check', '/expand', '/policy',
].sort()

test('注册生成路由：正好注册 15 条，一条不多一条不少', () => {
  const 表 = 收集路由()
  const 实有 = 表.map((r) => r.path.replace('/dsh-clay-memory', '')).sort()

  // ⚠ 用集合双向比对：既查「该有的漏了没」，也查「多出了没登记的路由」
  const 漏了 = 应有.filter((p) => !实有.includes(p))
  const 多了 = 实有.filter((p) => !应有.includes(p))
  assert.deepEqual(漏了, [], '这些路由没注册上（前端点了会 404）：' + 漏了.join(', '))
  assert.deepEqual(多了, [], '这些路由不在预期清单里（新增/改名了要同步更新本测试）：' + 多了.join(', '))
  assert.equal(实有.length, 15, '路由总数该是 15，实际 ' + 实有.length)
  // 无重复注册（同一个 path 注册两次，后一个会盖前一个，往往是复制粘贴漏改）
  assert.equal(new Set(实有).size, 实有.length, '有重复注册的路由：' + 实有.join(', '))
})

test('注册生成路由：每条路径都带统一前缀，且 handler 都是函数', () => {
  const 表 = 收集路由()
  for (const r of 表) {
    assert.ok(r.path.startsWith('/dsh-clay-memory/'), `路由 ${r.path} 缺统一前缀 /dsh-clay-memory/`)
    assert.equal(typeof r.handler, 'function', `路由 ${r.path} 的 handler 不是函数`)
    // handler 必须是 async（它们都要 await 读JSON体 / 问模型）—— 漏了 async 会让 res.end 时序错乱
    assert.equal(r.handler.constructor.name, 'AsyncFunction', `路由 ${r.path} 的 handler 该是 async 函数`)
  }
})

test('注册生成路由：重复调用不会互相污染（每次都重新注册一份）', () => {
  // apply 可能在宿主重载插件时被调用多次 —— 每次都要拿到完整的 15 条，不能越调越少
  const 一 = 收集路由()
  const 二 = 收集路由()
  assert.equal(一.length, 15)
  assert.equal(二.length, 15, '第二次调用注册的路由数变了（注册函数里有跨调用状态？）')
  assert.deepEqual(
    一.map((r) => r.path).sort(),
    二.map((r) => r.path).sort(),
    '两次调用注册的路由集合不一致'
  )
})

test('注册生成路由：批量/LLM 那几个「会调模型」的路由都在（前端按钮靠它们）', () => {
  // 这几条是设置页上标着「会调模型」的按钮背后的路由 —— README 明确列了它们，
  // 少任何一条，对应功能就在界面上点不动（按钮还在，但请求 404）。
  const 表 = 收集路由()
  const 有 = new Set(表.map((r) => r.path))
  for (const p of [
    '/dsh-clay-memory/refine',        // 提炼（把旧档案改写成记忆）
    '/dsh-clay-memory/wash-keys',     // 洗键（给大量记忆补「这件事叫什么」）
    '/dsh-clay-memory/expand',        // 扩词
    '/dsh-clay-memory/gen-run',       // 生成档案
    '/dsh-clay-memory/copy-to',       // 复制记忆到别的会话
  ]) {
    assert.ok(有.has(p), `「会调模型」的路由 ${p} 没注册 —— 对应按钮会变成 404`)
  }
  // 撤销类路由也要在（批量操作错了要能退回来 —— backup.mjs 的批次戳就是给它们用的）
  assert.ok(有.has('/dsh-clay-memory/refine/undo'), '提炼撤销路由没注册')
  assert.ok(有.has('/dsh-clay-memory/wash-keys/undo'), '洗键撤销路由没注册')
})

test('注册生成路由：调用 /gen-sessions 不会因漏 import 生成档案/CFG_DIR 而报错', async () => {
  const 表 = 收集路由()
  const 项 = 表.find((r) => r.path === '/dsh-clay-memory/gen-sessions')
  assert.ok(项, '应当存在 /gen-sessions')
  let 状态码 = 0
  let 响应体 = ''
  const res = {
    writeHead(code) { 状态码 = code },
    end(body) { 响应体 = String(body || '') },
  }
  await 项.handler({ url: '/dsh-clay-memory/gen-sessions' }, res)
  assert.equal(状态码, 200)
  const j = JSON.parse(响应体)
  assert.equal(j.ok, true, '/gen-sessions 应当返回 ok:true，实际：' + 响应体)
})

