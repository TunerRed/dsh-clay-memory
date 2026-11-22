// tools/check-mirror-coverage.mjs —— 镜像字段覆盖体检
//
// 为什么要有这个：1.12.37 修完 activation/is_knowledge，42 句基准就全等了 —— 但那是**运气**，
// 那批问句恰好没走 nature / 原话 / ctx 的路径。真正的问题是：镜像当初只照着「注入用得上的主列」
// 建，把条目的其余字段当展示字段漏了，一漏就是 18 个（含 3 个行为字段）。
// 以后再往记忆条目上加字段，忘了迁镜像会悄悄改变读切后的行为 —— 这个脚本把它变成一条会红的检查。
//
// 用法：
//   DSH_HOME=<家目录> node tools/check-mirror-coverage.mjs
//   DSH_HOME=<家目录> node tools/check-mirror-coverage.mjs --json
// 退出码：0 全覆盖 / 1 有字段没进镜像 / 2 库不存在
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const 仓库根 = fileURLToPath(new URL('..', import.meta.url))
const 输出JSON = process.argv.includes('--json')

const { STORE_DIR } = await import(pathToFileURL(path.join(仓库根, 'lib/paths.mjs')).href)

// 镜像列 ↔ JSON 字段的对应（列名 → 字段名；不写死的用括号说明它是内部列）
const 列映射 = {
  id: 'id',
  text: 'text',
  at: 'at',
  created_at: 'createdAt',
  importance: 'importance',
  source: 'source',
  category: 'category',
  type: 'type',
  fact_key: '事实键',
  related_json: 'related',
  extra_json: '(inference 包)',
  text_before: 'textBefore',
  refined: 'refined',
  refined_skip: 'refinedSkip',
  superseded_why: '已被取代',
  wrong: '别记',
  deleted_at: 'deletedAt',
  activation0: 'activation0',
  activation_anchor: 'activationAnchor',
  reinforce_count: 'reinforceCount',
  is_knowledge: 'is_knowledge',
  scope: 'scope',
  session_id: '(分层)',
  ord: '(顺序)',
}

// meta_json 的白名单 —— ⚠ 必须与 lib/store-core.mjs 的 打包杂项() 完全一致
const 杂项白名单 = [
  'tags', 'emotion', 'nature', '原话', 'ctx',
  'reinforcedAt', 'lastReinforcedDay', 'relatedAt', 'importBatch', 'importAt',
  'refinedAt', 'typeChecked', 'stableChecked',
  '洗键过', '键来源', 'refineTries', 'refineFailed', 'editedAt',
  '已被取代', '别记',
]

if (!fs.existsSync(STORE_DIR)) {
  console.error('找不到库目录：' + STORE_DIR + '（DSH_HOME 设了吗？）')
  process.exit(2)
}

const 已覆盖 = new Set(Object.values(列映射).filter((x) => !x.startsWith('(')))
for (const k of 杂项白名单) 已覆盖.add(k)

const 字段 = new Map()
let 总条 = 0
for (const fn of fs.readdirSync(STORE_DIR).filter((f) => f.endsWith('.json'))) {
  let j
  try {
    j = JSON.parse(fs.readFileSync(path.join(STORE_DIR, fn), 'utf8'))
  } catch {
    continue
  }
  for (const m of [...(j.memories || []), ...(j.deleted || [])]) {
    if (!m || typeof m !== 'object') continue
    总条++
    for (const k of Object.keys(m)) {
      if (m[k] === undefined) continue
      字段.set(k, (字段.get(k) || 0) + 1)
    }
  }
}

const 漏 = [...字段.entries()].filter(([k]) => !已覆盖.has(k)).sort((a, b) => b[1] - a[1])

const 结果 = {
  库目录: STORE_DIR,
  记忆条数: 总条,
  字段数: 字段.size,
  漏掉的字段: 漏.map(([名, 条数]) => ({ 字段: 名, 条数 })),
}

if (输出JSON) {
  console.log(JSON.stringify(结果, null, 2))
} else {
  console.log('库目录：' + STORE_DIR)
  console.log('扫了 ' + 总条 + ' 条记忆、' + 字段.size + ' 个字段')
  console.log('')
  if (!漏.length) {
    console.log('✓ 字段全部覆盖（列 + meta_json 白名单）')
  } else {
    console.log('✗ 有 ' + 漏.length + ' 个字段没进镜像：')
    for (const [名, 条数] of 漏) console.log('   ' + 名.padEnd(22) + 条数 + ' 条')
    console.log('')
    console.log('处理：加进 lib/store-core.mjs 的 杂项键们（和 tools/migrate-to-sqlite.mjs 的白名单），')
    console.log('      再重建镜像（全量回填）。行为字段（nature/原话/ctx 这类）漏了会改变注入结果。')
  }
}

process.exit(漏.length ? 1 : 0)
