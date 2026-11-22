// 会话详情 · 单条记忆行渲染与行内编辑/删除确认
export function 造一条记忆渲染({ React, post, rel, impName, S, 选择器 }) {
  return function 渲染一条记忆(m, ctx) {
    const { open, now, edit, setEdit, confirm, setConfirm, 选中, set选中, 看原文, set看原文, 是事实, 撤销作废, 退原文, 确认条, load } = ctx
  // 一条记忆当前落在哪层（给编辑框的层级下拉用）✓
  const 算层级 = (mm) => {
    const s = String((mm && mm.scope) || '')
    if (s === 'global' || (!s && mm && mm.category === 'stable_profile')) return 'global'
    if ((mm && mm.category === 'workspace') || s.indexOf('workspace:') === 0) return 'workspace'
    return 'session'
  }
  
  // 改一条：文本框 + 重要度 + 层级 + 存 / 算了
  const 改一条 = (m) =>
    React.createElement(
      'div',
      { style: S.editBox },
      React.createElement('textarea', {
        style: S.area,
        rows: 3,
        value: edit.text,
        onChange: (e) => setEdit(Object.assign({}, edit, { text: e.target.value })),
      }),
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 } },
        React.createElement('span', { style: S.dim }, '重要度'),
        React.createElement(选择器, {
          style: S.inp,
          值: String(edit.importance),
          选项: [
            { v: '0', t: '随口提过' },
            { v: '0.5', t: '比较重要' },
            { v: '1', t: '非常重要（会变成「一直」记得）' },
          ],
          onChange: (v) => setEdit(Object.assign({}, edit, { importance: Number(v) })),
        }),
        React.createElement('span', { style: S.dim }, '层级'),
        React.createElement(选择器, {
          style: S.inp,
          值: edit.层级 || 'global',
          选项: [
            { v: 'global', t: '全局记忆' },
            { v: 'workspace', t: '工作区' },
            { v: 'session', t: '本会话' },
          ],
          onChange: (v) => setEdit(Object.assign({}, edit, { 层级: v })),
        }),
        React.createElement('span', { style: Object.assign({}, S.dim, { flex: 1, fontSize: 12 }) }, '改之前会自动备份 ✓'),
        React.createElement(
          'button',
          {
            style: S.btn,
            disabled: !String(edit.text || '').trim(),
            onClick: () =>
              post('/edit', { session: open, id: m.id, text: edit.text, importance: edit.importance, scope: edit.层级 }).then(() => {
                setEdit(null)
                load()
              }),
          },
          '保存修改',
        ),
        React.createElement('button', { style: S.btn, onClick: () => setEdit(null) }, '算了'),
      ),
    )
  
  const 一条记忆 = (m) =>
    React.createElement(
      'div',
      // ⚠ 分隔线画在**整条**上（不是里面那个「行」）——
      //   这样下面那几行小字（能搜到它的词 / 讲的是）算在**这一条**里 ✓
      { key: m.id, style: S.条 },
      React.createElement(
        'div',
        { style: S.row },
        // ⭐ 2026-09-22（她要的批量删除）：行首一个勾选框
        React.createElement('input', {
          type: 'checkbox',
          checked: !!选中[m.id],
          title: '勾上它，再点上面的「批量删」',
          onChange: () => set选中(Object.assign({}, 选中, { [m.id]: !选中[m.id] })),
        }),
        React.createElement('div', { style: Object.assign({}, S.dim, { width: 96, flex: 'none' }) }, rel(m.at, now)),
        React.createElement(
          // ⚠⚠ 正文这一格给个**下限**（flexBasis 260 / minWidth 200）✗
          //   光有 flex:1 是不够的：它允许被压到 0，右边牌子一多就成竖条。
          //   有了下限 + 上面那条 flexWrap，装不下时是**牌子换行**，不是正文变窄 ✓
          'div',
          { style: { flex: '1 1 260px', minWidth: 200, overflowWrap: 'anywhere', wordBreak: 'break-word' } },
          m.已被取代
            ? React.createElement(
                'span',
                {
                  style: Object.assign({}, S.dim, { textDecoration: 'line-through', opacity: 0.62 }),
                  title: '这条已被取代（' + (m.已被取代.为什么 || '') + '）—— 不再被想起来，东西还留着',
                },
                m.text,
              )
            : m.text,
        ),
        // ⭐⭐ 2026-09-23（反馈「过期条目没标作废」）：
        //   标了「已被取代」的，行里直接挂一个「已被取代」的牌子 + 一个撤销口 ✓
        m.已被取代
          ? React.createElement(
              'div',
              {
                style: { flex: 'none', fontSize: 11, marginRight: 10, padding: '1px 6px', borderRadius: 8, background: 'rgba(224,176,112,.18)', color: '#e0b070', whiteSpace: 'nowrap' },
                title: (m.已被取代.为什么 || '') + '（' + rel(m.已被取代.作废于, now) + '）—— 它不再被注入，但东西还在',
              },
              '已被取代',
            )
          : null,
        m.已被取代
          ? React.createElement(
              'div',
              {
                style: Object.assign({}, S.link, { flex: 'none', fontSize: 12, marginRight: 10 }),
                title: '撤销「已被取代」—— 它又能被想起来了（标错了 / 状态又变回来了）',
                onClick: () => 撤销作废(m.id),
              },
              '恢复',
            )
          : null,
        // ⭐⭐ 2026-09-23：**事实键** —— ⚠ 不挂在行里，改挂到下面那行小字 ✓
        //   行里每多一个固定宽的牌子，正文就被挤窄一分；
        //   键本来就是「附注」性质，跟「能搜到它的词」放一起正合适（见下面那条）
        React.createElement(
          'div',
          { style: Object.assign({}, S.dim, { width: 58, flex: 'none', fontSize: 12 }), title: '鲜活度：越近就越鲜活，只影响排序。长期事实本来就不淡；没记时间的不知道是什么时候的事' },
          // ⭐⭐ 2026-09-22（反馈：「没标时间的还是鲜活 100%」）：
          //   光显示百分比会骗人 —— 长期事实本来就不淡，写「100%」像在说「刚发生」✗
          //   → 长期事实写「**不淡**」✓
          //   ⭐ 2026-09-22 再改（发现流水账来问）：**没记时间的也会淡了**
          //     （从「记下来的那天」开始算）→ 它们照常显示百分比 ✓
          //     （原来显示「没记时间」，那是我上一版判错了 —— 它们并不是不淡）
          m.freshKind === 'fact' ? '不淡'
            : typeof m.activation === 'number' && isFinite(m.activation) ? '鲜活 ' + Math.round(m.activation * 100) + '%' : '—',
        ),
        React.createElement('div', { style: Object.assign({}, S.dim, { width: 62, flex: 'none' }) }, impName(m.importance)),
        m.textBefore
          ? React.createElement(
              'div',
              {
                style: Object.assign({}, S.link, { flex: 'none', fontSize: 12, marginRight: 10 }),
                title: '看看提炼之前长什么样',
                onClick: () => set看原文(Object.assign({}, 看原文, { [m.id]: !看原文[m.id] })),
              },
              看原文[m.id] ? '收起' : '原文',
            )
          : null,
        m.textBefore
          ? React.createElement(
              'div',
              {
                style: Object.assign({}, S.link, { flex: 'none', fontSize: 12, marginRight: 10, color: '#e0b070' }),
                title: '把这条退回提炼前的原文（退回后可以再提炼一遍）',
                onClick: () => setConfirm({ id: m.id, kind: 'refineundo' }),
              },
              '退回',
            )
          : null,
        React.createElement(
          'div',
          { style: Object.assign({}, S.link, { flex: 'none', fontSize: 12, marginRight: 10 }), onClick: () => setEdit({ id: m.id, text: m.text, importance: typeof m.importance === 'number' ? m.importance : 0.5, 层级: 算层级(m) }) },
          '改',
        ),
        React.createElement(
          'div',
          {
            style: Object.assign({}, S.link, { flex: 'none', fontSize: 12 }),
            // ⭐ 1.4.0：事实删的是**全局**那份 —— 鼠标悬停先提醒一句
            title: 是事实(m) ? '这是全局事实 —— 删了所有会话都会忘（会再问一遍）' : undefined,
            onClick: () => setConfirm({ id: m.id, kind: 'delete' }),
          },
          '删',
        ),
      ),
      edit && edit.id === m.id ? 改一条(m) : null,
      confirm && confirm.id === m.id && confirm.kind === 'refineundo'
        ? React.createElement(
            'div',
            { style: S.confirm },
            React.createElement('span', { style: { flex: 1 } }, '把这条退回提炼前的原文？退回后它会变回「还没提炼」。'),
            React.createElement('button', { style: S.btn, onClick: () => 退原文(m.id) }, '退回'),
            React.createElement('button', { style: S.btn, onClick: () => setConfirm(null) }, '算了'),
          )
        : null,
      m.textBefore && 看原文[m.id]
        ? React.createElement(
            'div',
            {
              style: Object.assign({}, S.dim, {
                margin: '0 0 6px 104px',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                // ⚠ pre-wrap 只在空格/换行处断，长串（网址、长英文）照样横向撑破面板 —— 得补这两条
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
                borderLeft: '2px solid rgba(224,176,112,.5)',
                paddingLeft: 8,
              }),
            },
            '提炼前：' + m.textBefore,
          )
        : null,
      m.related && m.related.length
        ? React.createElement(
            'div',
            { style: Object.assign({}, S.dim, { margin: '0 0 6px 104px', fontSize: 11, overflowWrap: 'anywhere', wordBreak: 'break-word' }) },
            '能搜到它的词：' + m.related.join(' '),
          )
        : null,
      // ⭐⭐ 2026-09-23：**「这条讲的是哪件事」** —— 挂在这儿（第二行小字），不占行里的宽度 ✓
      //   ⚠⚠ 别用「事实键」这种我自己造的词 ——
      //     她说了「让人看不懂，写通俗一点的」✗
      m.事实键
        ? React.createElement(
            'div',
            { style: { margin: '0 0 6px 104px', fontSize: 11, overflowWrap: 'anywhere', wordBreak: 'break-word' } },
            React.createElement('span', { style: S.dim }, '讲的是：'),
            React.createElement(
              'span',
              {
                style: { padding: '1px 6px', borderRadius: 8, background: 'rgba(120,170,220,.16)', color: '#7aaadc', whiteSpace: 'nowrap' },
                title:
                  '这条讲的是「' + m.事实键 + '」这件事。' +
                  '讲同一件事的记忆只留最新那条 —— 旧的收起来了（还能恢复）',
              },
              m.事实键,
            ),
          )
        : null,
      // ⭐⭐ 1.4.0（需求②）：**删掉一条长期事实 = 全局生效** —— 会话 A 删了，
      //   会话 B、C、别的工区下一轮全都想不起来它。所以事实要**多问一遍**：
      //     点「删」→ ① 说明「这是全局事实，所有会话都会忘」→ ② 再点一次才真删 ✓
      //   事件照旧一步（它只属于这个会话，删了不影响别人）✓
      confirm && confirm.id === m.id && confirm.kind === 'delete'
        ? 是事实(m) && confirm.step !== 2
          ? React.createElement(
              'div',
              { style: S.confirm },
              React.createElement(
                'span',
                { style: { flex: 1, minWidth: 0, overflowWrap: 'anywhere' } },
                '⚠ 这是「全局事实」—— 收起来以后，所有会话都会忘掉它（不只是当前这个对话）。真的要动它？',
              ),
              React.createElement(
                'button',
                { style: S.btnDanger, onClick: () => setConfirm({ id: m.id, kind: 'delete', step: 2 }) },
                '我明白，继续',
              ),
              React.createElement('button', { style: S.btn, onClick: () => setConfirm(null) }, '算了'),
            )
          : 确认条('把这条收起来？它会进「已删掉的」，还能找回来。', '收起来', 'delete', m.id)
        : null,
    )
    return 一条记忆(m)
  }
}
