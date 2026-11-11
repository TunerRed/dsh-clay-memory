#!/usr/bin/env node
// 手动 UI 冒烟：连一个正在运行的 DSH 实例，把黏土记忆的页面逐个点一遍。
//
// 用法：
//   node tools/ui-check.mjs <端口> <DSH_HOME>
//   例：node tools/ui-check.mjs 61021 G:/tmp/home/.dsh
//
// 为什么手动跑、不进单元测试：它要一个活着的实例、要 Chrome、要本地登录凭证；
// 放进 `npm test` 会让 CI 和没装浏览器的机器全挂。改动页面之后手动跑一次就够。
//
// 覆盖：六个页签 → 高级页展开「参数」→ 会话详情展开「记忆列表」→ 记忆页点「改」（层级选择器）。
// 任何一处出现 `is not defined`、`出了点问题`、控制台报错，都算失败（退出码 1）。
import { createRequire } from 'node:module'
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const 端口 = process.argv[2]
const 家目录 = process.argv[3]
if (!端口 || !家目录) {
  console.error('用法：node tools/ui-check.mjs <端口> <DSH_HOME>')
  process.exit(2)
}

// playwright 跟着 DSH 桌面端走，不额外装（这里按本机实际位置找）
const require = createRequire('D:/deepseek/apps/web/package.json')
const { chromium } = require('playwright')
const b64url = (b) => Buffer.from(b).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
const authority = `127.0.0.1:${端口}`
const secretStr = /secret:\s*([A-Za-z0-9_-]+)/u.exec(readFileSync(`${家目录}/.credentials.yaml`, 'utf8'))[1]
const secret = Buffer.from(secretStr.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (secretStr.length % 4)) % 4), 'base64')
const 名 = 'dsh-auth-' + b64url(createHash('sha256').update(authority).digest())
const 现在 = Date.now()
const 载荷 = b64url(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: 现在, expiresAt: 现在 + 86400000 }), 'utf8'))
const cookie = `v1.${载荷}.${b64url(createHmac('sha256', secret).update(载荷).digest())}`

const 报错 = []
const 浏览器 = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const 上下文 = await 浏览器.newContext({ viewport: { width: 1440, height: 1200 } })
await 上下文.addCookies([{ name: 名, value: cookie, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }])
const 页 = await 上下文.newPage()
页.on('pageerror', (e) => 报错.push('PAGEERROR ' + String(e.message).slice(0, 200)))
页.on('console', (m) => { if (m.type() === 'error') 报错.push('CONSOLE ' + m.text().slice(0, 200)) })

await 页.goto(`http://127.0.0.1:${端口}/`, { waitUntil: 'domcontentloaded', timeout: 120000 })
await 页.waitForFunction(() => !document.body.innerText.includes('Loading plugins'), { timeout: 200000 })
await 页.waitForTimeout(1000)
await 页.locator('button[aria-label="账号菜单"]').click()
await 页.waitForTimeout(400)
await 页.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((e) => /设置/.test(e.innerText || ''))?.click())
await 页.waitForTimeout(1500)
await 页.getByText('黏土记忆', { exact: true }).first().click()
await 页.waitForTimeout(1500)
const 面板 = 页.locator('[role="dialog"]')

let 失败 = 0
const 判 = (好, 说明) => {
  console.log(`${好 ? '✓' : '✗'} ${说明}`)
  if (!好) 失败 += 1
}

// ① 五个页签
for (const 名 of ['记忆', '时间线', '会话', '回收站', '体检', '高级']) {
  await 页.getByRole('tab', { name: 名, exact: true }).click()
  await 页.waitForTimeout(名 === '会话' ? 6000 : 1800)
  const 文本 = await 面板.innerText()
  const 好 = 文本.length > 100 && !/出了点问题|is not defined/.test(文本)
  判(好, `页签「${名}」：${文本.length} 字`)
}

// ② 高级 → 展开参数（分组名「权重 / 遗忘速度」必须出现）
await 页.getByRole('tab', { name: '高级', exact: true }).click()
await 页.waitForTimeout(1200)
await 面板.getByText('参数', { exact: false }).first().click().catch(() => {})
await 页.waitForTimeout(1200)
const 参数文本 = await 面板.innerText()
判(/权重/.test(参数文本) && /遗忘速度/.test(参数文本), '高级 · 参数区（权重 / 遗忘速度）')

// ③ 会话详情 → 记忆列表
await 页.getByRole('tab', { name: '会话', exact: true }).click()
await 页.waitForTimeout(6000)
const 会话名 = await 页.evaluate(() => {
  const 框 = document.querySelector('[role="dialog"]')
  const 行们 = [...框.querySelectorAll('div,li')].filter((e) => /记忆\s*\d+\s*条/.test(e.innerText || '') && (e.innerText || '').trim().length < 80)
  if (!行们.length) return ''
  return (行们[0].innerText || '').trim().split('\n')[0].trim()
})
if (会话名) {
  await 面板.getByText(会话名, { exact: true }).first().click({ timeout: 8000 }).catch(() => {})
  await 页.waitForTimeout(2500)
  await 面板.getByText('记忆列表', { exact: false }).first().click({ timeout: 8000 }).catch(() => {})
  await 页.waitForTimeout(2000)
  const 详情文本 = await 面板.innerText()
  判(!/出了点问题|is not defined/.test(详情文本) && /全局事实|本会话|记忆/.test(详情文本), `会话详情 · 记忆列表（${会话名}）`)
} else {
  console.log('- 跳过会话详情（列表里没有带「记忆 N 条」的会话）')
}

// ④ 记忆页点「改」→ 层级选择器
await 页.getByRole('tab', { name: '记忆', exact: true }).click()
await 页.waitForTimeout(2000)
const 点了改 = await 页.evaluate(() => {
  const 框 = document.querySelector('[role="dialog"]')
  const 钮 = [...框.querySelectorAll('button')].find((e) => (e.innerText || '').trim() === '改')
  if (!钮) return false
  钮.click()
  return true
})
await 页.waitForTimeout(1200)
const 改后文本 = await 面板.innerText()
判(点了改 && /层级/.test(改后文本) && !/出了点问题|is not defined/.test(改后文本), '记忆 · 点「改」（层级选择器）')

// ⑤ 控制台 / 页面报错
const 渲染报错 = 报错.filter((e) => /黏土|渲染|is not defined|出了点问题/.test(e))
判(渲染报错.length === 0, `控制台渲染报错 ${渲染报错.length} 条`)
for (const e of 渲染报错.slice(0, 5)) console.log('   ', e)

await 浏览器.close()
if (失败) {
  console.log(`\n✗ ${失败} 项没过`)
  process.exitCode = 1
} else {
  console.log('\n✓ 全过')
}
