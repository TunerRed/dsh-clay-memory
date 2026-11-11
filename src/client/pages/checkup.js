// 回复体检页 —— 2026-11-11 从 lib/client.js 拆出来（逻辑未改）
// 依赖由调用方注入；不直接碰宿主 API，方便离线渲染测试。
export function 造回复体检页({ React, get, post, B, S, el }) {
  function 回复体检页() {
      const [数据, set数据] = React.useState(null)
      const [忙, set忙] = React.useState(true)
      const [错, set错] = React.useState('')
      const [天数, set天数] = React.useState(14)
      const [条数, set条数] = React.useState(20)
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
      React.useEffect(() => {
        载()
      }, [载])
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
      return el(
        'div',
        { style: S.wrap },
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
      )
  }

  return 回复体检页
}
