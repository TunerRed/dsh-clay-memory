// 时间线页 —— F14（1.12.12）：按天看「那天记了什么、又想起过什么」。
// 记忆页回答「有什么」，这一页只回答「节奏」：哪天记得多、哪天一条没记、哪天问了却一次没想起来。
export function 造时间线页({ React, el, get, S, G, 类型名 }) {
  const 天数们 = [7, 14, 30]

  return function 时间线页() {
    const [天, set天] = React.useState(14)
    const [d, setD] = React.useState(null)
    const [错, set错] = React.useState(null)
    const [载, set载] = React.useState(true)

    React.useEffect(() => {
      let 活了 = true
      set载(true)
      set错(null)
      get('/timeline?days=' + 天)
        .then((r) => {
          if (!活了) return
          if (!r || r.ok === false) set错(((r && r.message) || '拉不到时间线'))
          else setD(r)
          set载(false)
        })
        .catch((e) => {
          if (!活了) return
          set错(String((e && e.message) || e))
          set载(false)
        })
      return () => {
        活了 = false
      }
    }, [天])

    const 标 = (x) => {
      const 名 = 类型名 ? 类型名(x) : x
      return el(
        'span',
        { key: 'b-' + x, style: Object.assign({}, G.badge, { marginLeft: 4, opacity: 0.75 }) },
        String(名 || x || ''),
      )
    }

    const 顶 = el(
      'div',
      { style: Object.assign({}, S.secH, { marginBottom: 8 }) },
      el('span', { style: S.secTitle }, '时间线'),
      el('span', { style: S.secTag }, '那天记了什么 · 又想起过什么'),
      el(
        'span',
        { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
        ...天数们.map((n) =>
          el(
            'button',
            {
              key: 'd' + n,
              style: Object.assign({}, n === 天 ? S.btnOn : S.btn, { padding: '2px 9px', fontSize: 12 }),
              onClick: () => set天(n),
            },
            '近 ' + n + ' 天',
          ),
        ),
      ),
    )

    if (载 && !d) return el('div', null, 顶, el('div', { style: S.note }, '正在数…'))
    if (错) return el('div', null, 顶, el('div', { style: G.err }, '拉不到时间线：' + 错))

    const 每天 = (d && d.每天) || []
    if (!每天.length) {
      return el(
        'div',
        null,
        顶,
        el('div', { style: S.note }, '近 ' + 天 + ' 天没有记录 —— 这段时间要么没聊天，要么记忆功能没开着。'),
      )
    }

    return el(
      'div',
      null,
      顶,
      ...每天.map((x) => {
        const 想 = x.想起 || { 次: 0, 有: 0, 条: 0, 空: 0, 兜底: 0 }
        const 一句话 =
          '记了 ' + x.记数 + ' 条' +
          ' · 想起 ' + 想.次 + ' 次' +
          (想.有 ? '（' + 想.有 + ' 次翻到东西，共 ' + 想.条 + ' 条）' : '') +
          (想.空 ? ' · ' + 想.空 + ' 次什么都没翻到' : '') +
          (想.兜底 ? ' · 兜底 ' + 想.兜底 + ' 次' : '')
        return el(
          'div',
          { key: x.日, style: Object.assign({}, S.sec, { marginBottom: 10 }) },
          el(
            'div',
            { style: S.secH },
            el('span', { style: S.secTitle }, x.日),
            el('span', { style: S.secTag }, 一句话),
          ),
          x.记.length
            ? el(
                'div',
                { style: { marginTop: 6 } },
                ...x.记.map((m, i) =>
                  el(
                    'div',
                    {
                      key: 'm' + i,
                      style: { display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12.5, lineHeight: 1.85, opacity: 0.9 },
                    },
                    el('span', { style: { opacity: 0.5, fontFamily: 'monospace', fontSize: 11.5 } }, m.t),
                    el('span', { style: { flex: 1, minWidth: 0, wordBreak: 'break-word' } }, m.text),
                    m.类型 ? 标(m.类型) : null,
                    m.性质 ? 标('性质:' + m.性质) : null,
                  ),
                ),
                x.记数 > x.记.length
                  ? el('div', { style: Object.assign({}, S.note, { marginTop: 4 }) }, '（还有 ' + (x.记数 - x.记.length) + ' 条没摆出来，去「记忆」页搜）')
                  : null,
              )
            : el('div', { style: Object.assign({}, S.note, { marginTop: 4 }) }, '这天一条都没记'),
        )
      }),
      el('div', { style: Object.assign({}, S.note, { marginTop: 4 }) }, '只统计保留在库里的记录；「想起」= 每轮对话取记忆的次数，兜底 = 没翻到、改用原文顶上的次数。'),
    )
  }
}
