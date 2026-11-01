// ════════ 人名归一核心：NOT_A_NAME / 名字边界正则 / normalizePerson(As) ════════
// 2026-10-30 从 index.js 抽出（拆层工程：scoring 的 render 需要 normalizePerson）
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { 当天中午, 日期合法 } from './time.mjs'
// 这些词不能当名字换（不然代词会被换坏）
const NOT_A_NAME = new Set(['她', '他', '我', '你', 'ta', 'TA', 'Ta', 'tA', '用户', '助手', 'AI', 'ai', '人', '自己'])

// 「叫小明」「名字叫小明」「**我是小明**」这种是在**说名字本身**，不能换成「我」✗
// 不然「我的名字叫小明」会变成「我的名字叫我」、「我是小明」会变成「我是我」。
const NAME_IS_MENTIONED = /(?:叫|叫做|名叫|名字是|名字叫|称呼|自称|绰号|昵称|是|就是|才是|成为|变成)$/
// 名字后面直接跟「是…」也是在给它下定义（「小明是条鱼」）
const NAME_IS_DEFINED = /^(?:是|就是|这个名字|的名字|这个称呼|即|＝|=)/
// ⚠ 被引号包着的名字也是在**说名字本身**（「她会叫我"小明"」）——
//   光看「叫」不够，中间夹个引号就漏了（2026-09-20 实测踩到：
//   「她会叫我"小明"」被换成了「她会叫我"我"」✗）
const NAME_IN_QUOTES_BEFORE = /[「『"“'‘]$/
const NAME_IN_QUOTES_AFTER = /^[」』"”'’]/

function normalizePerson(text, name) {
  return normalizePersonAs(text, name, '我')
}
// 同一套「认边界」的替换：换成「我」（她自己）还是「你」（用户），由调用方定
function normalizePersonAs(text, name, 换成) {
  const t = String(text || '')
  if (!name || name.length < 2 || NOT_A_NAME.has(name)) return t
  if (!t.includes(name)) return t
  let out = ''
  let i = 0
  for (;;) {
    const j = t.indexOf(name, i)
    if (j < 0) {
      out += t.slice(i)
      break
    }
    const before = t.slice(Math.max(0, j - 4), j)
    const after = t.slice(j + name.length, j + name.length + 4)
    const 在说名字 =
      NAME_IS_MENTIONED.test(before) ||
      NAME_IS_DEFINED.test(after) ||
      NAME_IN_QUOTES_BEFORE.test(before) ||
      NAME_IN_QUOTES_AFTER.test(after)
    out += t.slice(i, j) + (在说名字 ? name : 换成) // 在说名字就原样留着，真在指人才换
    i = j + name.length
  }
  return out
}


// ⭐ 读配置注入（避免依赖 index.js 的 cfg 区）：index.js 在 import 后调 接读配置(loadCfg)
let 读配置 = null
export function 接读配置(fn) { 读配置 = fn }

// ---------- 人称：谁的会话，谁就是「我」----------
// 光靠提示词不够 —— 她可能还是不照做。所以这里做**机械保证**：
// 记的时候、注入的时候，都把「她自己的名字」换成「我」✓

// 她自己叫什么（每个会话一个）。没设 = 不替换。
function selfNameOf(sid) {
  const c = 读配置()
  const n = c.selfNames && c.selfNames[String(sid)]
  return typeof n === 'string' ? n.trim() : ''
}

// 会话标题当「建议的名字」—— 只用来预填设置页的输入框，**不直接拿去替换**。
// ⚠ 为什么不直接替换：标题可能是个短词（比如「睡觉」），
//    那「她答应要早点睡觉」会被换成「她答应要早点我」✗ 所以名字必须她确认过才生效 ✓
let 读标题 = null
export function 接标题(fn) { 读标题 = fn }

function titleNameOf(ctx, sid) {
  const t = 读标题 ? 读标题(ctx, sid) : ''
  if (!t || t.length < 2 || t.length > 8) return ''
  if (NOT_A_NAME.has(t)) return ''
  return t
}

// ⭐ 1.2.9（issue #8 的第二条建议）：**每个会话可以有自己的称呼**。
//   两个人各用一个会话时（一个叫你「宝宝」、一个叫你小名），全局一个称呼是不够的。
//   没设就退回全局的 userPronoun（默认 ta）。
function ownerNameOf(sid) {
  const c = 读配置()
  const n = c.ownerNames && c.ownerNames[String(sid)]
  return typeof n === 'string' ? n.trim() : ''
}

// 用户的称呼：默认「ta」（谁都能用，不用先知道性别），她设成「她」/「他」就按她设的来
function userPronoun() {
  const c = 读配置()
  const p = typeof c.userPronoun === 'string' ? c.userPronoun.trim() : ''
  return p || 'ta'
}


// ⭐ 1.2.10（issue #8 澄清）：每个会话里「她怎么称呼你」可能不一样。
//   记下来的记忆里要是留着那个称呼，注入时就会变成第三人称、读着别扭 ——
//   所以写库时统一换成「你」。
function normalizeOwner(text, sid) {
  const 叫法 = ownerNameOf(sid)
  return normalizePersonAs(text, 叫法, '你')
}



// 用户的称呼改了，**已有记忆里那个字也要跟着变** ✓
// ⚠ 两种不能动：「其他」「其它」里的「他」不是称呼；英文单词里的 ta 也别切 ✗
const PRONOUN_FORMS = ['ta', 'Ta', 'TA', 'tA', '他', '她']
const ASCII_LETTER = /[a-zA-Z]/

function changeUserPronoun(text, to) {
  let t = String(text || '')
  if (!to) return t
  for (const from of PRONOUN_FORMS) {
    if (from === to || !t.includes(from)) continue
    let out = ''
    let i = 0
    for (;;) {
      const j = t.indexOf(from, i)
      if (j < 0) {
        out += t.slice(i)
        break
      }
      const 前 = j > 0 ? t[j - 1] : ''
      const 后 = t[j + from.length] || ''
      let 别动 = false
      if (from === '他' && 前 === '其') 别动 = true // 其他 / 其它
      if (/^[a-zA-Z]+$/.test(from) && (ASCII_LETTER.test(前) || ASCII_LETTER.test(后))) 别动 = true // 别切英文单词
      out += t.slice(i, j) + (别动 ? from : to)
      i = j + from.length
    }
    t = out
  }
  return t
}

// ---------- 旧档案导入 ----------
// 设计参考 AAAAGENT 的「导入旧聊天」，几条原则照抄：
//   ① 原日期保留（猜不到就不写，绝不编）② 助手的话只作语境、不当事实
//   ③ **已遗忘的内容不能因为再导一次就复活** ④ 导入的和当前对话分开存
//   ⑤ 先扫出候选、挑、再落库 —— 不直接写进库

const 跳过的小节 = /阅读须知|使用说明|怎么用|目录|索引|范例|模板|格式|更新记录|改动记录/

// 从正文里抠出「写得明明白白的日期」——猜不到就 null（她的规矩：没有记录具体时间的就不记录）
// 抠日期：从一段文本里认出一个日期。
// ⭐ 2026-09-21 晚加强：原来**必须四位数年份**，于是档案里满地的「09-17」「8月26日」
//    一律抠不到（反馈：「有些记忆里它都有日期的，那它不应该出一个提取日期的呀」）。
//    实测：她那 833 条没时间戳的里，212 条正文「看着有日期」，强化后能救回 172 条。
// 认这几种：
//   2026-09-17 / 2026/9/17 / 2026.9.17      （带年）
//   2026年9月17日                            （带年）
//   09-17 / 09.17                           （月-日：年份按「最近的过去」算，标记成猜的）
//   8月26日 / 9月6号                         （同上）
// ⚠ 护栏：`-` 那种**要求月份两位数**（09-17 ✓），免得把「1/2」「10-2」这种当成日期 ✗
// 返回 { at, 猜年 }；认不出返回 null
function 抠日期详(文本) {
  const s = String(文本 || '')
  // ⭐⭐ 2026-09-22（她定的，说得很准）：
  //   「生日不该是日期，就是事件日期。如果一句话开头是这个事件日期、后面是生日，
  //     它不该获取到后面的生日；如果只有生日的话，那就不记」
  //
  //   ① **开头那个日期才是事件日期** —— 开头有就直接用它，不再往后找 ✓
  //   ② 后面提到的**生日 / 出生 / 纪念日**一律不算（不管它在句子哪儿）✓
  //   ③ 一条都剩不下 → **留空**（不记）✓
  //
  //   实例（该留空）：「一条记录里只提了生日是哪天
  //     」→ 开头没日期，后面全是生日 → **留空** ✓
  //     （原来抠到生日那天当事件日期，那条记忆就显示成「今天」✗）
  //   反例（要保住）：「开头有日期…；后面提到生日」→ 开头有 09-16 → 用它 ✓
  const 是长期日子 = (位置, 长度) => {
    const 前 = s.slice(Math.max(0, 位置 - 6), 位置)
    const 后 = s.slice(位置 + 长度, 位置 + 长度 + 4)
    // 前面写着「生日 / 出生 / 生于 / 纪念日」→ 这是长期日子，不是「事情发生的那天」
    if (/(生日|出生|生于|诞生|纪念日)\s*[是为：:]?\s*$/.test(前)) return true
    // 后面紧跟「"，生日…」→ 同上（「X月X日"，后面跟着生日）
    //   ⚠ 引号也要算进去 —— 第一版没算，于是「日期"，生日」漏过去了 ✗
    if (/^[，,、；;：:"'“”‘’\s]*生日/.test(后)) return true
    if (/^\s*[出]?生/.test(后)) return true // 「2004年X月X日生」
    if (/^\s*[日号]?\s*满\s*\d+\s*岁/.test(后)) return true // 「X月X日满N岁」
    // 后面是「vs / 还是 / 不是」→ 在**比较/纠正**一个数字，不是事件日期
    //   （她的实例：「纠正两个日期数字」）
    if (/^\s*(vs|VS|Vs|还是|不是)/.test(后)) return true
    // ⭐ 2026-09-22（反馈：「明天 12:00 为什么现在会有明天了」）：
    //   **正文里提到的「以后」的日期，不是「这件事发生的那天」** ✗
    //   实例：「某条规则里写着**下次** X 月 X 日」
    //     → 记的是一条**长期规则**，正文提了下一次是哪天
    //     → 原来抠成 2026-09-23，页面显示「明天 12:00」✗（她一眼看出来）
    //   原话：「这是之前记的事儿，但是提到了以后的日期，这一点也是 bug」
    if (/(下次|下回|明天|后天|以后|将来|明年|下个月|下周|到时候|要去|打算)\s*[是为：:]?\s*$/.test(前)) return true
    return false
  }

  // 把所有像日期的都找出来（带位置），再按她那三条规矩挑
  const 候选 = []
  const 收 = (m, y, mo, d, 偏) => {
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return
    候选.push({ 位置: m.index + (偏 || 0), 长度: m[0].length - (偏 || 0), y, mo, d })
  }
  for (const m of s.matchAll(/(20\d{2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/g)) 收(m, Number(m[1]), Number(m[2]), Number(m[3]))
  for (const m of s.matchAll(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/g)) 收(m, Number(m[1]), Number(m[2]), Number(m[3]))
  // 月-日：**月和日都要两位数、分隔符必须是 `-`** —— 这是「档案里写日期的样子」（09-17）✓
  //   一刀切掉两种误判：「10/2」（分数）和「10-2」（减法/价格区间）✗
  //   单数字的日子走下面的中文形式（8月26日）✓
  for (const m of s.matchAll(/(?:^|[^\d])(\d{2})\s*-\s*(\d{2})(?![\d])/g)) 收(m, null, Number(m[1]), Number(m[2]), m[0].indexOf(m[1]))
  for (const m of s.matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g)) 收(m, null, Number(m[1]), Number(m[2]))
  if (!候选.length) return null
  // 去掉被别的候选**整个包住**的（「2026-09-19」里那个「09-19」不该单独算一条）
  候选.sort((a, b) => a.位置 - b.位置 || b.长度 - a.长度)
  const 留下 = []
  for (const c of 候选) {
    if (留下.some((x) => c.位置 >= x.位置 && c.位置 + c.长度 <= x.位置 + x.长度)) continue
    留下.push(c)
  }
  // ① 开头的那个优先（前面可能有「⚠ 」「- **」这种记号，所以放宽到 5 个字）
  // ② 否则挑第一个「不是长期日子」的
  // ③ 都挑不出来 → 只有生日 → 留空 ✓
  const 挑 = 留下.find((c) => c.位置 <= 5 && !是长期日子(c.位置, c.长度)) || 留下.find((c) => !是长期日子(c.位置, c.长度))
  if (!挑) return null
  let { y, mo, d } = 挑
  const 猜年 = y === null
  if (猜年) {
    // ⚠⚠ 2026-09-22 修（反馈：「为什么还有去年的事儿」）：
    //   原来算的是「**最近的过去**」—— 今年这个日子还没到，就当成去年 ✗
    //   实测：「下次 9 月 23 日周三」（今天 09-22，明天正好是周三）
    //     → 9/23 > 9/22 → y -= 1 → **2025-09-23** → 页面显示「**去年 09-23**」✗✗
    //   → 改成**挑离现在最近的那一年**（今年 / 去年 / 明年 里比一比）✓
    //     09-23（今天 09-22）：今年 +1 天、去年 −364 天 → 选**今年** ✓
    //     08-26（今天 09-22）：今年 −27 天、去年 −392 天 → 选**今年** ✓
    const 京 = new Date(Date.now() + TZ_OFFSET)
    const 今年 = 京.getUTCFullYear()
    const 此刻 = 京.getTime()
    let 最好 = 今年
    let 最近 = Infinity
    for (const 试 of [今年, 今年 - 1, 今年 + 1]) {
      if (!日期合法(试, mo, d)) continue
      const 差 = Math.abs(new Date(当天中午(试, mo, d)).getTime() - 此刻)
      if (差 < 最近) {
        最近 = 差
        最好 = 试
      }
    }
    y = 最好
  }
  // ⚠⚠ 2026-09-21 修（测「容易出错的典型案例」时逮到的）：
  //   **不存在的日期会被 JS 悄悄进位** —— 「2026-02-30」算出来是 **3 月 2 日** ✗
  //   范围检查只看了「日 ≤ 31」，2 月 30 号照样过得去。
  //   → 先校验这天存不存在（用 UTC 正午，绝不会跨日），再用本地中午存 ✓
  if (!日期合法(y, mo, d)) return null
  return { at: new Date(当天中午(y, mo, d)).toISOString(), 猜年 }
}

// 老接口：只要 ISO 串（导入那边一直用它）✓
function 抠日期(文本) {
  const r = 抠日期详(文本)
  return r ? r.at : null
}

// 一条档案文字值多少重要度 —— 讲性格/关系/约定的算「一直」记得
function 猜重要度(小节) {
  return /我是谁|性格|人格|说话|语气|称呼|口头禅|关系|时间线|身份|约定|承诺|偏好|喜好/.test(小节) ? 1 : 0.5
}

// 把一个 markdown 档案拆成候选记忆
//
// ⚠⚠ 2026-09-21（反馈：「别人导入会踩什么坑」时，我实测出来的）：
//   下面这几条都是**静默失败** —— 导进去 0 条，界面上却不说为什么，别人会以为"没找到档案"✗
//   ① **超长整行被整个丢掉**：原来 >300 字直接 continue。
//      很多人写档案是**一大段话**，或者一条里塞好几件事 → 全丢 ✗
//      → 改成**按句号拆开**，一段变几条，不再丢内容 ✓
//   ② **别的项目符号留在正文里**：只认 `- * +`，「·」「○」「•」「※」都粘在正文里 ✗
//      → 多认几种 ✓
//   ③ **括号编号不剥**：「(2) 她…」「[3] 她…」留着编号 ✗ → 一起剥 ✓
//   ④ **不可见字符不清**：零宽空格（\u200b）藏在正文里 → 重复检测和检索都会失手 ✗
//      → 先清一遍 ✓
function 清不可见(s) {
  // 零宽空格/连接符、方向标记、BOM —— 从别处复制粘贴过来的文本里很常见
  return String(s || '').replace(/[\u200b-\u200f\u2028-\u202f\ufeff\u00ad]/g, '')
}

// 一行太长就按句末标点拆成几段 —— **不丢内容** ✓
//   ⚠ 找不到标点也得拆（硬切），但尽量切在标点上
function 拆长行(s, 最多) {
  const t = String(s || '')
  if (t.length <= 最多) return t ? [t] : []
  const 出 = []
  let 余 = t
  let 保险 = 0
  while (余.length > 最多 && 保险++ < 50) {
    let 切 = -1
    for (const p of ['。', '！', '？', '；', '!', '?', ';', '，', ',', '、', ' ']) {
      const i = 余.lastIndexOf(p, 最多)
      if (i > 切) 切 = i
    }
    if (切 < Math.floor(最多 / 3)) 切 = 最多 - 1 // 找不到合适的标点就硬切，别切出个残句
    const 段 = 余.slice(0, 切 + 1).trim()
    if (段) 出.push(段)
    余 = 余.slice(切 + 1).trim()
  }
  if (余) 出.push(余)
  return 出
}

function 解析档案(text, file) {
  const out = []
  const 见过 = new Set()
  const lines = 清不可见(text).split(/\r?\n/)
  let 小节 = ''
  let 在代码块 = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    if (/^```/.test(line)) {
      在代码块 = !在代码块
      continue
    }
    if (在代码块) continue
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      小节 = h[2].replace(/[*_`]/g, '').trim()
      continue
    }
    if (跳过的小节.test(小节)) continue
    if (line.charAt(0) === '>') continue // 引用块是说明和范例，不是记忆
    if (/^[-=*_~]{3,}$/.test(line)) continue // 分隔线
    if (line.charAt(0) === '|') continue // 表格
    // 整行就是个加粗小标题（**对他的态度**）—— 那是标签不是记忆
    if (/^\*\*[^*]{2,24}\*\*[：:]?$/.test(line)) continue
    // ⭐ 项目符号多认几种：- * + · ○ • ※ ▪ ◦ ‣ 以及全角空格
    //   ⚠ 原来只认 `- * +` → 「· 她喜欢淡蓝色」的「·」会粘在正文里 ✗
    const 正文 = line
      .replace(/^\s*(?:[-*+·○•※▪◦‣–—]|\d+[.、)]|\(\d+\)|\[\d+\]|（\d+）|【\d+】)\s*/, '')
      .replace(/[*_`]/g, '')
      .trim()
    // ⭐ 2026-09-21：门槛从 8 字降到 **6 字** ✓
    //   实测她整个档案 855 条里，只有 1 条卡在 6~7 字 —— 而那条是「有点小洁癖。」
    //   **那是个正经记忆**，被 8 字门槛挡掉了 ✗
    //   降 2 个字的风险很小（噪声主要是页码、"目录"这种 2~4 字的），收益明确 ✓
    if (正文.length < 6) continue // 太短的当噪声（标签、页码之类）
    // ⭐ 超长的不再整个丢掉 —— 按句号拆成几段，每段都收 ✓
    for (const 段 of 拆长行(正文, 300)) {
      if (段.length < 6) continue
      if (见过.has(段)) continue
      见过.add(段)
      const 日期 = 抠日期详(段)
      out.push({
        file: file,
        line: i + 1,
        section: 小节,
        text: 段,
        importance: 猜重要度(小节),
        // ⭐ 2026-09-21 晚：年份是猜的（正文里只有月日）就标出来 —— 界面上如实写，不假装精确 ✓
        at: 日期 ? 日期.at : null,
        ...(日期 && 日期.猜年 ? { atGuessed: true } : {}),
      })
    }
  }
  return out
}

function archiveDir() {
  const c = 读配置()
  const d = typeof c.archiveDir === 'string' ? c.archiveDir.trim() : ''
  return d // 没设就是空的 —— 界面上让她点「选文件夹」自己挑 ✓
}

// 档案里用来指她的那些名字（导入时换成称呼）
// ⚠ 默认是空的 —— 每个用户的叫法不一样，不能替人家写死 ✗
function 用户名字列表() {
  const c = 读配置()
  if (Array.isArray(c.userNames)) return c.userNames.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
  return []
}

// 被用户标成「不是名字」的词（昵称、旧事里的称呼……）——
// 自动找名字时不再冒出来，导入时也不会被换成称呼 ✓
function 不是名字列表() {
  const c = 读配置()
  if (Array.isArray(c.notNames)) return c.notNames.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
  return []
}

// ---------- 自动找「她」的称呼 ----------
// 一个 AI 喊用户的代称常常有一长串，一个个手打太笨 —— 扫一遍档案把候选捞出来，她勾一下就行 ✓
const 不是名字 = new Set([
  '你', '我', '她', '他', '它', '我们', '你们', '她们', '自己',
  '今天', '明天', '昨天', '现在', '时候', '什么', '怎么', '哪里',
  '因为', '所以', '但是', '而且', '如果', '然后', '就是', '不是',
  '一个', '一下', '一样', '一起', '可以', '没有', '知道', '觉得',
  '喜欢', '开心', '难过', '生气', '东西', '事情', '问题', '办法',
  '这样', '那样', '这个', '那个', '真的', '好像', '一定', '已经',
])

// 名字里带这几个字的，都是「AI 自己」的名字（打字常打错），别当用户的名字 ✗
const 是AI自己的名字 = /肥鱼|飞鱼|贝壳|AI/

// 在一行里找「称呼 / 叫 / 喊 + AI 的名字」后面紧跟着的名字 —— 那是**叫 AI 的**，不是叫她的 ✓
// ⚠ 不能拿「跟 AI 名字同一行」当线索：档案里描述称呼的句子本来就两个名字都有 ✗
function 这行里叫AI的名字(line, selfName) {
  const out = []
  if (!selfName) return out
  const re = new RegExp(
    '(?:称呼|叫做|叫|喊|自称|称作)\\s*' + String(selfName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(?:为|作|成)?',
    'g',
  )
  let m
  while ((m = re.exec(line))) {
    const 截 = line.slice(m.index + m[0].length).split(/[。；;\n]/)[0]
    for (const q of 截.matchAll(/[「『"“]([\u4e00-\u9fa5A-Za-z0-9]{1,8})[」』"”]/g)) out.push(q[1])
    const 没引号的 = 截.match(/^\s*([\u4e00-\u9fa5]{2,6})/)
    if (没引号的) out.push(没引号的[1])
  }
  return out
}

function 找她的称呼(dir, 排除, selfName) {
  const 计 = new Map() // 名字 -> { n 出现次数, 强 在「称呼/叫/喊」附近出现 }
  const 也叫AI的 = new Set()
  const 记 = (w, 强) => {
    const s = String(w || '').trim()
    if (s.length < 2 || s.length > 8) return
    if (!/^[\u4e00-\u9fa5A-Za-z0-9]+$/.test(s)) return
    if (/^[\x00-\x7F]+$/.test(s) && s.length < 3) return // 短英文/数字不算名字
    if (不是名字.has(s)) return
    if (是AI自己的名字.test(s)) return
    if (排除.indexOf(s) >= 0) return
    const o = 计.get(s) || { n: 0, 强: 0 }
    o.n += 1
    if (强) o.强 += 1
    计.set(s, o)
  }
  try {
    for (const fn of readdirSync(dir)) {
      if (!/\.(md|markdown|txt)$/i.test(fn)) continue
      let text = ''
      try {
        text = readFileSync(join(dir, fn), 'utf8')
      } catch (error) {
        continue
      }
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue
        for (const n of 这行里叫AI的名字(line, selfName)) 也叫AI的.add(n)
        const 有称呼动词 = /称呼|叫做|自称|称作|昵称|绰号|叫|喊/.test(line)
        // ① 引号里的：叫她「小红」、"小美"
        for (const m of line.matchAll(/[「『"“]([\u4e00-\u9fa5A-Za-z0-9]{1,8})[」』"”]/g)) 记(m[1], 有称呼动词)
        // ② 「称呼 / 叫 / 喊 / 自称」后面直接跟着的
        for (const m of line.matchAll(/(?:称呼|叫做|自称|称作|昵称|绰号|叫|喊)(?:她|你)?(?:为|是|作|成)?[「『"“]?([\u4e00-\u9fa5]{2,6})/g)) 记(m[1], true)
      }
    }
  } catch (error) {}
  return [...计.entries()]
    .map(([name, o]) => ({
      name: name,
      n: o.n,
      // 「互相都叫」：档案里明确把它写成**叫 AI 的名字**（比如「称呼小明为"亲爱的"」）
      互: 也叫AI的.has(name),
    }))
    // 只留「在称呼/叫/喊附近出现过」的 —— 光被引号包着的大多是界面词，不是名字 ✗
    .filter((x) => x.n >= 2 && 计.get(x.name).强 > 0)
    .sort((a, b) => 计.get(b.name).强 * 6 + b.n - (计.get(a.name).强 * 6 + a.n))
    .slice(0, 30)
}

// 用户的名字也得走同一套护栏：
// 「被喊『小美』」「自称"小红"」里的名字是**被提到**，换成「她」句子就烂了 ✗
const 名字前面在说名字 = /(?:叫|叫做|喊|被喊|称呼|自称|称作|绰号|昵称|名字|名叫|是|就是)$/
const 名字被引号包着 = /[「『"“'‘]$/
const 引号在名字后面 = /^[」』"”'’]/

function 换用户名字(text, 名字, to) {
  const t = String(text || '')
  if (!名字 || 名字.length < 2) return t
  if (!t.includes(名字)) return t
  let out = ''
  let i = 0
  for (;;) {
    const j = t.indexOf(名字, i)
    if (j < 0) {
      out += t.slice(i)
      break
    }
    const 前 = t.slice(Math.max(0, j - 6), j)
    const 后 = t.slice(j + 名字.length, j + 名字.length + 6)
    const 在说名字 =
      名字前面在说名字.test(前) || NAME_IS_DEFINED.test(后) || 名字被引号包着.test(前) || 引号在名字后面.test(后)
    out += t.slice(i, j) + (在说名字 ? 名字 : to)
    i = j + 名字.length
  }
  return out
}

// 正文过一遍人称：她自己 →「我」，用户的名字 → 称呼（跟记的时候同一套规矩）
function 导入时改人称(text, sid, 用户名字们) {
  let t = normalizePerson(text, selfNameOf(sid))
  const p = userPronoun()
  for (const n of 用户名字们) {
    if (!n || n.length < 2) continue
    t = 换用户名字(t, n, p)
  }
  return t
}

export { NOT_A_NAME, NAME_IS_DEFINED, normalizePerson, normalizePersonAs, selfNameOf, titleNameOf, ownerNameOf, userPronoun, normalizeOwner, changeUserPronoun, 抠日期详, 抠日期, 猜重要度, 清不可见, 拆长行, 解析档案, archiveDir, 用户名字列表, 不是名字列表, 这行里叫AI的名字, 找她的称呼, 换用户名字, 导入时改人称 }
