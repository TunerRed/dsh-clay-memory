// 回复体检：用可解释的正则规则给助手回复打"AI 味"标签（observe 模式，不阻断、不改写）。
// 规则参考 FuckAIWords 的 22 类词面规则，按中文语料与本地场景重写；命中有置信度，
// 同一句式在历史里重复出现会抬高置信度。技术语境豁免"不是 A 而是 B"这类排查句式。
const MAX_EVIDENCE = 36

const TECH_CONTEXT =
  /报错|错误|异常|蓝屏|崩溃|配置|代码|参数|接口|版本|安装|驱动|端口|日志|编码|字符|管道|进程|服务|依赖|证书|显卡|内存|磁盘|路径|退出|重启|部署|编译|数据库|网络|怎么(办|弄|修|解决)|如何|为什么/

export const RULES = [
  {
    id: 'self-deprecation',
    label: '自贬/免责开场',
    re: /^(抱歉|对不起|不好意思)|作为(一个)?(AI|人工智能|模型)|我只是(一个)?(AI|模型)/,
    confidence: 0.45,
  },
  {
    id: 'formula-reversal',
    label: '公式化反转',
    re: /不是[^，。；！？]{0,24}[，,]?\s*而是|与其说[^，。；]{0,24}不如说|不只是[^，。；]{0,24}更是/,
    confidence: 0.55,
    techExempt: true,
  },
  {
    id: 'translationese',
    label: '翻译腔',
    re: /值得注意的是|需要指出的是|总的来说|换句话说|在某种程度上|让我们(来看看|一起来)|首先让我们/,
    confidence: 0.5,
  },
  {
    id: 'list-tone',
    label: '列表腔',
    re: /(^|\n)\s*(首先|其次|再次|最后|第一|第二|第三)[，,、]/,
    confidence: 0.6,
  },
  {
    id: 'stoic-refrain',
    label: '认命式套句',
    re: /该[^，。！？\n]{1,6}(的)?还是[^，。！？\n]{1,6}/,
    confidence: 0.5,
  },
  {
    id: 'stoic-refrain-2',
    label: '说教式收尾',
    re: /请(记住|相信|放心)|你要知道|说到底|归根结底|无论如何都要/,
    confidence: 0.5,
  },
  {
    id: 'opening-filler',
    label: '开场填充',
    re: /^(好的|好呀|当然|没问题|明白了|收到|行吧|行行行|行|好家伙|说实话|老实说)[，,！!。]/,
    confidence: 0.6,
  },
  {
    id: 'trailing-question',
    label: '结尾反问',
    re: /(你觉得呢|你怎么看|你说呢|对吧|是吧|要不要我.{0,10}|需要我.{0,8}吗)[？?。.!！]?\s*$/,
    confidence: 0.55,
    minLength: 5,
  },
  {
    id: 'lecture-tone',
    label: '讲课腔',
    re: /本质上|底层逻辑|核心在于|说白了|也就是说|从本质上讲|综上|总而言之/,
    confidence: 0.55,
    techExempt: true,
  },
  {
    id: 'punct-heavy',
    label: '标点过密',
    re: /[！!]{3,}|[？?]{3,}|\.{3,}/,
    skipCode: true,
    confidence: 0.5,
  },
  {
    id: 'dash-heavy',
    label: '破折号过密',
    re: /——/,
    density: { pattern: /——/g, min: 3 },
    confidence: 0.45,
  },
  {
    id: 'hedge-pile',
    label: '含糊词堆积',
    re: /(可能|或许|大概|似乎|也许)[^。]{0,12}(可能|或许|大概|似乎|也许)/,
    confidence: 0.45,
  },
  {
    id: 'admission-template',
    label: '认错式收尾',
    re: /([，,]\s*)?(我认|我接下了?|我承认)[。！!～~]?\s*$|这(句|个)(话)?我认/,
    confidence: 0.6,
  },
  {
    id: 'bit-ack',
    label: '硬接梗',
    re: /(那)?我收下了|这梗我接了|这个梗我接|这梗我懂|我懂这个梗|接住这个梗/,
    confidence: 0.6,
  },
  {
    id: 'fabricated-self-act',
    label: '虚构现实行为',
    re: /我(刚|刚才|刚刚)(在)?(玩手机|刷手机|躺着|吃完饭|下班|上班|睡觉)|我(正|现在)(在)?(玩手机|刷手机|吃饭|上班|躺着)|我(躺|趴)在(床|沙发)/,
    confidence: 0.7,
  },
  {
    id: 'comfort-slogan',
    label: '陪伴宣言',
    re: /我在这儿|我听着|我一直陪着你|我会一直陪着你|我一直都在|想听什么|想听啥|想聊啥|想要什么图|直接报歌名/,
    confidence: 0.55,
  },
  {
    id: 'harmful-comfort',
    label: '越界安慰',
    re: /不用再受罪|跟着你.{0,8}受罪|总算是解脱了|对它也是解脱/,
    confidence: 0.75,
  },
  {
    id: 'repair-promise',
    label: '认错后多余承诺',
    re: /[，,]\s*(我改|我会改|下次注意)[。！!]?\s*$|[，,]\s*改[。！!]?\s*$|刚才那句就当没说过[。！!]?/,
    confidence: 0.6,
  },
  {
    id: 'filler-template',
    label: '搭架子填充',
    re: /说实话|老实说|对我来说|得看[^，。！？\n]{0,8}怎么(定义|算|看)|看你怎么定义|关键在于|关键是|说白了|说穿了/,
    confidence: 0.5,
  },
  {
    id: 'concept-parse',
    label: '先拆词再答',
    re: /你说的?[^。！？\n]{1,12}(是指|指的是|是什么意思|指什么|是哪种|指哪种)|所谓的?[^。！？\n]{1,12}(是指|意思是)|这个词[^。！？\n]{0,12}(是指|的意思|怎么理解)|按(我|你)的理解/,
    confidence: 0.55,
  },
  {
    id: 'preset-agreement',
    label: '先附和再展开',
    re: /^(确实|我懂|看得出来|理解你|能理解|辛苦了|抱抱|摸摸)[，,。！!]?/,
    confidence: 0.55,
    minLength: 14,
  },
  {
    id: 'inline-tag-question',
    label: '句中口头禅',
    re: /[^，。！？\n]{2,12}(是吧|对吧)[。！]/,
    confidence: 0.5,
  },
  {
    id: 'sentence-uniform',
    label: '句长过于均匀',
    re: /^/,
    special: 'sentenceUniform',
    confidence: 0.4,
  },
]

export const EXTRA_RULES = [
  { id: 'repeated-opening', label: '重复开场' },
  { id: 'recent-act-reuse', label: '连续同类回应' },
  { id: 'emoji-every', label: '每条都带表情' },
]

/** 全部可开关的规则（正则规则 + 跨条规则）。 */
export const ALL_RULES = [...RULES.map((rule) => ({ id: rule.id, label: rule.label })), ...EXTRA_RULES]

export const RULE_LABELS = {
  ...Object.fromEntries(RULES.map((rule) => [rule.id, rule.label])),
  'repeated-opening': '重复开场',
  'recent-act-reuse': '连续同类回应',
  'emoji-every': '每条都带表情',
}

function sentenceLengths(text) {
  return text
    .split(/[。！？!?]+|[\n]{2,}/)
    .map((s) => s.trim().length)
    .filter((n) => n >= 2)
}

function evidenceOf(text, index, length) {
  const start = Math.max(0, index - 8)
  const end = Math.min(text.length, index + length + 12)
  return text.slice(start, end).replace(/\s+/g, ' ').slice(0, MAX_EVIDENCE)
}

/** 对话行为分类：用于统计"连续三条都是同一类回应"。 */
export function dialogueAct(text) {
  const t = String(text ?? '').trim()
  if (t === '') return 'empty'
  if (/^(嗯|哦|啊|哈|好|行|ok|OK|收到|在)\s*[。.!！~～]?$/.test(t)) return 'ack'
  if (/^(确实|对啊|就是|同意|有道理|没错|是这样的)/.test(t)) return 'agree'
  if (/[?？]\s*$/.test(t)) return 'ask'
  if (/笑死|绷|草|典|急了|乐|离谱|逆天|绝了|麻了|好家伙/.test(t)) return 'tease'
  return 'statement'
}

/** 去掉引用块与表格行：转述别人的话/表格内容不该算 AI 味。 */
export function stripQuoted(text = '') {
  const lines = String(text).split(/\n/)
  const kept = []
  let fence = false
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence
      continue
    }
    if (fence) continue
    const t = line.trim()
    if (t.startsWith('>')) continue
    if (/^\|.*\|$/.test(t)) continue
    kept.push(
      line
        .replace(/「[^」]*」/g, '')
        .replace(/『[^』]*』/g, '')
        .replace(/“[^”]*”/g, ''),
    )
  }
  return kept.join('\n')
}

export function analyzeText(text, { history = [], disabled = [] } = {}) {
  const body = stripQuoted(String(text ?? ''))
  if (body.trim() === '') return []
  const tech = TECH_CONTEXT.test(body)
  const noCode = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')
  const hits = []
  const off = disabled instanceof Set ? disabled : new Set(disabled)
  for (const rule of RULES) {
    if (off.has(rule.id)) continue
    if (rule.techExempt && tech) continue
    if (rule.minLength && body.length < rule.minLength) continue
    if (rule.special === 'sentenceUniform') {
      const lens = sentenceLengths(noCode)
      if (lens.length >= 5) {
        const mean = lens.reduce((a, b) => a + b, 0) / lens.length
        const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length)
        const cv = mean > 0 ? sd / mean : 0
        if (cv < 0.45) {
          hits.push({
            id: rule.id,
            label: rule.label,
            evidence: `句数 ${lens.length}，长度波动 ${Math.round(cv * 100)}%`,
            index: 0,
            confidence: rule.confidence,
          })
        }
      }
      continue
    }
    if (rule.density) {
      const count = (body.match(rule.density.pattern) ?? []).length
      if (count < rule.density.min) continue
    }
    const target = rule.skipCode ? noCode : body
    const m = rule.re.exec(target)
    if (!m) continue
    const repeatedCount = history.filter((h) => rule.re.test(String(h ?? ''))).length
    hits.push({
      id: rule.id,
      label: rule.label,
      evidence: rule.skipCode ? String(m[0]) : evidenceOf(body, m.index, m[0].length),
      index: m.index,
      confidence: repeatedCount >= 2 ? Math.min(0.9, rule.confidence + 0.25) : rule.confidence,
    })
  }
  return hits
}

/** 一批回复：逐条命中 + 跨条重复检测 + 汇总。 */
export function analyzeBatch(messages = [], { disabled = [] } = {}) {
  const items = []
  const history = []
  const rawTexts = []

  for (const message of messages) {
    const text = String(message.text ?? '')
    rawTexts.push(text)
    const hits = analyzeText(text, { history: history.slice(-4), disabled })
    items.push({
      sessionId: message.sessionId ?? '',
      seq: message.seq ?? 0,
      time: message.time ?? 0,
      length: text.length,
      text: text.slice(0, 200),
      hits,
      // 每百字命中数：短句里出现一次也不算重，便于横向比较
      score: text.length > 0 ? Math.round((hits.length / text.length) * 1000) / 10 : 0,
    })
    history.push(text)
  }

  // 跨条规则：同一开场 / 连续三条同类回应 / 每条都带表情
  const offAll = disabled instanceof Set ? disabled : new Set(disabled)
  let emojiRun = 0
  for (let i = 0; i < items.length; i += 1) {
    const current = items[i]
    const text = rawTexts[i]
    if (!text) continue

    emojiRun = /\p{Extended_Pictographic}/u.test(text) ? emojiRun + 1 : 0
    if (!offAll.has('emoji-every') && emojiRun === 4) {
      current.hits.push({
        id: 'emoji-every',
        label: '每条都带表情',
        evidence: '连续 4 条都含表情',
        index: 0,
        confidence: 0.5,
      })
    }

    const opening = text.replace(/\s+/g, ' ').replace(/^[\s#>*"'“”「」]+/, '').slice(0, 6)
    if (!offAll.has('repeated-opening') && opening.length >= 4 && i >= 1) {
      const prev = rawTexts[i - 1].replace(/\s+/g, ' ').replace(/^[\s#>*"'“”「」]+/, '').slice(0, 6)
      if (prev === opening) {
        current.hits.push({ id: 'repeated-opening', label: '重复开场', evidence: opening, index: 0, confidence: 0.6 })
        current.score = Math.round((current.hits.length / Math.max(1, current.length)) * 1000) / 10
      }
    }

    if (!offAll.has('recent-act-reuse') && i >= 2) {
      const acts = [dialogueAct(rawTexts[i - 2]), dialogueAct(rawTexts[i - 1]), dialogueAct(text)]
      if (acts[0] === acts[1] && acts[1] === acts[2] && ['agree', 'tease', 'ask', 'ack'].includes(acts[0])) {
        current.hits.push({
          id: 'recent-act-reuse',
          label: '连续同类回应',
          evidence: '连续三条都是 ' + acts[0],
          index: 0,
          confidence: 0.7,
        })
        current.score = Math.round((current.hits.length / Math.max(1, current.length)) * 1000) / 10
      }
    }
  }

  const perRule = {}
  let totalHits = 0
  for (const item of items) {
    for (const hit of item.hits) {
      perRule[hit.id] = (perRule[hit.id] ?? 0) + 1
      totalHits += 1
    }
  }
  return {
    messages: items,
    summary: {
      count: items.length,
      totalHits,
      perRule,
      hitRate:
        items.length > 0
          ? Math.round((items.filter((i) => i.hits.length > 0).length / items.length) * 1000) / 10
          : 0,
    },
  }
}
