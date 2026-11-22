// 记忆的性质（nature）与证据原话（evidence）—— 1.11.0 一期
//
// 为什么要有「性质」：
//   梦、编的故事、假设场景，如果跟事实混在一起存，之后会被当真相召回（污染）。
//   以前靠「模型自觉」，实测盲抽时这块漏得最多（PUB01-C004/C012 全丢）。
//
// 为什么「性质」不能自动降级：
//   第三家建议「不带关键词就降级为 fact」—— 但「舞台变成温室了」不带一个「梦」字，
//   降级等于把梦写进事实池。判不出来就留空（按 fact 用），并标 uncertain 留痕。
//
// 为什么原话默认不存：
//   原话里最容易夹带敏感信息（体检、住址、证件、密码），而且原话进库 = 体积翻倍。
//   所以：**nature === 'fact' 的条目一律不存原话**（结构上杜绝瞬态属性污染：
//   「钥匙扔鞋柜上了」是 fact，存了原话就会被当成经历，之后「拿到桌上了」覆盖不掉它）。
//   只有梦/虚构/假设/过程这类「本来就要靠原话才能答」的条目才存，且有硬上限。

export const 性质全集 = ['fact', 'event', 'dream', 'fiction', 'hypothesis', 'process']

// 渲染时的短标签（写死在渲染层，不靠模型自觉加）
const 标签表 = {
  dream: '梦',
  fiction: '虚构',
  hypothesis: '假设',
  process: '过程',
}

// 规则优先级最高：命中就定死，不让模型改
const 规则 = [
  { 性质: 'dream', 正则: /梦见|梦到|做梦|梦里|梦见了/ },
  { 性质: 'fiction', 正则: /编一个|编个|编了|虚构|故事里|小说里|扮演|假装/ },
  { 性质: 'hypothesis', 正则: /假如|假设|如果.*(?:就|的话)|要是.*(?:就|的话)/ },
  { 性质: 'process', 正则: /花了\s*(?:\d+|[一二三四五六七八九十两半]+\s*)\s*(?:个)?(?:小时|分钟)|耗时|用了\s*(?:\d+|[一二三四五六七八九十两半]+)\s*(?:个)?(?:小时|分钟)/ },
]

// 归性质：显式 > 规则 > 留空（按 fact 用）
//   ⚠ 显式给的值必须合法，非法当没给（不静默改成 fact，交给规则/留空）
export function 归性质(text, 显式) {
  const 明 = String(显式 || '').trim().toLowerCase()
  if (性质全集.includes(明)) return { nature: 明, uncertain: false, by: 'explicit' }
  const 文 = String(text || '')
  for (const r of 规则) {
    if (r.正则.test(文)) return { nature: r.性质, uncertain: false, by: 'rule' }
  }
  // 判不出来：留空 = 按 fact 用，但标 uncertain 留痕（trace 里能看到，界面上不吓人）
  return { nature: '', uncertain: true, by: 'default' }
}

export function 是事实(nature) {
  return !nature || nature === 'fact'
}

// 渲染前缀：非事实条目要自报性质
export function 性质标签(nature) {
  const n = String(nature || '')
  return 标签表[n] ? '（' + 标签表[n] + '）' : ''
}

// ── 证据原话 ─────────────────────────────────────────

export const 原话上限 = 60

// 三道硬闸，全部是确定性规则（不做黑名单词库 —— 会误伤「阿岑借我扳手」这种正常名）
const 高危 = [
  /sk-[A-Za-z0-9_-]{16,}/, // API key
  /bearer\s+[A-Za-z0-9._-]{16,}/i, // token
  /\b\d{16,19}\b/, // 银行卡
  /\b1[3-9]\d{9}\b/, // 手机号
]
// 敏感类：命中就不存原话（条目照记，只是没有原话）
const 敏感 = /体检|病历|诊断|住院|手术|身份证|护照|银行卡|密码|月薪|工资|存款|欠款|住址|门牌|床戏/

export function 该留原话({ nature, text, 原话, 显式别记 }) {
  const 句 = String(原话 || '').trim()
  if (!句) return { 存: false, excerpt: '', why: 'nooriginal' }
  if (显式别记) return { 存: false, excerpt: '', why: 'user-said-no' }
  // fact 一律不存 —— 结构上杜绝「有原话就被当成经历」
  if (是事实(nature) || nature === 'event') return { 存: false, excerpt: '', why: 'fact-or-event' }
  for (const r of 高危) {
    if (r.test(句)) return { 存: false, excerpt: '', why: 'high-risk' }
  }
  if (敏感.test(句) || 敏感.test(String(text || ''))) return { 存: false, excerpt: '', why: 'sensitive' }
  const 截 = 句.length > 原话上限 ? 句.slice(0, 原话上限 - 1) + '…' : 句
  return { 存: true, excerpt: 截, why: 'kept' }
}

export function 拼证据({ 存, excerpt, sid, now, turn }) {
  if (!存 || !excerpt) return null
  return {
    session: String(sid || ''),
    ...(typeof turn === 'number' && turn > 0 ? { turn } : {}),
    excerpt,
    observed_at: new Date(now).toISOString(),
    origin: 'remember',
  }
}
