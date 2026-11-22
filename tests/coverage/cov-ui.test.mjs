import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 仓库根：测试文件在 tests/coverage/ 下，往上两级才是仓库根（别写死盘符路径）
const 仓库根 = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// 展示层（lib/ui.mjs）回归 —— 这个模块 465 行、**零测试覆盖**。
// 现有 tests/ui-static.test.mjs 只做「源码文本匹配」（读 src/client 与 routes-*.mjs 的字符串），
// **从不 import 本模块** ⇒ 下面这些真实行为一直是空白。
//
// 要守住的不变量：
//   ① `归档名单` 三条路的降级链，且**宁可多露、不可错藏** ——
//      🔴 2026-09-21 原来是 `catch { return new Set() }`：读不到就静默当成「没有归档」，
//      于是归档的会话照样露在清单里，一点痕迹都不留（用户反馈的 11 条幽灵就是这么来的）；
//   ② `已知会话ids` 拿不到可信来源时必须 `ok=false`，调用方据此**一条都不藏** ——
//      否则会把所有记忆都当幽灵藏掉；一个都没拿到也不算可信（同样理由）；
//   ③ `buildMemoryList` 的**事实 / 事件分开报**（1.4.0 双层库）：整份糊成一个 count
//      看着像本会话独有，其实一半是全局的；
//   ④ 词门健康状态要报给前端（`out.lexicon`）—— 词典整仓丢过一次且静默（1.8.20）；
//   ⑤ `freshKind` 只用来决定**显示什么字**，判据是 category / at / 有锚，
//      ⚠ 不能拿「鲜活度是不是钉住的」当判据 —— 那是算分的副作用、不是语义，
//      上一版因此把 394 条没抠到日期的流水账错收进「不会淡的」里；
//   ⑥ `scope` 是**按 category 推断**的，而 `层` 是真实落在哪个文件 ——
//      一条全局事实被补标降成 event 之后 scope 会推断成 session，用它筛「全局」会漏，
//      所以两个字段都得发；
//   ⑦ 挑选目录的读写要容错（坏 JSON 不抛）。
//
// ⚠ 全部文件操作落在自建临时 DSH_HOME，**不碰真实记忆库**
//   （本机真实数据在真实 DSH_HOME，测试实例在独立端口跑）。
const home = mkdtempSync(join(tmpdir(), 'fish-cov-ui-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')
mkdirSync(join(home, 'clay-memory'), { recursive: true })

const ui = await import('../../lib/ui.mjs')
const { loadCfg } = await import('../../lib/cfg.mjs')
const names = await import('../../lib/names.mjs')
const { titleOfSession } = await import('../../lib/tools.mjs')
const { STORE_DIR, factPath, storePath, 宿主数据根, 是会话文件 } = await import('../../lib/paths.mjs')

// names.mjs 的两个注入槽（照 tests/write-peek.test.mjs 的写法）——
// 不注入的话 ownerNameOf / titleNameOf 拿不到配置，会一路走降级分支
names.接读配置(loadCfg)
names.接标题(titleOfSession)

const 诊断 = []
ui.接报信((m) => 诊断.push(String(m)))

const {
  挑选目录文件, 读挑选目录, 写挑选目录, 目录在, 当前工作区根, 工作区号,
  归档名单, 已知会话ids, 分支来处Of, 是事实条, buildMemoryList, MEMORY_PAGE,
} = ui

// ── 假 ctx：只造被测分支需要的那几个口 ──
function 假ctx({ registry, agents = [] } = {}) {
  return {
    get: (名) => (名 === 'workspaceRegistry' ? registry : undefined),
    agents: {
      list: () => agents,
      get: (sid) => agents.find((a) => a && a.session && a.session.id === String(sid)) || null,
    },
  }
}
const 在线会话 = (id, 额外 = {}) => ({ session: { id, ...额外 } })

function 写库(sid, 内容) {
  writeFileSync(storePath(sid), JSON.stringify(内容), 'utf8')
}

// ─────────────── 纯函数 ───────────────

test('是事实条：全场只有 category 说了算', () => {
  // ⚠ 这一条是「住全局库还是留本会话」的唯一判据 —— 掺进重要度就会重演
  //   1.10.0 之前「重要度高就被当成长期事实」那个绑定
  assert.equal(是事实条({ category: 'stable_profile' }), true)
  assert.equal(是事实条({ category: 'event' }), false)
  assert.equal(是事实条({ category: 'workspace' }), false, '工作区层不是事实（它住 _ws-*.json）')
  assert.equal(是事实条({ category: 'stable_profile', importance: 0.1 }), true, '重要度低也还是事实')
  assert.equal(是事实条({ category: 'event', importance: 1 }), false, '重要度满格也不该被当成事实')
  assert.equal(是事实条({}), false)
  assert.equal(是事实条(null), false)
  assert.equal(是事实条(undefined), false)
  assert.equal(是事实条('stable_profile'), false, '传字符串不算（必须是条目对象）')
})

test('工作区号：优先 id / key / path，都没有就退回下标', () => {
  assert.equal(工作区号({ id: 'w1' }, 5), 'w1')
  assert.equal(工作区号({ key: 'k2' }, 5), 'k2')
  assert.equal(工作区号({ path: 'C:/work/a' }, 5), 'C:/work/a')
  // 优先级：id > key > path
  assert.equal(工作区号({ id: 'a', key: 'b', path: 'c' }, 9), 'a')
  assert.equal(工作区号({ key: 'b', path: 'c' }, 9), 'b')
  // 都没有 → 下标（字符串）
  assert.equal(工作区号({}, 3), '3')
  assert.equal(工作区号(null, 7), '7')
  assert.equal(工作区号(undefined, 0), '0')
  // 空串是 falsy → 也退回下标（不能把空串当工作区身份）
  assert.equal(工作区号({ id: '' }, 2), '2')
})

test('目录在 / 当前工作区根：真实目录判定，垃圾输入不抛', () => {
  const 真目录 = mkdtempSync(join(tmpdir(), 'fish-cov-ui-dir-'))
  const 真文件 = join(真目录, 'f.txt')
  writeFileSync(真文件, 'x', 'utf8')
  assert.equal(目录在(真目录), true)
  assert.equal(目录在(真文件), false, '文件不是目录')
  assert.equal(目录在(join(真目录, '根本不存在')), false)
  // 空 / null / 非字符串都不该抛（这一条在渲染路径上，抛了整个设置页就白屏）
  assert.equal(目录在(''), false)
  assert.equal(目录在(null), false)
  assert.equal(目录在(undefined), false)
  assert.equal(目录在(123), false)
  assert.equal(目录在({}), false)
  // 当前工作区根就是 cwd（工作区身份的来源）
  assert.equal(当前工作区根(), String(process.cwd()))
})

// ─────────────── ⑦ 挑选目录 ───────────────

test('⑦ 挑选目录：写了能读回来，且落在库里（带 _ 前缀，不会被当成会话库）', () => {
  const p = 挑选目录文件()
  assert.equal(p, join(STORE_DIR, '_last-pick.json'))
  assert.equal(p.split(/[\\/]/).pop().charAt(0), '_', '必须带 _ 前缀 —— 否则 是会话文件() 会把它当成一个会话，会话数跟着涨')

  写挑选目录('G:/tmp/some-dir')
  assert.equal(读挑选目录(), 'G:/tmp/some-dir', '写进去的目录该能原样读回来')
  const 盘上 = JSON.parse(readFileSync(p, 'utf8'))
  assert.equal(盘上.dir, 'G:/tmp/some-dir')
  assert.match(盘上.at, /^\d{4}-\d{2}-\d{2}T/, '要带写入时间')

  // 非字符串该被转成字符串（前端传 null 时会变 'null'，但绝不能抛）
  assert.doesNotThrow(() => 写挑选目录(null))
  // 坏 JSON → 空串（不能抛，也不能把垃圾路径塞回输入框）
  writeFileSync(p, '{ 坏了 ', 'utf8')
  assert.equal(读挑选目录(), '', '挑选目录坏了该兜成空串')
  writeFileSync(p, '{"dir":123}', 'utf8')
  assert.equal(读挑选目录(), '', 'dir 不是字符串也该兜成空串')
  writeFileSync(p, '[]', 'utf8')
  assert.equal(读挑选目录(), '')
  // 文件不存在 → 空串（第一次打开设置页就是这种状态）
  writeFileSync(p, '', 'utf8')
  assert.doesNotThrow(() => 读挑选目录())
})

// ─────────────── ① 归档名单 ───────────────

test('① 归档名单 路一：从运行时服务拿（首选、实时）', () => {
  const ctx = 假ctx({ registry: { archivedSessionIds: ['s1', 's2', 3] } })
  const 名单 = 归档名单(ctx)
  assert.ok(名单 instanceof Set)
  assert.deepEqual([...名单].sort(), ['3', 's1', 's2'], '数字 id 也该被转成字符串')
  assert.ok(诊断.some((m) => /从服务拿到 3 个/.test(m)), '走通服务那条路要留日志：' + JSON.stringify(诊断.slice(-3)))
})

test('① 归档名单 路二：服务拿不到 → 兜底读 DSH 自己的存储文件', () => {
  // 造 DSH 的 workspace.json（同一份数据，格式稳定）
  mkdirSync(宿主数据根(), { recursive: true })
  writeFileSync(join(宿主数据根(), 'workspace.json'),
    JSON.stringify({ global: { archivedSessionIds: ['x1', 'x2'] } }), 'utf8')

  // 服务返回 undefined → 走路二
  const 名单 = 归档名单(假ctx({ registry: undefined }))
  assert.deepEqual([...名单].sort(), ['x1', 'x2'], '服务拿不到时该从存储文件兜底')
  assert.ok(诊断.some((m) => /从存储文件兜底拿到 2 个/.test(m)), '兜底成功也要留日志')

  // 服务上的字段不是数组 → 同样兜底
  const 名单2 = 归档名单(假ctx({ registry: { archivedSessionIds: '不是数组' } }))
  assert.deepEqual([...名单2].sort(), ['x1', 'x2'])
  // 服务抛错 → 也要能兜底（不能因为读服务失败就露出归档会话）
  const 名单3 = 归档名单(假ctx({ registry: { get archivedSessionIds() { throw new Error('服务坏了') } } }))
  assert.deepEqual([...名单3].sort(), ['x1', 'x2'], '服务抛错时该走存储文件兜底')
})

test('① 归档名单 路三：两条路都拿不到 → 返回空集合 + 明说「这次不做归档隐藏」', () => {
  // 🔴 这条守的就是 2026-09-21 那个静默 bug：原来 `catch { return new Set() }`，
  //   读不到就静默当成「没有归档」，归档的会话照样露出来、一点痕迹都不留。
  const 备份 = join(宿主数据根(), 'workspace.json')
  const 原内容 = existsSync(备份) ? readFileSync(备份, 'utf8') : null
  if (existsSync(备份)) writeFileSync(备份, '{ 故意弄坏 ', 'utf8')

  const 名单 = 归档名单(假ctx({ registry: undefined }))
  assert.deepEqual([...名单], [], '两条路都拿不到时该是空集合（宁可多露）')
  assert.ok(
    诊断.some((m) => /宁可多露，不可错藏/.test(m)),
    '必须明说这次没做成归档隐藏 —— 静默失败正是当年 11 条幽灵的根因：' + JSON.stringify(诊断.slice(-3))
  )

  if (原内容 !== null) writeFileSync(备份, 原内容, 'utf8')
})

// ─────────────── ② 已知会话ids ───────────────

test('② 已知会话ids：拿到服务时汇总各工作区的 sessionIds，ok=true', () => {
  const ctx = 假ctx({
    registry: { list: () => [{ sessionIds: ['a', 'b'] }, { sessionIds: ['c'] }, { sessionIds: ['a'] }, null] },
  })
  const r = 已知会话ids(ctx)
  assert.deepEqual([...r.ids].sort(), ['a', 'b', 'c'], '跨工作区汇总且去重')
  assert.equal(r.ok, true)
})

test('② 已知会话ids：拿不到可信来源 → ok=false，调用方一条都不藏', () => {
  // ⚠ ok=false 的语义是「**没拿到可信来源**」，不是「一个会话都没有」。
  //   buildMemoryList 靠它决定要不要藏幽灵；误判成可信会把所有记忆都藏掉。
  for (const [说法, ctx] of [
    ['服务是 undefined', 假ctx({ registry: undefined })],
    ['服务上没有 list()', 假ctx({ registry: {} })],
    ['list() 抛错', 假ctx({ registry: { list: () => { throw new Error('坏了') } } })],
    ['ctx.get 本身抛错', { get: () => { throw new Error('宿主没起来') }, agents: { list: () => [] } }],
  ]) {
    const r = 已知会话ids(ctx)
    assert.equal(r.ok, false, `${说法} 时 ok 该是 false`)
    assert.equal(r.ids.size, 0, `${说法} 时该返回空集合`)
  }
  // ⚠ 一个都没拿到也不算可信 —— 否则「DSH 里没有任何会话」会被误当成「所有记忆都是幽灵」
  const 空 = 已知会话ids(假ctx({ registry: { list: () => [] } }))
  assert.equal(空.ids.size, 0)
  assert.equal(空.ok, false, '一个都没拿到就不算可信，否则会把所有记忆当幽灵藏掉')
  // list() 返回 null 也不该抛
  assert.equal(已知会话ids(假ctx({ registry: { list: () => null } })).ok, false)
})

test('分支来处Of：能拿到 parentSession 就返回，拿不到一律 null（不抛）', () => {
  const ctx = 假ctx({ agents: [在线会话('child', { header: { parentSession: 'parent-1' } })] })
  assert.equal(分支来处Of(ctx, 'child'), 'parent-1')
  assert.equal(分支来处Of(ctx, '没有这个会话'), null)
  // 没有 header / header 里没有 parentSession
  const ctx2 = 假ctx({ agents: [在线会话('n1', {}), 在线会话('n2', { header: {} })] })
  assert.equal(分支来处Of(ctx2, 'n1'), null)
  assert.equal(分支来处Of(ctx2, 'n2'), null)
  // ctx 残缺也不该抛（这一条在渲染路径上）
  assert.equal(分支来处Of({}, 'x'), null)
  assert.equal(分支来处Of({ agents: { get: () => { throw new Error('坏了') } } }, 'x'), null)
  // 数字 id 也该认（转成字符串去查）
  const ctx3 = 假ctx({ agents: [在线会话('77', { header: { parentSession: 'p' } })] })
  assert.equal(分支来处Of(ctx3, 77), 'p')
})

// ─────────────── ③④⑤⑥ buildMemoryList ───────────────

test('③④ buildMemoryList：空库也要给出完整骨架（前端不能读到 undefined）', () => {
  const out = buildMemoryList(假ctx({ registry: undefined, agents: [] }))
  assert.equal(out.ok, true)
  assert.ok(Array.isArray(out.sessions))
  // ④ 词门健康状态（1.8.20：词典整仓丢过一次且静默，缺了前端要红字提示）
  assert.ok(out.lexicon && typeof out.lexicon === 'object', '缺 lexicon 字段 ⇒ 前端没法判断词门健康')
  assert.ok(out.lexicon.词典 > 100000, '词典数不对：' + out.lexicon.词典)
  assert.equal(out.lexicon.词频, 20000, '词频数不对：' + out.lexicon.词频)
  // 参数区三件套：当前值 / 规格 / 默认值（前端要拿它画旋钮与「恢复默认」）
  assert.ok(out.policy && typeof out.policy === 'object', '没有库时也该给出全局参数（1.2.7 修的）')
  assert.ok(out.spec, '缺 POLICY_SPEC ⇒ 前端画不出旋钮范围')
  assert.ok(out.defaults, '缺默认值 ⇒ 前端没有「恢复默认」')
  assert.equal(typeof out.全局开关, 'boolean')
  assert.equal(out.ghosts, 0)
  assert.equal(out.factsCount, 0)
  assert.match(out.version, /^\d+\.\d+\.\d+/, '版本号该从 package.json 读出来，不是 "?"')
  assert.equal(typeof out.userPronoun, 'string')
})

test('③ buildMemoryList：事实 / 事件分开报，count 保留为合并视图总数', () => {
  const sid = 'cov-ui-facts'
  写库(sid, {
    memories: [
      { id: 'f1', text: '她喜欢蓝色', category: 'stable_profile', importance: 0.9 },
      { id: 'f2', text: '约定：晚上十点前回消息', category: 'stable_profile', importance: 0.8 },
      { id: 'e1', text: '今天去了公园', category: 'event', importance: 0.4 },
    ],
    traces: [],
    deleted: [],
  })
  const ctx = 假ctx({ registry: { list: () => [{ sessionIds: [sid] }] }, agents: [] })
  const out = buildMemoryList(ctx)
  const s = out.sessions.find((x) => x.id === sid)
  assert.ok(s, '会话该出现在清单里')

  // ⚠ 一个会话的 memories = 「全部全局事实」+「本会话事件」，
  //   整份糊成一个 count 看着像本会话独有，其实一半是全局的
  assert.equal(s.count, 3, 'count 该保留（老页面/老脚本还在读）')
  assert.equal(s.factsCount, 2, '事实数该单独报')
  assert.equal(s.eventCount, 1, '事件数该单独报')
  assert.equal(s.factsCount + s.eventCount, s.count, '两个数加起来该等于合并视图总数')

  // 没有记忆文件的会话也要露出来（否则新开的对话没有开关可点）
  const ctx2 = 假ctx({ registry: { list: () => [{ sessionIds: [sid, 'cov-ui-新会话'] }] }, agents: [] })
  const out2 = buildMemoryList(ctx2)
  const 新 = out2.sessions.find((x) => x.id === 'cov-ui-新会话')
  assert.ok(新, '没存过记忆的会话也该露出来，否则没有开关可点')
  assert.deepEqual(新.memories, [], '没文件时 memories 该是空数组')
  assert.equal(新.eventCount, 0)
  // 没文件的会话不再整库读，全局事实数直接当 factsCount（1031 的性能优化）
  assert.equal(新.factsCount, out2.factsCount, '没文件的会话 factsCount 该等于全局事实数')
  assert.equal(新.count, out2.factsCount)
})

test('⑤ buildMemoryList：freshKind 按 category / at / 有锚判，不按「鲜活度钉住没」判', () => {
  const sid = 'cov-ui-fresh'
  写库(sid, {
    memories: [
      { id: 'a', text: '长期事实', category: 'stable_profile', importance: 0.9 },
      { id: 'b', text: '有日期的事', category: 'event', at: '2026-09-17T04:00:00.000Z' },
      { id: 'c', text: '没日期但有创建时间', category: 'event', createdAt: '2026-09-17T04:00:00.000Z' },
      { id: 'd', text: '什么时间都没有', category: 'event' },
    ],
    traces: [], deleted: [],
  })
  const out = buildMemoryList(假ctx({ registry: { list: () => [{ sessionIds: [sid] }] }, agents: [] }))
  const ms = out.sessions.find((x) => x.id === sid).memories
  const 取 = (id) => ms.find((m) => m.id === id)

  assert.equal(取('a').freshKind, 'fact', '长期事实 → 「不淡」')
  assert.equal(取('b').freshKind, 'dated', '有日期的 → 显示百分比')
  assert.equal(取('c').freshKind, 'recorded', '没记时间的从「记下来那天」算 → 也会淡')
  assert.equal(取('d').freshKind, 'unknown', '连记下来的时间都没有 → 显示「—」')
  // ⚠⚠ 反面守卫：没日期的流水账**不能**被算成「不会淡的」——
  //   上一版拿「鲜活度是不是钉住的」当判据，把 394 条流水账错收进了长期事实
  assert.notEqual(取('c').freshKind, 'fact', '没日期的事件不该被当成不淡的事实')
  assert.notEqual(取('d').freshKind, 'fact')
  // activation 要么是有限数、要么是 null —— 不许把 NaN 发给前端（当年显示成「鲜活 NaN%」）
  for (const m of ms) {
    assert.ok(m.activation === null || Number.isFinite(m.activation),
      `${m.id} 的 activation 是 ${m.activation} —— NaN 会让页面显示「鲜活 NaN%」`)
  }
})

test('⑥ buildMemoryList：scope 按 category 推断，层 按真实落盘位置（两个都要发）', () => {
  const sid = 'cov-ui-scope'
  写库(sid, {
    memories: [
      { id: 'g', text: '全局事实', category: 'stable_profile' },
      { id: 'w', text: '工作区知识', category: 'workspace' },
      { id: 's', text: '本会话事件', category: 'event' },
      // 条目自带 scope 时优先（workspace:<cwd> 要原样透出去）
      { id: 'x', text: '自带 scope', category: 'event', scope: 'workspace:C:/work/a' },
    ],
    traces: [], deleted: [],
  })
  const out = buildMemoryList(假ctx({ registry: { list: () => [{ sessionIds: [sid] }] }, agents: [] }))
  const ms = out.sessions.find((x) => x.id === sid).memories
  const 取 = (id) => ms.find((m) => m.id === id)

  assert.equal(取('g').scope, 'global')
  assert.equal(取('w').scope, 'workspace')
  assert.equal(取('s').scope, 'session')
  assert.equal(取('x').scope, 'workspace:C:/work/a', '条目自带 scope 要原样透出，不能被推断覆盖')
  // category 照旧发（老页面/老脚本还在读它）—— 只**加**字段，不替换
  assert.equal(取('g').category, 'stable_profile')
  // ⚠ 「层」是真实来源层：scope 是按 category 推断的，
  //   一条全局事实被补标降成 event 之后 scope 会推断成 session ⇒ 用它筛「全局」会漏
  for (const m of ms) {
    assert.ok(['global', 'workspace', 'session'].includes(m.层), `${m.id} 的「层」值不合法：${m.层}`)
  }
  // 界面要用的其它字段都在（缺一个就有一处显示不出来）
  for (const 字段 of ['id', 'text', 'importance', 'type', 'stableChecked', 'related',
    'refined', 'refinedSkip', '已被取代', '事实键', '洗键过', '键来源', 'textBefore', '原话']) {
    assert.ok(字段 in 取('g'), `memories 缺字段「${字段}」⇒ 界面对应的那处会显示不出来`)
  }
  assert.equal(取('g').related, null, 'related 不是数组时该发 null（不是 undefined，JSON 会丢字段）')
  assert.equal(取('g').已被取代, null)
  assert.equal(取('g').事实键, null)
  assert.equal(取('g').原话, null)
  assert.equal(取('g').stableChecked, false)
})

test('buildMemoryList：藏幽灵，且 ok=false 时一条都不藏', () => {
  // 记忆库是独立文件，删会话不会连带删它 ⇒ 不拦的话列表里会堆一堆幽灵
  写库('cov-ui-live', { memories: [{ id: 'l1', text: '在线会话的记忆', category: 'event' }], traces: [], deleted: [] })
  写库('cov-ui-ghost', { memories: [{ id: 'g1', text: '幽灵会话的记忆', category: 'event' }], traces: [], deleted: [] })

  // 可信来源说只有 live 在线 ⇒ ghost 该被藏起来
  const 有来源 = buildMemoryList(假ctx({
    registry: { list: () => [{ sessionIds: ['cov-ui-live'] }] },
    agents: [在线会话('cov-ui-live')],
  }))
  const ids = 有来源.sessions.map((s) => s.id)
  assert.ok(ids.includes('cov-ui-live'), '在线会话必须露出来')
  assert.ok(!ids.includes('cov-ui-ghost'), 'DSH 里已经没有的会话不该露出来（幽灵）')
  // ⚠ ghosts 是「这次藏了几条」的总数 —— 同一个临时 DSH_HOME 里前面几条用例也写过库文件，
  //   所以不能断言绝对值，改断**一致性**：报出来的数必须等于「真有库文件、却没露出来」的那些。
  //   这样它仍然能逮住两类回归：一条都不藏（幽灵全露）、或藏过头（把该露的也藏了）。
  const 库文件 = readdirSync(STORE_DIR).filter(是会话文件).map((f) => f.replace(/\.json$/, ''))
  const 露出的库文件 = 库文件.filter((sid) => ids.includes(sid))
  assert.equal(有来源.ghosts, 库文件.length - 露出的库文件.length,
    `报出来的幽灵数（${有来源.ghosts}）跟实际藏起的（${库文件.length - 露出的库文件.length}）对不上`)
  assert.ok(有来源.ghosts >= 1, '至少该藏掉 cov-ui-ghost 这一条')
  assert.ok(诊断.some((m) => /藏起 \d+ 条幽灵/.test(m)), '藏幽灵要留日志')

  // ⚠ 拿不到可信来源时**宁可多露、不可错藏** —— 否则一次服务抖动就把全部记忆藏了
  const 没来源 = buildMemoryList(假ctx({ registry: undefined, agents: [] }))
  const ids2 = 没来源.sessions.map((s) => s.id)
  assert.ok(ids2.includes('cov-ui-ghost'), 'ok=false 时一条都不该藏 —— 否则服务一抖记忆全没了')
  assert.ok(ids2.includes('cov-ui-live'))
  assert.equal(没来源.ghosts, 0, '没藏就不该报幽灵数')
  // ok=false 时所有库文件都该露出来
  assert.equal(ids2.filter((x) => 库文件.includes(x)).length, 库文件.length, 'ok=false 时该把每个库文件都露出来')
})

test('③ buildMemoryList：顶部那个 factsCount 来自**全局事实库文件**（不是会话库里的 stable_profile）', () => {
  // ⚠ 两个来源要分清：
  //   · 会话条目的 factsCount = 这个会话的 memories 里 category==='stable_profile' 的条数
  //   · 顶部 out.factsCount    = `_facts.json` 里的条数（减去 deleted 墓碑）
  //   事实是全局共享的，页面顶部那行显示的是全局库那个数。
  writeFileSync(factPath(), JSON.stringify({
    memories: [
      { id: 'gf1', text: '她喜欢蓝色', category: 'stable_profile' },
      { id: 'gf2', text: '约定十点前回消息', category: 'stable_profile' },
      { id: 'gf3', text: '被删掉的', category: 'stable_profile' },
    ],
    deleted: [{ id: 'gf3', text: '被删掉的', deletedAt: '2026-01-01T00:00:00.000Z' }],
  }), 'utf8')

  const out = buildMemoryList(假ctx({ registry: undefined, agents: [] }))
  assert.equal(out.factsCount, 2, '全局事实数该扣掉 deleted 里的墓碑，实际 ' + out.factsCount)

  // 事实库不存在 / 坏了 → 0，不抛（新装环境还没有这个文件）
  const 备份 = readFileSync(factPath(), 'utf8')
  writeFileSync(factPath(), '{ 坏了 ', 'utf8')
  assert.equal(buildMemoryList(假ctx({ registry: undefined, agents: [] })).factsCount, 0, '事实库坏了该当 0，不能抛')
  writeFileSync(factPath(), 备份, 'utf8')
  assert.equal(buildMemoryList(假ctx({ registry: undefined, agents: [] })).factsCount, 2, '恢复后该重新读对')
})

test('buildMemoryList：归档的会话不露；在线的照样露', () => {
  写库('cov-ui-archived', { memories: [{ id: 'a1', text: '归档会话', category: 'event' }], traces: [], deleted: [] })
  写库('cov-ui-kept', { memories: [{ id: 'k1', text: '正常会话', category: 'event' }], traces: [], deleted: [] })
  const ctx = 假ctx({
    registry: {
      archivedSessionIds: ['cov-ui-archived'],
      list: () => [{ sessionIds: ['cov-ui-archived', 'cov-ui-kept'] }],
    },
    agents: [],
  })
  const ids = buildMemoryList(ctx).sessions.map((s) => s.id)
  assert.ok(!ids.includes('cov-ui-archived'), '归档了就该像归档了的样子，不该露在清单里')
  assert.ok(ids.includes('cov-ui-kept'))
})

test('buildMemoryList：ctx 整个残缺也不抛（设置页不能白屏）', () => {
  // 这一条在渲染路径上：抛了整个「黏土记忆」设置页就是 404 / 白屏
  for (const 坏ctx of [{}, { get: null, agents: null }, { get: () => { throw new Error('x') }, agents: { list: () => { throw new Error('y') } } }]) {
    let out = null
    let 抛了 = null
    try { out = buildMemoryList(坏ctx) } catch (e) { 抛了 = e }
    assert.equal(抛了, null, 'ctx 残缺时抛了：' + (抛了 && 抛了.message))
    assert.equal(out.ok, true)
    assert.ok(Array.isArray(out.sessions))
    assert.ok(out.policy, '参数该有兜底默认值')
    assert.ok(out.lexicon)
  }
})

test('buildMemoryList：deleted / traces / importBatches 都带给前端', () => {
  // ⚠ 隔离：前一条用例往全局事实库写过 deleted 墓碑，而 loadStore 读的是
  //   「事实 + 事件」合并视图 ⇒ 事实库的 deleted 会并进会话的 deleted。
  //   这里先把事实库清空，让 s.deleted 只反映本会话自己的墓碑（下面另有一条专测合并）。
  writeFileSync(factPath(), JSON.stringify({ memories: [], deleted: [] }), 'utf8')
  const sid = 'cov-ui-extra'
  写库(sid, {
    memories: [
      { id: 'b1', text: '第一批', category: 'event', importBatch: 'imp-1', importAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b2', text: '第一批第二条', category: 'event', importBatch: 'imp-1', importAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b3', text: '第二批', category: 'event', importBatch: 'imp-2', importAt: '2026-02-01T00:00:00.000Z' },
    ],
    traces: [{ at: '2026-03-01T00:00:00.000Z', id: 'b1' }, { at: '2026-03-02T00:00:00.000Z', id: 'b2' }],
    deleted: [{ id: 'd1', text: '删掉的', at: '', importance: 0.5, category: 'event', deletedAt: '2026-03-03T00:00:00.000Z' }],
  })
  const s = buildMemoryList(假ctx({ registry: { list: () => [{ sessionIds: [sid] }] }, agents: [] }))
    .sessions.find((x) => x.id === sid)

  // 回收站页签要的数据（只发界面用得上的几个字段）
  assert.equal(s.deleted.length, 1)
  assert.deepEqual(Object.keys(s.deleted[0]).sort(),
    ['at', 'category', 'deletedAt', 'id', 'importance', 'text'].sort(), '回收站条目该只发这几个字段')
  // 时间线 / 「最近一次召回」要的 traces
  assert.equal(s.traces.length, 2)
  assert.equal(s.lastTrace, '2026-03-02T00:00:00.000Z', 'lastTrace 该是最后一条 trace 的时间')
  // 导入批次：给「撤销这次导入」用，按时间倒序
  assert.equal(s.importBatches.length, 2)
  assert.equal(s.importBatches[0].id, 'imp-2', '该按时间倒序（最近的批次在前）')
  assert.equal(s.importBatches[1].id, 'imp-1')
  assert.equal(s.importBatches[1].n, 2, '每批几条要算对，撤销按钮上的数字靠它')
  assert.equal(s.importBatches[0].n, 1)
})

test('buildMemoryList：会话的 deleted 是「事实库墓碑 + 本会话墓碑」的合并视图', () => {
  // ⚠ 双层库（1.4.0）之后，loadStore 读的是合并视图：全局事实库的 deleted 会并进每个会话。
  //   这是**有意为之** —— 事实是全局共享的，在任一会话里删掉一条事实，
  //   回收站都该能看到它（否则用户在这个会话删的事实，换个会话就找不回来了）。
  //   前一条用例为了隔离把它清空了，这条专门验证这个合并语义。
  const sid = 'cov-ui-merge'
  writeFileSync(factPath(), JSON.stringify({
    memories: [{ id: 'gf-live', text: '还在的全局事实', category: 'stable_profile' }],
    deleted: [{ id: 'gf-del', text: '全局库删掉的', at: '', importance: 0.8, category: 'stable_profile', deletedAt: '2026-04-01T00:00:00.000Z' }],
  }), 'utf8')
  写库(sid, {
    memories: [{ id: 'e1', text: '本会话事件', category: 'event' }],
    traces: [],
    deleted: [{ id: 'e-del', text: '本会话删掉的', at: '', importance: 0.4, category: 'event', deletedAt: '2026-04-02T00:00:00.000Z' }],
  })
  const s = buildMemoryList(假ctx({ registry: { list: () => [{ sessionIds: [sid] }] }, agents: [] }))
    .sessions.find((x) => x.id === sid)

  const 删的ids = s.deleted.map((d) => d.id).sort()
  assert.ok(删的ids.includes('gf-del'), '全局事实库的墓碑该并进会话的 deleted（回收站要能看到）')
  assert.ok(删的ids.includes('e-del'), '本会话自己的墓碑也要在')
  // 还活着的全局事实不该出现在 deleted 里
  assert.ok(!删的ids.includes('gf-live'), '没删的条目不该混进回收站')
  // 合并视图下，memories 里也该带上全局事实（事实全会话共享）
  const memIds = s.memories.map((m) => m.id)
  assert.ok(memIds.includes('gf-live'), '活着的全局事实该出现在每个会话的 memories 里')
  assert.ok(memIds.includes('e1'), '本会话事件也要在')
})

// ─────────────── MEMORY_PAGE 静态断言 ───────────────

test('MEMORY_PAGE：是一份完整可打开的页面，且前端打的接口都在服务端注册了', () => {
  assert.equal(typeof MEMORY_PAGE, 'string')
  assert.ok(MEMORY_PAGE.startsWith('<!doctype html>'), '缺 doctype ⇒ 浏览器会进怪异模式')
  assert.match(MEMORY_PAGE, /<html lang="zh">/)
  assert.match(MEMORY_PAGE, /<meta charset="utf-8">/, '缺 charset ⇒ 中文会乱码')
  assert.ok(MEMORY_PAGE.trimEnd().endsWith('</html>'), '页面没闭合')
  // 页面骨架：body 容器与几个关键控件（前端 JS 靠 getElementById 找它们）
  for (const id of ['body', 'saved']) {
    assert.ok(MEMORY_PAGE.includes(`id="${id}"`), `页面缺 #${id} 容器 —— JS 会取到 null 然后整页报错`)
  }
  // ⚠ 页面里 fetch 的每个路径，服务端都必须注册（漏一个就是 404，
  //   tests/ui-static.test.mjs 只查 src/client 那套，这份内嵌页它没覆盖）
  const 打的接口 = new Set()
  for (const m of MEMORY_PAGE.matchAll(/fetch\('([^']+)'/g)) 打的接口.add(m[1].split('?')[0])
  assert.ok(打的接口.size > 0, '这份内嵌页该会打接口（否则下面的校验没意义）')
  const 服务端 = readdirSync(join(仓库根, 'lib'))
    .filter((f) => /^routes-.*\.mjs$/.test(f))
    .map((f) => readFileSync(join(仓库根, 'lib', f), 'utf8')).join('\n')
  for (const p of 打的接口) {
    assert.ok(服务端.includes(`'${p}'`), `内嵌页打的接口 ${p} 在服务端没注册 ⇒ 点了就是 404`)
  }
  // 参数区的字段要与 POLICY_SPEC 对得上（漏一个旋钮就调不了那一项）
  for (const k of ['baseHalfLifeDays', 'threshold', 'maxItems', 'dailyQuota']) {
    assert.ok(MEMORY_PAGE.includes(k), `页面缺参数 ${k} 的输入框`)
  }
})
