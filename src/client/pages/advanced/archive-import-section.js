// 高级区 · 从旧档案文件导入到指定会话
export function 造从档案导入会话区({ React, el, get, post, S, G, 选择器 }) {
  function 从档案导入会话区(props) {
    const 会话们 = props.会话们 || []
    const [开, set开] = React.useState(false)
    const [挑, set挑] = React.useState(null) // {path, name}
    const [扫, set扫] = React.useState(null) // scan-file 结果
    const [勾, set勾] = React.useState({})
    const [目标区, set目标区] = React.useState('')
    const [目标会话, set目标会话] = React.useState('')
    const [工作区们, set工作区们] = React.useState([])
    const [会话表, set会话表] = React.useState([])
    const [搜, set搜] = React.useState('')
    const [忙, set忙] = React.useState('')
    const [结果, set结果] = React.useState(null) // {added, 重复, batch}
    const [提示, set提示] = React.useState('')
  
    const 拉工作区 = React.useCallback(() => {
      get('/workspaces').then((r) => {
        const 表 = (r && r.workspaces) || []
        set工作区们(表)
        if (表.length && !目标区) set目标区(表[0].id)
      }).catch(() => {})
    }, [目标区])
  
    const 拉会话 = React.useCallback((wid, q) => {
      get('/sessions-by-workspace?workspace=' + encodeURIComponent(wid || '') + '&q=' + encodeURIComponent(q || ''))
        .then((r) => set会话表((r && r.sessions) || []))
        .catch(() => set会话表([]))
    }, [])
  
     React.useEffect(() => { if (开) 拉工作区() }, [开, 拉工作区])
     React.useEffect(() => { if (开 && 目标区) 拉会话(目标区, 搜) }, [开, 目标区, 搜, 拉会话])
  
    // 系统文件选择（浏览器原生 <input type="file">）：只要文本，不要路径
    const 选中文件 = (e) => {
      const f = e && e.target && e.target.files && e.target.files[0]
      if (!f) return
      set扫(null)
      set勾({})
      set结果(null)
      set提示('')
      set忙('读')
      const 读 = new FileReader()
      读.onload = () => {
        const text = String(读.result || '')
        set挑({ name: f.name, bytes: f.size, text })
        set忙('')
        // 读完直接扫，省掉「读这份」这一步
        set忙('扫')
        post('/import/scan-text', { session: 目标会话 || (会话们[0] && 会话们[0].id) || '', name: f.name, text })
          .then((r) => {
            set扫(r)
            if (r && r.ok) {
              const 全 = {}
              for (const it of r.items || []) if (!it.重复) 全[it.key] = true
              set勾(全)
            } else set提示((r && r.message) || '扫描失败')
          })
          .catch((err) => set提示(String(err)))
          .then(() => set忙(''))
      }
      读.onerror = () => { set忙(''); set提示('读文件失败') }
      读.readAsText(f, 'utf-8')
    }
  
    const 勾数 = React.useMemo(() => Object.keys(勾).filter((k) => 勾[k]).length, [勾])
    const 能导 = !!目标会话 && 勾数 > 0 && !忙
  
    const 导入 = () => {
      if (!能导) return
      const 要导 = (扫.items || []).filter((it) => 勾[it.key])
      set忙('导')
      set提示('')
      post('/import/apply', { session: 目标会话, items: 要导 })
        .then((r) => {
          if (r && r.ok !== false) {
            set结果({ added: r.added || 0, 重复: r.重复 || 0, 近似: r.近似 || 0, batch: r.batch, session: 目标会话 })
            set提示('✓ 导入完成')
          } else set提示((r && r.message) || '导入失败')
        })
        .catch((e) => set提示(String(e)))
        .then(() => set忙(''))
    }
  
    // ⭐ 1.8.0（用户：「提炼和补词对用户来说必须分开吗」→ 不必须，合成一个「整理」）
    //   内部串行：① 改写口吻（只对带原文的）② 补检索词（补所有缺词的）。
    // ⭐ 1.8.0：能中途停 —— 一批跑完就不再发下一批（不在跑的请求里硬断）
    const 停 = React.useRef(false)
    const 整理 = (只本次) => {
      if (!结果 || 忙) return
      停.current = false
      set忙('整理')
      set提示('① 改写口吻中…')
      const 附加 = 只本次 && 结果.batch ? { 批次: 结果.batch } : {}
      const 一步 = (地址, 名) => {
        const 跑 = () => {
          if (停.current) return Promise.resolve({ done: true, 停了: true })
          return post(地址, Object.assign({ session: 结果.session, 每批: 6 }, 附加)).then((r) => {
            if (!r || r.ok === false) throw new Error((r && r.message) || 名 + '失败')
            if (r.done) return r
            set提示(名 + '中：还剩 ' + (r.剩 || 0) + ' 条（这一轮 ' + (r.改了 || 0) + ' 条）…（点「停止」可以中断）')
            return 跑()
          })
        }
        return 跑()
      }
      一步('/refine', '① 改写')
        .then(() => {
          if (停.current) return null
          set提示('② 补检索词中…')
          return 一步('/expand', '② 补词')
        })
        .then(() => set提示(停.current ? '⏹ 已停止（没跑完的，下次点「整理」会接着来）' : '✓ 整理完成（口吻改好了、检索词也补上了）'))
        .catch((e) => set提示('✗ ' + String((e && e.message) || e)))
        .then(() => set忙(''))
    }
  
    const 撤销 = () => {
      if (!结果) return
      set忙('撤')
      post('/import/undo', { session: 结果.session, batch: 结果.batch })
        .then((r) => set提示(r && r.ok ? '✓ 已撤销这一批' : ((r && r.message) || '撤销失败')))
        .catch((e) => set提示(String(e)))
        .then(() => set忙(''))
    }
  
    const 卡头 = el(
      'div',
      { style: S.secH },
      el('span', { style: S.secTitle }, '从档案导入会话'),
      el('span', { style: S.secTag }, '把导出的档案读回来，变成记忆条目'),
      el('div', { style: { flex: 1 } }),
      el('button', { style: 开 ? S.btn : G.pillOn, onClick: () => set开(!开) }, 开 ? '收起' : '打开'),
    )
  
    const 说明 = el(
      'div',
      { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 8 }) },
      '先在上面导出一份 .md，再在这里挑它导回来。只认 Markdown；同一份导两次也不会重复记。',
    )
  
    const 文件行 = el(
      'div',
      { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 } },
      // 原生 input（Electron 里弹的就是系统的「打开」对话框）；label 包一层当成按钮
      el(
        'label',
        { style: Object.assign({}, G.btn, { cursor: 忙 ? 'default' : 'pointer' }) },
        '选择 Markdown…',
        el('input', {
          type: 'file',
          accept: '.md,.markdown,text/markdown',
          style: { display: 'none' },
          disabled: !!忙,
          onChange: 选中文件,
        }),
      ),
      el(
        'span',
        { style: Object.assign({}, S.dim, { fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '40em' }), title: 挑 ? 挑.name : '' },
        挑 ? 挑.name + '（' + Math.max(1, Math.round((挑.bytes || 0) / 1024)) + ' KB）' : '还没选文件',
      ),
      !挑 ? null : el('span', { style: Object.assign({}, S.dim, { fontSize: 12 }) }, 忙 === '扫' ? '读着呢…' : ''),
    )
  
    const 候选区 = 扫 && 扫.ok
      ? el(
          'div',
          null,
          el(
            'div',
            { style: Object.assign({}, S.dim, { fontSize: 12, margin: '4px 0 6px' }) },
            (扫.file ? 扫.file.name + ' · ' + 扫.file.lines + ' 行 · ' : '') + '拆出 ' + (扫.items || []).length + ' 条候选' + (扫.提示 ? '（' + 扫.提示 + '）' : ''),
          ),
          el(
            'div',
            { style: { display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' } },
            el('button', { style: S.btn, onClick: () => { const 全 = {}; for (const it of 扫.items || []) 全[it.key] = true; set勾(全) } }, '全选'),
            el('button', { style: S.btn, onClick: () => set勾({}) }, '全不选'),
            el('span', { style: Object.assign({}, S.dim, { fontSize: 12, alignSelf: 'center' }) }, '已勾 ' + 勾数 + ' / ' + (扫.items || []).length),
          ),
          el(
            'div',
            { style: { maxHeight: 260, overflow: 'auto', border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))', borderRadius: 8, padding: 6 } },
            (扫.items || []).map((it) =>
              el(
                'label',
                { key: it.key, style: { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 4px', fontSize: 12.5, cursor: 'pointer' } },
                el('input', { type: 'checkbox', checked: !!勾[it.key], onChange: () => set勾(Object.assign({}, 勾, { [it.key]: !勾[it.key] })) }),
                el('span', { style: { flex: 1, overflowWrap: 'anywhere' } }, String(it.改后 || it.text || '').slice(0, 200)),
                el('span', { style: Object.assign({}, S.dim, { fontSize: 11, flex: 'none' }) }, (it.重复 ? '重复 · ' : '') + (it.section || '')),
              ),
            ),
          ),
        )
      : null
  
    const 目标区块 = el(
      'div',
      { style: { marginTop: 12, marginBottom: 10 } },
      el('div', { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 4 }) }, '③ 导到哪儿'),
      el(
        'div',
        { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 } },
        el('span', { style: { fontSize: 12.5 } }, '工作区'),
        el(选择器, {
          style: Object.assign({}, S.inp, { width: 'auto', minWidth: 160 }),
          值: 目标区,
          选项: [{ v: '', t: '（选一个工作区）' }].concat(
            工作区们.map((w) => ({ v: w.id, t: w.name + '（' + w.会话数 + ' 个会话）' })),
          ),
          onChange: (v) => {
            set目标区(v)
            set目标会话('')
          },
        }),
        el('input', { style: Object.assign({}, S.inp, { width: 180 }), placeholder: '按会话名搜索…', value: 搜, onChange: (e) => set搜(e.target.value) }),
      ),
      el(
        'div',
        { style: { maxHeight: 200, overflow: 'auto', border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))', borderRadius: 8, padding: 4 } },
        会话表.length
          ? 会话表.map((x) =>
              el(
                'div',
                {
                  key: x.id,
                  role: 'button',
                  tabIndex: 0,
                  style: { display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12.5, background: 目标会话 === x.id ? 'var(--dsw-alias-state-business-primary, #5b8fd6)' : 'transparent', color: 目标会话 === x.id ? '#fff' : 'inherit' },
                  onClick: () => set目标会话(x.id),
                  onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') set目标会话(x.id) },
                },
                el('span', null, 目标会话 === x.id ? '●' : '○'),
                el('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, x.title || String(x.id || '').replace(/^session-/, '').slice(0, 12)),
                el('span', { style: { flex: 'none', fontSize: 11, opacity: 0.75 } }, (x.事件数 || 0) + ' 条事件'),
              ),
            )
          : el('div', { style: Object.assign({}, S.dim, { fontSize: 12, padding: '8px 6px' }) }, 目标区 ? '这个工作区里没有匹配的会话' : '先选工作区'),
      ),
      目标会话
        ? el('div', { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 4 }) }, '已选：' + ((会话表.find((x) => x.id === 目标会话) || {}).title || 目标会话))
        : null,
    )
  
    const 动作行 = el(
      'div',
      { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
      el('button', { style: G.pillOn, disabled: !能导, onClick: 导入 }, 忙 === '导' ? '导入中…' : '导入这 ' + 勾数 + ' 条'),
      !目标会话 ? el('span', { style: Object.assign({}, S.dim, { fontSize: 12 }) }, '先选目标会话') : null,
      !勾数 ? el('span', { style: Object.assign({}, S.dim, { fontSize: 12 }) }, '先勾要导入的条目') : null,
    )
  
    const 结果区 = 结果
      ? el(
          'div',
          { style: { marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--dsw-alias-bg-l1, rgba(127,127,127,.06))', border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))' } },
          el('div', { style: { fontSize: 12.5, marginBottom: 6 } }, '✓ 新增 ' + 结果.added + ' 条 · 跳过重复 ' + 结果.重复 + ' 条 · 近似 ' + 结果.近似 + ' 条'),
          el(
            'div',
            { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            忙 === '整理'
              ? el('button', {
                  style: Object.assign({}, S.btn, { borderColor: 'var(--dsw-alias-state-warn-primary, #d6a35b)', color: 'var(--dsw-alias-state-warn-primary, #d6a35b)' }),
                  onClick: () => { 停.current = true; set提示('要停了，等这一批跑完就不再发下一批…') },
                }, '停止')
              : el('button', { style: S.btn, onClick: () => 整理(true) }, '整理这批（本次导入的）'),
            el('button', { style: S.btn, disabled: !!忙, onClick: () => 整理(false) }, '连历史一起整理'),
            el('span', { style: Object.assign({}, S.dim, { fontSize: 11.5 }) }, '默认只整理本次导入的；「连历史一起」会把以前导入、还没提炼的也跑一遍（贵、慢，自己决定）'),
            el('button', { style: S.btn, disabled: !!忙, onClick: 撤销 }, '撤销这次导入'),
          ),
        )
      : null
  
    return el(
      'div',
      { style: Object.assign({}, S.sec, { marginTop: 14 }) },
      卡头,
      说明,
      开
        ? el(
            'div',
            { style: { marginTop: 6 } },
            文件行,
            候选区,
            目标区块,
            动作行,
            提示 ? el('div', { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 8 }) }, 提示) : null,
            结果区,
          )
        : null,
    )
  }
  return 从档案导入会话区
}
