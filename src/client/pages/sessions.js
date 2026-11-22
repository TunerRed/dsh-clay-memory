// 会话页 —— 会话列表 / 工作区记忆 / 会话详情（记忆 · 称呼 · 导入记录 · 召回记录）
import { 造选择器 } from '../components/select.js'
import { 造导入记录页 } from './sessions/import-history-tab.js'
import { 渲染称呼页签 } from './sessions/names-tab.js'
import { 渲染召回记录页签 } from './sessions/recall-tab.js'
import { 渲染工作区记忆视图 } from './sessions/workspace-view.js'
import { 造一条记忆渲染 } from './sessions/memory-item.js'
import { 造批量维护动作 } from './sessions/batch-actions.js'

export function 造会话页({ React, el, get, post, B, S, rel, impName, 一次最多画, 进度, 改进度, 补标进度, 洗键进度 }) {
      const 选择器 = 造选择器({ React, el })
      const 渲染一条记忆 = 造一条记忆渲染({ React, post, rel, impName, S, 选择器 })

      function 会话页(props) {
        const [d, setD] = React.useState(null)
        const [err, setErr] = React.useState(null)
        const [open, setOpen] = React.useState(null) // 打开哪个会话（两级结构 ✓）
        const [notes, setNotes] = React.useState(null)
        const 导入记录页 = React.useMemo(() => 造导入记录页({ React, post, S, setNotes }), [])
        const [busy, setBusy] = React.useState(false)
        const [confirm, setConfirm] = React.useState(null) // 正在等确认的删除（二次确认，手滑不了）
        const [showDeleted, setShowDeleted] = React.useState(false)
        const [selfDraft, setSelfDraft] = React.useState({}) // 每个会话「她自己叫什么」的草稿
        const [ownerDraft, setOwnerDraft] = React.useState({}) // 每个会话「怎么称呼对方」的草稿
        const [pronounDraft, setPronounDraft] = React.useState(null) // 用户的称呼草稿
        const [edit, setEdit] = React.useState(null) // 正在改的那条：{id, text, importance}
        const [pronounAsk, setPronounAsk] = React.useState(null) // 改了称呼，问要不要连旧记忆一起改
        // ⭐ 1.8.0：会话列表按「工作区 + 搜索」筛（会话一多就翻不动）
        const [区表, set区表] = React.useState([])
        const [选中区, set选中区] = React.useState('')
        const [会话搜, set会话搜] = React.useState('')
        const [区会话, set区会话] = React.useState(null) // 该工作区的会话 id 集合（null = 还没选/还没拉）
        // ⭐ 2026-11-01 用户要求：工作区记忆层（1.8.37 加的 scope=workspace:<cwd>）一直没有界面，
        //   在「会话」页签里再拆两个并列子页签：会话列表 / 工作区记忆
        const [子页签, set子页签] = React.useState('会话')
        const [工作区记忆, set工作区记忆] = React.useState(null) // /workspace-memories 的结果
        const [看回收站, set看回收站] = React.useState(false) // 工作区记忆回收站展开没
        // ⭐ 2026-11-01 用户反馈「下拉框显示的数量没有动态更新」：区表要能手动重拉
        const 拉区表 = React.useCallback(() => {
          get('/workspaces')
            .then((r) => set区表(Array.isArray(r) ? r : (r && r.workspaces) || []))
            .catch(() => set区表([]))
        }, [])
        React.useEffect(() => {
          拉区表()
        }, [拉区表])
        React.useEffect(() => {
          if (!选中区) {
            set区会话(null)
            return
          }
          get('/sessions-by-workspace?workspace=' + encodeURIComponent(选中区))
            .then((r) => set区会话(new Set(((r && r.sessions) || []).map((x) => x.id))))
            .catch(() => set区会话(new Set()))
        }, [选中区])
        // ⭐ 2026-11-01：工作区记忆视图 —— 选中区（uuid）先从区表映射回 cwd，再读该工作区自己的库
        const 刷工作区记忆 = React.useCallback(() => {
          const 区 = (区表 || []).find((w) => w && w.id === 选中区)
          const cwd = 区 && 区.path ? String(区.path) : ''
          if (!cwd) {
            set工作区记忆({ ok: false, message: '先选一个工作区' })
            return
          }
          set工作区记忆({ 读中: true })
          get('/workspace-memories?workspace=' + encodeURIComponent(cwd))
            .then((r) => set工作区记忆(r || { ok: false, message: '没读到' }))
            .catch((e) => set工作区记忆({ ok: false, message: String((e && e.message) || e) }))
        }, [选中区, 区表])
        React.useEffect(() => {
          if (子页签 !== '工作区记忆') return
          if (!选中区 && (区表 || []).length) {
            set选中区(区表[0].id) // 切过来没选过工作区：自动选第一个，省得再看「先选一个」
            return
          }
          刷工作区记忆()
        }, [子页签, 选中区, 区表, 刷工作区记忆])
        // ⭐ 2026-11-01 用户：「工作区记忆能加个删除吗」—— 单条收起来（进该工作区的回收站，可找回）
        const 删工作区记忆 = (m) => {
          const 区 = (区表 || []).find((w) => w && w.id === 选中区)
          const cwd = 区 && 区.path ? String(区.path) : ''
          if (!cwd) return
          const 问 = window.confirm(
            '把这条工作区记忆收起来？\n\n' + String(m.text || '').slice(0, 160) + '\n\n它只属于这个工作区；收起来后进回收站，以后能找回来。',
          )
          if (!问) return
          post('/workspace-memories', { action: 'delete', workspace: cwd, id: m.id })
            .then((r) => {
              if (r && r.ok) {
                刷工作区记忆()
                拉区表() // 下拉框里的「（N）」跟着变
              } else window.alert('没删掉：' + ((r && r.message) || '？'))
            })
            .catch((e) => window.alert('删失败：' + String((e && e.message) || e)))
        }
        // ⭐ 2026-11-01 用户问「回收站在哪个地方」——就是该工作区库文件里的 deleted 数组，这里能点着找回来
        const 找回工作区记忆 = (m) => {
          const 区 = (区表 || []).find((w) => w && w.id === 选中区)
          const cwd = 区 && 区.path ? String(区.path) : ''
          if (!cwd) return
          post('/workspace-memories', { action: 'restore', workspace: cwd, id: m.id })
            .then((r) => {
              if (r && r.ok) {
                刷工作区记忆()
                拉区表()
              } else window.alert('没找回来：' + ((r && r.message) || '？'))
            })
            .catch((e) => window.alert('找回来失败：' + String((e && e.message) || e)))
        }
        // ⭐ 2026-10-28：详情页现在是**四个页签**（记忆 / 称呼 / 导入 / 记录）✓
        //   （这一版把「从旧档案导入」单独成页了，所以 `impOpen` 那个折叠开关没用了
        //     —— 原来点了扫描要 setImpOpen(true) 把它扒开，现在本来就在那一页里）
        const [详情页, set详情页] = React.useState('记忆')
        // 进度放在组件外面（见上面「进度」那段）—— 她切走再回来，进度不该消失 ✓
        const [复制开, set复制开] = React.useState(false) // 「复制记忆到别的会话」展开没有
        const [复制到, set复制到] = React.useState('') // 复制到哪个会话
        // ⭐ 1.8.0：会话行的 ⋯ 菜单 ——「复制记忆到…」从这里起（原先是详情页导入里的一项）
        const [菜单在, set菜单在] = React.useState('')
        const [复制源, set复制源] = React.useState('')
  
        // ⭐⭐ 1.4.0 双层记忆（前端这半边）：**事实 / 事件分开报**
        //   事实（`category === 'stable_profile'`）这一版起住在**全局库** `_facts.json`，
        //   所有工作区 / 所有会话共享；事件（其余）还是各存各的会话库。
        //   后端 `loadStore` 已经把两边合并好再交给 `/list`，所以一个会话的 `memories` =
        //   「**全部**全局事实（每个会话看到的一模一样）」+「本会话事件（各是各的）」。
        //   ⚠ 设置页要是把合并后的条数糊在一起报，就会出现「525 条」那种
        //     看着像本会话独有、其实一半是全局的数 —— 所以这一版**分开报** ✓
        //   ⚠ 口径优先级：后端直接给了数字（`factsCount` / `eventCount`）就用它，
        //     别再拿 800 条 filter 一遍（`/list` 本来就吐 1MB，多算一遍是白烧）。
        const 是事实 = (m) => !!m && m.category === 'stable_profile'
        const 数事实 = (x) => {
          if (!x) return 0
          if (typeof x.factsCount === 'number' && isFinite(x.factsCount)) return x.factsCount
          if (!Array.isArray(x.memories)) return 0
          return x.memories.filter(是事实).length
        }
        const 数事件 = (x) => {
          if (!x) return 0
          if (typeof x.eventCount === 'number' && isFinite(x.eventCount)) return x.eventCount
          if (!Array.isArray(x.memories)) return typeof x.count === 'number' ? x.count : 0
          const 列 = x.memories
          return 列.length - 列.filter(是事实).length
        }
        // 全局事实库总共几条 —— 哪个会话看到的都一样，取最大那份就对了。
        // （后端在 `/list` 顶层给了总数就优先用它：万一某个会话是空的，也别报 0）
        const 全局事实数 = () => {
          if (d && typeof d.factsCount === 'number' && isFinite(d.factsCount)) return d.factsCount
          let 最多 = 0
          for (const x of ((d && d.sessions) || [])) {
            const n = 数事实(x)
            if (n > 最多) 最多 = n
          }
          return 最多
        }
        // 会话 id → 名字（分支继承那行提示要写「从『XX』分出来的」）
        const 会话名 = (sid) => {
          const x = ((d && d.sessions) || []).find((v) => v.id === sid)
          return (x && (x.title || x.id)) || String(sid || '').slice(0, 18)
        }
        const [搜词, set搜词] = React.useState('') // 记忆列表的检索词
        const [画全部, set画全部] = React.useState(false) // 记忆列表要不要一次画完（默认只画前 200）
        const [看记忆, set看记忆] = React.useState(false) // 记忆列表展开没有（默认折叠，不然把按钮顶到很下面）
        // ⭐ 2026-09-21：列表顺序。记忆库是 push 顺序（老的在前），而下面只画前 200 条 ——
        //   不翻过来的话，她永远看不到刚写进来的那条（851 条里画的是最老的 200 条）。
        //   '新' = 最新的在最上面（默认）；'旧' = 最早的在前（想从头翻的时候用）
        const [顺序, set顺序] = React.useState('新')
        // ⭐ 2026-09-24（反馈）：**「记了时间的」和「没记时间的」混在一坨了** ✗
        //   库里 850 条只有 188 条有日期 —— 混在一起排，「中间那一段」全是没日期的，排序就白排了。
        //   原话：「要么就是这样分类，记了时间的和没记时间的分开……
        //            不然的话记和没记的就全混在一起了，这个排序就没办法用了」
        //   她要的是**自己切**（不是固定的两块）→ 三种视图轮着切 ✓
        //     '全部' = 老样子；'有时间' = 只看有日期的；'没时间' = 只看没日期的
        const [看哪边, set看哪边] = React.useState('全部')
        // ⭐ 2026-09-22（她要的）：长期事实那个「收理的文件夹」展开没有（**默认收着**）
        const [看事实, set看事实] = React.useState(false)
        // ⭐⭐ 2026-09-22（反馈：「查重我们是不是还没找到按钮」）：
        //   去重一直有，但都是**自动**的（召回时、导入时）—— **库里已有的重复没人管** ✗
        //   这里补一个手动查重：列出来、挑、才合 ✓
        const [查重, set查重] = React.useState(null) // 查重结果：{组, 真重复组数, 汇总组数, 能少}
        const [查重选, set查重选] = React.useState({}) // 第几组 → 留哪条的 id
        // ⭐⭐ 2026-09-23（她真被坑过一次）：**哪几组要合**。
        //   原来「按我选的合」是**把每一组都合掉** —— 而每组默认都选中了，
        //   于是一点就把「汇总+明细」那 105 组也合了，**123 条记忆没了**（回收站还被清空）✗
        //   → 改成：**「汇总+明细」默认不参与**，要合得一组一组自己勾 ✓
        const [查重合, set查重合] = React.useState({}) // 第几组 → 要不要合
        const [查重开, set查重开] = React.useState(false) // 面板展开没有
        // ⭐⭐ 2026-09-22（她要的）：**批量删除**，但**必须二次确认** ✓
        //   原话：「再出一个批量删除，但还是需要 2 次确认的」
        //   ① 勾选（每条行首一个框）② 点「批量删」→ 出一个确认条 ③ 点「确定删」才真删
        //   删掉的是**收进「已删」**（不是销毁），能找回来 ✓
        const [选中, set选中] = React.useState({}) // 勾了哪些 id
        const [批删问, set批删问] = React.useState(false) // 二次确认条出来了没
        // ⭐ 2026-09-22（反馈「回收站还没有批量删除，就批量清空」）：
        //   「已删掉的」那一栏原来只有「一条条清」和「全清空」→ 补一个**批量清掉** ✓
        //   ⚠ 这个是**真销毁**（不是收起来）→ 界面必须问两遍 ✓
        const [选中清, set选中清] = React.useState({}) // 「已删」里勾了哪些
        const [批清问, set批清问] = React.useState(false)
        // ⭐⭐ 2026-09-23（反馈「这里没有批量找回呀」）：批量找回的确认
        const [批回问, set批回问] = React.useState(false)
        const [看原文, set看原文] = React.useState({}) // 哪几条在对照「提炼前」的原文
        // ---- 2026-09-21 新加：后台手动加一条记忆 ----
        const [加内容, set加内容] = React.useState('')
        const [加时间, set加时间] = React.useState('') // 留空 = 现在
        const [加重要, set加重要] = React.useState('0.5') // 三档是快捷，也能自己填
        const [加词, set加词] = React.useState('') // 关键词，空格分开
        const [加在谁, set加在谁] = React.useState('') // 加到哪个会话（默认第一个开着的，没有就第一个）
        const [加结果, set加结果] = React.useState(null) // { ok, 文字 }
        const [加展开, set加展开] = React.useState(false)
  
        const load = React.useCallback(() => {
          get('/list')
            .then((x) => {
              setD(x)
              setErr(null)
            })
            .catch((e) => setErr(String((e && e.message) || e)))
        }, [])
  
        React.useEffect(() => {
          load()
        }, [load])
  
        // ---- 2026-09-21 新加：手动加一条（提交）----
        // 加到哪个会话：她选的；没选就挑第一个开着的，都没有就第一个
        // ⭐ 1.2.8（issue #8「手动加的记忆跑到别的会话去了」）：
        //   以前没选就**默默挑第一个开着的会话** —— 两个都开着时，她打开的是 B，记忆却加到了 A。
        //   现在优先用「你正打开的这个会话」，再退回第一个开着的。
        const 加哪个会话 = React.useCallback(() => {
          if (加在谁) return 加在谁
          if (open) return String(open)
          const 列 = (d && d.sessions) || []
          const 开着的 = 列.find((x) => x.enabled)
          return (开着的 || 列[0] || {}).id || ''
        }, [加在谁, open, d])
  
        const 提交一条 = React.useCallback(() => {
          const 内容 = 加内容.trim()
          if (!内容) {
            set加结果({ ok: false, 文字: '内容不能空' })
            return
          }
          const 会话 = 加哪个会话()
          if (!会话) {
            set加结果({ ok: false, 文字: '没有会话可加' })
            return
          }
          const 重要 = Number(加重要)
          set加结果({ ok: true, 文字: '加着呢…' })
          post('/add', {
            session: 会话,
            text: 内容,
            at: 加时间.trim(),
            importance: Number.isFinite(重要) ? 重要 : 0.5,
            tags: 加词.trim() ? 加词.trim().split(/[\s,，、]+/).filter(Boolean) : [],
          })
            .then((r) => {
              if (r && r.ok) {
                set加结果({ ok: true, 文字: '加上了 ✓（这个会话现在 ' + r.count + ' 条）' })
                set加内容('')
                set加时间('')
                set加词('')
                load()
              } else {
                set加结果({ ok: false, 文字: (r && (r.error || r.message)) || '没加上' })
              }
            })
            .catch((e) => set加结果({ ok: false, 文字: String((e && e.message) || e) }))
        }, [加内容, 加时间, 加重要, 加词, 加哪个会话, load])
  
        // 切回这个页面就重读一遍 —— 不然得手动按「刷新」才看得到别处刚发生的变化 ✓
        // ⚠ 但一定要**限流**：库里有 800 多条的时候，/list 要吐 1 MB 左右，
        //   每次切窗口都重读 + 重画一遍，整个页面（连带别的插件面板）都会卡住 ✗
        React.useEffect(() => {
          if (typeof window === 'undefined' || !window.addEventListener) return
          let 上次 = 0
          const 回来就重读 = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
            if ((进度.扩词.状态 && 进度.扩词.状态.running) || (进度.提炼.状态 && 进度.提炼.状态.running)) return // 正跑着提炼/扩词，别抢
            const 现在 = Date.now()
            if (现在 - 上次 < 10000) return // 10 秒内只读一次
            上次 = 现在
            load()
          }
          window.addEventListener('focus', 回来就重读)
          document.addEventListener('visibilitychange', 回来就重读)
          return () => {
            window.removeEventListener('focus', 回来就重读)
            document.removeEventListener('visibilitychange', 回来就重读)
          }
        }, [load])
  
        if (err) return React.createElement('div', { style: S.wrap }, React.createElement('div', { style: S.drop }, '出错了：' + err))
        if (!d) return React.createElement('div', { style: S.wrap }, '加载中…')
  
        const now = Date.now()
  
        // ---- 第二级：某个会话的详情 ----
        if (open) {
          const s = (d.sessions || []).find((x) => x.id === open)
          if (!s) return React.createElement('div', { style: S.wrap }, '找不到这个会话')
          const tr = (s.traces || []).slice(-1)[0]
          const 删 = (id, action) => post('/delete', { session: open, id, action }).then(() => { setConfirm(null); load() })
          // ⭐⭐ 2026-09-23（反馈「过期条目没标作废」）：
          //   撤销「已被取代」—— 标错了、或者状态又变回来了 ✓
          //   （不删任何东西，只把那面小旗子摘掉，摘完它又能被想起来）
          const 撤销作废 = (id) => {
            setBusy(true)
            post('/delete', { session: open, action: 'unsupersede', id: id })
              .then((r) => {
                setBusy(false)
                if (!r || !r.ok) {
                  setNotes(['撤销失败：' + ((r && r.message) || '？')])
                  return
                }
                setNotes(['✓ ' + r.message])
                load()
              })
              .catch((e) => {
                setBusy(false)
                setNotes(['撤销失败：' + ((e && e.message) || e)])
              })
          }
          // 提炼改坏了 —— 退回原文（单条 / 全部）✓
          const 退原文 = (id) =>
            post('/refine/undo', id === '*' ? { session: open, all: true } : { session: open, id: id })
              .then((r) => {
                setConfirm(null)
                setNotes(['✓ 退回了 ' + ((r && r.退了) || 0) + ' 条原文'])
                load()
              })
              .catch((e) => setNotes(['退不回：' + String((e && e.message) || e)]))
          // 把这一份记忆复制到别的会话（新对话没有上下文，测起来最干净）✓
          const 复制过去 = () =>
            post('/copy-to', { session: 复制到, to: open })
              .then((r) => {
                setConfirm(null)
                // ⭐ 1.4.0：事实已经全局了，这边只拷事件 —— 提示也跟着改口径
                setNotes([r && r.ok ? '✓ 复制了 ' + r.复制了 + ' 条事件过去（事实本来就是全局的，不用复制），那边开关也开了' : '✗ ' + ((r && r.message) || '？')])
                load()
              })
              .catch((e) => setNotes(['✗ ' + String((e && e.message) || e)]))
  
          // 二次确认条（点「删」之后才出现，手滑不了）
          const 确认条 = (text, okLabel, action, id) =>
            React.createElement(
              'div',
              { style: S.confirm },
              React.createElement('span', { style: { flex: 1, minWidth: 0, overflowWrap: 'anywhere' } }, text),
              React.createElement('button', { style: S.btnDanger, onClick: () => 删(id, action) }, okLabel),
              React.createElement('button', { style: S.btn, onClick: () => setConfirm(null) }, '算了'),
            )
  
          const 一条记忆 = (m) => 渲染一条记忆(m, { open, now, edit, setEdit, confirm, setConfirm, 选中, set选中, 看原文, set看原文, 是事实, 撤销作废, 退原文, 确认条, load })
  
          const 已删 = s.deleted || []
          // ⭐⭐ 2026-09-24（她说的「那已被取代应该回回收站呀」）：
          //   被取代的**从主列表挪走**，收进「已删掉的」那一栏 ✓
          //   理由：它们已经不再被注入了，跟「收起来的」是一个性质，
          //         摆在主列表里只是占地方（还会挂个牌子把正文挤窄）
          //
          //   ⚠⚠ 但**不许挪进 `s.deleted`** —— 那是「她亲手删的」那一栏，
          //     「批量清掉」「把已删掉的清空」会**真销毁**它们 ✗
          //     被取代的是**自动标的**（几百条一起），
          //     不该被那两个按钮连坐销毁 —— 那正是丢 157 条那次的教训 ✗✗
          //   → 所以：**显示上**收进回收站，**数据上**还留在 memories 里，
          //     只是带一个「已被取代」的旗子 ✓
          const 被取代的 = (s.memories || []).filter((m) => m.已被取代)
          const 活着的 = (s.memories || []).filter((m) => !m.已被取代)
  
          // ---- 记忆列表的检索（几百条的时候靠翻是翻不到的）----
          // 正文、提炼前的原文、检索词、来源、id 都能搜 ✓
          const 关键字 = 搜词.trim().toLowerCase()
          const 搜过 = 关键字
            ? 活着的.filter((m) => {
                const 包 = (x) => String(x || '').toLowerCase().indexOf(关键字) >= 0
                return (
                  包(m.text) ||
                  包(m.textBefore) ||
                  包(m.原话) ||
                  包(m.source) ||
                  包(m.id) ||
                  (Array.isArray(m.related) && 包(m.related.join(' ')))
                )
              })
            : 活着的
  
          // ⭐ 2026-09-24（反馈）：**把「记了时间的」和「没记时间的」分开** ✓
          //   上一版它们混在一个列表里 —— 188 条有日期的排在上面，下面 662 条没日期的
          //   挤成「中间一坨」，看着就像排序坏了。原话：
          //   「还有中间没有记日期的，全卡在中间一坨了……不然的话记和没记的就全混在一起了，
          //     这个排序就没办法用了」
          //   她要**自己切** → 三种视图轮着切 ✓
          const 有时间 = (m) => !!m.at
          // ⭐⭐ 2026-09-22（她要的）：**「永远不淡」单独收成一栏** ✓
          //   原话：「改了就会归纳到那个永远不会淡的那一行里去了，就是那一行，
          //              我们是**单独做一个收理的文件夹一样**的，不然的话那些就不需要露在外面」
          //   ⭐ 又说：「**外面都是会淡的，里面才是不会淡的**，就不用管里面了」
          //   ⚠⚠ 2026-09-22 再改（发现两条流水账被误标）：
          //     **「不会淡」的只有一类：长期事实** ✓
          //     上一版我拿「鲜活度是不是钉住的」当判据 —— 那是**算分的副作用**，不是语义 ✗
          //     结果把 394 条**没抠到日期的流水账**错收进「不会淡的」里 ✗✗
          //     （一眼就看出不对）
          //     没记时间的现在**也会淡**（从「记下来的那天」开始算）→ 算「会淡的」✓
          const 不会淡 = (m) => m.category === 'stable_profile'
          // ⭐ 2026-11-01（她要的）：「全局事实 / 工作区记忆 / 这个会话的」三个作用域
          //   也并进这个下拉里单选。判据用后端带回来的 `层`（真实落在哪个文件），
          //   不用 scope —— 一条全局事实被补标降成 event 之后 scope 会推断成 session，会漏。
          const 层是 = (m, l) => (m.层 || 'session') === l
          const 过滤后 =
            看哪边 === '有时间'
              ? 搜过.filter(有时间)
              : 看哪边 === '没时间'
                ? 搜过.filter((m) => !有时间(m))
                : 看哪边 === '长期事实'
                  ? 搜过.filter(不会淡)
                  : 看哪边 === '会淡的'
                    ? 搜过.filter((m) => !不会淡(m))
                    : 看哪边 === '全局'
                      ? 搜过.filter((m) => 层是(m, 'global'))
                      : 看哪边 === '工作区'
                        ? 搜过.filter((m) => 层是(m, 'workspace'))
                        : 看哪边 === '会话'
                          ? 搜过.filter((m) => 层是(m, 'session'))
                          : 搜过
  
          // ⭐ 排好序再画 —— 按**最左边那一列的日期**排 ✗✗
          //   上一版写的是 过滤后.slice().reverse()，那是把数组倒过来（谁先记谁在前翻个个儿），
          //   **根本没看日期**。所以补完日期顺序一点没变 —— 她一眼就看出来了 ✗
          // 这一版：有日期的按日期排，**没日期的排最后**（没日期 = 不知道啥时候的事，
          //   搁在中间会把有日期的顶散）✓
          // ⚠ 「没时间」那个视图里全是没日期的 → 保留类里原来的相对次序（谁先记谁在前），
          //   这样「旧的在前 / 新的在前」切一下还能看出入库先后来 ✓
          const 排序 = (m) => {
            const t = m.at ? new Date(m.at).getTime() : NaN
            return isFinite(t) ? t : null
          }
          const 排好 = 过滤后.slice().sort((a, b) => {
            const ta = 排序(a)
            const tb = 排序(b)
            if (ta === null && tb === null) return 0 // 都没日期：保持原来的相对次序
            if (ta === null) return 1 // 没日期的沉到最后
            if (tb === null) return -1
            return 顺序 === '旧' ? ta - tb : tb - ta
          })
          // 「没时间」那个视图里没有日期可比 —— 想按入库先后翻的时候还得能用 ✓
          const 画这个 = 看哪边 === '没时间' && 顺序 === '新' ? 排好.slice().reverse() : 排好
          const 有时间数 = 活着的.filter(有时间).length
          const 没时间数 = 活着的.length - 有时间数
          // ⭐ 2026-09-22：**不会淡的**单独收一栏（「全部」视图里才拆）
          //   ⭐ 判据 = 鲜活度钉住的那批（长期事实 + 没时间的）——
          //     原话：「外面都是会淡的，里面才是不会淡的」
          //   ⚠ 2026-09-24：口径换成**活着的** —— 被取代的已经收进回收站了，
          //     不该还算在「会淡的/不会淡的」这些数里 ✗
          const 事实总数 = 活着的.filter(不会淡).length
          const 会淡总数 = 活着的.length - 事实总数
          // 2026-11-01：三层来源计数（给下拉里的「全局 / 工作区 / 这个会话的」用）
          const 全局数 = 活着的.filter((m) => (m.层 || 'session') === 'global').length
          const 工区数 = 活着的.filter((m) => (m.层 || 'session') === 'workspace').length
          const 会话数 = 活着的.length - 全局数 - 工区数
  
          // ⭐ 2026-09-21 晚：补日期 —— 正文里写着日期、当时却没抠出来的
          //   （老版本 抠日期 必须要四位数年份，而档案里写的是「09-17」「8月26日」）
          const 没日期的 = 活着的.filter((m) => !m.at).length
  
          // ⭐⭐ 2026-09-22（反馈）：**补标「永远不淡」** ——
          //   提炼原来只改重要度、不碰分类（0.7.6 才修好），
          //   所以实测库里 135 条该「永远不淡」的被标成了会淡的（重要的日子就在里面）。
          //   修好提炼只影响以后的，已经记下的那些得**单独补一遍** ✓
          //   一条条问模型太慢 → 一批一批来，界面循环调（照「补日期」的样子）
          //   ⭐⭐ 2026-09-22 晚（反馈：「有好多那种就不该是长期事实的」）：
          //     现在判**所有没判过的**（不只「会淡的」）—— 该升的升、**该降的降** ✓
          const 没判过的 = (s.memories || []).filter((m) => !m.stableChecked).length
          // ⭐ 2026-09-22（她要的批量删除）：勾了几条
          const 已选几条 = Object.keys(选中).filter((k) => 选中[k]).length
          // ⭐ 1.4.0：勾上的里有几条是**全局事实** —— 批量删碰到它们就是所有会话一起忘，
          //   确认条上得单独点一句（不然这事没人知道）✗
          const 已选事实 = (s.memories || []).filter((m) => 选中[m.id] && 是事实(m)).length
          // ⭐ 2026-09-22：判过几条（用来显示「重判一遍」）
          const 判过的 = (s.memories || []).filter((m) => m.stableChecked).length
          // ⭐ 2026-09-22（回收站的批量清掉）：勾了几条
          const 已选清几条 = Object.keys(选中清).filter((k) => 选中清[k]).length
  
          // ⭐⭐ 2026-09-23（第三步）：**清洗补键** —— 给老记忆补「事实键」✓
          //
          //   为什么单独一步：提炼只影响**以后**导入的；
          //   老库里那些条目是导入时进来的，**本来就没有键** ——
          //   不补的话「同一个 key 只留最新一条」对老数据一点用都没有 ✗
          //
          //   ⚠⚠ **只在设置页点按钮跑，不在对话里跑**（她的死规矩）：
          //     几百条要调几百次模型，挂在对话那一轮上会把那轮卡死。
          //   ⚠ 先「干跑」看一眼，确认了再真洗 —— 这一步要改几百条，别一上来就动库 ✓
          // ⚠ 算「还剩几条要洗」要跟服务端的 `要洗` **同一个口径** ——
          //   洗过的（含判了留空的）不算，不然按钮上的数字永远不消 ✗
          const 没键的 = (s.memories || []).filter((m) => !m.已被取代 && !m.refinedSkip && !m.事实键 && !m.洗键过).length
          // 判了「留空」的那些（洗过、但没键）—— 单独报个数，免得她以为漏了
          const 判留空的 = (s.memories || []).filter((m) => !m.事实键 && m.洗键过).length
          // ⚠⚠ 撤回按钮上的数字要跟**它真能撤的**对得上 ✗
          //   原来用的是「所有带键的」—— 把她自己手工填的也算进去了，
          //   于是按钮写「撤掉这次标的（5）」、真撤只撤掉 2 条，数对不上（她会以为坏了）
          const 可撤的 = (s.memories || []).filter((m) => m.键来源 === '清洗补键' || m.洗键过).length
          const { 补日期, 补不淡, 洗键, 撤销洗键, 批回, 批清, 去查重, 合重复, 批删 } = 造批量维护动作({ post, load, s, 没键的, 补标进度, 洗键进度, 选中, set选中, 选中清, set选中清, setBusy, setConfirm, setNotes, set批回问, set批清问, set批删问, set看记忆, 查重, set查重, 查重选, set查重选, 查重合, set查重合, set查重开 })
          return React.createElement(
            'div',
            { style: S.wrap },
            React.createElement('div', { style: S.link, onClick: () => setOpen(null) }, '← 所有会话'),
            // ⭐ 1.4.2：「这个会话是谁」收进一张浅卡（id、两笔账、分支说明）
            //   原来它跟下面的称呼框、记忆列表全平铺，第一屏看不出「头」在哪 ✗
            React.createElement(
              'div',
              { style: S.secHero },
              React.createElement('div', { style: { fontSize: 14, fontWeight: 650, marginBottom: 4, overflowWrap: 'anywhere' } }, s.title || '（没起名字的会话）'),
              React.createElement('div', { style: Object.assign({}, S.dim, { fontSize: 11.5, fontFamily: 'ui-monospace, monospace', marginBottom: 6, overflowWrap: 'anywhere' }) }, s.id),
            // ⭐ 1.4.0（需求①）：这个会话看到的「事实」是**全局库里的全部**（每个会话都一样），
            //   「事件」才是这个会话自己的 —— 两笔账分开写，别拿合并后的总数糊人 ✓
            React.createElement(
              'div',
              { style: Object.assign({}, S.dim, { fontSize: 12 }) },
              '全局事实 ' + 数事实(s) + ' 条（所有会话共享）· 本会话事件 ' + 数事件(s) + ' 条' +
                (已删.length ? '　· 还收着 ' + 已删.length + ' 条' : ''),
            ),
            React.createElement(
              'div',
              { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2, overflowWrap: 'anywhere' }) },
              '事实是所有会话共用的（在哪个会话里删，哪儿都会忘）；事件只属于这个会话。',
            ),
            // ⭐ 1.4.0（需求③）：分支继承那一侧的提示 —— 事实不用继承（已经全局了），
            //   从前端这头也把话说明白，别让人以为「分支没把事实带过来」是漏了 ✓
            s.parent
              ? React.createElement(
                  'div',
                  { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2, overflowWrap: 'anywhere' }) },
                  '这个会话是从「' + 会话名(s.parent) + '」分支出来的 —— 事实已经是全局的了，分支只继承了事件。',
                )
              : null,
            ),
            // ⭐⭐ 2026-10-28（用户：「把详情页下面几块功能拆成几个 tab 分区」）：
            //   原来十来块一路平铺到底，想看「导入」「备份」得滚很久，层次全糊了 ✗
            //   现在四个页签：
            //     ① 记忆（自己加一条 + 记忆列表 + 已删掉的）
            //     ② 称呼（她自己叫什么 / 她怎么称呼你）
            //     ③ 导入（从旧档案导入；提炼 / 扩词 收进它里面当②后期加工）
            //     ④ 记录（最近一次召回 + 备份怎么留）
            //   ⚠ 跟外层「会话记忆 / 全局事实」是同一套做法：**四块都挂着，只切 display** ——
            //     切走再回来，各块的折叠状态、勾选、进度条都还在，列表也不用重画一遍 ✓
            //     （条件渲染卸载再挂上的话，几百条的记忆列表会重画，肉眼能看出卡一下 ✗）
            React.createElement(
              'div',
              { style: S.tabs, role: 'tablist', 'aria-label': '会话详情分区' },
              [
                ['记忆', '记忆', '记忆列表、已删掉的、自己加一条'],
                ['称呼', '称呼', '她在这儿的名字、她怎么称呼你'],
                ['导入记录', '导入记录', '导过哪几批（只读）+ 撤销这一批'],
                ['召回记录', '召回记录', '最近一次召回挑中了什么 + 备份怎么留'],
              ].map(([k, t, 说明]) => React.createElement(
                'button',
                {
                  key: k,
                  type: 'button',
                  role: 'tab',
                  'aria-selected': 详情页 === k ? 'true' : 'false',
                  title: 说明,
                  style: 详情页 === k ? S.tabOn : S.tabOff,
                  onClick: () => set详情页(k),
                },
                t,
              )),
            ),
            渲染称呼页签({ React, post, S, open, s, 详情页, selfDraft, setSelfDraft, ownerDraft, setOwnerDraft, load }),
            // ---- 页签① 记忆：自己加一条 + 记忆列表 + 已删掉的（原来这几块就在这一竖溜）----
            React.createElement(
              'div',
              { style: { display: 详情页 === '记忆' ? 'block' : 'none' } },
            // ⚠ 记忆列表**默认折叠** —— 库里几百条的时候，它压在中间会把
            //   下面那些按钮顶到很下面，她得一直翻才够得着 ✗
            //   （2026-10-28 起「提炼 / 扩词」搬去「导入」页签了，这条折叠照旧有用：
            //     记忆页签第一眼要给的是「加一条 + 列表概览」，不是几百行原文）
            React.createElement(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 } },
              React.createElement(
                'div',
                { style: Object.assign({}, S.h, { cursor: 'pointer', margin: 0, flex: 1 }), onClick: () => set看记忆(!看记忆) },
                // ⭐ 2026-11-01（她要的）：标题只留「记忆列表」——后面的条数去掉了
                //   （上面那行已经写了「全局事实 N 条 · 本会话事件 M 条」，这里再报一遍是重复）
                (看记忆 ? '▾ ' : '▸ ') + '记忆列表',
              ),
              // ⭐⭐ 2026-09-22（反馈：「查重我们是不是还没做啊？我怎么没有找到按钮」）：
              //   ⚠⚠ 第一次我把它放进了**折叠起来的**记忆列表块里 ——
              //     不点开列表就看不见，那就等于没有按钮 ✗
              //     → 挪到**标题这一行**（这一行永远看得见）✓
              React.createElement(
                'button',
                {
                  style: S.btn,
                  title:
                    '找出库里「几乎一样」的记忆。自动去重只管召回和导入，管不到已经存着的。' +
                    '真重复能一键合；「汇总+明细」会列出来让你自己挑；合之前自动备份',
                  onClick: () => 去查重(s),
                },
                '查重',
              ),
              // ⭐⭐ 2026-09-22（她要的）：**批量删除** —— 勾了几条就显示几条
              //   ⚠ 二次确认：点这里**不删**，只出确认条；确认条上再点「确定删」才真删 ✓
              已选几条 > 0
                ? React.createElement(
                    'button',
                    {
                      style: S.btnDanger,
                      title: '把勾上的这几条收进「已删」（不是销毁，能找回来）。点它不会直接删，会先问一遍',
                      onClick: () => set批删问(true),
                    },
                    '批量删（' + 已选几条 + '）',
                  )
                : null,
              已选几条 > 0
                ? React.createElement(
                    'button',
                    { style: S.btn, onClick: () => { set选中({}); set批删问(false) } },
                    '取消勾选',
                  )
                : null,
            ),
            // ⭐ 2026-09-24：折叠着也能一眼看出「记了时间的」有多少 ——
            //   反馈那个「中间一坨」的根源就是 850 条里只有 188 条有日期，
            //   这个数字摆在标题下面，心里有底 ✓
            React.createElement(
              'div',
              { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2 }) },
              '记了时间的 ' + 有时间数 + ' 条 · 没记时间的 ' + 没时间数 + ' 条' +
                (看哪边 === '全部' ? '' : '（现在只看' + (看哪边 === '有时间' ? '记了时间的' : '没记时间的') + '）'),
            ),
            看记忆
              ? React.createElement(
                  'div',
                  null,
                  // ---- 检索框：几百条的时候，靠翻是翻不到的 ----
                  React.createElement(
                    'div',
                    { style: S.nameBox },
                    React.createElement('div', { style: { flex: 'none', width: 44 } }, '找'),
                    React.createElement('input', {
                      style: Object.assign({}, S.inp, { flex: 1, width: 'auto', minWidth: 140 }),
                      placeholder: '打几个字，只留含它的（正文、原文、检索词、来源都能搜）',
                      value: 搜词,
                      onChange: (e) => set搜词(e.target.value),
                    }),
                    搜词
                      ? React.createElement('button', { style: S.btn, onClick: () => set搜词('') }, '清掉')
                      : null,
                    // ⭐ 2026-11-01（她要的）：**改成下拉单选** —— 原来点一下轮一种要来回点，
                    //   而且「全局 / 工作区 / 会话」这三个作用域也该能直接筛（单选，不做多选）。
                    React.createElement(
                      'select',
                      {
                        style: Object.assign({}, S.inp, {
                          flex: 'none',
                          width: 'auto',
                          fontSize: 12,
                          padding: '2px 4px',
                        }),
                        value: 看哪边,
                        title: '选一种看法。「全部」那个视图里，不会淡的收在一个折叠的分组里（外面只剩会淡的）',
                        onChange: (e) => set看哪边(e.target.value),
                      },
                      [
                        ['全部', '看：全部（' + 活着的.length + '）'],
                        ['有时间', '只记了时间的（' + 有时间数 + '）'],
                        ['没时间', '只有没记时间的（' + 没时间数 + '）'],
                        ['长期事实', '不会淡的（' + 事实总数 + '）'],
                        ['会淡的', '会淡的（' + 会淡总数 + '）'],
                        ['全局', '── 全局事实（' + 全局数 + '）'],
                        ['工作区', '── 工作区记忆（' + 工区数 + '）'],
                        ['会话', '── 这个会话的（' + 会话数 + '）'],
                      ].map(([k, t]) => React.createElement('option', { key: k, value: k }, t)),
                    ),
                    // ⭐ 顺序开关：按日期排，默认「日期新的在前」
                    //   （851 条里只画前 200 条，不排的话看到的永远是最老的）
                    React.createElement(
                      'button',
                      {
                        style: S.btn,
                        title: '按最左边的日期排。没写日期的排在最后 —— 它们不知道是什么时候的事',
                        onClick: () => set顺序(顺序 === '新' ? '旧' : '新'),
                      },
                      '日期：' + (顺序 === '新' ? '新的在前' : '老的在前'),
                    ),
                    // ⭐ 补日期：从正文里认出日期，只补没日期的（补之前自动备份）
                    没日期的 > 0
                      ? React.createElement(
                          'button',
                          {
                            style: S.btn,
                            title: '从正文里认出日期（09-17、8月26日…）。只补没日期的，已有的不动；补之前会自动备份',
                            onClick: () => setConfirm({ id: '*', kind: 'backfill' }),
                          },
                          '补日期（' + 没日期的 + '）',
                        )
                      : null,
                    // ⭐⭐ 2026-09-22：补标「永远不淡」——
                    //   提炼原来只改重要度、不碰分类，所以老记忆该不淡的没标上
                    没判过的 > 0
                      ? React.createElement(
                          'button',
                          {
                            style: S.btn,
                            title:
                              '拿模型一条条判「该不该一直记得」，判成要记一辈子的就标成「永远不淡」' +
                              '（会收进「长期事实」那一栏）。判过的不会重复问；动之前自动备份',
                            onClick: () => setConfirm({ id: '*', kind: 'stable' }),
                          },
                          '补标不淡（' + 没判过的 + '）',
                        )
                      : null,
                    // ⭐ 2026-09-22（反馈「判定太松了就得改」）：判据改严之后，
                    //   **已经判过的那批得用新判据重来一遍** —— 否则老结果一直留着 ✗
                    判过的 > 0
                      ? React.createElement(
                          'button',
                          {
                            style: S.btn,
                            title:
                              '把所有「判过」的标记清掉，用现在的判据从头判一遍。' +
                              '判据改过之后要用这个 —— 不然老结果一直留着。会重新调模型，动之前自动备份',
                            onClick: () => setConfirm({ id: '*', kind: 'restable' }),
                          },
                          '重判一遍（' + 判过的 + '）',
                        )
                      : null,
                    // ⭐⭐ 2026-09-23（第三步）：**老数据清洗补键** ✓
                    //   提炼只管以后；老条目本来就没键 → 这里单独过一遍
                    //   ⚠ 先「试几条」再真洗 —— 一条命令改几百条，得让她先看一眼 ✓
                    //   ⚠⚠ 按钮上**不许写「清洗补键」** —— 那是我自己造的词，她看不懂 ✗
                    //     改成说**它有什么用**：「讲同一件事的，只留最新那条」
                    没键的 > 0
                      ? React.createElement(
                          'button',
                          {
                            style: S.btn,
                            title:
                              '让老记忆认出「讲的是同一件事」。\n' +
                              '比如「她身高一米七」和「她身高一米六八」是同一件事 —— ' +
                              '认出来之后只留最新那条，旧的收起来（还能恢复）。\n' +
                              '光看句子像不像认不出来，所以要一条条问模型。\n' +
                              '⚠ 先点「试 8 条看看」看一眼它标的对不对，再决定要不要全跑。',
                            onClick: () => setConfirm({ id: '*', kind: 'washkeys' }),
                          },
                          '同一件事只留最新（' + 没键的 + '）',
                        )
                      : null,
                    // 补过了就想退回来（几百条自动改的，得能一键回到洗之前）✓
                    可撤的 > 0
                      ? React.createElement(
                          'button',
                          {
                            style: S.btn,
                            title:
                              '把这次自动标的全撤掉、顺手收起来的也全放回来 —— 回到没跑之前。\n' +
                              '（只撤自动标的 —— 你自己填的那些不动）',
                            onClick: () => setConfirm({ id: '*', kind: 'unwashkeys' }),
                          },
                          '撤掉这次标的（' + 可撤的 + '）',
                        )
                      : null,
                  ),
                  // ⭐⭐ 2026-09-23：她说了「这个让人看不懂，写通俗一点的」——
                  //   光按钮上有个名字不够，旁边得有一句人话解释它到底干嘛 ✓
                  //   （只在按钮露着的时候出现，平时不占地方）
                  没键的 > 0
                    ? React.createElement(
                        'div',
                        { style: Object.assign({}, S.dim, { fontSize: 11, margin: '4px 0 0' }) },
                        '「同一件事只留最新」是干嘛的：给老记忆一条条标上「这条讲的是哪件事」。' +
                          '标好之后，讲同一件事的只留最新那条，旧的收起来（还能恢复）。',
                      )
                    : null,
                  // ⭐⭐ 2026-09-23：跑过之后跟她交代一句「剩下的去哪儿了」✓
                  //   模型会把一批判成「这条不用标」（一次性的、拿不准的）——
                  //   那种**不标但算问过了**。不说明的话她会以为漏了/白跑了 ✗
                  判留空的 > 0
                    ? React.createElement(
                        'div',
                        { style: Object.assign({}, S.dim, { fontSize: 11, margin: '4px 0 0' }) },
                        '（另外 ' + 判留空的 + ' 条，模型看了说「这条不用标」—— 一次性的、或者拿不准的。' +
                          '那种一个字都没改，也不会再问一遍 ✓）',
                      )
                    : null,
                  confirm && confirm.kind === 'stable'
                    ? React.createElement(
                        'div',
                        { style: S.askBox },
                        React.createElement(
                          'div',
                          { style: { flex: 1 } },
                          '拿模型判一遍这 ' + 没判过的 + ' 条该不该「永远不淡」？',
                          React.createElement(
                            'div',
                            { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2 }) },
                            '会调用模型（走你 DSH 里那个），一批 20 条慢慢跑。判过的不会重复问。',
                          ),
                        ),
                        React.createElement('button', { style: S.btnDanger, disabled: busy, onClick: () => 补不淡(false) }, busy ? '判着呢…' : '开始'),
                        React.createElement('button', { style: S.btn, onClick: () => setConfirm(null) }, '算了'),
                      )
                    : null,
                  // ⭐ 重判：判据改过之后，把老结果清掉重来 ✓
                  confirm && confirm.kind === 'restable'
                    ? React.createElement(
                        'div',
                        { style: S.askBox },
                        React.createElement(
                          'div',
                          { style: { flex: 1 } },
                          '把 ' + 判过的 + ' 条的「判过」标记全清掉，用现在的判据重判一遍？',
                          React.createElement(
                            'div',
                            { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2 }) },
                            '判据改过之后要用这个 —— 不然老结果一直留着。会重新调模型（全库 ' +
                              (s.memories || []).length + ' 条，一批 20 条），动之前自动备份。',
                          ),
                        ),
                        React.createElement('button', { style: S.btnDanger, disabled: busy, onClick: () => 补不淡(true) }, busy ? '判着呢…' : '重判'),
                        React.createElement('button', { style: S.btn, onClick: () => setConfirm(null) }, '算了'),
                      )
                    : null,
                  // ⭐⭐ 2026-09-23：清洗补键 —— 先「试几条」✓
                  confirm && confirm.kind === 'washkeys'
                    ? React.createElement(
                        'div',
                        { style: S.askBox },
                        React.createElement(
                          'div',
                          { style: { flex: 1 } },
                          '这 ' + 没键的 + ' 条老记忆，让它们认出「讲的是同一件事」？',
                          React.createElement(
                            'div',
                            { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2 }) },
                            '每条记忆贴一个说明：「这条讲的是哪件事」。讲同一件事的，以后只留最新那条，' +
                              '旧的收起来（还能恢复）—— 就不用再靠「句子像不像」去猜了。' +
                              '会调用模型（走你 DSH 里那个），一批 8 条慢慢跑，只在设置页跑、不碰对话。动之前自动备份。',
                          ),
                        ),
                        React.createElement('button', { style: S.btn, disabled: busy, onClick: () => 洗键(true) }, busy ? '跑着呢…' : '先试 8 条看看'),
                        React.createElement('button', { style: S.btnDanger, disabled: busy, onClick: () => 洗键(false) }, busy ? '跑着呢…' : '全部开始'),
                        React.createElement('button', { style: S.btn, onClick: () => setConfirm(null) }, '算了'),
                      )
                    : null,
                  // 撤退：把这次自动标的全撤掉
                  confirm && confirm.kind === 'unwashkeys'
                    ? React.createElement(
                        'div',
                        { style: S.askBox },
                        React.createElement(
                          'div',
                          { style: { flex: 1 } },
                          '把这次自动标的 ' + 可撤的 + ' 条全撤掉、顺手收起来的也全放回来？',
                          React.createElement(
                            'div',
                            { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2 }) },
                            '回到没跑之前的样子。只撤自动标的 —— 你自己填的那些不动。' +
                              '记忆本身一条都不会被删。',
                          ),
                        ),
                        React.createElement('button', { style: S.btnDanger, disabled: busy, onClick: 撤销洗键 }, busy ? '撤着呢…' : '撤掉'),
                        React.createElement('button', { style: S.btn, onClick: () => setConfirm(null) }, '算了'),
                      )
                    : null,
                  // ⭐⭐ 2026-09-23：**进度条**（跟补标那条分开，不互相盖）✓
                  洗键进度.在跑 && 洗键进度.总 > 0
                    ? (() => {
                        const 百 = Math.round((洗键进度.已 / 洗键进度.总) * 100)
                        return React.createElement(
                          'div',
                          { style: Object.assign({}, S.editBox, { marginTop: 8 }) },
                          React.createElement(
                            'div',
                            { style: { fontSize: 13, marginBottom: 4 } },
                            '⭐ 正在认「讲的是同一件事」' + (洗键进度.干跑 ? '（先试几条）' : '') + '　跑着呢',
                          ),
                          React.createElement(
                            'div',
                            { style: { fontSize: 12, color: '#8a6d3b' } },
                            '已过 ' + 洗键进度.已 + ' / ' + 洗键进度.总 + ' 条（' + 百 + '%）' +
                              '　还剩 ' + Math.max(0, 洗键进度.总 - 洗键进度.已) + ' 条　（每批 8 条，跑着就动）',
                          ),
                        )
                      })()
                    : null,
                  // ⭐⭐ 2026-09-22（她要的）：**补标/重判的进度条，就贴在按钮这一行下面** ✓
                  //   点了才出现，没点就没有 —— 不跟提炼/扩词那条挤在一起 ✓
                  补标进度.在跑 && 补标进度.总 > 0
                    ? (() => {
                        const 百 = Math.round((补标进度.已 / 补标进度.总) * 100)
                        return React.createElement(
                          'div',
                          { style: Object.assign({}, S.editBox, { marginTop: 8 }) },
                          React.createElement(
                            'div',
                            { style: { fontSize: 13, marginBottom: 4 } },
                            '⭐ ' + (补标进度.重判 ? '重判一遍' : '补标不淡') + '　跑着呢',
                          ),
                          React.createElement(
                            'div',
                            { style: S.barOut },
                            React.createElement('div', { style: Object.assign({}, S.barIn, { width: 百 + '%' }) }),
                          ),
                          React.createElement(
                            'div',
                            { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 4 }) },
                            '已判 ' + 补标进度.已 + ' / ' + 补标进度.总 + ' 条（' + 百 + '%）' +
                              '　还剩 ' + Math.max(0, 补标进度.总 - 补标进度.已) + ' 条' +
                              (补标进度.等 ? '　⚠ 撞限流了，正在等 ' + 补标进度.等 + ' 秒' : '　（每批 20 条，跑着就动）'),
                          ),
                        )
                      })()
                    : null,
                  // ⭐⭐ 2026-09-22（她要的）：**批量删的二次确认条** ✓
                  //   第一次点是「批量删（N）」，出这条；第二次点「确定删」才真删 ✓
                  批删问 && 已选几条 > 0
                    ? React.createElement(
                        'div',
                        { style: S.confirm },
                        React.createElement(
                          'div',
                          { style: { flex: 1 } },
                          '要删掉这 ' + 已选几条 + ' 条吗？',
                          React.createElement(
                            'div',
                            { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2 }) },
                            '不是销毁 —— 收进「已删」里，点开还能找回来。动之前也会自动备份。',
                          ),
                          // ⭐ 1.4.0：里面混了全局事实就单说一句（这些删了所有会话都会忘）
                          已选事实 > 0
                            ? React.createElement(
                                'div',
                                { style: Object.assign({}, S.warn, { fontSize: 12, marginTop: 2 }) },
                                '⚠ 其中有 ' + 已选事实 + ' 条是全局事实 —— 删了所有会话都会忘。',
                              )
                            : null,
                        ),
                        React.createElement('button', { style: S.btnDanger, disabled: busy, onClick: () => 批删(s) }, busy ? '删着…' : '确定删（' + 已选几条 + ' 条）'),
                        React.createElement('button', { style: S.btn, onClick: () => set批删问(false) }, '算了'),
                      )
                    : null,
                  // ⚠⚠ 2026-09-22（我发现的）：`notes` 原来**只在第一级**渲染 ——
                  //   而会话详情是 `if (open) return …` **提前返回**的，
                  //   所以在详情页里 setNotes 的东西**一个字都看不到** ✗
                  //   「补日期」「补标不淡」「查重」的结果提示全落在这儿 → 补一份 ✓
                  notes && notes.length
                    ? React.createElement(
                        'div',
                        { style: Object.assign({}, S.warn, { margin: '8px 0', fontSize: 12, whiteSpace: 'pre-line' }) },
                        '　· ' + notes.join('\n　· '),
                      )
                    : null,
                  // ⭐⭐ 2026-09-22（她的第十件）：**从会话导出档案** 的面板
                  //   四步分开 —— 因为第三步**调模型、花钱**，得让人看清再点 ✓
                  查重 && 查重开
                    ? React.createElement(
                        'div',                      { style: Object.assign({}, S.editBox, { marginTop: 8 }) },
                        [
                          React.createElement(
                            'div',
                            { key: '头', style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                            React.createElement('b', null, '查重：'),
                            React.createElement('span', null, (查重.组 || []).length + ' 组、能少 ' + 查重.能少 + ' 条'),
                            React.createElement(
                              'span',
                              { style: S.dim },
                              '（真重复 ' + 查重.真重复组数 + ' 组 / 汇总+明细 ' + 查重.汇总组数 + ' 组）',
                            ),
                            React.createElement(
                              'button',
                              { style: S.btn, disabled: busy || !查重.真重复组数, onClick: () => 合重复(s, true) },
                              '一键合真重复（' + 查重.真重复组数 + ' 组）',
                            ),
                            React.createElement(
                              'button',
                              {
                                style: S.btn,
                                disabled: busy || !(查重.组 || []).some((g, i) => 查重合[i]),
                                onClick: () => 合重复(s, false),
                              },
                              '按我勾的合（' + (查重.组 || []).filter((g, i) => 查重合[i]).length + ' 组、少 ' +
                                (查重.组 || []).reduce((a, g, i) => a + (查重合[i] ? g.条们.length - 1 : 0), 0) + ' 条）',
                            ),
                            React.createElement(
                              'button',
                              {
                                style: S.btn,
                                title: '把「汇总+明细」那些也勾上。⚠ 一长一短，合了会丢短的里的细节',
                                onClick: () => {
                                  const 全 = {}
                                  ;(查重.组 || []).forEach((g, i) => {
                                    全[i] = true
                                  })
                                  set查重合(全)
                                },
                              },
                              '把「汇总+明细」也全勾上',
                            ),
                            React.createElement('button', { style: S.btn, onClick: () => { set查重(null); set查重开(false) } }, '收起'),
                          ),
                          React.createElement(
                            'div',
                            { key: '说明', style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 4 }) },
                            '「真重复」= 两条长度差不多，合了安全，默认勾上；' +
                              '「汇总+明细」= 一长一短（长的把短的包住了），默认不勾 —— ' +
                              '长的那条未必真的包含了短的每个细节，合了会丢东西。要合哪一组，自己勾那一组。' +
                              '合掉的不销毁，收在「已删」里。',
                          ),
                        ]
                          .concat(
                            (查重.组 || []).slice(0, 60).map((g, i) =>
                              React.createElement(
                                'div',
                                {
                                  key: 'g' + i,
                                  style: { marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(128,128,128,.18)' },
                                },
                                [
                                  React.createElement(
                                    'div',
                                    {
                                      key: 'h',
                                      style: { fontSize: 12, marginBottom: 4, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
                                    },
                                    // ⭐⭐ 2026-09-23：每组一个「要合」的勾 —— 不勾的组「按我勾的合」不会碰 ✓
                                    React.createElement('input', {
                                      key: 'c',
                                      type: 'checkbox',
                                      checked: !!查重合[i],
                                      title: '勾上它，这一组才会被「按我勾的合」合掉',
                                      onChange: () => set查重合(Object.assign({}, 查重合, { [i]: !查重合[i] })),
                                    }),
                                    '第 ' + (i + 1) + ' 组 · ' + g.条们.length + ' 条 · ',
                                    React.createElement('b', { style: g.类型 === '真重复' ? S.ok : S.warn }, g.类型),
                                    查重合[i]
                                      ? null
                                      : React.createElement(
                                          'span',
                                          { style: Object.assign({}, S.dim, { fontSize: 11 }) },
                                          '（不参与）',
                                        ),
                                  ),
                                ].concat(
                                  g.条们.map((t) =>
                                    React.createElement(
                                      'label',
                                      {
                                        key: t.id,
                                        style: { display: 'flex', gap: 6, alignItems: 'flex-start', padding: '3px 0', cursor: 'pointer' },
                                      },
                                      [
                                        React.createElement('input', {
                                          key: 'r',
                                          type: 'radio',
                                          name: '查重组' + i,
                                          checked: 查重选[i] === t.id,
                                          onChange: () => set查重选(Object.assign({}, 查重选, { [i]: t.id })),
                                        }),
                                        React.createElement(
                                          'span',
                                          { key: 't', style: { flex: 1, minWidth: 0, overflowWrap: 'anywhere' } },
                                          t.text,
                                        ),
                                        React.createElement(
                                          'span',
                                          { key: 'n', style: Object.assign({}, S.dim, { fontSize: 11, whiteSpace: 'nowrap' }) },
                                          t.长 + ' 字',
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          )
                          .concat(
                            (查重.组 || []).length > 60
                              ? [
                                  React.createElement(
                                    'div',
                                    { key: '更多', style: Object.assign({}, S.dim, { marginTop: 8 }) },
                                    '（只画了前 60 组，先合这些再点一次查重）',
                                  ),
                                ]
                              : [],
                          ),
                      )
                    : null,
                  confirm && confirm.kind === 'backfill'
                    ? React.createElement(
                        'div',
                        { style: S.confirm },
                        React.createElement('span', { style: { flex: 1 } }, '从正文里补日期？只补那 ' + 没日期的 + ' 条没日期的，已有的不动（补之前会自动备份）。'),
                        React.createElement('button', { style: S.btn, onClick: 补日期 }, '补'),
                        React.createElement('button', { style: S.btn, onClick: () => setConfirm(null) }, '算了'),
                      )
                    : null,
                  搜词 || 看哪边 !== '全部'
                    ? React.createElement(
                        'div',
                        { style: Object.assign({}, S.dim, { fontSize: 12, margin: '0 0 6px' }) },
                        // ⭐ 1.4.0：分母也拆开报（事实全局共享 / 事件本会话）—— 只看合并总数会以为「都是这儿的」
                        '这里 ' + 过滤后.length + ' 条 / 共 ' + s.memories.length + ' 条（事实 ' + 数事实(s) + ' · 事件 ' + 数事件(s) + '）' +
                          (看哪边 === '有时间' ? '（只看记了时间的）' : 看哪边 === '没时间' ? '（只看没记时间的）' : '') +
                          (过滤后.length === 0 ? ' —— 换几个字试试，或者点上面的「看」换个范围' : ''),
                      )
                    : null,
                  React.createElement(
                    'div',
                    { style: { marginTop: 10 } },
                    过滤后.length === 0
                      ? React.createElement(
                          'div',
                          { style: S.dim },
                          搜词 ? '（没有含「' + 搜词 + '」的）' : '（这个范围里没有记忆）',
                        )
                      : (() => {
                          // ⭐⭐ 2026-09-22（她要的）：**「全部」视图里，不会淡的收进一个折叠的分组** ✓
                          //   原话：「那一行，我们是单独做一个收理的文件夹一样的，
                          //              不然的话那些就不需要露在外面」
                          //   ⭐ 又说：「**外面都是会淡的，里面才是不会淡的**，就不用管里面了」
                          //   → 外面只列**会淡的**；不会淡的（长期事实 + 没时间的）
                          //     塞进「▸ 不会淡的（N 条）」里，点开才看 ✓
                          const 上 = 画这个.slice(0, 画全部 ? 画这个.length : 一次最多画)
                          // ⚠ 搜的时候**不许折叠** —— 不然搜到了却看不见 ✗
                          //   （自检逮到的：搜「衣服」时匹配的那条是长期事实，被收进分组里了）
                          if (看哪边 !== '全部' || 搜词) return 上.map(一条记忆)
                          const 会淡的 = 上.filter((m) => !不会淡(m))
                          const 不淡的 = 上.filter(不会淡)
                          return [
                            ...会淡的.map(一条记忆),
                            不淡的.length
                              ? React.createElement(
                                  'div',
                                  { key: '事实组' },
                                  React.createElement(
                                    'div',
                                    {
                                      style: Object.assign({}, S.h, { cursor: 'pointer', marginTop: 14 }),
                                      onClick: () => set看事实(!看事实),
                                    },
                                    (看事实 ? '▾ ' : '▸ ') + '不会淡的 · 长期事实（' + 不淡的.length + ' 条，全局共享）',
                                  ),
                                  React.createElement(
                                    'div',
                                    { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 4 }) },
                                    '里面这些是长期事实（要记一辈子的事，不会淡）—— 存在全局库里，所有会话都读得到；' +
                                      '在这儿删一条，哪儿都会忘。' +
                                      '外面那些都会淡 —— 包括没记时间的（它们从「记下来的那天」开始淡）。',
                                  ),
                                  看事实 ? 不淡的.map(一条记忆) : null,
                                )
                              : null,
                          ]
                        })(),
                  ),
                  过滤后.length > 一次最多画
                    ? React.createElement(
                        'div',
                        { style: { margin: '6px 0 0', fontSize: 12 } },
                        画全部
                          ? React.createElement('span', { style: S.link, onClick: () => set画全部(false) }, '↑ 收起来（只画前 ' + 一次最多画 + ' 条）')
                          : React.createElement(
                              'span',
                              { style: S.link, onClick: () => set画全部(true) },
                              '还有 ' + (过滤后.length - 一次最多画) + ' 条' +
                                (看哪边 === '没时间' ? '（更早记的）' : 顺序 === '新' ? '（更早的）' : '（更新的）') +
                                '没画出来 —— 点这里全部显示（多了会卡）',
                            ),
                      )
                    : null,
                )
              : null,
            React.createElement(
              'div',
              null,
              React.createElement('div', { style: Object.assign({}, S.h, S.part, { cursor: 'pointer' }), onClick: () => setShowDeleted(!showDeleted) }, (showDeleted ? '▾ ' : '▸ ') + '已删掉的（' + (已删.length + 被取代的.length) + '）'),
              React.createElement('div', { style: S.dim }, '收起来的记忆不会被注入，但还留着，随时能找回来。'),
              showDeleted
                ? React.createElement(
                    'div',
                    { style: { marginTop: 6 } },
                    // ⭐⭐ 2026-09-22（反馈「你放在最下面的呀，你改到最上面去，
                    //     谁那么多条？如果有100条，我得翻到最下面才能全选吗？」）：
                    //   工具条原来在**列表最下面** —— 68 条就得翻到底才能点「全选」✗
                    //   → 挪到**最上面**，跟标题挨着 ✓
                    // ⭐⭐ 2026-09-23（反馈「点『清空』之后提示在最下面，看都看不到」）：
                    //   确认条原来渲染在**列表下面** —— 68 条就得翻到底才看得见那两句问话 ✗
                    //   （跟 0.9.7 修过的「工具条在最下面」是同一个毛病）
                    //   → 改成**就地替换工具条**：两样都在最上面，点了「清空」，
                    //     工具条那一格立刻变成确认条，不用滚 ✓
                    已删.length > 0 && confirm && confirm.kind === 'purgeall'
                      ? 确认条('把收着的 ' + 已删.length + ' 条全清掉？找不回来了。', '全清掉', 'purgeall', '*')
                      : null,
                    // ⭐⭐ 2026-09-23（反馈「这里没有批量找回呀」）：批量找回的确认
                    //   ⚠ 这个**不是销毁**（是往回捞），所以文案跟「清掉」正好相反
                    已删.length > 0 && !(confirm && confirm.kind === 'purgeall') && 批回问
                      ? React.createElement(
                          'div',
                          { style: S.confirm },
                          React.createElement(
                            'div',
                            { style: { flex: 1 } },
                            批回问.只合并
                              ? '把「合并掉的」那 ' + 已删.filter((m) => m.合并掉的 === true).length + ' 条全捞回来？'
                              : '把勾上的这 ' + 已选清几条 + ' 条捞回来？',
                            React.createElement(
                              'div',
                              { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2 }) },
                              '捞回来之后它们又会被注入（跟原来一样）。不是销毁，随时能再删。',
                            ),
                          ),
                          React.createElement('button', { style: S.btn, disabled: busy, onClick: () => 批回(s, 批回问.只合并) }, busy ? '捞着…' : '确定找回'),
                          React.createElement('button', { style: S.btn, onClick: () => set批回问(false) }, '算了'),
                        )
                      : null,
                    已删.length > 0 && !(confirm && confirm.kind === 'purgeall') && !批回问 && 批清问 && 已选清几条 > 0
                      ? React.createElement(
                          'div',
                          { style: S.confirm },
                          React.createElement(
                            'div',
                            { style: { flex: 1 } },
                            '要彻底清掉这 ' + 已选清几条 + ' 条吗？',
                            React.createElement(
                              'div',
                              { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2 }) },
                              '清掉就找不回来了（备份目录里可能还有一份）。想留就用「找回来」。',
                            ),
                          ),
                          React.createElement('button', { style: S.btnDanger, disabled: busy, onClick: () => 批清(s) }, busy ? '清着…' : '确定清掉（' + 已选清几条 + ' 条）'),
                          React.createElement('button', { style: S.btn, onClick: () => set批清问(false) }, '算了'),
                        )
                      : null,
                    已删.length > 0 && !(confirm && confirm.kind === 'purgeall') && !批回问 && !(批清问 && 已选清几条 > 0)
                      ? React.createElement(
                          'div',
                          { style: { margin: '8px 0', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
                          // ⭐ 一键全选 ✓
                          React.createElement(
                            'button',
                            {
                              style: S.btn,
                              title: '把这一栏里的全勾上（再点一下取消）',
                              onClick: () => {
                                if (已选清几条 === 已删.length) {
                                  set选中清({})
                                  set批清问(false)
                                  return
                                }
                                const 全 = {}
                                for (const m of 已删) 全[m.id] = true
                                set选中清(全)
                              },
                            },
                            已选清几条 === 已删.length && 已删.length > 0 ? '取消全选' : '全选（' + 已删.length + '）',
                          ),
                          // ⭐ 批量清掉（勾了几条就显示几条）—— 点了**不直接清**，先问一遍 ✓
                          已选清几条 > 0
                            ? React.createElement(
                                'button',
                                { style: S.btnDanger, onClick: () => set批清问(true) },
                                '批量清掉（' + 已选清几条 + '）',
                              )
                            : null,
                          // ⭐⭐ 2026-09-23（反馈「这里没有批量找回呀」）：**批量找回** ✓
                          已选清几条 > 0
                            ? React.createElement(
                                'button',
                                {
                                  style: S.btn,
                                  title: '把勾上的这几条从「已删」里捞回来（不是销毁，随时能再删）',
                                  onClick: () => set批回问({ 只合并: false }),
                                },
                                '批量找回（' + 已选清几条 + '）',
                              )
                            : null,
                          // ⭐ 一键撤销整次合并：把「合并掉的」那批全捞回来 ✓
                          已删.filter((m) => m.合并掉的 === true).length > 0
                            ? React.createElement(
                                'button',
                                {
                                  style: S.btn,
                                  title: '把「合并掉的」那批全捞回来 —— 等于撤销整次合并',
                                  onClick: () => set批回问({ 只合并: true }),
                                },
                                '撤销合并：全找回（' + 已删.filter((m) => m.合并掉的 === true).length + '）',
                              )
                            : null,
                          已选清几条 > 0
                            ? React.createElement(
                                'button',
                                { style: S.btn, onClick: () => { set选中清({}); set批清问(false); set批回问(false) } },
                                '取消勾选',
                              )
                            : null,
                          React.createElement('button', { style: S.btn, onClick: () => setConfirm({ id: '*', kind: 'purgeall' }) }, '把「已删掉的」清空'),
                        )
                      : null,
                    已删.length === 0
                      ? React.createElement('div', { style: S.dim }, '（空的）')
                      : 已删.map((m) =>
                          React.createElement(
                            'div',
                            { key: m.id, style: S.条 },
                            React.createElement(
                              'div',
                              { style: S.row },
                              // ⭐ 批量清掉：行首一个勾选框（跟上面那栏一样）
                              React.createElement('input', {
                                type: 'checkbox',
                                checked: !!选中清[m.id],
                                title: '勾上它，再点上面的「批量清掉」',
                                onChange: () => set选中清(Object.assign({}, 选中清, { [m.id]: !选中清[m.id] })),
                              }),
                              React.createElement('div', { style: Object.assign({}, S.dim, { width: 108, flex: 'none' }) }, '收于 ' + rel(m.deletedAt, now)),
                              React.createElement('div', { style: Object.assign({}, S.dim, { flex: 1, minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word' }) }, m.text),
                              React.createElement('div', { style: Object.assign({}, S.link, { flex: 'none', fontSize: 12, marginRight: 10 }), onClick: () => 删(m.id, 'restore') }, '找回来'),
                              React.createElement('div', { style: Object.assign({}, S.drop, { flex: 'none', fontSize: 12, cursor: 'pointer' }), onClick: () => setConfirm({ id: m.id, kind: 'purge' }) }, '彻底清掉'),
                            ),
                            confirm && confirm.id === m.id && confirm.kind === 'purge'
                              ? 确认条('彻底清掉就找不回来了（备份里可能还有）。', '确认清掉', 'purge', m.id)
                              : null,
                          ),
                        ),
                    // ⭐⭐ 2026-09-24（她说的「那已被取代应该回回收站呀」）：
                    //   **被取代的**从主列表挪出来，收在回收站里（就在这一栏下面）✓
                    //   ⚠ 放在 `showDeleted ?` **里面** —— 跟回收站一起折叠 ✓
                    //     （放外面的话，回收站收起来了它们还杵在那儿，看着像两栏）
                    //
                    //   ⚠⚠ 它们**不在 `s.deleted` 里** —— 所以上面那排
                    //     「全选 / 批量清掉 / 把已删掉的清空」**碰不到它们**，
                    //     这是故意的：被取代是自动标的（可能几百条），
                    //     不该被「清空」连坐销毁（丢 157 条那次的教训）✗✗
                    被取代的.length
                      ? React.createElement(
                          'div',
                          null,
                          React.createElement(
                            'div',
                            { style: Object.assign({}, S.h, { marginTop: 16 }) },
                            '被取代的（' + 被取代的.length + '）',
                          ),
                          React.createElement(
                            'div',
                            { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 4 }) },
                            '这些是「讲的是同一件事」里比较旧的那条，自动收起来的 —— 不再被注入，但东西还留着。',
                          ),
                          React.createElement(
                            'div',
                            { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 4 }) },
                            '⚠ 「清空」不会清掉它们（只有你亲手删的那些才会被清掉）。想让它回来就点「恢复」。',
                          ),
                          被取代的.map((m) =>
                            React.createElement(
                              'div',
                              { key: m.id, style: S.条 },
                              React.createElement(
                                'div',
                                { style: S.row },
                                React.createElement(
                                  'div',
                                  { style: Object.assign({}, S.dim, { width: 108, flex: 'none' }) },
                                  m.已被取代 && m.已被取代.作废于 ? '收于 ' + rel(m.已被取代.作废于, now) : '收起来了',
                                ),
                                React.createElement(
                                  'div',
                                  { style: { flex: '1 1 260px', minWidth: 200, overflowWrap: 'anywhere', wordBreak: 'break-word' } },
                                  React.createElement(
                                    'span',
                                    { style: Object.assign({}, S.dim, { textDecoration: 'line-through', opacity: 0.62 }) },
                                    m.text,
                                  ),
                                ),
                                React.createElement(
                                  'div',
                                  {
                                    style: Object.assign({}, S.link, { flex: 'none', fontSize: 12 }),
                                    title: '让它回来 —— 又能被想起来了（标错了 / 状态又变回来了）',
                                    onClick: () => 撤销作废(m.id),
                                  },
                                  '恢复',
                                ),
                              ),
                              m.已被取代 && m.已被取代.为什么
                                ? React.createElement(
                                    'div',
                                    {
                                      style: Object.assign({}, S.dim, {
                                        margin: '0 0 6px 104px',
                                        fontSize: 11,
                                        overflowWrap: 'anywhere',
                                        wordBreak: 'break-word',
                                      }),
                                    },
                                    '为什么收起来：' + m.已被取代.为什么,
                                  )
                                : null,
                            ),
                          ),
                        )
                      : null,
                    // ⚠ 工具条和两个确认条**都在上面**了（见前面那段）——
                    //   原来「批量清掉」和「清空」的确认条渲染在这儿（列表最下面），
                    //   条数一多就看不见 ✗ → 挪走了，这里不再重复 ✓
                  )
                : null,
            ),
            // ⭐ 2026-10-28：这一行往下原来排着「提炼 / 扩词」「从旧档案导入」「备份」三块 ——
            //   现在分别进了 页签③导入 / 页签④记录 里，这儿只负责收尾 ✓
            ),          // ← 收住「记忆」那一页（自己加一条 + 记忆列表 + 已删掉的）
            // ---- 页签③ 导入记录：这个会话导过哪几批（只读）+ 撤销这一批 ----
            React.createElement(
              'div',
              { style: { display: 详情页 === '导入记录' ? 'block' : 'none' } },
              React.createElement(导入记录页, { open: open, load: load }),
            ),
            渲染召回记录页签({ React, S, s, tr, 详情页 }),
          )
        }
  
        // ---- 第一级：会话列表 ----
        // ⭐ 2026-11-01：参数区搬去「高级」页了（见模块级 参数区 组件），这里不再有 spec/参数 UI。
  
        // 会话列表的筛选（工作区 + 名字）
        const 可见会话 = ((d && d.sessions) || []).filter((s) => {
          if (选中区 && 区会话 && !区会话.has(s.id)) return false
          if (会话搜) {
            const q = 会话搜.toLowerCase()
            if (!String(s.title || s.id || '').toLowerCase().includes(q)) return false
          }
          return true
        })
        return React.createElement(
          'div',
          { style: S.wrap },
          // ⭐ 1.4.2：以前顶上摆「鱼的记忆 v…」+ 一句「哪些会话用记忆」，然后十来块平铺 ——
          //   没有分区，看不出哪块管什么。现在：一句总说明 + 两张卡（记不记 / 会话）✓
          React.createElement(
            'div',
            { style: Object.assign({}, S.dim, { marginBottom: 12, fontSize: 12 }) },
            '每个会话都能记、也能读。记下来的分两种：所有会话共享的「事实」，和只属于某个会话的「事件」。',
          ),
          // ── 卡 1：记不记（称呼 + 总开关）──
          React.createElement(
            'div',
            { style: S.sec },
            React.createElement(
              'div',
              { style: S.secH },
              React.createElement('span', { style: S.secTitle }, '记不记'),
              React.createElement('span', { style: S.secTag }, '总开关 · 称呼'),
            ),
            React.createElement(
              'div',
              { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 8 }) },
              '装好就是开着的。想给某个会话单独关掉，去下面那张卡点它右边的「关」。',
            ),
          React.createElement(
            'div',
            { style: S.nameBox },
            React.createElement('div', { style: { flex: 'none', width: 132 } }, '用户的称呼'),
            React.createElement('input', {
              style: Object.assign({}, S.inp, { width: 90 }),
              placeholder: 'ta / 她 / 他',
              value: pronounDraft !== null ? pronounDraft : d.userPronoun || 'ta',
              onChange: (e) => setPronounDraft(e.target.value),
            }),
            React.createElement(
              'button',
              {
                style: S.btn,
                onClick: () => {
                  const p = pronounDraft !== null ? pronounDraft : d.userPronoun || 'ta'
                  post('/names', { userPronoun: p }).then((r) => {
                    setPronounDraft(null)
                    // 影响到了旧记忆就先问一句，不偷偷改 ✓
                    if (r && r.称呼影响几条 > 0 && !r.称呼已改) setPronounAsk({ n: r.称呼影响几条, to: p, 例子: r.称呼例子 || [] })
                    else setPronounAsk(null)
                    load()
                  })
                },
              },
              '存',
            ),
            React.createElement('span', { style: Object.assign({}, S.dim, { fontSize: 12, flex: 1 }) }, '记忆里提到你时用哪个字。默认「ta」；设成「她」或「他」就按你设的记。'),
          ),
          pronounAsk
            ? React.createElement(
                'div',
                { style: S.askBox },
                React.createElement(
                  'div',
                  { style: { flex: 1 } },
                  React.createElement('div', null, '已有 ' + pronounAsk.n + ' 条旧记忆里还写着旧的字。要一起改成「' + pronounAsk.to + '」吗？'),
                  (pronounAsk.例子 || []).slice(0, 2).map((e, i) =>
                    React.createElement('div', { key: i, style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2 }) }, '　「' + e.旧 + '」→「' + e.新 + '」'),
                  ),
                ),
                React.createElement(
                  'button',
                  {
                    style: S.btn,
                    onClick: () =>
                      post('/names', { userPronoun: pronounAsk.to, applyToExisting: true }).then(() => {
                        setPronounAsk(null)
                        load()
                      }),
                  },
                  '一起改',
                ),
                React.createElement('button', { style: S.btn, onClick: () => setPronounAsk(null) }, '以后再说'),
              )
            : null,
          // ⭐ 1.3.4：**总开关**（管整个插件）+ 下面每个会话自己的开关
          //   放同一块，是因为它们管的是同一件事（记不记），只是范围不同。
          React.createElement(
            'div',
            { style: Object.assign({}, S.row, S.条, { alignItems: 'center' }) },
            React.createElement(
              'button',
              {
                style: Object.assign({}, S.btn, {
                  flex: 'none',
                  color: d.全局开关 !== false ? '#8fd0a0' : 'inherit',
                  borderColor: d.全局开关 !== false ? 'rgba(143,208,160,.6)' : 'rgba(128,128,128,.35)',
                }),
                disabled: busy,
                onClick: () => {
                  setBusy(true)
                  post('/global', { on: d.全局开关 === false })
                    .then(() => {
                      setBusy(false)
                      load()
                    })
                    .catch(() => setBusy(false))
                },
              },
              (d.全局开关 !== false ? '● ' : '○ ') + 'remember 工具',
            ),
            React.createElement(
              'div',
              { style: Object.assign({}, S.dim, { flex: 1, minWidth: 0 }) },
              d.全局开关 !== false
                ? '所有会话都能记、也能读。单独不想要哪个，用下面那一行关掉。'
                : '全关着 —— 哪个会话都不记也不读，工具列表里也不会出现它。',
            ),
          ),
          ),
          // ⭐ 1.8.20：词门健康状态 —— 词典/词频缺失时召回会静默退回老切法，
          //   这里让它在设置页第一眼就能看到（后端 /list 的 lexicon 字段）
          React.createElement(
            'div',
            { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 4 }) },
            d && d.lexicon && d.lexicon.词典 > 0 && d.lexicon.词频 > 0
              ? '通用中文词门：词表 ' + d.lexicon.词典 + ' 词 · 词频 ' + d.lexicon.词频 + ' 词 ✓'
              : React.createElement(
                  'span',
                  { style: { color: '#e8a87c' } },
                  '⚠ 词典/词频文件缺失 —— 通用中文词门已失效，召回退回老切法（lib/lexicon.txt、lib/wordfreq.txt）',
                ),
          ),
          // ── 卡 2：会话 ──
          React.createElement(
            'div',
            { style: S.sec },
            React.createElement(
              'div',
              { style: S.secH },
              React.createElement('span', { style: S.secTitle }, '会话'),
              React.createElement('span', { style: S.secTag }, '全局事实 ' + 全局事实数() + ' 条 · 所有会话共享'),
            ),
            // ⭐ 1.4.0（需求①）：设置页第一眼就把两笔账分开 ——
            //   全局事实只有一条线（所有会话看到的一样），各会话的事件各报各的 ✓
            React.createElement(
              'div',
              { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 6, overflowWrap: 'anywhere' }) },
              '事实是所有会话共享的（在哪个会话里删，哪儿都会忘）；「事件」只属于那个会话。' +
                // ⭐ 2026-10-28：详情页拆成页签了，这句跟着改，别再说「都在那儿」让人乱翻 ✓
                '点名字进详情：记忆列表、称呼、从旧档案导入（导完还能提炼 / 扩词）、召回记录，分页签放着。',
            ),
          // ⭐ 2026-11-01 用户要求：工作区记忆层（1.8.37 加的 scope=workspace:<cwd>）一直没界面，
          //   这里拆成两个并列子页签：会话列表 / 工作区记忆 ✓
          React.createElement(
            'div',
            { style: { display: 'flex', gap: 6, margin: '2px 0 8px' } },
            ['会话', '工作区记忆'].map((k) =>
              React.createElement(
                'button',
                {
                  key: k,
                  style: Object.assign({}, 子页签 === k ? S.tabOn : S.tabOff, { fontSize: 12, padding: '3px 10px' }),
                  onClick: () => set子页签(k),
                },
                k,
              ),
            ),
          ),
          子页签 === '会话'
            ? React.createElement(
                'div',
                { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', margin: '2px 0 8px' } },
                el(选择器, {
                  style: Object.assign({}, S.inp, { width: 'auto', minWidth: 150, flex: 'none' }),
                  值: 选中区,
                  选项: [{ v: '', t: '所有工作区' }].concat(
                    (区表 || []).map((w) => ({ v: w.id, t: (w.name || '工作区') + '（' + (w.会话数 || 0) + '）' })),
                  ),
                  onChange: (v) => set选中区(v),
                }),
                React.createElement('input', {
                  style: Object.assign({}, S.inp, { width: 150, flex: 'none' }),
                  placeholder: '按会话名搜…',
                  value: 会话搜,
                  onChange: (e) => set会话搜(e.target.value),
                }),
                可见会话.length === (d.sessions || []).length
                  ? null
                  : React.createElement('span', { style: Object.assign({}, S.dim, { fontSize: 12 }) }, '筛出 ' + 可见会话.length + ' 个'),
              )
            : null,
          子页签 === '会话' && 可见会话.length === 0
            ? React.createElement('div', { style: Object.assign({}, S.dim, { fontSize: 12, padding: '8px 2px' }) }, '没有符合条件的会话')
            : null,
          // ⭐ 1.8.0：从「⋯ → 复制记忆到…」进来 —— 选目标会话，再复制
          子页签 === '会话' && 复制源
            ? React.createElement(
                'div',
                { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', margin: '4px 0 8px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28))', background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.07))' } },
                React.createElement('span', { style: { fontSize: 12.5 } }, '把「' + ((d.sessions || []).find((x) => x.id === 复制源) || {}).title + '」的事件复制到'),
                React.createElement(选择器, {
                  style: Object.assign({}, S.inp, { width: 'auto', minWidth: 180 }),
                  值: 复制到,
                  选项: [{ v: '', t: '（选一个目标会话）' }].concat(
                    (d.sessions || []).filter((x) => x.id !== 复制源).map((x) => ({ v: x.id, t: x.title || x.id.slice(0, 18) })),
                  ),
                  onChange: (v) => set复制到(v),
                }),
                React.createElement(
                  'button',
                  {
                    style: S.btn,
                    disabled: !复制到 || !!busy,
                    onClick: () => {
                      setBusy(true)
                      post('/copy-to', { session: 复制源, to: 复制到 })
                        .then(() => {
                          setBusy(false)
                          set复制源('')
                          set复制到('')
                          setNotes(['✓ 复制过去了（目标会话原来的事件已被替换，覆盖前有 .bak）'])
                          load()
                        })
                        .catch(() => {
                          setBusy(false)
                          setNotes(['✗ 没复制成，看控制台'])
                        })
                    },
                  },
                  '复制过去',
                ),
                React.createElement('button', { style: S.btn, onClick: () => { set复制源(''); set复制到('') } }, '取消'),
              )
            : null,
          子页签 === '会话'
            ? 可见会话.map((s) =>
            React.createElement(
              'div',
              { key: s.id, style: Object.assign({}, S.row, S.条) },
              React.createElement(
                'button',
                {
                  style: Object.assign({}, S.btn, {
                    flex: 'none',
                    width: 56,
                    color: s.enabled ? '#8fd0a0' : 'inherit',
                    borderColor: s.enabled ? 'rgba(143,208,160,.6)' : 'rgba(128,128,128,.35)',
                  }),
                  disabled: busy,
                  onClick: () => {
                    setBusy(true)
                    post('/toggle', { session: s.id, on: !s.enabled })
                      .then(() => {
                        setBusy(false)
                        load()
                      })
                      .catch(() => setBusy(false))
                  },
                },
                s.enabled ? '● 开' : '○ 关',
              ),
              React.createElement('div', { style: Object.assign({}, S.link, { flex: 1, minWidth: 120, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }), title: s.title || s.id, onClick: () => setOpen(s.id) }, s.title || s.id.slice(0, 24)),
              // ⚠ 在线会话也要渲染这一格（占位 48）—— 不渲染会让后面的列整体左移，看着像排错版
              React.createElement(
                'div',
                { style: Object.assign({}, S.dim, { width: 48, fontSize: 12, flex: 'none' }) },
                s.live ? '' : '不在线',
              ),
              // ⭐ 1.4.0（需求①）：一行里分开报 —— 事实是所有会话共享的（每行数字都一样），
              //   事件才是这个会话自己的。只写「525 条」会让人以为是这个会话独有的 ✗
              React.createElement(
                'div',
                {
                  style: Object.assign({}, S.dim, { width: 96, fontSize: 12, flex: 'none', whiteSpace: 'nowrap' }),
                  title: '这个会话里记下了多少条（所有会话共用的那部分不重复算进来）',
                },
                '记忆 ' + 数事件(s) + ' 条',
              ),
              React.createElement('div', { style: Object.assign({}, S.dim, { width: 84, flex: 'none', whiteSpace: 'nowrap' }) }, s.lastTrace ? rel(s.lastTrace, now) : '—'),
              // ⭐ B 轮 F4：静音 —— 这个会话接下来 30 分钟不往上下文里塞记忆（别的会话照常）
              React.createElement(
                'button',
                {
                  style: Object.assign({}, S.btn, { flex: 'none', fontSize: 11, padding: '2px 8px' }),
                  title: '接下来 30 分钟不往这个会话里注入记忆（记忆照记，只是先不往上下文里塞；再点一下取消）',
                  disabled: busy,
                  onClick: () => {
                    setBusy(true)
                    post('/pause', { session: s.id, minutes: 30 })
                      .then(() => {
                        setBusy(false)
                        load()
                      })
                      .catch(() => setBusy(false))
                  },
                },
                '静音 30 分',
              ),
              // ⭐ 1.8.0：每行一个 ⋯ ——「复制记忆到…」放这里（复制是会话级动作，不属于详情页）
              React.createElement(
                'div',
                { style: { position: 'relative', flex: 'none' } },
                React.createElement(
                  'button',
                  {
                    style: Object.assign({}, S.btn, { fontSize: 12, padding: '2px 7px' }),
                    title: '更多',
                    onClick: () => set菜单在(菜单在 === s.id ? '' : s.id),
                  },
                  '⋯',
                ),
                菜单在 === s.id
                  ? React.createElement(
                      'div',
                      {
                        style: {
                          position: 'absolute',
                          right: 0,
                          top: 'calc(100% + 4px)',
                          zIndex: 70,
                          minWidth: 160,
                          background: 'var(--dsw-alias-bg-layer-1, #fff)',
                          border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28))',
                          borderRadius: 8,
                          boxShadow: '0 8px 24px rgba(0,0,0,.22)',
                          padding: 4,
                        },
                      },
                      React.createElement(
                        'button',
                        {
                          style: { display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', fontSize: 12, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-primary, inherit)', cursor: 'pointer' },
                          onClick: () => {
                            set复制源(s.id)
                            set复制到('')
                            set菜单在('')
                          },
                        },
                        '复制记忆到…',
                      ),
                    )
                  : null,
              ),
            ),
          )
            : null,
          渲染工作区记忆视图({ React, el, S, 选择器, 子页签, 选中区, set选中区, 区表, 工作区记忆, 删工作区记忆, 看回收站, set看回收站, 找回工作区记忆 }),
          ),
          // ⭐ 2026-11-01（用户：「把参数整体搬进高级里」）：参数卡从这里整体搬到「高级」页了，
          //   会话页只留会话列表 + 工作区记忆。notes 是参数保存的提示，跟着一起走。
        )
      }
  return { 会话页 }
}
