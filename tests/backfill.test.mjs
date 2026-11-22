// F25 历史会话补记单元测试：协议字段统一（事实键/已被取代）、不生成 null.json、路径校验、单会话速查
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

const home = mkdtempSync(join(tmpdir(), 'clay-backfill-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'empty-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')

const { 解析补记候选, 判新旧, 造补记条目, 试提取, 应用, 撤销, 列批次, 读全局事实 } = await import('../lib/backfill.mjs')
const { 注册补记路由, 校验会话文件路径 } = await import('../lib/routes-backfill.mjs')

const storeDir = join(home, 'clay-memory')
const storagesDir = join(home, 'data', 'storages')
const sessionsRoot = join(home, 'data', 'sessions')
mkdirSync(storeDir, { recursive: true })
mkdirSync(storagesDir, { recursive: true })
mkdirSync(sessionsRoot, { recursive: true })

function 写测试会话(ws, sid, 条数 = 10) {
  const dir = join(sessionsRoot, ws, sid)
  mkdirSync(dir, { recursive: true })
  const 行 = [JSON.stringify({ type: 'session', version: 4, id: sid, createdAt: Date.now() })]
  for (let i = 1; i <= 条数; i++) {
    行.push(JSON.stringify({
      type: 'user/message',
      seq: i * 2 - 1,
      time: Date.now(),
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: `第${i}句：我以后绝对不吃香菜，而且喜欢喝冰美式，这是我们的固定习惯。` }] },
    }))
    行.push(JSON.stringify({
      type: 'assistant/message',
      seq: i * 2,
      time: Date.now(),
      data: { message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: `收到第${i}句，记住主人不吃香菜、喜欢喝冰美式了。` }] } },
    }))
  }
  const 文件 = join(dir, 'session.v4.jsonl.zstd')
  // 垫到 >= 8000 字节以过体检阈值
  while (Buffer.byteLength(行.join('\n'), 'utf8') < 16000) {
    行.push(JSON.stringify({ type: 'tool/result', seq: 999, time: Date.now(), data: { pad: 'x'.repeat(1000) } }))
  }
  const compressed = zstdCompressSync(Buffer.from(行.join('\n') + '\n', 'utf8'))
  // 若 zstd 压太小，写多帧确保 >= 8000 字节
  const frames = [compressed]
  while (Buffer.concat(frames).length < 8500) {
    frames.push(zstdCompressSync(Buffer.from(JSON.stringify({ type: 'tool/result', seq: 1000, data: { pad: 'z'.repeat(12000) } }) + '\n', 'utf8')))
  }
  writeFileSync(文件, Buffer.concat(frames))
  return 文件
}

test('解析补记候选：解析 JSON、保留事实键/词/类型/重要度，过滤非法键和万能键', () => {
  const raw = '```json\n' + JSON.stringify([
    { text: '主人完全不吃香菜，点外卖和做菜都必须避开。', 类型: 'preference', 事实键: '主人.忌口', 词: ['香菜', '忌口', '外卖'], 重要度: 1 },
    { text: '主人身高172厘米。', 类型: 'identity', 事实键: '她.身高172', 词: ['身高'], 重要度: 0.5 },
    { text: '无关紧要的一条测试万能键', 类型: 'misc', 事实键: '系统.内容', 词: [], 重要度: 0.5 },
    { text: '跳过', 类型: 'misc', 事实键: null, 词: [], 重要度: 0.5 },
  ]) + '\n```'
  const out = 解析补记候选(raw)
  assert.equal(out.length, 3)
  assert.equal(out[0].事实键, '主人.忌口')
  assert.equal(out[0].类型, 'preference')
  assert.deepEqual(out[0].词, ['香菜', '忌口', '外卖'])
  assert.equal(out[0].重要度, 1)
  assert.equal(out[1].事实键, null, '带数字的事实键必须被过滤掉')
  assert.equal(out[2].事实键, null, '万能键必须被过滤掉')
})

test('判新旧：按中文字段 事实键 判定 update，且忽略 已被取代 的旧记忆', () => {
  const 现有 = [
    { id: 'old-dead', text: '主人很早就吃辣', 事实键: '主人.口味', 已被取代: { 被谁: '用户', 为什么: '旧了' }, createdAt: '2026-10-01T00:00:00Z' },
    { id: 'old-live', text: '主人平时只喝热美式', 事实键: '主人.咖啡偏好', createdAt: '2026-11-01T00:00:00Z' },
  ]
  const p1 = 判新旧({ text: '主人现在改喝冰美式了，不加糖', 事实键: '主人.咖啡偏好' }, 现有)
  assert.equal(p1.动作, 'update')
  assert.equal(p1.撞上.id, 'old-live')

  const p2 = 判新旧({ text: '主人平时完全不吃任何辣味食物', 事实键: '主人.口味' }, 现有)
  assert.equal(p2.动作, 'add', '已被取代的同键旧条目不该再被当作现存目标触发 update')
})

test('试提取 → 应用 → 列批次 → 撤销：写 _facts.json、使用 已被取代/事实键、绝不生成 null.json', async () => {
  const 旧盘 = {
    version: 2,
    purgeEpoch: 'seed-facts',
    memories: [
      { id: 'f1', text: '主人平时只喝热美式咖啡', category: 'stable_profile', scope: 'global', 事实键: '主人.咖啡', createdAt: '2026-10-01T00:00:00Z' },
      { id: 'imp1', text: '旧档案导入的一条记忆', category: 'stable_profile', scope: 'global', importBatch: 'b12345', createdAt: '2026-10-02T00:00:00Z' },
    ],
    deleted: [],
    traces: [],
  }
  writeFileSync(join(storeDir, '_facts.json'), JSON.stringify(旧盘, null, 2))
  const 文件 = 写测试会话('ws-a', 'session-bf-1', 8)

  const pre = await 试提取(null, null, 'session-bf-1', 文件, {
    提取器: async () => ({
      ok: true,
      候选: [
        { text: '主人现在改喝加浓冰美式了，不加糖', 类型: 'preference', 事实键: '主人.咖啡', 词: ['冰美式', '咖啡'], 重要度: 0.8, 日期: null },
        { text: '主人完全不能吃香菜', 类型: 'preference', 事实键: '主人.忌口', 词: ['香菜', '忌口'], 重要度: 1, 日期: null },
      ],
    }),
  })
  assert.equal(pre.ok, true)
  assert.equal(pre.计.update, 1)
  assert.equal(pre.计.add, 1)
  assert.equal(pre.候选[0].撞上.id, 'f1')

  const appRes = 应用('', pre.候选, { 会话: 'session-bf-1', 批次: 'bfbtest1' })
  assert.equal(appRes.ok, true)
  assert.equal(appRes.加了, 2)
  assert.equal(appRes.取代, 1)
  assert.equal(existsSync(join(storeDir, 'null.json')), false, '绝不允许生成 null.json')

  const 写后 = JSON.parse(readFileSync(join(storeDir, '_facts.json'), 'utf8'))
  const f1 = 写后.memories.find((m) => m.id === 'f1')
  assert.ok(f1.已被取代 && f1.已被取代.被谁 === '历史补记:bfbtest1', '旧条目必须写中文 已被取代')
  assert.equal(f1.supersededBy, undefined)

  const 新增条 = 写后.memories.find((m) => m.importBatch === 'bfbtest1' && m.事实键 === '主人.忌口')
  assert.ok(新增条, '新条目必须写中文 事实键')
  assert.equal(新增条.factKey, undefined)
  assert.deepEqual(新增条.related, ['香菜', '忌口'])
  assert.equal(新增条.type, 'preference')

  const 批次们 = 列批次('')
  assert.equal(批次们.length, 1, '列批次只能列出 bfb 前缀补记批次，不能混入 b12345')
  assert.equal(批次们[0].批次, 'bfbtest1')

  const undoRes = 撤销('', 'bfbtest1')
  assert.equal(undoRes.ok, true)
  assert.equal(undoRes.删了, 2)
  assert.equal(undoRes.恢复了, 1)
  assert.equal(existsSync(join(storeDir, 'null.json')), false, '撤销后也绝不允许生成 null.json')

  const 撤后 = JSON.parse(readFileSync(join(storeDir, '_facts.json'), 'utf8'))
  assert.notEqual(撤后.purgeEpoch, 'seed-facts', '撤销后必须轮换全局库代际')
  const f1撤 = 撤后.memories.find((m) => m.id === 'f1')
  assert.equal(f1撤.已被取代, undefined, '旧条目的 已被取代 必须被清除恢复')
  assert.ok(Array.isArray(f1撤.撤销记录) && f1撤.撤销记录.length === 1)
})

test('routes-backfill：校验归档路径越界、单会话 ?当前= 不扫全盘', async () => {
  const 坏文件 = join(home, 'secret.txt')
  writeFileSync(坏文件, 'secret')
  assert.equal(校验会话文件路径(坏文件, sessionsRoot, 'session-bf-1'), '')
  assert.equal(校验会话文件路径(join(sessionsRoot, 'ws-a', 'session-bf-1', '..', '..', 'clay-memory', '_facts.json'), sessionsRoot, 'session-bf-1'), '')

  const routes = new Map()
  注册补记路由(
    (p, fn) => routes.set(p, fn),
    { 读JSON体: async (req) => req.body || {} },
  )

  const 调用 = async (path, req = {}) => {
    let status = 0
    let body = ''
    await routes.get(path)(req, {
      writeHead: (c) => { status = c },
      end: (s) => { body = s },
    })
    return { status, json: JSON.parse(body) }
  }

  // 单会话诊断
  const sRes = await 调用('/dsh-clay-memory/backfill/sessions', { url: '/dsh-clay-memory/backfill/sessions?当前=session-bf-1' })
  assert.equal(sRes.json.ok, true)
  assert.equal(sRes.json.当前诊断.够, true)
  assert.equal(sRes.json.会话们.length, 1)

  // 预览拦截越界路径
  const pRes = await 调用('/dsh-clay-memory/backfill/preview', {
    body: { 会话: 'session-bf-1', 文件: 坏文件 },
  })
  assert.equal(pRes.json.ok, false)
  assert.match(pRes.json.error, /允许/)
})

test.after(() => {
  try { rmSync(home, { recursive: true, force: true }) } catch {}
})
