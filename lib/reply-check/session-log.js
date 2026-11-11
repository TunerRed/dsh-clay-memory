// 会话日志读取（从 dsh-persona-growth 的 sources/session-log.js 裁剪搬来）
// 只保留回复体检需要的部分：多帧 zstd 解压 → 列最近的会话文件 → 抽助手发言。
// DSH 会话文件是「多帧 zstd 拼接」，整文件 zstdDecompressSync 只解第一帧，必须逐帧切。
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { CFG_DIR } from '../paths.mjs'

const MAGIC = 0xFD2FB528
const SESSION_FILE = 'session.v4.jsonl.zstd'

/** 会话日志根：桌面版数据根是 CFG_DIR/data，老/测试实例直接是 CFG_DIR。 */
export function 会话日志根() {
  const 长 = join(CFG_DIR, 'data', 'sessions')
  return existsSync(长) ? 长 : join(CFG_DIR, 'sessions')
}

/** 按 zstd 帧边界切分；非帧尾部（明文）原样忽略。 */
export function splitFrames(buf) {
  const frames = []
  let i = 0
  while (i + 4 <= buf.length) {
    if (buf.readUInt32LE(i) !== MAGIC) break
    const start = i
    i += 4
    const fhd = buf[i]
    i += 1
    const fcsFlag = fhd >> 6
    const single = (fhd >> 5) & 1
    const checksum = (fhd >> 2) & 1
    const dictFlag = fhd & 3
    if (!single) i += 1
    i += [0, 1, 2, 4][dictFlag]
    if (fcsFlag === 0) {
      if (single) i += 1
    } else if (fcsFlag === 1) i += 2
    else if (fcsFlag === 2) i += 4
    else i += 8
    let done = false
    while (!done) {
      if (i + 3 > buf.length) throw new RangeError('zstd frame truncated')
      const header = buf.readUIntLE(i, 3)
      i += 3
      done = (header & 1) === 1
      const type = (header >> 1) & 3
      const size = header >> 3
      i += type === 1 ? 1 : size
      if (i > buf.length) throw new RangeError('zstd frame overflow')
    }
    if (checksum) i += 4
    frames.push(buf.subarray(start, i))
  }
  return frames
}

/** 解压一个会话文件为文本；坏帧跳过不抛错。 */
export function decodeSessionFile(filePath) {
  const buf = readFileSync(filePath)
  const parts = []
  for (const frame of splitFrames(buf)) {
    try {
      parts.push(zstdDecompressSync(frame).toString('utf8'))
    } catch {
      // 单帧损坏时保留其余帧
    }
  }
  return parts.join('')
}

/** 会话目录：<sessionRoot>/<workspace>/<session>/session.v4.jsonl.zstd */
export function listSessionFiles(sessionRoot, { days = 14, maxFiles = 40, maxBytes = 8 * 1024 * 1024, now = Date.now() } = {}) {
  const cutoff = now - days * 24 * 60 * 60 * 1000
  const found = []
  let workspaces = []
  try {
    workspaces = readdirSync(sessionRoot)
  } catch {
    return []
  }
  for (const workspace of workspaces) {
    const workspaceDir = join(sessionRoot, workspace)
    let sessions = []
    try {
      if (!statSync(workspaceDir).isDirectory()) continue
      sessions = readdirSync(workspaceDir)
    } catch {
      continue
    }
    for (const session of sessions) {
      const filePath = join(workspaceDir, session, SESSION_FILE)
      try {
        const stat = statSync(filePath)
        if (!stat.isFile()) continue
        if (stat.mtimeMs < cutoff) continue
        if (stat.size > maxBytes) continue
        found.push({ path: filePath, sessionId: session, mtime: stat.mtimeMs, size: stat.size })
      } catch {
        // 不是会话目录，跳过
      }
    }
  }
  found.sort((a, b) => b.mtime - a.mtime)
  return found.slice(0, maxFiles)
}

/** 从会话文本里取助手发言（只取 text 块，跳过 reasoning）。 */
export function extractAssistantMessages(text, sessionId = '') {
  const messages = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event?.type !== 'assistant/message') continue
    const parts = Array.isArray(event?.data?.message?.content) ? event.data.message.content : []
    const body = parts
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('')
    if (body.trim() === '') continue
    messages.push({ sessionId, seq: event.seq ?? 0, time: event.time ?? 0, text: body })
  }
  return messages
}

/** 取最近 N 条助手发言（跨会话按时间排）。 */
export function recentAssistantMessages({ days = 14, maxFiles = 12, limit = 40 } = {}) {
  const files = listSessionFiles(会话日志根(), { days, maxFiles })
  const messages = []
  for (const file of files) {
    try {
      messages.push(...extractAssistantMessages(decodeSessionFile(file.path), file.sessionId))
    } catch {
      // 坏文件跳过
    }
  }
  messages.sort((a, b) => a.time - b.time)
  return { files: files.length, messages: messages.slice(-limit) }
}
