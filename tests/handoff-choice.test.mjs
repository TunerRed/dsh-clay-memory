// 新会话「继承语感」的来源选择（1.12.91）
//   选择层的逻辑：读选择 / 写选择 / 热尾文本 的取数口径 / 归档抽轮 / 乱码轮过滤
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

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
  m.写选择('session-new', { load: true, from: 'session-老会话', turns: [{ u: '老原话', a: '老回复内容', at: 1 }] })
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

// 2026-11-23 主实例暴露：选「挑一个会话」时，抽出来的热尾里混着
//   ① 宿主拼的「请查看附件 + 本机收件路径」② 同一个主人句配了两版回复。
// 这两条都出在 从归档取热尾，所以这里造一份真归档（一帧 zstd + JSONL）来钉住。
function 造归档(区, sid, 事件们) {
  const 目录 = join(沙盒, 'sessions', 区, sid)
  mkdirSync(目录, { recursive: true })
  const 文本 = 事件们.map((e) => JSON.stringify(e)).join('\n')
  writeFileSync(join(目录, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(文本, 'utf8')))
}

const 造用户 = (text, seq) => ({
  type: 'user/message',
  seq,
  time: 1000 + seq,
  data: { source: { kind: 'user' }, content: [{ type: 'text', text }] },
})
const 造助手 = (text, seq) => ({
  type: 'assistant/message',
  seq,
  time: 1000 + seq,
  data: { message: { role: 'assistant', content: [{ type: 'text', text }] } },
})

test('从归档取热尾：宿主注入的附件落地通知不抽进热尾', () => {
  清盘()
  造归档('ws-demo', 'session-有附件', [
    造用户('今天午饭吃啥', 1),
    造助手('大白饭！这还用问', 2),
    造用户('请查看附件\n\n用户从 QQ 发来的附件已保存到工作区。\n- 图片 /tmp/x/.dsh-inbox/1795.jpg', 3),
    造助手('看到了，是张猫图', 4),
  ])
  const turns = m.从归档取热尾('session-有附件')
  assert.equal(turns.length, 1, '只该剩那轮真对话')
  assert.equal(turns[0].u, '今天午饭吃啥')
  assert.ok(!JSON.stringify(turns).includes('.dsh-inbox'), '不能把本机路径抽进来')
})

test('从归档取热尾：同一个主人句配了多版回复 → 只留最后一版', () => {
  清盘()
  造归档('ws-demo', 'session-重试', [
    造用户('今天那个镜像同步崩了', 1),
    造助手('回滚到哪个快照', 2),
    造用户('今天那个镜像同步崩了', 3),
    造助手('回滚到哪个点', 4),
  ])
  const turns = m.从归档取热尾('session-重试')
  assert.equal(turns.length, 1, '同一句话不能留两轮')
  assert.equal(turns[0].a, '回滚到哪个点')
})

// 存量快照（1.12.91 之前抽的）里可能还躺着脏轮，注入前要再洗一遍，
// 不然修好了新数据、旧会话点开还是老样子。
test('注入前的净化：旧快照里的宿主注入句 / 重复回复在渲染时被滤掉', () => {
  清盘()
  m.写选择('session-new', {
    load: true,
    from: 'session-旧的',
    turns: [
      { u: '请查看附件\n\n用户从 QQ 发来的附件已保存到工作区。\n- 图片 /tmp/x/.dsh-inbox/a.jpg', a: '看到了，是张猫图', at: 1 },
      { u: '今天那个镜像同步崩了', a: '回滚到哪个快照', at: 2 },
      { u: '今天那个镜像同步崩了', a: '回滚到哪个点', at: 3 },
    ],
  })
  const 文 = m.热尾文本('session-new', 'latest')
  assert.ok(!文.includes('.dsh-inbox'), '本机路径不该出现在热尾里')
  assert.equal((文.match(/今天那个镜像同步崩了/g) || []).length, 1, '同一句话只留一轮')
  assert.ok(文.includes('回滚到哪个点') && !文.includes('回滚到哪个快照'), '留最后一版回复')
})

// 2026-11-23 主实例实测：宿主把两次输出并进了同一条 text（两版之间用 \n\n\n 隔开）。
// 一条消息的去重逻辑碰不到它，只能在注入前按「同前缀的第二个开头」剪。
const 两版回复 = [
  '（抬起头）',
  '',
  '挂了？哪边出的问题，配置还是依赖那头',
  '',
  '（想了想）要是它那条链路也断了，晚上要把什么回滚跟我说一声，我换个法子走',
  '',
  '',
  '挂了？是配置还是依赖那边',
  '',
  '（想了想）要是那条链路也断了，晚上要把什么回滚跟我说一声，我换个法子走',
  '',
  '话说回来了，你别老自己瞎折腾',
  '',
  '（小声）我这儿又没挂',
].join('\n')

test('注入前的净化：一条回复里塞了两版 → 只留后一版', () => {
  清盘()
  m.写选择('session-new', { load: true, from: 'session-旧', turns: [{ u: '今天那个镜像同步崩了', a: 两版回复, at: 1 }] })
  const 文 = m.热尾文本('session-new', 'latest')
  assert.ok(!文.includes('哪边出的问题'), '前一版要剪掉')
  assert.ok(文.includes('是配置还是依赖那边'), '后一版留着')
  assert.ok(文.includes('我这儿又没挂'), '后一版的结尾也在')
})

test('注入前的净化：正常的长回复不能剪（没有同前缀的两行）', () => {
  清盘()
  const 正常 = [
    '先看结论：镜像现在是全等 3 个会话，零差异。',
    '',
    '再展开讲，这次踩的坑是白名单漏字段，七个字段没进 meta_json。',
    '',
    '要是还炸，把新的 diag 丢给我，我再排一遍。',
  ].join('\n')
  m.写选择('session-new', { load: true, from: 'session-旧', turns: [{ u: '镜像对上了吗', a: 正常, at: 1 }] })
  const 文 = m.热尾文本('session-new', 'latest')
  assert.ok(文.includes('先看结论'), '开头得在')
  assert.ok(文.includes('要是还炸'), '结尾也得在')
})

// ── 注入路径的「算 + 锁」（1.12.92）─────────────────────────────────
// 外部评审 2026-11-23 指出两个会让「页面选择」静默失效的坑：
//   ① 全局 off 时挂载前判一次就省掉钩子 → 之后选「加载」不生效
//   ② 空白页预热求值一次就把 锁定 写成空串 → 之后选了也不生效

test('算热尾与锁：空白页（0 句）只算不锁，选来源后立刻能用', () => {
  清盘()
  m.记热尾('session-old', '今天外面下雨了', '那主人带伞了吗')
  // 空白页先求值一次：还没有选择 → 空，但**不许锁死**
  const 一 = m.算热尾与锁('session-new', 'off', 0, null)
  assert.equal(一.文, '')
  assert.equal(一.锁定, null, '空白页不能锁')
  // 用户在页面上选了「最近那段」（全局是 off，选择优先）
  m.写选择('session-new', { load: true, from: '', turns: [] })
  const 二 = m.算热尾与锁('session-new', 'off', 0, 一.锁定)
  assert.ok(二.文.includes('今天外面下雨了'), '选了就该注进来')
})

test('算热尾与锁：第一句发出后锁定，之后改选择不再变', () => {
  清盘()
  m.记热尾('session-old', '今天外面下雨了', '那主人带伞了吗')
  m.写选择('session-new', { load: true, from: '', turns: [] })
  const 一 = m.算热尾与锁('session-new', 'latest', 1, null)
  assert.ok(一.文.includes('今天外面下雨了'))
  assert.equal(一.锁定, 一.文, '第一句发出后要锁')
  // 锁住之后换选择也不动
  m.写选择('session-new', { load: false, from: '', turns: [] })
  const 二 = m.算热尾与锁('session-new', 'latest', 1, 一.锁定)
  assert.equal(二.文, 一.文)
})

test('算热尾与锁：已经在聊的会话永久不接', () => {
  清盘()
  m.记热尾('session-old', '今天外面下雨了', '那主人带伞了吗')
  const r = m.算热尾与锁('session-new', 'latest', 2, null)
  assert.equal(r.文, '')
  assert.equal(r.锁定, '', '老会话要判死')
})
