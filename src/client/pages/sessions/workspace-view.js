// 会话页 · 工作区记忆子页签视图
export function 渲染工作区记忆视图({ React, el, S, 选择器, 子页签, 选中区, set选中区, 区表, 工作区记忆, 删工作区记忆, 看回收站, set看回收站, 找回工作区记忆 }) {
  return (
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
    : null
  )
}
