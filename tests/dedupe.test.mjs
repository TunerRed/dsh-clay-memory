import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 配置要隔离到临时家目录 —— 自动整理会读写 clay-memory-config.json
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dedupe-home-'))

const { 切句子, 独有句数, 够格自动合并, 合并正文, 找可合的, 执行合并, 一轮合并上限 } = await import(
  '../lib/dedupe.mjs'
)

const 画像 = (id, text, extra = {}) => ({
  id,
  category: 'stable_profile',
  importance: 0.5,
  text,
  ...extra,
})

// 真正的重复：同一件事，只是多了个后缀
const 真重复A = '主人喜欢在 B站看泰拉瑞亚的教程视频，特别是刷怪场建造和环境治理的深度内容，不爱看速通。'
// 只多一个短后缀 —— 像度要 ≥0.9 才算「真重复」，词差太多就掉出去
const 真重复B = 真重复A.replace('。', '（抽样）。')

test('① 切句子：按句末标点和换行切，滤掉太短的碎句', () => {
  assert.deepEqual(切句子('第一句话在这里。第二句话也很长！第三句也够长？'), ['第一句话在这里', '第二句话也很长', '第三句也够长'])
  assert.deepEqual(切句子('好。这是一句正常长度的话'), ['这是一句正常长度的话'])
  assert.deepEqual(切句子(''), [])
})

test('② 独有句数：找出对方没有的句子', () => {
  const a = '主人喜欢大白饭。主人每天都要吃白饭。'
  const b = '主人喜欢大白饭。'
  assert.equal(独有句数(a, b), 1, '「每天都要吃白饭」是 b 没有的')
  assert.equal(独有句数(b, a), 0, 'b 的每句 a 都有')
})

// 真机 1.12.46 第 4 对：同义改写，前半段不同、后半段一字不差。
// 旧口径拿整句像度比，被前半段拉到线下 → 判成独有 → 补出一段重复。
test('②b 独有句数：同义改写、后半段一字不差 → 不算独有（别把一段话补成两遍）', () => {
  const 长 =
    '黏土记忆确定要加「临场提醒」功能：体检页把现有内容收进折叠区，上面新增一个折叠区输入固定注入文字；200 字硬限、全局唯一一份、每轮追加到记忆块最后、纯固定文字不做清单渲染。起因是想给每轮回复挂一份「检查清单」，格式参考 DeepSeek web 端角色扮演的思考链四步：分析输入 → 定策略 → 起草 → 润色'
  const 短 =
    '黏土记忆要加「临场提醒」功能：体检页把现有内容收进折叠区，上面新增一个折叠区输入固定注入文字；200 字硬限、全局唯一一份、每轮追加到记忆块最后、纯固定文字不做多行清单渲染。起因是主人想要「检查本轮回复」的提示，格式参考 DeepSeek web 端角色扮演的思考链四步：分析输入 → 定策略 → 起草 → 润色'
  assert.equal(独有句数(短, 长), 0, '短条这两句的意思长条都覆盖到了')
  assert.ok(!合并正文(长, 短).includes('补充：'), '不该补出重复段落')
})

test('③ 够格自动合并：几乎一样的两条 → 该合', () => {
  assert.equal(够格自动合并({ text: 真重复A }, { text: 真重复B }), true)
})

test('④ 主题相近但用词差太多 → 像度不够，不是同一条', () => {
  const a = '主人喜欢在 B站看泰拉瑞亚的教程视频，特别是刷怪场建造和环境治理的深度内容，不爱看速通。'
  const b = '主人爱看饥荒的基地规划和星空解说，喜欢老手开荒的过程，觉得新手向太浅。'
  assert.equal(够格自动合并({ text: a }, { text: b }), false, '像度到不了 0.9，不该自动合')
})

test('⑤ 各有对方没有的句子 → 不是重复，不合', () => {
  const a = '主人喜欢在 B站看泰拉瑞亚的教程视频。主人也爱看饥荒的基地规划。'
  const b = '主人喜欢在 B站看泰拉瑞亚的教程视频。主人还玩星穹铁道。'
  assert.equal(够格自动合并({ text: a }, { text: b }), false, '各自都有独有句，说明内容不一样')
})

test('⑥ 太短的零碎条目不合（可能是两件不同的小事）', () => {
  assert.equal(够格自动合并({ text: '吃白饭' }, { text: '吃白饭' }), false)
})

test('⑦ 合并正文：留长的正文，短的独有句追加在后面', () => {
  const 长 = '主人喜欢在 B站看泰拉瑞亚的教程视频。'
  const 短 = '主人喜欢在 B站看泰拉瑞亚的教程视频。他不爱看速通。'
  const 结果 = 合并正文(长, 短)
  assert.ok(结果.length > 长.length, '有独有句就要补进来，不能丢')
  assert.ok(!结果.includes('速通') === false, '「不爱看速通」这句必须保住')
})

test('⑧ 合并正文：没有独有句就原样返回（不把重复的话说两遍）', () => {
  const a = '主人喜欢在 B站看泰拉瑞亚的教程视频。'
  assert.equal(合并正文(a, a), a)
})

test('⑨ 找可合：不同类别 / 知识 vs 画像 永不互合', () => {
  const data = {
    memories: [
      画像('a', 真重复A),
      { id: 'b', category: 'stable_profile', is_knowledge: true, text: 真重复B }, // 知识，不该跟画像合
      画像('c', 真重复B),
    ],
  }
  const { 明细 } = 找可合的(data)
  assert.equal(明细.length, 1, '只该合画像那对')
  const ids = [明细[0].留.id, 明细[0].合.id].sort()
  assert.deepEqual(ids, ['a', 'c'], '合的是两条画像，不是画像和知识')
})

test('⑩ 执行合并：短的进回收站、长的记来源，信息不丢', () => {
  // 两条长度要够接近（长比 ≥0.9）才算真重复；短的比长的多一句细节，正好测「补充」那步
  const 长文 = '主人喜欢在 B站看泰拉瑞亚的教程视频，特别是刷怪场建造和环境治理这类深度内容，不爱看速通类的视频，更看重讲解的耐心程度。另外还喜欢饥荒的基地规划。'
  const 长 = 画像('long', 长文)
  const 短 = 画像('short', 长文 + '也讨厌标题党。')
  const data = { memories: [长, 短], deleted: [] }
  const { 明细 } = 找可合的(data)
  assert.equal(明细.length, 1)
  const { 记录 } = 执行合并(data, 明细)
  assert.equal(记录.length, 1)
  // 留下的是长的那条（short 更长，所以它该留）
  assert.equal(data.memories.length, 1)
  const 留下 = data.memories[0]
  assert.equal(String(留下.id), 'short', '留的是更长的那条')
  assert.ok(留下.text.includes('标题党'), '短条独有的句子不能丢')
  assert.equal(data.deleted.length, 1)
  assert.equal(data.deleted[0].合并掉的, true, '要跟普通删除区分开')
  assert.equal(data.deleted[0].合并进了, 'short', '要记清楚合到哪去了')
})

test('⑪ 执行合并：省下的字数如实返回', () => {
  const data = { memories: [画像('x', 真重复A), 画像('y', 真重复B)], deleted: [] }
  const { 明细 } = 找可合的(data)
  const { 省下 } = 执行合并(data, 明细)
  assert.ok(省下 > 0, '合掉一条同款就该省字')
})

test('⑫ 一轮合并上限存在，不会一次改掉太多', () => {
  assert.ok(一轮合并上限 > 0 && 一轮合并上限 <= 50)
})

// ⚠⚠ 2026-11-16 深夜：第一版门槛是「像度 ≥0.9 且长比 ≥0.9」，主库 459 条跑出 0 对 ——
//   因为真实库里的重复**全是汇总型**（短条被长条完整包住，长比 0.08~0.67），
//   「长短差不多」根本不是判据。改成只看「短条有没有长条没有的东西」。
test('⑬ 汇总型：长条啰嗦、短条精简，短条内容全被覆盖 → 可以合', () => {
  const 短 = '主人喜欢看泰拉瑞亚刷怪场建造和环境治理的深度教程，不爱速通。'
  const 长 =
    '主人喜欢看泰拉瑞亚的刷怪场建造教程，喜欢看环境治理的深度教程，泰拉瑞亚的刷怪场和环境治理，不爱速通。'
  assert.ok(短.length >= 20, '夹具得够长，否则会被最短条门槛挡住')
  assert.equal(够格自动合并({ text: 长 }, { text: 短 }), true, '短条没有长条没有的东西，合了不丢信息')
  // 反过来传参也一样 —— 判定不该依赖谁在参数前面
  assert.equal(够格自动合并({ text: 短 }, { text: 长 }), true)
})

test('⑭ 短条一句都不独有 → 合并后字数不变或少（信息被完整吸收）', () => {
  const data = { memories: [画像('x', 真重复A), 画像('y', 真重复B)], deleted: [] }
  const { 明细 } = 找可合的(data)
  const { 记录, 省下 } = 执行合并(data, 明细)
  assert.equal(记录.length, 1)
  assert.ok(省下 >= 0, '短条没有独有句，合完只会更短')
  assert.equal(data.memories.length, 1)
})
