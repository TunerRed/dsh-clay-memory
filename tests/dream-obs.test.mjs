// dream 的可观测性：「模型有正文但抠不出候选」不能记成「没找到规律」
//
// 背景（2026-11-21 真机铁证）：dream 连续三天「产出 0、被拦 0」，日志还打
// 「正常，料还没攒够」——实际是 1500 预算全被 reasoning 吃光、翻到 3000 后
// 正文写到 550 字符就截断、JSON 没闭合。抠候选 拿到 []、问题 空，账上就成了
// 0/0，跟「模型确实回了 []」长得一模一样，坏了三天没一个人发现。
// 这组测试盯的就是：坏掉时必须留下痕迹，正常回 [] 时不许误报。
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.DSH_HOME = process.env.DSH_HOME || 'G:/tmp/clay-dream-obs-home'
const { 归纳一次 } = await import('../lib/dream.mjs')
const { 接造消息, 接报信 } = await import('../lib/llm.mjs')

接造消息((x) => x)
接报信(() => {})

const 造ctx = (正文) => ({
  llm: {
    async *stream() {
      yield { type: 'text-delta', text: 正文 }
      yield { type: 'finish', reason: { kind: 'ok' } }
    },
  },
  get: () => null,
})
const agent = { options: { provider: 'deepseek-official', model: 'deepseek-flash' } }
const data = {
  memories: ['白饭', '泰拉瑞亚', '攒钱', 'Kafka', '游戏截图', '大肥鱼'].map((t, i) => ({
    id: 'm' + (i + 1),
    text: '主人的' + t,
    createdAt: '2026-11-' + String(10 + i).padStart(2, '0') + 'T10:00:00.000Z',
  })),
}

test('归纳一次：模型回纯文本（抠不出 JSON）→ 问题里必须留下痕迹', async () => {
  const r = await 归纳一次(造ctx('我看了看，觉得还没什么规律。'), agent, data)
  assert.equal(r.ok, true)
  assert.equal(r.候选.length, 0)
  assert.ok(
    r.问题.some((s) => String(s).includes('JSON 没抠出来')),
    '期望「JSON 没抠出来」，实际：' + JSON.stringify(r.问题),
  )
})

test('归纳一次：模型正常回 [] → 不许误报成 JSON 坏掉', async () => {
  const r = await 归纳一次(造ctx('[]'), agent, data)
  assert.equal(r.ok, true)
  assert.equal(r.候选.length, 0)
  assert.ok(
    !r.问题.some((s) => String(s).includes('JSON 没抠出来')),
    '真·没规律不该被记成 JSON 坏掉：' + JSON.stringify(r.问题),
  )
})

// 2026-11-21 第二步 c：截断容错。真机那次 3000 预算下正文写到第 550 个字符就断，
// 数组没闭合，旧代码 all-or-nothing 一条都救不回。现在逐条抠，断在最后一条就只丢
// 最后一条。但「救回 N 条」必须在账上看得见，不然跟「完整回了 N 条」分不清。
test('抠候选详细：数组没闭合 → 逐条救回前面完整的，状态 partial', async () => {
  const { 抠候选详细 } = await import('../lib/dream.mjs')
  const 截断 =
    '[{"text":"一","trigger":{"when":"a"},"evidence":["m1"]},' +
    '{"text":"二","trigger":{"when":"b"},"evidence":["m2"]},' +
    '{"text":"三","tri'
  const r = 抠候选详细(截断)
  assert.equal(r.状态, 'partial', '截断要判成 partial，实际：' + r.状态)
  assert.equal(r.候选.length, 2)
  assert.equal(r.候选[1].text, '二')
})

test('抠候选详细：正文里有花括号和转义引号 → 逐条抠不许切错', async () => {
  const { 抠候选详细 } = await import('../lib/dream.mjs')
  const 截断 = '[{"text":"他说\\"{白饭}\\"要加量","evidence":["m1"]},{"text":"断'
  const r = 抠候选详细(截断)
  assert.equal(r.状态, 'partial')
  assert.equal(r.候选.length, 1)
  assert.ok(
    String(r.候选[0].text).includes('{白饭}'),
    '字符串里的花括号该原样保留，实际：' + JSON.stringify(r.候选[0].text),
  )
})

test('归纳一次：截断只救回一部分 → 问题里必须记「只救回 N 条」', async () => {
  const 截断 =
    '[{"text":"技术改动先在测试实例验证","trigger":{"when":"改代码"},"evidence":["m1"]},' +
    '{"text":"排查要看可观测证据","trigger":{"when":"排错"},"evidence":["m2"]},' +
    '{"text":"被截断的第三'
  const r = await 归纳一次(造ctx(截断), agent, data)
  assert.equal(r.ok, true)
  assert.ok(
    r.问题.some((s) => String(s).includes('只救回 2 条')),
    '截断救了 2 条要显式记账，实际：' + JSON.stringify(r.问题),
  )
})
