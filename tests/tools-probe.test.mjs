// tests/tools-probe.test.mjs —— 真跑一遍工具链，抓「拆层后漏 import 被 try/catch 吞掉」的静默失败
// 2026-10-31：主实例 remember 报「归一键 is not defined」——tools.mjs 用了 scoring/llm 的符号却没 import，
//   函数内的 try/catch 把 ReferenceError 吞成静默失败（过期作废、事实键收敛都不工作），
//   而单元测试因为不走这些路径全绿。这个测试把它们真跑一遍，任何 "X is not defined" 都算失败。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('remember/forget/recall 工具真跑一遍，不出现运行时缺引用', async () => {
  const home = mkdtempSync(join(tmpdir(), 'probe-tools-'))
  const 旧 = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const 线索 = []
    const { loadCfg } = await import('../lib/cfg.mjs')
    const names = await import('../lib/names.mjs')
    names.接读配置(loadCfg)
    const { makeRememberTool, makeForgetTool, makeRecallTool, 接定义工具, 接报信 } = await import('../lib/tools.mjs')
    接定义工具((def) => def)
    接报信((m) => 线索.push(String(m)))

    const ctx = { agents: { list: () => [] }, interval: () => () => {}, on: () => {} }
    const exec = { agent: { session: { id: 'session-probe-0001' } } }

    const 记 = makeRememberTool(ctx)
    const 结果 = await 记.execute({ text: '小助手今天在验证拆层之后的工具链', importance: 0.5 }, exec)
    assert.equal(结果.ok, true, 'remember 应该成功：' + JSON.stringify(结果))

    const 忘 = makeForgetTool(ctx)
    const 找 = makeRecallTool(ctx)
    await 忘.execute({}, exec).catch(() => {})
    const 找结果 = await 找.execute({ query: '小助手' }, exec)
    assert.equal(找结果.ok, true, 'recall 应该成功：' + JSON.stringify(找结果))

    const 报错 = 线索.filter((m) => /is not defined|is not a function|Cannot read prop/.test(m))
    assert.deepEqual(报错, [], '工具链里出现了运行时缺引用（拆层漏 import）：' + 报错.join(' | '))
  } finally {
    if (typeof 旧 === 'string') process.env.DSH_HOME = 旧
    else delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})
