// tools/bench/shadow-compare.mjs —— S2 影子比对（真库离线对账）
//
// 不依赖运行中的实例：直接拿 loadStoreJSON 的合并视图（JSON 真相）和 读SQL视图同步
// 的镜像视图（SQLite 影子）逐会话比 id 序列 + 关键字段。
//
// 为什么单独一个工具：S2 的出口标准就是「SQL 视图 == JSON 视图 全等」，S3 每切一组
// 也要再跑一遍。以前只能开 CLAY_SQL_READ=1 在实例里靠 diag 看，样本全靠碰；这个脚本
// 一次把整库所有会话都对完，差异能落到具体会话和具体位置。
//
// 用法：
//   DSH_HOME=<家目录> node tools/bench/shadow-compare.mjs
//   DSH_HOME=<家目录> node tools/bench/shadow-compare.mjs --json
//
// 退出码：0 全等 / 1 有差异 / 2 库或目录不存在
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const 仓库根 = fileURLToPath(new URL('../..', import.meta.url))
const 输出JSON = process.argv.includes('--json')
const 模块URL = (p) => pathToFileURL(path.join(仓库根, p)).href

const { loadStoreJSON } = await import(模块URL('lib/store-core.mjs'))
const { 读SQL视图同步, 库文件路径, 比对视图 } = await import(模块URL('lib/storage.js'))
const { STORE_DIR, 是会话文件, 会话工作区 } = await import(模块URL('lib/paths.mjs'))

const 库 = 库文件路径(STORE_DIR)
if (!fs.existsSync(STORE_DIR)) {
  console.error('找不到库目录：' + STORE_DIR + '（DSH_HOME 设了吗？）')
  process.exit(2)
}
if (!fs.existsSync(库)) {
  console.error('找不到镜像库：' + 库 + '（镜像还没建过？跑一次 全量回填镜像）')
  process.exit(2)
}

const 文件们 = fs.readdirSync(STORE_DIR).filter(是会话文件).sort()
const 坏们 = []
let 全等 = 0
let 不等 = 0
let 读不出 = 0
let 总条 = 0

for (const fn of 文件们) {
  const sid = fn.replace(/\.json$/, '')
  let json视图 = null
  try {
    json视图 = loadStoreJSON(sid)
  } catch (e) {
    读不出++
    坏们.push({ sid, 原因: '读 JSON 崩：' + String((e && e.message) || e) })
    continue
  }
  const 工作区 = 会话工作区(sid)
  const sql视图 = 读SQL视图同步(库, sid, 工作区)
  if (!sql视图) {
    读不出++
    坏们.push({ sid, 原因: 'SQL 视图读不出来（镜像无货 / 打不开）' })
    continue
  }
  const r = 比对视图(json视图, sql视图)
  总条 += json视图.memories.length
  if (r.全等) 全等++
  else {
    不等++
    坏们.push({ sid, 条数: json视图.memories.length, 差异: r.差异 })
  }
}

const 结果 = {
  store: STORE_DIR,
  会话数: 文件们.length,
  全等,
  不等,
  读不出,
  JSON条目合计: 总条,
  不一致: 坏们,
}

if (输出JSON) {
  console.log(JSON.stringify(结果, null, 2))
} else {
  console.log('库目录：' + STORE_DIR)
  console.log('')
  console.log('结果：全等 ' + 全等 + ' / 不等 ' + 不等 + ' / 读不出 ' + 读不出 + '（共 ' + 文件们.length + ' 个会话库）')
  console.log('    JSON 侧条目合计 ' + 总条)
  if (坏们.length) {
    console.log('')
    console.log('不一致明细（前 20）：')
    for (const b of 坏们.slice(0, 20)) {
      console.log('  ' + b.sid.slice(0, 16) + '  条数=' + (b.条数 ?? '-') + '  ' + (b.原因 || (b.差异 || []).join(' | ')))
    }
    if (坏们.length > 20) console.log('  ...还有 ' + (坏们.length - 20) + ' 个')
  }
}

process.exit(不等 || 读不出 ? 1 : 0)
