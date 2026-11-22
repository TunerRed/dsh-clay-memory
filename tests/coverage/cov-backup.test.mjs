import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 备份与批次戳（lib/backup.mjs）回归 —— 这个模块**零测试覆盖**，但它是「记忆丢了还能不能救回来」的最后一道。
//
// 🔴 它存在的理由（2026-09-23 真出过一次事）：那天把「已删掉的」清空，连同刚合掉的 157 条一起没了。
//   而常规两道备份都指望不上：
//     `.bak`    只留**最后一次改动前**那一版（清空之后又被下一次写入覆盖了）
//     每天那份  只留**当天最早**那一版
//   最后是靠「每天那份」正好是当天最早，才整条救回来 —— 运气好而已。
//
// 要守住的不变量：
//   ① 凡是**真销毁**的动作，动之前必须另存一份带时间戳的，放 `clay-memory\销毁前\`，只留最近 20 份；
//   ② 时间戳要**到毫秒** —— 第一版只到秒，自检里连着清 25 次全落在同一秒 ⇒ 文件名一样、
//      互相覆盖 ⇒ 最后只剩 1 份（真出事的时候正好是连着点几下）；
//   ③ 撞名时**加序号，绝不覆盖**；
//   ④ 20 份额度要**按库名前缀分开数** —— 混在一起排的话 `_facts·…` 一直排最前
//      （`_` 的码位小于字母），最先被砍光的正是事实，那才是最难重建的东西；
//   ⑤ `memSig` / `条签名` 是稳定指纹：加一条、删一条、改一条都要变；
//   ⑥ `设暂停` 分钟数 clamp 到 0~1440，<=0 表示取消；无 sid 要抛；
//   ⑦ `记批次` 的改动明细截断到 2000 条（撤销时别把内存撑爆）；
//   ⑧ 报信器**没注入也不能崩**（`报` 初值是 null，销毁前另存 里直接调它）。
//
// ⚠ 全部文件操作都落在自建临时 DSH_HOME 里，**不碰真实记忆库**
//   （本机真实数据在真实 DSH_HOME，测试实例在独立端口跑）。
const home = mkdtempSync(join(tmpdir(), 'fish-cov-backup-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')
mkdirSync(join(home, 'clay-memory'), { recursive: true })

const {
  todayKey, memSig, 条签名, lastSig, 销毁前另存, backupFile, backupStore,
  读批次表, 读暂停表, 暂停到, 设暂停, 记批次, 接报信,
} = await import('../../lib/backup.mjs')
const { STORE_DIR, BACKUP_DIR, storePath, factPath } = await import('../../lib/paths.mjs')
// 对账用的时区偏移（todayKey 的期望值要用同一个口径算）
const { TZ_OFFSET } = await import('../../lib/time.mjs')

// ⚠ ⑧ 先验「没注入报信器也不崩」，再注入 —— 顺序不能反
const 销毁目录 = () => join(STORE_DIR, '销毁前')

// ⚠ 环境探测（2026-11-15）：有些执行环境对**非 ASCII 路径**的删除是静默 no-op ——
//   rmSync 不抛错、文件却还在（实测：ASCII 目录 + ASCII 名能删；含中文或「·」就删不掉）。
//   备份目录叫 `销毁前`、文件名带 `·`，正好全踩中；而「20 份额度」这条不变量完全靠删除实现，
//   删不掉就永远涨不到 20 份。探测一次，命中就在 ②④ 里 skip ——
//   这不是放宽断言，是这条**在当前环境里验不了**（DSH 实例内 / 普通终端不受此限，主库
//   clay-memory/销毁前/ 里 _facts 与热门会话各正好 20 份，可作旁证）。
const 能删非ASCII = (() => {
  try {
    const 探 = join(STORE_DIR, '探测·文件.json')
    writeFileSync(探, '{}')
    rmSync(探, { force: true })
    return !existsSync(探)
  } catch {
    return false
  }
})()

function 造库(sid, 内容) {
  const p = storePath(sid)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, JSON.stringify(内容), 'utf8')
  return p
}

test('⑧ 报信器没注入也不崩（`报` 初值是 null，直接调它会抛）', () => {
  // ⚠ 顺序要紧：这条必须在任何 接报信() 之前跑。
  //   销毁前另存 整段被 try/catch 吞掉 ⇒ 未注入时表现为**静默不备份**，
  //   这种「不报错但也没干活」的失效模式最危险，所以单独守一条。
  const sid = 'cov-weizhuru'
  造库(sid, { memories: [{ id: 'm1', text: '未注入时也要能备份' }] })
  let 抛了 = null
  try { 销毁前另存(sid) } catch (e) { 抛了 = e }
  assert.equal(抛了, null, '未注入报信器时不该抛（整段有 try/catch 兜着）：' + (抛了 && 抛了.message))
  assert.ok(existsSync(销毁目录()), '即使日志失败，另存这个动作本身也该完成')
  assert.ok(
    readdirSync(销毁目录()).some((f) => f.startsWith(sid + '·')),
    '未注入报信器时**静默没备份** —— 这是最危险的失效模式'
  )
})

const 诊断 = []
接报信((m) => 诊断.push(String(m)))

test('memSig：加一条 / 删一条 / 改一条，指纹都要变', () => {
  const 库 = [
    { id: 'm1', text: '她胃不好', at: '2026-01-01', importance: 0.8, category: 'stable_profile' },
    { id: 'm2', text: '今天去了公园', at: '2026-01-02', importance: 0.5, category: 'event' },
  ]
  const 原 = memSig(库)
  assert.match(原, /^2:-?\d+$/, '格式该是「条数:哈希」，方便一眼看出条数：' + 原)

  // 加一条
  assert.notEqual(memSig(库.concat([{ id: 'm3', text: '新的', at: '', importance: 0.5, category: 'event' }])), 原, '加一条指纹该变')
  // 删一条
  assert.notEqual(memSig([库[0]]), 原, '删一条指纹该变')
  // 改正文
  const 改文 = 库.map((m, i) => (i === 0 ? { ...m, text: '她胃不好，也不能吃辣' } : m))
  assert.notEqual(memSig(改文), 原, '改正文指纹该变')
  // 改重要度 / 类别 / 时间 / id —— 五个字段都进了签名，改哪个都该变
  assert.notEqual(memSig(库.map((m, i) => (i === 0 ? { ...m, importance: 0.9 } : m))), 原, '改重要度指纹该变')
  assert.notEqual(memSig(库.map((m, i) => (i === 0 ? { ...m, category: 'event' } : m))), 原, '改类别指纹该变')
  assert.notEqual(memSig(库.map((m, i) => (i === 0 ? { ...m, at: '2026-05-05' } : m))), 原, '改时间指纹该变')
  assert.notEqual(memSig(库.map((m, i) => (i === 0 ? { ...m, id: 'x9' } : m))), 原, '改 id 指纹该变')
  // 同样的库 → 同样的指纹（稳定性）
  assert.equal(memSig(库), 原, '同一个库两次算出的指纹必须一致')
  assert.equal(memSig(JSON.parse(JSON.stringify(库))), 原, '深拷贝后指纹也该一致')
  // ⚠ 未进签名的字段不该影响它（traces / related 每轮都在变，
  //   进了签名就会「每轮写 trace 都堆一堆备份」—— 注释里点名的那个问题）
  assert.equal(memSig(库.map((m) => ({ ...m, 无关字段: Math.random() }))), 原, '无关字段不该改指纹（否则每轮都备份）')
  // 空库 / null 不炸
  assert.equal(memSig([]), '0:0')
  assert.equal(memSig(null), '0:0')
  assert.equal(memSig(undefined), '0:0')
})

test('条签名：单条的稳定签名，五个字段按固定顺序拼接', () => {
  const m = { id: 'm1', text: '她胃不好', at: '2026-01-01', importance: 0.8, category: 'stable_profile' }
  assert.equal(条签名(m), 'm1|她胃不好|2026-01-01|0.8|stable_profile', '拼接顺序被改了 —— 迁移判断「旧副本还是不是权威原文」会全错')
  assert.equal(条签名(m), 条签名({ ...m }), '同样的内容必须给出同样的签名')
  // 改任一字段 → 签名变
  assert.notEqual(条签名({ ...m, text: '改过' }), 条签名(m))
  assert.notEqual(条签名({ ...m, importance: 0.9 }), 条签名(m))
  // 字段缺失时按 'undefined' 拼进去（不抛）—— 迁移时老条目常缺字段
  assert.equal(条签名({ id: 'm9' }), 'm9|undefined|undefined|undefined|undefined')
  // ⚠ 整条是 null 时，`m && m.id` 短路返回的是 **m 本身（null）**，不是 undefined ⇒ 拼出 'null'
  //   这条不是要它「好看」，而是要它**稳定**：迁移拿它判「旧副本还是不是权威原文」，
  //   同一种空值必须每次都算出同一个签名，不能一会儿 null 一会儿 undefined。
  assert.equal(条签名(null), 'null|null|null|null|null')
  assert.equal(条签名(undefined), 'undefined|undefined|undefined|undefined|undefined')
  assert.equal(条签名(null), 条签名(null), '同一个空值两次算出的签名必须一致')
  assert.doesNotThrow(() => 条签名(undefined))
  // ⚠ lastSig 是模块级 Map（调用方用来判「记忆变了才备」），要能正常读写
  assert.ok(lastSig instanceof Map)
})

test('todayKey：本地日历日，格式 YYYY-MM-DD', () => {
  const k = todayKey()
  assert.match(k, /^\d{4}-\d{2}-\d{2}$/, 'todayKey 格式不对：' + k)
  // 同一天内多次调用结果一致（「每天一份」要有明确的一天定义）
  assert.equal(todayKey(), k)
  assert.equal(k, new Date(Date.now() + TZ_OFFSET).toISOString().slice(0, 10), 'todayKey 该按本机时区算本地日历日')
})

test('② 销毁前另存：时间戳**到毫秒**，同毫秒连清 25 次也一份不少', (t) => {
  if (!能删非ASCII) {
    t.skip('本环境删不掉非 ASCII 路径（rmSync 静默 no-op）⇒ 额度裁剪这条验不了；换实例内或普通终端跑')
    return
  }
  const sid = 'cov-lianqing'
  造库(sid, { memories: [{ id: 'm1', text: '连清也不能互相覆盖' }] })
  // 🔴 这就是自检逮到的那个坑：第一版时间戳只到秒，连着清 25 次全落在同一秒
  //   ⇒ 文件名一样 ⇒ 互相覆盖 ⇒ 最后只剩 1 份。真出事时正好是连着点几下。
  for (let i = 0; i < 25; i++) 销毁前另存(sid)
  const 份 = readdirSync(销毁目录()).filter((f) => f.startsWith(sid + '·') && f.endsWith('.json'))
  assert.equal(份.length, 20, `20 份额度该被填满（一份都不能互相覆盖），实际 ${份.length}`)
  // 每份都该是完整可解析的 JSON（覆盖会留下半截文件）
  for (const f of 份) {
    assert.doesNotThrow(() => JSON.parse(readFileSync(join(销毁目录(), f), 'utf8')), f + ' 不是完整 JSON（被覆盖了？）')
  }
  // 文件名里的时间戳必须到毫秒（形如 2026-11-15T12-34-56-789）
  assert.match(份[0], /^cov-lianqing·\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}·?\d*\.json$/, '时间戳没到毫秒：' + 份[0])
})

test('④ 20 份额度按库名前缀分开数（`_facts` 不会被会话备份挤光）', (t) => {
  if (!能删非ASCII) {
    t.skip('同上：本环境删不掉非 ASCII 路径，按前缀分额度这条验不了')
    return
  }
  // 🔴 混在一起排序时 `_facts·…` 一直排最前（`_` 的码位小于字母）⇒ 最先被砍光的正是事实，
  //   而事实（画像/喜好/约定）才是最难重建的东西。
  const sid = 'cov-edu'
  造库(sid, { memories: [{ id: 's1', text: '会话记忆' }] })
  mkdirSync(join(factPath(), '..'), { recursive: true })
  writeFileSync(factPath(), JSON.stringify({ memories: [{ id: 'f1', text: '她喜欢蓝色', category: 'stable_profile' }] }), 'utf8')

  // ⚠ 不靠「真调 40 多次」来塞满目录（那要复制近百份文件、跑好几秒）。
  //   直接预置旧副本即可 —— 额度裁剪只看目录里同前缀的文件名，不关心它们是怎么来的。
  //   故意让会话侧**严重超额**（40 份）、事实侧只有 3 份：
  //     若额度是混在一起数的（按文件名排序），`_facts` 排在最前 ⇒ 会被会话侧的溢出**先砍光**；
  //     按前缀分开数，则两侧各自裁剪，事实侧一份不少。
  const 造旧副本 = (前缀, 份数) => {
    for (let i = 0; i < 份数; i++) {
      const 序 = String(i).padStart(3, '0')
      writeFileSync(join(销毁目录(), `${前缀}·2020-01-01T00-00-00-${序}.json`), '{}', 'utf8')
    }
  }
  mkdirSync(销毁目录(), { recursive: true })
  造旧副本(sid, 40)
  造旧副本('_facts', 3)

  销毁前另存(sid) // 一次调用会同时处理会话库与事实库两侧

  const 全部 = readdirSync(销毁目录()).filter((f) => f.endsWith('.json'))
  const 会话份 = 全部.filter((f) => f.startsWith(sid + '·'))
  const 事实份 = 全部.filter((f) => f.startsWith('_facts·'))

  assert.equal(会话份.length, 20, '会话侧该被自己的 20 份额度管住，实际 ' + 会话份.length)
  assert.equal(事实份.length, 4, '事实侧该守自己的额度（3 份旧的 + 本次 1 份），被会话溢出挤掉就说明额度没按前缀分开数：实际 ' + 事实份.length)
  // 本次真存下来的那两份必须在（被裁掉的只能是 2020 年那些旧的）
  assert.ok(会话份.some((f) => f.includes('2026-') || f.includes('·2')), '本次的会话副本不该被裁掉')
  assert.ok(事实份.some((f) => !f.startsWith('_facts·2020-')), '本次的事实副本不该被裁掉')
})

test('① 销毁前另存：会话库与全局事实库**两边都要存**（墓碑在 _facts.json 里）', () => {
  const sid = 'cov-liangce'
  造库(sid, { memories: [{ id: 'a1', text: '会话侧' }] })
  writeFileSync(factPath(), JSON.stringify({ memories: [{ id: 'b1', text: '事实侧' }] }), 'utf8')
  // ⚠ 前面的用例已经往「销毁前」里留过 `_facts·…` 副本了，所以这里**只认本次新增的**，
  //   否则 find 会命中上一批留下的旧副本（内容是别的用例写的）。
  const 之前 = new Set(existsSync(销毁目录()) ? readdirSync(销毁目录()) : [])
  销毁前另存(sid)
  const 新增 = readdirSync(销毁目录()).filter((f) => !之前.has(f))

  assert.ok(新增.some((f) => f.startsWith(sid + '·')), '会话库没另存 —— 清空会话就救不回来了')
  assert.ok(新增.some((f) => f.startsWith('_facts·')), '事实库没另存 —— 清空「已删」时墓碑就没了（1.4.0 双层库之后两边都可能发生）')
  // 内容要真是原库的副本（不是空文件、不是串了别的库）
  const 会话副本 = 新增.find((f) => f.startsWith(sid + '·'))
  const 事实副本 = 新增.find((f) => f.startsWith('_facts·'))
  assert.deepEqual(JSON.parse(readFileSync(join(销毁目录(), 会话副本), 'utf8')).memories[0].text, '会话侧')
  assert.deepEqual(JSON.parse(readFileSync(join(销毁目录(), 事实副本), 'utf8')).memories[0].text, '事实侧')
  assert.ok(诊断.some((m) => /销毁前另存：/.test(m)), '另存要留日志（排查时得知道存到哪了）')
})

test('销毁前另存：会话库不存在时安静返回，不产生半截副本', () => {
  // 新装环境的事实库一开始还没有；这里用一个从没写过的 sid
  const sid = 'cov-neverwritten-' + Date.now()
  assert.ok(!existsSync(storePath(sid)), '前提：这个会话库不该存在')
  const 之前 = existsSync(销毁目录()) ? readdirSync(销毁目录()).length : 0
  assert.doesNotThrow(() => 销毁前另存(sid), '源文件不存在时不该抛（整段有 try/catch 兜着）')
  const 之后 = existsSync(销毁目录()) ? readdirSync(销毁目录()).length : 0
  const 新增 = readdirSync(销毁目录()).filter((f) => f.startsWith(sid + '·'))
  assert.deepEqual(新增, [], '会话库不存在时不该给它造副本（只有事实库那一侧会被另存）')
  assert.ok(之后 - 之前 <= 1, '最多只该多出事实库那一份，实际多了 ' + (之后 - 之前))
})

test('backupFile：上一版 .bak + 当天最早那份，两份都要有', () => {
  const sid = 'cov-regular'
  const p = 造库(sid, { memories: [{ id: 'v1', text: '第一版' }] })
  backupFile(p)
  // ① 上一版（永远只有一份，最近一次改动前）
  assert.ok(existsSync(p + '.bak'), '.bak 没生成 —— 「最近一次改动前」那一版丢了')
  assert.deepEqual(JSON.parse(readFileSync(p + '.bak', 'utf8')).memories[0].text, '第一版')
  // ② 每天一份（存当天最早的那一版）
  const 当天目录 = join(BACKUP_DIR, todayKey())
  assert.ok(existsSync(当天目录), '当天备份目录没建')
  assert.ok(existsSync(join(当天目录, sid + '.json')), '当天那份没存')
  assert.deepEqual(JSON.parse(readFileSync(join(当天目录, sid + '.json'), 'utf8')).memories[0].text, '第一版')

  // ⚠ 关键：当天那份**不能被后来的写入覆盖** —— 它存的是「当天最早」那一版，
  //   这正是 157 条那次能救回来的唯一原因（运气好而已，所以要守死）
  //
  // ⚠⚠ 顺序照生产流程来（store-core.mjs 的 saveStore）：**先 backupFile 再 writeFileAtomicSync**
  //   ⇒ 调用 backupFile 的那一刻，盘上还是**改动前**那一版 ⇒ `.bak` = 改动前。
  //   测试里若「先写新内容再备份」，`.bak` 就成了新版本，语义正好反过来。
  backupFile(p)                                                    // 盘上还是第一版 ⇒ .bak = 第一版
  writeFileSync(p, JSON.stringify({ memories: [{ id: 'v2', text: '第二版' }] }), 'utf8')
  assert.deepEqual(JSON.parse(readFileSync(join(当天目录, sid + '.json'), 'utf8')).memories[0].text, '第一版',
    '当天那份被覆盖了 —— 它必须存「当天最早」那一版')
  assert.deepEqual(JSON.parse(readFileSync(p + '.bak', 'utf8')).memories[0].text, '第一版',
    '.bak 该是这次改动**前**那一版')
  // 下一次改动前再备一次 ⇒ .bak 推进到第二版（永远只有这一份）
  backupFile(p)                                                    // 盘上是第二版 ⇒ .bak = 第二版
  writeFileSync(p, JSON.stringify({ memories: [{ id: 'v3', text: '第三版' }] }), 'utf8')
  assert.deepEqual(JSON.parse(readFileSync(p + '.bak', 'utf8')).memories[0].text, '第二版',
    '.bak 该跟着推进到「最近一次改动前」那一版')
  // 而当天那份始终是最早那版（第三版也没能覆盖它）
  assert.deepEqual(JSON.parse(readFileSync(join(当天目录, sid + '.json'), 'utf8')).memories[0].text, '第一版')
})

test('backupFile：源不存在时安静返回（新装环境的事实库一开始还没有）', () => {
  const 不存在 = join(STORE_DIR, 'cov-nosuchstore.json')
  assert.ok(!existsSync(不存在))
  assert.doesNotThrow(() => backupFile(不存在), '源不存在不该抛')
  assert.ok(!existsSync(不存在 + '.bak'), '源不存在时不该造出一个空 .bak')
})

test('backupStore：两份库各自备份，某一侧不存在就跳过', () => {
  const sid = 'cov-fullstore'
  造库(sid, { memories: [{ id: 'c1', text: '会话' }] })
  writeFileSync(factPath(), JSON.stringify({ memories: [{ id: 'c2', text: '事实' }] }), 'utf8')
  assert.doesNotThrow(() => backupStore(sid))
  assert.ok(existsSync(storePath(sid) + '.bak'), '会话库该被备份')
  assert.ok(existsSync(factPath() + '.bak'), '事实库该被备份（1.3.7 只认会话库那一个路径）')
  // 会话库不存在时也不该抛（只备事实侧）
  assert.doesNotThrow(() => backupStore('cov-没有会话库的sid'))
})

test('⑥ 设暂停 / 暂停到：分钟数 clamp 到 0~1440，<=0 表示取消', () => {
  const sid = 'cov-暂停'
  assert.equal(设暂停(sid, 30), 30, '该原样返回设了多少分钟')
  const 到 = 暂停到(sid)
  assert.ok(到 > Date.now(), '暂停到点该在未来')
  assert.ok(到 - Date.now() <= 30 * 60000 + 5000, '暂停到点该在 30 分钟左右，实际差 ' + (到 - Date.now()))
  assert.ok(读暂停表()[sid], '暂停表里该有这条')

  // 上限 24*60 = 1440
  assert.equal(设暂停(sid, 99999), 1440, '超过一天该被夹到 1440 分钟')
  assert.ok(暂停到(sid) - Date.now() <= 1440 * 60000 + 5000)
  // 负数 / 0 → 取消（从表里删掉）
  assert.equal(设暂停(sid, 0), 0)
  assert.equal(暂停到(sid), 0, '0 分钟该等于取消暂停')
  assert.ok(!读暂停表()[sid], '取消后该从表里删掉，不是留个过期时间')
  设暂停(sid, 60)
  assert.equal(设暂停(sid, -5), 0, '负数也该当取消')
  assert.equal(暂停到(sid), 0)

  // 垃圾输入：NaN / null / undefined / 字符串 → 0（当取消），不抛
  assert.equal(设暂停(sid, NaN), 0)
  assert.equal(设暂停(sid, null), 0)
  assert.equal(设暂停(sid, undefined), 0)
  assert.equal(设暂停(sid, 'abc'), 0)
  // 四舍五入到整分钟
  assert.equal(设暂停(sid, 12.4), 12)
  assert.equal(设暂停(sid, 12.6), 13)
  assert.equal(设暂停(sid, '45'), 45, '数字字符串也该认（前端传来的常常是字符串）')
  设暂停(sid, 0)

  // 没有 sid 必须抛 —— 否则会把暂停状态写到空 key 上，静默影响所有会话
  assert.throws(() => 设暂停('', 30), /没有会话/, '无 sid 时该抛「没有会话」')
  assert.throws(() => 设暂停(null, 30), /没有会话/)
  // 暂停到 对没设过的 sid 返回 0（不是 NaN）
  assert.equal(暂停到('cov-从没暂停过'), 0)
  assert.equal(暂停到(''), 0)
  assert.equal(暂停到(null), 0)
})

test('暂停表：文件坏了 / 不存在 → 返回空对象（不能抛，也不能当成「全都暂停」）', () => {
  // 这个文件不在的时候，读暂停表 走 catch → {}
  assert.deepEqual(读暂停表(), {}, '没有任何暂停时该是空对象')
  // 写坏它：解析失败也该兜成 {}，而不是抛（抛了会让每轮记账都失败）
  const p = join(STORE_DIR, '_paused.json')
  writeFileSync(p, '{ 这不是 JSON ', 'utf8')
  assert.deepEqual(读暂停表(), {}, '暂停表坏了该兜成空对象')
  assert.equal(暂停到('cov-任意'), 0, '暂停表坏了不该让所有会话都变成「暂停中」')
  writeFileSync(p, '[1,2,3]', 'utf8')
  assert.deepEqual(读暂停表(), {}, '暂停表是数组时也该兜成空对象')
  writeFileSync(p, 'null', 'utf8')
  assert.deepEqual(读暂停表(), {})
  // 坏表不该挡住后续写入（设暂停会重建它）
  assert.equal(设暂停('cov-恢复', 10), 10)
  assert.ok(暂停到('cov-恢复') > Date.now(), '坏表之后该能重新写入')
  设暂停('cov-恢复', 0)
})

test('⑦ 记批次：盖「最近一批」的戳，带 kind 与改动明细', () => {
  const sid = 'cov-批次'
  记批次(sid, '补日期', [{ id: 'm1', 旧: { at: '' }, 新: { at: '2026-01-01' } }])
  const 表 = 读批次表()
  assert.ok(表[sid], '批次戳没盖上 —— /undo-last 就认不出这批了')
  assert.equal(表[sid].kind, '补日期')
  assert.match(表[sid].at, /^\d{4}-\d{2}-\d{2}T/, '批次戳要带时间（撤销有时间窗）')
  assert.equal(表[sid].改动.length, 1, '改动明细该被存下来（undo-last 靠它做字段级恢复）')
  assert.deepEqual(表[sid].改动[0], { id: 'm1', 旧: { at: '' }, 新: { at: '2026-01-01' } })
  // 落盘的文件必须是 `_` 前缀 —— 否则 是会话文件() 会把它当成一个会话库，
  // /all 会多扫出一个「last-batch 会话」，会话数也跟着涨
  assert.ok(existsSync(join(STORE_DIR, '_last-batch.json')), '批次戳文件名必须是 _last-batch.json')
  assert.equal(join(STORE_DIR, '_last-batch.json').split(/[\\/]/).pop().charAt(0), '_', '批次戳文件必须带 _ 前缀')

  // 覆盖式：同一 sid 再来一批，只留最近那批
  记批次(sid, '补类型', [])
  assert.equal(读批次表()[sid].kind, '补类型', '同一会话该只留最近一批')
  // 多个会话互不干扰
  记批次('cov-批次2', '重判')
  assert.equal(读批次表()[sid].kind, '补类型')
  assert.equal(读批次表()['cov-批次2'].kind, '重判')
})

test('⑦ 记批次：改动明细截断到 2000 条（撤销时别把内存撑爆）', () => {
  const sid = 'cov-大批次'
  const 大 = []
  for (let i = 0; i < 2500; i++) 大.push({ id: 'm' + i, 旧: {}, 新: { importance: 1 } })
  记批次(sid, '补标', 大)
  const 存下 = 读批次表()[sid].改动
  assert.equal(存下.length, 2000, '改动明细该截断到 2000 条，实际 ' + 存下.length)
  assert.equal(存下[0].id, 'm0', '该留**最前面**的（前 2000 条）')
  assert.equal(存下[1999].id, 'm1999')
  // 不是数组就不写这一格（普通改一条不该带明细）
  记批次(sid, '普通')
  assert.ok(!('改动' in 读批次表()[sid]), '没给改动明细时不该凭空造一格')
  // 无 sid 直接返回，不抛也不写
  assert.doesNotThrow(() => 记批次('', '补日期', []))
  assert.doesNotThrow(() => 记批次(null, '补日期', []))
})

test('批次表：文件坏了 / 不存在 → 返回空对象', () => {
  // ⚠ 不能用 读一份() —— 它会把任何文件规范化成记忆库结构（未知字段全丢），
  //   这个文件只是个小 map（sid → { at, kind }），必须原样 JSON.parse
  const p = join(STORE_DIR, '_last-batch.json')
  writeFileSync(p, '{ 坏了 ', 'utf8')
  assert.deepEqual(读批次表(), {}, '批次表坏了该兜成空对象，不能抛')
  writeFileSync(p, '[1,2]', 'utf8')
  assert.deepEqual(读批次表(), {}, '批次表是数组时也该兜成空对象')
  writeFileSync(p, 'null', 'utf8')
  assert.deepEqual(读批次表(), {})
})
