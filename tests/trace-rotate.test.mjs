// trace 轮转：每个会话的 traces.jsonl 只留最近 N 行（默认 500）
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { strict as assert } from 'node:assert'

const 临时 = mkdtempSync(join(tmpdir(), 'clay-trace-'))
process.env.DSH_HOME = 临时
mkdirSync(join(临时, 'clay-memory'), { recursive: true })

const { 追加trace, tracePath } = await import('../lib/trace-log.mjs')

const 上限 = 500
const sid = 'tr-1'
// 先造一个超大文件（模拟线上那些涨到几千行的轨迹）
const 造 = []
for (let i = 0; i < 5000; i += 1) 造.push(JSON.stringify({ at: i, picked: [] }))
writeFileSync(tracePath(sid), 造.join(String.fromCharCode(10)) + String.fromCharCode(10))

// 第一条追加就该把胖文件剪到上限（含刚写进来的这条）
追加trace(sid, { at: 'first' })
let 行 = readFileSync(tracePath(sid), 'utf8').split(String.fromCharCode(10)).filter(Boolean)
assert.equal(行.length, 上限, '第一条追加后应只留上限行数')
assert.equal(JSON.parse(行[行.length - 1]).at, 'first', '最新一条不能被剪掉')
// 5000 旧 + 1 新 = 5001，留最后 500 → 从第 4501 条开始
assert.equal(JSON.parse(行[0]).at, 4501, '保留下来的应是最新的那批')

// 再追加 250 条：途中剪一次，不超过「上限 + 一个剪的间隔 - 1」
for (let i = 0; i < 250; i += 1) 追加trace(sid, { at: 'n' + i })
行 = readFileSync(tracePath(sid), 'utf8').split(String.fromCharCode(10)).filter(Boolean)
assert.ok(行.length <= 上限 + 199, '轮转后不应超过「上限 + 一个剪的间隔」，实际 ' + 行.length)
assert.equal(JSON.parse(行[行.length - 1]).at, 'n249', '最后写入的那条要在')

// 小文件不受影响
const sid2 = 'tr-2'
for (let i = 0; i < 5; i += 1) 追加trace(sid2, { at: i })
assert.equal(readFileSync(tracePath(sid2), 'utf8').split(String.fromCharCode(10)).filter(Boolean).length, 5)

console.log('trace 轮转 ✓')
