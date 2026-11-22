import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 经历 / 梗记忆（1.12.64）回归：
//   ① 解析候选：只收合法 kind，别的脏东西一律丢掉；
//   ② 挑对话：只挑水位之后、只挑人说的话、单条截断；
//   ③ 造条目：state 带过期时间，meme/milestone 永久，且必须带 scope:'global'
//      （不带就会被分层器分进会话库，换个会话就看不见 —— 这是本层的命门）；
//   ④ 该提取：空闲 / 新内容 / 条数三道门。
const home = mkdtempSync(join(tmpdir(), 'fish-episode-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')

const ep = await import('../lib/episode.mjs')

test('解析候选：正常 JSON 数组', () => {
  const out = ep.解析候选('[{"kind":"meme","text":"主人拿疯狂星期四当梗来惩罚我","importance":0.7}]')
  assert.equal(out.length, 1)
  assert.equal(out[0].kind, 'meme')
  assert.equal(out[0].importance, 0.7)
})

test('解析候选：模型套了 ```json 代码块也认得', () => {
  const out = ep.解析候选('```json\n[{"kind":"state","text":"主人这周要坐飞机出差","importance":0.4}]\n```')
  assert.equal(out.length, 1)
  assert.equal(out[0].kind, 'state')
})

test('解析候选：前后废话不影响（只切 [] 那一段）', () => {
  const out = ep.解析候选('好的，我挑出这些：\n[{"kind":"milestone","text":"下午调了一下午参数定下出图模型"}]\n以上。')
  assert.equal(out.length, 1)
})

test('解析候选：非法 kind / 太短 / 太长 / 非数组 全部丢掉', () => {
  assert.deepEqual(ep.解析候选('[{"kind":"fact","text":"这是一条很长的但并不合法的条目内容"}]'), [])
  assert.deepEqual(ep.解析候选('[{"kind":"meme","text":"短"}]'), [])
  assert.deepEqual(ep.解析候选('[{"kind":"meme","text":"' + '长'.repeat(300) + '"}]'), [])
  assert.deepEqual(ep.解析候选('不是一个数组'), [])
  assert.deepEqual(ep.解析候选(''), [])
})

test('解析候选：importance 缺省 0.5，越界掐回 [0.1, 0.9]', () => {
  const a = ep.解析候选('[{"kind":"meme","text":"主人把星期四当成只有我俩懂的梗"}]')
  assert.equal(a[0].importance, 0.5)
  const b = ep.解析候选('[{"kind":"meme","text":"主人把星期四当成只有我俩懂的梗","importance":9}]')
  assert.equal(b[0].importance, 0.9)
  const c = ep.解析候选('[{"kind":"meme","text":"主人把星期四当成只有我俩懂的梗","importance":-3}]')
  assert.equal(c[0].importance, 0.1)
})

// 真实事件形状（2026-11-19 从 session v4 原始 JSON 抄的）：
//   user      → { type:'user/message', seq, data:{ content:[{type:'text',text}], source:{kind} } }
//   assistant → { type:'assistant/message', seq, data:{ message:{ content:[...] } } }
const 主人说 = (seq, text) => ({
  seq,
  type: 'user/message',
  data: { content: [{ type: 'text', text }], source: { kind: 'user' }, role: 'user' },
})
const 系统注入 = (seq, text) => ({
  seq,
  type: 'user/message',
  data: { content: [{ type: 'text', text }], source: { kind: 'runtime-context' }, role: 'user' },
})
const 我说 = (seq, text, 思考 = '') => ({
  seq,
  type: 'assistant/message',
  data: {
    message: {
      role: 'assistant',
      content: [...(思考 ? [{ type: 'reasoning', text: 思考 }] : []), { type: 'text', text }],
    },
  },
})
const 取文本 = (m) => {
  if (!m) return ''
  if (Array.isArray(m.content)) {
    return m.content
      .map((b) => (typeof b === 'string' ? b : b && b.type === 'text' ? b.text : ''))
      .join(' ')
  }
  return ''
}

test('提取系统 prompt 的两条判据不许被改没（主人 2026-11-19 定的）', () => {
  // 判据一：能不能回答「什么时候」—— 答不出的是画像/配置/知识，不该进经历层
  assert.match(ep.提取系统, /能不能回答「什么时候」/)
  // 判据二：这件事里有没有「我们」—— 只有我在干活的那是操作日志
  assert.match(ep.提取系统, /有没有「我们」/)
  // 兜底：没东西时不许硬凑
  assert.match(ep.提取系统, /不要凑数/)
})

test('挑对话：只挑水位之后的、只挑人说的话，用户数单独数', () => {
  const ev = [
    主人说(1, '早上好'),
    我说(2, '早呀'),
    { seq: 3, type: 'tool/call', data: {} },
    主人说(4, '今天干嘛'),
  ]
  const r = ep.挑对话(ev, 2, 取文本)
  assert.equal(r.到seq, 4)
  assert.equal(r.用户数, 1, '只数 seq>2 的用户消息')
  assert.match(r.文本, /主人：今天干嘛/)
  assert.doesNotMatch(r.文本, /早上好/, '水位之前的不能再挑进来')
})

test('挑对话：宿主注入的系统文本不算主人说话（source.kind 不是 user 全丢）', () => {
  const ev = [
    系统注入(1, '<system-reminder>这是一大段系统提示词，两千多字</system-reminder>'),
    主人说(2, '真正说的一句'),
  ]
  const r = ep.挑对话(ev, 0, 取文本)
  assert.equal(r.用户数, 1, '系统注入不该被数成主人说的话')
  assert.match(r.文本, /真正说的一句/)
  assert.doesNotMatch(r.文本, /system-reminder/)
})

test('挑对话：assistant 的 reasoning 块不进正文（思考链不算说过的话）', () => {
  const ev = [我说(1, '这是我说的话', '这是我在脑子里转的碎碎念')]
  const r = ep.挑对话(ev, 0, 取文本)
  assert.match(r.文本, /这是我说的话/)
  assert.doesNotMatch(r.文本, /碎碎念/)
})

test('挑对话：超长会话取**最近**的 120 条，不是停在最早那批（否则永远追不上今天）', () => {
  const ev = []
  for (let i = 1; i <= 200; i++) ev.push(主人说(i, '第' + i + '句'))
  const r = ep.挑对话(ev, 0, 取文本)
  assert.equal(r.条数, 120)
  assert.equal(r.跳过, 80)
  assert.equal(r.到seq, 200, '水位要推到最后一条，不然下次还在同一段里打转')
  assert.match(r.文本, /第200句/)
  assert.doesNotMatch(r.文本, /第1句。/)
})

test('挑对话：单条超长只留前 300 字（贴一大段代码不该把整段挤爆）', () => {
  const ev = [主人说(1, '啊'.repeat(1000))]
  const r = ep.挑对话(ev, 0, 取文本)
  assert.ok(r.文本.length < 400, '单条要截断，实际 ' + r.文本.length)
})

test('造条目：meme 落 stable_profile（梗答不出什么时候，不是经历）', () => {
  const now = Date.parse('2026-11-19T15:00:00Z')
  const m = ep.造条目({ kind: 'meme', text: '主人叫我大肥鱼，我会抗议说自己是鲸不是鱼', importance: 0.8 }, { now })
  assert.equal(m.category, 'stable_profile', '梗是长期约定，必须走画像层才召回得到')
  assert.equal(m.scope, 'global')
  assert.equal(m.expireAt, undefined, '梗不过期')
  assert.ok(m.importance <= 0.5, '梗不许抢常驻名额，importance 要压到 0.5 以下')
})

test('造条目：state/milestone 落 event + scope:global，state 带过期', () => {
  const now = Date.parse('2026-11-19T15:00:00Z')
  const s = ep.造条目({ kind: 'state', text: '主人这周要坐飞机出差', importance: 0.4 }, { now, 会话id: 's1' })
  assert.equal(s.category, 'event')
  assert.equal(s.scope, 'global', '不带这个就会被分进会话库，换会话就看不见')
  assert.equal(s.episode, 'state')
  assert.ok(s.expireAt, 'state 型必须有过期时间')
  assert.ok(Date.parse(s.expireAt) > now)

  const k = ep.造条目({ kind: 'milestone', text: '下午和主人一起调 ComfyUI 参数定下出图模型', importance: 0.6 }, { now })
  assert.equal(k.category, 'event')
  assert.equal(k.expireAt, undefined, '里程碑不过期')
})

test('该提取：空闲不够 / 没新内容 / 条数不够 / 全部满足', () => {
  const 记 = { seq: 100 }
  const 基准 = { 最后活动: 1000, 最新seq: 110, 新增用户数: 12 }
  // 刚说完话 —— 不算空闲
  assert.equal(ep.该提取(记, { ...基准, 现在: 1000 + 60 * 1000 }), false)
  // 空闲够了但没新内容
  assert.equal(ep.该提取(记, { ...基准, 现在: 1000 + 30 * 60000, 最新seq: 100 }), false)
  // 有内容但主人只说了两句
  assert.equal(ep.该提取(记, { ...基准, 现在: 1000 + 30 * 60000, 新增用户数: 2 }), false)
  // 全部满足
  assert.equal(ep.该提取(记, { ...基准, 现在: 1000 + 30 * 60000 }), true)
})

test('水位读写：坏了当空，不抛', () => {
  const 表 = { s1: { seq: 42, 用户数: 11, 上次提取: 123 } }
  assert.equal(ep.写水位(表), true)
  assert.ok(existsSync(ep.水位路径()))
  const back = ep.读水位()
  assert.equal(back.s1.seq, 42)
})
