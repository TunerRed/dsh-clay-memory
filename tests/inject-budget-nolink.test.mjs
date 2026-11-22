// 1.12.60：注入预算的两处口径
//  ① 抬头从 4 行压到 2 行（每轮固定开销 132 → 65）
//  ② 净长：**URL 和 Windows 路径都不计入估计长度**（主人原意「只是统计字数时不统计
//     它的长度，记忆本身不要动」）；英文标识符照原样算 —— 剥掉会改坏语义。
//     代价是实际注入比估计多，这个偏差已被主人接受。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { 净长 } from '../lib/scoring.mjs'

test('净长：URL 完全不占字', () => {
  const a = 净长('参考https://example.com/a/very/long/path那段')
  const b = 净长('参考那段')
  assert.equal(a, b)
})

test('净长：Windows 路径也不占字', () => {
  const 路径 = 'G:\\DSH_HOME\\plugins\\dsh-clay-memory'
  assert.equal(净长(路径), 0, '路径只算坐标，不算记忆内容')
})

test('净长：英文标识符一个字都不剥（libssl.so 是关键信息）', () => {
  const 文本 = 'nginx 报 libssl.so 找不到'
  assert.equal(净长(文本), 文本.length, '标识符被剥掉会直接改坏语义')
})

test('净长：空串与 null 都是 0', () => {
  assert.equal(净长(''), 0)
  assert.equal(净长(null), 0)
  assert.equal(净长(undefined), 0)
})

test('净长：普通中文短句按原长算', () => {
  const 文本 = '主人不喜欢吃香菜'
  assert.equal(净长(文本), 文本.length)
})
