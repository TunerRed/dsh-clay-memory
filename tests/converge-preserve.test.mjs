// tests/converge-preserve.test.mjs —— 按键收敛的「信息保全」回归（2026-11-15）
//
// 事故：`约定.测试实例隔离` 有两条同键记忆。
//   · 10-28 那条（importance 1、强化过 2 次）写着「改插件只动 D:\dev\fish-memory-dev
//     与 D:\dev\home\.dsh（测试实例），不碰主实例」——仓库路径全在里面。
//   · 11-10 那条写的是态度（先在沙箱跑干净、同步装机副本先问一声），一个字没提路径。
// 11-11 一次「清洗补键」给后者补上了同一个键，然后 按键收敛 按「只留最新」把前者作废。
// 结果：仓库路径再也想不起来，下次改插件连该动哪个目录都要重新问。
//
// 修法：收敛前比对两段文本的硬标识（路径 / URL / --flag）；旧条有、新条没有的，
//       这条**不作废**，记进 取收敛保住() 让人处置。
import test from 'node:test'
import assert from 'node:assert/strict'
import { 按键收敛, 取收敛保住 } from '../lib/scoring.mjs'

const 键 = '约定.测试实例隔离'
const 旧文 =
  '长任务开工约定：改插件只动 D:\\dev\\fish-memory-dev 与 D:\\dev\\home\\.dsh（测试实例），不碰主实例和 D:\\dsh-home 的 desktop profile。'
const 新文 = '以后评测/改插件先在沙箱实例跑干净，连同步装机副本都先问一声，不自作主张。'

const 条 = (id, text, at, k) => ({ id, text, at, createdAt: at, 事实键: k })

function 造(memories) {
  return { version: 2, memories, deleted: [], traces: [] }
}

test('信息保全：旧条带路径、新条没有 → 旧条不作废，缺的路径记进 取收敛保住', () => {
  const data = 造([条('old', 旧文, '2026-10-28T13:38:15.678Z', 键), 条('new', 新文, '2026-11-10T05:05:07.636Z', 键)])
  const 作废 = 按键收敛(data, '清洗补键')

  assert.deepEqual(作废, [], '旧条不该被作废')
  assert.equal(data.memories[0].已被取代, undefined, '旧条仍是有效条目')
  const 保住 = 取收敛保住()
  assert.equal(保住.length, 1, '应记一条保住')
  assert.equal(保住[0].id, 'old')
  assert.equal(保住[0].键, 键)
  assert.ok(
    保住[0].缺.some((x) => x.includes('fish-memory-dev')),
    '缺的标识里要有仓库路径，实际：' + JSON.stringify(保住[0].缺),
  )
})

test('新条也带同一批路径 → 没有信息损失，照常作废', () => {
  const data = 造([
    条('old', '改插件只动 D:\\dev\\fish-memory-dev，别碰主实例。', '2026-10-28T13:38:15.678Z', 键),
    条('new', '改插件只动 D:\\dev\\fish-memory-dev，先跑沙箱再说。', '2026-11-10T05:05:07.636Z', 键),
  ])
  const 作废 = 按键收敛(data, '清洗补键')
  assert.deepEqual(作废, ['old'], '路径没丢 → 正常收敛')
  assert.ok(data.memories[0].已被取代, '旧条被标已取代')
  assert.equal(取收敛保住().length, 0)
})

test('旧条根本没有硬标识 → 照常作废（保全只管具体信息）', () => {
  const data = 造([
    条('old', '拼团还没开。', '2026-10-28T13:38:15.678Z', 键),
    条('new', '拼团已经开了。', '2026-11-10T05:05:07.636Z', 键),
  ])
  const 作废 = 按键收敛(data, '清洗补键')
  assert.deepEqual(作废, ['old'])
  assert.equal(取收敛保住().length, 0)
})

test('--flag 也算硬标识：旧条独有就不埋', () => {
  const data = 造([
    条('old', '上线用 npm run deploy --force 才能覆盖旧产物。', '2026-10-28T13:38:15.678Z', 键),
    条('new', '上线记得先跑构建。', '2026-11-10T05:05:07.636Z', 键),
  ])
  const 作废 = 按键收敛(data, '清洗补键')
  assert.deepEqual(作废, [], '--force 会被埋掉 → 保住')
  assert.ok(取收敛保住()[0].缺.includes('--force'))
})

test('分不出新旧（时间戳相同）时本来就不动 —— 保全不改变这条', () => {
  const data = 造([
    条('a', 旧文, '2026-10-28T13:38:15.678Z', 键),
    条('b', 新文, '2026-10-28T13:38:15.678Z', 键),
  ])
  const 作废 = 按键收敛(data, '清洗补键')
  assert.deepEqual(作废, [])
  assert.equal(取收敛保住().length, 0, '没到作废那一步，不该记保全')
})
