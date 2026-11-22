/**
 * 反证检索（Counter-evidence Check）
 *
 * 起因：2026-11-18 我两次随手归纳（「他说的你定是测试」「晚上松白天正经」）都被主人当场否掉，
 * 两次都栽在「样本不够就下结论」。Gemini 评审指出 dream 生成的假设必须跑一遍反证检索才能入库。
 *
 * 用法：
 *   node tools/check-hypothesis.mjs "主人晚上喜欢聊松的话题"
 *   node tools/check-hypothesis.mjs "他对黑盒零容忍" --min 2
 *
 * 输出：支持 N 条 / 反对 M 条 / 存疑 K 条，并把命中的记忆列出来给人看。
 * 判据是**词面**，不是语义 —— 所以它只能当「粗筛」，用来抓「明显有反例」的情况，
 * 不能当「假设正确」的证明。找不到反例 ≠ 假设成立（这是这类工具最大的误用）。
 */
import { loadStoreJSON, 接报信 } from '../lib/store-core.mjs'
import { 分词 } from '../lib/lexicon.mjs'
import { homedir } from 'node:os'
import { join } from 'node:path'

接报信(() => {})
process.env.DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

const 假设 = process.argv[2]
if (!假设) {
  console.error('用法：node tools/check-hypothesis.mjs "一条假设" [--min 2]')
  process.exit(1)
}
const minArg = process.argv.indexOf('--min')
const 最少共有词 = minArg > 0 ? Math.max(1, Number(process.argv[minArg + 1]) || 2) : 2

// 反义词对：假设里出现左边，记忆里出现右边 → 算「可能矛盾」
const 反义对 = [
  ['喜欢', '讨厌'], ['喜欢', '不喜欢'], ['爱', '烦'],
  ['总是', '从不'], ['总是', '很少'], ['每次', '从来不'],
  ['会', '不会'], ['愿意', '不愿意'], ['同意', '反对'],
  ['晚上', '白天'], ['白天', '晚上'], ['深夜', '清早'],
  ['松', '正经'], ['正经', '松'], ['玩笑', '严肃'],
  ['快', '慢'], ['多', '少'], ['好', '差'],
  ['需要', '不需要'], ['要', '不要'], ['能', '不能'],
  ['想', '不想'], ['是', '不是'],
]

// 停用词：这些词几乎每条记忆都有，拿它们算「共有」等于没筛。
// 第一版没加这个，跑「主人晚上喜欢聊松的话题」时支持证据里全是「主人喜欢自己掌控工具」
// 这种连边都不沾的条目 —— 假阳性高到没法用。
const 停用 = new Set([
  '主人', '我', '你', '他', '她', '的', '了', '是', '在', '有', '不', '都', '就', '也',
  '和', '与', '这', '那', '什么', '怎么', '一个', '这个', '那个', '的话', '时候',
  '可以', '会', '要', '能', '想', '说', '做', '用', '去', '来', '给', '对', '从',
])
const 有效词 = (ws) => [...ws].filter((w) => w && !/^\d+$/.test(w) && !停用.has(w) && w.length > 1)

const 假设词 = [...new Set(有效词(分词(假设)))]

const d = loadStoreJSON('diag')
const 活 = d.memories.filter((m) => !m.refinedSkip && !m.已被取代)

const 支持 = []
const 反对 = []
const 存疑 = []

for (const m of 活) {
  const 文 = String(m.text || '')
  const 词 = new Set(有效词(分词(文)))
  const 共有 = 假设词.filter((w) => 词.has(w))
  if (共有.length === 0) continue

  // 矛盾检测：假设里的某个词 A，记忆里出现了它的反义词 B（且 B 不在假设里）
  let 矛盾 = null
  for (const [a, b] of 反义对) {
    if (假设.includes(a) && !假设.includes(b) && 文.includes(b) && 文.includes(a)) {
      矛盾 = { 正: a, 反: b }
      break
    }
  }

  const 条 = {
    id: m.id,
    共有,
    矛盾,
    日期: String(m.createdAt || '').slice(0, 10) || '未知',
    文字: 文.replace(/\s+/g, ' ').slice(0, 80),
  }
  if (共有.length >= 最少共有词) {
    if (矛盾) 反对.push(条)
    else 支持.push(条)
  } else {
    存疑.push(条)
  }
}

const 线 = (h) => console.log('\n=== ' + h + ' ===')
线('假设：' + 假设)
console.log('假设拆出的实词：' + 假设词.join(' / '))
console.log('活跃记忆：' + 活.length + ' 条')
console.log('\n支持 ' + 支持.length + ' / 反对 ' + 反对.length + ' / 存疑 ' + 存疑.length)

const 打印 = (名, 表) => {
  if (表.length === 0) return
  console.log('\n--- ' + 名 + ' ---')
  for (const t of 表.slice(0, 8)) {
    const 标记 = t.矛盾 ? '  ⚠矛盾(' + t.矛盾.正 + '↔' + t.矛盾.反 + ')' : ''
    console.log('  [' + t.id + '] ' + t.日期 + 标记 + ' 共有:' + t.共有.join(','))
    console.log('    ' + t.文字)
  }
}
打印('支持证据', 支持)
打印('反例（可能有矛盾）', 反对)
打印('存疑（只有单点重合）', 存疑)

// 跨日期聚合：Gemini 评审里的第二道硬约束 ——「证据 ≥3 条且来自至少 2~3 个不同日期」。
// 起因：2026-11-18 我拿「三个晚上」的样本归纳出「晚上松白天正经」，主人当场否掉。
// 那三次其实都发生在同一段时间里，等于**一个样本被拆成了三条记忆**。
const 日期集 = (表) => [...new Set(表.map((t) => t.日期))].sort()
const 支持日期 = 日期集(支持)
const 反对日期 = 日期集(反对)
console.log('\n=== 证据的日期分布 ===')
console.log('支持证据来自 ' + 支持日期.length + ' 个不同日期：' + (支持日期.join(' / ') || '（无）'))
if (反对.length) console.log('反例来自 ' + 反对日期.length + ' 个不同日期：' + 反对日期.join(' / '))

// 结论只给粗判，不做「假设成立」的承诺
console.log('\n=== 粗判 ===')
if (反对.length >= 支持.length && 反对.length > 0) {
  console.log('⚠ 反例不少于支持证据 —— 这条假设很可能站不住，或者触发条件写得太宽。')
  console.log('  建议：先看上面「反例」那几条，把它们的时间戳调出来，看是不是更近的推翻性记忆。')
} else if (支持.length === 0) {
  console.log('没有找到任何支持证据 —— 要么假设的方向不对，要么词面完全对不上（换词再试）。')
} else if (支持日期.length < 2) {
  // ⭐ 这一条是 2026-11-18 加的：那天我拿「三个晚上」的样本归纳出「晚上松白天正经」，
  //   主人当场否掉。那三条记忆其实落在同一两天里 —— 等于**一个样本被拆成三条**。
  //   所以「支持 3 条」这种数字毫无意义，要看它们是不是来自不同日期。
  console.log('⚠ 支持证据全挤在 ' + 支持日期.length + ' 个日期里 —— **这不足以当规律**。')
  console.log('  一个日期里连续发生的几件事，很可能只是同一件事的不同侧面。')
  console.log('  建议：等这事在别的日期再出现一次，再考虑把它写成模式。')
} else {
  console.log('支持 > 反例，且证据跨 ' + 支持日期.length + ' 个日期 —— 但仍**不等于假设成立**。')
  console.log('词面检查只证明「有相关记忆」，不证明归因正确。还要人工看一眼：')
  console.log('  1. 这些证据是不是同一个来源（比如都是我某次总结出来的，而不是你亲口说的）？')
  console.log('  2. 有没有更近的、方向相反的记忆没被抓到（换关键词再跑一次）？')
}
