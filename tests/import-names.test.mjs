import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 导入时人称：2026-11-04 修「从 meow 导入的称呼全变成 ta」——
//   以前无条件用全局 userPronoun()（默认 ta）；现在优先会话 ownerNames，
//   回落全局；仍是默认 ta 就保留原文不动。
const home = mkdtempSync(join(tmpdir(), 'fish-impname-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')
mkdirSync(join(home, 'clay-memory'), { recursive: true })

const { loadCfg } = await import('../lib/cfg.mjs')
const names = await import('../lib/names.mjs')
names.接读配置(loadCfg)

function 写配置(c) {
  writeFileSync(join(home, 'clay-memory-config.json'), JSON.stringify(c), 'utf8')
}

test('默认 ta 时保留原文称呼，不替换成 ta', () => {
  写配置({ userPronoun: '', ownerNames: {}, selfNames: {} })
  assert.equal(names.导入时改人称('主人喜欢玩泰拉瑞亚', 'session-x', ['主人']), '主人喜欢玩泰拉瑞亚')
})

test('设了全局称呼就替换', () => {
  写配置({ userPronoun: '老大', ownerNames: {}, selfNames: {} })
  assert.equal(names.导入时改人称('主人喜欢玩泰拉瑞亚', 'session-x', ['主人']), '老大喜欢玩泰拉瑞亚')
})

test('每会话称呼优先于全局', () => {
  写配置({ userPronoun: '老大', ownerNames: { 'session-x': '大嫂' }, selfNames: {} })
  assert.equal(names.导入时改人称('主人喜欢玩泰拉瑞亚', 'session-x', ['主人']), '大嫂喜欢玩泰拉瑞亚')
})
