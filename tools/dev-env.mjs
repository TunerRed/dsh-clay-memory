// tools/dev-env.mjs —— 本地开发环境的常用操作，一条命令一件
//
// 为什么有它：启动测试实例的命令（dsh --profile test --no-open --port 61022）以前
// 只在会话里「临时摸出来」过，换个会话就忘干净了。与其靠脑子记，不如固化成脚本。
//
// 用法：
//   node tools/dev-env.mjs status          # 测试实例在不在跑、版本多少
//   node tools/dev-env.mjs start           # 起测试实例（61022）
//   node tools/dev-env.mjs stop            # 停测试实例
//   node tools/dev-env.mjs test            # 在开发仓库跑全量测试
//   node tools/dev-env.mjs test --installed # 在装机副本跑全量测试
//   node tools/dev-env.mjs sync [git-ref]  # 把 dev 改动同步到装机副本（默认跟 de9c80f 比）
//   node tools/dev-env.mjs diag "还记得我喜欢吃什么吗"   # 看一条问句的召回明细
//
// 只动本机目录：开发仓库（本文件所在仓库）、装机副本（$DSH_HOME/plugins/<包名>）、
// 测试实例（CLAY_TEST_HOME 指定）。不碰主实例。
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const 本目录 = path.dirname(fileURLToPath(import.meta.url))
const 仓库根 = path.resolve(本目录, '..')
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

// 三个目录都能用环境变量覆盖；默认从「本仓库位置」和「$DSH_HOME」推出来
const DEV = process.env.CLAY_DEV_REPO || 仓库根
const INSTALLED = process.env.CLAY_INSTALLED || path.join(DSH_HOME, 'plugins', path.basename(仓库根))
// 测试实例的家目录推不出来，用 CLAY_TEST_HOME 指定（start 时没设会明确报错）
const TEST_HOME = process.env.CLAY_TEST_HOME || ''
const PORT = 61022
// 装机同步的默认基线：这个提交之后的改动才需要同步
const SYNC_BASE = process.env.DEV_ENV_SYNC_BASE || 'de9c80f'

function 跑(命令, 选项 = {}) {
  return execSync(命令, { encoding: 'utf8', stdio: 'pipe', ...选项 })
}

function 端口有进程(port) {
  try {
    const out = 跑(`netstat -ano | findstr ":${port}"`, { shell: true })
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes(`:${port}`) && /LISTENING/i.test(l))
      .map((l) => Number(l.split(/\s+/).pop()))
      .filter((n) => Number.isInteger(n) && n > 0)
  } catch (e) {
    return [] // findstr 没命中会非零退出
  }
}

function 状态() {
  const pids = 端口有进程(PORT)
  if (!pids.length) {
    console.log(`测试实例：没在跑（端口 ${PORT} 空闲）`)
    return false
  }
  console.log(`测试实例：在跑，端口 ${PORT}，PID ${pids.join(', ')}`)
  console.log(`  → http://127.0.0.1:${PORT}  （浏览器打开；curl 返回 401 是正常认证）`)
  return true
}

async function 启动() {
  if (!TEST_HOME) {
    console.log('✗ 没设 CLAY_TEST_HOME（测试实例的家目录，也就是那个实例的 DSH_HOME）。')
    console.log('  例：CLAY_TEST_HOME=<那个目录> node tools/dev-env.mjs start')
    return 1
  }
  if (端口有进程(PORT).length) {
    console.log(`端口 ${PORT} 已经有进程了，先 stop 再 start`)
    return 1
  }
  // ⚠⚠ 2026-11-15 实测踩到的坑：**只靠 spawn(detached)+unref 是留不住的**。
  //   在工具的 job object 沙箱里起它，端口能就绪、脚本报「已就绪」，
  //   但**前台命令一结束整棵进程树就被回收** —— 几秒后 status 又是「没在跑」。
  //   Start-Process 创建的是独立进程，能活过命令结束（本轮实测跨命令仍在监听）。
  //   所以这里先落一个 .bat，再让 PowerShell 用 Start-Process 拉起来。
  const bat = path.join(process.env.TEMP || 仓库根, `fish-dev-env-${PORT}.bat`)
  fs.writeFileSync(
    bat,
    [
      '@echo off',
      'set "ELECTRON_RUN_AS_NODE="',
      `set "DSH_HOME=${TEST_HOME}"`,
      `cd /d ${path.dirname(TEST_HOME)}`,
      `dsh --profile test --no-open --port ${PORT}`,
      '',
    ].join('\r\n'),
  )
  spawn('powershell', ['-NoProfile', '-Command', `Start-Process -FilePath "${bat}" -WindowStyle Hidden`], {
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  }).unref()
  console.log(`已拉起 dsh（启动脚本 ${bat}），等端口起来…`)
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (端口有进程(PORT).length) {
      console.log(`✓ 测试实例已就绪：http://127.0.0.1:${PORT}`)
      return 0
    }
  }
  console.log(`✗ 等了 20 秒端口还没起来，去看一眼启动日志`)
  // 最常见的原因：这个脚本是**在 AI 工具的 job object 沙箱里**跑的 ——
  // 命令一返回，整棵进程树就被回收，Start-Process 也拉不住。
  // 人类在自己的终端里跑，或者用工具的后台任务跑，就没这个问题。
  console.log(`  提示：如果你是在 AI 工具的沙箱里跑，请改成后台任务，或在自己的终端里跑 start`)
  return 1
}

function 停止() {
  const pids = 端口有进程(PORT)
  if (!pids.length) {
    console.log(`端口 ${PORT} 没有监听，不用停`)
    return 0
  }
  for (const pid of pids) {
    try {
      跑(`taskkill /PID ${pid} /F`, { shell: true })
      console.log(`✓ 已结束 PID ${pid}`)
    } catch (e) {
      console.log(`✗ 结束 PID ${pid} 失败：${String(e.message || e).slice(0, 120)}`)
    }
  }
  return 0
}

function 跑测试(装机) {
  const 目录 = 装机 ? INSTALLED : DEV
  console.log(`在 ${目录} 跑全量测试…`)
  try {
    const out = 跑('node --test "tests/*.test.mjs" "tests/coverage/*.test.mjs"', {
      cwd: 目录,
      shell: true,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    })
    console.log(out.split('\n').filter((l) => /^(ℹ|# )/.test(l)).join('\n') || out.slice(-800))
    return 0
  } catch (e) {
    const out = String((e.stdout || '') + (e.stderr || ''))
    console.log(out.split('\n').filter((l) => /^(ℹ|# )|✖/.test(l)).slice(0, 40).join('\n'))
    return 1
  }
}

function 同步(base) {
  const 文件们 = 跑(`git -c core.quotepath=false diff --name-only ${base} HEAD`, {
    cwd: DEV,
    shell: true,
  })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!文件们.length) {
    console.log(`跟 ${base} 比没有改动`)
    return 0
  }
  console.log(`要同步 ${文件们.length} 个文件：`)
  let 失败 = 0
  for (const f of 文件们) {
    const 源 = path.join(DEV, f)
    const 目标 = path.join(INSTALLED, f)
    if (!fs.existsSync(源)) {
      console.log(`  - 跳过（dev 里已删）${f}`)
      continue
    }
    try {
      fs.mkdirSync(path.dirname(目标), { recursive: true })
      fs.copyFileSync(源, 目标)
      console.log(`  ✓ ${f}`)
    } catch (e) {
      失败++
      console.log(`  ✗ ${f}：${String(e.message || e).slice(0, 100)}`)
    }
  }
  console.log(`同步完成，失败 ${失败} 个`)
  return 失败 ? 1 : 0
}

function 诊断(query) {
  return 跑(`node tools/bench/diag-recall.mjs ${JSON.stringify(query)}`, {
    cwd: DEV,
    shell: true,
    env: { ...process.env, DSH_HOME },
  })
}

const [命令, ...参数] = process.argv.slice(2)
let 码 = 0
switch (命令) {
  case 'status':
    状态()
    break
  case 'start':
    码 = await 启动()
    break
  case 'stop':
    码 = 停止()
    break
  case 'test':
    码 = 跑测试(参数.includes('--installed'))
    break
  case 'sync':
    码 = 同步(参数[0] || SYNC_BASE)
    break
  case 'diag':
    if (!参数.length) {
      console.log('用法：node tools/dev-env.mjs diag "问句"')
      码 = 1
    } else {
      console.log(诊断(参数[0]))
    }
    break
  default:
    console.log('用法：node tools/dev-env.mjs <status|start|stop|test [--installed]|sync [git-ref]|diag "问句">')
    码 = 命令 ? 1 : 0
}
process.exit(码)
