import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 词门（lib/lexicon.mjs）回归 —— 这个模块**零测试覆盖**。
// 现有 tests/lexicon-presence.test.mjs 只验「数据文件在不在、行数对不对」，
// 用 readFileSync 直读、**从不 import 本模块** ⇒「按词表切分是否正确」这条逻辑一直是空白。
//
// 要守住的不变量：
//   ① **按词表切，一个字都不丢** —— 老切法丢字（「她的胃不好」被切成「胃不好」，
//      问句「她的胃」只剩单字「胃」），两边词表对不上，才被迫拿 includes 硬撞字符串，
//      于是「车」撞进「车站」、「心」撞进「关心」（2026-09-23 换词表的根因）；
//   ② 词表认得的长词**整段吃掉**：「车站附近」→ 车站 / 附近，**「车」不单独冒出来**，
//      而「那辆车」里的「车」是独立词，照样留着；
//   ③ **通用中文门**（2026-09-24）：最常用的那些词不当检索线索。门槛 0.4 是实测出来的 ——
//      挡掉「表示 0.34 / 正式 0.39 / 今天 0.35」，留住「输 0.46 / 一把 0.43 / 抑郁 0.62」。
//      没有这道门，小库上「正式」只出现 4 条就成最值钱的证据，
//      于是她说「正式演出」捞出来的是「从没正式去医院确诊」；
//   ④ 词表 / 词频**读不到时自动退回老切法、不崩**（装新用户的前提），且不静默（1.8.20 起留痕）；
//   ⑤ 兜底单字若是虚词（的/了/我）→ 扔掉，不当线索。
//
// ⚠ 本文件的期望值**全部来自仓库内真实词典**（lexicon.txt 109750 词 / wordfreq.txt 20000 词），
//   不是凭注释猜的；词典是随仓库发布的固定数据，断言稳定。
// 这个文件不 import 任何宿主接口 → 不启动 DSH 也能跑。
const home = mkdtempSync(join(tmpdir(), 'fish-cov-lexicon-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')

const {
  HAN_STOPS, EN_STOPS, HAN_STOPS单, normalize, 中文片段,
  装词表, 装词频, 通用稀有, 通用门槛, 算线索, 正文价, 片价,
  是单字虚词, 老分词, 分词, tokenize, 接报信,
} = await import('../../lib/lexicon.mjs')

// 词典装载失败会在 diag 里留痕；这里接住，方便断言「不静默」
const 诊断 = []
接报信((m) => 诊断.push(String(m)))

test('词典装载：两份数据都装上了，且留了日志（不静默）', () => {
  const 表 = 装词表()
  const 频 = 装词频()
  // ⚠ 装不上会让整套「按词比」退化成老切法 —— 那是 1.8.17 词典整仓丢过的事故
  assert.ok(表.size > 100000, '词表太小，像是没装上：' + 表.size)
  assert.equal(频.size, 20000, '词频表该是 20000 词（jieba 那份）')
  // ⚠ 词表是**按词**收录的：「心理医生」不在表里，是「心理」+「医生」两个词
  //   （这正是分词('心理医生') → 心理/医生 的原因），所以这里只验真在表里的词
  assert.ok(表.has('车站'), '词表缺「车站」，装的可能不是那份词典')
  assert.ok(表.has('心理') && 表.has('医生'), '词表缺「心理」或「医生」')
  assert.ok(表.has('牛奶') && 表.has('护照') && 表.has('附近'), '词表缺常用词')
  assert.equal(频.get('的'), 0, '「的」该是最常用的那个（0）')
  // 装载成功要留痕；装载失败也要留痕（两条路都不许静默）
  assert.ok(诊断.some((m) => /词表已装载/.test(m)), '词表装载没留日志：' + JSON.stringify(诊断))
  assert.ok(诊断.some((m) => /词频表已装载/.test(m)), '词频装载没留日志：' + JSON.stringify(诊断))
  assert.ok(!诊断.some((m) => /读取失败/.test(m)), '词典读取失败了（会退回老切法）：' + JSON.stringify(诊断))
  // 重复调用走缓存，返回同一个对象
  assert.equal(装词表(), 表, '装词表该缓存')
  assert.equal(装词频(), 频, '装词频该缓存')
})

test('normalize：NFKC 全角折半角 + 转小写；空值不炸', () => {
  assert.equal(normalize('ＤＳＨ ＡＢＣ'), 'dsh abc', '全角没折成半角')
  assert.equal(normalize('ABC'), 'abc')
  assert.equal(normalize(''), '')
  assert.equal(normalize(null), '', 'null 该兜成空串')
  assert.equal(normalize(undefined), '')
  assert.equal(normalize(123), '123', '数字该被转成字符串')
  // 中文不受影响
  assert.equal(normalize('车站'), '车站')
})

test('中文片段：按停用词切开，停用词本身不进结果', () => {
  // 「她的胃不好，要喝温水」→ 停用词「的」「不」「要」被切掉
  assert.deepEqual(中文片段('她的胃不好，要喝温水'), ['胃不好', '喝温水'])
  // 混排时只抽中文那段（英文与数字不算中文片段）
  assert.deepEqual(中文片段('DSH 1.12.39 版本'), ['版本'])
  assert.deepEqual(中文片段('dsh'), [])
  assert.deepEqual(中文片段('1.12.39'), [])
  assert.deepEqual(中文片段(''), [])
  assert.deepEqual(中文片段(null), [])
  // 没有停用词就整段留着
  assert.deepEqual(中文片段('车站附近'), ['车站附近'])
  // 全角输入先 normalize，一样能切
  assert.deepEqual(中文片段('她的胃'), ['胃'])
})

test('① 分词按词表切：长词整段吃掉，「车」不再从「车站」里冒出来', () => {
  const 车站附近 = 分词('车站附近')
  assert.deepEqual([...车站附近].sort(), ['车站', '附近'].sort(), '「车站附近」该切成两个真词')
  // ⚠⚠ 这条是 2026-09-23 换词表要治的病根：老切法会切出「站附」这种跨词碎片，
  //   而记忆里「车站附近」没有独立的「车」，问句「那辆车」只有「车」⇒ 两边对不上 ⇒
  //   只能拿 includes 硬撞 ⇒「车」撞进「车站」、「心」撞进「关心」
  assert.ok(!车站附近.has('车'), '「车站附近」里不该单独冒出「车」（否则又会硬撞字符串）')
  assert.ok(!车站附近.has('站附'), '「车站附近」里不该有跨词碎片「站附」')

  // 而独立成词的「车」照样留着（词表认得它是单字词）
  const 那辆车 = 分词('那辆车')
  assert.ok(那辆车.has('车'), '独立成词的「车」必须留着，否则真问句反而召不回')
  // 复合词也按词切：心理医生 → 心理 + 医生（两块都是真词，没有单字碎块）
  const 心理医生 = 分词('心理医生')
  assert.deepEqual([...心理医生].sort(), ['医生', '心理'].sort())
  // 单个词不被切开
  assert.deepEqual([...分词('牛奶')], ['牛奶'])
  assert.deepEqual([...分词('护照')], ['护照'])
})

test('① 分词：一个字都不丢（对比老切法的丢字与碎片）', () => {
  // ⚠ 词表切法的价值就在这条对比上：老切法把 >=3 字的片段拆成**所有相邻 2 字**，
  //   于是造出「站附」这种跨词碎片（天生少见 → 被当成稀有线索 → 抬高了信息量）
  const 老 = 老分词('车站附近')
  assert.ok(老.has('站附'), '老切法本该有跨词碎片「站附」（这条对比才有意义）')
  assert.deepEqual([...老].sort(), ['站附', '车站', '附近'].sort())
  // 新切法没有碎片
  assert.ok(!分词('车站附近').has('站附'), '词表切法不该产生跨词碎片')

  // 「演出来」：词表切成 演出 + 来（「来」是兜底单字，不是虚词所以留着）
  const 演出来 = 分词('演出来')
  assert.ok(演出来.has('演出'), '「演出」该被切出来')
  // 关键：整段字符都能被覆盖 —— 拼回去不丢字（老切法丢字是按词比对不上的原因）
  const 原文 = '她胃不好要喝温水'
  const 切出 = [...分词(原文)].join('')
  for (const 字 of '胃喝温水') {
    assert.ok(切出.includes(字), `「${字}」被切丢了：${切出}`)
  }
})

test('⑤ 单字虚词兜底：的/了/我 不当线索，实义单字留着', () => {
  assert.equal(是单字虚词('的'), true)
  assert.equal(是单字虚词('了'), true)
  assert.equal(是单字虚词('我'), true)
  assert.equal(是单字虚词('着'), true)
  // 实义单字不是虚词
  assert.equal(是单字虚词('胃'), false, '「胃」是实义字，扔了就召不回了')
  assert.equal(是单字虚词('车'), false)
  // 多字一律不是「单字虚词」
  assert.equal(是单字虚词('车站'), false)
  assert.equal(是单字虚词(''), false)
  // HAN_STOPS单 是「整串正好是停用词」的锚定版本
  assert.ok(HAN_STOPS单.test('的'))
  assert.ok(!HAN_STOPS单.test('的确'), '「的确」整串不该被当停用词')
})

test('英文与数字：>=2 位才收，英文停用词不收', () => {
  assert.ok(分词('dsh 插件').has('dsh'))
  assert.ok(!分词('a b c').has('a'), '单个字母不该收')
  assert.ok(分词('1.12.39').size > 0, '版本号里的数字段该被收进来')
  // EN_STOPS 里的词不收
  for (const w of ['the', 'is', 'what', 'you']) {
    assert.ok(!分词(w + ' memory').has(w), `英文停用词「${w}」不该被当成线索`)
    assert.ok(EN_STOPS.has(w))
  }
  assert.ok(分词('the memory').has('memory'), '实义英文词要留着')
  // 大小写归一化后再比（normalize 转小写）
  assert.ok(分词('DSH').has('dsh'), '大写英文该被归一化成小写')
})

test('③ 通用中文门：门槛 0.4 卡在「正式/表示」与「输/一把」之间', () => {
  assert.equal(通用门槛, 0.4, '门槛被改了 —— 它是实测出来的落点，动它要重新跑基准')
  // 通用稀有：0 = 最常用，1 = 很具体；不在表里 = 前 20000 名之外 = 1
  assert.equal(通用稀有('的'), 0, '「的」该是最常用的那个')
  assert.equal(通用稀有('护照'), 1, '不在词频表里的词该算最具体（1）')
  assert.equal(通用稀有('一个根本不在表里的词'), 1)
  // 每个值都必须在 0~1 之间（超出会让打分公式失去意义）
  for (const w of ['的', '好', '会', '表示', '正式', '车', '输', '一把', '抑郁', '车站', '护照']) {
    const v = 通用稀有(w)
    assert.ok(v >= 0 && v <= 1, `通用稀有(${w})=${v} 超出 0~1`)
    assert.equal(算线索(w), v >= 通用门槛, `算线索(${w}) 与门槛判定不一致`)
  }
  // ⚠⚠ 门槛两边的实测落点（这就是 0.4 这个数的依据，改门槛会直接改变召回行为）
  for (const w of ['表示', '正式', '今天', '比较', '车', '好', '会', '的']) {
    assert.equal(算线索(w), false, `「${w}」是通用词，不该当线索（小库上它会把无关记忆顶上来）`)
  }
  for (const w of ['输', '一把', '抑郁', '车站', '护照', '婚礼', '胃']) {
    assert.equal(算线索(w), true, `「${w}」够具体，该当线索（挡了就召不回）`)
  }
  // 空值不炸：空串不在词频表里 → 按「很具体」算 1 → 算线索为 true（放行，不抛）
  assert.equal(通用稀有(''), 1)
  assert.equal(算线索(''), true)
  assert.doesNotThrow(() => 算线索(null), '空值不能抛')
})

test('证据折价常量：正文价 0.6 / 片价 0.8（都是实测出来的落点）', () => {
  // ⚠ 0.6 是实测出来的：它把注入从 50 条压到 16 条，而召回一条没掉
  assert.equal(正文价, 0.6, '正文价被改了 —— 0.6 是「压噪声但不掉召回」的实测落点')
  // 整条撞上扩词 = 全价；只撞上切碎后的干净碎片 = 打折
  assert.equal(片价, 0.8, '片价被改了')
  assert.ok(片价 > 正文价, '碎片证据（0.8）该比只撞正文（0.6）值钱 —— 撞上扩词说明更贴近要点')
  assert.ok(正文价 > 0 && 片价 <= 1, '折价必须在 0~1 之间')
})

test('tokenize：带缓存，同一串返回同一个集合对象', () => {
  const a = tokenize('车站附近')
  const b = tokenize('车站附近')
  assert.equal(a, b, 'tokenize 该缓存（每轮要重切几百条记忆，不缓存纯浪费）')
  assert.deepEqual([...a].sort(), [...分词('车站附近')].sort(), '缓存的结果要和现算的一致')
  // 不同串不该串味
  assert.notEqual(tokenize('那辆车'), a)
  assert.ok(tokenize('那辆车').has('车'))
  // 空值不炸
  assert.equal(tokenize('').size, 0)
  assert.equal(tokenize(null).size, 0, 'null 该兜成空集合')
  assert.equal(tokenize(undefined).size, 0)
  // 缓存命中的是「原文」当键 —— 大小写不同算不同键，但结果都归一化过
  assert.deepEqual([...tokenize('DSH')], [...tokenize('dsh')])
})

test('④ 词表缺失时的退路：老分词独立可用，且不依赖词典文件', () => {
  // ⚠ 这条守的是「装新用户的第一天」：词典读不到时不能崩，要退回老切法。
  //   模块内 词表/词频 是懒加载单例，测试里没法真的把它弄丢，
  //   所以这里直接验「退路本身是好用的」—— 老分词 不读任何文件，纯靠停用词规则。
  const 老 = 老分词('明天去公园玩')
  // 老切法：>=3 字的片段拆成所有相邻 2 字（这就是它产生跨词碎片的原因）
  assert.ok(老.has('明天') && 老.has('公园'), '老切法也该切出真词')
  assert.ok(老.has('天去') || 老.has('去公'), '老切法的相邻 2 字碎片特征还在（退路没被改坏）')
  // <=2 字的整段收
  assert.ok(老分词('车站').has('车站'))
  // 空值不炸
  assert.equal(老分词('').size, 0)
  assert.equal(老分词(null).size, 0)
  // 老切法同样过滤英文停用词
  assert.ok(!老分词('the memory').has('the'))
  assert.ok(老分词('the memory').has('memory'))
  // ⚠ 两套切法在「真词」上必须一致 —— 否则降级那天召回行为会突变
  for (const w of ['车站', '附近', '牛奶', '护照']) {
    assert.ok(老分词(w).has(w), `老切法也该认得「${w}」`)
    assert.ok(分词(w).has(w), `词表切法也该认得「${w}」`)
  }
})

test('停用词表：常见虚词都在，实义词不在', () => {
  const 源 = HAN_STOPS.source
  for (const w of ['怎么样', '什么', '怎么', '记得', '记住', '告诉', '我们', '这个', '的', '了', '是', '有', '吗', '呢']) {
    assert.ok(源.includes(w), `停用词表缺「${w}」—— 它会变成假线索`)
  }
  for (const w of ['护照', '抑郁', '车站', '胃']) {
    assert.ok(!源.includes(w), `实义词「${w}」不该进停用词表（进了就永远召不回）`)
  }
  // 正则必须带 g 与 u：中文片段里用 split，缺 g 会切不干净
  assert.ok(HAN_STOPS.global, 'HAN_STOPS 缺 g 标志，split 会切不干净')
  assert.ok(HAN_STOPS.unicode, 'HAN_STOPS 缺 u 标志，中文匹配可能出错')
})
