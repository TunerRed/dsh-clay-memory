// 所有记忆页 —— 2026-11-11 从 lib/client.js 拆出来（逻辑未改）
// 依赖由正文注入；模块内部自成一体。
import { 造选择器 } from '../components/select.js'
export function 造所有记忆页({ React, el, get, post, B, S, G, rel, 类型名, 类型表, 同日, 归整, 一次最多画, 重要色 }) {
      const 选择器 = 造选择器({ React, el })

      function 所有记忆页(props) {
        const [d, setD] = React.useState(null)
        const [err, setErr] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [提示, set提示] = React.useState(null)
        const [源, set源] = React.useState(null) // 'all' = 新端点 / 'list' = 退化
        const [搜, set搜] = React.useState('')
        const [作用域, set作用域] = React.useState('全部')
        const [会话, set会话] = React.useState('')
        const [类型, set类型] = React.useState('全部')
        const [状态, set状态] = React.useState('活跃')
        const [画全部, set画全部] = React.useState(false)
        const [在改, set在改] = React.useState(null)
        const [改稿, set改稿] = React.useState('')
        const [改层级, set改层级] = React.useState('global') // 改这条时选的层级：global/workspace/session ✓
        const [要删, set要删] = React.useState(null)
        const [加开, set加开] = React.useState(false)
        const [加正文, set加正文] = React.useState('')
        const [加类型, set加类型] = React.useState('identity')
        const [加重要, set加重要] = React.useState(0.5) // 0 小事 / 0.5 一般 / 1 很重要
        // ⭐ F15（1.10.3）：健康度 —— 近 7 天到底在不在工作。以前页面上只有一个「想起 N 次」的累计数，
        //   看不出「想起来了但没东西」和「根本没被调用」的区别。
        const [健康, set健康] = React.useState(null)
        // ⭐ 1.11.0 一期（§4.8）：候选区 —— 钩子挑出来的「像该记的话」，采纳了才进正式记忆
        const [候选们, set候选们] = React.useState(null)
        const [候选开, set候选开] = React.useState(false)
        // ⭐ F20（1.12.13）：整理（查重合并 / 洗键）原来散在会话详情里，现在搬到这一页，一次看全部会话
        const [整理跑, set整理跑] = React.useState(false)
        const [整理话, set整理话] = React.useState('')
        const [查重结果, set查重结果] = React.useState(null)
  
        const 查重 = async () => {
          set整理跑(true)
          set整理话('正在跟全部会话比……')
          try {
            const r = await get('/duplicates-all')
            if (!r || r.ok === false) set整理话('查重失败：' + ((r && r.message) || '？'))
            else {
              set查重结果(r)
              set整理话(r.总组 ? '找到 ' + r.总组 + ' 组完全重复，合并能少 ' + r.能少 + ' 条（留着的那条不动）' : '没有完全重复的条目')
            }
          } catch (e) {
            set整理话('查重出错：' + String((e && e.message) || e))
          }
          set整理跑(false)
        }
        // ⭐ 1.12.15：补键（洗键）也搬到这一页 —— 以前藏在会话详情里，N 洗完变 0 按钮消失就再也找不到
        const [补键结果, set补键结果] = React.useState(null)
        const 查补键 = async () => {
          set整理跑(true)
          set整理话('正在数还剩多少条没标……')
          try {
            const r = await get('/wash-plan')
            if (!r || r.ok === false) set整理话('补键读不出来：' + ((r && r.message) || '？'))
            else {
              set补键结果(r)
              set整理话(r.总剩 ? '还有 ' + r.总剩 + ' 条没标「这件事叫什么」（' + r.会话.length + ' 个会话）' : '都标过了：库里 ' + r.带键 + ' 条带键，没有要补的')
            }
          } catch (e) {
            set整理话('补键出错：' + String((e && e.message) || e))
          }
          set整理跑(false)
        }
        const 洗一批 = async (sid) => {
          set整理跑(true)
          set整理话('正在让模型给一批补键……（会调模型，按量计费）')
          try {
            const r = await post('/wash-keys', { session: sid, 每批: 20 })
            if (!r || r.ok === false) set整理话('补键失败：' + ((r && r.message) || '？'))
            else set整理话('这批给键 ' + (Number(r.给了键) || 0) + ' 条、留空 ' + (Number(r.留空) || 0) + ' 条，还剩 ' + (Number(r.剩) || 0) + ' 条')
          } catch (e) {
            set整理话('补键出错：' + String((e && e.message) || e))
          }
          set整理跑(false)
          await 查补键()
        }
        const 合并全部 = async () => {
          if (!查重结果 || !Array.isArray(查重结果.会话)) return
          set整理跑(true)
          set整理话('正在合并……')
          let 收 = 0
          let 保 = 0
          for (const x of 查重结果.会话) {
            try {
              const r = await post('/duplicates/merge', { session: x.session, 组: x.组 })
              if (r && r.ok !== false) 收 += Number(r.收起来) || 0
              保 += Number(r && r.保住) || 0
            } catch (e) {
              保 += 1
            }
          }
          set整理话('合掉了 ' + 收 + ' 条' + (保 ? '，另有 ' + 保 + ' 条不够像、保住了' : '') + '。收在「已删」里，能找回来。')
          set整理跑(false)
          set查重结果(null)
        }
        // ⭐ 1.7.3：这一页有两个「看哪些记忆」的入口 ——
        //   作用域=全部/全局记忆 → 用 /all（去重后的一份，跨会话不重复）
        //   作用域=指定会话     → 用 /all?session=<那个会话>（它自己的视图，含 copy-to 出来的副本）
        //   后者不能用全局去重：两个会话是同一批 id 复制出来的，先扫到的会把 id 全占走 ✗
        const 当前会话 = 会话 || ((d && d.会话们 && d.会话们[0] && d.会话们[0].id) || '')
  
        // ⚠ 1.7.3 踩坑：装载 用 useCallback 包着，闭包里读到的是**创建时**的 作用域/当前会话。
        //   切到「指定会话」以后点刷新，闭包还停在旧的 作用域='全部'，于是永远不带 session ✗
        //   改成「ref 存最新值 + effect 显式依赖」，两条路都能拿到当前的选择。
        // ⭐ 1.7.3（用户：「记忆页选指定会话是空的，点进那个会话却有」）
        //   根因：会话事件按 id 全局去重 —— 两个会话是 copy-to 出来的同一批 id，
        //   先扫到的把 id 全占走，后一个一条都不剩。
        //   改法：这一页直接用 /list（每个会话**各自**的合并视图），
        //   全局事实按 id 只留一份，会话事件按 (会话, id) 各留各的 ——
        //   于是「全部」不会一屏两份，「指定会话」也筛得出东西。
        const 装载 = React.useCallback(() => {
          setBusy(true)
          setErr(null)
          get('/list')
            .then((l) => {
              if (!l || l.ok === false) throw new Error((l && (l.message || l.error)) || '读不出来')
              const 条们 = []
              const 见过 = new Map()
              for (const s of l.sessions || []) {
                for (const m of s.memories || []) {
                  if (!m) continue
                  const 是事实 = m.category === 'stable_profile'
                  const 是工区 = m.category === 'workspace'
                  // ⭐ 2026-11-01（用户：重启后记忆里多了 1800 多条 → 查下来是工作区层的问题）：
                  //   事实按 id 一份、事件按 (会话,id) 各留 —— 这是 1.7.3 的语义（见 94da6d5）。
                  //   但 1.8.39 加的工作区条目会出现在**每个属于该 cwd 的会话合并视图**里，
                  //   走「会话:id」就会把 214 条工作区记忆复制成 1813 条 ✗
                  //   → 工作区层单独按 id 去重（同 id 就是同一条项目记忆，跨会话共享）。
                  //   缺的 type / at / 重要度用其它副本补齐，具体类型（非 misc）优先。
                  //   （渲染 key 仍带 session，见 行() —— 那处不动，避免 React 复用串味。）
                  const 键 = 是事实
                    ? 'g:' + String(m.id)
                    : 是工区
                      ? 'w:' + String(m.id)
                      : String(s.id) + ':' + String(m.id)
                  const 旧 = 见过.get(键)
                  if (旧) {
                    const 具体 = (t) => !!t && t !== 'misc'
                    if (!旧.type && m.type) 旧.type = m.type
                    else if (具体(m.type) && !具体(旧.type)) 旧.type = m.type
                    if (!旧.at && m.at) 旧.at = m.at
                    if (!旧.importance && m.importance) 旧.importance = m.importance
                    continue
                  }
                  const 一条 = 归整(
                    Object.assign({}, m, {
                      session: s.id,
                      sessionTitle: s.title || '',
                      scope: 是事实 ? 'global' : 是工区 ? String(m.scope || 'workspace') : 'session',
                    }),
                    false,
                  )
                  见过.set(键, 一条)
                  条们.push(一条)
                }
              }
              set源('list')
              setD({
                条们,
                会话们: (l.sessions || []).map((x) => ({ id: x.id, title: x.title || x.id })),
                统计: null,
                全局开关: l.全局开关,
              })
              setBusy(false)
            })
            .catch((e) => {
              setErr(String((e && e.message) || e))
              setBusy(false)
            })
        }, [])
        React.useEffect(() => {
          装载()
          // ⭐ F15：健康度单独拉一次 —— 拿不到就不显示，不影响记忆列表（老版本后端没这个端点时静默）
          get('/health?days=7')
            .then((r) => {
              if (r && r.ok !== false) set健康(r)
            })
            .catch(() => {})
          // 候选：老版本后端没有这个端点时静默（不打扰）
          get('/candidates')
            .then((r) => {
              if (r && r.ok !== false) set候选们(r)
            })
            .catch(() => {})
        }, [装载])
  
        const 全部 = (d && d.条们) || []
        const 会话们 = (d && d.会话们) || []
        const now = new Date().toISOString()
        const 计 = { 活跃: 0, 已被取代: 0, 已删: 0 }
        const 全计 = { 活跃: 0, 已被取代: 0, 已删: 0 }
        const 归类 = (m) => (m.deleted ? '已删' : m.已被取代 ? '已被取代' : '活跃')
        全部.forEach((m) => {
          全计[归类(m)]++
        })
        const q = 搜.trim().toLowerCase()
        const 底 = 全部.filter((m) => {
          if (作用域 === '全局记忆' && m.scope !== 'global') return false
          if (作用域 === '指定会话' && (m.scope !== 'session' || (当前会话 && m.session && m.session !== 当前会话)))
            return false
          if (类型 === '其他') {
            if (m.type && m.type !== 'misc') return false
          } else if (类型 !== '全部' && m.type !== 类型) return false
          if (q) {
            const 布 = [
              m.text,
              m.source,
              m.原话,
              m.sessionTitle,
              m.事实键,
              (m.related || []).join(' '),
            ]
              .join(' ')
              .toLowerCase()
            if (布.indexOf(q) < 0) return false
          }
          计[归类(m)]++
          return true
        })
        const 显示 = 底.filter((m) => 归类(m) === 状态)
        显示.sort((a, b) => String(b.at || b.createdAt || '').localeCompare(String(a.at || a.createdAt || '')))
        const 画的 = 画全部 ? 显示 : 显示.slice(0, 一次最多画)
  
        // 今天记了 N 条：优先用 /all 的 stats，没有就从 createdAt / id 时间戳数
        const 今天记 = (() => {
          const s = d && d.统计
          if (s && typeof s.todayAdded === 'number') return s.todayAdded
          let n = 0
          全部.forEach((m) => {
            if (!m.deleted && 同日(m.createdAt, now)) n++
          })
          return n
        })()
        // 想起 M 次：/all 的 stats，没有就数各会话召回记录里今天的
        const 今天想起 = (() => {
          const s = d && d.统计
          if (s && typeof s.todayRecalled === 'number') return s.todayRecalled
          let n = 0
          会话们.forEach((s2) => {
            ;(s2.traces || []).forEach((t) => {
              if (t && 同日(t.at, now)) n++
            })
          })
          return n
        })()
  
        const 记一条 = () => {
          const 正文 = 加正文.trim()
          if (!正文) {
            set提示('先写点什么')
            return
          }
          if (!当前会话) {
            set提示('还没有会话 —— 先在 DSH 里开一个对话，再回来记')
            return
          }
          setBusy(true)
          // 1.6.3：一律记全局（scope 不传也会按 importance 判，这里显式给 global 更清楚）
          post('/add', {
            session: 当前会话,
            text: 正文,
            importance: 加重要,
            scope: 'global',
            type: 加类型,
          })
            .then((r) => {
              if (!r || r.ok === false || r.error) {
                set提示('没记上：' + ((r && (r.error || r.message)) || '？'))
                setBusy(false)
                return
              }
              set加正文('')
              set加开(false)
              set提示('✓ 记下了（全局记忆）')
              // ⭐ 1.5.0（F2）：记完顺手给这一条补检索词 —— 后台跑，失败也不打扰她
              if (r.id) {
                post('/expand', { session: 当前会话, ids: [r.id], 每批: 1 }).catch(() => {})
              }
              装载()
            })
            .catch((e) => {
              set提示(String((e && e.message) || e))
              setBusy(false)
            })
        }
        const 存改 = (m) => {
          const 稿 = 改稿.trim()
          if (!稿) {
            set提示('不能改成空的')
            return
          }
          setBusy(true)
          // 原层：global / workspace / session；改层级了就一律走 /edit（带 scope）✓
          // 没改层级且本来就是全局 → 走 /facts/edit（不动落库）✓
          const 原层 = m.scope === 'global' ? 'global' : m.scope === 'workspace' ? 'workspace' : 'session'
          const 新层 = 改层级 || 原层
          const req =
            新层 === 原层 && 原层 === 'global'
              ? post('/facts/edit', { id: m.id, text: 稿 })
              : post('/edit', { session: m.session || 当前会话, id: m.id, text: 稿, scope: 新层 })
          req
            .then((r) => {
              set在改(null)
              set提示((r && (r.message || r.error)) || (r && r.ok ? '改好了' : '没改成'))
              装载()
            })
            .catch((e) => {
              set提示(String((e && e.message) || e))
              setBusy(false)
            })
        }
        const 删掉 = (m) => {
          setBusy(true)
          const req =
            m.scope === 'global'
              ? post('/facts/delete', { id: m.id })
              : post('/delete', { session: m.session || 当前会话, id: m.id, action: 'delete' })
          req
            .then((r) => {
              set要删(null)
              set提示((r && (r.message || r.error)) || (r && r.ok ? '删了' : '没删成'))
              装载()
            })
            .catch((e) => {
              set要删(null)
              set提示(String((e && e.message) || e))
              setBusy(false)
            })
        }
        // 找回删掉的：全局那条的「尸体」落在哪个会话库不确定 → 挨个试（通常就几个库）
        const 找回 = (m) => {
          setBusy(true)
          const 试 = async () => {
            let r = null
            const 序 = []
            if (m.session) 序.push(m.session)
            会话们.forEach((s) => {
              if (序.indexOf(s.id) < 0) 序.push(s.id)
            })
            for (let i = 0; i < 序.length; i++) {
              r = await post('/delete', { session: 序[i], id: m.id, action: 'restore' })
              if (r && r.ok) break
            }
            set提示((r && (r.message || r.error)) || '没找回来')
            setBusy(false)
            装载()
          }
          试().catch((e) => {
            set提示(String((e && e.message) || e))
            setBusy(false)
          })
        }
        const 撤销作废 = (m) => {
          setBusy(true)
          post('/delete', { session: m.session || 当前会话, id: m.id, action: 'unsupersede' })
            .then((r) => {
              set提示((r && (r.message || r.error)) || '好了')
              装载()
            })
            .catch((e) => {
              set提示(String((e && e.message) || e))
              setBusy(false)
            })
        }
  
        // ⭐ B 轮 F5：这条不对 —— 标记后不再被想起来，但原文还在
        const 标不对 = (m) => {
          setBusy(true)
          post('/mark-wrong', { session: m.session || 当前会话, id: m.id, undo: !!m.别记 })
            .then((r) => {
              set提示((r && (r.message || r.error)) || (m.别记 ? '撤销标记了' : '标好了 —— 这条以后不会再被想起来'))
              装载()
            })
            .catch((e) => {
              set提示(String((e && e.message) || e))
              setBusy(false)
            })
        }
  
        // 同一条记忆可能在两层各有一份（搬家后旧副本还没撤干净时）——
        // 删除确认/编辑状态不能只按 id 存，否则点一条、另一个也亮 ✗
        const 行键 = (m) => (m.deleted ? 'd:' : '') + String(m.id) + '@' + String(m.session || '')
        const 行 = (m) => {
          const 全局 = m.scope === 'global'
          const 是工区 = m.scope === 'workspace'
          const 删了 = m.deleted
          const 别记中 = !删了 && !!m.别记
          const 取代中 = !删了 && !!m.已被取代
          const 改中 = 在改 === 行键(m)
          const 条 = el(
            'div',
            { key: (删了 ? 'd:' : '') + m.id + '@' + String(m.session || ''), style: G.item },
            el(
              'div',
              { style: G.itemTop },
              el('span', {
                style: Object.assign({}, G.dot, {
                  background:
                    删了 || 取代中 ? 'var(--dsw-alias-label-tertiary, rgba(128,128,128,.5))' : 重要色(m.importance),
                }),
              }),
              要删 === 行键(m)
                ? el(
                    'div',
                    { style: Object.assign({}, G.confirm, { flex: 1, minWidth: 0, marginBottom: 0 }) },
                    el(
                      'span',
                      { style: { flex: 1, minWidth: 120 } },
                      全局 ? '所有会话都会忘 —— 真删？' : '删掉这条？还能在「已删」里找回来。',
                    ),
                    el('button', { style: G.btnDanger, onClick: () => 删掉(m), disabled: busy }, '确定删'),
                    el('button', { style: G.btn, onClick: () => set要删(null) }, '算了'),
                  )
                : 改中
                  ? null
                  : el(
                      'div',
                      {
                        style: Object.assign(
                          {},
                          G.text,
                          取代中 ? { opacity: 0.62, textDecoration: 'line-through' } : null,
                          删了 ? { opacity: 0.55 } : null,
                        ),
                        title: '点一下就能改',
                        onClick: () => {
                          set在改(行键(m))
                          set改稿(m.text)
                          set改层级(m.scope === 'global' ? 'global' : m.scope === 'workspace' ? 'workspace' : 'session')
                        },
                      },
                      m.text,
                    ),
              el('span', { style: G.date }, m.at ? rel(m.at, now) : 删了 ? '' : '没记时间'),
              改中 || 要删 === 行键(m)
                ? null
                : el('button', { style: G.x, title: '删这条', onClick: () => set要删(行键(m)) }, '×'),
            ),
            改中
              ? el(
                  'div',
                  { style: S.editBox },
                  el('textarea', {
                    style: G.area,
                    value: 改稿,
                    onChange: (e) => set改稿(e.target.value),
                  }),
                  el(
                    'div',
                    { style: { display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' } },
                    el('button', { style: G.btn, onClick: () => 存改(m), disabled: busy }, '保存'),
                    el('button', { style: G.btn, onClick: () => set在改(null) }, '取消'),
                    el('span', { style: Object.assign({}, G.note, { marginBottom: 0 }) }, '层级'),
                    el(选择器, {
                      style: { minWidth: 110 },
                      值: 改层级,
                      选项: [
                        { v: 'global', t: '全局记忆' },
                        { v: 'workspace', t: '工作区' },
                        { v: 'session', t: '本会话' },
                      ],
                      onChange: (v) => set改层级(v),
                    }),
                    el('span', { style: Object.assign({}, G.note, { marginBottom: 0 }) }, '改完检索词不会自动变（要重扩一次）'),
                  ),
                )
              : null,
            el(
              'div',
              { style: G.meta },
              el(
                'span',
                {
                  style: Object.assign({}, G.badge, 全局 ? { background: 'rgba(143,208,160,.18)' } : null, {
                    // 标题可能很长（DSH 自动起的名字）—— 截断显示，悬停看全
                    maxWidth: '18em',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }),
                  // 悬停显示完整标题；标题拿不到时显示会话 id，方便对照
                  title: 全局 ? '全局记忆：每个对话都能看到' : (m.sessionTitle ? m.sessionTitle + '（' + (m.sessionId || '') + '）' : m.sessionId || ''),
                },
                全局
                  ? '全局记忆'
                  : 是工区
                    ? '工作区记忆'
                    : '指定会话 · ' +
                      (m.sessionTitle || String(m.sessionId || '').replace(/^session-/, '').slice(0, 8) || '？'),
              ),
              m.type ? el('span', { style: G.badge }, 类型名(m.type) || m.type) : null,
              m.category === 'stable_profile' ? el('span', { style: G.badge }, '长期设定') : null,
              取代中 ? el('span', { style: G.badge }, '已被取代') : null,
              别记中 ? el('span', { style: G.badge, title: String(m.别记) }, '标了不对') : null,
              删了 ? el('span', { style: G.badge }, '已删') : null,
              m.事实键 ? el('span', { style: G.badge }, '讲的是：' + m.事实键) : null,
              // ⭐ 1.10.3（F12）：这条能对上「你当时说的原话」→ 和纯转述分开标
              m.原话 ? el('span', { style: G.badge, title: '记这条的时候，你最近说的那句话被一起存下来了' }, '你说的') : null,
              el(
                'span',
                null,
                (m.source || '没写出处') +
                  ' · ' +
                  (删了
                    ? m.deletedAt
                      ? '删于 ' + rel(m.deletedAt, now)
                      : '删了'
                    : m.at || m.createdAt
                      ? rel(m.at || m.createdAt, now)
                      : '时间不详'),
              ),
              取代中 ? el('button', { style: G.btn, onClick: () => 撤销作废(m), disabled: busy }, '撤销作废') : null,
              删了 ? el('button', { style: G.btn, onClick: () => 找回(m), disabled: busy }, '找回来') : null,
              删了 || 改中 ? null : el('button', { style: G.btn, onClick: () => { set在改(行键(m)); set改稿(m.text); set改层级(m.scope === 'global' ? 'global' : m.scope === 'workspace' ? 'workspace' : 'session') } }, '改'),
              删了 || 改中
                ? null
                : el(
                    'button',
                    { style: G.btn, title: '标了不对：以后不再被想起来（不删原文，随时能撤销）', onClick: () => 标不对(m), disabled: busy },
                    别记中 ? '撤销标记' : '这条不对',
                  ),
              // ⭐ 1.10.3（F12）：记这条时你说的话 —— 展开看原话，别只看她的转述
              m.原话
                ? el(
                    'details',
                    { style: { marginTop: 6, width: '100%' } },
                    el(
                      'summary',
                      { style: { fontSize: 11, cursor: 'pointer', opacity: 0.62, userSelect: 'none' } },
                      '你说的（记这条时最近的一句）',
                    ),
                    el(
                      'div',
                      {
                        style: {
                          marginTop: 4,
                          paddingLeft: 8,
                          borderLeft: '2px solid rgba(128,128,128,.28)',
                          fontSize: 12,
                          lineHeight: 1.55,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          opacity: 0.8,
                        },
                      },
                      String(m.原话).slice(0, 600),
                    ),
                  )
                : null,
              // ⭐ B 轮 F12：这条被提炼之前长什么样 —— 折叠着，点开才占地方
              m.textBefore
                ? el(
                    'details',
                    { style: { marginTop: 6, width: '100%' } },
                    el(
                      'summary',
                      { style: { fontSize: 11, cursor: 'pointer', opacity: 0.62, userSelect: 'none' } },
                      '原文（提炼前）',
                    ),
                    el(
                      'div',
                      {
                        style: {
                          marginTop: 4,
                          paddingLeft: 8,
                          borderLeft: '2px solid rgba(128,128,128,.28)',
                          fontSize: 12,
                          lineHeight: 1.55,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          opacity: 0.8,
                        },
                      },
                      String(m.textBefore).slice(0, 1200),
                    ),
                  )
                : null,
            ),
          )
          return 条
        }
  
        const 关 = () => {
          set加开(false)
          set加正文('')
        }
        return el(
          'div',
          { style: S.wrap },
          // ── 状态条 ────────────────────────────────────────────
          el(
            'div',
            { style: G.hero },
            el(
              'div',
              null,
              el(
                'span',
                { style: Object.assign({}, G.heroNum, { fontSize: 20, letterSpacing: 0 }) },
                '今天记了 ' + 今天记 + ' 条 · 想起 ' + 今天想起 + ' 次',
              ),
            ),
            el(
              'div',
              { style: G.heroTip },
              '写「全局记忆」的每个对话都看得见，写「指定会话」的只有那一个对话记得。' +
                '点正文就能改；× 删掉：指定会话的还能在「已删」里找回来，全局记忆的那条是真没了。',
            ),
            // ⭐ F15（1.10.3）：近 7 天的健康度 —— 一行小字，看它到底在不在工作
            (() => {
              if (!健康 || !健康.汇总) return null
              const 汇 = 健康.汇总
              const 配 = 健康.配额 || {}
              if (!汇.次数) {
                return el(
                  'div',
                  { style: Object.assign({}, G.heroTip, { marginTop: 6, opacity: 0.62 }) },
                  '近 7 天没有注入记录 —— 这段时间要么没聊天，要么这功能没开着。',
                )
              }
              const 率 = typeof 汇.命中率 === 'number' ? Math.round(汇.命中率 * 100) + '%' : '—'
              const 段 = [
                '近 ' + 健康.days + ' 天：注入 ' + 汇.次数 + ' 次',
                '有着落 ' + 汇.有命中 + ' 次（' + 率 + '）',
                '平均 ' + 汇.平均条数 + ' 条 / ' + 汇.平均字数 + ' 字',
                '空注入 ' + 汇.空注入 + ' 次' + (汇.被门挡 ? '（问句门挡 ' + 汇.被门挡 + ' 次）' : ''),
              ]
              if (配.maxItems || 配.maxChars) {
                段.push('配额 ' + (配.maxItems || 0) + ' 条 / ' + (配.maxChars || 0) + ' 字')
              }
              // ⭐ F10 阶段 0（1.12.24）：预算吃紧可见 —— 看不到「吃了多少 / 裁了几条」就没法判断该不该调参
              if (typeof 汇.预算利用率 === 'number') {
                段.push('预算吃 ' + 汇.预算利用率 + '%')
              }
              if (汇.被裁条数) {
                段.push('被裁 ' + 汇.被裁条数 + ' 条（' + 汇.裁剪率 + '%）')
              }
              return el(
                'div',
                {
                  style: Object.assign({}, G.heroTip, { marginTop: 6, opacity: 0.72 }),
                  title: '「有着落」= 那轮真的注入了至少一条记忆；「空注入」= 翻了库但一条都没给（话太没内容或没有对得上的）',
                },
                段.join(' · '),
              )
            })(),
            // ⭐ F20（1.12.13）：整理 —— 查重合并，一次看全部会话（原来只能一个会话一个会话点进去）
            el(
              'div',
              { style: { marginTop: 10, border: '1px solid rgba(128,128,128,.22)', borderRadius: 8, padding: '8px 10px', fontSize: 12.5 } },
              el(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                el('span', { style: { fontWeight: 600 } }, '整理'),
                el('span', { style: { opacity: 0.6 } }, '查重合并 · 补键 · 一次看全部会话'),
                el('button', { style: S.btn, disabled: 整理跑, onClick: () => 查重() }, '查重'),
                el('button', { style: S.btnOn, disabled: 整理跑, onClick: () => 合并全部() }, '合并全部真重复'),
                el('button', { style: S.btn, disabled: 整理跑, onClick: () => 查补键() }, '补键'),
              ),
              整理话 ? el('div', { style: { marginTop: 6, opacity: 0.8 } }, 整理话) : null,
              补键结果 && 补键结果.会话 && 补键结果.会话.length
                ? el(
                    'div',
                    { style: { marginTop: 6, opacity: 0.82, maxHeight: 160, overflow: 'auto' } },
                    ...补键结果.会话.slice(0, 12).map((x) =>
                      el(
                        'div',
                        { key: x.session, style: { marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 } },
                        el('span', { style: { fontWeight: 600 } }, String(x.名称 || x.session)),
                        el('span', { style: { opacity: 0.65 } }, ' · 剩 ' + x.剩 + ' 条'),
                        el('button', { style: S.btn, disabled: 整理跑, onClick: () => 洗一批(x.session) }, '洗一批'),
                      ),
                    ),
                  )
                : null,
              查重结果 && 查重结果.会话 && 查重结果.会话.length
                ? el(
                    'div',
                    { style: { marginTop: 6, opacity: 0.82, maxHeight: 160, overflow: 'auto' } },
                    ...查重结果.会话.slice(0, 12).map((x) =>
                      el(
                        'div',
                        { key: x.session, style: { marginTop: 3 } },
                        el('span', { style: { fontWeight: 600 } }, String(x.名称 || x.session)),
                        el('span', { style: { opacity: 0.65 } }, ' · ' + x.组.length + ' 组 · 能少 ' + x.能少 + ' 条'),
                      ),
                    ),
                  )
                : null,
            ),
            // ⭐ 1.11.0 一期（§4.8）：候选区 —— 钩子只标候选，这里由人决定「记下 / 不管」
            (() => {
              const 数 = 候选们 && typeof 候选们.count === 'number' ? 候选们.count : 0
              const 处理 = (id, action) => {
                post('/candidates', { action, id })
                  .then(() => get('/candidates'))
                  .then((r) => {
                    if (r && r.ok !== false) set候选们(r)
                  })
                  .catch(() => {})
              }
              if (!数) {
                return el(
                  'div',
                  { style: Object.assign({}, G.heroTip, { marginTop: 6, opacity: 0.55 }) },
                  '候选区：空的 —— 她没调 remember、但话里像该记的，会先掉在这儿',
                )
              }
              return el(
                'div',
                { style: Object.assign({}, G.heroTip, { marginTop: 6 }) },
                el(
                  'span',
                  {
                    style: { cursor: 'pointer', textDecoration: 'underline' },
                    onClick: () => set候选开(!候选开),
                    title: '钩子（承诺 / 偏好 / 身份三类线索）挑出来的话，采纳了才进正式记忆',
                  },
                  '候选 ' + 数 + ' 条 ' + (候选开 ? '▾' : '→'),
                ),
                候选开
                  ? el(
                      'div',
                      { style: { marginTop: 6, width: '100%' } },
                      (候选们.items || []).map((it) =>
                        el(
                          'div',
                          { key: it.id, style: { display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 } },
                          el('span', { style: { flex: 1, wordBreak: 'break-word' } }, String(it.text || '')),
                          el(
                            'button',
                            {
                              style: Object.assign({}, G.btn, { fontSize: 11, padding: '1px 8px' }),
                              onClick: () => 处理(it.id, 'adopt'),
                            },
                            '记下',
                          ),
                          el(
                            'button',
                            {
                              style: Object.assign({}, G.btn, { fontSize: 11, padding: '1px 8px' }),
                              onClick: () => 处理(it.id, 'drop'),
                            },
                            '不管',
                          ),
                        ),
                      ),
                    )
                  : null,
              )
            })(),
            el(
              'div',
              { style: G.chips },
              el('div', { style: G.chip }, el('span', { style: G.chipNum }, String(全计.活跃)), el('span', null, '活着')),
              el('div', { style: G.chip }, el('span', { style: G.chipNum }, String(全计.已被取代)), el('span', null, '已被取代')),
              el('div', { style: G.chip }, el('span', { style: G.chipNum }, String(全计.已删)), el('span', null, '已删')),
              el('div', { style: G.chip }, el('span', { style: G.chipNum }, String(会话们.length)), el('span', null, '个会话')),
            ),
          ),
          err ? el('div', { style: G.err }, err) : null,
          提示 ? el('div', { style: G.note }, 提示) : null,
          // ⭐ F22（1.12.11）：一条都还没有的时候别让这页空着 —— 空页面既看不出「能用」，也看不出「怎么用」。
          //   只在「真的空 + 没在筛」时出现，一有内容自动消失（不做「关掉就不再出现」的开关，省一个状态）
          全计.活跃 === 0 && 全计.已删 === 0 && 全计.已被取代 === 0 && !搜 && 作用域 === '全部'
            ? el(
                'div',
                { style: Object.assign({}, S.sec, { marginBottom: 12 }) },
                el(
                  'div',
                  { style: S.secH },
                  el('span', { style: S.secTitle }, '这里还空着'),
                  el('span', { style: S.secTag }, '第一次用，先挑一条路'),
                ),
                el(
                  'ol',
                  { style: { margin: '6px 0 0 18px', padding: 0, fontSize: 12.5, lineHeight: 1.9, opacity: 0.85 } },
                  el('li', null, '在聊天里直接说「记住：…」，我会挑值得长期留的那句记下来'),
                  el('li', null, '点下面的「+ 记一条」，自己塞一条进去'),
                  el('li', null, '以前攒过记录？去「高级 → 从档案导入」整批搬进来'),
                ),
                el(
                  'div',
                  { style: Object.assign({}, S.note, { marginTop: 6 }) },
                  '装好第一次用不会自己开始记 —— 得先跟它说过一句话；「像该记但没记」的话会先落到候选区，点「记下」才进库。',
                ),
              )
            : null,
          // ── ＋记一条（内联展开）───────────────────────────────
          加开
            ? el(
                'div',
                { style: Object.assign({}, S.sec, { marginBottom: 12 }) },
                el(
                  'div',
                  { style: S.secH },
                  el('span', { style: S.secTitle }, '记一条'),
                  el('span', { style: S.secTag }, '不用等助手想起来，你直接塞进去'),
                ),
                el('textarea', {
                  style: G.area,
                  rows: 2,
                  placeholder: '她说过什么、答应了什么、她自己是什么样…',
                  value: 加正文,
                  onChange: (e) => set加正文(e.target.value),
                }),
                el(
                  'div',
                  { style: Object.assign({}, G.tools, { marginTop: 8, marginBottom: 6 }) },
                  el('span', { style: Object.assign({}, G.note, { marginBottom: 0 }) }, '类型'),
                  el(选择器, {
                    style: G.sel,
                    值: 加类型,
                    选项: 类型表.map(([k, t]) => ({ v: k, t })),
                    onChange: (v) => set加类型(v),
                  }),
                  el('span', { style: Object.assign({}, G.note, { marginBottom: 0, marginLeft: 6 }) }, '重要'),
                  [['0', '小事'], ['0.5', '一般'], ['1', '很重要']].map(([v, t]) =>
                    el(
                      'button',
                      {
                        key: v,
                        style: Number(加重要) === Number(v) ? G.pillOn : G.pill,
                        title: v === '1' ? '标成「很重要」的会优先被想起来' : '',
                        onClick: () => set加重要(Number(v)),
                      },
                      t,
                    ),
                  ),
                  el('button', { style: G.btn, onClick: 记一条, disabled: busy }, busy ? '记…' : '记下'),
                  el('button', { style: G.btn, onClick: 关 }, '收起来'),
                ),
                el(
                  'div',
                  { style: Object.assign({}, G.note, { marginBottom: 0 }) },
                  '记进「全局记忆」—— 哪个对话都看得见，在这里删了哪儿都会忘。',
                ),
              )
            : el(
                'button',
                {
                  style: Object.assign({}, G.btn, {
                    width: '100%',
                    textAlign: 'left',
                    padding: '9px 12px',
                    marginBottom: 12,
                    fontSize: 13,
                  }),
                  onClick: () => set加开(true),
                },
                '＋ 记一条',
              ),
          // ── 全库搜索 ──────────────────────────────────────────
          el(
            'div',
            { style: G.tools },
            el('input', {
              style: G.search,
              placeholder: '搜全部记忆：正文 / 检索词 / 出处 / 讲的是',
              value: 搜,
              onChange: (e) => set搜(e.target.value),
            }),
            el('button', { style: G.btn, onClick: 装载, disabled: busy }, busy ? '读…' : '刷新'),
          ),
          // ── 筛选：作用域 / 类型 / 状态 ────────────────────────
          el(
            'div',
            { style: G.tools },
            el('span', { style: Object.assign({}, G.note, { marginBottom: 0 }) }, '作用域'),
            ['全部', '全局记忆', '指定会话'].map((v) =>
              el('button', { key: v, style: 作用域 === v ? G.pillOn : G.pill, onClick: () => set作用域(v) }, v),
            ),
            作用域 === '指定会话'
              ? el(选择器, {
                  style: G.sel,
                  值: 当前会话,
                  选项:
                    会话们.length === 0
                      ? [{ v: '', t: '（还没有会话）' }]
                      : 会话们.map((s) => ({ v: s.id, t: s.title || s.id })),
                  onChange: (v) => set会话(v),
                })
              : null,
          ),
          el(
            'div',
            { style: G.tools },
            el('span', { style: Object.assign({}, G.note, { marginBottom: 0 }) }, '类型'),
            [['全部', '全部']].concat(类型表).map(([k, t]) =>
              el('button', { key: k, style: 类型 === k ? G.pillOn : G.pill, onClick: () => set类型(k) }, t),
            ),
          ),
          el(
            'div',
            { style: G.tools },
            el('span', { style: Object.assign({}, G.note, { marginBottom: 0 }) }, '状态'),
            ['活跃', '已被取代', '已删'].map((v) =>
              el(
                'button',
                { key: v, style: 状态 === v ? G.pillOn : G.pill, onClick: () => set状态(v) },
                v + ' ' + 计[v],
              ),
            ),
          ),
          // ── 列表 ──────────────────────────────────────────────
          !d
            ? el('div', { style: G.empty }, '读…')
            : 显示.length === 0
              ? el(
                  'div',
                  { style: G.empty },
                  全部.length === 0
                    ? el(
                        'div',
                        null,
                        '这里还空着。',
                        el('br'),
                        '点上面的「＋ 记一条」自己写一条，或者在 DSH 里跟助手聊几句让它 remember。',
                      )
                    : '没有符合条件的 —— 换个筛选试试。',
                )
              : el('div', null, 画的.map((m) => 行(m))),
          显示.length > 画的.length
            ? el(
                'div',
                { style: { marginTop: 4 } },
                el(
                  'button',
                  { style: G.btn, onClick: () => set画全部(true) },
                  '还有 ' + (显示.length - 画的.length) + ' 条 —— 全画出来',
                ),
              )
            : null,
          el(
            'div',
            { style: Object.assign({}, G.note, { marginTop: 12, marginBottom: 0 }) },
            源 === 'list'
              ? '这次是从旧接口（/list）拼出来的：新加的「作用域 / 类型」可能不全，等后端 /all 上了就自动切过来。'
              : '',
          ),
        )
      }
  return { 所有记忆页 }
}
