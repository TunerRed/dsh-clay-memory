import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 性质与证据原话（1.11.0 一期）回归：
//   ① 规则优先：梦见→dream、编一个→fiction、假如→hypothesis、花了…小时→process；
//   ② 判不出来留空（按 fact 用）+ uncertain，**不自动降级成 fact 写进库**；
//   ③ fact / event 一律不存原话（结构上杜绝瞬态属性被当成经历）；
//   ④ 三道隐私闸：高危（key/token/卡号/手机号）、敏感词、用户说别记；
//   ⑤ 原话硬上限 60 字；
//   ⑥ 渲染时非事实条目自报性质；零命中兜底链能救回证据原话。
const home = mkdtempSync(join(tmpdir(), 'fish-nature-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')

const { 归性质, 该留原话, 性质标签, 是事实, 原话上限 } = await import('../lib/nature.mjs')
const { render, 原话兜底 } = await import('../lib/scoring.mjs')

test('性质：规则优先于缺省（显式 > 规则 > 留空）', () => {
  assert.equal(归性质('我梦见舞台变成温室了').nature, 'dream')
  assert.equal(归性质('我编一个纸船船长的故事').nature, 'fiction')
  assert.equal(归性质('假如我换早班，就去河边书店').nature, 'hypothesis')
  assert.equal(归性质('检查那盏灯花了九十分钟').nature, 'process')
  // 显式给了就用显式的，哪怕词面像别的
  assert.equal(归性质('我梦见…', 'fact').nature, 'fact')
  // 非法值当没给
  assert.equal(归性质('我梦见…', 'nonsense').nature, 'dream')
})

test('性质：判不出来留空 + uncertain，不硬塞成 fact 字段', () => {
  const r = 归性质('窗台那盆薄荷浇多了')
  assert.equal(r.nature, '')
  assert.equal(r.uncertain, true)
  assert.equal(是事实(r.nature), true, '留空按事实用')
  // 关键：带梦字但规则没覆盖的写法也留 uncertain，而不是被降级成 fact 写进库
  assert.equal(归性质('舞台变成温室了').nature, '')
})

test('证据原话：fact / event 一律不存', () => {
  assert.equal(该留原话({ nature: '', text: '钥匙扔鞋柜上了', 原话: '钥匙扔鞋柜上了' }).存, false)
  assert.equal(该留原话({ nature: 'fact', text: '钥匙扔鞋柜上了', 原话: '钥匙扔鞋柜上了' }).存, false)
  assert.equal(该留原话({ nature: 'event', text: '今天去看了演出', 原话: '今天去看了演出' }).存, false)
  // 非事实才存
  const ok = 该留原话({ nature: 'dream', text: '梦见舞台变温室', 原话: '我梦见舞台变成温室了，还有薄荷味' })
  assert.equal(ok.存, true)
  assert.equal(ok.excerpt, '我梦见舞台变成温室了，还有薄荷味')
})

test('证据原话：三道隐私闸', () => {
  assert.equal(该留原话({ nature: 'dream', text: '梦到密码是 abc', 原话: '我的 api key 是 sk-abcdefghijklmnopqrst' }).存, false)
  assert.equal(该留原话({ nature: 'dream', text: '梦到银行卡', 原话: '卡号 6222021234567890123' }).存, false)
  assert.equal(该留原话({ nature: 'dream', text: '梦到手机', 原话: '我手机 13800138000' }).存, false)
  assert.equal(该留原话({ nature: 'dream', text: '梦到体检报告', 原话: '体检报告说我缺铁' }).存, false)
  assert.equal(该留原话({ nature: 'dream', text: '梦到舞台', 原话: '别记这个，我梦见舞台塌了', 显式别记: true }).存, false)
  // 正常名字不许被误伤
  assert.equal(该留原话({ nature: 'dream', text: '借扳手', 原话: '阿岑借我一把活动扳手' }).存, true)
})

test('证据原话：硬上限 60 字，超了截断加省略号', () => {
  const 长句 = '我梦见' + '很长的描述'.repeat(30)
  const r = 该留原话({ nature: 'dream', text: '梦见很长的事', 原话: 长句 })
  assert.equal(r.存, true)
  assert.ok(r.excerpt.length <= 原话上限, '不能超过 ' + 原话上限)
  assert.ok(r.excerpt.endsWith('…'))
})

test('渲染：非事实条目自报性质，事实不带标签', () => {
  const now = Date.now()
  const 选 = [
    { m: { id: 'm1', text: '舞台变成温室了', nature: 'dream', at: new Date(now - 86400000).toISOString() } },
    { m: { id: 'm2', text: '我住四楼', at: new Date(now - 86400000).toISOString() } },
    { m: { id: 'm3', text: '纸船船长坐在蓝色茶杯里', nature: 'fiction', at: new Date(now - 86400000).toISOString() } },
  ]
  const 文 = render(选, now, '她')
  assert.ok(文.indexOf('（梦）') >= 0)
  assert.ok(文.indexOf('（虚构）') >= 0)
  const 行 = 文.split('\n').filter((l) => l.startsWith('- '))
  assert.equal(行.length, 3)
  assert.ok(行[1].indexOf('（') < 0, '事实那条不许带标签')
})

test('兜底链：结构化召回空时，证据原话池能撞回来', () => {
  const now = Date.now()
  const data = {
    memories: [
      {
        id: 'm1',
        text: '撕胶带的时候在抽屉最里层找到的',
        at: new Date(now - 3600000).toISOString(),
        nature: 'event',
        evidence: { excerpt: '撕胶带的时候在抽屉最里层找到的那卷', observed_at: new Date(now).toISOString() },
      },
      { id: 'm2', text: '我住四楼', at: new Date(now - 86400000).toISOString() },
    ],
  }
  const fb = 原话兜底(data, '胶带是在哪儿找到的', now)
  assert.ok(fb, '要能兜回来')
  assert.equal(fb.kind, 'excerpt')
  assert.equal(fb.m.id, 'm1')
  // 完全不相干 → 不硬凑
  assert.equal(原话兜底(data, '明天天气怎么样', now), null)
})

test('兜底链：没有证据原话时，退回 72 小时内的「你说的」', () => {
  const now = Date.now()
  const data = {
    memories: [
      { id: 'm1', text: '明信片周三寄出', at: new Date(now - 3600000).toISOString(), 原话: '明信片我周三寄出去' },
      { id: 'm2', text: '很久以前的事', at: new Date(now - 10 * 86400000).toISOString(), 原话: '很久以前说的' },
    ],
  }
  const fb = 原话兜底(data, '票订好了吗', now)
  assert.ok(fb, '72h 内要有兜底')
  assert.equal(fb.kind, 'quote')
  assert.equal(fb.m.id, 'm1', '超过 72h 的不许兜')
})
