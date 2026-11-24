// tests/session-file-name.test.mjs —— 「目录里哪些文件算会话库」的判据（2026-11-24 补）
//
// 起因（主实例真实事故）：
//   STORE_DIR 里有一个名字就叫 `.json` 的残留文件（`storePath('')` 的产物，内容是策略配置）。
//   旧的 `是会话文件` = `endsWith('.json') && charAt(0) !== '_'` —— 它**满足**：
//   首字符是 `.` 不是 `_`，后缀正是 `.json`。
//   于是 `取会话上下文()`（/facts/edit、/facts/delete 用来「借一个会话当写入上下文」）
//   挑中了它，文件名去掉 `.json` 得到**空串**，`saveStore('')` 一路是空 sid。
//   用户侧表现：在设置页改一条全局记忆、删一条全局记忆，**永远不生效**，
//   提示条一闪而过写着「没找到这条事实 / 还没有任何会话库」。
//
// 所以这里钉两件事：
//   ① 隐藏文件（`.` 开头）和分层库（`_` 开头）都不是会话库
//   ② 借会话上下文时，去后缀得到的 sid 必须非空
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 只用合成的目录，绝不碰调用方的 DSH_HOME（paths.mjs 顶层就会读它）。
const home = mkdtempSync(join(tmpdir(), 'clay-paths-'))
process.env.DSH_HOME = home
const p = await import('../lib/paths.mjs')

test('是会话文件：正常会话库算', () => {
  assert.equal(p.是会话文件('session-abc123.json'), true)
  assert.equal(p.是会话文件('session-0f1e2d3c-4567-4890-abcd-ef1234567890.json'), true)
})

test('是会话文件：名字就叫 `.json` 的残留文件不算（本次事故的元凶）', () => {
  assert.equal(p.是会话文件('.json'), false)
})

test('是会话文件：隐藏文件与备份都不算', () => {
  assert.equal(p.是会话文件('.json.bak'), false)
  assert.equal(p.是会话文件('.hidden-abc.json'), false)
  assert.equal(p.是会话文件('.json'), false)
})

test('是会话文件：分层库不算（_facts.json / _ws-*.json）', () => {
  assert.equal(p.是会话文件('_facts.json'), false)
  assert.equal(p.是会话文件('_ws-0011aabbccddeeff0011223344556677.json'), false)
})

test('是会话文件：非 .json、非字符串都不算', () => {
  assert.equal(p.是会话文件('clay-memory.db'), false)
  assert.equal(p.是会话文件('session.txt'), false)
  assert.equal(p.是会话文件(null), false)
  assert.equal(p.是会话文件(''), false)
})

test('找首个会话id：跳过残留的 .json 和分层库，挑出真会话', () => {
  const 目录 = join(home, 'mixed')
  mkdirSync(目录, { recursive: true })
  // 残留文件排在最前 —— readdirSync 的顺序不保证，但这里就是要验「挑不挑得中」
  writeFileSync(join(目录, '.json'), '{"version":2,"policy":{}}')
  writeFileSync(join(目录, '_facts.json'), '{"memories":[]}')
  writeFileSync(join(目录, '_ws-b876.json'), '{"memories":[]}')
  writeFileSync(join(目录, 'session-real.json'), '{"memories":[]}')
  assert.equal(p.找首个会话id(目录), 'session-real')
})

test('找首个会话id：只有残留 .json 时返回空串（调用方会抛「没地方落改动」，不会静默写错）', () => {
  const 目录 = join(home, 'onlystray')
  mkdirSync(目录, { recursive: true })
  writeFileSync(join(目录, '.json'), '{"version":2,"policy":{}}')
  writeFileSync(join(目录, '_facts.json'), '{"memories":[]}')
  assert.equal(p.找首个会话id(目录), '')
})

test('找首个会话id：空目录 / 不存在目录都不炸，返回空串', () => {
  const 空 = join(home, 'empty')
  mkdirSync(空, { recursive: true })
  assert.equal(p.找首个会话id(空), '')
  assert.equal(p.找首个会话id(join(home, 'nope-does-not-exist')), '')
})
