// 会话详情 · 批量维护操作（补日期 / 补标不淡 / 清洗补键 / 查重合并 / 批量删改回）
export function 造批量维护动作(ctx) {
  const { post, load, s, 没键的, 补标进度, 洗键进度, 选中, set选中, 选中清, set选中清, setBusy, setConfirm, setNotes, set批回问, set批清问, set批删问, set看记忆, 查重, set查重, 查重选, set查重选, 查重合, set查重合, set查重开 } = ctx

  const 补日期 = () => {
    setConfirm(null)
    setBusy(true)
    post('/backfill-dates', { session: s.id })
      .then((r) => {
        setBusy(false)
        setNotes([
          r && r.补了
            ? '补了 ' + r.补了 + ' 条日期' + (r.猜的 ? '（其中 ' + r.猜的 + ' 条年份是按最近的算的）' : '') + '，还有 ' + r.还是没 + ' 条正文里真没写日期'
            : '没有能补的 —— 正文里找不到日期',
        ])
        load()
      })
      .catch((e) => {
        setBusy(false)
        setNotes(['补日期失败：' + ((e && e.message) || e)])
      })
  }

  const 补不淡 = (重判) => {
    setConfirm(null)
    setBusy(true)
    let 累计判 = 0
    let 累计升 = 0
    let 累计降 = 0
    let 连着失败 = 0
    let 连着空 = 0
    let 头一趟 = true
    补标进度.在跑 = true
    补标进度.重判 = !!重判
    补标进度.已 = 0
    补标进度.总 = (s.memories || []).length
    补标进度.等 = 0
    const 跑 = () => {
      // ⚠ 重判：只在**第一趟**带这个参数（服务端会把所有「判过」标记清掉再从头判）
      const 体 = { session: s.id, 每批: 20 }
      if (重判 && 头一趟) 体.重判 = true
      头一趟 = false
      post('/backfill-stable', 体)
        .then((r) => {
          if (!r || !r.ok) {
            // ⚠⚠ 2026-09-22（反馈：跑到一半「模型报错：429 status code (no body)」）：
            //   限流是**暂时的**，不该直接放弃 —— 等一等再试同一批 ✓
            //   指数退避：5s → 10s → 20s → 40s → 60s，最多 6 次
            const 是限流 = /429|rate.?limit|too many|限流|超限/i.test(String((r && r.message) || ''))
            if (是限流 && 连着失败 < 6) {
              连着失败++
              const 等 = Math.min(60000, 5000 * Math.pow(2, 连着失败 - 1))
              补标进度.等 = Math.round(等 / 1000)
              setNotes([
                '⚠ 模型那边限流了（429），等 ' + Math.round(等 / 1000) + ' 秒再试…（第 ' + 连着失败 + ' 次）',
                '已经判好的都存下来了，不用重头来 ✓',
              ])
              setTimeout(跑, 等)
              return
            }
            补标进度.在跑 = false
            setBusy(false)
            setNotes([
              '补标失败：' + ((r && r.message) || '？'),
              '已经判好的都存下来了 —— 再点一次会接着跑，不会重头来 ✓',
            ])
            return
          }
          连着失败 = 0
          补标进度.等 = 0
          累计判 += r.判了 || 0
          累计升 += r.改成不淡 || 0
          累计降 += r.降成会淡 || 0
          补标进度.已 = 累计判
          if (r.共) 补标进度.总 = r.共
          // ⚠⚠ 2026-09-22 修（反馈「他就卡着判着呢」）：
          //   原来这里判「完了没」用的是 `判了 > 0` ——
          //   **一批回 0 条（模型没回东西）就被当成「判完了」直接停** ✗
          //   日志实锤：07:09:21「判了 0 条，还剩 665」之后就没动静了
          //   → 改成看**服务端的 done**；一批回 0 就**接着试下一批** ✓
          //     连着 3 批都空才停（说明模型那边真出问题了），并说清楚
          连着空 = (r.判了 || 0) === 0 ? 连着空 + 1 : 0
          setNotes([
            '正在判… 已判 ' + 累计判 + ' 条：' + 累计升 + ' 条标成「永远不淡」、' +
              累计降 + ' 条改成会淡' + (r.done ? '' : '，还剩 ' + r.剩 + ' 条') +
              (r.判了 === 0 && !r.done ? '　（这批模型没回东西，再试一批）' : ''),
          ])
          // ⚠ 每批之间**慢一点** —— 300ms 太急，容易撞限流（反馈就是 429 挂的）
          if (!r.done) {
            if (连着空 >= 3) {
              补标进度.在跑 = false
              setBusy(false)
              setNotes([
                '⚠ 连着 3 批模型都没回东西，先停了（还剩 ' + r.剩 + ' 条）。',
                '已经判好的都存下来了 —— 再点一次会接着跑，不会重头来 ✓',
              ])
              return
            }
            setTimeout(跑, 1500)
          } else {
            补标进度.在跑 = false
            setBusy(false)
            setNotes([
              '✓ 判完了：看了 ' + 累计判 + ' 条 —— ' + 累计升 + ' 条标成「永远不淡」，' +
                累计降 + ' 条从「永远不淡」改成会淡',
              '（这一趟把所有还没判过的都过了一遍：该升的升、该降的降）',
            ])
            load()
          }
        })
        .catch((e) => {
          补标进度.在跑 = false
          setBusy(false)
          setNotes(['补标失败：' + ((e && e.message) || e), '已经判好的都存下来了 —— 再点一次会接着跑 ✓'])
        })
    }
    跑()
  }

  const 洗键 = (干跑) => {
    setConfirm(null)
    setBusy(true)
    let 累计洗 = 0
    let 累计给 = 0
    let 累计空 = 0
    let 累计废 = 0
    let 连着失败 = 0
    let 连着空 = 0
    洗键进度.在跑 = true
    洗键进度.干跑 = !!干跑
    洗键进度.已 = 0
    洗键进度.总 = 没键的
    const 跑 = () => {
      // ⚠ 干跑：只跑**一批**就停 —— 让她看几个例子再决定，
      //   不许拿几百次模型调用去"试" ✗
      const 体 = { session: s.id, 每批: 8, 干跑: !!干跑 }
      post('/wash-keys', 体)
        .then((r) => {
          if (!r || !r.ok) {
            const 是限流 = /429|rate.?limit|too many|限流|超限/i.test(String((r && r.message) || ''))
            if (是限流 && 连着失败 < 6) {
              连着失败++
              const 等 = Math.min(60000, 5000 * Math.pow(2, 连着失败 - 1))
              setNotes([
                '⚠ 模型那边限流了（429），等 ' + Math.round(等 / 1000) + ' 秒再试…（第 ' + 连着失败 + ' 次）',
                '已经补好的都存下来了，不用重头来 ✓',
              ])
              setTimeout(跑, 等)
              return
            }
            洗键进度.在跑 = false
            setBusy(false)
            setNotes([
              '清洗失败：' + ((r && r.message) || '？'),
              '已经补好的都存下来了 —— 再点一次会接着跑，不会重头来 ✓',
            ])
            return
          }
          连着失败 = 0
          累计洗 += r.洗了 || 0
          累计给 += r.给了键 || 0
          累计空 += r.留空 || 0
          累计废 += r.作废了 || 0
          洗键进度.已 = 累计洗
          if (r.总数) 洗键进度.总 = 没键的
          // ⚠⚠ 「模型整批没回出东西」才算失败，**不许拿「给了键 === 0」当信号** ✗
          //   模型正常地把一批全判成留空时，给了键也是 0 ——
          //   原来按那个数，连着 3 批就误报「模型没回出键」停下来（实测踩到过）
          连着空 = (r.没回出东西 || 0) >= (r.洗了 || 0) ? 连着空 + 1 : 0
          if (干跑) {
            // 干跑：把几个例子摆出来，让她看一眼标得对不对 ✓
            洗键进度.在跑 = false
            setBusy(false)
            const 例 = (r.示例 || []).map((x) => '　「' + x.键 + '」　←　' + x.正文)
            setNotes(
              [
                '先试了 ' + (r.洗了 || 0) + ' 条（一个字都没改）：标了 ' + (r.给了键 || 0) + ' 条、说不用标 ' + (r.留空 || 0) + ' 条',
                '它标出来是这样的（左边是「这条讲的是哪件事」，右边是记忆本身）：',
              ]
                .concat(例.length ? 例 : ['　（这批它都说不用标）'])
                .concat(['', '看着行就点「全部开始」；不行就先别动 —— 这一步不做也不影响别的 ✓']),
            )
            return
          }
          setNotes([
            '正在认… 已过 ' + 累计洗 + ' 条：标了 ' + 累计给 + ' 条、说不用标 ' + 累计空 + ' 条' +
              (累计废 ? '、顺手收起来 ' + 累计废 + ' 条' : '') +
              (r.done ? '' : '，还剩 ' + r.剩 + ' 条'),
          ])
          if (!r.done) {
            if (连着空 >= 3) {
              洗键进度.在跑 = false
              setBusy(false)
              setNotes([
                '⚠ 连着 3 批模型一个字都没回，先停了（还剩 ' + r.剩 + ' 条）。',
                '已经标好的都存下来了 —— 再点一次会接着跑 ✓',
                '（要是它只是说「这批都不用标」，那不算出错、会自己往下走）',
              ])
              return
            }
            setTimeout(跑, 1500)
          } else {
            洗键进度.在跑 = false
            setBusy(false)
            setNotes([
              '✓ 跑完了：过了 ' + 累计洗 + ' 条 —— 标了 ' + 累计给 + ' 条、说不用标 ' + 累计空 + ' 条' +
                (累计废 ? '，其中 ' + 累计废 + ' 条因为「讲的是同一件事」被收起来了（还留着、能恢复）' : ''),
              '说不用标的那批一个字都没动 ✓（要退回来就点「撤掉这次标的」）',
            ])
            load()
          }
        })
        .catch((e) => {
          洗键进度.在跑 = false
          setBusy(false)
          setNotes(['跑失败了：' + ((e && e.message) || e), '已经标好的都存下来了 —— 再点一次会接着跑 ✓'])
        })
    }
    跑()
  }
  
  // 整份撤回（把这次自动标的全撤掉、顺手收起来的全放回来）✓
  const 撤销洗键 = () => {
    setConfirm(null)
    setBusy(true)
    post('/wash-keys/undo', { session: s.id })
      .then((r) => {
        setBusy(false)
        if (!r || !r.ok) {
          setNotes(['撤回失败：' + ((r && r.message) || '？')])
          return
        }
        setNotes([
          '✓ 撤完了：撤掉 ' + (r.摘了 || 0) + ' 条自动标的、放回来 ' + (r.恢复 || 0) + ' 条被收起来的',
          '（你自己填的那些没动 —— 这个按钮只管自动标的）',
        ])
        load()
      })
      .catch((e) => {
        setBusy(false)
        setNotes(['撤回失败：' + ((e && e.message) || e)])
      })
  }
  
  // ⭐ 2026-09-22（反馈「回收站还没有批量删除，就批量清空」）：
  //   「已删掉的」那一栏补一个**批量清掉** ✓
  //   ⚠ 这个是**真销毁**（不是收起来）→ 界面必须问两遍 ✓
  // ⭐⭐ 2026-09-23（反馈：「那这里没有批量找回呀」）：
  //   「已删掉的」原来只有**批量清掉**，想全捞回来只能一条条点「找回来」✗
  //   → 补一个**批量找回**（勾了哪几条就捞哪几条）
  //   ⚠ `只合并` = 只捞「合并掉的」那批 —— 等于**一键撤销整次合并** ✓
  //   ⚠ 这个**不是销毁**，是往回捞，所以不用问两遍；但界面上还是先说一句捞几条
  const 批回 = (会话, 只合并) => {
    const ids = 只合并 ? [] : Object.keys(选中清).filter((k) => 选中清[k])
    if (!只合并 && !ids.length) {
      set批回问(false)
      return
    }
    setBusy(true)
    post('/delete', Object.assign({ session: 会话.id, action: 'restorebatch', ids: ids }, 只合并 ? { 只找回合并掉的: true } : {}))
      .then((r) => {
        setBusy(false)
        set批回问(false)
        if (!r || !r.ok) {
          setNotes(['批量找回失败：' + ((r && r.message) || '？')])
          return
        }
        set选中清({})
        setNotes(['✓ ' + r.message + '（「已删」里还剩 ' + r.剩 + ' 条）'])
        load()
      })
      .catch((e) => {
        setBusy(false)
        setNotes(['批量找回失败：' + ((e && e.message) || e)])
      })
  }
  const 批清 = (会话) => {
    const ids = Object.keys(选中清).filter((k) => 选中清[k])
    if (!ids.length) {
      set批清问(false)
      return
    }
    setBusy(true)
    post('/delete', { session: 会话.id, action: 'purgebatch', ids: ids })
      .then((r) => {
        setBusy(false)
        set批清问(false)
        if (!r || !r.ok) {
          setNotes(['批量清掉失败：' + ((r && r.message) || '？')])
          return
        }
        set选中清({})
        setNotes(['✓ ' + r.message + '（「已删」里还剩 ' + r.剩 + ' 条）'])
        load()
      })
      .catch((e) => {
        setBusy(false)
        setNotes(['批量清掉失败：' + ((e && e.message) || e)])
      })
  }
  
  // ⭐⭐ 2026-09-22（反馈：「查重我们是不是还没做啊？我怎么没有找到按钮」）：
  //   去重一直有，但都是**自动**的 —— 召回时（注入前只留一条）、导入时。
  //   **库里已经存着的重复没人管** ✗
  //   ⚠ 不能一键全合：「汇总+明细」那种一长一短，合了会丢信息
  //     → 真重复给「一键合」，汇总+明细只列出来让她自己挑 ✓
  const 去查重 = (会话) => {
    setBusy(true)
    // ⚠⚠ 面板在**记忆列表那一块里**（跟「补标不淡」的确认框一样），
    //   列表默认是折叠的 —— 不展开就看不见面板 ✗
    //   → 点查重时**顺手把列表展开** ✓（按钮本身在标题行，永远看得见）
    set看记忆(true)
    post('/duplicates', { session: 会话.id })
      .then((r) => {
        setBusy(false)
        if (!r || !r.ok) {
          setNotes(['查重失败：' + ((r && r.message) || '？')])
          return
        }
        const 选 = {}
        const 勾 = {}
        ;(r.组 || []).forEach((g, i) => {
          // 默认留**最长**的那条 —— 「汇总+明细」时长的信息更全，别默认留短的 ✗
          选[i] = g.条们.reduce((a, b) => (b.长 > a.长 ? b : a), g.条们[0]).id
          // ⭐ 「真重复」默认勾上（合了安全）；「汇总+明细」默认**不勾**（合了会丢信息）✓
          勾[i] = g.类型 === '真重复'
        })
        set查重(r)
        set查重选(选)
        set查重合(勾)
        set查重开(true)
        if (!(r.组 || []).length) setNotes(['✓ 查过了：没有「几乎一样」的记忆'])
      })
      .catch((e) => {
        setBusy(false)
        setNotes(['查重失败：' + ((e && e.message) || e)])
      })
  }
  // 合掉：每组留一条，其余交给**服务端再验一遍**（不像的会被保住）✓
  //   ⚠⚠ 2026-09-22 修（反馈：「把一些别的对的事实给删了」）：
  //     原来客户端自己算好「删哪些」就发过去，服务端不验 ✗
  //     现在发的是「组」（留哪条、删哪些），**服务端自己再算一遍相似度** ✓
  const 合重复 = (会话, 只合真重复) => {
    if (!查重) return
    const 组们 = []
    ;(查重.组 || []).forEach((g, i) => {
      if (只合真重复 && g.类型 !== '真重复') return
      // ⭐⭐ 2026-09-23：「按我选的合」**只合勾上的组** ——
      //   原来它把每一组都合掉（默认全选中），一点就丢掉 123 条 ✗
      if (!只合真重复 && !查重合[i]) return
      const 留 = 查重选[i] || g.条们[0].id
      const 删 = g.条们.filter((t) => t.id !== 留).map((t) => t.id)
      if (删.length) 组们.push({ 留: 留, 删: 删 })
    })
    if (!组们.length) {
      setNotes([
        只合真重复 ? '这一批里没有「真重复」组' : '一组都没勾（「汇总+明细」默认不勾，要合得先勾上）',
      ])
      return
    }
    setBusy(true)
    post('/duplicates/merge', { session: 会话.id, 组: 组们 })
      .then((r) => {
        setBusy(false)
        if (!r || !r.ok) {
          setNotes(['合并：' + ((r && r.message) || '？')])
          return
        }
        const 行 = ['✓ ' + r.message + '（剩下的：' + r.剩 + ' 条）', '合掉的都收在「已删」里，点开能找回来']
        if (r.保住) {
          行.push('⚠ 有 ' + r.保住 + ' 条不够像、没敢合（保住了）：')
          ;(r.保住明细 || []).forEach((x) => 行.push('　　' + x.像度 + '  ' + x.text))
        }
        setNotes(行)
        set查重(null)
        set查重开(false)
        load()
      })
      .catch((e) => {
        setBusy(false)
        setNotes(['合并失败：' + ((e && e.message) || e)])
      })
  }
  
  // ⭐⭐ 2026-09-22（她要的）：**批量删** —— 收进「已删」，不是销毁 ✓
  //   「还是需要 2 次确认的」→ 点按钮只出确认条，确认条上再点才删 ✓
  const 批删 = (会话) => {
    const ids = Object.keys(选中).filter((k) => 选中[k])
    if (!ids.length) {
      set批删问(false)
      return
    }
    setBusy(true)
    post('/delete', { session: 会话.id, action: 'batchdelete', ids: ids })
      .then((r) => {
        setBusy(false)
        set批删问(false)
        if (!r || !r.ok) {
          setNotes(['批量删失败：' + ((r && r.message) || '？')])
          return
        }
        set选中({})
        setNotes(['✓ ' + r.message + '（剩下的：' + r.剩 + ' 条）', '删掉的都收在「已删」里，点开能找回来'])
        load()
      })
      .catch((e) => {
        setBusy(false)
        setNotes(['批量删失败：' + ((e && e.message) || e)])
      })
  }

  return { 补日期, 补不淡, 洗键, 撤销洗键, 批回, 批清, 去查重, 合重复, 批删 }
}
