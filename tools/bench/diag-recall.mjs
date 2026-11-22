// 默认读主实例的家目录；要看/诊断别的实例就显式传 DSH_HOME=<那个家目录>
import os from 'node:os'
import path from 'node:path'

process.env.DSH_HOME ||= path.join(os.homedir(), '.dsh')
const { loadStoreJSON } = await import('../../lib/store-core.mjs')
const { recall } = await import('../../lib/scoring.mjs')
const { tokenize } = await import('../../lib/lexicon.mjs')

const sid = 'diag'
const q = process.argv[2] || '还记得我喜欢吃什么吗'
const 目标 = 'mmwa5cyaf550'

console.log('query 分词：', JSON.stringify([...tokenize(q)]))

const data = loadStoreJSON(sid)
const r = recall(data, q, Date.now(), sid)
const sc = r.scored || []
const 排 = sc.findIndex((x) => String((x.m || x).id) === 目标)
if (排 >= 0) {
  const x = sc[排]
  console.log('饮食偏好第', 排 + 1, '/', sc.length)
  console.log('s 分项：', JSON.stringify(x.s))
  console.log('第三条的 s 分项：', JSON.stringify(sc[0].s))
  console.log('第一条文本：', String(sc[0].m.text).slice(0, 40))
}
const 问词 = ['还记得', '喜欢', '吃什么', '吃', '什么', '还', '记得']
const 条 = sc.find((x) => String((x.m || x).id) === 目标)
if (条) {
  console.log('目标条文本：', 条.m.text)
  console.log('目标条分项里有没有提到命中词：', JSON.stringify(条.s))
}
