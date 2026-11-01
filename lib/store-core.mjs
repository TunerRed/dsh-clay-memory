// 核心读写层：JSON 双层库读/写/代际/自愈 + SQLite 镜像同步 —— 2026-10-30 从 index.js 抽出（拆层工程第 6c 批）
// 依赖注入：报 = 诊断日志，由 index.js 注入。
import { readFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, constants } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { STORE_DIR, storePath, factPath, 是会话文件, FACTS_NAME, 工作区文件, 工作区文件旧, 工作区文件id, 会话工作区, 规范化 } from './paths.mjs'
import { 合并参数 } from './cfg.mjs'
import { 读追溯 } from './trace-log.mjs'
import { 条签名, memSig, lastSig, backupFile } from './backup.mjs'
import { 读SQL视图, 读SQL视图同步, 库文件路径, 比对视图, 取SQLite模块, 确保镜像表, 记镜像有货, 镜像主键是新模型, 重建镜像表 } from './storage.js'
import { 合并库 } from './store-merge.mjs'
import { writeFileAtomicSync } from './atomic-file.mjs'

let 报 = null
/** index.js 在 import 后调用：注入诊断日志函数 */
export function 接报信(fn) { if (typeof fn === 'function') 报 = fn }

function blank() {
  // factsPurgeEpoch：全局事实库的代际。跟 purgeEpoch 一样是**普通字符串字段** ——
  // 上层会 JSON 克隆整份数据（copy-to / 分支继承），藏在 Symbol 或 WeakMap 里的东西会丢，
  // 写成字段才跟着走 ✓
  return { version: 2, purgeEpoch: '', factsPurgeEpoch: '', policy: 合并参数(null), memories: [], traces: [], deleted: [] }
}

// 老库没有这一字段，视为初始代际；不保留被清理的内容或 id。
const purgeEpochOf = (data) => typeof data?.purgeEpoch === 'string' ? data.purgeEpoch : ''
// 全局事实库的代际。缺这个字段 = 这次写入的来路不认识分层（老快照 / 手搓对象），
// 调用方要按「不校验」处理，而不是当成空代际去误判 MEMORY_PURGED。
const 事实代际 = (data) => typeof data?.factsPurgeEpoch === 'string' ? data.factsPurgeEpoch : ''
// 工作区库的代际（1.8.37 新增）。缺字段 = 来路不认识工作区层 → 按「不校验」处理。
const 工作区代际 = (data) => typeof data?.workspacePurgeEpoch === 'string' ? data.workspacePurgeEpoch : ''

// 只有本次确实读到坏 JSON 的空快照能恢复它；旧任务不能借文件损坏绕过代际。
// 凭据只跟随这个对象（显式跨会话复制除外），不写入 JSON，也不充当跨进程锁。
// ⚠ 1.4.0：一个合并视图背后是**两份**文件 → 凭据按路径存：WeakMap<对象, Map<路径, 快照>>
const corruptSnapshots = new WeakMap()
// 同一模块实例已观察到的损坏事件；一次成功恢复会同时失效所有兄弟候选。
// 不同 HMR 实例或未观察的外部文件回滚仍需要独立的权威记录，不能靠字节辨别。
const corruptIncidents = new Map()

// 1.8.39 A：记忆条目级 Schema 校验（GPT 任务书）。
//   原则：只验「写回会破坏数据」的关键形状，不补默认值、不迁就坏数据、不查历史字段杂项
//   （emotion/tags 等 1.3.7 老形状五花八门，不在本轮范围）。字段缺失不报错（历史版本允许没有
//   新字段）；字段**在**但类型错 → 报毒。报告尽量带数组位置与条目 id，方便定位。
function 验活条目(m, i) {
  const 位 = 'memories 第 ' + (i + 1) + ' 条'
  const id = m.id
  if (typeof id !== 'string' || !id.trim()) return 位 + ' 缺非空字符串 id（实际 ' + JSON.stringify(id) + '）'
  const t = m.text
  if (typeof t !== 'string' || !t.trim()) return 位 + '（id=' + id + '）缺非空文本 text'
  if (m.importance !== undefined && typeof m.importance !== 'number') return 位 + '（id=' + id + '）importance 不是数字'
  // at 允许 null：「没记住时间」是合法语义——/import/apply 写的就是 `at: it.at || null`（源码注释
  //   「猜不到就 null，绝不编」）。2026-10-31 实机导入 5 条时被这条拦下：插件自己写的条目被自己判毒，
  //   整个会话库读成空、页面上一条看不到。空串/对象/数组仍然算坏类型（那不是「没时间」，是数据错了）。
  if (m.at !== undefined && m.at !== null && typeof m.at !== 'string' && typeof m.at !== 'number') return 位 + '（id=' + id + '）at 不是时间戳'
  if (m.createdAt !== undefined && typeof m.createdAt !== 'string' && typeof m.createdAt !== 'number') return 位 + '（id=' + id + '）createdAt 不是时间戳'
  for (const k of ['scope', 'category', 'type', 'status']) if (m[k] !== undefined && typeof m[k] !== 'string') return 位 + '（id=' + id + '）' + k + ' 不是字符串'
  for (const k of ['evidence', 'related']) if (m[k] !== undefined && !Array.isArray(m[k])) return 位 + '（id=' + id + '）' + k + ' 不是数组'
  return ''
}
function 验墓碑(d, i) {
  const 位 = 'deleted 第 ' + (i + 1) + ' 条'
  const id = d.id
  if (typeof id !== 'string' || !id.trim()) return 位 + ' 缺非空字符串 id（实际 ' + JSON.stringify(id) + '）'
  if (d.deletedAt === undefined || (typeof d.deletedAt !== 'string' && typeof d.deletedAt !== 'number')) return 位 + '（id=' + id + '）deletedAt 必须存在且是时间戳（实际 ' + JSON.stringify(d.deletedAt) + '）'
  return ''
}
function 查重id(列, 名) {
  const 见 = new Set()
  for (const m of 列) {
    if (!m) continue
    if (见.has(m.id)) return 名 + ' 里重复 id：' + String(m.id) + '（不同记录不得静默合并）'
    见.add(m.id)
  }
  return ''
}

// 读**单份**库文件（会话库 / 全局事实库通用）。坏 JSON 的自愈逻辑跟 1.3.7 一字不差，
// 只是全部按 `path` 记账 —— 两份文件各自损坏、各自恢复，互不借用凭据。
function 读一份(path) {
  try {
    const bytes = readFileSync(path)
    let raw
    try {
      raw = JSON.parse(bytes.toString('utf8'))
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      let incident = corruptIncidents.get(path)
      if (!incident || !incident.bytes.equals(bytes)) {
        incident = { bytes }
        corruptIncidents.set(path, incident)
      }
      const data = blank()
      data.purgeEpoch = randomUUID()
      corruptSnapshots.set(data, new Map([[path, { path, bytes, epoch: data.purgeEpoch, incident }]]))
      return data
    }
    corruptIncidents.delete(path)
    // GPT 整改 P1（读失败与空库语义分离）：JSON 能解析但结构不是记忆库形状
    // （null / 数组 / 数字等）→ 毒快照。不能当空库：上层拿它写回会清空盘上内容。
    const 毒 = (为什么) => {
      const data = blank()
      data.purgeEpoch = randomUUID()
      corruptSnapshots.set(data, new Map([[path, { path, epoch: data.purgeEpoch }]]))
      报('记忆库结构不合法（' + 为什么 + '，当作已损坏、拒绝写回）：' + path)
      return data
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return 毒('整体不是对象')
    }
    // GPT 整改 P1-②（1.8.38）：按版本校验结构。合法 JSON 对象不一定是合法记忆库——
    //   缺 memories 的 {version:2,policy:{}} 绝不能静默当空库写回（会清空盘上记忆）。
    const 版 = raw.version
    if (版 === undefined) {
      // 1.3.7 老库：无 version 是历史合法形状（既有迁移 = 归一化后按 version 2 语义读）。
      //   memories 是老库的必需字段：缺了同样判损坏，不允许当空库覆盖。
      if (!Array.isArray(raw.memories)) return 毒('老库缺 memories 或不是数组')
      // 1.8.39 A：老库也保底查「对象 + 非空 id/text + 不重复 id」——条目级坏数据同样不能静默合并；
      //   不做 version 2 全字段类型校验（老条目形状杂，任务书明确不得拿新 Schema 卡历史版本）。
      for (let i = 0; i < raw.memories.length; i++) {
        const m = raw.memories[i]
        if (m === null || typeof m !== 'object' || Array.isArray(m)) return 毒('老库 memories 里有非对象条目（第 ' + (i + 1) + ' 条）')
        if (typeof m.id !== 'string' || !m.id.trim()) return 毒('老库 memories 第 ' + (i + 1) + ' 条缺非空字符串 id')
        if (typeof m.text !== 'string' || !m.text.trim()) return 毒('老库 memories 第 ' + (i + 1) + ' 条（id=' + String(m.id) + '）缺非空文本 text')
      }
      const 重 = 查重id(raw.memories, 'memories')
      if (重) return 毒('老库 ' + 重)
    } else if (版 === 2) {
      // 当前版本必需字段：memories / deleted 缺一不可（deleted 缺失 = 写回会丢墓碑、已删记忆复活）
      if (!Array.isArray(raw.memories)) return 毒('version 2 缺 memories 或不是数组')
      if (!Array.isArray(raw.deleted)) return 毒('version 2 缺 deleted 或不是数组')
      // 条目必须是对象（正常写路径永远产对象；出现 null/数字/字符串 = 盘上被外部改坏）
      for (let i = 0; i < raw.memories.length; i++) {
        const m = raw.memories[i]
        if (m === null || typeof m !== 'object' || Array.isArray(m)) return 毒('memories 里有非对象条目（第 ' + (i + 1) + ' 条）')
        const 坏 = 验活条目(m, i)
        if (坏) return 毒(坏)
      }
      const 重 = 查重id(raw.memories, 'memories')
      if (重) return 毒(重)
      for (let i = 0; i < raw.deleted.length; i++) {
        const d = raw.deleted[i]
        if (d === null || typeof d !== 'object' || Array.isArray(d)) return 毒('deleted 里有非对象条目（第 ' + (i + 1) + ' 条）')
        const 坏 = 验墓碑(d, i)
        if (坏) return 毒(坏)
      }
      const 重坟 = 查重id(raw.deleted, 'deleted')
      if (重坟) return 毒(重坟)
    } else {
      return 毒('未知版本 ' + JSON.stringify(版))
    }
    return {
      version: 2,
      purgeEpoch: purgeEpochOf(raw),
      factsPurgeEpoch: '',
      wsRoot: typeof raw.wsRoot === 'string' ? raw.wsRoot : '', // 工作区库的自我身份（1.8.38 起用于校验）
      policy: 合并参数(raw.policy),
      memories: Array.isArray(raw.memories) ? raw.memories : [],
      traces: Array.isArray(raw.traces) ? raw.traces : [],
      deleted: Array.isArray(raw.deleted) ? raw.deleted : [],
    }
  } catch (error) {
    if (error?.code === 'ENOENT') corruptIncidents.delete(path)
    // 架构师审查 #8 + GPT 整改 P1：EACCES / EBUSY / EIO 返回**毒快照**而不是空库。
    //   blank + 随机代际 + corruptSnapshots 凭据 → saveStoreJSON 开头检测到凭据就
    //   拒绝写回（含 raw 真销毁路径），镜像同步 / 全量回填也会跳过。
    //   读失败绝不会被当「没有记忆」写盘，也不会把镜像 DELETE 成空。
    if (error?.code !== 'ENOENT') {
      报('读库失败（本次当作不可写快照，拒绝写回）：' + path + ' → ' + String(error?.code || error))
      const data = blank()
      data.purgeEpoch = randomUUID()
      corruptSnapshots.set(data, new Map([[path, { path, epoch: data.purgeEpoch }]]))
      return data
    }
    return blank()
  }
}

// 两层合起来看：**事实在前、事件在后**；删除墓碑两边都认（删了就是删了）。
//   · policy / traces / purgeEpoch 仍归会话库（库级参数、召回历史都是「这个会话」的）
//   · 同一个 id 两边都有 → 只认事实库那份（迁移时故意不删原库副本，读的时候按这个去重）
//   · **同一条事实换了 id**（两个会话各自记了一遍同一句话）→ 事实库那份优先，
//     会话里那份不再重复露脸；数据都还在，只是眼前只看见一条（按归一化文本比）
function 事实文(m) {
  return String((m && m.text) || '').normalize('NFKC').replace(/[\s\u200b\u200c\u200d\ufeff]+/g, ' ').trim().toLowerCase()
}


// ⭐ C 轮 S3-①（2026-10-29）：注入组的读切换
//
//   注入是每轮都跑的热路径，也是最想甩掉「读整份 JSON + 解析」的地方。
//   默认仍走 JSON（CLAY_SQL_READ=1 才用 SQLite），因为 traces / policy 还在 JSON 里，
//   只把 memories 换成 SQL 读 —— 等 traces 单独拆表后才算真正切换完。
// ⭐ C 轮 S3-②（2026-10-29）：召回记录（traces）单独存
//
//   以前每次注入都 push 一条 trace 再 saveStore(sid, data) —— 等于**每轮把整库读进来又写回去**，
//   而 traces 只是「这一轮回想起什么」的账本，跟记忆本身无关。
//   现在它单独一个 .jsonl：只追加一行，注入路径不再写整库。

function 读注入数据(sid) {
  if (process.env.CLAY_SQL_READ !== '1' || 镜像不可用) return loadStoreJSON(sid)
  const 壳 = loadStoreJSON(sid)
  const 视图 = 读SQL视图同步(库文件路径(STORE_DIR), sid, 规范化(会话工作区(sid)))
  if (!视图) return 壳
  return Object.assign({}, 壳, { memories: 视图.memories })
}

function loadStoreJSON(sid, 工作区) {
  const 自己 = 读一份(storePath(sid))
  const 事实 = 读一份(factPath())
  // GPT 整改 P2（workspace 三层 scope）：工作区记忆 = 同 cwd 跨会话共享的项目知识。
  //   显式传 cwd 优先（测试 / 调用方自知）；缺省按宿主 projcache 解析，解析不到就不读这层。
  const ws根 = 规范化(工作区 || 会话工作区(sid))
  // 1.8.38：文件名哈希化后不再有碰撞；旧消毒名文件仍可读（升级兼容），写只写新名。
  const ws文件 = 工作区文件(ws根)
  const ws文件旧 = 工作区文件旧(ws根)
  let 工区文件 = ''
  if (ws文件 && existsSync(ws文件)) 工区文件 = ws文件
  else if (ws文件旧 && ws文件旧 !== ws文件 && existsSync(ws文件旧)) 工区文件 = ws文件旧
  let 工区 = 工区文件 ? 读一份(工区文件) : null
  // wsRoot 校验：文件里记的工作区身份与当前 cwd 对不上 = 别的库放错了位置，拒绝当作本工作区数据。
  // 1.8.39 B：比较前两边都走 规范化（Windows 大小写不敏感，旧 1.8.38 文件里的大写 wsRoot 仍被认）。
  if (工区 && typeof 工区.wsRoot === 'string' && 工区.wsRoot && 规范化(工区.wsRoot) !== ws根) {
    报(`工作区库 wsRoot 不匹配（文件=${工区文件}，文件内=${工区.wsRoot}，当前=${ws根}），跳过不读`)
    工区 = null
  }
  const 已见 = new Set()
  const 已见文 = new Map() // 归一化文本 → 先出现的那条事实（用来合并「同文不同 id」的重复）
  const memories = []
  const 坟们 = new Map() // 两边墓碑按 id 并集（同一条事实两边都有墓碑时只留一份，别越读越胖）
  for (const m of [...(事实.memories || []), ...((工区 && 工区.memories) || []), ...(自己.memories || [])]) {
    if (!m) continue
    const id = String(m.id)
    if (已见.has(id)) continue
    if (m.category === 'stable_profile') {
      const 文 = 事实文(m)
      if (文) {
        if (已见文.has(文)) continue
        已见文.set(文, m)
      }
    }
    已见.add(id)
    memories.push(m)
  }
  for (const m of [...(自己.deleted || []), ...(事实.deleted || []), ...((工区 && 工区.deleted) || [])]) {
    if (!m) continue
    const id = String(m.id)
    if (!坟们.has(id)) 坟们.set(id, m)
  }
  const 合并 = {
    version: 2,
    purgeEpoch: purgeEpochOf(自己), // 会话库的代际（1.3.7 语义原样）
    factsPurgeEpoch: purgeEpochOf(事实), // 全局事实库的代际（1.4.0 新增）
    workspacePurgeEpoch: 工区 ? purgeEpochOf(工区) : '', // 工作区库的代际（1.8.37 新增）
    policy: 自己.policy,
    memories: memories.filter((m) => !坟们.has(String(m.id))),
    // traces：库里残留的旧记录 + 新追加的 .jsonl（越靠后越新）
    traces: (Array.isArray(自己.traces) ? 自己.traces : []).concat(读追溯(sid)).slice(-30),
    deleted: [...坟们.values()],
  }
  // 三份可能同时坏：把各自的恢复凭据都挂到合并视图上（saveStore 认哪份就查哪份）
  const 凭据们 = new Map()
  for (const 份 of [自己, 事实, 工区]) {
    if (!份) continue
    const m = corruptSnapshots.get(份)
    if (m) for (const [p, s] of m) 凭据们.set(p, s)
  }
  if (凭据们.size) corruptSnapshots.set(合并, 凭据们)
  return 合并
}

function adoptTargetEpoch(copy, target) {
  copy.purgeEpoch = purgeEpochOf(target)
  copy.factsPurgeEpoch = 事实代际(target)
  copy.workspacePurgeEpoch = typeof target?.workspacePurgeEpoch === 'string' ? target.workspacePurgeEpoch : ''
  const corrupt = corruptSnapshots.get(target)
  if (corrupt) corruptSnapshots.set(copy, new Map(corrupt))
}

function backupCorruptStore(path) {
  const base = path + '.corrupt-' + new Date().toISOString().replace(/[:.]/g, '-')
  for (let i = 0; ; i++) {
    try {
      copyFileSync(path, base + (i ? '-' + i : ''), constants.COPYFILE_EXCL)
      return
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
}

// ---------- ⭐ 写库前合并（2026-10-24 修「记忆会静默丢失」）----------
//
// 事故：用户报「连着记两条，第二条几秒后从库里消失，没有任何报错」。
// 真因：自动扩词是「读整份 → await 模型（几秒）→ 整份写回」——
//   等模型那几秒里别人新记的记忆，被它那句 writeFileSync 用**旧快照**盖掉了 ✗
//   同样的写法还有提炼 / 扩词 / 补标 / 洗称呼（它们跑得更久，更容易吞掉新记忆）。
//
// 修法：**写之前把盘上现在的内容读回来，按 id 合并**，而不是整份覆盖。
//   · 记忆按 id 取并集；同一条两边都有 → 取「更新时间更晚」的那份
//   · 「已删」按 id 取并集 —— **删除优先**：进了已删的不会被复活
//   · 只有明确的找回操作可以移除删除标记，旧快照里的 memories 不能表示找回
//   · 召回记录按时间合并，只留最近 100
// ⚠ 真销毁（清空已删 / 彻底删一条）不能让合并把它们捡回来 —— 那两处走 raw（见 saveStore）

// 读回**某一份**库文件，顺手把「坏 JSON 自愈」的判定做掉。
//   data 是调用方手里那份视图 —— corruptSnapshots 的凭据挂在它身上（按路径查）。
//   期望代际 = 调用方认为这一份该有的代际（会话库 purgeEpoch / 事实库 factsPurgeEpoch）。
function 读盘校验(path, data, 期望代际) {
  let bytes, 盘 = null, recoveryEpoch
  try {
    bytes = readFileSync(path)
  } catch (error) {
    // I/O 失败不等于 JSON 损坏；不能备份不明内容或覆盖原件。
    if (error?.code !== 'ENOENT') throw new Error('无法读取当前记忆库，本次未写入', { cause: error })
    corruptIncidents.delete(path)
  }
  if (bytes !== undefined) {
    try {
      盘 = JSON.parse(bytes.toString('utf8'))
      corruptIncidents.delete(path)
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      const incident = corruptIncidents.get(path)
      if (incident && !incident.bytes.equals(bytes)) corruptIncidents.delete(path)
      const 候 = corruptSnapshots.get(data)?.get(path)
      if (!候 || 候.incident !== corruptIncidents.get(path) ||
          !候.bytes.equals(bytes) || 候.epoch !== 期望代际) {
        throw new Error('记忆库已损坏或内容已变化，本次旧任务未写入，请重新运行')
      }
      // 精确保留坏文件原件，撞名不覆盖；备份失败则不进入原子写入。
      backupCorruptStore(path)
      recoveryEpoch = 候.epoch
    }
  }
  return { 盘, epoch: recoveryEpoch ?? purgeEpochOf(盘), 有文件: bytes !== undefined }
}

function 已清理错() {
  const error = new Error('记忆库已彻底清理，本次旧任务未写入，请重新运行')
  error.code = 'MEMORY_PURGED'
  return error
}


// 墓碑归哪一边？（归属只影响写进哪个文件；读的时候两边墓碑取并集，所以猜错也不会漏删）
//   · 墓碑自己记着它是事实（batchdelete 会把 category 一起推进去）→ 事实
//   · 调用方这次按事实份交上来的 id → 事实
//   · 调用方这次按会话份交上来的 id → 会话
//   · 盘上的事实库里还有这个 id（事实被硬删/被清）→ 事实
//   · 其余 → 会话（保守：宁可多留一份墓碑，也别把事实的墓碑写丢）
function 坟归事实(d, 事实ids, 会话ids, 盘事实ids) {
  if (!d) return false
  if (d.category === 'stable_profile') return true
  const id = String(d.id)
  if (事实ids.has(id)) return true
  if (会话ids.has(id)) return false
  return 盘事实ids.has(id)
}

// 墓碑归工作区？（1.8.39 回归发现的幽灵墓碑 bug 修复）
//   · 墓碑自己记着它是 workspace（删除时 category 会跟着推进去）→ 工区
//   · id 出现在事实/会话活层（改判出 workspace 的场景）→ 跟活层走，不归工区
//   · 其余（category=event 的普通墓碑）→ 会话份，**绝不能进工区**——
//     旧判据「id 不在事实层也不在会话层」会把刚删的会话条目误判成工作区墓碑写进 _ws-* 文件，
//     之后 restore 只清会话文件、清不掉工区文件里的幽灵墓碑 → 活条目被自己的墓碑过滤（假找回）。
function 坟归工区(d, 事实ids, 会话ids) {
  if (!d || d.category !== 'workspace') return false
  const id = String(d.id)
  if (事实ids.has(id)) return false
  if (会话ids.has(id)) return false
  return true
}

// ---------- ⭐ 双层库的写入（1.4.0）----------
//
// 事实（stable_profile）进 `<DSH_HOME>/clay-memory/_facts.json`，跨工作区/会话共享；
// 事件留在 `<sid>.json`。所以一次 saveStore 要**拆成两份**、各自走一遍
// 「读盘 → 合并 → 校验代际 → 原子写」—— 拆开写还拿另一份的盘内容去合并，等于假合并 ✗
//
// ⚠ 全程**同步**，中间一个 await 都没有。Node 单线程 + 同步 I/O 是这套库唯一的并发保护：
//   一旦在两次写之间让出事件循环，别的任务就能插进来看见「事实写了、事件没写」的半截状态。
// ⭐ C 轮 S2：存储后端抽象
//
//   以前 loadStore / saveStore 直接读写 JSON 文件，调用点到处是（43 / 39 处）。
//   现在它们只剩一层皮：真正的读写由 存储后端 决定。
//   默认还是 JSON（行为一个字没变）；S3 按组切换时只换这里的实现，调用点不用动。
const 存储后端 = {
  // ⚠ S3-⑤ 回滚（2026-10-29）：曾经让这里在 CLAY_SQL_READ=1 时走 SQL 视图，
  //   结果 saveStore 拿到的是镜像里的旧快照，写回 JSON 就把主库削掉了
  //   （事实从 68 条掉到 43 条，靠 .bak 才捞回来）。
  //   结论：**读切 SQL 只能给只读路径用**（注入），写路径必须读 JSON 主库。
  读: (sid, 工作区) => loadStoreJSON(sid, 工作区),
  写: (sid, data, 选项, 工作区) => saveStoreJSON(sid, data, 选项, 工作区),
}

// 工作区 是可选第二/四参：会话内能解析出 cwd 时由路由透传，解析不出就空（不读工作区层）。
function loadStore(sid, 工作区) {
  return 存储后端.读(sid, 工作区)
}

function saveStore(sid, data, 选项, 工作区) {
  return 存储后端.写(sid, data, 选项, 工作区)
}

/** S3 写路径：把这次要落盘的内容同步进 SQLite 镜像。
 *  JSON 仍是主库（读还是它），SQL 是「全等的只读镜像」——
 *  这样影子比对能持续盯着两边是否一致，等全等稳定了再把读切过去。 */
let 镜像不可用 = false
function 同步SQL镜像(sid, 事实们, 会话们, 事实坟, 会话坟, ws根, 工区们, 工区坟) {
  const sq = 取SQLite模块()
  if (!sq || !sq.DatabaseSync) return
  let db = null
  try {
    db = new sq.DatabaseSync(库文件路径(STORE_DIR))
    // 表没建过就建（新装机 / 删过库文件的情况）—— 建不出来直接抛，让上层标记镜像不可用
    if (!确保镜像表(db)) throw new Error('镜像表建不出来')
    // 1.8.29：旧主键（id 全局唯一）会把跨会话的同 id 副本互相挤掉 —— 重建后全量回填
    if (!镜像主键是新模型(db)) {
      if (!重建镜像表(db)) throw new Error('镜像表重建不出来')
      try { db.exec("delete from kv where k = 'mirrored'") } catch (e) {}
      db.close()
      db = null
      报('镜像主键旧模型 → 已重建，触发全量回填')
      全量回填镜像()
      return
    }
    let 序 = 0
    // GPT 整改 P2（inference）：推测专属字段不进主列，打包进 extra_json（json/sql 两侧形状一致）
    const 打包推理 = (m) => {
      if (!m || m.type !== 'inference') return null
      const 包 = {}
      if (Array.isArray(m.evidence)) 包.evidence = m.evidence
      if (typeof m.confidence === 'string') 包.confidence = m.confidence
      if (typeof m.status === 'string') 包.status = m.status
      if (typeof m.推断域 === 'string') 包.推断域 = m.推断域
      if (typeof m.provenance === 'string') 包.provenance = m.provenance
      if (typeof m.confirmedAt === 'string') 包.confirmedAt = m.confirmedAt
      if (typeof m.rejectedAt === 'string') 包.rejectedAt = m.rejectedAt
      return JSON.stringify(包)
    }
    const 造 = (列表, scope, 会话) =>
      列表.filter(Boolean).map((m) => [
        String(m.id),
        scope,
        会话,
        String(m.text || ''),
        m.at || null,
        m.createdAt || null,
        typeof m.importance === 'number' ? m.importance : 0.5,
        m.source ? String(m.source) : '',
        m.category || 'event',
        m.type || '',
        m.事实键 ? String(m.事实键) : '',
        JSON.stringify(Array.isArray(m.related) ? m.related : []),
        打包推理(m),
        m.textBefore ? String(m.textBefore) : '',
        m.refined ? 1 : 0,
        m.refinedSkip ? 1 : 0,
        m.已被取代 ? String(m.已被取代.为什么 || '') : '',
        m.别记 ? String(m.别记.原因 || '') : '',
        序++,
        null,
      ])
    const 造坟 = (列表, scope, 会话) =>
      列表.filter(Boolean).map((m) => [
        String(m.id),
        scope,
        会话,
        String(m.text || ''),
        m.at || null,
        m.createdAt || null,
        typeof m.importance === 'number' ? m.importance : 0.5,
        m.source ? String(m.source) : '',
        m.category || 'event',
        m.type || '',
        m.事实键 ? String(m.事实键) : '',
        JSON.stringify(Array.isArray(m.related) ? m.related : []),
        打包推理(m),
        m.textBefore ? String(m.textBefore) : '',
        m.refined ? 1 : 0,
        m.refinedSkip ? 1 : 0,
        m.已被取代 ? String(m.已被取代.为什么 || '') : '',
        m.别记 ? String(m.别记.原因 || '') : '',
        序++,
        m.deletedAt || m.deleted_at || new Date().toISOString(),
      ])
    const 插 = db.prepare(
      'INSERT OR REPLACE INTO memory (id,scope,session_id,text,at,created_at,importance,source,category,type,fact_key,related_json,extra_json,text_before,refined,refined_skip,superseded_why,wrong,ord,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    db.exec('BEGIN IMMEDIATE')
    try {
      // ⚠ 插入顺序 = 坟赢（1.8.29）：JSON 侧口径是「墓碑按 id 并集摘掉一切同 id 活条目」
      //   （loadStoreJSON: memories.filter(!坟们.has(id))，坟优先于活）。
      //   同 (scope, session_id, id) 主键下 INSERT OR REPLACE 后插者胜 —— **活先插、坟后插**，
      //   让墓碑 REPLACE 掉同键活行，读视图的「坟摘活」与 JSON 完全一致。
      //   历史教训：1.8.18 主键是 id 全局唯一时坟盖活把活条目彻底埋了（文本进 deleted 还能 restore）；
      //   1.8.25 改成坟先插活后插（活赢）—— 但那与 JSON 的「坟优先」口径相反，同键共存时 SQL 会
      //   多召回一条 JSON 不会召回的活条目。现在改回坟赢，靠组视图摘活实现与 JSON 全等。
      db.prepare("DELETE FROM memory WHERE scope = 'global'").run()
      // —— 活条目先插
      const 活事实id = new Set((事实们 || []).filter(Boolean).map((m) => String(m.id)))
      for (const row of 造(事实们, 'global', '')) 插.run(...row)
      db.prepare('DELETE FROM memory WHERE session_id = ?').run(String(sid))
      // ⚠ 会话库里可能还留着事实副本（1.4.0 之前的老库、copy-to 带过来的）——
      //   它们进镜像会以 session scope 覆盖掉同名 global 行（实测 68 条全局事实只剩 43 条活着）。
      //   事实只由事实库那一批负责，这里跳过。
      for (const row of 造(
        (会话们 || []).filter((m) => m && m.category !== 'stable_profile' && !活事实id.has(String(m.id))),
        'session',
        String(sid),
      )) 插.run(...row)
      // 工作区层（GPT 整改 P2 workspace）：scope='workspace' + session_id=规范化 cwd。
      // ws根 为空 = 这次写不涉及工作区 → 跳过 DELETE 和插入，保留镜像里已有的 workspace 行
      // （不然别的会话写自己的库会把整个工作区的镜像行清光）。
      if (ws根) {
        db.prepare("DELETE FROM memory WHERE scope = 'workspace' AND session_id = ?").run(ws根)
        for (const row of 造(
          (工区们 || []).filter((m) => m && !活事实id.has(String(m.id))),
          'workspace',
          ws根,
        )) 插.run(...row)
      }
      // —— 墓碑后插：同键时 REPLACE 压过活行，读视图按 id 摘活
      for (const row of 造坟(事实坟 || [], 'global', '')) 插.run(...row)
      for (const row of 造坟(会话坟 || [], 'session', String(sid))) 插.run(...row)
      if (ws根) for (const row of 造坟(工区坟 || [], 'workspace', ws根)) 插.run(...row)
      const 数 = db.prepare("select scope, count(*) c from memory where deleted_at is null group by scope").all()
      if (process.env.CLAY_SHADOW === '1') 报('镜像插入后：' + JSON.stringify(数))
      db.exec('COMMIT')
      记镜像有货(db)
    } catch (error) {
      try { db.exec('ROLLBACK') } catch (e) {}
      throw error
    }
  } finally {
    try { db && db.close() } catch (e) {}
  }
}

// 首启回填（审查 P1-5「已有 JSON 首启就建镜像」）：把盘上已有的全部会话库
// 灌进镜像。文件名即 sid（storePath 对正常 session-uuid 消毒是恒等的）。
function 全量回填镜像() {
  try {
    if (!existsSync(STORE_DIR)) return
    const sq = 取SQLite模块()
    if (!sq || !sq.DatabaseSync) return
    const db = new sq.DatabaseSync(库文件路径(STORE_DIR))
    const 表好 = 确保镜像表(db)
    db.close()
    if (!表好) return
    const 事实盘 = existsSync(factPath()) ? 读一份(factPath()) : null
    // GPT 整改 P1：读出来是毒快照（读失败/结构坏）→ 事实层整层跳过，不拿空库灌镜像
    if (事实盘 && corruptSnapshots.has(事实盘)) {
      报('全量镜像回填：事实库读失败，跳过事实层')
      return
    }
    const 事实 = 事实盘 && Array.isArray(事实盘.memories) ? 事实盘.memories : []
    const 事实坟 = 事实盘 && Array.isArray(事实盘.deleted) ? 事实盘.deleted : []
    let 库 = 0
    for (const fn of readdirSync(STORE_DIR)) {
      if (!是会话文件(fn)) continue
      const sid = fn.replace(/\.json$/, '')
      const 盘 = 读一份(join(STORE_DIR, fn))
      if (!盘 || !Array.isArray(盘.memories)) continue
      // GPT 整改 P1：单个会话读失败 → 跳过这个会话，别把它的镜像行 DELETE 光
      if (corruptSnapshots.has(盘)) {
        报('全量镜像回填：会话库读失败，跳过 ' + sid.slice(0, 14))
        continue
      }
      同步SQL镜像(sid, 事实, 盘.memories, 事实坟, 盘.deleted || [])
      库++
    }
    // 工作区层：_ws-*.json 单独灌（是会话文件 会排除 _ 前缀文件）。
    // wsRoot 优先取文件里的字段（写入时落盘），老文件没有则从文件名反推。
    let 工区库 = 0
    for (const fn of readdirSync(STORE_DIR)) {
      if (!fn.startsWith('_ws-') || !fn.endsWith('.json')) continue
      const 盘 = 读一份(join(STORE_DIR, fn))
      if (!盘 || !Array.isArray(盘.memories)) continue
      if (corruptSnapshots.has(盘)) {
        报('全量镜像回填：工作区库读失败，跳过 ' + fn)
        continue
      }
      const 根 = typeof 盘.wsRoot === 'string' && 盘.wsRoot ? 盘.wsRoot : 工作区文件id(fn)
      if (!根) continue
      // sid 传 根 也行：session 层插入空数组，session_id=根 的 DELETE 只会清 workspace 行
      // （后面 ws根 分支会重插回来），不会误伤 global（session_id=''）与本会话行。
      同步SQL镜像(根, 事实, [], 事实坟, [], 根, 盘.memories, 盘.deleted || [])
      工区库++
    }
    if (库 || 工区库) 报('全量镜像回填：' + 库 + ' 个会话库、' + 工区库 + ' 个工作区库')
  } catch (error) {
    报('全量镜像回填失败：' + String((error && error.message) || error).slice(0, 120))
  }
}

function saveStoreJSON(sid, data, 选项, 工作区) {
  const raw = !!(选项 && 选项.raw)
  try {
    // GPT 整改 P1：毒快照分两种 ——
    //  · 坏 JSON 自愈毒（凭据带 bytes）：内容已知、原件会被备份，读盘校验 会比对代际并
    //    走 backupCorruptStore 恢复流程，允许按自愈语义写回（覆盖坏文件前先备份原件）。
    //  · I/O 失败 / 结构坏毒（凭据不带 bytes）：盘上内容未知，写回=丢数据，
    //    一律拒绝，含 raw 真销毁路径 —— 不知道有什么，就不能清掉它。
    const 毒凭据们 = corruptSnapshots.get(data)
    if (毒凭据们 && [...毒凭据们.values()].every((候) => !候.bytes)) throw 已清理错()
    if (!data || typeof data !== 'object') data = blank()
    if (!Array.isArray(data.memories)) data.memories = []
    if (!Array.isArray(data.deleted)) data.deleted = []
    if (!Array.isArray(data.traces)) data.traces = []

    // ① 分层。分类权威在调用方 —— /refine 会把一条从事件改判成事实（或反过来），
    //    所以每次写入都重新分，不缓存「上次分到哪边」。
    //    GPT 整改 P2（workspace）：三层 —— stable_profile→全局事实库、workspace→工作区库、
    //    其余→会话库。scope 字段（global/session/workspace:<cwd>）跟着 category 落。
    const 事实记 = []
    const 会话记 = []
    let ws根 = 规范化(工作区 || 会话工作区(sid))
    const 工区全记 = []
    for (const m of data.memories) {
      if (!m) continue
      if (m.category === 'stable_profile') 事实记.push(m)
      else if (m.category === 'workspace') 工区全记.push(m)
      else 会话记.push(m)
    }
    // cwd 兜底：调用方没传工作区、projcache 也解析不出，但条目自带 workspace:<cwd> → 用它
    if (!ws根) {
      for (const m of 工区全记) {
        const s = typeof m.scope === 'string' ? m.scope : ''
        if (s.startsWith('workspace:')) {
          const 候 = 规范化(s.slice('workspace:'.length))
          if (候) { ws根 = 候; break }
        }
      }
    }
    // 还是没 cwd → 工作区条目降级落会话库（保数据不丢，读侧按文件归属，行为=会话级）
    if (!ws根 && 工区全记.length) {
      const 降级数 = 工区全记.length
      会话记.push(...工区全记)
      工区全记.length = 0
      报('工作区 cwd 解析不出，' + 降级数 + ' 条降级落会话库（' + sid.slice(0, 14) + '）')
    }
    // ⭐ 2026-11-01：只把**属于本工作区根**的条目分进工区份。loadStoreJSON 的合并视图带着
    //   别的 cwd 的工作区条目（三层合并），不按 scope 过一遍就会把它们复制进当前根的库文件
    //   ——实测：往 A 工作区记一条，B 工作区的 3 条也跟着写进去了。
    const 工区记 = 工区全记.filter((m) => {
      const s = typeof m.scope === 'string' ? m.scope : ''
      if (!s || !s.startsWith('workspace:')) return true // 老条目没 scope / 非工区 scope → 跟着当前根
      return 规范化(s.slice('workspace:'.length)) === ws根
    })
    const 事实ids = new Set(事实记.map((m) => String(m.id)))
    const 会话ids = new Set(会话记.map((m) => String(m.id)))
    const 工区ids = new Set(工区记.map((m) => String(m.id)))

    // ② 先把三份盘上的都读回来、把代际都对一遍 —— 失败都发生在**任何一次写之前**。
    const 会话盘 = 读盘校验(storePath(sid), data, purgeEpochOf(data))
    if (purgeEpochOf(data) !== 会话盘.epoch) throw 已清理错()
    const 事实盘 = 读盘校验(factPath(), data, 事实代际(data))
    // 老来路（1.3.7 语义 / 手搓的对象）身上没有事实代际 → 不校验，跟着盘上的走。
    // 正常路径的 data 都出自 loadStore，两个代际都在，这条兜底基本不会被走到。
    const 事实代际来 = 事实代际(data)
    if (事实代际来 && 事实代际来 !== 事实盘.epoch) throw 已清理错()
    const ws文件 = 工作区文件(ws根)
    // 1.8.38 兼容：盘上可能还是旧消毒名（升级前写的），读盘校验也要按「哈希名优先、旧名兜底」找文件；
    // 写（⑤）仍写哈希名。若不兜底：旧文件 ENOENT → 代际空串与 data 里的 workspacePurgeEpoch
    // 不匹配 → 误判 MEMORY_PURGED，且工区份按空盘合并会把整层清空。
    const ws文件旧 = 工作区文件旧(ws根)
    let 工区读文件 = ''
    if (ws文件 && existsSync(ws文件)) 工区读文件 = ws文件
    else if (ws文件旧 && ws文件旧 !== ws文件 && existsSync(ws文件旧)) 工区读文件 = ws文件旧
    const 工区盘 = 工区读文件 ? 读盘校验(工区读文件, data, 工作区代际(data)) : null
    const 工作区代际来 = 工作区代际(data)
    if (工区盘 && 工作区代际来 && 工作区代际来 !== 工区盘.epoch) throw 已清理错()
    const 盘事实ids = new Set(((事实盘.盘 && 事实盘.盘.memories) || []).map((m) => String(m && m.id)))

    // ③ 事实份：先合并（它是权威 —— 会话侧那批旧副本要拿它的结果来对）
    const 事实份 = {
      version: 2,
      purgeEpoch: 事实盘.epoch,
      policy: data.policy,
      memories: 事实记,
      traces: [], // 召回记录是「这个会话」的，不进全局库
      deleted: data.deleted.filter((d) => 坟归事实(d, 事实ids, 会话ids, 盘事实ids)),
    }
    let 事实结果 = raw || !事实盘.盘 || !Array.isArray(事实盘.盘.memories)
      ? 事实份
      : 合并库(事实盘.盘, 事实份, 选项)
    // 调用方明确归到会话份的 id（含 /refine 的「事实 → 事件」改判）必须从事实库撤掉，
    // 否则读的时候「事实优先」又把旧的那条当事实捡回来，改判白做 ✗
    if (会话ids.size) 事实结果.memories = (事实结果.memories || []).filter((m) => !m || !会话ids.has(String(m.id)))

    // 权威事实表：合并之后、且没被墓碑删掉的那些。会话库里的旧副本只认它们。
    const 坟事实ids = new Set((事实结果.deleted || []).map((d) => String(d && d.id)))
    const 权威 = new Map()
    for (const m of 事实结果.memories || []) {
      if (!m) continue
      const id = String(m.id)
      if (!坟事实ids.has(id)) 权威.set(id, 条签名(m))
    }

    // ④ 会话份
    const 会话份 = {
      version: 2,
      purgeEpoch: 会话盘.epoch,
      policy: data.policy,
      memories: 会话记,
      traces: data.traces,
      deleted: data.deleted.filter((d) => !坟归事实(d, 事实ids, 会话ids, 盘事实ids) && !坟归工区(d, 事实ids, 会话ids)),
    }
    const 会话结果 = raw || !会话盘.盘 || !Array.isArray(会话盘.盘.memories)
      ? 会话份
      : 合并库(会话盘.盘, 会话份, 选项)
    // ⭐ 会话库里那些「事实的旧副本」（迁移时**故意**没删的原库副本）：
    //   · 盘上原来就有这份副本，而且和权威事实一模一样 → 留着（万一回退到 1.3.7，事实还读得到）
    //   · 事实被改过 / 被删了 / 被彻底清了 → 随这次写入消失
    //     （不然 purge 之后它会从会话库原文复活 ✗ —— 那才是真的删不掉）
    //   · 这次新记的、/refine 提升成事实的 → 会话库不留（事实归全局库，别写两份）
    const 盘会话副本 = new Map()
    for (const m of (会话盘.盘 && Array.isArray(会话盘.盘.memories) ? 会话盘.盘.memories : [])) {
      if (m) 盘会话副本.set(String(m.id), 条签名(m))
    }
    会话结果.memories = (会话结果.memories || []).filter((m) => {
      if (!m) return false
      if (m.category !== 'stable_profile') return true
      const id = String(m.id)
      if (盘会话副本.get(id) !== 条签名(m)) return false
      return 权威.get(id) === 条签名(m)
    })

    // ④.5 工作区份（GPT 整改 P2 workspace）：同 cwd 跨会话共享的项目知识。
    //   墓碑按 id 并集（会话语义同款）；合并用同一套 合并库（补状态/找回/读盘于 全都有）。
    //   调用方把一条改判成 workspace（或从 workspace 改走）时：
    //   · 改走 → 旧的工作区行还在盘上，但权威表（事实）没它 → 下次写它会被……
    //     ⚠ 与事实层不同，workspace 不是权威层：改判出 workspace 后盘上旧行必须撤掉，
    //     否则读视图「工区文件按 id 并集」会把它捡回来。所以这里照会话→事实的撤法反过来做：
    //     会话/事实 ids 里出现过的 id 必须从工区结果撤掉。
    const 工区份 = {
      version: 2,
      purgeEpoch: 工区盘 ? 工区盘.epoch : '',
      policy: data.policy,
      memories: 工区记,
      traces: [],
      wsRoot: ws根,
      deleted: data.deleted.filter((d) => 坟归工区(d, 事实ids, 会话ids)),
    }
    const 工区结果 = raw || !工区盘 || !工区盘.盘 || !Array.isArray(工区盘.盘.memories)
      ? 工区份
      : 合并库(工区盘.盘, 工区份, 选项)
    if (事实ids.size || 会话ids.size) {
      工区结果.memories = (工区结果.memories || []).filter((m) => {
        if (!m) return false
        const id = String(m.id)
        return !事实ids.has(id) && !会话ids.has(id)
      })
      // 墓碑同款撤除：活层出现过的 id，工区文件里的墓碑必须撤掉——
      // ①改判出 workspace 的条目，旧墓碑跟着走；②restore 时清掉幽灵墓碑（假找回的根）。
      工区结果.deleted = (工区结果.deleted || []).filter((d) => {
        if (!d) return false
        const id = String(d.id)
        return !事实ids.has(id) && !会话ids.has(id)
      })
    }

    // ⑤ 落盘。事实先写：它是权威，事实写失败就整次没写，不会留下「事件新了、事实旧了」。
    mkdirSync(STORE_DIR, { recursive: true })
    const 事实有东西 = (事实结果.memories || []).length > 0 || (事实结果.deleted || []).length > 0
    // 新装环境 / 测试夹具里两条事实都没有、文件也还没有 → 别凭空造一个 _facts.json
    if (事实有东西 || 事实盘.有文件) {
      // 事实库的代际：真销毁（raw）换新的；**第一次落盘**也给一个（不然代际一直是空串，
      // 之后谁都能拿个空代际的快照把已清掉的事实捡回来）
      const 写事实 = { ...事实结果, version: 2, purgeEpoch: raw || !事实盘.epoch ? randomUUID() : 事实盘.epoch }
      if (写事实.traces.length > 100) 写事实.traces = 写事实.traces.slice(-100)
      const sig = memSig(写事实.memories)
      if (lastSig.get(FACTS_NAME) !== sig) backupFile(factPath()) // 事实变了才备，只写 trace 不备
      writeFileAtomicSync(factPath(), JSON.stringify(写事实, null, 2))
      corruptIncidents.delete(factPath())
      lastSig.set(FACTS_NAME, sig)
    }
    const 写会话 = { ...会话结果, version: 2, purgeEpoch: raw ? randomUUID() : 会话盘.epoch }
    if (写会话.traces.length > 100) 写会话.traces = 写会话.traces.slice(-100)
    const sig = memSig(写会话.memories)
    if (lastSig.get(String(sid)) !== sig) backupFile(storePath(sid))
    writeFileAtomicSync(storePath(sid), JSON.stringify(写会话, null, 2))
    corruptIncidents.delete(storePath(sid))
    lastSig.set(String(sid), sig)

    // 工作区库（GPT 整改 P2 workspace）：跟事实库同款「有东西才写」逻辑。
    // 第一次写（工区盘没文件也没 epoch）要给代际，跟事实层同一个理由。
    if (ws文件) {
      const 工区有东西 = (工区结果.memories || []).length > 0 || (工区结果.deleted || []).length > 0
      if (工区有东西 || (工区盘 && 工区盘.有文件)) {
        const 写工区 = { ...工区结果, version: 2, purgeEpoch: raw || !(工区盘 && 工区盘.epoch) ? randomUUID() : 工区盘.epoch, wsRoot: ws根 }
        const wsSig = memSig(写工区.memories)
        if (lastSig.get(ws文件) !== wsSig) backupFile(ws文件)
        writeFileAtomicSync(ws文件, JSON.stringify(写工区, null, 2))
        corruptIncidents.delete(ws文件)
        lastSig.set(ws文件, wsSig)
      }
    }

    // ⑥ SQL 镜像（S3 写路径）：主库仍是 JSON；SQL 只做全等镜像。
    //    失败不影响主流程 —— 镜像落后只影响影子比对的诊断，不影响记忆本身。
    try {
      // ⚠ ord 必须跟**文件里的顺序**一致：loadStore 读的是落盘后的数组顺序，
      //   而「事实结果」这个内存数组在合并 / 改判之后顺序可能和落盘的不同
      //   （2026-10-29 实测：JSON 前三条是新导入的 zf140/zg52/zh483，镜像里 zf140 却排在 ord=74）。
      //   所以这里回读刚落盘的两份文件，用它们的顺序编号。
      {
        // ⚠ 读一份 失败时返回毒快照（blank 形状，corruptSnapshots 挂凭据）—— 直接 if (盘) 判
        //   会把「读不到」当成「空库」，接着 DELETE 掉镜像里的全局行再插 0 行（架构师审查 M4
        //   指过旧 bug；GPT 整改 P1 又追到：blank 有 memories:[]，Array.isArray 判据恒真）。
        //   所以这里以「毒凭据」为准：读出来的是毒快照 → 整个跳过镜像同步。
        const 读好 = (v) => v && !corruptSnapshots.has(v) && Array.isArray(v.memories)
        const 盘事实 = 事实有东西 || 事实盘.有文件 ? 读一份(factPath()) : null
        const 盘会话 = 读一份(storePath(sid))
        const 盘工区 = 工区读文件 && (工区结果.memories.length > 0 || (工区结果.deleted || []).length > 0 || 工区盘.有文件) ? 读一份(工区读文件) : null
        if (盘事实 && !读好(盘事实)) throw new Error('事实库读不出来，这次跳过镜像同步')
        if (!读好(盘会话)) throw new Error('会话库读不出来，这次跳过镜像同步')
        if (盘工区 && !读好(盘工区)) throw new Error('工作区库读不出来，这次跳过镜像同步')
        const 工区们 = (盘工区 && Array.isArray(盘工区.memories)) ? 盘工区.memories : []
        const 工区坟 = (盘工区 && Array.isArray(盘工区.deleted)) ? 盘工区.deleted : []
        同步SQL镜像(sid, 盘事实 ? 盘事实.memories : [], 盘会话.memories, 盘事实 ? 盘事实.deleted : [], 盘会话.deleted, ws根, 工区们, 工区坟)
      }
      镜像不可用 = false
      // 写后自检：CLAY_SHADOW=1 时立刻把刚写下去的 JSON 和镜像对一遍。
      // 差异只在 diag —— 镜像落后不影响记忆本身，但「静默落后」正是 1.8.7 那批 bug 的根。
      if (process.env.CLAY_SHADOW === '1') {
        try {
          // ⚠ 比对的两边必须同口径：SQL 视图是「全局 + 本会话」的合并视图，
          //   这边也得用 loadStoreJSON（合并视图），不能拿单个会话库文件去比
          const 甲 = loadStoreJSON(sid)
          const 乙 = 读SQL视图同步(库文件路径(STORE_DIR), sid, 规范化(会话工作区(sid)))
          const 账 = 比对视图(甲, 乙)
          if (!账.全等) {
            // 先分清「集合不同」还是「只是顺序不同」—— 前者是真丢数据，后者只影响注入排序
            const 甲id = (甲.memories || []).map((m) => String(m.id)).sort().join(',')
            const 乙id = (乙.memories || []).map((m) => String(m.id)).sort().join(',')
            报(
              '镜像自检（' + sid.slice(0, 14) + '）：' +
              (甲id === 乙id ? '集合一致、顺序不同 → ' : '集合不同 → ') +
              账.差异.slice(0, 3).join('；'),
            )
          }
        } catch (error2) {
          报('镜像自检失败：' + String((error2 && error2.message) || error2).slice(0, 100))
        }
      }
    } catch (error) {
      镜像不可用 = true
      报('SQL 镜像同步失败（读侧已退回 JSON）：' + String((error && error.message) || error).slice(0, 120))
    }
  } catch (error) {
    报('记忆写入失败：' + String(error && error.code || 'write-error'))
    throw error
  }
}

export function 滤掉推测(记忆们) {
  return (记忆们 || []).filter((m) => !(m && m.type === 'inference'))
}

export { blank, purgeEpochOf, 事实代际, corruptSnapshots, corruptIncidents, 读一份, 事实文, 读注入数据, loadStoreJSON, adoptTargetEpoch, backupCorruptStore, 读盘校验, 已清理错, 坟归事实, loadStore, saveStore, 镜像不可用, 同步SQL镜像, 全量回填镜像, saveStoreJSON }
