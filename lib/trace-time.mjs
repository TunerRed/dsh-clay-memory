// trace 行的时间戳解析。
//
// 两种口径并存：
//   - trace 行（*.traces.jsonl）里 `at` 是毫秒数字（Date.now()）
//   - 记忆条目里 `at` / `createdAt` 是 ISO 字符串
// 只写 `Date.parse(tr.at)` 时数字会得 NaN、被 `|| 0` 吞成 0，
// 于是整批 trace 都被「时间太早」跳过 —— 健康度页面永远显示 0 次。

export function trace时间(tr) {
  const v = tr && tr.at
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') return Date.parse(v) || 0
  return 0
}
