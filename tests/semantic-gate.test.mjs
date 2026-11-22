// 1.12.42（P1-1 补洞）：语义放行 + 查询清洗
//
// 起因（2026-11-16 真机验收）：主库 458 条里「还记得我喜欢吃什么吗」召不回 ——
//   原来语义只做 RRF 重排，而重排对象是**已经过了 C 门槛**的 picked，C=0 的条目
//   连候选池都进不去。所以「换个说法就召不回」这个 P1-1 的核心场景一条都没覆盖。
//
// 这里钉住三件事：
//   ① 查询清洗：元话语（还记得/你知道/我说过）要从编码输入里剥掉，但剥太狠要退回原文
//   ② 语义放行：C=0 + 语义排前 N + 跟问句有弱词面重叠 → 允许带进 1 条
//   ③ 不放水：无弱重叠的无关问句一条都不放（实测 6 句无关话曾被塞 5 条噪声）
import { test } from 'node:test'
import assert from 'node:assert'

const { recall } = await import('../lib/scoring.mjs')
const { DEFAULT_POLICY } = await import('../lib/cfg.mjs')
const { 清洗查询 } = await import('../lib/embed.mjs')

const 天 = 86400000
const 现在 = 1794499200000

// 造一个小库：一条真答案 + 几条「什么都能沾一点」的泛化条目（真机里就是它们抢前排）
function 造库(改) {
  const memories = [
    { id: 'xhs', text: '主人吃盖浇饭是西红柿鸡蛋派，卤肉也接受。', category: 'stable_profile', importance: 0.6, createdAt: 现在 - 3 * 天 },
    { id: 'time', text: '主人提醒：说时间前要先看当前采样时刻，别把中午说成晚上。', category: 'stable_profile', importance: 0.6, createdAt: 现在 - 2 * 天 },
    { id: 'safe', text: '主人评估外部插件时先看安全面，再看许可和迁移成本。', category: 'stable_profile', importance: 0.5, createdAt: 现在 - 4 * 天 },
    { id: 're', text: '正则类规则必须用真实语料校准，首版误报率很高。', category: 'stable_profile', importance: 0.5, createdAt: 现在 - 5 * 天 },
  ]
  return {
    memories,
    policy: { ...DEFAULT_POLICY, queryGate: 0, factsMax: 0, factsAlwaysTopN: 0, maxItems: 6, maxChars: 3000, ...(改 || {}) },
  }
}

const 选中 = (r) => (r.selected || []).map((x) => x.m || x).map((m) => String(m.id))
const 分 = (r, id) => {
  const row = (r.scored || []).find((x) => String((x.m || x).id) === id)
  return row ? row.s.C : -1
}

test('① 查询清洗：元话语剥掉，正文不动', () => {
  assert.equal(清洗查询('还记得我喜欢吃什么吗'), '我喜欢吃什么吗')
  assert.equal(清洗查询('你知道我的笔记本是什么型号吗'), '我的笔记本是什么型号吗')
  assert.equal(清洗查询('我说过我显卡风扇响吗'), '我显卡风扇响吗')
  assert.equal(清洗查询('我平时玩什么游戏'), '我平时玩什么游戏')
  assert.equal(清洗查询('Kafka 宕机会丢消息吗'), 'Kafka 宕机会丢消息吗')
})

test('② 查询清洗：剥完太短就退回原文（别把真问句剥坏）', () => {
  assert.equal(清洗查询('记得带伞吗'), '记得带伞吗') // 剥成「带伞吗」只剩 3 字 → 退回
  assert.equal(清洗查询('记得'), '记得')
  assert.equal(清洗查询(''), '')
  assert.equal(清洗查询(null), '')
})

test('③ 语义放行：词面零证据、语义靠前、有弱重叠 → 带一条进来', () => {
  const data = 造库()
  const q = '还记得我喜欢吃什么吗'
  const 词面 = recall(data, q, 现在, 's1', null)
  assert.equal(分(词面, 'xhs'), 0, '这条必须词面零证据，否则测的不是放行')
  assert.deepEqual(选中(词面), [], '纯词面一条都不该给')

  // 语义：西红柿条排第 1，后面几条是泛化条目
  const 语义 = new Map([['xhs', 0.463], ['time', 0.42], ['safe', 0.41], ['re', 0.40]])
  const r = recall(data, q, 现在, 's1', null, 语义)
  assert.deepEqual(选中(r), ['xhs'])
  const row = (r.selected || [])[0]
  assert.equal(row.语义放行, true, '放行进来的要打标记，设置页才看得出来')
  assert.equal(row.omission, null, '放行的不算「被筛掉」')
})

test('④ 语义放行：无关问句（跟任何条目都没有共同实词）一条都不放', () => {
  const data = 造库()
  for (const q of ['今天天气怎么样', '在吗', '你好呀', '晚安']) {
    const 语义 = new Map([['xhs', 0.45], ['time', 0.44], ['safe', 0.43], ['re', 0.42]])
    const r = recall(data, q, 现在, 's2', null, 语义)
    assert.deepEqual(选中(r), [], `「${q}」不该放行任何条目`)
  }
})

test('⑤ 语义放行：纯数字不算弱重叠', () => {
  const data = 造库()
  const 语义 = new Map([['xhs', 0.5], ['time', 0.4], ['safe', 0.3], ['re', 0.2]])
  // 「1+1 等于几」跟哪条都没有实词交集；「几」「等」都不在条目里
  const r = recall(data, '1+1 等于几', 现在, 's3', null, 语义)
  assert.deepEqual(选中(r), [])
})

test('⑥ 语义放行可关：上限设 0 就回到 1.12.41 的行为', () => {
  const data = 造库({ 语义放行上限: 0 })
  const 语义 = new Map([['xhs', 0.463], ['time', 0.42], ['safe', 0.41], ['re', 0.40]])
  const r = recall(data, '还记得我喜欢吃什么吗', 现在, 's4', null, 语义)
  assert.deepEqual(选中(r), [])
})

test('⑦ 语义放行名次：排在 N 名之外的语义条目不会被放行', () => {
  const data = 造库({ 语义放行名次: 2 })
  // 西红柿条排第 3（三条泛化条目分都比它高），名次上限 2 → 不该放
  const 语义 = new Map([['time', 0.6], ['safe', 0.55], ['xhs', 0.463], ['re', 0.4]])
  const r = recall(data, '还记得我喜欢吃什么吗', 现在, 's5', null, 语义)
  assert.deepEqual(选中(r), [])
})

test('⑧ 语义放行：词面已有证据的条目不重复放行', () => {
  const data = 造库()
  // 这条是 event 类（会走事件队）；stable_profile 走的是常驻层，测不出「重复放行」
  data.memories.push({ id: 'ev1', text: '主人上次说想学做西红柿炒蛋。', category: 'event', importance: 0.5, createdAt: 现在 - 天 })
  const q = '西红柿炒蛋怎么做'
  const 词面 = recall(data, q, 现在, 's6', null)
  assert.ok(分(词面, 'ev1') > 0, '这句词面必须能命中，否则测的不是「不重复放行」')
  assert.ok(选中(词面).includes('ev1'), '词面命中就该正常进队')
  const 语义 = new Map([['ev1', 0.9], ['xhs', 0.5], ['time', 0.4], ['safe', 0.3], ['re', 0.2]])
  const r = recall(data, q, 现在, 's6', null, 语义)
  const ids = 选中(r)
  assert.equal(ids.filter((x) => x === 'ev1').length, 1, 'ev1 只该出现一次')
  const row = (r.selected || []).find((x) => String((x.m || x).id) === 'ev1')
  assert.equal(row.语义放行, undefined, '它是词面命中的，不该被标成语义放行')
  assert.ok(!ids.includes('xhs'), '西红柿鸡蛋派跟「炒蛋」只有「西红柿」一个词沾边，名次不够就不该被捞')
})

// ⭐ 第二轮（换说法验收）补的：RRF 里语义那一侧的系数
//   12 句换说法实测：系数 1 中 4 句、1.5 起中 5 句、再往上饱和；
//   漏掉的 8 句里 7 句语义分是全库第 1 —— 问题是词面名次权重过大，不是识别不行。
test('⑨ 语义权重：默认 1.5，取值烂掉也不崩', () => {
  assert.equal(DEFAULT_POLICY.语义权重, 1.5, '默认值就是实测出来的甜点，别随手改')
  assert.ok(DEFAULT_POLICY.语义权重 >= 1, '小于 1 等于打压语义通道，没有这个需求')
  const data = 造库()
  const 语义 = new Map([['xhs', 0.9], ['time', 0.5], ['safe', 0.3], ['re', 0.2]])
  for (const 坏 of ['abc', -5, NaN, null, undefined]) {
    const r = recall({ ...data, policy: { ...data.policy, 语义权重: 坏 } }, '西红柿', 现在, 's9', null, 语义)
    assert.ok(Array.isArray(r.selected), `语义权重=${String(坏)} 时 recall 不能崩`)
  }
})

test('⑩ 语义权重：调大以后「词面弱、语义强」的条目位置往前挪', () => {
  const data = 造库()
  const q = '西红柿鸡蛋派'
  // xhs 词面就命中（C>0）；ev1 词面只有「西红柿」一点边，靠语义才有优势
  data.memories.push({ id: 'ev1', text: '西红柿炒蛋要先炒蛋再放西红柿。', category: 'event', importance: 0.5, createdAt: 现在 - 天 })
  const 语义 = new Map([['ev1', 0.95], ['xhs', 0.31], ['time', 0.2], ['safe', 0.1], ['re', 0.1]])
  const 位置 = (权重) => {
    const r = recall({ ...data, policy: { ...data.policy, 语义权重: 权重 } }, q, 现在, 's10', null, 语义)
    return 选中(r).indexOf('ev1')
  }
  const 低 = 位置(1)
  const 高 = 位置(2)
  assert.ok(低 >= 0 && 高 >= 0, '两次都该出现在选中列表里，否则这条测试没测到东西')
  assert.ok(高 <= 低, `语义权重调大后 ev1 该往前挪（1 → 第 ${低}，2 → 第 ${高}）`)
})

// ⭐ 第三轮（1.12.44）：词面「有零碎证据但没过门槛」（0 < C < threshold）也该走放行。
//   起因：「关进程的脚本会把自己弄死是为啥」目标条 C=0.193、语义全库第 1、跟问句共享
//   「脚本/会/自己」三个词，却因为 C>0 被原条件 `!(C > 0)` 挡在放行之外，落成 below_threshold。
//   放宽后「1+1 等于几」多塞进一条讲调参的记忆（C=0.306，只靠一个词沾上），
//   所以对这类候选加了一道双词门槛：词面已经给过一点分还没过线，说明这点证据很虚。
test('⑪ 语义放行：证据不足（0<C<门槛）但两词重叠 + 语义靠前 → 放行', () => {
  const data = 造库({ threshold: 0.95 })
  const q = '西红柿鸡蛋怎么吃'
  const 语义 = new Map([['xhs', 0.62], ['time', 0.4], ['safe', 0.35], ['re', 0.3]])
  const 词面 = recall(data, q, 现在, 's10', null)
  const c = 分(词面, 'xhs')
  assert.ok(c > 0 && c < 0.95, `这条要有零碎证据但没过门槛，实际 C=${c}`)
  assert.deepEqual(选中(词面), [], '纯词面不该给')
  const r = recall(data, q, 现在, 's10', null, 语义)
  assert.ok(选中(r).includes('xhs'), '两词重叠 + 语义第 1 该放行')
})

test('⑫ 语义放行：证据不足且只有一词重叠 → 不放（防「1+1 等于几」那类沾边）', () => {
  const data = 造库({ threshold: 0.95 })
  const q = '西红柿哪家强'
  const 语义 = new Map([['xhs', 0.62], ['time', 0.4], ['safe', 0.35], ['re', 0.3]])
  const 词面 = recall(data, q, 现在, 's11', null)
  const c = 分(词面, 'xhs')
  assert.ok(c > 0 && c < 0.95, `要有一词证据但没过门槛，实际 C=${c}`)
  const r = recall(data, q, 现在, 's11', null, 语义)
  assert.deepEqual(选中(r), [], '只有一个词沾边不该放行')
})
