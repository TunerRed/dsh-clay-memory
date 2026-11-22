// 模式层（dream 的产物）—— 四条硬约束 + 状态机 + 条件路由
//
// 这组测试盯着的是「别让猜测变成事实」：
//   · 猜动机的话必须拒收
//   · 一天里说了四遍的话不许算规律
//   · candidate 不许进 prompt
//   · 被纠正两次自动打入冷宫
import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const 家 = mkdtempSync(join(tmpdir(), 'clay-pattern-'))
process.env.DSH_HOME = 家
mkdirSync(join(家, 'clay-memory'), { recursive: true })

const P = await import('../lib/patterns.mjs')

const 合法 = {
  text: '当他说累/烦的时候，倾向于想先被接一句再谈正事；建议先共情一句再问要不要方案',
  trigger: { intent: 'life', keywords: ['累', '烦'] },
  evidence: ['m1', 'm2', 'm3'],
  evidenceDates: ['2026-11-01', '2026-11-05'],
}

test('① 动机归因必须拒收（证据只能证明「他做了」，证不了「他为什么做」）', () => {
  const r = P.校验模式({ ...合法, text: '当加班时他其实想找人撒娇，应该哄他' })
  assert.equal(r.ok, false)
  assert.ok(r.问题.some((x) => x.includes('动机归因')), '要明确指出是动机归因：' + r.问题.join('|'))
})

test('② 三段式缺一段就不收', () => {
  assert.equal(P.校验模式({ ...合法, text: '他喜欢晚上聊游戏' }).ok, false, '缺触发条件')
  assert.equal(P.校验模式({ ...合法, text: '当晚上累了的时候，建议先共情' }).ok, false, '缺观测规律')
  assert.equal(P.校验模式({ ...合法, text: '当晚上累了的时候，他倾向于聊游戏' }).ok, false, '缺交互策略')
})

test('③ 证据必须 ≥3 条且跨 ≥2 个日期（同一天连说四遍不算规律）', () => {
  assert.equal(P.校验模式({ ...合法, evidence: ['m1', 'm2'] }).ok, false, '两条证据不够')
  const 同日 = P.校验模式({ ...合法, evidenceDates: ['2026-11-01', '2026-11-01'] })
  assert.equal(同日.ok, false, '同一天的两条不算跨天')
  assert.ok(同日.问题.some((x) => x.includes('日期')))
})

test('④ trigger 一个路由条件都没有就收不了（没法做条件注入）', () => {
  const r = P.校验模式({ ...合法, trigger: {} })
  assert.equal(r.ok, false)
  assert.ok(r.问题.some((x) => x.includes('路由条件')))
})

test('⑤ 落库一律 candidate，不进注入；升级成 tentative 后才参与', () => {
  const 加 = P.加模式(合法)
  assert.ok(加.ok, 加.问题 && 加.问题.join('|'))
  const 条 = P.读模式().patterns.find((p) => p.id === 加.id)
  assert.equal(条.status, 'candidate')

  assert.equal(P.取匹配模式('life', '今天好累', new Date('2026-11-18T23:00:00')), null, 'candidate 不许进注入')

  P.改状态(加.id, 'tentative', '人工看过')
  const 中 = P.取匹配模式('life', '今天好累', new Date('2026-11-18T23:00:00'))
  assert.ok(中, 'tentative 后应该能命中')
  assert.equal(中.id, 加.id)
})

test('⑥ 同一条候选重复给，合并证据而不是加两条', () => {
  const 前 = P.读模式().patterns.length
  const r = P.加模式({ ...合法, evidence: ['m9'], evidenceDates: ['2026-11-10'] })
  assert.ok(r.ok)
  assert.equal(r.合并, true, '正文前 40 字相同就该合并')
  assert.equal(P.读模式().patterns.length, 前, '条数不该增加')
  const 条 = P.读模式().patterns.find((p) => p.id === r.id)
  assert.ok(条.evidence.includes('m9'), '证据要并进来')
})

test('⑦ intent 是硬过滤：声明了 life 的模式在 tech 意图下不许冒出来', () => {
  assert.equal(P.取匹配模式('tech', '今天好累'), null, '「累」撞上了也不行 —— 技术问题套共情策略是噪音')
  assert.ok(P.取匹配模式('unknown', '今天好累'), '意图判不出来时仍然可以命中')
})

test('⑧ 被纠正两次自动降级为 deprecated，之后再也不进注入', () => {
  const id = P.读模式().patterns[0].id
  P.记纠正(id)
  assert.equal(P.读模式().patterns.find((p) => p.id === id).status, 'tentative', '纠正一次还不降级')
  P.记纠正(id)
  const 条 = P.读模式().patterns.find((p) => p.id === id)
  assert.equal(条.status, 'deprecated', '纠正两次要自动打入冷宫')
  assert.equal(P.取匹配模式('life', '今天好累'), null, 'deprecated 永不进注入')
})

test('⑨ 渲染：tentative 要带弱语气，不把猜测说成定论', () => {
  const 加 = P.加模式({ ...合法, text: '当深夜 22 点后他还在写代码时，倾向于话变少；建议别多问，直接给结论' })
  P.改状态(加.id, 'tentative', '')
  const 文 = P.渲染模式(P.读模式().patterns.find((p) => p.id === 加.id))
  assert.ok(文.startsWith('【行为模式】'))
  assert.ok(文.includes('不是定论'), 'tentative 必须带弱语气：' + 文)
})

test('⑩ 状态机只认四个名字，别的直接拒', () => {
  const r = P.改状态('pat-不存在', 'tentative')
  assert.equal(r.ok, false, '找不到 id')
  const id = P.读模式().patterns[0].id
  const r2 = P.改状态(id, '随便什么状态')
  assert.equal(r2.ok, false)
})
