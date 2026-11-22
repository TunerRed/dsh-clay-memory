// 兼容性自检的纯函数测试（1.12.78）。
// 判据全是「注入进来的事实 + 纯判断」，不碰真实日志和真实库文件。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  服务清单,
  哨兵,
  自检版本,
  判时长,
  说时长,
  解析时刻,
  找最后,
  读日志尾部,
  默认库文件们,
  查服务,
  查哨兵,
  默认备用,
  查水位,
  查文件,
  查落盘,
  汇总,
  跑浅检,
} from '../lib/health.mjs'
import { 浅检, 深度检 } from '../lib/routes-health.mjs'
import { 接造消息 } from '../lib/llm.mjs'

const 小时 = 3600 * 1000

// 造全有的服务表（含可选项）
function 服务全有() {
  const 表 = {}
  for (const s of 服务清单) 表[s.键] = {}
  return 表
}

// 造一行 diag 记录（格式：ISO 时间 + 4 空格 + 正文）
function 行(时刻, 正文) {
  return new Date(时刻).toISOString() + '    ' + 正文
}

test('自检版本是个能比的版本号', () => {
  assert.match(自检版本, /^\d+\.\d+\.\d+$/)
})

test('判时长：阈值内 ok、超出 warn、再超出 fail，负数按 ok 不吓人', () => {
  assert.equal(判时长(0, 24, 72), 'ok')
  assert.equal(判时长(23 * 小时, 24, 72), 'ok')
  assert.equal(判时长(24 * 小时 + 1, 24, 72), 'warn')
  assert.equal(判时长(71 * 小时, 24, 72), 'warn')
  assert.equal(判时长(72 * 小时 + 1, 24, 72), 'fail')
  // 时钟回拨/未来时间：不报错、不吓人
  assert.equal(判时长(-5 * 小时, 24, 72), 'ok')
  // 拿不到时长：不算坏，只提醒
  assert.equal(判时长(NaN, 24, 72), 'warn')
})

test('说时长：刚刚 / 分钟 / 小时 / 天', () => {
  assert.equal(说时长(30 * 1000), '刚刚')
  assert.equal(说时长(5 * 60 * 1000), '5 分钟前')
  assert.equal(说时长(3 * 小时), '3 小时前')
  assert.equal(说时长(50 * 小时), '2 天前')
  assert.equal(说时长(-1000), '刚刚')
})

test('解析时刻：ISO 字符串和毫秒数字都认', () => {
  assert.equal(解析时刻('2026-11-22T05:00:00.000Z'), Date.parse('2026-11-22T05:00:00.000Z'))
  assert.equal(解析时刻(1795000000000), 1795000000000)
  // 数字但太小（像 0）：当「没记过」
  assert.ok(Number.isNaN(解析时刻(0)))
  assert.ok(Number.isNaN(解析时刻(null)))
  assert.ok(Number.isNaN(解析时刻('')))
  assert.ok(Number.isNaN(解析时刻('不是时间')))
})

test('找最后：取时间最晚的那条', () => {
  const 现在 = Date.parse('2026-11-22T10:00:00.000Z')
  const 行们 = [
    行(现在 - 5 * 小时, '注入被调用：query 长度=3'),
    行(现在 - 1 * 小时, '注入被调用：query 长度=9'),
    行(现在 - 3 * 小时, '注入被调用：query 长度=1'),
  ]
  const 中 = 找最后(行们, /注入被调用/)
  assert.ok(中)
  assert.equal(中.时间, 现在 - 1 * 小时)
  assert.match(中.原文, /query 长度=9/)
  assert.equal(找最后(行们, /不存在的词/), null)
})

test('查服务：主干缺一个就是 fail，只缺可选项是 warn', () => {
  assert.equal(查服务(服务全有()).状态, 'ok')

  const 缺llm = 服务全有()
  delete 缺llm.llm
  const r = 查服务(缺llm)
  assert.equal(r.状态, 'fail')
  assert.match(r.说明, /模型/)

  const 缺标题 = 服务全有()
  delete 缺标题.sessionTitle
  assert.equal(查服务(缺标题).状态, 'warn')
})

test('查哨兵：有记录判新鲜度，没记录算 warn 不下死结论', () => {
  const 现在 = Date.parse('2026-11-22T10:00:00.000Z')
  // 全新鲜
  const 新 = [
    行(现在 - 1 * 小时, '注入被调用：query 长度=2'),
    行(现在 - 2 * 小时, '自动整理：合了 1 对'),
    行(现在 - 2 * 小时, '自动 dream：产出 1 条，落库 1 条'),
    行(现在 - 3 * 小时, '陈旧检查：待确认 0 条'),
    行(现在 - 1 * 小时, '经历提取：暂无'),
  ]
  const 全新 = 查哨兵(新, 现在)
  assert.equal(全新.length, 哨兵.length)
  assert.ok(全新.every((x) => x.状态 === 'ok'))

  // 一条都没有：全部 warn（刚装不能判死）
  const 空 = 查哨兵([], 现在)
  assert.ok(空.every((x) => x.状态 === 'warn'))

  // 注入断了三天：那条 fail
  const 断 = [行(现在 - 80 * 小时, '注入被调用：query 长度=2')]
  const 果 = 查哨兵(断, 现在)
  const 注入项 = 果.find((x) => x.名 === '记忆注入')
  assert.equal(注入项.状态, 'fail')
})

test('查水位：cfg 里记过就比时间，没记过只提醒', () => {
  const 现在 = Date.parse('2026-11-22T10:00:00.000Z')
  const 好 = 查水位(
    {
      _上次整理: new Date(现在 - 2 * 小时).toISOString(),
      _上次归纳: 现在 - 3 * 小时,
    },
    现在,
  )
  assert.equal(好.length, 2) // 2026-11-22 瘦身：水位只剩整理 / dream
  assert.ok(好.every((x) => x.状态 === 'ok'))

  const 旧 = 查水位({ _上次整理: new Date(现在 - 200 * 小时).toISOString() }, 现在)
  assert.equal(旧[0].状态, 'fail')
  // 没记过的那条：warn
  assert.equal(旧[1].状态, 'warn')
})

test('查文件：不存在算 skip（还没生成），坏 JSON 算 fail，校验不过算 fail', () => {
  const 不存在 = 查文件('G:/tmp/绝对不该存在的文件-自检测试.json', null)
  assert.equal(不存在.状态, 'skip')

  // 用本文件自己当「坏 JSON」：它不是 json
  const 坏 = 查文件(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), null)
  assert.equal(坏.状态, 'fail')
  assert.match(坏.说明, /读不了|JSON/)
})

test('汇总：任一 fail 就是整体 fail，有 warn 就是 warn', () => {
  assert.equal(汇总([]).结论, 'ok')
  assert.equal(汇总([{ 状态: 'ok' }, { 状态: 'ok' }]).结论, 'ok')
  assert.equal(汇总([{ 状态: 'ok' }, { 状态: 'warn' }]).结论, 'warn')
  assert.equal(汇总([{ 状态: 'warn' }, { 状态: 'fail' }]).结论, 'fail')
  // skip 不影响结论
  assert.equal(汇总([{ 状态: 'ok' }, { 状态: 'skip' }]).结论, 'ok')
  const 数 = 汇总([{ 状态: 'ok' }, { 状态: 'warn' }, { 状态: 'fail' }, { 状态: 'skip' }])
  assert.deepEqual(
    { 结论: 数.结论, ok: 数.ok, warn: 数.warn, fail: 数.fail, skip: 数.skip, 共: 数.共 },
    { 结论: 'fail', ok: 1, warn: 1, fail: 1, skip: 1, 共: 4 },
  )
})

test('跑浅检：全好是 ok，缺主干服务就变 fail', () => {
  const 现在 = Date.parse('2026-11-22T10:00:00.000Z')
  const 行们 = [
    行(现在 - 1 * 小时, '注入被调用：query 长度=2'),
    行(现在 - 2 * 小时, '自动整理：合了 1 对'),
    行(现在 - 2 * 小时, '自动 dream：产出 0 条'),
    行(现在 - 1 * 小时, '经历提取：暂无'),
  ]
  const cfg = {
    _上次整理: new Date(现在 - 2 * 小时).toISOString(),
    _上次归纳: 现在 - 2 * 小时,
  }

  // 落盘样本必须显式给空：不给就会去读本机的真实 trace 目录，测试结果随机器变
  const 好 = 跑浅检({ 服务: 服务全有(), cfg, 行们, 现在, 库文件们: [], 落盘样本: [] })
  assert.equal(好.统计.结论, 'ok')
  assert.equal(好.项们.length, 1 + 哨兵.length + 2 + 1) // 2026-11-22 瘦身：水位从 3 条（整理/dream/陈旧）减到 2 条；同日加落盘水位 1 条

  const 缺 = 服务全有()
  delete 缺.agents
  const 坏 = 跑浅检({ 服务: 缺, cfg, 行们, 现在, 库文件们: [], 落盘样本: [] })
  assert.equal(坏.统计.结论, 'fail')

  // 探针（读库）挂了也算 fail
  const 探针坏 = 跑浅检({ 服务: 服务全有(), cfg, 行们, 现在, 库文件们: [], 落盘样本: [], 探针: () => ({ ok: false, 说明: '读库抛错：x' }) })
  assert.equal(探针坏.统计.结论, 'fail')
})

// 2026-11-22：落盘水位（召回在跑、会话文件却没写进去）
test('查落盘：现在卡着要喊，旧账提一句就够，健康的别吵', () => {
  const 现在 = Date.parse('2026-11-22T10:00:00.000Z')
  const 分钟 = (n) => 现在 - n * 60 * 1000

  // 还没采到样本 → skip，不是故障
  assert.equal(查落盘([], 现在).状态, 'skip')
  assert.equal(查落盘(undefined, 现在).状态, 'skip')

  // 召回和落盘同步（落后几分钟，正常）
  const 健康 = 查落盘([{ 会话: 'session-aaaa1111', 召回在: 分钟(2), 会话在: 分钟(4) }], 现在)
  assert.equal(健康.状态, 'ok')

  // 正在跑、落后 30 分钟 → warn
  const 卡一点 = 查落盘([{ 会话: 'session-bbbb2222', 召回在: 分钟(2), 会话在: 分钟(32) }], 现在)
  assert.equal(卡一点.状态, 'warn')
  assert.match(卡一点.说明, /bbbb2222/)

  // 正在跑、落后 2 小时 → fail
  const 卡死 = 查落盘([{ 会话: 'session-cccc3333', 召回在: 分钟(1), 会话在: 分钟(120) }], 现在)
  assert.equal(卡死.状态, 'fail')

  // 很久没召回了（3 小时前）→ 只当旧账提一句，别让体检页永远亮红
  const 旧账 = 查落盘([{ 会话: 'session-dddd4444', 召回在: 分钟(180), 会话在: 分钟(270) }], 现在)
  assert.equal(旧账.状态, 'warn')
  assert.match(旧账.说明, /那会儿卡过/)

  // 超过 24 小时的旧账不再提
  const 陈年 = 查落盘([{ 会话: 'session-eeee5555', 召回在: 分钟(30 * 60), 会话在: 分钟(32 * 60) }], 现在)
  assert.equal(陈年.状态, 'ok')

  // 会话归档读不到（这版宿主没写）→ 丢掉这一条，别报错
  const 没归档 = 查落盘([{ 会话: 'session-ffff6666', 召回在: 分钟(1), 会话在: NaN }], 现在)
  assert.equal(没归档.状态, 'skip')
})

test('查哨兵：日志被轮转掉了就退到水位兜底，不报假警告', () => {
  const 现在 = Date.parse('2026-11-22T06:00:00.000Z')
  const 时间 = (分钟) => 现在 - 分钟 * 60 * 1000
  const 项们 = 查哨兵([], 现在, {
    整理: 时间(13 * 60),
    dream: 时间(15 * 60),
    经历: 时间(29),
  })
  const 名 = (片段) => 项们.find((x) => x.名.includes(片段))

  for (const 片段 of ['自动整理', '自动 dream', '经历提取']) {
    assert.equal(名(片段).状态, 'ok', 片段 + ' 该按水位判 ok')
    assert.match(名(片段).说明, /水位/, 片段 + ' 的说明要讲清是按水位判的')
  }
})

test('查哨兵：日志没有、水位也没有，才算「真找不到」', () => {
  const 现在 = Date.parse('2026-11-22T06:00:00.000Z')
  const 项们 = 查哨兵([], 现在, {})
  for (const x of 项们) {
    assert.equal(x.状态, 'warn', x.名 + ' 应该是 warn（没证据不下死结论）')
  }
})

test('默认备用：cfg 三个水位 + 经历里最晚的那次提取', () => {
  const 现在 = Date.parse('2026-11-22T06:00:00.000Z')
  const 出 = 默认备用(
    { _上次整理: '2026-11-21T17:00:00.000Z', _上次归纳: 现在 - 3600 * 1000, _上次陈旧检查: 0 },
    {
      'session-a': { 上次提取: 现在 - 2 * 3600 * 1000 },
      'session-b': { 上次提取: 现在 - 30 * 60 * 1000 },
    },
  )
  assert.equal(出.dream, 现在 - 3600 * 1000)
  assert.equal(出.经历, 现在 - 30 * 60 * 1000)
})

test('默认备用：经历文件读不到时不出「经历」这一项', () => {
  const 出 = 默认备用({ _上次整理: 1 }, null)
  assert.equal('经历' in 出, false)
})

test('读日志尾部：超过 1.5MB 的全中文日志也能精确切出末尾，不会因字节/字符混用返回空', () => {
  const 临 = mkdtempSync(join(tmpdir(), 'fish-health-log-'))
  try {
    const f = join(临, 'diag.log')
    // 1.5MB+ 的全中文行：UTF-8 字节数 > 1.5MB，但 UTF-16 字符数 < 60 万
    const 废行 = '2026-11-22T01:00:00.000Z    ' + '中文诊断日志测试内容'.repeat(25) + '\n'
    const 重复 = Math.ceil((1.6 * 1024 * 1024) / Buffer.byteLength(废行, 'utf8'))
    const 尾行 = '2026-11-22T10:00:00.000Z    注入被调用：尾行校验命中'
    writeFileSync(f, 废行.repeat(重复) + 尾行 + '\n', 'utf8')

    const 读到 = 读日志尾部(f, 10)
    assert.ok(读到.length >= 1, '不能切出空数组')
    assert.equal(读到[读到.length - 1], 尾行)
  } finally {
    rmSync(临, { recursive: true, force: true })
  }
})

test('默认库文件们：1.12.79 瘦身后默认不查 _stale.json，显式传含陈旧才查', () => {
  const 默认们 = 默认库文件们()
  assert.equal(默认们.some((x) => x.路径.endsWith('_stale.json')), false)
  const 开陈旧 = 默认库文件们({ 含陈旧: true })
  assert.equal(开陈旧.some((x) => x.路径.endsWith('_stale.json')), true)
})

test('浅检与深度检：带 上次检查；ctx.agents 失效退回 环.代理服务；模型报错不伪装成空正文', async () => {
  const 浅 = 浅检({
    自检: () => ({ ok: true, 项们: [], 统计: { 结论: 'ok', ok: 0, warn: 0, fail: 0, skip: 0, 共: 0 } }),
  })
  assert.match(浅.上次检查, /^\d{4}-\d{2}-\d{2}T/)

  接造消息((x) => x)
  const 假agent = { session: { requestHeader: () => ({ config: { provider: 'p1', model: 'm1' } }) } }
  const 死ctx = {
    get agents() {
      throw new Error('cannot get required service "agents" in inactive context')
    },
    llm: {
      async *stream() {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: '额度不足' } } }
      },
    },
  }
  const 深 = await 深度检({
    ctx: 死ctx,
    代理服务: { list: () => [假agent] },
    自检: () => ({ ok: true, 项们: [], 统计: { 结论: 'ok', ok: 0, warn: 0, fail: 0, skip: 0, 共: 0 } }),
  })
  assert.match(深.上次检查, /^\d{4}-\d{2}-\d{2}T/)
  const 模型项 = 深.项们.find((x) => x.名.includes('深度检查'))
  assert.equal(模型项.状态, 'fail')
  assert.match(模型项.说明, /额度不足/)
  assert.equal(模型项.细节, '用 p1/m1')
})
