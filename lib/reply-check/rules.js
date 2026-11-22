// 回复体检规则的开关：默认全开，只存 disabled 列表（新增规则默认启用，升级不会把新规则锁死）。
// 从 dsh-persona-growth 的 service/analyze-rules.js 搬来，存储位置换到 clay-memory 数据目录。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { STORE_DIR } from '../paths.mjs'

export function rulesFile() {
  return join(STORE_DIR, 'reply-check-rules.json')
}

export function loadDisabled() {
  const file = rulesFile()
  try {
    if (!existsSync(file)) return []
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const list = raw && Array.isArray(raw.disabled) ? raw.disabled : []
    return list.filter((id) => typeof id === 'string' && id !== '')
  } catch {
    return []
  }
}

export function saveDisabled(ids) {
  const file = rulesFile()
  const list = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id !== '') : []
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ disabled: list }, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}
