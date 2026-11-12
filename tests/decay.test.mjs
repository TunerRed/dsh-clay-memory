import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// F9（1.12.18 收尾）回归：惰性衰减的公式与结算。
//   ① 只存 (activation0, activationAnchor)，读时才按 now 算 → 不写盘也不会「越放越新」；
//   ② A = A0 × 2^(-天数/H)，H = baseHalfLifeDays × (1 + 2×importance)；
//   ③ 锚点优先级 activationAnchor → at → createdAt → importAt；
//   ④ stable_profile 恒为常数（unknownActivation），不参与衰减；
//   ⑤ 读路径（鲜活度）和写路径（回血 / remember 强化）必须是同一套规则。
const home = mkdtempSync(join(tmpdir(), 'fish-decay-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')
mkdirSync(join(home, 'clay-memory'), { recursive: true })

const { 鲜活度, 结算活跃度 } = await import('../lib/scoring.mjs')
const reinforce = await import('../lib/reinforce.mjs')

const DAY = 86400000
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, (msg || '') + ' 期望 ' + b + '，实际 ' + a)
const 造 = (o) => ({ id: 'm1', text: 'x', category: 'event', ...o })

test('衰减：刚记下（锚 = now）→ 活跃度 ≈ 1', () => {
  const now = Date.parse('2026-05-31T00:00:00Z')
  const m = 造({ activation0: 1, activationAnchor: new Date(now).toISOString() })
  near(鲜活度(m, {}, now), 1)
})

test('衰减：一个半衰期正好减半（默认 30 天）', () => {
  const now = Date.parse('2026-05-31T00:00:00Z')
  const m = 造({ activation0: 1, activationAnchor: new Date(now - 30 * DAY).toISOString() })
  near(鲜活度(m, { baseHalfLifeDays: 30 }, now), 0.5)
})

test('衰减：importance 越大半衰期越长（H = 30 × (1 + 2×I)）', () => {
  const now = Date.parse('2026-05-31T00:00:00Z')
  const 锚 = new Date(now - 30 * DAY).toISOString()
  const m = 造({ activation0: 1, activationAnchor: 锚, importance: 0.5 }) // H = 60
  near(鲜活度(m, { baseHalfLifeDays: 30 }, now), Math.pow(2, -0.5), 'I=0.5 → 30 天才掉到 70.7%')
})

test('衰减：锚点优先级 activationAnchor > at > createdAt', () => {
  const now = Date.parse('2026-05-31T00:00:00Z')
  const m = 造({
    activation0: 1,
    activationAnchor: new Date(now - 30 * DAY).toISOString(), // 用这个 → 0.5
    at: new Date(now - 90 * DAY).toISOString(), // 忽略
    createdAt: new Date(now - 120 * DAY).toISOString(), // 忽略
  })
  near(鲜活度(m, { baseHalfLifeDays: 30 }, now), 0.5)
})

test('衰减：没有 at 但有 createdAt → 从「记下来那天」开始淡，不是钉在 1', () => {
  const now = Date.parse('2026-05-31T00:00:00Z')
  const m = 造({ activation0: 1, createdAt: new Date(now - 30 * DAY).toISOString() })
  near(鲜活度(m, { baseHalfLifeDays: 30 }, now), 0.5)
})

test('衰减：stable_profile 恒为常数，不参与衰减', () => {
  const now = Date.parse('2026-05-31T00:00:00Z')
  const m = 造({ category: 'stable_profile', activation0: 1, activationAnchor: new Date(now - 365 * DAY).toISOString() })
  near(鲜活度(m, { baseHalfLifeDays: 30 }, now), 1, '默认 unknownActivation = 1')
  near(鲜活度(m, { baseHalfLifeDays: 30, unknownActivation: 0.5 }, now), 0.5, '跟着 unknownActivation 走')
})

test('衰减：什么时间都没有 → 常数，且不返回 NaN', () => {
  const now = Date.parse('2026-05-31T00:00:00Z')
  const m = 造({ activation0: 1 })
  const a = 鲜活度(m, { unknownActivation: 0.5 }, now)
  near(a, 0.5)
  assert.ok(Number.isFinite(a), '不能是 NaN')
})

test('回血：A 涨 0.2(1-A)，锚点挪到现在', () => {
  const now = Date.parse('2026-05-31T00:00:00Z')
  const m = 造({ activation0: 0.5, activationAnchor: new Date(now).toISOString() })
  const data = { policy: { baseHalfLifeDays: 30 }, memories: [m] }
  reinforce.标回血('d1', [m.id], now)
  assert.equal(reinforce.应用回血(data, 'd1', now, data.policy), 1)
  near(m.activation0, 0.5 + 0.2 * 0.5) // 0.6
  assert.equal(m.activationAnchor, new Date(now).toISOString(), '锚要挪到结算时刻')
})

test('回血：涨完再过 30 天又是半路（不是回到 1，也不是钉住）', () => {
  const now = Date.parse('2026-05-31T00:00:00Z')
  const m = 造({ activation0: 0.5, activationAnchor: new Date(now).toISOString() })
  const data = { policy: { baseHalfLifeDays: 30 }, memories: [m] }
  reinforce.标回血('d2', [m.id], now)
  reinforce.应用回血(data, 'd2', now, data.policy)
  near(鲜活度(m, { baseHalfLifeDays: 30 }, now + 30 * DAY), 0.3, '0.6 再掉一半')
})

// ── 写路径（remember 强化）的两个「有意保留」选项：跟 1.12.17 及以前行为一致 ──
const 写 = { 稳定值: 1, 只认显式锚: true }

test('写路径：stable_profile 固定 1（即使库把 unknownActivation 调成 0.5）', () => {
  const now = Date.parse('2026-05-31T00:00:00Z')
  const m = 造({ category: 'stable_profile', activation0: 1, activationAnchor: new Date(now - 365 * DAY).toISOString() })
  near(结算活跃度(m, { unknownActivation: 0.5 }, now, 写), 1, '写路径不复用读路径的常数')
  near(鲜活度(m, { unknownActivation: 0.5 }, now), 0.5, '读路径仍然取常数')
})

test('写路径：只有 createdAt 的流水账 → 取常数，不按 createdAt 衰减', () => {
  const now = Date.parse('2026-05-31T00:00:00Z')
  const m = 造({ activation0: 1, createdAt: new Date(now - 30 * DAY).toISOString() })
  near(结算活跃度(m, { baseHalfLifeDays: 30 }, now, 写), 1, '无显式锚 → 常数（默认 1）')
  near(鲜活度(m, { baseHalfLifeDays: 30 }, now), 0.5, '读路径按 createdAt 淡')
})

test('写路径：有 at 时和读路径算的是同一个数', () => {
  const now = Date.parse('2026-05-31T00:00:00Z')
  const m = 造({ activation0: 0.8, at: new Date(now - 30 * DAY).toISOString() })
  near(结算活跃度(m, { baseHalfLifeDays: 30 }, now, 写), 0.8 * 0.5)
  near(结算活跃度(m, { baseHalfLifeDays: 30 }, now, 写), 鲜活度(m, { baseHalfLifeDays: 30 }, now))
})
