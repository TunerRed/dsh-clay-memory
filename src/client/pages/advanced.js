// 高级区 —— 维护工具 / 骨架预览 / 参数 / 档案生成与导入 / 语义召回
import { 造选择器 } from '../components/select.js'
import { 造参数区 } from './advanced/params-section.js'
import { 造生成档案区 } from './advanced/archive-gen-section.js'
import { 造从档案导入会话区 } from './advanced/archive-import-section.js'
import { 造语义区 } from './advanced/semantic-section.js'

export function 造高级区({ React, el, get, post, S, G, toPct, fromPct, 进度, 更新条 }) {
  const 选择器 = 造选择器({ React, el })
  const 参数区 = 造参数区({ React, el, get, post, S, toPct, fromPct })
  const 生成档案区 = 造生成档案区({ React, el, get, post, S, G, 进度, 选择器 })
  const 从档案导入会话区 = 造从档案导入会话区({ React, el, get, post, S, G, 选择器 })
  const 语义区 = 造语义区({ React, el, get, post, S, G })

      function 高级区(props) {
        const [会话们, set会话们] = React.useState([])
        const [维护在, set维护在] = React.useState('') // 运维作用在哪个会话
        const [维护提示, set维护提示] = React.useState(null)
        const [维护跑, set维护跑] = React.useState(false)
        // ⭐ 2026-10-31 用户要求：补类型允许自己选模型（null = 跟随默认降级链）
        const [维护模型, set维护模型] = React.useState(null)
        const [维护模型们, set维护模型们] = React.useState(null) // /models 的结果（未读 = null）
        // ⭐ 2026-10-31 用户要求：补类型支持整个工作区批量跑
        const [维护范围, set维护范围] = React.useState('会话') // 会话 = 只跑选中的；工作区 = 全区逐会话跑
        // ⭐ 1.8.0：会话选择改「工作区 + 搜索」，跟「从档案导入会话」同一套
        const [维护区, set维护区] = React.useState('')
        const [维护搜, set维护搜] = React.useState('')
        const [维护表, set维护表] = React.useState([])
        const [重复组, set重复组] = React.useState([]) // 查重结果（就地合并用）
        const [要合并, set要合并] = React.useState(false) // 行内二次确认（confirm 在 webview 里不弹）
        const [区表, set区表] = React.useState([])
        // ⭐ 1.10.2（F19）：一键清空 —— 范围 / 二次确认 / 手动打「清空」三个字
        const [清空范围, set清空范围] = React.useState('session')
        const [清空问, set清空问] = React.useState(false)
        const [清空字, set清空字] = React.useState('')
        const [清空跑, set清空跑] = React.useState(false)
        // ⭐ 1.12.0 一期决策四：骨架预览 —— _core.json 降成主库投影，只做「预览 + 手动写回」
        const [骨架预, set骨架预] = React.useState(null)
        const [骨架开, set骨架开] = React.useState(false)
        const [骨架跑, set骨架跑] = React.useState(false)
        // ⭐ 1.12.22：骨架可手改 —— null = 不在编辑；数组 = 正在编（保存时整份覆盖）
        const [骨架草, set骨架草] = React.useState(null)
        const [骨架存跑, set骨架存跑] = React.useState(false)
        // ⭐ F10 阶段 0（1.12.26）：骨架空但主库有够格条目 → 顶上挂一条提醒
        const [骨提示, set骨提示] = React.useState(null)
        React.useEffect(() => {
          get('/list')
            .then((l) => {
              const ss = ((l && l.sessions) || []).map((s) => ({ id: s.id, title: s.title || s.id }))
              set会话们(ss)
              if (ss[0]) set维护在(ss[0].id)
            })
            .catch(() => {})
          // ⭐ 2026-10-31：模型下拉自动拉一次列表（不用先点「读模型」，点了也还是能看到）
          post('/models', { session: '' })
            .then((r) => {
              if (r && r.ok) set维护模型们(r)
            })
            .catch(() => {})
        }, [])
        // 工作区列表（会话选择用）
        React.useEffect(() => {
          get('/workspaces')
            .then((r) => {
              const 表 = Array.isArray(r) ? r : (r && r.workspaces) || []
              set区表(表)
              if (表.length) set维护区((v) => v || 表[0].id)
            })
            .catch(() => set区表([]))
        }, [])
        // 骨架预览：跟主库比一比，主库里有没有该进骨架的、骨架里有没有主库已经不认的
        const 拉骨架预 = () => {
          get('/core-preview')
            .then((r) => {
              if (r && r.ok !== false) {
                set骨架预(r)
                set骨提示((r && r.提示) || null)
              }
            })
            .catch(() => {})
        }
        React.useEffect(() => {
          拉骨架预()
        }, [])
        // 当前工作区的会话（按名搜）
        React.useEffect(() => {
          if (!维护区) return
          get('/sessions-by-workspace?workspace=' + encodeURIComponent(维护区) + '&q=' + encodeURIComponent(维护搜 || ''))
            .then((r) => set维护表((r && r.sessions) || []))
            .catch(() => set维护表([]))
        }, [维护区, 维护搜])
        // ⭐ 1.5.0：导出全部 —— 纯前端打包成 JSON 下载，不用后端配合
        const 导出全部 = () => {
          set维护跑(true)
          set维护提示('打包中…')
          post('/all', {})
            .then((r) => {
              if (!r || r.ok === false || !Array.isArray(r.memories)) throw new Error('读不出来')
              const 包 = {
                导出于: new Date().toISOString(),
                统计: r.stats,
                记忆: r.memories,
                已删: r.deleted || [],
              }
              const blob = new Blob([JSON.stringify(包, null, 2)], { type: 'application/json' })
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = '黏土记忆-' + new Date().toISOString().slice(0, 10) + '.json'
              document.body.appendChild(a)
              a.click()
              a.remove()
              setTimeout(() => URL.revokeObjectURL(a.href), 2000)
              set维护提示('✓ 导出了 ' + r.memories.length + ' 条（浏览器下载里找）')
            })
            .catch((e) => set维护提示('导出失败：' + String((e && e.message) || e)))
            .then(() => set维护跑(false))
        }
        // ⭐ 1.10.2（F19）：一键清空（全部 / 仅本会话）
        //   ⚠ 语义 = 收进回收站，不是真销毁：清完还能去「回收站」页找回；
        //     要彻底销毁再去那儿点「把已删掉的清空」。
        const 做清空 = () => {
          const 范围 = 清空范围
          const sid = 维护在
          if (范围 === 'session' && !sid) {
            set维护提示('先在上面选一个会话')
            return
          }
          set清空跑(true)
          set维护提示('清空中…')
          post('/clear', { scope: 范围, session: sid, confirm: 清空字 })
            .then((r) => {
              set维护提示(r && r.ok ? '✓ ' + (r.message || '清好了') : '✗ ' + ((r && r.message) || '没成'))
              if (r && r.ok) {
                set清空问(false)
                set清空字('')
              }
            })
            .catch((e) => set维护提示('✗ ' + String((e && e.message) || e)))
            .then(() => set清空跑(false))
        }
  
        // ⭐ 1.6.16：撤销最近一次批量操作（只认 30 分钟内的补日期 / 补类型 / 补标）
        //   以前改错了只能去目录里翻 .bak 手工拼回来（2026-10-29 凌晨就干过一次）
        const 撤销上一批 = () => {
          const sid = 维护在
          if (!sid) {
            set维护提示('先在右边选一个会话')
            return
          }
          const 名 = (会话们.find((x) => x.id === sid) || {}).title || String(sid).replace(/^session-/, '').slice(0, 8)
          const 问 = window.confirm(
            '把「' + 名 + '」恢复到最近一次批量操作之前？' + '\n' +
              '只认 30 分钟内的「补日期 / 补类型 / 补标长期设定」；\n' +
              '撤完现在这份会存成 .before-undo，万一撤错还能拿回来。',
          )
          if (!问) return
          set维护跑(true)
          set维护提示('正在回滚…')
          post('/undo-last', { session: sid })
            .then((r) => {
              if (!r || !r.ok) {
                set维护提示('撤不了：' + ((r && r.message) || '？'))
                return
              }
              set维护提示(
                '✓ 已撤销「' + (r.撤掉 || '那次批量') + '」\n' +
                  '恢复：' + ((r.恢复 || []).join('、') || '（没有文件被换）'),
              )
            })
            .catch((e) => set维护提示('撤销失败：' + String((e && e.message) || e)))
            .then(() => set维护跑(false))
        }
  
        // ⭐ 1.5.0（F20）：常用运维不用再跳进某个会话的详情页
        //   补标 / 重判要分批跑，这里串成一条链跑到底（她能看见「判了 N 条」在涨）
        const 做 = async (种) => {
          const sid = 维护在
          if (!sid) {
            set维护提示('先在右边选一个会话')
            return
          }
          set维护跑(true)
          set维护提示(种 + '…')
          try {
            if (种 === '补日期') {
              const r = await post('/backfill-dates', { session: sid })
              set维护提示(
                r && r.ok
                  ? '✓ 补了 ' + r.补了 + ' 条（其中年份是猜的 ' + r.猜的 + '），还有 ' + r.还是没 + ' 条真没日期'
                  : '没成：' + ((r && (r.message || r.error)) || '？'),
              )
            } else if (种 === '查重') {
              const r = await post('/duplicates', { session: sid })
              const 组们 = r && Array.isArray(r.组) ? r.组 : []
              set重复组(组们)
              set维护提示(
                r && r.ok
                  ? 组们.length
                    ? '找到 ' + 组们.length + ' 组「像同一件事的」—— 底下可以就地合并，也可以先逐组看过再合'
                    : '✓ 没找到重复'
                  : '没成：' + ((r && (r.message || r.error)) || '？'),
              )
            } else if (种 === '补类型') {
              // 旧条目没有类型（1.5.0 之前导入的）—— 一批 20 条问模型，串着跑到 done
              // ⭐ 2026-10-31 用户要求：范围选「整个工作区」时逐会话跑，每个跑到 done 再下一个
              let 目标sids = [sid]
              if (维护范围 === '工作区') {
                const 区r = await get('/sessions-by-workspace?workspace=' + encodeURIComponent(维护区))
                const 区sids = ((区r && 区r.sessions) || []).map((x) => x.id)
                if (!区sids.length) {
                  set维护提示('这个工作区里没有会话')
                  set维护跑(false)
                  return
                }
                目标sids = 区sids
              }
              let 判 = 0
              let 用 = ''
              let 跑过会话 = 0
              for (const s0 of 目标sids) {
                let 连着空 = 0
                for (let i = 0; i < 400; i++) {
                  const 体 = { session: s0, 每批: 20 }
                  if (维护模型) {
                    体.provider = 维护模型.provider
                    体.model = 维护模型.model
                  }
                  const r = await post('/classify-types', 体)
                  if (!r || !r.ok) {
                    set维护提示('补类型失败：' + ((r && r.message) || '？') + '（判好的已经存下，再点一次接着跑）')
                    set维护跑(false)
                    return
                  }
                  判 += r.判了 || 0
                  用 = r.用 || 用
                  set维护提示('已跑 ' + 跑过会话 + '/' + 目标sids.length + ' 个会话，判了 ' + 判 + ' 条…' + (用 ? '（' + 用 + '）' : ''))
                  if (r.done) break
                  if (!(r.判了 || 0)) {
                    连着空++
                    if (连着空 > 2) break
                  } else 连着空 = 0
                }
                跑过会话++
              }
              set维护提示('✓ 补类型完成：' + 跑过会话 + ' 个会话、共 ' + 判 + ' 条' + (用 ? '（用的 ' + 用 + '）' : ''))
            } else {
              // 「补标长期设定」/「重判」：一批 20 条，串着跑到 done
              let 判 = 0
              let 升 = 0
              let 降 = 0
              let 连着空 = 0
              let 头 = true
              for (let i = 0; i < 400; i++) {
                const 体 = { session: sid, 每批: 20 }
                if (种 === '重判' && 头) 体.重判 = true
                头 = false
                const r = await post('/backfill-stable', 体)
                if (!r || !r.ok) {
                  set维护提示('补标失败：' + ((r && r.message) || '？') + '（判好的已经存下，再点一次会接着跑）')
                  set维护跑(false)
                  return
                }
                判 += r.判了 || 0
                升 += r.改成不淡 || 0
                降 += r.降成会淡 || 0
                set维护提示('判了 ' + 判 + ' 条…（升 ' + 升 + ' / 降 ' + 降 + '）')
                if (r.done) break
                if (!(r.判了 || 0)) {
                  连着空++
                  if (连着空 > 2) break
                } else 连着空 = 0
              }
              set维护提示('✓ 判了 ' + 判 + ' 条：升成「长期设定」' + 升 + ' 条，降回会淡 ' + 降 + ' 条')
            }
          } catch (e) {
            set维护提示(String((e && e.message) || e))
          }
          set维护跑(false)
        }
        // 就地合并（查重结果就在这页）
        const 合并组 = async () => {
          const sid = 维护在
          if (!sid || !重复组.length) return
          // 后端要的是 {留, 删}：每组留第一条，其余收起来
          const 组们 = []
          for (const g of 重复组) {
            const 条们 = g.条们 || []
            if (条们.length < 2) continue
            const 留 = 条们[0].id
            const 删 = 条们.filter((t) => t.id !== 留).map((t) => t.id)
            if (删.length) 组们.push({ 留: 留, 删: 删 })
          }
          if (!组们.length) {
            set维护提示('这几组里没有能自动合的（每组不到 2 条）')
            return
          }
          set维护跑(true)
          set维护提示('合并中…')
          try {
            const r = await post('/duplicates/merge', { session: sid, 组: 组们 })
            set维护提示(r && r.ok ? '✓ ' + (r.message || '合并好了') : '没成：' + ((r && (r.message || r.error)) || '？'))
            if (r && r.ok) {
              set重复组([])
              set要合并(false)
            }
          } catch (e) {
            set维护提示(String((e && e.message) || e))
          }
          set维护跑(false)
        }
        // ⭐ 1.6.18（用户：「运维样式不够好看，要有条理、边界清晰」）
        //   原来是一整行 flex 平铺：标签 + 下拉 + 七个按钮 + 一段提示，全挤在一条线上，看不出哪些是一类。
        //   现在「记忆习惯」「运维」各一张卡；运维卡里按**动作性质**分三组：整理 / 检查与导出 / 回退。
        const 组标题 = {
          fontSize: 12.5,
          fontWeight: 600,
          color: 'var(--dsw-alias-label-secondary, #666)',
          margin: '14px 0 7px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }
        const 按钮行 = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }
        // ⭐ 1.8.0：运维卡里「只对这个会话」和「整库」要分开，否则第一行那个「作用在」会让人以为
        //   下面每个按钮都只作用于那个会话 ✗
        const 分割线 = { margin: '14px 0', borderTop: '2px solid var(--dsw-alias-border-l1, rgba(128,128,128,.45))' }
        const 卡说明 = { fontSize: 11.5, marginTop: 6, color: 'var(--dsw-alias-label-tertiary, #8a8a8a)', lineHeight: 1.6 }
        return el(
          'div',
          null,
          // ── 参数（2026-11-01 用户要求：从「会话 → 参数」整块搬来，替代原来的「记忆习惯」三档；
          //   样式沿用原来的折叠卡——默认收起，点标题才展开）
          el(参数区, null),
          // ⭐ F10 阶段 0（1.12.26）：骨架还空着，但主库已经攒够格的了 —— 顶上挂一条，别让人自己去猜
          骨提示
            ? el(
                'div',
                {
                  style: {
                    margin: '0 0 10px',
                    padding: '8px 10px',
                    border: '1px solid rgba(194,65,12,.35)',
                    background: 'rgba(249,115,22,.07)',
                    borderRadius: 8,
                    fontSize: 12.5,
                    lineHeight: 1.6,
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 8,
                    flexWrap: 'wrap',
                  },
                },
                el(
                  'span',
                  { style: { flex: '1 1 320px' } },
                  '有 ' +
                    骨提示.够格 +
                    ' 条记忆够格进骨架（重要度 ≥0.8），但骨架现在是空的。骨架每轮都在场上，适合放「她是谁 / 怎么称呼 / 别做什么」这种长期不变的东西 —— 下面「骨架预览」里能挑几条进去。',
                ),
              )
            : null,
          // ── 骨架预览（1.12.0）
          //   骨架 _core.json 每轮都在场上，但它一直是手写的、跟主库脱节。
          //   这里把它当「主库的投影」：只算差在哪（该加的 / 主库已经不认的），
          //   写不写由人点 —— 自动覆盖会把手写的风格、边界冲掉，冲掉没后悔药。
          el(
            'div',
            { style: S.sec },
            el(
              'div',
              { style: S.secH },
              el('span', { style: S.secTitle }, '骨架预览'),
              el('span', { style: S.secTag }, '主库 → _core.json'),
            ),
            el('div', { style: 分割线 }),
            (() => {
              if (!骨架预) return el('div', { style: 卡说明 }, '读不到骨架（文件不存在也算正常）')
              const 加 = (骨架预.新增 || []).length
              const 下 = (骨架预.可下线 || []).length
              const 已 = (骨架预.已有 || []).length
              const 做写回 = () => {
                set骨架跑(true)
                post('/core-preview', { action: 'apply' })
                  .then((r) => {
                    if (r && r.ok === false) throw new Error(r.message || '写回失败')
                    set维护提示((r && r.message) || '骨架已更新')
                    set骨架开(false)
                    拉骨架预()
                  })
                  .catch((e) => set维护提示(String((e && e.message) || e)))
                  .then(() => set骨架跑(false))
              }
              // ⭐ 1.12.22：手改后整份覆盖。空条目不提交（后端也会再过滤一遍）。
              const 存骨架 = () => {
                set骨架存跑(true)
                post('/core-preview', { action: 'save', items: 骨架草 || [] })
                  .then((r) => {
                    if (r && r.ok === false) throw new Error(r.message || '保存失败')
                    set维护提示((r && r.message) || '骨架已保存')
                    set骨架草(null)
                    拉骨架预()
                  })
                  .catch((e) => set维护提示(String((e && e.message) || e)))
                  .then(() => set骨架存跑(false))
              }
              return el(
                'div',
                null,
                el(
                  'div',
                  { style: 卡说明 },
                  '骨架 ' + 骨架预.骨架条数 + ' 条 · 主库里够格的 ' + 骨架预.候选条数 + ' 条 · ' +
                    '可加 ' + 加 + ' · 可下线 ' + 下 + ' · 已经对上 ' + 已,
                ),
                el(
                  'div',
                  { style: Object.assign({}, 卡说明, { marginTop: 2 }) },
                  '主库挑得出的只有「事实层 + 重要度 ≥ 0.8」；风格、边界、关系那种手写的，它挑不出来，也不会替你删。',
                ),
                骨架草
                  ? el(
                      'div',
                      null,
                      el(
                        'div',
                        { style: Object.assign({}, 卡说明, { marginTop: 6 }) },
                        '改、删、加都行；留空的条目保存时会被丢掉。跟 AGENTS.md 或跟别条重不重复，你自己判断 —— 这里不给建议。',
                      ),
                      骨架草.map((it, i) =>
                        el(
                          'div',
                          { key: 'ce' + i, style: { marginTop: 8 } },
                          el(
                            'div',
                            { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3, flexWrap: 'wrap' } },
                            el(
                              'span',
                              { style: Object.assign({}, 卡说明, { marginTop: 0 }) },
                              (it.core ? '◆ 核心' : '·') + ' #' + (i + 1) + ' · ' + String(it.content || '').length + ' 字',
                            ),
                            el(
                              'label',
                              { style: { fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' } },
                              el('input', {
                                type: 'checkbox',
                                checked: it.core === true,
                                onChange: (e) => {
                                  const 下份 = 骨架草.slice()
                                  下份[i] = Object.assign({}, 下份[i], { core: e.target.checked })
                                  set骨架草(下份)
                                },
                              }),
                              '核心画像（永不下线）',
                            ),
                            el(
                              'button',
                              {
                                style: { marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#c44', fontSize: 15, lineHeight: 1 },
                                title: '删这条',
                                onClick: () => set骨架草(骨架草.filter((_, j) => j !== i)),
                              },
                              '×',
                            ),
                          ),
                          el('textarea', {
                            style: G.area,
                            value: it.content || '',
                            onChange: (e) => {
                              const 下份 = 骨架草.slice()
                              下份[i] = Object.assign({}, 下份[i], { content: e.target.value })
                              set骨架草(下份)
                            },
                          }),
                        ),
                      ),
                      el(
                        'div',
                        { style: 按钮行 },
                        el(
                          'button',
                          {
                            style: S.btn,
                            onClick: () => set骨架草(骨架草.concat([{ id: '', content: '', core: false, importance: 0 }])),
                          },
                          '＋ 加一条',
                        ),
                        el(
                          'button',
                          { style: Object.assign({}, S.btn, { opacity: 骨架存跑 ? 0.5 : 1 }), disabled: 骨架存跑, onClick: 存骨架 },
                          骨架存跑 ? '保存中…' : '保存骨架',
                        ),
                        el('button', { style: S.btn, onClick: () => set骨架草(null) }, '取消'),
                      ),
                    )
                  : el(
                      'div',
                      null,
                      el(
                        'div',
                        { style: 按钮行 },
                        el(
                          'button',
                          { style: S.btn, onClick: () => set骨架草((骨架预.items || []).map((x) => Object.assign({}, x))) },
                          '编辑骨架（' + 骨架预.骨架条数 + ' 条）',
                        ),
                        加 || 下
                          ? el(
                              'button',
                              { style: S.btn, onClick: () => set骨架开(!骨架开) },
                              (骨架开 ? '收起' : '看差在哪') + '（+' + 加 + ' / −' + 下 + '）',
                            )
                          : null,
                        加 || 下
                          ? el(
                              'button',
                              {
                                style: Object.assign({}, S.btn, { opacity: 骨架跑 ? 0.5 : 1 }),
                                onClick: 做写回,
                                disabled: 骨架跑,
                              },
                              骨架跑 ? '写着…' : '写回骨架',
                            )
                          : null,
                      ),
                      加 || 下
                        ? null
                        : el('div', { style: Object.assign({}, 卡说明, { marginTop: 4 }) }, '✓ 主库里没有要改的'),
                      骨架开
                        ? el(
                            'div',
                            { style: Object.assign({}, 卡说明, { marginTop: 6 }) },
                            el('div', null, '▸ 会加进去：'),
                            (骨架预.新增 || []).map((x, i) =>
                              el('div', { key: 'a' + i, style: { paddingLeft: 10 } }, '· ' + x.content),
                            ),
                            el('div', { style: { marginTop: 4 } }, '▸ 会下线（主库已经不认了）：'),
                            (骨架预.可下线 || []).map((x, i) =>
                              el('div', { key: 'd' + i, style: { paddingLeft: 10 } }, '· ' + x),
                            ),
                          )
                        : null,
                    ),
              )
            })(),
          ),
          // ── 整理会话
          el(
            'div',
            { style: S.sec },
            el(
              'div',
              { style: S.secH },
              el('span', { style: S.secTitle }, '整理会话'),
              el('span', { style: S.secTag }, '整理 · 检查 · 回退'),
            ),
            el('div', { style: 分割线 }),
            el(
              'div',
              { style: Object.assign({}, 按钮行, { marginTop: 6 }) },
              el(选择器, {
                style: Object.assign({}, G.sel, { maxWidth: 210 }),
                值: 维护区,
                选项: (区表.length ? 区表 : [{ id: '', name: '（没有工作区）', 会话数: 0 }]).map((w) => ({
                  v: w.id,
                  t: (w.name || '工作区') + '（' + (w.会话数 || 0) + ' 个会话）',
                })),
                onChange: (v) => {
                  set维护区(v)
                  set维护搜('')
                  set维护在('')
                },
              }),
              el('input', {
                style: Object.assign({}, G.sel, { width: 150 }),
                placeholder: '按会话名搜索…',
                value: 维护搜,
                onChange: (e) => set维护搜(e.target.value),
              }),
            ),
            el(
              'div',
              {
                style: {
                  maxHeight: 150,
                  overflow: 'auto',
                  border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))',
                  borderRadius: 8,
                  padding: 4,
                  marginTop: 8,
                },
              },
              维护表.length
                ? 维护表.map((x) =>
                    el(
                      'div',
                      {
                        key: x.id,
                        role: 'button',
                        tabIndex: 0,
                        style: {
                          display: 'flex',
                          gap: 8,
                          alignItems: 'center',
                          padding: '6px 8px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          fontSize: 12.5,
                          background:
                            维护在 === x.id ? 'var(--dsw-alias-state-business-primary, #5b8fd6)' : 'transparent',
                          color: 维护在 === x.id ? '#fff' : 'inherit',
                        },
                        onClick: () => set维护在(x.id),
                        onKeyDown: (e) => {
                          if (e.key === 'Enter' || e.key === ' ') set维护在(x.id)
                        },
                      },
                      el('span', null, 维护在 === x.id ? '●' : '○'),
                      el(
                        'span',
                        { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                        x.title || String(x.id || '').replace(/^session-/, '').slice(0, 12),
                      ),
                      el('span', { style: { flex: 'none', fontSize: 11, opacity: 0.75 } }, (x.事件数 || 0) + ' 条事件'),
                    ),
                  )
                : el(
                    'div',
                    { style: Object.assign({}, 卡说明, { padding: '8px 6px', margin: 0 }) },
                    维护区 ? '这个工作区里没有匹配的会话' : '先选工作区',
                  ),
            ),
            el(
              'div',
              { style: Object.assign({}, 按钮行, { marginTop: 8 }) },
              // ⭐ 2026-10-31 用户要求：范围 —— 只跑选中的会话 / 整个工作区逐会话跑
              el(
                'select',
                {
                  key: '范围',
                  style: Object.assign({}, G.btn, { maxWidth: 170 }),
                  disabled: 维护跑,
                  value: 维护范围,
                  onChange: (e) => set维护范围(String((e && e.target && e.target.value) || '会话')),
                },
                el('option', { value: '会话' }, '范围：这个会话'),
                el('option', { value: '工作区' }, '范围：整个工作区'),
              ),
              // ⭐ 2026-10-31 用户要求：补类型前可以先选模型（默认跟随 DSH 默认模型）
              el(
                'select',
                {
                  key: '模型',
                  style: Object.assign({}, G.btn, { maxWidth: 280 }),
                  disabled: 维护跑,
                  value: 维护模型 ? 维护模型.provider + '/' + 维护模型.model : '',
                  onChange: (e) => {
                    const v = String((e && e.target && e.target.value) || '')
                    if (!v) {
                      set维护模型(null)
                      return
                    }
                    const i = v.indexOf('/')
                    set维护模型(i > 0 ? { provider: v.slice(0, i), model: v.slice(i + 1) } : null)
                  },
                },
                el(
                  'option',
                  { value: '' },
                  '模型：跟随默认' +
                    (维护模型们 && 维护模型们.默认 && 维护模型们.默认.model ? '（' + 维护模型们.默认.model + '）' : ''),
                ),
                ...(维护模型们 && 维护模型们.ok
                  ? (维护模型们.providers || []).flatMap((p) =>
                      (p.models || []).map((m) =>
                        el('option', { key: p.id + '/' + m.id, value: p.id + '/' + m.id }, p.name + ' / ' + (m.name || m.id)),
                      ),
                    )
                  : []),
              ),
              el(
                'button',
                {
                  key: '读模型',
                  style: G.btn,
                  disabled: 维护跑,
                  onClick: () => {
                    set维护提示('读着呢…')
                    post('/models', { session: 维护在 })
                      .then((r) => {
                        set维护模型们(r)
                        if (r && r.ok) set维护提示('模型读好了，下拉里选一个再点补类型')
                        else set维护提示('✗ ' + ((r && r.message) || '读模型失败'))
                      })
                      .catch((e) => set维护提示('✗ ' + String((e && e.message) || e)))
                  },
                },
                '读模型',
              ),
              ['补日期', '补类型', '补标长期设定', '重判'].map((种) =>
                el('button', { key: 种, style: G.btn, disabled: 维护跑, onClick: () => 做(种) }, 种),
              ),
              el(
                'button',
                {
                  key: '撤销上一批',
                  style: Object.assign({}, G.btn, {
                    borderColor: 'var(--dsw-alias-state-warn-primary, #c9963f)',
                    color: 'var(--dsw-alias-state-warn-primary, #c9963f)',
                  }),
                  disabled: 维护跑,
                  onClick: 撤销上一批,
                },
                '撤销上一批',
              ),
            ),
            el('div', { style: 卡说明 }, '前四个会调模型、改分类，别连点。「撤销上一批」撤掉的是这个会话最近一次补日期 / 补类型 / 补标（30 分钟内有效）。'),
            el('div', { style: 组标题 }, '查重'),
            el(
              'div',
              { style: 按钮行 },
              el('button', { key: '查重', style: G.btn, disabled: 维护跑, onClick: () => 做('查重') }, '查重'),
              重复组.length
                ? 要合并
                  ? el(
                      'span',
                      { key: '确认条', style: Object.assign({}, 按钮行, { margin: 0 }) },
                      el('span', { style: Object.assign({}, 卡说明, { margin: 0 }) }, '合并掉这 ' + 重复组.length + ' 组？每组只留最像的一条，其余进「已删」（可找回）'),
                      el('button', { key: '确定', style: G.btn, disabled: 维护跑, onClick: 合并组 }, '确定合并'),
                      el('button', { key: '取消', style: G.btn, onClick: () => set要合并(false) }, '算了'),
                    )
                  : el(
                      'button',
                      {
                        key: '合并',
                        style: Object.assign({}, G.btn, {
                          borderColor: 'var(--dsw-alias-state-warn-primary, #c9963f)',
                          color: 'var(--dsw-alias-state-warn-primary, #c9963f)',
                        }),
                        disabled: 维护跑,
                        onClick: () => set要合并(true),
                      },
                      '合并这 ' + 重复组.length + ' 组',
                    )
                : null,
            ),
            重复组.length
              ? el(
                  'div',
                  { style: { marginTop: 8, maxHeight: 220, overflow: 'auto', border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))', borderRadius: 8, padding: 6 } },
                  重复组.map((g, i) =>
                    el(
                      'div',
                      { key: i, style: { padding: '6px 8px', borderBottom: i < 重复组.length - 1 ? '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.16))' : 'none' } },
                      el('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 2 } }, (g.类型 || '像同一件事') + ' · ' + (g.条们 ? g.条们.length : 0) + ' 条'),
                      (g.条们 || []).slice(0, 3).map((m, j) =>
                        el('div', { key: j, style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary, #777)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '· ' + String(m.text || '').slice(0, 60)),
                      ),
                    ),
                  ),
                )
              : null,
            el('div', { style: 卡说明 }, '只找出来、不自动合并。'),
            el('div', { style: 分割线 }),
            el(
              'div',
              { style: 按钮行 },
              el('button', { key: '导出全部', style: G.btn, disabled: 维护跑, onClick: 导出全部 }, '导出全部记忆（JSON）'),
              el('span', { style: Object.assign({}, 卡说明, { margin: 0 }) }, '整库、不分会话；含已删条目，不调模型、不花钱。留底 / 换电脑用这个。'),
            ),
  
            维护提示
              ? el(
                  'div',
                  {
                    style: {
                      marginTop: 10,
                      padding: '8px 10px',
                      borderRadius: 8,
                      fontSize: 12,
                      whiteSpace: 'pre-line',
                      background: 'var(--dsw-alias-bg-l1, rgba(127,127,127,.08))',
                      border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))',
                    },
                  },
                  维护提示,
                )
              : null,
          ),
          // ⭐ 1.10.2（F19）一键清空：独立一张卡，跟「整理会话」分开 ——
          //   一个是在旧记忆上做加工，一个是把记忆全收走，不该摆在一起。
          el(
            'div',
            { style: S.sec },
            el('div', { style: S.secH }, el('span', { style: S.secTitle }, '清空'), el('span', { style: S.secTag }, '收进回收站 · 能找回')),
            el(
              'div',
              { style: 卡说明 },
              '「清空」不销毁任何东西：全进回收站，随时能找回。真要彻底销毁，去「回收站」页点「把已删掉的清空」。',
            ),
            el(
              'div',
              { style: Object.assign({}, 按钮行, { marginTop: 8 }) },
              el(
                'select',
                {
                  key: '清空范围',
                  style: Object.assign({}, G.btn, { maxWidth: 260 }),
                  disabled: 清空跑,
                  value: 清空范围,
                  onChange: (e) => {
                    set清空范围(String((e && e.target && e.target.value) || 'session'))
                    set清空问(false)
                    set清空字('')
                  },
                },
                el('option', { value: 'session' }, '只清这个会话（事实 / 工作区不动）'),
                el('option', { value: 'all' }, '全清：事实 + 所有会话 + 工作区'),
              ),
              el(
                'button',
                {
                  key: '清空',
                  style: Object.assign({}, G.btn, {
                    borderColor: 'var(--dsw-alias-state-error-primary, rgba(208,90,90,.7))',
                    color: 'var(--dsw-alias-state-error-primary, rgba(208,90,90,.95))',
                  }),
                  disabled: 清空跑,
                  onClick: () => {
                    set清空问(!清空问)
                    set清空字('')
                  },
                },
                清空问 ? '算了' : '清空…',
              ),
            ),
            清空问
              ? el(
                  'div',
                  { style: Object.assign({}, 按钮行, { marginTop: 8 }) },
                  el(
                    'span',
                    { style: Object.assign({}, 卡说明, { margin: 0 }) },
                    清空范围 === 'all'
                      ? '这会清掉**全部**（事实对所有工作区都不可见），清完在回收站能找回。'
                      : '这会清掉「' + ((会话们.find((x) => x.id === 维护在) || {}).title || '当前会话') + '」的事件，事实和工作区不动。',
                  ),
                  el('input', {
                    style: Object.assign({}, G.sel, { width: 110 }),
                    placeholder: '打「清空」',
                    value: 清空字,
                    onChange: (e) => set清空字(e.target.value),
                  }),
                  el(
                    'button',
                    {
                      key: '确定清空',
                      style: Object.assign({}, G.btn, {
                        borderColor: 'var(--dsw-alias-state-error-primary, rgba(208,90,90,.7))',
                        color: 'var(--dsw-alias-state-error-primary, rgba(208,90,90,.95))',
                      }),
                      disabled: 清空跑 || 清空字.trim() !== '清空',
                      onClick: 做清空,
                    },
                    '确定清空',
                  ),
                )
              : null,
          ),
          el(生成档案区, { 会话号: (会话们[0] && 会话们[0].id) || '' }),
          // ⭐ 1.8.0：导出档案正下方 —— 从档案导入会话
          el(从档案导入会话区, { 会话们 }),
          el(语义区),
          el('div', { style: { marginTop: 14 } }, el(更新条)),
        )
      }
  return { 高级区 }
}

