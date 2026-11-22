// 自绘下拉选择器 —— 会话页与高级区共用（2026-11-11 从 pages/advanced.js 提出来）
export function 造选择器({ React, el }) {
      function 选择器(props) {
        const [开, set开] = React.useState(false)
        // ⭐ 1.8.0：自绘下拉也要有原生那种「鼠标移到哪一行，哪一行亮」的反馈
        const [悬, set悬] = React.useState(-1)
        const [悬钮, set悬钮] = React.useState(false)
        const 选项 = props.选项 || []
        const 当前 = 选项.find((o) => String(o.v) === String(props.值))
        const 底 = Object.assign(
          {
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3))',
            background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,.08))',
            color: 'var(--dsw-alias-label-primary, inherit)',
            fontSize: 12,
          },
          props.style || {},
        )
        return el(
          'div',
          { style: { position: 'relative', display: 'inline-block', minWidth: props.minWidth || 120 } },
          el(
            'button',
            {
              style: Object.assign({}, 底, {
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                cursor: props.disabled ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                opacity: props.disabled ? 0.55 : 1,
                // 悬停：边框亮一档 + 背景提一档（跟原生下拉一致的反馈）
                ...(悬钮 && !props.disabled
                  ? {
                      borderColor: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,.55))',
                      background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.16))',
                    }
                  : null),
                ...(开
                  ? { borderColor: 'var(--dsw-alias-state-business-primary, #5b8fd6)' }
                  : null),
              }),
              onClick: () => set开((v) => !v),
              disabled: props.disabled,
              onMouseEnter: () => set悬钮(true),
              onMouseLeave: () => set悬钮(false),
            },
            el('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, 当前 ? 当前.t : '（请选择）'),
            el('span', { style: { flex: 'none', opacity: 0.6, fontSize: 10 } }, 开 ? '▴' : '▾'),
          ),
          开
            ? el(
                'div',
                {
                  style: {
                    position: 'absolute',
                    top: 'calc(100% + 4px)',
                    left: 0,
                    zIndex: 60,
                    minWidth: '100%',
                    maxHeight: 240,
                    overflow: 'auto',
                    background: 'var(--dsw-alias-bg-layer-1, #fff)',
                    border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28))',
                    borderRadius: 8,
                    padding: 4,
                    boxShadow: '0 10px 28px rgba(0,0,0,.22)',
                  },
                },
                选项.map((o, idx) =>
                  el(
                    'div',
                    {
                      key: String(o.v),
                      role: 'button',
                      tabIndex: 0,
                      style: {
                        padding: '6px 8px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontSize: 12,
                        whiteSpace: 'nowrap',
                        background:
                          String(o.v) === String(props.值)
                            ? 'var(--dsw-alias-state-business-primary, #5b8fd6)'
                            : 悬 === idx
                              ? 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.18))'
                              : 'transparent',
                        color: String(o.v) === String(props.值) ? '#fff' : 'var(--dsw-alias-label-primary, inherit)',
                        outline: 悬 === idx && String(o.v) !== String(props.值) ? '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35))' : 'none',
                      },
                      onMouseEnter: () => set悬(idx),
                      onMouseLeave: () => set悬(-1),
                      onClick: () => {
                        props.onChange && props.onChange(o.v)
                        set开(false)
                      },
                      onKeyDown: (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          props.onChange && props.onChange(o.v)
                          set开(false)
                        }
                      },
                    },
                    o.t,
                  ),
                ),
              )
            : null,
        )
      }
  return 选择器
}
