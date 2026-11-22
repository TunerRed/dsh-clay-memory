import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 工作区上下文层（2026-11-04，需求 §3.2）回归：
//   ① remember 带项目分类 → 落工作区库（category=workspace + ctx + scope=cwd）；
//   ② goal/stack/constraint 常驻注入（≤4 条），progress/decision/todo 不常驻；
//   ③ 无关问句也带项目上下文（它不依赖相关性）。
const home = mkdtempSync(join(tmpdir(), 'fish-wsctx-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')

const paths = await import('../lib/paths.mjs')
const { render项目上下文, 建注入账本 } = await import('../lib/scoring.mjs')
const { loadCfg } = await import('../lib/cfg.mjs')
const names = await import('../lib/names.mjs')
names.接读配置(loadCfg)
const tools = await import('../lib/tools.mjs')
tools.接定义工具((def) => def)
tools.接报信(() => {})
const { apply } = await import('../lib/index.js')

const CWD = 'G:/proj/alpha'
const dir = join(home, 'clay-memory')
mkdirSync(dir, { recursive: true })

// 给会话造假 projcache（宿主会把会话的工作区 cwd 记在 session_projcache）
function 造假工作区(sid) {
  const p = join(home, 'storages', 'session_projcache', 'sessions', sid + '.json')
  mkdirSync(join(home, 'storages', 'session_projcache', 'sessions'), { recursive: true })
  writeFileSync(p, JSON.stringify({ record: { identity: { cwd: CWD } } }), 'utf8')
}

const 造工具 = () => tools.makeRememberTool({ agents: { list: () => [] }, interval: () => () => {}, on: () => {} })
const argv = (sid) => ({ agent: { session: { id: sid } } })

function 注入文本(sid, 句子) {
  let recallText
  const agent = {
    session: { id: sid, snapshotEvents: () => [{ type: 'user/message', data: { text: 句子 } }] },
    ctx: {
      on: () => () => {},
      tools: { register: () => () => {} },
      systemPrompt: {
        section: () => () => {},
        context: ({ text }) => { recallText = text; return () => {} },
      },
    },
  }
  apply({
    agents: { list: () => [agent], get: () => agent },
    sessions: { list: () => [] },
    get: () => null,
    on: () => () => {},
    interval: () => () => {},
    effect: (fn) => fn(),
    webServer: { register: () => () => {} },
  })
  assert.equal(typeof recallText, 'function')
  return recallText() || ''
}

test('remember 带项目分类：落工作区库、带 ctx、scope 指 cwd', async () => {
  const sid = 'wsctx-1'
  造假工作区(sid)
  const r = await 造工具().execute(
    { text: '这个工具最终要替代线上记忆插件', importance: 0.7, 项目分类: 'goal' },
    argv(sid),
  )
  assert.equal(r.ok, true, JSON.stringify(r))
  const ws路径 = paths.工作区文件(CWD)
  assert.ok(existsSync(ws路径), '应写工作区文件')
  const 文件 = JSON.parse(readFileSync(ws路径, 'utf8'))
  const 条 = (文件.memories || []).find((m) => String(m.text).includes('替代线上'))
  assert.ok(条, '条目应落工作区文件')
  assert.equal(条.category, 'workspace')
  assert.equal(条.ctx, 'goal')
  assert.equal(条.scope, 'workspace:' + CWD)
})

test('render项目上下文：只常驻 goal/stack/constraint，decision 不出现，最多 4 条', () => {
  const ms = [
    { id: '1', category: 'workspace', ctx: 'goal', text: '目标 A' },
    { id: '2', category: 'workspace', ctx: 'stack', text: 'Node 22' },
    { id: '3', category: 'workspace', ctx: 'constraint', text: '不许新依赖' },
    { id: '4', category: 'workspace', ctx: 'decision', text: '选了 SQLite' },
    { id: '5', category: 'workspace', ctx: 'todo', text: '补 trace' },
    { id: '6', category: 'event', ctx: 'goal', text: '会话层的不算' },
    { id: '7', category: 'workspace', ctx: 'goal', text: '已被取代的', 已被取代: true },
  ]
  const out = render项目上下文(ms)
  assert.match(out, /目标 A/)
  assert.match(out, /Node 22/)
  assert.match(out, /不许新依赖/)
  assert.doesNotMatch(out, /选了 SQLite/)
  assert.doesNotMatch(out, /补 trace/)
  assert.doesNotMatch(out, /会话层的不算/)
  assert.doesNotMatch(out, /已被取代的/)
})

test('注入：无关问句也带项目上下文，且排在「你记得的事」前面', async () => {
  const sid = 'wsctx-2'
  造假工作区(sid)
  await 造工具().execute(
    { text: '项目目标是替代线上插件', importance: 0.8, 项目分类: 'goal' },
    argv(sid),
  )
  const out = 注入文本(sid, '今天天气怎么样')
  assert.match(out, /【项目上下文】/)
  assert.match(out, /项目目标是替代线上插件/)
  const 项目 = out.indexOf('【项目上下文】')
  const 记得 = out.indexOf('【你记得的事】')
  assert.ok(项目 >= 0)
  assert.ok(记得 < 0 || 项目 < 记得, '项目上下文应排在记忆前面')
})

// ---------- 1.12.62 方案 B：拆池排序回归 ----------
// 起因（2026-11-19）：主人问「中午画了什么」想不起来，根因之一是常驻只取前 4 名，
// 而排序把类别压在 importance 上面 ⇒ importance 0.7 的 constraint 被 4 条 0.5 的
// stack 挤出局，且 ComfyUI 那条刚好卡在第 4 名边缘，再来一条 stack 就彻底掉出上下文。
const 基 = (id, ctx, text, importance, at) => ({
  id,
  category: 'workspace',
  ctx,
  text,
  importance,
  at,
})

test('拆池后 importance 优先：constraint 0.7 不再被 4 条 stack 0.5 挤掉', () => {
  const ms = [
    基('s1', 'stack', '基建一', 0.5, '2026-11-15T00:00:00Z'),
    基('s2', 'stack', '基建二', 0.5, '2026-11-15T00:00:00Z'),
    基('s3', 'stack', '基建三', 0.5, '2026-11-15T00:00:00Z'),
    基('s4', 'stack', '基建四', 0.5, '2026-11-15T00:00:00Z'),
    基('c1', 'constraint', 'npm 快照事故', 0.7, '2026-11-18T00:00:00Z'),
  ]
  const out = render项目上下文(ms)
  assert.match(out, /npm 快照事故/, '0.7 的约束必须排在 0.5 的技术栈前面')
  // 5 条里取 4 条：留下 0.7 那条 + 前 3 条同分基建
  assert.equal(out.split('\n').filter((l) => l.startsWith('- [')).length, 4)
})

test('同 importance 且都没进过上下文时，越老越先上（防遗忘）', () => {
  const ms = [
    基('old', 'stack', '三天前的基建', 0.5, '2026-11-15T00:00:00Z'),
    基('new', 'stack', '今天的基建', 0.5, '2026-11-19T05:06:18Z'),
  ]
  const out = render项目上下文(ms, 1)
  assert.match(out, /三天前的基建/, '同分时老条目先被想起来，别让它被永久饿死')
  assert.doesNotMatch(out, /今天的基建/)
})

test('注入账本让同分条目轮换：进过的往后站，没进过的顶上来', () => {
  const ms = [
    基('a', 'stack', '甲', 0.5, '2026-11-15T00:00:00Z'),
    基('b', 'stack', '乙', 0.5, '2026-11-16T00:00:00Z'),
    基('c', 'stack', '丙', 0.5, '2026-11-17T00:00:00Z'),
  ]
  const 账本 = 建注入账本()
  const 第一轮 = render项目上下文(ms, 1, 账本)
  assert.match(第一轮, /甲/)
  const 第二轮 = render项目上下文(ms, 1, 账本)
  assert.match(第二轮, /乙/, '甲已露过面，这轮该乙上')
  const 第三轮 = render项目上下文(ms, 1, 账本)
  assert.match(第三轮, /丙/, '甲乙都露过了，该丙')
  const 第四轮 = render项目上下文(ms, 1, 账本)
  assert.match(第四轮, /甲/, '一轮转完回到开头')
})

test('账本不改变 importance 的地位：高重要的每轮都在', () => {
  const ms = [
    基('重要', 'constraint', '红线', 0.9, '2026-11-15T00:00:00Z'),
    基('a', 'stack', '甲', 0.5, '2026-11-15T00:00:00Z'),
    基('b', 'stack', '乙', 0.5, '2026-11-16T00:00:00Z'),
  ]
  const 账本 = 建注入账本()
  for (let i = 0; i < 5; i++) {
    const out = render项目上下文(ms, 1, 账本)
    assert.match(out, /红线/, 'importance 0.9 的条目不该被轮换掉')
  }
})

test('任务池保底：goal 不会被一大堆高重要度的 stack 挤光', () => {
  const ms = [
    基('g1', 'goal', '目标甲', 0.4, '2026-11-15T00:00:00Z'),
    ...Array.from({ length: 6 }, (_, i) =>
      基('s' + i, 'stack', '高权重基建' + i, 0.9, '2026-11-19T00:00:00Z'),
    ),
  ]
  const out = render项目上下文(ms)
  assert.match(out, /目标甲/, '目标池有独立配额，优先级低的 goal 也能进')
  assert.equal(out.split('\n').filter((l) => l.startsWith('- [')).length, 4)
})

test('任务池空时基建吃满配额', () => {
  const ms = Array.from({ length: 6 }, (_, i) =>
    基('s' + i, 'stack', '基建' + i, 0.5, '2026-11-19T00:00:00Z'),
  )
  const out = render项目上下文(ms)
  assert.equal(out.split('\n').filter((l) => l.startsWith('- [')).length, 4)
})
