// 工具拦截 —— 2026-11-21 新增（1.12.71）
//   ⚠ 原来的配置界面上错地方了：1.12.70 把「工具拦截」区块塞进了老的独立网页
//     （/dsh-clay-memory/page，lib/ui.mjs 的 MEMORY_PAGE），可用户是在 DSH 设置里的
//     「黏土记忆」详情页（React，六个页签）找的 —— 那里根本没有那一块，当然「没看到」。
//   → 这里是详情页的第七个页签「拦截」。
//   后端接口 1.12.70 就已经有了，不用改：
//     GET  /guard        → { ok, enabled, rules, 工作区们, 编译错误, 配置文件 }
//     POST /guard/save   → { enabled, rules } 整批存（坏规则整批拒收）
//     POST /guard/test   → { tool, args, workspace, rules? } 干跑，不落盘
export function 造拦截页({ React, el, get, post, S }) {

  // 把界面上那条（字符串）折回后端认的形状
  function 收一条(r) {
    const 正则表 = {}
    let 参数 = null
    const 文 = String(r.args || '').trim()
    if (文) {
      try {
        参数 = JSON.parse(文)
      } catch (_) {
        return { 错: '参数不是合法 JSON' }
      }
    }
    if (参数 && typeof 参数 === 'object' && !Array.isArray(参数)) {
      Object.keys(参数).forEach((k) => {
        正则表[k] = 参数[k]
      })
    } else if (参数 !== null) {
      return { 错: '参数得是对象，形如 {"file_path":["^..."], "命令":["..."]}' }
    }
    const 工具们 = String(r.tools || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
    if (!工具们.length) return { 错: '至少写一个工具名（* 表示全部）' }
    const 区们 = String(r.workspace || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
    const 条 = {
      id: String(r.id || '').trim() || undefined,
      tools: 工具们,
      action: 'deny',
      reason: String(r.reason || '').trim() || undefined,
    }
    if (Object.keys(正则表).length) 条.args = 正则表
    if (区们.length) 条.workspace = 区们.length === 1 ? 区们[0] : 区们
    return { 条 }
  }

  // 后端返回的一条 → 界面上的字符串
  function 摊一条(r) {
    return {
      id: String((r && r.id) || ''),
      tools: Array.isArray(r && r.tools) ? r.tools.join(', ') : String((r && r.tools) || ''),
      args: r && r.args ? JSON.stringify(r.args) : '',
      workspace: Array.isArray(r && r.workspace) ? r.workspace.join(', ') : String((r && r.workspace) || ''),
      reason: String((r && r.reason) || ''),
    }
  }

  function 拦截页() {
    const [开, set开] = React.useState(false) // 总闸
    const [规则, set规则] = React.useState([]) // 可编辑的字符串态
    const [工作区们, set工作区们] = React.useState([])
    const [配置错误, set配置错误] = React.useState([]) // 后端存的那些规则编译出的错
    const [载入中, set载入中] = React.useState(true)
    const [提示, set提示] = React.useState(null) // { 样: 'ok'|'drop'|'warn', 文 }
    const [存中, set存中] = React.useState(false)

    // 干跑
    const [测工具, set测工具] = React.useState('read')
    const [测参数, set测参数] = React.useState('{"file_path":"G:\\\\Windows\\\\system.ini"}')
    const [测工作区, set测工作区] = React.useState('')
    const [测结果, set测结果] = React.useState(null)
    const [测中, set测中] = React.useState(false)
    // 单条测试：{ i: 第几条, 结果 } —— 用这一条 + 干跑区的输入试一次，结果就地显示在这张卡里
    const [单测, set单测] = React.useState(null)

    // 一句话 → 规则（1.12.72）：只翻译，翻出来的东西要人看过才并入规则表
    const [人话, set人话] = React.useState('')
    const [翻中, set翻中] = React.useState(false)
    const [翻结果, set翻结果] = React.useState(null)

    const 读 = React.useCallback(() => {
      get('/guard')
        .then((x) => {
          set开(!!(x && x.enabled))
          set规则(Array.isArray(x && x.rules) ? x.rules.map(摊一条) : [])
          set工作区们(Array.isArray(x && x.工作区们) ? x.工作区们 : [])
          set配置错误(Array.isArray(x && x.编译错误) ? x.编译错误 : [])
          set载入中(false)
        })
        .catch((e) => {
          set载入中(false)
          set提示({ 样: 'drop', 文: '读不到拦截配置：' + String((e && e.message) || e) })
        })
    }, [])
    React.useEffect(() => {
      读()
    }, [读])

    const 改一条 = (i, 键, 值) => {
      set规则((prev) => prev.map((r, j) => (j === i ? Object.assign({}, r, { [键]: 值 }) : r)))
      set提示(null)
      set单测(null)
    }
    const 加一条 = () => {
      set规则((prev) => prev.concat([{ id: '', tools: '', args: '', workspace: '', reason: '' }]))
      set提示(null)
      set单测(null)
    }
    const 删一条 = (i) => {
      set规则((prev) => prev.filter((_, j) => j !== i))
      set提示(null)
      set单测(null)
    }

    // 单条测试：只拿这一条 + 干跑区填的工具/参数/工作区去问，不落盘
    function 测一条(i) {
      const 一 = 收一条(规则[i])
      if (一.错) {
        set单测({ i, 结果: { ok: false, error: '这条写法有问题：' + 一.错 } })
        return
      }
      const 工具 = String(测工具 || '').trim()
      if (!工具) {
        set单测({ i, 结果: { ok: false, error: '先在下面「干跑一次」里填个工具名（比如 read）' } })
        return
      }
      let 参数 = null
      const 文 = String(测参数 || '').trim()
      if (文) {
        try {
          参数 = JSON.parse(文)
        } catch (_) {
          set单测({ i, 结果: { ok: false, error: '下面干跑区的参数不是合法 JSON' } })
          return
        }
      }
      set单测({ i, 结果: { 载入: true } })
      post('/guard/test', { tool: 工具, args: 参数, workspace: 测工作区, rules: [一.条] })
        .then((x) => set单测({ i, 结果: x || { ok: false, error: '后端没返回' } }))
        .catch((e) => set单测({ i, 结果: { ok: false, error: String((e && e.message) || e) } }))
    }

    function 单测样式(结果) {
      if (!结果 || 结果.载入) return S.dim
      if (!结果.ok) return S.drop
      return 结果.拦不拦 ? S.ok : S.warn
    }
    function 单测文字(结果) {
      if (!结果) return ''
      if (结果.载入) return '试中…'
      if (!结果.ok) return '没试成：' + String(结果.error || '')
      if (结果.拦不拦) {
        const 规 = 结果.命中的 || {}
        return '✓ 这条会拦下这次调用' + (规.reason ? '；对助手说「' + 规.reason + '」' : '')
      }
      return '✗ 这条拦不住这次调用 —— 工具名或参数正则没对上'
    }

    // 整批折成后端形状；有一条坏就整批不存（跟后端一个态度，别让它存一半）
    function 折规则() {
      const 出 = []
      const 错 = []
      规则.forEach((r, i) => {
        const 一 = 收一条(r)
        if (一.错) 错.push('第 ' + (i + 1) + ' 条：' + 一.错)
        else 出.push(一.条)
      })
      return { 出, 错 }
    }

    function 存() {
      const { 出, 错 } = 折规则()
      if (错.length) {
        set提示({ 样: 'drop', 文: '先改这两处再存：' + 错.join('；') })
        return
      }
      set存中(true)
      post('/guard/save', { enabled: 开, rules: 出 })
        .then((x) => {
          set存中(false)
          if (x && x.ok === false) {
            set提示({ 样: 'drop', 文: '没存进去：' + String(x.error || '（后端没给原因）') })
            return
          }
          set提示({ 样: 'ok', 文: '存好了，立刻生效（不用重启）' })
          读()
        })
        .catch((e) => {
          set存中(false)
          set提示({ 样: 'drop', 文: '存失败：' + String((e && e.message) || e) })
        })
    }

    function 试() {
      let 参数 = null
      const 文 = String(测参数 || '').trim()
      if (文) {
        try {
          参数 = JSON.parse(文)
        } catch (e) {
          set测结果({ ok: false, error: '参数不是合法 JSON：' + String((e && e.message) || e) })
          return
        }
      }
      const { 出, 错 } = 折规则()
      if (错.length) {
        set测结果({ ok: false, error: '表里有写坏的规则，先修：' + 错.join('；') })
        return
      }
      set测中(true)
      set测结果(null)
      post('/guard/test', { tool: String(测工具 || '').trim(), args: 参数, workspace: 测工作区, rules: 出 })
        .then((x) => {
          set测中(false)
          set测结果(x || { ok: false, error: '后端没返回' })
        })
        .catch((e) => {
          set测中(false)
          set测结果({ ok: false, error: String((e && e.message) || e) })
        })
    }

    // 一句话 → 规则草稿。**只翻译不保存** —— 翻歪了得在存之前就看得出来。
    function 翻一句() {
      const 话 = String(人话 || '').trim()
      if (!话) {
        set翻结果({ ok: false, error: '先在框里写一句要求，比如「别读 Windows 目录里的文件」' })
        return
      }
      set翻中(true)
      set翻结果(null)
      post('/guard/translate', { text: 话 })
        .then((x) => {
          set翻中(false)
          set翻结果(x || { ok: false, error: '后端没返回' })
        })
        .catch((e) => {
          set翻中(false)
          set翻结果({ ok: false, error: String((e && e.message) || e) })
        })
    }

    function 并入规则表() {
      const 条 = 翻结果 && Array.isArray(翻结果.规则们) ? 翻结果.规则们 : []
      if (!条.length) return
      set规则((prev) => prev.concat(条.map(摊一条)))
      set提示({ 样: 'ok', 文: '已把 ' + 条.length + ' 条草稿并入下面的规则表 —— 看过没问题再点上面的「保存」' })
      set翻结果(null)
    }

    const 输入条 = (键, 宽, 占位, 值, i, 额外) => {
      const 样式 = Object.assign({}, S.inp, { padding: '4px 8px', fontSize: 12.5 }, 宽 ? { width: 宽 } : null, 额外 || {})
      return el('input', {
        value: 值,
        placeholder: 占位,
        onChange: (e) => 改一条(i, 键, e.target.value),
        style: 样式,
      })
    }

    // 一格子：左边短标签，右边输入框，说明小字挂在输入框下面（2026-11-21 主人给的样式）
    const 字段 = (名, 小字, 子, 额外) =>
      el(
        'div',
        { style: Object.assign({ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0, padding: '6px 0' }, 额外 || {}) },
        el('span', { style: { flex: '0 0 56px', fontSize: 13, lineHeight: '26px', opacity: 0.9, whiteSpace: 'nowrap' } }, 名),
        el(
          'div',
          { style: { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 } },
          子,
          el('span', { style: Object.assign({}, S.dim, { fontSize: 11, lineHeight: 1.5 }) }, 小字),
        ),
      )

    const 翻译块 = el(
      'div',
      { style: S.editBox },
      el('div', { style: { fontWeight: 600, marginBottom: 4 } }, '用一句话说（可选）'),
      el(
        'div',
        { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 6 }) },
        '写人话，让插件自己的模型翻成规则草稿。翻出来**不会直接生效** —— 得你并入下面的规则表、看过、再点「保存」。每翻一次要花一点 token。',
      ),
      el('textarea', {
        value: 人话,
        rows: 2,
        onChange: (e) => set人话(e.target.value),
        placeholder: '例如：别让助手读 Windows 和 Program Files 里的文件',
        style: S.area,
      }),
      el(
        'div',
        { style: Object.assign({}, S.row, { marginTop: 6, alignItems: 'center' }) },
        el('button', { style: Object.assign({}, S.btn, { opacity: 翻中 ? 0.6 : 1 }), onClick: 翻一句 }, 翻中 ? '翻…' : '翻成规则'),
        el('span', { style: Object.assign({}, S.dim, { fontSize: 11.5 }) }, '只能说「拦什么」；「除了某处以外都放行」这种现在还表达不出来'),
      ),
      翻结果 && 翻结果.ok === false
        ? el(
            'div',
            { style: Object.assign({}, S.drop, { marginTop: 6, fontSize: 12 }) },
            '没翻出来：' + String(翻结果.error || ''),
            翻结果.原文
              ? el('div', { style: Object.assign({}, S.dim, { marginTop: 4, fontSize: 11 }) }, '模型原文：' + String(翻结果.原文))
              : null,
          )
        : null,
      翻结果 && 翻结果.ok
        ? el(
            'div',
            { style: { marginTop: 8, fontSize: 12.5 } },
            Array.isArray(翻结果.规则们) && 翻结果.规则们.length
              ? el(
                  'div',
                  null,
                  el(
                    'div',
                    { style: { fontWeight: 600, marginBottom: 4 } },
                    '翻出 ' + 翻结果.规则们.length + ' 条' + (翻结果.截断 ? '（模型没写全，只救回这些）' : '') + '：',
                  ),
                  翻结果.规则们.map((r, i) =>
                    el(
                      'div',
                      { key: i, style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 2 }) },
                      i + 1 + '. ' + String((r && r.id) || '（没名字）') +
                        ' · 工具 ' + (Array.isArray(r && r.tools) ? r.tools.join(', ') : String((r && r.tools) || '')) +
                        (r && r.args ? ' · 参数 ' + JSON.stringify(r.args) : '') +
                        (r && r.workspace ? ' · 只在 ' + (Array.isArray(r.workspace) ? r.workspace.join(', ') : r.workspace) : '') +
                        (r && r.reason ? ' · 「' + r.reason + '」' : ''),
                    ),
                  ),
                  Array.isArray(翻结果.编译错误) && 翻结果.编译错误.length
                    ? el(
                        'div',
                        { style: Object.assign({}, S.warn, { fontSize: 11.5, marginTop: 4 }) },
                        '有 ' + 翻结果.编译错误.length + ' 条写得不对，并入后要改：' + 翻结果.编译错误.join('；'),
                      )
                    : null,
                  el('button', { style: Object.assign({}, S.btn, { marginTop: 6 }), onClick: 并入规则表 }, '并入规则表'),
                )
              : el('div', { style: S.dim }, '模型认为这句话里没有需要拦的东西（回了空数组）。'),
            翻结果.用
              ? el('div', { style: Object.assign({}, S.dim, { fontSize: 11, marginTop: 6 }) }, '用的模型：' + String(翻结果.用))
              : null,
          )
        : null,
    )

    // 一条规则一张小卡：名字一行，工具/工作区两列，参数与理由各占一行。
    //   2026-11-21 改造前是五个定宽 input 横排，JSON 只有半截、也看不出哪个是哪个。
    const 规则卡 = (r, i) =>
      el(
        'div',
        {
          key: i,
          style: {
            margin: '8px 0',
            padding: '8px 10px 10px',
            borderRadius: 8,
            border: '1px solid rgba(128,128,128,.28)',
            background: 'rgba(128,128,128,.08)',
          },
        },
        el(
          'div',
          { style: Object.assign({}, S.row, { alignItems: 'center', rowGap: 6 }) },
          el('span', { style: Object.assign({}, S.secTag, { flex: 'none' }) }, '规则 ' + (i + 1)),
          输入条('id', 0, '给这条起个名字（可空）', r.id, i, { flex: 1, minWidth: 180 }),
          el('button', { style: Object.assign({}, S.btnDanger, { flex: 'none' }), onClick: () => 删一条(i) }, '删掉'),
          el(
            'button',
            {
              style: Object.assign({}, S.btn, { flex: 'none', opacity: 单测 && 单测.i === i && 单测.结果 && 单测.结果.载入 ? 0.6 : 1 }),
              title: '用下面「干跑一次」里填的工具和参数，试试这一条拦不拦得住',
              onClick: () => 测一条(i),
            },
            '测试',
          ),
        ),
        字段('工具', '拦哪些工具 · 逗号分隔 · bash* 通配 · * = 全部', 输入条('tools', 0, 'read, write, bash*', r.tools, i, { width: '100%' })),
        字段('工作区', '只在哪个工作区生效 · 空 = 哪都拦', 输入条('workspace', 0, 'G:\\DSH_WORKSPACE\\需求开发', r.workspace, i, { width: '100%' })),
        字段(
          '参数',
          '匹配哪些参数 · JSON · 键之间「且」· 同一个键里多个正则「或」· 空 = 只按工具名拦',
          el('input', {
            value: r.args || '',
            placeholder: '{"file_path":["^[A-Za-z]:[\\\\\\\\/]Windows[\\\\\\\\/]"]}',
            onChange: (e) => 改一条(i, 'args', e.target.value),
            style: Object.assign({}, S.inp, { width: '100%', fontFamily: 'ui-monospace, Consolas, monospace' }),
          }),
        ),
        字段(
          '反馈',
          '拦下时对助手说的话 · 写该怎么做，比只写「不行」有用',
          输入条('reason', 0, 'Windows 系统目录不归助手管，换个位置', r.reason, i, { width: '100%' }),
        ),
        单测 && 单测.i === i
          ? el('div', { style: Object.assign({}, 单测样式(单测.结果), { fontSize: 12, marginTop: 8 }) }, 单测文字(单测.结果))
          : null,
      )

    const 规则表 = el(
      'div',
      null,
      el('div', { style: Object.assign({}, S.dim, { marginBottom: 4 }) }, '一条 = 匹配哪些工具 + 匹配哪些参数 + 拦在哪个工作区。参数键之间是「且」，同一个键里多个正则是「或」。参数没出现就不拦（宁可少拦）。'),
      规则.length === 0
        ? el(
            'div',
            { style: Object.assign({}, S.editBox, { margin: '8px 0', textAlign: 'center', fontSize: 12.5 }) },
            '还没有规则。点下面「加一条」——不知道怎么写，先看页脚的三个例子。',
          )
        : el('div', null, 规则.map(规则卡)),
      el('div', { style: { marginTop: 10 } }, el('button', { style: S.btn, onClick: 加一条 }, '加一条规则')),
    )

    const 输入框 = (值, 改, 占位, 额外) =>
      el('input', {
        value: 值,
        placeholder: 占位,
        onChange: (e) => 改(e.target.value),
        style: Object.assign({}, S.inp, { padding: '4px 8px', fontSize: 12.5, width: '100%' }, 额外 || {}),
      })

    const 示例们 = [
      {
        名: '别碰 Windows 系统目录',
        说明: '读、写、改、shell 全都管；路径正则同时认正斜杠和反斜杠',
        规则: {
          id: '别碰 Windows 系统目录',
          tools: ['read', 'write', 'edit', 'bash*'],
          args: { file_path: ['^[A-Za-z]:[\\\\/]Windows[\\\\/]'] },
          reason: 'Windows 系统目录不归助手管，要改东西去自己的目录',
        },
      },
      {
        名: '只在这个工作区里生效',
        说明: '工作区写前缀加 *，别的项目里这条就不拦',
        规则: {
          id: '只在这个工作区里生效',
          tools: ['*'],
          workspace: 'G:\\DSH_WORKSPACE\\*',
          reason: '这条只管这个工作区',
        },
      },
      {
        名: '别手改记忆库',
        说明: '按文件名片段拦，不用跟反斜杠较劲',
        规则: {
          id: '别手改记忆库',
          tools: ['read', 'edit', 'write'],
          args: { file_path: ['clay-memory.*_facts'] },
          reason: '记忆库由插件自己写，手改容易把格式弄坏',
        },
      },
    ]

    function 按这个加一条(示例) {
      set规则((prev) => prev.concat([摊一条(示例.规则)]))
      set提示({ 样: 'ok', 文: '已按「' + 示例.名 + '」加了一条，改完记得点上面的「保存」' })
    }

    const 示例块 = el(
      'div',
      { style: S.sec },
      el(
        'div',
        { style: S.secH },
        el('span', { style: S.secTitle }, '怎么写一条'),
        el('span', { style: S.secTag }, '点一下就填进规则表'),
      ),
      示例们.map((示例, i) =>
        el(
          'div',
          {
            key: 'ex' + i,
            style: {
              margin: '6px 0',
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid rgba(128,128,128,.22)',
              background: 'rgba(128,128,128,.06)',
            },
          },
          el('div', { style: { fontSize: 12.5, fontWeight: 600 } }, i + 1 + '. ' + 示例.名),
          el('div', { style: Object.assign({}, S.dim, { fontSize: 11.5, lineHeight: 1.7, margin: '2px 0 6px' }) }, 示例.说明),
          el('button', { style: S.btn, onClick: () => 按这个加一条(示例) }, '按这个加一条'),
        ),
      ),
    )

    const 测试块 = el(
      'div',
      { style: S.editBox },
      el('div', { style: Object.assign({}, S.dim, { marginBottom: 2 }) }, '干跑一次：不走真工具，只问「这次调用会不会被拦」。改完不存也能试。'),
      字段('工具', '要试的工具名 · read / bash / write …', 输入框(测工具, set测工具, 'read')),
      字段('工作区', '空 = 不限（不按工作区过滤）', 输入框(测工作区, set测工作区, '空 = 不限')),
      字段(
        '参数',
        '这次调用带的参数 · JSON · 留空 = 没有参数',
        el('textarea', {
          value: 测参数,
          rows: 3,
          onChange: (e) => set测参数(e.target.value),
          placeholder: '{"file_path":"G:\\\\Windows\\\\system.ini"}',
          style: Object.assign({}, S.area, { fontSize: 12, width: '100%' }),
        }),
      ),
      el('div', { style: { marginTop: 10, paddingLeft: 66 } }, el('button', { style: Object.assign({}, S.btn, { opacity: 测中 ? 0.6 : 1 }), onClick: 试 }, 测中 ? '试…' : '试试拦不拦')),
      测结果 && 测结果.ok === false
        ? el('div', { style: Object.assign({}, S.drop, { marginTop: 6, fontSize: 12 }) }, '试不了：' + String(测结果.error || ''))
        : null,
      测结果 && 测结果.ok
        ? el(
            'div',
            { style: { marginTop: 8, fontSize: 12.5 } },
            el(
              'div',
              { style: Object.assign({}, 测结果.拦不拦 ? S.drop : S.ok, { fontWeight: 600 }) },
              测结果.拦不拦 ? '会被拦下' : '不会被拦，会照常执行',
            ),
            测结果.拦不拦 && 测结果.命中的
              ? el('div', { style: { marginTop: 4 } }, '命中规则：' + String(测结果.命中的.id || '（没写名字）') + ' —— ' + String(测结果.命中的.reason || '（它没说理由）'))
              : null,
            el('div', { style: Object.assign({}, S.dim, { marginTop: 4 }) }, '这条会话的工作区：' + (测结果.工作区 || '（查不到）')),
            Array.isArray(测结果.逐条) && 测结果.逐条.length
              ? el(
                  'div',
                  { style: Object.assign({}, S.dim, { marginTop: 6 }), },
                  测结果.逐条.map((x, i) =>
                    el(
                      'div',
                      { key: i, style: { fontSize: 12 } },
                      (x.中 ? '✓ ' : '✗ ') + String(x.id || '第 ' + (i + 1) + ' 条') + (x.workspace === false ? '（工作区不对）' : ''),
                    ),
                  ),
                )
              : null,
          )
        : null,
    )

    if (载入中) return el('div', { style: S.dim }, '正在读拦截配置…')

    return el(
      'div',
      { style: S.wrap },
      el(
        'div',
        { style: S.sec },
        el(
          'div',
          { style: S.secH },
          el('span', { style: S.secTitle }, '工具拦截'),
          el('span', { style: S.secTag }, 'Beta'),
          el('span', { style: Object.assign({}, S.dim, { fontSize: 11.5 }) }, '命中就拦下不执行，不是提示'),
        ),
        el(
          'div',
          { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 8 }) },
          '规则完全由你写，插件一条都不内置 —— 它只负责「拦住」。在哪配都生效：这里、配置文件、老的独立网页。改完立刻生效，不用重启。',
        ),
        el(
          'div',
          { style: Object.assign({}, S.warn, { fontSize: 12, lineHeight: 1.5, marginBottom: 8, padding: '6px 8px', borderRadius: 6, background: 'rgba(224,176,112,.10)', border: '1px solid rgba(224,176,112,.28)' }) },
          'Beta —— 这是一道「提醒」，不是「保险箱」。它只按「工具名 + 参数正则」去比，写法不对、路径换个写法（比如 /c/Windows）、或者本机工具名跟规则里写的不一样，都可能漏；漏掉的时候工具会照常执行，它不知道。要紧的东西别只指望它 —— 要真兜底，把会话的文件权限收紧（沙箱 / 审批），那道才拦得住「不该写的目录」。',
        ),
        el(
          'div',
          { style: Object.assign({}, S.row, { alignItems: 'center', padding: '4px 0' }) },
          el(
            'label',
            { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
            el('input', { type: 'checkbox', checked: 开, onChange: (e) => { set开(e.target.checked); set提示(null) } }),
            '总开关（关掉 = 全部放行）',
          ),
          el('button', { style: Object.assign({}, S.btn, { opacity: 存中 ? 0.6 : 1 }), onClick: 存 }, 存中 ? '存…' : '保存'),
          el('button', { style: S.btn, onClick: 读 }, '刷新'),
          el('span', { style: Object.assign({}, S.dim, { fontSize: 11.5, marginLeft: 'auto' }) }, '改完点「保存」才会写回配置文件'),
        ),
        提示
          ? el('div', { style: Object.assign({}, 提示.样 === 'ok' ? S.ok : S.drop, { fontSize: 12, marginTop: 6 }) }, 提示.文)
          : null,
        配置错误.length
          ? el(
              'div',
              { style: Object.assign({}, S.warn, { fontSize: 12, marginTop: 6 }) },
              '配置文件里有 ' + 配置错误.length + ' 条写法不对（那条会被跳过，不连累别的）：' + 配置错误.join('；'),
            )
          : null,
      ),
      el('div', { style: S.sec }, 翻译块),
      el('div', { style: S.sec }, 规则表),
      el('div', { style: S.sec }, 测试块),
      示例块,
    )
  }

  return { 拦截页 }
}
