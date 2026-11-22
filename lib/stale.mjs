// ════════ 陈旧路径检测（V1）════════
// 2026-11-22 起。
//
// 只干一件事：扫活跃记忆正文里提到的 **Windows 盘符路径**，看它现在还在不在。
// 不调模型、不改 memories、不碰 expireAt —— 只产出一份待确认清单 `_stale.json`，
// 由人在设置页「体检」页签里一条条拍板。
//
// 为什么只做路径（依据见 docs/交接-2026-11-21.md 与 2026-11-22 的探针实测）：
//   - 全库两两比「矛盾」：16320 对候选 → 人工抽读 107 条 ≈ 0 对真矛盾，不值。
//   - 路径存在性：87 个路径里 21 个已不存在（24.1%），零模型成本，全是真问题。
//   - 版本号 V1 不做：版本号错几乎不误导执行，且难用正则区分插件/模型/Node/CUDA 版本。
//
// ⚠ 三个踩过的坑（2026-11-21 探针时发现，写在这里防回退）：
//   1. 判活别用「父目录存在」—— 真场景是「整个目录被搬走」，那时直接父目录也没了，
//      会静默跳过，最该抓的一类全漏掉。改用**盘符根**：盘根在 + 路径不在 = 失效。
//   2. MSYS 写法 `/g/AI/...` 在 Windows 的 Node 里会被当成当前盘的 `\g\AI\...`，
//      必须显式转成 `G:/AI/...` 再 existsSync。
//   3. ignored 不能只按路径记 —— 那样以后新写入的同类错记忆会被永久静默吞掉。
//      改成 ignoredIds（绑 memoryId），新 id 不在集合里就重新拉回 pending。

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs'
import { basename, join, win32 } from 'node:path'
import { writeFileAtomicSync } from './atomic-file.mjs'
import { 标记镜像滞后 } from './store-core.mjs'
import { STORE_DIR } from './paths.mjs'
import { diag } from './diag.mjs'

export const 清单名 = '_stale.json'

export function 清单路径() {
  return join(STORE_DIR, 清单名)
}

// ──── 一、从正文里抠路径 ────

// 路径字符集：到空白或中文标点就断。刻意不含 `*?{}|<>` —— 那些是通配/模板，判不了。
// ⚠ 2026-11-22 第一版把空格当终止符，结果 `E:\program files\ComfyUI\...` 被切成
//   `E:/program`（假失效两条）。Windows 路径里空格太常见了，所以：主段吃到空白为止，
//   之后只允许「空格 + 纯 ASCII 尾段」继续吃 —— 这样 `Program Files` 完整，而
//   `ComfyUI 里装的是` 里的中文不会被吞进来。
const 尾段 = '[A-Za-z0-9_.\\\\/@-]+'
const 路径正则 = new RegExp(
  '[A-Za-z]:[\\\\/][^\\s，。；;、（）()「」『』【】"\'`|<>*?\\n：]{1,180}(?: +' + 尾段 + ')*',
  'g',
)

// 正文里先把 URL 剁掉，否则 `http://127.0.0.1:8931` 会被抠成 `p:/127.0.0.1:8931`。
export function 剥网址(文本) {
  return String(文本 || '').replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s，。；、）)」』】]+/g, ' ')
}

/** 从一段正文里抠出所有「像路径」的字面，保留出现位置（给降噪取上下文用） */
export function 抠路径(文本) {
  const 源 = 剥网址(文本)
  const 出 = []
  const re = new RegExp(路径正则.source, 'g')
  let m
  while ((m = re.exec(源)) !== null) {
    // 后一个字符：用来判断「是不是被中文截断了」（见 规整路径）
    const 后 = 源.charAt(m.index + m[0].length)
    出.push({ 字面: m[0], 起: m.index, 止: m.index + m[0].length, 后, 源 })
    if (出.length >= 50) break // 一条记忆里再多也不看
  }
  return 出
}

// ──── 二、规整 + 判定 ────

const 尾省略 = /(\.\.\.|…)$/
const 通配符 = /[*?{}%$]/
const 首标点 = /^[`'"「『（(\[]+/
const 尾标点 = /[`'"」』）)\]]+$/
// 尾部残留的全角标点（`：`「，」这种接在路径后面当句子分隔用的）
const 尾全角 = /[\u3000-\u303F\uFF01-\uFF60]+$/
// 占位符段：`XXX` / `<会话id>` / `...` —— 这种不是真路径
const 占位段 = /^(xxx+|XXX+|<[^>]*>|_+|-+)$/
const 中日韩 = /[\u4e00-\u9fa5\u3040-\u30ff]/

/**
 * 规整一条字面。
 * 后 = 字面后面紧跟的那个字符，用来识别「被中文截断」的情况。
 * 返回 { 判: '检查', 规整 } 或 { 判: '跳过' | '判不了', 原因 }
 */
export function 规整路径(原始, 后 = '') {
  let s = String(原始 || '').trim()
  if (!s) return { 判: '跳过', 原因: '空' }
  // JSON 里存的双反斜杠：`E:\\AI` → `E:\AI`
  if (s.includes('\\\\')) s = s.split('\\\\').join('\\')
  // 首尾标点（路径后面紧跟句号/括号/引号是常态）
  s = s.replace(首标点, '').replace(尾标点, '').replace(尾全角, '').trim()
  if (!s) return { 判: '跳过', 原因: '剥完是空' }
  // 被截断的路径（原文写着 `E:\...\xxx...`）宁可不判，别误报
  if (尾省略.test(s)) return { 判: '跳过', 原因: '原文被省略号截断' }
  if (通配符.test(s)) return { 判: '判不了', 原因: '含通配符或环境变量' }
  // 段里有占位符（XXX / <会话id> / 末段只有 1 个字符）—— 不是可判的路径
  const 段们 = s.split(/[\\/]+/).filter(Boolean)
  const 末段 = 段们[段们.length - 1] || ''
  if (段们.some((段) => 占位段.test(段) || /xxx/i.test(段))) {
    return { 判: '判不了', 原因: '路径段里有占位符' }
  }
  if (末段.length <= 1) return { 判: '判不了', 原因: '末段只有一个字符，像是占位' }
  // 末段以 - / _ 结尾 = 原文写到一半被截断（logs/crash- 这种）
  if (/[-_]$/.test(末段)) return { 判: '判不了', 原因: '末段以连字符结尾，像是被截断' }
  // 紧跟中文 = 多半是「路径 + 中文目录名」被截断了（如 --G-DSH_WORKSPACE-需求开发--），
  //   这种判失效会是误报，宁可放过
  if (中日韩.test(后)) return { 判: '判不了', 原因: '后面紧跟中文，可能被截断' }
  // 最后一段像「路径后接了说明文字」（assets：148349094_p8.jpg 这种混合体）
  if (/(assets|docs|files)：/.test(s)) return { 判: '判不了', 原因: '路径后接了说明文字' }
  // MSYS 写法：/g/AI/x → G:/AI/x
  let 文 = s
  const msys = 文.match(/^\/([a-zA-Z])(\/.+)$/)
  if (msys) 文 = msys[1].toUpperCase() + ':' + msys[2]
  if (!/^[a-zA-Z]:[\\/]/.test(文)) return { 判: '跳过', 原因: '不是盘符路径' }
  // 2026-11-22：折叠 `..` / `.` —— 原来只换斜杠，`G:/A/../B` 和 `G:/B` 会成两个聚合键，
  //   同一物理路径在体检页出现两次。win32.normalize 是纯字符串运算，不碰磁盘、也不改大小写。
  //   ⚠ 只用 win32 语义：这个功能整体只认 Windows 盘符路径（见 判定路径 第一行）。
  return { 判: '检查', 规整: win32.normalize(文).replace(/\\/g, '/') }
}

/** 聚合键：大小写不敏感、去尾斜杠、统一正斜杠。原始字面另存，别丢。 */
export function 聚合键(规整) {
  return String(规整 || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/**
 * 判一个规整路径还活不活。
 * 查 是注入点（测试里换成假的），默认 existsSync。
 * 返回 { 判定: '有效' | '失效' | '判不了', 原因? }
 */
export function 判定路径(规整, 查 = existsSync) {
  if (!/^[a-zA-Z]:\//.test(规整)) return { 判定: '判不了', 原因: '不是盘符路径' }
  // ⚠ 关键：判的是盘符根，不是父目录（父目录跟着一起搬走时父目录也没了）
  // 2026-11-22：显式用 win32.parse —— 之前用平台 path.parse，Linux 上 posix.parse('G:/A').root
  //   是空串，测试与插件在非 Windows 下就「取不到盘符根」（产品是判不了，但同一份代码行为不一致）。
  const 根 = win32.parse(规整).root
  if (!根 || !/^[a-zA-Z]:[\\/]$/.test(根)) return { 判定: '判不了', 原因: '取不到盘符根' }
  try {
    if (!查(根)) return { 判定: '判不了', 原因: '盘符根不在（可能是移动硬盘没插）' }
    if (查(规整)) return { 判定: '有效' }
    // ⚠ 2026-11-22 真机踩的坑：正则会把紧跟在路径后的中文一起吞进来
    //   （「放在 G:/dev/repo下面，做测试用」→ 字面成了 `G:/dev/repo下面`），
    //   而末尾那个「后」是「，」不是中文，所以规整阶段的中文检查拦不住。
    //   这里兜一刀：把第一个中文字符之后的部分砍掉再查一次，能查到就当有效。
    //   注意不能无条件砍——`G:/DSH_WORKSPACE/需求开发` 这种中文目录名是真的存在的。
    const 中 = 规整.search(中日韩)
    if (中 > 3) {
      const 砍 = 规整.slice(0, 中).replace(/[\\/]+$/, '')
      if (砍.length > 3 && 查(砍)) return { 判定: '有效', 原因: '中文粘在路径后，按前半段算' }
    }
    return { 判定: '失效' }
  } catch (error) {
    return { 判定: '判不了', 原因: '查的时候出了错：' + ((error && error.message) || error) }
  }
}

// ──── 三、降噪 ────

const 历史词 = /以前|原来|原本|旧|曾经|搬到|迁移|已删|废弃|换到|不用了|moved|used to/i

/** 取路径周围 ±15 字的上下文，判断是不是「在讲过去」 */
export function 历史上下文(文本, 起, 止) {
  const 源 = String(文本 || '')
  const 前 = 源.slice(Math.max(0, 起 - 15), 起)
  const 后 = 源.slice(止, Math.min(源.length, 止 + 15))
  return { 上下文: (前 + '…' + 后).replace(/\s+/g, ' ').trim(), 疑似历史: 历史词.test(前 + 后) }
}

// ──── 四、扫一遍 ────

/**
 * 扫活跃记忆，聚合出「路径 → 命中记忆」。
 * 返回 { 记录: {键→条目}, 统计 }
 * 纯读，不落盘也不改 memories。
 */
export function 扫一遍(memories, 查 = existsSync) {
  const 列表 = (Array.isArray(memories) ? memories : []).filter(
    (m) => m && m.id && !m.refinedSkip && !m.已被取代 && !m.supersededBy,
  )
  const 记录 = {}
  let 扫了路径 = 0
  let 跳过 = 0
  let 判不了 = 0
  for (const m of 列表) {
    const 正文 = String(m.text || '')
    if (!正文) continue
    const 抠出的 = 抠路径(正文)
    if (!抠出的.length) continue
    // 先算这条记忆里哪些路径「有效」——用来给失效的降噪（同一条里既有失效又有有效，
    // 多半是「A 搬到 B」这种正常表述，不是记忆错了）
    const 本条 = []
    for (const p of 抠出的) {
      const 规 = 规整路径(p.字面, p.后)
      if (规.判 === '跳过') { 跳过++; continue }
      if (规.判 === '判不了') {
        判不了++
        本条.push({ ...p, 判定: '判不了', 原因: 规.原因, 键: '' })
        continue
      }
      扫了路径++
      const r = 判定路径(规.规整, 查)
      本条.push({ ...p, 判定: r.判定, 原因: r.原因 || '', 键: 聚合键(规.规整), 规整: 规.规整 })
    }
    const 本条有效 = 本条.some((x) => x.判定 === '有效')
    for (const x of 本条) {
      if (x.判定 !== '失效' || !x.键) continue
      const h = 历史上下文(正文, x.起, x.止)
      const 条 = 记录[x.键] || (记录[x.键] = {
        类型: '路径',
        字面: x.规整,
        判定: '失效',
        命中记忆: [],
        伴随有效路径: false,
        疑似历史说明: false,
      })
      条.伴随有效路径 = 条.伴随有效路径 || 本条有效
      条.疑似历史说明 = 条.疑似历史说明 || h.疑似历史
      if (!条.命中记忆.some((y) => y.id === m.id)) {
        条.命中记忆.push({ id: m.id, 摘录: 正文.slice(0, 80), 上下文: h.上下文 })
      }
    }
  }
  return {
    记录,
    统计: { 记忆数: 列表.length, 扫了路径, 跳过, 判不了, 失效路径: Object.keys(记录).length },
  }
}

// ──── 五、落盘 / 合并 ────

export function 读清单() {
  try {
    const j = JSON.parse(readFileSync(清单路径(), 'utf8'))
    if (j && typeof j === 'object' && j.记录 && typeof j.记录 === 'object') return j
  } catch (error) {
    // 不存在 / 坏了都当空清单
  }
  return { v: 1, 上次检查: '', 记录: {} }
}

export function 写清单(清单) {
  // 目录可能还不存在（新装的库 / 测试实例的空 DSH_HOME）—— 先建，别再 ENOENT。
  mkdirSync(STORE_DIR, { recursive: true })
  const 目标 = 清单路径()
  const 临时 = 目标 + '.tmp'
  writeFileSync(临时, JSON.stringify(清单, null, 1), 'utf8')
  renameSync(临时, 目标)
}

/**
 * 把这次扫出来的结果并进旧清单，保住人工状态。
 * - 老有的 pending：保 首次发现 / ignoredIds
 * - 这次还在（失效）：刷新 最后确认 / 命中记忆；状态 pending 的保持 pending
 * - 那次还在但这次有效了（路径复活）：状态改 recovered（下次扫会自然消失）
 * - confirmed 但出现未处置的新 memoryId → 拉回 pending（避免新写入的同路径错记忆被静默吞掉）
 */
export function 合并清单(旧, 新记录, 现在 = new Date(), 查 = existsSync) {
  const 时间 = nowIso(现在)
  const 记录 = {}
  const 旧记 = (旧 && 旧.记录) || {}
  for (const [键, 新] of Object.entries(新记录 || {})) {
    const 老 = 旧记[键] || null
    const ignoredIds = Array.isArray(老 && 老.ignoredIds) ? 老.ignoredIds.slice() : []
    const 已追踪处置 = Array.isArray(老 && 老.已处置)
    const 已处置 = 已追踪处置 ? 老.已处置 : []
    const 命中id = (新.命中记忆 || []).map((x) => x.id)
    const 有新的 = 命中id.some((id) => !ignoredIds.includes(id))
    const 有未处置新记忆 = 命中id.some((id) => !已处置.includes(id) && !ignoredIds.includes(id))
    let 状态 = 'pending'
    if (老 && 老.状态 === 'ignored' && !有新的) 状态 = 'ignored'
    // 2026-11-22：处置过（confirmed）的记录不能因为「这次又扫到了」就翻回 pending；
    //   但如果新写入了一条不在 已处置 / ignoredIds 里的同路径记忆，必须拉回 pending，
    //   免得新错记忆被旧 confirmed 静默吞掉（和 ignoredIds 同理）。
    if (老 && 老.状态 === 'confirmed' && (!已追踪处置 || !有未处置新记忆)) 状态 = 'confirmed'
    记录[键] = {
      类型: '路径',
      字面: 新.字面,
      判定: '失效',
      命中记忆: 新.命中记忆,
      伴随有效路径: !!新.伴随有效路径,
      疑似历史说明: !!新.疑似历史说明,
      首次发现: (老 && 老.首次发现) || 时间,
      最后确认: 时间,
      状态,
      ignoredIds,
      // 人工状态原样带过去：重建时丢了它们，体检页的「已处置 / 已撤销」就只剩个空壳，
      //   撤销按钮也跟着消失（v1.12.76 的 bug，见 docs/private/已知问题清单-2026-11-15.md）。
      ...(老 && Array.isArray(老.已撤销) ? { 已撤销: 老.已撤销.slice() } : {}),
      ...(老 && Array.isArray(老.已处置) ? { 已处置: 老.已处置.slice() } : {}),
      ...(老 && 老.处置于 ? { 处置于: 老.处置于 } : {}),
    }
  }
  // 上次挂着、这次已经能 stat 到的（路径复活）：留一条 recovered，供体检页显示「已恢复」
  for (const [键, 老] of Object.entries(旧记)) {
    if (记录[键]) continue
    if (老 && 老.状态 === 'pending') {
      记录[键] = {
        ...老,
        判定: '有效',
        状态: 'recovered',
        最后确认: 时间,
      }
    } else if (老 && 老.状态 === 'recovered') {
      // 普通 recovered 留 7 天；若还挂着「已处置（已被取代）」等用户决定要不要撤销，多留到 30 天
      const 留几天 = Array.isArray(老.已处置) && 老.已处置.length ? 30 : 7
      const 多久 = 时间戳(老.最后确认)
      if (多久 && Date.now() - 多久 < 留几天 * 24 * 3600 * 1000) 记录[键] = 老
    } else if (老 && 老.状态 === 'confirmed') {
      // 2026-11-22 修：confirmed = 人处置过，扫不到它才是正常的（记忆已被标 已被取代，
      //   扫一遍会把它过滤掉）。原来这里没有 confirmed 分支 → 下一次扫描整个丢掉记录，
      //   体检页「已处置」连同「撤销」入口一起消失，人想反悔都没处点。
      //   只有路径真的又能 stat 到，才转 recovered 提醒「你处置过的那条又出现了」。
      const 规 = 规整路径(老.字面)
      const 又活了 = 规.判 === '检查' && 判定路径(规.规整, 查).判定 === '有效'
      记录[键] = 又活了 ? { ...老, 判定: '有效', 状态: 'recovered', 最后确认: 时间 } : 老
    } else if (老 && 老.状态 === 'ignored') {
      记录[键] = 老
    }
  }
  return { v: 1, 上次检查: 时间, 记录 }
}

function nowIso(d) {
  try {
    return (d instanceof Date ? d : new Date(d)).toISOString()
  } catch (error) {
    return new Date().toISOString()
  }
}

function 时间戳(iso) {
  const t = Date.parse(String(iso || ''))
  return Number.isFinite(t) ? t : 0
}

// ──── 六、调度 ────

/** 距上次检查够不够久（默认 24 小时）。读 cfg 的 `_上次陈旧检查`。 */
export function 该查了(cfg, 间隔小时 = 24) {
  const t = Number((cfg && cfg._上次陈旧检查) || 0)
  if (!Number.isFinite(t) || t <= 0) return true
  return Date.now() - t >= 间隔小时 * 3600 * 1000
}

/**
 * 跑一次完整检查并落盘。给自动任务和页面「立刻查一次」共用。
 * 返回 { ok, 统计, 清单, 待确认数 }
 */
export function 跑一次(memories, 现在 = new Date()) {
  const { 记录, 统计 } = 扫一遍(memories)
  const 旧 = 读清单()
  const 新清单 = 合并清单(旧, 记录, 现在)
  写清单(新清单)
  const 待确认数 = Object.values(新清单.记录).filter((x) => x.状态 === 'pending').length
  diag(
    '  陈旧检查：扫 ' +
      统计.扫了路径 +
      ' 个路径，失效 ' +
      统计.失效路径 +
      '，待确认 ' +
      待确认数 +
      '（跳过 ' +
      统计.跳过 +
      '，判不了 ' +
      统计.判不了 +
      '）',
  )
  return { ok: true, 统计, 清单: 新清单, 待确认数 }
}

// ──── 七、跨层改记忆（1.12.75）────
//
// 记忆按 store-core 的分层规则散在三种文件里：
//   全局 `_facts.json`、工作区 `_ws-<hash>.json`、会话 `session-*.json`。
//
// ⚠ 2026-11-22 真机踩过：处置时用 `loadStore(体.session || null)`，前端根本没传 session，
//   于是 `会话工作区(null)` 解析不出工作区层 → 只在 global + session(null) 里找 →
//   工作区那条记忆「账上 confirmed、库里原样」，`改了记忆 = 0` 却照写 `条.状态 = 'confirmed'`。
//   扫的时候有真 sid 所以看得见，处置的时候看不见 —— 典型的「看得见改不着」。
//
// 所以这里改成：**直接遍历所有层文件，按 id 找到它真正所在的那一层再改**，
// 每改一个文件先留一份 `.bak-陈旧-<时间>` 原文备份（同日重复跑只留第一份）。

/** 列出库里的所有记忆层文件（不含备份、不含 traces）。 */
export function 列库文件() {
  const 们 = []
  let 名单 = []
  try {
    名单 = readdirSync(STORE_DIR)
  } catch (error) {
    return 们
  }
  for (const 名 of 名单) {
    if (!名.endsWith('.json')) continue
    if (名.includes('.bak')) continue
    if (名 === '_facts.json' || /^_ws-[0-9a-f]{8,}\.json$/.test(名) || /session-[0-9a-f-]{8,}\.json$/.test(名)) {
      们.push(join(STORE_DIR, 名))
    }
  }
  return 们
}

/** 把所有层里的记忆读成一张表（按 id 去重，先到先得）。扫描与处置用同一个口径。 */
export function 全库记忆() {
  const 见过 = new Map()
  for (const 文件 of 列库文件()) {
    let 库 = null
    try {
      库 = JSON.parse(readFileSync(文件, 'utf8'))
    } catch (error) {
      continue
    }
    const 记忆们 = 库 && Array.isArray(库.memories) ? 库.memories : []
    for (const m of 记忆们) if (m && m.id && !见过.has(m.id)) 见过.set(m.id, m)
  }
  return Array.from(见过.values())
}

function 改一层(文件, 改一条, 时间) {  let 原文 = ''
  try {
    原文 = readFileSync(文件, 'utf8')
  } catch (error) {
    return 0
  }
  let 库 = null
  try {
    库 = JSON.parse(原文)
  } catch (error) {
    return 0
  }
  const 记忆们 = 库 && Array.isArray(库.memories) ? 库.memories : null
  if (!记忆们) return 0
  let 改数 = 0
  for (const m of 记忆们) if (m && m.id && 改一条(m)) 改数++
  if (!改数) return 0
  try {
    // 2026-11-22：备份名原来带毫秒（`bak-陈旧-2026-11-22T01-23-45-678Z`），跟上面注释「同日重复只留第一份」
    //   对不上——每次跑都是一份新备份，一天能攒几十份。改成按天：同一天只留第一次改之前的那份原文。
    const 天 = String(时间 instanceof Date ? 时间.toISOString() : 时间).slice(0, 10)
    const 备份 = 文件 + '.bak-陈旧-' + (天 || '未知日期')
    if (!existsSync(备份)) writeFileSync(备份, 原文, 'utf8')
  } catch (error) {
    // 备份失败也要继续改：原件还在，_facts.json 每天也被别的备份轮着拷
  }
  try {
    // 2026-11-22：这里原来裸 writeFileSync —— 半截崩溃就是半个 JSON，整个层文件报废。
    //   必须走原子写（同目录 staging + fsync + rename）。
    writeFileAtomicSync(文件, JSON.stringify(库, null, 2))
  } catch (error) {
    diag('  陈旧检查：写回 ' + basename(文件) + ' 失败：' + ((error && error.message) || error))
    return 0
  }
  // 2026-11-22：这层是直接改文件，没走 saveStore，SQLite 镜像就停在了改之前。
  //   CLAY_SQL_READ=1 时召回读的是镜像 → 会继续注入已经标过时的记忆。
  //   与其假装同步，不如把镜像标滞后，读路径自动回退 JSON（见 store-core 的 读注入数据）。
  标记镜像滞后(文件)
  return 改数
}

/**
 * 把 ids 里还活着的记忆标成「已被取代（被谁: 陈旧检查）」。
 * 返回 [{ 层, 改了 }]，空数组 = 一条都没改到（这时调用方必须报错，别悄悄记 confirmed）。
 */
export function 跨层标取代(ids, 为什么, 时间 = new Date().toISOString()) {
  const 目标 = new Set((ids || []).map(String))
  const 结果 = []
  for (const 文件 of 列库文件()) {
    const 改数 = 改一层(
      文件,
      (m) => {
        if (!目标.has(m.id) || m.已被取代) return false
        m.已被取代 = { 被谁: '陈旧检查', 为什么, 作废于: 时间 }
        // 2026-11-22：核心存储的合并靠 editedAt 判新旧（store-core / store-merge 的 更新时间）。
        //   只改 已被取代 不碰 editedAt 的话，并发合并时旧快照「看起来一样新」就能把它盖回来。
        m.editedAt = 时间
        return true
      },
      时间,
    )
    if (改数) 结果.push({ 层: basename(文件), 改了: 改数 })
  }
  return 结果
}

/** 撤销「陈旧检查」标过的 已被取代（只认 被谁 === '陈旧检查'，人明确改口的别动）。 */
export function 跨层撤销取代(ids, 时间 = new Date().toISOString()) {
  const 目标 = new Set((ids || []).map(String))
  const 结果 = []
  for (const 文件 of 列库文件()) {
    const 改数 = 改一层(
      文件,
      (m) => {
        if (!目标.has(m.id)) return false
        const 旧 = m.已被取代
        if (!旧 || 旧.被谁 !== '陈旧检查') return false
        delete m.已被取代
        if (!Array.isArray(m.撤销记录)) m.撤销记录 = []
        m.撤销记录.push({ 被谁: '陈旧检查', 撤销于: 时间, 原因: '在体检页点了撤销' })
        // 同上：撤销也是一次改动，editedAt 必须跟着走，否则合并时被旧快照盖回去
        m.editedAt = 时间
        return true
      },
      时间,
    )
    if (改数) 结果.push({ 层: basename(文件), 改了: 改数 })
  }
  return 结果
}

/**
 * 给清单里每条「命中记忆」标上 `失效路径数`：这条记忆一共出现在几条失效路径里。
 * ≥2 说明它多半在**列举**（「只探测 A、B、C 这几个路径」），不该一键标过时。
 */
export function 标失效路径数(清) {
  const 数 = {}
  const 记录 = (清 && 清.记录) || {}
  for (const 条 of Object.values(记录)) {
    if (!条 || 条.状态 !== 'pending') continue
    for (const x of 条.命中记忆 || []) if (x && x.id) 数[x.id] = (数[x.id] || 0) + 1
  }
  for (const 条 of Object.values(记录)) {
    for (const x of (条 && 条.命中记忆) || []) if (x && x.id) x.失效路径数 = 数[x.id] || 1
  }
  return 清
}
