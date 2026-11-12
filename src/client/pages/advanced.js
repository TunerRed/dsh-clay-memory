// 高级区 —— 2026-11-11 从 lib/client.js 拆出来（逻辑未改）
// 依赖由正文注入；模块内部自成一体。
import { 造选择器 } from '../components/select.js'

// 参数分组（权重 / 遗忘速度 / 门槛与条数）—— 只在参数区用，跟着页面走
const GROUPS = [
  ['weight', '权重', '决定「什么更容易被想起来」。四项加起来必须是 100% —— 你改一项，其余三项自动让位，你填的数会尽量保住。'],
  ['time', '遗忘速度', '数字越大 = 忘得越慢。淡了只是不容易被想起来，不会删。'],
  ['gate', '门槛与条数', '控制「一次塞多少给她」。'],
]

export function 造高级区({ React, el, get, post, S, G, toPct, fromPct, 进度, 更新条 }) {
      const 选择器 = 造选择器({ React, el })

      function 参数区() {
        const [params, setParams] = React.useState(null)
        const [spec, setSpec] = React.useState(null)
        const [pin, setPin] = React.useState(null) // 她刚改的那一项权重
        const [editing, setEditing] = React.useState(null) // 正在打字的那格（原样显示她敲的字）
        const [notes, setNotes] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [开, set开] = React.useState(false) // ⭐ 默认收起（调一次就不动，不占地方）
        const [均长, set均长] = React.useState(0) // ⭐ F10 阶段 0（1.12.25）：当前库平均条长，用来算名额×字长的联动
        const load = React.useCallback(() => {
          get('/list')
            .then((x) => {
              if (x && x.policy) setParams(Object.assign({}, x.policy))
              setSpec(Array.isArray(x && x.spec) ? x.spec.slice() : [])
              setNotes(null)
            })
            .catch((e) => setNotes(['读不到参数：' + String((e && e.message) || e)]))
          get('/health?days=7')
            .then((h) => set均长(Number(h && h.汇总 && h.汇总.平均字数) || 0))
            .catch(() => {})
        }, [])
        React.useEffect(() => {
          load()
        }, [load])
  
        // 折叠头（照原「会话 → 参数」的样子：▸ 参数 · 调一次就不动 · 点开调）
        const 头 = el(
          'div',
          { style: Object.assign({}, S.secH, { cursor: 'pointer', marginBottom: 开 ? 8 : 0 }), onClick: () => set开(!开) },
          el('span', { style: S.secTitle }, (开 ? '▾ ' : '▸ ') + '参数'),
          el('span', { style: S.secTag }, '调一次就不动 · 点开调'),
        )
        if (!开) return el('div', { style: S.sec }, 头)
        if (!params || !spec) return el('div', { style: S.sec }, 头, el('div', { style: S.dim }, '正在读参数…'))
  
        const WK = spec.filter((s) => s.group === 'weight').map((s) => s.key)
        const wSum = WK.length ? Math.round(WK.reduce((a, k) => a + toPct(params[k] || 0), 0) * 10) / 10 : 0
        const setOne = (k, native) => {
          // 函数式更新 —— 连着改两格不会互相覆盖 ✓
          setParams((prev) => Object.assign({}, prev, { [k]: native }))
          if (WK.indexOf(k) >= 0) setPin(k)
          setNotes(null)
        }
        const oneRow = (s) => {
          const isW = s.group === 'weight'
          const lo = isW ? toPct(s.min) : s.min
          const hi = isW ? toPct(s.max) : s.max
          const cur = isW ? toPct(params[s.key]) : params[s.key]
          const typing = editing && editing.key === s.key
          const unit = isW ? '%' : s.unit || ''
          const head = [
            el('span', { key: 'lbl', style: { flex: '0 0 auto', fontSize: 12 } }, s.label),
            el('input', {
              key: 'inp',
              type: 'number',
              style: Object.assign({}, S.inp, { fontSize: 12, width: 64, padding: '3px 6px' }),
              min: lo,
              max: hi,
              step: isW ? 0.1 : s.step,
              value: typing ? editing.text : String(cur),
              onChange: (e) => {
                const t = e.target.value
                setEditing({ key: s.key, text: t })
                const n = Number(t)
                if (t !== '' && isFinite(n)) setOne(s.key, isW ? fromPct(n) : n)
              },
              onBlur: () => setEditing(null),
            }),
          ]
          if (unit) head.push(el('span', { key: 'unit', style: Object.assign({}, S.dim, { fontSize: 12 }) }, unit))
          head.push(el('span', { key: 'rng', style: Object.assign({}, S.dim, { fontSize: 11, opacity: 0.7 }) }, '（' + lo + ' ~ ' + hi + '）'))
          // ⭐ F10 阶段 0（1.12.25）：名额 × 字长的联动 —— 光看数字看不出「6 条 × 176 字 > 800 预算」
          const 估 = (() => {
            const 均 = Number(均长) || 0
            const 预算 = Number(params.maxChars) || 0
            if (!均 || !预算) return null
            if (s.key === 'factsMax' && Number(cur) > 0) {
              const 名义 = Math.round(均 * Number(cur))
              if (名义 > 预算) {
                const 能进 = Math.min(Number(cur), Math.floor(预算 / 均))
                return { 超: true, text: '按当前库均长 ' + 均 + ' 字算：' + cur + ' 条 × ' + 均 + ' 字 = ' + 名义 + ' 字，超出 ' + 预算 + ' 字预算，实际大约只能进 ' + 能进 + ' 条' }
              }
              return { 超: false, text: '按当前库均长 ' + 均 + ' 字算：' + cur + ' 条 × ' + 均 + ' 字 = ' + 名义 + ' 字，' + 预算 + ' 字预算装得下' }
            }
            if (s.key === 'maxChars' && Number(cur) > 0) {
              return { 超: false, text: '按当前库均长 ' + 均 + ' 字算：这个预算大约装得下 ' + Math.floor(Number(cur) / 均) + ' 条（名额 ' + (Number(params.factsMax) || 0) + ' 条）' }
            }
            return null
          })()
          return el(
            'div',
            { key: s.key, style: { margin: '5px 0' } },
            el('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' } }, head),
            估
              ? el(
                  'div',
                  { style: Object.assign({}, S.dim, { fontSize: 11, marginTop: 1, lineHeight: 1.45 }, 估.超 ? { color: '#c2410c', opacity: 0.95 } : { opacity: 0.75 }) },
                  估.text,
                )
              : null,
            s.tip
              ? el('div', { style: Object.assign({}, S.dim, { fontSize: 11, marginTop: 1, lineHeight: 1.45, opacity: 0.85 }) }, s.tip)
              : null,
          )
        }
        const save = (body) => {
          setBusy(true)
          setNotes(null)
          post('/policy', body)
            .then((r) => {
              if (r && r.policy) setParams(Object.assign({}, r.policy))
              setNotes((r && r.notes) || [])
              setBusy(false)
              load()
            })
            .catch((e) => {
              setBusy(false)
              setNotes(['保存失败：' + ((e && e.message) || e)])
            })
        }
        const blocks = []
        for (const [gid, gname, gtip] of GROUPS) {
          const rows = spec.filter((s) => s.group === gid)
          if (!rows.length) continue
          blocks.push(el('div', { key: gid, style: Object.assign({}, S.h, { fontSize: 12, marginTop: 10, marginBottom: 2 }) }, gname))
          blocks.push(el('div', { key: gid + '-tip', style: Object.assign({}, S.dim, { fontSize: 11, opacity: 0.85 }) }, gtip))
          if (gid === 'weight') {
            blocks.push(
              el(
                'div',
                { key: 'wsum', style: { margin: '6px 0 2px', fontSize: 12 } },
                el('span', { style: { display: 'inline-block', width: 96 } }, '合计'),
                el('span', { style: wSum === 100 ? S.ok : S.warn, fontWeight: 600, fontSize: 12 }, wSum + '%'),
                wSum === 100
                  ? el('span', { style: Object.assign({}, S.dim, { marginLeft: 8, fontSize: 11 }) }, '正好 ✓')
                  : el('span', { style: Object.assign({}, S.dim, { marginLeft: 8, fontSize: 11 }) }, '不是 100% —— 保存时会自动调平'),
              ),
            )
          }
          for (const s of rows) blocks.push(oneRow(s))
        }
        return el(
          'div',
          { style: S.sec },
          头,
          el('div', { style: Object.assign({}, S.dim, { fontSize: 11, marginBottom: 2 }) }, '这些是所有会话共用的。每项都有范围，超出会被收到范围内。'),
          blocks,
          el(
            'div',
            { style: { marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' } },
            el('button', { style: Object.assign({}, S.btn, { fontSize: 12, padding: '4px 10px' }), disabled: busy, onClick: () => save(Object.assign({}, params, { pin })) }, busy ? '保存中…' : '保存参数'),
            el('button', { style: Object.assign({}, S.btn, { fontSize: 12, padding: '4px 10px' }), disabled: busy, onClick: () => save({ reset: true }) }, '恢复默认'),
            el('button', { style: Object.assign({}, S.btn, { fontSize: 12, padding: '4px 10px' }), disabled: busy, onClick: () => load() }, '刷新'),
          ),
          notes && notes.length
            ? el('div', { style: Object.assign({}, S.warn, { marginTop: 8, fontSize: 11, whiteSpace: 'pre-line' }) }, '　· ' + notes.join('\n　· '))
            : null,
        )
      }
      function 折叠区(props) {
        const 开 = !!props.开
        const 切 = () => props.on切(!开)
        return el(
          'div',
          { style: Object.assign({}, S.sec, { marginBottom: 10 }) },
          el(
            'div',
            {
              style: Object.assign({}, S.secH, { marginBottom: 开 ? 10 : 0, cursor: 'pointer' }),
              onClick: 切,
              // 键盘也能开合（Tab 到这一行，回车 / 空格）
              role: 'button',
              tabIndex: 0,
              'aria-expanded': 开,
              onKeyDown: (e) => {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                  e.preventDefault()
                  切()
                }
              },
            },
            el('span', { style: S.secTitle }, (开 ? '▾ ' : '▸ ') + props.标题),
            props.注 ? el('span', { style: S.secTag }, props.注) : null,
          ),
          开 ? props.children : null,
        )
      }
      function 导入迁移区(props) {
        return el(
          'div',
          null,
          el(
            'div',
            { style: G.note },
            '顺序别反：① 先从一个会话里把旧档案导入 → ② 导完再点「提炼 / 扩词」。',
            el('br'),
            '先导进去再整理，整理过的才不会被下一批又盖回原样。',
          ),
          el(
            'div',
            { style: G.tools },
            el('button', { style: G.btn, onClick: props.on去会话 }, '去「会话」里导入'),
          ),
          el(
            'div',
            { style: Object.assign({}, G.note, { marginBottom: 0 }) },
            '这一版先给入口：真正的扫描 / 勾选 / 整批撤销还在「会话 → 点一个会话 → 导入」里，下一轮整块搬上来。',
          ),
        )
      }
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
      function 高级区(props) {
        const [会话们, set会话们] = React.useState([])
        const [维护在, set维护在] = React.useState('') // 运维作用在哪个会话
        const [维护提示, set维护提示] = React.useState(null)
        const [维护跑, set维护跑] = React.useState(false)
        // ⭐ 2026-10-31 用户要求：补类型允许自己选模型（null = 跟随默认降级链）
        const [维护模型, set维护模型] = React.useState(null)
        const [维护模型们, set维护模型们] = React.useState(null) // /models 的结果（未读 = null）
        // ⭐ 2026-10-31 用户要求：补类型支持整个工作区批量跑
        const [维护范围, set维护范围] = React.useState('会话') // 会话 = 只跑选中的；工作区 = 全区逐会话跑
        // ⭐ 1.8.0：会话选择改「工作区 + 搜索」，跟「从档案导入会话」同一套
        const [维护区, set维护区] = React.useState('')
        const [维护搜, set维护搜] = React.useState('')
        const [维护表, set维护表] = React.useState([])
        const [重复组, set重复组] = React.useState([]) // 查重结果（就地合并用）
        const [要合并, set要合并] = React.useState(false) // 行内二次确认（confirm 在 webview 里不弹）
        const [区表, set区表] = React.useState([])
        // ⭐ 1.10.2（F19）：一键清空 —— 范围 / 二次确认 / 手动打「清空」三个字
        const [清空范围, set清空范围] = React.useState('session')
        const [清空问, set清空问] = React.useState(false)
        const [清空字, set清空字] = React.useState('')
        const [清空跑, set清空跑] = React.useState(false)
        // ⭐ 1.12.0 一期决策四：骨架预览 —— _core.json 降成主库投影，只做「预览 + 手动写回」
        const [骨架预, set骨架预] = React.useState(null)
        const [骨架开, set骨架开] = React.useState(false)
        const [骨架跑, set骨架跑] = React.useState(false)
        // ⭐ 1.12.22：骨架可手改 —— null = 不在编辑；数组 = 正在编（保存时整份覆盖）
        const [骨架草, set骨架草] = React.useState(null)
        const [骨架存跑, set骨架存跑] = React.useState(false)
        // ⭐ F10 阶段 0（1.12.26）：骨架空但主库有够格条目 → 顶上挂一条提醒
        const [骨提示, set骨提示] = React.useState(null)
        React.useEffect(() => {
          get('/list')
            .then((l) => {
              const ss = ((l && l.sessions) || []).map((s) => ({ id: s.id, title: s.title || s.id }))
              set会话们(ss)
              if (ss[0]) set维护在(ss[0].id)
            })
            .catch(() => {})
          // ⭐ 2026-10-31：模型下拉自动拉一次列表（不用先点「读模型」，点了也还是能看到）
          post('/models', { session: '' })
            .then((r) => {
              if (r && r.ok) set维护模型们(r)
            })
            .catch(() => {})
        }, [])
        // 工作区列表（会话选择用）
        React.useEffect(() => {
          get('/workspaces')
            .then((r) => {
              const 表 = Array.isArray(r) ? r : (r && r.workspaces) || []
              set区表(表)
              if (表.length) set维护区((v) => v || 表[0].id)
            })
            .catch(() => set区表([]))
        }, [])
        // 骨架预览：跟主库比一比，主库里有没有该进骨架的、骨架里有没有主库已经不认的
        const 拉骨架预 = () => {
          get('/core-preview')
            .then((r) => {
              if (r && r.ok !== false) {
                set骨架预(r)
                set骨提示((r && r.提示) || null)
              }
            })
            .catch(() => {})
        }
        React.useEffect(() => {
          拉骨架预()
        }, [])
        // 当前工作区的会话（按名搜）
        React.useEffect(() => {
          if (!维护区) return
          get('/sessions-by-workspace?workspace=' + encodeURIComponent(维护区) + '&q=' + encodeURIComponent(维护搜 || ''))
            .then((r) => set维护表((r && r.sessions) || []))
            .catch(() => set维护表([]))
        }, [维护区, 维护搜])
        // ⭐ 1.5.0：导出全部 —— 纯前端打包成 JSON 下载，不用后端配合
        const 导出全部 = () => {
          set维护跑(true)
          set维护提示('打包中…')
          post('/all', {})
            .then((r) => {
              if (!r || r.ok === false || !Array.isArray(r.memories)) throw new Error('读不出来')
              const 包 = {
                导出于: new Date().toISOString(),
                统计: r.stats,
                记忆: r.memories,
                已删: r.deleted || [],
              }
              const blob = new Blob([JSON.stringify(包, null, 2)], { type: 'application/json' })
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = '黏土记忆-' + new Date().toISOString().slice(0, 10) + '.json'
              document.body.appendChild(a)
              a.click()
              a.remove()
              setTimeout(() => URL.revokeObjectURL(a.href), 2000)
              set维护提示('✓ 导出了 ' + r.memories.length + ' 条（浏览器下载里找）')
            })
            .catch((e) => set维护提示('导出失败：' + String((e && e.message) || e)))
            .then(() => set维护跑(false))
        }
        // ⭐ 1.10.2（F19）：一键清空（全部 / 仅本会话）
        //   ⚠ 语义 = 收进回收站，不是真销毁：清完还能去「回收站」页找回；
        //     要彻底销毁再去那儿点「把已删掉的清空」。
        const 做清空 = () => {
          const 范围 = 清空范围
          const sid = 维护在
          if (范围 === 'session' && !sid) {
            set维护提示('先在上面选一个会话')
            return
          }
          set清空跑(true)
          set维护提示('清空中…')
          post('/clear', { scope: 范围, session: sid, confirm: 清空字 })
            .then((r) => {
              set维护提示(r && r.ok ? '✓ ' + (r.message || '清好了') : '✗ ' + ((r && r.message) || '没成'))
              if (r && r.ok) {
                set清空问(false)
                set清空字('')
              }
            })
            .catch((e) => set维护提示('✗ ' + String((e && e.message) || e)))
            .then(() => set清空跑(false))
        }
  
        // ⭐ 1.6.16：撤销最近一次批量操作（只认 30 分钟内的补日期 / 补类型 / 补标）
        //   以前改错了只能去目录里翻 .bak 手工拼回来（2026-10-29 凌晨就干过一次）
        const 撤销上一批 = () => {
          const sid = 维护在
          if (!sid) {
            set维护提示('先在右边选一个会话')
            return
          }
          const 名 = (会话们.find((x) => x.id === sid) || {}).title || String(sid).replace(/^session-/, '').slice(0, 8)
          const 问 = window.confirm(
            '把「' + 名 + '」恢复到最近一次批量操作之前？' + '\n' +
              '只认 30 分钟内的「补日期 / 补类型 / 补标长期设定」；\n' +
              '撤完现在这份会存成 .before-undo，万一撤错还能拿回来。',
          )
          if (!问) return
          set维护跑(true)
          set维护提示('正在回滚…')
          post('/undo-last', { session: sid })
            .then((r) => {
              if (!r || !r.ok) {
                set维护提示('撤不了：' + ((r && r.message) || '？'))
                return
              }
              set维护提示(
                '✓ 已撤销「' + (r.撤掉 || '那次批量') + '」\n' +
                  '恢复：' + ((r.恢复 || []).join('、') || '（没有文件被换）'),
              )
            })
            .catch((e) => set维护提示('撤销失败：' + String((e && e.message) || e)))
            .then(() => set维护跑(false))
        }
  
        // ⭐ 1.5.0（F20）：常用运维不用再跳进某个会话的详情页
        //   补标 / 重判要分批跑，这里串成一条链跑到底（她能看见「判了 N 条」在涨）
        const 做 = async (种) => {
          const sid = 维护在
          if (!sid) {
            set维护提示('先在右边选一个会话')
            return
          }
          set维护跑(true)
          set维护提示(种 + '…')
          try {
            if (种 === '补日期') {
              const r = await post('/backfill-dates', { session: sid })
              set维护提示(
                r && r.ok
                  ? '✓ 补了 ' + r.补了 + ' 条（其中年份是猜的 ' + r.猜的 + '），还有 ' + r.还是没 + ' 条真没日期'
                  : '没成：' + ((r && (r.message || r.error)) || '？'),
              )
            } else if (种 === '查重') {
              const r = await post('/duplicates', { session: sid })
              const 组们 = r && Array.isArray(r.组) ? r.组 : []
              set重复组(组们)
              set维护提示(
                r && r.ok
                  ? 组们.length
                    ? '找到 ' + 组们.length + ' 组「像同一件事的」—— 底下可以就地合并，也可以先逐组看过再合'
                    : '✓ 没找到重复'
                  : '没成：' + ((r && (r.message || r.error)) || '？'),
              )
            } else if (种 === '补类型') {
              // 旧条目没有类型（1.5.0 之前导入的）—— 一批 20 条问模型，串着跑到 done
              // ⭐ 2026-10-31 用户要求：范围选「整个工作区」时逐会话跑，每个跑到 done 再下一个
              let 目标sids = [sid]
              if (维护范围 === '工作区') {
                const 区r = await get('/sessions-by-workspace?workspace=' + encodeURIComponent(维护区))
                const 区sids = ((区r && 区r.sessions) || []).map((x) => x.id)
                if (!区sids.length) {
                  set维护提示('这个工作区里没有会话')
                  set维护跑(false)
                  return
                }
                目标sids = 区sids
              }
              let 判 = 0
              let 用 = ''
              let 跑过会话 = 0
              for (const s0 of 目标sids) {
                let 连着空 = 0
                for (let i = 0; i < 400; i++) {
                  const 体 = { session: s0, 每批: 20 }
                  if (维护模型) {
                    体.provider = 维护模型.provider
                    体.model = 维护模型.model
                  }
                  const r = await post('/classify-types', 体)
                  if (!r || !r.ok) {
                    set维护提示('补类型失败：' + ((r && r.message) || '？') + '（判好的已经存下，再点一次接着跑）')
                    set维护跑(false)
                    return
                  }
                  判 += r.判了 || 0
                  用 = r.用 || 用
                  set维护提示('已跑 ' + 跑过会话 + '/' + 目标sids.length + ' 个会话，判了 ' + 判 + ' 条…' + (用 ? '（' + 用 + '）' : ''))
                  if (r.done) break
                  if (!(r.判了 || 0)) {
                    连着空++
                    if (连着空 > 2) break
                  } else 连着空 = 0
                }
                跑过会话++
              }
              set维护提示('✓ 补类型完成：' + 跑过会话 + ' 个会话、共 ' + 判 + ' 条' + (用 ? '（用的 ' + 用 + '）' : ''))
            } else {
              // 「补标长期设定」/「重判」：一批 20 条，串着跑到 done
              let 判 = 0
              let 升 = 0
              let 降 = 0
              let 连着空 = 0
              let 头 = true
              for (let i = 0; i < 400; i++) {
                const 体 = { session: sid, 每批: 20 }
                if (种 === '重判' && 头) 体.重判 = true
                头 = false
                const r = await post('/backfill-stable', 体)
                if (!r || !r.ok) {
                  set维护提示('补标失败：' + ((r && r.message) || '？') + '（判好的已经存下，再点一次会接着跑）')
                  set维护跑(false)
                  return
                }
                判 += r.判了 || 0
                升 += r.改成不淡 || 0
                降 += r.降成会淡 || 0
                set维护提示('判了 ' + 判 + ' 条…（升 ' + 升 + ' / 降 ' + 降 + '）')
                if (r.done) break
                if (!(r.判了 || 0)) {
                  连着空++
                  if (连着空 > 2) break
                } else 连着空 = 0
              }
              set维护提示('✓ 判了 ' + 判 + ' 条：升成「长期设定」' + 升 + ' 条，降回会淡 ' + 降 + ' 条')
            }
          } catch (e) {
            set维护提示(String((e && e.message) || e))
          }
          set维护跑(false)
        }
        // 就地合并（查重结果就在这页）
        const 合并组 = async () => {
          const sid = 维护在
          if (!sid || !重复组.length) return
          // 后端要的是 {留, 删}：每组留第一条，其余收起来
          const 组们 = []
          for (const g of 重复组) {
            const 条们 = g.条们 || []
            if (条们.length < 2) continue
            const 留 = 条们[0].id
            const 删 = 条们.filter((t) => t.id !== 留).map((t) => t.id)
            if (删.length) 组们.push({ 留: 留, 删: 删 })
          }
          if (!组们.length) {
            set维护提示('这几组里没有能自动合的（每组不到 2 条）')
            return
          }
          set维护跑(true)
          set维护提示('合并中…')
          try {
            const r = await post('/duplicates/merge', { session: sid, 组: 组们 })
            set维护提示(r && r.ok ? '✓ ' + (r.message || '合并好了') : '没成：' + ((r && (r.message || r.error)) || '？'))
            if (r && r.ok) {
              set重复组([])
              set要合并(false)
            }
          } catch (e) {
            set维护提示(String((e && e.message) || e))
          }
          set维护跑(false)
        }
        // ⭐ 1.6.18（用户：「运维样式不够好看，要有条理、边界清晰」）
        //   原来是一整行 flex 平铺：标签 + 下拉 + 七个按钮 + 一段提示，全挤在一条线上，看不出哪些是一类。
        //   现在「记忆习惯」「运维」各一张卡；运维卡里按**动作性质**分三组：整理 / 检查与导出 / 回退。
        const 组标题 = {
          fontSize: 12.5,
          fontWeight: 600,
          color: 'var(--dsw-alias-label-secondary, #666)',
          margin: '14px 0 7px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }
        const 按钮行 = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }
        // ⭐ 1.8.0：运维卡里「只对这个会话」和「整库」要分开，否则第一行那个「作用在」会让人以为
        //   下面每个按钮都只作用于那个会话 ✗
        const 分割线 = { margin: '14px 0', borderTop: '2px solid var(--dsw-alias-border-l1, rgba(128,128,128,.45))' }
        const 卡说明 = { fontSize: 11.5, marginTop: 6, color: 'var(--dsw-alias-label-tertiary, #8a8a8a)', lineHeight: 1.6 }
        return el(
          'div',
          null,
          // ── 参数（2026-11-01 用户要求：从「会话 → 参数」整块搬来，替代原来的「记忆习惯」三档；
          //   样式沿用原来的折叠卡——默认收起，点标题才展开）
          el(参数区, null),
          // ⭐ F10 阶段 0（1.12.26）：骨架还空着，但主库已经攒够格的了 —— 顶上挂一条，别让人自己去猜
          骨提示
            ? el(
                'div',
                {
                  style: {
                    margin: '0 0 10px',
                    padding: '8px 10px',
                    border: '1px solid rgba(194,65,12,.35)',
                    background: 'rgba(249,115,22,.07)',
                    borderRadius: 8,
                    fontSize: 12.5,
                    lineHeight: 1.6,
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 8,
                    flexWrap: 'wrap',
                  },
                },
                el(
                  'span',
                  { style: { flex: '1 1 320px' } },
                  '有 ' +
                    骨提示.够格 +
                    ' 条记忆够格进骨架（重要度 ≥0.8），但骨架现在是空的。骨架每轮都在场上，适合放「她是谁 / 怎么称呼 / 别做什么」这种长期不变的东西 —— 下面「骨架预览」里能挑几条进去。',
                ),
              )
            : null,
          // ── 骨架预览（1.12.0）
          //   骨架 _core.json 每轮都在场上，但它一直是手写的、跟主库脱节。
          //   这里把它当「主库的投影」：只算差在哪（该加的 / 主库已经不认的），
          //   写不写由人点 —— 自动覆盖会把手写的风格、边界冲掉，冲掉没后悔药。
          el(
            'div',
            { style: S.sec },
            el(
              'div',
              { style: S.secH },
              el('span', { style: S.secTitle }, '骨架预览'),
              el('span', { style: S.secTag }, '主库 → _core.json'),
            ),
            el('div', { style: 分割线 }),
            (() => {
              if (!骨架预) return el('div', { style: 卡说明 }, '读不到骨架（文件不存在也算正常）')
              const 加 = (骨架预.新增 || []).length
              const 下 = (骨架预.可下线 || []).length
              const 已 = (骨架预.已有 || []).length
              const 做写回 = () => {
                set骨架跑(true)
                post('/core-preview', { action: 'apply' })
                  .then((r) => {
                    if (r && r.ok === false) throw new Error(r.message || '写回失败')
                    set维护提示((r && r.message) || '骨架已更新')
                    set骨架开(false)
                    拉骨架预()
                  })
                  .catch((e) => set维护提示(String((e && e.message) || e)))
                  .then(() => set骨架跑(false))
              }
              // ⭐ 1.12.22：手改后整份覆盖。空条目不提交（后端也会再过滤一遍）。
              const 存骨架 = () => {
                set骨架存跑(true)
                post('/core-preview', { action: 'save', items: 骨架草 || [] })
                  .then((r) => {
                    if (r && r.ok === false) throw new Error(r.message || '保存失败')
                    set维护提示((r && r.message) || '骨架已保存')
                    set骨架草(null)
                    拉骨架预()
                  })
                  .catch((e) => set维护提示(String((e && e.message) || e)))
                  .then(() => set骨架存跑(false))
              }
              return el(
                'div',
                null,
                el(
                  'div',
                  { style: 卡说明 },
                  '骨架 ' + 骨架预.骨架条数 + ' 条 · 主库里够格的 ' + 骨架预.候选条数 + ' 条 · ' +
                    '可加 ' + 加 + ' · 可下线 ' + 下 + ' · 已经对上 ' + 已,
                ),
                el(
                  'div',
                  { style: Object.assign({}, 卡说明, { marginTop: 2 }) },
                  '主库挑得出的只有「事实层 + 重要度 ≥ 0.8」；风格、边界、关系那种手写的，它挑不出来，也不会替你删。',
                ),
                骨架草
                  ? el(
                      'div',
                      null,
                      el(
                        'div',
                        { style: Object.assign({}, 卡说明, { marginTop: 6 }) },
                        '改、删、加都行；留空的条目保存时会被丢掉。跟 AGENTS.md 或跟别条重不重复，你自己判断 —— 这里不给建议。',
                      ),
                      骨架草.map((it, i) =>
                        el(
                          'div',
                          { key: 'ce' + i, style: { marginTop: 8 } },
                          el(
                            'div',
                            { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3, flexWrap: 'wrap' } },
                            el(
                              'span',
                              { style: Object.assign({}, 卡说明, { marginTop: 0 }) },
                              (it.core ? '◆ 核心' : '·') + ' #' + (i + 1) + ' · ' + String(it.content || '').length + ' 字',
                            ),
                            el(
                              'label',
                              { style: { fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' } },
                              el('input', {
                                type: 'checkbox',
                                checked: it.core === true,
                                onChange: (e) => {
                                  const 下份 = 骨架草.slice()
                                  下份[i] = Object.assign({}, 下份[i], { core: e.target.checked })
                                  set骨架草(下份)
                                },
                              }),
                              '核心画像（永不下线）',
                            ),
                            el(
                              'button',
                              {
                                style: { marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#c44', fontSize: 15, lineHeight: 1 },
                                title: '删这条',
                                onClick: () => set骨架草(骨架草.filter((_, j) => j !== i)),
                              },
                              '×',
                            ),
                          ),
                          el('textarea', {
                            style: G.area,
                            value: it.content || '',
                            onChange: (e) => {
                              const 下份 = 骨架草.slice()
                              下份[i] = Object.assign({}, 下份[i], { content: e.target.value })
                              set骨架草(下份)
                            },
                          }),
                        ),
                      ),
                      el(
                        'div',
                        { style: 按钮行 },
                        el(
                          'button',
                          {
                            style: S.btn,
                            onClick: () => set骨架草(骨架草.concat([{ id: '', content: '', core: false, importance: 0 }])),
                          },
                          '＋ 加一条',
                        ),
                        el(
                          'button',
                          { style: Object.assign({}, S.btn, { opacity: 骨架存跑 ? 0.5 : 1 }), disabled: 骨架存跑, onClick: 存骨架 },
                          骨架存跑 ? '保存中…' : '保存骨架',
                        ),
                        el('button', { style: S.btn, onClick: () => set骨架草(null) }, '取消'),
                      ),
                    )
                  : el(
                      'div',
                      null,
                      el(
                        'div',
                        { style: 按钮行 },
                        el(
                          'button',
                          { style: S.btn, onClick: () => set骨架草((骨架预.items || []).map((x) => Object.assign({}, x))) },
                          '编辑骨架（' + 骨架预.骨架条数 + ' 条）',
                        ),
                        加 || 下
                          ? el(
                              'button',
                              { style: S.btn, onClick: () => set骨架开(!骨架开) },
                              (骨架开 ? '收起' : '看差在哪') + '（+' + 加 + ' / −' + 下 + '）',
                            )
                          : null,
                        加 || 下
                          ? el(
                              'button',
                              {
                                style: Object.assign({}, S.btn, { opacity: 骨架跑 ? 0.5 : 1 }),
                                onClick: 做写回,
                                disabled: 骨架跑,
                              },
                              骨架跑 ? '写着…' : '写回骨架',
                            )
                          : null,
                      ),
                      加 || 下
                        ? null
                        : el('div', { style: Object.assign({}, 卡说明, { marginTop: 4 }) }, '✓ 主库里没有要改的'),
                      骨架开
                        ? el(
                            'div',
                            { style: Object.assign({}, 卡说明, { marginTop: 6 }) },
                            el('div', null, '▸ 会加进去：'),
                            (骨架预.新增 || []).map((x, i) =>
                              el('div', { key: 'a' + i, style: { paddingLeft: 10 } }, '· ' + x.content),
                            ),
                            el('div', { style: { marginTop: 4 } }, '▸ 会下线（主库已经不认了）：'),
                            (骨架预.可下线 || []).map((x, i) =>
                              el('div', { key: 'd' + i, style: { paddingLeft: 10 } }, '· ' + x),
                            ),
                          )
                        : null,
                    ),
              )
            })(),
          ),
          // ── 整理会话
          el(
            'div',
            { style: S.sec },
            el(
              'div',
              { style: S.secH },
              el('span', { style: S.secTitle }, '整理会话'),
              el('span', { style: S.secTag }, '整理 · 检查 · 回退'),
            ),
            el('div', { style: 分割线 }),
            el(
              'div',
              { style: Object.assign({}, 按钮行, { marginTop: 6 }) },
              el(选择器, {
                style: Object.assign({}, G.sel, { maxWidth: 210 }),
                值: 维护区,
                选项: (区表.length ? 区表 : [{ id: '', name: '（没有工作区）', 会话数: 0 }]).map((w) => ({
                  v: w.id,
                  t: (w.name || '工作区') + '（' + (w.会话数 || 0) + ' 个会话）',
                })),
                onChange: (v) => {
                  set维护区(v)
                  set维护搜('')
                  set维护在('')
                },
              }),
              el('input', {
                style: Object.assign({}, G.sel, { width: 150 }),
                placeholder: '按会话名搜索…',
                value: 维护搜,
                onChange: (e) => set维护搜(e.target.value),
              }),
            ),
            el(
              'div',
              {
                style: {
                  maxHeight: 150,
                  overflow: 'auto',
                  border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))',
                  borderRadius: 8,
                  padding: 4,
                  marginTop: 8,
                },
              },
              维护表.length
                ? 维护表.map((x) =>
                    el(
                      'div',
                      {
                        key: x.id,
                        role: 'button',
                        tabIndex: 0,
                        style: {
                          display: 'flex',
                          gap: 8,
                          alignItems: 'center',
                          padding: '6px 8px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          fontSize: 12.5,
                          background:
                            维护在 === x.id ? 'var(--dsw-alias-state-business-primary, #5b8fd6)' : 'transparent',
                          color: 维护在 === x.id ? '#fff' : 'inherit',
                        },
                        onClick: () => set维护在(x.id),
                        onKeyDown: (e) => {
                          if (e.key === 'Enter' || e.key === ' ') set维护在(x.id)
                        },
                      },
                      el('span', null, 维护在 === x.id ? '●' : '○'),
                      el(
                        'span',
                        { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                        x.title || String(x.id || '').replace(/^session-/, '').slice(0, 12),
                      ),
                      el('span', { style: { flex: 'none', fontSize: 11, opacity: 0.75 } }, (x.事件数 || 0) + ' 条事件'),
                    ),
                  )
                : el(
                    'div',
                    { style: Object.assign({}, 卡说明, { padding: '8px 6px', margin: 0 }) },
                    维护区 ? '这个工作区里没有匹配的会话' : '先选工作区',
                  ),
            ),
            el(
              'div',
              { style: Object.assign({}, 按钮行, { marginTop: 8 }) },
              // ⭐ 2026-10-31 用户要求：范围 —— 只跑选中的会话 / 整个工作区逐会话跑
              el(
                'select',
                {
                  key: '范围',
                  style: Object.assign({}, G.btn, { maxWidth: 170 }),
                  disabled: 维护跑,
                  value: 维护范围,
                  onChange: (e) => set维护范围(String((e && e.target && e.target.value) || '会话')),
                },
                el('option', { value: '会话' }, '范围：这个会话'),
                el('option', { value: '工作区' }, '范围：整个工作区'),
              ),
              // ⭐ 2026-10-31 用户要求：补类型前可以先选模型（默认跟随 DSH 默认模型）
              el(
                'select',
                {
                  key: '模型',
                  style: Object.assign({}, G.btn, { maxWidth: 280 }),
                  disabled: 维护跑,
                  value: 维护模型 ? 维护模型.provider + '/' + 维护模型.model : '',
                  onChange: (e) => {
                    const v = String((e && e.target && e.target.value) || '')
                    if (!v) {
                      set维护模型(null)
                      return
                    }
                    const i = v.indexOf('/')
                    set维护模型(i > 0 ? { provider: v.slice(0, i), model: v.slice(i + 1) } : null)
                  },
                },
                el(
                  'option',
                  { value: '' },
                  '模型：跟随默认' +
                    (维护模型们 && 维护模型们.默认 && 维护模型们.默认.model ? '（' + 维护模型们.默认.model + '）' : ''),
                ),
                ...(维护模型们 && 维护模型们.ok
                  ? (维护模型们.providers || []).flatMap((p) =>
                      (p.models || []).map((m) =>
                        el('option', { key: p.id + '/' + m.id, value: p.id + '/' + m.id }, p.name + ' / ' + (m.name || m.id)),
                      ),
                    )
                  : []),
              ),
              el(
                'button',
                {
                  key: '读模型',
                  style: G.btn,
                  disabled: 维护跑,
                  onClick: () => {
                    set维护提示('读着呢…')
                    post('/models', { session: 维护在 })
                      .then((r) => {
                        set维护模型们(r)
                        if (r && r.ok) set维护提示('模型读好了，下拉里选一个再点补类型')
                        else set维护提示('✗ ' + ((r && r.message) || '读模型失败'))
                      })
                      .catch((e) => set维护提示('✗ ' + String((e && e.message) || e)))
                  },
                },
                '读模型',
              ),
              ['补日期', '补类型', '补标长期设定', '重判'].map((种) =>
                el('button', { key: 种, style: G.btn, disabled: 维护跑, onClick: () => 做(种) }, 种),
              ),
              el(
                'button',
                {
                  key: '撤销上一批',
                  style: Object.assign({}, G.btn, {
                    borderColor: 'var(--dsw-alias-state-warn-primary, #c9963f)',
                    color: 'var(--dsw-alias-state-warn-primary, #c9963f)',
                  }),
                  disabled: 维护跑,
                  onClick: 撤销上一批,
                },
                '撤销上一批',
              ),
            ),
            el('div', { style: 卡说明 }, '前四个会调模型、改分类，别连点。「撤销上一批」撤掉的是这个会话最近一次补日期 / 补类型 / 补标（30 分钟内有效）。'),
            el('div', { style: 组标题 }, '查重'),
            el(
              'div',
              { style: 按钮行 },
              el('button', { key: '查重', style: G.btn, disabled: 维护跑, onClick: () => 做('查重') }, '查重'),
              重复组.length
                ? 要合并
                  ? el(
                      'span',
                      { key: '确认条', style: Object.assign({}, 按钮行, { margin: 0 }) },
                      el('span', { style: Object.assign({}, 卡说明, { margin: 0 }) }, '合并掉这 ' + 重复组.length + ' 组？每组只留最像的一条，其余进「已删」（可找回）'),
                      el('button', { key: '确定', style: G.btn, disabled: 维护跑, onClick: 合并组 }, '确定合并'),
                      el('button', { key: '取消', style: G.btn, onClick: () => set要合并(false) }, '算了'),
                    )
                  : el(
                      'button',
                      {
                        key: '合并',
                        style: Object.assign({}, G.btn, {
                          borderColor: 'var(--dsw-alias-state-warn-primary, #c9963f)',
                          color: 'var(--dsw-alias-state-warn-primary, #c9963f)',
                        }),
                        disabled: 维护跑,
                        onClick: () => set要合并(true),
                      },
                      '合并这 ' + 重复组.length + ' 组',
                    )
                : null,
            ),
            重复组.length
              ? el(
                  'div',
                  { style: { marginTop: 8, maxHeight: 220, overflow: 'auto', border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))', borderRadius: 8, padding: 6 } },
                  重复组.map((g, i) =>
                    el(
                      'div',
                      { key: i, style: { padding: '6px 8px', borderBottom: i < 重复组.length - 1 ? '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.16))' : 'none' } },
                      el('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 2 } }, (g.类型 || '像同一件事') + ' · ' + (g.条们 ? g.条们.length : 0) + ' 条'),
                      (g.条们 || []).slice(0, 3).map((m, j) =>
                        el('div', { key: j, style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary, #777)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '· ' + String(m.text || '').slice(0, 60)),
                      ),
                    ),
                  ),
                )
              : null,
            el('div', { style: 卡说明 }, '只找出来、不自动合并。'),
            el('div', { style: 分割线 }),
            el(
              'div',
              { style: 按钮行 },
              el('button', { key: '导出全部', style: G.btn, disabled: 维护跑, onClick: 导出全部 }, '导出全部记忆（JSON）'),
              el('span', { style: Object.assign({}, 卡说明, { margin: 0 }) }, '整库、不分会话；含已删条目，不调模型、不花钱。留底 / 换电脑用这个。'),
            ),
  
            维护提示
              ? el(
                  'div',
                  {
                    style: {
                      marginTop: 10,
                      padding: '8px 10px',
                      borderRadius: 8,
                      fontSize: 12,
                      whiteSpace: 'pre-line',
                      background: 'var(--dsw-alias-bg-l1, rgba(127,127,127,.08))',
                      border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))',
                    },
                  },
                  维护提示,
                )
              : null,
          ),
          // ⭐ 1.10.2（F19）一键清空：独立一张卡，跟「整理会话」分开 ——
          //   一个是在旧记忆上做加工，一个是把记忆全收走，不该摆在一起。
          el(
            'div',
            { style: S.sec },
            el('div', { style: S.secH }, el('span', { style: S.secTitle }, '清空'), el('span', { style: S.secTag }, '收进回收站 · 能找回')),
            el(
              'div',
              { style: 卡说明 },
              '「清空」不销毁任何东西：全进回收站，随时能找回。真要彻底销毁，去「回收站」页点「把已删掉的清空」。',
            ),
            el(
              'div',
              { style: Object.assign({}, 按钮行, { marginTop: 8 }) },
              el(
                'select',
                {
                  key: '清空范围',
                  style: Object.assign({}, G.btn, { maxWidth: 260 }),
                  disabled: 清空跑,
                  value: 清空范围,
                  onChange: (e) => {
                    set清空范围(String((e && e.target && e.target.value) || 'session'))
                    set清空问(false)
                    set清空字('')
                  },
                },
                el('option', { value: 'session' }, '只清这个会话（事实 / 工作区不动）'),
                el('option', { value: 'all' }, '全清：事实 + 所有会话 + 工作区'),
              ),
              el(
                'button',
                {
                  key: '清空',
                  style: Object.assign({}, G.btn, {
                    borderColor: 'var(--dsw-alias-state-error-primary, rgba(208,90,90,.7))',
                    color: 'var(--dsw-alias-state-error-primary, rgba(208,90,90,.95))',
                  }),
                  disabled: 清空跑,
                  onClick: () => {
                    set清空问(!清空问)
                    set清空字('')
                  },
                },
                清空问 ? '算了' : '清空…',
              ),
            ),
            清空问
              ? el(
                  'div',
                  { style: Object.assign({}, 按钮行, { marginTop: 8 }) },
                  el(
                    'span',
                    { style: Object.assign({}, 卡说明, { margin: 0 }) },
                    清空范围 === 'all'
                      ? '这会清掉**全部**（事实对所有工作区都不可见），清完在回收站能找回。'
                      : '这会清掉「' + ((会话们.find((x) => x.id === 维护在) || {}).title || '当前会话') + '」的事件，事实和工作区不动。',
                  ),
                  el('input', {
                    style: Object.assign({}, G.sel, { width: 110 }),
                    placeholder: '打「清空」',
                    value: 清空字,
                    onChange: (e) => set清空字(e.target.value),
                  }),
                  el(
                    'button',
                    {
                      key: '确定清空',
                      style: Object.assign({}, G.btn, {
                        borderColor: 'var(--dsw-alias-state-error-primary, rgba(208,90,90,.7))',
                        color: 'var(--dsw-alias-state-error-primary, rgba(208,90,90,.95))',
                      }),
                      disabled: 清空跑 || 清空字.trim() !== '清空',
                      onClick: 做清空,
                    },
                    '确定清空',
                  ),
                )
              : null,
          ),
          el(生成档案区, { 会话号: (会话们[0] && 会话们[0].id) || '' }),
          // ⭐ 1.8.0：导出档案正下方 —— 从档案导入会话
          el(从档案导入会话区, { 会话们 }),
          el('div', { style: { marginTop: 14 } }, el(更新条)),
        )
      }
  return { 高级区 }
}
