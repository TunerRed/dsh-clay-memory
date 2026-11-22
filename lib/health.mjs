// 自检（1.12.78）：插件跟当前这版 DSH 还合不合得来 —— 给体检页一个「点一下查一遍」的入口。
//
// 为什么要它（2026-11-22 主人在 DSH 预览版把定时任务搞没之后提的）：
//   DSH 升级把某个事件名、服务名、API 形状改了，插件**不会崩、也不会往日志里写报错**，
//   只是那件事从此永远不发生。1.12.66 之前 dream 连续三天 0 产出、账上干干净净，
//   就是这个形状 —— 所以这里的判据不是「有没有抛异常」，而是
//   「**该发生的事，最近发生过没有**」。
//
// 判据分四层（从硬到软）：
//   ① 服务层：apply() 期间接住的服务对象还在不在（这是最硬的，没有就是没有）
//   ② 行为层：diag 里各条流水线最后一次留痕距今多久（间接但最贴近真实）
//   ③ 水位层：cfg 里的 _上次整理 / _上次归纳 / _上次陈旧检查 跟当前时间比
//   ④ 数据层：库文件还能不能读、结构还是不是预期
// 另外可选的「深度检查」会真发一次模型请求，验证 provider/model 这条路通不通（花几百 token）。
//
// 设计约束（都是踩过的坑）：
//   - 本模块不碰 ctx：服务对象由 apply() 期间接住后传进来（1.12.67：定时器里 ctx 已 inactive）
//   - 全部判据做成纯函数，方便测试；只有「读日志」「读库文件」两处 IO
//   - 读日志只读尾部，不整文件扫（diag 一天能长到 MB 级）

import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { DIAG } from './diag.mjs'
import { CFG_DIR, STORE_DIR, 宿主数据根 } from './paths.mjs'
import { join, dirname } from 'node:path'
import { 找帧起点, 解析事件 } from './archive-reader.mjs'

export const 自检版本 = '1.12.90'

// 服务清单必须跟 lib/index.js 的 `export const inject` 保持一致。
// 只列「插件真用得上」的：sessionTitle 也在 inject 里但属于可选增强，缺了不算故障，所以标 可选。
export const 服务清单 = [
  { 键: 'systemPrompt', 名: '系统提示词', 说明: '注入记忆正文靠它（system-prompt/assemble）' },
  { 键: 'agents', 名: '代理', 说明: '拿会话、跑 dream / 陈旧检查都要它' },
  { 键: 'timer', 名: '定时器', 说明: '后台巡检的节拍' },
  { 键: 'tools', 名: '工具', 说明: '工具注册表；工具拦截 1.12.79 起默认关，缺了也不影响记忆' },
  { 键: 'webServer', 名: 'Web 服务', 说明: '设置页与体检页的路由靠它' },
  { 键: 'sessions', 名: '会话', 说明: '会话枚举与标题' },
  { 键: 'llm', 名: '模型', 说明: '扩容词、dream 归纳、经历提取都要它' },
  { 键: 'sessionTitle', 名: '会话标题', 说明: '可选增强，缺了不影响记忆', 可选: true },
]

// diag 里的「流水线留痕」哨兵。正则会同时匹配「成功」和「失败」两种文案 ——
// 这里判的是「这条流水线最近有没有走完过一次」，至于成功与否另由 fail 关键词看。
export const 哨兵 = [
  {
    键: '注入',
    名: '记忆注入',
    正则: /注入被调用/,
    多久算好: 24,
    多久算差: 72,
    说明: '每轮对话都会打一行；超过一天没有，多半是 system-prompt/assemble 或 agent/inbox 事件变了',
  },
  {
    键: '整理',
    名: '自动整理（去重合并）',
    正则: /自动整理：|手动整理：/,
    多久算好: 48,
    多久算差: 96,
    说明: '一天该跑一次；两天以上没留痕说明触发链断了',
  },
  {
    键: 'dream',
    名: '自动 dream（规律归纳）',
    正则: /自动 dream：|dream 归纳：/,
    多久算好: 48,
    多久算差: 96,
    说明: '一天该跑一次；两天以上没留痕说明触发链断了',
  },
  {
    键: '经历',
    名: '经历提取（梗 / 状态 / 里程碑）',
    正则: /经历提取：/,
    多久算好: 24 * 7,
    多久算差: 24 * 14,
    说明: '要有「静默 25 分钟 + 新增 10 条发言」才触发，安静几天不跑是正常的，所以门槛放到一周',
  },
]

const 小时 = 3600 * 1000

/** 读 diag 尾部（含轮转的 .1）。返回行数组，按时间从旧到新。 */
export function 读日志尾部(文件 = DIAG, 最大行 = 800) {
  const 段们 = [文件 + '.1', 文件]
  const 行 = []
  const 最大字节 = 1024 * 1024
  for (const f of 段们) {
    let fd = null
    try {
      if (!existsSync(f)) continue
      const 大小 = statSync(f).size
      if (大小 <= 0) continue
      // 真只读尾部：按 UTF-8 字节截最后 1MB 再解码（不能拿字节大小去 slice JS 字符串，否则中文多时会切出空串）
      const 起 = Math.max(0, 大小 - 最大字节)
      const 读长 = 大小 - 起
      const buf = Buffer.allocUnsafe(读长)
      fd = openSync(f, 'r')
      const 实读 = readSync(fd, buf, 0, 读长, 起)
      const 文本 = buf.subarray(0, 实读).toString('utf8')
      const 行们 = 文本.split('\n')
      // 首行可能被截断（或从多字节字符中间切开），整行丢掉（除非是从字节 0 读的）
      if (起 > 0 && 行们.length) 行们.shift()
      for (const l of 行们) if (l.trim()) 行.push(l)
    } catch (error) {
      // 日志读不到不算故障：新装的插件本来就没有日志
    } finally {
      if (fd !== null) {
        try { closeSync(fd) } catch (e2) {}
      }
    }
  }
  return 行.slice(-最大行)
}

/**
 * 从日志里找某条哨兵最后一次出现的位置。返回 { 时间(ms), 原文 } 或 null。
 *
 * 按「时间最晚」取，不是按「数组最后一条」取：读日志尾部会把 DIAG 和 DIAG.1
 * 拼在一起，轮转边界上两段顺序不保证严格递增；只按位置取会把旧的当新的，
 * 于是明明断了三天还说「刚刚」——自检最怕这种假好消息。
 */
export function 找最后(行们, 正则) {
  let 最好 = null
  for (const l of 行们) {
    if (!正则.test(l)) continue
    const 时 = Date.parse(l.slice(0, 24))
    if (!Number.isFinite(时)) continue
    if (!最好 || 时 >= 最好.时间) 最好 = { 时间: 时, 原文: l.slice(24).trim().slice(0, 120) }
  }
  return 最好
}

/** 时长 → 状态。负数（时钟回拨/未来时间）也按 ok 处理，不吓人。 */
export function 判时长(毫秒, 好多时, 差多时) {
  if (!Number.isFinite(毫秒)) return 'warn'
  const h = 毫秒 / 小时
  if (h <= 好多时) return 'ok'
  if (h <= 差多时) return 'warn'
  return 'fail'
}

/** 把毫秒转成「3 小时前 / 2 天前 / 刚刚」。 */
export function 说时长(毫秒) {
  if (!Number.isFinite(毫秒)) return '时间不明'
  if (毫秒 < 0) return '刚刚'
  const m = Math.floor(毫秒 / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return m + ' 分钟前'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' 小时前'
  const d = Math.floor(h / 24)
  return d + ' 天前'
}

/**
 * 解析 cfg 里那些「上次跑过」的时间戳 —— 有的是 ISO 字符串（_上次整理），有的是毫秒数字。
 * 认不出的一律 NaN（=「没记过」）：0 是「清零等下次跑」，不能当成 1970 年然后报「56 年前」。
 */
export function 解析时刻(值) {
  if (值 === null || 值 === undefined || 值 === '') return NaN
  const n = typeof 值 === 'number' ? 值 : Number(值)
  // 毫秒时间戳都在 1e11 以上（1973 年）；比这小的数字是「清零 / 天数 / 乱写的」，不算时刻
  if (Number.isFinite(n)) return n > 1e11 ? n : NaN
  const t = Date.parse(String(值))
  return Number.isFinite(t) ? t : NaN
}

function 项(名, 状态, 说明, 细节) {
  return { 名, 状态, 说明, 细节: 细节 || '' }
}

/** 服务层：apply() 期间接住的服务还在不在。 */
export function 查服务(服务们) {
  const 缺 = []
  const 缺可选 = []
  for (const s of 服务清单) {
    const 有 = !!(服务们 && 服务们[s.键])
    if (有) continue
    if (s.可选) 缺可选.push(s)
    else 缺.push(s)
  }
  if (缺.length) {
    return 项(
      'DSH 服务接口',
      'fail',
      '缺 ' + 缺.map((s) => s.名).join('、') + ' —— 这些是插件的主干，缺了对应功能整块不工作',
      缺.map((s) => s.名 + '：' + s.说明).join('；'),
    )
  }
  if (缺可选.length) {
    return 项('DSH 服务接口', 'warn', '主干都在，但缺可选服务：' + 缺可选.map((s) => s.名).join('、'), '')
  }
  return 项('DSH 服务接口', 'ok', '主干 ' + 服务清单.filter((s) => !s.可选).length + ' 个服务都在')
}

/**
 * 行为层：各条流水线最后一次留痕。
 *
 * 双源：先看日志（能看原文，最权威），日志里没有就退到持久化水位（`备用`）。
 *
 * 为什么必须有第二源（2026-11-22 真机踩到）：diag 1MB 就轮转、大约 20 分钟一轮，
 * 而整理 / dream / 陈旧检查都是 24 小时跑一次 —— 它们留的痕早被轮转冲掉了，
 * 只靠日志会永远「找不到」，每次自检都报假警告。水位是持久化的，能跨轮转。
 *
 * @param {{ [键: string]: number|string }} 备用 键 → 时间（毫秒数或 ISO 串）
 */
export function 查哨兵(行们, 现在, 备用 = {}) {
  return 哨兵.map((s) => {
    const 中 = 找最后(行们, s.正则)
    if (!中) {
      const 水 = 解析时刻(备用[s.键])
      if (Number.isFinite(水)) {
        const 距离备 = 现在 - 水
        return 项(
          s.名,
          判时长(距离备, s.多久算好, s.多久算差),
          '日志里没有（轮转掉了），按水位：' + 说时长(距离备),
          '水位 ' + new Date(水).toISOString(),
        )
      }
      // 两处都没有：可能是刚装、也可能是一直没跑。算 warn 不算 fail —— 没证据不下死结论
      return 项(s.名, 'warn', '日志里找不到这条流水线的记录（刚装或一直没跑过）', s.说明)
    }
    const 距离 = 现在 - 中.时间
    const 态 = 判时长(距离, s.多久算好, s.多久算差)
    return 项(s.名, 态, '最后一次：' + 说时长(距离), 中.原文)
  })
}

/** 水位层：cfg 里记的「上次跑过」时间。 */
export function 查水位(cfg, 现在) {
  const 表 = [
    { 键: '_上次整理', 名: '整理水位', 好: 48, 差: 96 },
    { 键: '_上次归纳', 名: 'dream 水位', 好: 48, 差: 96 },
  ]
  return 表.map((t) => {
    const 值 = cfg ? cfg[t.键] : undefined
    const 时 = 解析时刻(值)
    if (!Number.isFinite(时)) {
      return 项(t.名, 'warn', '配置里还没有记过（第一次启动，或还没跑到）', 'cfg.' + t.键 + ' = ' + JSON.stringify(值))
    }
    const 距离 = 现在 - 时
    return 项(t.名, 判时长(距离, t.好, t.差), '上次：' + 说时长(距离), new Date(时).toISOString())
  })
}

// ⭐ 1.12.80 落盘水位：召回在跑 ≠ 会话事件写进盘了。
//
// 2026-11-22 的事故形状：11:46–13:46 四个会话一共被组装了 892 次 prompt，
// 而会话文件的最后一条事件停在 11:37，全程没有任何地方会喊一声
// （trace 照样在写、界面照样在跑，只有翻文件才看得出来）。
//
// 为什么不用会话文件的 mtime：多帧 zstd 在重启/补偿写时会被整份重写，
// eb51a18e 的 mtime 是 15:39:35，最后一条业务事件却是 11:37:07 —— mtime 会骗人。
// 所以得真解一帧出来读 `time`；为了不把 12MB 的归档整个读进来，
// 只读尾部 4MB 窗口、从最后一个 zstd 帧往前最多试 3 帧，并且跳过 `session/end-seed`
// （它是重启时补写的一条，时间会「看起来」很新，正好会把滞后盖住）。
const 落盘好滞后 = 10 * 60e3
const 落盘差滞后 = 60 * 60e3
const 归档尾窗口 = 4 * 1024 * 1024
const 归档试帧数 = 3

/** 会话归档路径：`<CFG_DIR>/data/sessions/<工作区目录>/<sid>/session.v4.jsonl.zstd`。 */
export function 找会话归档(sid) {
  if (!sid) return ''
  const 根 = join(dirname(宿主数据根()), 'sessions')
  try {
    for (const 工作区 of readdirSync(根, { withFileTypes: true })) {
      if (!工作区.isDirectory()) continue
      const 候选 = join(根, 工作区.name, String(sid), 'session.v4.jsonl.zstd')
      if (existsSync(候选)) return 候选
    }
  } catch (error) {
    /* 这版宿主不写 jsonl.zstd（测试实例、老版本）：当成没有，交给调用方 skip */
  }
  return ''
}

/** 会话归档里「最后一条业务事件」的时间（毫秒）。读不出来给 NaN。 */
export function 读会话尾时间(路径) {
  if (!路径 || !existsSync(路径)) return NaN
  let buf
  try {
    const 大小 = statSync(路径).size
    const 读 = Math.min(归档尾窗口, 大小)
    buf = Buffer.alloc(读)
    const fd = openSync(路径, 'r')
    try {
      readSync(fd, buf, 0, 读, 大小 - 读)
    } finally {
      closeSync(fd)
    }
  } catch (error) {
    return NaN
  }
  const 起点们 = 找帧起点(buf)
  if (!起点们.length) return NaN
  for (let k = 起点们.length - 1; k >= 0 && k > 起点们.length - 1 - 归档试帧数; k -= 1) {
    const 止 = k + 1 >= 起点们.length ? buf.length : 起点们[k + 1]
    let 事件们
    try {
      const 出 = zstdDecompressSync(buf.subarray(起点们[k], 止))
      if (!出 || !出.length) continue
      事件们 = 解析事件(出.toString('utf8')).事件
    } catch (error) {
      continue // 边界猜窄了，或者这是压缩流里的假魔数 —— 往前一帧再试
    }
    let 最晚 = NaN
    for (const e of 事件们) {
      if (!e || e.type === 'session' || e.type === 'session/end-seed') continue
      const t = Number(e.time)
      if (Number.isFinite(t) && (!Number.isFinite(最晚) || t > 最晚)) 最晚 = t
    }
    if (Number.isFinite(最晚)) return 最晚
  }
  return NaN
}

/** 追溯文件最后一条的 `at`（毫秒）。只读尾部 8KB。 */
export function 读追溯尾时间(路径) {
  if (!路径 || !existsSync(路径)) return NaN
  try {
    const 大小 = statSync(路径).size
    const 读 = Math.min(8192, 大小)
    const buf = Buffer.alloc(读)
    const fd = openSync(路径, 'r')
    try {
      readSync(fd, buf, 0, 读, 大小 - 读)
    } finally {
      closeSync(fd)
    }
    const 行们 = buf.toString('utf8').split('\n')
    for (let i = 行们.length - 1; i >= 0; i -= 1) {
      const 行 = 行们[i].trim()
      if (!行) continue
      try {
        const j = JSON.parse(行)
        const t = Number(j && j.at)
        if (Number.isFinite(t)) return t
      } catch (error) {
        /* 窗口头一行可能被切断，跳过 */
      }
    }
  } catch (error) {}
  return NaN
}

/**
 * 采样本：拿最近活跃的 N 个会话，各自读「召回侧时间」与「落盘侧时间」。
 * 为什么按 trace 文件的 mtime 挑：这样连「今天没碰过的会话」也能覆盖到，
 * 不依赖当前 agent 上下文（apply 之后 ctx 已经 inactive）。
 */
export function 读落盘样本(最多 = 5) {
  const 出 = []
  const 尾缀 = '.traces.jsonl'
  try {
    if (!existsSync(STORE_DIR)) return 出
    const 表 = readdirSync(STORE_DIR)
      .filter((f) => f.endsWith(尾缀))
      .map((f) => {
        let m = 0
        try {
          m = statSync(join(STORE_DIR, f)).mtimeMs
        } catch (error) {}
        return { f, m }
      })
      .sort((a, b) => b.m - a.m)
      .slice(0, 最多)
    for (const { f } of 表) {
      const sid = f.slice(0, -尾缀.length)
      const 召回在 = 读追溯尾时间(join(STORE_DIR, f))
      if (!Number.isFinite(召回在)) continue
      出.push({ 会话: sid, 召回在, 会话在: 读会话尾时间(找会话归档(sid)) })
    }
  } catch (error) {}
  return 出
}

/** 纯判断：召回侧比落盘侧新多少。样本里没有可比的就 skip（不是故障）。 */
export function 查落盘(样本, 现在) {
  if (!Array.isArray(样本) || !样本.length) {
    return 项('会话落盘', 'skip', '还没采到样本（第一次启动，或这块没跑到）')
  }
  const 可比 = 样本
    .map((s) => ({ 会话: s && s.会话, 召回在: Number(s && s.召回在), 滞后: Number(s && s.召回在) - Number(s && s.会话在) }))
    .filter((s) => Number.isFinite(s.滞后))
    .sort((a, b) => b.滞后 - a.滞后)
  if (!可比.length) {
    return 项('会话落盘', 'skip', '样本里没有可比对（这版宿主可能不写 session 归档）', '样本 ' + 样本.length + ' 个')
  }
  const 短 = (sid) => String(sid || '').replace(/^session-/, '').slice(0, 8)
  // ⚠️ 这里必须区分「现在卡着」和「以前卡过」：
  //   老会话的滞后会永远留在 trace 里（它不会再落盘了），只看最大滞后会让体检页永远亮红。
  //   所以只有「召回发生在 30 分钟内」才算现在还在跑；更早的只当 24 小时内的旧账提一句，过期就不提。
  const 活跃窗 = 30 * 60e3
  const 旧账窗 = 24 * 60 * 60e3
  const 时长 = (毫秒) => {
    const m = Math.round(毫秒 / 60000)
    if (m < 60) return m + ' 分钟'
    const h = Math.round((m / 60) * 10) / 10
    return h + ' 小时'
  }
  const 半 = (x) => 短(x.会话) + ' 落后 ' + 时长(x.滞后)

  const 现在卡 = 可比.filter((x) => 现在 - x.召回在 <= 活跃窗 && x.滞后 > 落盘好滞后)
  if (现在卡.length) {
    const 态 = 现在卡.some((x) => x.滞后 > 落盘差滞后) ? 'fail' : 'warn'
    return 项('会话落盘', 态, 现在卡.slice(0, 3).map(半).join('；') + '（召回在跑、会话没写进盘）', '检查于 ' + new Date(现在).toISOString())
  }
  const 旧账 = 可比.filter((x) => 现在 - x.召回在 > 活跃窗 && 现在 - x.召回在 <= 旧账窗 && x.滞后 > 落盘差滞后)
  if (旧账.length) {
    return 项(
      '会话落盘',
      'warn',
      旧账.slice(0, 3).map(半).join('；') + '（那会儿卡过，现在没卡着）',
      '共 ' + 可比.length + ' 个样本，检查于 ' + new Date(现在).toISOString(),
    )
  }
  return 项('会话落盘', 'ok', '召回和会话同步，最多落后 ' + 时长(可比[0].滞后), '样本 ' + 可比.length + ' 个')
}

/** 读 `_episodes.json`（经历提取的进度表）；读不到不给错误，返回 null。 */
export function 读经历(路径 = join(STORE_DIR, '_episodes.json')) {
  try {
    if (!existsSync(路径)) return null
    const 数据 = JSON.parse(readFileSync(路径, 'utf8'))
    return 数据 && typeof 数据 === 'object' ? 数据 : null
  } catch (error) {
    return null
  }
}

/**
 * 把散落在各处的「上次跑过」时间收成一张表，给 `查哨兵` 当备用源。
 *
 * 收两颗源头：配置里的 `_上次整理` / `_上次归纳` / `_上次陈旧检查`，
 * 以及 `_episodes.json` 里所有会话的 `上次提取` 取最晚的一个。
 */
export function 默认备用(cfg, 经历 = null) {
  const 出 = {}
  if (cfg) {
    出.整理 = cfg._上次整理
    出.dream = cfg._上次归纳
    出.陈旧 = cfg._上次陈旧检查
  }
  if (经历 && typeof 经历 === 'object') {
    let 最晚 = NaN
    for (const 键 of Object.keys(经历)) {
      const 条 = 经历[键]
      const 时 = 解析时刻(条 && 条.上次提取)
      if (Number.isFinite(时) && (!Number.isFinite(最晚) || 时 > 最晚)) 最晚 = 时
    }
    if (Number.isFinite(最晚)) 出.经历 = 最晚
  }
  return 出
}

/** 数据层：一个 json 文件能不能读、结构对不对。 */
export function 查文件(路径, 校验) {
  const 短名 = 路径.split(/[\\/]/).pop()
  try {
    if (!existsSync(路径)) return 项(短名, 'skip', '文件不存在（还没生成，正常）')
    const 文 = readFileSync(路径, 'utf8')
    const 数据 = JSON.parse(文)
    const 果 = 校验 ? 校验(数据) : { ok: true, 说明: '能读' }
    return 项(短名, 果.ok ? 'ok' : 'fail', 果.说明, '')
  } catch (error) {
    return 项(短名, 'fail', '读不了：' + String((error && error.message) || error).slice(0, 120))
  }
}

/** 汇总：任何一项 fail 就是整体 fail；有 warn 就是 warn。 */
export function 汇总(项们) {
  const 算 = (态) => 项们.filter((x) => x.状态 === 态).length
  const fail = 算('fail')
  const warn = 算('warn')
  const ok = 算('ok')
  const skip = 算('skip')
  const 结论 = fail ? 'fail' : warn ? 'warn' : 'ok'
  return { 结论, fail, warn, ok, skip, 共: 项们.length }
}

/**
 * 组装一次浅检（零 token、毫秒级）。
 * 入参全是「已经准备好的事实」，本函数只做判断 —— 方便测试和复用。
 */
export function 跑浅检({ 服务, cfg, 行们, 现在, 库文件们, 探针, 备用, 经历, 落盘样本 }) {
  const 项们 = []
  项们.push(查服务(服务))
  项们.push(...查哨兵(行们 || [], 现在, 备用 || 默认备用(cfg, 经历)))
  项们.push(...查水位(cfg, 现在))
  项们.push(查落盘(落盘样本 !== undefined ? 落盘样本 : 读落盘样本(), 现在))
  for (const f of 库文件们 || []) 项们.push(查文件(f.路径, f.校验))
  if (探针) {
    try {
      const r = 探针()
      项们.push(项('记忆能读能召回能渲染', r.ok ? 'ok' : 'fail', r.说明, r.细节 || ''))
    } catch (error) {
      项们.push(项('记忆能读能召回能渲染', 'fail', '试跑时抛错：' + String((error && error.message) || error).slice(0, 160)))
    }
  }
  return { 项们, 统计: 汇总(项们) }
}

/** 主库、骨架、配置（以及启用陈旧检查时的陈旧清单）的存在性与结构。 */
export function 默认库文件们(额外 = {}) {
  const facts = 额外.facts || join(STORE_DIR, '_facts.json')
  const core = 额外.core || join(STORE_DIR, '_core.json')
  const stale = 额外.stale || join(STORE_DIR, '_stale.json')
  const config = 额外.config || join(CFG_DIR, 'clay-memory-config.json')
  const 表 = [
    {
      路径: facts,
      校验: (d) => {
        const ms = d && d.memories
        const 条 = Array.isArray(ms) ? ms.length : ms && typeof ms === 'object' ? Object.keys(ms).length : -1
        if (条 < 0) return { ok: false, 说明: '结构不对：没有 memories' }
        return { ok: true, 说明: '能读，记忆 ' + 条 + ' 条' }
      },
    },
    {
      路径: core,
      校验: (d) => {
        const items = d && d.items
        if (!Array.isArray(items)) return { ok: false, 说明: '结构不对：没有 items 数组' }
        return { ok: true, 说明: '能读，骨架 ' + items.length + ' 条' }
      },
    },
  ]
  if (额外.含陈旧 === true) {
    表.push({
      路径: stale,
      校验: (d) => (d && typeof d === 'object' ? { ok: true, 说明: '能读' } : { ok: false, 说明: '不是对象' }),
    })
  }
  表.push({ 路径: config, 校验: (d) => (d && typeof d === 'object' ? { ok: true, 说明: '能读' } : { ok: false, 说明: '不是对象' }) })
  return 表
}
