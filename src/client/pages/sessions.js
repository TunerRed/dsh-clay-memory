// 会话页 —— 2026-11-11 从 lib/client.js 拆出来（逻辑未改）
// 依赖由正文注入；模块内部自成一体。
import { 造选择器 } from '../components/select.js'

export function 造会话页({ React, el, get, post, B, S, rel, impName, 一次最多画, 进度, 改进度, 补标进度, 洗键进度 }) {
      const 选择器 = 造选择器({ React, el })

      function 会话页(props) {
        const [d, setD] = React.useState(null)
        const [err, setErr] = React.useState(null)
        const [open, setOpen] = React.useState(null) // 打开哪个会话（两级结构 ✓）
        const [notes, setNotes] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [confirm, setConfirm] = React.useState(null) // 正在等确认的删除（二次确认，手滑不了）
        const [showDeleted, setShowDeleted] = React.useState(false)
        const [selfDraft, setSelfDraft] = React.useState({}) // 每个会话「她自己叫什么」的草稿
        const [ownerDraft, setOwnerDraft] = React.useState({}) // 每个会话「怎么称呼对方」的草稿
        const [pronounDraft, setPronounDraft] = React.useState(null) // 用户的称呼草稿
        const [edit, setEdit] = React.useState(null) // 正在改的那条：{id, text, importance}
        const [pronounAsk, setPronounAsk] = React.useState(null) // 改了称呼，问要不要连旧记忆一起改
        const [imp, setImp] = React.useState(null) // 档案导入：扫描结果 + 勾选状态
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
        const [impBusy, setImpBusy] = React.useState(false)
        const [impNote, setImpNote] = React.useState(null)
        // ⭐ 2026-10-28：详情页现在是**四个页签**（记忆 / 称呼 / 导入 / 记录）✓
        //   （这一版把「从旧档案导入」单独成页了，所以 `impOpen` 那个折叠开关没用了
        //     —— 原来点了扫描要 setImpOpen(true) 把它扒开，现在本来就在那一页里）
        const [详情页, set详情页] = React.useState('记忆')
        // 进度放在组件外面（见上面「进度」那段）—— 她切走再回来，进度不该消失 ✓
        const [exp, setExpState] = React.useState(进度.扩词.状态)
        const [expNote, setExpNoteState] = React.useState(进度.扩词.说明)
        const [rf, setRfState] = React.useState(进度.提炼.状态)
        const [rfNote, setRfNoteState] = React.useState(进度.提炼.说明)
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
        const setExp = (v) => 改进度('扩词', v, 进度.扩词.说明)
        const setExpNote = (v) => 改进度('扩词', 进度.扩词.状态, v)
        const setRf = (v) => 改进度('提炼', v, 进度.提炼.说明)
        const setRfNote = (v) => 改进度('提炼', 进度.提炼.状态, v)
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
        const [mdl, setMdl] = React.useState(null) // DSH 里有哪些模型可选
        // ⭐⭐ 2026-09-22（她的第十件）：**从会话导出档案** —— 给别人用的功能
        //   用户导入自己的会话 → 模型读一遍 → 出一份档案 → 再走「从旧档案导入」变成条目
        //   ⚠ 四步分开，因为**第三步调模型、花钱**，得一批一批停下来看 ✓
        const [impDir, setImpDir] = React.useState(null) // 档案目录草稿
        const [impNames, setImpNames] = React.useState(null) // 「指她的名字」草稿
        const [impDirs, setImpDirs] = React.useState(null) // 文件夹选择器的列表
        const [找名字, set找名字] = React.useState(null) // 自动找出来的称呼候选
        const [看原文, set看原文] = React.useState({}) // 哪几条在对照「提炼前」的原文
        // ---- 2026-09-21 新加：后台手动加一条记忆 ----
        const [加内容, set加内容] = React.useState('')
        const [加时间, set加时间] = React.useState('') // 留空 = 现在
        const [加重要, set加重要] = React.useState('0.5') // 三档是快捷，也能自己填
        const [加词, set加词] = React.useState('') // 关键词，空格分开
        const [加在谁, set加在谁] = React.useState('') // 加到哪个会话（默认第一个开着的，没有就第一个）
        const [加结果, set加结果] = React.useState(null) // { ok, 文字 }
        const [加展开, set加展开] = React.useState(false)
  
        // 「指她的名字」那一格：读出来、点一下加/减 ✓
        const 名字串 = () => (impNames !== null ? impNames : (imp.data && imp.data.用户名字 ? imp.data.用户名字 : []).join(','))
        const 名字们 = () => 名字串().split(/[,，]/).map((x) => x.trim()).filter(Boolean)
        const 已选名字 = (n) => 名字们().indexOf(n) >= 0
        const 点名字 = (n) => {
          const 有 = 名字们()
          const i = 有.indexOf(n)
          if (i >= 0) 有.splice(i, 1)
          else 有.push(n)
          setImpNames(有.join(','))
        }
        // 「这个不是名字」—— 昵称、旧事里的称呼…… 标了就存起来，以后不再出现、也不会被换掉 ✓
        const 标掉名字 = (n) => {
          const 现有 = 找名字 && Array.isArray(找名字.不是名字) ? 找名字.不是名字.slice() : []
          if (现有.indexOf(n) < 0) 现有.push(n)
          post('/names', { notNames: 现有 })
            .then(() => post('/names/scan', { session: open, dir: 现在目录 }))
            .then((r) => {
              set找名字(r)
              const 剩 = 名字们().filter((x) => x !== n)
              setImpNames(剩.join(','))
            })
            .catch((e) => setExpNote('标不了：' + String((e && e.message) || e)))
        }
  
        // 一个候选名字块：点名字=加/减，点 ✕ = 标成「不是名字」✓
        const 一个名字块 = (x, 淡) =>
          React.createElement(
            'span',
            {
              key: x.name,
              style: Object.assign({}, S.btn, {
                cursor: 'pointer',
                opacity: 淡 ? 0.7 : 1,
                color: 已选名字(x.name) ? '#8fd0a0' : 'inherit',
              }),
            },
            React.createElement('span', { onClick: () => 点名字(x.name) }, (已选名字(x.name) ? '✓ ' : '') + x.name + ' ' + x.n),
            React.createElement(
              'span',
              {
                style: Object.assign({}, S.dim, { marginLeft: 5, cursor: 'pointer' }),
                title: '不是名字（昵称、旧事里的称呼…）—— 标了就再也不出现，也不会被换掉',
                onClick: (e) => {
                  if (e && e.stopPropagation) e.stopPropagation()
                  标掉名字(x.name)
                },
              },
              '✕',
            ),
          )
  
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
  
        // 订阅外面那个「进度」—— 切走再回来也看得到还在跑 ✓
        React.useEffect(() => {
          const 同步 = () => {
            setExpState(进度.扩词.状态)
            setExpNoteState(进度.扩词.说明)
            setRfState(进度.提炼.状态)
            setRfNoteState(进度.提炼.说明)
          }
          进度.订阅.add(同步)
          同步()
          return () => {
            进度.订阅.delete(同步)
          }
        }, [])
  
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
                setExpNote('✓ 退回了 ' + ((r && r.退了) || 0) + ' 条原文')
                load()
              })
              .catch((e) => setExpNote('退不回：' + String((e && e.message) || e)))
          // 把这一份记忆复制到别的会话（新对话没有上下文，测起来最干净）✓
          const 复制过去 = () =>
            post('/copy-to', { session: 复制到, to: open })
              .then((r) => {
                setConfirm(null)
                // ⭐ 1.4.0：事实已经全局了，这边只拷事件 —— 提示也跟着改口径
                setExpNote(r && r.ok ? '✓ 复制了 ' + r.复制了 + ' 条事件过去（事实本来就是全局的，不用复制），那边开关也开了' : '✗ ' + ((r && r.message) || '？'))
                load()
              })
              .catch((e) => setExpNote('✗ ' + String((e && e.message) || e)))
  
          // 二次确认条（点「删」之后才出现，手滑不了）
          const 确认条 = (text, okLabel, action, id) =>
            React.createElement(
              'div',
              { style: S.confirm },
              React.createElement('span', { style: { flex: 1, minWidth: 0, overflowWrap: 'anywhere' } }, text),
              React.createElement('button', { style: S.btnDanger, onClick: () => 删(id, action) }, okLabel),
              React.createElement('button', { style: S.btn, onClick: () => setConfirm(null) }, '算了'),
            )
  
          // 一条记忆当前落在哪层（给编辑框的层级下拉用）✓
          const 算层级 = (mm) => {
            const s = String((mm && mm.scope) || '')
            if (s === 'global' || (!s && mm && mm.category === 'stable_profile')) return 'global'
            if ((mm && mm.category === 'workspace') || s.indexOf('workspace:') === 0) return 'workspace'
            return 'session'
          }
  
          // 改一条：文本框 + 重要度 + 层级 + 存 / 算了
          const 改一条 = (m) =>
            React.createElement(
              'div',
              { style: S.editBox },
              React.createElement('textarea', {
                style: S.area,
                rows: 3,
                value: edit.text,
                onChange: (e) => setEdit(Object.assign({}, edit, { text: e.target.value })),
              }),
              React.createElement(
                'div',
                { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 } },
                React.createElement('span', { style: S.dim }, '重要度'),
                React.createElement(选择器, {
                  style: S.inp,
                  值: String(edit.importance),
                  选项: [
                    { v: '0', t: '随口提过' },
                    { v: '0.5', t: '比较重要' },
                    { v: '1', t: '非常重要（会变成「一直」记得）' },
                  ],
                  onChange: (v) => setEdit(Object.assign({}, edit, { importance: Number(v) })),
                }),
                React.createElement('span', { style: S.dim }, '层级'),
                React.createElement(选择器, {
                  style: S.inp,
                  值: edit.层级 || 'global',
                  选项: [
                    { v: 'global', t: '全局记忆' },
                    { v: 'workspace', t: '工作区' },
                    { v: 'session', t: '本会话' },
                  ],
                  onChange: (v) => setEdit(Object.assign({}, edit, { 层级: v })),
                }),
                React.createElement('span', { style: Object.assign({}, S.dim, { flex: 1, fontSize: 12 }) }, '改之前会自动备份 ✓'),
                React.createElement(
                  'button',
                  {
                    style: S.btn,
                    disabled: !String(edit.text || '').trim(),
                    onClick: () =>
                      post('/edit', { session: open, id: m.id, text: edit.text, importance: edit.importance, scope: edit.层级 }).then(() => {
                        setEdit(null)
                        load()
                      }),
                  },
                  '保存修改',
                ),
                React.createElement('button', { style: S.btn, onClick: () => setEdit(null) }, '算了'),
              ),
            )
  
          const 一条记忆 = (m) =>
            React.createElement(
              'div',
              // ⚠ 分隔线画在**整条**上（不是里面那个「行」）——
              //   这样下面那几行小字（能搜到它的词 / 讲的是）算在**这一条**里 ✓
              { key: m.id, style: S.条 },
              React.createElement(
                'div',
                { style: S.row },
                // ⭐ 2026-09-22（她要的批量删除）：行首一个勾选框
                React.createElement('input', {
                  type: 'checkbox',
                  checked: !!选中[m.id],
                  title: '勾上它，再点上面的「批量删」',
                  onChange: () => set选中(Object.assign({}, 选中, { [m.id]: !选中[m.id] })),
                }),
                React.createElement('div', { style: Object.assign({}, S.dim, { width: 96, flex: 'none' }) }, rel(m.at, now)),
                React.createElement(
                  // ⚠⚠ 正文这一格给个**下限**（flexBasis 260 / minWidth 200）✗
                  //   光有 flex:1 是不够的：它允许被压到 0，右边牌子一多就成竖条。
                  //   有了下限 + 上面那条 flexWrap，装不下时是**牌子换行**，不是正文变窄 ✓
                  'div',
                  { style: { flex: '1 1 260px', minWidth: 200, overflowWrap: 'anywhere', wordBreak: 'break-word' } },
                  m.已被取代
                    ? React.createElement(
                        'span',
                        {
                          style: Object.assign({}, S.dim, { textDecoration: 'line-through', opacity: 0.62 }),
                          title: '这条已被取代（' + (m.已被取代.为什么 || '') + '）—— 不再被想起来，东西还留着',
                        },
                        m.text,
                      )
                    : m.text,
                ),
                // ⭐⭐ 2026-09-23（反馈「过期条目没标作废」）：
                //   标了「已被取代」的，行里直接挂一个「已被取代」的牌子 + 一个撤销口 ✓
                m.已被取代
                  ? React.createElement(
                      'div',
                      {
                        style: { flex: 'none', fontSize: 11, marginRight: 10, padding: '1px 6px', borderRadius: 8, background: 'rgba(224,176,112,.18)', color: '#e0b070', whiteSpace: 'nowrap' },
                        title: (m.已被取代.为什么 || '') + '（' + rel(m.已被取代.作废于, now) + '）—— 它不再被注入，但东西还在',
                      },
                      '已被取代',
                    )
                  : null,
                m.已被取代
                  ? React.createElement(
                      'div',
                      {
                        style: Object.assign({}, S.link, { flex: 'none', fontSize: 12, marginRight: 10 }),
                        title: '撤销「已被取代」—— 它又能被想起来了（标错了 / 状态又变回来了）',
                        onClick: () => 撤销作废(m.id),
                      },
                      '恢复',
                    )
                  : null,
                // ⭐⭐ 2026-09-23：**事实键** —— ⚠ 不挂在行里，改挂到下面那行小字 ✓
                //   行里每多一个固定宽的牌子，正文就被挤窄一分；
                //   键本来就是「附注」性质，跟「能搜到它的词」放一起正合适（见下面那条）
                React.createElement(
                  'div',
                  { style: Object.assign({}, S.dim, { width: 58, flex: 'none', fontSize: 12 }), title: '鲜活度：越近就越鲜活，只影响排序。长期事实本来就不淡；没记时间的不知道是什么时候的事' },
                  // ⭐⭐ 2026-09-22（反馈：「没标时间的还是鲜活 100%」）：
                  //   光显示百分比会骗人 —— 长期事实本来就不淡，写「100%」像在说「刚发生」✗
                  //   → 长期事实写「**不淡**」✓
                  //   ⭐ 2026-09-22 再改（发现流水账来问）：**没记时间的也会淡了**
                  //     （从「记下来的那天」开始算）→ 它们照常显示百分比 ✓
                  //     （原来显示「没记时间」，那是我上一版判错了 —— 它们并不是不淡）
                  m.freshKind === 'fact' ? '不淡'
                    : typeof m.activation === 'number' && isFinite(m.activation) ? '鲜活 ' + Math.round(m.activation * 100) + '%' : '—',
                ),
                React.createElement('div', { style: Object.assign({}, S.dim, { width: 62, flex: 'none' }) }, impName(m.importance)),
                m.textBefore
                  ? React.createElement(
                      'div',
                      {
                        style: Object.assign({}, S.link, { flex: 'none', fontSize: 12, marginRight: 10 }),
                        title: '看看提炼之前长什么样',
                        onClick: () => set看原文(Object.assign({}, 看原文, { [m.id]: !看原文[m.id] })),
                      },
                      看原文[m.id] ? '收起' : '原文',
                    )
                  : null,
                m.textBefore
                  ? React.createElement(
                      'div',
                      {
                        style: Object.assign({}, S.link, { flex: 'none', fontSize: 12, marginRight: 10, color: '#e0b070' }),
                        title: '把这条退回提炼前的原文（退回后可以再提炼一遍）',
                        onClick: () => setConfirm({ id: m.id, kind: 'refineundo' }),
                      },
                      '退回',
                    )
                  : null,
                React.createElement(
                  'div',
                  { style: Object.assign({}, S.link, { flex: 'none', fontSize: 12, marginRight: 10 }), onClick: () => setEdit({ id: m.id, text: m.text, importance: typeof m.importance === 'number' ? m.importance : 0.5, 层级: 算层级(m) }) },
                  '改',
                ),
                React.createElement(
                  'div',
                  {
                    style: Object.assign({}, S.link, { flex: 'none', fontSize: 12 }),
                    // ⭐ 1.4.0：事实删的是**全局**那份 —— 鼠标悬停先提醒一句
                    title: 是事实(m) ? '这是全局事实 —— 删了所有会话都会忘（会再问一遍）' : undefined,
                    onClick: () => setConfirm({ id: m.id, kind: 'delete' }),
                  },
                  '删',
                ),
              ),
              edit && edit.id === m.id ? 改一条(m) : null,
              confirm && confirm.id === m.id && confirm.kind === 'refineundo'
                ? React.createElement(
                    'div',
                    { style: S.confirm },
                    React.createElement('span', { style: { flex: 1 } }, '把这条退回提炼前的原文？退回后它会变回「还没提炼」。'),
                    React.createElement('button', { style: S.btn, onClick: () => 退原文(m.id) }, '退回'),
                    React.createElement('button', { style: S.btn, onClick: () => setConfirm(null) }, '算了'),
                  )
                : null,
              m.textBefore && 看原文[m.id]
                ? React.createElement(
                    'div',
                    {
                      style: Object.assign({}, S.dim, {
                        margin: '0 0 6px 104px',
                        fontSize: 12,
                        whiteSpace: 'pre-wrap',
                        // ⚠ pre-wrap 只在空格/换行处断，长串（网址、长英文）照样横向撑破面板 —— 得补这两条
                        overflowWrap: 'anywhere',
                        wordBreak: 'break-word',
                        borderLeft: '2px solid rgba(224,176,112,.5)',
                        paddingLeft: 8,
                      }),
                    },
                    '提炼前：' + m.textBefore,
                  )
                : null,
              m.related && m.related.length
                ? React.createElement(
                    'div',
                    { style: Object.assign({}, S.dim, { margin: '0 0 6px 104px', fontSize: 11, overflowWrap: 'anywhere', wordBreak: 'break-word' }) },
                    '能搜到它的词：' + m.related.join(' '),
                  )
                : null,
              // ⭐⭐ 2026-09-23：**「这条讲的是哪件事」** —— 挂在这儿（第二行小字），不占行里的宽度 ✓
              //   ⚠⚠ 别用「事实键」这种我自己造的词 ——
              //     她说了「让人看不懂，写通俗一点的」✗
              m.事实键
                ? React.createElement(
                    'div',
                    { style: { margin: '0 0 6px 104px', fontSize: 11, overflowWrap: 'anywhere', wordBreak: 'break-word' } },
                    React.createElement('span', { style: S.dim }, '讲的是：'),
                    React.createElement(
                      'span',
                      {
                        style: { padding: '1px 6px', borderRadius: 8, background: 'rgba(120,170,220,.16)', color: '#7aaadc', whiteSpace: 'nowrap' },
                        title:
                          '这条讲的是「' + m.事实键 + '」这件事。' +
                          '讲同一件事的记忆只留最新那条 —— 旧的收起来了（还能恢复）',
                      },
                      m.事实键,
                    ),
                  )
                : null,
              // ⭐⭐ 1.4.0（需求②）：**删掉一条长期事实 = 全局生效** —— 会话 A 删了，
              //   会话 B、C、别的工区下一轮全都想不起来它。所以事实要**多问一遍**：
              //     点「删」→ ① 说明「这是全局事实，所有会话都会忘」→ ② 再点一次才真删 ✓
              //   事件照旧一步（它只属于这个会话，删了不影响别人）✓
              confirm && confirm.id === m.id && confirm.kind === 'delete'
                ? 是事实(m) && confirm.step !== 2
                  ? React.createElement(
                      'div',
                      { style: S.confirm },
                      React.createElement(
                        'span',
                        { style: { flex: 1, minWidth: 0, overflowWrap: 'anywhere' } },
                        '⚠ 这是「全局事实」—— 收起来以后，所有会话都会忘掉它（不只是当前这个对话）。真的要动它？',
                      ),
                      React.createElement(
                        'button',
                        { style: S.btnDanger, onClick: () => setConfirm({ id: m.id, kind: 'delete', step: 2 }) },
                        '我明白，继续',
                      ),
                      React.createElement('button', { style: S.btn, onClick: () => setConfirm(null) }, '算了'),
                    )
                  : 确认条('把这条收起来？它会进「已删掉的」，还能找回来。', '收起来', 'delete', m.id)
                : null,
            )
  
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
          const 补日期 = () => {
            setConfirm(null)
            setBusy(true)
            post('/backfill-dates', { session: s.id })
              .then((r) => {
                setBusy(false)
                setNotes([
                  r && r.补了
                    ? '补了 ' + r.补了 + ' 条日期' + (r.猜的 ? '（其中 ' + r.猜的 + ' 条年份是按最近的算的）' : '') + '，还有 ' + r.还是没 + ' 条正文里真没写日期'
                    : '没有能补的 —— 正文里找不到日期',
                ])
                load()
              })
              .catch((e) => {
                setBusy(false)
                setNotes(['补日期失败：' + ((e && e.message) || e)])
              })
          }
  
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
          const 补不淡 = (重判) => {
            setConfirm(null)
            setBusy(true)
            let 累计判 = 0
            let 累计升 = 0
            let 累计降 = 0
            let 连着失败 = 0
            let 连着空 = 0
            let 头一趟 = true
            补标进度.在跑 = true
            补标进度.重判 = !!重判
            补标进度.已 = 0
            补标进度.总 = (s.memories || []).length
            补标进度.等 = 0
            const 跑 = () => {
              // ⚠ 重判：只在**第一趟**带这个参数（服务端会把所有「判过」标记清掉再从头判）
              const 体 = { session: s.id, 每批: 20 }
              if (重判 && 头一趟) 体.重判 = true
              头一趟 = false
              post('/backfill-stable', 体)
                .then((r) => {
                  if (!r || !r.ok) {
                    // ⚠⚠ 2026-09-22（反馈：跑到一半「模型报错：429 status code (no body)」）：
                    //   限流是**暂时的**，不该直接放弃 —— 等一等再试同一批 ✓
                    //   指数退避：5s → 10s → 20s → 40s → 60s，最多 6 次
                    const 是限流 = /429|rate.?limit|too many|限流|超限/i.test(String((r && r.message) || ''))
                    if (是限流 && 连着失败 < 6) {
                      连着失败++
                      const 等 = Math.min(60000, 5000 * Math.pow(2, 连着失败 - 1))
                      补标进度.等 = Math.round(等 / 1000)
                      setNotes([
                        '⚠ 模型那边限流了（429），等 ' + Math.round(等 / 1000) + ' 秒再试…（第 ' + 连着失败 + ' 次）',
                        '已经判好的都存下来了，不用重头来 ✓',
                      ])
                      setTimeout(跑, 等)
                      return
                    }
                    补标进度.在跑 = false
                    setBusy(false)
                    setNotes([
                      '补标失败：' + ((r && r.message) || '？'),
                      '已经判好的都存下来了 —— 再点一次会接着跑，不会重头来 ✓',
                    ])
                    return
                  }
                  连着失败 = 0
                  补标进度.等 = 0
                  累计判 += r.判了 || 0
                  累计升 += r.改成不淡 || 0
                  累计降 += r.降成会淡 || 0
                  补标进度.已 = 累计判
                  if (r.共) 补标进度.总 = r.共
                  // ⚠⚠ 2026-09-22 修（反馈「他就卡着判着呢」）：
                  //   原来这里判「完了没」用的是 `判了 > 0` ——
                  //   **一批回 0 条（模型没回东西）就被当成「判完了」直接停** ✗
                  //   日志实锤：07:09:21「判了 0 条，还剩 665」之后就没动静了
                  //   → 改成看**服务端的 done**；一批回 0 就**接着试下一批** ✓
                  //     连着 3 批都空才停（说明模型那边真出问题了），并说清楚
                  连着空 = (r.判了 || 0) === 0 ? 连着空 + 1 : 0
                  setNotes([
                    '正在判… 已判 ' + 累计判 + ' 条：' + 累计升 + ' 条标成「永远不淡」、' +
                      累计降 + ' 条改成会淡' + (r.done ? '' : '，还剩 ' + r.剩 + ' 条') +
                      (r.判了 === 0 && !r.done ? '　（这批模型没回东西，再试一批）' : ''),
                  ])
                  // ⚠ 每批之间**慢一点** —— 300ms 太急，容易撞限流（反馈就是 429 挂的）
                  if (!r.done) {
                    if (连着空 >= 3) {
                      补标进度.在跑 = false
                      setBusy(false)
                      setNotes([
                        '⚠ 连着 3 批模型都没回东西，先停了（还剩 ' + r.剩 + ' 条）。',
                        '已经判好的都存下来了 —— 再点一次会接着跑，不会重头来 ✓',
                      ])
                      return
                    }
                    setTimeout(跑, 1500)
                  } else {
                    补标进度.在跑 = false
                    setBusy(false)
                    setNotes([
                      '✓ 判完了：看了 ' + 累计判 + ' 条 —— ' + 累计升 + ' 条标成「永远不淡」，' +
                        累计降 + ' 条从「永远不淡」改成会淡',
                      '（这一趟把所有还没判过的都过了一遍：该升的升、该降的降）',
                    ])
                    load()
                  }
                })
                .catch((e) => {
                  补标进度.在跑 = false
                  setBusy(false)
                  setNotes(['补标失败：' + ((e && e.message) || e), '已经判好的都存下来了 —— 再点一次会接着跑 ✓'])
                })
            }
            跑()
          }
  
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
          const 洗键 = (干跑) => {
            setConfirm(null)
            setBusy(true)
            let 累计洗 = 0
            let 累计给 = 0
            let 累计空 = 0
            let 累计废 = 0
            let 连着失败 = 0
            let 连着空 = 0
            洗键进度.在跑 = true
            洗键进度.干跑 = !!干跑
            洗键进度.已 = 0
            洗键进度.总 = 没键的
            const 跑 = () => {
              // ⚠ 干跑：只跑**一批**就停 —— 让她看几个例子再决定，
              //   不许拿几百次模型调用去"试" ✗
              const 体 = { session: s.id, 每批: 8, 干跑: !!干跑 }
              post('/wash-keys', 体)
                .then((r) => {
                  if (!r || !r.ok) {
                    const 是限流 = /429|rate.?limit|too many|限流|超限/i.test(String((r && r.message) || ''))
                    if (是限流 && 连着失败 < 6) {
                      连着失败++
                      const 等 = Math.min(60000, 5000 * Math.pow(2, 连着失败 - 1))
                      setNotes([
                        '⚠ 模型那边限流了（429），等 ' + Math.round(等 / 1000) + ' 秒再试…（第 ' + 连着失败 + ' 次）',
                        '已经补好的都存下来了，不用重头来 ✓',
                      ])
                      setTimeout(跑, 等)
                      return
                    }
                    洗键进度.在跑 = false
                    setBusy(false)
                    setNotes([
                      '清洗失败：' + ((r && r.message) || '？'),
                      '已经补好的都存下来了 —— 再点一次会接着跑，不会重头来 ✓',
                    ])
                    return
                  }
                  连着失败 = 0
                  累计洗 += r.洗了 || 0
                  累计给 += r.给了键 || 0
                  累计空 += r.留空 || 0
                  累计废 += r.作废了 || 0
                  洗键进度.已 = 累计洗
                  if (r.总数) 洗键进度.总 = 没键的
                  // ⚠⚠ 「模型整批没回出东西」才算失败，**不许拿「给了键 === 0」当信号** ✗
                  //   模型正常地把一批全判成留空时，给了键也是 0 ——
                  //   原来按那个数，连着 3 批就误报「模型没回出键」停下来（实测踩到过）
                  连着空 = (r.没回出东西 || 0) >= (r.洗了 || 0) ? 连着空 + 1 : 0
                  if (干跑) {
                    // 干跑：把几个例子摆出来，让她看一眼标得对不对 ✓
                    洗键进度.在跑 = false
                    setBusy(false)
                    const 例 = (r.示例 || []).map((x) => '　「' + x.键 + '」　←　' + x.正文)
                    setNotes(
                      [
                        '先试了 ' + (r.洗了 || 0) + ' 条（一个字都没改）：标了 ' + (r.给了键 || 0) + ' 条、说不用标 ' + (r.留空 || 0) + ' 条',
                        '它标出来是这样的（左边是「这条讲的是哪件事」，右边是记忆本身）：',
                      ]
                        .concat(例.length ? 例 : ['　（这批它都说不用标）'])
                        .concat(['', '看着行就点「全部开始」；不行就先别动 —— 这一步不做也不影响别的 ✓']),
                    )
                    return
                  }
                  setNotes([
                    '正在认… 已过 ' + 累计洗 + ' 条：标了 ' + 累计给 + ' 条、说不用标 ' + 累计空 + ' 条' +
                      (累计废 ? '、顺手收起来 ' + 累计废 + ' 条' : '') +
                      (r.done ? '' : '，还剩 ' + r.剩 + ' 条'),
                  ])
                  if (!r.done) {
                    if (连着空 >= 3) {
                      洗键进度.在跑 = false
                      setBusy(false)
                      setNotes([
                        '⚠ 连着 3 批模型一个字都没回，先停了（还剩 ' + r.剩 + ' 条）。',
                        '已经标好的都存下来了 —— 再点一次会接着跑 ✓',
                        '（要是它只是说「这批都不用标」，那不算出错、会自己往下走）',
                      ])
                      return
                    }
                    setTimeout(跑, 1500)
                  } else {
                    洗键进度.在跑 = false
                    setBusy(false)
                    setNotes([
                      '✓ 跑完了：过了 ' + 累计洗 + ' 条 —— 标了 ' + 累计给 + ' 条、说不用标 ' + 累计空 + ' 条' +
                        (累计废 ? '，其中 ' + 累计废 + ' 条因为「讲的是同一件事」被收起来了（还留着、能恢复）' : ''),
                      '说不用标的那批一个字都没动 ✓（要退回来就点「撤掉这次标的」）',
                    ])
                    load()
                  }
                })
                .catch((e) => {
                  洗键进度.在跑 = false
                  setBusy(false)
                  setNotes(['跑失败了：' + ((e && e.message) || e), '已经标好的都存下来了 —— 再点一次会接着跑 ✓'])
                })
            }
            跑()
          }
  
          // 整份撤回（把这次自动标的全撤掉、顺手收起来的全放回来）✓
          const 撤销洗键 = () => {
            setConfirm(null)
            setBusy(true)
            post('/wash-keys/undo', { session: s.id })
              .then((r) => {
                setBusy(false)
                if (!r || !r.ok) {
                  setNotes(['撤回失败：' + ((r && r.message) || '？')])
                  return
                }
                setNotes([
                  '✓ 撤完了：撤掉 ' + (r.摘了 || 0) + ' 条自动标的、放回来 ' + (r.恢复 || 0) + ' 条被收起来的',
                  '（你自己填的那些没动 —— 这个按钮只管自动标的）',
                ])
                load()
              })
              .catch((e) => {
                setBusy(false)
                setNotes(['撤回失败：' + ((e && e.message) || e)])
              })
          }
  
          // ⭐ 2026-09-22（反馈「回收站还没有批量删除，就批量清空」）：
          //   「已删掉的」那一栏补一个**批量清掉** ✓
          //   ⚠ 这个是**真销毁**（不是收起来）→ 界面必须问两遍 ✓
          // ⭐⭐ 2026-09-23（反馈：「那这里没有批量找回呀」）：
          //   「已删掉的」原来只有**批量清掉**，想全捞回来只能一条条点「找回来」✗
          //   → 补一个**批量找回**（勾了哪几条就捞哪几条）
          //   ⚠ `只合并` = 只捞「合并掉的」那批 —— 等于**一键撤销整次合并** ✓
          //   ⚠ 这个**不是销毁**，是往回捞，所以不用问两遍；但界面上还是先说一句捞几条
          const 批回 = (会话, 只合并) => {
            const ids = 只合并 ? [] : Object.keys(选中清).filter((k) => 选中清[k])
            if (!只合并 && !ids.length) {
              set批回问(false)
              return
            }
            setBusy(true)
            post('/delete', Object.assign({ session: 会话.id, action: 'restorebatch', ids: ids }, 只合并 ? { 只找回合并掉的: true } : {}))
              .then((r) => {
                setBusy(false)
                set批回问(false)
                if (!r || !r.ok) {
                  setNotes(['批量找回失败：' + ((r && r.message) || '？')])
                  return
                }
                set选中清({})
                setNotes(['✓ ' + r.message + '（「已删」里还剩 ' + r.剩 + ' 条）'])
                load()
              })
              .catch((e) => {
                setBusy(false)
                setNotes(['批量找回失败：' + ((e && e.message) || e)])
              })
          }
          const 批清 = (会话) => {
            const ids = Object.keys(选中清).filter((k) => 选中清[k])
            if (!ids.length) {
              set批清问(false)
              return
            }
            setBusy(true)
            post('/delete', { session: 会话.id, action: 'purgebatch', ids: ids })
              .then((r) => {
                setBusy(false)
                set批清问(false)
                if (!r || !r.ok) {
                  setNotes(['批量清掉失败：' + ((r && r.message) || '？')])
                  return
                }
                set选中清({})
                setNotes(['✓ ' + r.message + '（「已删」里还剩 ' + r.剩 + ' 条）'])
                load()
              })
              .catch((e) => {
                setBusy(false)
                setNotes(['批量清掉失败：' + ((e && e.message) || e)])
              })
          }
  
          // ⭐⭐ 2026-09-22（反馈：「查重我们是不是还没做啊？我怎么没有找到按钮」）：
          //   去重一直有，但都是**自动**的 —— 召回时（注入前只留一条）、导入时。
          //   **库里已经存着的重复没人管** ✗
          //   ⚠ 不能一键全合：「汇总+明细」那种一长一短，合了会丢信息
          //     → 真重复给「一键合」，汇总+明细只列出来让她自己挑 ✓
          const 去查重 = (会话) => {
            setBusy(true)
            // ⚠⚠ 面板在**记忆列表那一块里**（跟「补标不淡」的确认框一样），
            //   列表默认是折叠的 —— 不展开就看不见面板 ✗
            //   → 点查重时**顺手把列表展开** ✓（按钮本身在标题行，永远看得见）
            set看记忆(true)
            post('/duplicates', { session: 会话.id })
              .then((r) => {
                setBusy(false)
                if (!r || !r.ok) {
                  setNotes(['查重失败：' + ((r && r.message) || '？')])
                  return
                }
                const 选 = {}
                const 勾 = {}
                ;(r.组 || []).forEach((g, i) => {
                  // 默认留**最长**的那条 —— 「汇总+明细」时长的信息更全，别默认留短的 ✗
                  选[i] = g.条们.reduce((a, b) => (b.长 > a.长 ? b : a), g.条们[0]).id
                  // ⭐ 「真重复」默认勾上（合了安全）；「汇总+明细」默认**不勾**（合了会丢信息）✓
                  勾[i] = g.类型 === '真重复'
                })
                set查重(r)
                set查重选(选)
                set查重合(勾)
                set查重开(true)
                if (!(r.组 || []).length) setNotes(['✓ 查过了：没有「几乎一样」的记忆'])
              })
              .catch((e) => {
                setBusy(false)
                setNotes(['查重失败：' + ((e && e.message) || e)])
              })
          }
          // 合掉：每组留一条，其余交给**服务端再验一遍**（不像的会被保住）✓
          //   ⚠⚠ 2026-09-22 修（反馈：「把一些别的对的事实给删了」）：
          //     原来客户端自己算好「删哪些」就发过去，服务端不验 ✗
          //     现在发的是「组」（留哪条、删哪些），**服务端自己再算一遍相似度** ✓
          const 合重复 = (会话, 只合真重复) => {
            if (!查重) return
            const 组们 = []
            ;(查重.组 || []).forEach((g, i) => {
              if (只合真重复 && g.类型 !== '真重复') return
              // ⭐⭐ 2026-09-23：「按我选的合」**只合勾上的组** ——
              //   原来它把每一组都合掉（默认全选中），一点就丢掉 123 条 ✗
              if (!只合真重复 && !查重合[i]) return
              const 留 = 查重选[i] || g.条们[0].id
              const 删 = g.条们.filter((t) => t.id !== 留).map((t) => t.id)
              if (删.length) 组们.push({ 留: 留, 删: 删 })
            })
            if (!组们.length) {
              setNotes([
                只合真重复 ? '这一批里没有「真重复」组' : '一组都没勾（「汇总+明细」默认不勾，要合得先勾上）',
              ])
              return
            }
            setBusy(true)
            post('/duplicates/merge', { session: 会话.id, 组: 组们 })
              .then((r) => {
                setBusy(false)
                if (!r || !r.ok) {
                  setNotes(['合并：' + ((r && r.message) || '？')])
                  return
                }
                const 行 = ['✓ ' + r.message + '（剩下的：' + r.剩 + ' 条）', '合掉的都收在「已删」里，点开能找回来']
                if (r.保住) {
                  行.push('⚠ 有 ' + r.保住 + ' 条不够像、没敢合（保住了）：')
                  ;(r.保住明细 || []).forEach((x) => 行.push('　　' + x.像度 + '  ' + x.text))
                }
                setNotes(行)
                set查重(null)
                set查重开(false)
                load()
              })
              .catch((e) => {
                setBusy(false)
                setNotes(['合并失败：' + ((e && e.message) || e)])
              })
          }
  
          // ⭐⭐ 2026-09-22（她要的）：**批量删** —— 收进「已删」，不是销毁 ✓
          //   「还是需要 2 次确认的」→ 点按钮只出确认条，确认条上再点才删 ✓
          const 批删 = (会话) => {
            const ids = Object.keys(选中).filter((k) => 选中[k])
            if (!ids.length) {
              set批删问(false)
              return
            }
            setBusy(true)
            post('/delete', { session: 会话.id, action: 'batchdelete', ids: ids })
              .then((r) => {
                setBusy(false)
                set批删问(false)
                if (!r || !r.ok) {
                  setNotes(['批量删失败：' + ((r && r.message) || '？')])
                  return
                }
                set选中({})
                setNotes(['✓ ' + r.message + '（剩下的：' + r.剩 + ' 条）', '删掉的都收在「已删」里，点开能找回来'])
                load()
              })
              .catch((e) => {
                setBusy(false)
                setNotes(['批量删失败：' + ((e && e.message) || e)])
              })
          }
  
          // ═══════════════════════════════════════════════════════════
          // ⭐⭐ 2026-09-22（她的第十件）：**从会话导出档案** —— 给别人用的功能
          //
          //   ① 看这个工作区有哪些会话、勾几个
          //   ② 算要切几批、多少字（**不花钱**）
          //   ③ 一批一批跑（⚠ 这一步调模型、花钱）—— 跑完一批就把条目攒起来，
          //      下一批带上「已经记过的」，同一件事不会被收两遍
          //   ④ 存成档案文件 → 再走已有的「从旧档案导入」变成记忆条目
          // ═══════════════════════════════════════════════════════════════
  
          // ---- 用 DSH 自己的模型给记忆扩词 ----
          // 「直接用我们 deepseek 的可不可以」→ 可以 ✓ 插件能调宿主模型，不用外部 key
          const 没扩的 = (s.memories || []).filter((m) => !m.related || !m.related.length).length
          // 要提炼的：档案导入进来的、还没提炼过的 ✓
          const 没提炼的 = (s.memories || []).filter((m) => String(m.source || '').indexOf('档案导入') === 0 && !m.refined).length
          const 扩词区 = () => {
            const 小件 = []
            小件.push(
              React.createElement(
                'div',
                // ⭐ 2026-10-28（用户：「把提炼 / 扩词收进从旧档案导入里面」）：
                //   它原来**单独占一块**，摆在导入上面，看着像跟导入并列的另一件事 ✗
                //   其实它就是导入的**后期加工** → 收进导入这一页，标题让成「② 导完之后再做」，
                //   用轻一档的虚线小标题（S.subH）—— 别再用 S.part 抢层级 ✓
                { key: 'h', style: Object.assign({}, S.secH, S.subH) },
                React.createElement('span', { style: S.secTitle }, '② 导完之后再做：提炼 / 扩词'),
                // ⭐ 1.4.2（用户：「提炼是用于旧档案导入的我就没能看出来」）：
                //   这句范围必须贴在标题上 —— 光在说明里写「导入进来的档案原文」等于没说 ✓
                React.createElement('span', { style: S.secTag }, '后期加工 · 只给「从旧档案导入」的条目'),
              ),
            )
            小件.push(
              React.createElement(
                'div',
                { key: 'd', style: S.dim },
                React.createElement(
                  'div',
                  { style: { marginBottom: 4 } },
                  React.createElement('b', null, '先在上面把那一批导进来，导完再回来点这两个。'),
                  '平时聊天自动记住的话，不用点这里。这两个是给导入进来的老档案补索引、改口吻的，跑一次就完事。',
                ),
                React.createElement('div', null, '两件事不一样，分开的：'),
                React.createElement(
                  'div',
                  { style: { margin: '4px 0 0 8px' } },
                  React.createElement('b', null, '① 扩词'),
                  '：给每条记忆加一批「以后可能搜到它的词」，比如「她的衣服是蓝色的」加上「颜色 蓝色 衣着 穿搭」。' +
                    '这样问「她喜欢什么颜色」也能捞到它。不改记忆本身，只是加索引。',
                ),
                React.createElement(
                  'div',
                  { style: { margin: '4px 0 0 8px' } },
                  React.createElement('b', null, '② 提炼'),
                  '：把导入进来的档案原文改写成「一条第一人称的记忆」。' +
                    '比如「- 极致温柔：他会第一时间接住她的情绪」→「我会第一时间接住她的情绪」。' +
                    '会改记忆本身（原文留在底里，能对照）。',
                ),
                React.createElement(
                  'div',
                  { style: { margin: '4px 0 0 8px' } },
                  '两个都在后台跑一次就行；跑完之后每轮对话不再调用模型，所以不卡、不额外花钱。',
                ),
              ),
            )
  
            // ---- 选模型 ----
            const 当前 = mdl && mdl.选中的 ? mdl.选中的 : (mdl && mdl.默认) || null
            const 当前串 = 当前 ? 当前.provider + ' / ' + 当前.model : '（还没读到）'
            小件.push(
              React.createElement(
                'div',
                { key: 'pick', style: S.nameBox },
                React.createElement('div', { style: { flex: 'none', width: 100 } }, '用哪个模型'),
                mdl
                  ? React.createElement(选择器, {
                      style: Object.assign({}, S.inp, { width: 300 }),
                      minWidth: 300,
                      值: 当前 ? 当前.provider + '|' + 当前.model : '',
                      选项: [
                        { v: '', t: '（用会话自己的：' + (mdl.默认 ? mdl.默认.provider + '/' + mdl.默认.model : '？') + '）' },
                      ].concat(
                        (mdl.providers || []).flatMap((p) =>
                          (p.models || []).map((m) => ({ v: p.id + '|' + m.id, t: m.name + '　（' + p.id + '）' })),
                        ),
                      ),
                      onChange: (v) => {
                        const i = String(v || '').indexOf('|')
                        const 选 = i > 0 ? { provider: v.slice(0, i), model: v.slice(i + 1) } : null
                        post('/names', { llmModel: 选 }).then(() => {
                          setMdl(Object.assign({}, mdl, { 选中的: 选 }))
                          setExpNote(选 ? '以后就用 ' + 选.provider + ' / ' + 选.model + ' ✓' : '改回用会话自己的模型 ✓')
                        })
                      },
                    })
                  : React.createElement('span', { style: S.dim }, '点右边「读一下有哪些模型」'),
                React.createElement(
                  'button',
                  {
                    style: S.btn,
                    onClick: () => {
                      setExpNote('读着呢…')
                      post('/models', { session: open })
                        .then((r) => {
                          setMdl(r)
                          setExpNote(
                            r && r.ok
                              ? 'DSH 里有 ' + (r.providers || []).length + ' 个 provider，共 ' +
                                (r.providers || []).reduce((a, p) => a + (p.models || []).length, 0) + ' 个模型。现在用：' + 当前串
                              : '✗ ' + ((r && r.message) || '？'),
                          )
                        })
                        .catch((e) => setExpNote('✗ ' + String((e && e.message) || e)))
                    },
                  },
                  '读一下有哪些模型',
                ),
              ),
            )
  
            // ⚠⚠⚠ 2026-09-22（她的反馈，原话）：
            //   「他那个就是重判的进度条跟那个提炼的是在一起呀。我发现我得往下翻
            //     才能看到进度条，那就不对呀。重判应该有个单独的进度条吧？如果你
            //     点了的话，它就会弹出来；如果没点，它就没有。」
            //   她说得对 —— 补标/重判的进度条原来**跟「模型与扩词」「提炼」挤在
            //   同一张卡里**，点了重判得往上翻才看得见，没点的人还会以为那条是
            //   自己点出来的 ✗
            //   → 搬走：谁点的，进度条就跟在谁的按钮旁边（下面那个按钮行里）✓
            // ---- 进度条 ----
            if (exp && exp.总) {
              const 已 = Math.max(0, exp.总 - exp.剩)
              const 百 = exp.总 ? Math.round((已 / exp.总) * 100) : 0
              小件.push(
                React.createElement(
                  'div',
                  { key: 'bar', style: { margin: '8px 0' } },
                  React.createElement(
                    'div',
                    { style: S.barOut },
                    React.createElement('div', { style: Object.assign({}, S.barIn, { width: 百 + '%' }) }),
                  ),
                  React.createElement(
                    'div',
                    { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 4 }) },
                    (exp.模式 || '扩词') + '：' + 已 + ' / ' + exp.总 + ' 条（' + 百 + '%）' + (exp.剩 ? '　还剩 ' + exp.剩 + ' 条' : '　✓ 完事了'),
                  ),
                ),
              )
            }
            // 提炼的进度条（跟扩词各一条，不互相盖）✓
            if (rf && rf.总) {
              const 已 = Math.max(0, rf.总 - rf.剩)
              const 百 = rf.总 ? Math.round((已 / rf.总) * 100) : 0
              小件.push(
                React.createElement(
                  'div',
                  { key: 'rfbar', style: { margin: '8px 0' } },
                  React.createElement(
                    'div',
                    { style: S.barOut },
                    React.createElement('div', { style: Object.assign({}, S.barIn, { width: 百 + '%' }) }),
                  ),
                  React.createElement(
                    'div',
                    { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 4 }) },
                    '提炼：' + 已 + ' / ' + rf.总 + ' 条（' + 百 + '%）' + (rf.剩 ? '　还剩 ' + rf.剩 + ' 条' : '　✓ 完事了'),
                  ),
                ),
              )
            }
  
            小件.push(
              React.createElement(
                'div',
                { key: 'b', style: { display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' } },
                React.createElement(
                  'button',
                  {
                    style: S.btn,
                    disabled: !!(exp && exp.running),
                    onClick: () => {
                      setExpNote('测着呢…')
                      post('/llm-check', { session: open })
                        .then((r) => {
                          setExpNote(
                            r && r.ok
                              ? '✓ 模型通了（' + r.provider + ' / ' + r.model + '，' + r.ms + 'ms）→ 它回了「' + String(r.text || '').slice(0, 20) + '」'
                              : '✗ 不通：' + ((r && r.message) || '？'),
                          )
                        })
                        .catch((e) => setExpNote('✗ ' + String((e && e.message) || e)))
                    },
                  },
                  '先测一下模型',
                ),
                React.createElement(
                  'button',
                  {
                    style: S.btnDanger,
                    disabled: !!(exp && exp.running) || 没扩的 === 0,
                    onClick: () => {
                      let 累计 = 0
                      let 空批 = 0 // 连着几批一条词都没扩出来
                      let 每批 = 6 // 空批就把批量减半 —— 输入越少、思考越少，越不容易被截断 ✓
                      const 跑 = () => {
                        post('/expand', { session: open, 每批: 每批 })
                          .then((r) => {
                            if (!r || !r.ok) {
                              setExp({ running: false, 累计: 累计, 总: s.memories.length, 剩: r ? r.剩 : 0 })
                              setExpNote('✗ ' + ((r && r.message) || '？'))
                              load()
                              return
                            }
                            累计 += r.改了
                            setExp({ running: !r.done, 累计: 累计, 总: r.总数, 剩: r.剩, 模型: r.provider + '/' + r.model })
                            // ⚠ 一批没扩出词就收手的话，模型偶发抽风会让它看起来「自己取消」✗
                            //   空批就把**批量减半**（输入少 → 思考少 → 不容易被截断），
                            //   连着空三批才停，并说清楚原因
                            if (r.改了 > 0) {
                              空批 = 0
                              每批 = 6
                            } else {
                              空批++
                              每批 = Math.max(1, Math.floor(每批 / 2))
                            }
                            setExpNote(
                              r.改了
                                ? '这批扩了 ' + r.改了 + ' 条，还剩 ' + r.剩 + ' 条（' + r.ms + 'ms/批，' + r.provider + '/' + r.model + '）'
                                : '模型这批没回可用的词（可能思考吃光了预算）—— 下一批缩到 ' + 每批 + ' 条再试（还剩 ' + r.剩 + ' 条）',
                            )
                            if (!r.done && (r.改了 > 0 || 空批 < 3)) setTimeout(跑, 400)
                            else {
                              setExp({ running: false, 累计: 累计, 总: r.总数, 剩: r.剩 })
                              if (空批 >= 3) {
                                setExpNote('连着 ' + 空批 + ' 批模型没回可用的词（缩到 ' + 每批 + ' 条也不行），先停了 —— 过会儿再点一次「开始扩词」')
                              }
                              load()
                            }
                          })
                          .catch((e) => {
                            setExp({ running: false, 累计: 累计, 总: s.memories.length, 剩: 没扩的 })
                            setExpNote('✗ ' + String((e && e.message) || e))
                          })
                      }
                      setExp({ running: true, 累计: 0, 总: s.memories.length, 剩: 没扩的 })
                      setExpNote('开始…')
                      跑()
                    },
                  },
                  exp && exp.running ? '扩着呢…' : '开始扩词',
                ),
                React.createElement('span', { style: S.dim }, '② 扩词：还没扩的 ' + 没扩的 + ' / ' + (s.memories || []).length + ' 条'),
              ),
            )
  
            // ---- 提炼（导入进来的档案原文 → 真正的记忆）----
            小件.push(
              React.createElement(
                'div',
                { key: 'rf', style: { display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 8px', flexWrap: 'wrap' } },
                React.createElement(
                  'button',
                  {
                    style: S.btnDanger,
                    disabled: !!(rf && rf.running) || 没提炼的 === 0,
                    onClick: () => {
                      let 累计 = 0
                      let 跳 = 0
                      let 词 = 0
                      let 日 = 0
                      let 重 = 0
                      let 没解 = 0
                      const 跑 = () => {
                        post('/refine', { session: open, 每批: 6 })
                          .then((r) => {
                            if (!r || !r.ok) {
                              setRf({ running: false, 累计: 累计, 总: s.memories.length, 剩: r ? r.剩 : 0, 模式: '提炼' })
                              setRfNote('✗ ' + ((r && r.message) || '？'))
                              load()
                              return
                            }
                            累计 += r.改了
                            跳 += r.跳过 || 0
                            词 += r.出了词的 || 0
                            日 += r.出了日期的 || 0
                            重 += r.出了重要度 || 0
                            没解 += r.没解析出来 || 0
                            setRf({ running: !r.done, 累计: 累计, 总: 累计 + r.剩, 剩: r.剩, 模式: '提炼' })
                            setRfNote(
                              '这批改写 ' + r.改了 + ' 条、跳过 ' + (r.跳过 || 0) + ' 条，还剩 ' + r.剩 + ' 条（' +
                                r.ms + 'ms/批，' + r.provider + '/' + r.model + '）',
                            )
                            if (!r.done) setTimeout(跑, 400)
                            else {
                              setRf({ running: false, 累计: 累计, 总: 累计, 剩: 0, 模式: '提炼' })
                              // 检索词是提炼顺手出的，所以跑完这趟通常不用再单独跑扩词 ✓
                              setRfNote(
                                '✓ 提炼完了：改写 ' + 累计 + ' 条，跳过 ' + 跳 + ' 条' +
                                  (词 ? '；其中 ' + 词 + ' 条顺手出了检索词，不用再跑扩词了' : '（这批没出检索词，可以再点「② 扩词」补）') +
                                  (日 ? '；' + 日 + ' 条顺手出了日期' : '') +
                                  (重 ? '；' + 重 + ' 条顺手判了重要度' : '') +
                                  (没解 ? '；有 ' + 没解 + ' 条模型没回出东西，点「重跑跳过的」再试一次' : ''),
                              )
                              load()
                            }
                          })
                          .catch((e) => {
                            setRf({ running: false, 累计: 累计, 总: s.memories.length, 剩: 没提炼的, 模式: '提炼' })
                            setRfNote('✗ ' + String((e && e.message) || e))
                          })
                      }
                      setRf({ running: true, 累计: 0, 总: 没提炼的, 剩: 没提炼的, 模式: '提炼' })
                      setRfNote('开始提炼…')
                      跑()
                    },
                  },
                  rf && rf.running ? '提炼着呢…' : '开始提炼',
                ),
                React.createElement('span', { style: S.dim }, '① 提炼：还没提炼的 ' + 没提炼的 + ' 条'),
              ),
            )
            // 提炼改坏了能退回 —— 单条的在下面每条记忆上，这里是整批 ✓
            {
              const 提炼过的 = (s.memories || []).filter((m) => m.textBefore).length
              if (提炼过的 > 0) {
                小件.push(
                  React.createElement(
                    'div',
                    { key: 'undo', style: { margin: '2px 0 6px' } },
                    confirm && confirm.kind === 'refineundoall'
                      ? React.createElement(
                          'div',
                          { style: S.confirm },
                          React.createElement('span', { style: { flex: 1 } }, '把提炼过的 ' + 提炼过的 + ' 条全退回原文？退回后它们会变回「还没提炼」。'),
                          React.createElement('button', { style: S.btn, onClick: () => 退原文('*') }, '全退回'),
                          React.createElement('button', { style: S.btn, onClick: () => setConfirm(null) }, '算了'),
                        )
                      : React.createElement(
                          'button',
                          {
                            style: S.btn,
                            disabled: !!(rf && rf.running),
                            title: '把提炼过的记忆全部退回提炼前的原文',
                            onClick: () => setConfirm({ id: '*', kind: 'refineundoall' }),
                          },
                          '退回全部原文（' + 提炼过的 + ' 条）',
                        ),
                  ),
                )
              }
            }
            // 被「跳过」的（没改写过的）能放回队列重跑 ——
            // 模型偶尔整批回不出东西，那种不该永远躺着 ✓
            {
              const 跳过的 = (s.memories || []).filter((m) => m.refinedSkip && !m.textBefore).length
              if (跳过的 > 0) {
                小件.push(
                  React.createElement(
                    'div',
                    { key: 'retry', style: { margin: '0 0 6px', fontSize: 12 } },
                    React.createElement(
                      'button',
                      {
                        style: S.btn,
                        disabled: !!(rf && rf.running),
                        title: '把「跳过」的那些放回队列，再提炼一遍（模型偶尔会整批回不出东西）',
                        onClick: () =>
                          post('/refine/retry', { session: open })
                            .then((r) => {
                              setRfNote('✓ 放回了 ' + ((r && r.放回) || 0) + ' 条，可以再点「开始提炼」')
                              load()
                            })
                            .catch((e) => setRfNote('放不回：' + String((e && e.message) || e))),
                      },
                      '重跑跳过的（' + 跳过的 + ' 条）',
                    ),
                  ),
                )
              }
            }
            if (expNote) 小件.push(React.createElement('div', { key: 'n', style: Object.assign({}, S.ok, { fontSize: 12, margin: '4px 0' }) }, expNote))
            if (rfNote) 小件.push(React.createElement('div', { key: 'n2', style: Object.assign({}, S.ok, { fontSize: 12, margin: '4px 0' }) }, rfNote))
  
            // ---- 复制事件到别的会话 ----
            // 新开一个空对话把记忆复制过去 —— 那边一点历史都没有，测起来最干净 ✓
            // ⭐ 1.4.0：事实（stable_profile）从这一版起已经是**全局**的了 ——
            //   所有会话都读同一份 `_facts.json`，再复制一遍纯属白干（还会造出重复条目）。
            //   所以这里只剩**事件**要搬：标题、按钮、确认条、结果提示全改成「事件」口径 ✓
            {
              const 别的 = (d.sessions || []).filter((x) => x.id !== open)
              if (别的.length) {
                小件.push(
                  React.createElement(
                    'div',
                    { key: 'copy', style: { marginTop: 14 } },
                    React.createElement(
                      'div',
                      { style: Object.assign({}, S.h, { cursor: 'pointer' }), onClick: () => set复制开(!复制开) },
                      (复制开 ? '▾ ' : '▸ ') + '从其他会话导入事件',
                    ),
                    复制开
                      ? React.createElement(
                          'div',
                          null,
                          React.createElement(
                            'div',
                            { style: Object.assign({}, S.dim, { fontSize: 12, margin: '0 0 4px', overflowWrap: 'anywhere' }) },
                            '事实（长期事实、偏好、约定）本来就是全局的 —— 每个会话都读得到，不用搬。这里只把别的会话的「事件」搬过来。',
                          ),
                          React.createElement(
                            'div',
                            { style: S.nameBox },
                            React.createElement('div', { style: { flex: 'none', width: 76 } }, '从哪个'),
                            React.createElement(选择器, {
                              style: Object.assign({}, S.inp, { flex: 1, width: 'auto', minWidth: 150 }),
                              值: 复制到,
                              选项: [{ v: '', t: '（选一个来源会话）' }].concat(
                                别的.map((x) => ({ v: x.id, t: (x.title || x.id.slice(0, 18)) + '（事件 ' + 数事件(x) + ' 条）' })),
                              ),
                              onChange: (v) => set复制到(v),
                            }),
                            React.createElement(
                              'button',
                              {
                                style: S.btn,
                                disabled: !复制到 || !!(exp && exp.running) || !!(rf && rf.running),
                                onClick: () => setConfirm({ id: '*', kind: 'copyto' }),
                              },
                              '导入过来（' + (复制到 ? 数事件((d.sessions || []).find((x) => x.id === 复制到)) || 0 : 0) + ' 条事件）',
                            ),
                          ),
                          confirm && confirm.kind === 'copyto'
                            ? React.createElement(
                                'div',
                                { style: S.confirm },
                                React.createElement('span', { style: { flex: 1 } }, '把那个会话的 ' + (复制到 ? 数事件((d.sessions || []).find((x) => x.id === 复制到)) || 0 : 0) + ' 条事件搬过来，覆盖当前这个会话？事实是全局的、不用搬；当前会话原来的事件会被换掉（覆盖前会自动备份一份 .bak）。'),
                                React.createElement('button', { style: S.btnDanger, onClick: 复制过去 }, '确认覆盖'),
                                React.createElement('button', { style: S.btn, onClick: () => setConfirm(null) }, '算了'),
                              )
                            : null,
                          React.createElement(
                            'div',
                            { style: Object.assign({}, S.dim, { fontSize: 12 }) },
                            '做法：挑一个聊过话的会话当来源 → 导入过来 → 在当前对话里问她「刚才聊了什么」。答得上来，就说明事件真的搬到了这个会话 ✓（会顺手把当前会话的开关打开）',
                          ),
                        )
                      : null,
                  ),
                )
              }
            }
            return 小件
          }
  
          // ---- 从旧档案导入 ----
          // 原则（照 AAAAGENT 的「导入旧聊天」）：
          //   ① 先扫出候选，挑完再落库 —— 不直接写进库
          //   ② 已遗忘的内容不能因为再导一次就复活
          //   ③ 猜不到日期就 null，绝不编
          const 扫描 = () => {
            setImpBusy(true)
            setImpNote(null)
            post('/import/scan', { session: open })
              .then((r) => {
                setImpBusy(false)
                if (!r || !r.ok) {
                  setImpNote('扫不了：' + ((r && r.message) || '？'))
                  return
                }
                // 默认只勾「记忆卡 / 总档案」这种明显是记忆的 ——
                // 同一个文件夹里还有我自己的工程笔记，那个不能导 ✗
                //
                // ⚠⚠ 2026-09-24 修（反馈：「别人导入会踩什么坑」时发现的）：
                //   原来**只认「记忆卡 / 总档案」两个词** —— 别人的档案叫
                //   `my_memories.md`、`关于我.md`、`profile.txt` → **一个都不勾**，
                //   扫完看着一片空白，很容易以为没扫到 ✗
                //   → 分三层：先认像记忆的名字；一个都没认出来就**勾上有内容的**（排除明显的笔记/说明）；
                //     实在拿不准就全勾上（她还能自己取消）✓
                const 像记忆 = /记忆卡|总档案|记忆|档案|回忆|自传|memory|memoir|profile|about|diary|journal/i
                const 像笔记 = /笔记|notes?|log|readme|说明|索引|目录|index|changelog|todo|草稿|draft|脚本|script/i
                const 文件们 = r.files || []
                const files = {}
                const 第一批 = 文件们.filter((f) => 像记忆.test(f.name))
                if (第一批.length) {
                  for (const f of 文件们) files[f.name] = 像记忆.test(f.name)
                } else {
                  const 第二批 = 文件们.filter((f) => f.候选 > 0 && !像笔记.test(f.name))
                  if (第二批.length) {
                    for (const f of 文件们) files[f.name] = f.候选 > 0 && !像笔记.test(f.name)
                  } else {
                    // 实在认不出来 → 有内容的都勾上，让她自己取消（总比一个都不勾好）
                    for (const f of 文件们) files[f.name] = f.候选 > 0
                  }
                }
                setImp({ data: r, files: files, off: {}, open: {} })
                // ⭐ 2026-10-28：这里原来还 setImpOpen(true) 把「从旧档案导入」扒开 ——
                //   现在它自己就是一页，扫完本来就在眼前 ✓
                // ⭐ 扫到 0 条时把**原因**显示出来 —— 静默的「0 条」最坑人 ✗
                if (r.提示) setImpNote(r.提示)
              })
              .catch((e) => {
                setImpBusy(false)
                setImpNote('扫不了：' + String((e && e.message) || e))
              })
          }
  
          const 选中条目 = () => {
            if (!imp) return []
            return (imp.data.items || []).filter((it) => imp.files[it.file] && imp.off[it.key] !== true)
          }
  
          const 导入 = () => {
            const 要导 = 选中条目()
            if (!要导.length) return
            setImpBusy(true)
            setImpNote(null)
            post('/import/apply', { session: open, items: 要导 })
              .then((r) => {
                setImpBusy(false)
                setImpNote(
                  r && r.ok
                    ? '导进去了 ' + r.added + ' 条' + (r.重复 ? '（跳过重复 ' + r.重复 + ' 条）' : '') + (r.近似 ? '（跳过跟已有的几乎一样的 ' + r.近似 + ' 条）' : '') + (r.删过 ? '（跳过你删过的 ' + r.删过 + ' 条）' : '')
                    : '导不了：' + ((r && r.message) || '？'),
                )
                setImp(null)
                load()
              })
              .catch((e) => {
                setImpBusy(false)
                setImpNote('导不了：' + String((e && e.message) || e))
              })
          }
  
          // ⭐ 1.8.0：导入记录（只读）。导入本身搬去了「高级 → 从档案导入会话」，
          //   这里只回答「这个会话导过哪几批、每批几条、导进来的是什么」+ 撤销整批。
          // ⚠ 必须做成独立组件：这个块只在「打开了某个会话」时才渲染，
          //   如果把 hooks 写在 Section 主体里、又被条件调用，React 会报 #310（hooks 数量不一致）
          function 导入记录页(props) {
            const open = props.open
            const [批们, set批们] = React.useState([])
            const [载中, set载中] = React.useState(false)
            const [展, set展] = React.useState('')
            const [要撤, set要撤] = React.useState('')
            const 拉批 = () => {
              if (!open) return
              set载中(true)
              post('/import/batches', { session: open })
                .then((r) => set批们((r && r.batches) || []))
                .catch(() => set批们([]))
                .finally(() => set载中(false))
            }
            React.useEffect(() => {
              拉批()
            }, [open])
            const 撤 = (batch) => {
              post('/import/undo', { session: open, batch })
                .then(() => {
                  set要撤('')
                  setNotes(['✓ 撤掉了这一批（收在「已删」里，能找回来）'])
                  props.load()
                  拉批()
                })
                .catch(() => setNotes(['✗ 没撤成，看控制台']))
            }
            return React.createElement(
              'div',
              null,
              React.createElement(
                'div',
                { style: S.part },
                React.createElement(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
                  React.createElement('span', { style: { fontSize: 13, fontWeight: 600 } }, '导入记录'),
                  React.createElement('span', { style: Object.assign({}, S.dim, { fontSize: 12 }) }, '这个会话导过哪几批')),
                React.createElement(
                  'div',
                  { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 8 }) },
                  '想导新档案？去「高级 → 从档案导入会话」，选文件、挑这个会话再导。这里只看记录，不导东西。'),
                !批们.length
                  ? React.createElement('div', { style: Object.assign({}, S.dim, { fontSize: 12, padding: '8px 0' }) }, 载中 ? '读着呢…' : '这个会话还没导过档案。')
                  : 批们.map((b) => React.createElement(
                      'div',
                      { key: b.batch, style: { border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))', borderRadius: 8, marginBottom: 8, overflow: 'hidden' } },
                      React.createElement(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.06))' } },
                        React.createElement('span', { style: { flex: 'none', fontSize: 12, fontWeight: 600 } }, b.条数 + ' 条'),
                        React.createElement('span', { style: { flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: b.名 }, b.名),
                        React.createElement('span', { style: Object.assign({}, S.dim, { flex: 'none', fontSize: 11.5 }) }, b.时间 ? new Date(b.时间).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''),
                        React.createElement(
                          'button',
                          { style: Object.assign({}, S.btn, { flex: 'none', fontSize: 11.5, padding: '2px 8px' }), onClick: () => set展(展 === b.batch ? '' : b.batch) },
                          展 === b.batch ? '收起' : '展开',
                        ),
                        React.createElement(
                          'button',
                          { style: Object.assign({}, S.btn, { flex: 'none', fontSize: 11.5, padding: '2px 8px', color: 'var(--dsw-alias-state-error-primary, #d05b5b)' }), onClick: () => set要撤(要撤 === b.batch ? '' : b.batch) },
                          要撤 === b.batch ? '算了' : '撤销这批',
                        ),
                      ),
                      要撤 === b.batch
                        ? React.createElement(
                            'div',
                            { style: { padding: '7px 10px', fontSize: 12, background: 'var(--dsw-alias-bg-layer-2, rgba(212,90,90,.08))' } },
                            '把这一批 ' + b.条数 + ' 条都撤掉？收进「已删」，之后能找回来。',
                            React.createElement('button', { style: Object.assign({}, S.btn, { marginLeft: 8, fontSize: 11.5, padding: '2px 8px' }), onClick: () => 撤(b.batch) }, '确定撤销'),
                          )
                        : null,
                      展 === b.batch
                        ? React.createElement(
                            'div',
                            { style: { maxHeight: 220, overflow: 'auto', padding: '6px 10px' } },
                            b.items.map((it) => React.createElement(
                              'div',
                              { key: it.id, style: { fontSize: 12, padding: '3px 0', borderBottom: '1px dashed var(--dsw-alias-border-l1, rgba(128,128,128,.18))' } },
                              it.text,
                            )),
                            b.items.length >= 300 ? React.createElement('div', { style: Object.assign({}, S.dim, { fontSize: 11.5, paddingTop: 4 }) }, '（只列前 300 条）') : null,
                          )
                        : null,
                    )),
              ),
            )
          }
  
          const 导入区 = () => {
            const 小件 = []
            小件.push(
              React.createElement(
                'div',
                // ⭐ 2026-10-28：这一页就是「从旧档案导入」，标题改成第①步 ——
                //   跟下面收进来的「② 导完之后再做：提炼 / 扩词」连成一条线 ✓
                //   （S.part 的虚线不要了：页签上方已经有分隔，再画一条看着像重复开头）
                { key: 'h', style: S.secH },
                React.createElement('span', { style: S.secTitle }, '① 把旧档案导进来'),
                React.createElement('span', { style: S.secTag }, '把以前写过的设定 / 记忆卡搬进来'),
              ),
            )
            小件.push(
              React.createElement(
                'div',
                { key: 'd', style: S.dim },
                '记忆插件只管「往后」—— 装上之后它才开始自己记。你以前那些日子，得你先归纳一下：' +
                  '把旧对话、日记、设定、备忘，整理成几个文本文件（.md / .txt）放进一个文件夹，' +
                  '这里再把它们拆成一条条记忆 —— 文件夹在下面选，你挑完再导 ✓',
              ),
            )
            小件.push(
              React.createElement(
                'div',
                {
                  key: 'how',
                  style: Object.assign({}, S.dim, {
                    margin: '6px 0 8px',
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: 'rgba(128,128,128,.08)',
                    borderLeft: '2px solid rgba(128,128,128,.35)',
                  }),
                },
                React.createElement('div', { style: { fontWeight: 600 } }, '怎么归纳（一句话：一个文件一个主题，一行一件事）'),
                React.createElement('div', null, '· 分几份写：「我是谁」「重要的人和事」「约定」「时间线」……'),
                React.createElement('div', null, '· 一行写清一件事，别写成一大段流水账 —— 拆起来才准'),
                React.createElement('div', null, '· 有日期就写上；没日期不写也行，它不会瞎猜'),
                React.createElement('div', null, '· 拆完先给你过目，挑中的才进库；导错了能整批撤销'),
                React.createElement('div', null, '· 想更干净，拆完再点「② 提炼」，让模型改写成第一人称'),
              ),
            )
            小件.push(
              React.createElement(
                'div',
                { key: 'b', style: { display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' } },
                React.createElement('button', { style: S.btn, disabled: impBusy, onClick: 扫描 }, impBusy ? '扫着呢…' : '扫描档案'),
                imp ? React.createElement('span', { style: S.dim }, '目录：' + imp.data.dir) : null,
                imp && imp.data.selfName
                  ? React.createElement('span', { style: S.dim }, '（人称：「' + imp.data.selfName + '」→「我」）')
                  : React.createElement('span', { style: S.warn, fontSize: 12 }, '（这个会话还没设「她自己叫什么」，导进去的人称不会自动换 —— 建议先在上面填好）'),
              ),
            )
            // 只导哪些文件 —— 同一个文件夹里常常还堆着别的文档，得能挑 ✓
            if (imp && imp.data && (imp.data.files || []).length) {
              小件.push(
                React.createElement(
                  'div',
                  {
                    key: 'files',
                    style: {
                      margin: '0 0 8px',
                      padding: '6px 10px',
                      borderRadius: 6,
                      background: 'rgba(128,128,128,.08)',
                      border: '1px solid rgba(128,128,128,.2)',
                      fontSize: 12,
                    },
                  },
                  React.createElement('div', { style: S.dim }, '只导这些文件（默认只勾了「记忆卡／总档案」—— 别的文档别导进来）：'),
                  React.createElement(
                    'div',
                    { style: { display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 4 } },
                    (imp.data.files || []).map((f) =>
                      React.createElement(
                        'label',
                        {
                          key: f.name,
                          style: { cursor: 'pointer', display: 'flex', gap: 4, alignItems: 'center', opacity: imp.files[f.name] ? 1 : 0.5 },
                        },
                        React.createElement('input', {
                          type: 'checkbox',
                          checked: !!imp.files[f.name],
                          onChange: (e) =>
                            setImp(Object.assign({}, imp, { files: Object.assign({}, imp.files, { [f.name]: e.target.checked }) })),
                        }),
                        f.name + '（' + f.候选 + ' 条）',
                      ),
                    ),
                  ),
                ),
              )
            }
            if (impNote) 小件.push(React.createElement('div', { key: 'n', style: Object.assign({}, S.ok, { margin: '6px 0' }) }, impNote))
  
            // 导过几批 + 撤销 —— ⚠ 必须在 `if (!imp)` **之前**：
            // 导入完 imp 就清空了，放后面的话撤销按钮根本看不到 ✗
            const 批次 = s.importBatches || []
            if (批次.length) {
              小件.push(
                React.createElement(
                  'div',
                  { key: 'bt', style: { marginTop: 4 } },
                  React.createElement('div', { style: { fontWeight: 600, margin: '8px 0 2px' } }, '导过 ' + 批次.length + ' 批'),
                  批次.map((b) =>
                    React.createElement(
                      'div',
                      { key: b.id, style: Object.assign({}, S.row, S.条) },
                      React.createElement('div', { style: { flex: 1 } }, (b.at ? rel(b.at, Date.now()) : '（不知道什么时候）') + '　' + b.n + ' 条'),
                      React.createElement(
                        'div',
                        {
                          style: Object.assign({}, S.drop, { flex: 'none', fontSize: 12, cursor: 'pointer' }),
                          onClick: () => {
                            setImpBusy(true)
                            post('/import/undo', { session: open, batch: b.id }).then((r) => {
                              setImpBusy(false)
                              setImpNote(
                                r && r.ok
                                  ? '撤销了：收起了 ' + r.撤了 + ' 条（在「已删掉的」里，能一条条找回来）'
                                  : '撤不了：' + ((r && r.message) || '？'),
                              )
                              load()
                            })
                          },
                        },
                        '撤销这次导入',
                      ),
                    ),
                  ),
                ),
              )
            }
  
            // ⭐ 提炼 / 扩词**不依赖扫描结果** —— 它加工的是已经入库的「档案导入」条目，
            //   没扫过、这次没导过也该看得见。所以两条返回路径都带上它（同一时刻只走一条，
            //   key 不会重复）✓
            if (!imp) {
              小件.push(React.createElement('div', { key: 'refine' }, 扩词区()))
              return 小件
            }
  
            // 档案目录（能选也能打）+ 档案里指她的名字
            const 现在目录 = impDir !== null ? impDir : imp.data.dir
            const 列目录 = (p) => {
              post('/dirs', { path: p || '' })
                .then((r) => {
                  setImpDirs(r)
                  if (r && r.ok && r.path) setImpDir(r.path)
                })
                .catch((e) => setExpNote('列不了目录：' + String((e && e.message) || e)))
            }
            // ⚠ 拆成两行、输入框用弹性宽度 ——
            //   原来四个控件挤一行，加起来 880px 撑破了 780px 的容器（放大之后更糟）✗
            小件.push(
              React.createElement(
                'div',
                { key: 'cfg', style: S.nameBox },
                React.createElement('div', { style: { flex: 'none', width: 92 } }, '档案目录'),
                React.createElement('input', {
                  style: Object.assign({}, S.inp, { flex: 1, width: 'auto', minWidth: 130 }),
                  value: 现在目录,
                  onChange: (e) => setImpDir(e.target.value),
                }),
                React.createElement('button', { style: S.btn, onClick: () => 列目录(现在目录) }, '选文件夹'),
              ),
            )
            小件.push(
              React.createElement(
                'div',
                { key: 'cfg2', style: Object.assign({}, S.nameBox, { marginTop: -4 }) },
                React.createElement('div', { style: { flex: 'none', width: 92 } }, '指她的名字'),
                React.createElement('input', {
                  style: Object.assign({}, S.inp, { flex: 1, width: 'auto', minWidth: 130 }),
                  placeholder: '可以不填 —— 或者点右边「自动找」',
                  value: 名字串(),
                  onChange: (e) => setImpNames(e.target.value),
                }),
                React.createElement(
                  'button',
                  {
                    style: S.btn,
                    onClick: () =>
                      post('/names/scan', { session: open, dir: 现在目录 })
                        .then((r) => set找名字(r))
                        .catch((e) => setExpNote('自动找名字失败：' + String((e && e.message) || e))),
                  },
                  '自动找',
                ),
                React.createElement(
                  'button',
                  {
                    style: S.btn,
                    onClick: () =>
                      post('/names', {
                        archiveDir: 现在目录,
                        userNames: 名字们(),
                      }).then(() => {
                        setImpDir(null)
                        setImpNames(null)
                        扫描()
                      }),
                  },
                  '存了重扫',
                ),
              ),
            )
            // 自动找出来的候选 —— 点一下加进上面那格，再点一下减掉 ✓
            if (找名字) {
              小件.push(
                React.createElement(
                  'div',
                  { key: 'names', style: { margin: '0 0 8px', padding: '6px 10px', borderRadius: 6, background: 'rgba(128,128,128,.10)', border: '1px solid rgba(128,128,128,.22)', fontSize: 12 } },
                  找名字.ok === false
                    ? React.createElement('div', { style: S.drop }, '✗ ' + (找名字.message || '找不了'))
                    : React.createElement(
                        'div',
                        null,
                        React.createElement('div', null, '只喊她的 —— 点一下加进去：'),
                        React.createElement(
                          'div',
                          { style: { display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0' } },
                          (找名字.候选 || []).map((x) => 一个名字块(x)),
                        ),
                        (找名字.互称 || []).length
                          ? React.createElement(
                              'div',
                              null,
                              React.createElement('div', { style: Object.assign({}, S.dim, { marginTop: 4 }) }, '互相都叫的 —— 加了会把「' + 找名字.互称[0].name + '」全换成称呼，一般别加：'),
                              React.createElement(
                                'div',
                                { style: { display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0' } },
                                (找名字.互称 || []).map((x) => 一个名字块(x, true)),
                              ),
                            )
                          : null,
                        React.createElement(
                          'div',
                          { style: Object.assign({}, S.dim, { fontSize: 11 }) },
                          '数字是出现次数。底下混着界面词没关系，不点就行。填不填都不影响导入。',
                        ),
                      ),
                ),
              )
            }
            // 现在扫的是哪个目录 —— 用文字再写一遍，不靠输入框 ✓
            小件.push(
              React.createElement(
                'div',
                { key: 'nowdir', style: Object.assign({}, S.dim, { fontSize: 12, margin: '2px 0 6px' }) },
                '现在扫的是：' + imp.data.dir + '　（' + (imp.data.files || []).length + ' 个文件，' + (imp.data.items || []).length + ' 条候选）',
              ),
            )
            // 文件夹选择器
            if (impDirs) {
              小件.push(
                React.createElement(
                  'div',
                  { key: 'dirs', style: { margin: '0 0 8px', padding: '6px 10px', borderRadius: 6, background: 'rgba(128,128,128,.10)', border: '1px solid rgba(128,128,128,.22)', fontSize: 12 } },
                  impDirs.ok === false
                    ? React.createElement('div', { style: S.drop }, '✗ ' + (impDirs.message || '列不了'))
                    : React.createElement(
                        'div',
                        null,
                        React.createElement(
                          'div',
                          { style: Object.assign({}, S.dim, { marginBottom: 4 }) },
                          impDirs.path ? '「' + impDirs.path + '」下的文件夹（点一下就进去）：' : '选一个盘：',
                        ),
                        React.createElement(
                          'div',
                          { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
                          impDirs.parent
                            ? React.createElement('span', { style: S.link, onClick: () => 列目录(impDirs.parent) }, '↑ 上一级')
                            : null,
                          (impDirs.dirs || []).map((d) =>
                            React.createElement('span', { key: d.path, style: S.link, onClick: () => 列目录(d.path) }, '📁 ' + d.name),
                          ),
                          (impDirs.dirs || []).length === 0 && !impDirs.parent
                            ? React.createElement('span', { style: S.dim }, '（这里没有子文件夹）')
                            : null,
                        ),
                        React.createElement(
                          'div',
                          { style: Object.assign({}, S.dim, { marginTop: 4 }) },
                          '看好了就点「存了重扫」✓',
                        ),
                      ),
                ),
              )
            }
  
            // 文件勾选
            小件.push(
              React.createElement(
                'div',
                { key: 'files', style: S.nameBox },
                React.createElement('div', { style: { flex: 'none', width: 100 } }, '扫到这些文件'),
                React.createElement(
                  'div',
                  { style: { flex: 1 } },
                  (imp.data.files || []).map((f) =>
                    React.createElement(
                      'label',
                      { key: f.name, style: { display: 'block', cursor: 'pointer' } },
                      React.createElement('input', {
                        type: 'checkbox',
                        checked: !!imp.files[f.name],
                        onChange: (e) => setImp(Object.assign({}, imp, { files: Object.assign({}, imp.files, { [f.name]: e.target.checked }) })),
                      }),
                      ' ' + f.name + '　' + f.候选 + ' 条',
                      /记忆卡|总档案/.test(f.name) ? null : React.createElement('span', { style: S.dim }, '　（不是她的记忆？自己看着勾）'),
                    ),
                  ),
                ),
              ),
            )
  
            // 按小节分组（只列勾了的文件）
            const 组 = {}
            for (const it of imp.data.items || []) {
              if (!imp.files[it.file]) continue
              const k = it.file + '｜' + (it.section || '（没有小节）')
              if (!组[k]) 组[k] = { file: it.file, section: it.section || '（没有小节）', items: [] }
              组[k].items.push(it)
            }
            const 组们 = Object.keys(组)
            const 选中 = 选中条目()
            const 字数 = 选中.reduce((a, it) => a + String(it.改后 || it.text).length, 0)
  
            小件.push(
              React.createElement(
                'div',
                { key: 'secbar', style: { display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0 4px' } },
                React.createElement('span', { style: { fontWeight: 600 } }, '按小节挑'),
                React.createElement('button', { style: S.btn, onClick: () => setImp(Object.assign({}, imp, { off: {} })) }, '全选'),
                React.createElement(
                  'button',
                  {
                    style: S.btn,
                    onClick: () => {
                      const off = {}
                      for (const it of imp.data.items || []) if (imp.files[it.file] && it.importance < 1) off[it.key] = true
                      setImp(Object.assign({}, imp, { off: off }))
                    },
                  },
                  '只留「一直」记得的',
                ),
                React.createElement(
                  'button',
                  {
                    style: S.btn,
                    onClick: () => {
                      const off = {}
                      for (const it of imp.data.items || []) if (imp.files[it.file]) off[it.key] = true
                      setImp(Object.assign({}, imp, { off: off }))
                    },
                  },
                  '全不选',
                ),
              ),
            )
  
            for (const k of 组们) {
              const g = 组[k]
              const 开 = !!imp.open[k]
              const 选了几条 = g.items.filter((it) => imp.off[it.key] !== true).length
              小件.push(
                React.createElement(
                  'div',
                  { key: 'sec' + k, style: { margin: '2px 0' } },
                  React.createElement(
                    'div',
                    { style: { display: 'flex', gap: 8, alignItems: 'baseline' } },
                    React.createElement(
                      'div',
                      { style: Object.assign({}, S.link, { flex: 1 }), onClick: () => setImp(Object.assign({}, imp, { open: Object.assign({}, imp.open, { [k]: !开 }) })) },
                      (开 ? '▾ ' : '▸ ') + g.section,
                    ),
                    React.createElement('div', { style: Object.assign({}, S.dim, { width: 90, flex: 'none' }) }, 选了几条 + ' / ' + g.items.length + ' 条'),
                    React.createElement(
                      'div',
                      {
                        style: Object.assign({}, S.link, { flex: 'none', fontSize: 12 }),
                        onClick: () => {
                          const 全选这节 = 选了几条 < g.items.length
                          const off = Object.assign({}, imp.off)
                          for (const it of g.items) if (全选这节) delete off[it.key]
                          else off[it.key] = true
                          setImp(Object.assign({}, imp, { off: off }))
                        },
                      },
                      '全选这节',
                    ),
                  ),
                  开
                    ? g.items.map((it) =>
                        React.createElement(
                          'div',
                          { key: it.key, style: { margin: '2px 0 6px 18px', fontSize: 12 } },
                          React.createElement(
                            'label',
                            { style: { cursor: 'pointer' } },
                            React.createElement('input', {
                              type: 'checkbox',
                              checked: imp.off[it.key] !== true,
                              onChange: (e) => setImp(Object.assign({}, imp, { off: Object.assign({}, imp.off, { [it.key]: !e.target.checked }) })),
                            }),
                            ' ',
                            React.createElement('span', { style: Object.assign({}, S.dim, { fontSize: 11 }) }, it.file + ' 第 ' + it.line + ' 行　'),
                            String(it.改后 || it.text),
                            it.at ? React.createElement('span', { style: Object.assign({}, S.ok, { fontSize: 11 }) }, '　[' + it.at.slice(0, 10) + ']') : null,
                            it.改后 && it.改后 !== it.text
                              ? React.createElement('div', { style: Object.assign({}, S.dim, { marginLeft: 18, fontSize: 11 }) }, '原文：' + it.text)
                              : null,
                          ),
                        ),
                      )
                    : null,
                ),
              )
            }
  
            小件.push(
              React.createElement(
                'div',
                { key: 'go', style: Object.assign({}, S.askBox, { marginTop: 10 }) },
                React.createElement('div', { style: { flex: 1 } }, '已选 ' + 选中.length + ' 条，共约 ' + 字数 + ' 字' + (选中.length ? '（一次只注入 6 条，其余在库里等着）' : '')),
                React.createElement('button', { style: S.btnDanger, disabled: impBusy || !选中.length, onClick: 导入 }, impBusy ? '导着呢…' : '导入选中的'),
              ),
            )
            // ⭐ 2026-10-28（用户：「把提炼 / 扩词收进从旧档案导入里面」）：
            //   它原来在详情页里**单独占一块**（排在导入前面）→ 现在收进来，
            //   当导入之后的**后期加工步骤**（②）✓
            // ⚠ 只在上面（`if (!imp)` 那个早退**之前**）push 一次 —— 放这里的话，
            //     没扫描过的会话会在早退处直接 return，这一块永远不出现 ✗
            小件.push(React.createElement('div', { key: 'refine' }, 扩词区()))
            return 小件
          }
  
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
            // ---- 页签② 称呼：原来紧贴 hero 的那张卡，单独一页装它 ----
            React.createElement(
              'div',
              { style: { display: 详情页 === '称呼' ? 'block' : 'none' } },
            React.createElement(
              'div',
              { style: { padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(128,128,128,.22)', background: 'rgba(127,127,127,.05)' } },
              React.createElement(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 } },
                React.createElement('span', { style: { flex: 'none', width: 96, fontSize: 13 } }, '她自己叫什么'),
                React.createElement('input', {
                  style: Object.assign({}, S.inp, { width: 160 }),
                  placeholder: '她在这儿的名字',
                  value: selfDraft[open] !== undefined ? selfDraft[open] : s.selfName || s.titleName || '',
                  onChange: (e) => setSelfDraft(Object.assign({}, selfDraft, { [open]: e.target.value })),
                }),
                s.selfName
                  ? null
                  : (s.titleName ? React.createElement('span', { style: Object.assign({}, S.dim, { fontSize: 12 }) }, '（先填的是会话标题，确认没问题再点「存」）') : null),
              ),
              React.createElement(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 } },
                React.createElement('span', { style: { flex: 'none', width: 96, fontSize: 13 } }, '她怎么称呼你'),
                React.createElement('input', {
                  style: Object.assign({}, S.inp, { width: 160 }),
                  placeholder: '她平时怎么叫你（小名、昵称都行）',
                  value: ownerDraft[open] !== undefined ? ownerDraft[open] : s.ownerName || '',
                  onChange: (e) => setOwnerDraft(Object.assign({}, ownerDraft, { [open]: e.target.value })),
                }),
              ),
              React.createElement(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                React.createElement(
                  'button',
                  {
                    style: S.btn,
                    onClick: () =>
                      post('/names', {
                        session: open,
                        selfName: (selfDraft[open] !== undefined ? selfDraft[open] : s.selfName) || '',
                        ownerName: (ownerDraft[open] !== undefined ? ownerDraft[open] : s.ownerName) || '',
                      }).then(() => {
                        setSelfDraft({})
                        setOwnerDraft({})
                        load()
                      }),
                  },
                  '存',
                ),
                React.createElement(
                  'span',
                  { style: Object.assign({}, S.dim, { fontSize: 12, flex: 1, lineHeight: 1.5 }) },
                  '她自己的名字写进记忆时会换成「我」；她怎么称呼你，会换成「你」。已有的记忆也会顺手洗一遍。',
                ),
              ),
            ),
            ),
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
            // ---- 页签④ 记录：最近一次召回 + 备份怎么留 ----
            React.createElement(
              'div',
              { style: { display: 详情页 === '召回记录' ? 'block' : 'none' } },
            tr
              ? React.createElement(
                  'div',
                  null,
                  React.createElement('div', { style: Object.assign({}, S.h, S.part) }, '最近一次召回'),
                  React.createElement('div', { style: S.dim }, '线索：「' + String(tr.query || '').slice(0, 50) + '」'),
                  (() => {
                    // ⚠ 按分数排再显示 —— 老记录是按**入库顺序**存的，
                    //   直接取前 12 条全是 0 分的老条目，看不出到底挑中了什么 ✗
                    //   （反馈：「这里为什么只有这些，该显示最近标中的」）
                    const 排好 = (tr.rows || []).slice().sort((a, b) => (b.P || 0) - (a.P || 0) || (b.C || 0) - (a.C || 0))
                    const 进去的 = 排好.filter((r) => !r.omission)
                    return React.createElement(
                      'div',
                      null,
                      React.createElement(
                        'div',
                        { style: Object.assign({}, S.dim, { fontSize: 12, margin: '2px 0 4px' }) },
                        进去的.length
                          ? '✓ 挑中并塞进去了 ' + 进去的.length + ' 条（排在最前面）'
                          : '这次一条都没挑中（线索跟记忆对不上）',
                      ),
                      排好.slice(0, 20).map((r, i) => {
                        const mm = s.memories.find((x) => x.id === r.id) || (s.deleted || []).find((x) => x.id === r.id)
                        const why = r.omission
                          ? { hard_gate: '没命中线索', below_threshold: '分数不够', limit: '超过条数上限', budget: '超过字数上限', duplicate: '跟另一条重复', fact_cap: '长期事实占满了名额' }[r.omission] || r.omission
                          : { assembled: '进去了', consumed: '像是用上了', invalidated: '已失效' }[r.status] || '进去了'
                        const 色 = r.omission
                          ? S.drop
                          : r.status === 'consumed'
                            ? S.ok
                            : S.dim
                        return React.createElement(
                          'div',
                          { key: i, style: Object.assign({}, S.row, S.条) },
                          React.createElement(
                            'div',
                            { style: { flex: 1 } },
                            (r.omission ? '　' : '✓ ') + String((mm && mm.text) || r.id).slice(0, 60),
                          ),
                          React.createElement('div', { style: Object.assign({}, S.dim, { width: 54 }) }, 'C ' + r.C),
                          React.createElement('div', { style: Object.assign({}, S.dim, { width: 54 }) }, 'P ' + r.P),
                          React.createElement('div', { style: Object.assign({}, 色, { width: 96 }) }, why + (r.timeHit ? ' ⭐' : '')),
                        )
                      }),
                    )
                  })(),
                  React.createElement(
                    'div',
                    { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 6 }) },
                    '「进去了」= 这一轮塞进提示词了；「像是用上了」= 她回复里的实词跟这条重合得多（这是猜的）；「已失效」= 这条后来被删了或改过。',
                  ),
                )
              : React.createElement(
                  'div',
                  { style: S.dim },
                  '这个会话还没有召回记录 —— 等下一次对话注入之后就有了。',
                ),
            // ⭐ 2026-09-22：说明都放末尾（原来「备份」插在中间，看着像别的区块的标题）
            React.createElement('div', { style: Object.assign({}, S.h, S.part) }, '备份'),
            React.createElement(
              'div',
              { style: S.dim },
              '记忆一变就会自动备份：上一版存在同目录的 .bak，另外每天存一份，留 14 天。' +
                '「补日期」「补标不淡」「改」「删」之前也都会先备一份。',
            ),
            ),          // ← 收住「记录」那一页
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
          // ⭐ 2026-11-01 用户要求：工作区记忆视图 —— 只读列出这个工作区自己记下的项目记忆
          子页签 === '工作区记忆'
            ? React.createElement(
                'div',
                { style: { marginTop: 4 } },
                // 工作区选择器（和会话列表共用同一个选中区，切页签不丢）
                React.createElement(
                  'div',
                  { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', margin: '2px 0 8px' } },
                  el(选择器, {
                    style: Object.assign({}, S.inp, { width: 'auto', minWidth: 170, flex: 'none' }),
                    值: 选中区,
                    选项: (区表 || []).map((w) => ({
                      v: w.id,
                      // ⭐ 2026-11-01 用户要求：这里显示「工作区级记忆」的条数（不是会话数），
                      //   格式和会话列表下拉统一——都只给数字
                      t: (w.name || '工作区') + '（' + (w.记忆数 || 0) + '）',
                    })),
                    onChange: (v) => set选中区(v),
                  }),
                  React.createElement(
                    'span',
                    { style: Object.assign({}, S.dim, { fontSize: 12 }) },
                    '这里只看工作区自己那一层（项目事实/决策），全局事实和会话事件在「会话」页签里',
                  ),
                ),
                工作区记忆 && 工作区记忆.读中
                  ? React.createElement('div', { style: Object.assign({}, S.dim, { fontSize: 12 }) }, '读着…')
                  : 工作区记忆 && 工作区记忆.ok && 工作区记忆.count > 0
                    ? React.createElement(
                        'div',
                        null,
                        React.createElement(
                          'div',
                          { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 6, overflowWrap: 'anywhere' }) },
                          '这个工作区自己的记忆 ' + 工作区记忆.count + ' 条 —— 同一工作区的会话共享，别的工作区看不到。库文件：' + (工作区记忆.file || ''),
                        ),
                        工作区记忆.memories.map((m) =>
                          React.createElement(
                            'div',
                            { key: m.id, style: Object.assign({}, S.row, S.条) },
                            React.createElement('span', { style: { flex: 'none', fontSize: 12, width: 76 } }, '重要 ' + Number(m.importance).toFixed(2)),
                            React.createElement(
                              'span',
                              { style: { flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } },
                              m.text || '（空）',
                            ),
                            React.createElement('span', { style: { flex: 'none', fontSize: 11.5 } }, m.at ? String(m.at).slice(0, 10) : ''),
                            React.createElement(
                              'button',
                              {
                                style: { flex: 'none', fontSize: 11, padding: '2px 8px', cursor: 'pointer', borderRadius: 4, border: '1px solid rgba(248,113,113,.45)', background: 'transparent', color: 'rgb(248,113,113)' },
                                onClick: () => 删工作区记忆(m),
                                title: '收起来（进这个工作区的回收站，能找回来）',
                              },
                              '删',
                            ),
                          ),
                        ),
                      )
                    : React.createElement(
                        'div',
                        { style: Object.assign({}, S.dim, { fontSize: 12, padding: '8px 2px' }) },
                        (工作区记忆 && (工作区记忆.message || (工作区记忆.ok ? '这个工作区还没有项目记忆' : '读不出来'))) || '先选一个工作区',
                      ),
                // ⭐ 2026-11-01 用户问「回收站在哪个地方」：回收站 = 该工作区库文件里的 deleted 数组，
                //   这里列出来能点「找回来」（POST action=restore）。
                工作区记忆 && 工作区记忆.ok && Array.isArray(工作区记忆.回收站) && 工作区记忆.回收站.length
                  ? React.createElement(
                      'div',
                      { style: { marginTop: 12 } },
                      React.createElement(
                        'div',
                        {
                          style: Object.assign({}, S.dim, { fontSize: 12, cursor: 'pointer', userSelect: 'none' }),
                          onClick: () => set看回收站(!看回收站),
                        },
                        (看回收站 ? '▾ ' : '▸ ') + '回收站 ' + 工作区记忆.回收站.length + ' 条 —— 删掉的先放这儿，能找回来',
                      ),
                      看回收站
                        ? 工作区记忆.回收站.map((m) =>
                            React.createElement(
                              'div',
                              { key: 'd:' + m.id, style: Object.assign({}, S.row, S.条) },
                              React.createElement('span', { style: { flex: 'none', fontSize: 12, width: 76 } }, '删于 ' + (m.deletedAt ? String(m.deletedAt).slice(0, 10) : '—')),
                              React.createElement(
                                'span',
                                { style: { flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', opacity: 0.72 } },
                                m.text || '（空）',
                              ),
                              React.createElement(
                                'button',
                                {
                                  style: {
                                    flex: 'none',
                                    fontSize: 11,
                                    padding: '2px 8px',
                                    cursor: 'pointer',
                                    borderRadius: 4,
                                    border: '1px solid rgba(148,163,184,.5)',
                                    background: 'transparent',
                                    color: 'inherit',
                                  },
                                  onClick: () => 找回工作区记忆(m),
                                  title: '放回活条目里',
                                },
                                '找回来',
                              ),
                            ),
                          )
                        : null,
                    )
                  : null,
              )
            : null,
          ),
          // ⭐ 2026-11-01（用户：「把参数整体搬进高级里」）：参数卡从这里整体搬到「高级」页了，
          //   会话页只留会话列表 + 工作区记忆。notes 是参数保存的提示，跟着一起走。
        )
      }
  return { 会话页 }
}
