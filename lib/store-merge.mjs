// 纯合并逻辑：不访问磁盘、宿主或模型，便于复现后台旧快照与删除交错。
export function 合并库(盘, 写, 选项 = {}) {
  const 更新时间 = (m) => Math.max(
    Date.parse(m.editedAt || 0) || 0,
    Date.parse(m.relatedAt || 0) || 0,
    Date.parse(m.reinforcedAt || 0) || 0,
    Date.parse(m.deletedAt || 0) || 0,
    Date.parse(m.createdAt || 0) || 0,
  )
  // ⭐ B 阶段（2026-10-30）：提炼 / 洗键 / 补类型 / 别记 这些批量状态**不更新 editedAt**，
  //   两边拿旧快照交错写时「谁时间新」判不出来 —— A 刚提炼完的成果会被 B 的旧快照整条盖掉。
  //   所以选中胜者后，把败者有的状态字段逐个补上（胜者缺才补，绝不覆盖胜者已有的）。
  //   ⚠ 已知限制：`delete` 式的撤销（比如撤销「别记」）可能被旧快照补回 ——
  //     胜者没有该字段时无法区分「从来没设过」和「刚撤销」，保守取「补」，
  //     撤销失效只影响极少数交错场景，重新撤一次即可。
  const 状态字段 = [
    'refinedAt', 'refineTries', 'refineSkip', 'refineFailed',
    'expandTries', 'expandSkip', 'expandFailed', 'textBefore',
    '事实键', '键来源', '洗键过',
    'type', 'typeChecked', 'stableChecked',
    '别记',
  ]
  // ⚠ 2026-10-31（清字段）：上一条限制在「重判 / 撤销」这类**故意删字段**的写入里是必然踩中的
  //   ——内存里删掉了，合并时又被盘上旧值补回来，清标记等于没清（真机撞过：/backfill-stable
  //   重判清不掉 stableChecked，重判筛出来的永远是「本来就没标记」的那批）。
  //   调用方用 选项.清字段 显式声明「这些字段是我这次主动删的」，本趟不补；
  //   其余字段仍按原语义「胜者缺才补」，交错写的保护不变。
  const 清字段集合 = new Set(Array.isArray(选项?.清字段) ? 选项.清字段.map(String) : [])
  const 补状态 = (胜, 败) => {
    if (!败 || 胜 === 败) return 胜
    let 已拷 = false
    for (const f of 状态字段) {
      if (清字段集合.has(f)) continue
      if (败[f] !== undefined && 胜[f] === undefined) {
        // 真要补才浅拷贝 —— 不补时零 mutate，保住「不污染输入」的纯函数性质
        if (!已拷) { 胜 = { ...胜 }; 已拷 = true }
        胜[f] = 败[f]
      }
    }
    return 胜
  }
  const 写记 = new Map((写.memories || []).map((m) => [String(m.id), m]))
  const 合记 = new Map((盘.memories || []).map((m) => [String(m.id), m]))
  for (const [id, m] of 写记) {
    const 旧 = 合记.get(id)
    合记.set(id, !旧 || 更新时间(m) >= 更新时间(旧) ? 补状态(m, 旧) : 补状态(旧, m))
  }
  const 删们 = new Map((盘.deleted || []).map((m) => [String(m.id), m]))
  for (const m of 写.deleted || []) 删们.set(String(m.id), m)
  // 内存里仍有一条，不等于用户要求找回。只有同步找回入口显式列出的 id 能撤销删除。
  const 找回 = Array.isArray(选项?.restoreIds) ? 选项.restoreIds : []
  // GPT 整改 P1（restoreIds 并发删除冲突）：调用方传「我读盘的时刻」——
  //   盘上墓碑比它还新 = 别处刚删的，旧快照不得把它复活（原架构师审查 #8 的根治方案）。
  const 读盘于 = typeof 选项?.读盘于 === 'string' ? 选项.读盘于 : ''
  for (const value of 找回) {
    const id = String(value)
    if (!写记.has(id)) continue
    const 盘坟 = 删们.get(id)
    if (读盘于 && 盘坟 && 盘坟.deletedAt && String(盘坟.deletedAt) > 读盘于) continue
    删们.delete(id)
  }
  const memories = [...合记.values()].filter((m) => !删们.has(String(m.id)))
  const 记录表 = new Map()
  const 键 = (t) => String(t && t.at) + '|' + String((t && t.query) || '').slice(0, 80)
  for (const t of 写.traces || []) 记录表.set(键(t), t)
  for (const t of 盘.traces || []) if (!记录表.has(键(t))) 记录表.set(键(t), t)
  const traces = [...记录表.values()].sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-100)
  return { version: 2, policy: 写.policy || 盘.policy, memories, traces, deleted: [...删们.values()] }
}
