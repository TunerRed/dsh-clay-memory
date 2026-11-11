import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// trace / suppress（2026-11-04，需求 §5 可追溯 + §5 删除/禁止）：
//   trace 只读：给出处 / 状态 / 召回记录；suppress 只标「别记」不删。
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'fish-trace-'))
process.env.DSH_HOST_MODULES = join(process.env.DSH_HOME, 'no-host-modules')
process.env.APPDATA = join(process.env.DSH_HOME, 'empty-appdata')

const tools = await import('../lib/tools.mjs')
const { loadCfg } = await import('../lib/cfg.mjs')
const names = await import('../lib/names.mjs')
names.接读配置(loadCfg)
tools.接定义工具((def) => def)
tools.接报信(() => {})

mkdirSync(join(process.env.DSH_HOME, 'clay-memory'), { recursive: true })

const 造记 = () => tools.makeRememberTool({ agents: { list: () => [] }, interval: () => () => {}, on: () => {} })
const 造查 = () => tools.makeTraceTool({ agents: { list: () => [] }, interval: () => () => {}, on: () => {} })
const 造别记 = () => tools.makeSuppressTool({ agents: { list: () => [] }, interval: () => () => {}, on: () => {} })
const argv = (sid) => ({ agent: { session: { id: sid } } })

// 不依赖具体落哪个文件：把 clay-memory 下所有 json 翻一遍找条目
function 找条目(片段) {
  const dir = join(process.env.DSH_HOME, 'clay-memory')
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    let 文件
    try {
      文件 = JSON.parse(readFileSync(join(dir, f), 'utf8'))
    } catch {
      continue
    }
    const 条 = (文件.memories || []).find((m) => String(m.text || '').includes(片段))
    if (条) return 条
  }
  return null
}

test('trace 能翻出来源和状态', async () => {
  const r = await 造记().execute({ text: '主人喜欢玩泰拉瑞亚', importance: 0.5 }, argv('tr-1'))
  assert.equal(r.ok, true, JSON.stringify(r))
  const 条 = 找条目('喜欢玩泰拉瑞亚')
  assert.ok(条, '应写入')
  const t = await 造查().execute({ id: 条.id }, argv('tr-1'))
  assert.equal(t.ok, true, JSON.stringify(t))
  assert.match(t.message, /泰拉瑞亚/)
  assert.match(t.message, /记于/)
  assert.match(t.message, /来源/)
  assert.equal(t.detail.id, 条.id)
})

test('trace 支持片段匹配', async () => {
  await 造记().execute({ text: '主人喜欢吃大白饭', importance: 0.5 }, argv('tr-2'))
  const t = await 造查().execute({ text: '大白饭' }, argv('tr-2'))
  assert.equal(t.ok, true, JSON.stringify(t))
  assert.match(t.message, /大白饭/)
})

test('trace 找不到会明确失败', async () => {
  const t = await 造查().execute({ text: '这条根本不存在zzz' }, argv('tr-3'))
  assert.equal(t.ok, false)
})

test('suppress 标别记但不删', async () => {
  await 造记().execute({ text: '主人不喜欢吃香菜', importance: 0.5 }, argv('sp-1'))
  const 条 = 找条目('不喜欢吃香菜')
  assert.ok(条, '应写入')
  const s = await 造别记().execute({ id: 条.id, reason: '记错了' }, argv('sp-1'))
  assert.equal(s.ok, true, JSON.stringify(s))
  const 后 = 找条目('不喜欢吃香菜')
  assert.ok(后, '标别记不是删——东西必须还在')
  assert.equal(后.别记 && 后.别记.原因, '记错了')
})

test('suppress 重复标的会提示已标过', async () => {
  await 造记().execute({ text: '主人讨厌下雨天', importance: 0.5 }, argv('sp-2'))
  const 条 = 找条目('讨厌下雨天')
  await 造别记().execute({ id: 条.id }, argv('sp-2'))
  const 二 = await 造别记().execute({ id: 条.id }, argv('sp-2'))
  assert.equal(二.ok, true)
  assert.match(二.message, /之前就标过/)
})
