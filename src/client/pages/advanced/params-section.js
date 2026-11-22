// 高级区 · 记忆策略参数表单
const GROUPS = [
  ['weight', '权重', '决定「什么更容易被想起来」。四项加起来必须是 100% —— 你改一项，其余三项自动让位，你填的数会尽量保住。'],
  ['time', '遗忘速度', '数字越大 = 忘得越慢。淡了只是不容易被想起来，不会删。'],
  ['gate', '门槛与条数', '控制「一次塞多少给她」。'],
]

export function 造参数区({ React, el, get, post, S, toPct, fromPct }) {
  function 参数区() {
    const [params, setParams] = React.useState(null)
    const [spec, setSpec] = React.useState(null)
    const [pin, setPin] = React.useState(null) // 她刚改的那一项权重
    const [editing, setEditing] = React.useState(null) // 正在打字的那格（原样显示她敲的字）
    const [notes, setNotes] = React.useState(null)
    const [busy, setBusy] = React.useState(false)
    const [开, set开] = React.useState(false) // ⭐ 默认收起（调一次就不动，不占地方）
    const [均长, set均长] = React.useState(0) // ⭐ F10 阶段 0（1.12.25）：当前库平均条长，用来算名额×字长的联动
    const load = React.useCallback(() => {
      get('/list')
        .then((x) => {
          if (x && x.policy) setParams(Object.assign({}, x.policy))
          setSpec(Array.isArray(x && x.spec) ? x.spec.slice() : [])
          setNotes(null)
        })
        .catch((e) => setNotes(['读不到参数：' + String((e && e.message) || e)]))
      get('/health?days=7')
        .then((h) => set均长(Number(h && h.汇总 && h.汇总.平均字数) || 0))
        .catch(() => {})
    }, [])
    React.useEffect(() => {
      load()
    }, [load])
  
    // 折叠头（照原「会话 → 参数」的样子：▸ 参数 · 调一次就不动 · 点开调）
    const 头 = el(
      'div',
      { style: Object.assign({}, S.secH, { cursor: 'pointer', marginBottom: 开 ? 8 : 0 }), onClick: () => set开(!开) },
      el('span', { style: S.secTitle }, (开 ? '▾ ' : '▸ ') + '参数'),
      el('span', { style: S.secTag }, '调一次就不动 · 点开调'),
    )
    if (!开) return el('div', { style: S.sec }, 头)
    if (!params || !spec) return el('div', { style: S.sec }, 头, el('div', { style: S.dim }, '正在读参数…'))
  
    const WK = spec.filter((s) => s.group === 'weight').map((s) => s.key)
    const wSum = WK.length ? Math.round(WK.reduce((a, k) => a + toPct(params[k] || 0), 0) * 10) / 10 : 0
    const setOne = (k, native) => {
      // 函数式更新 —— 连着改两格不会互相覆盖 ✓
      setParams((prev) => Object.assign({}, prev, { [k]: native }))
      if (WK.indexOf(k) >= 0) setPin(k)
      setNotes(null)
    }
    const oneRow = (s) => {
      const isW = s.group === 'weight'
      const lo = isW ? toPct(s.min) : s.min
      const hi = isW ? toPct(s.max) : s.max
      const cur = isW ? toPct(params[s.key]) : params[s.key]
      const typing = editing && editing.key === s.key
      const unit = isW ? '%' : s.unit || ''
      const head = [
        el('span', { key: 'lbl', style: { flex: '0 0 auto', fontSize: 12 } }, s.label),
        el('input', {
          key: 'inp',
          type: 'number',
          style: Object.assign({}, S.inp, { fontSize: 12, width: 64, padding: '3px 6px' }),
          min: lo,
          max: hi,
          step: isW ? 0.1 : s.step,
          value: typing ? editing.text : String(cur),
          onChange: (e) => {
            const t = e.target.value
            setEditing({ key: s.key, text: t })
            const n = Number(t)
            if (t !== '' && isFinite(n)) setOne(s.key, isW ? fromPct(n) : n)
          },
          onBlur: () => setEditing(null),
        }),
      ]
      if (unit) head.push(el('span', { key: 'unit', style: Object.assign({}, S.dim, { fontSize: 12 }) }, unit))
      head.push(el('span', { key: 'rng', style: Object.assign({}, S.dim, { fontSize: 11, opacity: 0.7 }) }, '（' + lo + ' ~ ' + hi + '）'))
      // ⭐ F10 阶段 0（1.12.25）：名额 × 字长的联动 —— 光看数字看不出「6 条 × 176 字 > 800 预算」
      const 估 = (() => {
        const 均 = Number(均长) || 0
        const 预算 = Number(params.maxChars) || 0
        if (!均 || !预算) return null
        if (s.key === 'factsMax' && Number(cur) > 0) {
          const 名义 = Math.round(均 * Number(cur))
          if (名义 > 预算) {
            const 能进 = Math.min(Number(cur), Math.floor(预算 / 均))
            return { 超: true, text: '按当前库均长 ' + 均 + ' 字算：' + cur + ' 条 × ' + 均 + ' 字 = ' + 名义 + ' 字，超出 ' + 预算 + ' 字预算，实际大约只能进 ' + 能进 + ' 条' }
          }
          return { 超: false, text: '按当前库均长 ' + 均 + ' 字算：' + cur + ' 条 × ' + 均 + ' 字 = ' + 名义 + ' 字，' + 预算 + ' 字预算装得下' }
        }
        if (s.key === 'maxChars' && Number(cur) > 0) {
          return { 超: false, text: '按当前库均长 ' + 均 + ' 字算：这个预算大约装得下 ' + Math.floor(Number(cur) / 均) + ' 条（名额 ' + (Number(params.factsMax) || 0) + ' 条）' }
        }
        return null
      })()
      return el(
        'div',
        { key: s.key, style: { margin: '5px 0' } },
        el('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' } }, head),
        估
          ? el(
              'div',
              { style: Object.assign({}, S.dim, { fontSize: 11, marginTop: 1, lineHeight: 1.45 }, 估.超 ? { color: '#c2410c', opacity: 0.95 } : { opacity: 0.75 }) },
              估.text,
            )
          : null,
        s.tip
          ? el('div', { style: Object.assign({}, S.dim, { fontSize: 11, marginTop: 1, lineHeight: 1.45, opacity: 0.85 }) }, s.tip)
          : null,
      )
    }
    const save = (body) => {
      setBusy(true)
      setNotes(null)
      post('/policy', body)
        .then((r) => {
          if (r && r.policy) setParams(Object.assign({}, r.policy))
          setNotes((r && r.notes) || [])
          setBusy(false)
          load()
        })
        .catch((e) => {
          setBusy(false)
          setNotes(['保存失败：' + ((e && e.message) || e)])
        })
    }
    const blocks = []
    for (const [gid, gname, gtip] of GROUPS) {
      const rows = spec.filter((s) => s.group === gid)
      if (!rows.length) continue
      blocks.push(el('div', { key: gid, style: Object.assign({}, S.h, { fontSize: 12, marginTop: 10, marginBottom: 2 }) }, gname))
      blocks.push(el('div', { key: gid + '-tip', style: Object.assign({}, S.dim, { fontSize: 11, opacity: 0.85 }) }, gtip))
      if (gid === 'weight') {
        blocks.push(
          el(
            'div',
            { key: 'wsum', style: { margin: '6px 0 2px', fontSize: 12 } },
            el('span', { style: { display: 'inline-block', width: 96 } }, '合计'),
            el('span', { style: wSum === 100 ? S.ok : S.warn, fontWeight: 600, fontSize: 12 }, wSum + '%'),
            wSum === 100
              ? el('span', { style: Object.assign({}, S.dim, { marginLeft: 8, fontSize: 11 }) }, '正好 ✓')
              : el('span', { style: Object.assign({}, S.dim, { marginLeft: 8, fontSize: 11 }) }, '不是 100% —— 保存时会自动调平'),
          ),
        )
      }
      for (const s of rows) blocks.push(oneRow(s))
    }
    return el(
      'div',
      { style: S.sec },
      头,
      el('div', { style: Object.assign({}, S.dim, { fontSize: 11, marginBottom: 2 }) }, '这些是所有会话共用的。每项都有范围，超出会被收到范围内。'),
      blocks,
      el(
        'div',
        { style: { marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' } },
        el('button', { style: Object.assign({}, S.btn, { fontSize: 12, padding: '4px 10px' }), disabled: busy, onClick: () => save(Object.assign({}, params, { pin })) }, busy ? '保存中…' : '保存参数'),
        el('button', { style: Object.assign({}, S.btn, { fontSize: 12, padding: '4px 10px' }), disabled: busy, onClick: () => save({ reset: true }) }, '恢复默认'),
        el('button', { style: Object.assign({}, S.btn, { fontSize: 12, padding: '4px 10px' }), disabled: busy, onClick: () => load() }, '刷新'),
      ),
      notes && notes.length
        ? el('div', { style: Object.assign({}, S.warn, { marginTop: 8, fontSize: 11, whiteSpace: 'pre-line' }) }, '　· ' + notes.join('\n　· '))
        : null,
    )
  }
  return 参数区
}
