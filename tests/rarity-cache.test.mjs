// tests/rarity-cache.test.mjs —— 词频表缓存的指纹回归（2026-11-15）
//
// 第三方复核逮到的问题：`lib/meter.mjs` 的 稀有表() 用「条数 + 每条字数 + 标签数」
// 当缓存指纹，不含实际内容。于是等长改文、补扩词、跨会话同形状数据全都
// 命中旧指纹，继续用旧词频 —— 召回分静默失真，绿灯也查不出来。
import test from 'node:test'
import assert from 'node:assert/strict'
import { 稀有表 } from '../lib/meter.mjs'

test('等长改文要重算：alpha→bravo', () => {
  const 前 = 稀有表([{ text: 'alpha' }, { text: 'beta' }])
  assert.equal(前.get('alpha'), 1, '前置：alpha 在旧表里')
  const 后 = 稀有表([{ text: 'bravo' }, { text: 'beta' }])
  assert.equal(后.get('bravo'), 1, '新词要进表')
  assert.equal(后.get('alpha'), undefined, '旧词不该留在表里（长度一样也得重算）')
})

test('补扩词要重算：tags 新增 charlie', () => {
  const 前 = 稀有表([{ text: 'alpha' }])
  assert.equal(前.get('charlie'), undefined, '前置：charlie 还没进表')
  const 后 = 稀有表([{ text: 'alpha', tags: ['charlie'] }])
  assert.equal(后.get('charlie'), 1, 'tags 会进 词面()，加进去词频表要跟着变')
})

test('related 也要重算', () => {
  const 前 = 稀有表([{ text: 'alpha' }])
  assert.equal(前.get('deltax'), undefined)
  const 后 = 稀有表([{ text: 'alpha', related: ['deltax'] }])
  assert.equal(后.get('deltax'), 1, 'related 也进 词面()，不能漏')
})

test('真没变就还用缓存（别把指纹改成一刀切重算）', () => {
  const a = 稀有表([{ text: 'alpha' }, { text: 'beta' }])
  const b = 稀有表([{ text: 'alpha' }, { text: 'beta' }])
  assert.equal(a, b, '内容一样必须命中缓存，返回同一个对象')
})
