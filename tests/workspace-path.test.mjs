// 1.8.38 P1：workspace 路径碰撞修复 —— 文件名 SHA-256 哈希（无碰撞）+ wsRoot 校验（拒绝错位文件）。
// 覆盖：规范化规则（Windows/Linux）、不同路径不同名、同路径幂等、旧消毒名升级兼容、wsRoot 不匹配拒绝读。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'fish-wspath-'))
process.env.DSH_HOME = home
const paths = await import('../lib/paths.mjs')
const store = await import('../lib/store-core.mjs')
store.接报信(() => {}) // 测试环境不接真 diag，报信静默
const dir = join(home, 'clay-memory')
mkdirSync(dir, { recursive: true })

const 写库 = (p, 内存) => writeFileSync(p, JSON.stringify({
  version: 2, purgeEpoch: 'e-' + Math.random().toString(36).slice(2, 8),
  policy: {}, memories: 内存, traces: [], deleted: [],
}), 'utf8')

test('规范化：Windows 大小写 / 分隔符 / . / .. 归一', () => {
  // 1.8.39 B：盘符路径目录段统一小写（Windows 文件系统大小写不敏感，同一目录必须同一标识）
  assert.equal(paths.规范化('c:\\WORK\\a\\b'), 'C:/work/a/b')
  assert.equal(paths.规范化('C:/WORK/a/b'), 'C:/work/a/b')
  assert.equal(paths.规范化('C:/Work/Proj'), 'C:/work/proj')
  assert.equal(paths.规范化('C:/a/./b'), 'C:/a/b')
  assert.equal(paths.规范化('C:/a/../b'), 'C:/b')
  assert.equal(paths.规范化('C:/a/../../..'), 'C:/')
  assert.equal(paths.规范化('g:/'), 'G:/')
  assert.equal(paths.规范化('G:'), 'G:/')
})

test('规范化：Linux 大小写敏感保留 + 根目录不坍缩（1.8.39 B）', () => {
  assert.equal(paths.规范化('/'), '/', 'Linux 根目录是合法工作区，不得变空串')
  assert.equal(paths.规范化('//'), '/')
  assert.equal(paths.规范化('/Work/Proj'), '/Work/Proj', 'Linux 保留大小写')
  assert.notEqual(paths.规范化('/Work'), paths.规范化('/work'), 'Linux 大小写不同目录')
  assert.notEqual(paths.工作区文件('/'), '', '根目录能生成工作区文件名')
  assert.match(paths.工作区文件('/').split(/[\\/]/).pop(), /^_ws-[0-9a-f]{32}\.json$/)
})

test('工作区文件：Windows 大小写变体归同一标识，Linux 不混', () => {
  assert.equal(paths.工作区文件('C:/Work/Proj'), paths.工作区文件('c:/work/proj'))
  assert.equal(paths.工作区文件('G:/Tmp/X'), paths.工作区文件('g:\\tmp\\x'))
  assert.notEqual(paths.工作区文件('/Work'), paths.工作区文件('/work'))
})

test('wsRoot 校验：Windows 大小写差异仍被认作本工作区（旧 1.8.38 大写 wsRoot 文件升级兼容）', () => {
  const cwd = 'C:/Work/Compat'
  const 名 = paths.工作区文件(cwd)
  // 手工放一个 1.8.38 时代的文件：wsRoot 存的大写原文
  writeFileSync(名, JSON.stringify({
    version: 2, purgeEpoch: 'ecompat', wsRoot: 'C:/Work/Compat', policy: {},
    memories: [{ id: 'cw1', text: '兼容条目', category: 'workspace' }], traces: [], deleted: [],
  }), 'utf8')
  const 视 = store.loadStoreJSON('compat-s1', cwd)
  assert.ok((视.memories || []).some((m) => m.id === 'cw1'), '大写 wsRoot 的旧文件仍要读得到')
  assert.equal(视.workspacePurgeEpoch, 'ecompat')
  // 真的不同工作区（不同目录）依然拒绝
  const 视2 = store.loadStoreJSON('compat-s1', 'C:/Work/Other')
  assert.ok(!(视2.memories || []).some((m) => m.id === 'cw1'), '不同工作区仍不可见')
})

test('规范化：Linux 路径确定性', () => {
  assert.equal(paths.规范化('/home/user/x'), '/home/user/x')
  assert.equal(paths.规范化('/a/./b'), '/a/b')
  assert.equal(paths.规范化('/a/../..'), '/', '绝对路径 .. 超根折叠为根')
  assert.equal(paths.规范化('a/../..'), '..', '相对路径超根保留 ..')
  assert.equal(paths.规范化('/home//user/'), '/home/user')
})

test('工作区文件：不同路径不同名（碰撞修复），同路径幂等', () => {
  const f1 = paths.工作区文件('C:/work/a/b')
  const f2 = paths.工作区文件('C:/work/a_b')
  assert.notEqual(f1, f2, '字符替换时代会碰撞的两个路径必须不同名')
  assert.equal(f1, paths.工作区文件('c:\\work\\a\\b'), '同一路径（写法不同）必须同名')
  assert.equal(f1, paths.工作区文件('C:/work/a/b/'))
  assert.match(f1.split(/[\\/]/).pop(), /^_ws-[0-9a-f]{32}\.json$/, '文件名 = 32 位 hex 哈希')
  assert.ok(!f1.includes('work'), '路径不得出现在文件名里')
})

test('旧消毒名文件升级后仍可读（读兼容）', () => {
  const cwd = 'C:/work/legacy'
  const 旧名 = paths.工作区文件旧(cwd)
  writeFileSync(旧名, JSON.stringify({
    version: 2, purgeEpoch: 'elegacy', wsRoot: cwd, policy: {},
    memories: [{ id: 'old1', text: '旧文件条目', category: 'workspace' }], traces: [], deleted: [],
  }), 'utf8')
  const 视 = store.loadStoreJSON('legacy-s1', cwd)
  assert.ok((视.memories || []).some((m) => m.id === 'old1'), '旧消毒名文件要读得到')
  assert.equal(视.workspacePurgeEpoch, 'elegacy')
})

test('旧消毒名文件在、哈希名不在：写路径也要兜底读，不得误判代际/清空工作区层', () => {
  const cwd = 'C:/work/legacy-write'
  const 旧名 = paths.工作区文件旧(cwd)
  const 新名 = paths.工作区文件(cwd)
  assert.notEqual(旧名, 新名)
  writeFileSync(旧名, JSON.stringify({
    version: 2, purgeEpoch: 'elegacy-w', wsRoot: cwd, policy: {},
    memories: [{ id: 'oldw1', text: '升级前的工作区条目', category: 'workspace' }], traces: [], deleted: [],
  }), 'utf8')
  // 升级后第一次写：loadStoreJSON（读旧名）→ 加一条 → saveStoreJSON（写新名）
  const 视 = store.loadStoreJSON('legacy-w-s1', cwd)
  assert.ok((视.memories || []).some((m) => m.id === 'oldw1'), '写前读得到旧条目')
  视.memories.push({ id: 'neww1', text: '升级后新条目', category: 'workspace', scope: 'workspace:' + cwd })
  store.saveStoreJSON('legacy-w-s1', 视, {}, cwd)
  const 新盘 = JSON.parse(readFileSync(新名, 'utf8'))
  assert.ok((新盘.memories || []).some((m) => m.id === 'oldw1'), '旧工作区条目不得丢')
  assert.ok((新盘.memories || []).some((m) => m.id === 'neww1'), '新条目落新哈希名文件')
  const 再读 = store.loadStoreJSON('legacy-w-s1', cwd)
  assert.equal((再读.memories || []).filter((m) => m.id === 'oldw1').length, 1, '不重复')
})

test('wsRoot 校验：别的库放错文件名位置 → 拒绝读', () => {
  const A = 'C:/work/ws-a'
  const B = 'C:/work/ws-b'
  // 手工把 B 的内容写成 A 的哈希文件名（模拟放错文件 / 被别的库覆盖）
  const 名A = paths.工作区文件(A)
  写库(名A, [{ id: 'b1', text: 'B 的条目', category: 'workspace' }])
  writeFileSync(名A, JSON.stringify({
    version: 2, purgeEpoch: 'eB', wsRoot: B, policy: {},
    memories: [{ id: 'b1', text: 'B 的条目', category: 'workspace' }], traces: [], deleted: [],
  }), 'utf8')
  const 视 = store.loadStoreJSON('wsa-s1', A)
  assert.ok(!(视.memories || []).some((m) => m.id === 'b1'), 'wsRoot 不匹配的文件不得当作本工作区数据')
  assert.equal(视.workspacePurgeEpoch, '', '不匹配文件的工作区代际不得带进视图')
  // A 自己正常写入后，读得到 A 的内容、仍读不到 B 的内容
  写库(名A, [{ id: 'a1', text: 'A 自己的条目', category: 'workspace' }])
  const 视2 = store.loadStoreJSON('wsa-s1', A)
  assert.ok((视2.memories || []).some((m) => m.id === 'a1'), 'A 自己的内容正常')
  assert.ok(!(视2.memories || []).some((m) => m.id === 'b1'), 'B 的内容仍不可见')
})

test('工作区文件id：新哈希名与旧消毒名都能反推兜底串', () => {
  assert.equal(paths.工作区文件id('_ws-1e496b6c23a04cdbd6e9cf92e6609b77.json'), '1e496b6c23a04cdbd6e9cf92e6609b77')
  assert.equal(paths.工作区文件id('_ws-C__work_a_b.json'), 'C__work_a_b')
  assert.equal(paths.工作区文件id('别的.json'), '')
})
