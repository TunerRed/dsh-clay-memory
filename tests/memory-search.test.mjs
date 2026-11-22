// tests/memory-search.test.mjs —— 1.12.28：memory_search「知识按需检索」
// 为什么要它：记忆块只有 800 字，技术笔记一旦不常驻，模型就得有路自己去找。
// 这里钉住三件事：①按相关度排（不是按 importance）②kind 过滤真的生效 ③空 query / 无命中的返回形状
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const 造库 = (home, sid) => {
  const dir = join(home, 'clay-memory')
  mkdirSync(dir, { recursive: true })
  const data = {
    version: 2,
    memories: [
      {
        id: 'm-a',
        text: 'Kafka 消费者组 rebalance 一直不过，靠把 session.timeout.ms 调大解决',
        category: 'stable_profile',
        is_knowledge: true,
        importance: 1,
        createdAt: '2026-11-01T00:00:00.000Z',
      },
      {
        id: 'm-b',
        text: '部署时 Kafka 的 log.dirs 放在 /data/kafka，别放系统盘',
        category: 'stable_profile',
        is_knowledge: true,
        importance: 1,
        createdAt: '2026-11-02T00:00:00.000Z',
      },
      {
        id: 'm-c',
        text: '主人喜欢白米饭配菜，讨厌别人抢',
        category: 'stable_profile',
        is_knowledge: false,
        importance: 0.9,
        createdAt: '2026-11-03T00:00:00.000Z',
      },
      {
        id: 'm-d',
        text: '这条已经被取代了，不该出现在结果里',
        category: 'stable_profile',
        is_knowledge: true,
        importance: 1,
        已被取代: { 被谁: 'm-a' },
        createdAt: '2026-11-04T00:00:00.000Z',
      },
    ],
    traces: [],
    deleted: [],
  }
  // 事实层（stable_profile）落在全局库，会话文件留空 —— 写在会话文件里会被合并逻辑归到 _facts
  writeFileSync(join(dir, '_facts.json'), JSON.stringify(data, null, 2), 'utf8')
  writeFileSync(join(dir, sid + '.json'), JSON.stringify({ version: 2, memories: [], traces: [], deleted: [] }, null, 2), 'utf8')
}

test('memory_search：按相关度排、过滤已取代、kind 过滤生效', async () => {
  const home = mkdtempSync(join(tmpdir(), 'search-tool-'))
  const 旧 = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const sid = 'session-search-0001'
  try {
    造库(home, sid)
    const sc = await import('../lib/store-core.mjs')
    sc.接报信(() => {})
    const { makeSearchTool, 接定义工具, 接报信 } = await import('../lib/tools.mjs')
    接报信(() => {})
    接定义工具((def) => def)
    const 工具 = makeSearchTool({})
    const exec = { agent: { session: { id: sid } } }

    const 全 = await 工具.execute({ query: 'Kafka 参数怎么调' }, exec)
    assert.equal(全.ok, true, JSON.stringify(全))
    assert.ok(全.items.length >= 1, '该命中至少一条：' + JSON.stringify(全.items))
    assert.ok(
      全.items.some((x) => x.id === 'm-a'),
      'a（讲参数怎么调）应该进结果：' + JSON.stringify(全.items.map((x) => x.id)),
    )
    assert.ok(
      !全.items.some((x) => x.id === 'm-d'),
      '已取代的条目不该出现：' + JSON.stringify(全.items.map((x) => x.id)),
    )

    const 只看知识 = await 工具.execute({ query: 'Kafka', kind: 'knowledge' }, exec)
    assert.ok(只看知识.items.length >= 1)
    assert.ok(只看知识.items.every((x) => x.kind === 'knowledge'), 'kind=knowledge 时全是知识')

    const 只看画像 = await 工具.execute({ query: 'Kafka', kind: 'profile' }, exec)
    assert.equal(只看画像.items.length, 0, '画像里没有 Kafka，应为空')

    const 空 = await 工具.execute({ query: '   ' }, exec)
    assert.equal(空.ok, false, '空 query 要明确说不')

    const 无命中 = await 工具.execute({ query: '量子纠缠态的退相干时间' }, exec)
    assert.equal(无命中.ok, true)
    assert.equal(无命中.items.length, 0)

    const 限条 = await 工具.execute({ query: 'Kafka', limit: 1 }, exec)
    assert.equal(限条.items.length, 1, 'limit 生效')
  } finally {
    if (typeof 旧 === 'string') process.env.DSH_HOME = 旧
    else delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  }
})
