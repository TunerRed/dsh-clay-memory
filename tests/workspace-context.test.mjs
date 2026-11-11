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
const { render项目上下文 } = await import('../lib/scoring.mjs')
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
