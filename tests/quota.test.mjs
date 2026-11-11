import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 日额度（1.10.6）回归：
//   ① 额度只数**事件类**，数到 dailyQuota（默认 10）就拒；
//   ② 稳定事实（长期偏好、约定这类）**不占额度**，满了还能记；
//   ③ 拒绝时的文案要说清「是事件满了」，别让人以为稳定的事也记不了。
const home = mkdtempSync(join(tmpdir(), 'fish-quota-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')

const { loadCfg } = await import('../lib/cfg.mjs')
const names = await import('../lib/names.mjs')
names.接读配置(loadCfg)
const tools = await import('../lib/tools.mjs')
tools.接定义工具((def) => def)
tools.接报信(() => {})

mkdirSync(join(home, 'clay-memory'), { recursive: true })
const 造工具 = () => tools.makeRememberTool({ agents: { list: () => [] }, interval: () => () => {}, on: () => {} })
const 会话 = (sid) => ({ agent: { session: { id: sid, snapshotEvents: () => [] } } })

test('日额度：事件类记到 10 条就停，第 11 条被拒且文案说清是「事件」满了', async () => {
  const sid = 'quota-a'
  const 工 = 造工具()
  for (let i = 1; i <= 10; i++) {
    const r = await 工.execute({ text: '测试第 ' + i + ' 条流水，今天在河边走了走', 类型: 'event' }, 会话(sid))
    assert.equal(r.ok, true, '第 ' + i + ' 条应该能记：' + r.message)
  }
  const 超 = await 工.execute({ text: '测试第 11 条流水，今天又去河边走了走', 类型: 'event' }, 会话(sid))
  assert.equal(超.ok, false, '超过额度要拒')
  assert.ok(超.message.indexOf('10 条事件') >= 0, '文案要说是事件满了，实际：' + 超.message)
  assert.ok(超.message.indexOf('稳定的事还能记') >= 0, '要告诉它稳定事实不受影响')
})

test('日额度：事件满了之后，稳定事实照样能记（不占额度）', async () => {
  const sid = 'quota-a'
  const 工 = 造工具()
  const 稳 = await 工.execute({ text: '主人的生日是三月十七号', 类型: 'stable' }, 会话(sid))
  assert.equal(稳.ok, true, '稳定事实不该被事件额度挡住：' + 稳.message)
  const 稳2 = await 工.execute({ text: '双方约定：闲聊句末不写句号', 类型: 'stable' }, 会话(sid))
  assert.equal(稳2.ok, true)
  // 稳定事实也不该把事件额度「算少了」—— 再记一条事件仍然是满的
  const 事件 = await 工.execute({ text: '测试第 12 条流水，晚上出门买灯泡', 类型: 'event' }, 会话(sid))
  assert.equal(事件.ok, false, '稳定事实不占额度，事件额度还是满的')
})

test('日额度：稳定事实记满 10 条之后，第 11 条事件仍能记（额度只数事件）', async () => {
  const sid = 'quota-b'
  const 工 = 造工具()
  for (let i = 1; i <= 10; i++) {
    const r = await 工.execute({ text: '主人的第 ' + i + ' 个长期偏好：喜欢第 ' + i + ' 种口味', 类型: 'stable' }, 会话(sid))
    assert.equal(r.ok, true)
  }
  const 事件 = await 工.execute({ text: '今天下午三点去打了疫苗第三针', 类型: 'event' }, 会话(sid))
  assert.equal(事件.ok, true, '事件额度是空的，不该被稳定事实占掉：' + 事件.message)
})
