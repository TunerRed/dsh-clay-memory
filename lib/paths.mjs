// ════════ 路径层：CFG_DIR / STORE_DIR / 会话库文件路径 ════════
// 2026-10-30 从 index.js 抽出（拆层工程第 5a 批）
// index.js 里所有引用点靠 import 绑定，零改动。
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

export const CFG_DIR = process.env.DSH_HOME || join(homedir(), '.dsh')
export const STORE_DIR = join(CFG_DIR, 'clay-memory')
export const BACKUP_DIR = join(CFG_DIR, 'clay-memory-backup')
export const CFG_PATH = join(CFG_DIR, 'clay-memory-config.json')

export const FACTS_NAME = '_facts.json'

export function factPath() {
  return join(STORE_DIR, FACTS_NAME)
}

// 目录里哪些才算「会话库」—— `_facts.json` / `_ws-*` 都是分层库，不是会话，遍历都得跳过 `_` 开头
export function 是会话文件(fn) {
  return typeof fn === 'string' && fn.endsWith('.json') && fn.charAt(0) !== '_'
}

export function storePath(sid) {
  let 名 = String(sid).replace(/[^a-zA-Z0-9_-]/g, '_')
  if (名 === '_facts') 名 = '_facts.session' // 别跟全局事实库撞名（正常会话 id 不可能长这样）
  return join(STORE_DIR, 名 + '.json')
}

// ──── GPT 整改 P2（workspace 三层 scope）───
// 工作区记忆 = 同一工作区（cwd）下所有会话共享的项目知识，落独立文件 `_ws-<哈希>.json`。
//   scope：global（_facts.json）/ workspace:<cwd>（_ws-*.json）/ session（会话文件）
// 规范化规则（确定性，Windows / Linux 行为一致）：
//   - 分隔符统一 '/'；去掉尾部 '/'；盘符（'C:'）大写
//   - '.' 折叠掉；'..' 折叠上一段（超出根时：有盘符则丢弃、无盘符则保留）
//   - 不解析符号链接：工作区身份 = 规范化后的路径字符串本身（宿主给的 cwd 即身份）。
//     符号链接路径与其真实路径被视为**不同工作区**（明确约定，1.8.39 B）；
//     realpath 会让「同一目录的多个链接」归一成不同字符串，制造多身份。
// 文件名 = '_ws-' + sha256(规范化结果).hex 前 32 位 + '.json'：哈希无碰撞，路径不进文件名
// （旧版用字符替换消毒，'C:/work/a/b' 与 'C:/work/a_b' 会撞成同一名，1.8.38 起废弃）。
export function 规范化(x) {
  const 原文 = String(x || '').replace(/\\/g, '/')
  if (!原文) return ''
  // 纯根（Linux '/'、Windows 'C:/'/'C:'）不能坍缩成空串：根目录是合法工作区
  if (原文 === '/') return '/'
  if (/^[a-zA-Z]:$/.test(原文)) return 原文[0].toUpperCase() + ':/'
  if (/^[a-zA-Z]:\/$/.test(原文)) return 原文[0].toUpperCase() + ':/'
  const 去尾 = 原文.replace(/\/+$/, '')
  if (!去尾) return 原文.startsWith('/') ? '/' : '' // '//'、'///' 都是根
  if (/^[a-zA-Z]:$/.test(去尾)) return 去尾[0].toUpperCase() + ':/' // 'C://' → 'C:/'
  const 前导 = 去尾.startsWith('/')
  const 盘 = /^[a-zA-Z]:\//.test(去尾) ? 去尾.slice(0, 2).toUpperCase() : ''
  let 文 = 盘 ? 去尾.slice(3) : 去尾
  // 1.8.39 B：盘符路径（Windows）文件系统大小写不敏感 —— 目录段统一小写，
  //   'C:/Work' 与 'c:/work' 是同一个目录，必须归一成同一个工作区标识；
  //   Linux 路径（无盘符）大小写敏感，保留原大小写。
  if (盘) 文 = 文.toLowerCase()
  const 段 = []
  for (const 片 of 文.split('/')) {
    if (!片 || 片 === '.') continue
    if (片 === '..') {
      if (段.length && 段[段.length - 1] !== '..') 段.pop()
      else if (!盘 && !前导) 段.push('..')
      continue
    }
    段.push(片)
  }
  const 尾 = 段.join('/')
  return (盘 ? 盘 + '/' : 前导 ? '/' : '') + 尾
}

export function 工作区文件(cwd) {
  const 根 = 规范化(cwd)
  if (!根) return ''
  const 名 = '_ws-' + createHash('sha256').update(根).digest('hex').slice(0, 32)
  return join(STORE_DIR, 名 + '.json')
}

// 旧版（≤1.8.37）的消毒文件名：升级后旧文件还能读到（读兼容），写只写新哈希名。
export function 工作区文件旧(cwd) {
  const 根 = 规范化(cwd)
  if (!根) return ''
  return join(STORE_DIR, '_ws-' + 根.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json')
}

// 从文件名反推工作区 id（全量回填镜像兜底用）：新哈希名返回哈希串；旧消毒名返回消毒串。
// 1.8.37 起每次写盘都带 wsRoot 字段，正常路径根本不需要反推；此兜底仅防手工构造的文件。
export function 工作区文件id(fn) {
  if (typeof fn !== 'string' || !fn.startsWith('_ws-') || !fn.endsWith('.json')) return ''
  return fn.slice(4, -5)
}

// ⭐ 2026-10-31 主实例适配：桌面版宿主的会话元数据（projcache / workspace.json）挂在
//   data root（CFG_DIR/data/storages），而测试实例直接是 CFG_DIR/storages。
//   有 data root 就优先用它，读标题 / 工作区注册表 / 会话 cwd 都从这里走。
export function 宿主数据根() {
  const 长 = join(CFG_DIR, 'data', 'storages')
  return existsSync(长) ? 长 : join(CFG_DIR, 'storages')
}

// 会话的工作区 cwd：读宿主 projcache（session 文件 record.identity.cwd）。
// 拿不到（测试环境 / 老版本宿主）就返回 ''，调用方退化成「不读工作区层」。
export function 会话工作区(sid) {
  if (!sid) return ''
  try {
    const 候选 = join(宿主数据根(), 'session_projcache', 'sessions', String(sid) + '.json')
    if (!existsSync(候选)) return ''
    const j = JSON.parse(readFileSync(候选, 'utf8'))
    const cwd = j && j.record && j.record.identity && j.record.identity.cwd
    return typeof cwd === 'string' && cwd ? 规范化(cwd) : ''
  } catch (error) {
    return ''
  }
}
