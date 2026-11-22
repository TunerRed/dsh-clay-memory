// 会话归档读取器（1.12.30）—— F25「从已有会话补记」的前置
//
// 为什么要单独一个模块：
//   DSH 把一段会话存成 `session.v4.jsonl.zstd`，但那是**把整段 jsonl 压成很多个 zstd 帧**。
//   Node 自带的 zstdDecompressSync 一次只解**第一帧**，剩下的帧直接丢掉 ——
//   不报错、不提示，只是悄悄少了 99% 内容（一个 353 KB 的样本 145 帧，只解出 178 字节）。
//   所以这里自己切帧：找 magic、逐帧解、边界猜错就往后借一帧。
//
// 这个模块只做「纯读」：不改任何文件、不依赖宿主、不碰记忆库。
// F25 的提取/预览/应用都建立在它给出的「事件流」上。

import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

// zstd 帧头魔数，每个独立帧都以它开头
export const ZSTD魔数 = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
// 一帧边界最多往后借几帧再断言解不开 —— 压缩流内部也可能出现魔数
const 最多借帧 = 6

// 找出所有候选帧起点。第一个如果不是 0，说明文件头不是 zstd（后面会当纯文本处理）。
export function 找帧起点(buf) {
  const 起点 = buf.indexOf(ZSTD魔数, 0) === 0 ? [0] : []
  let i = 4
  for (;;) {
    i = buf.indexOf(ZSTD魔数, i)
    if (i < 0) break
    起点.push(i)
    i += 4
  }
  return 起点
}

// 多帧解压。返回 { 文本, 帧数, 跳过 }；
// 「跳过」是试遍往后 6 个边界都解不开的起点（真损坏，或者压缩流里的假魔数）。
export function 解压归档(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { 文本: '', 帧数: 0, 跳过: 0 }
  const 起点 = 找帧起点(buf)
  if (!起点.length) {
    // 不是 zstd：按纯文本返回，让调用方自己决定要不要信
    return { 文本: buf.toString('utf8'), 帧数: 0, 跳过: 0 }
  }
  const 片 = []
  let 跳过 = 0
  let k = 0
  while (k < 起点.length) {
    let 成了 = false
    for (let j = k + 1; j <= Math.min(k + 最多借帧, 起点.length); j += 1) {
      const 止 = j >= 起点.length ? buf.length : 起点[j]
      try {
        const 出 = zstdDecompressSync(buf.subarray(起点[k], 止))
        // 解出 0 字节也算失败：zstd 遇到垃圾帧头常常不抛错，只是返回空
        if (!出 || 出.length === 0) throw new Error('空帧')
        片.push(出)
        k = j
        成了 = true
        break
      } catch {
        // 边界猜窄了，或者这个起点本身就是压缩流里的假魔数
      }
    }
    if (!成了) {
      跳过 += 1
      k += 1
    }
  }
  return { 文本: Buffer.concat(片).toString('utf8'), 帧数: 片.length, 跳过 }
}

// 把整段文本按行解析成事件数组。空行忽略；解析失败的行计数，不抛。
export function 解析事件(文本) {
  const 事件 = []
  let 坏行 = 0
  for (const 行 of String(文本 || '').split('\n')) {
    const 去空 = 行.trim()
    if (!去空) continue
    try {
      事件.push(JSON.parse(去空))
    } catch {
      坏行 += 1
    }
  }
  return { 事件, 坏行 }
}

// 读一个 `session.v4.jsonl.zstd`（或同格式的裸 jsonl）。
// 返回 { 头, 事件, 帧数, 跳过, 坏行 }；头是第一条 type === 'session' 的事件。
export function 读会话归档(路径) {
  const buf = readFileSync(路径)
  const { 文本, 帧数, 跳过 } = 解压归档(buf)
  const { 事件, 坏行 } = 解析事件(文本)
  const 头 = 事件.find((e) => e && e.type === 'session') || null
  return { 头, 事件, 帧数, 跳过, 坏行 }
}

// 从事件流里抽出「谁说了什么」，给 F25 的提取环节用。
// 只取 user/message 与 assistant/message 的文本块，跳过工具调用与系统消息。
export function 取对话(事件) {
  const 出 = []
  for (const e of Array.isArray(事件) ? 事件 : []) {
    if (!e) continue
    if (e.type !== 'user/message' && e.type !== 'assistant/message') continue
    // ⚠ 2026-11-22：user/message 里有大量**不是主人说的**宿主注入 ——
    //   runtime-context（整段 system-reminder，上千字）/ time-context / agent-instructions /
    //   skill-catalog / tool-jobs。它们的判据是 data.source.kind（不是文本前缀，
    //   别用正则猜 `<system-reminder>`，那会把 `Time sampled…` 这种漏掉）。
    //   只有 kind 缺失（很老的消息）或 kind === 'user' 才当主人真说的话。
    //   episode.mjs 的 取正文 早就是这么判的，这里对齐它，免得两处口径走散。
    if (e.type === 'user/message') {
      const kind = e.data && e.data.source && e.data.source.kind
      if (kind && kind !== 'user') continue
    }
    // ⚠ 2026-11-22 实测：两种消息的正文**不在同一个位置**。
    //   user/message        → e.data.content
    //   assistant/message   → e.data.message.content（外面还套了一层 message，
    //                         带 id/role/source，里面才是 content 数组）
    //   原来只读 e.data.content，于是助手的话**一条都取不到**，而且不会报错 ——
    //   表现就是「这个会话只有主人在说话」，F25 的补记会以为整段对话只有提问没有回答。
    const 体 = (e.data && e.data.message) || e.data
    const 段 = Array.isArray(体?.content) ? 体.content : []
    const 文 = 段
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n')
      .trim()
    if (!文) continue
    出.push({
      role: e.type === 'user/message' ? 'user' : 'assistant',
      text: 文,
      time: Number(e.time) || 0,
      seq: Number(e.seq) || 0,
    })
  }
  return 出
}
