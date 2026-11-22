// 1.12.1 自动入库：六类强线索 + 细节低置信档
//   要点：① 六类都能认出来（strong）；② 只有具体名词/时间的走 detail 低置信
//        ③ detail 不是「不收」——颗粒度低的碎片按低重要度收，由 daily cap 控制量
//        ④ 跟库里几乎一样的（像度 ≥ 真重复门槛）不重复落
import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const 家 = mkdtempSync(join(tmpdir(), 'clay-auto-'))
process.env.DSH_HOME = 家
mkdirSync(join(家, 'clay-memory'), { recursive: true })

const 自动 = await import('../lib/auto-capture.mjs')

test('六类：约束 / 决定 / 偏好 / 日期 / 地点 / 物品都认得出（strong 档）', () => {
  assert.equal(自动.归类('以后别在早上十点前给我发消息'), 'constraint')
  assert.equal(自动.归类('改成周六下午三点在旧书摊碰头'), 'decision')
  assert.equal(自动.归类('我更喜欢热麦茶'), 'preference')
  assert.equal(自动.归类('我生日是五月十二'), 'date')
  assert.equal(自动.归类('水壶放在阳台门旁边的架子上'), 'place')
  assert.equal(自动.归类('阿岑借了我一把活动扳手'), 'item')
  assert.equal(自动.该自动收('阿岑借了我一把活动扳手').档, 'strong')
})

test('细节档：只有具体名词/时间的碎片收成低置信，不当成六类', () => {
  const 判 = 自动.该自动收('拿暖宝宝贴了后背，手还是僵')
  assert.equal(判.档, 'detail')
  assert.equal(自动.该自动收('今天中午吃了盖浇饭').档, 'detail')
})

test('不收：太短、没有具体名词的闲聊、整段长文', () => {
  assert.equal(自动.该自动收('嗯嗯'), null, '四个字以下不收')
  assert.equal(自动.该自动收('好的呀'), null)
  assert.equal(自动.该自动收('我怕自己弄不好'), null, '情绪句没有具体名词不收')
  assert.equal(自动.该自动收('啊'.repeat(500)), null, '整段长文不收')
})

test('撞旧条：像度到真重复门槛就不再落一条', () => {
  const memories = [{ id: 'a', text: '我更喜欢热麦茶' }, { id: 'b', text: '我下周三去北京出差' }]
  assert.ok(自动.撞旧条(memories, '我更喜欢热麦茶'), '同句要撞上')
  assert.ok(自动.撞旧条(memories, '我下周三要去北京出差'), '几乎同句也要撞上')
  assert.equal(自动.撞旧条(memories, '我把活动扳手放工具包内侧了'), null, '不同的事不撞')
})

test('已作废的旧条不参与去重（改了口的能重新落）', () => {
  const 已作废 = [{ id: 'a', text: '集合点在东门', 已被取代: true }]
  assert.equal(自动.撞旧条(已作废, '集合点在东门'), null)
})

test('拆片段：长消息按句拆开，短句并进上一段', () => {
  const 片 = 自动.拆片段('加班回来我更喜欢喝热麦茶，咖啡太容易让我睡不着。我生日是五月十二日。')
  assert.equal(片.length, 2, '两句应该拆成两片')
  assert.ok(片[0].includes('热麦茶'), '第一片保留偏好句')
  assert.ok(片[1].includes('五月十二'), '第二片保留生日')
  // 短句（<6 字）并到上一段，不要单独成片
  const 短 = 自动.拆片段('我住四楼，楼梯窄。嗯。')
  assert.equal(短.length, 1, '「嗯。」应并进上一段')
})

test('拆片段后逐段判定：长消息里藏着的偏好和日期都能收', () => {
  const 长 = '今天排练到很晚，剧场冷得像冰箱。' + '加班回来我更喜欢喝热麦茶，咖啡太容易让我睡不着。' + '我生日是五月十二日。'
  const 判们 = 自动.拆片段(长).map((s) => 自动.该自动收(s)).filter(Boolean).map((r) => r.类)
  assert.ok(判们.includes('preference'), '长消息里的偏好要被认出来')
  assert.ok(判们.includes('date'), '长消息里的日期要被认出来')
  assert.equal(自动.该自动收('啊'.repeat(500)), null, '超过 400 字整条不收（所以调用方必须先拆）')
})

test('详情上限走 policy：未配置回落常量、0 视为不限', async () => {
  const cfg = await import('../lib/cfg.mjs')
  const 收 = (x) => cfg.fitPolicy(x).policy.细节每天上限
  assert.equal(收({}), 60, '默认 60')
  assert.equal(收({ 细节每天上限: 200 }), 200, '配置 200 要生效')
  assert.equal(收({ 细节每天上限: 0 }), 0, '0 表示不限，不能被夹成别的值')
  assert.equal(收({ 细节每天上限: 99999 }), 2000, '超上限要夹到 2000')
})

// ── 性质档（1.12.3）：梦 / 虚构 / 假设不能丢，但必须带 nature 标签 ──
test('性质档：梦、编的故事、假设都能认出来，并带 nature', () => {
  const 梦 = 自动.该自动收('昨晚梦到舞台变成一座温室，观众席里全是盆栽。')
  assert.equal(梦.档, 'nature', '梦要走性质档，不能当成细节或事实')
  assert.equal(梦.性质, 'dream')
  assert.equal(梦.名, '梦')

  const 故事 = 自动.该自动收('我编了一个纸船船长的故事，他坐在蓝色茶杯里出海。')
  assert.equal(故事.性质, 'fiction', '编故事要认成虚构')

  const 假设 = 自动.该自动收('假设明天能换到早班，我就去河边书店逛逛。')
  assert.equal(假设.性质, 'hypothesis', '假设要认成 hypothesis')
})

test('性质档：普通的「如果…就…」不算假设，别把每句条件都收进库', () => {
  const 普 = 自动.该自动收('如果明天有空就去看展。')
  assert.ok(!普 || 普.档 !== 'nature', '没带「假设/假如/要是」的普通条件句不许进性质档')
})

// ── 词表缺口（1.12.54）：否定式偏好 + 非「一X」的数量词 ──
test('词表：不吃 / 不喝 / 忌口 这类否定式偏好要能收', () => {
  const 香 = 自动.该自动收('我不吃香菜')
  assert.ok(香 && 香.类 === 'preference', '「我不吃香菜」是 preference，原来整类漏收')
  const 辣 = 自动.该自动收('我不吃辣，一点辣都不行')
  assert.ok(辣 && 辣.类 === 'preference')
})

test('词表：两只 / 三只 这类数量词要能收物品', () => {
  const 猫 = 自动.该自动收('我有两只猫')
  assert.ok(猫 && 猫.类 === 'item', '「我有两只猫」原来只认「一只」，整类抓不到')
  const 狗 = 自动.该自动收('我家养了三只狗')
  assert.ok(狗 && 狗.类 === 'item')
})

test('词表：加了「不吃」之后，假设句仍然要拦住', () => {
  const 假 = 自动.该自动收('如果我不吃香菜，那我就点别的')
  assert.equal(假, null, '整句是假设，不能因为含「不吃」就收进来')
})
