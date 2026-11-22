// 陈旧路径检测的纯函数测试。
// 判活用注入的假 查，不碰真实文件系统。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  剥网址,
  抠路径,
  规整路径,
  聚合键,
  判定路径,
  历史上下文,
  扫一遍,
  合并清单,
  该查了,
} from '../lib/stale.mjs'

test('剥网址：把 URL 剁掉，别被当成路径', () => {
  const s = 剥网址('服务在 http://127.0.0.1:8931/api 上，台账在 G:\\DSH_HOME\\x')
  assert.equal(s.includes('127.0.0.1'), false)
  assert.equal(s.includes('G:\\DSH_HOME\\x'), true)
})

test('抠路径：基本提取 + 记录后一个字符', () => {
  const 出 = 抠路径('配置在 G:\\DSH_HOME\\clay-memory-config.json 里')
  assert.equal(出.length, 1)
  assert.equal(出[0].字面, 'G:\\DSH_HOME\\clay-memory-config.json')
  assert.equal(出[0].后, ' ')
})

test('抠路径：带空格的路径要整段吃下去（E:\\program files\\...）', () => {
  const 出 = 抠路径('装在 E:\\program files\\ComfyUI\\ComfyUI\\models 下面')
  assert.equal(出.length, 1)
  assert.equal(出[0].字面, 'E:\\program files\\ComfyUI\\ComfyUI\\models')
})

test('抠路径：路径后面紧跟中文就停，不把中文吞进来', () => {
  const 出 = 抠路径('路径是 G:\\DSH_HOME\\logs 里面装的是日志')
  assert.equal(出[0].字面, 'G:\\DSH_HOME\\logs')
})

test('规整路径：JSON 双反斜杠折成一层的', () => {
  const r = 规整路径('G:\\\\DSH_HOME\\\\clay-memory')
  assert.equal(r.判, '检查')
  assert.equal(r.规整, 'G:/DSH_HOME/clay-memory')
})

test('规整路径：首尾标点剥掉', () => {
  const r = 规整路径('（G:\\DSH_HOME\\clay-memory）。')
  assert.equal(r.判, '检查')
  assert.equal(r.规整, 'G:/DSH_HOME/clay-memory')
})

test('规整路径：全角冒号也剥掉', () => {
  const r = 规整路径('G:\\DSH_HOME\\clay-memory：')
  assert.equal(r.判, '检查')
  assert.equal(r.规整, 'G:/DSH_HOME/clay-memory')
})

test('规整路径：末段只有一个字符 → 判不了（像占位，保守跳过）', () => {
  const r = 规整路径('G:\\DSH_HOME\\x')
  assert.equal(r.判, '判不了')
})

test('规整路径：末尾省略号 → 跳过（原文被截断，宁可不判）', () => {
  assert.equal(规整路径('G:\\DSH_HOME\\a...').判, '跳过')
  assert.equal(规整路径('G:\\DSH_HOME\\a…').判, '跳过')
})

test('规整路径：通配符 / 环境变量 → 判不了', () => {
  assert.equal(规整路径('G:\\DSH_HOME\\*.json').判, '判不了')
  assert.equal(规整路径('C:\\%APPDATA%\\x').判, '判不了')
  assert.equal(规整路径('G:\\${HOME}\\x').判, '判不了')
})

test('规整路径：占位符段 → 判不了', () => {
  assert.equal(规整路径('G:\\DSH_HOME\\data\\sessions\\--G-DSH_WORKSPACE-XXX--\\').判, '判不了')
  assert.equal(规整路径('G:\\DSH_HOME\\<会话id>\\x').判, '判不了')
})

test('规整路径：末段只有一个字符 → 判不了（像占位）', () => {
  assert.equal(规整路径('G:\\DSH_WORKSPACE\\x').判, '判不了')
})

test('规整路径：末段以连字符结尾 → 判不了（写到一半断了）', () => {
  assert.equal(规整路径('C:\\Users\\a\\logs\\crash-').判, '判不了')
})

test('规整路径：后面紧跟中文 → 判不了（怕是中文目录名被截断）', () => {
  assert.equal(规整路径('G:\\DSH_HOME\\--G-DSH_WORKSPACE-', '需').判, '判不了')
})

test('规整路径：MSYS 写法 /g/AI 转成 G:/AI', () => {
  const r = 规整路径('/g/AI/ComfyUI')
  assert.equal(r.判, '检查')
  assert.equal(r.规整, 'G:/AI/ComfyUI')
})

test('规整路径：不是盘符路径 → 跳过', () => {
  assert.equal(规整路径('/usr/local/bin').判, '跳过')
  assert.equal(规整路径('foo/bar').判, '跳过')
})

test('聚合键：大小写 / 反斜杠 / 尾斜杠 归一', () => {
  assert.equal(聚合键('G:\\DSH_HOME\\X\\'), 'g:/dsh_home/x')
  assert.equal(聚合键('g:/dsh_home/x'), 'g:/dsh_home/x')
})

test('判定路径：盘符根不在 → 判不了（不误报成失效）', () => {
  const 查 = () => false
  assert.equal(判定路径('Z:/foo/bar', 查).判定, '判不了')
  assert.equal(判定路径('Z:/foo/bar', 查).原因, '盘符根不在（可能是移动硬盘没插）')
})

test('判定路径：盘根在、路径不在 → 失效', () => {
  const 查 = (p) => p === 'G:/'
  assert.equal(判定路径('G:/foo/bar', 查).判定, '失效')
})

test('判定路径：盘根在、路径也在 → 有效', () => {
  const 查 = () => true
  assert.equal(判定路径('G:/foo/bar', 查).判定, '有效')
})

test('判定路径：查的时候抛错 → 判不了，不炸', () => {
  const 查 = () => {
    throw new Error('权限不足')
  }
  const r = 判定路径('G:/foo', 查)
  assert.equal(r.判定, '判不了')
  assert.match(r.原因, /权限不足/)
})

test('历史上下文：前后 15 字里带「搬到」→ 疑似历史', () => {
  const 正文 = '原来在 E:\\old\\path 后来搬到 G 盘了'
  const 起 = 正文.indexOf('E:\\')
  const r = 历史上下文(正文, 起, 起 + 'E:\\old\\path'.length)
  assert.equal(r.疑似历史, true)
})

test('历史上下文：普通叙述 → 不算历史', () => {
  const 正文 = '配置文件在 G:\\DSH_HOME\\config.json'
  const 起 = 正文.indexOf('G:\\')
  const r = 历史上下文(正文, 起, 起 + 'G:\\DSH_HOME\\config.json'.length)
  assert.equal(r.疑似历史, false)
})

test('扫一遍：只认活跃记忆，跳过已被取代的', () => {
  const 查 = () => true
  const { 统计 } = 扫一遍(
    [
      { id: 'a', text: '路径 G:\\DSH_HOME\\x' },
      { id: 'b', text: '路径 G:\\DSH_HOME\\y', 已被取代: { 被谁: 'x' } },
      { id: 'c', text: '路径 G:\\DSH_HOME\\z', refinedSkip: true },
    ],
    查,
  )
  assert.equal(统计.记忆数, 1)
})

test('扫一遍：同一条里既有失效又有有效 → 标「伴随有效路径」', () => {
  const 查 = (p) => p !== 'G:/gone/bin'
  const { 记录 } = 扫一遍(
    [{ id: 'a', text: '旧的 G:\\gone\\bin 现在换到 G:\\here\\keep' }],
    查,
  )
  const 键 = 'g:/gone/bin'
  assert.equal(!!记录[键], true)
  assert.equal(记录[键].伴随有效路径, true)
  assert.deepEqual(
    记录[键].命中记忆.map((x) => x.id),
    ['a'],
  )
})

test('扫一遍：同一条记忆里的同一个路径只记一次', () => {
  const 查 = () => false
  const { 记录 } = 扫一遍(
    [{ id: 'a', text: 'G:\\gone\\bin 和 G:\\gone\\bin 两次' }],
    查,
  )
  // 盘根也得「在」，否则判不了；这里盘根 G:/ 也不在 → 没有记录
  assert.equal(Object.keys(记录).length, 0)
  const 查2 = (p) => p === 'G:/'
  const r2 = 扫一遍([{ id: 'a', text: 'G:\\gone\\bin 和 G:\\gone\\bin 两次' }], 查2)
  assert.equal(r2.记录['g:/gone/bin'].命中记忆.length, 1)
})

test('合并清单：老 pending 保住首次发现，刷新最后确认', () => {
  const 旧 = {
    v: 1,
    记录: { 'g:/a': { 字面: 'G:/A', 首次发现: '2026-01-01T00:00:00.000Z', 状态: 'pending', ignoredIds: [] } },
  }
  const 新 = { 记录: { 'g:/a': { 字面: 'G:/A', 命中记忆: [{ id: 'm1' }] } } }
  const r = 合并清单(旧, 新.记录, new Date('2026-02-02T00:00:00.000Z'))
  assert.equal(r.记录['g:/a'].首次发现, '2026-01-01T00:00:00.000Z')
  assert.equal(r.记录['g:/a'].最后确认, '2026-02-02T00:00:00.000Z')
  assert.equal(r.记录['g:/a'].状态, 'pending')
})

test('合并清单：ignored 覆盖了全部命中就保持 ignored', () => {
  const 旧 = {
    v: 1,
    记录: { 'g:/a': { 字面: 'G:/A', 状态: 'ignored', ignoredIds: ['m1', 'm2'] } },
  }
  const 新 = { 'g:/a': { 字面: 'G:/A', 命中记忆: [{ id: 'm1' }] } }
  const r = 合并清单(旧, 新, new Date('2026-02-02T00:00:00.000Z'))
  assert.equal(r.记录['g:/a'].状态, 'ignored')
})

test('合并清单：出现新的 memoryId → 拉回 pending（防以后新写的错记忆被永久静默）', () => {
  const 旧 = {
    v: 1,
    记录: { 'g:/a': { 字面: 'G:/A', 状态: 'ignored', ignoredIds: ['m1'] } },
  }
  const 新 = { 'g:/a': { 字面: 'G:/A', 命中记忆: [{ id: 'm1' }, { id: 'm9' }] } }
  const r = 合并清单(旧, 新, new Date('2026-02-02T00:00:00.000Z'))
  assert.equal(r.记录['g:/a'].状态, 'pending')
})

test('合并清单：路径复活 → 老 pending 变成 recovered', () => {
  const 旧 = { v: 1, 记录: { 'g:/a': { 字面: 'G:/A', 状态: 'pending', 最后确认: '2026-02-01T00:00:00.000Z' } } }
  const r = 合并清单(旧, {}, new Date('2026-02-02T00:00:00.000Z'))
  assert.equal(r.记录['g:/a'].状态, 'recovered')
  assert.equal(r.记录['g:/a'].判定, '有效')
})

test('该查了：没记录过 → 该查；刚查过 → 不查；隔了 25 小时 → 该查', () => {
  assert.equal(该查了({}, 24), true)
  assert.equal(该查了({ _上次陈旧检查: Date.now() - 1000 }, 24), false)
  assert.equal(该查了({ _上次陈旧检查: Date.now() - 25 * 3600 * 1000 }, 24), true)
})

test('判定路径：中文粘在路径后 → 按前半段算有效（2026-11-22 真机假阳性）', () => {
  const 查 = (p) => p === 'G:/' || p === 'G:/dev/repo'
  assert.equal(判定路径('G:/dev/repo下面', 查).判定, '有效')
  // 中文目录名本身存在时不能被砍坏（工作区路径就带中文）
  assert.equal(
    判定路径('G:/DSH_WORKSPACE/需求开发', (p) => p === 'G:/' || p === 'G:/DSH_WORKSPACE/需求开发').判定,
    '有效',
  )
  // 真失效的照旧失效
  assert.equal(判定路径('G:/nope/xx', 查).判定, '失效')
})

// —— 1.12.77：Gemini 审查第 1 / 6 条的回归测试 ——

test('合并清单：confirmed 不会翻回 pending，已撤销 / 已处置 / 处置于 原样保留', () => {
  const 旧 = {
    v: 1,
    记录: {
      'g:/a': {
        字面: 'G:/A',
        状态: 'confirmed',
        已撤销: [{ 键: 'g:/a', 为什么: '误报' }],
        已处置: ['m1'],
        处置于: '2026-02-01T00:00:00.000Z',
        首次发现: '2026-01-01T00:00:00.000Z',
      },
    },
  }
  const 新 = { 'g:/a': { 字面: 'G:/A', 命中记忆: [{ id: 'm1' }] } }
  const r = 合并清单(旧, 新, new Date('2026-02-02T00:00:00.000Z'))
  const 条 = r.记录['g:/a']
  assert.equal(条.状态, 'confirmed')
  assert.deepEqual(条.已处置, ['m1'])
  assert.equal(条.处置于, '2026-02-01T00:00:00.000Z')
  assert.equal(条.已撤销.length, 1)
})

test('合并清单：confirmed 且这次扫不到 → 记录留着（旧 bug 是整条消失）', () => {
  const 旧 = { v: 1, 记录: { 'g:/nope/xx': { 字面: 'G:/nope/xx', 状态: 'confirmed', 已处置: ['m1'] } } }
  const r = 合并清单(旧, {}, new Date('2026-02-02T00:00:00.000Z'))
  assert.ok(r.记录['g:/nope/xx'], '处置过的记录不能被下一次扫描丢掉')
  assert.equal(r.记录['g:/nope/xx'].状态, 'confirmed')
  assert.deepEqual(r.记录['g:/nope/xx'].已处置, ['m1'])
})

test('合并清单：confirmed 的路径真复活 → recovered', () => {
  const 假盘 = (p) => p === 'G:/' || p === 'G:/复活测试'
  const 旧 = { v: 1, 记录: { 'g:/复活测试': { 字面: 'G:/复活测试', 状态: 'confirmed', 已处置: ['m1'] } } }
  const r = 合并清单(旧, {}, new Date('2026-02-02T00:00:00.000Z'), 假盘)
  assert.equal(r.记录['g:/复活测试'].状态, 'recovered')
  assert.equal(r.记录['g:/复活测试'].判定, '有效')
})

test('合并清单：confirmed 路径出现新写入的未处置记忆 → 拉回 pending', () => {
  const 旧 = { v: 1, 记录: { 'g:/a': { 字面: 'G:/A', 状态: 'confirmed', 已处置: ['m1'] } } }
  const 新 = { 'g:/a': { 字面: 'G:/A', 命中记忆: [{ id: 'm1' }, { id: 'm9' }] } }
  const r = 合并清单(旧, 新, new Date('2026-02-02T00:00:00.000Z'))
  assert.equal(r.记录['g:/a'].状态, 'pending')
})

test('规整路径：折叠 .. / .，同一物理路径不再出两个聚合键', () => {
  const a = 规整路径('G:\\工作\\资料\\..\\报告\\正文.txt')
  const b = 规整路径('G:\\工作\\报告\\正文.txt')
  assert.equal(a.判, '检查')
  assert.equal(a.规整, b.规整)
  assert.equal(a.规整, 'G:/工作/报告/正文.txt')
  assert.equal(聚合键(a.规整), 聚合键(b.规整))
})

test('规整路径：. 段也折掉', () => {
  assert.equal(规整路径('G:\\a\\.\\b.txt').规整, 'G:/a/b.txt')
})
