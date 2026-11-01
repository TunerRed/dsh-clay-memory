import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 词典/词频三文件是「通用中文词门」的测量仪器：
//   装词表() 读不到 lexicon.txt → 静默退回老切法
//   装词频() 读不到 wordfreq.txt → 通用稀有恒为 1，词门失效
// 曾经整仓丢过（1.8.17 审查发现），所以这三条断言必须是硬失败。
const libDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib')

function 读(名) {
  try {
    return readFileSync(join(libDir, 名), 'utf8')
  } catch {
    return null
  }
}

test('lexicon.txt 存在且词条量级正常（按行一词）', () => {
  const 内容 = 读('lexicon.txt')
  assert.ok(内容, 'lib/lexicon.txt 缺失：装词表() 会静默退回老切法')
  const 行 = 内容.trim().split('\n').map(l => l.trim()).filter(Boolean)
  assert.ok(行.length > 100000, `lexicon.txt 词条数异常：${行.length}（期望 > 100000）`)
  const 最长 = Math.max(...行.map(w => w.length))
  assert.ok(最长 <= 20, `lexicon.txt 有超长词条（${最长} 字），会撑爆最长匹配窗口`)
})

test('wordfreq.txt 存在且每行是「词 0~99」，前两万词无坏行', () => {
  const 内容 = 读('wordfreq.txt')
  assert.ok(内容, 'lib/wordfreq.txt 缺失：通用稀有() 恒为 1，通用中文门整条失效')
  const 行 = 内容.trim().split('\n').filter(Boolean)
  assert.equal(行.length, 20000, `wordfreq.txt 行数 ${行.length} ≠ 20000`)
  let 坏 = 0
  const 表 = new Map()
  for (const l of 行) {
    const p = l.trim().split(/\s+/)
    if (p.length < 2) { 坏++; continue }
    const v = Number(p[1])
    if (!p[0] || !Number.isFinite(v) || v < 0 || v > 99) { 坏++; continue }
    if (表.has(p[0])) { 坏++; continue }
    表.set(p[0], v)
  }
  assert.equal(坏, 0, `wordfreq.txt 有 ${坏} 行格式坏（期望「词 0~99」、词不重复）`)
  // 锚点：最常用的几个虚词必须落在低分位（0 = 最常用）
  for (const w of ['的', '了', '是']) {
    assert.ok(表.has(w), `wordfreq.txt 缺少最常用词「${w}」`)
    assert.ok(表.get(w) <= 20, `「${w}」分位 ${表.get(w)} 异常高（期望 ≤ 20）`)
  }
})

test('lexicon-source.txt 存在且保留 jieba 的 MIT 声明', () => {
  const 内容 = 读('lexicon-source.txt')
  assert.ok(内容, 'lib/lexicon-source.txt 缺失：来源与许可无从核对')
  assert.match(内容, /jieba/)
  assert.match(内容, /MIT/)
  assert.match(内容, /Sun Junyi/)
})
