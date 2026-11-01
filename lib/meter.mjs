// ════════ 说话尺 / 切词 / 词面 / 稀有表 / 问句信息量 ════════
// 2026-10-30 从 index.js 拆出（拆层工程第 2 批）
// 依赖：./lexicon.mjs（normalize/中文片段/装词表/tokenize/EN_STOPS）+ 注入报信器（diag）
// 注意：说话尺不落盘 —— 每次从会话历史快照回放补齐（补历史尺），跨重启由宿主重喂
import { normalize, 中文片段, 装词表, tokenize, EN_STOPS } from './lexicon.mjs'

// 报信器由 index.js 注入（diag），测试里可以不接
let 报信 = (msg) => {}
export function 接诊断(fn) { 报信 = typeof fn === 'function' ? fn : (msg) => {} }

// ── 把一条消息的内容抽成文字（消息结构小工具，跟 补历史尺 一起搬过来）──
function textOfMessage(p) {
  if (!p) return ''
  if (typeof p === 'string') return p.slice(0, 2000)
  if (typeof p.text === 'string') return p.text.slice(0, 2000)
  if (typeof p.content === 'string') return p.content.slice(0, 2000)
  if (Array.isArray(p.content)) {
    const parts = []
    for (const b of p.content) {
      if (typeof b === 'string') parts.push(b)
      else if (b && typeof b.text === 'string') parts.push(b.text)
    }
    if (parts.length) return parts.join(' ').slice(0, 2000)
  }
  return ''
}

// ── 扩词的两层集合（依赖本文件的 切词）──
// ⭐ 「扩词」的两层集合 —— 整条 / 碎片 ✓
//   整条：模型挑出来的那个词，原样撞上才算「撞上要点」
//   碎片：整条被切词切开之后的小块。**只有当切开后没有单字碎块时**才收 ——
//     切开后剩下单字的，说明这次切分本身就切错了：
//       「演出来」→ 演出 + **来**   ← 切错了（来是虚字），碎片「演出」是假朋友 ✗
//       「心理医生」→ 心理 + 医生   ← 切对了，碎片「医生」是真能用的 ✓
//     实测这个口径把「她说的『正式演出』撞上『演出来』」那条挡掉了，
//     而「没去看**医生**」照样能想起抑郁那条 ✓
const 扩词集缓存 = new Map()
const 扩词集上限 = 4000
function 扩词集(m) {
  if (!Array.isArray(m && m.related) || !m.related.length) return null
  const 原 = m.related.join('\u0001')
  const 有 = 扩词集缓存.get(原)
  if (有 !== undefined) return 有
  const 整 = new Set()
  const 片 = new Set()
  for (const w of m.related) {
    const t = String(w || '').trim()
    if (!t) continue
    整.add(t)
    const 块 = [...切词(t)]
    if (块.length > 1 && !块.some((p) => p.length === 1)) for (const p of 块) 片.add(p)
  }
  const 出 = { 整, 片 }
  if (扩词集缓存.size >= 扩词集上限) 扩词集缓存.clear()
  扩词集缓存.set(原, 出)
  return 出
}

// ── 半个词判定 + 说话尺 + 稀有表 + 问句信息量 ──
// ---------- 「这半个词到底算不算一个词」 ----------
//
// 老切法把长度 >=3 的片段里**所有**相邻 2 字都收进来，于是「明天去公园」切出
//     明天 / 天去 / 去公 / 公园
// 其中 天去、去公 是**跨词碎片**：在语料里天生少见，被当成稀有线索，
// 把「这句话有多少信息量」抬起来 —— 报上来的那条误报就是它俩撑的
// （实测：门 1.98 → 0.59，门槛 0.8，正好从「过」变成「不过」）✓
//
// 判据只看**用户自己怎么用这两个字**，不维护任何词表。三个条件都满足才判成半个词：
//   ① 在用户嘴里出现过 >=3 次
//   ② 却从没被单独当一段用过（>=2 次）
//   ③ 而且**总黏着同一个邻居**（左右邻熵 <= 0.7 —— 真词的邻居五花八门，半个词是黏在另一半上的）
//     「天去」碎 11 次、单独 0 次、左邻熵 0.00 → 丢
//     「去公」碎  7 次、单独 1 次、最小邻熵 0.59 → 丢
//     「肚子」碎 11 次、单独 1 次、最小邻熵 1.67 → **留**（③ 把它救回来）
//     「花园」碎 565 次、单独 2 次 → 留（② 把它救回来）    「颜色」碎 0 次 → 留
//   ⚠ 第 ③ 条是 2026-09-21 补的：只按 ①② 会误杀「肚子」「开始」「阳台」这种
//     用户从来没单独用过、但确实是词的（实测「我肚子疼」被白挡成 0 条）。
//     0.7 这个位置不敏感：要丢的那批最小邻熵是 0.59 以下，要留的那批是 0.92 以上，中间是空带 ✓
// 一个片段里的 2 字**全**被判成半个词时，整段按原样切（不丢任何一个）——
//   这样「小明」「小红」「矿泉水」这种名字还有把手可以抓 ✓
//
// 换个人用，这套计数从那个人的话里长出来；语料还小的时候什么都不丢（= 原来的切法）✓
let 当前被丢 = null // Set<string>：这一次切词要丢掉的 2 字；null = 不过滤
let 当前搭配版本 = '无' // 这次挂的是哪个会话的第几版搭配表 —— 缓存键靠它区分 ✓

const 碎片下限 = 3 // ① 在她嘴里出现过这么多次…
const 整用下限 = 2 // ② …却从没被单独用过这么多次…
const 熵门 = 0.7 // ③ …而且邻居的杂乱程度低到这个地步 → 判成半个词
const 邻上限 = 8 // 一个词最多记这么多种邻居；记满了就说明「够杂」，不用再记 ✓

const 切词缓存2 = new Map() // 「过滤后」的切词缓存（跟上面那个原始缓存分开）
const 切词缓存2上限 = 4000

function 切词(s) {
  const 丢 = 当前被丢
  // ⭐⭐ 2026-09-23：**有词表时，不再过「半个词」这道** ✓
  //
  //   那套（碎/整/邻熵 → 判半个词）是给老切法擦屁股的：
  //   老切法把长串切成一堆相邻 2 字，于是造出「天去」「去公」这种**跨词碎片**，
  //   它们天生少见、被当成稀有线索，才需要靠搭配表把它们挑出来扔掉。
  //
  //   词表切出来的是**真词**，没有碎片可挑；再过滤只会**误杀真词** ——
  //   实测：「牛奶」在用户的话里总是黏着「茶」（左右邻熵低）→ 被判成半个词 →
  //   「奶茶」那轮**把「牛奶」扔了**，C 从该有的高度掉到 0.356，
  //   三条最该给的并列 0.356、条数上限跟着掉到 1 → **只给得出 1 条** ✗
  //
  //   → 有词表就跳过这道；没有词表（读不到文件）时，老路照走 ✓
  if (!丢 || !丢.size || 装词表().size) return tokenize(s) // 没有证据 → 一个字都不丢 ✓
  const key = 当前搭配版本 + '\u0001' + String(s || '')
  const 有 = 切词缓存2.get(key)
  if (有 !== undefined) return 有
  const out = new Set()
  const clean = normalize(s)
  for (const m of clean.matchAll(/[a-z0-9]{2,}/g)) {
    if (!EN_STOPS.has(m[0])) out.add(m[0])
  }
  for (const part of 中文片段(s)) {
    const chars = [...part]
    if (chars.length <= 2) {
      out.add(part)
      continue
    }
    const 候选 = []
    for (let i = 0; i + 1 < chars.length; i++) 候选.push(chars[i] + chars[i + 1])
    const 留 = 候选.filter((bg) => !丢.has(bg))
    if (留.length) for (const t of 留) out.add(t)
    else for (const t of 候选) out.add(t) // 全被判成半个词 → 按原样切（名字还有把手）✓
  }
  if (切词缓存2.size >= 切词缓存2上限) 切词缓存2.clear()
  切词缓存2.set(key, out)
  return out
}

// ---------- 召回：量的是「证据」，不是「重叠率」----------
//
// ⚠⚠ 2026-09-21 大改（她定的 A+B，先讨论后动手）。
//
// 老公式是    C = 命中的实词数 ÷ 问句的实词数
// 分母是**问句长短**，不是「有没有关系」。所以它在真数据上跑出来是**双峰**的：
//     短句（「在吗」「嗯」）   → 分母 1~2 → C 白送 1.0 → 六条全塞
//     长句（「我什么时候卖号的」）→ 分母 3~5 → C 上不去 → 一条都不给
// 她 09-19~09-20 说的 47 句真话回放：0 条 32% / 6 条 60%，中间几乎是空的。
// 也就是说：**不是太敏感，是又太敏感又太聋，同一个病根。**
//
// 新公式把「比例」换成「证据量」：
//     s = Σ 命中词的稀有度   ← **不除以问句长度**，跟句子长短无关
//     C = s / (s + K)        ← 饱和到 1，K 就是「算一半相关」的那个点
// 稀有度从**记忆库自己**算：出现得越多的词越不值钱（IDF 的思路），
// 而且**归一化成 0~1** —— 不然 850 条的库和 5 条的库量出来不是一个量级，
// 同一个 K 在两边不可能都对（这是实测踩到的：小库上什么都召不回来）✓
// 好处：通用。不用维护任何黑名单、同义词组，换个人用也一样自己长出来。
//
// ⚠ 顺手砍掉三条「白送分」的路（老代码里它们能凭空造出一个 C）：
//     for (const tag of m.tags) if (query.includes(tag)) C = max(C, 0.6)   ← 白送
//     for (const g of SYN_GROUPS) ...                     C = max(C, 0.5)   ← 白送
//     if (cue && ...)                                     C = max(C, 0.7)   ← 白送
//   报上来的那个案子就是第二行干的：某个会话里聊插件说了「记忆」，
//   于是所有带「档案/记得/忘记」的记忆一律 0.5 → 5 条全塞（跟插件毫无关系）✗
//   时间词（「今天」「昨天」）本来想表达的是「优先想起那天的」，那是**排序**的事，
//   所以改成乘在 P 上，不再凭空给 C ✓

// 一条记忆「能被匹配到的那个面」= 正文 + 标签 + 离线扩出来的相关词
// （照 切词缓存 的办法按原文缓存 —— 用 id 当键会在改文本之后拿到旧的 ✗）
const 词面缓存 = new Map()
const 词面缓存上限 = 4000

function 词面(m) {
  const 原文 =
    String((m && m.text) || '') +
    ' ' +
    ((m && m.tags) || []).join(' ') +
    ' ' +
    (Array.isArray(m && m.related) ? m.related.join(' ') : '')
  // ⚠ 这里返回的是**归一化后的整段文字**（不是词集）——
  //   现在只剩「整句原话有没有原样出现」那一条在用它，跟「搭配代次」无关，缓存键不用带版本 ✓
  const 有 = 词面缓存.get(原文)
  if (有 !== undefined) return 有
  const t = normalize(原文)
  if (词面缓存.size >= 词面缓存上限) 词面缓存.clear()
  词面缓存.set(原文, t)
  return t
}

// ⭐ 记忆那边的**词集** —— 给「按词比」用 ✓
// ⚠ 2026-09-23 才敢这么干：老切法会丢字（「她的胃不好」被切成「胃不好」，
//   问句「她的胃」只剩单字「胃」），按词比对不上，所以那时只能拿 includes 硬撞。
//   换成词表切之后**一个字都不丢**，两边就能正经按词比了 ✓
const 记忆词集缓存 = new Map()
const 记忆词集上限 = 4000

function 记忆词集(m) {
  const 原文 =
    String((m && m.text) || '') +
    ' ' +
    ((m && m.tags) || []).join(' ') +
    ' ' +
    (Array.isArray(m && m.related) ? m.related.join(' ') : '')
  // ⚠ 这个**跟搭配代次有关**（切词会过搭配表），所以键里要带版本 ✓
  const key = 当前搭配版本 + '\u0001' + 原文
  const 有 = 记忆词集缓存.get(key)
  if (有 !== undefined) return 有
  const s = 切词(原文)
  if (记忆词集缓存.size >= 记忆词集上限) 记忆词集缓存.clear()
  记忆词集缓存.set(key, s)
  return s
}

// 稀有度表：每个词出现在多少条记忆里。跟着记忆库走，记忆一改指纹就变、自然重算 ✓
// 指纹用「条数 + 每条的字数」，比逐条比文本便宜得多，也不会因为改一个字就漏掉
let 稀有缓存 = { 指纹: '', df: null }

function 稀有表(memories) {
  let 指纹 = String(memories.length)
  for (const m of memories) 指纹 += ',' + String(m && m.text ? m.text.length : 0) + '.' + String(m && m.tags ? m.tags.length : 0)
  if (稀有缓存.df && 稀有缓存.指纹 === 指纹) return 稀有缓存.df
  const df = new Map()
  for (const m of memories) {
    // ⚠ 记忆那边**故意不过滤**（走原始切法）：
    //   ① 多留几个词只会更宽松，不会漏配；② 它就不用跟着搭配版本反复重切 851 条
    //   问句那边切出来的词，要么是「被单独用过的词」，要么是整段全判成半个词时按原样切的，
    //   两种都能在这张原始词表里查到 ✓
    for (const k of tokenize(词面(m))) df.set(k, (df.get(k) || 0) + 1)
  }
  df.总条数 = memories.length
  // ⚠ 归一化用的顶：只在**一条**记忆里出现的词就是最值钱的，记作 1.00 ✓
  df.顶 = Math.log((memories.length + 1) / 2)
  稀有缓存 = { 指纹, df }
  return df
}

// 归一化过的稀有度：0 ~ 1。1 = 只在一条记忆里出现过，0 = 每条记忆里都有它 ✓
// ⚠⚠ 2026-09-22：**必须夹到 1 以内** —— 原来没夹，`df = 0` 的词会算到 **1 以上** ✗
//   而 df = 0 的意思是「这个字符串**在记忆库里从来不是一个词**」——
//   多半是**假词**（单字撞进了长词里）或者**单字**
//   （「一」「胃」「饿」，因为切词器会把「她的胃」切成单字「胃」）。
//   不夹的话，**越假越值钱**：实测那种假词拿到 1.12，比任何真词都高 ✗
//   （夹到 1 只是止血；假词的根子在 `includes` 撞字符串，见 evaluate 里那段说明）
const 稀有度 = (df, k) => {
  // ⚠⚠ 2026-09-23（自检逮到的边缘 bug）：**库里只剩 1 条时，什么都想不起来** ✗
  //   归一化的顶是 log((N+1)/2) —— N=1 时 = log(1) = **0**，
  //   于是 `!(顶 > 0)` 直接返回 0 → 证据 s 全是 0 → C=0 → 一条都不给。
  //   新用户刚记下第一条、或者别的条目都被「跳过/作废」过滤掉时就会撞上，
  //   表现是「记了东西却怎么都想不起来」，很难查。
  //   → 库里 <= 1 条时不归一化：**有它就算数**（给 1）✓
  if (!(df.总条数 > 1)) return df.get(k) ? 1 : 0
  if (!(df.顶 > 0)) return 0
  const v = Math.log((df.总条数 + 1) / ((df.get(k) || 0) + 1)) / df.顶
  return v > 1 ? 1 : v > 0 ? v : 0
}

// ---------- 「她自己怎么说话」这把尺子 ----------
//
// 治「太敏感」的那一刀不能砍在记忆上，得砍在**问句**上：
// 「在吗」「嗯」「哈哈」这种话，不管拿什么公式去跟几百条记忆比，总能比出六条来
// （这个我用真数据试过：只换打分公式，它们照样六条）。
// 但「这句话本身有没有值得翻记忆的东西」是可以量的 ——
// 尺子就是**用户自己说过的话**：天天挂在嘴边的词（在吗）不算信息，偶尔才说的（护照）才算。
//
// 实测（拿用户 2048 句真话当尺子）：
//   在吗 753/2048 句 → 0.29      护照 8 句 → 高
//   嗯    56 句                   体检 4 句 → 高
// 这把尺子自己长出来：监听本会话收到的每一条消息，第一次要用时再从会话历史里补一遍。
// 不需要任何词表 —— 以后发仓库给别人用，他的尺子从他的话里长，不会带着我们的口味 ✓
const 说话尺 = new Map() // sid -> { n, df, 碎, 整, 被丢, 装过 }

function 拿尺(sid) {
  const key = String(sid || '')
  let r = 说话尺.get(key)
  if (!r) {
    r = { n: 0, df: new Map(), 碎: new Map(), 整: new Map(), 邻: new Map(), 被丢: new Set(), 版本: 0, 装过: false }
    说话尺.set(key, r)
  }
  return r
}

// ⭐ 数「这两个字她是怎么用的」：
//     碎 = 夹在长片段里的次数（明天去公园 → 天去、去公 各 +1）
//     整 = 被单独当一段用的次数（「去公」当一整段出现 → +1）
//   ⚠ 这两个计数**不能**走过滤后的切词 —— 判据本身要是被它判过的东西，就自己咬自己了，
//     所以这里永远用原始片段（中文片段）来数 ✓
function 记一句结构(r, text) {
  for (const p of 中文片段(text)) {
    const c = [...p]
    const 整过 = r.整.get(p) || 0
    r.整.set(p, 整过 + 1)
    // 单独用过 >=2 次 → 撤销「半个词」的判定（「花园」就是这么救回来的）✓
    if (整过 + 1 === 整用下限 && r.被丢.has(p)) {
      r.被丢.delete(p)
      r.版本++
    }
    if (c.length <= 2) continue
    for (let i = 0; i + 1 < c.length; i++) {
      const bg = c[i] + c[i + 1]
      const n = (r.碎.get(bg) || 0) + 1
      r.碎.set(bg, n)
      // 左右邻居：判「是不是总黏着同一个字」。记满 邻上限 种就标记「够杂」，不再记 ✓
      记邻居(r, bg, 'L', i > 0 ? c[i - 1] : '边')
      记邻居(r, bg, 'R', i + 2 < c.length ? c[i + 2] : '边')
      if (n >= 碎片下限) 判半个词(r, bg)
    }
  }
}

function 记邻居(r, bg, 侧, ch) {
  const key = 侧 + bg
  let m = r.邻.get(key)
  if (!m) {
    m = new Map()
    r.邻.set(key, m)
  }
  if (m.够杂) return
  m.set(ch, (m.get(ch) || 0) + 1)
  if (m.size >= 邻上限) {
    m.够杂 = true
    m.clear()
  }
}

function 熵(m) {
  let n = 0
  for (const v of m.values()) n += v
  if (!n) return 0
  let h = 0
  for (const v of m.values()) {
    const p = v / n
    h -= p * Math.log2(p)
  }
  return h
}

function 侧熵(r, bg, 侧) {
  const m = r.邻.get(侧 + bg)
  if (!m) return 0
  return m.够杂 ? 99 : 熵(m)
}

// 三个条件都满足才判成半个词；判完就写进 被丢，并且**每次新句子都重判一次**
// （邻居越攒越多，一个词随时可能从「半个词」翻回「是个词」）✓
function 判半个词(r, bg) {
  const 该丢 =
    (r.整.get(bg) || 0) < 整用下限 && Math.min(侧熵(r, bg, 'L'), 侧熵(r, bg, 'R')) <= 熵门
  if (该丢 === r.被丢.has(bg)) return
  if (该丢) r.被丢.add(bg)
  else r.被丢.delete(bg)
  r.版本++
}

function 记一句话(sid, text) {
  const s = String(text || '').trim()
  if (!s || s.length > 1000) return
  const r = 拿尺(sid)
  r.n++
  for (const k of tokenize(s)) r.df.set(k, (r.df.get(k) || 0) + 1)
  记一句结构(r, s)
}

// 这个会话当前要丢掉哪些「半个词」✓
function 搭配集(sid) {
  return 拿尺(sid).被丢
}

// 把某个会话的搭配表挂上（切词、稀有表、问句门都靠它）——
// 返回版本号，缓存键带上它，搭配表一变缓存自然失效 ✓
function 装搭配(sid) {
  if (!sid) {
    当前被丢 = null
    当前搭配版本 = '无'
    return 当前搭配版本
  }
  const r = 拿尺(sid)
  当前被丢 = r.被丢
  当前搭配版本 = String(sid) + '#' + r.版本
  return 当前搭配版本
}

// 第一次要用的时候从会话历史里补一遍（只做一次，最多回看 2000 句）
function 补历史尺(sid, session) {
  const r = 拿尺(sid)
  if (r.装过) return r
  r.装过 = true
  try {
    if (!session || typeof session.snapshotEvents !== 'function') return r
    const ev = session.snapshotEvents() || []
    let 收 = 0
    for (let i = ev.length - 1; i >= 0 && 收 < 2000; i--) {
      const e = ev[i]
      if (!e || e.type !== 'user/message') continue
      const p = e.payload !== undefined ? e.payload : e.data && e.data.message !== undefined ? e.data.message : e.data
      const txt = textOfMessage(p)
      if (!txt) continue
      记一句话(sid, txt)
      收++
    }
    报信('  说话尺补齐：' + 收 + ' 句')
  } catch (error) {
    报信('  说话尺补历史失败：' + (error && error.message))
  }
  return r
}

// 这句话本身有多少信息量。返回的是**归一化过**的值（0 ~ 几个「最稀有的词」）——
// 不归一化的话它会跟着「过多少句话」一起变大，门槛就成了个只对当前样本成立的数 ✓
// ⚠ 只算「在记忆库里真能当线索用」的词：切词切出来的「宝今」「天干」这种跨词碎片
//   在记忆里根本不存在，不该被算成信息（不然长词会被自己的碎片抬起来）✓
function 问句信息量(sid, query, df) {
  const r = 拿尺(sid)
  if (r.n < 20) return Infinity // 样本太少，门先不开，免得误杀
  const 顶 = Math.log(r.n + 1)
  if (!(顶 > 0)) return Infinity
  装搭配(sid) // ⭐ 半个词不算线索（「天去」「去公」不该给这句话加分）✓
  let v = 0
  for (const k of 切词(query)) {
    if (!df.get(k)) continue
    // ⚠ 这道门**没动** —— 试过让它也乘「通用稀有」，在真数据上没帮上忙
    //   （她那些话里的词要么够具体、要么本来就该被门放行），所以保持原样 ✓
    v += Math.log((r.n + 1) / ((r.df.get(k) || 0) + 1))
  }
  return v / 顶
}

export {
  textOfMessage,
  扩词集,
  切词,
  词面,
  记忆词集,
  稀有表,
  稀有度,
  拿尺,
  记一句话,
  记一句结构,
  装搭配,
  补历史尺,
  问句信息量,
  搭配集,
  说话尺,
}
