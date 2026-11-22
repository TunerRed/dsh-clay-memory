// tests/hint.test.mjs —— 临场提醒（lib/hint.mjs）的纯逻辑部分
//
// 测的都是「不碰宿主、不碰真机」的保证：
//   · 200 字硬限制真的截（而且按码点截，emoji 不会被劈成半个）
//   · 空着的时候一个字都不多花（拼记忆块 里整段消失）
//   · 拼装顺序固定：骨架 → 项目上下文 → 注入 → 自检 → 临场提醒（**最后**）
//
// 配置隔离：`取临场提醒` 会读 CFG_DIR 下的真实配置，所以 import 前先把
// DSH_HOME 指到空临时家 —— 不然本机一写临场提醒，第一条「出厂默认」的断言就红。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const 家 = mkdtempSync(join(tmpdir(), 'hint-home-'))
process.env.DSH_HOME = 家

const { 收临场提醒, 取临场提醒, 拼临场提醒, 拼记忆块, 临场提醒上限, 默认临场提醒 } = await import('../lib/hint.mjs')

const 换行 = String.fromCharCode(10)

test('上限就是 200 字（写死的约定，改了要同步 UI 与文档）', () => {
  assert.equal(临场提醒上限, 200)
})

test('短文字原样收下（不 trim 掉中间的换行）', () => {
  const 文 = '第一行' + 换行 + '第二行'
  assert.equal(收临场提醒(文), 文)
})

test('超过 200 字直接截到 200，不报错', () => {
  const 文 = '鲸'.repeat(250)
  const 收 = 收临场提醒(文)
  assert.equal(Array.from(收).length, 200)
  assert.equal(收, '鲸'.repeat(200))
})

test('按码点截：emoji 不会被劈成半个代理对', () => {
  const 收 = 收临场提醒('🐟'.repeat(250))
  assert.equal(Array.from(收).length, 200)
  // 200 个 emoji = 400 个 UTF-16 单元；被劈的会变成孤代理，长度对不上
  assert.equal(收.length, 400)
  assert.equal(收, '🐟'.repeat(200))
})

test('非字符串一律当没写（配置被手改成数字也不炸）', () => {
  assert.equal(收临场提醒(undefined), '')
  assert.equal(收临场提醒(null), '')
  assert.equal(收临场提醒(123), '')
  assert.equal(收临场提醒({ a: 1 }), '')
})

test('配置里没有这个字段 → 给默认那段（装完就能用，不用主人先自己想）', () => {
  assert.equal(取临场提醒(), 默认临场提醒)
})
test('默认那段在 200 字以内（否则出厂就超限，体检页一进来就显示被截）', () => {
  const 字 = Array.from(默认临场提醒)
  assert.ok(字.length <= 临场提醒上限, `默认 ${字.length} 字，上限 ${临场提醒上限}`)
  assert.ok(字.length > 60, `默认 ${字.length} 字，太短了没实际约束力`)
})
test('显式清空（存成空串）→ 真的不注入，不被默认值顶回来', () => {
  writeFileSync(join(家, 'clay-memory-config.json'), JSON.stringify({ 临场提醒: '' }), 'utf8')
  assert.equal(取临场提醒(), '')
})

test('配置里写了 → 读得出来；写超长 → 读出来已经截到 200', () => {
  mkdirSync(家, { recursive: true })
  writeFileSync(join(家, 'clay-memory-config.json'), JSON.stringify({ 临场提醒: '每轮自查语气' }), 'utf8')
  assert.equal(取临场提醒(), '每轮自查语气')

  writeFileSync(join(家, 'clay-memory-config.json'), JSON.stringify({ 临场提醒: '长'.repeat(300) }), 'utf8')
  assert.equal(Array.from(取临场提醒()).length, 200)

  // 配置写坏了 → loadCfg 返回 {}，落到默认那段，绝不抛（记忆坏了也不能影响对话）
  writeFileSync(join(家, 'clay-memory-config.json'), '{ 这不是 JSON', 'utf8')
  assert.doesNotThrow(() => 取临场提醒())
  assert.equal(取临场提醒(), 默认临场提醒)
})

test('拼临场提醒：空 → 空串（一个字都不多花）', () => {
  assert.equal(拼临场提醒(''), '')
  assert.equal(拼临场提醒('   ' + 换行 + '  '), '')
  assert.equal(拼临场提醒(null), '')
})

test('拼临场提醒：非空 → 带【临场提醒】标记（否则会跟记忆正文糊在一起）', () => {
  assert.equal(拼临场提醒('先想清楚再开口'), '【临场提醒】' + 换行 + '先想清楚再开口')
})

test('拼记忆块：顺序固定，临场提醒一定在最后', () => {
  const out = 拼记忆块({ 骨架: 'A', 项目上下文: 'B', 注入: 'C', 自检: 'D', 临场提醒: 'E' })
  assert.equal(out, ['A', 'B', 'C', 'D', '【临场提醒】' + 换行 + 'E'].join(换行 + 换行))
  assert.ok(out.endsWith('【临场提醒】' + 换行 + 'E'), '临场提醒必须是最后一段')
})

test('拼记忆块：没有临场提醒时，输出跟旧版逐字相同', () => {
  const 新 = 拼记忆块({ 骨架: 'A', 项目上下文: 'B', 注入: 'C', 自检: 'D', 临场提醒: '' })
  const 旧 = ['A', 'B', 'C', 'D'].filter(Boolean).join(换行 + 换行)
  assert.equal(新, 旧)
})

test('拼记忆块：段全空 → 空串（不注入一个空壳）', () => {
  assert.equal(拼记忆块({}), '')
  assert.equal(拼记忆块(null), '')
  assert.equal(拼记忆块({ 骨架: '', 项目上下文: '', 注入: '', 自检: '', 临场提醒: '' }), '')
})

test('拼记忆块：只有临场提醒时也能单独成立', () => {
  assert.equal(拼记忆块({ 临场提醒: '别点句号' }), '【临场提醒】' + 换行 + '别点句号')
})
