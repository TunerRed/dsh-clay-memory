// ════════ 时间工具：dayKey / hhmm / mmdd / dayIndex / relTime ════════
// 2026-10-30 从 index.js 拆出（拆层工程第 3a 批）
// 依赖：无（只用 Date；时区按本机自动认，见 TZ_OFFSET 注释）
// ⭐⭐ 2026-09-21（反馈：「别人导入会踩什么坑」时改的）：**时区不能再写死北京** ✗
//   原来写死 +8。实测：换纽约、换东京，日期显示一模一样 ——
//   别人在别的时区，「今天 / 昨天」会差一天，跨年判断也会错 ✗
//   → 改成**自动认这台机器的时区**：在北京还是 +8，**对她零影响** ✓（实测过）
const TZ_OFFSET = -new Date().getTimezoneOffset() * 60000

// ---------- 时间 ----------

// 北京时间的一天（「每天最多记几条」要有明确定义）
function dayKey(t) {
  return new Date(t + TZ_OFFSET).toISOString().slice(0, 10)
}

function hhmm(t) {
  // ⚠ 2026-09-21 晚修：原来写的是 `new Date(t + TZ_OFFSET)` —— 那是**数字加法**的写法，
  //   而 t 传进来常常是 ISO **字符串**（m.at 就是字符串）→ 变成字符串拼接 → Invalid Date → NaN:NaN ✗
  const d = new Date(new Date(t).getTime() + TZ_OFFSET)
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0')
}

function mmdd(t) {
  const d = new Date(new Date(t).getTime() + TZ_OFFSET) // ⚠ 同上：要能接字符串
  return String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0')
}

// ⭐ 相对时间 —— 「时间观念」的核心
// ⭐ 相对时间 —— 按「日历天」算（北京时间），不是按过了多少小时 ✗
//    （昨天 22:14 到今天 12:08 只过了 14 小时，但那是「昨天」✓）
function dayIndex(t) {
  return Math.floor((new Date(t).getTime() + TZ_OFFSET) / 86400000)
}

function relTime(at, now) {
  // ⚠ 2026-09-21 晚补：空值 / 认不出来的时间，得老实说，不能算成 1970 ✗
  if (at === null || at === undefined || at === '') return '（没记时间）'
  const days = dayIndex(now) - dayIndex(at)
  if (!isFinite(days)) return '（时间认不出来）'
  if (days <= 0) return '今天 ' + hhmm(at)
  if (days === 1) return '昨天 ' + hhmm(at)
  if (days === 2) return '前天 ' + hhmm(at)
  if (days <= 14) return days + ' 天前（' + mmdd(at) + '）'
  if (days <= 60) return mmdd(at) + '（' + days + ' 天前）'
  // ⭐ 2026-09-21 晚：**跨年了就必须带年份** —— 不然「09-17」看不出是哪一年 ✗
  //   （反馈：的：「过了一年会怎么显示呢？我现在看没有年份，只有月份」）
  const 今年 = new Date(new Date(now).getTime() + TZ_OFFSET).getUTCFullYear()
  const 那年 = new Date(new Date(at).getTime() + TZ_OFFSET).getUTCFullYear()
  if (那年 !== 今年) {
    const 差 = 今年 - 那年
    if (差 === 1) return '去年 ' + mmdd(at)
    return 那年 + '-' + mmdd(at) + '（' + 差 + ' 年前）'
  }
  return mmdd(at) + '（' + Math.round(days / 30) + ' 个月前）'
}

// 「某年某月某日的中午」对应的 UTC 毫秒 —— 存日期用它，避免时区把日子推偏 ✓
//   ⚠ 原来写死 4 点（= 北京中午 12:00）。别人时区差得远时，存进去的日期会**差一天** ✗
//   → 按本地中午算：北京还是 4 点（12-8），纽约就是 17 点（12+5）✓
// 2026-10-31 从 llm.mjs 挪进来：names.mjs 的 抠日期 也要用它，
//   放 llm 会造成 names → llm → names 的循环依赖 ✗；时间工具本来就该在这一层。
const 当天中午 = (y, mo, d) => Date.UTC(y, mo - 1, d, 12, 0, 0) - TZ_OFFSET

// 「这天真的存在吗」—— 用 **UTC 正午**校验，绝不会跨日 ✓
//   ⚠ 不能拿「本地中午」去校验：UTC+13 的话本地中午是前一天 23:00 UTC，
//     读 UTC 日期就变成前一天，校验会**误判成不合法** ✗
const 日期合法 = (y, mo, d) => {
  const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

export { TZ_OFFSET, dayKey, hhmm, mmdd, dayIndex, relTime, 当天中午, 日期合法 }
