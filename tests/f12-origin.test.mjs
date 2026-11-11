import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// F12（1.10.3）回归：每条记忆存一句「记这条时你说的话」当出处 ——
//   ① 有会话原文 → 原话 落库，能看出「你说的」而不只是她的转述；
//   ② 拿不到会话 / 没有用户消息 → 不写这个字段（老数据长什么样它长什么样）；
//   ③ 太长要截断（300 字），别把整段对话塞进库里。
const home = mkdtempSync(join(tmpdir(), 'fish-f12-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')

const { loadCfg } = await import('../lib/cfg.mjs')
const names = await import('../lib/names.mjs')
names.接读配置(loadCfg)
const tools = await import('../lib/tools.mjs')
tools.接定义工具((def) => def)
tools.接报信(() => {})
const { loadStore } = await import('../lib/store-core.mjs')

mkdirSync(join(home, 'clay-memory'), { recursive: true })

const 造工具 = () => tools.makeRememberTool({ agents: { list: () => [] }, interval: () => () => {}, on: () => {} })
const 会话 = (sid, 句子们) => ({
  agent: {
    session: {
      id: sid,
      snapshotEvents: () => 句子们.map((t) => ({ type: 'user/message', data: { text: t } })),
    },
  },
})

test('F12：remember 顺手存下「你说的话」', async () => {
  const sid = 'f12-a'
  const r = await 造工具().execute(
    { text: '我下周三要去北京出差，周日回' },
    会话(sid, ['早上好呀', '我下周三要去北京出差，周日回']),
  )
  assert.equal(r.ok, true)
  const m = loadStore(sid).memories.find((x) => x.text.indexOf('北京') >= 0)
  assert.ok(m, '这条要落库')
  assert.equal(m.原话, '我下周三要去北京出差，周日回', '最近一条用户消息就是出处')
})

test('F12：拿不到会话 / 没有用户消息 → 不写 原话', async () => {
  const sid = 'f12-b'
  const r1 = await 造工具().execute({ text: '我喜欢喝热的麦茶' }, { agent: { session: { id: sid } } })
  assert.equal(r1.ok, true)
  const r2 = await 造工具().execute({ text: '我不吃香菜' }, 会话(sid, []))
  assert.equal(r2.ok, true)
  const 们 = loadStore(sid).memories
  assert.equal(们.find((x) => x.text.indexOf('麦茶') >= 0).原话, undefined)
  assert.equal(们.find((x) => x.text.indexOf('香菜') >= 0).原话, undefined)
})

test('F12：原话过长截到 300 字', async () => {
  const sid = 'f12-c'
  const 长 = '啊'.repeat(900)
  const r = await 造工具().execute({ text: '长消息里的一句话' }, 会话(sid, [长]))
  assert.equal(r.ok, true)
  const m = loadStore(sid).memories.find((x) => x.text.indexOf('长消息') >= 0)
  assert.equal(m.原话.length, 300)
})

// ⭐ 2026-11-11 真机 bug：DSH 每轮会往会话里塞 role='user' 的系统消息
//   （time-context / runtime-context / skill-catalog / plugin:*），
//   旧版取「最近一条 user/message」拿到的是这些，原话全脏。
//   只有 source.kind === 'user' 才算真人说话。
test('F12：跳过系统注入的 user 消息，只认真人说的', async () => {
  const sid = 'f12-d'
  const 事件 = [
    { type: 'user/message', data: { text: '我下周三要去北京出差', source: { kind: 'user' } } },
    { type: 'user/message', data: { text: 'Current runtime context. This snapshot supersedes…', source: { kind: 'runtime-context' } } },
    { type: 'user/message', data: { text: '<system-reminder> 技能目录', source: { kind: 'skill-catalog' } } },
    { type: 'user/message', data: { text: 'Time sampled while preparing turn 1, step 1: 2026-11-11T11:41:57+08:00', source: { kind: 'time-context' } } },
    { type: 'user/message', data: { text: '（现在 11:45，主人 40 分钟没说话了）', source: { kind: 'plugin:dsh-proactive-msg' } } },
  ]
  const r = await 造工具().execute(
    { text: '主人下周要去北京出差' },
    { agent: { session: { id: sid, snapshotEvents: () => 事件 } } },
  )
  assert.equal(r.ok, true)
  const m = loadStore(sid).memories.find((x) => x.text.indexOf('北京') >= 0)
  assert.equal(m.原话, '我下周三要去北京出差', '原话必须是真人那句，不是系统注入')
})

