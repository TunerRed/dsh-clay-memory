import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 1.12.64 经历/梗的两处「接线」回归：
//   ① 分层器：category:'event' + scope:'global' 必须进全局事实库
//      —— 否则梗留在会话库里，换个会话就真断了（这正是要治的病）；
//   ② 召回器：带 expireAt 的条目过期后不再注入（「这周在出差」三周后还冒出来最丢人）。
const home = mkdtempSync(join(tmpdir(), 'fish-ep-store-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')

const { loadCfg } = await import('../lib/cfg.mjs')
const names = await import('../lib/names.mjs')
names.接读配置(loadCfg)
const { loadStore, saveStore } = await import('../lib/store-core.mjs')
const { factPath } = await import('../lib/paths.mjs')
const { recall } = await import('../lib/scoring.mjs')

mkdirSync(join(home, 'clay-memory'), { recursive: true })

test('分层：event + scope:global 落进全局事实库（跨会话可见）', () => {
  const d = loadStore('S1')
  d.memories.push({
    id: 'ep1',
    text: '主人把疯狂星期四当成只属于我俩的梗',
    category: 'event',
    scope: 'global',
    episode: 'meme',
    importance: 0.7,
    createdAt: new Date().toISOString(),
  })
  // 对照组：普通 event 不带 scope —— 应该留在会话库
  d.memories.push({
    id: 'ep2',
    text: '这条是会话级的碎片',
    category: 'event',
    importance: 0.5,
    createdAt: new Date().toISOString(),
  })
  saveStore('S1', d)

  const facts = JSON.parse(readFileSync(factPath(), 'utf8'))
  const ids = (facts.memories || []).map((m) => m.id)
  assert.ok(ids.includes('ep1'), 'scope:global 的经历该进 _facts.json')
  assert.ok(!ids.includes('ep2'), '没标 scope 的 event 该留在会话库')

  // 换个会话也读得到 —— 这才是「跨会话」的意思
  const 别的会话 = loadStore('S2')
  assert.ok(别的会话.memories.some((m) => m.id === 'ep1'), '另一个会话加载时能看到这条梗')
})

test('召回：过期条目不再注入，没过期的照常', () => {
  const now = Date.parse('2026-12-01T12:00:00Z')
  const data = {
    policy: { threshold: 0, queryGate: 0, maxItems: 10, factsMax: 0 },
    memories: [
      {
        id: 'old',
        text: '主人这周要坐飞机出差去上线',
        category: 'event',
        scope: 'global',
        episode: 'state',
        importance: 0.6,
        at: '2026-11-01T00:00:00Z',
        createdAt: '2026-11-01T00:00:00Z',
        expireAt: '2026-11-15T00:00:00Z', // 已经过期
      },
      {
        id: 'live',
        text: '主人在调 ComfyUI 出图参数',
        category: 'event',
        scope: 'global',
        episode: 'state',
        importance: 0.6,
        at: '2026-11-28T00:00:00Z',
        createdAt: '2026-11-28T00:00:00Z',
        expireAt: '2026-12-12T00:00:00Z', // 还没过期
      },
    ],
  }
  const r = recall(data, '出差 上线 ComfyUI 参数', now, null, null)
  const ids = (r.selected || []).map((x) => (x.m && x.m.id) || x.id)
  assert.ok(ids.includes('live'), '没过期的该被召回')
  assert.ok(!ids.includes('old'), '过期的不该再当「现在」注入')
})
