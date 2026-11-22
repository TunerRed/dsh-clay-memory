// 回复体检页 —— 2026-11-11 从 lib/client.js 拆出来（逻辑未改）
// 2026-11-16（1.12.41）：加「临场提醒」折叠区，原有内容收进「回复体检」折叠区。
// 依赖由调用方注入；不直接碰宿主 API，方便离线渲染测试。
// ⚠️ 2026-11-22 主人给插件瘦身：路径陈旧检查默认不显示（代码和测试都留着，改这里就回来）。
const 启用陈旧检查 = false

export function 造回复体检页({ React, get, post, B, S, el }) {
  // 本地折叠组件（用法照 advanced.js 的那份，只是这里要多一处字数提示，所以单独放一份）。
  // 没抽成公共模块的原因：两边的「注」用法不太一样（这里是动态字数，那边是固定说明）。
  function 折(props) {
    const 开 = !!props.开
    const 切 = () => props.on切(!开)
    return el(
      'div',
      { style: Object.assign({}, S.sec, { marginBottom: 10 }) },
      el(
        'div',
        {
          style: Object.assign({}, S.secH, { marginBottom: 开 ? 10 : 0, cursor: 'pointer' }),
          onClick: 切,
          role: 'button',
          tabIndex: 0,
          'aria-expanded': 开,
          onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
              e.preventDefault()
              切()
            }
          },
        },
        el('span', { style: S.secTitle }, (开 ? '▾ ' : '▸ ') + props.标题),
        props.注 ? el('span', { style: S.secTag }, props.注) : null,
      ),
      开 ? props.children : null,
    )
  }

  function 回复体检页() {
      const [数据, set数据] = React.useState(null)
      const [忙, set忙] = React.useState(true)
      const [错, set错] = React.useState('')
      const [天数, set天数] = React.useState(14)
      const [条数, set条数] = React.useState(20)
      // ⭐ 1.12.41：临场提醒（体检页第一个折叠区）
      const [提醒, set提醒] = React.useState('')
      const [上限, set上限] = React.useState(200)
      const [提醒存, set提醒存] = React.useState('') // '' | '保存中…' | '已保存 ✓'
      const [开提醒, set开提醒] = React.useState(true)
      const [开体检, set开体检] = React.useState(false)
      // ⭐ 1.12.78：兼容性自检 —— 体检页最上面那个（客户端升级后插件还干不干活）
      const [自检, set自检] = React.useState(null)
      const [开自检, set开自检] = React.useState(true)
      const [自检忙, set自检忙] = React.useState('')
      const [自检错, set自检错] = React.useState('')
      const 跑自检 = React.useCallback(() => {
        set自检忙('跑着…')
        set自检错('')
        get('/selfcheck')
          .then((r) => {
            set自检忙('')
            if (r && r.ok) set自检(r)
            else set自检错(String((r && r.error) || '没跑成'))
          })
          .catch((e) => {
            set自检忙('')
            set自检错(String((e && e.message) || e))
          })
      }, [])
      React.useEffect(() => {
        跑自检()
      }, [跑自检])
      const 跑深检 = () => {
        set自检忙('深检中…')
        set自检错('')
        post('/selfcheck/deep', {})
          .then((r) => {
            set自检忙('')
            if (r && r.ok) set自检(r)
            else set自检错(String((r && r.error) || '没跑成'))
          })
          .catch((e) => {
            set自检忙('')
            set自检错(String((e && e.message) || e))
          })
      }
      // ⭐ 1.12.46：自动整理（存量重复自查自合）—— 让主人能翻账
      const [整理, set整理] = React.useState(null)
      const [开整理, set开整理] = React.useState(false)
      const [整理中, set整理中] = React.useState('')
      const [整理后, set整理后] = React.useState('')
      // ⭐ 1.12.74：陈旧检查（记忆里写的路径现在还在不在）—— 体检页新增的折叠区
      const [陈旧, set陈旧] = React.useState(null)
      const [开陈旧, set开陈旧] = React.useState(false)
      const [陈旧忙, set陈旧忙] = React.useState('')
      const [陈旧后, set陈旧后] = React.useState('')
      const 载陈旧 = React.useCallback(() => {
        get('/stale')
          .then((r) => {
            if (r && r.ok) set陈旧(r)
          })
          .catch(() => {})
      }, [])
      React.useEffect(() => {
        if (启用陈旧检查) 载陈旧()
      }, [载陈旧])
      const 处置陈旧 = (键, 动作, 强制) => {
        set陈旧忙('处置中…')
        post('/stale/action', { 键: 键, 动作: 动作, 强制: !!强制 })
          .then((r) => {
            if (r && r.ok) {
              set陈旧后(动作 === 'undo' ? '撤销了，这条又能被想起来了' : (动作 === 'confirm' ? '标成过时了（没删，随时能撤销）' : '记下了，这条路径不再烦你'))
              set陈旧忙('')
              载陈旧()
            } else {
              set陈旧后(String((r && r.error) || '没成'))
              set陈旧忙('')
            }
          })
          .catch((e) => {
            set陈旧后(String((e && e.message) || e))
            set陈旧忙('')
          })
      }
      const 立刻扫陈旧 = () => {
        set陈旧忙('扫着…')
        post('/stale/scan', {})
          .then((r) => {
            if (r && r.ok) {
              set陈旧后('扫完了：待确认 ' + (r.待确认数 || 0) + ' 条')
              set陈旧忙('')
              载陈旧()
            } else {
              set陈旧后(String((r && r.error) || '没扫成'))
              set陈旧忙('')
            }
          })
          .catch((e) => {
            set陈旧后(String((e && e.message) || e))
            set陈旧忙('')
          })
      }
      // 1.12.75：机械护栏 —— 不猜语义，只 refuse「明显像是在举例/列举」的那几种。
      // 2026-11-22 真机上标错了两条：一条讲 detectQq 探测哪几个路径（QQ 卸了，路径全没了，
      // 但这条记忆本身是排坑知识）、一条排查套路里顺带提了个路径。都是「路径只是被列举」，
      // 所以这里只在两个信号同时看着像「列举」时才挡。
      const 陈旧护栏 = (x) => {
        if (!x) return ''
        if (x.伴随有效路径) return '同一句里还有有效路径，像是在举例'
        const 列举 = (x.命中记忆 || []).some((m) => Number(m.失效路径数 || 1) >= 2)
        if (列举) return '这条记忆提到了不止一个失效路径，像是在列举'
        return ''
      }
      const 载 = React.useCallback(() => {
        set忙(true)
        get('/reply-check?days=' + 天数 + '&limit=' + 条数)
          .then((r) => {
            if (r && r.ok) {
              set数据(r)
              set错('')
            } else set错((r && r.message) || '读不出来')
          })
          .catch((e) => set错(String((e && e.message) || e)))
          .finally(() => set忙(false))
      }, [天数, 条数])
      // 临场提醒：进来读一次（读不到就当没写，不挡住体检数据）
      React.useEffect(() => {
        get('/hint')
          .then((r) => {
            if (r && r.ok) {
              set提醒(String(r.文字 || ''))
              set上限(Number(r.上限) || 200)
            }
          })
          .catch(() => {})
      }, [])
      React.useEffect(() => {
        载()
      }, [载])
      // 整理记录：进来拉一次（读不到就空着，不挡住别的）
      React.useEffect(() => {
        get('/dedupe')
          .then((r) => {
            if (r && r.ok) set整理(r)
          })
          .catch(() => {})
      }, [])
      const 提醒字 = Array.from(提醒).length
      const 存提醒 = () => {
        set提醒存('保存中…')
        post('/hint', { 文字: 提醒 })
          .then((r) => {
            if (r && r.ok) {
              // 后端可能截断了，以后端回来的为准（超长时输入框也会跟着收到 200 字）
              set提醒(String(r.文字 || ''))
              set提醒存(r.被截断 ? '超长已截到 ' + (r.上限 || 200) + ' 字' : '已保存 ✓')
            } else set提醒存('保存失败')
          })
          .catch((e) => set提醒存('保存失败：' + String((e && e.message) || e)))
      }
      const 跑整理 = () => {
        set整理中('整理中…')
        set整理后('')
        post('/dedupe', {})
          .then((r) => {
            set整理中('')
            if (r && r.ok) {
              set整理((o) => Object.assign({}, o || {}, r))
              set整理后(r.合了 ? '合了 ' + r.合了 + ' 对，省下 ' + r.省下 + ' 字' : '没找到能合的')
              get('/dedupe')
                .then((x) => {
                  if (x && x.ok) set整理(x)
                })
                .catch(() => {})
            } else set整理中('失败：' + String((r && r.error) || '未知'))
          })
          .catch((e) => {
            set整理中('')
            set整理中('失败：' + String((e && e.message) || e))
          })
      }
      const 切规则 = (id) => {
        if (!数据) return
        const 现在 = new Set(数据.disabled || [])
        if (现在.has(id)) 现在.delete(id)
        else 现在.add(id)
        post('/reply-check/rules', { disabled: [...现在] })
          .then(() => 载())
          .catch((e) => window.alert('保存失败：' + String((e && e.message) || e)))
      }
      const 汇总 = (数据 && 数据.summary) || { count: 0, totalHits: 0, hitRate: 0 }
      const 多行 = Object.assign({}, S.inp, {
        width: '100%',
        minHeight: 130,
        lineHeight: 1.6,
        fontFamily: 'inherit',
        fontSize: 12.5,
        padding: '8px 10px',
        resize: 'vertical',
        boxSizing: 'border-box',
        whiteSpace: 'pre-wrap',
      })
      return el(
        'div',
        { style: S.wrap },
        // ---------- ⓿ 兼容性自检（1.12.78）----------
        // 定位：DSH 客户端一升级就可能把事件/服务悄悄换掉，插件不崩不报错、只是那件事
        // 永远不发生（1.12.66 前 dream 静默失败三天就是这个形状）。所以这里不问「有没有
        // 报错」，问「该发生的事最近发生过没有」。
        折({
          标题: '兼容性自检',
          注: 自检
            ? ((自检.统计 && 自检.统计.结论) === 'ok' ? '都正常' : (自检.统计 && 自检.统计.结论) === 'warn' ? '有该看的项' : '有问题')
            : '客户端升级后插件还干不干活',
          开: 开自检,
          on切: set开自检,
          children: el(
            'div',
            null,
            el(
              'div',
              { style: Object.assign({}, S.dim, { fontSize: 11.5, lineHeight: 1.55, marginBottom: 8 }) },
              '查四层：服务在不在（apply 期间接住的那些）· 各条流水线最后干活距今多久 · ' +
                (启用陈旧检查 ? '整理/归纳/陈旧检查的水位' : '整理/归纳的水位') +
                ' · 库文件结构对不对。事件改名这类问题它不会当场发现，但最多两天就能从「上次成功距今多久」里看出来。',
            ),
            el(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 } },
              el(
                'button',
                { style: Object.assign({}, S.btn, { fontSize: 12, padding: '4px 10px' }), disabled: !!自检忙, onClick: 跑自检 },
                自检忙 === '跑着…' ? '跑着…' : '跑一次自检',
              ),
              el(
                'button',
                {
                  style: Object.assign({}, S.btn, { fontSize: 12, padding: '4px 10px' }),
                  disabled: !!自检忙,
                  onClick: 跑深检,
                  title: '会真的调一次模型（花一点点 token），确认模型通路能不能用',
                },
                自检忙 === '深检中…' ? '深检中…' : '深度检查（调模型）',
              ),
              el('span', { style: Object.assign({}, S.dim, { fontSize: 11 }) }, '浅检不花钱，深度检查会调一次模型'),
              自检 && 自检.上次检查 ? el('span', { style: Object.assign({}, S.dim, { fontSize: 11 }) }, '· ' + String(自检.上次检查).slice(0, 16).replace('T', ' ')) : null,
            ),
            自检错 ? el('div', { style: Object.assign({}, S.drop, { fontSize: 12 }) }, 自检错) : null,
            自检 && 自检.统计
              ? el(
                  'div',
                  {
                    style: {
                      marginBottom: 10,
                      padding: '6px 10px',
                      borderRadius: 6,
                      fontSize: 12,
                      background: 自检.统计.结论 === 'ok' ? 'rgba(143,208,160,.10)' : 自检.统计.结论 === 'warn' ? 'rgba(224,176,112,.10)' : 'rgba(201,128,128,.12)',
                      color: 自检.统计.结论 === 'ok' ? '#8fd0a0' : 自检.统计.结论 === 'warn' ? '#e0b070' : '#c98080',
                    },
                  },
                  (自检.统计.结论 === 'ok' ? '✓ 都正常' : 自检.统计.结论 === 'warn' ? '⚠ 有几项该看看' : '✗ 有东西坏了') +
                    ' —— 正常 ' + (自检.统计.ok || 0) + ' / 要留意 ' + (自检.统计.warn || 0) + ' / 坏了 ' + (自检.统计.fail || 0) +
                    (自检.兜底 ? '（读不到 live 服务，只跑了兜底检查）' : ''),
                )
              : null,
            自检 && 自检.项们 && 自检.项们.length
              ? el(
                  'div',
                  null,
                  自检.项们.map((x, i) =>
                    el(
                      'div',
                      {
                        key: 'hc' + i,
                        style: Object.assign({}, S.row, {
                          alignItems: 'baseline',
                          borderBottom: '1px solid rgba(128,128,128,.12)',
                          padding: '4px 0',
                        }),
                      },
                      el('span', { style: { flex: '0 0 16px', fontSize: 12, color: x.状态 === 'ok' ? '#8fd0a0' : x.状态 === 'warn' ? '#e0b070' : '#c98080' } }, x.状态 === 'ok' ? '✓' : x.状态 === 'warn' ? '!' : '✗'),
                      el('span', { style: { flex: '0 0 132px', fontSize: 12, whiteSpace: 'nowrap' } }, String(x.名 || '')),
                      el(
                        'div',
                        { style: { flex: '1 1 0', minWidth: 0 } },
                        el('div', { style: Object.assign({}, S.dim, { fontSize: 11.5, wordBreak: 'break-all' }) }, String(x.说明 || '')),
                        x.细节 ? el('div', { style: Object.assign({}, S.dim, { fontSize: 11, opacity: 0.78, marginTop: 2, wordBreak: 'break-all' }) }, String(x.细节)) : null,
                      ),
                    ),
                  ),
                )
              : el('div', { style: S.dim }, '还没跑过。'),
          ),
        }),
        // ---------- ① 临场提醒（每轮拼在记忆最后的一段固定文字）----------
        折({
          标题: '临场提醒',
          注: 提醒字 + ' / ' + 上限 + ' 字' + (提醒 ? ' · 正在生效' : ' · 空着就不注入'),
          开: 开提醒,
          on切: set开提醒,
          children: el(
            'div',
            null,
            el(
              'div',
              { style: Object.assign({}, S.dim, { fontSize: 11.5, lineHeight: 1.55, marginBottom: 6 }) },
              '每轮都会追加到记忆「最后面」的一段固定文字 —— 用来自查这一轮的回复：语气对不对、有没有抢戏、有没有公文腔。只对自己的话管用，不写进记忆库、不占注入名额。',
            ),
            el('textarea', {
              style: 多行,
              value: 提醒,
              maxLength: 上限,
              placeholder: '例：每次回复前先想清楚——主人在说什么情绪、这轮该先用什么称呼、开头一句反应、中间讲正事、结尾一句收尾。别抢戏、别点句号。',
              onChange: (e) => {
                set提醒(e.target.value)
                if (提醒存) set提醒存('')
              },
            }),
            el(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' } },
              el(
                'button',
                { style: Object.assign({}, S.btn, { fontSize: 12, padding: '4px 10px' }), disabled: 提醒存 === '保存中…', onClick: 存提醒 },
                提醒存 === '保存中…' ? '保存中…' : '保存',
              ),
              el(
                'button',
                { style: Object.assign({}, S.btn, { fontSize: 12, padding: '4px 10px' }), onClick: () => { set提醒(''); set提醒存('') } },
                '清空',
              ),
              el('span', { style: Object.assign({}, S.dim, { fontSize: 11 }) }, '改完下一轮就生效，不用重启'),
              提醒存 ? el('span', { style: Object.assign({}, S.ok, { fontSize: 11 }) }, 提醒存) : null,
            ),
          ),
        }),
        // ---------- ② 回复体检（原有内容，收进折叠区）----------
        折({
          标题: '回复体检',
          注: 数据 ? 汇总.count + ' 条 · 命中率 ' + 汇总.hitRate + '%' : '词面规则 · 只观察不阻断',
          开: 开体检,
          on切: set开体检,
          children: el(
            'div',
            null,
            el('div', { style: S.dim }, '用词面规则给助手最近的回复打「AI 味」标签：只观察、不阻断、不改写。技术语境里的「不是 A 而是 B」这类排查句式会豁免。'),
            el(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' } },
              el('span', { style: S.dim }, '最近'),
              el('input', { style: S.inp, value: 天数, onChange: (e) => set天数(Number(e.target.value) || 14) }),
              el('span', { style: S.dim }, '天，取最近'),
              el('input', { style: S.inp, value: 条数, onChange: (e) => set条数(Number(e.target.value) || 20) }),
              el('span', { style: S.dim }, '条回复'),
              el('button', { style: S.btn, onClick: 载, disabled: 忙 }, 忙 ? '…' : '刷新'),
            ),
            错 ? el('div', { style: S.drop }, 错) : null,
            数据 ? el('div', { style: S.nameBox }, '共 ' + 汇总.count + ' 条 · 命中 ' + 汇总.totalHits + ' 次 · 命中率 ' + 汇总.hitRate + '% · 扫了 ' + 数据.files + ' 个会话文件') : null,
            数据 ? el('div', { style: S.h }, '规则开关') : null,
            数据
              ? el(
                  'div',
                  null,
                  (数据.rules || []).map((r) =>
                    el(
                      'div',
                      { key: r.id, style: { display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' } },
                      el('input', { type: 'checkbox', checked: r.enabled, onChange: () => 切规则(r.id) }),
                      el('span', { style: r.enabled ? {} : S.dim }, r.label),
                      el('span', { style: S.dim }, '(' + r.count + ')'),
                    ),
                  ),
                )
              : null,
            数据 ? el('div', { style: S.h }, '最近回复') : null,
            数据
              ? el(
                  'div',
                  null,
                  (数据.messages || [])
                    .slice()
                    .reverse()
                    .map((m) =>
                      el(
                        'div',
                        { key: (m.sessionId || '') + ':' + m.seq, style: Object.assign({}, S.条, { padding: '8px 0' }) },
                        el(
                          'div',
                          { style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' } },
                          el('span', { style: S.dim }, String(m.length) + ' 字'),
                          el('span', { style: S.dim }, '得分 ' + m.score),
                          ...(m.hits || []).map((h) =>
                            el(
                              'span',
                              { key: h.id, style: { padding: '1px 6px', borderRadius: 4, background: 'rgba(224,176,112,.18)', border: '1px solid rgba(224,176,112,.4)', fontSize: 11.5 } },
                              h.label + ' ' + Math.round((h.confidence || 0) * 100) + '%',
                            ),
                          ),
                        ),
                        el('div', { style: { fontSize: 12.5, marginTop: 4, color: 'var(--dsw-alias-label-secondary, #8a8a8a)' } }, m.text),
                        m.hits && m.hits.length
                          ? el('div', { style: { fontSize: 11.5, marginTop: 2, color: 'var(--dsw-alias-label-tertiary, #999)' } }, m.hits.map((h) => h.evidence).join(' ｜ '))
                          : null,
                      ),
                    ),
                )
              : null,
          ),
        }),
        // ---------- ③ 重复整理（存量重复自查自合）----------
        折({
          标题: '重复整理',
          注: 整理
            ? (整理.待合 ? 整理.待合 + ' 对可以合' : '现在没有重复') +
              (整理.上次 ? ' · 上次 ' + String(整理.上次).slice(5, 16).replace('T', ' ') : '')
            : '还没跑过',
          开: 开整理,
          on切: set开整理,
          children: el(
            'div',
            null,
            el(
              'div',
              { style: Object.assign({}, S.dim, { fontSize: 11.5, lineHeight: 1.55, marginBottom: 6 }) },
              '每 24 小时自己查一次：库里「短条的内容长条全都有」那种真重复会自动合掉，被合的那条进回收站、随时能捞回来。汇总型（长条包住好几条不同的事）一律不碰，只列给人看。',
            ),
            el(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' } },
              el(
                'button',
                { style: Object.assign({}, S.btn, { fontSize: 12, padding: '4px 10px' }), disabled: 整理中 === '整理中…', onClick: 跑整理 },
                整理中 === '整理中…' ? '整理中…' : '现在整理一次',
              ),
              整理后 ? el('span', { style: Object.assign({}, S.ok, { fontSize: 11 }) }, 整理后) : null,
              整理中 && 整理中 !== '整理中…' ? el('span', { style: S.drop, fontSize: 11 }, 整理中) : null,
            ),
            (整理 && 整理.历史 && 整理.历史.length
              ? 整理.历史
              : []
            ).map((h, i) =>
              el(
                'div',
                { key: 'h' + i, style: Object.assign({}, S.条, { padding: '6px 0' }) },
                el(
                  'div',
                  { style: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' } },
                  el('span', { style: S.dim }, String(h.时间 || '').slice(5, 16).replace('T', ' ')),
                  el('span', {}, '合了 ' + (h.合了 || 0) + ' 对'),
                  el('span', { style: S.dim }, '省 ' + (h.省下 || 0) + ' 字'),
                ),
                (h.明细 || []).map((d, j) =>
                  el(
                    'div',
                    { key: 'd' + j, style: { fontSize: 11.5, marginTop: 3, color: 'var(--dsw-alias-label-secondary, #8a8a8a)' } },
                    '· ' + String(d.摘要 || '').slice(0, 30) + '… （' + (d.合前 || '') + ' → ' + (d.合后 || '') + '）',
                  ),
                ),
              ),
            ),
          ),
        }),
        // ---------- ④ 陈旧检查（记忆里写的路径现在还在不在）—— 1.12.79 起默认不显示 ----------
        启用陈旧检查 ? 折({
          标题: '陈旧检查',
          注: 陈旧
            ? (陈旧.统计 && 陈旧.统计.待确认 ? 陈旧.统计.待确认 + ' 条待确认' : '没有失效的路径') +
              (陈旧.上次检查 ? ' · 上次 ' + String(陈旧.上次检查).slice(5, 16).replace('T', ' ') : '')
            : '还没跑过',
          开: 开陈旧,
          on切: set开陈旧,
          children: el(
            'div',
            null,
            el(
              'div',
              { style: Object.assign({}, S.dim, { fontSize: 11.5, lineHeight: 1.55, marginBottom: 6 }) },
              '每 24 小时自己扫一遍记忆里提到的路径，只看「这个东西现在还在不在盘上」，不判断这条记忆对不对。东西搬走、记错位置、路径换写法都可能命中，所以每一条都要人看一眼再决定。标成过时不会删原件，随时能恢复。',
            ),
            el(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' } },
              el(
                'button',
                { style: Object.assign({}, S.btn, { fontSize: 12, padding: '4px 10px' }), disabled: 陈旧忙 === '扫着…', onClick: 立刻扫陈旧 },
                陈旧忙 === '扫着…' ? '扫着…' : '现在扫一次',
              ),
              陈旧后 ? el('span', { style: Object.assign({}, S.ok, { fontSize: 11 }) }, 陈旧后) : null,
              陈旧忙 && 陈旧忙 !== '扫着…' && 陈旧忙 !== '处置中…' ? el('span', { style: S.drop, fontSize: 11 }, 陈旧忙) : null,
            ),
            (陈旧 && 陈旧.待确认 && 陈旧.待确认.length
              ? 陈旧.待确认
              : []
            ).map((x) =>
              el(
                'div',
                { key: 'st' + x.键, style: Object.assign({}, S.条, { padding: '8px 0' }) },
                el(
                  'div',
                  { style: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' } },
                  el('span', { style: { fontSize: 12.5, fontWeight: 600, wordBreak: 'break-all' } }, x.字面 || x.键),
                  el('span', { style: S.dim, fontSize: 11 }, (x.命中记忆 || []).length + ' 条记忆提到它'),
                  x.伴随有效路径
                    ? el('span', { style: Object.assign({}, S.secTag, { background: 'rgba(143,208,160,.16)', color: '#8fd0a0' }) }, '同一句里还有有效路径')
                    : null,
                  x.疑似历史说明
                    ? el('span', { style: Object.assign({}, S.secTag, { background: 'rgba(224,176,112,.16)', color: '#e0b070' }) }, '像在说以前的事')
                    : null,
                ),
                (x.命中记忆 || []).map((m, i) =>
                  el(
                    'div',
                    { key: 'sm' + i, style: { fontSize: 11.5, marginTop: 3, color: 'var(--dsw-alias-label-secondary, #8a8a8a)' } },
                    '· ' + String(m.摘录 || '').slice(0, 60),
                  ),
                ),
                el(
                  'div',
                  { style: { display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' } },
                  el(
                    'button',
                    {
                      style: Object.assign({}, S.btn, { fontSize: 11.5, padding: '3px 9px', opacity: 陈旧护栏(x) ? 0.7 : 1 }),
                      // 2026-11-22：护栏不再把按钮按死。机械规则再准也会冤枉人（比如那条排坑记忆），
                      //   最后一下该由人拍 —— 点了弹二次确认，确认过带 强制 交给后端放行。
                      disabled: 陈旧忙 === '处置中…',
                      title: 陈旧护栏(x) ? '机械护栏：' + 陈旧护栏(x) + '（点一下会再问你一次）' : '标成过时之后召回不再出它，原件还在，随时能撤销',
                      onClick: () => {
                        const 栏 = 陈旧护栏(x)
                        if (栏) {
                          const 敢 =
                            typeof window === 'undefined' || !window.confirm
                              ? true
                              : window.confirm(
                                  '机械护栏说：' +
                                    栏 +
                                    '\n\n这条可能是在举例或列举，标成过时会连排坑知识一起不召回。\n原件不删，标完还能撤销。确定要标吗？',
                                )
                          if (!敢) return
                        }
                        处置陈旧(x.键, 'confirm', !!栏)
                      },
                    },
                    '标成过时（不再召回）',
                  ),
                  el(
                    'button',
                    { style: Object.assign({}, S.btn, { fontSize: 11.5, padding: '3px 9px' }), disabled: 陈旧忙 === '处置中…', onClick: () => 处置陈旧(x.键, 'ignore') },
                    '留着，别管它',
                  ),
                  陈旧护栏(x) ? el('span', { style: Object.assign({}, S.dim, { fontSize: 11 }) }, '· ' + 陈旧护栏(x)) : null,
                ),
              ),
            ),
            陈旧 && 陈旧.待确认 && !陈旧.待确认.length
              ? el('div', { style: S.dim }, '没有待确认的路径。')
              : null,
            (陈旧 && 陈旧.已处置 && 陈旧.已处置.length
              ? el(
                  'div',
                  { style: { marginTop: 10 } },
                  el('div', { style: Object.assign({}, S.dim, { fontSize: 11.5, marginBottom: 4 }) }, '已标成过时的（召回不再出这些，还能撤销）：'),
                  陈旧.已处置.map((x) =>
                    el(
                      'div',
                      {
                        key: 'sc' + x.键,
                        style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, marginTop: 3, flexWrap: 'wrap' },
                      },
                      el('span', { style: { wordBreak: 'break-all' } }, '· ' + (x.字面 || x.键)),
                      x.处置于 ? el('span', { style: S.dim }, String(x.处置于).slice(0, 16).replace('T', ' ')) : null,
                      el(
                        'button',
                        {
                          style: Object.assign({}, S.btn, { fontSize: 11, padding: '2px 8px' }),
                          disabled: 陈旧忙 === '处置中…',
                          title: '撤销之后这条记忆又会出现在召回里',
                          onClick: () => 处置陈旧(x.键, 'undo'),
                        },
                        '撤销',
                      ),
                    ),
                  ),
                )
              : null),
            (陈旧 && 陈旧.已恢复 && 陈旧.已恢复.length
              ? el(
                  'div',
                  { style: { marginTop: 10 } },
                  el('div', { style: Object.assign({}, S.dim, { fontSize: 11.5, marginBottom: 4 }) }, '已经恢复的（路径又在了）：'),
                  陈旧.已恢复.map((x) =>
                    el(
                      'div',
                      {
                        key: 'sr' + x.键,
                        style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, marginTop: 3, flexWrap: 'wrap', color: 'var(--dsw-alias-label-secondary, #8a8a8a)' },
                      },
                      el('span', { style: { wordBreak: 'break-all' } }, '· ' + (x.字面 || x.键)),
                      (x.已处置 && x.已处置.length) || x.处置于
                        ? el(
                            'button',
                            {
                              style: Object.assign({}, S.btn, { fontSize: 11, padding: '2px 8px' }),
                              disabled: 陈旧忙 === '处置中…',
                              title: '之前因路径失效标过「过时」，现在路径回来了，点这里把记忆恢复进召回',
                              onClick: () => 处置陈旧(x.键, 'undo'),
                            },
                            '恢复记忆（撤销过时）',
                          )
                        : null,
                    ),
                  ),
                )
              : null),
          ),
        }) : null,
      )
  }

  return 回复体检页
}
