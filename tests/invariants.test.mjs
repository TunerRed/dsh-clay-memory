// 1.12.30 静默失败回归：把「不报错但结果错了」的几类钉住
//   ① 双份实现漂移：活跃度结算只剩一份，读路径默认必须与旧读路径逐位相等
//   ② 写路径的两条历史特判（stable_profile 恒 1、只认显式锚）不能被顺手改掉
//   ③ 参数越界：fitPolicy 必须把任何手改值收回规格范围
//   ④ 预算按字数：maxChars 是硬上限，不能因为「条数没到」就放行
import { test } from 'node:test'
import assert from 'node:assert'

const { 鲜活度, 结算活跃度, recall } = await import('../lib/scoring.mjs')
const { DEFAULT_POLICY, fitPolicy, POLICY_SPEC } = await import('../lib/cfg.mjs')

const 天 = 86400000
const 现在 = 1794499200000

test('① 读路径：鲜活度 与 结算活跃度 默认参数逐位相等', () => {
  const 样 = [
    { text: 'a', category: 'event', importance: 0.5 },
    { text: 'b', category: 'stable_profile', importance: 1 },
    { text: 'c', category: 'event', importance: 0.2, at: 现在 - 45 * 天 },
    { text: 'd', category: 'workspace', importance: 0.8, createdAt: 现在 - 7 * 天 },
    { text: 'e', category: 'event', activationAnchor: 现在 - 3 * 天, activation: 0.7 },
    { text: 'f', category: 'event' },
  ]
  for (const m of 样) {
    assert.equal(结算活跃度(m, DEFAULT_POLICY, 现在), 鲜活度(m, DEFAULT_POLICY, 现在), m.text)
  }
})

test('② 写路径：stable_profile 恒 1、无显式锚取常数（这两条是历史行为，别丢）', () => {
  const 库 = { ...DEFAULT_POLICY, unknownActivation: 0.5 }
  const 稳定 = { text: 's', category: 'stable_profile', importance: 0.8 }
  // 读路径取 unknownActivation（0.5），写路径必须钉在 1
  assert.equal(鲜活度(稳定, 库, 现在), 0.5)
  assert.equal(结算活跃度(稳定, 库, 现在, { 稳定值: 1, 只认显式锚: true }), 1)

  const 只有创建时间 = { text: 'c', category: 'event', importance: 0.5, createdAt: 现在 - 60 * 天 }
  // 读路径按 createdAt 衰减；写路径只认显式锚，拿不到就取常数
  assert.ok(鲜活度(只有创建时间, 库, 现在) < 1)
  assert.equal(结算活跃度(只有创建时间, 库, 现在, { 稳定值: 1, 只认显式锚: true }), 0.5)
})

test('③ 参数越界：任何手改值都被收回规格范围', () => {
  const 规格 = new Map(POLICY_SPEC.map((s) => [s.key, s]))
  const 乱填 = { ...DEFAULT_POLICY }
  for (const s of POLICY_SPEC) {
    乱填[s.key] = Number(s.max) + 1000
  }
  乱填.threshold = -3
  乱填.maxItems = 0
  const r = fitPolicy(乱填, DEFAULT_POLICY)
  for (const s of POLICY_SPEC) {
    const 值 = Number(r.policy[s.key])
    assert.ok(值 >= Number(s.min) && 值 <= Number(s.max), `${s.key} 越界：${值}`)
  }
  assert.ok(规格.size > 0)
})

test('④ 预算按字数：条数没到上限，字数到了也要截', () => {
  // 造 4 条各 ~200 字的高相关记忆 + 6 条无关条目。
  // 加无关条目是为了把词面稀有度抬起来 —— 如果全库每条都含「泰拉瑞亚」，稀有度会算成 0，一条都召不回来。
  const 长文 = (i) => `泰拉瑞亚挖矿效率提升的技巧第${i}条：` + '用镐子一路向下挖到地狱，路上顺手敲掉所有罐子，'.repeat(8)
  const 无关 = ['主人喜欢大白饭', '今天天气不错', '周五要交周报', '系统提示要简洁', 'B站视频挑短的', '书架该整理了']
    .map((t, i) => ({ id: 'x' + i, text: t + '。'.repeat(20), category: 'stable_profile', importance: 0.5, createdAt: 现在 - i * 天 }))
  const memories = [0, 1, 2, 3]
    .map((i) => ({ id: 'm' + i, text: 长文(i), category: 'stable_profile', importance: 0.9, is_knowledge: false, createdAt: 现在 - i * 天 }))
    .concat(无关)
  const data = { memories, policy: { ...DEFAULT_POLICY, maxChars: 800, factsMax: 6, queryGate: 0 } }
  const r = recall(data, '泰拉瑞亚怎么挖矿效率最高', 现在, 's-budget')
  const 字 = r.selected.reduce((n, x) => n + String(x.m.text || '').length, 0)
  assert.ok(字 <= 800, `注入 ${字} 字，超了 800 预算`)
  assert.ok(r.selected.length >= 1, '至少得进去一条')
  // 4 条 × 201 字 = 804 > 800：第 4 条必须因为预算被挡，而不是因为条数
  const 被预算挡的 = r.scored.filter((x) => x.omission === 'budget')
  assert.equal(被预算挡的.length, 1, '第 4 条应该标 budget，不是 limit')
})

// ⭐ 1.12.33：首条不再无条件进 —— 一条就超过 maxChars 的老笔记不许硬塞进来，
//   宁可这轮少它一条（后面的短条目照常填），也不能突破字数硬边界。
//   ⚠ 1.12.45：这条改成**显式关掉单条注入上限**（= 回到 1.12.44 行为）才成立。
//   开了上限以后超长条会被截到 300 字进来，那是有意的改进行为 —— 见 ⑤b。
test('⑤ 单条自己就超预算（关掉单条上限时）：首条也不能硬塞进去', () => {
  const 巨长 = '泰拉瑞亚挖矿效率提升：' + '用镐子一路向下挖到地狱，路上顺手敲掉所有罐子，'.repeat(40)
  assert.ok(巨长.length > 800, '样本得真的超 800 字')
  // 同样要掺无关条目把稀有度抬起来，否则 3 条里 3 条都含「泰拉瑞亚」→ 稀有度 0 → C=0
  const 无关 = ['主人喜欢大白饭', '今天天气不错', '周五要交周报', '系统提示要简洁', 'B站视频挑短的', '书架该整理了']
    .map((t, i) => ({ id: 'x' + i, text: t + '。'.repeat(20), category: 'stable_profile', importance: 0.5, createdAt: 现在 - i * 天 }))
  const memories = [
    { id: 'huge', text: 巨长, category: 'stable_profile', importance: 1, is_knowledge: false, createdAt: 现在 },
    { id: 'a', text: '泰拉瑞亚挖矿效率提升：先搭平台再往下挖。', category: 'stable_profile', importance: 0.9, is_knowledge: false, createdAt: 现在 - 天 },
    { id: 'b', text: '泰拉瑞亚挖矿效率：带够火把绳子。', category: 'stable_profile', importance: 0.8, is_knowledge: false, createdAt: 现在 - 2 * 天 },
  ].concat(无关)
  const data = { memories, policy: { ...DEFAULT_POLICY, maxChars: 800, factsMax: 6, factsAlwaysTopN: 0, queryGate: 0, 单条注入上限: 0 } }
  const r = recall(data, '泰拉瑞亚怎么挖矿效率最高', 现在, 's-huge')
  const 字 = r.selected.reduce((n, x) => n + String(x.m.text || '').length, 0)
  assert.ok(字 <= 800, `注入 ${字} 字，首条被硬塞了`)
  assert.ok(!r.selected.some((x) => x.m.id === 'huge'), '超长的首条不该进 selected')
  const 那条 = r.scored.find((x) => x.m.id === 'huge')
  assert.equal(那条 && 那条.omission, 'budget', '超长首条要标 budget，不是静默丢掉')
  assert.ok(r.selected.length >= 1, '后面装得下的短条目照常进，不该整轮空掉')
})

// ⭐ 1.12.45（预算治理 b）：开了单条上限以后，同一条超长笔记**应该进来**——
//   截到 300 字送进上下文，比「因为它太长所以永远进不来」有用得多。
//   这是有意的行为改变，所以单独立一条测试钉住，别让后人当成回归又给改回去。
test('⑤b 开着单条上限时：超长首条被截进来，预算仍不突破', () => {
  const 巨长 = '泰拉瑞亚挖矿效率提升：' + '用镐子一路向下挖到地狱，路上顺手敲掉所有罐子，'.repeat(40)
  const 无关 = ['主人喜欢大白饭', '今天天气不错', '周五要交周报', '系统提示要简洁', 'B站视频挑短的', '书架该整理了']
    .map((t, i) => ({ id: 'x' + i, text: t + '。'.repeat(20), category: 'stable_profile', importance: 0.5, createdAt: 现在 - i * 天 }))
  const memories = [
    { id: 'huge', text: 巨长, category: 'stable_profile', importance: 1, is_knowledge: false, createdAt: 现在 },
    { id: 'a', text: '泰拉瑞亚挖矿效率提升：先搭平台再往下挖。', category: 'stable_profile', importance: 0.9, is_knowledge: false, createdAt: 现在 - 天 },
  ].concat(无关)
  const data = { memories, policy: { ...DEFAULT_POLICY, maxChars: 800, factsMax: 6, factsAlwaysTopN: 0, queryGate: 0 } }
  const r = recall(data, '泰拉瑞亚怎么挖矿效率最高', 现在, 's-huge-on')
  // 预算按**真正注入的文本**算，不是按库里全条算
  const 字 = r.selected.reduce(
    (n, x) => n + String(x.注入文本 !== undefined ? x.注入文本 : x.m.text || '').length,
    0,
  )
  assert.ok(字 <= 800, `注入 ${字} 字，超了 800 预算`)
  const 那条 = r.selected.find((x) => x.m.id === 'huge')
  assert.ok(那条, '截断后这条该能进来，不该再被 budget 挡住')
  assert.ok(那条.注入文本 && 那条.注入文本.length <= DEFAULT_POLICY.单条注入上限, '注入文本要截到上限以内')
  assert.equal(那条.m.text, 巨长, '库里存的仍是全条，只有注入时变短')
})

