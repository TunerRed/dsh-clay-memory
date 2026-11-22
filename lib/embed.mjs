// lib/embed.mjs —— 本地中文语义向量（P1-1 第一半：向量化 + 缓存）
//
// 2026-11-15 开：召回层 C 是纯词面，实测短问句和记忆陈述几乎零字面重合
//   （「我全名咋写」vs「ta叫沈知夏」、「喜欢吃什么」vs「盖浇饭/西红柿鸡蛋派」），
//   Cov 中位数 1.8%、81% 的句子低于 5%，gold 能排到 371/381。
//   这里补语义路：一条记忆一个 512 维向量，进库/改文时离线算，查询时算一次。
//
// 设计取舍（和 Gemini 对齐过）：
//   · 模型 bge-small-zh-v1.5（ONNX INT8，~24MB，512 维）—— BGE 专门做非对称检索
//     （短问句 → 长陈述事实），比对称 STS 系（text2vec）在「问句查事实」上强得多
//   · ⚠️ 2026-11-16 实测推翻「查询端必须加 Instruction 前缀」：官方那句
//     「为这个句子生成表示以用于检索相关文章：」在 bge-small-zh-v1.5 的 INT8 量化版上
//     **反而把排序搞坏**。主库 458 条、7 句真问句对照（MRR）：加指令 0.5744 / 不加 0.6916，
//     4 句更好、3 句持平、0 句更差。典型例子「还记得我喜欢吃什么吗」：目标条（西红柿鸡蛋派）
//     加指令 121 名 / 不加 4 名；且加了之后「说时间别看错」那条 0.5569 反超真答案 0.4095。
//     官方指令是给大模型（base/large）调的，小模型吃不住。所以**查询端也不加前缀**。
//   · 查询端的另一个坑：元话语（还记得/你知道/我说过）会被当成正文编码，把「还记得」
//     匹配到一堆「关于记忆系统本身」的元认知条目上 —— 见下面 清洗查询
//   · 模型懒加载：只有 CLAY_EMBED=1 且真的需要向量时才去 load，没开时零开销
//   · 向量缓存放 DSH_HOME 下（不进记忆 json，避免把库撑大十几倍）
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadCfg } from './cfg.mjs'
import { CFG_DIR } from './paths.mjs'

// BGE 官方中文检索指令（query 端专用）—— 2026-11-16 实测这个模型上加了更差，默认不用。
// 留着只为「换个模型想试试指令」时能一键打开（见 查询加指令）。
export const 检索指令 = '为这个句子生成表示以用于检索相关文章：'

// 实测开关：false = 查询端原样编码（默认）。想复验官方用法就改这里。
export const 查询加指令 = false

// 查询清洗：剥掉开头的元话语再编码。
// 为什么：「还记得我喜欢吃什么吗」原样编码时「还记得」把「关于记忆系统」的元认知条目
//   顶到前面（实测前 3 名是「记着整理可观测性 / 没有独立日记」这类），真答案排第 4；
//   剥成「我喜欢吃什么」之后真答案直接第 1。
// 只剥开头、只剥这些固定说法；剥完太短就退回原文（别把「记得带伞吗」剥成「带伞吗」那种真问句）。
const 开头元话语 = [
  /^(?:你|您)?(?:还)?(?:记不记得|记得|记着|知道|晓得|清楚)\s*/,
  /^(?:我)?(?:之前|上次)?(?:说过|提过|讲过|问过)\s*/,
  /^(?:你|您)?(?:还)?(?:记不记得|记得)(?:我|我们)?(?:之前|上次|说过|提过)?\s*/,
]

export function 清洗查询(文本) {
  const 原 = String(文本 || '').trim()
  if (!原) return 原
  let 剩 = 原
  for (const re of 开头元话语) 剩 = 剩.replace(re, '')
  剩 = 剩.replace(/^[，,、。：:\s]+/, '').trim()
  // 剥完至少还剩 4 个字才认，否则原文更可信
  return 剩.length >= 4 ? 剩 : 原
}

const 默认模型名 = 'Xenova/bge-small-zh-v1.5'
const 维度 = 512

// 懒加载的 pipeline（首用时才 init，避免没开语义召回也去碰模型文件）
let 管道 = null
let 加载失败原因 = null
let 模型目录 = null

// 配置里的名字（loadCfg 每次读文件，别缓存：设置页改完要立刻生效）
function 配置() {
  try {
    return loadCfg() || {}
  } catch {
    return {}
  }
}

export function 模型名() {
  const c = 配置()
  return String(c.语义模型 || 默认模型名)
}

// 语义召回开关：设置页「高级」里的开关（语义召回: true）优先，CLAY_EMBED=1 兜底
export function 语义开() {
  if (process.env.CLAY_EMBED === '1') return true
  try {
    return 配置().语义召回 === true
  } catch {
    return false
  }
}

export function 模型状态() {
  return { 名: 模型名(), 维度, 加载过: !!管道, 失败: 加载失败原因, 目录: 模型目录 }
}

// 设置模型缓存目录（init 时传 DSH_HOME/models，避免每次去 HuggingFace 拉）
export function 设模型目录(dir) {
  模型目录 = dir
}

// 模型目录：配置里的 模型目录 优先，其次调用方给的默认（DSH_HOME/models）
export function 取模型目录(默认) {
  const c = 配置()
  if (c.模型目录 && typeof c.模型目录 === 'string' && c.模型目录.trim()) return c.模型目录.trim()
  return 默认 || 模型目录
}

async function 取管道() {
  if (管道) return 管道
  if (加载失败原因) return null
  try {
    // @huggingface/transformers 是 onnxruntime-node 的上层封装，负责 tokenizer + 前处理
    const { pipeline, env } = await import('@huggingface/transformers')
    const 目录 = 取模型目录(join(CFG_DIR, 'models'))
    if (目录) {
      mkdirSync(目录, { recursive: true })
      env.cacheDir = 目录
      env.localModelPath = 目录
      env.allowRemoteModels = true
    }
    模型目录 = 目录
    管道 = await pipeline('feature-extraction', 模型名(), { quantized: true })
    return 管道
  } catch (e) {
    // 失败原因要说人话：最常见的是「没装依赖」和「模型文件不全」，笼统报个英文栈谁都看不懂
    const 原文 = String((e && e.message) || e)
    if (/Cannot find package '@huggingface/.test(原文)) {
      加载失败原因 =
        '缺依赖：插件目录里没装 @huggingface/transformers。在插件目录执行 `npm i @huggingface/transformers` 后重试（这个包会连带装 onnxruntime，约 300MB）。'
    } else if (/Cannot find package 'onnxruntime/.test(原文) || /onnxruntime/.test(原文)) {
      加载失败原因 = '缺依赖：onnxruntime 没装好（装 @huggingface/transformers 会自动带上）。'
    } else if (/Cannot find package/.test(原文)) {
      加载失败原因 = '缺依赖：' + 原文
    } else {
      加载失败原因 = '加载失败：' + 原文
    }
    return null
  }
}

// 下载状态（给设置页「下载默认模型」按钮轮询用）
let 下载中 = false
let 下载结果 = null

export function 下载状态() {
  return { 下载中, 结果: 下载结果, 失败: 加载失败原因 }
}

// 触发一次模型加载/下载（首次会从 HuggingFace 拉 ~24MB）。
// 返回 {ok, 错误?}；失败原因落进 加载失败原因。
export async function 下载模型() {
  if (管道) return { ok: true, 已存在: true }
  if (下载中) return { ok: true, 进行中: true }
  下载中 = true
  下载结果 = null
  try {
    const p = await 取管道()
    if (p) {
      下载结果 = { ok: true, 目录: 模型目录, 名: 模型名() }
      return { ok: true }
    }
    下载结果 = { ok: false, 错误: 加载失败原因 }
    return { ok: false, 错误: 加载失败原因 }
  } finally {
    下载中 = false
  }
}

// 输入单句 → 归一化后的 512 维向量（Float32Array）
async function 向量化(文本, 是查询) {
  const p = await 取管道()
  if (!p) return null
  // 查询端：先剥元话语，再按开关决定加不加官方指令；事实端原样编码。
  const 输入 = 是查询
    ? (查询加指令 ? 检索指令 : '') + 清洗查询(文本)
    : String(文本 || '')
  const out = await p(输入, { pooling: 'mean', normalize: true })
  // transformers.js 返回 Tensor；.data 是 Float32Array
  const data = out && out.data ? out.data : out
  return data instanceof Float32Array ? data : Float32Array.from(data)
}

// 一批文本 → 归一化向量数组（查询模式加指令前缀）
export async function 向量化批(文本们, { 查询 = false, 批大小 = 8 } = {}) {
  const 结果 = []
  for (let i = 0; i < 文本们.length; i += 批大小) {
    const 片 = 文本们.slice(i, i + 批大小)
    for (const t of 片) 结果.push(await 向量化(t, 查询))
  }
  return 结果
}

// 余弦相似度（向量已归一化，点积即余弦）
export function 余弦(a, b) {
  if (!a || !b) return 0
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

// ---------- 向量缓存 ----------
// 每条记忆一个向量，用「内容指纹」校验：text / tags / related 变了才重算。
// 指纹算法和 lib/meter.mjs 的 文本指纹 同源（FNV-1a 32 位），保持代码库一致。
export function 文本指纹(s) {
  const 文 = String(s || '')
  let h = 2166136261
  for (let i = 0; i < 文.length; i++) {
    h ^= 文.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

// 记忆的向量指纹：只认「语义上会影响向量」的字段
export function 记忆指纹(m) {
  const 文 = String((m && m.text) || '')
  const 标 = Array.isArray(m && m.tags) ? m.tags.join('\u0001') : ''
  const 关 = Array.isArray(m && m.related) ? m.related.join('\u0001') : ''
  return 文本指纹(文 + '\u0001' + 标 + '\u0001' + 关)
}

function 缓存路径(家) {
  return join(家, 'clay-memory', 'embeddings.json')
}

function 读缓存(家) {
  try {
    const p = 缓存路径(家)
    if (!existsSync(p)) return {}
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function 写缓存(家, 缓存) {
  try {
    const p = 缓存路径(家)
    mkdirSync(dirname(p), { recursive: true })
    const 临时 = p + '.tmp'
    writeFileSync(临时, JSON.stringify(缓存), 'utf8')
    renameSync(临时, p)
  } catch {}
}

// 给一批记忆算向量（有缓存就用缓存，指纹变了才重算）。
// 返回 Map<记忆id, { 指纹, 向量 }>，同时把新向量落盘。
export async function 取向量(记忆们, 家) {
  if (!语义开()) return new Map()
  const 缓存 = 读缓存(家)
  const 结果 = new Map()
  const 要算 = []
  for (const m of 记忆们) {
    if (!m || !m.id) continue
    const 指纹 = 记忆指纹(m)
    const 老 = 缓存[String(m.id)]
    if (老 && 老.指纹 === 指纹 && Array.isArray(老.向量) && 老.向量.length === 维度) {
      结果.set(String(m.id), Float32Array.from(老.向量))
    } else {
      要算.push({ m, 指纹 })
    }
  }
  if (!要算.length) return 结果

  const 向量们 = await 向量化批(要算.map((x) => x.m.text), { 查询: false })
  let 变 = false
  for (let i = 0; i < 要算.length; i++) {
    const v = 向量们[i]
    if (!v) continue
    结果.set(String(要算[i].m.id), v)
    缓存[String(要算[i].m.id)] = { 指纹: 要算[i].指纹, 向量: Array.from(v) }
    变 = true
  }
  if (变) 写缓存(家, 缓存)
  return 结果
}

// 查询向量（加 BGE 检索指令前缀）
export async function 取查询向量(文本) {
  if (!语义开()) return null
  return 向量化(文本, true)
}

// ---------- 同步接口（给 systemPrompt.context 的 text 回调用） ----------
// text() 是**同步**函数，里面不能 await。所以向量提前在下游算好：
//   · 记忆向量：进库/改文时算，落在 embeddings.json 里
//   · 查询向量：收到用户消息时就异步开始算（见 lib/index.js 的 inbox 钩子）
// 这里只做「读缓存 + 点积」，纯内存，几十微秒。
export function 同步向量(家) {
  const 缓存 = 读缓存(家)
  const 表 = new Map()
  for (const [id, v] of Object.entries(缓存)) {
    if (v && Array.isArray(v.向量) && v.向量.length === 维度) {
      表.set(String(id), Float32Array.from(v.向量))
    }
  }
  return 表
}

// 查询向量 × 一批记忆 → Map<记忆id, 余弦>。向量还没算出来的记 0。
export function 相似度表(查询向量, 记忆们, 家) {
  if (!查询向量) return null
  const 表 = 同步向量(家)
  const 结果 = new Map()
  for (const m of 记忆们) {
    if (!m || !m.id) continue
    const v = 表.get(String(m.id))
    结果.set(String(m.id), v ? 余弦(查询向量, v) : 0)
  }
  return 结果
}
