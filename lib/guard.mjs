// ⭐ 1.12.69：工具拦截（机制层）
//
// 这个文件只做「机制」：把用户在配置里写的规则，编译成 DSH 的 `ctx.tools.guard()`。
// **这里一条规则都不内置** —— 写死任何一条「不许读 X」「必须 Y」都是在替用户决定，
// 用户的习惯、目录、工具集各不相同，插件不该知道它们。
//
// 规则长这样（写进 clay-memory-config.json 的 toolGuard.rules）：
//   {
//     "id": "随便起的名，日志里用",
//     "tools": ["read", "write", "bash*"],   // 工具名，支持 * 通配，["*"] = 全部工具
//     "args": { "file_path": ["^C:\\\\Windows"] }, // 可选：参数名 → 正则（数组内 OR，多个键 AND）
//     "action": "deny",                       // 目前只支持 deny
//     "reason": "给模型看的理由",
//     "workspace": ["G:\\\\DSH_WORKSPACE\\\\需求开发"] // 可选：只在这几个工作区生效，不写 = 所有工作区
//   }
//
// 分工作区（1.12.70）：`workspace` 比的是**会话的工作区根**（会话 cwd），不是文件路径。
//   写 `"*"` 或不写 = 所有工作区；支持 `前缀*` 通配；数组 = 任一命中。
//   拿不到会话工作区时（测试实例 / 老宿主）带 workspace 的规则**不拦** —— 宁可少拦，不误拦。
//
// 为什么用 `guard` 而不是 `tools/pre-execute`：
//   DSH 官方 Stability 指南原话 ——「A denial that must hold regardless of order is a
//   `ctx.tools.guard()`；a guard is synchronous, so a decision that must await something,
//   such as asking the user, returns `ask` from `tools/pre-execute`」。
//   拦截规则不该被别的监听器挤掉顺序，所以走 guard；要问用户的场景以后走 pre-execute 的 ask。
//
// 为什么规则要用户写：主人 2026-11-21 定的方向 ——「只做机制，规则要用户自定义，
//   设计的场景要适配任何用户，不能因为我的习惯和约定去动代码」。

/**
 * shell 类工具在不同 DSH 版本 / 系统上叫法不一样：bash、pwsh、powershell、ops_bash、sh…
 * 这是**同一类工具的归一**，不是替用户立规矩 —— 规则里写 `bash*` 还是 `pwsh*`，都归到这一族。
 * 2026-11-21 踩的坑：页面上「命令别碰系统目录」被翻成 `tools:["bash*"]`，
 * 而这台机器上的 shell 工具叫 pwsh / ops_bash，`bash*` 一个都匹配不到 —— 规则存了等于没存。
 */
const 外壳族 = new Set(['bash', 'sh', 'shell', 'zsh', 'pwsh', 'powershell', 'cmd', 'ops_bash', 'ops_shell', 'run_command'])

/** 把「工具名 / 通配模式」跟实际工具名对上。`*` 全中，`前缀*` 前缀匹配，否则精确；shell 族互通。 */
export function 工具名命中(模式, 名) {
  if (typeof 模式 !== 'string' || !模式) return false
  const 实际 = String(名 || '')
  if (模式 === '*') return true
  if (模式.endsWith('*')) {
    const 前缀 = 模式.slice(0, -1)
    if (实际.startsWith(前缀)) return true
    return 外壳族.has(前缀.toLowerCase()) && 外壳族.has(实际.toLowerCase())
  }
  if (模式 === 实际) return true
  return 外壳族.has(模式.toLowerCase()) && 外壳族.has(实际.toLowerCase())
}

/** 把参数值变成能喂给正则的文本：字符串原样，其余 JSON（数组/对象也能匹配）。 */
export function 值文本(v) {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  try { return JSON.stringify(v) } catch (error) { return String(v) }
}

/** 规范化工作区路径：去尾分隔符、反斜杠统一成正斜杠、小写（Windows 路径不分大小写）。 */
export function 规范工作区(p) {
  const 文 = typeof p === 'string' ? p.trim() : ''
  if (!文) return ''
  return 文.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * 工作区匹配：`*` 或不写 = 全部；`前缀*` 前缀；否则精确。数组 = 任一命中。
 * 拿不到实际工作区（空串）时一律不命中 —— 宁可少拦，不误拦。
 */
export function 工作区命中(模式, cwd) {
  const 实 = 规范工作区(cwd)
  if (!实) return false
  if (模式 === undefined || 模式 === null || 模式 === '') return true
  const 表 = Array.isArray(模式) ? 模式 : [模式]
  for (const m of 表) {
    const 文 = 规范工作区(m)
    if (!文 || 文 === '*') return true
    if (文.endsWith('/*')) {
      if (实 === 文.slice(0, -2) || 实.startsWith(文.slice(0, -1))) return true
      continue
    }
    if (实 === 文) return true
  }
  return false
}

/** 用户规则里的字符串正则：编译一次就缓存。参数命中挂在 ctx.tools.guard() 热路径上，
 *  每次调用都 new RegExp 既费 CPU，也会让「用户写了灾难性回溯的表达式」每条规则每轮都重编译。 */
const 用户正则缓存 = new Map()
function 编译用户正则(源) {
  const 旧 = 用户正则缓存.get(源)
  if (旧 !== undefined) return 旧
  let 新 = null
  try { 新 = new RegExp(源) } catch (error) { 新 = null } // 坏正则当没写
  if (用户正则缓存.size >= 512) 用户正则缓存.clear() // 用户频繁改规则时别把表撑爆
  return 用户正则缓存.set(源, 新).get(源)
}

/** 一条规则里「参数匹配」：args 的每个键都要在不短于一个正则上命中（AND），键内 OR。 */
export function 参数命中(args规则, 实际参数) {
  if (!args规则 || typeof args规则 !== 'object') return true // 没写 args = 只看工具名
  const 键们 = Object.keys(args规则)
  if (!键们.length) return true
  for (const 键 of 键们) {
    const 表 = Array.isArray(args规则[键]) ? args规则[键] : [args规则[键]]
    const 文本 = 值文本(实际参数 ? 实际参数[键] : undefined)
    if (!文本) return false // 参数压根没给 ⇒ 不匹配（保守：宁可不拦，也不乱拦）
    let 中 = false
    for (const r of 表) {
      if (r instanceof RegExp) { if (r.test(文本)) { 中 = true; break } continue }
      if (typeof r === 'string' && r) { const 正 = 编译用户正则(r); if (正 && 正.test(文本)) { 中 = true; break } }
    }
    if (!中) return false
  }
  return true
}

/** 编译一条原始规则（用户手写的 JSON）。成功返回 {规则}，失败返回 {错误}。 */
export function 编译一条(raw, 序号 = 0) {
  const 位 = raw && typeof raw === 'object' ? raw : null
  if (!位) return { 错误: '第 ' + (序号 + 1) + ' 条不是对象' }
  if (!Array.isArray(位.tools) || !位.tools.length) return { 错误: '第 ' + (序号 + 1) + ' 条缺 tools（工具名数组，可用 * 通配）' }
  const 动作 = 位.action === undefined ? 'deny' : String(位.action)
  if (动作 !== 'deny') return { 错误: '第 ' + (序号 + 1) + ' 条的 action 目前只支持 deny（收到「' + 动作 + '」）' }
  const 规则 = {
    id: String(位.id || ('规则' + (序号 + 1))),
    tools: 位.tools.map(String).filter(Boolean),
    args: 位.args && typeof 位.args === 'object' ? 位.args : null,
    action: 动作,
    reason: String(位.reason || '被工具拦截规则拦下了'),
    // workspace：不写 / 空串 / 空数组 都算「所有工作区」（null），只有真写了才算限定。
    workspace: (() => {
      const 位2 = 位.workspace
      if (位2 === undefined || 位2 === null) return null
      if (Array.isArray(位2)) { const a = 位2.map(String).filter(Boolean); return a.length ? a : null }
      const s = String(位2).trim()
      return s ? s : null
    })(),
  }
  if (!规则.tools.length) return { 错误: '第 ' + (序号 + 1) + ' 条 tools 全是空值' }
  return { 规则 }
}

/** 编译一整组规则；坏的那条跳过并记账，不连坐其他规则。 */
export function 编译规则组(raws) {
  const 规则们 = []
  const 错误 = []
  const 源 = Array.isArray(raws) ? raws : []
  for (let i = 0; i < 源.length; i++) {
    const r = 编译一条(源[i], i)
    if (r && r.规则) 规则们.push(r.规则)
    else if (r && r.错误) 错误.push(r.错误)
  }
  return { 规则们, 错误 }
}

/** 一条规则是否命中这次调用。`工作区` 是这次调用所在会话的工作区根。 */
export function 一条命中(规则, exec, 工作区) {
  if (!规则 || !exec) return false
  if (!规则.tools.some((m) => 工具名命中(m, exec.name))) return false
  if (规则.workspace !== null && 规则.workspace !== undefined) {
    if (!工作区命中(规则.workspace, 工作区)) return false
  }
  return 参数命中(规则.args, exec.arguments)
}

/** 找出第一条命中的规则。 */
export function 找命中(规则们, exec, 工作区) {
  for (const 规则 of 规则们) if (一条命中(规则, exec, 工作区)) return 规则
  return null
}

/** 从配置里取规则（配置是用户手写的 JSON，读坏了就当没有）。 */
export function 取规则(配置) {
  const 区 = 配置 && typeof 配置 === 'object' ? 配置.toolGuard : null
  if (!区 || typeof 区 !== 'object') return { 开: false, 规则们: [], 错误: [] }
  const 开 = 区.enabled !== false
  const { 规则们, 错误 } = 编译规则组(区.rules)
  return { 开, 规则们, 错误 }
}

/**
 * 造一个 guard 函数交给 ctx.tools.guard()。
 * 返回 string / {reason} 表示拒绝，返回 undefined 表示放行。
 *
 * `取工作区(exec)` 是可选的第 4 个参数：给一个同步函数，返回这次调用所在会话的工作区根。
 * 不给的话，带 `workspace` 的规则不会生效（宁可少拦，不误拦）。
 *
 * 防死循环：模型被拒后可能原样重试。同一个「工具名 + 参数」被拒到第 N 次，
 * 理由里会多一句提醒（不是熔断，只是让模型知道自己在原地打转）。
 */
export function 造守卫(规则们, 报 = null, 上限 = 3, 取工作区 = null) {
  const 账 = new Map()
  // 规则可以是数组（一次性编译好），也可以是函数（每次现取）——
  // 给函数是为了「用户改了配置不用重启」：guard 是同步的，取规则那边自己做缓存。
  const 当前 = () => {
    if (typeof 规则们 === 'function') {
      try { const r = 规则们(); return Array.isArray(r) ? r : [] } catch (error) { return [] }
    }
    return Array.isArray(规则们) ? 规则们 : []
  }
  const 工作区Of = (exec) => {
    if (typeof 取工作区 !== 'function') return ''
    try { const w = 取工作区(exec); return typeof w === 'string' ? w : '' } catch (error) { return '' }
  }
  return function 工具守卫(exec) {
    const 中 = 找命中(当前(), exec, 工作区Of(exec))
    if (!中) return undefined
    const 指纹 = String(exec && exec.name) + '\u0000' + 值文本(exec && exec.arguments)
    const 次 = (账.get(指纹) || 0) + 1
    账.set(指纹, 次)
    if (报) {
      try {
        报('工具拦截：[' + 中.id + '] 拦下 ' + exec.name + '（第 ' + 次 + ' 次）')
      } catch (error) { /* 日志失败不影响拦截 */ }
    }
    const 尾巴 = 次 >= 上限 ? '（这条你已经试过 ' + 次 + ' 次，换个做法，原样重试还会被拦）' : ''
    return { reason: 中.reason + 尾巴 }
  }
}
