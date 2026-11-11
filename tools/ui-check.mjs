#!/usr/bin/env node
// 手动 UI 冒烟：连一个正在运行的 DSH 实例，把黏土记忆的页面逐个点一遍。
//
// 用法：
//   node tools/ui-check.mjs <端口> <DSH_HOME>
//   node tools/ui-check.mjs <端口> <DSH_HOME> --empty   # 额外真跑一遍「空库」
//   例：node tools/ui-check.mjs 61021 G:/tmp/home/.dsh
//
// 为什么手动跑、不进单元测试：它要一个活着的实例、要 Chrome、要本地登录凭证；
// 放进 `npm test` 会让 CI 和没装浏览器的机器全挂。改动页面之后手动跑一次就够。
//
// 覆盖：
//   ① 六个页签 → ② 高级页展开「参数」→ ③ 会话详情展开「记忆列表」→ ④ 记忆页点「改」（层级选择器）
//   ⑤ F22 空库引导卡：拦 `/list` 返回「一个会话都没有」，看卡片与三条路出不出来（不动任何数据）
//   ⑥ 控制台 / 页面报错
//
// `--empty`（可选）：把 <DSH_HOME>/clay-memory 临时改名成 clay-memory-bak-emptycheck-<时间戳>、
// 原地建一个空目录，再走一遍真链路（后端也真的是空库），跑完在 finally 里原样挪回。
// 它比 ⑤ 更真（后端空库行为也一起验），但要动实例的数据目录，所以**不默认开**。
// 实测 61021 这种实例（SQLite 连接是短开的）在跑着也能改名；万一名不了，
// 说明这个实例长期占着目录，`--empty` 这条路对它不通，退回默认模式（拦路由版）验就行。
//
// 任何一处出现 `is not defined`、`出了点问题`、控制台报错，都算失败（退出码 1）。
import { createRequire } from 'node:module'
import { createHash, createHmac } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'

const 端口 = process.argv[2]
const 家目录 = process.argv[3]
const 空库模式 = process.argv.includes('--empty')
if (!端口 || !家目录) {
  console.error('用法：node tools/ui-check.mjs <端口> <DSH_HOME> [--empty]')
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
let 失败 = 0
const 判 = (好, 说明) => {
  console.log(`${好 ? '✓' : '✗'} ${说明}`)
  if (!好) 失败 += 1
}

// ── ⑤ 的空库假数据（纯前端验证；真链路见 --empty）────────────────────────
const 空库响应 = { ok: true, sessions: [], 全局开关: true }
const 拦空库 = (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(空库响应) })
const 列表路由 = /\/dsh-clay-memory\/list(?:\?|$)/u

// ── 库目录挪走 / 挪回（--empty 用）──────────────────────────────────────
const 库目录 = path.join(家目录, 'clay-memory')
const 备份目录 = `${库目录}-bak-emptycheck-${现在}`
let 挪过 = false
function 挪库走() {
  if (空库模式 && existsSync(库目录)) {
    try {
      renameSync(库目录, 备份目录)
    } catch (e) {
      console.error(`✗ 挪不动 ${库目录} —— 这个实例长期占着目录，--empty 对它走不通。用默认模式（拦路由版）验空库。`)
      console.error('  ' + String((e && e.message) || e))
      process.exit(2)
    }
    挪过 = true
  }
  mkdirSync(库目录, { recursive: true })
}
function 挪库回() {
  if (!挪过) return
  try {
    rmSync(库目录, { recursive: true, force: true })
    renameSync(备份目录, 库目录)
    console.log(`- 库已挪回（${path.basename(备份目录)} → clay-memory）`)
  } catch (e) {
    console.error(`✗ 挪回失败！备份还在 ${备份目录}，手动改回来。`)
    console.error('  ' + String((e && e.message) || e))
    process.exitCode = 1
  }
}

const 浏览器 = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const 上下文 = await 浏览器.newContext({ viewport: { width: 1440, height: 1200 } })
  await 上下文.addCookies([{ name: 名, value: cookie, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }])
  const 页 = await 上下文.newPage()
  页.on('pageerror', (e) => 报错.push('PAGEERROR ' + String(e.message).slice(0, 200)))
  页.on('console', (m) => { if (m.type() === 'error') 报错.push('CONSOLE ' + m.text().slice(0, 200)) })

  const 面板 = 页.locator('[role="dialog"]')

  // 打开设置 → 黏土记忆（首次进入和 reload 之后都要走一遍）
  async function 进面板() {
    await 页.waitForFunction(() => !document.body.innerText.includes('Loading plugins'), { timeout: 200000 })
    await 页.waitForTimeout(1000)
    await 页.locator('button[aria-label="账号菜单"]').click()
    await 页.waitForTimeout(400)
    await 页.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((e) => /设置/.test(e.innerText || ''))?.click())
    await 页.waitForTimeout(1500)
    await 页.getByText('黏土记忆', { exact: true }).first().click()
    await 页.waitForTimeout(1500)
  }

  await 页.goto(`http://127.0.0.1:${端口}/`, { waitUntil: 'domcontentloaded', timeout: 120000 })

  if (空库模式) {
    // 只验空库这一条路：库是真的空的，所以别的页签（会话/回收站有内容才有意义）不再点
    挪库走()
    await 进面板()
    await 页.getByRole('tab', { name: '记忆', exact: true }).click()
    await 页.waitForTimeout(2500)
    const 空文 = await 面板.innerText()
    判(/这里还空着/u.test(空文), '空库（真链路）· 「这里还空着」卡出现')
    判(
      /第一次用，先挑一条路/u.test(空文) && /记住：/u.test(空文) && /从档案导入/u.test(空文),
      '空库（真链路）· 三条路文案齐',
    )
    const 点了加 = await 页.evaluate(() => {
      const 框 = document.querySelector('[role="dialog"]')
      const 钮 = [...框.querySelectorAll('button')].find((e) => (e.innerText || '').replace(/\s/gu, '').includes('记一条'))
      if (!钮) return false
      钮.click()
      return true
    })
    await 页.waitForTimeout(1000)
    const 加占位 = await 页.evaluate(() => {
      const t = document.querySelector('[role="dialog"] textarea')
      return t ? t.getAttribute('placeholder') || '' : ''
    })
    判(点了加 && /她说过什么/u.test(加占位), '空库（真链路）· 点「＋ 记一条」展开输入框')
  } else {
    await 进面板()

    // ① 六个页签
    for (const 页签名 of ['记忆', '时间线', '会话', '回收站', '体检', '高级']) {
      await 页.getByRole('tab', { name: 页签名, exact: true }).click()
      await 页.waitForTimeout(页签名 === '会话' ? 6000 : 1800)
      const 文本 = await 面板.innerText()
      const 好 = 文本.length > 100 && !/出了点问题|is not defined/u.test(文本)
      判(好, `页签「${页签名}」：${文本.length} 字`)
    }

    // ② 高级 → 展开参数（分组名「权重 / 遗忘速度」必须出现）
    await 页.getByRole('tab', { name: '高级', exact: true }).click()
    await 页.waitForTimeout(1200)
    await 面板.getByText('参数', { exact: false }).first().click().catch(() => {})
    await 页.waitForTimeout(1200)
    const 参数文本 = await 面板.innerText()
    判(/权重/u.test(参数文本) && /遗忘速度/u.test(参数文本), '高级 · 参数区（权重 / 遗忘速度）')

    // ③ 会话详情 → 记忆列表
    await 页.getByRole('tab', { name: '会话', exact: true }).click()
    await 页.waitForTimeout(6000)
    const 会话名 = await 页.evaluate(() => {
      const 框 = document.querySelector('[role="dialog"]')
      const 行们 = [...框.querySelectorAll('div,li')].filter((e) => /记忆\s*\d+\s*条/u.test(e.innerText || '') && (e.innerText || '').trim().length < 80)
      if (!行们.length) return ''
      return (行们[0].innerText || '').trim().split('\n')[0].trim()
    })
    if (会话名) {
      await 面板.getByText(会话名, { exact: true }).first().click({ timeout: 8000 }).catch(() => {})
      await 页.waitForTimeout(2500)
      await 面板.getByText('记忆列表', { exact: false }).first().click({ timeout: 8000 }).catch(() => {})
      await 页.waitForTimeout(2000)
      const 详情文本 = await 面板.innerText()
      判(!/出了点问题|is not defined/u.test(详情文本) && /全局事实|本会话|记忆/u.test(详情文本), `会话详情 · 记忆列表（${会话名}）`)
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
    判(点了改 && /层级/u.test(改后文本) && !/出了点问题|is not defined/u.test(改后文本), '记忆 · 点「改」（层级选择器）')

    // ⑤ F22 空库引导卡 —— 拦 /list 返回「一个会话都没有」，不动真实数据。
    //   真链路版在 --empty 里（库真为空、后端也一起验）；这里保证「改完页面，卡片没被改坏」有得回归。
    await 页.route(列表路由, 拦空库)
    try {
      await 页.reload({ waitUntil: 'domcontentloaded', timeout: 120000 })
      await 进面板()
      await 页.getByRole('tab', { name: '记忆', exact: true }).click()
      await 页.waitForTimeout(2500)
      const 空文 = await 面板.innerText()
      判(/这里还空着/u.test(空文), '空库（拦路由）· 「这里还空着」卡出现')
      判(
        /第一次用，先挑一条路/u.test(空文) && /记住：/u.test(空文) && /记一条/u.test(空文) && /从档案导入/u.test(空文),
        '空库（拦路由）· 三条路文案齐',
      )
      const 点了加 = await 页.evaluate(() => {
        const 框 = document.querySelector('[role="dialog"]')
        const 钮 = [...框.querySelectorAll('button')].find((e) => (e.innerText || '').replace(/\s/gu, '').includes('记一条'))
        if (!钮) return ''
        钮.click()
        return (钮.innerText || '').trim()
      })
      await 页.waitForTimeout(1000)
      // ⚠ placeholder 不进 innerText，得直接问 textarea
      const 占位 = await 页.evaluate(() => {
        const t = document.querySelector('[role="dialog"] textarea')
        return t ? t.getAttribute('placeholder') || '' : ''
      })
      判(!!占位 && /她说过什么/u.test(占位), `空库（拦路由）· 点「＋ 记一条」展开输入框${点了加 ? '' : '（没找到按钮）'}`)
    } finally {
      await 页.unroute(列表路由, 拦空库).catch(() => {})
    }
  }

  // ⑥ 控制台 / 页面报错
  const 渲染报错 = 报错.filter((e) => /黏土|渲染|is not defined|出了点问题/u.test(e))
  判(渲染报错.length === 0, `控制台渲染报错 ${渲染报错.length} 条`)
  for (const e of 渲染报错.slice(0, 5)) console.log('   ', e)
} finally {
  await 浏览器.close().catch(() => {})
  挪库回()
}

if (失败) {
  console.log(`\n✗ ${失败} 项没过`)
  process.exitCode = 1
} else {
  console.log('\n✓ 全过')
}
