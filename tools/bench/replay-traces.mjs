// tools/bench/replay-traces.mjs —— 用真实 trace 问句重放召回，对比 knowledgeStaysOut 0/1
//
// 为什么用这个而不是「主实例开几天」：真实问句都在主库 trace 里（每条带 query），
//   直接重放同一批问句、只在内存里切 policy，一天就能出结论，还完全不碰库。
//
// 用法：
//   node tools/bench/replay-traces.mjs [trace目录] [样本上限]
// 默认读 $DSH_HOME/clay-memory 下所有 *.traces.jsonl，取最近 500 条像问句的 query。
// ⚠ 只读：不改任何库文件，policy 只在本进程内存里改。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 默认读主实例的家目录；想重放别的实例就显式传 DSH_HOME=<那个家目录>
process.env.DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const { loadStoreJSON } = await import('../../lib/store-core.mjs')
const { recall } = await import('../../lib/scoring.mjs')

const 上限 = Number(process.argv[3] || 500)

// 只留像「对话问句」的：2~60 字、不含换行（排除那种整段任务 prompt）
const 全部 = []
const 第一参 = process.argv[2] || path.join(process.env.DSH_HOME, 'clay-memory')
// 也支持直接喂 queries.json（S0 那 42 句基准）：node replay-traces.mjs tools/bench/queries.json 42
if (/\.json$/i.test(第一参)) {
  const 集 = JSON.parse(fs.readFileSync(第一参, 'utf8'))
  const 问句们 = Array.isArray(集) ? 集 : (集.queries || [])
  for (const q of 问句们) {
    if (String(q).length >= 2) 全部.push({ sid: process.env.REPLAY_SID || 'diag', q: String(q), at: 0 })
  }
} else {
  for (const fn of fs.readdirSync(第一参)) {
    if (!fn.endsWith('.traces.jsonl')) continue
    const sid = fn.slice(0, -'.traces.jsonl'.length)
    let 文本 = ''
    try { 文本 = fs.readFileSync(path.join(第一参, fn), 'utf8') } catch (e) { continue }
    for (const ln of 文本.split('\n')) {
      if (!ln) continue
      let t = null
      try { t = JSON.parse(ln) } catch (e) { continue }
      const q = String(t.query || '')
      if (q.length >= 2 && q.length <= 60 && !q.includes('\n')) 全部.push({ sid, q, at: Number(t.at) || 0 })
    }
  }
}
全部.sort((a, b) => b.at - a.at)
// 同一条问句会被 trace 记很多次（多 step / 反复问），先按问句去重，保留最近那次
const 见过 = new Set()
const 不重 = []
for (const 项 of 全部) {
  if (见过.has(项.q)) continue
  见过.add(项.q)
  不重.push(项)
}
const 样本 = 不重.slice(0, 上限)

const 空统计 = () => ({ 总: 0, 有知识: 0, 知识条: 0, 字数: 0, 条数: 0 })
const 统计 = { 0: 空统计(), 1: 空统计() }
const 差异 = []
const 库缓存 = new Map()

for (const { sid, q } of 样本) {
  let data = 库缓存.get(sid)
  if (!data) {
    try { data = loadStoreJSON(sid) } catch (e) { data = { memories: [], policy: {} } }
    库缓存.set(sid, data)
  }
  if (!data || !data.memories || !data.memories.length) continue

  const 结果 = {}
  for (const k of [0, 1]) {
    const d = { ...data, policy: { ...(data.policy || {}), knowledgeStaysOut: k } }
    let r = null
    try { r = recall(d, q, Date.now(), sid) } catch (e) { continue }
    const sel = (r.selected || []).map((x) => (x && x.m) || x).filter(Boolean)
    const 知识 = sel.filter((m) => m.is_knowledge === true).length
    const s = 统计[k]
    s.总++
    s.条数 += sel.length
    s.字数 += r.字数 || 0
    s.知识条 += 知识
    if (知识 > 0) s.有知识++
    结果[k] = sel.map((m) => String(m.id))
  }
  if (结果[0] && 结果[1] && 结果[0].join() !== 结果[1].join()) 差异.push({ sid, q, a: 结果[0], b: 结果[1] })
}

console.log('样本问句：', 样本.length, '（覆盖会话', 库缓存.size, '个）')
for (const k of [0, 1]) {
  const s = 统计[k]
  const 率 = s.总 ? ((s.有知识 / s.总) * 100).toFixed(1) : '0.0'
  const 条均 = s.总 ? (s.条数 / s.总).toFixed(2) : '0'
  const 字均 = s.总 ? (s.字数 / s.总).toFixed(1) : '0'
  console.log(`staysOut=${k}: 有知识出现的问句 ${s.有知识}/${s.总}（${率}%），知识条合计 ${s.知识条}，平均召回 ${条均} 条 / ${字均} 字`)
}
console.log('结果不同的问句：', 差异.length, `（${样本.length ? ((差异.length / 样本.length) * 100).toFixed(1) : 0}%）`)
for (const d of 差异.slice(0, 15)) {
  console.log('---', d.q)
  console.log('  0:', 差异前(d.a), '→', 条数(d.a))
  console.log('  1:', 差异前(d.b), '→', 条数(d.b))
}

function 差异前(ids) { return JSON.stringify(ids.slice(0, 3)) }
function 条数(ids) { return ids.length + ' 条' }
