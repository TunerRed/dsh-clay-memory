import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// importance 与 category 解耦（2026-11-04，需求总纲原则）：
//   重要性回答「多重要」，类型回答「是什么、怎么参与生命周期」，两者独立。
//   回归重点：高 importance 的一次性事件不得被当成稳定事实；
//   低 importance 的长期偏好仍应成为稳定事实；显式「类型」优先于规则。
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'fish-cat-'))
process.env.DSH_HOST_MODULES = join(process.env.DSH_HOME, 'no-host-modules')
process.env.APPDATA = join(process.env.DSH_HOME, 'empty-appdata')

const tools = await import('../lib/tools.mjs')
const { loadCfg } = await import('../lib/cfg.mjs')
const names = await import('../lib/names.mjs')
names.接读配置(loadCfg)
tools.接定义工具((def) => def)
tools.接报信(() => {})

mkdirSync(join(process.env.DSH_HOME, 'clay-memory'), { recursive: true })

const 造工具 = () => tools.makeRememberTool({ agents: { list: () => [] }, interval: () => () => {}, on: () => {} })
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

test('高 importance 的一次性事件仍是事件', async () => {
  const r = await 造工具().execute({ text: '今天在高速上爆胎了，人没事', importance: 1 }, argv('cat-1'))
  assert.equal(r.ok, true, JSON.stringify(r))
  const 条 = 找条目('高速上爆胎')
  assert.ok(条, '应写入')
  assert.equal(条.category, 'event', '重要性高不代表稳定事实')
  assert.equal(条.importance, 1)
})

test('低 importance 的长期偏好仍是稳定事实', async () => {
  const r = await 造工具().execute({ text: '主人喜欢玩泰拉瑞亚', importance: 0.3 }, argv('cat-2'))
  assert.equal(r.ok, true, JSON.stringify(r))
  const 条 = 找条目('喜欢玩泰拉瑞亚')
  assert.ok(条, '应写入')
  assert.equal(条.category, 'stable_profile', '长期偏好不该因为重要性低就丢进事件池')
  assert.equal(条.importance, 0.3)
})

test('显式类型优先于规则', async () => {
  const r = await 造工具().execute({ text: '今天爆胎这事记成长期背景', importance: 1, 类型: 'stable' }, argv('cat-3'))
  assert.equal(r.ok, true, JSON.stringify(r))
  const 条 = 找条目('记成长期背景')
  assert.ok(条, '应写入')
  assert.equal(条.category, 'stable_profile')
})

test('关系与称呼约定归稳定事实', async () => {
  const r = await 造工具().execute({ text: '主人叫我大肥鱼，我要俏皮抗议', importance: 0.5 }, argv('cat-4'))
  assert.equal(r.ok, true, JSON.stringify(r))
  const 条 = 找条目('叫我大肥鱼')
  assert.ok(条, '应写入')
  assert.equal(条.category, 'stable_profile')
})

test('带临时时间词的偏好归事件', async () => {
  const r = await 造工具().execute({ text: '主人今天很喜欢这道菜', importance: 0.5 }, argv('cat-5'))
  assert.equal(r.ok, true, JSON.stringify(r))
  const 条 = 找条目('今天很喜欢这道菜')
  assert.ok(条, '应写入')
  assert.equal(条.category, 'event', '今天喜欢不等于长期偏好')
})
