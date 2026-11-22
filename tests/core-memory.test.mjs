import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// 骨架层（_core.json）回归：2026-11-04 决议四。
//   数据在 $DSH_HOME/clay-memory/_core.json，不进插件包；
//   核心画像（core: true）最多 3 条，其余进「长期背景」。
const home = fs.mkdtempSync(join(tmpdir(), 'fish-core-'))
process.env.DSH_HOME = home
const { 读骨架, render骨架, 骨架文件 } = await import('../lib/core-memory.mjs')
const directory = join(home, 'clay-memory')
fs.mkdirSync(directory, { recursive: true })
const path = join(directory, '_core.json')

test('读骨架：正常文件返回条目', () => {
  fs.writeFileSync(path, JSON.stringify({ version: 1, items: [
    { id: 'a', content: '第一条' },
    { id: 'b', content: '  ' },
    { id: 'c', content: '第二条' },
  ] }))
  const items = 读骨架(path)
  assert.equal(items.length, 2, '空白 content 被过滤')
  assert.equal(items[0].id, 'a')
})

test('读骨架：文件不存在 / JSON 坏 / items 非数组 → 空数组', () => {
  assert.deepEqual(读骨架(join(home, 'nope.json')), [])
  fs.writeFileSync(path, 'not json{')
  assert.deepEqual(读骨架(path), [])
  fs.writeFileSync(path, JSON.stringify({ version: 1, items: 'oops' }))
  assert.deepEqual(读骨架(path), [])
})

test('render骨架：核心画像在前（最多 3 条），其余进长期背景', () => {
  const items = [
    { core: true, content: '核心A' },
    { core: true, content: '核心B' },
    { core: true, content: '核心C' },
    { content: '普通一' },
    { content: '普通二' },
  ]
  const out = render骨架(items)
  assert.match(out, /【核心画像】/)
  assert.match(out, /【长期背景】/)
  assert.match(out, /核心A/)
  assert.match(out, /核心B/)
  // 2026-11-18（1.12.48）：上限 2 → 3。真库里有 3 条 core:true，只取 2 会让第 3 条
  //（关系那一段）永远进不来 —— 实测渲染里就是缺它。这里改成 3 并断言它出现。
  assert.match(out, /核心C/, '核心画像最多 3 条')
  assert.match(out, /普通一/)
  assert.ok(out.indexOf('核心A') < out.indexOf('普通一'), '核心在前')
})

test('render骨架：核心画像第 4 条照样被挡在外面（上限仍是硬的）', () => {
  const items = [
    { core: true, content: '核心A' },
    { core: true, content: '核心B' },
    { core: true, content: '核心C' },
    { core: true, content: '核心D' },
  ]
  const out = render骨架(items)
  assert.doesNotMatch(out, /核心D/, '第 4 条 core 不进核心画像')
})

test('render骨架：空骨架返回空串', () => {
  assert.equal(render骨架([]), '')
  assert.equal(render骨架(null), '')
})

test('骨架文件：指向 $DSH_HOME/clay-memory/_core.json', () => {
  assert.equal(骨架文件(), join(home, 'clay-memory', '_core.json'))
})

// ⭐ 1.10.3 F6：骨架独立字数预算（2026-11-19 起为 maxChars 的 60%），溢出按 importance 截断
const { 骨架预算 } = await import('../lib/core-memory.mjs')

test('骨架预算：maxChars 的 60%，缺省 800 → 480，最低 80', () => {
  assert.equal(骨架预算({ maxChars: 800 }), 480)
  assert.equal(骨架预算({ maxChars: 1000 }), 600)
  assert.equal(骨架预算({ maxChars: 200 }), 120, '极小上限也别把骨架饿死')
  assert.equal(骨架预算(null), 480, '没传 policy 用默认 800')
})

test('render骨架：超预算时按 importance 从高到低留，整条丢不切半句', () => {
  const items = [
    { core: true, content: '核心一', importance: 0.9 },
    { content: '低优先的一条', importance: 0.1 },
    { content: '高优先的一条', importance: 0.8 },
    { content: '中等的一条', importance: 0.5 },
  ]
  // 预算只够：核心一(3) + 高优先(6) + 中等(5) 之后放不下低优先(7)
  const out = render骨架(items, 15)
  assert.match(out, /核心一/)
  assert.match(out, /高优先的一条/)
  assert.doesNotMatch(out, /低优先的一条/, '超预算的低优先条目要丢')
})

test('render骨架：核心画像永远不因预算丢；不给预算 = 不截断（老行为）', () => {
  const items = [
    { core: true, content: '核心', importance: 0 },
    { content: '很长很长很长很长很长很长很长很长很长很长的一条', importance: 0 },
  ]
  const 紧 = render骨架(items, 5)
  assert.match(紧, /核心画像/)
  assert.doesNotMatch(紧, /很长很长/)
  const 松 = render骨架(items)
  assert.match(松, /很长很长/, '不给字数上限时保持原来的全量行为')
})
