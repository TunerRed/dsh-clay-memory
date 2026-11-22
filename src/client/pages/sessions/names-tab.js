// 会话详情 · 称呼页签
export function 渲染称呼页签({ React, post, S, open, s, 详情页, selfDraft, setSelfDraft, ownerDraft, setOwnerDraft, load }) {
  return (
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
  )
  )
}
