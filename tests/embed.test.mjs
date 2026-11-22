// tests/embed.test.mjs —— 语义召回底座（embed.mjs）的纯函数部分
//
// 这里**不碰模型**：模型下载/推理要网络和 ONNX 运行时，跑测试的机器上不一定有。
// 测的是「开关默认关、指纹稳定、余弦正确、没有缓存时相似度全 0」这些保证
// 「不开语义 = 行为跟老版本一模一样」的东西。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 配置目录先指到空临时家再 import：`语义开()` 在 CLAY_EMBED 不等于 '1' 时会回落读
// CFG_DIR 下的真实配置，不隔离的话本机一开「语义召回」开关，下面那条默认关的断言就红。
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'embed-home-'))

const { 语义开, 文本指纹, 记忆指纹, 余弦, 相似度表 } = await import('../lib/embed.mjs')

test('默认关：CLAY_EMBED 不是 1 就 false', () => {
  const 旧 = process.env.CLAY_EMBED
  try {
    delete process.env.CLAY_EMBED
    assert.equal(语义开(), false)
    process.env.CLAY_EMBED = '0'
    assert.equal(语义开(), false)
    process.env.CLAY_EMBED = '1'
    assert.equal(语义开(), true)
  } finally {
    if (旧 === undefined) delete process.env.CLAY_EMBED
    else process.env.CLAY_EMBED = 旧
  }
})

test('文本指纹：同内容同值、不同内容不同值', () => {
  assert.equal(文本指纹('ta叫沈知夏'), 文本指纹('ta叫沈知夏'))
  assert.notEqual(文本指纹('ta叫沈知夏'), 文本指纹('ta叫沈知秋'))
  // 只是等长不算同内容 —— 这正是 1.12.40 词频缓存踩过的坑
  assert.notEqual(文本指纹('alpha'), 文本指纹('bravo'))
})

test('记忆指纹：text / tags / related 任一变了就变', () => {
  const a = { text: 'ta叫沈知夏', tags: ['身份'], related: [] }
  assert.equal(记忆指纹(a), 记忆指纹({ ...a }))
  assert.notEqual(记忆指纹(a), 记忆指纹({ ...a, text: 'ta叫沈知秋' }))
  assert.notEqual(记忆指纹(a), 记忆指纹({ ...a, tags: ['身份', '名字'] }))
  assert.notEqual(记忆指纹(a), 记忆指纹({ ...a, related: ['全名'] }))
})

test('余弦：向量已归一化时点积即余弦', () => {
  assert.ok(Math.abs(余弦(Float32Array.from([1, 0]), Float32Array.from([1, 0])) - 1) < 1e-6)
  assert.ok(Math.abs(余弦(Float32Array.from([1, 0]), Float32Array.from([-1, 0])) + 1) < 1e-6)
  assert.equal(余弦(Float32Array.from([1, 0]), Float32Array.from([0, 1])), 0)
})

test('相似度表：没有缓存就全 0（等价纯词面）', () => {
  const 家 = mkdtempSync(join(tmpdir(), 'embed-'))
  mkdirSync(join(家, 'clay-memory'), { recursive: true })
  const 表 = 相似度表(Float32Array.from([1, 0]), [{ id: 'a', text: '随便' }], 家)
  assert.equal(表.get('a') || 0, 0)
})

test('相似度表：缓存命中就按点积算', () => {
  const 家 = mkdtempSync(join(tmpdir(), 'embed-'))
  mkdirSync(join(家, 'clay-memory'), { recursive: true })
  const m = { id: 'x', text: 'ta叫沈知夏', tags: [], related: [] }
  // 缓存格式：{ [记忆id]: { 指纹, 向量: number[] } } —— 只认指纹对得上、维度 512 的
  const 向量 = new Array(512).fill(0)
  向量[0] = 1
  writeFileSync(
    join(家, 'clay-memory', 'embeddings.json'),
    JSON.stringify({ x: { 指纹: 记忆指纹(m), 向量 } }),
  )
  const 查询 = new Float32Array(512)
  查询[0] = 1
  const 表 = 相似度表(查询, [m], 家)
  assert.ok(表.get('x') > 0.99)
})
