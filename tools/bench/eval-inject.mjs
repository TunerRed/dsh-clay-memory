// tools/bench/eval-inject.mjs —— 注入策略离线评测脚手架
//
// 起因（2026-11-16 深夜，两份外部评审）：
//   Gemini 指出「省 370 字 vs 多一次 tool call」这笔账得先算清；GPT 指出
//   「索引卡是数据视图，不是新的记忆类型」并且要先做离线 A/B、量的是
//   应查未查率 / 关键遗漏率 / 无效注入率，而不是字数。
//
// 这一版只做**机械层**（不调模型、不判对错）：同一批问题、同一份库，
// 比较四种注入形态在「注入了什么」上的差异。端到端正确性要接模型，
// 接口留在 buildPrompt()，由外部评测机调用。
//
// ⚠ 只读：loadStoreJSON 只读不写；policy 只在本进程内存里覆盖。
//
// 用法：
//   node tools/bench/eval-inject.mjs                      # 用内置语料，只跑词面
//   node tools/bench/eval-inject.mjs --embed              # 带语义（慢，要加载模型）
//   node tools/bench/eval-inject.mjs --out 报告.md        # 写 markdown 报告
//   node tools/bench/eval-inject.mjs --corpus 语料.json   # 换语料
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const { loadStoreJSON } = await import('../../lib/store-core.mjs')
const { recall, render } = await import('../../lib/scoring.mjs')

const 参数 = process.argv.slice(2)
const 有 = (k) => 参数.includes(k)
const 取值 = (k, 默认) => {
  const i = 参数.indexOf(k)
  return i >= 0 && 参数[i + 1] ? 参数[i + 1] : 默认
}
const 会话 = 取值('--session', 'diag')
const 输出 = 取值('--out', '')
const 语料路径 = 取值('--corpus', '')

/** 索引卡：一条知识压成「主题 + 关键结论」，而不是截前 N 字（GPT 评审的第 3 条） */
const 索引字数 = 34
function 做索引(文本, id) {
  const 干净 = String(文本 || '').replace(/\s+/g, ' ').trim()
  // 不截前 N 字，而是尽量截到第一个句末标点，实在没有才硬截
  const 句 = 干净.match(/^[^。！？；]{6,}?[。！？；]/)
  const 主体 = 句 ? 句[0] : 干净
  const 短 = 主体.length > 索引字数 ? 主体.slice(0, 索引字数) + '…' : 主体
  return `- [${id}] ${短}（需要细节就调 memory_search）`
}

/** 策略表：policy 覆盖 + 呈现改写 */
const 策略们 = [
  {
    名: 'baseline',
    说明: '现状：知识进事件队全文注入',
    policy: {},
    改写: null,
  },
  {
    名: 'no-knowledge',
    说明: '知识完全不注入，只留搜索工具（Gemini 说的 A）',
    // ⚠ 不能用 knowledgeStaysOut: 0 来表达「不注入知识」—— 那个开关是二选一：
    //   =1 知识退出常驻、留在事件队；=0 知识留在常驻、退出事件队。永远有一条队能进。
    //   要真的「一条知识都不注入」，只能在 recall 之后把知识条剔掉（下面 改写）。
    policy: {},
    改写: (行们) => 行们.filter((r) => !(r.m && r.m.is_knowledge)),
  },
  {
    名: 'index-card',
    说明: '知识降级成索引卡（GPT 说的 L2）',
    policy: {},
    改写: (行们) => 行们.map((r) => (r.m && r.m.is_knowledge ? { ...r, 索引版: 做索引(r.m.text, r.m.id) } : r)),
  },
  {
    名: 'task-first',
    说明: '最多 1 条知识全文，其余降级成索引卡',
    policy: {},
    改写: (行们) => {
      let 给了 = 0
      return 行们.map((r) => {
        if (!r.m || !r.m.is_knowledge) return r
        if (给了 < 1) {
          给了 += 1
          return r
        }
        return { ...r, 索引版: 做索引(r.m.text, r.m.id) }
      })
    },
  },
]

/** 一条 selected 行实际会占多少字、会不会带上正文 */
function 估行(r) {
  if (r.索引版) return r.索引版.length
  return String(r.注入文本 !== undefined ? r.注入文本 : (r.m && r.m.text) || '').length
}

/** 把 selected 渲染成最终注入文本（索引版走索引，正文走走原 render） */
function 组装(selected, 策略, 现在, 自称) {
  const 正文行 = selected.filter((r) => !r.索引版)
  const 索引行 = selected.filter((r) => r.索引版)
  const 段 = []
  const 正文 = 正文行.length ? render(正文行, 现在, 自称) : ''
  if (正文.trim()) 段.push(正文.trim())
  if (索引行.length) {
    段.push('【库里有你的笔记】\n' + 索引行.map((r) => r.索引版).join('\n'))
  }
  return 段.join('\n\n')
}

/** 评测一条语料 */
function 评一句(data, 条目, 策略, 现在, 自称) {
  const merged = { ...data, policy: { ...data.policy, ...策略.policy } }
  const 结果 = recall(merged, 条目.q, 现在, 会话, 自称, null)
  let 行们 = 结果.selected || []
  if (策略.改写) 行们 = 策略.改写(行们)
  const 文本 = 组装(行们, 策略, 现在, 自称)
  const ids = new Set(行们.map((r) => (r.m && r.m.id) || ''))
  const 目标 = 条目.目标 || []
  const 命中 = 目标.filter((id) => ids.has(id))
  // ⭐ 全文命中 vs 只给索引：这是四种策略真正的分水岭 ——
  //   索引卡「召回到了」但模型看不到内容，得自己决定去查（Gemini 说的过早满足风险）。
  const 命中全文 = 目标.filter((id) => {
    const r = 行们.find((x) => x.m && x.m.id === id)
    return r && !r.索引版
  })
  const 知识条 = 行们.filter((r) => r.m && r.m.is_knowledge)
  const 画像条 = 行们.filter((r) => r.m && !r.m.is_knowledge)
  const 误注入 = 目标.length ? 行们.filter((r) => r.m && !目标.includes(r.m.id)) : []
  return {
    q: 条目.q,
    类: 条目.类 || '未分类',
    条数: 行们.length,
    字数: 文本.length,
    知识条: 知识条.length,
    画像条: 画像条.length,
    目标: 目标.length,
    命中: 命中.length,
    命中全文: 命中全文.length,
    误注入: 误注入.length,
    字符: 文本,
  }
}

// ── 语料 ────────────────────────────────────────────────────────────
// 内置语料分五类，对应两份评审点名的四种场景 + 非词面自然语言。
// 「目标」是人工确认的必须命中条（知道 id 的填，不知道留空 → 该句只统计注入形态）。
const 内置语料 = [
  // ① 普通知识：模型自己多半会答（有笔记但对不对得上不明显）
  { q: 'Kafka 手动提交应该怎么写', 类: '普通知识', 目标: ['imvql7mno242'] },
  { q: 'Nginx 的 proxy_pass 参数一般怎么配', 类: '普通知识' },
  // ② 用户专属经验：必须依赖历史记忆
  { q: '之前那个 Kafka 重复消费最后怎么解决的', 类: '专属经验', 目标: ['imvql7mno242'] },
  { q: '上次调 Anima 碰到的坑', 类: '专属经验', 目标: ['imvql7mjb154'] },
  { q: '老的那个记忆库挪哪去了', 类: '专属经验', 目标: ['imvql7mih862'] },
  { q: '还记得我喜欢吃什么吗', 类: '专属经验', 目标: ['mmwa5cyaf550'] },
  { q: '关进程的脚本会把自己弄死是为啥', 类: '专属经验', 目标: ['imvql7mjd17'] },
  // ③ 历史失败方案：否定性记忆 —— 库里目前一条都没有，这几句就是用来暴露缺口的
  { q: '上次那个方案为什么不行', 类: '否定性' },
  { q: '之前试过什么办法失败了', 类: '否定性' },
  // ④ 延续性任务：过程性记忆 —— 同样缺
  { q: '继续上次没做完的事', 类: '延续性' },
  { q: '上次那个任务做到哪一步了', 类: '延续性' },
  // ⑤ 非词面自然语言：GPT 特别点名要测的
  { q: '之前那个服务又出问题了', 类: '非词面' },
  { q: '我想接着搞昨天那个', 类: '非词面' },
  { q: '今天好累', 类: '非词面' },
]

let 语料 = 内置语料
if (语料路径) {
  const 外 = JSON.parse(fs.readFileSync(语料路径, 'utf8'))
  语料 = Array.isArray(外) ? 外 : 外.queries || []
}

// ── 跑 ──────────────────────────────────────────────────────────────
const data = loadStoreJSON(会话)
if (!data) {
  console.error(`读不到库：会话 ${会话}（DSH_HOME=${process.env.DSH_HOME}）`)
  process.exit(1)
}
const 现在 = Date.now()
const 自称 = 取值('--self', '鲸鱼娘')
const 库 = data.memories || []
const 知识数 = 库.filter((m) => m.is_knowledge).length

const 结果表 = []
for (const 策略 of 策略们) {
  const 行 = []
  for (const 条目 of 语料) 行.push(评一句(data, 条目, 策略, 现在, 自称))
  const 有目标 = 行.filter((r) => r.目标 > 0)
  const 总目标 = 有目标.reduce((a, r) => a + r.目标, 0)
  const 总命中 = 有目标.reduce((a, r) => a + r.命中, 0)
  const 总全文 = 有目标.reduce((a, r) => a + r.命中全文, 0)
  结果表.push({
    名: 策略.名,
    说明: 策略.说明,
    句数: 行.length,
    有目标句: 有目标.length,
    均条: +(行.reduce((a, r) => a + r.条数, 0) / 行.length).toFixed(1),
    均字: Math.round(行.reduce((a, r) => a + r.字数, 0) / 行.length),
    知识均: +(行.reduce((a, r) => a + r.知识条, 0) / 行.length).toFixed(1),
    画像均: +(行.reduce((a, r) => a + r.画像条, 0) / 行.length).toFixed(1),
    空轮: 行.filter((r) => r.条数 === 0).length,
    总目标,
    总命中,
    总全文,
    关键遗漏: 总目标 ? 1 - 总命中 / 总目标 : null,
    误注入: 行.reduce((a, r) => a + r.误注入, 0),
    明细: 行,
  })
}

// ── 报告 ────────────────────────────────────────────────────────────
const L = []
L.push('# 注入策略离线评测（机械层）')
L.push('')
L.push(`- 时间：${new Date().toLocaleString('zh-CN')}`)
L.push(`- 库：会话 \`${会话}\`，共 **${库.length}** 条（知识 ${知识数} / 画像 ${库.length - 知识数}）`)
L.push(`- 语料：**${语料.length}** 句（${[...new Set(语料.map((x) => x.类 || '未分类'))].join(' / ')}）`)
L.push(`- 语义路：${有('--embed') ? '开' : '关（只测词面，先看机械形态）'}`)
L.push('')
L.push('> ⚠ 这一版**不调模型**，所以不判断「答得对不对」，只看「注入了什么」。')
L.push('> 端到端正确性 / 应查未查率要接模型跑，语料和指标已经按那个口径设计好。')
L.push('')
L.push('## 汇总')
L.push('')
L.push('| 策略 | 均条数 | 均字数 | 知识条 | 画像条 | 空轮 | 目标命中（全文/仅索引） | 关键遗漏率 | 误注入 |')
L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const r of 结果表) {
  const 命中 = `${r.总命中}/${r.总目标}（${r.总全文}/${r.总命中 - r.总全文}）`
  const 遗漏 = r.关键遗漏 === null ? '—' : `${(r.关键遗漏 * 100).toFixed(0)}%`
  L.push(`| ${r.名} | ${r.均条} | ${r.均字} | ${r.知识均} | ${r.画像均} | ${r.空轮} | ${命中} | ${遗漏} | ${r.误注入} |`)
}
L.push('')
L.push('**读表提示**')
L.push('')
L.push('- `目标命中（全文/仅索引）`：括号里是「模型能直接看到内容」与「只给了索引卡」的拆分 —— 索引卡命中 ≠ 模型知道内容，得靠自己决定去查')
L.push('- `空轮` = 一句都没注入（「今天好累」这种就是它）')
L.push('- `关键遗漏率` 只在标了目标 id 的句子上算')
L.push('- `误注入` = 注入了但不在目标里 —— 「无效注入率」的粗代理，精确值要模型判')
L.push('- 全轮字数包含抬头与每条前缀，与 `maxChars=800` 的口径一致')
L.push('')

for (const r of 结果表) {
  L.push(`## ${r.名}`)
  L.push('')
  L.push(`> ${r.说明}`)
  L.push('')
  L.push('| 问题 | 类 | 条数 | 字数 | 命中/目标（全文） |')
  L.push('| --- | --- | --- | --- | --- |')
  for (const x of r.明细) {
    const 命中 = x.目标 ? `${x.命中}/${x.目标}（${x.命中全文}）` : '—'
    L.push(`| ${x.q} | ${x.类} | ${x.条数} | ${x.字数} | ${命中} |`)
  }
  L.push('')
}

const 报告 = L.join('\n')
if (输出) {
  fs.writeFileSync(输出, 报告, 'utf8')
  console.log(`报告已写到 ${输出}（${报告.length} 字）`)
} else {
  console.log(报告)
}
