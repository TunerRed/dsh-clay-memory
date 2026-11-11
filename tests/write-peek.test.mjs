import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 写入可见（1.10.4）回归：写入看得见 —— 记一条新记忆时，告诉它「库里最像的是哪条」。
//   ① 像但不够像（0.5~0.85）→ 提一句，判断权交回给它自己；
//   ② 完全像（≥0.85）→ 不提（上面已经自动标「已被取代」了）；
//   ③ 不相干（<0.5）→ 不提（天天喊狼来了等于没信息）；
//   ④ 已被取代 / 别记 / 这次刚作废的 → 不拿来提示（指错人比不提示更糟）。
//   这个文件本身不 import 任何宿主接口 → 纯函数部分不启动 DSH 也能测。
const home = mkdtempSync(join(tmpdir(), 'fish-peek-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')

const { 找最像, 像提示, 提示字数 } = await import('../lib/write-peek.mjs')

const 条 = (id, text, 加料) => ({ id, text, ...(加料 || {}) })

test('写入可见：像但不够像（0.80）→ 找得到，带原文和分数', () => {
  const memories = [条('m1', '我下周三要去北京出差'), 条('m2', '我不吃香菜')]
  const peek = 找最像(memories, '我下周三去北京看展')
  assert.ok(peek, '0.80 这一档要提示')
  assert.equal(peek.id, 'm1')
  assert.equal(peek.text, '我下周三要去北京出差')
  assert.ok(Math.abs(peek.像 - 0.8) < 1e-6, '分数要能对上（实测 0.800）')
})

test('写入可见：完全像（≥0.85）和完全不像（<0.5）都不提', () => {
  const 完全像 = [条('m1', '我下周三要去北京出差')]
  assert.equal(找最像(完全像, '我下周三去北京出差'), null, '≥0.85 交给自动作废，不重复念叨')
  const 不像 = [条('m1', '我不吃香菜')]
  assert.equal(找最像(不像, '明天下午三点开会'), null, '<0.5 太泛，不提示')
})

test('写入可见：已被取代 / 别记 / 排除名单里的不拿来提示', () => {
  const 全 = [
    条('m1', '我下周三要去北京出差', { 已被取代: { by: 'm9' } }),
    条('m2', '我下周三要去北京出差', { 别记: { 原因: '过时了' } }),
    条('m3', '我下周三要去北京出差'),
  ]
  assert.equal(找最像(全, '我下周三去北京看展').id, 'm3', '前两条都要跳过')
  assert.equal(找最像(全, '我下周三去北京看展', ['m3']), null, '排除后没有候选')
  assert.equal(找最像(全, '我下周三去北京看展', new Set(['m3'])), null, 'Set 也要认')
})

test('写入可见：提示文案截到 40 字，空结果不返回任何字', () => {
  const 长 = '我'.repeat(提示字数) + '很长的尾巴'
  const 话 = 像提示({ id: 'm1', text: 长, 像: 0.66 })
  assert.ok(话.indexOf('像') >= 0)
  assert.ok(话.indexOf('0.66') >= 0)
  assert.ok(话.indexOf('…') >= 0, '超长要截断')
  assert.ok(话.indexOf('很长的尾巴') < 0, '截断之后原文的尾巴不许跟着进来')
  assert.equal(像提示(null), '')
  assert.equal(像提示({ id: 'm1', text: '', 像: 0.6 }), '')
})

// ---- 接到 remember 上：提示真的会出现在工具返回值里（也不多出别的字）----
const { loadCfg } = await import('../lib/cfg.mjs')
const names = await import('../lib/names.mjs')
names.接读配置(loadCfg)
const tools = await import('../lib/tools.mjs')
tools.接定义工具((def) => def)
tools.接报信(() => {})

mkdirSync(join(home, 'clay-memory'), { recursive: true })
const 造工具 = () => tools.makeRememberTool({ agents: { list: () => [] }, interval: () => () => {}, on: () => {} })
const 会话 = (sid) => ({ agent: { session: { id: sid, snapshotEvents: () => [] } } })

test('写入可见：remember 返回里带「跟某某有点像」', async () => {
  const sid = 'peek-a'
  const 工 = 造工具()
  const r1 = await 工.execute({ text: '我下周三要去北京出差' }, 会话(sid))
  assert.equal(r1.ok, true)
  assert.ok(r1.message.indexOf('有点像') < 0, '库里还没有别的条，不该提示')
  const r2 = await 工.execute({ text: '我下周三去北京看展' }, 会话(sid))
  assert.equal(r2.ok, true)
  assert.ok(r2.message.indexOf('有点像') >= 0, '0.80 这一档要提示')
  assert.ok(r2.message.indexOf('北京出差') >= 0, '要能认出是哪条')
})

test('写入可见：完全重复走强化那条路，不额外念叨「有点像」', async () => {
  const sid = 'peek-b'
  const 工 = 造工具()
  await 工.execute({ text: '我下周三要去北京出差' }, 会话(sid))
  const r = await 工.execute({ text: '我下周三要去北京出差' }, 会话(sid))
  assert.equal(r.ok, true)
  assert.ok(r.message.indexOf('记过了') >= 0)
  assert.ok(r.message.indexOf('有点像') < 0)
})
