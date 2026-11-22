// 会话详情 · 导入记录页签（只读批次列表与整批撤销）
export function 造导入记录页({ React, post, S, setNotes }) {
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
  return 导入记录页
}
