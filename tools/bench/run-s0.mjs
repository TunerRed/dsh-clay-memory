import fs from 'node:fs'
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// 全部走环境变量，默认值只当兜底 —— 换会话/换端口/换库都不用改脚本
// GPT 整改 P2（D 阶段）：默认路径不再硬编码本机临时目录（别人机器上没有），改用仓库内 tools/bench/
const 仓库根 = fileURLToPath(new URL('../..', import.meta.url))
const SID = process.env.BENCH_SESSION_ID || 'session-4c622978-0ddd-48d7-945f-a162bdfc9d53'
const port = Number(process.env.BENCH_PORT || 61021)
const 问句文件 = process.env.BENCH_QUERIES || join(仓库根, 'tools/bench/queries.json')
const 输出文件 = process.env.BENCH_OUTPUT || join(仓库根, 'tools/bench/S0-baseline.json')
const 后端 = process.env.BENCH_BACKEND === 'sql' ? 'sql' : 'json'

const q = JSON.parse(fs.readFileSync(问句文件, 'utf8')).queries

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const 文件指纹 = (路径) => {
  try {
    const buf = fs.readFileSync(路径)
    return { sha256: sha256(buf), bytes: buf.length }
  } catch {
    return 'missing'
  }
}

const gitCommit = (() => {
  try {
    return execSync('git rev-parse HEAD', { cwd: 仓库根, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
})()

const t0 = Date.now()
const r = await fetch('http://127.0.0.1:' + port + '/dsh-clay-memory/bench-recall', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ session: SID, queries: q, 后端 }),
})
const j = await r.json()
if (!j.ok) {
  console.log('FAIL', j.message)
  process.exit(1)
}
const out = {
  at: new Date().toISOString(),
  note: 'S0 基线：当前召回算法与存储后端（' + 后端 + '）。S2/S3 每步重跑，比 picked 与顺序。',
  ms: Date.now() - t0,
  count: j.count,
  // 溯源：这份基准是哪份代码、哪份问句、哪份词表录的 —— 少了这三样，回头没法比
  gitCommit,
  queriesHash: sha256(JSON.stringify(q)),
  backend: 后端,
  lexicon: {
    词典: 文件指纹(仓库根 + '/lib/lexicon.txt'),
    词频: 文件指纹(仓库根 + '/lib/wordfreq.txt'),
  },
  data: j.data,
}
fs.writeFileSync(输出文件, JSON.stringify(out, null, 2))
const 有挑中 = out.data.filter((x) => x.picked.length > 0).length
const 总条 = out.data.reduce((n, x) => n + x.picked.length, 0)
console.log('句数', out.count, '| 有挑中的', 有挑中, '| 共挑中', 总条, '| 耗时', out.ms + 'ms', '|', 后端, gitCommit.slice(0, 7))
out.data.slice(0, 6).forEach((x) => console.log('  ', x.query.slice(0, 18), '→', x.picked.length, '条', 'gate:', x.gate ? x.gate.信息量 : '过'))
