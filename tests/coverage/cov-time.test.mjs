import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 时间工具（lib/time.mjs）回归 —— 这个模块**零测试覆盖**，却是「时间观念」的地基。
// 要守住的不变量：
//   ① 时区**按本机自动认**，不写死北京（2026-09-21 换纽约/东京日期不变的修复）；
//   ② `hhmm` / `mmdd` **必须能接 ISO 字符串** —— 第一版写的是 `t + TZ_OFFSET` 数字加法，
//      而 `m.at` 是字符串 → 字符串拼接 → Invalid Date → 显示 `NaN:NaN`（2026-09-21 晚修）；
//   ③ 相对时间按**日历天**算，不是按过了多少小时（昨天 22:14 → 今天 12:08 只过 14 小时，
//      但那是「昨天」）；
//   ④ 空值 / 认不出来的时间要**老实说**，不能算成 1970；
//   ⑤ **跨年必须带年份** —— 不然「09-17」看不出是哪一年（用户反馈：过了一年怎么显示）；
//   ⑥ `当天中午` 按本地中午算，别把日子推偏；`日期合法` 用 UTC 正午校验，绝不跨日。
//
// ⚠ 断言全部**时区无关**：时间点一律用 `当天中午(y,mo,d)` 构造（它自己减了 TZ_OFFSET），
//   这样换任何时区跑，期望值都成立 —— 否则这套测试只有在北京能过。
// 这个文件不 import 任何宿主接口 → 不启动 DSH 也能跑。
const home = mkdtempSync(join(tmpdir(), 'fish-cov-time-'))
process.env.DSH_HOME = home
process.env.DSH_HOST_MODULES = join(home, 'no-host-modules')
process.env.APPDATA = join(home, 'empty-appdata')

const { TZ_OFFSET, dayKey, hhmm, mmdd, dayIndex, relTime, 当天中午, 日期合法 } =
  await import('../../lib/time.mjs')

// 本套测试的公共基准日：2026-11-15 本地中午
const 今 = 当天中午(2026, 11, 15)

test('时区：TZ_OFFSET 自动认本机，且是整分钟偏移（不写死 +8）', () => {
  assert.equal(typeof TZ_OFFSET, 'number')
  assert.ok(Number.isFinite(TZ_OFFSET), 'TZ_OFFSET 必须有限，写死或算错都会变 NaN')
  assert.equal(TZ_OFFSET % 60000, 0, '时区偏移按分钟算，出现秒级余数说明公式被改坏了')
  // 地球上的时区跨度约 UTC-12 ~ UTC+14
  assert.ok(Math.abs(TZ_OFFSET) <= 14 * 3600000, 'TZ_OFFSET 超出真实时区范围：' + TZ_OFFSET)
  // 关键：它是从 Date 反推的，不是常量 —— 跟本机 getTimezoneOffset 必须一致
  assert.equal(TZ_OFFSET, -new Date().getTimezoneOffset() * 60000 || 0, 'TZ_OFFSET 与本机时区不一致（被写死了？）')
})

test('dayKey：本地日历日，且「本地中午」不会跨日', () => {
  assert.equal(dayKey(今), '2026-11-15')
  assert.equal(dayKey(当天中午(2026, 1, 1)), '2026-01-01', '元旦这类边界日被推偏了')
  assert.equal(dayKey(当天中午(2026, 12, 31)), '2026-12-31', '年末被推偏了')
  // 同一天的不同时刻 → 同一个 dayKey（「每天最多记几条」要有明确定义）
  assert.equal(dayKey(今), dayKey(今 + 3600000), '同一天内挪一小时不该换日')
  assert.notEqual(dayKey(今), dayKey(今 + 86400000), '挪一整天必须换日')
})

test('hhmm / mmdd：必须能接 ISO **字符串**（不是只能接数字）', () => {
  // ⚠ 这条就是 2026-09-21 晚那个 `NaN:NaN` 的回归：t 传字符串时若走数字加法会拼接成非法日期
  const 串 = new Date(今).toISOString()
  assert.equal(typeof 串, 'string', '基准值本身要是字符串，否则这条测试等于没测')
  assert.match(hhmm(串), /^\d{2}:\d{2}$/, 'hhmm 收字符串后出了 NaN:NaN（数字加法 bug 回来了）')
  assert.match(mmdd(串), /^\d{2}-\d{2}$/, 'mmdd 收字符串后出了 NaN-NaN（数字加法 bug 回来了）')
  assert.ok(!hhmm(串).includes('NaN'), 'hhmm 结果里带 NaN')
  assert.ok(!mmdd(串).includes('NaN'), 'mmdd 结果里带 NaN')

  // 本地中午构造出来的时刻，本地读回来一定是 12:00 / 当月当日
  assert.equal(hhmm(今), '12:00', '当天中午造出来的点，本地读回来该是 12:00')
  assert.equal(mmdd(今), '11-15')
  // 个位数要补零（否则排序和显示都乱）
  assert.equal(mmdd(当天中午(2026, 3, 5)), '03-05', '月/日没补零')
  // 数字入参也照样能用（两种入参都要认）
  assert.equal(hhmm(今), hhmm(串), '数字与字符串两种入参结果必须一致')
})

test('dayIndex：按日历天递增，同一天内不变', () => {
  assert.equal(dayIndex(今), dayIndex(今 + 3600000), '同一天内 dayIndex 不该变')
  assert.equal(dayIndex(今 + 86400000) - dayIndex(今), 1, '隔天必须正好差 1')
  assert.equal(dayIndex(当天中午(2026, 11, 10)), dayIndex(今) - 5, '隔 5 天该差 5')
  assert.ok(Number.isFinite(dayIndex(今)))
})

test('relTime：空值 / 认不出来 → 老实说，不能算成 1970', () => {
  assert.equal(relTime(null, 今), '（没记时间）')
  assert.equal(relTime(undefined, 今), '（没记时间）')
  assert.equal(relTime('', 今), '（没记时间）')
  // 认不出来的字符串：dayIndex 会得到 NaN → 必须走「认不出来」这条，而不是显示成几十年前
  assert.equal(relTime('去年冬天', 今), '（时间认不出来）')
  assert.equal(relTime('not-a-date', 今), '（时间认不出来）')
  assert.ok(!relTime('去年冬天', 今).includes('NaN'), '认不出来的时间不该漏出 NaN')
  // ⚠ 反面：绝不能把无效值当成 epoch 0（1970）来显示
  assert.ok(!relTime('not-a-date', 今).includes('1970'), '无效时间被当成 1970 了')
})

test('relTime：今天 / 昨天 / 前天按日历天，不看过了几小时', () => {
  // 「昨天 22:14 → 今天 12:08 只过了 14 小时，但那是昨天」
  const 昨天晚 = 当天中午(2026, 11, 14) + 10 * 3600000 + 14 * 60000 // 22:14
  const 今天中午 = 今 // 12:08 用 12:00 近似，日差才是重点
  // ⭐ 1.12.63：近三天必须带日期 —— 只写「今天 13:06」时，
  //   回头去筛会话记录会分不清是哪个「今天」（2026-11-19 真翻车过）
  assert.equal(relTime(今, 今), '今天（11-15）12:00')
  assert.match(relTime(昨天晚, 今天中午), /^昨天（11-14）\d{2}:\d{2}$/, '只过 14 小时也该说「昨天」，说明用了小时差而不是日差')
  assert.equal(relTime(当天中午(2026, 11, 13), 今), '前天（11-13）12:00')
  // 未来时间（days <= 0）也归「今天」，不出现负数天前
  assert.equal(relTime(今 + 86400000, 今), '今天（11-16）12:00', '未来的点不该显示成负数天前')
})

test('relTime：14 天内带「N 天前」，60 天内月日在前', () => {
  assert.equal(relTime(当天中午(2026, 11, 10), 今), '5 天前（11-10）')
  assert.equal(relTime(当天中午(2026, 11, 1), 今), '14 天前（11-01）', '第 14 天还该走「N 天前」这一档')
  // 第 15 天起换格式：月日在前
  assert.equal(relTime(当天中午(2026, 10, 31), 今), '10-31（15 天前）')
  assert.equal(relTime(当天中午(2026, 9, 16), 今), '09-16（60 天前）', '第 60 天还该走「N 天前」这一档')
})

test('relTime：**跨年必须带年份**（去年 / N 年前）', () => {
  // 差 1 年 → 「去年 MM-DD」
  assert.equal(relTime(当天中午(2025, 12, 25), 当天中午(2026, 3, 1)), '去年 12-25')
  // 差 2 年及以上 → 带完整年份 + N 年前
  assert.equal(relTime(当天中午(2024, 12, 25), 当天中午(2026, 3, 1)), '2024-12-25（2 年前）')
  assert.equal(relTime(当天中午(2021, 6, 1), 当天中午(2026, 3, 1)), '2021-06-01（5 年前）')
  // ⚠ 反例守卫：跨年却只显示「09-17」是不行的 —— 用户看不出是哪一年
  const 跨年文案 = relTime(当天中午(2025, 9, 17), 当天中午(2026, 3, 1))
  assert.match(跨年文案, /去年|2025/, '跨年没带年份，用户看不出是哪一年：' + 跨年文案)
})

test('relTime：同年超过 60 天 → 按「N 个月前」，且不带年份', () => {
  const 文案 = relTime(当天中午(2026, 1, 10), 今)
  assert.equal(文案, '01-10（10 个月前）')
  assert.ok(!/20\d\d/.test(文案), '同年不该冒出四位年份，看着像跨年：' + 文案)
  // 3 个月 ≈ 90 天 → round(90/30)=3
  assert.equal(relTime(当天中午(2026, 8, 17), 今), '08-17（3 个月前）')
})

test('当天中午：本地中午反查回来日期不偏（跨时区也不偏）', () => {
  // 造出来的点，用本模块自己的 dayKey / mmdd 读回来必须还是那一天
  for (const [y, mo, d] of [[2026, 11, 15], [2026, 1, 1], [2026, 12, 31], [2024, 2, 29], [2026, 3, 1]]) {
    const t = 当天中午(y, mo, d)
    const 期望 = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    assert.equal(dayKey(t), 期望, `当天中午(${y},${mo},${d}) 被时区推偏了`)
    assert.equal(hhmm(t), '12:00', `当天中午(${y},${mo},${d}) 本地读回来不是中午`)
  }
})

test('日期合法：用 UTC 正午校验，不存在的日子一律 false', () => {
  assert.equal(日期合法(2026, 11, 15), true)
  assert.equal(日期合法(2024, 2, 29), true, '闰年 2/29 是存在的')
  assert.equal(日期合法(2026, 2, 29), false, '平年 2/29 不存在，必须挡住')
  assert.equal(日期合法(2026, 2, 30), false, '2/30 不存在')
  assert.equal(日期合法(2026, 4, 31), false, '4 月没有 31 号')
  assert.equal(日期合法(2026, 13, 1), false, '13 月不存在')
  assert.equal(日期合法(2026, 0, 1), false, '0 月不存在')
  assert.equal(日期合法(2026, 11, 0), false, '0 号不存在')
  assert.equal(日期合法(2100, 2, 29), false, '2100 不是闰年（能被 100 整除但不能被 400 整除）')
  assert.equal(日期合法(2000, 2, 29), true, '2000 是闰年（能被 400 整除）')
})
