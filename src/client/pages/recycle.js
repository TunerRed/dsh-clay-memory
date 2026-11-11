// 回收站页 —— 2026-11-11 从 lib/client.js 拆出来（逻辑未改）
// 依赖由调用方注入；不直接碰宿主 API，方便离线渲染测试。
export function 造回收站页({ React, get, post, S, el, 类型名 }) {
  function 回收站页() {
      const [数据, set数据] = React.useState(null)
      const [搜, set搜] = React.useState('')
      const [忙, set忙] = React.useState('')
      const 拉 = React.useCallback(() => {
        get('/recycle-bin')
          .then((r) => set数据(r || { ok: false, message: '没读到' }))
          .catch((e) => set数据({ ok: false, message: String((e && e.message) || e) }))
      }, [])
      React.useEffect(() => {
        拉()
      }, [拉])
      if (!数据) return el('div', { style: Object.assign({}, S.dim, { fontSize: 12 }) }, '读着…')
      if (!数据.ok) return el('div', { style: Object.assign({}, S.dim, { fontSize: 12 }) }, 数据.message || '读不出来')
      const 来源色 = { fact: 'rgba(96,165,250,.85)', session: 'rgba(148,163,184,.85)', workspace: 'rgba(52,211,153,.85)' }
      const 类型名 = (x) => (x.来源类型 === 'fact' ? '事实' : x.来源类型 === 'workspace' ? '工作区' : '会话')
      // ⭐ 2026-11-01 用户：工作区那一列只显示最后一段路径（全路径太挤），
      //   全路径留在 title 里悬停可见，省出宽度给正文。
      const 短来源 = (x) => {
        const 全 = String(x.来源 || '').trim()
        if (x.来源类型 !== 'workspace') return 全 || '—'
        const 段 = 全.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
        return (段.length ? 段[段.length - 1] : 全) || '工作区'
      }
      const q = 搜.trim().toLowerCase()
      const 全 = Array.isArray(数据.items) ? 数据.items : []
      const 条 = q ? 全.filter((it) => String(it.text || '').toLowerCase().includes(q)) : 全
      return el(
        'div',
        { style: S.sec },
        el('div', { style: S.secH }, el('span', { style: S.secTitle }, '回收站'), el('span', { style: S.secTag }, '删掉的都在这儿 · 能找回来')),
        el(
          'div',
          { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 8, overflowWrap: 'anywhere' }) },
          '共 ' + 数据.total + ' 条。回收站不共用——事实库 / 每个会话 / 每个工作区各自一个，这里合起来看，标签标明来源。',
        ),
        el(
          'div',
          { style: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 } },
          el('input', {
            style: Object.assign({}, S.inp, { flex: 1 }),
            placeholder: '搜内容…',
            value: 搜,
            onChange: (e) => set搜(e.target.value),
          }),
          el('span', { style: Object.assign({}, S.dim, { fontSize: 12, flex: 'none' }) }, q ? 条.length + ' 条命中' : 数据.total + ' 条'),
          el('button', { style: Object.assign({}, S.btn, { flex: 'none', fontSize: 12, padding: '3px 10px' }), onClick: 拉 }, '刷新'),
        ),
        条.length === 0
          ? el('div', { style: Object.assign({}, S.dim, { fontSize: 12, padding: '8px 2px' }) }, q ? '没有匹配的' : '回收站是空的')
          : 条.map((m) =>
              el(
                'div',
                { key: m.file + ':' + m.id, style: Object.assign({}, S.row, S.条) },
                el(
                  'span',
                  {
                    style: {
                      flex: 'none',
                      fontSize: 11,
                      padding: '1px 6px',
                      borderRadius: 4,
                      border: '1px solid ' + (来源色[m.来源类型] || 'rgba(148,163,184,.6)'),
                      color: 来源色[m.来源类型] || 'inherit',
                    },
                  },
                  类型名(m),
                ),
                el(
                  'span',
                  {
                    style: { flex: 'none', fontSize: 11.5, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.85 },
                    title: m.来源 || '',
                  },
                  短来源(m),
                ),
                el('span', { style: { flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', opacity: 0.8 } }, m.text || '（空）'),
                el('span', { style: { flex: 'none', fontSize: 11.5 } }, m.deletedAt ? String(m.deletedAt).slice(0, 10) : ''),
                el(
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
                    disabled: 忙 === m.id,
                    onClick: () => {
                      set忙(m.id)
                      post('/recycle-bin', { file: m.file, id: m.id })
                        .then((r) => {
                          if (r && r.ok) 拉()
                          else window.alert('没找回来：' + ((r && r.message) || '？'))
                        })
                        .catch((e) => window.alert('找回来失败：' + String((e && e.message) || e)))
                        .finally(() => set忙(''))
                    },
                  },
                  忙 === m.id ? '…' : '找回来',
                ),
              ),
            ),
      )
  }

  return 回收站页
}
