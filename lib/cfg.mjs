// 配置层：策略定义与收参、配置读写、会话开关 —— 2026-10-30 从 index.js 抽出（拆层工程第 5b 批）
// 依赖注入：报 = 诊断日志（index.js 的 diag）、读库 = 读会话库（migrateSwitch 用），由 index.js 注入。
import { readFileSync, mkdirSync, readdirSync } from 'node:fs'
import { CFG_DIR, STORE_DIR, CFG_PATH, 是会话文件 } from './paths.mjs'
import { writeFileAtomicSync } from './atomic-file.mjs'

let 报 = null
let 读库 = null
/** index.js 在 import 后调用：注入诊断日志函数 */
export function 接报信(fn) { if (typeof fn === 'function') 报 = fn }
/** index.js 在 import 后调用：注入 loadStore（migrateSwitch 用） */
export function 接读库(fn) { if (typeof fn === 'function') 读库 = fn }

const DEFAULT_POLICY = {
  baseHalfLifeDays: 30,
  emotionHalfLifeDays: 7,
  baselineWeight: 0.55,
  activationWeight: 0.25,
  importanceWeight: 0.15,
  emotionWeight: 0.05,
  threshold: 0.35, // ⭐ 2026-09-21 晚：改成卡 **C（证据）**，不再卡 P —— 见 recall 里那段长注释
  // ⭐ 2026-10-30 P3 调优试过 0.40：P3 十二句里能把「帮(0.375)」这类弱噪声挡掉，
  //   但 42 句基准里有「我玩什么游戏→游戏角色(0.389)」这类真弱命中，0.40 一刀下去
  //   24 句变空（0.35~0.40 区间的真命中全被误伤）→ 回滚 0.35。
  //   噪声治理靠通用门（见 recall 安全垫修复），不靠加高这道门槛。
  maxItems: 6,
  // 自动抽取的「细节」碎片每天最多收几条（0 = 不限）。六类强线索不占这个额度。
  细节每天上限: 60,
  maxChars: 800,
  // ⭐ 1.10.6：8 → 10，而且**只算事件类**（`category === 'stable_profile'` 不占额度）。
  //   起因：主人 2026-11-10 上午就把 8 条记满了，其中一半是「攒钱目标 / 口味 / 约定」这种
  //   要记一辈子的事 —— 稳定事实跟「今天发生了啥」抢同一个日额度，是额度设计的错，不是额度小。
  dailyQuota: 10,
  // ⭐ 2026-09-21 新加的两项（治「太敏感」，见 evaluate 上面的长注释）
  rarityK: 1, // 稀有度饱和点：归一化稀有度加起来到多少算「一半相关」（跟库大小无关）
  queryGate: 0.8, // 问句信息量门槛：这句话本身太没内容就不翻记忆。0 = 关掉这道门
  // ⭐ 2026-09-21 中午加的（C＋D：两条队）
  // ⭐⭐ 1.4.0（双层改造）：默认 2 → **6** ✓
  //   事实层变成全局库之后，候选池是整个「我是谁 / 偏好 / 约定」那一层（实测主库 202 条），
  //   只带前 2 条等于把另外 200 条永远关在门外；6 条 ≈ 一轮多花 200 字，值。
  factsMax: 6, // 长期事实每轮固定带几条（常驻层，不占 maxItems 的位置）。0 = 不带长期事实
  // ⭐ 1.12.19（F10 阶段 0）：画像的「免证据名额」。
  //   真库实测：62 条画像里 74% 的行在 hard_gate 就被挡死（C=0）——
  //   拿「这句话有没有撞上词」去考核身份/偏好，等于逼哑巴说话。
  //   这里给排序最前的 N 条一个不看证据的席位（按重要度 → 时间取），其余照旧要 C>0。
  //   默认 0 = 行为跟以前一模一样（11-04「无关问句别被事实塞满」仍然成立）。
  factsAlwaysTopN: 0,
  // ⭐ 1.12.23（F10 阶段 0 第三）：知识条目退出「长期事实每轮常驻」。
  //   真库实测：339 条知识（is_knowledge）占常驻层注入字数的 82% ——
  //   每轮 740 字里 608 字是技术笔记，画像只剩 137 字。不是画像不够格，
  //   是常驻层被导入的技术笔记占满了。
  //   0（默认）= 行为跟以前一模一样；1 = 常驻层只留画像，知识照旧走事件队
  //   和 C>0 的证据路径（不是删掉，只是不再每轮无条件占位）。
  knowledgeStaysOut: 0,
  // ⭐⭐ 1.12.42（P1-1 补洞）：语义放行。
  //   原来语义只做 RRF 重排，而重排对象是**已经过了 C 门槛**的 picked ——
  //   C=0 的条目连候选池都进不去，所以「换个说法就召不回」这个 P1-1 的核心场景
  //   其实一条都没被覆盖（真机验收：458 条库里「还记得我喜欢吃什么吗」召不回）。
  //   这里给语义路一个**受控的入口**：词面零证据、但语义排进前 N 的，允许带进来。
  //   默认 1 条、名次前 3 —— 宁缺毋滥：语义模型在 458 条上给的前 3 里仍可能混噪声，
  //   限量比放开门槛安全（阈值型方案实测不可行：跨问句的余弦分根本不可比）。
  //   0 = 关（行为回到 1.12.41）。
  语义放行上限: 1,
  语义放行名次: 3,
  // ⭐ 1.12.42 第二轮（换说法验收）：RRF 里语义那一侧的系数。
  //   1 = 两路等权（原味 RRF）。实测 12 句换说法：系数 1 中 4 句、1.5 起中 5 句，再往上饱和。
  //   为什么问题不在识别：漏掉的 8 句里有 7 句语义分是**全库第 1**，纯粹是融合时
  //   词面名次权重太大（词面几乎总在前几名，语义第 1 也只有同样的 1/11），
  //   目标条词面排到 30 名就成 1/40，直接被词面强的条目压过去。
  //   1.5 是甜点：多救一条、旧 7 句 7/7 不退化、6 句无关话噪声条数不变（还是 2）。
  语义权重: 1.5,
  // ⭐⭐ 1.12.45（预算治理 a）：常驻层最多占几成预算。
  //   起因：1.12.43 把常驻和事件合并成一个池按 C 抢，解决了「6 条常驻吃掉 605/668 字」，
  //   但还有个尾巴——常驻条目本身又长又高分时，照样能把预算吃干（真库最长一条 1224 字）。
  //   这里给常驻层一个**配额**：无论多少条，最多用 可用×占比 的字数，剩下的强制留给事件。
  //   为什么不直接砍 factsMax：条数和字数是两件事，6 条短画像比 2 条长画像有用。
  //   0 = 不限（行为回到 1.12.44，向后兼容）。
  常驻预算占比: 0,
  // ⭐⭐ 1.12.45（预算治理 b）：单条进上下文的字数上限。
  //   起因：真库 370 条知识里 68 条超过 300 字、最长 1224 字；预算按**全条**算，
  //   这些条在装填阶段就被判「装不下」，一条能把整轮注入挤成一条，极端长条等于永远进不来。
  //   ⚠ 主人此前把「maxFactLength 硬截断」标了暂缓（截断伤语义），2026-11-16 才松口，
  //   所以这里必须**按句末标点截**（不劈句子），截不到才硬截并补省略号；
  //   而且取「头 60% + 尾 40%」而不是只留头 —— 技术笔记的结论和参数几乎都在末尾。
  //   库里仍存全条，只是注入时短一些 —— 设置页点开能看全文。
  //   为什么默认 300 而不是 0：300 以下一律不碰（画像中位才 80 字，日常完全够用），
  //   只动态影响那 68 条「一条顶三条」的超长知识；实测指标与基线等价
  //   （换说法 9/12 不变，均条/均字 3.0/300 对 3.1/307）。
  //   0 = 不限。
  单条注入上限: 300,
  // ⭐ 1.12.49（意图路由）：判成「聊生活」时，知识条的有效 C 打折再排。
  //   起因：真库 14 天实测——每轮注入 636 字里 581 字是知识（91%），画像只 55 字；
  //   问「我平时喜欢吃什么」画像只剩 186 字，问「Anima 升级注意什么」知识吃掉 469 字。
  //   同一份 668 预算，闲聊不该被 Kafka 笔记占住。1 = 不降权（回到 1.12.48 的行为）。
  知识降权: 0.6,
  // ⭐ 2026-11-18（1.12.59）：知识的**硬上限**（字）。
  //   起因（observe 14 天实测）：每轮注入 3.23 条 / 636 字里，「知识」占 581 字 = 91%，
  //   画像只剩 55 字。主人当天的原话是「对我来说知识反而是最不重要的」。
  //   降权（1.12.49）只是让知识排后面，一旦这轮没有画像命中，它照样吃满预算 ——
  //   这里改成硬上限：技术轮最多 200 字，剩下的强制留给画像/约定/经历。
  //   0 = 不限。
  知识预算上限: 200,
  // ⭐ 2026-11-18（1.12.59）：闲聊时到底带不带知识。
  //   0 = 不带（判成生活/判不出意图时，知识条一条都不装）；
  //   1 = 带（回到 1.12.58 的「降权但允许」）。
  //   为什么默认 0：闲聊里知识条从来不是「那件事」，它只是「顺便提到」，
  //   而每轮 800 字的预算里，塞一条笔记就等于挤掉一条对你的理解。
  //   技术问题（判意图 = tech）不受这个开关影响，照样按 C 竞争。
  闲聊带知识: 0,
  // ⭐ 1.12.51（写入端收长度）：记账时单条超过这个字数，就在返回消息里提醒一句「偏长了」。
  //   起因：反复优化「注入时怎么省预算」，但**新的长笔记每天都在往库里灌**——
  //   2026-11-18 实测活跃 382 条里 45 条超 300 字、均长 195 字，源头不关，下游怎么截都是补丁。
  //   ⚠ 只提醒、**不截断也不拒绝**：写入这一刻手里握着的是完整上下文，
  //     能判断「该拆成两条」还是「这条就该这么长」，插件的机械规则不该替她做这个决定。
  //   0 = 不提醒。
  写入长度提醒: 300,
  // ⭐ 1.12.53（回声与配额）：自动抽取的条目降权 + 配额隔离。
  //   起因：用户聊口味随口四句（「真的吗？我喜欢黑丝还是光腿？」等），全被 auto-capture
  //   的六类正则收成 event，下一轮 P 0.344~0.351 把真答案（P 0.288）挤到最后一名。
  //   0.32 不是 0.5：脏记忆若撞上关键词，原始分能到 0.7~0.8，乘 0.5 还剩 0.35~0.40，照样压人。
  自动抽取降权: 0.32,
  // 降权后低于这个分就直接判死 —— 否则这轮没有高置信记忆时，0.17 的垃圾也会被塞进 prompt。
  自动抽取门槛: 0.15,
  // 回声窗（分钟）：刚被自动收进来的话，此刻大概率正躺在对话历史里，别再捞一遍当回声。
  //   ⚠ 这是次优做法（recall 层拿不到会话轮次）；理想是比对「还在不在当前 prompt 的近期消息里」。
  回声窗分钟: 15,
  // 自动抽取的装填配额（字 / 条）：降权只让它排后面，兜不住「这轮没别的记忆时它顶上」和
  //   存量脏数据 —— 这条硬上限才是安全网。150 字约 5~8 条背景，淹不掉主 prompt。0 = 不限。
  自动抽取配额字: 150,
  自动抽取配额条: 5,
  // ⭐ 2026-09-21 深夜（她的决定）：默认从 1 调到 **0.5** ✓
  //   她的直觉：「我知道时间才是劣势」——有日期的那 188 条，反倒排不到没日期的前面去 ✗
  //   实测：门槛卡 C 之后这个旋钮**只影响排序**，扫 1/0.75/0.5/0.25/0「该给到」全是 11/13 一动不动 ✓
  //   所以调它**不会误伤谁进得来**，只让没写时间的往后站 ✓
  unknownActivation: 0.5, // 没写时间的记忆（含长期事实）鲜活度按几成算。只影响排序，不影响谁进得来 ✓
}

// ---------- 参数的范围（防止调坏）----------
// 权重四项必须合计 100%，所以单独成一组，由 fitWeights 凑数 ✓
const POLICY_SPEC = [
  { key: 'baselineWeight', group: 'weight', label: '基础权重', tip: '只要被想起来就有的一份，其余三项是在它之上加的分', min: 0.5, max: 0.6, step: 0.01, pct: true },
  { key: 'activationWeight', group: 'weight', label: '鲜活度权重', tip: '越近、越常被想起的事，加得越多', min: 0.2, max: 0.3, step: 0.01, pct: true },
  { key: 'importanceWeight', group: 'weight', label: '重要度权重', tip: '标成「非常重要」的事，加得越多', min: 0.1, max: 0.2, step: 0.01, pct: true },
  { key: 'emotionWeight', group: 'weight', label: '情绪权重', tip: '带情绪的事，加得越多', min: 0.0, max: 0.1, step: 0.01, pct: true },
  { key: 'baseHalfLifeDays', group: 'time', label: '半衰期', tip: '普通的事多久淡一半。越大忘得越慢', min: 15, max: 60, step: 1, unit: '天' },
  { key: 'emotionHalfLifeDays', group: 'time', label: '情绪半衰期', tip: '情绪多久淡一半，比普通的事快', min: 3.5, max: 14, step: 0.5, unit: '天' },
  { key: 'threshold', group: 'gate', label: '证据门槛', tip: '命中的词要够「稀有」才算真的有关。它只卡证据（C），不掺鲜活度 —— 所以调它不会误伤该想起的', min: 0.1, max: 0.8, step: 0.05 },
  { key: 'maxItems', group: 'gate', label: '最多注入几条', tip: '一次最多塞几条给她。越大越占上下文', min: 1, max: 12, step: 1 },
  { key: 'maxChars', group: 'gate', label: '注入字数上限', tip: '一次注入的记忆加起来最多多少字。超了的这次先不进（下次可能就进了）', min: 200, max: 3000, step: 100, unit: '字' },
  { key: '细节每天上限', group: 'gate', label: '自动收细节每天上限', tip: '自动抽取的「细节」碎片（剧场冷、公交坐过站这类）一天最多收几条；六类强线索（约定/偏好/日期…）不受这个限制。0 = 不限', min: 0, max: 2000, step: 10 },
  { key: 'dailyQuota', group: 'gate', label: '每天最多记几条（事件）', tip: '一天最多记几条「今天发生的事」；稳定事实（长期偏好、约定这类）不占这个额度', min: 1, max: 30, step: 1 },
  { key: 'rarityK', group: 'gate', label: '稀有度饱和点', tip: '命中词的稀有度（0~1）加起来到多少算「一半相关」。越小越容易给', min: 0.3, max: 6, step: 0.1 },
  { key: 'queryGate', group: 'gate', label: '问句信息量门槛', tip: '这句话本身太没内容（像「在吗」）就不翻记忆。0 = 关掉这道门', min: 0, max: 2, step: 0.05 },
  { key: 'factsMax', group: 'gate', label: '长期事实每轮带几条', tip: '要记一辈子的事（画像、喜好、约定）每轮都带上，不看这句话问了什么，也不占「最多注入几条」的位置。0 = 不带长期事实（1.6.16：上限从 6 放到 10，好让「话痨」档真的多一点）', min: 0, max: 10, step: 1 },
  { key: 'factsAlwaysTopN', group: 'gate', label: '画像免证据名额', tip: '长期事实里排最前的几条，不看这句话问了什么、直接每轮带上（按重要度、再按时间取）。0 = 全都要有证据才进（默认）；调大就是「核心画像无条件在场」，适合「早上好」这类无关问句也别丢掉她是谁', min: 0, max: 10, step: 1 },
  { key: 'knowledgeStaysOut', group: 'gate', label: '知识退出常驻（0 关 / 1 开）', tip: '1 = 标了 is_knowledge 的技术笔记不再参与「长期事实每轮常驻」，把名额让给人物画像；它们照旧能被相关性召回，不是删除。0 = 行为不变（默认）', min: 0, max: 1, step: 1 },
  { key: '语义放行上限', group: 'gate', label: '语义放行几条', tip: '词面一条证据都没有（多半是换了个说法）时，允许语义最贴近的记忆也进来。0 = 关（行为回到 1.12.41：换说法就召不回）', min: 0, max: 3, step: 1 },
  { key: '语义放行名次', group: 'gate', label: '语义排名前几才放行', tip: '只放行语义排在前 N 名的。调大更容易召回换说法的记忆，但也会带进沾边的噪声', min: 1, max: 10, step: 1 },
  { key: '语义权重', group: 'gate', label: '语义排序权重', tip: '两路融合时语义名次值多少钱。1 = 等权；调大更容易召回「词面只沾一点边、但意思很近」的记忆。实测 1.5 起收益饱和', min: 1, max: 3, step: 0.5 },
  { key: '常驻预算占比', group: 'gate', label: '常驻层最多占几成预算', tip: '长期事实每轮必带，但长条目会把预算吃干（实测 6 条吃掉 605/668 字，事件队形同虚设）。设成 50 = 常驻最多用一半，剩下强制留给「这趟真正相关的记忆」。0 = 不限', min: 0, max: 100, step: 5, unit: '%' },
  { key: '单条注入上限', group: 'gate', label: '单条最长注入多少字', tip: '一条很长的笔记（370 条知识里 68 条超 300 字、最长 1224 字）能把整轮预算挤成一条。超过就在**句号处**截断再注入（留头也留尾），库里仍存全条。0 = 不限', min: 0, max: 500, step: 20, unit: '字' },
  { key: '知识降权', group: 'gate', label: '聊生活时知识条打几折', tip: '插件先粗判这句话是「问技术」还是「聊生活」：判成生活时，技术笔记的有效分乘这个系数再排，让画像/偏好先拿预算。实测每轮注入 91% 是技术笔记。1 = 不降权', min: 0, max: 1, step: 0.1 },
  { key: '知识预算上限', group: 'gate', label: '技术轮里知识最多占多少字', tip: '实测每轮注入 91% 是技术笔记、画像只剩 55 字。这里给知识设硬上限：技术轮最多 200 字，剩下的强制留给「你是谁」。0 = 不限', min: 0, max: 600, step: 25, unit: '字' },
  { key: '闲聊带知识', group: 'gate', label: '闲聊时要不要带技术笔记', tip: '关掉（默认）时，判成「聊生活」或判不出意图的轮次，一条知识都不注入 —— 闲聊里笔记从来不是那件事，塞一条就等于挤掉一条对你的理解。问技术时不受影响', min: 0, max: 1, step: 1 },
  { key: '写入长度提醒', group: 'gate', label: '记账超过多少字就提醒', tip: '只在**写入那一刻**提醒一句「偏长了，考虑拆成两条」，不截断也不拒绝 —— 那时候手里有完整上下文，拆不拆该由写的人判断。0 = 不提醒', min: 0, max: 1000, step: 50, unit: '字' },
  { key: '自动抽取降权', group: 'gate', label: '自动收的记忆打几折', tip: '插件会把「像偏好/决定/要求」的话自动收进库（六类正则）。它们没经人确认，和画像平起平坐会挤掉真答案 —— 实测四句闲聊 P 0.35 把真答案 0.29 挤到最后。0.32 比 0.5 更稳：脏记忆撞上关键词能到 0.7，乘 0.5 还剩 0.35。1 = 不降权', min: 0.1, max: 1, step: 0.02 },
  { key: '回声窗分钟', group: 'gate', label: '刚收进来的话多久内不再召回', tip: '刚说的话此刻正躺在对话历史里，再召一遍等于同一句听两遍。0 = 不排除', min: 0, max: 120, step: 5, unit: '分钟' },
  { key: '自动抽取配额字', group: 'gate', label: '自动收的记忆最多占多少字', tip: '降权只让它排后面，兜不住「这轮没别的记忆时它顶上」。这条硬上限才是安全网，也能压住库里已经攒下的存量。0 = 不限', min: 0, max: 400, step: 25, unit: '字' },
  { key: 'unknownActivation', group: 'gate', label: '没写时间的算多鲜活', tip: '没写时间戳的记忆（含长期事实）鲜活度按几成算。1 = 当成刚发生的（默认）。调小只让它们排在有时间戳的后面，不影响谁进得来', min: 0, max: 1, step: 0.05 },
]

const SPEC_BY_KEY = {}
for (const s of POLICY_SPEC) SPEC_BY_KEY[s.key] = s
const WEIGHT_KEYS = POLICY_SPEC.filter((s) => s.group === 'weight').map((s) => s.key)

function clampNum(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

// 四个权重凑成 100%：多出来的按「还能减的余地」摊掉，缺的按「还能加的余地」补上 ✓
// pin = 她刚改的那一项 —— 钉住不动，让其余三项让位（她填的数就保住了）✓
function fitWeights(src, pin) {
  const keys = WEIGHT_KEYS
  const out = {}
  for (const k of keys) out[k] = clampNum(Number(src[k]) || 0, SPEC_BY_KEY[k].min, SPEC_BY_KEY[k].max)
  const pinned = pin && keys.indexOf(pin) >= 0 ? pin : null
  for (let round = 0; round < 60; round++) {
    let sum = 0
    for (const k of keys) sum += out[k]
    const diff = 1 - sum
    if (Math.abs(diff) < 1e-9) break
    const each = {}
    let room = 0
    for (const k of keys) {
      if (k === pinned) {
        each[k] = 0
        continue
      }
      const s = SPEC_BY_KEY[k]
      each[k] = diff > 0 ? s.max - out[k] : out[k] - s.min
      if (each[k] < 0) each[k] = 0
      room += each[k]
    }
    // 钉住的那个挡死了 → 松开它，退回到「四项一起让位」
    if (room <= 1e-12) {
      if (pinned) return fitWeights(src, null)
      break
    }
    for (const k of keys) out[k] += diff * (each[k] / room)
  }
  // 落到 0.1% 上，再把误差补给「余地最大」的那个，保证合计正好 100% ✓
  for (const k of keys) out[k] = Math.round(out[k] * 1000) / 1000
  let sum = 0
  for (const k of keys) sum += out[k]
  const resid = Math.round((1 - sum) * 1000) / 1000
  if (Math.abs(resid) >= 0.0005) {
    let best = null
    let bestRoom = -1
    for (const k of keys) {
      if (k === pinned) continue
      const s = SPEC_BY_KEY[k]
      const r = resid > 0 ? s.max - out[k] : out[k] - s.min
      if (r > bestRoom) {
        bestRoom = r
        best = k
      }
    }
    if (best === null) best = pinned || keys[0]
    out[best] = Math.round(clampNum(out[best] + resid, SPEC_BY_KEY[best].min, SPEC_BY_KEY[best].max) * 1000) / 1000
  }
  return out
}

// 把送来的参数收进范围，权重凑成 100%，并回一句「我动了什么」✓
function fitPolicy(input, base, pin) {
  const out = Object.assign({}, DEFAULT_POLICY, base || {})
  const notes = []
  // 先把底子收进范围（防手改文件）✓
  for (const s of POLICY_SPEC) {
    const cur = out[s.key]
    if (typeof cur === 'number' && isFinite(cur)) out[s.key] = clampNum(cur, s.min, s.max)
  }
  // 再收页面送来的补丁
  for (const s of POLICY_SPEC) {
    const raw = input ? input[s.key] : undefined
    if (typeof raw !== 'number' || !isFinite(raw)) continue
    const v = clampNum(raw, s.min, s.max)
    if (Math.abs(v - raw) > 1e-9) notes.push(s.label + ' 只允许 ' + s.min + ' ~ ' + s.max + '，已收到 ' + v)
    out[s.key] = v
  }
  const before = {}
  for (const k of WEIGHT_KEYS) before[k] = out[k]
  const w = fitWeights(out, pin)
  let moved = false
  for (const k of WEIGHT_KEYS) {
    out[k] = w[k]
    if (Math.abs(before[k] - w[k]) > 1e-9) moved = true
  }
  if (moved) notes.push('四个权重合计要 100%，已自动调平')
  return { policy: out, notes }
}

// ⭐ 1.2.7（issue #7）：**全局参数**
//   以前参数只存在每个记忆库（memory-store/<会话>.json）里 —— 一个库都没有时，
//   保存等于没保存，F5 一刷就回默认值。
//   现在 priority：DEFAULT_POLICY ← 全局（config.policy）← 这个库自己的 policy。
function 全局参数() {
  try {
    const c = loadCfg()
    return (c && c.policy && typeof c.policy === 'object') ? c.policy : {}
  } catch (error) {
    return {}
  }
}

function 合并参数(库参数) {
  return fitPolicy(null, { ...全局参数(), ...(库参数 || {}) }).policy
}

// ---------- 配置（哪些会话开启 + 她自己叫什么 + 用户的称呼）----------

/** 读配置文件的字节当文本 —— 顺带把 Windows 上常见的三种 BOM 都去掉。
 *  2026-10-25（issue #1 里那位用户踩到的）：
 *    · PowerShell `Set-Content -Encoding UTF8` → UTF-8 BOM
 *    · PowerShell 5.1 `Out-File` / `>` 重定向 → **UTF-16LE**（这个最坑，JSON.parse 一片 NUL）
 *  以前直接 readFileSync(...,'utf8') → JSON.parse 抛错 → return {} ⇒ 所有会话静默「关着」。 */
function 读配置文本() {
  const 字节 = readFileSync(CFG_PATH)
  // UTF-16LE（PowerShell 5.1 的 Out-File / > 重定向默认就是它）
  if (字节.length >= 2 && 字节[0] === 0xFF && 字节[1] === 0xFE) return 字节.subarray(2).toString('utf16le')
  // UTF-16BE（少见，但别的工具会写）
  if (字节.length >= 2 && 字节[0] === 0xFE && 字节[1] === 0xFF) {
    const 换 = Buffer.from(字节.subarray(2))
    for (let i = 0; i + 1 < 换.length; i += 2) { const t = 换[i]; 换[i] = 换[i + 1]; 换[i + 1] = t }
    return 换.toString('utf16le')
  }
  // UTF-8（带不带 BOM 都行：用码位判断，不往源码里塞不可见字符）
  let 文 = 字节.toString('utf8')
  if (文.charCodeAt(0) === 0xFEFF) 文 = 文.slice(1)
  return 文
}

function loadCfg() {
  try {
    const raw = JSON.parse(读配置文本())
    return raw && typeof raw === 'object' ? raw : {}
  } catch (error) {
    try { 报('配置文件读不了（可能是 BOM / 写坏了）：' + String((error && error.message) || error)) } catch (error2) {}
    return {}
  }
}

function saveCfg(c) {
  try {
    mkdirSync(CFG_DIR, { recursive: true })
    writeFileAtomicSync(CFG_PATH, JSON.stringify(c, null, 2))
    return true
  } catch (error) {
    return false
  }
}

// 总开关：整个记忆功能开不开。
//
// ⚠ 1.3.4 起**默认开**（以前默认关）。默认关的后果是：装好插件、开了会话，
//   工具列表里根本没有 remember —— 很多人以为插件坏了。
//   现在装好就能用；不想用的自己关掉。
function globalOn() {
  try {
    const c = loadCfg()
    return c.全局开关 !== false
  } catch (error) {
    return true
  }
}

function setGlobalOn(on) {
  try {
    const c = loadCfg()
    c.全局开关 = !!on
    saveCfg(c)
    return !!on
  } catch (error) {
    return globalOn()
  }
}

// 某个 agent 是不是子代理派出去干活的。
// 子代理不挂记忆：它只干一件事，给它一份记忆库既没用又白写一遍文件。
function 是子代理(agent) {
  try {
    const h = agent && agent.session && agent.session.header
    if (!h) return false
    if (h.origin === 'subagent') return true
    if (typeof h.delegationDepth === 'number' && h.delegationDepth > 0) return true
    return false
  } catch (error) {
    return false
  }
}

// 哪些会话开着记忆。
// ⚠ 默认是「开」：装好就能用。某个会话不想用，把它单独关掉。
//   总开关一关，所有会话一律当关。
function isEnabled(sid) {
  if (!globalOn()) return false
  const c = loadCfg()
  const s = String(sid)
  const m = c.sessions
  if (m && typeof m === 'object' && Object.prototype.hasOwnProperty.call(m, s)) return !!m[s]
  // 兼容旧版：以前是「没配 = 全开」，那份白名单里的人继续开着
  if (Array.isArray(c.enabled) && c.enabled.indexOf(s) >= 0) return true
  return true
}

// 打开 / 关闭某个会话的记忆
function setEnabled(sid, on) {
  try {
    const c = loadCfg()
    const m = c.sessions && typeof c.sessions === 'object' ? Object.assign({}, c.sessions) : {}
    const s = String(sid)
    m[s] = !!on
    c.sessions = m
    // 老的白名单搬过来之后就不用了
    if (Array.isArray(c.enabled)) c.enabled = c.enabled.filter((x) => String(x) !== s)
    saveCfg(c)
    return Object.keys(m).filter((k) => m[k])
  } catch (error) {
    return []
  }
}

// 现在开着记忆的会话有哪些
function enabledList() {
  const c = loadCfg()
  const m = c.sessions && typeof c.sessions === 'object' ? c.sessions : {}
  return Object.keys(m).filter((k) => m[k])
}

// 一次性搬家：旧版「没配 = 全开」→ 新版「没配 = 关」。
// 把**已经存过记忆**的会话记成「开」，免得升级之后她的记忆突然不注入了 ✓
function migrateSwitch() {
  try {
    const c = loadCfg()
    if (c.switchMigrated) return
    const m = c.sessions && typeof c.sessions === 'object' ? Object.assign({}, c.sessions) : {}
    for (const sid of Array.isArray(c.enabled) ? c.enabled : []) m[String(sid)] = true
    try {
      for (const fn of readdirSync(STORE_DIR)) {
        if (!是会话文件(fn)) continue
        const sid = fn.replace(/\.json$/, '')
        if (m[sid] !== undefined) continue
        const d = 读库(sid)
        if (d && (d.memories || []).length) m[sid] = true
      }
    } catch (error) {}
    c.sessions = m
    c.switchMigrated = true
    saveCfg(c)
    报('开关搬家（默认改成关了，存过记忆的留开）：' + JSON.stringify(m))
  } catch (error) {}
}

export { DEFAULT_POLICY, POLICY_SPEC, clampNum, fitPolicy, 全局参数, 合并参数, loadCfg, saveCfg, globalOn, setGlobalOn, 是子代理, isEnabled, setEnabled, enabledList, migrateSwitch }
