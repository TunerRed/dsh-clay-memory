// tests/backup-rotate.test.mjs —— D-11：每日备份按自身时间清理 + 保底 N 份 + 清理前校验（2026-10-30）
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 清理旧备份, 日期加减 } from '../lib/backup-rotate.mjs'

function 造目录(名们, 坏名) {
  const dir = mkdtempSync(join(tmpdir(), 'bak-'))
  for (const 名 of 名们) {
    const d = join(dir, 名)
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'session-xx.json'), 坏名 === 名 ? '{坏了' : '{"memories":[]}')
  }
  return dir
}

test('日期加减：跨月跨年正确', () => {
  assert.equal(日期加减('2026-10-30', -13), '2026-10-17')
  assert.equal(日期加减('2026-01-02', -3), '2025-12-30')
  assert.equal(日期加减('2026-03-01', -1), '2026-02-28')
})

test('按自身时间清理：只砍真的过期目录，新鲜的全留', () => {
  // 今天 2026-10-30，保留 14 天 → 边界 10-17。新鲜 8 份（>= 至少份数 7），
  // 走「只砍过期」分支：10-01、10-05 过期被砍，10-17 起的全留。
  const 名们 = ['2026-10-01', '2026-10-05', '2026-10-17', '2026-10-18', '2026-10-20', '2026-10-22', '2026-10-24', '2026-10-26', '2026-10-28', '2026-10-30']
  const dir = 造目录(名们)
  const r = 清理旧备份(dir, '2026-10-30', {})
  assert.equal(r.砍了, 2)
  assert.deepEqual(readdirSync(dir).sort(), 名们.slice(2))
  rmSync(dir, { recursive: true, force: true })
})

test('至少保留 N 份：长期没写也不删光，保底留最近 N 个', () => {
  // 全部过期（都是 9 月的），但至少份数默认 7 → 留最近 7 个
  const 老名 = ['2026-09-01', '2026-09-05', '2026-09-08', '2026-09-11', '2026-09-15', '2026-09-19', '2026-09-22', '2026-09-26', '2026-09-29']
  const dir = 造目录(老名)
  const r = 清理旧备份(dir, '2026-10-30', {})
  assert.equal(r.砍了, 2)
  assert.deepEqual(readdirSync(dir).sort(), 老名.slice(2))
  rmSync(dir, { recursive: true, force: true })
})

test('新鲜不足 N 份时：过期的不砍，直到攒够 N 份（或全新鲜）', () => {
  const dir = 造目录(['2026-09-29', '2026-10-01', '2026-10-20']) // 新鲜只有 1 份，不足 7
  const r = 清理旧备份(dir, '2026-10-30', {})
  assert.equal(r.砍了, 0) // 全留：一共 3 份 < 7，一份都不能砍
  assert.equal(readdirSync(dir).length, 3)
  rmSync(dir, { recursive: true, force: true })
})

test('清理前校验：保留的里有坏文件 → 这次不砍，跳过原因带回', () => {
  // 2 个过期会被砍，但保留区（新鲜的 8 份）里 10-30 是坏文件 → 校验不过，一个不砍
  const 名们 = ['2026-10-01', '2026-10-05', '2026-10-17', '2026-10-18', '2026-10-20', '2026-10-22', '2026-10-24', '2026-10-26', '2026-10-28', '2026-10-30']
  const dir = 造目录(名们, '2026-10-30')
  const r = 清理旧备份(dir, '2026-10-30', {})
  assert.equal(r.砍了, 0)
  assert.ok(r.跳过.includes('不可解析'))
  assert.ok(r.跳过.includes('2026-10-30'))
  assert.equal(readdirSync(dir).length, 名们.length) // 一个没砍
  rmSync(dir, { recursive: true, force: true })
})

test('全部新鲜：什么都不砍，也不报跳过', () => {
  const dir = 造目录(['2026-10-28', '2026-10-30'])
  const r = 清理旧备份(dir, '2026-10-30', {})
  assert.equal(r.砍了, 0)
  assert.equal(r.跳过, '')
  rmSync(dir, { recursive: true, force: true })
})

test('选项可调：保留天数 / 至少份数', () => {
  const dir = 造目录(['2026-10-20', '2026-10-24', '2026-10-26', '2026-10-28', '2026-10-30'])
  const r = 清理旧备份(dir, '2026-10-30', { 保留天数: 7, 至少份数: 2 }) // 边界 10-24
  assert.equal(r.砍了, 1)
  assert.deepEqual(readdirSync(dir).sort(), ['2026-10-24', '2026-10-26', '2026-10-28', '2026-10-30'])
  rmSync(dir, { recursive: true, force: true })
})
