// ============================================================================
// 新会话「继承语感」的控件 —— 1.12.91
//
//   挂在 conversation.hero.options（新会话空白页那行右侧的空位）。
//   作用：这个新会话要不要接上一段对话的尾巴，接哪一段。
//
//   后端（lib/routes-handoff.mjs）：
//     GET  /dsh-clay-memory/handoff?sid=       → { ok, 模式, 最近:{sid,轮数,标题}, 选择:{load,from,轮数} }
//     GET  /dsh-clay-memory/handoff/candidates → { ok, 模式, 最近, 候选:[{sid,标题,时间,是热尾}] }
//     POST /dsh-clay-memory/handoff/choose     → { ok, load, from, 轮数 }
//
//   ⚠ 注册回调一定要写成 `(props) => ...`，裸用 props 是 ReferenceError
//     （被 DSH 兜底接住，构建和单测都不报 —— 2026-11 踩过）。
// ============================================================================
import { 造选择器 } from '../components/select.js'

export function 造语感控件({ React, el, get, post }) {
  const { useState, useEffect } = React
  const 选择器 = 造选择器({ React, el })

  // 值约定：'latest' = 最近那段 / 'none' = 不加载 / '<sid>' = 指定的那个会话
  function 当前值(态) {
    if (!态) return 'none'
    if (态.选择) {
      if (!态.选择.load) return 'none'
      return 态.选择.from || 'latest'
    }
    return 态.模式 === 'latest' ? 'latest' : 'none'
  }

  function 继承语感控件(props) {
    const sid = props && props.sessionId ? String(props.sessionId) : ''
    const [态, set态] = useState(null)
    const [候选, set候选] = useState([])
    const [忙, set忙] = useState(false)
    const [错, set错] = useState('')

    useEffect(() => {
      if (!sid) return
      let 活 = true
      Promise.all([get('/handoff?sid=' + encodeURIComponent(sid)), get('/handoff/candidates')])
        .then(([a, b]) => {
          if (!活) return
          if (a && a.ok) set态(a)
          if (b && b.ok) set候选(Array.isArray(b.候选) ? b.候选 : [])
        })
        .catch(() => {})
      return () => {
        活 = false
      }
    }, [sid])

    if (!sid) return null

    const 选项 = [{ v: 'latest', t: '最近那段' }, { v: 'none', t: '不加载' }]
    for (const c of 候选) {
      // 排除自己（自己还没说过话，没什么可接的）
      if (c.sid === sid) continue
      选项.push({ v: c.sid, t: (c.是热尾 ? '★ ' : '') + String(c.标题 || c.sid).slice(0, 24) })
    }

    const 改 = (v) => {
      if (!v || 忙) return
      set忙(true)
      set错('')
      const 体 = v === 'none' ? { sid, load: false, from: '' } : v === 'latest' ? { sid, load: true, from: '' } : { sid, load: true, from: v }
      post('/handoff/choose', 体)
        .then((r) => {
          if (r && r.ok) {
            set态((旧) => (旧 ? Object.assign({}, 旧, { 选择: { load: r.load, from: r.from, 轮数: r.轮数 } }) : 旧))
            if (v !== 'none' && v !== 'latest' && !r.轮数) set错('那个会话里没抽到原话')
          } else {
            set错((r && r.error) || '没存上')
          }
        })
        .catch(() => set错('没存上'))
        .finally(() => set忙(false))
    }

    const 当前 = 当前值(态)
    const 是最近 = 当前 === 'latest' && 态 && 态.最近 && 态.最近.sid && 态.最近.sid !== sid
    const 轮数 = 态 && 态.选择 && 态.选择.轮数 ? 态.选择.轮数 : 是最近 ? 态.最近.轮数 : 0

    return el(
      'div',
      { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
      el(
        'span',
        { style: { fontSize: 12, opacity: 0.72, whiteSpace: 'nowrap' }, title: '新会话要不要接上一段对话的语感' },
        '继承语感',
      ),
      选择器({
        选项,
        值: 当前,
        onChange: 改,
        minWidth: 132,
        disabled: 忙,
      }),
      轮数 ? el('span', { style: { fontSize: 11, opacity: 0.55, whiteSpace: 'nowrap' } }, 轮数 + ' 轮') : null,
      错 ? el('span', { style: { fontSize: 11, color: 'var(--dsw-alias-state-warning-primary, #b7791f)' } }, 错) : null,
    )
  }

  return 继承语感控件
}
