// ============================================================================
// 历史补记（F25）—— 1.12.84
//
//   选一个历史会话 → 按当前规则重新提取候选 → 跟现有库比出「新增/改写/跳过」→
//   人看一眼勾选 → 写进去打成一个批次 → 反悔了整批撤销。
//
// 后端接口（lib/routes-backfill.mjs，1.12.84 就绪）：
//   GET  /dsh-clay-memory/backfill/sessions  → { ok, 会话根, 数量, 会话们:[{会话,条数,用户,助手,字节,时间,已补记,文件}] }
//   POST /dsh-clay-memory/backfill/preview   → { ok, 候选:[{text,动作,撞上,为什么}], 计:{add,update,noop}, 文本长度, 秒 }
//   POST /dsh-clay-memory/backfill/apply     → { ok, 批次, 删了/加了, id们 }
//   GET  /dsh-clay-memory/backfill/batches   → { ok, 批次们:[{批次,条数,会话,时间}] }
//   POST /dsh-clay-memory/backfill/undo      → { ok, 删了, 恢复了 }
//
// ⚠ 这一页的花 token 只有「预览」一下（一次模型请求）。列会话、应用、撤销都不调模型。
// ============================================================================
export function 造补记页({ React, el, get, post, S, 初始会话 }) {
  const { useState, useEffect } = React

  const 动作名 = { add: '新增', update: '改写', noop: '跳过' }
  const 动作色 = {
    add: 'var(--dsw-alias-state-success-primary, #2f8f5b)',
    update: 'var(--dsw-alias-state-warning-primary, #b7791f)',
    noop: 'var(--dsw-alias-label-secondary, #888)',
  }

  function 时长(字节) {
    const n = Number(字节) || 0
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + 'MB'
    return Math.round(n / 1024) + 'KB'
  }

  function 那天(毫秒) {
    const n = Number(毫秒)
    if (!n || !isFinite(n)) return ''
    const d = new Date(n)
    const p = (x) => String(x).padStart(2, '0')
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
  }

  function 补记页(props) {
    // 1.12.86: 放进会话详情当页签时，panel 会传 { 初始会话: s.id }
    const 想要的会话 = (props && props.初始会话) || 初始会话 || ''
    // 1.12.86：从会话详情的「补记」页签进来时，会话已经定了 —— 第一步「选会话」整块不出。
    const 直接进 = !!想要的会话
    const [会话们, set会话们] = useState([])
    const [选中, set选中] = useState('')
    const [候选, set候选] = useState(null)
    const [勾, set勾] = useState({})
    const [批次们, set批次们] = useState([])
    const [忙, set忙] = useState('')
    const [错, set错] = useState('')
    const [提示, set提示] = useState('')

    function 拉会话() {
      set忙('会话')
      set错('')
      get('/backfill/sessions')
        .then((r) => {
          if (!r || !r.ok) {
            set错((r && r.error) || '拿不到会话列表')
            set会话们([])
            return
          }
          set会话们(Array.isArray(r.会话们) ? r.会话们 : [])
          // 1.12.86: 从会话详情跳过来时带着 id，优先选它（省掉「再挑一遍会话」）
          if (!选中) {
            const 想要 = (r.会话们 || []).find((x) => x.会话 === 想要的会话)
            if (想要) set选中(想要.文件)
            else if (r.会话们 && r.会话们.length) set选中(r.会话们[0].文件)
          }
        })
        .catch((e) => set错(String((e && e.message) || e)))
        .finally(() => set忙(''))
    }

    function 拉批次() {
      get('/backfill/batches')
        .then((r) => {
          if (r && r.ok) {
            const 全 = Array.isArray(r.批次们) ? r.批次们 : []
            // 1.12.86：在会话详情里的「补记」页签，只看得见这个会话的批次 ——
            //   撤销是按「批次」走的、不按会话，把别的会话的批次也列出来太容易误点。
            set批次们(想要的会话 ? 全.filter((b) => b.会话 === 想要的会话) : 全)
          }
        })
        .catch(() => {})
    }

    useEffect(() => {
      拉会话()
      拉批次()
      // eslint-disable-next-line
    }, [])

    const 这条 = 会话们.find((x) => x.文件 === 选中) || null

    function 试提取() {
      if (!这条) return
      set忙('预览')
      set错('')
      set提示('')
      set候选(null)
      post('/backfill/preview', { 会话: 这条.会话, 文件: 这条.文件 })
        .then((r) => {
          if (!r || !r.ok) {
            set错((r && (r.error || r.message)) || '提取失败')
            return
          }
          set候选(r)
          // 默认勾上「新增」和「改写」，「跳过」不勾（跟人想的一样：重复的别再写一遍）
          const 新勾 = {}
          ;(r.候选 || []).forEach((c, i) => {
            if (c.动作 !== 'noop') 新勾[i] = true
          })
          set勾(新勾)
        })
        .catch((e) => set错(String((e && e.message) || e)))
        .finally(() => set忙(''))
    }

    function 写进去() {
      if (!候选 || !这条) return
      const 通过 = (候选.候选 || []).filter((c, i) => 勾[i])
      if (!通过.length) {
        set错('一条都没勾，没什么可写的')
        return
      }
      set忙('应用')
      set错('')
      post('/backfill/apply', { 会话: 这条.会话, 通过 })
        .then((r) => {
          if (!r || !r.ok) {
            set错((r && (r.error || r.message)) || '写入失败')
            return
          }
          set提示('写进去了，批次 ' + String(r.批次 || '') + '；反悔的话在下面点「撤销」')
          set候选(null)
          set勾({})
          拉会话()
          拉批次()
        })
        .catch((e) => set错(String((e && e.message) || e)))
        .finally(() => set忙(''))
    }

    function 撤批次(批) {
      if (!批) return
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        if (!window.confirm('撤销批次 ' + 批 + '？\n\n· 这一批写进去的条目会被删掉\n· 被它取代的旧条目会恢复原样')) return
      }
      set忙('撤销')
      set错('')
      set提示('')
      post('/backfill/undo', { 批次: 批 })
        .then((r) => {
          if (!r || !r.ok) {
            set错((r && (r.error || r.message)) || '撤销失败')
            return
          }
          set提示('撤销了：删掉 ' + Number(r.删了 || 0) + ' 条，恢复 ' + Number(r.恢复了 || 0) + ' 条')
          拉批次()
          拉会话()
        })
        .catch((e) => set错(String((e && e.message) || e)))
        .finally(() => set忙(''))
    }

    const 计 = (候选 && 候选.计) || null

    return el(
      'div',
      { style: S.wrap },
      // ── 说明 ──
      el(
        'div',
        { style: S.dim },
        '挑一个以前聊过、但当时没记下来的会话，按你现在的偏好重新过一遍，提取出该记的条目。' +
          '先给你看、你来勾，确认了才写；写进去打成一个批次，反悔能整批撤掉。',
      ),
      el('div', { style: { ...S.dim, marginTop: 4 } }, '只有「预览」这一步会调一次模型，其余都不花 token。'),

      // ── 第一步：选会话 ──
      直接进 ? null : el('div', { style: S.sec }, el('div', { style: S.secH }, el('span', { style: S.secTitle }, '① 选一个历史会话'))),
      直接进 ? null : el(
        'div',
        { style: { ...S.row, marginTop: 6 } },
        el('button', { style: S.btn, onClick: 拉会话, disabled: !!忙 }, 忙 === '会话' ? '刷新中…' : '刷新列表'),
        el('span', { style: S.dim }, '共 ' + 会话们.length + ' 个（读对话 ≥6 条、助手至少回 2 句的）'),
      ),
      直接进 ? null : 会话们.length === 0
        ? el('div', { style: { ...S.dim, marginTop: 6 } }, '没有可补记的会话。')
        : el(
            'select',
            {
              style: { ...S.inp, marginTop: 6, width: '100%' },
              value: 选中,
              onChange: (e) => {
                set选中(e.target.value)
                set候选(null)
                set勾({})
              },
            },
            会话们.map((x) =>
              el(
                'option',
                { key: x.会话, value: x.文件 },
                (x.已补记 ? '✓ ' : '') +
                  x.会话.slice(0, 20) +
                  ' · ' +
                  x.条数 +
                  ' 条（我 ' +
                  x.用户 +
                  ' / 你 ' +
                  x.助手 +
                  '）· ' +
                  时长(x.字节) +
                  ' · ' +
                  那天(x.时间),
              ),
            ),
          ),

      直接进 ? el('div', { style: { ...S.dim, marginTop: 6 } }, '补记的就是这个会话，不用再挑。') : null,

      // ── 第二步：预览 ──
      el('div', { style: S.sec }, el('div', { style: S.secH }, el('span', { style: S.secTitle }, '看它想记什么'))),
      el(
        'div',
        { style: { ...S.row, marginTop: 6 } },
        el('button', { style: S.btn, onClick: 试提取, disabled: !!忙 || !这条 }, 忙 === '预览' ? '正在读…（要调一次模型）' : '试提取一下'),
        计
          ? el(
              'span',
              { style: S.dim },
              '新增 ' + Number(计.add || 0) + ' · 改写 ' + Number(计.update || 0) + ' · 跳过 ' + Number(计.noop || 0),
              '　原文 ' + Number(候选.文本长度 || 0) + ' 字' + (候选.秒 ? '　花了 ' + 候选.秒 + ' 秒' : ''),
            )
          : el('span', { style: S.dim }, '这一步会花 token'),
      ),

      候选 && (候选.候选 || []).length === 0
        ? el('div', { style: { ...S.dim, marginTop: 6 } }, '这段对话里没有值得记的新东西。')
        : null,

      候选 && (候选.候选 || []).length > 0
        ? el(
            'div',
            { style: { marginTop: 8 } },
            (候选.候选 || []).map((c, i) =>
              el(
                'div',
                {
                  key: i,
                  style: {
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-start',
                    padding: '6px 8px',
                    borderRadius: 6,
                    background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.06))',
                    marginBottom: 4,
                  },
                },
                el('input', {
                  type: 'checkbox',
                  checked: !!勾[i],
                  disabled: c.动作 === 'noop',
                  onChange: (e) => set勾((p) => ({ ...p, [i]: e.target.checked })),
                  style: { marginTop: 3 },
                }),
                el(
                  'div',
                  { style: { flex: 1, minWidth: 0 } },
                  el('div', { style: { display: 'flex', gap: 6, alignItems: 'baseline' } },
                    el('span', { style: { fontSize: 11.5, color: 动作色[c.动作] || 'inherit', fontWeight: 600 } }, 动作名[c.动作] || c.动作 || '?'),
                    c.为什么 ? el('span', { style: { ...S.dim, fontSize: 11 } }, c.为什么) : null,
                  ),
                  el('div', { style: { fontSize: 12.5, marginTop: 2, wordBreak: 'break-word' } }, String(c.text || '')),
                  c.撞上 ? el('div', { style: { ...S.dim, fontSize: 11, marginTop: 2 } }, '跟这条像：' + String(c.撞上)) : null,
                ),
              ),
            ),
            el(
              'div',
              { style: { ...S.row, marginTop: 8 } },
              el('button', { style: S.btn, onClick: 写进去, disabled: !!忙 }, 忙 === '应用' ? '写入中…' : '把勾上的写进去'),
              el('span', { style: S.dim }, '写进去的都在这个批次里，能整批撤'),
            ),
          )
        : null,

      // ── 第三步：批次 ──
      el(
        'div',
        { style: S.sec },
        el('div', { style: S.secH }, el('span', { style: S.secTitle }, '补记批次')),
        el('span', { style: S.secTag }, 批次们.length + ' 个'),
      ),
      批次们.length === 0
        ? el('div', { style: { ...S.dim, marginTop: 6 } }, '还没有补记过。')
        : el(
            'div',
            { style: { marginTop: 6 } },
            批次们.slice(0, 12).map((b) =>
              el(
                'div',
                { key: b.批次, style: { ...S.row, padding: '4px 0', borderBottom: '1px solid rgba(128,128,128,.12)' } },
                el('span', { style: { fontFamily: 'monospace', fontSize: 11.5 } }, String(b.批次 || '')),
                el('span', { style: S.dim }, Number(b.条数 || 0) + ' 条'),
                el('span', { style: { ...S.dim, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, 那天(b.时间)),
                el('button', { style: S.btnDanger, onClick: () => 撤批次(b.批次), disabled: !!忙 }, 忙 === '撤销' ? '撤销中…' : '撤销'),
              ),
            ),
          ),

      错 ? el('div', { style: { ...S.drop, marginTop: 10 } }, 错) : null,
      提示 ? el('div', { style: { ...S.ok, marginTop: 10 } }, 提示) : null,
    )
  }

  return { 补记页 }
}
