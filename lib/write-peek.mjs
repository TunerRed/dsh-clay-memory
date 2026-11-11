// lib/write-peek.mjs —— 写入可见：记一条新记忆时，告诉它「库里最像的是哪条」
// ============================================================================
// 2026-11-10（1.10.4，写入可见）。起因：
//   以前 remember 只有两种可见结果 —— 「记下了」或者「这条记过了（强化）」。
//   落在中间地带的情况（**像但不完全像**，像度 0.5~0.85）什么都看不见：
//   于是同一件事被记成两条、各自淡忘，而它自己完全不知道 ✗
//
// 为什么单独一个文件（跟宿主解耦的约定）：
//   ① 这儿**不 import 任何宿主接口**，只吃一个普通数组 + 一段文本，返回普通对象
//      → 不启动 DSH 就能单测（tests/write-peek.test.mjs）；
//   ② 提示文案也在这，宿主那一侧只负责把字符串拼进工具返回值
//      （工具返回值本来就进上下文，**不新增任何常驻 token**）；
//   ③ DSH 接口变了，这个文件一行都不用动。
//
// 口径（为什么门槛是 0.5 / 0.85）：
//   - ≥ 0.85（真重复门槛）= 已经由 remember 自动标成「已被取代」了，不用再提示；
//   - 0.5~0.85 = 「像」，但**不够格自动合并**（自动合错的代价是悄悄让一条正经记忆不再被想起来）；
//     这种只能交给它自己判断 —— 它才知道是不是同一件事。
// ============================================================================
import { 词集, 像度, 真重复门槛 } from './scoring.mjs'

/** 低到这儿就不提了：太泛的相似（0.5 以下）提示一次等于每轮都在喊狼来了 */
export const 像提示门槛 = 0.5
/** 提示里引用的原文最多这么多字，超了截断 —— 别为了提示把上下文撑起来 */
export const 提示字数 = 40

/**
 * 在已有记忆里找跟 text 最像的那条（落在「像但不够格自动合并」这一档）。
 * @param {Array} memories 当前库里的条目（普通数组，不要求是 DSH 的任何对象）
 * @param {string} text 这次要记的内容
 * @param {Set<string>|Array<string>} [排除] 这次已经被标作废的 id（别拿它们做提示）
 * @returns {{id:string, text:string, 像:number}|null}
 */
export function 找最像(memories, text, 排除) {
  if (!Array.isArray(memories) || !text) return null
  let 排 = null
  if (排除 instanceof Set) 排 = 排除
  else if (Array.isArray(排除)) 排 = new Set(排除.map(String))
  const 新词集 = 词集(text)
  let 最好 = null
  let 分 = 0
  for (const m of memories) {
    if (!m || m.已被取代 || m.别记) continue
    const id = String(m.id || '')
    if (排 && 排.has(id)) continue
    const 文 = String(m.text || '')
    if (!文) continue
    const 像 = 像度(新词集, 词集(文))
    if (像 < 像提示门槛 || 像 >= 真重复门槛) continue
    if (像 > 分) {
      分 = 像
      最好 = m
    }
  }
  return 最好 ? { id: String(最好.id || ''), text: String(最好.text || ''), 像: 分 } : null
}

/**
 * 把 找最像 的结果变成一句人话；没有就不返回任何东西（空串）。
 * @param {{text:string, 像:number}|null} peek
 */
export function 像提示(peek) {
  if (!peek || !peek.text) return ''
  const 短 = peek.text.length > 提示字数 ? peek.text.slice(0, 提示字数) + '…' : peek.text
  return '（跟「' + 短 + '」有点像，' + peek.像.toFixed(2) + ' —— 要是同一件事，可以填「取代」指它）'
}
