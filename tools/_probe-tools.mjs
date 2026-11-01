// tools/_probe-tools.mjs —— 真跑一遍 remember 工具，捞出被 try/catch 吞掉的运行时缺引用
// 用法：node tools/_probe-tools.mjs
// 背景：2026-10-31 主实例 remember 报「归一键 is not defined」——拆层遗留的漏 import
//   被函数内 try/catch 吞成静默失败（作废/收敛不生效），只靠测试绿是看不出来的。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'probe-tools-'))
process.env.DSH_HOME = home

const 线索 = []
const { loadCfg } = await import('../lib/cfg.mjs')
const names = await import('../lib/names.mjs')
names.接读配置(loadCfg)
const { makeRememberTool, makeForgetTool, makeRecallTool, 接定义工具, 接报信 } = await import('../lib/tools.mjs')
接定义工具((def) => def)
接报信((m) => 线索.push(String(m)))

const ctx = {
  agents: { list: () => [] },
  interval: () => () => {},
  on: () => {},
}
const sid = 'session-probe-0001'

const 记 = makeRememberTool(ctx)
const 结果 = await 记.execute({ text: '鲸鱼娘今天在验证拆层之后的工具链', importance: 0.5 }, { agent: { session: { id: sid } } })

const 报错 = 线索.filter((m) => /is not defined|is not a function|Cannot read/.test(m))
console.log('remember 结果:', JSON.stringify(结果).slice(0, 160))
console.log('diag:', 线索.length, '条')
for (const m of 线索) console.log('  ·', m.slice(0, 160))
if (报错.length) {
  console.log('\n✗ 发现运行时缺引用：')
  for (const m of 报错) console.log('  ', m)
  process.exitCode = 1
} else {
  console.log('\n✓ 没扫到 ReferenceError 类错误')
}

// forget / recall 也各跑一下（它们同样有 try/catch 包裹的分支）
const 忘 = makeForgetTool(ctx)
const 找 = makeRecallTool(ctx)
const r2 = await 忘.execute({}, { agent: { session: { id: sid } } }).catch((e) => ({ 抛错: String(e) }))
const r3 = await 找.execute({ query: '鲸鱼娘' }, { agent: { session: { id: sid } } }).catch((e) => ({ 抛错: String(e) }))
console.log('forget:', JSON.stringify(r2).slice(0, 120))
console.log('recall:', JSON.stringify(r3).slice(0, 120))
const 后报错 = 线索.filter((m) => /is not defined|is not a function/.test(m))
if (后报错.length) {
  console.log('✗ forget/recall 阶段缺引用:', 后报错)
  process.exitCode = 1
}

rmSync(home, { recursive: true, force: true })
