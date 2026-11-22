import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 自查更新（lib/selfupdate.mjs）回归 —— 这个模块**零测试覆盖**，但它守着一句硬承诺：
//   **「查不到要如实说『查不到』，绝不能显示成『已是最新』」**
// 要守住的不变量：
//   ① `cmpVer` 认 `v` 前缀与 `-pre` 后缀，且**按数字比**（1.10.0 > 1.9.0，不是字符串比）；
//   ② 正式版 > 预发布（`1.2.3` 比 `1.2.3-beta.1` 新）；
//   ③ 仓库地址从包里自己的 package.json 读，**不在代码里写死**；`repoUrl` 要做归一化
//      （去掉 `git+` / `.git` / `#readme`），否则用户复制到浏览器是坏链接；
//   ④ package.json 读不到 → `current` 退化成空串，**不抛**（插件不能因为查更新而起不来）；
//   ⑤ 拿不到 GitHub 地址 → `check()` 如实报 error、`ok=false`、`hasUpdate=false`
//      —— 这条是 ⑤ 的核心：**不能把「查不到」伪装成「已是最新」**；
//   ⑥ 结果缓存 6 小时，`force` 绕过缓存。
//
// ⚠ 本文件**全程不联网**：只调「repo 非 GitHub」那条分支（`rawUrls` 返回空数组，
//   在 fetch 之前就短路了），以及纯函数 `cmpVer` / 属性读取。
// 这个文件不 import 任何宿主接口 → 不启动 DSH 也能跑。
const home = mkdtempSync(join(tmpdir(), 'fish-cov-selfupdate-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')

const { cmpVer, createSelfUpdate } = await import('../../lib/selfupdate.mjs')

const 仓库根 = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// 造一个临时包目录（放假 package.json），用来驱动各种降级分支
function 假包(meta) {
  const dir = mkdtempSync(join(home, 'pkg-'))
  if (meta !== null) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), typeof meta === 'string' ? meta : JSON.stringify(meta), 'utf8')
  }
  const 日志 = []
  const 实例 = createSelfUpdate({ packageRoot: dir, diag: (m) => 日志.push(m) })
  return { dir, 日志, ...实例 }
}

test('cmpVer：按数字比，不是按字符串比（1.10.0 > 1.9.0）', () => {
  // ⚠ 字符串比会得出 '1.10.0' < '1.9.0'（'1' < '9'）—— 版本号的经典坑
  assert.equal(cmpVer('1.10.0', '1.9.0'), 1)
  assert.equal(cmpVer('1.9.0', '1.10.0'), -1)
  assert.equal(cmpVer('1.12.39', '1.12.9'), 1, '本仓库当前版本就该比 1.12.9 新')
  assert.equal(cmpVer('2.0.0', '1.99.99'), 1, '主版本号优先')
  assert.equal(cmpVer('1.2.3', '1.2.3'), 0)
  assert.equal(cmpVer('1.2.4', '1.2.3'), 1)
  assert.equal(cmpVer('1.2.3', '1.2.4'), -1)
  assert.equal(cmpVer('1.3.0', '1.2.9'), 1, '次版本号优先于修订号')
})

test('cmpVer：认 v 前缀、认残缺位数（1.2 == 1.2.0）', () => {
  assert.equal(cmpVer('v1.2.3', '1.2.3'), 0, 'v 前缀该被吃掉')
  assert.equal(cmpVer('V1.2.3', '1.2.3'), 0, '大写 V 也该认')
  assert.equal(cmpVer('1.2', '1.2.0'), 0, '少一位当 0 补')
  assert.equal(cmpVer('1', '1.0.0'), 0)
  assert.equal(cmpVer('1.2', '1.2.1'), -1)
  assert.equal(cmpVer(' v1.2.3 ', '1.2.3'), 0, '首尾空白该被 trim')
})

test('cmpVer：正式版 > 预发布（1.2.3 比 1.2.3-beta.1 新）', () => {
  assert.equal(cmpVer('1.2.3', '1.2.3-beta.1'), 1, '正式版必须比预发布新，否则会提示「降级更新」')
  assert.equal(cmpVer('1.2.3-beta.1', '1.2.3'), -1)
  assert.equal(cmpVer('1.2.3-beta.1', '1.2.3-beta.1'), 0)
  assert.equal(cmpVer('1.2.3-beta.2', '1.2.3-beta.1'), 1, '预发布之间按字符串比')
  assert.equal(cmpVer('1.2.3-rc.1', '1.2.3-alpha.1'), 1, 'rc 排在 alpha 后面')
  // 预发布不该压过更高的正式版本
  assert.equal(cmpVer('1.2.4-beta.1', '1.2.3'), 1, '更高版本的预发布仍然更新')
})

test('cmpVer：垃圾输入不炸（空、null、非数字段一律当 0）', () => {
  assert.equal(cmpVer('', ''), 0)
  assert.equal(cmpVer(null, null), 0)
  assert.equal(cmpVer(undefined, '1.0.0'), -1, 'undefined 当 0.0.0，自然小于 1.0.0')
  assert.equal(cmpVer(undefined, '0.0.0'), 0, 'undefined 当 0.0.0')
  assert.equal(cmpVer('abc', '0.0.0'), 0, '非数字段按 0 处理，不抛')
  assert.equal(cmpVer('1.x.3', '1.0.3'), 0)
  // 不能抛异常 —— 查更新失败不该把插件带崩
  assert.doesNotThrow(() => cmpVer({}, []))
})

test('createSelfUpdate：从真实仓库根读到 current 与归一化后的 repoUrl', () => {
  // ⚠ 只读属性、**不调 check()** —— 这个仓库是 GitHub 地址，调了就会真联网
  const 日志 = []
  const u = createSelfUpdate({ packageRoot: 仓库根, diag: (m) => 日志.push(m) })
  const pkg = JSON.parse(readFileSync(join(仓库根, 'package.json'), 'utf8'))

  assert.equal(u.current, String(pkg.version), 'current 必须来自 package.json 的 version，不能写死')
  // 归一化：去掉 git+ / .git / #readme
  assert.ok(!/^git\+/.test(u.repoUrl), 'repoUrl 还带着 git+ 前缀，复制到浏览器是坏链接：' + u.repoUrl)
  assert.ok(!/\.git$/.test(u.repoUrl), 'repoUrl 还带着 .git 后缀：' + u.repoUrl)
  assert.ok(!/#readme$/i.test(u.repoUrl), 'repoUrl 还带着 #readme：' + u.repoUrl)
  assert.match(u.repoUrl, /^https:\/\/github\.com\/[^/]+\/[^/]+$/, 'repoUrl 归一化结果不像一个能打开的 GitHub 地址：' + u.repoUrl)
  assert.equal(u.repoUrl, 'https://github.com/TunerRed/dsh-clay-memory')
  assert.equal(typeof u.check, 'function')
  assert.equal(typeof u.register, 'function')
  assert.equal(日志.length, 0, '正常读到 package.json 时不该打任何诊断')
})

test('createSelfUpdate：package.json 读不到 → current 为空、不抛、留诊断', () => {
  const dir = join(home, 'no-such-package-dir')
  const 日志 = []
  let u
  assert.doesNotThrow(() => { u = createSelfUpdate({ packageRoot: dir, diag: (m) => 日志.push(m) }) },
    '读不到 package.json 不能抛 —— 那会让整条插件不激活')
  assert.equal(u.current, '', 'current 该退化成空串')
  assert.equal(u.repo, '', 'repo 该退化成空串')
  assert.equal(u.repoUrl, '')
  assert.equal(日志.length, 1, '读失败要留一条诊断，不能静默')
  assert.match(日志[0], /读自己的 package\.json 失败/, '诊断文案要能一眼看出是哪一步失败')
})

test('createSelfUpdate：package.json 是坏 JSON → 同样降级不抛', () => {
  const { current, 日志 } = 假包('{ 这不是 JSON ')
  assert.equal(current, '')
  assert.equal(日志.length, 1)
  assert.match(日志[0], /读自己的 package\.json 失败/)
})

test('check()：没写 GitHub 仓库地址 → 如实说「没法查」，绝不显示成已是最新', async () => {
  const r = 假包({ name: 'x', version: '1.0.0', repository: { url: 'https://example.com/foo/bar' } })
  const 结果 = await r.check()

  // ⚠⚠ 本条是整个模块最关键的一句：查不到 ≠ 已是最新
  assert.equal(结果.ok, false, '查不到版本时 ok 必须是 false')
  assert.equal(结果.latest, null, '查不到时 latest 必须是 null，不能编一个')
  assert.equal(结果.hasUpdate, false, '查不到时不能声称有更新')
  assert.equal(结果.ahead, false, '查不到时不能声称本机更新')
  assert.equal(结果.error, '包里没写 GitHub 仓库地址，没法查')
  assert.equal(结果.current, '1.0.0', '即使查不到远端，本机版本还是要如实报出来')
  assert.equal(typeof 结果.checkedAt, 'number')
  assert.ok(!('cached' in 结果), '第一次查不该带 cached 标记')
  // 前端就是靠 error 这一格显示「查不到」的，没有它会被渲染成「已是最新」
  assert.ok(结果.error, 'error 必须非空，否则界面会显示成「已是最新」')
})

test('check()：连 homepage 都没有 → 一样如实报错，不联网', async () => {
  const r = 假包({ name: 'x', version: '2.0.0' })
  assert.equal(r.repo, '')
  const 结果 = await r.check()
  assert.equal(结果.ok, false)
  assert.equal(结果.error, '包里没写 GitHub 仓库地址，没法查')
  assert.equal(结果.repoUrl, null, '没有仓库地址时 repoUrl 该是 null 而不是空串')
})

test('check()：repository 写成字符串（不是对象）也认；homepage 兜底', async () => {
  // 有人手写 `"repository": "https://example.com/x/y"` 而不是对象
  const a = 假包({ name: 'x', version: '1.0.0', repository: 'https://example.com/x/y' })
  assert.equal(a.repo, 'https://example.com/x/y')
  const 结果 = await a.check()
  assert.equal(结果.ok, false, '非 GitHub 地址照样查不到')

  // 没写 repository、只写 homepage → 拿 homepage 当仓库地址
  const b = 假包({ name: 'x', version: '1.0.0', homepage: 'https://example.com/x/y#readme' })
  assert.equal(b.repo, 'https://example.com/x/y#readme')
  assert.equal(b.repoUrl, 'https://example.com/x/y', '#readme 该被去掉')
})

test('check()：结果缓存 6 小时，force 绕过缓存', async () => {
  const r = 假包({ name: 'x', version: '1.0.0', repository: 'https://example.com/foo/bar' })
  const 第一次 = await r.check()
  const 第二次 = await r.check()

  assert.equal(第二次.cached, true, '6 小时内重复查该走缓存')
  assert.equal(第二次.error, 第一次.error, '缓存回来的内容要和第一次一致')
  assert.equal(第二次.checkedAt, 第一次.checkedAt, '走缓存时 checkedAt 不该刷新')

  // refresh（点按钮）绕过缓存 → 重新查一次，不带 cached 标记
  const 第三次 = await r.check(true)
  assert.ok(!第三次.cached, 'force=true 必须绕过缓存')
  assert.equal(第三次.error, 第一次.error)
})

test('register()：宿主接口缺失也不抛（降级不能让插件崩）', () => {
  const r = 假包({ name: 'x', version: '1.0.0' })
  // 空 ctx：没有 effect / webServer
  assert.doesNotThrow(() => r.register({}, '/dsh-clay-memory'), 'register 碰到残缺 ctx 不能抛')
  // effect 里抛错也要被吞掉并留日志
  const 日志 = []
  const r2 = createSelfUpdate({ packageRoot: r.dir, diag: (m) => 日志.push(m) })
  assert.doesNotThrow(() => r2.register({ effect: () => { throw new Error('宿主没有 webServer') } }, '/x'))
  assert.ok(日志.some((m) => /查更新路由注册失败/.test(m)), '注册失败要留诊断')
})
