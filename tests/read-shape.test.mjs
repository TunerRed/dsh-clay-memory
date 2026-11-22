// 1.8.38 P1-②：读一份 按版本校验结构 —— 合法 JSON 对象不一定是合法记忆库。
// 任何结构损坏的文件都不能被当作空库保存覆盖；旧版本（1.3.7 无 version）走既有迁移语义。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'fish-shape-'))
process.env.DSH_HOME = home
const store = await import('../lib/store-core.mjs')
store.接报信(() => {})
const dir = join(home, 'clay-memory')
mkdirSync(dir, { recursive: true })
const file = (sid) => join(dir, sid + '.json')
const 读原始 = (sid) => readFileSync(file(sid), 'utf8')

const 合法库 = (extra = {}) => JSON.stringify({
  version: 2, purgeEpoch: 'e1', policy: {},
  memories: [{ id: 'a', text: '条目', category: 'event' }],
  traces: [], deleted: [],
  ...extra,
})

const 造坏文件 = (sid, 内容) => writeFileSync(file(sid), 内容, 'utf8')

function 写回应被拒(sid, 视) {
  // 结构坏读出来的毒视图，saveStoreJSON 入口必须拒绝（含 raw），盘上内容不得变
  const 原文 = 读原始(sid)
  for (const 选项 of [{}, { raw: true }]) {
    assert.throws(
      () => store.saveStoreJSON(sid, 视, 选项),
      (e) => String((e && e.message) || e).includes('已彻底清理'),
      '结构坏的视图不得写回' + (选项.raw ? '（raw）' : ''),
    )
    assert.equal(读原始(sid), 原文, '盘上内容不得被覆盖')
  }
}

test('合法的当前版本文件：正常读', () => {
  writeFileSync(file('s-ok'), 合法库(), 'utf8')
  const 视 = store.loadStoreJSON('s-ok')
  assert.ok(Array.isArray(视.memories) && 视.memories.length === 1)
  assert.equal(视.purgeEpoch, 'e1')
})

test('合法的已知旧版本文件（1.3.7 无 version/policy/traces）：走迁移语义，不判损坏', () => {
  writeFileSync(file('s-old'), JSON.stringify({
    memories: [{ id: 'a', text: '老记忆' }], deleted: [],
  }), 'utf8')
  const 视 = store.loadStoreJSON('s-old')
  assert.equal(视.memories.length, 1, '老库记忆要读得到')
  assert.equal(视.purgeEpoch, '', '缺代际按空代际')
  assert.equal(视.policy.baseHalfLifeDays, 30, 'policy 归一默认')
})

test('缺 memories（version 2）：毒快照，拒绝写回', () => {
  造坏文件('s-nomem', JSON.stringify({ version: 2, policy: {} }))
  const 视 = store.loadStoreJSON('s-nomem')
  assert.ok(store.corruptSnapshots.has(视), '读出来的是毒快照')
  写回应被拒('s-nomem', 视)
})

test('memories 类型错误：毒快照', () => {
  for (const 坏 of ['{"version":2,"memories":"x","deleted":[]}',
                    '{"version":2,"memories":{"a":1},"deleted":[]}']) {
    const sid = 's-badmem-' + Math.random().toString(36).slice(2, 6)
    造坏文件(sid, 坏)
    const 视 = store.loadStoreJSON(sid)
    assert.ok(store.corruptSnapshots.has(视), 'memories 非数组 → 毒')
    写回应被拒(sid, 视)
  }
})

test('memories 中存在非法条目：毒快照', () => {
  for (const 坏 of [null, 42, '字', true]) {
    const sid = 's-baditem-' + Math.random().toString(36).slice(2, 6)
    造坏文件(sid, JSON.stringify({ version: 2, memories: [{ id: 'a', text: '好' }, 坏], deleted: [] }))
    const 视 = store.loadStoreJSON(sid)
    assert.ok(store.corruptSnapshots.has(视), '非对象条目 → 毒')
    写回应被拒(sid, 视)
  }
})

test('version 2 缺 deleted：毒快照（墓碑缺失写回会复活已删记忆）', () => {
  造坏文件('s-nodeleted', JSON.stringify({ version: 2, memories: [{ id: 'a', text: 'x' }] }))
  const 视 = store.loadStoreJSON('s-nodeleted')
  assert.ok(store.corruptSnapshots.has(视))
  写回应被拒('s-nodeleted', 视)
})

test('未知版本号：毒快照', () => {
  for (const v of [3, '3', null, { 怪: 1 }]) {
    const sid = 's-ver-' + Math.random().toString(36).slice(2, 6)
    造坏文件(sid, JSON.stringify({ version: v, memories: [], deleted: [] }))
    const 视 = store.loadStoreJSON(sid)
    assert.ok(store.corruptSnapshots.has(视), '未知版本 ' + JSON.stringify(v) + ' → 毒')
    写回应被拒(sid, 视)
  }
})

test('JSON 语法错误：走自愈毒（有 bytes 凭据），写回前先备份原件', () => {
  造坏文件('s-syntax', '{ 这不是 JSON')
  const 视 = store.loadStoreJSON('s-syntax')
  assert.ok(store.corruptSnapshots.has(视))
  const 凭据们 = store.corruptSnapshots.get(视)
  assert.ok([...凭据们.values()][0].bytes, '自愈毒凭据要带 bytes')
  // 1.4.0 的自愈语义：内容已知（bytes 凭据）→ 允许写回覆盖，但覆盖前必须先备份原件
  store.saveStoreJSON('s-syntax', 视, {})
  const 名 = file('s-syntax')
  const 备份 = readdirSync(dir).filter((f) => f.startsWith('s-syntax.json.corrupt-'))
  assert.ok(备份.length >= 1, '坏文件原件必须留 .corrupt-* 备份')
  assert.equal(readFileSync(join(dir, 备份[0]), 'utf8'), '{ 这不是 JSON', '备份 = 原始坏内容')
  assert.ok(JSON.parse(readFileSync(名, 'utf8')).version === 2, '盘上已换成新库')
})

test('老库缺 memories 同样判损坏（不能当空库覆盖）', () => {
  造坏文件('s-oldbad', JSON.stringify({ deleted: [] }))
  const 视 = store.loadStoreJSON('s-oldbad')
  assert.ok(store.corruptSnapshots.has(视), '老库缺 memories → 毒')
  写回应被拒('s-oldbad', 视)
})

// ===== 1.8.39 A：记忆条目级 Schema 校验（GPT 任务书） =====

const 造坏条目库 = (memories, deleted = []) =>
  JSON.stringify({ version: 2, purgeEpoch: 'e1', policy: {}, memories, traces: [], deleted })

test('A：正常全字段条目不误伤（含 inference/workspace 新字段）', () => {
  const 全字段 = {
    id: 'm1', text: '用户喜欢命令行', at: '2026-10-31T00:00:00Z', createdAt: '2026-10-31T00:00:00Z',
    category: 'event', scope: 'session', type: 'preference', status: 'confirmed',
    importance: 0.8, evidence: ['e1'], related: ['词'], refinedAt: 1761878400000,
  }
  const sid = 's-full-' + Math.random().toString(36).slice(2, 6)
  造坏文件(sid, 造坏条目库([全字段]))
  const 视 = store.loadStoreJSON(sid)
  assert.ok(!store.corruptSnapshots.has(视), '全字段条目是合法的，不能判毒')
  assert.equal(视.memories.length, 1)
})

test('A：缺 id / id 空串 / id 类型错 → 毒快照 + 拒绝写回', () => {
  const 坏们 = [
    [{ text: '没 id' }],
    [{ id: '', text: '空 id' }],
    [{ id: '  ', text: '纯空白 id' }],
    [{ id: 42, text: '数字 id' }],
    [{ id: null, text: 'null id' }],
  ]
  for (const 坏 of 坏们) {
    const sid = 's-noid-' + Math.random().toString(36).slice(2, 6)
    造坏文件(sid, 造坏条目库(坏))
    const 视 = store.loadStoreJSON(sid)
    assert.ok(store.corruptSnapshots.has(视), JSON.stringify(坏[0]) + ' → 毒')
    写回应被拒(sid, 视)
  }
})

test('A：缺 text / text 纯空白 / text 类型错 → 毒快照 + 拒绝写回', () => {
  const 坏们 = [
    [{ id: 'a' }],
    [{ id: 'a', text: '' }],
    [{ id: 'a', text: '   \n  ' }],
    [{ id: 'a', text: 123 }],
    [{ id: 'a', text: null }],
  ]
  for (const 坏 of 坏们) {
    const sid = 's-notext-' + Math.random().toString(36).slice(2, 6)
    造坏文件(sid, 造坏条目库(坏))
    const 视 = store.loadStoreJSON(sid)
    assert.ok(store.corruptSnapshots.has(视), JSON.stringify(坏[0]) + ' → 毒')
    写回应被拒(sid, 视)
  }
})

test('A：重复 id（同文件内两条记录）→ 毒快照，不静默合并', () => {
  const sid = 's-dup-' + Math.random().toString(36).slice(2, 6)
  造坏文件(sid, 造坏条目库([
    { id: 'a', text: '第一条' },
    { id: 'a', text: '第二条，同 id 不同内容' },
  ]))
  const 视 = store.loadStoreJSON(sid)
  assert.ok(store.corruptSnapshots.has(视), '重复 id → 毒')
  写回应被拒(sid, 视)
})

test('A：关键字段类型错（importance/at/scope/evidence）→ 毒快照', () => {
  const 坏们 = [
    [{ id: 'a', text: 'x', importance: '高' }],
    [{ id: 'a', text: 'x', at: { 怪: 1 } }],
    [{ id: 'a', text: 'x', scope: 42 }],
    [{ id: 'a', text: 'x', evidence: '不是数组' }],
    [{ id: 'a', text: 'x', category: true }],
  ]
  for (const 坏 of 坏们) {
    const sid = 's-typo-' + Math.random().toString(36).slice(2, 6)
    造坏文件(sid, 造坏条目库(坏))
    const 视 = store.loadStoreJSON(sid)
    assert.ok(store.corruptSnapshots.has(视), JSON.stringify(坏[0]) + ' → 毒')
    写回应被拒(sid, 视)
  }
})

test('A：at 允许 null（/import/apply 写「没记时间」是合法语义）→ 不误判毒', () => {
  const sid = 's-atnull-' + Math.random().toString(36).slice(2, 6)
  造坏文件(sid, 造坏条目库([{ id: 'a', text: '导入的条目，没记住时间', at: null, category: 'event', importance: 0.5 }]))
  const 视 = store.loadStoreJSON(sid)
  assert.ok(!store.corruptSnapshots.has(视), 'at:null 不能判毒（否则插件自己导入的条目会把整个会话库读成空）')
  assert.equal(视.memories.length, 1)
  assert.equal(视.memories[0].at, null)
})

test('A：墓碑结构异常（缺 id / 非对象 / deletedAt 类型错或缺失）→ 毒快照', () => {
  const 坏们 = [
    [{ text: '坟没 id' }],
    [null],
    [{ id: 'a', deletedAt: 123n > 0 ? { 坏: true } : {} }],
    [{ id: 'a', text: '坟没删除时刻' }],
  ]
  for (const 坏 of 坏们) {
    const sid = 's-badtomb-' + Math.random().toString(36).slice(2, 6)
    造坏文件(sid, 造坏条目库([{ id: 'x', text: '活' }], 坏))
    const 视 = store.loadStoreJSON(sid)
    assert.ok(store.corruptSnapshots.has(视), JSON.stringify(坏[0]) + ' → 毒')
    写回应被拒(sid, 视)
  }
})

test('A：墓碑正常形状（带 deletedAt/撤销原因）不误伤', () => {
  const sid = 's-oktomb-' + Math.random().toString(36).slice(2, 6)
  造坏文件(sid, 造坏条目库([{ id: 'x', text: '活' }], [
    { id: 'gone', text: '删了', at: '2026-10-31T00:00:00Z', category: 'event', deletedAt: '2026-10-31T01:00:00Z', 撤销原因: '测试' },
  ]))
  const 视 = store.loadStoreJSON(sid)
  assert.ok(!store.corruptSnapshots.has(视), '正常墓碑不能判毒')
  assert.equal(视.deleted.length, 1)
})

test('A：老库条目缺 id/text 同样判损坏（保底校验，但不过度卡老字段）', () => {
  for (const 坏 of [[{ text: '没 id' }], [{ id: 'a', text: '' }]]) {
    const sid = 's-olditem-' + Math.random().toString(36).slice(2, 6)
    造坏文件(sid, JSON.stringify({ memories: 坏 }))
    const 视 = store.loadStoreJSON(sid)
    assert.ok(store.corruptSnapshots.has(视), '老库 ' + JSON.stringify(坏[0]) + ' → 毒')
    写回应被拒(sid, 视)
  }
  // 老库正常条目带杂字段（emotion 字符串等 1.3.7 形状）不误伤
  const sid2 = 's-oldok-' + Math.random().toString(36).slice(2, 6)
  造坏文件(sid2, JSON.stringify({
    memories: [{ id: 'a', text: '老记忆', emotion: 'happy', tags: 'x,y', importance: 0.5, 事实键: 'k' }],
    deleted: [{ id: 'gone', text: '坟', 撤销原因: '测试' }],
  }))
  const 视2 = store.loadStoreJSON(sid2)
  assert.ok(!store.corruptSnapshots.has(视2), '老库杂字段不能判毒')
})
