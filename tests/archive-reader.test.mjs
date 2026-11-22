// 1.12.30 会话归档读取器：多帧 zstd
//   要点：① Node 的 zstdDecompressSync 只解第一帧，剩下的必须自己切
//        ② 帧边界可能撞上压缩流内部的假 magic，解不开就往后借一帧
//        ③ 坏帧/坏行只计数，不抛（读不了的文件不该让整批失败）
import { test } from 'node:test'
import assert from 'node:assert'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { 解压归档, 找帧起点, 解析事件, 读会话归档, 取对话, ZSTD魔数 } = await import('../lib/archive-reader.mjs')

const 压 = (s) => zstdCompressSync(Buffer.from(s, 'utf8'))
const 行 = (o) => JSON.stringify(o) + '\n'
const 会话头 = 行({ type: 'session', version: 4, id: 'session-x', createdAt: 1794499232177 })
const 用户 = 行({ type: 'user/message', seq: 8, time: 1794499232348, data: { content: [{ type: 'text', text: '主人喜欢大白饭' }] } })
const 助手 = 行({ type: 'assistant/message', seq: 9, time: 1794499233456, data: { content: [{ type: 'text', text: '记住了' }] } })

test('单帧：能解出来', () => {
  const r = 解压归档(压(会话头))
  assert.equal(r.帧数, 1)
  assert.equal(r.跳过, 0)
  assert.match(r.文本, /"type":"session"/)
})

test('多帧：三帧全解、顺序不乱（这就是 Node 自带 API 会吞掉的那部分）', () => {
  const buf = Buffer.concat([压(会话头), 压(用户), 压(助手)])
  // 前提确认：一次调用只能拿到第一帧 —— 这正是必须自己切的原因
  const 一次 = zstdDecompressSync(buf).toString('utf8')
  assert.ok(一次.length < buf.length, '一次解压拿不到全部，说明确实是多帧')
  const r = 解压归档(buf)
  assert.equal(r.帧数, 3)
  assert.equal(r.跳过, 0)
  assert.ok(r.文本.indexOf('session') < r.文本.indexOf('大白饭'))
  assert.ok(r.文本.indexOf('大白饭') < r.文本.indexOf('记住了'))
})

test('假 magic 干扰：插在两帧之间的假帧头不会让后面的帧丢', () => {
  const 假 = Buffer.concat([ZSTD魔数, Buffer.from([0x00, 0x00, 0x00, 0x00, 0x11, 0x22])])
  const buf = Buffer.concat([压(会话头), 假, 压(用户)])
  const r = 解压归档(buf)
  // 假帧头那个起点会被当成坏起点跳过（跳过 1），但两段真内容一条都不能少
  assert.equal(r.跳过, 1)
  assert.equal(r.帧数, 2)
  assert.match(r.文本, /"type":"session"/)
  assert.match(r.文本, /大白饭/)
})

test('空内容：返回空，不炸', () => {
  const r = 解压归档(Buffer.alloc(0))
  assert.equal(r.文本, '')
  assert.equal(r.帧数, 0)
  assert.equal(r.跳过, 0)
})

test('不是 zstd：按纯文本返回（调用方自己决定要不要信）', () => {
  const r = 解压归档(Buffer.from(会话头, 'utf8'))
  assert.equal(r.帧数, 0)
  assert.equal(r.文本, 会话头)
})

test('坏帧只计数，不影响好帧', () => {
  const 坏 = Buffer.concat([ZSTD魔数, Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])])
  const buf = Buffer.concat([压(会话头), 坏])
  const r = 解压归档(buf)
  assert.equal(r.帧数, 1)
  assert.equal(r.跳过, 1)
  assert.match(r.文本, /session/)
})

test('解析事件：空行忽略，坏行计数不抛', () => {
  const { 事件, 坏行 } = 解析事件('{"a":1}\n\n不是 json\n{"b":2}\n')
  assert.equal(事件.length, 2)
  assert.equal(坏行, 1)
})

test('读会话归档：头、事件、帧数都对', () => {
  const 目录 = mkdtempSync(join(tmpdir(), 'clay-arch-'))
  const 文件 = join(目录, 'session.v4.jsonl.zstd')
  writeFileSync(文件, Buffer.concat([压(会话头), 压(用户), 压(助手)]))
  const r = 读会话归档(文件)
  assert.equal(r.头.id, 'session-x')
  assert.equal(r.帧数, 3)
  assert.equal(r.事件.length, 3)
  assert.equal(r.坏行, 0)
})

test('取对话：只留人和助手说的话，工具消息不要', () => {
  const 工具 = 行({ type: 'tool/call', seq: 10, data: { name: 'read' } })
  const 系统 = 行({ type: 'system/message', seq: 11, data: { content: [{ type: 'text', text: '你是助手' }] } })
  const { 事件 } = 解析事件(会话头 + 用户 + 工具 + 助手 + 系统)
  const 对话 = 取对话(事件)
  assert.deepEqual(对话.map((x) => x.role), ['user', 'assistant'])
  assert.equal(对话[0].text, '主人喜欢大白饭')
  assert.equal(对话[1].text, '记住了')
})

test('找帧起点：第一个不在 0 时不硬当 zstd', () => {
  const 起点 = 找帧起点(Buffer.from(会话头, 'utf8'))
  assert.deepEqual(起点, [])
})
