import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 宿主依赖解析（lib/hostdeps.mjs）回归 —— 这个模块**零测试覆盖**，却是「插件能不能激活」的命门。
//
// 🔴 它存在的理由（2026-10-16 一位用户的完整报告）：index.js 顶部裸 import
//   `@deepseek-ai/schemastery` 和 `dsh-tools`，而它们在 package.json 里是 **optional peer**
//   ⇒ 桌面版 profile（`autoInstallPeers: false`）**永远不装它们**
//   ⇒ 插件整条不激活，DSH 只留一句 `warning: 1 entry did not activate … failed to import`。
//
// 要守住的不变量：
//   ① **优先从宿主那棵树解析**（跟宿主用同一份，行为最一致）；`DSH_HOST_MODULES` 是第一优先候选根
//      —— 这既是策略，也是本测试注入假宿主包的唯一入口；
//   ② 三个包**任何一个拿不到都不能抛** —— 必须返回降级实现 + 把原因写进 notes；
//   ③ `dsh-tools` 拿不到 → 本地 `defineTool` 顶上，且**保留宿主那条 additionalProperties 校验**
//      （2026-10-14 那次真实报错就是被它校验出来的，本地实现不能把它丢掉）；
//   ④ `dsh-llm` 拿不到 → 本地 `createUserMessage` 兜底，且**必须透传 `source`**
//      —— tools.mjs 的 `是真人消息()` 靠 `source.kind === 'user'` 过滤，
//      丢了 source 就会把 DSH 自己塞的 runtime-context / skill-catalog / time-context
//      当成「用户说的话」，F12 存下来的「原话」全是系统文本（真机实测踩过）；
//   ⑤ `schemastery` 彻底拿不到 → `z = null`，插件照常加载（设置页降级，本体不死）。
//
// ⚠ 本文件不联网、不碰真实 DSH 家目录：三个环境变量全部指向自建临时目录，
//   其中 `DSH_HOST_MODULES` 按需指向「造出来的假宿主包」以驱动主路径。
const home = mkdtempSync(join(tmpdir(), 'fish-cov-hostdeps-'))
process.env.DSH_HOME = home
process.env.APPDATA = join(home, 'empty-appdata')
// 默认先指向一个**不存在**的目录（跟 nature.test.mjs 等现有测试同款做法）→ 逼出降级路径
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')

const { candidateRoots, loadHostDeps } = await import('../../lib/hostdeps.mjs')

// 在假宿主树里造一个能被 `await import()` 的包
function 造假宿主包(包名, 源码, 子树 = null) {
  const 根 = 子树 || mkdtempSync(join(home, 'host-'))
  const dir = join(根, 包名)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/' + 包名,
    version: '0.0.0-test',
    type: 'module',
    exports: { '.': './index.js' },
  }, null, 2), 'utf8')
  writeFileSync(join(dir, 'index.js'), 源码, 'utf8')
  return 根
}

// 用指定的假宿主树跑一次 loadHostDeps（改 env 后必须**重新**读候选根，所以每次都新调）
async function 用宿主树(根) {
  process.env.DSH_HOST_MODULES = 根
  try {
    return await loadHostDeps()
  } finally {
    process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
  }
}

test('candidateRoots：DSH_HOST_MODULES 排第一，插件自己那棵树排最后', () => {
  const 假根 = join(home, 'my-host-root')
  process.env.DSH_HOST_MODULES = 假根
  const 根们 = candidateRoots()
  process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')

  assert.ok(Array.isArray(根们) && 根们.length > 1, '候选根不该为空')
  assert.equal(根们[0], 假根, 'DSH_HOST_MODULES 必须是第一优先（否则「跟宿主用同一份」这条策略失效）')
  // 自己那份（package.json 的 dependencies）放最后：前面优先跟宿主同一份
  const 最后 = 根们[根们.length - 1]
  assert.match(最后, /node_modules[\\/]@deepseek-ai$/, '最后一个候选根该是插件自己那棵树')
  assert.ok(!最后.startsWith(home), '插件自己那棵树不该落在临时目录里（应按模块位置算，别依赖 cwd）')
  // 去重
  assert.equal(new Set(根们).size, 根们.length, '候选根有重复项')
  // APPDATA 下那几条也要在（Windows 全局安装的路径）
  assert.ok(根们.some((p) => p.includes(join('npm', 'node_modules'))), '缺 %APPDATA%/npm/node_modules 这一路')
})

test('candidateRoots：DSH_HOME/profiles 下每个 profile 的 node_modules 都算候选', () => {
  // 有些机器上这些包是被别的插件 hoist 到 profile 根上的
  mkdirSync(join(home, 'profiles', 'fish', 'node_modules', '@deepseek-ai'), { recursive: true })
  mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
  const 根们 = candidateRoots()
  assert.ok(
    根们.some((p) => p === join(home, 'profiles', 'fish', 'node_modules', '@deepseek-ai')),
    'profile 树里的候选根没被列出来'
  )
  // profiles 目录不存在时也不能抛（catch 掉）
  assert.doesNotThrow(() => candidateRoots())
})

test('① 优先从宿主树取：假 schemastery 被取到，z 就是它导出的那份', async () => {
  const 根 = 造假宿主包('schemastery', 'export default function 假Config(x){ return { 假: true, x } }\n')
  const { z, notes } = await 用宿主树(根)

  assert.equal(typeof z, 'function', 'z 该是宿主 schemastery 导出的东西，不是 null')
  assert.deepEqual(z('试'), { 假: true, x: '试' }, 'z 该真是假包那一份（说明走的是宿主树）')
  assert.ok(notes.some((n) => /schemastery：从宿主树取到/.test(n)), 'notes 要写清「从宿主树取到」，方便远程排查：' + JSON.stringify(notes))
  // 走通了宿主树，就不该再报「彻底拿不到」
  assert.ok(!notes.some((n) => /schemastery 彻底拿不到/.test(n)), '明明取到了却还报彻底拿不到：' + JSON.stringify(notes))
})

test('① 优先从宿主树取：假 dsh-tools 的 defineTool 被采用（不是本地兜底）', async () => {
  const 根 = mkdtempSync(join(home, 'host-tools-'))
  造假宿主包('schemastery', 'export default {}\n', 根)
  造假宿主包('dsh-tools', 'export function defineTool(o){ return { 宿主给的: true, name: o.name } }\n', 根)
  const { defineTool, notes } = await 用宿主树(根)

  assert.equal(typeof defineTool, 'function')
  assert.deepEqual(defineTool({ name: 'remember', parameters: { type: 'object' } }),
    { 宿主给的: true, name: 'remember' },
    '该用宿主那份 defineTool；若返回原样 options 说明错用了本地兜底')
  assert.ok(notes.some((n) => /dsh-tools：从宿主树取到/.test(n)))
})

test('② 三个包全拿不到：一个都不抛，全部降级 + notes 留痕', async () => {
  // ⚠ 不能用 assert.doesNotThrow(async …) —— 它对返回的 promise 不等待，
  //   异步抛错会被当成「没抛」放过，这正是本条要守的东西，不能测漏。
  let r = null
  let 抛了 = null
  try {
    r = await loadHostDeps()
  } catch (e) {
    抛了 = e
  }
  assert.equal(抛了, null,
    '宿主依赖缺失绝不能抛 —— 那会让整条插件不激活（2026-10-16 那个故障）：' + (抛了 && 抛了.message))
  assert.ok(r, 'loadHostDeps 该返回结果对象')

  // ⑤ schemastery 彻底拿不到 → z = null，插件照常加载
  assert.equal(r.z, null, 'schemastery 拿不到时 z 该是 null（设置页降级，本体不死）')
  // ③ defineTool 有本地兜底
  assert.equal(typeof r.defineTool, 'function', 'defineTool 必须有本地兜底，不能是 null')
  // ④ createUserMessage 有本地兜底
  assert.equal(typeof r.createUserMessage, 'function', 'createUserMessage 必须有本地兜底，不能是 null')

  // notes 是远程排查的唯一线索，三条都得在（静默降级 = 出问题时无从查起）
  assert.ok(Array.isArray(r.notes) && r.notes.length >= 3, 'notes 太短，降级原因没留全：' + JSON.stringify(r.notes))
  assert.ok(r.notes.some((n) => /schemastery 彻底拿不到/.test(n)), '缺 schemastery 的降级说明')
  assert.ok(r.notes.some((n) => /dsh-tools 拿不到/.test(n)), '缺 dsh-tools 的降级说明')
  assert.ok(r.notes.some((n) => /dsh-llm 拿不到/.test(n)), '缺 dsh-llm 的降级说明')
  // 那句「插件本体照常跑」的承诺要写在日志里，用户看到才不慌
  assert.ok(r.notes.some((n) => /插件本体照常跑/.test(n)), 'schemastery 那条要说明「插件本体照常跑」')
})

test('③ 本地 defineTool：合法 schema 原样返回，不改内容', async () => {
  const 定义 = {
    name: 'remember',
    description: '记一条',
    parameters: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } } } },
  }
  const { defineTool } = await loadHostDeps()
  // 用真实工具的形状跑一遍（tools.mjs 里三个工具都是这个结构）
  assert.deepEqual(defineTool(定义), 定义, '本地兜底该原样返回 options，不许改动工具定义')
})

test('③ 本地 defineTool：parameters 是 object 却没写 additionalProperties → 抛', async () => {
  const { defineTool } = await loadHostDeps()
  // ⚠ 这条校验**故意保留**：宿主的 defineTool 会做 spec→JSONSchema 转换 + 参数校验，
  //   2026-10-14 那次 additionalProperties 报错就是被它逮出来的。本地实现不能把它丢了，
  //   否则换到桌面版（走本地兜底）同一个错误就变成静默通过、上线才炸。
  assert.throws(
    () => defineTool({ name: 'remember', parameters: { type: 'object' } }),
    /defineTool\(remember\): parameters 是 object 却没写 additionalProperties/,
    '缺 additionalProperties 必须抛，且报错里要带工具名和出问题的位置'
  )
  // output.schema 也要查
  assert.throws(
    () => defineTool({ name: 'recall', parameters: { type: 'object', additionalProperties: false }, output: { schema: { type: 'object' } } }),
    /output\.schema 是 object 却没写 additionalProperties/
  )
  // 递归到嵌套 properties
  assert.throws(
    () => defineTool({
      name: 'trace',
      parameters: { type: 'object', additionalProperties: false, properties: { 内层: { type: 'object' } } },
    }),
    /parameters\.properties\.内层 是 object 却没写 additionalProperties/,
    '嵌套的 object 也要递归查（宿主就是这么查的）'
  )
  // 写了就不抛
  assert.doesNotThrow(() => defineTool({ name: 'x', parameters: { type: 'object', additionalProperties: false } }))
  // 不是 object 类型的不受这条管
  assert.doesNotThrow(() => defineTool({ name: 'x', parameters: { type: 'string' } }))
  assert.doesNotThrow(() => defineTool({ name: 'x', parameters: { type: 'array', items: { type: 'string' } } }))
  // parameters / output 整个没给也不该抛（check 对 null 直接返回）
  assert.doesNotThrow(() => defineTool({ name: 'x' }))
  assert.doesNotThrow(() => defineTool({ name: 'x', output: {} }))
})

test('④ 本地 createUserMessage：必须透传 source（否则「原话」会全是系统文本）', async () => {
  const { createUserMessage } = await loadHostDeps()
  const content = [{ type: 'text', text: '我下周三去北京' }]
  const msg = createUserMessage({ content, source: { kind: 'user' } })

  assert.equal(msg.role, 'user', 'role 恒为 user')
  assert.equal(msg.content, content, 'content 数组要原样保留（同一个引用也行，别丢内容）')
  // ⚠⚠ 这一条是本测试最重要的断言：
  //   tools.mjs 的 `是真人消息(payload)` 靠 `payload.source.kind === 'user'` 判断
  //   「这条是不是真由人打出来的」。DSH 每轮会塞好几条 role='user' 的消息
  //   （runtime-context / skill-catalog / time-context / plugin:*），
  //   丢了 source 就会把 `Time sampled while preparing turn 1…` 当成用户原话存进记忆。
  assert.deepEqual(msg.source, { kind: 'user' }, 'source 丢了 → 系统消息会被当成真人原话（F12 存原话全脏）')

  // source.kind = 'plugin' 的也要如实透传（好让上层把它过滤掉）
  const 插件消息 = createUserMessage({ content, source: { kind: 'plugin', plugin: 'dsh-clay-memory' } })
  assert.deepEqual(插件消息.source, { kind: 'plugin', plugin: 'dsh-clay-memory' })

  // 没给 source → 不加这个字段（`是真人消息` 对 undefined 放行，老宿主行为）
  const 无源 = createUserMessage({ content })
  assert.ok(!('source' in 无源), '没给 source 时不该凭空造一个')
})

test('④ 本地 createUserMessage：id 是唯一 UUID，content 非数组时兜成空数组', async () => {
  const { createUserMessage } = await loadHostDeps()
  const a = createUserMessage({ content: [{ type: 'text', text: 'x' }] })
  const b = createUserMessage({ content: [{ type: 'text', text: 'x' }] })

  assert.match(a.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'id 该是 UUID')
  assert.notEqual(a.id, b.id, '两条消息的 id 不能相同（宿主按 id 认消息）')

  // content 不是数组 → 空数组（不能让下游拿到字符串去 .map）
  assert.deepEqual(createUserMessage({ content: '纯字符串' }).content, [])
  assert.deepEqual(createUserMessage({}).content, [])
  // payload 是垃圾也不该抛（fire-and-forget 的调用点很多，抛了会打断主流程）
  assert.doesNotThrow(() => createUserMessage(null))
  assert.doesNotThrow(() => createUserMessage(undefined))
  assert.doesNotThrow(() => createUserMessage('字符串'))
  assert.equal(createUserMessage(null).role, 'user')
  assert.deepEqual(createUserMessage(null).content, [])
})

test('宿主包里入口文件缺失 → 当作拿不到，继续降级（不抛）', async () => {
  // package.json 写了 exports，但文件不存在 → entryUrlFor 返回 null → 跳过这个根
  const 根 = mkdtempSync(join(home, 'host-broken-'))
  const dir = join(根, 'schemastery')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/schemastery', version: '0.0.0-test', type: 'module', exports: { '.': './不存在.js' },
  }), 'utf8')

  const { z, notes } = await 用宿主树(根)
  assert.equal(z, null, '入口文件不存在该降级成 null，不能抛')
  assert.ok(notes.some((n) => /schemastery 彻底拿不到/.test(n)), '要留下降级说明')
})

test('宿主包入口自己抛错 → 也不影响插件加载（记进 notes 后继续）', async () => {
  const 根 = 造假宿主包('dsh-tools', 'throw new Error("宿主包自己坏了")\n')
  const { defineTool, notes } = await 用宿主树(根)
  assert.equal(typeof defineTool, 'function', '宿主包 import 失败也要有本地兜底')
  // 失败原因要写进 notes（`宿主树里都不行（ERR:路径）`），这是排查降级问题的唯一线索
  assert.ok(notes.some((n) => /dsh-tools/.test(n)), 'notes 要提到 dsh-tools 的解析结果：' + JSON.stringify(notes))
})
