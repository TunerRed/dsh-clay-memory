// tests/mirror-recall-equal.test.mjs —— 镜像必须带齐「打分输入」（2026-11-15，S3-a 前置）
//
// 真库实测：42 句基准里 41 句的 picked 在 JSON / SQL 两条读路径上对不上。
// 根因不在排序，在**镜像少了两个打分输入**：
//   ① 回血三件套 activation0 / activation_anchor / reinforce_count
//      —— 缺了它，所有条目按冷处理（A0 默认 1、锚点退到 at），热条目全被裁掉；
//   ② is_knowledge —— 它决定「谁能拿免门名额进常驻层」，缺了知识条目会白占画像的名额。
//
// 这个测试不只看字段在不在，直接跑 recall：同一批问句，两条读路径的 selected 必须逐句一致。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'clay-recall-eq-'))
process.env.DSH_HOME = home
const store = await import('../lib/store-core.mjs')
const sql = await import('../lib/storage.js')
const { recall } = await import('../lib/scoring.mjs')
const dir = join(home, 'clay-memory')
mkdirSync(dir, { recursive: true })

const SID = 'session-eq-1'
const CWD = 'G:/proj/eq'

function 造假工作区(sid, cwd) {
  const p = join(home, 'storages', 'session_projcache', 'sessions', sid + '.json')
  mkdirSync(join(home, 'storages', 'session_projcache', 'sessions'), { recursive: true })
  writeFileSync(p, JSON.stringify({ record: { identity: { cwd } } }), 'utf8')
}

const 条 = (o) => ({
  category: 'stable_profile',
  scope: 'global',
  importance: 1,
  source: 'user',
  at: '2026-11-01T00:00:00.000Z',
  ...o,
})

test('镜像带齐打分输入后，JSON/SQL 两条读路径的召回结果一字不差', () => {
  造假工作区(SID, CWD)
  const data = store.loadStoreJSON(SID, CWD)
  data.policy = Object.assign({}, data.policy, { factsAlwaysTopN: 3, factsMax: 6, maxItems: 10, maxChars: 800 })
  data.memories = [
    // 知识条目：importance 1 且最新 —— 缺 is_knowledge 时它会抢走免门名额
    条({
      id: 'k1',
      text: 'dsh-clay-memory 的召回门槛在 lib/scoring.mjs',
      is_knowledge: true,
      createdAt: '2026-11-05T00:00:00.000Z',
    }),
    // 热画像：强化 40 次、锚点是最近 —— 缺 activation 字段时它会被当冷条目裁掉
    条({
      id: 'h1',
      text: '主人喝咖啡不加糖',
      is_knowledge: false,
      reinforcement: 40,
      createdAt: '2026-11-03T00:00:00.000Z',
      reinforceCount: 40,
      activation0: 0.9,
      activationAnchor: new Date().toISOString(),
    }),
    // 冷画像
    条({
      id: 'c1',
      text: '主人讨厌香菜',
      is_knowledge: false,
      createdAt: '2026-10-01T00:00:00.000Z',
    }),
  ]
  // 一条会话事件，保证事件队也有东西
  data.memories.push({
    id: 'e1',
    text: '今天在整理镜像召回口径',
    category: 'event',
    scope: 'session',
    importance: 0.6,
    source: 'user',
    at: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  })
  store.saveStore(SID, data, {}, CWD)

  const json视图 = store.loadStoreJSON(SID, CWD)
  const 视图 = sql.读SQL视图同步(sql.库文件路径(dir), SID, CWD)
  assert.ok(视图, '镜像视图应可读')

  // ① 字段层：三件套 + is_knowledge 必须原样还原
  const 热 = 视图.memories.find((m) => String(m.id) === 'h1')
  assert.equal(热.activation0, 0.9, '激活度要还原')
  assert.ok(热.activationAnchor, '锚点要还原')
  assert.equal(热.reinforceCount, 40, '强化次数要还原')
  const 知识 = 视图.memories.find((m) => String(m.id) === 'k1')
  assert.equal(知识.is_knowledge, true, 'is_knowledge 要还原成布尔')
  const 冷 = 视图.memories.find((m) => String(m.id) === 'c1')
  assert.equal(冷.is_knowledge, false)
  assert.equal(冷.activation0, undefined, '没有激活度的不许凭空造出字段')

  // ② 行为层：两条读路径跑同一批问句，selected 必须逐句一致
  const 问句们 = ['喝什么', '香菜', '召回门槛', '今天做了什么', 'dsh-clay-memory scouring']
  const sqlData = Object.assign({}, json视图, { memories: 视图.memories })
  for (const q of 问句们) {
    const a = recall(json视图, q, Date.now(), SID).selected.map((x) => String(x.m.id)).join(',')
    const b = recall(sqlData, q, Date.now(), SID).selected.map((x) => String(x.m.id)).join(',')
    assert.equal(b, a, '「' + q + '」两条读路径不一致：json=' + a + ' sql=' + b)
  }
})

test('杂项字段（nature / 原话 / tags / ctx / 清洗标记）也进镜像并能原样还原', () => {
  const SID2 = 'session-eq-2'
  造假工作区(SID2, CWD)
  const data = store.loadStoreJSON(SID2, CWD)
  const 现在 = new Date().toISOString()
  data.memories = [
    // 梦：渲染要加「（梦）」、召回不许当事实念 —— 丢了 nature 行为就变
    {
      id: 'n1', text: '梦见自己在吃白饭', category: 'event', scope: 'session',
      importance: 0.6, at: 现在, createdAt: 现在,
      nature: 'dream', 原话: '我昨晚做梦在吃白饭', tags: ['自动抽取', '梦'],
      洗键过: '2026-11-15T00:00:00.000Z', 键来源: '清洗补键',
    },
    // 工作区常驻：ctx 决定 goal/stack/constraint 的排序
    {
      id: 'w1', text: '这个工作区的目标是打通迁移', category: 'workspace', scope: 'workspace:' + CWD,
      importance: 0.8, at: 现在, createdAt: 现在, ctx: 'goal',
    },
  ]
  store.saveStore(SID2, data, {}, CWD)

  const 视图 = sql.读SQL视图同步(sql.库文件路径(dir), SID2, CWD)
  assert.ok(视图, '镜像视图应可读')

  const 梦 = 视图.memories.find((m) => String(m.id) === 'n1')
  assert.ok(梦, '梦条目要在镜像视图里')
  assert.equal(梦.nature, 'dream', 'nature 必须还原（渲染/召回都靠它）')
  assert.equal(梦.原话, '我昨晚做梦在吃白饭', '原话必须还原（兜底池靠它）')
  assert.deepEqual(梦.tags, ['自动抽取', '梦'], 'tags 必须还原')
  assert.equal(梦.洗键过, '2026-11-15T00:00:00.000Z', '清洗标记必须还原（撤销靠它）')
  assert.equal(梦.键来源, '清洗补键')

  const 工 = 视图.memories.find((m) => String(m.id) === 'w1')
  assert.equal(工.ctx, 'goal', 'ctx 必须还原（常驻排序靠它）')

  // 和 JSON 侧逐字段对齐（除了 SQL 侧必然多出来的 scope 等）
  const json = store.loadStoreJSON(SID2, CWD)
  for (const id of ['n1', 'w1']) {
    const a = json.memories.find((m) => String(m.id) === id)
    const b = 视图.memories.find((m) => String(m.id) === id)
    for (const k of ['nature', '原话', 'tags', 'ctx', '洗键过', '键来源']) {
      assert.deepEqual(b[k], a[k], id + '.' + k + ' 两侧不一致')
    }
  }
})

test('cleanup', () => {
  rmSync(home, { recursive: true, force: true })
})
