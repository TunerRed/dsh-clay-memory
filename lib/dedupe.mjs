// 黏土记忆 · 重复项自动整理
//
// 2026-11-16（1.12.46，她拍板「可以的」）：
//   问题：库里已经存着的重复没人管 —— 设置页的「查重」是**手动**点的，
//   主人不会天天去点；写过的事实键能自动收敛，但**没写键的、跨键同义的**只能靠人。
//   实测存量：B站内容口味画像 661 字和 416 字两条都在（同一件事的旧版 + 新版），
//   问「我 B站爱看什么」时两条同款互相挤名额。
//
// 但是「自动删记忆」是全插件最危险的操作，所以这里的规矩比手动查重**更严**：
//
//   1. **只合「真重复」，绝不碰「汇总」** —— 一条长的包住几条短的（像度够但长短差太多）
//      合了就把短条的细节吃掉了。那种永远只报告、不自动动。
//   2. 门槛比手动查重收紧一档：手动用「像度 ≥0.85 且长比 ≥0.8」，
//      自动用「像度 ≥0.9 且长比 ≥0.9」，再补一道**独有句子**检查 ——
//      两条各自都有对方没有的句子，说明不是真重复，只是撞词，不合。
//      宁可漏合，不许错合。
//   3. 合并**不丢信息**：留长的正文，短条里对方没有的句子追加在后面。
//      被合的那条进回收站（`deleted`），能找回来。
//   4. 全流程记账：合了哪两条、合前合后多少字，写进 diag + 配置里的整理记录，设置页能翻。
//      不做黑盒 —— 她最烦这个（原话：「看不到整理了哪些记忆吗」）。
import { 词集, 像度 } from './scoring.mjs'
import { loadCfg, saveCfg } from './cfg.mjs'
import { diag } from './diag.mjs'

// 自动合并的判定门槛。手动查重用的是 `重复门槛 0.75` / `真重复门槛 0.85`，
// 自动这边必须更严 —— 没有人在旁边看着。
export const 自动像度门槛 = 0.9
// 允许短条有几句是长条没有的。0 = 一句都不许丢；这里给 1 是因为合并时会把那 1 句
// 追加到长条后面（见 `合并正文`），信息不丢。≥2 句说明短条有独立内容，不该合。
export const 自动独有句上限 = 1
// 太短的零碎条目一律不自动合 —— 八个字的一句话就算词全被长条包含，
// 也可能是件独立的小事，删了找不回来的风险不值当。
export const 自动最短条 = 20
// 一轮最多合多少对（防止配置坏了 / 库异常时一次改掉太多）
export const 一轮合并上限 = 20

// ⚠⚠ 2026-11-16 深夜修正（第一版设计错了）：
//   第一版用「像度 ≥0.9 **且长比 ≥0.9**」，本意是「只合长短差不多的真重复」。
//   拿主库 459 条一跑，**0 对** —— 因为像度是词集的重合度，长条词多、短条词全被包含，
//   像度直接 1.000，可长比只有 0.12~0.67。也就是说主库里所有「重复」都是**汇总型**
//   （短条被长条完整包住），一对等长真重复都没有。
//   → 「长短差不多」根本不是判据。真正该问的是**短条里有没有长条没有的东西**：
//     一句都没有 → 短条的信息长条全有，合了不丢东西；
//     有两句以上 → 短条有独立内容，不许合。
//   所以门槛改成「像度够硬 + 短条独有句 ≤1 + 短条别太短」，长比彻底去掉。

// 按句末标点切句，滤掉空的和太短的（「好」「嗯」这种碎句会让"独有"判定失真）
export function 切句子(text) {
  return String(text || '')
    .split(/[。！？；\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
}

// 一句算不算「对方没有的」：看这句的实词在对方**整段**里覆盖了多少。
// < 这条线 = 对方没讲过这段意思，算独有（合并时要补过去）。>= 就算对方已经有了。
// 为什么不是「跟对方每一句比整句像度」：同义改写的两句，前半不同就能把整句像度拉到线下，
// 后半段明明一字不差也会被当成独有 —— 真机就是这么把一段话补成两遍的。
export const 独有覆盖线 = 0.7

function 是独有句(句, 对方词集) {
  const 此 = [...词集(句)]
  if (!此.length) return false
  let 命中 = 0
  for (const w of 此) if (对方词集.has(w)) 命中 += 1
  return 命中 / 此.length < 独有覆盖线
}

// a 里有几句是 b 完全没有的。
// ⚠⚠ 2026-11-16 深夜修（真机第 4 对合出了重复）：
//   原来拿「短条的每一句」跟「长条的每一句」比**整句像度**（≥0.85 算找得到）。
//   真机抓到的病：两句同义改写，只有前半段不同、后半段一字不差 ——
//     长：起因是想给每轮回复挂一份「检查清单」，格式参考…四步：分析输入 → 定策略 → 起草 → 润色
//     短：起因是主人想要「检查本轮回复」的提示，格式参考…四步：分析输入 → 定策略 → 起草 → 润色
//   整句像度被前半段拉低，判成「独有」→ 追加 → 一段话里「格式参考…四步」说了两遍。
//   真正该问的是「这句的实词，长条整段覆盖了多少」—— 后半段明明一字不差，覆盖率 0.86，
//   不该算独有。所以改成**词覆盖口径**（≥0.7 就算长条已经有这段意思）。
//   代价：真独有的句子如果大量复用长条的词汇，也会被判成「已有」而不追加 ——
//   宁可漏补一句，也别制造重复：漏补只是少一句补充，重复是每轮注入都带着的冗余。
export function 独有句数(a, b) {
  const b词 = 词集(b)
  let n = 0
  for (const s of 切句子(a)) if (是独有句(s, b词)) n += 1
  return n
}

// 两条够不够格自动合并
export function 够格自动合并(a, b) {
  const ta = String((a && a.text) || '')
  const tb = String((b && b.text) || '')
  if (ta.length < 自动最短条 || tb.length < 自动最短条) return false
  if (像度(词集(ta), 词集(tb)) < 自动像度门槛) return false
  // 谁长谁短：合掉的是短的那条，所以只关心「短条有没有长条没有的东西」。
  // 长条有更多内容是正常的（它就是更详细那份），不用管。
  const 长文本 = ta.length >= tb.length ? ta : tb
  const 短文本 = 长文本 === ta ? tb : ta
  // 短条一句都不独有 = 它的内容长条全有，合了不丢信息；
  // 有 1 句独有 = 合并时会把那 1 句补到长条后面（`合并正文`），也不丢。
  if (独有句数(短文本, 长文本) > 自动独有句上限) return false
  return true
}

// 合并正文：留长的，把短的里「长的没有的」句子追加在后面。
// 为什么不直接把两条拼起来：那就是把重复的话说两遍，注入时纯浪费预算。
export function 合并正文(长文本, 短文本) {
  const 长 = String(长文本 || '').trim()
  const 短 = String(短文本 || '').trim()
  const 长词 = 词集(长)
  // ⚠ 2026-11-16 深夜：这里原来用的是「短句 vs 长句整句像度 ≥0.85」，跟 `独有句数` 同款毛病，
  //   真机第 4 对就是这么补出重复的。现在两处统一走 `是独有句` 的词覆盖口径。
  const 独有 = 切句子(短).filter((s) => 是独有句(s, 长词))
  if (!独有.length) return 长
  return 长 + '\n补充：' + 独有.join('；')
}

// 扫一遍库，把够格的真重复合掉。
// 返回 { 合了, 明细, 扫过 }，不改动任何东西以外的东西 —— 调用方负责落盘。
//
// ⚠ 只在「同一类」里比：画像跟知识、这个类别跟那个类别，永远不互合。
//   一条「主人喜欢大白饭」的画像和一条「Kafka 消费组」的知识就算都提到 Kafka，
//   也不是一回事，合了纯属灾难。
export function 找可合的(data) {
  const 活的 = (data && Array.isArray(data.memories) ? data.memories : []).filter(
    (m) => m && !m.deletedAt && m.text,
  )
  const 已用 = new Set()
  const 明细 = []
  for (let i = 0; i < 活的.length; i++) {
    const a = 活的[i]
    if (已用.has(String(a.id))) continue
    for (let j = i + 1; j < 活的.length; j++) {
      if (明细.length >= 一轮合并上限) return { 明细, 扫过: 活的.length }
      const b = 活的[j]
      if (已用.has(String(b.id))) continue
      if ((a.category || '') !== (b.category || '')) continue
      if (Boolean(a.is_knowledge) !== Boolean(b.is_knowledge)) continue
      if (!够格自动合并(a, b)) continue
      const 长的 = String(a.text).length >= String(b.text).length ? a : b
      const 短的 = 长的 === a ? b : a
      已用.add(String(长的.id))
      已用.add(String(短的.id))
      明细.push({ 留: 长的, 合: 短的 })
      break // a 已经配上了，别再给它配第二个
    }
  }
  return { 明细, 扫过: 活的.length }
}

// 执行合并。返回一份给人看的记录。
// ⚠ data 是就地改的，落盘交给调用方（跟项目里其它写操作的约定一致）。
export function 执行合并(data, 明细) {
  if (!Array.isArray(data.deleted)) data.deleted = []
  const 按id = new Map((data.memories || []).map((m) => [String(m.id), m]))
  const 记录 = []
  let 省下 = 0
  for (const { 留, 合 } of 明细) {
    const 长 = 按id.get(String(留.id))
    const 短 = 按id.get(String(合.id))
    if (!长 || !短) continue
    const 合前长 = String(长.text || '').length
    const 合前短 = String(短.text || '').length
    长.text = 合并正文(长.text, 短.text)
    // 重要度取两者较高的 —— 合并后不该比任何一条更不重要
    长.importance = Math.max(Number(长.importance) || 0, Number(短.importance) || 0)
    // 时间取早的：这条记忆最初是什么时候形成的
    if (短.createdAt && (!长.createdAt || 短.createdAt < 长.createdAt)) 长.createdAt = 短.createdAt
    长.合并自 = (Array.isArray(长.合并自) ? 长.合并自 : []).concat([String(短.id)])
    短.deletedAt = new Date().toISOString()
    短.合并掉的 = true // 跟普通「删」区分开，将来想找回来好认
    短.合并进了 = String(长.id)
    data.deleted.push(短)
    省下 += 合前长 + 合前短 - String(长.text).length
    记录.push({
      id: String(短.id),
      进: String(长.id),
      合前: 合前长 + '+' + 合前短 + ' 字',
      合后: String(长.text).length + ' 字',
      摘要: String(短.text || '').slice(0, 40),
    })
  }
  if (记录.length) data.memories = (data.memories || []).filter((m) => !m.合并掉的)
  return { 记录, 省下 }
}

// 距上次整理够久了吗（默认 24 小时跑一次）
export function 该整理了(间隔小时 = 24) {
  try {
    const c = loadCfg()
    const 上次 = Date.parse(String(c._上次整理 || ''))
    if (!Number.isFinite(上次)) return true
    return Date.now() - 上次 >= 间隔小时 * 3600 * 1000
  } catch (error) {
    return false // 配置读不出来就别动 —— 宁可跳过一轮，也不瞎跑
  }
}

// 把这次的整理结果记进配置（只留最近 20 次），设置页能翻
export function 记整理结果(记录们, 省下) {
  try {
    const c = loadCfg()
    c._上次整理 = new Date().toISOString()
    const 旧 = Array.isArray(c._整理记录) ? c._整理记录 : []
    const 新 = [{ 时间: c._上次整理, 合了: 记录们.length, 省下: 省下, 明细: 记录们.slice(0, 10) }].concat(旧)
    c._整理记录 = 新.slice(0, 20)
    saveCfg(c)
  } catch (error) {
    diag('自动整理：记结果失败 ' + String((error && error.message) || error))
  }
}
