// ════════ 词门：停用词 / 通用词表 / 词频 / 分词 ════════
// 2026-10-30 从 index.js 拆出（拆层工程第 1 批）
// 依赖：node:fs/node:path/node:url 标准库 + 外部注入的报信器（diag）
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 报信器由 index.js 注入（diag），测试里可以不接 —— 词门失效时无痕
let 报信 = (msg) => {}
export function 接报信(fn) { 报信 = typeof fn === 'function' ? fn : (msg) => {} }

const HAN_STOPS =
  /(?:怎么样|叫什么|名字|名叫|叫|用户|什么|怎么|哪里|哪儿|现在|目前|当前|记得|记住|告诉|可以|请问|一下|来着|我们|你们|他们|她们|这个|那个|哪些|是否|有没有|我|你|他|她|它|的|了|着|过|是|有|在|把|被|和|与|及|或|这|那|哪|吗|呢|吧|啊|呀|得|地|个|只|件|请|也|都|就|很|再|还|要)/gu
const EN_STOPS = new Set(['the','a','an','is','are','was','were','i','you','my','your','it','and','or','to','of','what','where','do','did','does'])

const normalize = (s) => String(s || '').normalize('NFKC').toLowerCase()

// 抽出「实词」（去停用词 ✓）：中文按停用词切开，≤2 字整段收，更长抽 2-gram
// 切词的结果**缓存起来** —— 每轮要把 850 条记忆重新切一遍，纯浪费
// （实测：850 条切一次 42.7ms，而每轮都要切；缓存之后第二次起几乎不花时间）
// ⚠ 缓存有上限，别把内存撑爆；满了就整个丢掉重来（简单、够用）
const 切词缓存 = new Map()
const 切词缓存上限 = 4000

// 把一段话切成「按停用词分开的中文片段」—— 切词和搭配统计共用同一把刀 ✓
function 中文片段(s) {
  const clean = normalize(s)
  const out = []
  for (const run of clean.match(/[\u4e00-\u9fa5]+/g) || []) {
    for (const part of run.split(HAN_STOPS)) if (part) out.push(part)
  }
  return out
}

// ⭐⭐ 2026-09-23：**通用中文词表**（jieba 的，MIT，见同目录 lexicon-source.txt）
//
// 老切法（停用词切开 + 长串只出 2-gram）有个治不好的毛病：
//     记忆里「车站附近」 → 切出 车站 / 站附 / 附近，**「车」自己不是一项**
//     问句里「那辆车」→ 「车」短，整段收 → **词表里就是「车」**
//   两边词表**本来就对不上**，于是老代码只能拿字符串去整段正文里硬撞
//   （`mText.includes('车')`）→ 「车」撞进「车站」、「心」撞进「关心」✗
//
//   有了词表就能**按词比**了：词表认得「车站」是一个词，那一段就整段吃掉，
//   「车」不再单独冒出来；而「那辆车」里的「车」是独立词，照样留着 ✓
//
// ⚠ 词表是**通用中文**的，跟谁用、说过什么话**无关** —— 装上第一天就管用，
//   不需要先喂够语料（这是给别人用的前提）。
// ⚠ 读不到这个词表文件时**自动退回老切法**，不会崩 ✓
const 词表路径 = join(dirname(fileURLToPath(import.meta.url)), 'lexicon.txt')
let 词表 = null // Set<string>；null = 还没装，空 Set = 文件读不到
let 词表最长 = 8 // 最长匹配的窗口上限

function 装词表() {
  if (词表) return 词表
  词表 = new Set()
  try {
    for (const l of readFileSync(词表路径, 'utf8').split('\n')) {
      const w = l.trim()
      if (w) 词表.add(w)
    }
    报信('词表已装载：' + 词表.size + ' 词')
  } catch (e) {
    词表 = new Set() // 读不到 → 当没有 → 自动退回老切法 ✓
    // ⭐ 1.8.20：不再静默 —— 词典整仓丢过一次（1.8.17 审查发现），丢了要在 diag 里留痕
    报信('⚠ 词表读取失败（通用中文按词切分已失效，退回老切法）：' + 词表路径 + ' → ' + String((e && e.code) || e))
  }
  if (词表.size) {
    词表最长 = 2
    for (const w of 词表) if (w.length > 词表最长) 词表最长 = w.length
    if (词表最长 > 12) 词表最长 = 12 // 别让一条超长词条把窗口撑爆
  }
  return 词表
}

// ⭐⭐ 2026-09-24：**通用中文词频表**（jieba 的，MIT，跟 lexicon.txt 同一个来源）✓
//
//   治的是什么：**「库里稀不稀有」在小库上没有意义**。
//   实测她那句「轮到**正式**演出…我也该**表示**了」，注入的却是
//   「从没**正式**去医院确诊…明确**表示**不会轻生」——两个词各是各的意思。
//   为什么它能排全库第一：
//     「正式」在她的库里只出现 4 条、「表示」只出现 2 条
//     → 按「库里稀不稀有」算，它俩成了**最值钱的证据**（库里越小越荒唐：
//       一个词碰巧只出现一次，稀有度就算满 1.0）✗
//   可它们在**通用中文**里是最常见的词（表示排 376、正式排 887）。
//   反过来，她话里真正有意义的「宝宝」「亲」因为在这个库里常见，被整条挡掉了 ✗
//
//   → 再拿一把**跟谁用无关**的尺子：这个词在通用中文里有多常见。
//     最常见的那些词（谁的话里都会出现）不当检索线索 ✓
//   ⚠ 读不到这个文件就**当没有**（不压），不会崩；老行为完全不变 ✓
const 词频路径 = join(dirname(fileURLToPath(import.meta.url)), 'wordfreq.txt')
let 词频表 = null // Map<string, number>：词 → 0~99（0 最常用，99 最具体）

function 装词频() {
  if (词频表) return 词频表
  词频表 = new Map()
  try {
    for (const l of readFileSync(词频路径, 'utf8').split('\n')) {
      const p = l.trim().split(/\s+/)
      if (p.length < 2) continue
      const v = Number(p[1])
      if (p[0] && Number.isFinite(v)) 词频表.set(p[0], v)
    }
    报信('词频表已装载：' + 词频表.size + ' 词')
  } catch (e) {
    词频表 = new Map()
    // ⭐ 1.8.20：不再静默 —— 词频丢过会让「通用中文门」整条失效且无从察觉
    报信('⚠ 词频表读取失败（通用中文门已失效，召回退回老行为）：' + 词频路径 + ' → ' + String((e && e.code) || e))
  }
  return 词频表
}

// 0~1：这个词在通用中文里有多「具体」。1 = 很少见（很具体），0 = 最常用 ✓
// ⚠ 不在表里 = 前 20000 名之外 = 很具体 → 1 ✓
function 通用稀有(k) {
  const m = 装词频()
  if (!m.size) return 1
  const v = m.get(k)
  if (v === undefined) return 1
  return v / 99
}

// 这个词算不算「线索」——最常用的那些中文词不算 ✓
//   门槛口径：**通用中文里最常用的前若干千个词**不当线索。
//   0.40 大约对应「词频前 4000 名」。实测（她那 40 句真话 + 10 句手写回归）：
//     挡掉「表示(0.34) 正式(0.39) 比较(0.35) 今天(0.35)」这些通用词，
//     留住「输(0.46) 一把(0.43) 婚礼(0.55) 生日(0.54) 胃(0.52) 抑郁(0.62)」✓
//   ⚠ 读不到词频表时通用稀有恒为 1 → 这道门自动失效 → 完全退回老行为，不会误伤新用户 ✓
const 通用门槛 = 0.4
const 算线索 = (k) => 通用稀有(k) >= 通用门槛
// 「只撞上正文、没撞上扩词」的那份证据打几折 ✓
//   0.6 是实测出来的：它把注入从 50 条压到 16 条，而**召回一条没掉** ✓
const 正文价 = 0.6
// 只撞上「扩词被切碎之后的一个干净碎片」时打几折（整条撞上 = 全价）✓
const 片价 = 0.8

const HAN_STOPS单 = new RegExp('^' + HAN_STOPS.source + '$')
const 是单字虚词 = (w) => w.length === 1 && HAN_STOPS单.test(w)

// 老切法（没有词表时的退路）—— 停用词切开，≤2 字整段收，更长抽相邻 2 字
function 老分词(s) {
  const out = new Set()
  const clean = normalize(s)
  for (const m of clean.matchAll(/[a-z0-9]{2,}/g)) {
    if (!EN_STOPS.has(m[0])) out.add(m[0])
  }
  for (const part of 中文片段(s)) {
    const chars = [...part]
    if (chars.length <= 2) out.add(part)
    else for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1])
  }
  return out
}

// 按词表切：每个位置取**最长的、词表里有的**那个词；一个都取不到就单字兜底 ✓
//   兜底的单字如果正好是虚词（的/了/我），当它不算线索，扔掉
//   ⚠ 兜底这一步是关键：**一个字都不丢** —— 老切法丢字，就是按词比对不上的原因
function 分词(s) {
  const 表 = 装词表()
  if (!表.size) return 老分词(s)
  const out = new Set()
  const clean = normalize(s)
  for (const m of clean.matchAll(/[a-z0-9]{2,}/g)) {
    if (!EN_STOPS.has(m[0])) out.add(m[0])
  }
  for (const run of clean.match(/[\u4e00-\u9fa5]+/g) || []) {
    let i = 0
    while (i < run.length) {
      let 长 = 0
      const 上限 = Math.min(词表最长, run.length - i)
      for (let n = 上限; n >= 1; n--) {
        if (表.has(run.slice(i, i + n))) {
          长 = n
          break
        }
      }
      const w = 长 === 0 ? run[i] : run.slice(i, i + 长)
      if (!是单字虚词(w)) out.add(w)
      i += 长 === 0 ? 1 : 长
    }
  }
  return out
}

function tokenize(s) {
  const 原文 = String(s || '')
  const 有 = 切词缓存.get(原文)
  if (有 !== undefined) return 有
  const out = 分词(s)
  if (切词缓存.size >= 切词缓存上限) 切词缓存.clear()
  切词缓存.set(原文, out)
  return out
}

export {
  HAN_STOPS,
  EN_STOPS,
  normalize,
  中文片段,
  装词表,
  装词频,
  通用稀有,
  通用门槛,
  算线索,
  正文价,
  片价,
  HAN_STOPS单,
  是单字虚词,
  老分词,
  分词,
  tokenize,
}
