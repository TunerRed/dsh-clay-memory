// 1.12.53：自动抽取的回声与问句闸门
//
// 起因（2026-11-18 真机）：用户聊口味随口说了四句，四条全被 auto-capture 收成记忆：
//   「真的吗？妈妈妈妈，我喜欢黑丝还是光腿？」        ← 在问，不是陈述
//   「如果光腿是大白饭，黑丝是卤肉饭，那白丝应该是我更喜欢吃的什么饭？」 ← 比喻
//   结果下一轮召回时这四条 P 0.344~0.351，把真答案（P 0.288）挤到最后一名。
//
// 这里钉住四件事：
//   ① 假设词是**整句**作用域（「如果…，我就去爬山」后半句不能被当成事实收）
//   ② 疑问判据只看句末，不裸匹配「还是/什么/哪/怎么」（那些词在陈述句里很正常）
//   ③ 子句阈值 4 不是 6（「我爱吃辣」只有 4 字，是黄金偏好记忆）
//   ④ 性质档（梦/虚构/假设）不能被「假设句一律丢」误杀
import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const 家 = mkdtempSync(join(tmpdir(), 'clay-echo-'))
process.env.DSH_HOME = 家
mkdirSync(join(家, 'clay-memory'), { recursive: true })

const 自动 = await import('../lib/auto-capture.mjs')
const { recall } = await import('../lib/scoring.mjs')
const { DEFAULT_POLICY } = await import('../lib/cfg.mjs')

const 天 = 86400000
const 现在 = 1794499200000

test('① 四句闲聊一条都不收（这次的真实 case）', () => {
  const 四句 = [
    '真的吗？妈妈妈妈，我喜欢黑丝还是光腿？',
    '光腿有什么不好的，光腿就像大白饭，黑丝是卤肉饭',
    '如果光腿是大白饭，黑丝是卤肉饭，那白丝应该是我更喜欢吃的什么饭？',
    '好吧，那我换个说法，我除了卤肉饭，还喜欢什么饭？',
  ]
  for (const s of 四句) {
    assert.equal(自动.该自动收(s), null, '不该收：' + s)
  }
})

test('② 假设词是整句作用域：「如果…我就去爬山」后半句也不能收', () => {
  // 只按子句切的话，后半句「我就去爬山」会被当成既定事实
  assert.equal(自动.该自动收('如果明天不下雨，我就去爬山'), null)
  assert.equal(自动.该自动收('万一服务器挂了，我就回滚'), null)
  // ⚠ 「假如/要是」走的是性质档（hypothesis），带「（假设）」标签渲染、不当事实念 ——
  //   这是 1.12.3 的设计，不是漏网。真正要拦的是「如果…就…」这类普通条件句。
  const 假如 = 自动.该自动收('假如换成周六，我就把时间空出来')
  assert.equal(假如 && 假如.档, 'nature')
})

test('③ 子句阈值 4：短偏好能收，碎词不放行', () => {
  // 4~5 字的黄金偏好记忆，不能因为短就丢
  assert.equal(自动.该自动收('我爱吃辣').档, 'strong')
  // 纯碎词不该收
  assert.equal(自动.该自动收('好吧'), null)
  assert.equal(自动.该自动收('喜欢'), null)
  // ⚠ 1.12.53 时的已知缺口：「不吃」不在 preference 正则里 → 「我不吃香菜」收不到。
  //   1.12.54 补掉了（否定式偏好 + 非「一X」数量词），这里从「该丢」翻成「该收」。
  assert.equal(自动.该自动收('我不吃香菜').档, 'strong', '1.12.54 起否定式偏好要能收')
})

test('④ 疑问只看句末：「我还是更喜欢喝冰美式」这类陈述不能被误杀', () => {
  const 陈述 = ['我还是更喜欢喝冰美式', '我也不知道怎么就特别喜欢猫']
  for (const s of 陈述) {
    assert.ok(自动.该自动收(s), '这是陈述，应该收：' + s)
  }
  // 句末带疑问语气的子句要跳过
  assert.equal(自动.是疑问子句('我喜欢黑丝还是光腿？'), true)
  assert.equal(自动.是疑问子句('我是不是该睡了'), false, '句中「是不是」不算疑问子句')
  assert.equal(自动.是疑问子句('我该睡了吗'), true)
})

test('⑤ 性质档不被误杀：梦/虚构/假设仍要收（带 nature 标签）', () => {
  const 梦 = 自动.该自动收('梦见舞台变成温室，我一直在找出口')
  assert.ok(梦, '梦必须能收')
  assert.equal(梦.档, 'nature')
  assert.equal(梦.性质, 'dream')

  const 假 = 自动.该自动收('假设你是只猫，你会干嘛')
  assert.ok(假, '假设档要收（渲染时标「（假设）」），不能被「假设句一律丢」杀了')
  assert.equal(假.档, 'nature')
})

test('⑥ 强反问整句丢', () => {
  assert.equal(自动.该自动收('难道我喜欢吃香菜很奇怪吗？'), null)
  assert.equal(自动.该自动收('为什么我喜欢的东西都这么贵？'), null)
  // 但普通疑问（不带强疑问词结构）走的是子句过滤，不是整句丢
  assert.ok(自动.该自动收('我喜欢吃辣，你觉得呢？'))
})

// ══════════════════════════════════════════════════════════════
// 召回侧：降权 / 门槛 / 回声 / 配额

function 造库(改) {
  const memories = [
    { id: 'xhs', text: '主人吃盖浇饭是西红柿鸡蛋派，卤肉也接受。', category: 'stable_profile', importance: 0.6, createdAt: 现在 - 3 * 天 },
    { id: 'echo1', text: '如果光腿是大白饭，黑丝是卤肉饭，那白丝应该是我更喜欢吃的什么饭', category: 'event', importance: 0.4, source: '自动抽取', createdAt: 现在 - 2 * 天 },
    { id: 'echo2', text: '光腿有什么不好的，光腿就像大白饭，黑丝是卤肉饭', category: 'event', importance: 0.4, source: '自动抽取', createdAt: 现在 - 2 * 天 },
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
const P分 = (r, id) => {
  const row = (r.scored || []).find((x) => String((x.m || x).id) === id)
  return row ? row.s.P : -1
}

test('⑦ 降权生效：自动抽取的条目 P 明显低于同一句的普通条目', () => {
  const 低 = recall(造库({ 自动抽取降权: 0.32, 自动抽取门槛: 0, 回声窗分钟: 0 }), '如果光腿是大白饭黑丝是卤肉饭，那白丝是我更喜欢吃的什么饭', 现在, 's1', null)
  const 不降 = recall(造库({ 自动抽取降权: 1, 自动抽取门槛: 0, 回声窗分钟: 0 }), '如果光腿是大白饭黑丝是卤肉饭，那白丝是我更喜欢吃的什么饭', 现在, 's1', null)
  const a = P分(低, 'echo2')
  const b = P分(不降, 'echo2')
  if (b > 0) assert.ok(a < b, `降权后 ${a} 应该小于不降权 ${b}`)
})

test('⑧ 出厂参数：降权 0.32 / 门槛 0.15 / 回声窗 15 分钟 / 配额 150 字 5 条', () => {
  // 回声窗的运行时行为在 打分() 里（createdAt 距今 < 回声窗分钟 → P=0），
  //   这一条只钉「出厂契约」：这些默认值是 Gemini 评审校准过的，别在后续重构里被悄悄改掉。
  assert.equal(DEFAULT_POLICY.自动抽取降权, 0.32)
  assert.equal(DEFAULT_POLICY.自动抽取门槛, 0.15)
  assert.equal(DEFAULT_POLICY.回声窗分钟, 15)
  assert.equal(DEFAULT_POLICY.自动抽取配额字, 150)
  assert.equal(DEFAULT_POLICY.自动抽取配额条, 5)
})

test('⑨ 门槛：降权后低于门槛直接判死', () => {
  const 库 = (改) => 造库({ 自动抽取降权: 0.1, 自动抽取门槛: 0.9, 回声窗分钟: 0, ...改 })
  const 死 = recall(库(), '如果光腿是大白饭黑丝是卤肉饭，那白丝是我更喜欢吃的什么饭', 现在, 's1', null)
  assert.equal(P分(死, 'echo1'), 0, '过不了门槛必须 P=0')
  const 活 = recall(库({ 自动抽取降权: 0.9, 自动抽取门槛: 0.01 }), '如果光腿是大白饭黑丝是卤肉饭，那白丝是我更喜欢吃的什么饭', 现在, 's1', null)
  assert.ok(P分(活, 'echo1') > 0, '降权轻、门槛低，P 该有值')
})

test('⑩ 配额：自动抽取的条目最多装 N 条（存量脏数据的安全网）', () => {
  const 库 = 造库({ 自动抽取配额条: 1, 自动抽取配额字: 400, 自动抽取降权: 1, 自动抽取门槛: 0, 回声窗分钟: 0 })
  const r = recall(库, '光腿 大白饭 卤肉饭', 现在, 's1', null)
  const 装进来的自动 = (r.selected || []).filter((x) => (x.m || x).source === '自动抽取')
  assert.ok(装进来的自动.length <= 1, `配了最多 1 条，实际装了 ${装进来的自动.length} 条`)
})

test('⑪ 配额 0 = 不限（回到 1.12.52 的行为）', () => {
  const 库 = 造库({ 自动抽取配额条: 0, 自动抽取配额字: 0, 自动抽取降权: 1, 自动抽取门槛: 0, 回声窗分钟: 0 })
  const r = recall(库, '光腿 大白饭 卤肉饭', 现在, 's1', null)
  assert.ok(r.selected, '不崩')
})
