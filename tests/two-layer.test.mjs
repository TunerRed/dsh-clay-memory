import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// 只用合成的库和假宿主；绝不碰调用方的 DSH_HOME。
const home = mkdtempSync(join(tmpdir(), 'fish-two-layer-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'empty-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')
const plugin = await import('../lib/index.js')
const dir = join(home, 'clay-memory')
mkdirSync(dir, { recursive: true })

const fact = (id, text, 日期 = '2026-10-01') => ({
  id, text, category: 'stable_profile', importance: 0.8, weight: 1,
  at: 日期 + 'T00:00:00Z', createdAt: 日期 + 'T00:00:00Z',
})
const event = (id, text, 日期 = '2026-10-02') => ({
  id, text, category: 'event', importance: 0.2, weight: 1,
  at: 日期 + 'T00:00:00Z', createdAt: 日期 + 'T00:00:00Z',
})
const 会话库 = (sid) => join(dir, sid + '.json')
const 读会话 = (sid) => JSON.parse(readFileSync(会话库(sid), 'utf8'))
const 读事实 = () => JSON.parse(readFileSync(join(dir, '_facts.json'), 'utf8'))
const 有事实文件 = () => existsSync(join(dir, '_facts.json'))
const 写会话 = (sid, o) => writeFileSync(会话库(sid), JSON.stringify({ version: 2, purgeEpoch: 'seed-' + sid, policy: {}, traces: [], deleted: [], ...o }))
const 写事实 = (o) => writeFileSync(join(dir, '_facts.json'), JSON.stringify({ version: 2, purgeEpoch: 'seed-facts', policy: {}, traces: [], deleted: [], ...o }))
const ids = (list) => (list || []).map((m) => m.id).sort()

// ---------- 1. 路径拆分 ----------
test('事实写进 _facts.json，事件留在会话库', () => {
  const d = plugin.loadStore('s1')
  d.memories.push(fact('f1', '用户喜欢大白饭'), event('e1', '用户今天有点累'))
  plugin.saveStore('s1', d)
  assert.ok(有事实文件(), '事实库该被创建')
  assert.deepEqual(ids(读事实().memories), ['f1'])
  assert.deepEqual(ids(读会话('s1').memories), ['e1'])
  // 事实库是「库」，不是会话：遍历会话时不能被当成一个会话
  assert.equal(plugin.是会话文件('_facts.json'), false)
  assert.equal(plugin.是会话文件('s1.json'), true)
})

test('_facts.json 撞名的会话 id 会改名，不会覆盖全局库', () => {
  const d = plugin.loadStore('_facts')
  d.memories.push(event('e9', '撞名事件'))
  plugin.saveStore('_facts', d)
  assert.deepEqual(ids(读事实().memories), ['f1'], '全局事实库没被踩')
  assert.deepEqual(ids(JSON.parse(readFileSync(join(dir, '_facts.session.json'), 'utf8')).memories), ['e9'])
})

// ---------- 2. 跨会话 / 跨工作区 ----------
test('事实跨会话可见，事件只属于自己那个会话', () => {
  const 别的 = plugin.loadStore('s2')
  assert.deepEqual(ids(别的.memories), ['f1'], '别的会话该看见全局事实，看不见 s1 的事件')
  assert.equal(别的.memories[0].category, 'stable_profile')
})

test('同一个 id 两边都有时只认事实库那份（迁移留下的副本按 id 去重）', () => {
  写会话('s3', { memories: [fact('f1', '用户喜欢大白饭（旧副本）'), event('e3', 's3 的事件')] })
  const d = plugin.loadStore('s3')
  assert.deepEqual(ids(d.memories), ['e3', 'f1'])
  assert.equal(d.memories.find((m) => m.id === 'f1').text, '用户喜欢大白饭', '事实库那份赢')
})

test('同一条事实换了 id（两个会话各自记了一遍）只露一条', () => {
  写会话('s4', { memories: [fact('a-1', '  用户喜欢大白饭 ') , event('e4', 's4 的事件')] })
  const d = plugin.loadStore('s4')
  const 命中 = d.memories.filter((m) => String(m.text).includes('大白饭'))
  assert.equal(命中.length, 1, '归一化之后算同一条')
  assert.equal(命中[0].id, 'f1', '露出来的是事实库那份')
  assert.deepEqual(ids(d.memories), ['e4', 'f1'], '自己的那条不再重复露脸（数据还在会话库里）')
})

// ---------- 3. 删除是全局的 ----------
test('删掉一条事实 → 墓碑进事实库，别的会话也看不见了', () => {
  const d = plugin.loadStore('s1')
  const 命中 = d.memories.find((m) => m.id === 'f1')
  d.memories = d.memories.filter((m) => m.id !== 'f1')
  d.deleted.push({ ...命中, category: 'stable_profile', deletedAt: '2026-10-03T00:00:00Z' })
  plugin.saveStore('s1', d)
  assert.deepEqual(ids(读事实().memories), [])
  assert.deepEqual(ids(读事实().deleted), ['f1'], '事实的墓碑归事实库')
  assert.deepEqual(ids(读会话('s1').deleted), [], '别在会话库里留一份假墓碑')
  assert.equal(plugin.loadStore('s2').memories.some((m) => m.id === 'f1'), false)
})

test('会话里软删的事件只影响自己，不写进全局库', () => {
  const d = plugin.loadStore('s1')
  const 命中 = d.memories.find((m) => m.id === 'e1')
  d.memories = d.memories.filter((m) => m.id !== 'e1')
  d.deleted.push({ ...命中, deletedAt: '2026-10-04T00:00:00Z' })
  plugin.saveStore('s1', d)
  assert.deepEqual(ids(读会话('s1').deleted), ['e1'])
  assert.deepEqual(ids(读事实().deleted), ['f1'], '全局库的墓碑没被染指')
})

// ---------- 4. 迁移留下的副本：一致就留着，事实变了就消失 ----------
test('会话库里的旧事实副本：和权威一致时保留，事实改过之后消失', () => {
  const 原样 = fact('f7', '用户是运维工程师')
  写事实({ memories: [原样] })
  写会话('s7', { memories: [{ ...原样 }, event('e7', 's7 的事件')] })
  const d = plugin.loadStore('s7')
  assert.deepEqual(ids(d.memories), ['e7', 'f7'])
  plugin.saveStore('s7', d)
  assert.deepEqual(ids(读会话('s7').memories).sort(), ['e7', 'f7'], '一模一样 → 副本留着（回退 1.3.7 还读得到）')

  // 事实改了（模型扩写过文本）→ 会话库那份旧副本不该继续留着
  const d2 = plugin.loadStore('s7')
  d2.memories = d2.memories.map((m) => (m.id === 'f7' ? { ...m, text: '用户是运维工程师（改过）', editedAt: '2026-10-05T00:00:00Z' } : m))
  plugin.saveStore('s7', d2)
  assert.equal(读事实().memories.find((m) => m.id === 'f7').text, '用户是运维工程师（改过）')
  assert.deepEqual(ids(读会话('s7').memories), ['e7'], '副本跟着事实的旧版本一起消失（免得 purge 之后原文复活）')
})

test('彻底清掉事实之后，会话库里的副本不会把它复活', () => {
  const d = plugin.loadStore('s7')
  const 命中 = d.memories.find((m) => m.id === 'f7')
  d.memories = d.memories.filter((m) => m.id !== 'f7')
  d.deleted.push({ ...命中, category: 'stable_profile', deletedAt: '2026-10-06T00:00:00Z' })
  plugin.saveStore('s7', d)
  // 真销毁那条墓碑（raw）
  const d3 = plugin.loadStore('s7')
  d3.deleted = []
  plugin.saveStore('s7', d3, { raw: true })
  assert.equal(plugin.loadStore('s7').memories.some((m) => m.id === 'f7'), false, '清干净了就是干净了')
  assert.equal(plugin.loadStore('s8').memories.some((m) => m.id === 'f7'), false)
})

// ---------- 5. 写入合并（同步，不交错）----------
test('连着两次写入不互相吞（后一次读到盘上的新内容再合并）', () => {
  const a = plugin.loadStore('s9')
  a.memories.push(fact('f9', '用户晚上喜欢喝牛奶'))
  plugin.saveStore('s9', a)
  // 模拟「另一个任务手里握着**旧**快照」（照 2026-10-24 那次静默丢失的场景）
  const 旧快照 = plugin.loadStore('s9')
  旧快照.memories.push(event('e10', '旧快照里新加的事件'))
  plugin.saveStore('s9', 旧快照)
  const 盘 = 读事实()
  assert.deepEqual(ids(盘.memories), ['f9'], '事实库没被旧快照抹掉')
  assert.ok(ids(读会话('s9').memories).includes('e10'))
})

test('事实库和会话库的代际各管各的：只换了事实库 → 会话库照常能写', () => {
  const d = plugin.loadStore('s9')
  // 模拟「事实库被彻底清理过」（别人 raw 写了一次）
  写事实({ memories: [], deleted: [], purgeEpoch: 'brand-new-epoch' })
  const d2 = plugin.loadStore('s9')
  d2.memories.push(event('e11', '代际换了也能写事件'))
  plugin.saveStore('s9', d2) // 不抛
  assert.ok(ids(读会话('s9').memories).includes('e11'))
  // 但过期的快照（还拿着老代际）必须被拦住
  assert.throws(() => plugin.saveStore('s9', d, {}), /彻底清理/)
})

// ---------- 6. factsMax 默认 6 ----------
test('factsMax 默认 6（1.3.7 是 2）', () => {
  assert.equal(plugin.blank().policy.factsMax, 6)
})

// ---------- 7. copy-to：只搬事件 ----------
function host(mod = plugin, liveAgents = []) {
  const routes = new Map()
  const agent = { options: { provider: 'fixture', model: 'fixture' } }
  const ctx = {
    agents: { list: () => liveAgents, get: () => agent }, sessions: { list: () => [] },
    get: () => null, on: () => () => {}, interval: () => () => {},
    effect: (fn) => fn(),
    webServer: { register: ({ path, handler }) => { routes.set(path, handler); return () => {} } },
    llm: { async *stream() { yield { type: 'text-delta', text: '' } } },
  }
  mod.apply(ctx)
  return {
    ctx,
    async post(path, body) {
      const handler = routes.get('/dsh-clay-memory' + path)
      assert.ok(handler, '该注册的路由在：' + path)
      const req = { url: path, async *[Symbol.asyncIterator]() { yield JSON.stringify(body) } }
      let output
      await handler(req, { writeHead() {}, end(v) { output = JSON.parse(v) } })
      return output
    },
  }
}

test('copy-to 只复制事件，事实不跟着跑（它本来就是共享的）', async () => {
  const h = host()
  const 源 = plugin.loadStore('s1')
  源.memories.push(fact('f12', '用户在用 DSH'), event('e12', 's1 的独有事件'))
  plugin.saveStore('s1', 源)
  const out = await h.post('/copy-to', { session: 's1', to: 's12' })
  assert.equal(out.ok, true)
  assert.equal(out.复制了, 1, '只数事件（e1 已经在这一串用例里被软删了，剩 e12）')
  const 到 = 读会话('s12')
  assert.deepEqual(ids(到.memories), ['e12'])
  assert.equal(到.memories.every((m) => m.source && m.source.includes('复制')), true)
  assert.deepEqual(ids(到.deleted), ['e1'], '事件的墓碑跟着走（事实的墓碑不搬：f1 那条不在里面）')
  // 目标会话照样看得见全局事实（因为它是全局的，不是复制来的）
  assert.ok(plugin.loadStore('s12').memories.some((m) => m.id === 'f12'))
})

// ---------- 8. 设置页的账：全局事实 N / 本会话事件 M ----------
test('stats：全局事实条数是全局的，事件条数是自己的', () => {
  // 开一个干净会话，免得前面用过的会话里那些「旧副本」把数字搅浑
  const 干净 = plugin.loadStore('s30')
  干净.memories.push(event('e30', 's30 自己的事件'))
  plugin.saveStore('s30', 干净)
  const h = host()
  const out = plugin.buildMemoryList(h.ctx)
  assert.equal(out.ok, true)
  const 盘 = 读事实().memories.length
  assert.equal(out.factsCount, 盘, '顶部的「全局事实」= 事实库里的条数')
  const s30 = out.sessions.find((s) => s.id === 's30')
  assert.ok(s30, 's30 该在列表里')
  assert.equal(s30.factsCount, 盘, '事实是共享的 —— 干净会话看到的就是全局那些')
  assert.equal(s30.eventCount, 1, 's30 只有自己那一条事件')
  assert.equal(s30.count, s30.factsCount + s30.eventCount, 'count 保留 = 合并视图总数（老页面还要读它）')
  // 会话库文件里**只有事件** —— 事实一条都没写进会话份
  assert.deepEqual(ids(读会话('s30').memories), ['e30'])
})

// ---------- 9. 迁移脚本 ----------
const 脚本 = fileURLToPath(new URL('../tools/migrate-facts.mjs', import.meta.url))
const 跑 = (home2, ...args) => spawnSync(process.execPath, [脚本, '--home', home2, ...args], { encoding: 'utf8' })

function 造老库(基) {
  const 家 = join(基, '.dsh')
  const 库 = join(家, 'clay-memory')
  mkdirSync(库, { recursive: true })
  const 老 = (id, text, category, 日 = '2026-09-01') => ({ id, text, category, importance: 0.7, weight: 1, at: 日 + 'T00:00:00Z', createdAt: 日 + 'T00:00:00Z' })
  writeFileSync(join(库, 'session-x.json'), JSON.stringify({
    version: 2, purgeEpoch: 'ex', policy: {}, traces: [],
    memories: [老('x-1', '用户喜欢大白饭', 'stable_profile'), 老('x-2', '用户养了一只猫', 'stable_profile'), 老('x-e', '一个事件', 'event')],
    deleted: [],
  }))
  writeFileSync(join(库, 'session-y.json'), JSON.stringify({
    version: 2, purgeEpoch: 'ey', policy: {}, traces: [],
    // 和 x-1 同一条事实（只有空白/大小写差异），但更晚、更重要 → 去重后更新的是 x-1 那份
    memories: [{ ...老('y-1', '用户喜欢大白饭', 'stable_profile', '2026-09-20'), importance: 0.9 }, 老('y-e', '另一个事件', 'event')],
    deleted: [],
  }))
  return 家
}

test('迁移脚本：默认 dry-run 什么都不写，--apply 才搬，且不删原库副本', () => {
  const 基 = mkdtempSync(join(tmpdir(), 'fish-mig-'))
  const 家 = 造老库(基)
  const 库 = join(家, 'clay-memory')
  const 前 = readFileSync(join(库, 'session-x.json'), 'utf8')

  const 干 = 跑(家)
  assert.equal(干.status, 0, 干.stderr)
  assert.match(干.stdout, /DRY-RUN/)
  assert.equal(existsSync(join(库, '_facts.json')), false, 'dry-run 不许建库')
  assert.equal(readFileSync(join(库, 'session-x.json'), 'utf8'), 前, 'dry-run 一个字都不许改')

  const 干跑 = 跑(家, '--apply')
  assert.equal(干跑.status, 0, 干跑.stderr)
  const 事实 = JSON.parse(readFileSync(join(库, '_facts.json'), 'utf8'))
  assert.deepEqual(ids(事实.memories), ['x-1', 'x-2'], '同一条事实只进一次（y-1 并进 x-1）')
  assert.equal(事实.memories.find((m) => m.id === 'x-1').importance, 0.9, '更新的那份赢，id 不换')
  assert.equal(readFileSync(join(库, 'session-x.json'), 'utf8'), 前, '默认不删原库副本')
  assert.equal(readFileSync(join(库, 'session-y.json'), 'utf8').includes('y-1'), true)
  const 备份 = readdirSync(join(家, 'clay-memory-backup'))
  assert.equal(备份.length, 1, '动盘之前整目录备份了一份')
  assert.ok(existsSync(join(家, 'clay-memory-backup', 备份[0], 'session-x.json')))

  // 幂等：再跑一次，一条也不新增
  const 再 = 跑(家, '--apply', '--force')
  assert.equal(再.status, 0, 再.stderr)
  assert.match(再.stdout, /新增进全局库\s+0 条/)
  assert.deepEqual(ids(JSON.parse(readFileSync(join(库, '_facts.json'), 'utf8')).memories), ['x-1', 'x-2'])

  // 不带 --force 的第二次跑：直接认标记跳过
  const 三 = 跑(家, '--apply')
  assert.equal(三.status, 0)
  assert.match(三.stdout, /已经迁移过了/)

  // --purge 才会删副本（而且只删已经进全局库的那些）
  const 清 = 跑(家, '--apply', '--purge', '--force')
  assert.equal(清.status, 0, 清.stderr)
  const x = JSON.parse(readFileSync(join(库, 'session-x.json'), 'utf8'))
  assert.deepEqual(ids(x.memories), ['x-e'], '事实搬走了、事件还留着')
  const y = JSON.parse(readFileSync(join(库, 'session-y.json'), 'utf8'))
  assert.deepEqual(ids(y.memories), ['y-1', 'y-e'], '去重没搬的那份不在全局库 id 里 → 留着（不然就丢了）')
  assert.equal(existsSync(join(库, 'session-x.json.bak')), false, '本来就没有 .bak，别凭空造')
  rmSync(基, { recursive: true, force: true })
})

test.after(() => {
  try { rmSync(home, { recursive: true, force: true }) } catch (error) {}
})
