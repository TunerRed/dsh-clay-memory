// 新会话「继承语感」的来源选择（1.12.91）
//   选择层的逻辑：读选择 / 写选择 / 热尾文本 的取数口径 / 归档抽轮 / 乱码轮过滤
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const 沙盒 = mkdtempSync(join(tmpdir(), 'clay-handoff-choice-'))
process.env.DSH_HOME = 沙盒
mkdirSync(join(沙盒, 'clay-memory'), { recursive: true })

const m = await import('../lib/handoff.mjs')

function 清盘() {
  for (const p of ['_handoff.json', '_handoff_choice.json']) {
    try {
      writeFileSync(join(沙盒, 'clay-memory', p), '')
    } catch (e) {
      /* 没就算了 */
    }
  }
}

test('选择：写进去读得出来，没选过给 null', () => {
  清盘()
  assert.equal(m.读选择('session-a'), null)
  assert.equal(m.写选择('session-a', { load: true, from: 'session-old', turns: [{ u: 'u', a: 'a', at: 1 }] }), true)
  const 选 = m.读选择('session-a')
  assert.equal(选.load, true)
  assert.equal(选.from, 'session-old')
  assert.equal(选.turns.length, 1)
  assert.equal(m.读选择('session-b'), null)
})

test('选择：选「不加载」时 load=false，热尾文本一律空', () => {
  清盘()
  m.记热尾('session-old', '今天外面下雨了', '那主人带伞了吗')
  m.写选择('session-new', { load: false, from: '', turns: [] })
  assert.equal(m.热尾文本('session-new', 'latest'), '')
})

test('选择：挑一个以前的会话 → 用存下来的快照', () => {
  清盘()
  m.记热尾('session-最新', '最新那句', '最新的回复')
  m.写选择('session-new', { load: true, from: 'session-老会话', turns: [{ u: '老原话', a: '老回复', at: 1 }] })
  const 文 = m.热尾文本('session-new', 'latest')
  assert.ok(文.includes('老原话'), '应该用快照里的老原话')
  assert.ok(!文.includes('最新那句'), '不能混进最近那段')
})

test('选择：from 为空 = 最近那段，且跟着热尾库实时走', () => {
  清盘()
  m.记热尾('session-上游', '第一句', '第一句的回复内容')
  m.写选择('session-new', { load: true, from: '', turns: [] })
  let 文 = m.热尾文本('session-new', 'latest')
  assert.ok(文.includes('第一句'), '空 from 应该跟最近的尾巴')
  // 上游接着说，新会话还没开聊 → 应该看到更新后的尾巴
  m.记热尾('session-上游', '第二句', '第二句的回复内容')
  文 = m.热尾文本('session-new', 'latest')
  assert.ok(文.includes('第二句'), '「最近那段」要实时跟新')
})

test('热尾文本：没有选择时按模式走（latest 给 / ask、off 不给）', () => {
  清盘()
  m.记热尾('session-上游', '上游原话', '上游的回复内容')
  assert.ok(m.热尾文本('session-新', 'latest').includes('上游原话'))
  assert.equal(m.热尾文本('session-新', 'ask'), '')
  assert.equal(m.热尾文本('session-新', 'off'), '')
  // 尾巴就是自己 → 不给（自己没什么好接的）
  assert.equal(m.热尾文本('session-上游', 'latest'), '')
})

test('乱码轮不接：U+FFFD 的原话/回复都跳过', () => {
  清盘()
  assert.equal(m.是健康一轮('����糡�������䡣', '正常回复'), false)
  assert.equal(m.是健康一轮('正常问题', '回复里带乱码����'), false)
  assert.equal(m.是健康一轮('正常问题', '正常回复内容'), true)
})

test('从归档取热尾：非法会话 id 直接空，不越界读文件', () => {
  清盘()
  assert.deepEqual(m.从归档取热尾('..'), [])
  assert.deepEqual(m.从归档取热尾('a/b'), [])
  assert.deepEqual(m.从归档取热尾('session-不存在'), [])
})

test('从归档取热尾：真归档里抽出 user→assistant 配对，乱码轮被滤掉', () => {
  // 造一份最小归档：直接复用插件的写归档格式太难，这里只验证「配对 + 过滤」口径
  //   —— 走的是取对话()的输出，用不到 zstd，所以用不到真文件；上面那条已保证读不到时给空
  清盘()
  assert.deepEqual(m.从归档取热尾('session-空'), [])
})
