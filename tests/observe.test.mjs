import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { analyzeTraces, formatReport, parseTraceTime } from '../tools/observe.mjs'

const NOW = Date.parse('2026-11-15T12:00:00.000Z')
const DAY = 86400000
const script = fileURLToPath(new URL('../tools/observe.mjs', import.meta.url))
const facts = {
  memories: [
    { id: 'k', text: '当前知识文本已增长', is_knowledge: true },
    { id: 'p', text: '当前画像', is_knowledge: false },
    { id: 'skipped', text: '已忽略', refinedSkip: true },
    { id: 'replaced', text: '已替代', 已被取代: true },
    { id: 'suppressed', text: '不记', 别记: true },
  ],
  policy: { maxChars: 999, maxItems: 20 },
}
const trace = (overrides = {}) => ({
  at: NOW - 1000, turn: 1, step: 1, picked: [], selectedMeta: [], 字: 0, totalChars: 0,
  algorithmVersion: 'v2', policySnapshot: { maxChars: 200 }, queryDiagnostics: {}, fallback: false,
  ...overrides,
})
const file = (traces, name = 's.traces.jsonl') => ({ name, text: traces.map((t) => JSON.stringify(t)).join('\n') })
const analyze = (traces, options = {}) => analyzeTraces({ files: [file(traces)], facts, now: NOW, ...options })

// 每个 CLI 子进程只接触独立临时目录，明确覆盖继承的 DSH_HOME。
function fixture(t) {
  assert.ok(existsSync(tmpdir()), '临时目录的父目录必须存在')
  const home = mkdtempSync(join(tmpdir(), 'fish-observe-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const memory = join(home, 'clay-memory')
  mkdirSync(memory)
  writeFileSync(join(memory, '_facts.json'), JSON.stringify(facts))
  const env = { ...process.env, DSH_HOME: join(home, 'unused-home') }
  const run = (args, overrides = {}) => spawnSync(process.execPath, [script, ...args], {
    cwd: home, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 10000,
  })
  return { home, memory, env, run }
}

test('时间解析支持毫秒数、数字串和 ISO（含时区）', () => {
  for (const value of [NOW, String(NOW), ' ' + NOW + ' ', '2026-11-15T12:00:00.000Z', '2026-11-15T20:00:00+08:00']) {
    assert.equal(parseTraceTime(value), NOW)
  }
  assert.equal(parseTraceTime('1.794744e12'), 1.794744e12)
})

test('时间解析拒绝缺失、非有限数、零、负数和非法日历日期', () => {
  for (const value of [null, undefined, '', ' ', '坏时间', 0, '0', -1, NaN, Infinity, true, {}, [], 8640000000000001, '2026-02-30T12:00:00Z', '2026-13-01', '2026-11-15T25:00:00Z']) {
    assert.equal(parseTraceTime(value), null, String(value))
  }
})

test('时间窗包含边界，识别时间别名，非法和未来记录不会混入', () => {
  const result = analyze([
    trace({ at: NOW - 7 * DAY, turn: 1 }),
    trace({ at: String(NOW - DAY), turn: 2 }),
    trace({ at: new Date(NOW - 2 * DAY).toISOString(), turn: 3 }),
    trace({ at: undefined, 时间: NOW, turn: 4 }),
    trace({ at: undefined, time: NOW - 3 * DAY, turn: 5 }),
    trace({ at: NOW - 7 * DAY - 1, turn: 6 }),
    trace({ at: NOW + 1, turn: 7 }),
    trace({ at: '坏时间', turn: 8 }),
    trace({ at: undefined, turn: 9 }),
  ], { days: 7 })
  assert.equal(result.轮数, 5)
  assert.equal(result.覆盖.原始条数, 9)
  assert.equal(result.覆盖.窗外条数, 1)
  assert.equal(result.覆盖.未来时间条数, 1)
  assert.equal(result.覆盖.非法时间条数, 2)
  assert.equal(result.覆盖.覆盖起点, new Date(NOW - 7 * DAY).toISOString())
  assert.equal(result.覆盖.覆盖终点, new Date(NOW).toISOString())
})

test('不指定 days 也明确排除非法时间、未来时间和损坏 JSON', () => {
  const result = analyzeTraces({
    now: NOW, facts,
    files: [{ name: 's.traces.jsonl', text: '\n' + JSON.stringify(trace()) + '\n{坏\nnull\n' + JSON.stringify(trace({ at: '坏' })) + '\n' + JSON.stringify(trace({ at: NOW + DAY })) }],
  })
  assert.equal(result.轮数, 1)
  assert.equal(result.覆盖.原始条数, 5)
  assert.equal(result.覆盖.非法JSON条数, 1)
  assert.equal(result.覆盖.非法时间条数, 2)
  assert.equal(result.覆盖.未来时间条数, 1)
})

test('同文件同会话同 turn 只留最后时刻，同时间取较大 step，再按末行', () => {
  const result = analyze([
    trace({ at: NOW - 100, step: 1, totalChars: 10 }),
    trace({ at: NOW - 100, step: 3, totalChars: 30 }),
    trace({ at: NOW - 200, step: 99, totalChars: 990 }),
    trace({ at: NOW - 100, step: 2, totalChars: 20 }),
    trace({ at: NOW - 100, step: 3, totalChars: 35 }),
  ])
  assert.equal(result.轮数, 1)
  assert.equal(result.覆盖.合并step条数, 4)
  assert.equal(result.整体注入.每轮字数, 35)
})

test('相同 turn 在不同文件、不同会话均独立统计', () => {
  const result = analyzeTraces({ now: NOW, facts, files: [
    file([trace({ sessionId: 'a' }), trace({ sessionId: 'b' }), trace({ session: 'c' }), trace({ conversationId: 'd' })], 'one.traces.jsonl'),
    file([trace({ sessionId: 'a' })], 'two.traces.jsonl'),
  ] })
  assert.equal(result.轮数, 5)
  assert.equal(result.覆盖.合并step条数, 0)
  assert.equal(result.覆盖.无会话标识轮数, 0)
})

test('缺少或非法 turn 的每条记录保守独立，turn 0 正常去重', () => {
  const result = analyze([
    trace({ turn: undefined }), trace({ turn: undefined }), trace({ turn: '' }), trace({ turn: {} }),
    trace({ turn: 0 }), trace({ turn: '0', step: 2 }),
  ])
  assert.equal(result.轮数, 5)
  assert.equal(result.覆盖.无turn轮数, 4)
  assert.equal(result.覆盖.合并step条数, 1)
  assert.match(result.警告.join('\n'), /无 turn.*高估/)
})

test('新 selectedMeta 使用历史分类和字符，不依赖当前 facts 文本或存活 ID', () => {
  const result = analyze([trace({
    picked: ['k', 'deleted', 'p', 'event'], 字: 40, totalChars: 140,
    selectedMeta: [
      { id: 'k', scope: 'global', isKnowledge: false, chars: 3 },
      { id: 'deleted', scope: 'global', isKnowledge: true, chars: 7 },
      { id: 'p', scope: 'global', isKnowledge: false, chars: 5 },
      { id: 'event', scope: 'session', isKnowledge: false, chars: 11 },
    ],
  })])
  assert.deepEqual(result.事实注入.条次, { 知识: 1, 画像: 2, unknown: 0 })
  assert.deepEqual(result.事实注入.字次, { 知识: 7, 画像: 8, unknown: 0 })
  assert.equal(result.事实注入.每轮条数, 3)
  assert.equal(result.事实注入.每轮字数, 15)
  assert.equal(result.事实注入.当前快照估计字合计, 0)
  assert.equal(result.整体注入.每轮条数, 4)
  assert.equal(result.整体注入.每轮字数, 140)
  assert.equal(result.整体注入.每轮记忆渲染字, 40)
  assert.equal(result.整体注入.预算利用率, 20)
  assert.equal(result.ActiveRatio.知识, 100)
})

test('旧 trace 事实分项明确为当前快照估计，不能伪造 totalChars 或历史配置', () => {
  const result = analyze([{ at: NOW - 100, turn: 1, picked: ['k', 'event'], 字: 50 }])
  assert.equal(result.事实注入.当前快照估计轮数, 1)
  assert.equal(result.事实注入.每轮字数, facts.memories[0].text.length)
  assert.equal(result.事实注入.当前快照估计字合计, facts.memories[0].text.length)
  assert.equal(result.事实注入.未归类picked条次, 1)
  assert.equal(result.整体注入.每轮条数, 2)
  assert.equal(result.整体注入.空注入, 0)
  assert.equal(result.整体注入.每轮字数, null)
  assert.equal(result.整体注入.完整上下文字合计, null)
  assert.equal(result.整体注入.每轮记忆渲染字, 50)
  assert.equal(result.整体注入.预算利用率, null)
  assert.equal(result.质量.无版本轮数, 1)
  assert.equal(result.分组[0].algorithmVersion, null)
  assert.equal(result.分组[0].policySnapshot, null)
  assert.match(result.警告.join('\n'), /当前快照估计/)
})

test('兜底有字、事件或项目 picked、仅骨架输出都不算整体空注入', () => {
  const result = analyze([
    trace({ turn: 1, fallback: true, 字: 25, totalChars: undefined }),
    { at: NOW - 100, turn: 2, picked: ['event'], 字: 12 },
    trace({ turn: 3, picked: ['project'], selectedMeta: [{ id: 'project', scope: 'workspace', isKnowledge: false, chars: 4 }] }),
    trace({ turn: 4, totalChars: 80 }),
    trace({ turn: 5 }),
    { at: NOW - 100, turn: 6, picked: [] },
    { at: NOW - 100, turn: 7, fallback: true },
  ])
  assert.equal(result.整体注入.空注入, 1)
  assert.equal(result.整体注入.非空注入, 4)
  assert.equal(result.整体注入.unknown轮数, 2)
  assert.equal(result.整体注入.空注入率, 20)
  assert.equal(result.整体注入.兜底轮数, 2)
  assert.equal(result.注入.空注入, 1)
})

test('零召回：兜底写了几十个字，也当「一条记忆都没召回到」', () => {
  const result = analyze([
    trace({ turn: 1, fallback: true, 字: 25 }),
    trace({ turn: 2, picked: ['k'] }),
  ])
  assert.equal(result.整体注入.零召回的轮, 1)
  assert.equal(result.整体注入.零召回率, 50)
  assert.equal(result.整体注入.兜底轮数, 1)
  // 空注入量的是「注入区有没有字」，兜底那轮有字；零召回量的是「有没有召回到记忆」，它没有。
  assert.equal(result.整体注入.非空注入, 2)
  assert.equal(result.整体注入.空注入, 0)
})

test('缺 picked 时 selectedMeta 仍证明事件非空，空元数据不回退到当前事实', () => {
  const result = analyze([
    trace({ turn: 1, picked: undefined, selectedMeta: [{ id: 'e', scope: 'session', isKnowledge: false, chars: 5 }] }),
    trace({ turn: 2, picked: ['k'], selectedMeta: [] }),
  ])
  assert.equal(result.整体注入.每轮条数, 1)
  assert.equal(result.整体注入.非空注入, 2)
  assert.equal(result.事实注入.每轮条数, 0)
  assert.equal(result.质量.selectedMeta与picked不一致轮数, 1)
  assert.equal(result.质量.旧trace估计轮数, 0)
})

test('新旧混合的完整上下文字数只对已知样本求均值，不将缺失补零', () => {
  const result = analyze([
    trace({ turn: 1, 字: 20, totalChars: 120 }),
    { at: NOW - 100, turn: 2, picked: ['k'], 字: 60 },
    trace({ turn: 3, 字: undefined, totalChars: -1 }),
  ])
  assert.equal(result.整体注入.每轮字数, 120)
  assert.equal(result.整体注入.完整上下文字覆盖轮数, 1)
  assert.equal(result.整体注入.完整上下文字unknown轮数, 2)
  assert.equal(result.整体注入.每轮记忆渲染字, 40)
  assert.equal(result.整体注入.记忆渲染字覆盖轮数, 2)
  assert.equal(result.整体注入.预算覆盖轮数, 1)
})

test('元数据缺字符或知识分类时报告 unknown，不使用当前文本补全', () => {
  const result = analyze([trace({
    picked: ['k', 'p'],
    selectedMeta: [
      { id: 'k', scope: 'global', isKnowledge: true },
      { id: 'p', scope: 'global', chars: 4 },
    ],
  })])
  assert.equal(result.事实注入.缺字符条次, 1)
  assert.equal(result.事实注入.每轮字数, null)
  assert.equal(result.事实注入.每轮知识字, null)
  assert.equal(result.事实注入.条次.unknown, 1)
  assert.equal(result.事实注入.字次.unknown, 4)
})

test('无事实快照时历史 selectedMeta 仍可统计，旧 trace 标为 unknown', () => {
  const result = analyze([
    trace({ turn: 1, picked: ['k'], selectedMeta: [{ id: 'k', scope: 'global', isKnowledge: true, chars: 8 }] }),
    { at: NOW - 100, turn: 2, picked: ['k'] },
  ], { facts: null })
  assert.equal(result.池.总条, null)
  assert.equal(result.ActiveRatio.知识, null)
  assert.equal(result.事实注入.每轮字数, 8)
  assert.equal(result.事实注入.统计轮数, 1)
  assert.equal(result.事实注入.unknown轮数, 1)
})

test('版本与配置按稳定键分组，unknown 不被当前配置填充', () => {
  const result = analyze([
    trace({ turn: 1, policySnapshot: { maxChars: 200, nested: { a: 1, b: 2 } } }),
    trace({ turn: 2, policySnapshot: { nested: { b: 2, a: 1 }, maxChars: 200 } }),
    trace({ turn: 3, algorithmVersion: 'v3', policySnapshot: { maxChars: 300 } }),
    { at: NOW - 100, turn: 4, picked: [], 字: 0 },
  ])
  assert.equal(result.分组.length, 3)
  assert.equal(result.分组.find((g) => g.algorithmVersion === 'v2').轮数, 2)
  assert.equal(result.分组.find((g) => g.algorithmVersion === null).policySnapshot, null)
  assert.equal(result.质量.无版本轮数, 1)
  assert.equal(result.质量.无配置快照轮数, 1)
  assert.equal(result.质量.无查询诊断轮数, 1)
  assert.equal(result.质量.版本混用, true)
  assert.equal(result.质量.配置混用, true)
  assert.match(result.警告.join('\n'), /混用/)
})

test('即使日志跨度超过两周也不承诺完整两周，低 ActiveRatio 不是迁出许可', () => {
  const result = analyze([trace({ at: NOW - 20 * DAY, turn: 1 }), trace({ turn: 2 })])
  assert.equal(result.覆盖.完整两周可证明, false)
  assert.equal(result.ActiveRatio.知识, 0)
  assert.match(result.覆盖.说明, /日志滚动/)
  assert.match(result.ActiveRatio.口径, /不是迁出许可/)
  assert.match(formatReport(result), /不能证明完整两周/)
  assert.doesNotMatch(formatReport(result), /才可以开始迁|达标才可以/)
})

test('空数据与不可读文件不会制造观测读数或低 ActiveRatio', () => {
  const result = analyzeTraces({ now: NOW, facts, files: [{ name: 'unreadable.traces.jsonl', text: null }] })
  assert.equal(result.轮数, 0)
  assert.equal(result.覆盖.覆盖起点, null)
  assert.equal(result.ActiveRatio.知识, null)
  assert.equal(result.整体注入.每轮字数, null)
  assert.equal(result.整体注入.空注入率, null)
  assert.deepEqual(result.覆盖.读取失败文件, ['unreadable.traces.jsonl'])
})

test('没有任何可用事实选择信息时 ActiveRatio 为 unknown', () => {
  const result = analyze([{ at: NOW - 1, turn: 1 }])
  assert.equal(result.质量.事实unknown轮数, 1)
  assert.equal(result.ActiveRatio.知识, null)
  assert.equal(result.事实注入.每轮字数, null)
})

test('淘汰分布明确当前快照估计，特殊键不会污染对象原型', () => {
  const result = analyze([trace({ rows: [
    { id: 'k', omission: null }, { id: 'p', omission: 'budget' },
    { id: 'k', omission: '__proto__' }, { id: 'other', omission: 'budget' },
  ] })])
  assert.equal(result.淘汰分布.知识.选中, 1)
  assert.equal(result.淘汰分布.知识.__proto__, 1)
  assert.equal(result.淘汰分布.画像.budget, 1)
  assert.equal(result.质量.淘汰未归类条次, 1)
  assert.match(result.淘汰分布口径, /当前.*估计/)
  assert.equal(Object.getPrototypeOf(result.淘汰分布.知识), Object.prototype)
})

test('纯分析不修改输入且拒绝非法 now/days', () => {
  const options = { files: [file([trace()])], facts: structuredClone(facts), now: NOW }
  const before = JSON.stringify(options)
  assert.deepEqual(analyzeTraces(options), analyzeTraces(options))
  assert.equal(JSON.stringify(options), before)
  for (const days of [-1, Infinity, NaN, '7']) assert.throws(() => analyze([], { days }), /days/)
  for (const now of [undefined, 0, NaN, String(NOW)]) assert.throws(() => analyze([], { now }), /now/)
})

test('导入模块无 CLI 输出或库读取，不要求 DSH_HOME', (t) => {
  const { home, env } = fixture(t)
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(new URL('../tools/observe.mjs', import.meta.url).href)}).then(m => { if (typeof m.analyzeTraces !== 'function') process.exitCode = 1 })`], {
    cwd: home, env: { ...env, DSH_HOME: '' }, encoding: 'utf8', timeout: 10000,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})

test('CLI --home --days --json 使用隔离 fixture，数字时间窗正确且文件完全只读', (t) => {
  const { home, memory, run } = fixture(t)
  const now = Date.now()
  writeFileSync(join(memory, 's.traces.jsonl'), file([
    trace({ at: now - DAY, turn: 1, totalChars: 80, 字: 20 }),
    trace({ at: String(now - DAY), turn: 1, step: 2, totalChars: 100, 字: 30 }),
    trace({ at: now - 30 * DAY, turn: 2 }),
    trace({ at: now + DAY, turn: 3 }),
    trace({ at: '坏', turn: 4 }),
  ]).text)
  const before = Object.fromEntries(readdirSync(memory).map((name) => [name, readFileSync(join(memory, name), 'utf8')]))
  const child = run(['--home', home, '--days', '7', '--json'])
  assert.equal(child.status, 0, child.stderr)
  const result = JSON.parse(child.stdout)
  assert.equal(result.库, memory)
  assert.equal(result.轮数, 1)
  assert.equal(result.覆盖.原始条数, 5)
  assert.equal(result.覆盖.窗外条数, 1)
  assert.equal(result.覆盖.未来时间条数, 1)
  assert.equal(result.覆盖.非法时间条数, 1)
  assert.equal(result.整体注入.每轮字数, 100)
  for (const key of ['库', '时间窗', '轮数', '池', 'ActiveRatio', '注入', '淘汰分布', '当前参数']) assert.ok(Object.hasOwn(result, key))
  assert.deepEqual(Object.fromEntries(readdirSync(memory).map((name) => [name, readFileSync(join(memory, name), 'utf8')])), before)
})

test('CLI 支持隔离的 DSH_HOME 默认值，文本报告披露估计和 unknown', (t) => {
  const { home, memory, run } = fixture(t)
  writeFileSync(join(memory, 'old.traces.jsonl'), file([{ at: Date.now() - 1000, turn: 1, picked: ['k'], 字: 50 }]).text)
  const child = run([], { DSH_HOME: home })
  assert.equal(child.status, 0, child.stderr)
  assert.match(child.stdout, /当前快照估计轮：1/)
  assert.match(child.stdout, /完整上下文：unknown/)
  assert.match(child.stdout, /无版本轮数/)
  assert.match(child.stdout, /不能证明完整两周/)
  assert.match(child.stdout, /不是迁出许可/)
})

test('CLI 拒绝坏参数，不退回真实 DSH_HOME', (t) => {
  const { home, run } = fixture(t)
  for (const args of [
    ['--home'], ['--days'], ['--home', home, '--days', '-1'],
    ['--home', home, '--days', 'NaN'], ['--home', home, '--days', 'Infinity'], ['--bad'],
  ]) {
    const child = run(args)
    assert.equal(child.status, 2, JSON.stringify(args))
    assert.equal(child.stdout, '')
    assert.match(child.stderr, /缺少参数|非负有限|未知参数/)
  }
})

test('CLI 不存在或未提供的隔离目录返回错误', (t) => {
  const { home, run } = fixture(t)
  for (const [args, env] of [[['--home', join(home, 'missing')], {}], [[], { DSH_HOME: '' }]]) {
    const child = run(args, env)
    assert.equal(child.status, 2)
    assert.match(child.stderr, /找不到记忆库/)
  }
})

test('CLI 空或损坏事实快照不崩溃，不制造池和历史字符数', (t) => {
  const { home, memory, run } = fixture(t)
  writeFileSync(join(memory, '_facts.json'), '{坏')
  writeFileSync(join(memory, 's.traces.jsonl'), '{坏\n' + JSON.stringify({ at: Date.now() - 1000, turn: 1, picked: ['k'] }))
  const child = run(['--home', home, '--json'])
  assert.equal(child.status, 0, child.stderr)
  const result = JSON.parse(child.stdout)
  assert.equal(result.质量.事实快照可用, false)
  assert.equal(result.池.总条, null)
  assert.equal(result.ActiveRatio.知识, null)
  assert.equal(result.整体注入.每轮字数, null)
  assert.equal(result.覆盖.非法JSON条数, 1)
})

test('零召回双口径：没有 turn 的老记录不进「按 turn」的分母', () => {
  const result = analyze([
    trace({ turn: 1, picked: [], 字: 30, fallback: true }),
    trace({ turn: 2, picked: ['k'] }),
    trace({ turn: undefined, step: undefined, picked: [], 字: 30, fallback: true }),
  ])
  // 全量口径：3 轮里 2 轮零召回（老记录一条算一轮）
  assert.equal(result.整体注入.零召回的轮, 2)
  assert.equal(result.整体注入.无turn记录轮数, 1)
  // 按 turn 口径：只算 2 轮有 turn 的，其中 1 轮零召回 —— 这才是能跟人对话对照的比例
  assert.equal(result.整体注入.零召回轮数按turn, 1)
  assert.equal(result.整体注入.按turn分母, 2)
  assert.equal(result.整体注入.零召回率按turn, 50)
})
