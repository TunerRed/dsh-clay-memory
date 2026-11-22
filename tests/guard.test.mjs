// 工具拦截（机制层）：规则编译、匹配、guard 返回值
//
// ⭐ 这个模块一条规则都不内置，规则全由用户写在 toolGuard.rules 里。
// 所以测试也只测「机制对不对」——通配、参数正则、缺参保守不拦、坏规则跳过、
// 防死循环的重复计数、以及「改了配置不用重启」的懒取。
//
// 判别力说明：每条用例都构造了「该拦 / 不该拦」成对场景，光让实现返回自己期望的
// 常量是过不了的（比如把 参数命中 写成永真，case 2/3 立刻红）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  工具名命中,
  值文本,
  参数命中,
  编译一条,
  编译规则组,
  一条命中,
  找命中,
  取规则,
  造守卫,
  规范工作区,
  工作区命中,
} = await import('../lib/guard.mjs')

test('工具名命中：通配 / 前缀 / 精确 / 不中', () => {
  assert.equal(工具名命中('*', 'bash'), true)
  assert.equal(工具名命中('bash*', 'bash'), true)
  assert.equal(工具名命中('bash*', 'bash-local'), true)
  assert.equal(工具名命中('bash', 'bash-local'), false, '没有 * 就是精确匹配')
  assert.equal(工具名命中('read', 'read'), true)
  assert.equal(工具名命中('rea', 'read'), false)
  assert.equal(工具名命中('', 'read'), false)
  assert.equal(工具名命中(undefined, 'read'), false)
})

test('工具名命中：shell 族互通（bash* 也能拦 pwsh / ops_bash）', () => {
  // 这台机器上的 shell 工具叫 pwsh / ops_bash，翻译出来的规则常写 bash*，得能对上
  assert.equal(工具名命中('bash*', 'pwsh'), true)
  assert.equal(工具名命中('bash*', 'ops_bash'), true)
  assert.equal(工具名命中('bash*', 'powershell'), true)
  assert.equal(工具名命中('bash', 'pwsh'), true)
  assert.equal(工具名命中('pwsh*', 'bash'), true)
  assert.equal(工具名命中('shell*', 'ops_bash'), true)
  // 别误伤：非 shell 工具照样按名字走
  assert.equal(工具名命中('bash*', 'read'), false)
  assert.equal(工具名命中('read*', 'pwsh'), false)
  assert.equal(工具名命中('grep', 'pwsh'), false)
})

test('值文本：字符串原样，其余 JSON，空值空串', () => {
  assert.equal(值文本('C:\\Windows'), 'C:\\Windows')
  assert.equal(值文本(12), '12')
  assert.equal(值文本(['a', 'b']), '["a","b"]')
  assert.equal(值文本({ k: 'v' }), '{"k":"v"}')
  assert.equal(值文本(null), '')
  assert.equal(值文本(undefined), '')
})

test('参数命中：没写 args 就只按工具名', () => {
  assert.equal(参数命中(null, { file_path: 'x' }), true)
  assert.equal(参数命中(undefined, undefined), true)
  assert.equal(参数命中({}, { file_path: 'x' }), true)
})

test('参数命中：正则命中 / 不命中 / 参数没给', () => {
  const 规 = { file_path: ['^/etc/', '^/var/'] }
  assert.equal(参数命中(规, { file_path: '/etc/passwd' }), true)
  assert.equal(参数命中(规, { file_path: '/var/log/x' }), true)
  assert.equal(参数命中(规, { file_path: '/home/u/x' }), false)
  assert.equal(参数命中(规, { file_path: undefined }), false, '参数压根没给 ⇒ 不拦（保守）')
  assert.equal(参数命中(规, {}), false)
})

test('参数命中：Windows 路径反斜杠要能吃住', () => {
  const 规 = { file_path: [/^C:\\Windows/] }
  assert.equal(参数命中(规, { file_path: 'C:\\Windows\\System32' }), true)
  assert.equal(参数命中(规, { file_path: 'D:\\Windows\\System32' }), false)
})

test('参数命中：键之间 AND，键内 OR', () => {
  const 规 = { file_path: ['^/etc/'], command: ['rm', 'mkfs'] }
  assert.equal(参数命中(规, { file_path: '/etc/passwd', command: 'rm -rf /' }), true)
  assert.equal(参数命中(规, { file_path: '/etc/passwd', command: 'cat x' }), false, '一个键没中就不拦')
  assert.equal(参数命中(规, { command: 'rm -rf /' }), false, '缺一个键也不拦')
})

test('编译一条：缺 tools / 非对象 / 不支持的 action 都报错', () => {
  assert.match(编译一条({ id: 'x' }, 0).错误, /缺 tools/)
  assert.match(编译一条(null, 1).错误, /第 2 条不是对象/)
  assert.match(编译一条({ tools: ['read'], action: 'ask' }, 2).错误, /只支持 deny/)
  assert.match(编译一条({ tools: [] }, 3).错误, /缺 tools/)
})

test('编译一条：成功时补默认 id / reason / action', () => {
  const { 规则, 错误 } = 编译一条({ tools: ['read'] }, 0)
  assert.equal(错误, undefined)
  assert.equal(规则.id, '规则1')
  assert.equal(规则.action, 'deny')
  assert.equal(规则.reason, '被工具拦截规则拦下了')
  assert.equal(规则.args, null)
})

test('编译规则组：坏规则跳过，不连坐', () => {
  const { 规则们, 错误 } = 编译规则组([
    { id: 'ok', tools: ['read'] },
    { id: 'bad' }, // 没 tools
    { id: 'ok2', tools: ['write'] },
  ])
  assert.deepEqual(规则们.map((r) => r.id), ['ok', 'ok2'])
  assert.equal(错误.length, 1)
  assert.match(错误[0], /第 2 条缺 tools/)
})

test('一条命中 / 找命中：工具名 + 参数都要过', () => {
  const { 规则们 } = 编译规则组([
    { id: 'a', tools: ['read'], args: { file_path: ['^/etc/'] } },
    { id: 'b', tools: ['bash*'] },
  ])
  assert.equal(一条命中(规则们[0], { name: 'read', arguments: { file_path: '/etc/x' } }), true)
  assert.equal(一条命中(规则们[0], { name: 'read', arguments: { file_path: '/tmp/x' } }), false)
  assert.equal(找命中(规则们, { name: 'bash', arguments: {} }).id, 'b')
  assert.equal(找命中(规则们, { name: 'grep', arguments: {} }), null)
})

test('取规则：没配 / 关掉 / 正常三种', () => {
  assert.deepEqual(取规则({}).开, false)
  assert.deepEqual(取规则(null).规则们, [])
  assert.equal(取规则({ toolGuard: { enabled: false, rules: [{ tools: ['*'] }] } }).开, false)
  const 开 = 取规则({ toolGuard: { rules: [{ tools: ['*'] }] } })
  assert.equal(开.开, true)
  assert.equal(开.规则们.length, 1)
})

test('造守卫：不命中放行（undefined），命中返回拒绝原因', () => {
  const { 规则们 } = 编译规则组([{ id: 'et', tools: ['read'], args: { file_path: ['^/etc/'] }, reason: '别碰系统目录' }])
  const 守卫 = 造守卫(规则们)
  assert.equal(守卫({ name: 'read', arguments: { file_path: '/tmp/a' } }), undefined)
  const 拒 = 守卫({ name: 'read', arguments: { file_path: '/etc/passwd' } })
  assert.equal(拒.reason, '别碰系统目录')
})

test('造守卫：同一个调用反复被拒，第三次开始提醒别再原样重试', () => {
  const { 规则们 } = 编译规则组([{ id: 'et', tools: ['read'], args: { file_path: ['^/etc/'] }, reason: '别碰系统目录' }])
  const 守卫 = 造守卫(规则们)
  const 调用 = { name: 'read', arguments: { file_path: '/etc/passwd' } }
  assert.doesNotMatch(守卫(调用).reason, /试过/)
  assert.doesNotMatch(守卫(调用).reason, /试过/)
  assert.match(守卫(调用).reason, /试过 3 次/)
  // 换个参数是另一次调用，计数从头
  assert.doesNotMatch(守卫({ name: 'read', arguments: { file_path: '/etc/shadow' } }).reason, /试过/)
})

test('造守卫：懒取规则——改了配置下一次调用就生效，不用重启', () => {
  let 当前 = []
  const 守卫 = 造守卫(() => 当前)
  const 调用 = { name: 'read', arguments: { file_path: '/etc/passwd' } }
  assert.equal(守卫(调用), undefined)
  当前 = 编译规则组([{ id: 'et', tools: ['read'], args: { file_path: ['^/etc/'] } }]).规则们
  assert.equal(守卫(调用).reason !== undefined, true)
})

test('造守卫：取规则抛错时不炸（当没有规则放行）', () => {
  const 守卫 = 造守卫(() => { throw new Error('配置文件读坏了') })
  assert.equal(守卫({ name: 'read', arguments: {} }), undefined)
})

test('造守卫：报日志抛错不影响拦截本身', () => {
  const { 规则们 } = 编译规则组([{ tools: ['*'], reason: '全拦' }])
  const 守卫 = 造守卫(规则们, () => { throw new Error('日志炸了') })
  assert.equal(守卫({ name: 'bash', arguments: {} }).reason, '全拦')
})

// ─────────────── 分工作区（1.12.70）───────────────
// 语义：workspace 比的是「会话的工作区根」，不是被操作的文件路径。
// 拿不到工作区时带 workspace 的规则一律不拦 —— 宁可少拦，也不误拦别的工作区。

test('规范工作区：反斜杠归一、去尾斜杠、小写；空值给空串', () => {
  assert.equal(规范工作区('G:\\DSH_WORKSPACE\\需求开发'), 'g:/dsh_workspace/需求开发')
  assert.equal(规范工作区('G:/DSH_WORKSPACE/需求开发/'), 'g:/dsh_workspace/需求开发')
  assert.equal(规范工作区('G:\\DSH_WORKSPACE\\需求开发\\'), 'g:/dsh_workspace/需求开发')
  assert.equal(规范工作区('   '), '', '纯空白不算工作区')
  assert.equal(规范工作区(''), '')
  assert.equal(规范工作区(undefined), '')
})

test('工作区命中：不写就是所有工作区；* 通配；前缀*；数组任一', () => {
  const ws = 'G:/DSH_WORKSPACE/需求开发'
  assert.equal(工作区命中(null, ws), true, '不写 workspace = 所有工作区生效')
  assert.equal(工作区命中('', ws), true)
  assert.equal(工作区命中('*', ws), true)
  assert.equal(工作区命中('G:/DSH_WORKSPACE/*', ws), true)
  assert.equal(工作区命中('g:\\dsh_workspace\\需求开发', ws), true, 'windows 写法与大小写都要认')
  assert.equal(工作区命中('G:/other/repo/*', ws), false)
  assert.equal(工作区命中(['G:/nope', 'G:/DSH_WORKSPACE/*'], ws), true, '数组里任一命中就算')
  assert.equal(工作区命中('G:/DSH_WORKSPACE/*', ''), false, '拿不到工作区就别拦——宁可少拦不误拦')
})

test('一条命中：workspace 不匹配就不拦，匹配才拦', () => {
  const raws = [{ id: 'ws1', tools: ['read'], workspace: 'G:/DSH_WORKSPACE/*', reason: '这个工作区不许读' }]
  const { 规则们 } = 编译规则组(raws)
  const exec = { name: 'read', arguments: { file_path: 'C:\\x.txt' } }
  assert.equal(一条命中(规则们[0], exec, 'G:/DSH_WORKSPACE/需求开发'), true)
  assert.equal(一条命中(规则们[0], exec, 'G:/other/repo/workspace'), false, '别的工作区不该被这条拦')
  assert.equal(一条命中(规则们[0], exec, ''), false, '不知道工作区时不拦')
  // 找命中也要透传工作区
  assert.ok(找命中(规则们, exec, 'G:/DSH_WORKSPACE/需求开发'))
  assert.equal(找命中(规则们, exec, 'G:/other/repo/workspace'), null)
})

test('造守卫：第四参取工作区，抛错或乱返回值都当「不知道」放行', () => {
  const { 规则们 } = 编译规则组([{ id: 'ws2', tools: ['*'], workspace: 'G:/DSH_WORKSPACE/*', reason: '这里不许' }])
  const 干 = { name: 'bash', arguments: { command: 'ls' }, agent: { id: 'abc' } }
  assert.equal(造守卫(规则们, null, 3, () => 'G:/DSH_WORKSPACE/需求开发')(干).reason, '这里不许')
  assert.equal(造守卫(规则们, null, 3, () => 'G:/other/repo/workspace')(干), undefined)
  assert.equal(造守卫(规则们, null, 3, () => { throw new Error('查不到会话') })(干), undefined, '查工作区炸了不能连带把工具全拦死')
  assert.equal(造守卫(规则们, null, 3, () => null)(干), undefined)
})

test('编译一条：workspace 缺省是 null（= 所有工作区），数组会收成字符串数组', () => {
  assert.equal(编译一条({ tools: ['read'] }, 1).规则.workspace, null)
  assert.deepEqual(编译一条({ tools: ['read'], workspace: ['A:\\x', 'B:\\y'] }, 2).规则.workspace, ['A:\\x', 'B:\\y'])
  assert.equal(编译一条({ tools: ['read'], workspace: '' }, 3).规则.workspace, null, '空串不算限定')
})
