import test from 'node:test'
import assert from 'node:assert/strict'

// 1.10.5（自检摘要）回归：这一轮记忆「有没有毛病」，一句话说给它自己听。
//   ① 正常时**一个字都不输出**（空注入在闲聊里是常态，天天喊狼来了等于没信息）；
//   ② 人家在问、却一条都没想起来 → 要提（这是最容易被编过去的场合）；
//   ③ 塞满上限 / 快吃满字数预算 → 要提（回答时别当成「我就只记得这些」）；
//   ④ 整句有 60 字硬上限。
//   这个文件不 import 任何宿主接口 → 不启动 DSH 也能跑。
const { 自检, 是问句, 自检上限, 按轮去重 } = await import('../lib/selfcheck.mjs')

test('自检：正常的一轮 → 什么都不说', () => {
  assert.equal(自检({ query: '今天好累', 选中: 2, 候选: 3, 字: 120, 骨架字: 80 }), '')
  assert.equal(自检({}), '')
  assert.equal(自检(null), '')
})

test('自检：人家在问、却一条都没想起来 → 要说', () => {
  const 甲 = 自检({ query: '我下周三要去哪来着？', 选中: 0, 候选: 0 })
  assert.ok(甲.indexOf('在问') >= 0)
  assert.ok(甲.indexOf('库里没有落得上的') >= 0)
  const 乙 = 自检({ query: '我们之前说什么来着', 选中: 0, 候选: 0, gate: { 信息量: 0.2, 门槛: 0.8 } })
  assert.ok(乙.indexOf('没去翻库') >= 0, '被问句门挡下要说清楚是「门」，不是「库里没有」')
})

test('自检：陈述句空注入不喊（闲聊里空注入是常态）', () => {
  assert.equal(自检({ query: '今天好累啊', 选中: 0, 候选: 0 }), '')
  assert.equal(自检({ query: '嗯', 选中: 0, 候选: 0, gate: { 信息量: 0 } }), '')
})

test('自检：塞满上限、还有没进来的 → 要说清楚剩几条', () => {
  const 话 = 自检({ query: '我以前说过什么', 选中: 6, 候选: 9, maxItems: 6, 字: 300 })
  assert.ok(话.indexOf('6 条上限') >= 0)
  assert.ok(话.indexOf('3 条没进来') >= 0)
  // 候选等于选中 = 没有更淡的，不该提
  assert.equal(自检({ query: '我以前说过什么', 选中: 6, 候选: 6, maxItems: 6, 字: 300 }), '')
})

test('自检：字数快吃满预算 → 要说（骨架也算在内）', () => {
  const 话 = 自检({ query: '随便聊聊', 选中: 4, 候选: 4, 字: 640, 骨架字: 80, 预算: 800 })
  assert.ok(话.indexOf('800 字预算') >= 0)
  // 刚好不到 85% 不喊
  assert.equal(自检({ query: '随便聊聊', 选中: 2, 候选: 2, 字: 300, 骨架字: 80, 预算: 800 }), '')
})

test('自检：整句有 60 字硬上限（目前的判据凑不满，但上限要守住）', () => {
  const 话 = 自检({
    query: '我下周三要去哪来着？',
    选中: 6,
    候选: 99999,
    maxItems: 6,
    字: 780,
    骨架字: 100,
    预算: 800,
  })
  assert.ok(话.length <= 自检上限, '整句不许超 ' + 自检上限)
  // 三条判据里「空注入」和「塞满上限」互斥，所以现实里最长约 50 字；
  // 截断那条路留给以后加判据时兜底（见 selfcheck.mjs 里的 '…）'）。
  assert.ok(话.indexOf('上限') >= 0 && 话.indexOf('预算') >= 0)
})

test('是问句：问号 / 疑问词 / 句尾吗呢嘛', () => {
  for (const q of ['真的？', '你说什么', '怎么弄的', '几点回来', '行吗', '那我呢', '在不在嘛']) {
    assert.equal(是问句(q), true, q)
  }
  for (const q of ['今天好累', '嗯', '', '我去吃饭了', '好的']) {
    assert.equal(是问句(q), false, q)
  }
})

// ---- 1.12.17：同一轮只喊一次 ----------------------------------------------
// 起因：真机 11544 条 trace 里 1103 条是同一句「快吃满 800 字预算」，且同一 turn 的
//   step 167/168/169 连着各喊一遍 —— 一条消息走多个 step，每个 step 都 recall 一次。
test('按轮去重：同一 turn 只喊一次，换 turn 再喊', () => {
  const 轮 = 按轮去重()
  assert.equal(轮.该喊('s1', 11), true)
  轮.喊了('s1', 11)
  // 同 turn 的后续 step 全部闭嘴
  assert.equal(轮.该喊('s1', 11), false)
  assert.equal(轮.该喊('s1', 11), false)
  // 下一条消息（turn 12）照样会喊
  assert.equal(轮.该喊('s1', 12), true)
})

test('按轮去重：会话之间互不影响', () => {
  const 轮 = 按轮去重()
  轮.喊了('s1', 5)
  assert.equal(轮.该喊('s1', 5), false)
  assert.equal(轮.该喊('s2', 5), true, '别的会话同样的 turn 号不受影响')
})

test('按轮去重：turn 缺失时一律放行，且不会把 undefined 记成已喊', () => {
  const 轮 = 按轮去重()
  assert.equal(轮.该喊('s1', undefined), true)
  轮.喊了('s1', undefined)
  assert.equal(轮.该喊('s1', 3), true, '没记成已喊过 3')
})

test('按轮去重：超过上限丢最老的会话（不会无限长）', () => {
  const 轮 = 按轮去重(2)
  轮.喊了('a', 1)
  轮.喊了('b', 1)
  轮.喊了('c', 1) // a 被挤掉
  assert.equal(轮.该喊('b', 1), false)
  assert.equal(轮.该喊('a', 1), true, 'a 已淘汰 → 重新放行（宁多喊一次）')
})
