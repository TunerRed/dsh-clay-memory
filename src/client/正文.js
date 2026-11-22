import { 造记忆面板 } from './pages/panel.js'
import { 造会话页 } from './pages/sessions.js'
import { 造所有记忆页 } from './pages/memories.js'
import { 造高级区 } from './pages/advanced.js'
import { 造时间线页 } from './pages/timeline.js'
import { 造回收站页 } from './pages/recycle.js'
import { 造回复体检页 } from './pages/checkup.js'
import { 造拦截页 } from './pages/guard.js'

// DSH 黏土记忆 · 客户端正文（由加载器调用）
export function 装客户端(require) {
  const React = require('react')
    const inject = ['slots']
    const B = '/dsh-clay-memory'

    const get = (p) => fetch(B + p, { cache: 'no-store' }).then((r) => r.json())
    const post = (p, body) =>
      fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json())

    const fmt = (t) => {
      if (!t) return '（没记时间）'
      const d = new Date(t)
      const p = (n) => String(n).padStart(2, '0')
      return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    }
    const rel = (t, now) => {
      if (!t) return '（没记时间）'
      const dayIdx = (x) => Math.floor((new Date(x).getTime() + 8 * 3600000) / 86400000)
      const days = dayIdx(now) - dayIdx(t)
      if (!isFinite(days)) return fmt(t)
      // ⚠⚠ 2026-09-22 修（反馈：「为什么还有今天的事儿」）：
      //   原来是 `if (days <= 0) return '今天 …'` —— **负数的（未来的）也被算成今天** ✗
      //   实测：一条日期在未来的记忆→ 页面显示「今天 12:00」✗✗
      //   → 今天 / 明天 / N 天后 分开写 ✓
      if (days === 0) return '今天 ' + fmt(t).slice(6)
      if (days === -1) return '明天 ' + fmt(t).slice(6)
      if (days < 0) {
        const 后 = -days
        if (后 < 30) return 后 + ' 天后'
        return fmt(t).slice(0, 5) + '（' + Math.floor(后 / 30) + ' 个月后）'
      }
      if (days === 1) return '昨天 ' + fmt(t).slice(6)
      if (days < 30) return days + ' 天前'
      // ⭐ 2026-09-21 晚：**跨年了就必须带年份** —— 不然「09-17」看不出是哪一年 ✗
      //   （反馈：的：「过了一年会怎么显示呢？我现在看没有年份，只有月份」）
      const 今年 = new Date(new Date(now).getTime() + 8 * 3600000).getUTCFullYear()
      const 那年 = new Date(new Date(t).getTime() + 8 * 3600000).getUTCFullYear()
      if (那年 !== 今年) {
        const 差 = 今年 - 那年
        if (差 === 1) return '去年 ' + fmt(t).slice(0, 5)
        return 那年 + '-' + fmt(t).slice(0, 5) + '（' + 差 + ' 年前）'
      }
      // ⚠⚠ 2026-09-22 修（反馈：「不是两个月前啊」）：
      //   原来是 `Math.round(days / 30)` —— **四舍五入**把 47 天说成了「2 个月」✗
      //   47 天明明才一个半月。→ 改成**只进不退**（floor），零头够 15 天就说「个多月」✓
      const 月 = Math.floor(days / 30)
      const 零头 = days - 月 * 30
      return fmt(t).slice(0, 5) + '（' + 月 + (零头 >= 15 ? ' 个多' : ' 个') + '月前）'
    }
    const impName = (v) => (v >= 1 ? '非常重要' : v >= 0.5 ? '比较重要' : '随口提过')

    // ---------- 提炼 / 扩词的进度放在**组件外面** ----------
    // 为什么：跑一轮要十几二十分钟，她中途切走再回来，进度不该消失 ✓
    // ⚠ 两个**各占一格** —— 共用一个格子的话，两个一起跑会互相盖，
    //   看起来就像「点了扩词，过一会儿自己取消了」✗（2026-09-20 踩到）
    const 进度 = { 扩词: { 状态: null, 说明: null }, 提炼: { 状态: null, 说明: null }, 订阅: new Set() }
    // ⭐ 2026-09-22（反馈「点了判断，但他没有弹进度条啊，他就卡着判着呢」）：
    //   「补标不淡」原来**只有一行字、没有进度条** —— 跑起来看不出它在动 ✗
    //   （其实一直在跑，日志里一批批都有；她以为卡死了）
    //   → 给它也配一条进度条 ✓（放在组件外面，切走再回来还在）
    // ⚠ 2026-09-22（她的反馈）：这条原来跟提炼/扩词挤在同一张卡里，
    //   点了重判得往上翻才看得见 ✗ → 挪到按钮行下面，并记下**是哪一种**：
    //   「补标不淡」还是「重判一遍」，进度条上写清楚 ✓
    const 补标进度 = { 已: 0, 总: 0, 在跑: false, 重判: false }
// ⭐⭐ 2026-09-23：**清洗补键**的进度（老数据补事实键）✓
//   跟 补标 分开一份 —— 两条进度条同时跑的时候不许互相盖 ✗
const 洗键进度 = { 已: 0, 总: 0, 在跑: false, 干跑: false }
    const 改进度 = (格, 状态, 说明) => {
      const s = 进度[格] || (进度[格] = { 状态: null, 说明: null })
      s.状态 = 状态
      s.说明 = 说明
      for (const f of 进度.订阅) {
        try {
          f()
        } catch (e) {}
      }
    }

    // 一次别画太多行 —— 库里 800 多条的时候，全画出来整个页面都会卡（连别的插件面板一起卡）✗
    const 一次最多画 = 200

    // 权重在页面上按百分比显示 ✓（0.55 → 55）
    const toPct = (v) => Math.round(Number(v) * 1000) / 10
    const fromPct = (v) => Math.round(Number(v) * 10) / 1000

    const S = {
      wrap: { padding: '16px 6px', fontSize: 13, lineHeight: 1.8, maxWidth: 780 },
      dim: { color: 'var(--dsw-alias-label-tertiary, #8a8a8a)' },
      h: { fontSize: 14, margin: '20px 0 8px', fontWeight: 600 },
      // ⚠⚠ 2026-09-23（她的反馈：「右边堆的东西太多，左边的文字成了竖着的一条」）：
      //   这一行**必须能换行** ✗
      //   原来没有 flexWrap —— 行里全是 flex:'none' 的牌子/列（日期、鲜活度、重要度、原文、改、删…），
      //   它们一多，那条 flex:1 的正文就被挤成**竖着的一条**（一个字一行）。
      //   清洗补键给两百多条补上键之后，行里又多一个牌子 → 立刻犯病。
      //   加 flexWrap：装不下就让牌子们**掉到下一行**，正文始终有地方 ✓
      //   （跟上面 nameBox 那条是同一个教训）
      // ⚠⚠ 2026-09-24（她说的「能搜到它的词和讲的是，移到下一条的那一格里面去了」）：
      //   分隔线**原来画在「行」上** —— 可每条下面还有一两行小字
      //   （「提炼前：…」「能搜到它的词：…」「讲的是：…」），
      //   它们在线的**下面** → 看着就像属于**下一条**了 ✗
      //   → 线挪到「整条」上（见 S.条），行自己不再画线 ✓
      row: { padding: '6px 8px', display: 'flex', flexWrap: 'wrap', gap: 10, rowGap: 2, alignItems: 'baseline' },
      // 「一整条」的分隔线：**连着下面那几行小字一起**框住 ✓
      条: { borderBottom: '1px solid rgba(128,128,128,.15)' },
      btn: { padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(128,128,128,.35)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 },
      inp: { width: 72, padding: '2px 6px', borderRadius: 5, border: '1px solid rgba(128,128,128,.35)', background: 'transparent', color: 'inherit', colorScheme: 'light dark', fontSize: 12 },
      link: { color: 'var(--dsw-alias-label-secondary, #8fa8c8)', cursor: 'pointer', textDecoration: 'underline' },
      confirm: { display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 8px 8px', padding: '6px 10px', borderRadius: 6, background: 'rgba(200,120,120,.12)', border: '1px solid rgba(200,120,120,.35)', fontSize: 12 },
      // ⚠ flexWrap：放大或窗口窄的时候要能换行，不然会横向撑出容器（右边就看不见了）✗
      nameBox: { display: 'flex', flexWrap: 'wrap', gap: 8, rowGap: 6, alignItems: 'center', margin: '10px 0', padding: '6px 10px', borderRadius: 6, background: 'rgba(128,128,128,.10)', border: '1px solid rgba(128,128,128,.22)', fontSize: 12 },
      editBox: { margin: '4px 0 10px 8px', padding: '8px 10px', borderRadius: 6, background: 'rgba(128,128,128,.10)', border: '1px solid rgba(128,128,128,.28)' },
      askBox: { display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0', padding: '8px 10px', borderRadius: 6, background: 'rgba(224,176,112,.12)', border: '1px solid rgba(224,176,112,.4)', fontSize: 12 },
      barOut: { height: 10, borderRadius: 5, background: 'rgba(128,128,128,.20)', overflow: 'hidden', border: '1px solid rgba(128,128,128,.25)' },
      barIn: { height: '100%', background: 'linear-gradient(90deg,#5b8fd6,#8fd0a0)', transition: 'width .25s' },
      area: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 5, border: '1px solid rgba(128,128,128,.35)', background: 'transparent', color: 'inherit', fontSize: 13, lineHeight: 1.7, fontFamily: 'inherit', resize: 'vertical' },
      btnDanger: { padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(200,120,120,.6)', background: 'rgba(200,120,120,.18)', color: 'inherit', cursor: 'pointer', fontSize: 12 },
      ok: { color: '#8fd0a0' },
      drop: { color: '#c98080' },
      warn: { color: '#e0b070' },
      // ⭐ 1.4.2（用户：「层次和主次不太分明」）：分区卡片
      //   原来十来个区块平铺在一页里，全靠一行行小字分隔，谁管谁看不出来。
      //   现在每块一个浅色卡 + 一句标题 + 小标签，扫描时先看到「有几块」再看细节 ✓
      sec: {
        margin: '0 0 12px',
        padding: '12px 14px',
        borderRadius: 12,
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))',
        background: 'var(--dsw-alias-bg-l2, rgba(127,127,127,.05))',
      },
      secH: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
      secTitle: { fontSize: 13.5, fontWeight: 600 },
      secTag: {
        fontSize: 11,
        padding: '1px 7px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3))',
        color: 'var(--dsw-alias-label-tertiary, #8a8a8a)',
      },
      // ⭐ 1.4.2：详情页的区块分隔（跟上面那些卡片是一套的）
      //   详情页区块多、又各有自己的折叠，套整张卡片得把每块都包一层 ——
      //   包 JSX 风险大，先用「分隔线 + 加重标题」把段分出来，层次一样能看出来 ✓
      part: {
        marginTop: 20,
        paddingTop: 14,
        borderTop: '1px dashed var(--dsw-alias-border-l1, rgba(128,128,128,.28))',
        marginBottom: 8,
        fontSize: 13.5,
        fontWeight: 650,
        color: 'var(--dsw-alias-label-primary)',
      },
      // ⭐ 1.4.2：详情页顶部的「这个会话是谁」小卡（跟全局事实页的 hero 呼应）
      secHero: {
        margin: '2px 0 14px',
        padding: '12px 14px',
        borderRadius: 12,
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2))',
        background:
          'linear-gradient(135deg, rgba(91,143,214,.10), rgba(143,208,160,.07) 60%, rgba(128,128,128,.02))',
      },
      // ⭐ 2026-10-28（用户：「详情页下面几块功能拆成几个 tab 分区」）：
      //   原来十来块一路平铺到底，想看「导入」「备份」得滚动好久，谁管谁也看不出来 ✗
      //   → 顶上加一条页签，下面只显示当前那一块 ✓
      //   ⚠ 观感跟外层「会话记忆 / 全局事实」那排页签是同一套：
      //     选中 = 品牌色药丸 + 白字，没选 = 透明底 + 次级字色；
      //     颜色全走主题变量，深色模式自己跟着变 ✓
      tabs: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        margin: '0 0 14px',
        padding: 4,
        borderRadius: 10,
        background: 'var(--dsw-alias-bg-l2, rgba(128,128,128,.08))',
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))',
        width: 'fit-content',
        maxWidth: '100%',
        boxSizing: 'border-box',
      },
      tabOn: {
        padding: '5px 14px',
        borderRadius: 999,
        border: '1px solid transparent',
        background: 'var(--dsw-alias-state-business-primary, #5b8fd6)',
        color: '#fff',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
        boxShadow: '0 1px 3px rgba(0,0,0,.14)',
      },
      tabOff: {
        padding: '5px 14px',
        borderRadius: 999,
        border: '1px solid transparent',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, rgba(110,110,110,.95))',
        cursor: 'pointer',
        fontSize: 13,
      },
      // ⭐ 2026-10-28：tab 里面「下一阶段」的小标题
      //   （虚线分隔 + 加重字，比 S.part 轻一档 —— 别抢了 tab 的层级）
      subH: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        gap: 8,
        marginTop: 18,
        paddingTop: 12,
        borderTop: '1px dashed var(--dsw-alias-border-l1, rgba(128,128,128,.28))',
        marginBottom: 4,
      },
    }

    // ⭐ 版本 / 检查更新 —— 单独一条，不掺进那个大页面（改它的渲染风险太大）
    const 更新命令 = ['dsh plugin --profile web remove dsh-clay-memory', 'dsh plugin --profile web add dsh-clay-memory'].join(String.fromCharCode(10))
    function 更新条() {
      const [up, setUp] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const 查 = async () => {
        setBusy(true)
        try { setUp(await get('/update?refresh=1')) } catch (e) { setUp({ ok: false, error: String((e && e.message) || e) }) }
        setBusy(false)
      }
      React.useEffect(() => { get('/update').then((r) => setUp(r)).catch(() => {}) }, [])
      const 说 = !up ? '正在看有没有新版…'
        : up.hasUpdate ? '仓库里已经有 v' + up.latest + ' 了'
          : up.ok ? '已经是最新版' : '暂时查不到（' + (up.error || '网络') + '）—— 这不代表没有问题'
      return React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', marginBottom: 14, borderRadius: 10, background: 'rgba(127,127,127,.07)' } },
        React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          React.createElement('div', { style: { flex: 1, fontSize: 13 } }, '插件版本 ' + ((up && up.current) || '—') + '　·　' + 说),
          React.createElement('button', { style: S.btn, disabled: busy, onClick: 查 }, busy ? '查…' : '检查更新'),
        ),
        (up && up.hasUpdate)
          ? React.createElement(
            'div',
            null,
            React.createElement('div', { style: S.dim }, '更新方法：先卸旧版再装新版（直接装可能拿到缓存里的旧副本）。'),
            React.createElement('div', { style: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: '8px 10px', borderRadius: 7, background: 'rgba(127,127,127,.1)' } }, 更新命令),
            React.createElement('button', {
              style: S.btn,
              onClick: () => navigator.clipboard.writeText(更新命令).catch(() => {}),
            }, '复制命令'),
          )
          : null,
      )
    }


    // ⭐⭐ 1.4.1：**全局事实独立页**（用户要的「单独页面管理」）
    //   事实是全局资产，不该逼着先选一个会话才能看见 → 单独一个页签，单独拉 /facts。
    //   完全不碰上面 Section 那四千行（改它的风险太大），出问题也只影响这一页 ✓
    const el = React.createElement

    // ⭐ 2026-11-01（用户：「把参数整体搬进高级里，替代原本的记忆习惯」）：
    //   参数（权重 / 遗忘速度 / 门槛与条数）原来藏在「会话 → 点进会话 → 参数」里，
    //   现在整块搬到「高级」页，替代三档快捷。参数是所有会话共用的，自己拉 /list 的 spec + policy。

    // ⭐ 1.8.0：自绘下拉 —— 原生 <select> 的弹层由系统画，深色主题下会白底白字
    //   这里用 button + 绝对定位列表，颜色全走 --dsw-alias-* 变量，深浅色都跟得上。
    const 重要色 = (v) =>
      v >= 1
        ? 'var(--dsw-alias-state-success-primary, #7fbf8f)'
        : v >= 0.5
          ? 'var(--dsw-alias-state-warn-primary, #d6a35b)'
          : 'var(--dsw-alias-label-tertiary, rgba(128,128,128,.5))'
    const G = {
      tabs: {
        display: 'flex',
        gap: 4,
        margin: '2px 0 14px',
        padding: 4,
        borderRadius: 10,
        background: 'rgba(128,128,128,.08)',
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))',
        width: 'fit-content',
      },
      tabOn: {
        padding: '5px 14px',
        borderRadius: 7,
        border: '1px solid transparent',
        background: 'var(--dsw-alias-state-business-primary, #5b8fd6)',
        color: '#fff',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
        boxShadow: '0 1px 3px rgba(0,0,0,.14)',
      },
      tabOff: {
        padding: '5px 14px',
        borderRadius: 7,
        border: '1px solid transparent',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, rgba(110,110,110,.95))',
        cursor: 'pointer',
        fontSize: 13,
      },
      hero: {
        position: 'relative',
        overflow: 'hidden',
        padding: '18px 20px',
        marginBottom: 14,
        borderRadius: 14,
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))',
        background:
          'linear-gradient(135deg, rgba(91,143,214,.16), rgba(143,208,160,.10) 55%, rgba(128,128,128,.04))',
      },
      heroNum: {
        fontSize: 40,
        lineHeight: 1.1,
        fontWeight: 700,
        letterSpacing: '-1px',
        color: 'var(--dsw-alias-label-primary, inherit)',
      },
      heroUnit: {
        fontSize: 13,
        fontWeight: 400,
        marginLeft: 6,
        color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,.8))',
      },
      heroTip: {
        marginTop: 6,
        fontSize: 12,
        color: 'var(--dsw-alias-label-secondary, rgba(128,128,128,.9))',
      },
      chips: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 },
      chip: {
        display: 'flex',
        alignItems: 'baseline',
        gap: 5,
        padding: '5px 10px',
        borderRadius: 8,
        fontSize: 12,
        background: 'rgba(255,255,255,.22)',
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2))',
        color: 'var(--dsw-alias-label-secondary, rgba(128,128,128,.9))',
      },
      chipNum: { fontWeight: 700, fontSize: 14, color: 'var(--dsw-alias-label-primary, inherit)' },
      tools: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 },
      search: {
        flex: '1 1 180px',
        minWidth: 140,
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3))',
        background: 'rgba(128,128,128,.06)',
        color: 'inherit',
        fontSize: 13,
        outline: 'none',
      },
      sel: {
        padding: '6px 8px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3))',
        // ⭐ 1.8.0：下拉框要跟主题走 —— 框体用主题底色，原生弹层用 color-scheme
        background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,.08))',
        color: 'var(--dsw-alias-label-primary, inherit)',
        colorScheme: 'light dark',
        fontSize: 12,
      },
      pill: {
        padding: '5px 10px',
        borderRadius: 999,
        fontSize: 12,
        cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3))',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, rgba(128,128,128,.9))',
      },
      pillOn: {
        padding: '5px 10px',
        borderRadius: 999,
        fontSize: 12,
        cursor: 'pointer',
        border: '1px solid var(--dsw-alias-state-business-primary, #5b8fd6)',
        background: 'rgba(91,143,214,.16)',
        color: 'var(--dsw-alias-label-primary, inherit)',
      },
      item: {
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.16))',
        background: 'rgba(128,128,128,.04)',
        marginBottom: 8,
      },
      itemTop: { display: 'flex', gap: 10, alignItems: 'flex-start' },
      dot: { flex: 'none', width: 8, height: 8, borderRadius: 4, marginTop: 7 },
      text: {
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        lineHeight: 1.75,
        color: 'var(--dsw-alias-label-primary, inherit)',
        overflowWrap: 'anywhere',
        cursor: 'text',
      },
      date: {
        flex: 'none',
        fontSize: 11,
        paddingTop: 3,
        color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,.75))',
      },
      x: {
        flex: 'none',
        padding: '1px 7px',
        borderRadius: 6,
        border: '1px solid transparent',
        background: 'transparent',
        color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,.8))',
        cursor: 'pointer',
        fontSize: 14,
        lineHeight: 1.4,
      },
      meta: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 6,
        paddingLeft: 18,
        fontSize: 11,
        color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,.8))',
      },
      badge: {
        padding: '0 6px',
        borderRadius: 5,
        background: 'rgba(91,143,214,.14)',
        color: 'var(--dsw-alias-label-secondary, rgba(128,128,128,.95))',
        fontSize: 11,
      },
      empty: {
        padding: '36px 16px',
        textAlign: 'center',
        borderRadius: 12,
        border: '1px dashed var(--dsw-alias-border-l1, rgba(128,128,128,.3))',
        color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,.85))',
        fontSize: 13,
        lineHeight: 2,
      },
      confirm: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
        padding: '8px 12px',
        borderRadius: 10,
        marginBottom: 8,
        background: 'rgba(200,120,120,.12)',
        border: '1px solid rgba(200,120,120,.35)',
        fontSize: 12,
      },
      btn: {
        padding: '4px 12px',
        borderRadius: 7,
        border: '1px solid rgba(128,128,128,.35)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 12,
      },
      btnDanger: {
        padding: '4px 12px',
        borderRadius: 7,
        border: '1px solid var(--dsw-alias-state-error-primary, rgba(200,120,120,.6))',
        background: 'rgba(200,120,120,.18)',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 12,
      },
      area: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '8px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3))',
        background: 'rgba(128,128,128,.06)',
        color: 'inherit',
        fontSize: 13,
        lineHeight: 1.7,
        fontFamily: 'inherit',
        resize: 'vertical',
        minHeight: 60,
      },
      note: {
        fontSize: 12,
        marginBottom: 10,
        color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,.85))',
      },
      err: {
        padding: '8px 12px',
        marginBottom: 10,
        borderRadius: 8,
        fontSize: 12,
        background: 'rgba(200,120,120,.12)',
        border: '1px solid rgba(200,120,120,.35)',
        color: 'var(--dsw-alias-label-primary, inherit)',
      },
    }

    // ⭐⭐ 1.5.0（A 轮）：**所有记忆页** —— 一个列表看全部（F16）
    //   把 1.4.x 的「会话记忆 / 全局事实」两页签**收掉**：
    //   作用域从「页签」变成**每条上的徽章** + 一行筛选器（F1 的前端那一半）。
    //   结构：状态条 → ＋记一条（内联）→ 全库搜索 → 筛选行（作用域/类型/状态）→ 卡片列表
    //   ⚠⚠ 数据分流一条都没动：只合并**渲染**，删除 / 找回 / 作废还是各回各家
    //     （上一版把「已被取代」并进 deleted，清空连坐销毁过 157 条 —— 见规划 §4.5）
    //   ⚠ 数据源：新端点 POST /all（每条带 scope / session / sessionTitle / type / createdAt / deleted）；
    //     后端还没上时**自己退化**成 GET /list 合并视图 —— 按 id 去重
    //     （每个会话的 memories 都含全部全局事实，直接 flatten 会 ×N）
    const 类型表 = [
      ['identity', '身份'],
      ['relation', '关系'],
      ['promise', '约定'],
      ['preference', '偏好'],
      ['experience', '经历'],
      ['misc', '其他'],
    ]
    const 类型名 = (k) => {
      for (let i = 0; i < 类型表.length; i++) if (类型表[i][0] === k) return 类型表[i][1]
      return ''
    }
    const 同日 = (a, b) => {
      if (!a || !b) return false
      const A = new Date(a)
      const B = new Date(b)
      if (isNaN(A.getTime()) || isNaN(B.getTime())) return false
      return A.getFullYear() === B.getFullYear() && A.getMonth() === B.getMonth() && A.getDate() === B.getDate()
    }
    // /list 不返回「什么时候记下的」—— 新记忆的 id 是 'mm' + 时间戳(36 进制) + 随机尾巴，
    // 从最长前缀往短了试，第一个落进「合理范围」的就是时间戳（随机尾巴加上去只会变大被排除）✓
    const 由id猜时间 = (id) => {
      const s = String(id || '')
      if (s.indexOf('mm') !== 0 || s.length < 8) return null
      const 上限 = Date.now() + 86400000
      for (let n = s.length; n > 5; n--) {
        const t = parseInt(s.slice(2, n), 36)
        if (!isFinite(t) || t < 1e12 || t > 上限) continue
        return new Date(t).toISOString()
      }
      return null
    }

    // 一条记忆 → 前端统一形状（/all 的原样用，/list 的尽量补）
    const 归整 = (m, 来自全部) => {
      const 是工区 = m.category === 'workspace' || String(m.scope || '').indexOf('workspace:') === 0
      const 全局 = m.scope === 'global' || (!m.scope && !是工区 && m.category === 'stable_profile')
      return {
        id: String(m.id || ''),
        text: String(m.text || ''),
        at: m.at || null,
        createdAt: m.createdAt || m.addedAt || 由id猜时间(m.id),
        importance: typeof m.importance === 'number' ? m.importance : null,
        source: String(m.source || ''),
        category: m.category || '',
        已被取代: m.已被取代 || null,
        事实键: m.事实键 || m.factKey || '',
        related: Array.isArray(m.related) ? m.related : [],
        type: m.type || m.kind || '',
        scope: 全局 ? 'global' : 是工区 ? 'workspace' : 'session',
        session: 全局 ? null : m.session || m.sessionId || null,
        sessionTitle: 全局 ? '全局记忆' : 是工区 ? '工作区记忆' : String(m.sessionTitle || ''),
        sessionId: String(m.session || m.sessionId || ''),
        deleted: !!m.deleted || !!m.deletedAt,
        deletedAt: m.deletedAt || null,
        // ⭐ B 轮：这两个字段要从 /all 原样带过来，不然详情块的字段到了列表就被丢掉
        textBefore: String(m.textBefore || ''),
        // ⭐ 1.10.3（F12）：原话也要原样带过来
        原话: String(m.原话 || ''),
        别记: String(m.别记 || ''),
      }
    }
    // 退化路径：/list 的会话们 → 一份去重过的全库列表
    const 合并成一份 = (会话们) => {
      const 条 = []
      const 见过 = {}
      const 收 = (m, 会话, 标题, 已删) => {
        const k = (已删 ? 'd:' : '') + String(m.id)
        if (!m || !m.id || 见过[k]) return
        见过[k] = true
        const x = 归整(m, false)
        x.session = 会话 || null
        x.sessionTitle = 会话 ? 标题 : '全局记忆'
        x.deleted = !!已删
        if (!x.createdAt) x.createdAt = 已删 ? m.deletedAt || null : null
        条.push(x)
      }
      ;(会话们 || []).forEach((s) => {
        ;(s.memories || []).forEach((m) => 收(m, s.id, s.title || s.id, false))
        ;(s.deleted || []).forEach((m) => 收(m, s.id, s.title || s.id, true))
      })
      return 条
    }


    // ── 底部三个折叠区（▸会话 / ▸导入迁移 / ▸高级）──────────


    // ⭐ 1.5.0（F21）：三档快捷 —— 2026-11-01 用户要求「参数整体搬进高级、替代记忆习惯」，
    //   三档按钮和它的 保守/正常/话痨 预设一起删了；现在高级页直接给完整参数。
    // ⭐ 1.6.14（用户：「从会话导出档案里可以选择指定会话，说明它不是针对当前会话的，放到高级 tab」）
    //   整块从「会话详情 → 记忆」搬到这里：状态、动作、面板都在组件内，高级页只留一个入口。
    //   会话号只用来告诉后端「哪个工作区、建议存哪」——不读这个会话的内容 ✓

    // ⭐ 1.8.0：从档案导入会话（设计 §四）
    //   ① 选档案 = 原生 <input type="file">（系统「打开」对话框，只认 .md）
    //   ② 拆出候选、重复项默认不勾
    //   ③ 导到哪儿 = 工作区下拉 + 该工作区会话列表（可搜索、单选）
    //   ④ 两个条件都满足才允许点「导入」
    //   ⑤ 导完原地给 提炼 / 补检索词 / 撤销这次导入


    // ⭐ 1.6.9（用户：「高级页里按钮跳转混乱，子菜单返回直接回主页；理不清就用 tab 页」）
    //   改成平级的四个页签：记忆 / 会话 / 导入 / 高级。没有层级，也就没有「返回去哪一层」的问题；
    //   高级里的「去调」= 切到「会话」页并展开参数，不再来回跳页面。
    const 页签名 = [
      ['记忆', '所有记忆'],
      ['时间线', '按天看：那天记了什么 · 又想起过什么'],
      ['会话', '每个会话的开关 · 称呼 · 导入 · 提炼'],
      ['回收站', '删掉的记忆都在这儿 · 能搜能找回'],
      ['体检', '助手回复的 AI 味 · 规则开关'],
      ['高级', '参数 · 整理会话 · 备份 · 版本'],
    ]

    // ⭐ 1.8.0：一块出错不该让整个设置面板变白 —— 兜住渲染异常，给出「哪一块坏了 + 重试」
    class 兜底 extends React.Component {
      constructor(props) {
        super(props)
        this.state = { 错: null }
      }
      static getDerivedStateFromError(e) {
        return { 错: e }
      }
      componentDidCatch(e) {
        try {
          console.error('[黏土记忆] 渲染出错：', e)
        } catch (_) {}
      }
      render() {
        if (this.state.错) {
          return el(
            'div',
            { style: { padding: 12, borderRadius: 8, border: '1px solid var(--dsw-alias-state-error-primary, rgba(208,90,90,.5))', background: 'var(--dsw-alias-bg-layer-2, rgba(208,90,90,.08))', fontSize: 12.5 } },
            el('div', { style: { fontWeight: 600, marginBottom: 6 } }, '这块出了点问题（换回别的页签还能用）'),
            el(
              'div',
              { style: { fontFamily: 'monospace', fontSize: 11.5, color: 'var(--dsw-alias-label-secondary, #888)', marginBottom: 8, wordBreak: 'break-all' } },
              String((this.state.错 && this.state.错.message) || this.state.错),
            ),
            el(
              'button',
              {
                style: { padding: '3px 10px', fontSize: 12, borderRadius: 6, border: '1px solid rgba(128,128,128,.35)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
                onClick: () => this.setState({ 错: null }),
              },
              '重试',
            ),
          )
        }
        return this.props.children
      }
    }

    // ⭐ 2026-11-01 用户：「回收站的条目好多，是会话和工作区共用的吗？如果是，能不能换到顶部页签
    //   做成一个独立的内容？顺便把搜索也做上，只搜内容就行了」→ 顶部独立「回收站」页签。
    //   回收站不共用：事实库/每个会话/每个工作区各自一个 deleted 数组，这里合起来看、标来源、能找回。
  const 时间线页 = 造时间线页({ React, el, get, S, G, 类型名 })
  const 回收站页 = 造回收站页({ React, get, post, S, el, 类型名 })

    // ⭐ 2026-11-10：回复体检（FuckAIWords 的 22 类词面规则，从 dsh-persona-growth 搬进黏土记忆）
    //   只观察不阻断：扫最近会话里的助手发言，标「AI 味」，规则可逐条开关。
  const 回复体检页 = 造回复体检页({ React, get, post, B, S, el })

    // ⭐ 1.12.71：工具拦截（B 组）—— 规则用户自己写，插件只负责拦
  const { 拦截页 } = 造拦截页({ React, el, get, post, S })

  const { 高级区 } = 造高级区({ React, el, get, post, S, G, toPct, fromPct, 进度, 更新条 })
  const { 所有记忆页 } = 造所有记忆页({ React, el, get, post, B, S, G, rel, 类型名, 类型表, 同日, 归整, 一次最多画, 重要色 })
  // ⚠ 会话页里也用到组件外的进度对象（切走再回来还在）：漏传会 `ReferenceError: 进度 is not defined`，整页空白
  const { 会话页 } = 造会话页({ React, el, get, post, B, S, rel, impName, 一次最多画, 进度, 改进度, 补标进度, 洗键进度 })

  const { 记忆面板 } = 造记忆面板({ React, el, get, post, S, G, B, rel, impName, toPct, fromPct, 进度, 更新条, 类型名, 类型表, 同日, 归整, 一次最多画, 重要色, 会话页, 所有记忆页, 时间线页, 回收站页, 回复体检页, 拦截页, 高级区 , 页签名, 兜底})
    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () =>
        slots.register(
          {
            name: 'settings.section',
            id: 'memory',
            order: 51,
            label: () => '黏土记忆',
          },
          () => el(记忆面板),
        ),
      )
    }


  return { apply, inject }
}
