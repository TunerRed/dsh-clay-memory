// 会话详情 · 召回记录与备份说明页签
export function 渲染召回记录页签({ React, S, s, tr, 详情页 }) {
  return (
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
  )
  )
}
