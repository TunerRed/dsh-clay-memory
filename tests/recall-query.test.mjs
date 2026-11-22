// tests/recall-query.test.mjs —— recall 工具的查询口径（2026-11-15）
//
// 原来只有一句 `text.includes(q)`：拿整条 query 当**一个连续字符串**去原文里找。
// 实测事故：`fish-memory-dev 开发仓库 装机副本` 零命中，可三个词单独问都在，
// 主人当场问「是不是没分词」。recall 的定位是「列给我看」，不该被问法噎住。
//
// 现在的口径：
//   ① 整串能命中 → 只给整串命中的（精确查询行为一个字没变）
//   ② 整串不中 && query 里有空格 → 拆词，任一命中都算，命中词多的排前面
//   ③ query 是单个词且不中 → 空（跟原来一样）
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'recall-q-'))
process.env.DSH_HOME = home

const { loadCfg } = await import('../lib/cfg.mjs')
const names = await import('../lib/names.mjs')
names.接读配置(loadCfg)
const { makeRememberTool, makeRecallTool, 接定义工具, 接报信 } = await import('../lib/tools.mjs')
接定义工具((def) => def)
接报信(() => {})

const ctx = { agents: { list: () => [] }, interval: () => () => {}, on: () => {} }
const exec = { agent: { session: { id: 'session-recall-q1' } } }
const 记 = makeRememberTool(ctx)
const 找 = makeRecallTool(ctx)

const 塞 = async (text) => {
  const r = await 记.execute({ text, importance: 0.6 }, exec)
  assert.equal(r.ok, true, 'remember 失败：' + JSON.stringify(r))
}

const A = '开发仓库 装机副本 连着写的一句话'
const B = '开发仓库在 D:\\dev\\fish-memory-dev'
const C = '装机副本要重启桌面'

test('recall：整串能命中时只给整串命中的（精确查询不变）', async () => {
  await 塞(A)
  await 塞(B)
  await 塞(C)
  const r = await 找.execute({ query: '开发仓库 装机副本 连着写' }, exec)
  assert.deepEqual(
    r.items.map((x) => x.text),
    [A],
    '整串只出现在 A 里，B/C 只是拆开来能对上 —— 不该混进来',
  )
})

test('recall：整串不中时有空格就拆词兜底，命中词多的排前面', async () => {
  const r = await 找.execute({ query: '开发仓库 装机副本 重启' }, exec)
  const 文们 = r.items.map((x) => x.text)
  assert.equal(文们.length, 3, '三条各至少命中一个词')
  // A 命中「开发仓库」「装机副本」= 2；C 命中「装机副本」「重启」= 2；B 只有 1
  const 前两条 = 文们.slice(0, 2).sort()
  assert.deepEqual(前两条, [A, C].sort(), '两词命中的排在只命中一个词的前面')
  assert.equal(文们[2], B)
})

test('recall：单个关键词仍是纯子串筛，不中的仍然给空', async () => {
  const 中 = await 找.execute({ query: 'fish-memory-dev' }, exec)
  assert.deepEqual(中.items.map((x) => x.text), [B], '单词命中照旧')

  const 空 = await 找.execute({ query: '火星土豆' }, exec)
  assert.equal(空.items.length, 0, '单词不中 → 空，跟原来一样')
})

test('recall：拆词后一个都不中 → 空，不是全列', async () => {
  const r = await 找.execute({ query: '火星 土豆' }, exec)
  assert.equal(r.items.length, 0, '拆词兜底不许退化成「什么都给」')
})

after(() => {
  delete process.env.DSH_HOME
  rmSync(home, { recursive: true, force: true })
})
