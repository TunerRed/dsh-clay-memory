// lib/ui.mjs —— 展示层：工作区/归档/已知会话名单 + 记忆清单 + 设置页 HTML
// ============================================================================
// 2026-10-30 从 index.js 抽出（拆层工程第 9 批）。依赖方向：
//   paths(STORE_DIR/CFG_DIR/factPath)、store-core(loadStore)、cfg(loadCfg/isEnabled)、
//   names(userPronoun/selfNameOf/ownerNameOf)、tools(titleOfSession/sessionIdOf)
// 注入槽：接报信(diag)
// ============================================================================
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STORE_DIR, CFG_DIR, factPath, storePath, 是会话文件, 宿主数据根 } from './paths.mjs'
import { loadStore, 读一份 } from './store-core.mjs'
import { loadCfg, isEnabled, globalOn, fitPolicy, DEFAULT_POLICY, POLICY_SPEC } from './cfg.mjs'
import { userPronoun, selfNameOf, ownerNameOf, titleNameOf } from './names.mjs'
import { titleOfSession, sessionIdOf } from './tools.mjs'
import { 装词表, 装词频 } from './lexicon.mjs'
import { writeFileAtomicSync } from './atomic-file.mjs'
import { 鲜活度 } from './scoring.mjs'

// 版本号从 package.json 读（2026-09-23 起；读不到显示 ?）—— 从 index.js 随段搬来
const VERSION = (() => {
  try {
    const p = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'))
    return String(p.version || '?')
  } catch (error) {
    return '?'
  }
})()

let 报 = () => {}
export function 接报信(fn) { if (typeof fn === 'function') 报 = fn }
const diag = (msg) => { try { 报(msg) } catch { /* 日志失败不影响主流程 */ } }

// ⚠ 归档只是把会话**藏起来**，不会把它卸载 —— agents.list() 里还在，得单独查这个名单。
//    这个属性没写进 workspaceRegistry 的公开方法表，但运行时确实有
//
// ⚠⚠ 2026-09-21 修：原来是 `catch { return new Set() }` —— **读不到就静默当成「没有归档」**，
//    于是归档的会话照样露在清单里，而且一点痕迹都不留（反馈： 11 条幽灵就是这么来的）。
//    现在：① 每条路都留日志（只在内容变化时打，免得每 3 秒刷屏）；② 服务读不到就兜底读存储文件；
//    ③ 两条都不行才放弃，而且**宁可多露、不可错藏**。
// ⭐ 1.8.0：选档案的「上次目录」 + 工作区小工具
function 挑选目录文件() { return join(STORE_DIR, '_last-pick.json') }
function 读挑选目录() {
  try {
    const j = JSON.parse(readFileSync(挑选目录文件(), 'utf8'))
    return j && typeof j.dir === 'string' ? j.dir : ''
  } catch (error) { return '' }
}
function 写挑选目录(dir) {
  try {
    writeFileAtomicSync(挑选目录文件(), JSON.stringify({ dir: String(dir), at: new Date().toISOString() }, null, 2))
  } catch (error) { diag('记挑选目录失败：' + ((error && error.message) || String(error))) }
}
function 目录在(p) {
  try { return !!p && statSync(String(p)).isDirectory() } catch (error) { return false }
}
function 当前工作区根() {
  try { return String(process.cwd() || '') } catch (error) { return '' }
}
function 工作区号(w, i) {
  const v = w && (w.id || w.key || w.path)
  return v ? String(v) : String(i)
}
let 归档名单上次日志 = ''
function 归档名单log(msg) {
  if (msg === 归档名单上次日志) return
  归档名单上次日志 = msg
  diag(msg)
}

function 归档名单(ctx) {
  const out = new Set()
  // 路一：问运行时的服务（首选，实时）
  try {
    const wr = ctx.get('workspaceRegistry')
    if (wr === undefined) {
      归档名单log('归档名单：ctx.get("workspaceRegistry") 是空的')
    } else {
      const ids = wr.archivedSessionIds
      if (Array.isArray(ids)) {
        for (const x of ids) out.add(String(x))
        归档名单log('归档名单：从服务拿到 ' + out.size + ' 个')
        return out
      }
      归档名单log('归档名单：服务上的 archivedSessionIds 不是数组，是 ' + typeof ids)
    }
  } catch (error) {
    归档名单log('归档名单：读服务抛错 -> ' + ((error && error.message) || String(error)))
  }
  // 路二：兜底读 DSH 自己的存储文件（同一份数据，格式稳定）
  try {
    const j = JSON.parse(readFileSync(join(宿主数据根(), 'workspace.json'), 'utf8'))
    const ids = j && j.global && j.global.archivedSessionIds
    if (Array.isArray(ids)) {
      for (const x of ids) out.add(String(x))
      归档名单log('归档名单：从存储文件兜底拿到 ' + out.size + ' 个')
      return out
    }
    归档名单log('归档名单：存储文件里没有 global.archivedSessionIds')
  } catch (error) {
    归档名单log('归档名单：读存储文件也失败 -> ' + ((error && error.message) || String(error)))
  }
  归档名单log('归档名单：两条路都拿不到，这次不做归档隐藏（宁可多露，不可错藏）')
  return out
}

// DSH 现在认得哪些会话 —— 用来认「幽灵」（会话已经没了、记忆文件还留着）
// ⚠ ok=false 表示**没拿到可信来源**，这时候调用方必须保守：一条都不藏
let 已知会话上次日志 = ''
function 已知会话log(msg) {
  if (msg === 已知会话上次日志) return
  已知会话上次日志 = msg
  diag(msg)
}

function 已知会话ids(ctx) {
  const ids = new Set()
  try {
    const wr = ctx.get('workspaceRegistry')
    if (wr === undefined) {
      已知会话log('已知会话：ctx.get("workspaceRegistry") 是空的 —— 这次一条都不藏')
      return { ids, ok: false }
    }
    if (typeof wr.list !== 'function') {
      已知会话log('已知会话：workspaceRegistry 上没有 list() —— 这次一条都不藏')
      return { ids, ok: false }
    }
    const list = wr.list() || []
    for (const w of list) for (const id of (w && w.sessionIds) || []) ids.add(String(id))
    已知会话log('已知会话：拿到 ' + ids.size + ' 个（工作区 ' + list.length + ' 个）')
  } catch (error) {
    已知会话log('已知会话：读 workspaceRegistry 抛错 -> ' + ((error && error.message) || String(error)))
    return { ids, ok: false }
  }
  // ⚠ 一个都没拿到就不算可信 —— 否则会把所有记忆都当幽灵藏掉
  return { ids, ok: ids.size > 0 }
}

// 拼出给页面看的全部数据（/list 和 /page 共用）
// 这个会话是从哪个会话分出来的（拿不到就 null）—— 界面上标「分支」用
function 分支来处Of(ctx, sid) {
  try {
    const a = ctx.agents.get(String(sid))
    const h = a && a.session && a.session.header
    return h && h.parentSession ? String(h.parentSession) : null
  } catch (error) {}
  return null
}

// 这一条算「事实」（住全局库）还是「事件」（留本会话）—— 全场只有 `category` 说了算
const 是事实条 = (m) => !!m && m.category === 'stable_profile'

function buildMemoryList(ctx) {
  const out = { ok: true, sessions: [], policy: null, ghosts: 0, 全局开关: globalOn() }
  // ⭐⭐ 1.4.0 双层记忆：**事实 / 事件分开报**（前端 lib/client.js 就是按这两个数显示的）
  //   一个会话的 `memories` = 「全部全局事实」+「本会话事件」。整份糊成一个 `count`
  //   看着像本会话独有，其实一半是全局的 —— 所以：
  //     factsCount = 全局事实有几条（每个会话看到的都一样，页面顶部那行要用它）
  //     eventCount = 本会话自己的事件有几条
  //   `count` 保留（= 合并视图总数），别让老页面/老脚本读不到 ✓
  out.factsCount = 0
  // ⭐ 1.8.20：设置页要能看到「词门」健康状态 —— 词典/词频整仓丢过一次且静默，
  //   这里把两张表的装载情况报给前端，缺了就红字提示（不再无声失效）
  try {
    out.lexicon = { 词典: 装词表().size, 词频: 装词频().size }
  } catch (error) {
    out.lexicon = { 词典: 0, 词频: 0 }
  }
  try {
    const 事实盘 = 读一份(factPath())
    const 坟 = new Set((事实盘.deleted || []).map((m) => String(m && m.id)))
    out.factsCount = (事实盘.memories || []).filter((m) => !坟.has(String(m.id))).length
  } catch (error) {}
  // ⭐ 1.2.7：设置页显示「全局参数」—— 以前是「碰到的第一个库的参数」，没有库就什么都没有
  try {
    const c0 = loadCfg()
    out.policy = fitPolicy(null, { ...DEFAULT_POLICY, ...(c0.policy || {}) }).policy
  } catch (error) {}
  try {
    // 活着的会话 ＋ 存过记忆的会话，都要露出来 ——
    // 不然新开的对话在列表里根本不出现，也就没有开关可点 ✗
    // ⚠ 但**被她归档的不要露** —— 归档了就该像归档了的样子（反馈）
    // ⚠⚠ 2026-09-21 再加一道：**DSH 里已经没有这个会话了，就别露** ——
    //     记忆库是独立文件（.dsh\clay-memory\<会话id>.json），删会话不会连带删它，
    //     不拦的话列表里会堆一堆幽灵（反馈：那 11 条就是这么来的）
    const 归档的 = 归档名单(ctx)
    const 已知 = 已知会话ids(ctx)
    const ids = []
    const liveIds = new Set()
    const push = (x) => {
      if (!x || 归档的.has(String(x))) return
      if (ids.indexOf(x) < 0) ids.push(x)
    }
    // ⭐ 2026-10-31 主实例：DSH 登记的全部会话都进列表 —— 以前只露「在线 + 存过记忆的」，
    //   会话页签按工作区一过滤，大部分工作区就空了。已知.ok 为假（服务拿不到）时保持旧行为。
    if (已知.ok) {
      for (const id of 已知.ids) push(id)
    }
    try {
      for (const a of ctx.agents.list() || []) {
        const x = sessionIdOf(a.session)
        push(x)
        if (x) liveIds.add(x)
      }
    } catch (error) {}
    try {
      let 藏了 = 0
      for (const fn of readdirSync(STORE_DIR)) {
        if (!是会话文件(fn)) continue
        const sid = fn.replace(/\.json$/, '')
        // 在线的一律算存在；已知.ok 为假时**一条都不藏**（宁可多露，不可错藏）
        if (已知.ok && !liveIds.has(sid) && !已知.ids.has(String(sid))) { 藏了++; continue }
        push(sid)
      }
      if (藏了 > 0) {
        out.ghosts = 藏了
        diag('清单：藏起 ' + 藏了 + ' 条幽灵（DSH 里已经没有这些会话了）')
      }
    } catch (error) {}
    for (const sid of ids) {
      // ⭐ 2026-10-31 主实例：几百个会话里只有几个存过记忆 —— 没文件的会话不再整库读，
      //   全局事实数直接当 factsCount（事实本来就全会话共享），memories 留空。快一个量级。
      const 有文件 = existsSync(storePath(sid))
      const data = 有文件 ? loadStore(sid) : null
      if (!out.policy && data) out.policy = data.policy
      out.sessions.push({
        id: sid,
        title: titleOfSession(ctx, sid),
        // ⭐ 1.2.9：这个会话里「怎么称呼对方」+「她自己叫什么」，设置页两个输入框要回显
        ownerName: ownerNameOf(sid),
        selfName: selfNameOf(sid),
        enabled: isEnabled(sid),
        live: liveIds.has(sid),
        parent: 分支来处Of(ctx, sid),
        count: data ? data.memories.length : out.factsCount,
        // 事实 / 事件分开报（见函数开头那段）。事实是全局的 —— 每个会话这几个数字都一样
        factsCount: data ? data.memories.filter(是事实条).length : out.factsCount,
        eventCount: data ? data.memories.filter((m) => !是事实条(m)).length : 0,
        memories: data ? data.memories.map((m) => {
          // ⚠⚠ 2026-09-22 修（反馈：「没标时间的还是鲜活 100%，有些还是 —」）：
          //   原来这里自己写了一套公式 —— 长期事实无条件 1（100%）、
          //   没时间的 `Date.parse(undefined)` 出 NaN ✗
          //   现在**跟召回用同一个函数** ✓（她看到的 = 真正发生的）
          let act = null
          try {
            const v = 鲜活度(m, data.policy, Date.now())
            act = Number.isFinite(v) ? v : null
          } catch (e) {}
          // ⭐⭐ 2026-09-22（反馈：「这些为什么会被当成长期事实」）：
          //   **「不会淡」的只有一类：长期事实** ✓
          //     ⚠ 上一版我拿「鲜活度是不是钉住的」当判据 —— 那是**算分的副作用**，
          //       不是语义。结果把 394 条没抠到日期的**流水账**错收进「不会淡的」里 ✗
          //   没记时间的现在**也会淡**（从「记下来的那天」开始算）→ 它们算「会淡的」✓
          //   freshKind 只用来决定**显示什么字**：
          //     fact    = 长期事实 → 「不淡」
          //     dated   = 有日期的 → 百分比
          //     recorded= 没记时间的（从记下来那天算）→ 百分比
          //     unknown = 连记下来的时间都没有 → 「—」
          const 有锚 = !!(m.activationAnchor || m.at || m.createdAt || m.importAt)
          const freshKind =
            m.category === 'stable_profile' ? 'fact' : m.at ? 'dated' : 有锚 ? 'recorded' : 'unknown'
          return {
            id: m.id,
            text: m.text,
            at: m.at,
            importance: m.importance,
            source: m.source,
            category: m.category,
            // ⭐ 1.5.0 A 轮（F1/F16）：**作用域**跟重要度拆开，界面上是徽章 / 筛选项
            //   category 是存储权威（stable_profile 住全局事实库，其余住会话库），
            //   这里只把它翻成人话：global = 全局记忆，session = 指定会话
            //   ⚠ 只**加**字段，`category` 照旧发（老页面 / 老脚本还在读它）
            // GPT 整改 P2（workspace）：条目自带 scope 优先（workspace:<cwd> 透出去），老条目按 category 推断
            scope:
              typeof m.scope === 'string' && m.scope
                ? m.scope
                : m.category === 'stable_profile'
                  ? 'global'
                  : m.category === 'workspace'
                    ? 'workspace'
                    : 'session',
            // 类型（1.5.0 A 轮）：身份 / 关系 / 约定 / 偏好 / 经历 / 杂项，只做展示与筛选
            type: m.type || '',
            activation: act,
            freshKind: freshKind,
            // ⚠⚠ 2026-09-22 修（反馈「显示的话就像是要从头来呀」）：
            //   `/list` 原来**没发这个字段** —— 于是页面算「没判过的」永远是**全库条数** ✗
            //   判了 640 条之后，确认条还写着「判一遍这 784 条」→ 看着像要从头重来
            //   （服务端本来就是按 stableChecked 过滤的，只会判剩下的 —— 是**显示**在骗人）
            stableChecked: !!m.stableChecked,
            related: Array.isArray(m.related) ? m.related : null,
            refined: !!m.refinedAt,
            refinedSkip: !!m.refinedSkip,
            // ⭐⭐ 2026-09-23：「已被取代」—— 界面上要看得见、能撤销 ✓
            已被取代: m.已被取代 ? { 为什么: String(m.已被取代.为什么 || ''), 作废于: m.已被取代.作废于 || null } : null,
            // ⭐⭐ 2026-09-23：**事实键** —— 界面上看得见（同键的条目一眼能认出来）✓
            事实键: typeof m.事实键 === 'string' && m.事实键 ? m.事实键 : null,
            // ⚠ 「清洗补键」洗过的记号（含判了留空的）——
            //   界面上要能算清「还剩几条要洗」，不然按钮上的数字永远不消 ✗
            洗键过: !!m.洗键过,
            // ⚠ 「这个键是自动标的，还是她自己填的」—— 撤回按钮要按这个算数 ✗
            //   界面上拿不到这个字段，撤回按钮的数字就会把手工填的也算进去（数对不上）
            键来源: typeof m.键来源 === 'string' && m.键来源 ? m.键来源 : null,
            // 提炼改之前的原文 —— 界面上要能对照、能退回 ✓
            textBefore: typeof m.textBefore === 'string' ? m.textBefore : null,
          }
        }) : [],
        traces: data ? data.traces || [] : [],
        lastTrace: data && data.traces && data.traces.length ? data.traces[data.traces.length - 1].at : null,
        deleted: data ? (data.deleted || []).map((m) => ({ id: m.id, text: m.text, at: m.at, importance: m.importance, category: m.category, deletedAt: m.deletedAt })) : [],
        selfName: selfNameOf(sid),
        titleName: titleNameOf(ctx, sid),
        // 导过几批、每批几条 —— 给「撤销这次导入」用 ✓
        importBatches: data ? (() => {
          const 批 = {}
          for (const m of data.memories || []) {
            const k = m.importBatch
            if (!k) continue
            if (!批[k]) 批[k] = { id: k, n: 0, at: m.importAt || null }
            批[k].n++
          }
          return Object.keys(批)
            .map((k) => 批[k])
            .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
        })() : [],
      })
    }
  } catch (error) {}
  if (!out.policy) out.policy = { ...DEFAULT_POLICY }
  out.spec = POLICY_SPEC
  out.defaults = { ...DEFAULT_POLICY }
  out.version = VERSION
  out.userPronoun = userPronoun()
  return out
}

// ---------- 设置页（一个网页）----------

const MEMORY_PAGE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<title>DSH 记忆</title>
<style>
 body{background:#14161a;color:#dcdcdc;font:13px/1.7 "Microsoft YaHei",system-ui,sans-serif;margin:0;padding:20px 26px}
 h1{font-size:17px;margin:0 0 4px}
 .sub{color:#8a8a8a;font-size:12px;margin-bottom:18px}
 h2{font-size:14px;margin:22px 0 8px;color:#cfcfcf;border-bottom:1px solid #2a2d33;padding-bottom:5px}
 table{width:100%;border-collapse:collapse;font-size:12px}
 th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #23262b;vertical-align:top}
 th{color:#8a8a8a;font-weight:normal}
 .id{color:#6f7681;font-family:monospace}
 .imp{color:#e0b070}
 .when{color:#8fd0a0}
 .gate{color:#7a7f88}
 .sel{color:#8fd0a0}
 .drop{color:#8a6f6f}
 .src{color:#7a8fa8;font-size:11px}
 button{background:#2a2d33;color:#dcdcdc;border:1px solid #3a3d44;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:12px}
 button:hover{background:#34383f}
 input{background:#1b1e23;color:#dcdcdc;border:1px solid #33373d;border-radius:5px;padding:3px 7px;width:80px;font-size:12px}
 .row{margin:4px 0}
 .muted{color:#6f7681;font-size:11px}
</style></head><body>
<h1>🐳 DSH 记忆</h1>
<div class="sub">每个会话一份记忆。<b>淡了只是不容易被想起来，不会删。</b></div>

<div id="top"></div>

<h2>参数（改完点保存）</h2>
<div id="policy"></div>

<div id="body">加载中…</div>

<script>
// 全局捕错 —— 出什么事都写出来，别静默 ✗
window.onerror = function(m,s,l,c){ var b=document.getElementById('body'); if(b) b.innerHTML = '<div style="color:#c98080">JS 出错：'+m+'  （第'+l+'行 第'+c+'列）</div>' }
window.addEventListener('unhandledrejection', function(e){ var b=document.getElementById('body'); var r=e.reason; if(b) b.innerHTML = '<div style="color:#c98080">出错了：'+((r&&r.message)||r)+'</div>' })

const fmt = (t) => { if(!t) return '（没记时间）'; const d=new Date(t); const p=n=>String(n).padStart(2,'0'); return p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes()) }
const rel = (t, now) => { if(!t) return '（没记时间）'; const days=Math.floor((now-Date.parse(t))/86400000); if(days<=0) return '今天 '+fmt(t).slice(6); if(days===1) return '昨天 '+fmt(t).slice(6); if(days<30) return days+' 天前'; return fmt(t).slice(0,5)+'（'+days+' 天前）' }
const impName = (v) => v>=1?'非常重要':v>=0.5?'比较重要':'随口提过'

async function load(){
  const r = await fetch('/dsh-clay-memory/list', {cache:'no-store'})
  const d = await r.json()

  const now = Date.now()

  document.getElementById('top').innerHTML =
    '<h2>概览</h2><div class="muted">默认全是关的 —— 到「设置 → 黏土记忆」里点开，那个会话才会记、才会读。</div>' +
    '<table><tr><th>会话</th><th>记忆</th><th>开关</th><th>最近召回</th></tr>' +
    d.sessions.map(s => '<tr><td>'+(s.title?s.title:"（没有名字）")+' <span class="id">'+s.id.slice(0,18)+'…</span></td><td>'+(s.eventCount ?? s.count)+' 条事件</td><td>'+(s.enabled?'开':'关')+'</td><td>'+(s.lastTrace?rel(s.lastTrace,now):'（还没有）')+'</td>' +
    '</tr>').join('') +
    '</table>'

  const p = d.policy
  document.getElementById('policy').innerHTML =
    [
      'baseHalfLifeDays|半衰期（天）|普通事件多久淡一半。越大忘得越慢（30 = 一个月后剩一半）',
      'emotionHalfLifeDays|情绪半衰期（天）|情绪多久淡一半 —— 比普通事件快（7 = 一周后剩一半）',
      'threshold|选入门槛|分数低于它就不注入。越大越严格、越少塞东西',
      'rarityK|稀有度饱和点|命中词的稀有度（0~1）加起来到多少算「一半相关」。越小越容易给（1 = 一个满稀有的词就差不多够）',
      'queryGate|问句信息量门槛|这句话本身太没内容（像「在吗」）就不翻记忆。尺子是「你自己怎么说话」。0 = 关掉这道门',
      'maxItems|最多注入几条|一次最多塞几条记忆给她。越大越占上下文',
      'dailyQuota|每天最多记几条|她自己一天最多能记几条 —— 防止猛猛记',
    ]
    .map(x => { const [k,label,tip]=x.split('|'); return '<div class="row">'+label+' <input id="p_'+k+'" value="'+p[k]+'"> <span class="muted">'+tip+'</span></div>' }).join('') +
    '<div class="row"><button onclick="save()">保存参数</button> <span id="saved" class="muted"></span></div>'

  let html = ''
  for (const s of d.sessions) {
    if (!s.memories.length) continue
    html += '<h2>'+(s.title?s.title:s.id.slice(0,26)+'…')+' （'+s.memories.length+' 条）</h2><table><tr><th>什么时候</th><th>内容</th><th>重要</th><th>来源</th><th>现在多鲜活</th></tr>'
    for (const m of s.memories) {
      html += '<tr><td class="when">'+rel(m.at, now)+'</td><td>'+m.text+'</td><td class="imp">'+impName(m.importance)+'</td>' +
              '<td class="src">'+(m.source||'')+'</td><td class="muted">'+(m.activation!=null?m.activation.toFixed(2):'—')+'</td></tr>'
    }
    html += '</table>'
    const tr = (s.traces||[]).slice(-1)[0]
    if (tr) {
      html += '<div class="muted" style="margin:8px 0 0">最近一次召回 —— 线索：「'+(tr.query||'').slice(0,50)+'」' +
              (tr.gate!=null ? ' ｜ 这句话的信息量 '+tr.gate+(tr.gateLimit!=null?' / 门槛 '+tr.gateLimit:'') : '') + '</div>'
      if (tr.gate!=null && !(tr.rows||[]).length) {
        html += '<div class="muted">这句话本身没什么内容，这次没翻记忆 —— 这是**问句信息量门槛**挡的。' +
                '想让它照样翻，把「问句信息量门槛」调小；调成 0 就是关掉这道门。</div>'
      }
      html += '<table><tr><th>记忆</th><th>相关度 C</th><th>分数 P</th><th>结果</th></tr>'
      for (const r of (tr.rows||[]).slice(0,12)) {
        const mm = s.memories.find(x=>x.id===r.id)
        const label = r.omission ? ({hard_gate:'没命中线索',below_threshold:'分数不够',limit:'超过条数上限',budget:'字数超了',query_gate:'问句没内容',fact_cap:'事实名额满了'}[r.omission]||r.omission) : '选中了'
        html += '<tr><td class="muted">'+((mm&&mm.text)||r.id).slice(0,34)+'</td><td>'+r.C+'</td><td>'+r.P+'</td>' +
                '<td class="'+(r.omission?'drop':'sel')+'">'+label+(r.timeHit?' ⭐时间词':'')+'</td></tr>'
      }
      html += '</table>'
    }
  }
  document.getElementById('body').innerHTML = html || '<div class="muted">（还没有任何记忆）</div>'
}

async function toggle(sid){
  const on = document.getElementById('btn_'+sid).textContent.indexOf('已开启') < 0
  await fetch('/dsh-clay-memory/toggle', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({session:sid, on:on})})
  load()
}

async function save(){
  const keys = ['baseHalfLifeDays','emotionHalfLifeDays','threshold','maxItems','dailyQuota','rarityK','queryGate']
  const policy = {}
  for (const k of keys) policy[k] = Number(document.getElementById('p_'+k).value)
  await fetch('/dsh-clay-memory/policy', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(policy)})
  document.getElementById('saved').textContent = '✓ 存好了'
  setTimeout(load, 300)
}

try { load() } catch (e) { document.getElementById('body').innerHTML = '<div style="color:#c98080">出错了：' + e.message + '</div>' }
</script></body></html>`

export { 挑选目录文件, 读挑选目录, 写挑选目录, 目录在, 当前工作区根, 工作区号, 归档名单, 已知会话ids, 分支来处Of, 是事实条, buildMemoryList, MEMORY_PAGE }
