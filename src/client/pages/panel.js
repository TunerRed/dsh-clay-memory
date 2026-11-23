// 记忆面板 —— 2026-11-11 从 lib/client.js 拆出来（逻辑未改）
// 依赖由正文注入；模块内部自成一体。
import { 造选择器 } from '../components/select.js'

export function 造记忆面板({ React, el, get, post, S, G, B, rel, impName, toPct, fromPct, 进度, 更新条, 类型名, 类型表, 同日, 归整, 一次最多画, 重要色, 会话页, 所有记忆页, 时间线页, 回收站页, 回复体检页, 拦截页, 高级区, 页签名, 兜底}) {
      const 选择器 = 造选择器({ React, el })

      // 「新会话语感」的默认模式（1.12.91）—— 只在高级页签顶上露一行，不打扰主界面
      function 语感默认行() {
        const [模式, set模式] = React.useState(null)
        const [忙, set忙] = React.useState(false)
        React.useEffect(() => {
          let 活 = true
          get('/handoff/mode')
            .then((r) => {
              if (活 && r && r.ok) set模式(String(r.模式 || 'latest'))
            })
            .catch(() => {})
          return () => {
            活 = false
          }
        }, [])
        const 改 = (v) => {
          if (忙) return
          set忙(true)
          post('/handoff/mode', { mode: v })
            .then((r) => {
              if (r && r.ok) set模式(String(r.模式 || 'latest'))
            })
            .catch(() => {})
            .finally(() => set忙(false))
        }
        return el(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 12,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))',
              fontSize: 12,
            },
          },
          el('span', { style: { opacity: 0.75, whiteSpace: 'nowrap' } }, '新会话语感'),
          选择器({
            选项: [
              { v: 'latest', t: '默认接最近那段' },
              { v: 'ask', t: '每次新建时自己选' },
              { v: 'off', t: '不接' },
            ],
            值: 模式 || 'latest',
            onChange: 改,
            minWidth: 150,
            disabled: 忙,
          }),
          el(
            'span',
            { style: { opacity: 0.55 } },
            '建新会话时，空白页那行会出现「继承语感」，按会话单独改',
          ),
        )
      }

      function 记忆面板() {
        const [页签, set页签] = React.useState('记忆')
  
        // 换页签回到顶部（设置面板自己的滚动容器）
        React.useEffect(() => {
          const 候选 = [...document.querySelectorAll('div')].filter((d) => {
            const st = getComputedStyle(d)
            return (
              (st.overflowY === 'auto' || st.overflowY === 'scroll') &&
              d.scrollHeight > d.clientHeight + 20 &&
              d.clientHeight > 400 &&
              d.clientHeight < 900
            )
          })
          if (候选.length) 候选.sort((a, b) => b.scrollHeight - a.scrollHeight)[0].scrollTop = 0
        }, [页签])
  
        const 去会话 = () => {
          set页签('会话')
        }
  
        const 页签条 = el(
          'div',
          { style: Object.assign({}, S.tabs, { marginBottom: 14 }), role: 'tablist', 'aria-label': '黏土记忆分区' },
          页签名.map(([k, 注]) =>
            el(
              'button',
              {
                key: k,
                role: 'tab',
                'aria-selected': 页签 === k,
                title: 注,
                style: 页签 === k ? S.tabOn : S.tabOff,
                onClick: () => set页签(k),
              },
              k,
            ),
          ),
        )
  
        let 内容 = null
        if (页签 === '记忆') 内容 = el(所有记忆页, { on高级: () => set页签('高级') })
        else if (页签 === '时间线') 内容 = el(时间线页, null)
        else if (页签 === '会话')
          内容 = el(会话页, null)
  
        else if (页签 === '回收站') 内容 = el(回收站页, null)
        else if (页签 === '体检') 内容 = el(回复体检页, null)
        else if (页签 === '拦截') 内容 = el(拦截页, null)
        else 内容 = el(高级区, { on去会话: 去会话 })
  
        return el('div', null, 页签条, 页签 === '高级' ? el(语感默认行, null) : null, el(兜底, { key: 页签 }, 内容))
      }
  return { 记忆面板 }
}
