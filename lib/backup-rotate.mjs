// lib/backup-rotate.mjs —— 每日备份的轮换清理（2026-10-30 D 阶段）
//
// 审查 D-11：备份要「按备份自身时间」清理 + 至少保留 N 份 + 清理前校验可解析。
//
// 旧实现只按「目录个数」留 14 个：一个月没写的话，留下的全是陈年备份，
// 最近 14 天反而一份都没有 —— 清理的不是「过期的」，是「数量超的」。✗
//
// 正确语义：
//   1. 按目录名里的日期（备份自身时间）判断新鲜度，只砍「真的过期」的；
//   2. 新鲜份数不足 至少份数 时保底留最近 N 份（宁留陈年，不删光）；
//   3. 真要砍之前，先把「将保留的」全部 JSON.parse 校验一遍，
//      有坏的就不砍 —— 宁可不清，也别把最后能读的那几份砍没了。

import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// 'YYYY-MM-DD' ± 天 → 'YYYY-MM-DD'（UTC 算，只跟字符串日期打交道）
export function 日期加减(日期, 天) {
  const t = new Date(日期 + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() + 天)
  return t.toISOString().slice(0, 10)
}

/**
 * 清理每日备份目录。
 * @param {string} 备份目录 BACKUP_DIR（下面一层是 YYYY-MM-DD 目录）
 * @param {string} 今天 'YYYY-MM-DD'
 * @param {{保留天数?:number, 至少份数?:number}} 选项
 * @returns {{砍了:number, 保留:number, 跳过:string}} 跳过非空 = 这次没砍（含原因）
 */
export function 清理旧备份(备份目录, 今天, { 保留天数 = 14, 至少份数 = 7 } = {}) {
  const days = readdirSync(备份目录)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
  if (!days.length) return { 砍了: 0, 保留: 0, 跳过: '' }

  // ① 按备份自身时间（目录日期）判断过期：今天 - (保留天数 - 1) 起才算新鲜
  const 边界 = 日期加减(今天, -(保留天数 - 1))
  const 新鲜的 = days.filter((d) => d >= 边界)

  // ② 新鲜不足 至少份数 时，保底留最近 N 个目录（哪怕都过期）
  const 保留 =
    新鲜的.length >= 至少份数
      ? 新鲜的
      : days.slice(Math.max(0, days.length - 至少份数))
  const 砍 = days.filter((d) => !保留.includes(d))
  if (!砍.length) return { 砍了: 0, 保留: 保留.length, 跳过: '' }

  // ③ 清理前校验「将保留的」可解析：有坏的这次不砍，diag 留痕等人来看
  const 坏 = []
  for (const d of 保留) {
    for (const f of readdirSync(join(备份目录, d))) {
      if (!f.endsWith('.json')) continue
      try {
        JSON.parse(readFileSync(join(备份目录, d, f), 'utf8'))
      } catch (e) {
        坏.push(d + '/' + f)
      }
    }
  }
  if (坏.length) {
    return { 砍了: 0, 保留: 保留.length, 跳过: '保留备份有不可解析文件：' + 坏.join(', ') }
  }

  for (const d of 砍) {
    try {
      rmSync(join(备份目录, d), { recursive: true, force: true })
    } catch (e) {}
  }
  return { 砍了: 砍.length, 保留: 保留.length, 跳过: '' }
}
