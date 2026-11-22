import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 说话尺（lib/meter.mjs）回归 —— 这个模块**零测试覆盖**，而它管的是「这句话值不值得翻记忆」。
//
// 要守住的不变量：
//   ① `textOfMessage` 认得住宿主各种消息形状，且**硬截 2000 字**（一条超长消息不该撑爆线索）；
//   ② `扩词集` 的两层结构：整词 / 碎片，而**碎片只在切开后没有单字碎块时才收** ——
//      「演出来」→ 演出 + **来**（来是虚字 ⇒ 这次切分本身切错了）⇒ 碎片「演出」是假朋友，不收；
//      「心理医生」→ 心理 + 医生（都是真词）⇒ 碎片能用，收。
//      实测这个口径把「她说的『正式演出』撞上『演出来』」那条误召回挡掉了，
//      而「没去看**医生**」照样能想起抑郁那条；
//   ③ `稀有度` 归一化到 0~1，且**必须夹到 1 以内** —— df=0 的词（假词/单字）原来能算到 1.12，
//      比任何真词都值钱（2026-09-22 修的「越假越值钱」）；
//   ④ **库里只剩 1 条时不归一化** —— N=1 时顶 log(1)=0，原实现直接返回 0 ⇒ 证据全 0 ⇒
//      新用户「记了东西却怎么都想不起来」（2026-09-23 自检逮到的边缘 bug）；
//   ⑤ `问句信息量` 样本不足（<20 句）时返回 **Infinity**（门先不开，免得误杀新用户）；
//   ⑥ 说话尺**按 sid 隔离**、不落盘，且缓存键带搭配版本（版本变了缓存自然失效）。
//
// ⚠ 期望值全部来自仓库内真实词典跑出来的实测结果，不是凭注释猜的。
// ⚠ 说话尺是模块级 Map（按 sid 累积），没有 teardown —— 所以每条测试**用自己的 sid**。
// 这个文件不 import 任何宿主接口 → 不启动 DSH 也能跑。
const home = mkdtempSync(join(tmpdir(), 'fish-cov-meter-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')

const {
  textOfMessage, 扩词集, 切词, 词面, 记忆词集, 稀有表, 稀有度,
  拿尺, 记一句话, 装搭配, 补历史尺, 问句信息量, 搭配集, 说话尺, 接诊断,
} = await import('../../lib/meter.mjs')
// 词表切法的对照基准（有词表时 切词 就该等于它 —— 证明「半个词」过滤被跳过了）
const { tokenize } = await import('../../lib/lexicon.mjs')

const 诊断 = []
接诊断((m) => 诊断.push(String(m)))

// 造一份小记忆库（三句话，词互不重叠 → df 都是 1）
function 小库() {
  return [
    { text: '她胃不好要喝温水', tags: [], related: [] },
    { text: '我喜欢蓝色的衣服', tags: [], related: [] },
    { text: '明天去北京', tags: [], related: [] },
  ]
}

test('① textOfMessage：认得住各种消息形状（字符串 / text / content 字符串 / content 数组）', () => {
  assert.equal(textOfMessage('你好'), '你好', '纯字符串入参要认')
  assert.equal(textOfMessage({ text: '在吗' }), '在吗', 'text 字段要认')
  assert.equal(textOfMessage({ content: '纯文本' }), '纯文本', 'content 是字符串时要认')
  // content 是块数组：只抽 text 块与字符串块，其它块（image 等）跳过
  assert.equal(
    textOfMessage({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }, 'c', 123, { type: 'image' }] }),
    'a b c',
    'content 数组该按空格拼接文本块，非文本块跳过'
  )
  // 空 / 垃圾 → 空串（不能抛：这些调用点在主流程上）
  assert.equal(textOfMessage(null), '')
  assert.equal(textOfMessage(undefined), '')
  assert.equal(textOfMessage({}), '')
  assert.equal(textOfMessage({ content: [] }), '', '空块数组该给空串')
  assert.equal(textOfMessage(123), '')
  // text 优先于 content（宿主两种都给时以 text 为准）
  assert.equal(textOfMessage({ text: '优先', content: '靠后' }), '优先')
})

test('① textOfMessage：硬截 2000 字（超长消息不该撑爆线索）', () => {
  assert.equal(textOfMessage('x'.repeat(3000)).length, 2000)
  assert.equal(textOfMessage('y'.repeat(2000)).length, 2000, '正好 2000 字不该被截掉一个字')
  assert.equal(textOfMessage('z'.repeat(1999)).length, 1999, '不到上限不许截')
  // 三种入参路径都要截（漏一条就是漏一个撑爆口子）
  assert.equal(textOfMessage({ text: 'x'.repeat(3000) }).length, 2000, 'text 路径也要截')
  assert.equal(textOfMessage({ content: 'x'.repeat(3000) }).length, 2000, 'content 字符串路径也要截')
  assert.equal(textOfMessage({ content: [{ type: 'text', text: 'x'.repeat(3000) }] }).length, 2000, 'content 数组路径也要截')
})

test('② 扩词集：碎片只在「切开后没有单字碎块」时才收（假朋友挡在门外）', () => {
  const ex = 扩词集({ related: ['心理医生', '演出来', '护照'] })
  // 整词层：模型挑出来的词，原样收下
  assert.deepEqual([...ex.整].sort(), ['心理医生', '护照', '演出来'].sort())
  // ⚠⚠ 碎片层是这条测试的重点：
  //   「心理医生」→ 心理 + 医生（两块都是真词，没有单字）⇒ 收 ✓
  //   「演出来」→ 演出 + 来（「来」是单字碎块 ⇒ 这次切分本身切错了）⇒ **不收** ✗
  //   「护照」→ 单个词，切不开（块数 1，不满足「>1」）⇒ 不产生碎片
  assert.ok(ex.片.has('心理'), '「心理」是真碎片，该收')
  assert.ok(ex.片.has('医生'), '「医生」是真碎片，该收 —— 少了它「没去看医生」就想不起抑郁那条')
  assert.ok(!ex.片.has('演出'), '「演出来」切出单字「来」⇒ 碎片「演出」是假朋友，必须挡住')
  assert.ok(!ex.片.has('来'), '单字碎片不该进碎片层')
  assert.deepEqual([...ex.片].sort(), ['医生', '心理'].sort(), '碎片层里混进了别的东西')
})

test('② 扩词集：整词能切开的收碎片，切不开的（单个词）不产生碎片', () => {
  const 单个 = 扩词集({ related: ['牛奶'] })
  assert.deepEqual([...单个.整], ['牛奶'])
  assert.equal(单个.片.size, 0, '「牛奶」是一个词，切不出碎片')
  // 没有 related / 空数组 → null（调用方靠这个判「这条没有扩词」）
  assert.equal(扩词集({ related: [] }), null)
  assert.equal(扩词集({}), null)
  assert.equal(扩词集(null), null)
  // 空白词跳过，但不影响其它词
  const 带空 = 扩词集({ related: ['  ', '', '护照'] })
  assert.deepEqual([...带空.整], ['护照'], '空白词该被跳过')
  // 缓存：同一组 related 返回同一个对象
  assert.equal(扩词集({ related: ['心理医生'] }), 扩词集({ related: ['心理医生'] }), '扩词集该缓存')
})

test('③ 稀有度：归一化到 0~1，且**夹到 1 以内**（越假越值钱那个 bug 不许回来）', () => {
  const df = 稀有表(小库())
  assert.equal(df.总条数, 3)
  // ⚠ 顶 = log((N+1)/2) = log(2) ≈ 0.6931 —— 它是归一化的分母
  assert.ok(Math.abs(df.顶 - Math.log(2)) < 1e-9, '顶的公式被改了：' + df.顶)
  // 只在一条记忆里出现的词 = 最值钱 = 1.00
  assert.equal(稀有度(df, '胃'), 1, 'df=1 的词该是满值 1')
  // ⚠⚠ df=0（库里根本不是个词：假词或单字）**也必须夹到 1**，
  //   原来没夹会算到 1.12 —— 比任何真词都值钱，于是假词把真证据全压下去
  const 假词 = 稀有度(df, '一个库里根本没有的词')
  assert.ok(假词 <= 1, '稀有度超过 1 了（「越假越值钱」的 bug 回来了）：' + 假词)
  assert.equal(假词, 1, 'df=0 的词夹到 1（不是 0 —— 夹只是止血，根子在 includes 硬撞）')
  // 每条记忆里都有的词 → 0
  const 都有 = 稀有表([
    { text: '我喜欢猫', tags: [], related: [] },
    { text: '我喜欢狗', tags: [], related: [] },
    { text: '我喜欢鸟', tags: [], related: [] },
  ])
  assert.ok(稀有度(都有, '喜欢') < 稀有度(都有, '猫'), '常见词的稀有度该低于罕见词')
  // 全库所有词都必须在 0~1 之间
  for (const k of df.keys()) {
    if (typeof k !== 'string') continue // 跳过 总条数 / 顶 两个非词字段
    const v = 稀有度(df, k)
    assert.ok(v >= 0 && v <= 1, `稀有度(${k})=${v} 超出 0~1`)
  }
})

test('④ 稀有度：库里只剩 1 条时不归一化（否则新用户什么都想不起来）', () => {
  const 单条 = 稀有表([{ text: '只有一条', tags: [], related: [] }])
  // ⚠ N=1 ⇒ 顶 = log((1+1)/2) = log(1) = **0** ⇒ 按公式 `!(顶>0)` 会直接返回 0
  //   ⇒ 证据 s 全是 0 ⇒ C=0 ⇒ 一条都不给。表现是「记了东西却怎么都想不起来」，极难查。
  assert.equal(单条.顶, 0, '单条库的顶本该是 0（这条前提变了，下面那个修复就要重看）')
  assert.equal(稀有度(单条, '一条'), 1, '库里 <=1 条时：有它就算数（给 1），不许返回 0')
  // 库里没有的那个词仍然是 0（不能因为「不归一化」就什么都给 1）
  assert.equal(稀有度(单条, '没有这个词'), 0)
  // 空库也不能抛
  const 空 = 稀有表([])
  assert.equal(空.总条数, 0)
  assert.equal(稀有度(空, '任意'), 0)
})

test('稀有表：带指纹缓存，库变了要重算（不能拿旧表打分）', () => {
  const 库A = 小库()
  const t1 = 稀有表(库A)
  const t2 = 稀有表(库A)
  assert.equal(t1, t2, '同一个库该走缓存（850 条每轮重切纯浪费）')
  // 指纹 = 条数 + 每条的字数/标签数 ⇒ 加一条、改长度都会失效
  const 库B = 小库().concat([{ text: '又多了一条很长的记忆', tags: [], related: [] }])
  assert.notEqual(稀有表(库B), t1, '条数变了必须重算')
  assert.equal(稀有表(库B).总条数, 4)
  // 改了正文长度也要失效（指纹里带字数）
  const 库C = 小库().map((m, i) => (i === 0 ? { ...m, text: '她胃不好要喝温水而且不能吃辣的' } : m))
  assert.notEqual(稀有表(库C), t1, '正文长度变了必须重算')
  // tags / related 也算进「词面」，所以它们的词要进 df
  const 库D = [{ text: '正文', tags: ['健康'], related: ['肠胃'] }]
  const dfD = 稀有表(库D)
  assert.ok(dfD.get('健康') >= 1, 'tags 里的词该进稀有表')
  assert.ok(dfD.get('肠胃') >= 1, 'related 里的词该进稀有表')
})

test('⑤ 问句信息量：样本不足 20 句 → Infinity（门先不开，免得误杀新用户）', () => {
  const df = 稀有表(小库())
  assert.equal(问句信息量('cov-新会话-1', '在吗', df), Infinity, '一句没说过的会话，门不该开')
  // 19 句还是不够
  for (let i = 0; i < 19; i++) 记一句话('cov-新会话-2', '第' + i + '句 我今天去了公园')
  assert.equal(拿尺('cov-新会话-2').n, 19)
  assert.equal(问句信息量('cov-新会话-2', '公园', df), Infinity, '19 句仍算样本不足')
  // 第 20 句起门就开了（返回有限值）
  记一句话('cov-新会话-2', '第20句 我今天去了公园')
  assert.equal(拿尺('cov-新会话-2').n, 20)
  const v = 问句信息量('cov-新会话-2', '公园', df)
  assert.ok(Number.isFinite(v), '满 20 句后该给出有限值，实际是 ' + v)
  assert.ok(v >= 0, '信息量不该是负数')
})

test('⑤ 问句信息量：只算「记忆库里真能当线索用」的词（碎片不该加分）', () => {
  const df = 稀有表(小库())
  // 喂够样本（换个 sid，不污染上面那条）
  for (let i = 0; i < 25; i++) 记一句话('cov-尺子-A', '第' + i + '句 我今天去了公园 天气不错')
  // 问句里的词若不在记忆库的 df 里 ⇒ 不加分（跨词碎片「宝今」「天干」就是这么被挡掉的）
  const 库里没有 = 问句信息量('cov-尺子-A', '护照体检', df)
  assert.equal(库里没有, 0, '问句里的词全不在记忆库中 ⇒ 信息量该是 0')
  // 记忆库里有的词 ⇒ 加分
  const 库里有 = 问句信息量('cov-尺子-A', '胃', df)
  assert.ok(库里有 > 0, '问句含库里真词时信息量该 > 0，实际 ' + 库里有)
  assert.ok(库里有 > 库里没有, '有真词的问句该比全是碎片的问句信息量高')
  // 空问句不炸
  assert.equal(问句信息量('cov-尺子-A', '', df), 0)
})

test('⑥ 说话尺按 sid 隔离：一个会话的话不影响另一个', () => {
  记一句话('cov-隔离-甲', '甲说的话 护照')
  记一句话('cov-隔离-乙', '乙说的话 体检')
  const 甲 = 拿尺('cov-隔离-甲')
  const 乙 = 拿尺('cov-隔离-乙')
  assert.notEqual(甲, 乙, '两个会话该各有各的尺子')
  assert.ok(甲.df.get('护照') >= 1, '甲该记得「护照」')
  assert.equal(甲.df.get('体检'), undefined, '乙的词串到甲这边了')
  assert.ok(乙.df.get('体检') >= 1)
  assert.equal(乙.df.get('护照'), undefined, '甲的词串到乙这边了')
  assert.equal(甲.n, 1)
  assert.equal(乙.n, 1)
  // 说话尺是模块级 Map（测试之间共享），但 key 不同就互不影响
  assert.ok(说话尺.has('cov-隔离-甲') && 说话尺.has('cov-隔离-乙'))
})

test('记一句话：空串与超长句不收（>1000 字直接跳过）', () => {
  const 前 = 拿尺('cov-过滤').n
  记一句话('cov-过滤', '')
  记一句话('cov-过滤', '   ')
  记一句话('cov-过滤', null)
  assert.equal(拿尺('cov-过滤').n, 前, '空串不该计数')
  记一句话('cov-过滤', 'x'.repeat(1001))
  assert.equal(拿尺('cov-过滤').n, 前, '超过 1000 字的不该收（多半是粘贴的长文，不是说话）')
  记一句话('cov-过滤', 'x'.repeat(1000))
  assert.equal(拿尺('cov-过滤').n, 前 + 1, '正好 1000 字该收')
  // 没有 sid 也不该抛
  assert.doesNotThrow(() => 记一句话('', '一句话'))
})

test('⑥ 装搭配：返回版本号当缓存键；空 sid 等于「不过滤」', () => {
  assert.equal(装搭配(''), '无', '空 sid 该返回「无」（= 不挂任何搭配表）')
  const v1 = 装搭配('cov-搭配-1')
  assert.match(v1, /^cov-搭配-1#\d+$/, '版本号该是「sid#第几版」：' + v1)
  // 同一 sid、搭配没变 → 版本号不变（缓存才命中得了）
  assert.equal(装搭配('cov-搭配-1'), v1)
})

test('⑥ 半个词判定：先被丢、单独用过 2 次再「救回来」，每次变化都递增版本号', () => {
  // ⚠ 版本号只在 `被丢` 集合**真的变了**的时候才动（判半个词 里 `该丢 === 已丢` 就直接 return）。
  //   所以这里要造出「先判成半个词、再翻回是个词」这一次真实翻转，才测得到缓存失效。
  //   「天去」是典型的跨词碎片（来自「明天去公园」），符合注释里 `碎 11 次、单独 0 次 → 丢`。
  const sid = 'cov-半个词'

  // 第一阶段：反复说「明天去公园玩啊」→「天去」只以碎片出现，从没被单独用过 ⇒ 判成半个词
  for (let i = 0; i < 6; i++) 记一句话(sid, '明天去公园玩啊')
  const v前 = 装搭配(sid)
  assert.ok(搭配集(sid).has('天去'), '「天去」该被判成半个词（跨词碎片，不该当线索）')

  // 第二阶段：用户真的把「天去」当一整段单独用了 2 次 ⇒ 撤销判定（整用下限 = 2）
  //   这正是注释里「花园」被救回来的那条路：碎 565 次、单独 2 次 → 留
  记一句话(sid, '天去')
  记一句话(sid, '天去')
  const v后 = 装搭配(sid)

  assert.ok(!搭配集(sid).has('天去'), '单独用过 2 次后必须撤销「半个词」判定，否则真词被误杀')
  assert.ok(
    Number(String(v后).split('#')[1]) > Number(String(v前).split('#')[1]),
    `搭配表变了版本号却没动（${v前} → ${v后}）⇒ 切词缓存不会失效，用的还是旧切法`
  )
  assert.notEqual(v后, v前, '版本号字符串本身也该变（它是缓存键的一部分）')
})

test('⑥ 判定没变时版本号不动（缓存该继续命中，不白重切几百条）', () => {
  const sid = 'cov-版本稳定'
  for (let i = 0; i < 6; i++) 记一句话(sid, '明天去公园玩啊')
  const v1 = 装搭配(sid)
  // 再喂同样的句子：碎片计数涨了，但「该丢/已丢」的判断结果没变 ⇒ 版本号必须保持
  for (let i = 0; i < 3; i++) 记一句话(sid, '天去公园那边')
  const v2 = 装搭配(sid)
  assert.equal(v2, v1, `判定没变版本号却动了（${v1} → ${v2}）⇒ 每轮都会白重切整个记忆库`)
  assert.ok(搭配集(sid).has('天去'), '「天去」仍该是半个词（它一直只以碎片出现）')
})

test('切词：有词表时跳过「半个词」过滤（真词不许被误杀）', () => {
  // ⚠ 2026-09-23 的修复：那套「碎/整/邻熵判半个词」是给老切法擦屁股的。
  //   词表切出来的是真词，没有碎片可挑；再过滤只会误杀真词 ——
  //   实测「牛奶」在用户话里总黏着「茶」（邻熵低）⇒ 被判成半个词 ⇒ 「奶茶」那轮把「牛奶」扔了，
  //   C 从该有的高度掉到 0.356，条数上限跟着掉到 1 ⇒ 只给得出 1 条。
  for (let i = 0; i < 8; i++) 记一句话('cov-牛奶', '我喜欢喝牛奶茶')
  装搭配('cov-牛奶')
  const 词 = 切词('牛奶')
  assert.ok(词.has('牛奶'), '有词表时「牛奶」不许被当成半个词丢掉')
  // 切词的结果应与 tokenize（词表切法）一致 —— 说明这道过滤确实被跳过了
  assert.deepEqual([...词].sort(), [...tokenize('牛奶')].sort())
})

test('词面 / 记忆词集：把 tags 与 related 一起算进「能被匹配到的那个面」', () => {
  const m = { text: 'ＡＢＣ 蓝色', tags: ['标签'], related: ['蓝'] }
  // 词面返回**归一化后的整段文字**（不是词集）—— 只剩「整句原话有没有原样出现」在用它
  assert.equal(词面(m), 'abc 蓝色 标签 蓝', '词面该把正文+标签+扩词拼起来并归一化')
  // 空值不炸
  assert.equal(词面(null), '  ', '空记忆也不该抛')
  assert.equal(词面({}), '  ')
  // 记忆词集是**词集**，且要含 tags / related 里的词
  const 集 = 记忆词集({ text: '她胃不好', tags: ['健康'], related: ['肠胃'] })
  assert.ok(集 instanceof Set)
  for (const w of ['胃', '健康', '肠胃']) {
    assert.ok(集.has(w), `记忆词集缺「${w}」（tags/related 也该能被匹配到）`)
  }
  // 缓存：同一条记忆返回同一个集合
  const 同 = { text: '她胃不好', tags: ['健康'], related: ['肠胃'] }
  assert.equal(记忆词集(同), 集, '记忆词集该缓存（每轮要重切几百条）')
})

test('补历史尺：从会话快照回放，只跑一次；没有 session 也不抛', () => {
  const 假会话 = {
    snapshotEvents: () => [
      { type: 'user/message', payload: { content: [{ type: 'text', text: '第一句 护照' }], source: { kind: 'user' } } },
      { type: 'assistant/message', payload: { text: '助手的回复不算' } },
      { type: 'user/message', payload: { content: [{ type: 'text', text: '第二句 体检' }], source: { kind: 'user' } } },
    ],
  }
  const r = 补历史尺('cov-补历史', 假会话)
  assert.equal(r.装过, true, '补过之后要标「装过」，免得每轮都回放一遍')
  assert.equal(r.n, 2, '只该收 user/message 那两条，助手回复不算：实际 ' + r.n)
  assert.ok(r.df.get('护照') >= 1)
  assert.ok(r.df.get('体检') >= 1)
  assert.ok(诊断.some((m) => /说话尺补齐/.test(m)), '补齐要留日志：' + JSON.stringify(诊断))
  // 第二次调用不再回放（装过=true 直接返回）
  const n前 = r.n
  补历史尺('cov-补历史', 假会话)
  assert.equal(拿尺('cov-补历史').n, n前, '重复补历史会重复计数')
  // data 形状的老快照也要认（payload 或 data.message 或 data）
  const 老会话 = { snapshotEvents: () => [{ type: 'user/message', data: { message: { text: '老形状' } } }] }
  assert.equal(补历史尺('cov-老形状', 老会话).n, 1)
  // 没有 session / 形状不对 → 不抛，只标装过
  assert.equal(补历史尺('cov-无会话', null).装过, true)
  assert.equal(补历史尺('cov-无快照', {}).装过, true)
  assert.equal(拿尺('cov-无会话').n, 0)
  // snapshotEvents 抛错也不能带崩主流程
  const 坏会话 = { snapshotEvents: () => { throw new Error('宿主快照坏了') } }
  assert.doesNotThrow(() => 补历史尺('cov-坏快照', 坏会话))
  assert.ok(诊断.some((m) => /说话尺补历史失败/.test(m)), '快照坏了要留日志')
})

test('拿尺：新 sid 自动建一把空尺，字段齐全', () => {
  const r = 拿尺('cov-全新')
  assert.equal(r.n, 0)
  assert.ok(r.df instanceof Map && r.碎 instanceof Map && r.整 instanceof Map && r.邻 instanceof Map)
  assert.ok(r.被丢 instanceof Set)
  assert.equal(r.版本, 0)
  assert.equal(r.装过, false)
  // 同一个 sid 拿到的是同一把尺（不然计数会散）
  assert.equal(拿尺('cov-全新'), r)
  // sid 为空也不该抛（用空串当 key）
  assert.doesNotThrow(() => 拿尺(''))
  assert.doesNotThrow(() => 拿尺(null))
})
