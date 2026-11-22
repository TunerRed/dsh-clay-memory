// 高级区 · 从历史对话提炼并导出旧档案
export function 造生成档案区({ React, el, get, post, S, G, 进度, 选择器 }) {
  function 生成档案区(props) {
    const 会话号 = props.会话号 || ''
    const [开, set开] = React.useState(false)
    const [提示, set提示] = React.useState([])
    const [忙, set忙] = React.useState(false)
    const [生成会话, set生成会话] = React.useState(null) // 这个工作区有哪些会话
    const [生成选, set生成选] = React.useState({}) // 勾了哪几个
    const [生成计划, set生成计划] = React.useState(null) // 算出来的：几批、多少字、多少 token
    const [生成条目, set生成条目] = React.useState([]) // 攒下来的条目
    const [生成进度, set生成进度] = React.useState(null) // {批号, 批数, 在跑, 模型}
    const [生成档, set生成档] = React.useState(null) // 存好了：{存到, 条数, 预览}
    const [生成备, set生成备] = React.useState(null) // 给模型用的备用模型（可选）
    const [生成诊断, set生成诊断] = React.useState(null) // 列表跟 DSH 对不上时，看这几个数
    // ⭐⭐ 2026-09-22（反馈：「点存档案的地方应该自定义」）：
    //   原来存到哪儿是我**写死的**（`.dsh\导出的档案.md`）✗ → 能打、能选 ✓
    const [生成存到, set生成存到] = React.useState('')
    const [生成目录列, set生成目录列] = React.useState(null) // 文件夹选择器的列表
    const [生成选目录, set生成选目录] = React.useState(false)
    const 记 = (x) => set提示(Array.isArray(x) ? x : [String(x)])
        const 开生成 = () => {
          set开(true)
          set生成会话(null)
          set生成计划(null)
          set生成条目([])
          set生成档(null)
          set生成进度(null)
          post('/gen-sessions', { session: 会话号 })
            .then((r) => {
              if (!r || !r.ok) {
                记(['读会话列表失败：' + ((r && r.message) || '？')])
                return
              }
              set生成会话(r.会话 || [])
              set生成诊断(r.诊断 || null)
              // 建议路径（服务端按这个会话的工作目录算的）—— 用户能改 ✓
              if (r.建议存到) set生成存到(String(r.建议存到))
              // ⚠⚠ 2026-09-22（反馈：「默认不该全选」）：
              //   原来我默认**全勾上** —— 那等于替用户决定「全都处理一遍」，
              //   而这一步后面是要**调模型、花钱**的 ✗
              //   → 默认**一个都不勾**，让用户自己挑 ✓
              set生成选({})
            })
            .catch((e) => 记(['读会话列表失败：' + ((e && e.message) || e)]))
        }
    
        const 勾的sid = () => Object.keys(生成选).filter((k) => 生成选[k])
    
        const 算生成 = () => {
          const sids = 勾的sid()
          if (!sids.length) {
            记(['一个会话都没勾'])
            return
          }
          set忙(true)
          记(['算着呢…（要读一遍会话、去重、切段，一个会话约一秒）'])
          post('/gen-plan', { session: 会话号, sids: sids })
            .then((r) => {
              set忙(false)
              if (!r || !r.ok) {
                记(['算失败：' + ((r && r.message) || '？')])
                return
              }
              set生成计划(r)
              set生成条目([])
              set生成档(null)
              记([])
            })
            .catch((e) => {
              set忙(false)
              记(['算失败：' + ((e && e.message) || e)])
            })
        }
    
        const 跑生成 = () => {
          const sids = 勾的sid()
          if (!sids.length || !生成计划) return
          const 总批 = 生成计划.批数
          set忙(true)
          set生成档(null)
          const 攒 = 生成条目.slice()
          let 连着空 = 0
          const 跑一批 = (批号) => {
            if (批号 > 总批) {
              set忙(false)
              set生成进度(null)
              记(['✓ 跑完了：' + 总批 + ' 批，攒了 ' + 攒.length + ' 条。' + (攒.length ? '点「存成档案文件」' : '模型这一轮一条都没收；回文长度记在诊断日志里，换个会话或再点一次试试')])
              return
            }
            set生成进度({ 批号, 批数: 总批, 在跑: true, 模型: (生成进度 && 生成进度.模型) || '' })
            post('/gen-run', {
              session: 会话号,
              sids: sids,
              批号: 批号,
              // ⚠ 把前面攒的条目当「已记清单」传过去 —— 这是防重复的机制
              已记: 攒.map((x) => x.章 + '|' + x.日期 + '|' + x.话),
              provider: 生成备 ? 生成备.provider : undefined,
              model: 生成备 ? 生成备.model : undefined,
            })
              .then((r) => {
                if (!r || !r.ok) {
                  set忙(false)
                  set生成进度(null)
                  记(['第 ' + 批号 + ' 批失败：' + ((r && r.message) || '？'), '已经跑好的 ' + 攒.length + ' 条留着，再点一次会接着跑'])
                  return
                }
                if (r.条目 && r.条目.length) {
                  r.条目.forEach((x) => 攒.push(x))
                  连着空 = 0
                } else {
                  连着空++
                }
                set生成条目(攒.slice())
                set生成进度({ 批号, 批数: 总批, 在跑: true, 模型: r.模型 || '' })
                if (r.done) {
                  set忙(false)
                  set生成进度(null)
                  记(['✓ 跑完了：' + 总批 + ' 批，攒了 ' + 攒.length + ' 条。' + (攒.length ? '点「存成档案文件」' : '模型这一轮一条都没收；回文长度记在诊断日志里，换个会话或再点一次试试')])
                  return
                }
                // 一批回 0 条不算失败，但也别无限跑 —— 连着 3 批空就停
                if (连着空 >= 3) {
                  set忙(false)
                  set生成进度(null)
                  记(['连着 3 批模型没回东西，先停了。再点一次会接着跑'])
                  return
                }
                setTimeout(() => 跑一批(批号 + 1), 300)
              })
              .catch((e) => {
                set忙(false)
                set生成进度(null)
                记(['第 ' + 批号 + ' 批失败：' + ((e && e.message) || e), '再点一次会接着跑'])
              })
          }
          跑一批(1)
        }
    
        const 存生成 = () => {
          if (!生成条目.length) {
            记(['还没有条目'])
            return
          }
          set忙(true)
          post('/gen-save', { session: 会话号, 条目: 生成条目, 来源: (生成计划 && 生成计划.天数 + ' 天') || '', 存到: 生成存到 })
            .then((r) => {
              set忙(false)
              if (!r || !r.ok) {
                记(['存失败：' + ((r && r.message) || '？')])
                return
              }
              set生成档(r)
              记(['✓ 档案存到：' + r.存到, '共 ' + r.条数 + ' 条' + (r.去掉重复 ? '（去掉了 ' + r.去掉重复 + ' 条重复）' : '')])
            })
            .catch((e) => {
              set忙(false)
              记(['存失败：' + ((e && e.message) || e)])
            })
        }
    return el(
      'div',
      { style: Object.assign({}, S.sec, { marginTop: 14 }) },
      el(
        'div',
        { style: S.secH },
        el('span', { style: S.secTitle }, '从会话导出档案'),
        el('span', { style: S.secTag }, '把某个会话读一遍，导出一份九章档案'),
        el('div', { style: { flex: 1 } }),
        el('button', { style: 开 ? S.btn : G.pillOn, onClick: () => (开 ? set开(false) : 开生成()) }, 开 ? '收起' : '打开'),
      ),
      el('div', { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 8 }) },
        '挑任意一个会话（不一定是当前这个）读一遍，导出一份九章档案；导好的档案再走「从旧档案导入」变成记忆条目。',
      ),
                开
                  ? React.createElement(
                      'div',
                      { style: Object.assign({}, S.editBox, { marginTop: 8 }) },
                      [
    
                        // ① 选会话
                        React.createElement(
                          'div',
                          { key: 's', style: { marginTop: 8 } },
                          React.createElement('div', { style: S.dim }, '① 选会话' + (生成会话 ? '（这个工作区里找到 ' + 生成会话.length + ' 个）' : '（读着呢…）')),
                          生成会话 && 生成会话.length
                            ? React.createElement(
                                'div',
                                { style: { margin: '4px 0 0 8px', maxHeight: 260, overflow: 'auto' } },
                                生成会话.map((x) =>
                                  React.createElement(
                                    'label',
                                    { key: x.sid, style: { display: 'block', fontSize: 12, cursor: 'pointer', padding: '2px 0' } },
                                    React.createElement('input', {
                                      type: 'checkbox',
                                      checked: !!生成选[x.sid],
                                      onChange: () => set生成选(Object.assign({}, 生成选, { [x.sid]: !生成选[x.sid] })),
                                    }),
                                    // ⚠⚠ 2026-09-22（反馈：「不显示名字」）：
                                    //   光有 `session-a1b2c3d4-…` 这种**没法挑** —— 得显示标题 ✓
                                    ' ',
                                    React.createElement('span', { style: x.标题 ? null : S.dim }, x.标题 || '（没起名字）'),
                                    React.createElement(
                                      'span',
                                      { style: Object.assign({}, S.dim, { marginLeft: 6 }) },
                                      (x.话数 ? x.话数 + ' 句　' : '') + x.MB + ' MB　' + x.sid.slice(0, 12) + '…',
                                    ),
                                  ),
                                ),
                              )
                            : 生成会话
                              ? React.createElement(
                                  'div',
                                  { style: Object.assign({}, S.dim, { marginTop: 4 }) },
                                  '这个工作区里没找到会话（归档的、子代理跑出来的、空壳的都不列）',
                                )
                              : null,
                          // ⚠ 默认一个都不勾 —— 让用户自己挑（后面是要花钱的）✓
                          生成会话 && 生成会话.length
                            ? React.createElement(
                                'div',
                                { style: { marginTop: 4, display: 'flex', gap: 8, alignItems: 'center' } },
                                React.createElement(
                                  'button',
                                  {
                                    style: S.btn,
                                    onClick: () => {
                                      const 勾 = {}
                                      生成会话.forEach((x) => {
                                        勾[x.sid] = true
                                      })
                                      set生成选(勾)
                                    },
                                  },
                                  '全选',
                                ),
                                React.createElement('button', { style: S.btn, onClick: () => set生成选({}) }, '全不选'),
                                React.createElement('span', { style: S.dim }, '勾了 ' + 勾的sid().length + ' 个'),
                              )
                            : null,
                          // ⚠ 诊断：列表跟 DSH 对不上时，这几个数能看出卡在哪一道 ✓
                          生成诊断
                            ? React.createElement(
                                'div',
                                { style: Object.assign({}, S.dim, { marginTop: 4, fontSize: 11 }) },
                                '文件夹里 ' + 生成诊断.文件夹里 + ' 个　DSH 名单 ' + 生成诊断.DSH名单 +
                                  ' 个　归档 ' + 生成诊断.归档 + ' 个　筛完剩 ' + 生成诊断.筛完剩 + ' 个',
                                (生成诊断.被我筛掉的 || []).length
                                  ? React.createElement(
                                      'div',
                                      { style: { marginTop: 2 } },
                                      '筛掉的：' +
                                        (生成诊断.被我筛掉的 || [])
                                          .map((x) => (x.标题 || x.sid) + '（' + x.因 + '）')
                                          .join('　'),
                                    )
                                  : null,
                              )
                            : null,
                          React.createElement(
                            'div',
                            { style: { marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' } },
                            React.createElement(
                              'button',
                              { style: S.btn, disabled: 忙 || 勾的sid().length === 0, onClick: () => 算生成() },
                              '② 算一下要多少',
                            ),
                            React.createElement(
                              'span',
                              { style: S.dim },
                              !勾的sid().length ? '先勾几个会话' : '（这一步不调模型、不花钱；要读一遍会话、去重、切段，慢一点）',
                            ),
                          ),
                        ),
    
                        // ② 计划
                        生成计划
                          ? React.createElement(
                              'div',
                              { key: 'p', style: { marginTop: 8 } },
                              React.createElement(
                                'div',
                                { style: S.dim },
                                '② 算出来了：' + 生成计划.批数 + ' 批　' + 生成计划.天数 + ' 天　' +
                                  生成计划.总字.toLocaleString() + ' 字　粗算约 ' + 生成计划.token.toLocaleString() + ' token',
                              ),
                              React.createElement(
                                'div',
                                { style: Object.assign({}, S.dim, { marginTop: 2 }) },
                                '（每批最多 ' + 生成计划.每批字上限.toLocaleString() + ' 字；挑出来「不是聊天」的 ' +
                                  生成计划.挑出来 + ' 条没算进去）',
                              ),
                              React.createElement(
                                'div',
                                { style: { marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                                React.createElement(
                                  'button',
                                  { style: S.btnDanger, disabled: 忙, onClick: () => 跑生成() },
                                  忙 ? '跑着呢…' : '③ 开始跑（会调模型、会花钱）',
                                ),
                                React.createElement(
                                  'span',
                                  { style: S.dim },
                                  '一批一批跑，跑完一批就把条目攒起来；下一批会带上「已经记过的」，同一件事不会收两遍',
                                ),
                              ),
                              (生成计划.会话 || []).length
                                ? React.createElement(
                                    'div',
                                    { style: Object.assign({}, S.dim, { marginTop: 4, fontSize: 12 }) },
                                    '会话情况：' +
                                      生成计划.会话
                                        .map((x) => (x.标题 || x.sid.slice(0, 12)) + '（独有 ' + x.独有 + '／副本 ' + x.副本 + '）')
                                        .join('　'),
                                  )
                                : null,
                            )
                          : null,
    
                        // ③ 进度
                        生成进度 && 生成进度.在跑
                          ? (() => {
                              const 百 = Math.round(((生成进度.批号 - 1) / 生成进度.批数) * 100)
                              return React.createElement(
                                'div',
                                { key: 'bar', style: { marginTop: 8 } },
                                React.createElement(
                                  'div',
                                  { style: S.barOut },
                                  React.createElement('div', { style: Object.assign({}, S.barIn, { width: 百 + '%' }) }),
                                ),
                                React.createElement(
                                  'div',
                                  { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 4 }) },
                                  '第 ' + 生成进度.批号 + ' / ' + 生成进度.批数 + ' 批（' + 百 + '%）' +
                                    '　已攒 ' + 生成条目.length + ' 条' +
                                    (生成进度.模型 ? '　' + 生成进度.模型 : ''),
                                ),
                              )
                            })()
                          : null,
    
                        // ④ 存到哪儿 —— ⚠⚠ 2026-09-22（反馈：「选了文件夹点了过后
                        //   再想换的话就会卡住，就没有那个选项了，就不能再修改了」）
                        //   两个毛病：
                        //     ① 这块原来在 `生成条目.length` 里面 —— **跑完才出现** ✗
                        //        → 挪到外面，面板一开就能设 ✓
                        //     ② 再点「选文件夹」时**不重新读目录**（`if (!生成目录列)`）——
                        //        看到的还是上次那份，像卡住 ✗ → 每次打开都重读 ✓
                        React.createElement(
                          'div',
                          { key: 'save', style: { marginTop: 8 } },
                          React.createElement(
                            'div',
                            { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                            React.createElement('b', null, '④ 存到哪儿'),
                            React.createElement('span', { style: S.dim }, '跑完就存到这个文件 —— 能直接改，也能点「选文件夹」挑'),
                          ),
                          React.createElement(
                            'div',
                            { style: Object.assign({}, S.nameBox, { marginTop: 6 }) },
                            React.createElement('div', { style: { flex: 'none', width: 72 } }, '存到'),
                            React.createElement('input', {
                              style: Object.assign({}, S.inp, { flex: 1, width: 'auto', minWidth: 140 }),
                              value: 生成存到,
                              placeholder: '要存的完整路径（比如 D:\\档案\\导出的档案.md）',
                              onChange: (e) => set生成存到(e.target.value),
                            }),
                            React.createElement(
                              'button',
                              {
                                style: S.btn,
                                onClick: () => {
                                  const 要开 = !生成选目录
                                  set生成选目录(要开)
                                  // ⚠ 每次打开都**重读一遍**（原来只在第一次读，再打开看到的是旧的）
                                  if (要开) {
                                    // 从当前路径所在的目录开始（拿不到就从盘符列表开始）
                                    const 起点 = /[\\/]/.test(生成存到) ? 生成存到.replace(/[\\/][^\\/]*$/, '') : ''
                                    post('/dirs', { path: 起点 })
                                      .then((r) => set生成目录列(r))
                                      .catch((e) => 记(['列不了目录：' + ((e && e.message) || e)]))
                                  }
                                },
                              },
                              生成选目录 ? '收起' : '选文件夹',
                            ),
                          ),
                          // 文件夹选择器（跟「从旧档案导入」那个是同一个接口）
                          生成选目录 && 生成目录列
                            ? React.createElement(
                                'div',
                                { style: { margin: '4px 0 0', padding: '6px 10px', borderRadius: 6, background: 'rgba(128,128,128,.10)', border: '1px solid rgba(128,128,128,.22)', fontSize: 12 } },
                                React.createElement(
                                  'div',
                                  { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 } },
                                  React.createElement('span', { style: S.dim }, 生成目录列.path ? '当前：' + 生成目录列.path : '选一个盘'),
                                  React.createElement('div', { style: { flex: 1 } }),
                                  // ⚠ 选择器里也放一个「收起」—— 别只能靠上面那个按钮
                                  React.createElement('button', { style: S.btn, onClick: () => set生成选目录(false) }, '收起'),
                                ),
                                生成目录列.ok === false
                                  ? React.createElement('div', { style: S.drop }, '✗ ' + (生成目录列.message || '列不了'))
                                  : React.createElement(
                                      'div',
                                      null,
                                      React.createElement(
                                        'div',
                                        { style: Object.assign({}, S.dim, { marginBottom: 4 }) },
                                        生成目录列.path
                                          ? '「' + 生成目录列.path + '」下的文件夹（点一下就进去）：'
                                          : '选一个盘：',
                                      ),
                                      React.createElement(
                                        'div',
                                        { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
                                        生成目录列.parent
                                          ? React.createElement(
                                              'span',
                                              {
                                                style: S.link,
                                                onClick: () =>
                                                  post('/dirs', { path: 生成目录列.parent }).then((r) => set生成目录列(r)).catch(() => {}),
                                              },
                                              '↑ 上一级',
                                            )
                                          : null,
                                        (生成目录列.dirs || []).map((d) =>
                                          React.createElement(
                                            'span',
                                            {
                                              key: d.path,
                                              style: S.link,
                                              onClick: () =>
                                                post('/dirs', { path: d.path }).then((r) => set生成目录列(r)).catch(() => {}),
                                            },
                                            '📁 ' + d.name,
                                          ),
                                        ),
                                      ),
                                      // 「就用这个文件夹」—— 把路径拼成 <文件夹>\导出的档案.md
                                      生成目录列.path
                                        ? React.createElement(
                                            'div',
                                            { style: { marginTop: 6 } },
                                            React.createElement(
                                              'button',
                                              {
                                                style: S.btn,
                                                onClick: () => {
                                                  const p = String(生成目录列.path).replace(/[\\/]+$/, '')
                                                  set生成存到(p + '\\导出的档案.md')
                                                  set生成选目录(false)
                                                },
                                              },
                                              '就用这个文件夹',
                                            ),
                                            React.createElement(
                                              'span',
                                              { style: Object.assign({}, S.dim, { marginLeft: 8 }) },
                                              '→ 存成「导出的档案.md」（也可以先点进去子文件夹再点这个）',
                                            ),
                                          )
                                        : React.createElement(
                                            'div',
                                            { style: Object.assign({}, S.dim, { marginTop: 6 }) },
                                            '先点进一个盘，再点「就用这个文件夹」',
                                          ),
                                    ),
                              )
                            : null,
                        ),
    
                        // 攒下来的条目 + 存文件
                        // ⚠ 2026-10-26：原来只在「条目 > 0」时渲染 —— 0 条时界面上只留一句
                        //   「点『存成档案文件』」，按钮根本不存在，用户只能到处找 ✗
                        //   → 算过计划就画出来；0 条时按钮置灰、旁边写明为什么。
                        生成计划
                          ? React.createElement(
                              'div',
                              { key: 'r', style: { marginTop: 8 } },
                              React.createElement(
                                'div',
                                { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                                React.createElement('b', null, '攒了 ' + 生成条目.length + ' 条'),
                                React.createElement(
                                  'button',
                                  {
                                    style: S.btn,
                                    disabled: 忙 || !!(生成进度 && 生成进度.在跑) || !生成条目.length,
                                    onClick: () => 存生成(),
                                  },
                                  '存成档案文件',
                                ),
                                React.createElement(
                                  'span',
                                  { style: S.dim },
                                  生成条目.length
                                    ? '存成一份 markdown；然后再用下面的「从旧档案导入」把它变成记忆条目'
                                    : '还没有条目可存 —— 这一轮模型一条都没收（也可能输出被截断，诊断日志里有回文长度）',
                                ),
                              ),
                              生成条目.length
                                ? React.createElement(
                                    'div',
                                    { style: Object.assign({}, S.dim, { marginTop: 4, maxHeight: 200, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-line' }) },
                                    生成条目.slice(0, 40).map((x) => x.章 + '|' + x.日期 + '|' + x.话).join('\n') +
                                      (生成条目.length > 40 ? '\n…（还有 ' + (生成条目.length - 40) + ' 条）' : ''),
                                  )
                                : null,
                            )
                          : null,
    
                        // 存好了
                        生成档
                          ? React.createElement(
                              'div',
                              { key: 'ok', style: { marginTop: 8 } },
                              React.createElement('div', null, '✓ 档案存到：' + 生成档.存到),
                              React.createElement(
                                'div',
                                { style: Object.assign({}, S.dim, { marginTop: 2 }) },
                                '共 ' + 生成档.条数 + ' 条' + (生成档.去掉重复 ? '（去掉了 ' + 生成档.去掉重复 + ' 条重复）' : ''),
                              ),
                            )
                          : null,
                      ],
                    )
                  : null,
    )
  }
  return 生成档案区
}
