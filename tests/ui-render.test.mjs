// UI 真实 DOM 渲染与交互测试（Batch 1：jsdom + React 真实挂载，不依赖浏览器）
// 覆盖：全页签无白屏崩溃、会话名字/出处/层级显示准确、补记懒加载与状态重置、样式/选中态/防竖排/二次确认、构建产物 lib/client.js 冒烟
// 注意：jsdom / react / react-dom 是 devDependency，发布包无 node_modules 时自动跳过（与 page-scope / client-build 同口径）。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const 仓库根 = join(dirname(fileURLToPath(import.meta.url)), '..')
const 有UI依赖 =
  existsSync(join(仓库根, 'node_modules/jsdom')) &&
  existsSync(join(仓库根, 'node_modules/react')) &&
  existsSync(join(仓库根, 'node_modules/react-dom'))

const 跳过原因 = 有UI依赖 ? false : '没装 jsdom / react / react-dom（devDependency），跳过 UI 渲染用例'

if (跳过原因) {
  test('UI 真实 DOM 渲染测试', { skip: 跳过原因 }, () => {})
} else {
  const { JSDOM } = await import('jsdom')
  // react-dom/client 在模块初始化时会读取全局 window/document，先准备临时 jsdom 环境再 import
  const 预热Dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:3000/' })
  const 预存 = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    Node: globalThis.Node,
    Event: globalThis.Event,
    getComputedStyle: globalThis.getComputedStyle,
  }
  globalThis.window = 预热Dom.window
  globalThis.document = 预热Dom.window.document
  globalThis.HTMLElement = 预热Dom.window.HTMLElement
  globalThis.Node = 预热Dom.window.Node
  globalThis.Event = 预热Dom.window.Event
  globalThis.getComputedStyle = 预热Dom.window.getComputedStyle.bind(预热Dom.window)

  const React = (await import('react')).default
  const { createRoot } = await import('react-dom/client')
  const { act } = React
  const { 装客户端 } = await import('../src/client/app.js')
  Object.assign(globalThis, 预存)

  const require = createRequire(import.meta.url)

  function 建测试夹具(重写) {
    const 现 = new Date().toISOString()
    const 数据 = {
      sessions: [
        {
          id: 'sess-1',
          title: '周末火锅与旅行计划',
          enabled: true,
          live: true,
          parent: 'sess-parent',
          lastTrace: 现,
          selfName: '小橘',
          ownerName: '主人',
          factsCount: 1,
          eventCount: 2,
          memories: [
            {
              id: 'm-global-1',
              text: '主人喜欢喝冰美式，不加糖',
              category: 'stable_profile',
              scope: 'global',
              type: 'preference',
              importance: 1,
              at: '2026-11-20T08:00:00.000Z',
              createdAt: 现,
              source: '她自己记的',
              事实键: '饮品.咖啡',
              层: 'global',
            },
            {
              id: 'm-sess-1',
              text: '周六约好去吃牛油火锅',
              category: 'event',
              scope: 'session',
              session: 'sess-1',
              type: 'promise',
              importance: 0.8,
              at: '2026-11-21T12:00:00.000Z',
              createdAt: 现,
              source: 'episode-extract',
              原话: '这周六去吃牛油火锅吧',
              层: 'session',
            },
            {
              id: 'm-sup-1',
              text: '以前住在城西老房子',
              category: 'event',
              scope: 'session',
              session: 'sess-1',
              type: 'misc',
              importance: 0.5,
              source: '自动抽取',
              已被取代: { 被谁: 'm-new', 为什么: '搬到城东了', 作废于: 现 },
              层: 'session',
            },
          ],
          deleted: [
            {
              id: 'm-del-1',
              text: '一条临时删掉的测试记忆',
              deletedAt: 现,
            },
          ],
          traces: [
            {
              at: 现,
              query: '周末吃什么',
              picked: [{ id: 'm-sess-1', text: '周六约好去吃牛油火锅', score: 0.91 }],
            },
          ],
        },
        {
          id: 'sess-parent',
          title: '最初的设定讨论',
          enabled: false,
          live: false,
          factsCount: 1,
          eventCount: 1,
          memories: [
            {
              id: 'm-parent-1',
              text: '最初约定了称呼规则',
              category: 'event',
              scope: 'session',
              session: 'sess-parent',
              type: 'identity',
              importance: 0.5,
              createdAt: 现,
              source: '手动添加',
              层: 'session',
            },
          ],
          deleted: [],
          traces: [],
        },
        {
          id: 'sess-unnamed-1234567890abcdef',
          title: '',
          enabled: true,
          live: false,
          factsCount: 1,
          eventCount: 0,
          memories: [],
          deleted: [],
          traces: [],
        },
      ],
      workspaces: [
        { id: 'ws-1', name: 'clay-plugin', path: '/workspace/dsh-clay-memory', 会话数: 2 },
      ],
      allMemories: [
        {
          id: 'm-global-1',
          text: '主人喜欢喝冰美式，不加糖',
          category: 'stable_profile',
          scope: 'global',
          type: 'preference',
          importance: 1,
          at: '2026-11-20T08:00:00.000Z',
          createdAt: 现,
          source: '她自己记的',
          事实键: '饮品.咖啡',
        },
        {
          id: 'm-ws-1',
          text: '这个仓库走 npm test 跑单测',
          category: 'workspace',
          scope: 'workspace:/workspace/dsh-clay-memory',
          type: 'misc',
          importance: 0.6,
          at: '2026-11-21T09:00:00.000Z',
          createdAt: 现,
          source: '手动添加',
        },
        {
          id: 'm-sess-1',
          text: '周六约好去吃牛油火锅',
          category: 'event',
          scope: 'session',
          session: 'sess-1',
          sessionTitle: '周末火锅与旅行计划',
          type: 'promise',
          importance: 0.8,
          at: '2026-11-21T12:00:00.000Z',
          createdAt: 现,
          source: 'episode-extract',
          原话: '这周六去吃牛油火锅吧',
        },
        {
          id: 'm-sup-1',
          text: '以前住在城西老房子',
          category: 'event',
          scope: 'session',
          session: 'sess-1',
          sessionTitle: '周末火锅与旅行计划',
          type: 'misc',
          importance: 0.5,
          createdAt: 现,
          source: '自动抽取',
          已被取代: { 被谁: 'm-new', 为什么: '搬到城东了', 作废于: 现 },
        },
      ],
      allDeleted: [
        {
          id: 'm-del-1',
          text: '一条临时删掉的测试记忆',
          scope: 'session',
          session: 'sess-1',
          sessionTitle: '周末火锅与旅行计划',
          deletedAt: 现,
          source: '手动添加',
        },
      ],
      backfillBatches: [
        { 批次: 'backfill-20261122-01', 会话: 'sess-1', 条数: 3, 时间: 现 },
        { 批次: 'backfill-other-session', 会话: 'sess-parent', 条数: 2, 时间: 现 },
      ],
    }

    const 请求记录 = []

    const fetch假 = async (rawUrl, init) => {
      const url = String(rawUrl)
      const method = (init && init.method) || 'GET'
      const body = init && init.body ? JSON.parse(init.body) : null
      请求记录.push({ method, url, body })

      if (重写 && typeof 重写 === 'function') {
        const 自定义 = await 重写({ method, url, body })
        if (自定义 !== undefined) return { ok: true, json: async () => 自定义 }
      }

      const 路径 = url.replace(/^\/dsh-clay-memory/, '').split('?')[0]
      const qs = new URLSearchParams(url.includes('?') ? url.split('?')[1] : '')
      const 回 = (obj) => ({ ok: true, json: async () => obj })

      if (路径 === '/update') return 回({ ok: true, current: '1.12.88', latest: '1.12.88', hasUpdate: false })
      if (路径 === '/all') {
        return 回({
          ok: true,
          memories: 数据.allMemories,
          deleted: 数据.allDeleted,
          sessions: 数据.sessions.map((s) => ({ id: s.id, title: s.title })),
          stats: { 总数: 数据.allMemories.length, 返回: 数据.allMemories.length, todayAdded: 2, todayRecalled: 1 },
          全局开关: true,
        })
      }
      if (路径 === '/health') {
        return 回({
          ok: true,
          days: 7,
          汇总: { 次数: 12, 有命中: 10, 平均条数: 3, 平均字数: 120, 空注入: 2, 被门挡: 0, 预算利用率: 40, 被裁条数: 0, 裁剪率: 0 },
          配额: { maxItems: 6, maxChars: 1200 },
        })
      }
      if (路径 === '/candidates') return 回({ ok: true, count: 0, items: [] })
      if (路径 === '/list') {
        return 回({
          ok: true,
          全局开关: true,
          userPronoun: 'ta',
          factsCount: 1,
          lexicon: { 词典: 12000, 词频: 8000 },
          sessions: 数据.sessions,
        })
      }
      if (路径 === '/workspaces') return 回({ ok: true, workspaces: 数据.workspaces })
      if (路径 === '/sessions-by-workspace') {
        const ws = qs.get('workspace')
        const list = ws === 'ws-1' ? 数据.sessions.slice(0, 2) : 数据.sessions
        return 回({ ok: true, sessions: list.map((s) => ({ id: s.id, title: s.title })) })
      }
      if (路径 === '/workspace-memories') {
        return 回({
          ok: true,
          count: 1,
          file: 'ws-1.json',
          memories: [{ id: 'm-ws-1', text: '这个仓库走 npm test 跑单测', importance: 0.6, at: 现 }],
          deleted: [],
          回收站: [],
        })
      }
      if (路径 === '/timeline') {
        return 回({
          ok: true,
          每天: [
            {
              日: '2026-11-22',
              记数: 1,
              想起: { 次: 2, 有: 1, 条: 3, 空: 1, 兜底: 0 },
              记: [{ t: '10:00', text: '主人喜欢喝冰美式，不加糖', 类型: 'preference' }],
            },
          ],
        })
      }
      if (路径 === '/recycle-bin') {
        return 回({
          ok: true,
          total: 1,
          items: [
            {
              id: 'm-del-1',
              file: 'sess-1.json',
              来源类型: 'session',
              来源: '周末火锅与旅行计划',
              text: '一条临时删掉的测试记忆',
              deletedAt: 现,
            },
          ],
        })
      }
      if (路径 === '/selfcheck') return 回({ ok: true, checks: [], 摘要: '全部正常' })
      if (路径 === '/checkup') return 回({ ok: true, days: 14, total: 0, items: [], rules: [], 统计: {} })
      if (路径 === '/prompt-reminder') return 回({ ok: true, text: '', maxChars: 200 })
      if (路径 === '/guard') return 回({ ok: true, enabled: false, rules: [], 工作区们: [], 编译错误: [] })
      if (路径 === '/models') return 回({ ok: true, models: [] })
      if (路径 === '/core-preview') return 回({ ok: true, skeleton: [], 缺: [], 多: [] })
      if (路径 === '/import-history') return 回({ ok: true, items: [] })
      if (路径 === '/backfill/sessions') {
        const 当前 = qs.get('当前') || ''
        if (当前 === 'sess-parent') {
          return 回({
            ok: true,
            会话们: [],
            当前诊断: { 会话: 'sess-parent', 够: false, 为什么: '没有归档记录', 建议: '先多聊几轮再补记' },
          })
        }
        return 回({
          ok: true,
          会话们: [
            { 会话: 'sess-1', 条数: 24, 用户: 12, 助手: 12, 字节: 4096, 时间: Date.now(), 已补记: false, 文件: '/sessions/ws-1/sess-1/session.v4.jsonl.zstd' },
          ],
          当前诊断: 当前 ? { 会话: 当前, 够: true } : null,
        })
      }
      if (路径 === '/backfill/batches') return 回({ ok: true, 批次们: 数据.backfillBatches })
      if (路径 === '/backfill/preview') {
        return 回({
          ok: true,
          模型: 'mock-model',
          候选: [
            {
              id: 'cand-1',
              动作: '新增',
              type: 'preference',
              text: '喜欢喝冰美式',
              事实键: '饮品.咖啡',
              词: ['冰美式', '咖啡'],
              撞上: { id: 'm-global-1', text: '每天早上喝冰美式' },
              为什么: '与既有偏好高度一致',
              默认勾: true,
            },
          ],
        })
      }
      if (路径 === '/backfill/undo') return 回({ ok: true, 删了: 3, 恢复: 0 })
      if (路径 === '/facts/delete' || 路径 === '/delete') return 回({ ok: true })
      return 回({ ok: true })
    }

    return { 数据, 请求记录, fetch假 }
  }

  describe('UI 真实 DOM 渲染与交互测试（Batch 1）', () => {
    let dom
    let root
    let container
    let 原始环境
    let 错误收集

    const 刷异步 = async (轮 = 6) => {
      for (let i = 0; i < 轮; i++) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 10))
        })
      }
    }

    const 填输入 = async (el, 值) => {
      const 原型 = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(原型, 'value').set
      await act(async () => {
        setter.call(el, 值)
        el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
        el.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
      })
    }

    const 点 = async (node) => {
      assert.ok(node, '要点击的 DOM 节点不存在')
      await act(async () => {
        node.click()
      })
      await 刷异步()
    }

    const 找按钮 = (文本, 范围 = container) =>
      [...范围.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 文本)

    const 找精确元素 = (选择器, 精确字, 范围 = container) =>
      [...范围.querySelectorAll(选择器)].find((n) => (n.textContent || '').trim() === 精确字)

    const 找最深含字元素 = (选择器, 含字, 范围 = container) => {
      const 命中 = [...范围.querySelectorAll(选择器)].filter((n) => (n.textContent || '').includes(含字))
      return 命中[命中.length - 1]
    }

    before(() => {
      原始环境 = {
        window: globalThis.window,
        document: globalThis.document,
        HTMLElement: globalThis.HTMLElement,
        Node: globalThis.Node,
        Event: globalThis.Event,
        getComputedStyle: globalThis.getComputedStyle,
        fetch: globalThis.fetch,
        IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
        consoleError: console.error,
      }
    })

    const 挂载面板 = async (fetch假, 拦截弹窗 = true) => {
      if (root) {
        await act(async () => {
          root.unmount()
        })
      }
      dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
        url: 'http://127.0.0.1:3000/',
      })
      错误收集 = []
      globalThis.IS_REACT_ACT_ENVIRONMENT = true
      globalThis.window = dom.window
      globalThis.document = dom.window.document
      globalThis.HTMLElement = dom.window.HTMLElement
      globalThis.Node = dom.window.Node
      globalThis.Event = dom.window.Event
      globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
      globalThis.fetch = fetch假
      if (拦截弹窗) {
        dom.window.confirm = () => {
          throw new Error('不允许调用 window.confirm，应使用页内二次确认')
        }
        dom.window.alert = () => {
          throw new Error('不允许调用 window.alert')
        }
      }
      dom.window.addEventListener('error', (e) => {
        错误收集.push('window.error: ' + (e.message || e.error))
      })
      console.error = (...args) => {
        错误收集.push(args.map((a) => String(a)).join(' '))
      }

      let 面板渲染 = null
      const 假require = (id) => {
        if (id === 'react') return React
        return require(id)
      }
      const 客户端 = 装客户端(假require)
      客户端.apply({
        get(name) {
          if (name === 'slots') {
            return {
              inject(_slot, fn) {
                fn()
              },
              register(_meta, renderFn) {
                面板渲染 = renderFn
              },
            }
          }
          return undefined
        },
      })
      assert.equal(typeof 面板渲染, 'function', 'apply(ctx) 必须通过 slots.register 注册记忆面板')

      container = dom.window.document.getElementById('root')
      root = createRoot(container)
      await act(async () => {
        root.render(React.createElement(面板渲染))
      })
      await 刷异步()
      return { 面板渲染 }
    }

    after(async () => {
      if (root) {
        await act(async () => {
          root.unmount()
        })
      }
      Object.assign(globalThis, {
        window: 原始环境.window,
        document: 原始环境.document,
        HTMLElement: 原始环境.HTMLElement,
        Node: 原始环境.Node,
        Event: 原始环境.Event,
        getComputedStyle: 原始环境.getComputedStyle,
        fetch: 原始环境.fetch,
        IS_REACT_ACT_ENVIRONMENT: 原始环境.IS_REACT_ACT_ENVIRONMENT,
      })
      console.error = 原始环境.consoleError
    })

    test('1. 全页签与会话详情子页签渲染无白屏、无兜底报错、无 [object Object]/NaN', async () => {
      const { fetch假 } = 建测试夹具()
      await 挂载面板(fetch假)

      const 查干净 = (标签) => {
        const 全文 = container.textContent || ''
        assert.ok(全文.trim().length > 40, `页签「${标签}」渲染内容过少`)
        assert.ok(!全文.includes('这块出了点问题'), `页签「${标签}」触发了 ErrorBoundary 兜底：\n${全文}`)
        assert.ok(!全文.includes('[object Object]'), `页签「${标签}」把对象直接拼成了 [object Object]：\n${全文}`)
        assert.ok(!/\bNaN\b/.test(全文), `页签「${标签}」出现 NaN：\n${全文}`)
      }

      // 逐个切换顶部所有页签
      for (const tabName of ['记忆', '时间线', '会话', '回收站', '体检', '高级']) {
        const tabBtn = [...container.querySelectorAll('[role="tab"]')].find((b) => (b.textContent || '').trim() === tabName)
        assert.ok(tabBtn, `找不到顶部页签「${tabName}」`)
        await 点(tabBtn)
        查干净(tabName)
      }

      // 回到「会话」页签：切子页签「工作区记忆」再切回「会话」
      await 点([...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent.trim() === '会话'))
      await 点(找按钮('工作区记忆'))
      查干净('会话 -> 工作区记忆')
      assert.ok((container.textContent || '').includes('这个仓库走 npm test 跑单测'), '工作区记忆未渲染出来')

      const 子页签会话钮 = [...container.querySelectorAll('button')].find(
        (b) => b.getAttribute('role') !== 'tab' && (b.textContent || '').trim() === '会话',
      )
      await 点(子页签会话钮)
      // 点进「周末火锅与旅行计划」详情，并遍历 5 个子页签 + 展开记忆列表
      const 入口 = 找精确元素('div', '周末火锅与旅行计划')
      await 点(入口)
      查干净('会话详情(默认)')

      const 展开表头 = 找精确元素('div', '▸ 记忆列表')
      if (展开表头) await 点(展开表头)
      查干净('会话详情 -> 展开记忆列表')

      for (const subTab of ['记忆', '称呼', '导入记录', '召回记录', '补记']) {
        const btn = [...container.querySelectorAll('[aria-label="会话详情分区"] [role="tab"]')].find(
          (b) => (b.textContent || '').trim() === subTab,
        )
        assert.ok(btn, `会话详情缺少子页签「${subTab}」`)
        await 点(btn)
        查干净(`会话详情 -> ${subTab}`)
      }

      assert.deepEqual(错误收集, [], '渲染全过程不应产生 console.error 或未捕获异常：' + 错误收集.join('\n'))
    })

    test('2. 会话名字与出处字段准确渲染（防串名、防回退 ？、防未命名残留）', async () => {
      const { fetch假 } = 建测试夹具()
      await 挂载面板(fetch假)

      // ① 「记忆」页（/all）：三条作用域徽章 + 出处翻译
      const 记忆页文 = container.textContent || ''
      assert.ok(记忆页文.includes('指定会话 · 周末火锅与旅行计划'), '会话记忆必须显示对应会话标题，不能退回「？」或 raw id')
      assert.ok(!记忆页文.includes('指定会话 · ？'), '不应出现未解析的「指定会话 · ？）」')
      assert.ok(记忆页文.includes('全局记忆'), '全局记忆缺少徽章')
      assert.ok(记忆页文.includes('工作区记忆'), '工作区记忆缺少徽章')
      assert.ok(记忆页文.includes('经历提取'), '内部 source episode-extract 应显示为「经历提取」')
      assert.ok(!记忆页文.includes('episode-extract'), '不应把内部英文 source 直接吐给用户')

      // 验证悬停 title 带完整标题与会话 ID
      const 带标题徽章 = [...container.querySelectorAll('span')].find(
        (s) => (s.textContent || '').includes('指定会话 · 周末火锅与旅行计划'),
      )
      assert.equal(带标题徽章?.getAttribute('title'), '周末火锅与旅行计划（sess-1）')

      // 切作用域到「指定会话」验证下拉里展示会话名字
      await 点(找按钮('指定会话'))
      assert.ok((container.textContent || '').includes('周末火锅与旅行计划'), '指定会话筛选下拉应展示会话标题')

      // ② 「会话」页：列表显示、搜索过滤、详情头、分支来源名、无标题兜底与不串名
      await 点([...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent.trim() === '会话'))
      const 列表文 = container.textContent || ''
      assert.ok(列表文.includes('周末火锅与旅行计划'))
      assert.ok(列表文.includes('最初的设定讨论'))
      assert.ok(列表文.includes('sess-unnamed-1234567890a'), '无标题会话列表应截取前 24 位 ID 兜底显示')

      const 搜索框 = [...container.querySelectorAll('input')].find((i) => i.placeholder === '按会话名搜…')
      assert.ok(搜索框, '找不到会话搜索框')
      await 填输入(搜索框, '火锅')
      assert.ok((container.textContent || '').includes('筛出 1 个'), '搜索应筛出 1 个会话，实际文本：' + (container.textContent || '').slice(0, 200))
      assert.ok(!(container.textContent || '').includes('最初的设定讨论'), '未匹配的会话应被过滤')
      await 填输入(搜索框, '')

      // 点进 sess-1 详情：确认主标题与分支来源会话名（不是 parent raw id）
      await 点(找精确元素('div', '周末火锅与旅行计划'))
      const 详情文1 = container.textContent || ''
      assert.ok(详情文1.includes('周末火锅与旅行计划'))
      assert.ok(详情文1.includes('sess-1'))
      assert.ok(详情文1.includes('这个会话是从「最初的设定讨论」分支出来的'), '分支来源应显示父会话标题而非 raw id')

      // 返回列表，再点进无标题会话：确认显示兜底名，不残留上一会话名字
      await 点(找精确元素('div', '← 所有会话'))
      await 点(找精确元素('div', 'sess-unnamed-1234567890a'))
      const 详情文2 = container.textContent || ''
      assert.ok(详情文2.includes('（没起名字的会话）'), '无标题会话详情应显示「（没起名字的会话）」')
      assert.ok(!详情文2.includes('周末火锅与旅行计划'), '切进另一会话后不得残留上一个会话的名字')
    })

    test('3. 补记页签：未点开前不发请求、切换会话清状态、碰撞对象显示正文不吐 [object Object]、行内二次确认撤销', async () => {
      const { fetch假, 请求记录 } = 建测试夹具()
      await 挂载面板(fetch假)

      await 点([...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent.trim() === '会话'))
      await 点(找精确元素('div', '周末火锅与旅行计划'))

      // 点开详情但还没切「补记」时，绝不能触发 /backfill/sessions 同步扫描
      const 点前补记请求 = 请求记录.filter((r) => r.url.includes('/backfill/'))
      assert.equal(点前补记请求.length, 0, '未切到「补记」页签前不应发起补记请求')

      // 切到「补记」
      await 点([...container.querySelectorAll('[aria-label="会话详情分区"] [role="tab"]')].find((b) => b.textContent.trim() === '补记'))
      const 诊断请求 = 请求记录.filter((r) => r.url.includes('/backfill/sessions?'))
      assert.ok(诊断请求.some((r) => r.url.includes('当前=sess-1')), '切入补记页签应带当前会话拉取单会话诊断')
      assert.ok((container.textContent || '').includes('backfill-20261122-01'), '应显示当前会话的补记批次')
      assert.ok(!(container.textContent || '').includes('backfill-other-session'), '不得混入其它会话的补记批次')

      // 点击「试提取一下」：碰撞对象 { id, text } 必须渲染 text 而非 [object Object]
      await 点(找按钮('试提取一下'))
      const 预览文 = container.textContent || ''
      assert.ok(预览文.includes('跟这条像：每天早上喝冰美式'), 'c.撞上 对象应渲染其 text 字段')
      assert.ok(!预览文.includes('[object Object]'), '不得显示 [object Object]')

      // 行内二次确认撤销批次（window.confirm 若被调用已在夹具里抛错）
      const 撤销钮 = 找按钮('撤销')
      assert.ok(撤销钮, '缺少批次撤销按钮')
      await 点(撤销钮)
      assert.ok(找按钮('确定撤销'), '点撤销后应出现页内「确定撤销」按钮')
      assert.ok(找按钮('取消'), '点撤销后应出现页内「取消」按钮')
      await 点(找按钮('确定撤销'))
      assert.ok(
        请求记录.some((r) => r.method === 'POST' && r.url.includes('/backfill/undo')),
        '点「确定撤销」应调用 POST /backfill/undo',
      )

      // 切回列表打开 sess-parent（无归档不可补记）：旧预览必须清空，按钮禁用并展示诊断原因
      await 点(找精确元素('div', '← 所有会话'))
      await 点(找精确元素('div', '最初的设定讨论'))
      await 点([...container.querySelectorAll('[aria-label="会话详情分区"] [role="tab"]')].find((b) => b.textContent.trim() === '补记'))
      const 新页文 = container.textContent || ''
      assert.ok(!新页文.includes('跟这条像：每天早上喝冰美式'), '切换会话后上一会话的补记候选预览应被重置')
      assert.ok(新页文.includes('没有归档记录'), '不可补记会话应显示诊断原因')
      const 禁用提取 = 找按钮('试提取一下')
      assert.equal(禁用提取?.disabled, true, '归档不满足条件时提取按钮应处于 disabled 状态')
    })

    test('4. 样式、主题变量、选中态切换与防竖排布局属性校验', async () => {
      const { fetch假 } = 建测试夹具()
      await 挂载面板(fetch假)

      // ① 顶部页签 tabOn vs tabOff 样式切换
      const 记忆Tab = [...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent.trim() === '记忆')
      const 会话Tab = [...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent.trim() === '会话')
      assert.equal(记忆Tab.getAttribute('aria-selected'), 'true')
      assert.equal(会话Tab.getAttribute('aria-selected'), 'false')
      assert.equal(记忆Tab.style.fontWeight, '600', '选中页签应应用 tabOn 加粗样式')
      assert.match(会话Tab.style.background, /^(transparent|none)$/, '未选中页签应应用 tabOff 透明底')

      await 点(会话Tab)
      assert.equal(记忆Tab.getAttribute('aria-selected'), 'false')
      assert.equal(会话Tab.getAttribute('aria-selected'), 'true')
      assert.equal(会话Tab.style.fontWeight, '600', '切换后「会话」页签应切为 tabOn')
      assert.match(记忆Tab.style.background, /^(transparent|none)$/, '切换后「记忆」页签应切回 tabOff')

      // ② 会话开关按钮颜色区分（enabled vs disabled）
      const 开按钮 = 找按钮('● 开')
      const 关按钮 = 找按钮('○ 关')
      assert.ok(开按钮 && 关按钮, '应存在开启/关闭两种状态的会话按钮')
      assert.match(开按钮.style.color, /#8fd0a0|rgb\(143,\s*208,\s*160\)/, '开启按钮应高亮绿色')
      assert.equal(关按钮.style.color, 'inherit', '关闭按钮应使用 inherit')

      // ③ 会话行防竖排：flexWrap 必须为 wrap，防止右侧徽章挤扁左侧标题/正文
      const 会话行 = 找精确元素('div', '周末火锅与旅行计划')?.parentElement
      assert.equal(会话行?.style.flexWrap, 'wrap', '会话行必须带 flexWrap: wrap 防止正文竖排')

      // ④ 「记忆」页：已被取代划线样式、主题变量、行内删除二次确认（非 window.confirm）
      await 点(记忆Tab)
      const 记忆搜 = [...container.querySelectorAll('input')].find((i) => i.placeholder.includes('搜全部记忆'))
      assert.ok(记忆搜, '找不到记忆搜索框')
      assert.ok((记忆搜.getAttribute('style') || '').includes('--dsw-alias-'), '输入框边框应绑定 --dsw-alias-* 主题变量')

      // 切状态到「已被取代」检查划线样式
      const 取代筛选 = [...container.querySelectorAll('button')].find((b) => (b.textContent || '').startsWith('已被取代 '))
      await 点(取代筛选)
      const 旧记忆正文 = 找最深含字元素('div', '以前住在城西老房子')
      assert.equal(旧记忆正文?.style.textDecoration, 'line-through', '已被取代条目应有删除线样式')
      assert.equal(旧记忆正文?.style.opacity, '0.62', '已被取代条目应降低透明度')

      // 切回「活跃」，点 × 触发页内删除确认（点击「算了」不发起删除请求）
      const 活跃筛选 = [...container.querySelectorAll('button')].find((b) => (b.textContent || '').startsWith('活跃 '))
      await 点(活跃筛选)
      const 删钮 = container.querySelector('button[title="删这条"]')
      assert.ok(删钮, '缺少单条删除按钮 ×')
      await 点(删钮)
      assert.ok(找按钮('确定删'), '点 × 后应就地展开「确定删」确认条')
      await 点(找按钮('算了'))
      assert.equal(找按钮('确定删'), undefined, '点「算了」后确认条应收起')
    })

    test('5. 兜底 ErrorBoundary 真实生效 + 已构建产物 lib/client.js 可无错装载挂载', async () => {
      const { fetch假 } = 建测试夹具()
      // ① 验证 兜底 组件真能接住子组件渲染异常
      await 挂载面板(fetch假)
      // 通过构造坏接口（/all 返回 null）或直接在 __ModuleLoader__ 中验 兜底
      const 坏代码挂载 = async () => {
        const 坏fetch = async (url, init) => {
          if (String(url).includes('/all')) return { ok: true, json: async () => null }
          return fetch假(url, init)
        }
        await 挂载面板(坏fetch)
        assert.ok((container.textContent || '').includes('读不出来'), '接口返回异常数据时记忆页应优雅提示错误而非白屏')
      }
      await 坏代码挂载()

      // ② 加载实际构建输出 lib/client.js，确保 esbuild 单文件产物通过 __ModuleLoader__ 能正常注册和渲染
      const 产物路径 = join(仓库根, 'lib/client.js')
      assert.ok(existsSync(产物路径), 'lib/client.js 产物必须存在')
      const 产物源码 = readFileSync(产物路径, 'utf8')

      const bundleDom = new JSDOM('<!doctype html><html><body><div id="bundle-root"></div></body></html>', {
        url: 'http://127.0.0.1:3000/',
      })
      const 产物报错 = []
      globalThis.window = bundleDom.window
      globalThis.document = bundleDom.window.document
      globalThis.HTMLElement = bundleDom.window.HTMLElement
      globalThis.Node = bundleDom.window.Node
      globalThis.Event = bundleDom.window.Event
      globalThis.getComputedStyle = bundleDom.window.getComputedStyle.bind(bundleDom.window)
      globalThis.fetch = fetch假
      console.error = (...args) => 产物报错.push(args.join(' '))

      let 注册渲染 = null
      let 插件id = ''
      bundleDom.window.__ModuleLoader__ = {
        load(spec) {
          插件id = spec.id
          const mod = spec.factory((id) => {
            if (id === 'react') return React
            return require(id)
          })
          mod.apply({
            get(name) {
              if (name !== 'slots') return undefined
              return {
                inject(_s, fn) {
                  fn()
                },
                register(_meta, fn) {
                  注册渲染 = fn
                },
              }
            },
          })
        },
      }

      // 执行构建产物 IIFE
      new bundleDom.window.Function('window', 产物源码)(bundleDom.window)
      assert.equal(插件id, 'dsh-clay-memory', '产物注册插件 id 必须为 dsh-clay-memory')
      assert.equal(typeof 注册渲染, 'function', '产物 apply 后必须注册 settings.section 面板')

      const bundleRootEl = bundleDom.window.document.getElementById('bundle-root')
      const bundleReactRoot = createRoot(bundleRootEl)
      await act(async () => {
        bundleReactRoot.render(React.createElement(注册渲染))
      })
      await 刷异步()
      const 产物文本 = bundleRootEl.textContent || ''
      assert.ok(产物文本.includes('指定会话 · 周末火锅与旅行计划'), '构建产物挂载后应正常显示会话名称')
      assert.ok(!产物文本.includes('这块出了点问题'), '构建产物挂载不应触发兜底错误页')
      assert.deepEqual(产物报错, [], '构建产物挂载不应产生 console.error：' + 产物报错.join('\n'))

      await act(async () => {
        bundleReactRoot.unmount()
      })
    })
  })
}
