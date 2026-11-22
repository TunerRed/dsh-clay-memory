// 高级区 · 语义向量召回开关与模型管理
export function 造语义区({ React, el, get, post, S, G }) {
  // ⭐ 1.12.41（P1-1）：语义召回 —— 开关 + 模型目录 + 一键下载
  //   为什么放「高级」：调一次就不动的东西；默认关，开了才多花一秒算向量。
  function 语义区() {
    const [st, setSt] = React.useState(null)
    const [开, set开] = React.useState(false)
    const [目录, set目录] = React.useState('')
    const [模型, set模型] = React.useState('')
    const [提示, set提示] = React.useState(null)
    const [跑, set跑] = React.useState(false)
    // ⚠ 按钮行 原本只在 高级区 里定义；语义区是独立函数，直接引用会 ReferenceError（ui-check 抓到的就是这个）
    const 按钮行 = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }
    const 读 = React.useCallback(() => {
      get('/embed-status')
        .then((r) => {
          if (!r) return
          setSt(r)
          set开(!!r.开)
          set目录(String(r.模型目录 || ''))
          set模型(String(r.模型名 || ''))
        })
        .catch((e) => set提示('读不到状态：' + String((e && e.message) || e)))
    }, [])
    React.useEffect(() => {
      读()
    }, [读])
    // 下载中每 1.5 秒刷一次状态
    React.useEffect(() => {
      if (!st || !st.下载中) return
      const t = setInterval(读, 1500)
      return () => clearInterval(t)
    }, [st, 读])
    const 存 = (补) => {
      set跑(true)
      post('/embed-config', Object.assign({ 开, 模型目录: 目录, 模型名: 模型 }, 补 || {}))
        .then((r) => {
          set提示(r && r.ok ? '已保存' : '保存失败')
          setTimeout(() => 读(), 300)
        })
        .catch((e) => set提示('保存失败：' + String((e && e.message) || e)))
        .finally(() => set跑(false))
    }
    const 下载 = () => {
      set跑(true)
      post('/embed-download', {})
        .then((r) => {
          set提示(r && r.started ? '开始下载…（约 24MB，首次要几十秒）' : '启动失败')
          setTimeout(() => 读(), 1000)
        })
        .catch((e) => set提示('下载失败：' + String((e && e.message) || e)))
        .finally(() => set跑(false))
    }
    const 默认 = (st && st.默认目录) || ''
    return el(
      'div',
      { style: Object.assign({}, S.sec, { marginTop: 10 }) },
      el(
        'div',
        { style: S.secH },
        el('span', { style: S.secTitle }, '语义召回'),
        el('span', { style: S.secTag }, 'P1-1 · 先用向量找“意思相近”的'),
      ),
      el(
        'div',
        { style: Object.assign({}, S.dim, { lineHeight: 1.7 }) },
        '词面召回只认字面重合 ——「我全名咋写」和「ta叫沈知夏」一个字都不挨着，所以想不起来。开了这个，每条记忆多存一个向量，问句也转成向量，两路候选合在一起排。',
      ),
      el(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' } },
        el(
          'label',
          { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
          el('input', {
            type: 'checkbox',
            checked: 开,
            disabled: 跑,
            onChange: (e) => set开(!!e.target.checked),
          }),
          el('span', {}, '开启语义召回'),
        ),
        st && st.加载过 ? el('span', { style: { color: 'var(--dsw-alias-state-success-primary, #4a9)', fontSize: 12 } }, '● 模型已加载') : null,
        st && st.下载中 ? el('span', { style: { color: 'var(--dsw-alias-state-warning-primary, #c90)', fontSize: 12 } }, '● 下载中…') : null,
        st && st.失败 ? el('span', { style: { color: 'var(--dsw-alias-state-error-primary, #d66)', fontSize: 12, lineHeight: 1.5 } }, '● ' + String(st.失败)) : null,
      ),
      el(
        'div',
        { style: { marginTop: 8 } },
        el('div', { style: Object.assign({}, S.dim, { marginBottom: 4 }) }, '模型（bge-small-zh-v1.5，ONNX，512 维）'),
        el('input', {
          style: Object.assign({}, G.sel, { width: '100%', boxSizing: 'border-box' }),
          placeholder: 默认 ? '留空 = ' + 默认 : '模型目录（留空用默认）',
          value: 模型,
          disabled: 跑,
          onChange: (e) => set模型(e.target.value),
        }),
        el('div', { style: Object.assign({}, S.dim, { marginTop: 4 }) }, '默认 bge-small-zh-v1.5（BGE 非对称检索，短问句查陈述事实最稳）；填别的会按 HuggingFace 名字拉。'),
      ),
      el(
        'div',
        { style: { marginTop: 8 } },
        el('div', { style: Object.assign({}, S.dim, { marginBottom: 4 }) }, '模型缓存目录'),
        el('input', {
          style: Object.assign({}, G.sel, { width: '100%', boxSizing: 'border-box' }),
          placeholder: 默认 ? '留空 = ' + 默认 : '留空用 $DSH_HOME/models',
          value: 目录,
          disabled: 跑,
          onChange: (e) => set目录(e.target.value),
        }),
      ),
      el(
        'div',
        { style: Object.assign({}, 按钮行, { marginTop: 10 }) },
        el('button', { style: Object.assign({}, G.btn, { opacity: 跑 ? 0.5 : 1 }), disabled: 跑, onClick: () => 存({}) }, '保存'),
        el(
          'button',
          { style: Object.assign({}, G.btn, { opacity: 跑 ? 0.5 : 1 }), disabled: 跑, onClick: 下载 },
          st && st.加载过 ? '重新检查模型' : '下载默认模型',
        ),
      ),
      提示 ? el('div', { style: Object.assign({}, S.dim, { marginTop: 6 }) }, 提示) : null,
    )
  }
  return 语义区
}
