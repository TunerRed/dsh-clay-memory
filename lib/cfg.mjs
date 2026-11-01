// 配置层：策略定义与收参、配置读写、会话开关 —— 2026-10-30 从 index.js 抽出（拆层工程第 5b 批）
// 依赖注入：报 = 诊断日志（index.js 的 diag）、读库 = 读会话库（migrateSwitch 用），由 index.js 注入。
import { readFileSync, mkdirSync, readdirSync } from 'node:fs'
import { CFG_DIR, STORE_DIR, CFG_PATH, 是会话文件 } from './paths.mjs'
import { writeFileAtomicSync } from './atomic-file.mjs'

let 报 = null
let 读库 = null
/** index.js 在 import 后调用：注入诊断日志函数 */
export function 接报信(fn) { if (typeof fn === 'function') 报 = fn }
/** index.js 在 import 后调用：注入 loadStore（migrateSwitch 用） */
export function 接读库(fn) { if (typeof fn === 'function') 读库 = fn }

const DEFAULT_POLICY = {
  baseHalfLifeDays: 30,
  emotionHalfLifeDays: 7,
  baselineWeight: 0.55,
  activationWeight: 0.25,
  importanceWeight: 0.15,
  emotionWeight: 0.05,
  threshold: 0.35, // ⭐ 2026-09-21 晚：改成卡 **C（证据）**，不再卡 P —— 见 recall 里那段长注释
  // ⭐ 2026-10-30 P3 调优试过 0.40：P3 十二句里能把「帮(0.375)」这类弱噪声挡掉，
  //   但 42 句基准里有「我玩什么游戏→游戏角色(0.389)」这类真弱命中，0.40 一刀下去
  //   24 句变空（0.35~0.40 区间的真命中全被误伤）→ 回滚 0.35。
  //   噪声治理靠通用门（见 recall 安全垫修复），不靠加高这道门槛。
  maxItems: 6,
  maxChars: 800,
  dailyQuota: 8,
  // ⭐ 2026-09-21 新加的两项（治「太敏感」，见 evaluate 上面的长注释）
  rarityK: 1, // 稀有度饱和点：归一化稀有度加起来到多少算「一半相关」（跟库大小无关）
  queryGate: 0.8, // 问句信息量门槛：这句话本身太没内容就不翻记忆。0 = 关掉这道门
  // ⭐ 2026-09-21 中午加的（C＋D：两条队）
  // ⭐⭐ 1.4.0（双层改造）：默认 2 → **6** ✓
  //   事实层变成全局库之后，候选池是整个「我是谁 / 偏好 / 约定」那一层（实测主库 202 条），
  //   只带前 2 条等于把另外 200 条永远关在门外；6 条 ≈ 一轮多花 200 字，值。
  factsMax: 6, // 长期事实每轮固定带几条（常驻层，不占 maxItems 的位置）。0 = 不带长期事实
  // ⭐ 2026-09-21 深夜（她的决定）：默认从 1 调到 **0.5** ✓
  //   她的直觉：「我知道时间才是劣势」——有日期的那 188 条，反倒排不到没日期的前面去 ✗
  //   实测：门槛卡 C 之后这个旋钮**只影响排序**，扫 1/0.75/0.5/0.25/0「该给到」全是 11/13 一动不动 ✓
  //   所以调它**不会误伤谁进得来**，只让没写时间的往后站 ✓
  unknownActivation: 0.5, // 没写时间的记忆（含长期事实）鲜活度按几成算。只影响排序，不影响谁进得来 ✓
}

// ---------- 参数的范围（防止调坏）----------
// 权重四项必须合计 100%，所以单独成一组，由 fitWeights 凑数 ✓
const POLICY_SPEC = [
  { key: 'baselineWeight', group: 'weight', label: '基础权重', tip: '只要被想起来就有的一份，其余三项是在它之上加的分', min: 0.5, max: 0.6, step: 0.01, pct: true },
  { key: 'activationWeight', group: 'weight', label: '鲜活度权重', tip: '越近、越常被想起的事，加得越多', min: 0.2, max: 0.3, step: 0.01, pct: true },
  { key: 'importanceWeight', group: 'weight', label: '重要度权重', tip: '标成「非常重要」的事，加得越多', min: 0.1, max: 0.2, step: 0.01, pct: true },
  { key: 'emotionWeight', group: 'weight', label: '情绪权重', tip: '带情绪的事，加得越多', min: 0.0, max: 0.1, step: 0.01, pct: true },
  { key: 'baseHalfLifeDays', group: 'time', label: '半衰期', tip: '普通的事多久淡一半。越大忘得越慢', min: 15, max: 60, step: 1, unit: '天' },
  { key: 'emotionHalfLifeDays', group: 'time', label: '情绪半衰期', tip: '情绪多久淡一半，比普通的事快', min: 3.5, max: 14, step: 0.5, unit: '天' },
  { key: 'threshold', group: 'gate', label: '证据门槛', tip: '命中的词要够「稀有」才算真的有关。它只卡证据（C），不掺鲜活度 —— 所以调它不会误伤该想起的', min: 0.1, max: 0.8, step: 0.05 },
  { key: 'maxItems', group: 'gate', label: '最多注入几条', tip: '一次最多塞几条给她。越大越占上下文', min: 1, max: 12, step: 1 },
  { key: 'maxChars', group: 'gate', label: '注入字数上限', tip: '一次注入的记忆加起来最多多少字。超了的这次先不进（下次可能就进了）', min: 200, max: 3000, step: 100, unit: '字' },
  { key: 'dailyQuota', group: 'gate', label: '每天最多记几条', tip: '她自己一天最多记几条', min: 1, max: 30, step: 1 },
  { key: 'rarityK', group: 'gate', label: '稀有度饱和点', tip: '命中词的稀有度（0~1）加起来到多少算「一半相关」。越小越容易给', min: 0.3, max: 6, step: 0.1 },
  { key: 'queryGate', group: 'gate', label: '问句信息量门槛', tip: '这句话本身太没内容（像「在吗」）就不翻记忆。0 = 关掉这道门', min: 0, max: 2, step: 0.05 },
  { key: 'factsMax', group: 'gate', label: '长期事实每轮带几条', tip: '要记一辈子的事（画像、喜好、约定）每轮都带上，不看这句话问了什么，也不占「最多注入几条」的位置。0 = 不带长期事实（1.6.16：上限从 6 放到 10，好让「话痨」档真的多一点）', min: 0, max: 10, step: 1 },
  { key: 'unknownActivation', group: 'gate', label: '没写时间的算多鲜活', tip: '没写时间戳的记忆（含长期事实）鲜活度按几成算。1 = 当成刚发生的（默认）。调小只让它们排在有时间戳的后面，不影响谁进得来', min: 0, max: 1, step: 0.05 },
]

const SPEC_BY_KEY = {}
for (const s of POLICY_SPEC) SPEC_BY_KEY[s.key] = s
const WEIGHT_KEYS = POLICY_SPEC.filter((s) => s.group === 'weight').map((s) => s.key)

function clampNum(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

// 四个权重凑成 100%：多出来的按「还能减的余地」摊掉，缺的按「还能加的余地」补上 ✓
// pin = 她刚改的那一项 —— 钉住不动，让其余三项让位（她填的数就保住了）✓
function fitWeights(src, pin) {
  const keys = WEIGHT_KEYS
  const out = {}
  for (const k of keys) out[k] = clampNum(Number(src[k]) || 0, SPEC_BY_KEY[k].min, SPEC_BY_KEY[k].max)
  const pinned = pin && keys.indexOf(pin) >= 0 ? pin : null
  for (let round = 0; round < 60; round++) {
    let sum = 0
    for (const k of keys) sum += out[k]
    const diff = 1 - sum
    if (Math.abs(diff) < 1e-9) break
    const each = {}
    let room = 0
    for (const k of keys) {
      if (k === pinned) {
        each[k] = 0
        continue
      }
      const s = SPEC_BY_KEY[k]
      each[k] = diff > 0 ? s.max - out[k] : out[k] - s.min
      if (each[k] < 0) each[k] = 0
      room += each[k]
    }
    // 钉住的那个挡死了 → 松开它，退回到「四项一起让位」
    if (room <= 1e-12) {
      if (pinned) return fitWeights(src, null)
      break
    }
    for (const k of keys) out[k] += diff * (each[k] / room)
  }
  // 落到 0.1% 上，再把误差补给「余地最大」的那个，保证合计正好 100% ✓
  for (const k of keys) out[k] = Math.round(out[k] * 1000) / 1000
  let sum = 0
  for (const k of keys) sum += out[k]
  const resid = Math.round((1 - sum) * 1000) / 1000
  if (Math.abs(resid) >= 0.0005) {
    let best = null
    let bestRoom = -1
    for (const k of keys) {
      if (k === pinned) continue
      const s = SPEC_BY_KEY[k]
      const r = resid > 0 ? s.max - out[k] : out[k] - s.min
      if (r > bestRoom) {
        bestRoom = r
        best = k
      }
    }
    if (best === null) best = pinned || keys[0]
    out[best] = Math.round(clampNum(out[best] + resid, SPEC_BY_KEY[best].min, SPEC_BY_KEY[best].max) * 1000) / 1000
  }
  return out
}

// 把送来的参数收进范围，权重凑成 100%，并回一句「我动了什么」✓
function fitPolicy(input, base, pin) {
  const out = Object.assign({}, DEFAULT_POLICY, base || {})
  const notes = []
  // 先把底子收进范围（防手改文件）✓
  for (const s of POLICY_SPEC) {
    const cur = out[s.key]
    if (typeof cur === 'number' && isFinite(cur)) out[s.key] = clampNum(cur, s.min, s.max)
  }
  // 再收页面送来的补丁
  for (const s of POLICY_SPEC) {
    const raw = input ? input[s.key] : undefined
    if (typeof raw !== 'number' || !isFinite(raw)) continue
    const v = clampNum(raw, s.min, s.max)
    if (Math.abs(v - raw) > 1e-9) notes.push(s.label + ' 只允许 ' + s.min + ' ~ ' + s.max + '，已收到 ' + v)
    out[s.key] = v
  }
  const before = {}
  for (const k of WEIGHT_KEYS) before[k] = out[k]
  const w = fitWeights(out, pin)
  let moved = false
  for (const k of WEIGHT_KEYS) {
    out[k] = w[k]
    if (Math.abs(before[k] - w[k]) > 1e-9) moved = true
  }
  if (moved) notes.push('四个权重合计要 100%，已自动调平')
  return { policy: out, notes }
}

// ⭐ 1.2.7（issue #7）：**全局参数**
//   以前参数只存在每个记忆库（memory-store/<会话>.json）里 —— 一个库都没有时，
//   保存等于没保存，F5 一刷就回默认值。
//   现在 priority：DEFAULT_POLICY ← 全局（config.policy）← 这个库自己的 policy。
function 全局参数() {
  try {
    const c = loadCfg()
    return (c && c.policy && typeof c.policy === 'object') ? c.policy : {}
  } catch (error) {
    return {}
  }
}

function 合并参数(库参数) {
  return fitPolicy(null, { ...全局参数(), ...(库参数 || {}) }).policy
}

// ---------- 配置（哪些会话开启 + 她自己叫什么 + 用户的称呼）----------

/** 读配置文件的字节当文本 —— 顺带把 Windows 上常见的三种 BOM 都去掉。
 *  2026-10-25（issue #1 里那位用户踩到的）：
 *    · PowerShell `Set-Content -Encoding UTF8` → UTF-8 BOM
 *    · PowerShell 5.1 `Out-File` / `>` 重定向 → **UTF-16LE**（这个最坑，JSON.parse 一片 NUL）
 *  以前直接 readFileSync(...,'utf8') → JSON.parse 抛错 → return {} ⇒ 所有会话静默「关着」。 */
function 读配置文本() {
  const 字节 = readFileSync(CFG_PATH)
  // UTF-16LE（PowerShell 5.1 的 Out-File / > 重定向默认就是它）
  if (字节.length >= 2 && 字节[0] === 0xFF && 字节[1] === 0xFE) return 字节.subarray(2).toString('utf16le')
  // UTF-16BE（少见，但别的工具会写）
  if (字节.length >= 2 && 字节[0] === 0xFE && 字节[1] === 0xFF) {
    const 换 = Buffer.from(字节.subarray(2))
    for (let i = 0; i + 1 < 换.length; i += 2) { const t = 换[i]; 换[i] = 换[i + 1]; 换[i + 1] = t }
    return 换.toString('utf16le')
  }
  // UTF-8（带不带 BOM 都行：用码位判断，不往源码里塞不可见字符）
  let 文 = 字节.toString('utf8')
  if (文.charCodeAt(0) === 0xFEFF) 文 = 文.slice(1)
  return 文
}

function loadCfg() {
  try {
    const raw = JSON.parse(读配置文本())
    return raw && typeof raw === 'object' ? raw : {}
  } catch (error) {
    try { 报('配置文件读不了（可能是 BOM / 写坏了）：' + String((error && error.message) || error)) } catch (error2) {}
    return {}
  }
}

function saveCfg(c) {
  try {
    mkdirSync(CFG_DIR, { recursive: true })
    writeFileAtomicSync(CFG_PATH, JSON.stringify(c, null, 2))
    return true
  } catch (error) {
    return false
  }
}

// 总开关：整个记忆功能开不开。
//
// ⚠ 1.3.4 起**默认开**（以前默认关）。默认关的后果是：装好插件、开了会话，
//   工具列表里根本没有 remember —— 很多人以为插件坏了。
//   现在装好就能用；不想用的自己关掉。
function globalOn() {
  try {
    const c = loadCfg()
    return c.全局开关 !== false
  } catch (error) {
    return true
  }
}

function setGlobalOn(on) {
  try {
    const c = loadCfg()
    c.全局开关 = !!on
    saveCfg(c)
    return !!on
  } catch (error) {
    return globalOn()
  }
}

// 某个 agent 是不是子代理派出去干活的。
// 子代理不挂记忆：它只干一件事，给它一份记忆库既没用又白写一遍文件。
function 是子代理(agent) {
  try {
    const h = agent && agent.session && agent.session.header
    if (!h) return false
    if (h.origin === 'subagent') return true
    if (typeof h.delegationDepth === 'number' && h.delegationDepth > 0) return true
    return false
  } catch (error) {
    return false
  }
}

// 哪些会话开着记忆。
// ⚠ 默认是「开」：装好就能用。某个会话不想用，把它单独关掉。
//   总开关一关，所有会话一律当关。
function isEnabled(sid) {
  if (!globalOn()) return false
  const c = loadCfg()
  const s = String(sid)
  const m = c.sessions
  if (m && typeof m === 'object' && Object.prototype.hasOwnProperty.call(m, s)) return !!m[s]
  // 兼容旧版：以前是「没配 = 全开」，那份白名单里的人继续开着
  if (Array.isArray(c.enabled) && c.enabled.indexOf(s) >= 0) return true
  return true
}

// 打开 / 关闭某个会话的记忆
function setEnabled(sid, on) {
  try {
    const c = loadCfg()
    const m = c.sessions && typeof c.sessions === 'object' ? Object.assign({}, c.sessions) : {}
    const s = String(sid)
    m[s] = !!on
    c.sessions = m
    // 老的白名单搬过来之后就不用了
    if (Array.isArray(c.enabled)) c.enabled = c.enabled.filter((x) => String(x) !== s)
    saveCfg(c)
    return Object.keys(m).filter((k) => m[k])
  } catch (error) {
    return []
  }
}

// 现在开着记忆的会话有哪些
function enabledList() {
  const c = loadCfg()
  const m = c.sessions && typeof c.sessions === 'object' ? c.sessions : {}
  return Object.keys(m).filter((k) => m[k])
}

// 一次性搬家：旧版「没配 = 全开」→ 新版「没配 = 关」。
// 把**已经存过记忆**的会话记成「开」，免得升级之后她的记忆突然不注入了 ✓
function migrateSwitch() {
  try {
    const c = loadCfg()
    if (c.switchMigrated) return
    const m = c.sessions && typeof c.sessions === 'object' ? Object.assign({}, c.sessions) : {}
    for (const sid of Array.isArray(c.enabled) ? c.enabled : []) m[String(sid)] = true
    try {
      for (const fn of readdirSync(STORE_DIR)) {
        if (!是会话文件(fn)) continue
        const sid = fn.replace(/\.json$/, '')
        if (m[sid] !== undefined) continue
        const d = 读库(sid)
        if (d && (d.memories || []).length) m[sid] = true
      }
    } catch (error) {}
    c.sessions = m
    c.switchMigrated = true
    saveCfg(c)
    报('开关搬家（默认改成关了，存过记忆的留开）：' + JSON.stringify(m))
  } catch (error) {}
}

export { DEFAULT_POLICY, POLICY_SPEC, clampNum, fitPolicy, 全局参数, 合并参数, loadCfg, saveCfg, globalOn, setGlobalOn, 是子代理, isEnabled, setEnabled, enabledList, migrateSwitch }
