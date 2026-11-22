#!/usr/bin/env node
// tools/probe-context-pressure.mjs —— 直接读会话表面，核对 surfaceTokens 与压缩的关系
//
// 背景（2026-11-21 实测结论，见 docs/交接-2026-11-21.md 第五节）：
//   billion-context 的压缩只改「发给模型的请求视图」，不往会话里写替换节点；
//   而 DSH 的 surfaceTokens 是「会话位置化表面」所有节点 tokens 之和（= ctx.tokenMeter.measure(session).surfaceTokens），
//   只有带 claim 的 replacement（DSH 原生 compaction）才会按 shadow price 让它缩小。
//   所以：插件压缩让每轮 prompt 变小，但 surfaceTokens / 那个「上下文 xx%」的百分比不降。
//   这个脚本把证据摆出来：压过几块之后，surface 节点里有没有替换类节点、总量是涨是跌。
//
// 数据源：$DSH_HOME/data/storages/session_projcache/sessions/session-<id>.json
//   record.rows.contextTimeline.val.surface = [{seq,time,cat,tokens,text}]
//   record.rows.tokenMeasurement.val.anchor.usage = 最近一次上游 usage 样本
//
// 用法（在开发仓库根）：
//   node tools/probe-context-pressure.mjs                    # 看最近更新过的那个会话
//   node tools/probe-context-pressure.mjs --session 336f83c6 # 按 id 片段选
//   node tools/probe-context-pressure.mjs --all              # 全部会话总览（找有没有 compaction 节点）
//   node tools/probe-context-pressure.mjs --home <DSH_HOME目录> # 指定 DSH_HOME
// 退出码：0 读到数据 / 1 没找到 projcache
import fs from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'

const 参数 = new Map()
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) {
    const k = a.slice(2)
    const v = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true
    参数.set(k, v)
  }
}

const 家目录 = String(参数.get('home') || process.env.DSH_HOME || path.join(homedir(), '.dsh'))
const 缓存目录 = path.join(家目录, 'data', 'storages', 'session_projcache', 'sessions')
if (!fs.existsSync(缓存目录)) {
  console.error(`没找到投影缓存：${缓存目录}\n（用 --home 指定 DSH_HOME，或确认这个 DSH 实例跑过一轮对话）`)
  process.exit(1)
}

// DSH 原生 compaction 写进表面的节点类别（实测本机 20 个会话里一个都没有）
const 替换类 = new Set(['compaction', 'replacement', 'compact'])

const 读会话 = (文件) => {
  const raw = JSON.parse(fs.readFileSync(path.join(缓存目录, 文件), 'utf8'))
  const rows = raw.record?.rows ?? {}
  const surface = rows.contextTimeline?.val?.surface ?? []
  const usage = rows.tokenMeasurement?.val?.anchor?.usage ?? null
  const stats = rows.sessionStats?.val ?? null
  const identity = raw.record?.identity ?? null
  const 分类 = {}
  let 合计 = 0
  for (const n of surface) {
    分类[n.cat] = (分类[n.cat] ?? 0) + (n.tokens ?? 0)
    合计 += n.tokens ?? 0
  }
  return { 文件, surface, 分类, 合计, usage, stats, identity }
}

const 百分比 = (x, 总) => 总 ? `${((x * 100) / 总).toFixed(1)}%` : '—'
const 千 = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n)

const 打印一个 = (s) => {
  const 替换节点 = s.surface.filter((n) => 替换类.has(n.cat))
  console.log(`会话 ${s.文件.replace(/^session-/, '').replace(/\.json$/, '')}`)
  console.log(`  cwd              ${s.identity?.cwd ?? '?'}  inherited=${s.identity?.inheritedEventCount ?? '?'}`)
  console.log(`  surface 节点     ${s.surface.length}（seq ${s.surface[0]?.seq ?? '?'} → ${s.surface[s.surface.length - 1]?.seq ?? '?'}）`)
  console.log(`  surfaceTokens    ${s.合计}  ≈ ${千(s.合计)}`)
  const 拆 = Object.entries(s.分类).sort((a, b) => b[1] - a[1])
    .map(([cat, t]) => `${cat} ${千(t)} (${百分比(t, s.合计)})`).join(' · ')
  console.log(`  按类别           ${拆}`)
  console.log(`  替换类节点       ${替换节点.length ? `有 ${替换节点.length} 个（${替换节点.map((n) => n.cat).join(',')}）` : '没有 —— 插件压缩不会写替换节点'}`)
  if (s.usage) {
    const u = s.usage
    console.log(`  最近上游样本     input ${u.inputTokens} · output ${u.outputTokens} · cacheRead ${千(u.cacheReadTokens)} · total ${千(u.totalTokens)}`)
  }
  if (s.stats) console.log(`  轮/步            turns ${s.stats.turns} · steps ${s.stats.steps}`)
  console.log('')
}

if (参数.has('all')) {
  const 全 = fs.readdirSync(缓存目录).filter((f) => f.endsWith('.json')).map(读会话)
  全.sort((a, b) => b.合计 - a.合计)
  let 有替换 = 0
  for (const s of 全) {
    const 替换节点 = s.surface.filter((n) => 替换类.has(n.cat))
    if (替换节点.length) 有替换++
    const cats = Object.keys(s.分类).sort().join('/')
    console.log(`${s.文件.slice(8, 16)}  nodes ${String(s.surface.length).padStart(3)}  sum ${String(s.合计).padStart(6)}  ${替换节点.length ? 'REPL' : '    '}  ${cats}`)
  }
  console.log(`\n共 ${全.length} 个会话，含替换类节点的 ${有替换} 个`)
  process.exit(0)
}

const 选 = String(参数.get('session') ?? '')
const 全 = fs.readdirSync(缓存目录).filter((f) => f.endsWith('.json'))
let 目标 = 选 ? 全.find((f) => f.includes(选)) : null
if (!目标) {
  // 默认：最近更新过的那个
  目标 = 全.map((f) => ({ f, m: fs.statSync(path.join(缓存目录, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0]?.f
}
if (!目标) {
  console.error('缓存目录是空的')
  process.exit(1)
}
打印一个(读会话(目标))
