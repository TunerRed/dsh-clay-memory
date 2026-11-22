// DSH 黏土记忆（原「鱼的记忆」）· 客户端半边 —— 由 src/client/ 构建生成，别直接改这个文件
(() => {
  // src/client/pages/panel.js
  function 造记忆面板({ React, el, get, post, S, G, B, rel, impName, toPct, fromPct, 进度, 更新条, 类型名, 类型表, 同日, 归整, 一次最多画, 重要色, 会话页, 所有记忆页, 时间线页, 回收站页, 回复体检页, 拦截页, 高级区, 页签名, 兜底 }) {
    function 记忆面板() {
      const [页签, set页签] = React.useState("记忆");
      React.useEffect(() => {
        const 候选 = [...document.querySelectorAll("div")].filter((d) => {
          const st = getComputedStyle(d);
          return (st.overflowY === "auto" || st.overflowY === "scroll") && d.scrollHeight > d.clientHeight + 20 && d.clientHeight > 400 && d.clientHeight < 900;
        });
        if (候选.length) 候选.sort((a, b) => b.scrollHeight - a.scrollHeight)[0].scrollTop = 0;
      }, [页签]);
      const 去会话 = () => {
        set页签("会话");
      };
      const 页签条 = el(
        "div",
        { style: Object.assign({}, S.tabs, { marginBottom: 14 }), role: "tablist", "aria-label": "黏土记忆分区" },
        页签名.map(
          ([k, 注]) => el(
            "button",
            {
              key: k,
              role: "tab",
              "aria-selected": 页签 === k,
              title: 注,
              style: 页签 === k ? S.tabOn : S.tabOff,
              onClick: () => set页签(k)
            },
            k
          )
        )
      );
      let 内容 = null;
      if (页签 === "记忆") 内容 = el(所有记忆页, { on高级: () => set页签("高级") });
      else if (页签 === "时间线") 内容 = el(时间线页, null);
      else if (页签 === "会话")
        内容 = el(会话页, null);
      else if (页签 === "回收站") 内容 = el(回收站页, null);
      else if (页签 === "体检") 内容 = el(回复体检页, null);
      else if (页签 === "拦截") 内容 = el(拦截页, null);
      else 内容 = el(高级区, { on去会话: 去会话 });
      return el("div", null, 页签条, el(兜底, { key: 页签 }, 内容));
    }
    return { 记忆面板 };
  }

  // src/client/components/select.js
  function 造选择器({ React, el }) {
    function 选择器(props) {
      const [开, set开] = React.useState(false);
      const [悬, set悬] = React.useState(-1);
      const [悬钮, set悬钮] = React.useState(false);
      const 选项 = props.选项 || [];
      const 当前 = 选项.find((o) => String(o.v) === String(props.值));
      const 底 = Object.assign(
        {
          padding: "6px 8px",
          borderRadius: 8,
          border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3))",
          background: "var(--dsw-alias-bg-layer-1, rgba(128,128,128,.08))",
          color: "var(--dsw-alias-label-primary, inherit)",
          fontSize: 12
        },
        props.style || {}
      );
      return el(
        "div",
        { style: { position: "relative", display: "inline-block", minWidth: props.minWidth || 120 } },
        el(
          "button",
          {
            style: Object.assign({}, 底, {
              display: "flex",
              alignItems: "center",
              gap: 6,
              width: "100%",
              cursor: props.disabled ? "not-allowed" : "pointer",
              textAlign: "left",
              opacity: props.disabled ? 0.55 : 1,
              // 悬停：边框亮一档 + 背景提一档（跟原生下拉一致的反馈）
              ...悬钮 && !props.disabled ? {
                borderColor: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.55))",
                background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,.16))"
              } : null,
              ...开 ? { borderColor: "var(--dsw-alias-state-business-primary, #5b8fd6)" } : null
            }),
            onClick: () => set开((v) => !v),
            disabled: props.disabled,
            onMouseEnter: () => set悬钮(true),
            onMouseLeave: () => set悬钮(false)
          },
          el("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, 当前 ? 当前.t : "（请选择）"),
          el("span", { style: { flex: "none", opacity: 0.6, fontSize: 10 } }, 开 ? "▴" : "▾")
        ),
        开 ? el(
          "div",
          {
            style: {
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              zIndex: 60,
              minWidth: "100%",
              maxHeight: 240,
              overflow: "auto",
              background: "var(--dsw-alias-bg-layer-1, #fff)",
              border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28))",
              borderRadius: 8,
              padding: 4,
              boxShadow: "0 10px 28px rgba(0,0,0,.22)"
            }
          },
          选项.map(
            (o, idx) => el(
              "div",
              {
                key: String(o.v),
                role: "button",
                tabIndex: 0,
                style: {
                  padding: "6px 8px",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                  background: String(o.v) === String(props.值) ? "var(--dsw-alias-state-business-primary, #5b8fd6)" : 悬 === idx ? "var(--dsw-alias-bg-layer-2, rgba(128,128,128,.18))" : "transparent",
                  color: String(o.v) === String(props.值) ? "#fff" : "var(--dsw-alias-label-primary, inherit)",
                  outline: 悬 === idx && String(o.v) !== String(props.值) ? "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35))" : "none"
                },
                onMouseEnter: () => set悬(idx),
                onMouseLeave: () => set悬(-1),
                onClick: () => {
                  props.onChange && props.onChange(o.v);
                  set开(false);
                },
                onKeyDown: (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    props.onChange && props.onChange(o.v);
                    set开(false);
                  }
                }
              },
              o.t
            )
          )
        ) : null
      );
    }
    return 选择器;
  }

  // src/client/pages/sessions/import-history-tab.js
  function 造导入记录页({ React, post, S, setNotes }) {
    function 导入记录页(props) {
      const open = props.open;
      const [批们, set批们] = React.useState([]);
      const [载中, set载中] = React.useState(false);
      const [展, set展] = React.useState("");
      const [要撤, set要撤] = React.useState("");
      const 拉批 = () => {
        if (!open) return;
        set载中(true);
        post("/import/batches", { session: open }).then((r) => set批们(r && r.batches || [])).catch(() => set批们([])).finally(() => set载中(false));
      };
      React.useEffect(() => {
        拉批();
      }, [open]);
      const 撤 = (batch) => {
        post("/import/undo", { session: open, batch }).then(() => {
          set要撤("");
          setNotes(["✓ 撤掉了这一批（收在「已删」里，能找回来）"]);
          props.load();
          拉批();
        }).catch(() => setNotes(["✗ 没撤成，看控制台"]));
      };
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { style: S.part },
          React.createElement(
            "div",
            { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 } },
            React.createElement("span", { style: { fontSize: 13, fontWeight: 600 } }, "导入记录"),
            React.createElement("span", { style: Object.assign({}, S.dim, { fontSize: 12 }) }, "这个会话导过哪几批")
          ),
          React.createElement(
            "div",
            { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 8 }) },
            "想导新档案？去「高级 → 从档案导入会话」，选文件、挑这个会话再导。这里只看记录，不导东西。"
          ),
          !批们.length ? React.createElement("div", { style: Object.assign({}, S.dim, { fontSize: 12, padding: "8px 0" }) }, 载中 ? "读着呢…" : "这个会话还没导过档案。") : 批们.map((b) => React.createElement(
            "div",
            { key: b.batch, style: { border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))", borderRadius: 8, marginBottom: 8, overflow: "hidden" } },
            React.createElement(
              "div",
              { style: { display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,.06))" } },
              React.createElement("span", { style: { flex: "none", fontSize: 12, fontWeight: 600 } }, b.条数 + " 条"),
              React.createElement("span", { style: { flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: b.名 }, b.名),
              React.createElement("span", { style: Object.assign({}, S.dim, { flex: "none", fontSize: 11.5 }) }, b.时间 ? new Date(b.时间).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""),
              React.createElement(
                "button",
                { style: Object.assign({}, S.btn, { flex: "none", fontSize: 11.5, padding: "2px 8px" }), onClick: () => set展(展 === b.batch ? "" : b.batch) },
                展 === b.batch ? "收起" : "展开"
              ),
              React.createElement(
                "button",
                { style: Object.assign({}, S.btn, { flex: "none", fontSize: 11.5, padding: "2px 8px", color: "var(--dsw-alias-state-error-primary, #d05b5b)" }), onClick: () => set要撤(要撤 === b.batch ? "" : b.batch) },
                要撤 === b.batch ? "算了" : "撤销这批"
              )
            ),
            要撤 === b.batch ? React.createElement(
              "div",
              { style: { padding: "7px 10px", fontSize: 12, background: "var(--dsw-alias-bg-layer-2, rgba(212,90,90,.08))" } },
              "把这一批 " + b.条数 + " 条都撤掉？收进「已删」，之后能找回来。",
              React.createElement("button", { style: Object.assign({}, S.btn, { marginLeft: 8, fontSize: 11.5, padding: "2px 8px" }), onClick: () => 撤(b.batch) }, "确定撤销")
            ) : null,
            展 === b.batch ? React.createElement(
              "div",
              { style: { maxHeight: 220, overflow: "auto", padding: "6px 10px" } },
              b.items.map((it) => React.createElement(
                "div",
                { key: it.id, style: { fontSize: 12, padding: "3px 0", borderBottom: "1px dashed var(--dsw-alias-border-l1, rgba(128,128,128,.18))" } },
                it.text
              )),
              b.items.length >= 300 ? React.createElement("div", { style: Object.assign({}, S.dim, { fontSize: 11.5, paddingTop: 4 }) }, "（只列前 300 条）") : null
            ) : null
          ))
        )
      );
    }
    return 导入记录页;
  }

  // src/client/pages/sessions/names-tab.js
  function 渲染称呼页签({ React, post, S, open, s, 详情页, selfDraft, setSelfDraft, ownerDraft, setOwnerDraft, load }) {
    return (
      // ---- 页签② 称呼：原来紧贴 hero 的那张卡，单独一页装它 ----
      React.createElement(
        "div",
        { style: { display: 详情页 === "称呼" ? "block" : "none" } },
        React.createElement(
          "div",
          { style: { padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(128,128,128,.22)", background: "rgba(127,127,127,.05)" } },
          React.createElement(
            "div",
            { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 } },
            React.createElement("span", { style: { flex: "none", width: 96, fontSize: 13 } }, "她自己叫什么"),
            React.createElement("input", {
              style: Object.assign({}, S.inp, { width: 160 }),
              placeholder: "她在这儿的名字",
              value: selfDraft[open] !== void 0 ? selfDraft[open] : s.selfName || s.titleName || "",
              onChange: (e) => setSelfDraft(Object.assign({}, selfDraft, { [open]: e.target.value }))
            }),
            s.selfName ? null : s.titleName ? React.createElement("span", { style: Object.assign({}, S.dim, { fontSize: 12 }) }, "（先填的是会话标题，确认没问题再点「存」）") : null
          ),
          React.createElement(
            "div",
            { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 } },
            React.createElement("span", { style: { flex: "none", width: 96, fontSize: 13 } }, "她怎么称呼你"),
            React.createElement("input", {
              style: Object.assign({}, S.inp, { width: 160 }),
              placeholder: "她平时怎么叫你（小名、昵称都行）",
              value: ownerDraft[open] !== void 0 ? ownerDraft[open] : s.ownerName || "",
              onChange: (e) => setOwnerDraft(Object.assign({}, ownerDraft, { [open]: e.target.value }))
            })
          ),
          React.createElement(
            "div",
            { style: { display: "flex", alignItems: "center", gap: 10 } },
            React.createElement(
              "button",
              {
                style: S.btn,
                onClick: () => post("/names", {
                  session: open,
                  selfName: (selfDraft[open] !== void 0 ? selfDraft[open] : s.selfName) || "",
                  ownerName: (ownerDraft[open] !== void 0 ? ownerDraft[open] : s.ownerName) || ""
                }).then(() => {
                  setSelfDraft({});
                  setOwnerDraft({});
                  load();
                })
              },
              "存"
            ),
            React.createElement(
              "span",
              { style: Object.assign({}, S.dim, { fontSize: 12, flex: 1, lineHeight: 1.5 }) },
              "她自己的名字写进记忆时会换成「我」；她怎么称呼你，会换成「你」。已有的记忆也会顺手洗一遍。"
            )
          )
        )
      )
    );
  }

  // src/client/pages/sessions/recall-tab.js
  function 渲染召回记录页签({ React, S, s, tr, 详情页 }) {
    return (
      // ---- 页签④ 记录：最近一次召回 + 备份怎么留 ----
      React.createElement(
        "div",
        { style: { display: 详情页 === "召回记录" ? "block" : "none" } },
        tr ? React.createElement(
          "div",
          null,
          React.createElement("div", { style: Object.assign({}, S.h, S.part) }, "最近一次召回"),
          React.createElement("div", { style: S.dim }, "线索：「" + String(tr.query || "").slice(0, 50) + "」"),
          (() => {
            const 排好 = (tr.rows || []).slice().sort((a, b) => (b.P || 0) - (a.P || 0) || (b.C || 0) - (a.C || 0));
            const 进去的 = 排好.filter((r) => !r.omission);
            return React.createElement(
              "div",
              null,
              React.createElement(
                "div",
                { style: Object.assign({}, S.dim, { fontSize: 12, margin: "2px 0 4px" }) },
                进去的.length ? "✓ 挑中并塞进去了 " + 进去的.length + " 条（排在最前面）" : "这次一条都没挑中（线索跟记忆对不上）"
              ),
              排好.slice(0, 20).map((r, i) => {
                const mm = s.memories.find((x) => x.id === r.id) || (s.deleted || []).find((x) => x.id === r.id);
                const why = r.omission ? { hard_gate: "没命中线索", below_threshold: "分数不够", limit: "超过条数上限", budget: "超过字数上限", duplicate: "跟另一条重复", fact_cap: "长期事实占满了名额" }[r.omission] || r.omission : { assembled: "进去了", consumed: "像是用上了", invalidated: "已失效" }[r.status] || "进去了";
                const 色 = r.omission ? S.drop : r.status === "consumed" ? S.ok : S.dim;
                return React.createElement(
                  "div",
                  { key: i, style: Object.assign({}, S.row, S.条) },
                  React.createElement(
                    "div",
                    { style: { flex: 1 } },
                    (r.omission ? "　" : "✓ ") + String(mm && mm.text || r.id).slice(0, 60)
                  ),
                  React.createElement("div", { style: Object.assign({}, S.dim, { width: 54 }) }, "C " + r.C),
                  React.createElement("div", { style: Object.assign({}, S.dim, { width: 54 }) }, "P " + r.P),
                  React.createElement("div", { style: Object.assign({}, 色, { width: 96 }) }, why + (r.timeHit ? " ⭐" : ""))
                );
              })
            );
          })(),
          React.createElement(
            "div",
            { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 6 }) },
            "「进去了」= 这一轮塞进提示词了；「像是用上了」= 她回复里的实词跟这条重合得多（这是猜的）；「已失效」= 这条后来被删了或改过。"
          )
        ) : React.createElement(
          "div",
          { style: S.dim },
          "这个会话还没有召回记录 —— 等下一次对话注入之后就有了。"
        ),
        // ⭐ 2026-09-22：说明都放末尾（原来「备份」插在中间，看着像别的区块的标题）
        React.createElement("div", { style: Object.assign({}, S.h, S.part) }, "备份"),
        React.createElement(
          "div",
          { style: S.dim },
          "记忆一变就会自动备份：上一版存在同目录的 .bak，另外每天存一份，留 14 天。「补日期」「补标不淡」「改」「删」之前也都会先备一份。"
        )
      )
    );
  }

  // src/client/pages/sessions/workspace-view.js
  function 渲染工作区记忆视图({ React, el, S, 选择器, 子页签, 选中区, set选中区, 区表, 工作区记忆, 删工作区记忆, 看回收站, set看回收站, 找回工作区记忆 }) {
    return (
      // ⭐ 2026-11-01 用户要求：工作区记忆视图 —— 只读列出这个工作区自己记下的项目记忆
      子页签 === "工作区记忆" ? React.createElement(
        "div",
        { style: { marginTop: 4 } },
        // 工作区选择器（和会话列表共用同一个选中区，切页签不丢）
        React.createElement(
          "div",
          { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "2px 0 8px" } },
          el(选择器, {
            style: Object.assign({}, S.inp, { width: "auto", minWidth: 170, flex: "none" }),
            值: 选中区,
            选项: (区表 || []).map((w) => ({
              v: w.id,
              // ⭐ 2026-11-01 用户要求：这里显示「工作区级记忆」的条数（不是会话数），
              //   格式和会话列表下拉统一——都只给数字
              t: (w.name || "工作区") + "（" + (w.记忆数 || 0) + "）"
            })),
            onChange: (v) => set选中区(v)
          }),
          React.createElement(
            "span",
            { style: Object.assign({}, S.dim, { fontSize: 12 }) },
            "这里只看工作区自己那一层（项目事实/决策），全局事实和会话事件在「会话」页签里"
          )
        ),
        工作区记忆 && 工作区记忆.读中 ? React.createElement("div", { style: Object.assign({}, S.dim, { fontSize: 12 }) }, "读着…") : 工作区记忆 && 工作区记忆.ok && 工作区记忆.count > 0 ? React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 6, overflowWrap: "anywhere" }) },
            "这个工作区自己的记忆 " + 工作区记忆.count + " 条 —— 同一工作区的会话共享，别的工作区看不到。库文件：" + (工作区记忆.file || "")
          ),
          工作区记忆.memories.map(
            (m) => React.createElement(
              "div",
              { key: m.id, style: Object.assign({}, S.row, S.条) },
              React.createElement("span", { style: { flex: "none", fontSize: 12, width: 76 } }, "重要 " + Number(m.importance).toFixed(2)),
              React.createElement(
                "span",
                { style: { flex: 1, minWidth: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" } },
                m.text || "（空）"
              ),
              React.createElement("span", { style: { flex: "none", fontSize: 11.5 } }, m.at ? String(m.at).slice(0, 10) : ""),
              React.createElement(
                "button",
                {
                  style: { flex: "none", fontSize: 11, padding: "2px 8px", cursor: "pointer", borderRadius: 4, border: "1px solid rgba(248,113,113,.45)", background: "transparent", color: "rgb(248,113,113)" },
                  onClick: () => 删工作区记忆(m),
                  title: "收起来（进这个工作区的回收站，能找回来）"
                },
                "删"
              )
            )
          )
        ) : React.createElement(
          "div",
          { style: Object.assign({}, S.dim, { fontSize: 12, padding: "8px 2px" }) },
          工作区记忆 && (工作区记忆.message || (工作区记忆.ok ? "这个工作区还没有项目记忆" : "读不出来")) || "先选一个工作区"
        ),
        // ⭐ 2026-11-01 用户问「回收站在哪个地方」：回收站 = 该工作区库文件里的 deleted 数组，
        //   这里列出来能点「找回来」（POST action=restore）。
        工作区记忆 && 工作区记忆.ok && Array.isArray(工作区记忆.回收站) && 工作区记忆.回收站.length ? React.createElement(
          "div",
          { style: { marginTop: 12 } },
          React.createElement(
            "div",
            {
              style: Object.assign({}, S.dim, { fontSize: 12, cursor: "pointer", userSelect: "none" }),
              onClick: () => set看回收站(!看回收站)
            },
            (看回收站 ? "▾ " : "▸ ") + "回收站 " + 工作区记忆.回收站.length + " 条 —— 删掉的先放这儿，能找回来"
          ),
          看回收站 ? 工作区记忆.回收站.map(
            (m) => React.createElement(
              "div",
              { key: "d:" + m.id, style: Object.assign({}, S.row, S.条) },
              React.createElement("span", { style: { flex: "none", fontSize: 12, width: 76 } }, "删于 " + (m.deletedAt ? String(m.deletedAt).slice(0, 10) : "—")),
              React.createElement(
                "span",
                { style: { flex: 1, minWidth: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", opacity: 0.72 } },
                m.text || "（空）"
              ),
              React.createElement(
                "button",
                {
                  style: {
                    flex: "none",
                    fontSize: 11,
                    padding: "2px 8px",
                    cursor: "pointer",
                    borderRadius: 4,
                    border: "1px solid rgba(148,163,184,.5)",
                    background: "transparent",
                    color: "inherit"
                  },
                  onClick: () => 找回工作区记忆(m),
                  title: "放回活条目里"
                },
                "找回来"
              )
            )
          ) : null
        ) : null
      ) : null
    );
  }

  // src/client/pages/sessions/memory-item.js
  function 造一条记忆渲染({ React, post, rel, impName, S, 选择器 }) {
    return function 渲染一条记忆(m, ctx) {
      const { open, now, edit, setEdit, confirm, setConfirm, 选中, set选中, 看原文, set看原文, 是事实, 撤销作废, 退原文, 确认条, load } = ctx;
      const 算层级 = (mm) => {
        const s = String(mm && mm.scope || "");
        if (s === "global" || !s && mm && mm.category === "stable_profile") return "global";
        if (mm && mm.category === "workspace" || s.indexOf("workspace:") === 0) return "workspace";
        return "session";
      };
      const 改一条 = (m2) => React.createElement(
        "div",
        { style: S.editBox },
        React.createElement("textarea", {
          style: S.area,
          rows: 3,
          value: edit.text,
          onChange: (e) => setEdit(Object.assign({}, edit, { text: e.target.value }))
        }),
        React.createElement(
          "div",
          { style: { display: "flex", gap: 8, alignItems: "center", marginTop: 6 } },
          React.createElement("span", { style: S.dim }, "重要度"),
          React.createElement(选择器, {
            style: S.inp,
            值: String(edit.importance),
            选项: [
              { v: "0", t: "随口提过" },
              { v: "0.5", t: "比较重要" },
              { v: "1", t: "非常重要（会变成「一直」记得）" }
            ],
            onChange: (v) => setEdit(Object.assign({}, edit, { importance: Number(v) }))
          }),
          React.createElement("span", { style: S.dim }, "层级"),
          React.createElement(选择器, {
            style: S.inp,
            值: edit.层级 || "global",
            选项: [
              { v: "global", t: "全局记忆" },
              { v: "workspace", t: "工作区" },
              { v: "session", t: "本会话" }
            ],
            onChange: (v) => setEdit(Object.assign({}, edit, { 层级: v }))
          }),
          React.createElement("span", { style: Object.assign({}, S.dim, { flex: 1, fontSize: 12 }) }, "改之前会自动备份 ✓"),
          React.createElement(
            "button",
            {
              style: S.btn,
              disabled: !String(edit.text || "").trim(),
              onClick: () => post("/edit", { session: open, id: m2.id, text: edit.text, importance: edit.importance, scope: edit.层级 }).then(() => {
                setEdit(null);
                load();
              })
            },
            "保存修改"
          ),
          React.createElement("button", { style: S.btn, onClick: () => setEdit(null) }, "算了")
        )
      );
      const 一条记忆 = (m2) => React.createElement(
        "div",
        // ⚠ 分隔线画在**整条**上（不是里面那个「行」）——
        //   这样下面那几行小字（能搜到它的词 / 讲的是）算在**这一条**里 ✓
        { key: m2.id, style: S.条 },
        React.createElement(
          "div",
          { style: S.row },
          // ⭐ 2026-09-22（她要的批量删除）：行首一个勾选框
          React.createElement("input", {
            type: "checkbox",
            checked: !!选中[m2.id],
            title: "勾上它，再点上面的「批量删」",
            onChange: () => set选中(Object.assign({}, 选中, { [m2.id]: !选中[m2.id] }))
          }),
          React.createElement("div", { style: Object.assign({}, S.dim, { width: 96, flex: "none" }) }, rel(m2.at, now)),
          React.createElement(
            // ⚠⚠ 正文这一格给个**下限**（flexBasis 260 / minWidth 200）✗
            //   光有 flex:1 是不够的：它允许被压到 0，右边牌子一多就成竖条。
            //   有了下限 + 上面那条 flexWrap，装不下时是**牌子换行**，不是正文变窄 ✓
            "div",
            { style: { flex: "1 1 260px", minWidth: 200, overflowWrap: "anywhere", wordBreak: "break-word" } },
            m2.已被取代 ? React.createElement(
              "span",
              {
                style: Object.assign({}, S.dim, { textDecoration: "line-through", opacity: 0.62 }),
                title: "这条已被取代（" + (m2.已被取代.为什么 || "") + "）—— 不再被想起来，东西还留着"
              },
              m2.text
            ) : m2.text
          ),
          // ⭐⭐ 2026-09-23（反馈「过期条目没标作废」）：
          //   标了「已被取代」的，行里直接挂一个「已被取代」的牌子 + 一个撤销口 ✓
          m2.已被取代 ? React.createElement(
            "div",
            {
              style: { flex: "none", fontSize: 11, marginRight: 10, padding: "1px 6px", borderRadius: 8, background: "rgba(224,176,112,.18)", color: "#e0b070", whiteSpace: "nowrap" },
              title: (m2.已被取代.为什么 || "") + "（" + rel(m2.已被取代.作废于, now) + "）—— 它不再被注入，但东西还在"
            },
            "已被取代"
          ) : null,
          m2.已被取代 ? React.createElement(
            "div",
            {
              style: Object.assign({}, S.link, { flex: "none", fontSize: 12, marginRight: 10 }),
              title: "撤销「已被取代」—— 它又能被想起来了（标错了 / 状态又变回来了）",
              onClick: () => 撤销作废(m2.id)
            },
            "恢复"
          ) : null,
          // ⭐⭐ 2026-09-23：**事实键** —— ⚠ 不挂在行里，改挂到下面那行小字 ✓
          //   行里每多一个固定宽的牌子，正文就被挤窄一分；
          //   键本来就是「附注」性质，跟「能搜到它的词」放一起正合适（见下面那条）
          React.createElement(
            "div",
            { style: Object.assign({}, S.dim, { width: 58, flex: "none", fontSize: 12 }), title: "鲜活度：越近就越鲜活，只影响排序。长期事实本来就不淡；没记时间的不知道是什么时候的事" },
            // ⭐⭐ 2026-09-22（反馈：「没标时间的还是鲜活 100%」）：
            //   光显示百分比会骗人 —— 长期事实本来就不淡，写「100%」像在说「刚发生」✗
            //   → 长期事实写「**不淡**」✓
            //   ⭐ 2026-09-22 再改（发现流水账来问）：**没记时间的也会淡了**
            //     （从「记下来的那天」开始算）→ 它们照常显示百分比 ✓
            //     （原来显示「没记时间」，那是我上一版判错了 —— 它们并不是不淡）
            m2.freshKind === "fact" ? "不淡" : typeof m2.activation === "number" && isFinite(m2.activation) ? "鲜活 " + Math.round(m2.activation * 100) + "%" : "—"
          ),
          React.createElement("div", { style: Object.assign({}, S.dim, { width: 62, flex: "none" }) }, impName(m2.importance)),
          m2.textBefore ? React.createElement(
            "div",
            {
              style: Object.assign({}, S.link, { flex: "none", fontSize: 12, marginRight: 10 }),
              title: "看看提炼之前长什么样",
              onClick: () => set看原文(Object.assign({}, 看原文, { [m2.id]: !看原文[m2.id] }))
            },
            看原文[m2.id] ? "收起" : "原文"
          ) : null,
          m2.textBefore ? React.createElement(
            "div",
            {
              style: Object.assign({}, S.link, { flex: "none", fontSize: 12, marginRight: 10, color: "#e0b070" }),
              title: "把这条退回提炼前的原文（退回后可以再提炼一遍）",
              onClick: () => setConfirm({ id: m2.id, kind: "refineundo" })
            },
            "退回"
          ) : null,
          React.createElement(
            "div",
            { style: Object.assign({}, S.link, { flex: "none", fontSize: 12, marginRight: 10 }), onClick: () => setEdit({ id: m2.id, text: m2.text, importance: typeof m2.importance === "number" ? m2.importance : 0.5, 层级: 算层级(m2) }) },
            "改"
          ),
          React.createElement(
            "div",
            {
              style: Object.assign({}, S.link, { flex: "none", fontSize: 12 }),
              // ⭐ 1.4.0：事实删的是**全局**那份 —— 鼠标悬停先提醒一句
              title: 是事实(m2) ? "这是全局事实 —— 删了所有会话都会忘（会再问一遍）" : void 0,
              onClick: () => setConfirm({ id: m2.id, kind: "delete" })
            },
            "删"
          )
        ),
        edit && edit.id === m2.id ? 改一条(m2) : null,
        confirm && confirm.id === m2.id && confirm.kind === "refineundo" ? React.createElement(
          "div",
          { style: S.confirm },
          React.createElement("span", { style: { flex: 1 } }, "把这条退回提炼前的原文？退回后它会变回「还没提炼」。"),
          React.createElement("button", { style: S.btn, onClick: () => 退原文(m2.id) }, "退回"),
          React.createElement("button", { style: S.btn, onClick: () => setConfirm(null) }, "算了")
        ) : null,
        m2.textBefore && 看原文[m2.id] ? React.createElement(
          "div",
          {
            style: Object.assign({}, S.dim, {
              margin: "0 0 6px 104px",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              // ⚠ pre-wrap 只在空格/换行处断，长串（网址、长英文）照样横向撑破面板 —— 得补这两条
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              borderLeft: "2px solid rgba(224,176,112,.5)",
              paddingLeft: 8
            })
          },
          "提炼前：" + m2.textBefore
        ) : null,
        m2.related && m2.related.length ? React.createElement(
          "div",
          { style: Object.assign({}, S.dim, { margin: "0 0 6px 104px", fontSize: 11, overflowWrap: "anywhere", wordBreak: "break-word" }) },
          "能搜到它的词：" + m2.related.join(" ")
        ) : null,
        // ⭐⭐ 2026-09-23：**「这条讲的是哪件事」** —— 挂在这儿（第二行小字），不占行里的宽度 ✓
        //   ⚠⚠ 别用「事实键」这种我自己造的词 ——
        //     她说了「让人看不懂，写通俗一点的」✗
        m2.事实键 ? React.createElement(
          "div",
          { style: { margin: "0 0 6px 104px", fontSize: 11, overflowWrap: "anywhere", wordBreak: "break-word" } },
          React.createElement("span", { style: S.dim }, "讲的是："),
          React.createElement(
            "span",
            {
              style: { padding: "1px 6px", borderRadius: 8, background: "rgba(120,170,220,.16)", color: "#7aaadc", whiteSpace: "nowrap" },
              title: "这条讲的是「" + m2.事实键 + "」这件事。讲同一件事的记忆只留最新那条 —— 旧的收起来了（还能恢复）"
            },
            m2.事实键
          )
        ) : null,
        // ⭐⭐ 1.4.0（需求②）：**删掉一条长期事实 = 全局生效** —— 会话 A 删了，
        //   会话 B、C、别的工区下一轮全都想不起来它。所以事实要**多问一遍**：
        //     点「删」→ ① 说明「这是全局事实，所有会话都会忘」→ ② 再点一次才真删 ✓
        //   事件照旧一步（它只属于这个会话，删了不影响别人）✓
        confirm && confirm.id === m2.id && confirm.kind === "delete" ? 是事实(m2) && confirm.step !== 2 ? React.createElement(
          "div",
          { style: S.confirm },
          React.createElement(
            "span",
            { style: { flex: 1, minWidth: 0, overflowWrap: "anywhere" } },
            "⚠ 这是「全局事实」—— 收起来以后，所有会话都会忘掉它（不只是当前这个对话）。真的要动它？"
          ),
          React.createElement(
            "button",
            { style: S.btnDanger, onClick: () => setConfirm({ id: m2.id, kind: "delete", step: 2 }) },
            "我明白，继续"
          ),
          React.createElement("button", { style: S.btn, onClick: () => setConfirm(null) }, "算了")
        ) : 确认条("把这条收起来？它会进「已删掉的」，还能找回来。", "收起来", "delete", m2.id) : null
      );
      return 一条记忆(m);
    };
  }

  // src/client/pages/sessions/batch-actions.js
  function 造批量维护动作(ctx) {
    const { post, load, s, 没键的, 补标进度, 洗键进度, 选中, set选中, 选中清, set选中清, setBusy, setConfirm, setNotes, set批回问, set批清问, set批删问, set看记忆, 查重, set查重, 查重选, set查重选, 查重合, set查重合, set查重开 } = ctx;
    const 补日期 = () => {
      setConfirm(null);
      setBusy(true);
      post("/backfill-dates", { session: s.id }).then((r) => {
        setBusy(false);
        setNotes([
          r && r.补了 ? "补了 " + r.补了 + " 条日期" + (r.猜的 ? "（其中 " + r.猜的 + " 条年份是按最近的算的）" : "") + "，还有 " + r.还是没 + " 条正文里真没写日期" : "没有能补的 —— 正文里找不到日期"
        ]);
        load();
      }).catch((e) => {
        setBusy(false);
        setNotes(["补日期失败：" + (e && e.message || e)]);
      });
    };
    const 补不淡 = (重判) => {
      setConfirm(null);
      setBusy(true);
      let 累计判 = 0;
      let 累计升 = 0;
      let 累计降 = 0;
      let 连着失败 = 0;
      let 连着空 = 0;
      let 头一趟 = true;
      补标进度.在跑 = true;
      补标进度.重判 = !!重判;
      补标进度.已 = 0;
      补标进度.总 = (s.memories || []).length;
      补标进度.等 = 0;
      const 跑 = () => {
        const 体 = { session: s.id, 每批: 20 };
        if (重判 && 头一趟) 体.重判 = true;
        头一趟 = false;
        post("/backfill-stable", 体).then((r) => {
          if (!r || !r.ok) {
            const 是限流 = /429|rate.?limit|too many|限流|超限/i.test(String(r && r.message || ""));
            if (是限流 && 连着失败 < 6) {
              连着失败++;
              const 等 = Math.min(6e4, 5e3 * Math.pow(2, 连着失败 - 1));
              补标进度.等 = Math.round(等 / 1e3);
              setNotes([
                "⚠ 模型那边限流了（429），等 " + Math.round(等 / 1e3) + " 秒再试…（第 " + 连着失败 + " 次）",
                "已经判好的都存下来了，不用重头来 ✓"
              ]);
              setTimeout(跑, 等);
              return;
            }
            补标进度.在跑 = false;
            setBusy(false);
            setNotes([
              "补标失败：" + (r && r.message || "？"),
              "已经判好的都存下来了 —— 再点一次会接着跑，不会重头来 ✓"
            ]);
            return;
          }
          连着失败 = 0;
          补标进度.等 = 0;
          累计判 += r.判了 || 0;
          累计升 += r.改成不淡 || 0;
          累计降 += r.降成会淡 || 0;
          补标进度.已 = 累计判;
          if (r.共) 补标进度.总 = r.共;
          连着空 = (r.判了 || 0) === 0 ? 连着空 + 1 : 0;
          setNotes([
            "正在判… 已判 " + 累计判 + " 条：" + 累计升 + " 条标成「永远不淡」、" + 累计降 + " 条改成会淡" + (r.done ? "" : "，还剩 " + r.剩 + " 条") + (r.判了 === 0 && !r.done ? "　（这批模型没回东西，再试一批）" : "")
          ]);
          if (!r.done) {
            if (连着空 >= 3) {
              补标进度.在跑 = false;
              setBusy(false);
              setNotes([
                "⚠ 连着 3 批模型都没回东西，先停了（还剩 " + r.剩 + " 条）。",
                "已经判好的都存下来了 —— 再点一次会接着跑，不会重头来 ✓"
              ]);
              return;
            }
            setTimeout(跑, 1500);
          } else {
            补标进度.在跑 = false;
            setBusy(false);
            setNotes([
              "✓ 判完了：看了 " + 累计判 + " 条 —— " + 累计升 + " 条标成「永远不淡」，" + 累计降 + " 条从「永远不淡」改成会淡",
              "（这一趟把所有还没判过的都过了一遍：该升的升、该降的降）"
            ]);
            load();
          }
        }).catch((e) => {
          补标进度.在跑 = false;
          setBusy(false);
          setNotes(["补标失败：" + (e && e.message || e), "已经判好的都存下来了 —— 再点一次会接着跑 ✓"]);
        });
      };
      跑();
    };
    const 洗键 = (干跑) => {
      setConfirm(null);
      setBusy(true);
      let 累计洗 = 0;
      let 累计给 = 0;
      let 累计空 = 0;
      let 累计废 = 0;
      let 连着失败 = 0;
      let 连着空 = 0;
      洗键进度.在跑 = true;
      洗键进度.干跑 = !!干跑;
      洗键进度.已 = 0;
      洗键进度.总 = 没键的;
      const 跑 = () => {
        const 体 = { session: s.id, 每批: 8, 干跑: !!干跑 };
        post("/wash-keys", 体).then((r) => {
          if (!r || !r.ok) {
            const 是限流 = /429|rate.?limit|too many|限流|超限/i.test(String(r && r.message || ""));
            if (是限流 && 连着失败 < 6) {
              连着失败++;
              const 等 = Math.min(6e4, 5e3 * Math.pow(2, 连着失败 - 1));
              setNotes([
                "⚠ 模型那边限流了（429），等 " + Math.round(等 / 1e3) + " 秒再试…（第 " + 连着失败 + " 次）",
                "已经补好的都存下来了，不用重头来 ✓"
              ]);
              setTimeout(跑, 等);
              return;
            }
            洗键进度.在跑 = false;
            setBusy(false);
            setNotes([
              "清洗失败：" + (r && r.message || "？"),
              "已经补好的都存下来了 —— 再点一次会接着跑，不会重头来 ✓"
            ]);
            return;
          }
          连着失败 = 0;
          累计洗 += r.洗了 || 0;
          累计给 += r.给了键 || 0;
          累计空 += r.留空 || 0;
          累计废 += r.作废了 || 0;
          洗键进度.已 = 累计洗;
          if (r.总数) 洗键进度.总 = 没键的;
          连着空 = (r.没回出东西 || 0) >= (r.洗了 || 0) ? 连着空 + 1 : 0;
          if (干跑) {
            洗键进度.在跑 = false;
            setBusy(false);
            const 例 = (r.示例 || []).map((x) => "　「" + x.键 + "」　←　" + x.正文);
            setNotes(
              [
                "先试了 " + (r.洗了 || 0) + " 条（一个字都没改）：标了 " + (r.给了键 || 0) + " 条、说不用标 " + (r.留空 || 0) + " 条",
                "它标出来是这样的（左边是「这条讲的是哪件事」，右边是记忆本身）："
              ].concat(例.length ? 例 : ["　（这批它都说不用标）"]).concat(["", "看着行就点「全部开始」；不行就先别动 —— 这一步不做也不影响别的 ✓"])
            );
            return;
          }
          setNotes([
            "正在认… 已过 " + 累计洗 + " 条：标了 " + 累计给 + " 条、说不用标 " + 累计空 + " 条" + (累计废 ? "、顺手收起来 " + 累计废 + " 条" : "") + (r.done ? "" : "，还剩 " + r.剩 + " 条")
          ]);
          if (!r.done) {
            if (连着空 >= 3) {
              洗键进度.在跑 = false;
              setBusy(false);
              setNotes([
                "⚠ 连着 3 批模型一个字都没回，先停了（还剩 " + r.剩 + " 条）。",
                "已经标好的都存下来了 —— 再点一次会接着跑 ✓",
                "（要是它只是说「这批都不用标」，那不算出错、会自己往下走）"
              ]);
              return;
            }
            setTimeout(跑, 1500);
          } else {
            洗键进度.在跑 = false;
            setBusy(false);
            setNotes([
              "✓ 跑完了：过了 " + 累计洗 + " 条 —— 标了 " + 累计给 + " 条、说不用标 " + 累计空 + " 条" + (累计废 ? "，其中 " + 累计废 + " 条因为「讲的是同一件事」被收起来了（还留着、能恢复）" : ""),
              "说不用标的那批一个字都没动 ✓（要退回来就点「撤掉这次标的」）"
            ]);
            load();
          }
        }).catch((e) => {
          洗键进度.在跑 = false;
          setBusy(false);
          setNotes(["跑失败了：" + (e && e.message || e), "已经标好的都存下来了 —— 再点一次会接着跑 ✓"]);
        });
      };
      跑();
    };
    const 撤销洗键 = () => {
      setConfirm(null);
      setBusy(true);
      post("/wash-keys/undo", { session: s.id }).then((r) => {
        setBusy(false);
        if (!r || !r.ok) {
          setNotes(["撤回失败：" + (r && r.message || "？")]);
          return;
        }
        setNotes([
          "✓ 撤完了：撤掉 " + (r.摘了 || 0) + " 条自动标的、放回来 " + (r.恢复 || 0) + " 条被收起来的",
          "（你自己填的那些没动 —— 这个按钮只管自动标的）"
        ]);
        load();
      }).catch((e) => {
        setBusy(false);
        setNotes(["撤回失败：" + (e && e.message || e)]);
      });
    };
    const 批回 = (会话, 只合并) => {
      const ids = 只合并 ? [] : Object.keys(选中清).filter((k) => 选中清[k]);
      if (!只合并 && !ids.length) {
        set批回问(false);
        return;
      }
      setBusy(true);
      post("/delete", Object.assign({ session: 会话.id, action: "restorebatch", ids }, 只合并 ? { 只找回合并掉的: true } : {})).then((r) => {
        setBusy(false);
        set批回问(false);
        if (!r || !r.ok) {
          setNotes(["批量找回失败：" + (r && r.message || "？")]);
          return;
        }
        set选中清({});
        setNotes(["✓ " + r.message + "（「已删」里还剩 " + r.剩 + " 条）"]);
        load();
      }).catch((e) => {
        setBusy(false);
        setNotes(["批量找回失败：" + (e && e.message || e)]);
      });
    };
    const 批清 = (会话) => {
      const ids = Object.keys(选中清).filter((k) => 选中清[k]);
      if (!ids.length) {
        set批清问(false);
        return;
      }
      setBusy(true);
      post("/delete", { session: 会话.id, action: "purgebatch", ids }).then((r) => {
        setBusy(false);
        set批清问(false);
        if (!r || !r.ok) {
          setNotes(["批量清掉失败：" + (r && r.message || "？")]);
          return;
        }
        set选中清({});
        setNotes(["✓ " + r.message + "（「已删」里还剩 " + r.剩 + " 条）"]);
        load();
      }).catch((e) => {
        setBusy(false);
        setNotes(["批量清掉失败：" + (e && e.message || e)]);
      });
    };
    const 去查重 = (会话) => {
      setBusy(true);
      set看记忆(true);
      post("/duplicates", { session: 会话.id }).then((r) => {
        setBusy(false);
        if (!r || !r.ok) {
          setNotes(["查重失败：" + (r && r.message || "？")]);
          return;
        }
        const 选 = {};
        const 勾 = {};
        (r.组 || []).forEach((g, i) => {
          选[i] = g.条们.reduce((a, b) => b.长 > a.长 ? b : a, g.条们[0]).id;
          勾[i] = g.类型 === "真重复";
        });
        set查重(r);
        set查重选(选);
        set查重合(勾);
        set查重开(true);
        if (!(r.组 || []).length) setNotes(["✓ 查过了：没有「几乎一样」的记忆"]);
      }).catch((e) => {
        setBusy(false);
        setNotes(["查重失败：" + (e && e.message || e)]);
      });
    };
    const 合重复 = (会话, 只合真重复) => {
      if (!查重) return;
      const 组们 = [];
      (查重.组 || []).forEach((g, i) => {
        if (只合真重复 && g.类型 !== "真重复") return;
        if (!只合真重复 && !查重合[i]) return;
        const 留 = 查重选[i] || g.条们[0].id;
        const 删 = g.条们.filter((t) => t.id !== 留).map((t) => t.id);
        if (删.length) 组们.push({ 留, 删 });
      });
      if (!组们.length) {
        setNotes([
          只合真重复 ? "这一批里没有「真重复」组" : "一组都没勾（「汇总+明细」默认不勾，要合得先勾上）"
        ]);
        return;
      }
      setBusy(true);
      post("/duplicates/merge", { session: 会话.id, 组: 组们 }).then((r) => {
        setBusy(false);
        if (!r || !r.ok) {
          setNotes(["合并：" + (r && r.message || "？")]);
          return;
        }
        const 行 = ["✓ " + r.message + "（剩下的：" + r.剩 + " 条）", "合掉的都收在「已删」里，点开能找回来"];
        if (r.保住) {
          行.push("⚠ 有 " + r.保住 + " 条不够像、没敢合（保住了）：");
          (r.保住明细 || []).forEach((x) => 行.push("　　" + x.像度 + "  " + x.text));
        }
        setNotes(行);
        set查重(null);
        set查重开(false);
        load();
      }).catch((e) => {
        setBusy(false);
        setNotes(["合并失败：" + (e && e.message || e)]);
      });
    };
    const 批删 = (会话) => {
      const ids = Object.keys(选中).filter((k) => 选中[k]);
      if (!ids.length) {
        set批删问(false);
        return;
      }
      setBusy(true);
      post("/delete", { session: 会话.id, action: "batchdelete", ids }).then((r) => {
        setBusy(false);
        set批删问(false);
        if (!r || !r.ok) {
          setNotes(["批量删失败：" + (r && r.message || "？")]);
          return;
        }
        set选中({});
        setNotes(["✓ " + r.message + "（剩下的：" + r.剩 + " 条）", "删掉的都收在「已删」里，点开能找回来"]);
        load();
      }).catch((e) => {
        setBusy(false);
        setNotes(["批量删失败：" + (e && e.message || e)]);
      });
    };
    return { 补日期, 补不淡, 洗键, 撤销洗键, 批回, 批清, 去查重, 合重复, 批删 };
  }

  // src/client/pages/sessions.js
  function 造会话页({ React, el, get, post, B, S, rel, impName, 一次最多画, 进度, 改进度, 补标进度, 洗键进度, 补记页 }) {
    const 选择器 = 造选择器({ React, el });
    const 渲染一条记忆 = 造一条记忆渲染({ React, post, rel, impName, S, 选择器 });
    function 会话页(props) {
      const [d, setD] = React.useState(null);
      const [err, setErr] = React.useState(null);
      const [open, setOpen] = React.useState(null);
      const [notes, setNotes] = React.useState(null);
      const 导入记录页 = React.useMemo(() => 造导入记录页({ React, post, S, setNotes }), []);
      const [busy, setBusy] = React.useState(false);
      const [confirm, setConfirm] = React.useState(null);
      const [showDeleted, setShowDeleted] = React.useState(false);
      const [selfDraft, setSelfDraft] = React.useState({});
      const [ownerDraft, setOwnerDraft] = React.useState({});
      const [pronounDraft, setPronounDraft] = React.useState(null);
      const [edit, setEdit] = React.useState(null);
      const [pronounAsk, setPronounAsk] = React.useState(null);
      const [区表, set区表] = React.useState([]);
      const [选中区, set选中区] = React.useState("");
      const [会话搜, set会话搜] = React.useState("");
      const [区会话, set区会话] = React.useState(null);
      const [子页签, set子页签] = React.useState("会话");
      const [工作区记忆, set工作区记忆] = React.useState(null);
      const [看回收站, set看回收站] = React.useState(false);
      const 拉区表 = React.useCallback(() => {
        get("/workspaces").then((r) => set区表(Array.isArray(r) ? r : r && r.workspaces || [])).catch(() => set区表([]));
      }, []);
      React.useEffect(() => {
        拉区表();
      }, [拉区表]);
      React.useEffect(() => {
        if (!选中区) {
          set区会话(null);
          return;
        }
        get("/sessions-by-workspace?workspace=" + encodeURIComponent(选中区)).then((r) => set区会话(new Set((r && r.sessions || []).map((x) => x.id)))).catch(() => set区会话(/* @__PURE__ */ new Set()));
      }, [选中区]);
      const 刷工作区记忆 = React.useCallback(() => {
        const 区 = (区表 || []).find((w) => w && w.id === 选中区);
        const cwd = 区 && 区.path ? String(区.path) : "";
        if (!cwd) {
          set工作区记忆({ ok: false, message: "先选一个工作区" });
          return;
        }
        set工作区记忆({ 读中: true });
        get("/workspace-memories?workspace=" + encodeURIComponent(cwd)).then((r) => set工作区记忆(r || { ok: false, message: "没读到" })).catch((e) => set工作区记忆({ ok: false, message: String(e && e.message || e) }));
      }, [选中区, 区表]);
      React.useEffect(() => {
        if (子页签 !== "工作区记忆") return;
        if (!选中区 && (区表 || []).length) {
          set选中区(区表[0].id);
          return;
        }
        刷工作区记忆();
      }, [子页签, 选中区, 区表, 刷工作区记忆]);
      const 删工作区记忆 = (m) => {
        const 区 = (区表 || []).find((w) => w && w.id === 选中区);
        const cwd = 区 && 区.path ? String(区.path) : "";
        if (!cwd) return;
        const 问 = window.confirm(
          "把这条工作区记忆收起来？\n\n" + String(m.text || "").slice(0, 160) + "\n\n它只属于这个工作区；收起来后进回收站，以后能找回来。"
        );
        if (!问) return;
        post("/workspace-memories", { action: "delete", workspace: cwd, id: m.id }).then((r) => {
          if (r && r.ok) {
            刷工作区记忆();
            拉区表();
          } else window.alert("没删掉：" + (r && r.message || "？"));
        }).catch((e) => window.alert("删失败：" + String(e && e.message || e)));
      };
      const 找回工作区记忆 = (m) => {
        const 区 = (区表 || []).find((w) => w && w.id === 选中区);
        const cwd = 区 && 区.path ? String(区.path) : "";
        if (!cwd) return;
        post("/workspace-memories", { action: "restore", workspace: cwd, id: m.id }).then((r) => {
          if (r && r.ok) {
            刷工作区记忆();
            拉区表();
          } else window.alert("没找回来：" + (r && r.message || "？"));
        }).catch((e) => window.alert("找回来失败：" + String(e && e.message || e)));
      };
      const [详情页, set详情页] = React.useState("记忆");
      const [复制开, set复制开] = React.useState(false);
      const [复制到, set复制到] = React.useState("");
      const [菜单在, set菜单在] = React.useState("");
      const [复制源, set复制源] = React.useState("");
      const 是事实 = (m) => !!m && m.category === "stable_profile";
      const 数事实 = (x) => {
        if (!x) return 0;
        if (typeof x.factsCount === "number" && isFinite(x.factsCount)) return x.factsCount;
        if (!Array.isArray(x.memories)) return 0;
        return x.memories.filter(是事实).length;
      };
      const 数事件 = (x) => {
        if (!x) return 0;
        if (typeof x.eventCount === "number" && isFinite(x.eventCount)) return x.eventCount;
        if (!Array.isArray(x.memories)) return typeof x.count === "number" ? x.count : 0;
        const 列 = x.memories;
        return 列.length - 列.filter(是事实).length;
      };
      const 全局事实数 = () => {
        if (d && typeof d.factsCount === "number" && isFinite(d.factsCount)) return d.factsCount;
        let 最多 = 0;
        for (const x of d && d.sessions || []) {
          const n = 数事实(x);
          if (n > 最多) 最多 = n;
        }
        return 最多;
      };
      const 会话名 = (sid) => {
        const x = (d && d.sessions || []).find((v) => v.id === sid);
        return x && (x.title || x.id) || String(sid || "").slice(0, 18);
      };
      const [搜词, set搜词] = React.useState("");
      const [画全部, set画全部] = React.useState(false);
      const [看记忆, set看记忆] = React.useState(false);
      const [顺序, set顺序] = React.useState("新");
      const [看哪边, set看哪边] = React.useState("全部");
      const [看事实, set看事实] = React.useState(false);
      const [查重, set查重] = React.useState(null);
      const [查重选, set查重选] = React.useState({});
      const [查重合, set查重合] = React.useState({});
      const [查重开, set查重开] = React.useState(false);
      const [选中, set选中] = React.useState({});
      const [批删问, set批删问] = React.useState(false);
      const [选中清, set选中清] = React.useState({});
      const [批清问, set批清问] = React.useState(false);
      const [批回问, set批回问] = React.useState(false);
      const [看原文, set看原文] = React.useState({});
      const [加内容, set加内容] = React.useState("");
      const [加时间, set加时间] = React.useState("");
      const [加重要, set加重要] = React.useState("0.5");
      const [加词, set加词] = React.useState("");
      const [加在谁, set加在谁] = React.useState("");
      const [加结果, set加结果] = React.useState(null);
      const [加展开, set加展开] = React.useState(false);
      const load = React.useCallback(() => {
        get("/list").then((x) => {
          setD(x);
          setErr(null);
        }).catch((e) => setErr(String(e && e.message || e)));
      }, []);
      React.useEffect(() => {
        load();
      }, [load]);
      const 加哪个会话 = React.useCallback(() => {
        if (加在谁) return 加在谁;
        if (open) return String(open);
        const 列 = d && d.sessions || [];
        const 开着的 = 列.find((x) => x.enabled);
        return (开着的 || 列[0] || {}).id || "";
      }, [加在谁, open, d]);
      const 提交一条 = React.useCallback(() => {
        const 内容 = 加内容.trim();
        if (!内容) {
          set加结果({ ok: false, 文字: "内容不能空" });
          return;
        }
        const 会话 = 加哪个会话();
        if (!会话) {
          set加结果({ ok: false, 文字: "没有会话可加" });
          return;
        }
        const 重要 = Number(加重要);
        set加结果({ ok: true, 文字: "加着呢…" });
        post("/add", {
          session: 会话,
          text: 内容,
          at: 加时间.trim(),
          importance: Number.isFinite(重要) ? 重要 : 0.5,
          tags: 加词.trim() ? 加词.trim().split(/[\s,，、]+/).filter(Boolean) : []
        }).then((r) => {
          if (r && r.ok) {
            set加结果({ ok: true, 文字: "加上了 ✓（这个会话现在 " + r.count + " 条）" });
            set加内容("");
            set加时间("");
            set加词("");
            load();
          } else {
            set加结果({ ok: false, 文字: r && (r.error || r.message) || "没加上" });
          }
        }).catch((e) => set加结果({ ok: false, 文字: String(e && e.message || e) }));
      }, [加内容, 加时间, 加重要, 加词, 加哪个会话, load]);
      React.useEffect(() => {
        if (typeof window === "undefined" || !window.addEventListener) return;
        let 上次 = 0;
        const 回来就重读 = () => {
          if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
          if (进度.扩词.状态 && 进度.扩词.状态.running || 进度.提炼.状态 && 进度.提炼.状态.running) return;
          const 现在 = Date.now();
          if (现在 - 上次 < 1e4) return;
          上次 = 现在;
          load();
        };
        window.addEventListener("focus", 回来就重读);
        document.addEventListener("visibilitychange", 回来就重读);
        return () => {
          window.removeEventListener("focus", 回来就重读);
          document.removeEventListener("visibilitychange", 回来就重读);
        };
      }, [load]);
      if (err) return React.createElement("div", { style: S.wrap }, React.createElement("div", { style: S.drop }, "出错了：" + err));
      if (!d) return React.createElement("div", { style: S.wrap }, "加载中…");
      const now = Date.now();
      if (open) {
        const s = (d.sessions || []).find((x) => x.id === open);
        if (!s) return React.createElement("div", { style: S.wrap }, "找不到这个会话");
        const tr = (s.traces || []).slice(-1)[0];
        const 删 = (id, action) => post("/delete", { session: open, id, action }).then(() => {
          setConfirm(null);
          load();
        });
        const 撤销作废 = (id) => {
          setBusy(true);
          post("/delete", { session: open, action: "unsupersede", id }).then((r) => {
            setBusy(false);
            if (!r || !r.ok) {
              setNotes(["撤销失败：" + (r && r.message || "？")]);
              return;
            }
            setNotes(["✓ " + r.message]);
            load();
          }).catch((e) => {
            setBusy(false);
            setNotes(["撤销失败：" + (e && e.message || e)]);
          });
        };
        const 退原文 = (id) => post("/refine/undo", id === "*" ? { session: open, all: true } : { session: open, id }).then((r) => {
          setConfirm(null);
          setNotes(["✓ 退回了 " + (r && r.退了 || 0) + " 条原文"]);
          load();
        }).catch((e) => setNotes(["退不回：" + String(e && e.message || e)]));
        const 复制过去 = () => post("/copy-to", { session: 复制到, to: open }).then((r) => {
          setConfirm(null);
          setNotes([r && r.ok ? "✓ 复制了 " + r.复制了 + " 条事件过去（事实本来就是全局的，不用复制），那边开关也开了" : "✗ " + (r && r.message || "？")]);
          load();
        }).catch((e) => setNotes(["✗ " + String(e && e.message || e)]));
        const 确认条 = (text, okLabel, action, id) => React.createElement(
          "div",
          { style: S.confirm },
          React.createElement("span", { style: { flex: 1, minWidth: 0, overflowWrap: "anywhere" } }, text),
          React.createElement("button", { style: S.btnDanger, onClick: () => 删(id, action) }, okLabel),
          React.createElement("button", { style: S.btn, onClick: () => setConfirm(null) }, "算了")
        );
        const 一条记忆 = (m) => 渲染一条记忆(m, { open, now, edit, setEdit, confirm, setConfirm, 选中, set选中, 看原文, set看原文, 是事实, 撤销作废, 退原文, 确认条, load });
        const 已删 = s.deleted || [];
        const 被取代的 = (s.memories || []).filter((m) => m.已被取代);
        const 活着的 = (s.memories || []).filter((m) => !m.已被取代);
        const 关键字 = 搜词.trim().toLowerCase();
        const 搜过 = 关键字 ? 活着的.filter((m) => {
          const 包 = (x) => String(x || "").toLowerCase().indexOf(关键字) >= 0;
          return 包(m.text) || 包(m.textBefore) || 包(m.原话) || 包(m.source) || 包(m.id) || Array.isArray(m.related) && 包(m.related.join(" "));
        }) : 活着的;
        const 有时间 = (m) => !!m.at;
        const 不会淡 = (m) => m.category === "stable_profile";
        const 层是 = (m, l) => (m.层 || "session") === l;
        const 过滤后 = 看哪边 === "有时间" ? 搜过.filter(有时间) : 看哪边 === "没时间" ? 搜过.filter((m) => !有时间(m)) : 看哪边 === "长期事实" ? 搜过.filter(不会淡) : 看哪边 === "会淡的" ? 搜过.filter((m) => !不会淡(m)) : 看哪边 === "全局" ? 搜过.filter((m) => 层是(m, "global")) : 看哪边 === "工作区" ? 搜过.filter((m) => 层是(m, "workspace")) : 看哪边 === "会话" ? 搜过.filter((m) => 层是(m, "session")) : 搜过;
        const 排序 = (m) => {
          const t = m.at ? new Date(m.at).getTime() : NaN;
          return isFinite(t) ? t : null;
        };
        const 排好 = 过滤后.slice().sort((a, b) => {
          const ta = 排序(a);
          const tb = 排序(b);
          if (ta === null && tb === null) return 0;
          if (ta === null) return 1;
          if (tb === null) return -1;
          return 顺序 === "旧" ? ta - tb : tb - ta;
        });
        const 画这个 = 看哪边 === "没时间" && 顺序 === "新" ? 排好.slice().reverse() : 排好;
        const 有时间数 = 活着的.filter(有时间).length;
        const 没时间数 = 活着的.length - 有时间数;
        const 事实总数 = 活着的.filter(不会淡).length;
        const 会淡总数 = 活着的.length - 事实总数;
        const 全局数 = 活着的.filter((m) => (m.层 || "session") === "global").length;
        const 工区数 = 活着的.filter((m) => (m.层 || "session") === "workspace").length;
        const 会话数 = 活着的.length - 全局数 - 工区数;
        const 没日期的 = 活着的.filter((m) => !m.at).length;
        const 没判过的 = (s.memories || []).filter((m) => !m.stableChecked).length;
        const 已选几条 = Object.keys(选中).filter((k) => 选中[k]).length;
        const 已选事实 = (s.memories || []).filter((m) => 选中[m.id] && 是事实(m)).length;
        const 判过的 = (s.memories || []).filter((m) => m.stableChecked).length;
        const 已选清几条 = Object.keys(选中清).filter((k) => 选中清[k]).length;
        const 没键的 = (s.memories || []).filter((m) => !m.已被取代 && !m.refinedSkip && !m.事实键 && !m.洗键过).length;
        const 判留空的 = (s.memories || []).filter((m) => !m.事实键 && m.洗键过).length;
        const 可撤的 = (s.memories || []).filter((m) => m.键来源 === "清洗补键" || m.洗键过).length;
        const { 补日期, 补不淡, 洗键, 撤销洗键, 批回, 批清, 去查重, 合重复, 批删 } = 造批量维护动作({ post, load, s, 没键的, 补标进度, 洗键进度, 选中, set选中, 选中清, set选中清, setBusy, setConfirm, setNotes, set批回问, set批清问, set批删问, set看记忆, 查重, set查重, 查重选, set查重选, 查重合, set查重合, set查重开 });
        return React.createElement(
          "div",
          { style: S.wrap },
          React.createElement("div", { style: S.link, onClick: () => setOpen(null) }, "← 所有会话"),
          // ⭐ 1.4.2：「这个会话是谁」收进一张浅卡（id、两笔账、分支说明）
          //   原来它跟下面的称呼框、记忆列表全平铺，第一屏看不出「头」在哪 ✗
          React.createElement(
            "div",
            { style: S.secHero },
            React.createElement("div", { style: { fontSize: 14, fontWeight: 650, marginBottom: 4, overflowWrap: "anywhere" } }, s.title || "（没起名字的会话）"),
            React.createElement("div", { style: Object.assign({}, S.dim, { fontSize: 11.5, fontFamily: "ui-monospace, monospace", marginBottom: 6, overflowWrap: "anywhere" }) }, s.id),
            // ⭐ 1.4.0（需求①）：这个会话看到的「事实」是**全局库里的全部**（每个会话都一样），
            //   「事件」才是这个会话自己的 —— 两笔账分开写，别拿合并后的总数糊人 ✓
            React.createElement(
              "div",
              { style: Object.assign({}, S.dim, { fontSize: 12 }) },
              "全局事实 " + 数事实(s) + " 条（所有会话共享）· 本会话事件 " + 数事件(s) + " 条" + (已删.length ? "　· 还收着 " + 已删.length + " 条" : "")
            ),
            React.createElement(
              "div",
              { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2, overflowWrap: "anywhere" }) },
              "事实是所有会话共用的（在哪个会话里删，哪儿都会忘）；事件只属于这个会话。"
            ),
            // ⭐ 1.4.0（需求③）：分支继承那一侧的提示 —— 事实不用继承（已经全局了），
            //   从前端这头也把话说明白，别让人以为「分支没把事实带过来」是漏了 ✓
            s.parent ? React.createElement(
              "div",
              { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2, overflowWrap: "anywhere" }) },
              "这个会话是从「" + 会话名(s.parent) + "」分支出来的 —— 事实已经是全局的了，分支只继承了事件。"
            ) : null
          ),
          // ⭐⭐ 2026-10-28（用户：「把详情页下面几块功能拆成几个 tab 分区」）：
          //   原来十来块一路平铺到底，想看「导入」「备份」得滚很久，层次全糊了 ✗
          //   现在四个页签：
          //     ① 记忆（自己加一条 + 记忆列表 + 已删掉的）
          //     ② 称呼（她自己叫什么 / 她怎么称呼你）
          //     ③ 导入（从旧档案导入；提炼 / 扩词 收进它里面当②后期加工）
          //     ④ 记录（最近一次召回 + 备份怎么留）
          //   ⚠ 跟外层「会话记忆 / 全局事实」是同一套做法：**四块都挂着，只切 display** ——
          //     切走再回来，各块的折叠状态、勾选、进度条都还在，列表也不用重画一遍 ✓
          //     （条件渲染卸载再挂上的话，几百条的记忆列表会重画，肉眼能看出卡一下 ✗）
          React.createElement(
            "div",
            { style: S.tabs, role: "tablist", "aria-label": "会话详情分区" },
            [
              ["记忆", "记忆", "记忆列表、已删掉的、自己加一条"],
              ["称呼", "称呼", "她在这儿的名字、她怎么称呼你"],
              ["导入记录", "导入记录", "导过哪几批（只读）+ 撤销这一批"],
              ["召回记录", "召回记录", "最近一次召回挑中了什么 + 备份怎么留"],
              ["补记", "补记", "把这段聊过、但当时没记下来的，按现在的偏好重新过一遍"]
            ].map(([k, t, 说明]) => React.createElement(
              "button",
              {
                key: k,
                type: "button",
                role: "tab",
                "aria-selected": 详情页 === k ? "true" : "false",
                title: 说明,
                style: 详情页 === k ? S.tabOn : S.tabOff,
                onClick: () => set详情页(k)
              },
              t
            ))
          ),
          渲染称呼页签({ React, post, S, open, s, 详情页, selfDraft, setSelfDraft, ownerDraft, setOwnerDraft, load }),
          // ---- 页签① 记忆：自己加一条 + 记忆列表 + 已删掉的（原来这几块就在这一竖溜）----
          React.createElement(
            "div",
            { style: { display: 详情页 === "记忆" ? "block" : "none" } },
            // ⚠ 记忆列表**默认折叠** —— 库里几百条的时候，它压在中间会把
            //   下面那些按钮顶到很下面，她得一直翻才够得着 ✗
            //   （2026-10-28 起「提炼 / 扩词」搬去「导入」页签了，这条折叠照旧有用：
            //     记忆页签第一眼要给的是「加一条 + 列表概览」，不是几百行原文）
            React.createElement(
              "div",
              { style: { display: "flex", gap: 8, alignItems: "center", marginTop: 16 } },
              React.createElement(
                "div",
                { style: Object.assign({}, S.h, { cursor: "pointer", margin: 0, flex: 1 }), onClick: () => set看记忆(!看记忆) },
                // ⭐ 2026-11-01（她要的）：标题只留「记忆列表」——后面的条数去掉了
                //   （上面那行已经写了「全局事实 N 条 · 本会话事件 M 条」，这里再报一遍是重复）
                (看记忆 ? "▾ " : "▸ ") + "记忆列表"
              ),
              // ⭐⭐ 2026-09-22（反馈：「查重我们是不是还没做啊？我怎么没有找到按钮」）：
              //   ⚠⚠ 第一次我把它放进了**折叠起来的**记忆列表块里 ——
              //     不点开列表就看不见，那就等于没有按钮 ✗
              //     → 挪到**标题这一行**（这一行永远看得见）✓
              React.createElement(
                "button",
                {
                  style: S.btn,
                  title: "找出库里「几乎一样」的记忆。自动去重只管召回和导入，管不到已经存着的。真重复能一键合；「汇总+明细」会列出来让你自己挑；合之前自动备份",
                  onClick: () => 去查重(s)
                },
                "查重"
              ),
              // ⭐⭐ 2026-09-22（她要的）：**批量删除** —— 勾了几条就显示几条
              //   ⚠ 二次确认：点这里**不删**，只出确认条；确认条上再点「确定删」才真删 ✓
              已选几条 > 0 ? React.createElement(
                "button",
                {
                  style: S.btnDanger,
                  title: "把勾上的这几条收进「已删」（不是销毁，能找回来）。点它不会直接删，会先问一遍",
                  onClick: () => set批删问(true)
                },
                "批量删（" + 已选几条 + "）"
              ) : null,
              已选几条 > 0 ? React.createElement(
                "button",
                { style: S.btn, onClick: () => {
                  set选中({});
                  set批删问(false);
                } },
                "取消勾选"
              ) : null
            ),
            // ⭐ 2026-09-24：折叠着也能一眼看出「记了时间的」有多少 ——
            //   反馈那个「中间一坨」的根源就是 850 条里只有 188 条有日期，
            //   这个数字摆在标题下面，心里有底 ✓
            React.createElement(
              "div",
              { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2 }) },
              "记了时间的 " + 有时间数 + " 条 · 没记时间的 " + 没时间数 + " 条" + (看哪边 === "全部" ? "" : "（现在只看" + (看哪边 === "有时间" ? "记了时间的" : "没记时间的") + "）")
            ),
            看记忆 ? React.createElement(
              "div",
              null,
              // ---- 检索框：几百条的时候，靠翻是翻不到的 ----
              React.createElement(
                "div",
                { style: S.nameBox },
                React.createElement("div", { style: { flex: "none", width: 44 } }, "找"),
                React.createElement("input", {
                  style: Object.assign({}, S.inp, { flex: 1, width: "auto", minWidth: 140 }),
                  placeholder: "打几个字，只留含它的（正文、原文、检索词、来源都能搜）",
                  value: 搜词,
                  onChange: (e) => set搜词(e.target.value)
                }),
                搜词 ? React.createElement("button", { style: S.btn, onClick: () => set搜词("") }, "清掉") : null,
                // ⭐ 2026-11-01（她要的）：**改成下拉单选** —— 原来点一下轮一种要来回点，
                //   而且「全局 / 工作区 / 会话」这三个作用域也该能直接筛（单选，不做多选）。
                React.createElement(
                  "select",
                  {
                    style: Object.assign({}, S.inp, {
                      flex: "none",
                      width: "auto",
                      fontSize: 12,
                      padding: "2px 4px"
                    }),
                    value: 看哪边,
                    title: "选一种看法。「全部」那个视图里，不会淡的收在一个折叠的分组里（外面只剩会淡的）",
                    onChange: (e) => set看哪边(e.target.value)
                  },
                  [
                    ["全部", "看：全部（" + 活着的.length + "）"],
                    ["有时间", "只记了时间的（" + 有时间数 + "）"],
                    ["没时间", "只有没记时间的（" + 没时间数 + "）"],
                    ["长期事实", "不会淡的（" + 事实总数 + "）"],
                    ["会淡的", "会淡的（" + 会淡总数 + "）"],
                    ["全局", "── 全局事实（" + 全局数 + "）"],
                    ["工作区", "── 工作区记忆（" + 工区数 + "）"],
                    ["会话", "── 这个会话的（" + 会话数 + "）"]
                  ].map(([k, t]) => React.createElement("option", { key: k, value: k }, t))
                ),
                // ⭐ 顺序开关：按日期排，默认「日期新的在前」
                //   （851 条里只画前 200 条，不排的话看到的永远是最老的）
                React.createElement(
                  "button",
                  {
                    style: S.btn,
                    title: "按最左边的日期排。没写日期的排在最后 —— 它们不知道是什么时候的事",
                    onClick: () => set顺序(顺序 === "新" ? "旧" : "新")
                  },
                  "日期：" + (顺序 === "新" ? "新的在前" : "老的在前")
                ),
                // ⭐ 补日期：从正文里认出日期，只补没日期的（补之前自动备份）
                没日期的 > 0 ? React.createElement(
                  "button",
                  {
                    style: S.btn,
                    title: "从正文里认出日期（09-17、8月26日…）。只补没日期的，已有的不动；补之前会自动备份",
                    onClick: () => setConfirm({ id: "*", kind: "backfill" })
                  },
                  "补日期（" + 没日期的 + "）"
                ) : null,
                // ⭐⭐ 2026-09-22：补标「永远不淡」——
                //   提炼原来只改重要度、不碰分类，所以老记忆该不淡的没标上
                没判过的 > 0 ? React.createElement(
                  "button",
                  {
                    style: S.btn,
                    title: "拿模型一条条判「该不该一直记得」，判成要记一辈子的就标成「永远不淡」（会收进「长期事实」那一栏）。判过的不会重复问；动之前自动备份",
                    onClick: () => setConfirm({ id: "*", kind: "stable" })
                  },
                  "补标不淡（" + 没判过的 + "）"
                ) : null,
                // ⭐ 2026-09-22（反馈「判定太松了就得改」）：判据改严之后，
                //   **已经判过的那批得用新判据重来一遍** —— 否则老结果一直留着 ✗
                判过的 > 0 ? React.createElement(
                  "button",
                  {
                    style: S.btn,
                    title: "把所有「判过」的标记清掉，用现在的判据从头判一遍。判据改过之后要用这个 —— 不然老结果一直留着。会重新调模型，动之前自动备份",
                    onClick: () => setConfirm({ id: "*", kind: "restable" })
                  },
                  "重判一遍（" + 判过的 + "）"
                ) : null,
                // ⭐⭐ 2026-09-23（第三步）：**老数据清洗补键** ✓
                //   提炼只管以后；老条目本来就没键 → 这里单独过一遍
                //   ⚠ 先「试几条」再真洗 —— 一条命令改几百条，得让她先看一眼 ✓
                //   ⚠⚠ 按钮上**不许写「清洗补键」** —— 那是我自己造的词，她看不懂 ✗
                //     改成说**它有什么用**：「讲同一件事的，只留最新那条」
                没键的 > 0 ? React.createElement(
                  "button",
                  {
                    style: S.btn,
                    title: "让老记忆认出「讲的是同一件事」。\n比如「她身高一米七」和「她身高一米六八」是同一件事 —— 认出来之后只留最新那条，旧的收起来（还能恢复）。\n光看句子像不像认不出来，所以要一条条问模型。\n⚠ 先点「试 8 条看看」看一眼它标的对不对，再决定要不要全跑。",
                    onClick: () => setConfirm({ id: "*", kind: "washkeys" })
                  },
                  "同一件事只留最新（" + 没键的 + "）"
                ) : null,
                // 补过了就想退回来（几百条自动改的，得能一键回到洗之前）✓
                可撤的 > 0 ? React.createElement(
                  "button",
                  {
                    style: S.btn,
                    title: "把这次自动标的全撤掉、顺手收起来的也全放回来 —— 回到没跑之前。\n（只撤自动标的 —— 你自己填的那些不动）",
                    onClick: () => setConfirm({ id: "*", kind: "unwashkeys" })
                  },
                  "撤掉这次标的（" + 可撤的 + "）"
                ) : null
              ),
              // ⭐⭐ 2026-09-23：她说了「这个让人看不懂，写通俗一点的」——
              //   光按钮上有个名字不够，旁边得有一句人话解释它到底干嘛 ✓
              //   （只在按钮露着的时候出现，平时不占地方）
              没键的 > 0 ? React.createElement(
                "div",
                { style: Object.assign({}, S.dim, { fontSize: 11, margin: "4px 0 0" }) },
                "「同一件事只留最新」是干嘛的：给老记忆一条条标上「这条讲的是哪件事」。标好之后，讲同一件事的只留最新那条，旧的收起来（还能恢复）。"
              ) : null,
              // ⭐⭐ 2026-09-23：跑过之后跟她交代一句「剩下的去哪儿了」✓
              //   模型会把一批判成「这条不用标」（一次性的、拿不准的）——
              //   那种**不标但算问过了**。不说明的话她会以为漏了/白跑了 ✗
              判留空的 > 0 ? React.createElement(
                "div",
                { style: Object.assign({}, S.dim, { fontSize: 11, margin: "4px 0 0" }) },
                "（另外 " + 判留空的 + " 条，模型看了说「这条不用标」—— 一次性的、或者拿不准的。那种一个字都没改，也不会再问一遍 ✓）"
              ) : null,
              confirm && confirm.kind === "stable" ? React.createElement(
                "div",
                { style: S.askBox },
                React.createElement(
                  "div",
                  { style: { flex: 1 } },
                  "拿模型判一遍这 " + 没判过的 + " 条该不该「永远不淡」？",
                  React.createElement(
                    "div",
                    { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2 }) },
                    "会调用模型（走你 DSH 里那个），一批 20 条慢慢跑。判过的不会重复问。"
                  )
                ),
                React.createElement("button", { style: S.btnDanger, disabled: busy, onClick: () => 补不淡(false) }, busy ? "判着呢…" : "开始"),
                React.createElement("button", { style: S.btn, onClick: () => setConfirm(null) }, "算了")
              ) : null,
              // ⭐ 重判：判据改过之后，把老结果清掉重来 ✓
              confirm && confirm.kind === "restable" ? React.createElement(
                "div",
                { style: S.askBox },
                React.createElement(
                  "div",
                  { style: { flex: 1 } },
                  "把 " + 判过的 + " 条的「判过」标记全清掉，用现在的判据重判一遍？",
                  React.createElement(
                    "div",
                    { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2 }) },
                    "判据改过之后要用这个 —— 不然老结果一直留着。会重新调模型（全库 " + (s.memories || []).length + " 条，一批 20 条），动之前自动备份。"
                  )
                ),
                React.createElement("button", { style: S.btnDanger, disabled: busy, onClick: () => 补不淡(true) }, busy ? "判着呢…" : "重判"),
                React.createElement("button", { style: S.btn, onClick: () => setConfirm(null) }, "算了")
              ) : null,
              // ⭐⭐ 2026-09-23：清洗补键 —— 先「试几条」✓
              confirm && confirm.kind === "washkeys" ? React.createElement(
                "div",
                { style: S.askBox },
                React.createElement(
                  "div",
                  { style: { flex: 1 } },
                  "这 " + 没键的 + " 条老记忆，让它们认出「讲的是同一件事」？",
                  React.createElement(
                    "div",
                    { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2 }) },
                    "每条记忆贴一个说明：「这条讲的是哪件事」。讲同一件事的，以后只留最新那条，旧的收起来（还能恢复）—— 就不用再靠「句子像不像」去猜了。会调用模型（走你 DSH 里那个），一批 8 条慢慢跑，只在设置页跑、不碰对话。动之前自动备份。"
                  )
                ),
                React.createElement("button", { style: S.btn, disabled: busy, onClick: () => 洗键(true) }, busy ? "跑着呢…" : "先试 8 条看看"),
                React.createElement("button", { style: S.btnDanger, disabled: busy, onClick: () => 洗键(false) }, busy ? "跑着呢…" : "全部开始"),
                React.createElement("button", { style: S.btn, onClick: () => setConfirm(null) }, "算了")
              ) : null,
              // 撤退：把这次自动标的全撤掉
              confirm && confirm.kind === "unwashkeys" ? React.createElement(
                "div",
                { style: S.askBox },
                React.createElement(
                  "div",
                  { style: { flex: 1 } },
                  "把这次自动标的 " + 可撤的 + " 条全撤掉、顺手收起来的也全放回来？",
                  React.createElement(
                    "div",
                    { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2 }) },
                    "回到没跑之前的样子。只撤自动标的 —— 你自己填的那些不动。记忆本身一条都不会被删。"
                  )
                ),
                React.createElement("button", { style: S.btnDanger, disabled: busy, onClick: 撤销洗键 }, busy ? "撤着呢…" : "撤掉"),
                React.createElement("button", { style: S.btn, onClick: () => setConfirm(null) }, "算了")
              ) : null,
              // ⭐⭐ 2026-09-23：**进度条**（跟补标那条分开，不互相盖）✓
              洗键进度.在跑 && 洗键进度.总 > 0 ? (() => {
                const 百 = Math.round(洗键进度.已 / 洗键进度.总 * 100);
                return React.createElement(
                  "div",
                  { style: Object.assign({}, S.editBox, { marginTop: 8 }) },
                  React.createElement(
                    "div",
                    { style: { fontSize: 13, marginBottom: 4 } },
                    "⭐ 正在认「讲的是同一件事」" + (洗键进度.干跑 ? "（先试几条）" : "") + "　跑着呢"
                  ),
                  React.createElement(
                    "div",
                    { style: { fontSize: 12, color: "#8a6d3b" } },
                    "已过 " + 洗键进度.已 + " / " + 洗键进度.总 + " 条（" + 百 + "%）　还剩 " + Math.max(0, 洗键进度.总 - 洗键进度.已) + " 条　（每批 8 条，跑着就动）"
                  )
                );
              })() : null,
              // ⭐⭐ 2026-09-22（她要的）：**补标/重判的进度条，就贴在按钮这一行下面** ✓
              //   点了才出现，没点就没有 —— 不跟提炼/扩词那条挤在一起 ✓
              补标进度.在跑 && 补标进度.总 > 0 ? (() => {
                const 百 = Math.round(补标进度.已 / 补标进度.总 * 100);
                return React.createElement(
                  "div",
                  { style: Object.assign({}, S.editBox, { marginTop: 8 }) },
                  React.createElement(
                    "div",
                    { style: { fontSize: 13, marginBottom: 4 } },
                    "⭐ " + (补标进度.重判 ? "重判一遍" : "补标不淡") + "　跑着呢"
                  ),
                  React.createElement(
                    "div",
                    { style: S.barOut },
                    React.createElement("div", { style: Object.assign({}, S.barIn, { width: 百 + "%" }) })
                  ),
                  React.createElement(
                    "div",
                    { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 4 }) },
                    "已判 " + 补标进度.已 + " / " + 补标进度.总 + " 条（" + 百 + "%）　还剩 " + Math.max(0, 补标进度.总 - 补标进度.已) + " 条" + (补标进度.等 ? "　⚠ 撞限流了，正在等 " + 补标进度.等 + " 秒" : "　（每批 20 条，跑着就动）")
                  )
                );
              })() : null,
              // ⭐⭐ 2026-09-22（她要的）：**批量删的二次确认条** ✓
              //   第一次点是「批量删（N）」，出这条；第二次点「确定删」才真删 ✓
              批删问 && 已选几条 > 0 ? React.createElement(
                "div",
                { style: S.confirm },
                React.createElement(
                  "div",
                  { style: { flex: 1 } },
                  "要删掉这 " + 已选几条 + " 条吗？",
                  React.createElement(
                    "div",
                    { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2 }) },
                    "不是销毁 —— 收进「已删」里，点开还能找回来。动之前也会自动备份。"
                  ),
                  // ⭐ 1.4.0：里面混了全局事实就单说一句（这些删了所有会话都会忘）
                  已选事实 > 0 ? React.createElement(
                    "div",
                    { style: Object.assign({}, S.warn, { fontSize: 12, marginTop: 2 }) },
                    "⚠ 其中有 " + 已选事实 + " 条是全局事实 —— 删了所有会话都会忘。"
                  ) : null
                ),
                React.createElement("button", { style: S.btnDanger, disabled: busy, onClick: () => 批删(s) }, busy ? "删着…" : "确定删（" + 已选几条 + " 条）"),
                React.createElement("button", { style: S.btn, onClick: () => set批删问(false) }, "算了")
              ) : null,
              // ⚠⚠ 2026-09-22（我发现的）：`notes` 原来**只在第一级**渲染 ——
              //   而会话详情是 `if (open) return …` **提前返回**的，
              //   所以在详情页里 setNotes 的东西**一个字都看不到** ✗
              //   「补日期」「补标不淡」「查重」的结果提示全落在这儿 → 补一份 ✓
              notes && notes.length ? React.createElement(
                "div",
                { style: Object.assign({}, S.warn, { margin: "8px 0", fontSize: 12, whiteSpace: "pre-line" }) },
                "　· " + notes.join("\n　· ")
              ) : null,
              // ⭐⭐ 2026-09-22（她的第十件）：**从会话导出档案** 的面板
              //   四步分开 —— 因为第三步**调模型、花钱**，得让人看清再点 ✓
              查重 && 查重开 ? React.createElement(
                "div",
                { style: Object.assign({}, S.editBox, { marginTop: 8 }) },
                [
                  React.createElement(
                    "div",
                    { key: "头", style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
                    React.createElement("b", null, "查重："),
                    React.createElement("span", null, (查重.组 || []).length + " 组、能少 " + 查重.能少 + " 条"),
                    React.createElement(
                      "span",
                      { style: S.dim },
                      "（真重复 " + 查重.真重复组数 + " 组 / 汇总+明细 " + 查重.汇总组数 + " 组）"
                    ),
                    React.createElement(
                      "button",
                      { style: S.btn, disabled: busy || !查重.真重复组数, onClick: () => 合重复(s, true) },
                      "一键合真重复（" + 查重.真重复组数 + " 组）"
                    ),
                    React.createElement(
                      "button",
                      {
                        style: S.btn,
                        disabled: busy || !(查重.组 || []).some((g, i) => 查重合[i]),
                        onClick: () => 合重复(s, false)
                      },
                      "按我勾的合（" + (查重.组 || []).filter((g, i) => 查重合[i]).length + " 组、少 " + (查重.组 || []).reduce((a, g, i) => a + (查重合[i] ? g.条们.length - 1 : 0), 0) + " 条）"
                    ),
                    React.createElement(
                      "button",
                      {
                        style: S.btn,
                        title: "把「汇总+明细」那些也勾上。⚠ 一长一短，合了会丢短的里的细节",
                        onClick: () => {
                          const 全 = {};
                          (查重.组 || []).forEach((g, i) => {
                            全[i] = true;
                          });
                          set查重合(全);
                        }
                      },
                      "把「汇总+明细」也全勾上"
                    ),
                    React.createElement("button", { style: S.btn, onClick: () => {
                      set查重(null);
                      set查重开(false);
                    } }, "收起")
                  ),
                  React.createElement(
                    "div",
                    { key: "说明", style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 4 }) },
                    "「真重复」= 两条长度差不多，合了安全，默认勾上；「汇总+明细」= 一长一短（长的把短的包住了），默认不勾 —— 长的那条未必真的包含了短的每个细节，合了会丢东西。要合哪一组，自己勾那一组。合掉的不销毁，收在「已删」里。"
                  )
                ].concat(
                  (查重.组 || []).slice(0, 60).map(
                    (g, i) => React.createElement(
                      "div",
                      {
                        key: "g" + i,
                        style: { marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(128,128,128,.18)" }
                      },
                      [
                        React.createElement(
                          "div",
                          {
                            key: "h",
                            style: { fontSize: 12, marginBottom: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }
                          },
                          // ⭐⭐ 2026-09-23：每组一个「要合」的勾 —— 不勾的组「按我勾的合」不会碰 ✓
                          React.createElement("input", {
                            key: "c",
                            type: "checkbox",
                            checked: !!查重合[i],
                            title: "勾上它，这一组才会被「按我勾的合」合掉",
                            onChange: () => set查重合(Object.assign({}, 查重合, { [i]: !查重合[i] }))
                          }),
                          "第 " + (i + 1) + " 组 · " + g.条们.length + " 条 · ",
                          React.createElement("b", { style: g.类型 === "真重复" ? S.ok : S.warn }, g.类型),
                          查重合[i] ? null : React.createElement(
                            "span",
                            { style: Object.assign({}, S.dim, { fontSize: 11 }) },
                            "（不参与）"
                          )
                        )
                      ].concat(
                        g.条们.map(
                          (t) => React.createElement(
                            "label",
                            {
                              key: t.id,
                              style: { display: "flex", gap: 6, alignItems: "flex-start", padding: "3px 0", cursor: "pointer" }
                            },
                            [
                              React.createElement("input", {
                                key: "r",
                                type: "radio",
                                name: "查重组" + i,
                                checked: 查重选[i] === t.id,
                                onChange: () => set查重选(Object.assign({}, 查重选, { [i]: t.id }))
                              }),
                              React.createElement(
                                "span",
                                { key: "t", style: { flex: 1, minWidth: 0, overflowWrap: "anywhere" } },
                                t.text
                              ),
                              React.createElement(
                                "span",
                                { key: "n", style: Object.assign({}, S.dim, { fontSize: 11, whiteSpace: "nowrap" }) },
                                t.长 + " 字"
                              )
                            ]
                          )
                        )
                      )
                    )
                  )
                ).concat(
                  (查重.组 || []).length > 60 ? [
                    React.createElement(
                      "div",
                      { key: "更多", style: Object.assign({}, S.dim, { marginTop: 8 }) },
                      "（只画了前 60 组，先合这些再点一次查重）"
                    )
                  ] : []
                )
              ) : null,
              confirm && confirm.kind === "backfill" ? React.createElement(
                "div",
                { style: S.confirm },
                React.createElement("span", { style: { flex: 1 } }, "从正文里补日期？只补那 " + 没日期的 + " 条没日期的，已有的不动（补之前会自动备份）。"),
                React.createElement("button", { style: S.btn, onClick: 补日期 }, "补"),
                React.createElement("button", { style: S.btn, onClick: () => setConfirm(null) }, "算了")
              ) : null,
              搜词 || 看哪边 !== "全部" ? React.createElement(
                "div",
                { style: Object.assign({}, S.dim, { fontSize: 12, margin: "0 0 6px" }) },
                // ⭐ 1.4.0：分母也拆开报（事实全局共享 / 事件本会话）—— 只看合并总数会以为「都是这儿的」
                "这里 " + 过滤后.length + " 条 / 共 " + s.memories.length + " 条（事实 " + 数事实(s) + " · 事件 " + 数事件(s) + "）" + (看哪边 === "有时间" ? "（只看记了时间的）" : 看哪边 === "没时间" ? "（只看没记时间的）" : "") + (过滤后.length === 0 ? " —— 换几个字试试，或者点上面的「看」换个范围" : "")
              ) : null,
              React.createElement(
                "div",
                { style: { marginTop: 10 } },
                过滤后.length === 0 ? React.createElement(
                  "div",
                  { style: S.dim },
                  搜词 ? "（没有含「" + 搜词 + "」的）" : "（这个范围里没有记忆）"
                ) : (() => {
                  const 上 = 画这个.slice(0, 画全部 ? 画这个.length : 一次最多画);
                  if (看哪边 !== "全部" || 搜词) return 上.map(一条记忆);
                  const 会淡的 = 上.filter((m) => !不会淡(m));
                  const 不淡的 = 上.filter(不会淡);
                  return [
                    ...会淡的.map(一条记忆),
                    不淡的.length ? React.createElement(
                      "div",
                      { key: "事实组" },
                      React.createElement(
                        "div",
                        {
                          style: Object.assign({}, S.h, { cursor: "pointer", marginTop: 14 }),
                          onClick: () => set看事实(!看事实)
                        },
                        (看事实 ? "▾ " : "▸ ") + "不会淡的 · 长期事实（" + 不淡的.length + " 条，全局共享）"
                      ),
                      React.createElement(
                        "div",
                        { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 4 }) },
                        "里面这些是长期事实（要记一辈子的事，不会淡）—— 存在全局库里，所有会话都读得到；在这儿删一条，哪儿都会忘。外面那些都会淡 —— 包括没记时间的（它们从「记下来的那天」开始淡）。"
                      ),
                      看事实 ? 不淡的.map(一条记忆) : null
                    ) : null
                  ];
                })()
              ),
              过滤后.length > 一次最多画 ? React.createElement(
                "div",
                { style: { margin: "6px 0 0", fontSize: 12 } },
                画全部 ? React.createElement("span", { style: S.link, onClick: () => set画全部(false) }, "↑ 收起来（只画前 " + 一次最多画 + " 条）") : React.createElement(
                  "span",
                  { style: S.link, onClick: () => set画全部(true) },
                  "还有 " + (过滤后.length - 一次最多画) + " 条" + (看哪边 === "没时间" ? "（更早记的）" : 顺序 === "新" ? "（更早的）" : "（更新的）") + "没画出来 —— 点这里全部显示（多了会卡）"
                )
              ) : null
            ) : null,
            React.createElement(
              "div",
              null,
              React.createElement("div", { style: Object.assign({}, S.h, S.part, { cursor: "pointer" }), onClick: () => setShowDeleted(!showDeleted) }, (showDeleted ? "▾ " : "▸ ") + "已删掉的（" + (已删.length + 被取代的.length) + "）"),
              React.createElement("div", { style: S.dim }, "收起来的记忆不会被注入，但还留着，随时能找回来。"),
              showDeleted ? React.createElement(
                "div",
                { style: { marginTop: 6 } },
                // ⭐⭐ 2026-09-22（反馈「你放在最下面的呀，你改到最上面去，
                //     谁那么多条？如果有100条，我得翻到最下面才能全选吗？」）：
                //   工具条原来在**列表最下面** —— 68 条就得翻到底才能点「全选」✗
                //   → 挪到**最上面**，跟标题挨着 ✓
                // ⭐⭐ 2026-09-23（反馈「点『清空』之后提示在最下面，看都看不到」）：
                //   确认条原来渲染在**列表下面** —— 68 条就得翻到底才看得见那两句问话 ✗
                //   （跟 0.9.7 修过的「工具条在最下面」是同一个毛病）
                //   → 改成**就地替换工具条**：两样都在最上面，点了「清空」，
                //     工具条那一格立刻变成确认条，不用滚 ✓
                已删.length > 0 && confirm && confirm.kind === "purgeall" ? 确认条("把收着的 " + 已删.length + " 条全清掉？找不回来了。", "全清掉", "purgeall", "*") : null,
                // ⭐⭐ 2026-09-23（反馈「这里没有批量找回呀」）：批量找回的确认
                //   ⚠ 这个**不是销毁**（是往回捞），所以文案跟「清掉」正好相反
                已删.length > 0 && !(confirm && confirm.kind === "purgeall") && 批回问 ? React.createElement(
                  "div",
                  { style: S.confirm },
                  React.createElement(
                    "div",
                    { style: { flex: 1 } },
                    批回问.只合并 ? "把「合并掉的」那 " + 已删.filter((m) => m.合并掉的 === true).length + " 条全捞回来？" : "把勾上的这 " + 已选清几条 + " 条捞回来？",
                    React.createElement(
                      "div",
                      { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2 }) },
                      "捞回来之后它们又会被注入（跟原来一样）。不是销毁，随时能再删。"
                    )
                  ),
                  React.createElement("button", { style: S.btn, disabled: busy, onClick: () => 批回(s, 批回问.只合并) }, busy ? "捞着…" : "确定找回"),
                  React.createElement("button", { style: S.btn, onClick: () => set批回问(false) }, "算了")
                ) : null,
                已删.length > 0 && !(confirm && confirm.kind === "purgeall") && !批回问 && 批清问 && 已选清几条 > 0 ? React.createElement(
                  "div",
                  { style: S.confirm },
                  React.createElement(
                    "div",
                    { style: { flex: 1 } },
                    "要彻底清掉这 " + 已选清几条 + " 条吗？",
                    React.createElement(
                      "div",
                      { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2 }) },
                      "清掉就找不回来了（备份目录里可能还有一份）。想留就用「找回来」。"
                    )
                  ),
                  React.createElement("button", { style: S.btnDanger, disabled: busy, onClick: () => 批清(s) }, busy ? "清着…" : "确定清掉（" + 已选清几条 + " 条）"),
                  React.createElement("button", { style: S.btn, onClick: () => set批清问(false) }, "算了")
                ) : null,
                已删.length > 0 && !(confirm && confirm.kind === "purgeall") && !批回问 && !(批清问 && 已选清几条 > 0) ? React.createElement(
                  "div",
                  { style: { margin: "8px 0", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" } },
                  // ⭐ 一键全选 ✓
                  React.createElement(
                    "button",
                    {
                      style: S.btn,
                      title: "把这一栏里的全勾上（再点一下取消）",
                      onClick: () => {
                        if (已选清几条 === 已删.length) {
                          set选中清({});
                          set批清问(false);
                          return;
                        }
                        const 全 = {};
                        for (const m of 已删) 全[m.id] = true;
                        set选中清(全);
                      }
                    },
                    已选清几条 === 已删.length && 已删.length > 0 ? "取消全选" : "全选（" + 已删.length + "）"
                  ),
                  // ⭐ 批量清掉（勾了几条就显示几条）—— 点了**不直接清**，先问一遍 ✓
                  已选清几条 > 0 ? React.createElement(
                    "button",
                    { style: S.btnDanger, onClick: () => set批清问(true) },
                    "批量清掉（" + 已选清几条 + "）"
                  ) : null,
                  // ⭐⭐ 2026-09-23（反馈「这里没有批量找回呀」）：**批量找回** ✓
                  已选清几条 > 0 ? React.createElement(
                    "button",
                    {
                      style: S.btn,
                      title: "把勾上的这几条从「已删」里捞回来（不是销毁，随时能再删）",
                      onClick: () => set批回问({ 只合并: false })
                    },
                    "批量找回（" + 已选清几条 + "）"
                  ) : null,
                  // ⭐ 一键撤销整次合并：把「合并掉的」那批全捞回来 ✓
                  已删.filter((m) => m.合并掉的 === true).length > 0 ? React.createElement(
                    "button",
                    {
                      style: S.btn,
                      title: "把「合并掉的」那批全捞回来 —— 等于撤销整次合并",
                      onClick: () => set批回问({ 只合并: true })
                    },
                    "撤销合并：全找回（" + 已删.filter((m) => m.合并掉的 === true).length + "）"
                  ) : null,
                  已选清几条 > 0 ? React.createElement(
                    "button",
                    { style: S.btn, onClick: () => {
                      set选中清({});
                      set批清问(false);
                      set批回问(false);
                    } },
                    "取消勾选"
                  ) : null,
                  React.createElement("button", { style: S.btn, onClick: () => setConfirm({ id: "*", kind: "purgeall" }) }, "把「已删掉的」清空")
                ) : null,
                已删.length === 0 ? React.createElement("div", { style: S.dim }, "（空的）") : 已删.map(
                  (m) => React.createElement(
                    "div",
                    { key: m.id, style: S.条 },
                    React.createElement(
                      "div",
                      { style: S.row },
                      // ⭐ 批量清掉：行首一个勾选框（跟上面那栏一样）
                      React.createElement("input", {
                        type: "checkbox",
                        checked: !!选中清[m.id],
                        title: "勾上它，再点上面的「批量清掉」",
                        onChange: () => set选中清(Object.assign({}, 选中清, { [m.id]: !选中清[m.id] }))
                      }),
                      React.createElement("div", { style: Object.assign({}, S.dim, { width: 108, flex: "none" }) }, "收于 " + rel(m.deletedAt, now)),
                      React.createElement("div", { style: Object.assign({}, S.dim, { flex: 1, minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }) }, m.text),
                      React.createElement("div", { style: Object.assign({}, S.link, { flex: "none", fontSize: 12, marginRight: 10 }), onClick: () => 删(m.id, "restore") }, "找回来"),
                      React.createElement("div", { style: Object.assign({}, S.drop, { flex: "none", fontSize: 12, cursor: "pointer" }), onClick: () => setConfirm({ id: m.id, kind: "purge" }) }, "彻底清掉")
                    ),
                    confirm && confirm.id === m.id && confirm.kind === "purge" ? 确认条("彻底清掉就找不回来了（备份里可能还有）。", "确认清掉", "purge", m.id) : null
                  )
                ),
                // ⭐⭐ 2026-09-24（她说的「那已被取代应该回回收站呀」）：
                //   **被取代的**从主列表挪出来，收在回收站里（就在这一栏下面）✓
                //   ⚠ 放在 `showDeleted ?` **里面** —— 跟回收站一起折叠 ✓
                //     （放外面的话，回收站收起来了它们还杵在那儿，看着像两栏）
                //
                //   ⚠⚠ 它们**不在 `s.deleted` 里** —— 所以上面那排
                //     「全选 / 批量清掉 / 把已删掉的清空」**碰不到它们**，
                //     这是故意的：被取代是自动标的（可能几百条），
                //     不该被「清空」连坐销毁（丢 157 条那次的教训）✗✗
                被取代的.length ? React.createElement(
                  "div",
                  null,
                  React.createElement(
                    "div",
                    { style: Object.assign({}, S.h, { marginTop: 16 }) },
                    "被取代的（" + 被取代的.length + "）"
                  ),
                  React.createElement(
                    "div",
                    { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 4 }) },
                    "这些是「讲的是同一件事」里比较旧的那条，自动收起来的 —— 不再被注入，但东西还留着。"
                  ),
                  React.createElement(
                    "div",
                    { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 4 }) },
                    "⚠ 「清空」不会清掉它们（只有你亲手删的那些才会被清掉）。想让它回来就点「恢复」。"
                  ),
                  被取代的.map(
                    (m) => React.createElement(
                      "div",
                      { key: m.id, style: S.条 },
                      React.createElement(
                        "div",
                        { style: S.row },
                        React.createElement(
                          "div",
                          { style: Object.assign({}, S.dim, { width: 108, flex: "none" }) },
                          m.已被取代 && m.已被取代.作废于 ? "收于 " + rel(m.已被取代.作废于, now) : "收起来了"
                        ),
                        React.createElement(
                          "div",
                          { style: { flex: "1 1 260px", minWidth: 200, overflowWrap: "anywhere", wordBreak: "break-word" } },
                          React.createElement(
                            "span",
                            { style: Object.assign({}, S.dim, { textDecoration: "line-through", opacity: 0.62 }) },
                            m.text
                          )
                        ),
                        React.createElement(
                          "div",
                          {
                            style: Object.assign({}, S.link, { flex: "none", fontSize: 12 }),
                            title: "让它回来 —— 又能被想起来了（标错了 / 状态又变回来了）",
                            onClick: () => 撤销作废(m.id)
                          },
                          "恢复"
                        )
                      ),
                      m.已被取代 && m.已被取代.为什么 ? React.createElement(
                        "div",
                        {
                          style: Object.assign({}, S.dim, {
                            margin: "0 0 6px 104px",
                            fontSize: 11,
                            overflowWrap: "anywhere",
                            wordBreak: "break-word"
                          })
                        },
                        "为什么收起来：" + m.已被取代.为什么
                      ) : null
                    )
                  )
                ) : null
                // ⚠ 工具条和两个确认条**都在上面**了（见前面那段）——
                //   原来「批量清掉」和「清空」的确认条渲染在这儿（列表最下面），
                //   条数一多就看不见 ✗ → 挪走了，这里不再重复 ✓
              ) : null
            )
            // ⭐ 2026-10-28：这一行往下原来排着「提炼 / 扩词」「从旧档案导入」「备份」三块 ——
            //   现在分别进了 页签③导入 / 页签④记录 里，这儿只负责收尾 ✓
          ),
          // ← 收住「记忆」那一页（自己加一条 + 记忆列表 + 已删掉的）
          // ---- 页签③ 导入记录：这个会话导过哪几批（只读）+ 撤销这一批 ----
          React.createElement(
            "div",
            { style: { display: 详情页 === "导入记录" ? "block" : "none" } },
            React.createElement(导入记录页, { open, load })
          ),
          渲染召回记录页签({ React, S, s, tr, 详情页 }),
          // 1.12.86: 「补记」进会话详情当页签 —— 所有内容都针对这个会话，不再是外面那个要选会话的页面
          React.createElement(
            "div",
            { style: { display: 详情页 === "补记" ? "block" : "none" } },
            补记页 ? React.createElement(补记页, { 初始会话: s.id }) : null
          )
        );
      }
      const 可见会话 = (d && d.sessions || []).filter((s) => {
        if (选中区 && 区会话 && !区会话.has(s.id)) return false;
        if (会话搜) {
          const q = 会话搜.toLowerCase();
          if (!String(s.title || s.id || "").toLowerCase().includes(q)) return false;
        }
        return true;
      });
      return React.createElement(
        "div",
        { style: S.wrap },
        // ⭐ 1.4.2：以前顶上摆「鱼的记忆 v…」+ 一句「哪些会话用记忆」，然后十来块平铺 ——
        //   没有分区，看不出哪块管什么。现在：一句总说明 + 两张卡（记不记 / 会话）✓
        React.createElement(
          "div",
          { style: Object.assign({}, S.dim, { marginBottom: 12, fontSize: 12 }) },
          "每个会话都能记、也能读。记下来的分两种：所有会话共享的「事实」，和只属于某个会话的「事件」。"
        ),
        // ── 卡 1：记不记（称呼 + 总开关）──
        React.createElement(
          "div",
          { style: S.sec },
          React.createElement(
            "div",
            { style: S.secH },
            React.createElement("span", { style: S.secTitle }, "记不记"),
            React.createElement("span", { style: S.secTag }, "总开关 · 称呼")
          ),
          React.createElement(
            "div",
            { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 8 }) },
            "装好就是开着的。想给某个会话单独关掉，去下面那张卡点它右边的「关」。"
          ),
          React.createElement(
            "div",
            { style: S.nameBox },
            React.createElement("div", { style: { flex: "none", width: 132 } }, "用户的称呼"),
            React.createElement("input", {
              style: Object.assign({}, S.inp, { width: 90 }),
              placeholder: "ta / 她 / 他",
              value: pronounDraft !== null ? pronounDraft : d.userPronoun || "ta",
              onChange: (e) => setPronounDraft(e.target.value)
            }),
            React.createElement(
              "button",
              {
                style: S.btn,
                onClick: () => {
                  const p = pronounDraft !== null ? pronounDraft : d.userPronoun || "ta";
                  post("/names", { userPronoun: p }).then((r) => {
                    setPronounDraft(null);
                    if (r && r.称呼影响几条 > 0 && !r.称呼已改) setPronounAsk({ n: r.称呼影响几条, to: p, 例子: r.称呼例子 || [] });
                    else setPronounAsk(null);
                    load();
                  });
                }
              },
              "存"
            ),
            React.createElement("span", { style: Object.assign({}, S.dim, { fontSize: 12, flex: 1 }) }, "记忆里提到你时用哪个字。默认「ta」；设成「她」或「他」就按你设的记。")
          ),
          pronounAsk ? React.createElement(
            "div",
            { style: S.askBox },
            React.createElement(
              "div",
              { style: { flex: 1 } },
              React.createElement("div", null, "已有 " + pronounAsk.n + " 条旧记忆里还写着旧的字。要一起改成「" + pronounAsk.to + "」吗？"),
              (pronounAsk.例子 || []).slice(0, 2).map(
                (e, i) => React.createElement("div", { key: i, style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 2 }) }, "　「" + e.旧 + "」→「" + e.新 + "」")
              )
            ),
            React.createElement(
              "button",
              {
                style: S.btn,
                onClick: () => post("/names", { userPronoun: pronounAsk.to, applyToExisting: true }).then(() => {
                  setPronounAsk(null);
                  load();
                })
              },
              "一起改"
            ),
            React.createElement("button", { style: S.btn, onClick: () => setPronounAsk(null) }, "以后再说")
          ) : null,
          // ⭐ 1.3.4：**总开关**（管整个插件）+ 下面每个会话自己的开关
          //   放同一块，是因为它们管的是同一件事（记不记），只是范围不同。
          React.createElement(
            "div",
            { style: Object.assign({}, S.row, S.条, { alignItems: "center" }) },
            React.createElement(
              "button",
              {
                style: Object.assign({}, S.btn, {
                  flex: "none",
                  color: d.全局开关 !== false ? "#8fd0a0" : "inherit",
                  borderColor: d.全局开关 !== false ? "rgba(143,208,160,.6)" : "rgba(128,128,128,.35)"
                }),
                disabled: busy,
                onClick: () => {
                  setBusy(true);
                  post("/global", { on: d.全局开关 === false }).then(() => {
                    setBusy(false);
                    load();
                  }).catch(() => setBusy(false));
                }
              },
              (d.全局开关 !== false ? "● " : "○ ") + "remember 工具"
            ),
            React.createElement(
              "div",
              { style: Object.assign({}, S.dim, { flex: 1, minWidth: 0 }) },
              d.全局开关 !== false ? "所有会话都能记、也能读。单独不想要哪个，用下面那一行关掉。" : "全关着 —— 哪个会话都不记也不读，工具列表里也不会出现它。"
            )
          )
        ),
        // ⭐ 1.8.20：词门健康状态 —— 词典/词频缺失时召回会静默退回老切法，
        //   这里让它在设置页第一眼就能看到（后端 /list 的 lexicon 字段）
        React.createElement(
          "div",
          { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 4 }) },
          d && d.lexicon && d.lexicon.词典 > 0 && d.lexicon.词频 > 0 ? "通用中文词门：词表 " + d.lexicon.词典 + " 词 · 词频 " + d.lexicon.词频 + " 词 ✓" : React.createElement(
            "span",
            { style: { color: "#e8a87c" } },
            "⚠ 词典/词频文件缺失 —— 通用中文词门已失效，召回退回老切法（lib/lexicon.txt、lib/wordfreq.txt）"
          )
        ),
        // ── 卡 2：会话 ──
        React.createElement(
          "div",
          { style: S.sec },
          React.createElement(
            "div",
            { style: S.secH },
            React.createElement("span", { style: S.secTitle }, "会话"),
            React.createElement("span", { style: S.secTag }, "全局事实 " + 全局事实数() + " 条 · 所有会话共享")
          ),
          // ⭐ 1.4.0（需求①）：设置页第一眼就把两笔账分开 ——
          //   全局事实只有一条线（所有会话看到的一样），各会话的事件各报各的 ✓
          React.createElement(
            "div",
            { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 6, overflowWrap: "anywhere" }) },
            "事实是所有会话共享的（在哪个会话里删，哪儿都会忘）；「事件」只属于那个会话。点名字进详情：记忆列表、称呼、从旧档案导入（导完还能提炼 / 扩词）、召回记录，分页签放着。"
          ),
          // ⭐ 2026-11-01 用户要求：工作区记忆层（1.8.37 加的 scope=workspace:<cwd>）一直没界面，
          //   这里拆成两个并列子页签：会话列表 / 工作区记忆 ✓
          React.createElement(
            "div",
            { style: { display: "flex", gap: 6, margin: "2px 0 8px" } },
            ["会话", "工作区记忆"].map(
              (k) => React.createElement(
                "button",
                {
                  key: k,
                  style: Object.assign({}, 子页签 === k ? S.tabOn : S.tabOff, { fontSize: 12, padding: "3px 10px" }),
                  onClick: () => set子页签(k)
                },
                k
              )
            )
          ),
          子页签 === "会话" ? React.createElement(
            "div",
            { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "2px 0 8px" } },
            el(选择器, {
              style: Object.assign({}, S.inp, { width: "auto", minWidth: 150, flex: "none" }),
              值: 选中区,
              选项: [{ v: "", t: "所有工作区" }].concat(
                (区表 || []).map((w) => ({ v: w.id, t: (w.name || "工作区") + "（" + (w.会话数 || 0) + "）" }))
              ),
              onChange: (v) => set选中区(v)
            }),
            React.createElement("input", {
              style: Object.assign({}, S.inp, { width: 150, flex: "none" }),
              placeholder: "按会话名搜…",
              value: 会话搜,
              onChange: (e) => set会话搜(e.target.value)
            }),
            可见会话.length === (d.sessions || []).length ? null : React.createElement("span", { style: Object.assign({}, S.dim, { fontSize: 12 }) }, "筛出 " + 可见会话.length + " 个")
          ) : null,
          子页签 === "会话" && 可见会话.length === 0 ? React.createElement("div", { style: Object.assign({}, S.dim, { fontSize: 12, padding: "8px 2px" }) }, "没有符合条件的会话") : null,
          // ⭐ 1.8.0：从「⋯ → 复制记忆到…」进来 —— 选目标会话，再复制
          子页签 === "会话" && 复制源 ? React.createElement(
            "div",
            { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", margin: "4px 0 8px", borderRadius: 8, border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28))", background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,.07))" } },
            React.createElement("span", { style: { fontSize: 12.5 } }, "把「" + ((d.sessions || []).find((x) => x.id === 复制源) || {}).title + "」的事件复制到"),
            React.createElement(选择器, {
              style: Object.assign({}, S.inp, { width: "auto", minWidth: 180 }),
              值: 复制到,
              选项: [{ v: "", t: "（选一个目标会话）" }].concat(
                (d.sessions || []).filter((x) => x.id !== 复制源).map((x) => ({ v: x.id, t: x.title || x.id.slice(0, 18) }))
              ),
              onChange: (v) => set复制到(v)
            }),
            React.createElement(
              "button",
              {
                style: S.btn,
                disabled: !复制到 || !!busy,
                onClick: () => {
                  setBusy(true);
                  post("/copy-to", { session: 复制源, to: 复制到 }).then(() => {
                    setBusy(false);
                    set复制源("");
                    set复制到("");
                    setNotes(["✓ 复制过去了（目标会话原来的事件已被替换，覆盖前有 .bak）"]);
                    load();
                  }).catch(() => {
                    setBusy(false);
                    setNotes(["✗ 没复制成，看控制台"]);
                  });
                }
              },
              "复制过去"
            ),
            React.createElement("button", { style: S.btn, onClick: () => {
              set复制源("");
              set复制到("");
            } }, "取消")
          ) : null,
          子页签 === "会话" ? 可见会话.map(
            (s) => React.createElement(
              "div",
              { key: s.id, style: Object.assign({}, S.row, S.条) },
              React.createElement(
                "button",
                {
                  style: Object.assign({}, S.btn, {
                    flex: "none",
                    width: 56,
                    color: s.enabled ? "#8fd0a0" : "inherit",
                    borderColor: s.enabled ? "rgba(143,208,160,.6)" : "rgba(128,128,128,.35)"
                  }),
                  disabled: busy,
                  onClick: () => {
                    setBusy(true);
                    post("/toggle", { session: s.id, on: !s.enabled }).then(() => {
                      setBusy(false);
                      load();
                    }).catch(() => setBusy(false));
                  }
                },
                s.enabled ? "● 开" : "○ 关"
              ),
              React.createElement("div", { style: Object.assign({}, S.link, { flex: 1, minWidth: 120, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }), title: s.title || s.id, onClick: () => setOpen(s.id) }, s.title || s.id.slice(0, 24)),
              // ⚠ 在线会话也要渲染这一格（占位 48）—— 不渲染会让后面的列整体左移，看着像排错版
              React.createElement(
                "div",
                { style: Object.assign({}, S.dim, { width: 48, fontSize: 12, flex: "none" }) },
                s.live ? "" : "不在线"
              ),
              // ⭐ 1.4.0（需求①）：一行里分开报 —— 事实是所有会话共享的（每行数字都一样），
              //   事件才是这个会话自己的。只写「525 条」会让人以为是这个会话独有的 ✗
              React.createElement(
                "div",
                {
                  style: Object.assign({}, S.dim, { width: 96, fontSize: 12, flex: "none", whiteSpace: "nowrap" }),
                  title: "这个会话里记下了多少条（所有会话共用的那部分不重复算进来）"
                },
                "记忆 " + 数事件(s) + " 条"
              ),
              React.createElement("div", { style: Object.assign({}, S.dim, { width: 84, flex: "none", whiteSpace: "nowrap" }) }, s.lastTrace ? rel(s.lastTrace, now) : "—"),
              // ⭐ B 轮 F4：静音 —— 这个会话接下来 30 分钟不往上下文里塞记忆（别的会话照常）
              React.createElement(
                "button",
                {
                  style: Object.assign({}, S.btn, { flex: "none", fontSize: 11, padding: "2px 8px" }),
                  title: "接下来 30 分钟不往这个会话里注入记忆（记忆照记，只是先不往上下文里塞；再点一下取消）",
                  disabled: busy,
                  onClick: () => {
                    setBusy(true);
                    post("/pause", { session: s.id, minutes: 30 }).then(() => {
                      setBusy(false);
                      load();
                    }).catch(() => setBusy(false));
                  }
                },
                "静音 30 分"
              ),
              // ⭐ 1.8.0：每行一个 ⋯ ——「复制记忆到…」放这里（复制是会话级动作，不属于详情页）
              React.createElement(
                "div",
                { style: { position: "relative", flex: "none" } },
                React.createElement(
                  "button",
                  {
                    style: Object.assign({}, S.btn, { fontSize: 12, padding: "2px 7px" }),
                    title: "更多",
                    onClick: () => set菜单在(菜单在 === s.id ? "" : s.id)
                  },
                  "⋯"
                ),
                菜单在 === s.id ? React.createElement(
                  "div",
                  {
                    style: {
                      position: "absolute",
                      right: 0,
                      top: "calc(100% + 4px)",
                      zIndex: 70,
                      minWidth: 160,
                      background: "var(--dsw-alias-bg-layer-1, #fff)",
                      border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28))",
                      borderRadius: 8,
                      boxShadow: "0 8px 24px rgba(0,0,0,.22)",
                      padding: 4
                    }
                  },
                  React.createElement(
                    "button",
                    {
                      style: { display: "block", width: "100%", textAlign: "left", padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "none", background: "transparent", color: "var(--dsw-alias-label-primary, inherit)", cursor: "pointer" },
                      onClick: () => {
                        set复制源(s.id);
                        set复制到("");
                        set菜单在("");
                      }
                    },
                    "复制记忆到…"
                  )
                ) : null
              )
            )
          ) : null,
          渲染工作区记忆视图({ React, el, S, 选择器, 子页签, 选中区, set选中区, 区表, 工作区记忆, 删工作区记忆, 看回收站, set看回收站, 找回工作区记忆 })
        )
        // ⭐ 2026-11-01（用户：「把参数整体搬进高级里」）：参数卡从这里整体搬到「高级」页了，
        //   会话页只留会话列表 + 工作区记忆。notes 是参数保存的提示，跟着一起走。
      );
    }
    return { 会话页 };
  }

  // src/client/pages/memories.js
  function 造所有记忆页({ React, el, get, post, B, S, G, rel, 类型名, 类型表, 同日, 归整, 一次最多画, 重要色 }) {
    const 选择器 = 造选择器({ React, el });
    function 所有记忆页(props) {
      const [d, setD] = React.useState(null);
      const [err, setErr] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [提示, set提示] = React.useState(null);
      const [源, set源] = React.useState(null);
      const [搜, set搜] = React.useState("");
      const [作用域, set作用域] = React.useState("全部");
      const [会话, set会话] = React.useState("");
      const [类型, set类型] = React.useState("全部");
      const [状态, set状态] = React.useState("活跃");
      const [画全部, set画全部] = React.useState(false);
      const [在改, set在改] = React.useState(null);
      const [改稿, set改稿] = React.useState("");
      const [改层级, set改层级] = React.useState("global");
      const [要删, set要删] = React.useState(null);
      const [加开, set加开] = React.useState(false);
      const [加正文, set加正文] = React.useState("");
      const [加类型, set加类型] = React.useState("identity");
      const [加重要, set加重要] = React.useState(0.5);
      const [健康, set健康] = React.useState(null);
      const [候选们, set候选们] = React.useState(null);
      const [候选开, set候选开] = React.useState(false);
      const [整理跑, set整理跑] = React.useState(false);
      const [整理话, set整理话] = React.useState("");
      const [查重结果, set查重结果] = React.useState(null);
      const 查重 = async () => {
        set整理跑(true);
        set整理话("正在跟全部会话比……");
        try {
          const r = await get("/duplicates-all");
          if (!r || r.ok === false) set整理话("查重失败：" + (r && r.message || "？"));
          else {
            set查重结果(r);
            set整理话(r.总组 ? "找到 " + r.总组 + " 组完全重复，合并能少 " + r.能少 + " 条（留着的那条不动）" : "没有完全重复的条目");
          }
        } catch (e) {
          set整理话("查重出错：" + String(e && e.message || e));
        }
        set整理跑(false);
      };
      const [补键结果, set补键结果] = React.useState(null);
      const [撤销问, set撤销问] = React.useState(false);
      const 撤全部标 = async () => {
        set撤销问(false);
        set整理跑(true);
        set整理话("正在把这次自动补的键全摘掉……");
        try {
          const r = await post("/wash-keys/undo", {});
          if (!r || r.ok === false) set整理话("撤不回来：" + (r && r.message || "？"));
          else
            set整理话(
              "撤掉了 " + (Number(r.摘了) || 0) + " 条键、清了 " + (Number(r.洗过清) || 0) + " 条「洗过」记号" + (Number(r.恢复) ? "、放回 " + Number(r.恢复) + " 条被收起来的" : "") + "（动了 " + (Number(r.会话数) || 0) + " 个会话）"
            );
        } catch (e) {
          set整理话("撤的时候出错：" + String(e && e.message || e));
        }
        set整理跑(false);
        await 查补键();
      };
      const 查补键 = async () => {
        set整理跑(true);
        set整理话("正在数还剩多少条没标……");
        try {
          const r = await get("/wash-plan");
          if (!r || r.ok === false) set整理话("补键读不出来：" + (r && r.message || "？"));
          else {
            set补键结果(r);
            set整理话(r.总剩 ? "还有 " + r.总剩 + " 条没标「这件事叫什么」（" + r.会话.length + " 个会话）" : "都标过了：库里 " + r.带键 + " 条带键，没有要补的");
          }
        } catch (e) {
          set整理话("补键出错：" + String(e && e.message || e));
        }
        set整理跑(false);
      };
      const 洗一批 = async (sid) => {
        set整理跑(true);
        set整理话("正在让模型给一批补键……（会调模型，按量计费）");
        try {
          const r = await post("/wash-keys", { session: sid, 每批: 20 });
          if (!r || r.ok === false) set整理话("补键失败：" + (r && r.message || "？"));
          else set整理话("这批给键 " + (Number(r.给了键) || 0) + " 条、留空 " + (Number(r.留空) || 0) + " 条，还剩 " + (Number(r.剩) || 0) + " 条");
        } catch (e) {
          set整理话("补键出错：" + String(e && e.message || e));
        }
        set整理跑(false);
        await 查补键();
      };
      const 合并全部 = async () => {
        if (!查重结果 || !Array.isArray(查重结果.会话)) return;
        set整理跑(true);
        set整理话("正在合并……");
        let 收 = 0;
        let 保 = 0;
        for (const x of 查重结果.会话) {
          try {
            const r = await post("/duplicates/merge", { session: x.session, 组: x.组 });
            if (r && r.ok !== false) 收 += Number(r.收起来) || 0;
            保 += Number(r && r.保住) || 0;
          } catch (e) {
            保 += 1;
          }
        }
        set整理话("合掉了 " + 收 + " 条" + (保 ? "，另有 " + 保 + " 条不够像、保住了" : "") + "。收在「已删」里，能找回来。");
        set整理跑(false);
        set查重结果(null);
      };
      const 当前会话 = 会话 || (d && d.会话们 && d.会话们[0] && d.会话们[0].id || "");
      const 装载 = React.useCallback(() => {
        setBusy(true);
        setErr(null);
        post("/all", {}).then((r) => {
          if (!r || r.ok === false || !Array.isArray(r.memories)) throw new Error(r && (r.message || r.error) || "读不出来");
          const 条们 = [];
          for (const m of r.memories) 条们.push(归整(Object.assign({}, m, { deleted: false }), true));
          for (const m of r.deleted || []) 条们.push(归整(Object.assign({}, m, { deleted: true, deletedAt: m.deletedAt || null }), true));
          set源("all");
          setD({
            条们,
            会话们: (r.sessions || []).map((x) => ({ id: x.id, title: x.title || x.id })),
            统计: r.stats || null,
            全局开关: r.全局开关
          });
          setBusy(false);
        }).catch((e) => {
          setErr(String(e && e.message || e));
          setBusy(false);
        });
      }, []);
      React.useEffect(() => {
        装载();
        get("/health?days=7").then((r) => {
          if (r && r.ok !== false) set健康(r);
        }).catch(() => {
        });
        get("/candidates").then((r) => {
          if (r && r.ok !== false) set候选们(r);
        }).catch(() => {
        });
      }, [装载]);
      const 全部 = d && d.条们 || [];
      const 会话们 = d && d.会话们 || [];
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const 计 = { 活跃: 0, 已被取代: 0, 已删: 0 };
      const 全计 = { 活跃: 0, 已被取代: 0, 已删: 0 };
      const 归类 = (m) => m.deleted ? "已删" : m.已被取代 ? "已被取代" : "活跃";
      全部.forEach((m) => {
        全计[归类(m)]++;
      });
      const q = 搜.trim().toLowerCase();
      const 底 = 全部.filter((m) => {
        if (作用域 === "全局记忆" && m.scope !== "global") return false;
        if (作用域 === "指定会话" && (m.scope !== "session" || 当前会话 && m.session && m.session !== 当前会话))
          return false;
        if (类型 === "其他") {
          if (m.type && m.type !== "misc") return false;
        } else if (类型 !== "全部" && m.type !== 类型) return false;
        if (q) {
          const 布 = [
            m.text,
            m.source,
            m.原话,
            m.sessionTitle,
            m.事实键,
            (m.related || []).join(" ")
          ].join(" ").toLowerCase();
          if (布.indexOf(q) < 0) return false;
        }
        计[归类(m)]++;
        return true;
      });
      const 显示 = 底.filter((m) => 归类(m) === 状态);
      显示.sort((a, b) => String(b.at || b.createdAt || "").localeCompare(String(a.at || a.createdAt || "")));
      const 画的 = 画全部 ? 显示 : 显示.slice(0, 一次最多画);
      const 今天记 = (() => {
        const s = d && d.统计;
        if (s && typeof s.todayAdded === "number") return s.todayAdded;
        let n = 0;
        全部.forEach((m) => {
          if (!m.deleted && 同日(m.createdAt, now)) n++;
        });
        return n;
      })();
      const 今天想起 = (() => {
        const s = d && d.统计;
        if (s && typeof s.todayRecalled === "number") return s.todayRecalled;
        let n = 0;
        会话们.forEach((s2) => {
          ;
          (s2.traces || []).forEach((t) => {
            if (t && 同日(t.at, now)) n++;
          });
        });
        return n;
      })();
      const 记一条 = () => {
        const 正文 = 加正文.trim();
        if (!正文) {
          set提示("先写点什么");
          return;
        }
        if (!当前会话) {
          set提示("还没有会话 —— 先在 DSH 里开一个对话，再回来记");
          return;
        }
        setBusy(true);
        post("/add", {
          session: 当前会话,
          text: 正文,
          importance: 加重要,
          scope: "global",
          type: 加类型
        }).then((r) => {
          if (!r || r.ok === false || r.error) {
            set提示("没记上：" + (r && (r.error || r.message) || "？"));
            setBusy(false);
            return;
          }
          set加正文("");
          set加开(false);
          set提示("✓ 记下了（全局记忆）");
          if (r.id) {
            post("/expand", { session: 当前会话, ids: [r.id], 每批: 1 }).catch(() => {
            });
          }
          装载();
        }).catch((e) => {
          set提示(String(e && e.message || e));
          setBusy(false);
        });
      };
      const 存改 = (m) => {
        const 稿 = 改稿.trim();
        if (!稿) {
          set提示("不能改成空的");
          return;
        }
        setBusy(true);
        const 原层 = m.scope === "global" ? "global" : m.scope === "workspace" ? "workspace" : "session";
        const 新层 = 改层级 || 原层;
        const req = 新层 === 原层 && 原层 === "global" ? post("/facts/edit", { id: m.id, text: 稿 }) : post("/edit", { session: m.session || 当前会话, id: m.id, text: 稿, scope: 新层 });
        req.then((r) => {
          set在改(null);
          set提示(r && (r.message || r.error) || (r && r.ok ? "改好了" : "没改成"));
          装载();
        }).catch((e) => {
          set提示(String(e && e.message || e));
          setBusy(false);
        });
      };
      const 删掉 = (m) => {
        setBusy(true);
        const req = m.scope === "global" ? post("/facts/delete", { id: m.id }) : post("/delete", { session: m.session || 当前会话, id: m.id, action: "delete" });
        req.then((r) => {
          set要删(null);
          set提示(r && (r.message || r.error) || (r && r.ok ? "删了" : "没删成"));
          装载();
        }).catch((e) => {
          set要删(null);
          set提示(String(e && e.message || e));
          setBusy(false);
        });
      };
      const 找回 = (m) => {
        setBusy(true);
        const 试 = async () => {
          let r = null;
          const 序 = [];
          if (m.session) 序.push(m.session);
          会话们.forEach((s) => {
            if (序.indexOf(s.id) < 0) 序.push(s.id);
          });
          for (let i = 0; i < 序.length; i++) {
            r = await post("/delete", { session: 序[i], id: m.id, action: "restore" });
            if (r && r.ok) break;
          }
          set提示(r && (r.message || r.error) || "没找回来");
          setBusy(false);
          装载();
        };
        试().catch((e) => {
          set提示(String(e && e.message || e));
          setBusy(false);
        });
      };
      const 撤销作废 = (m) => {
        setBusy(true);
        post("/delete", { session: m.session || 当前会话, id: m.id, action: "unsupersede" }).then((r) => {
          set提示(r && (r.message || r.error) || "好了");
          装载();
        }).catch((e) => {
          set提示(String(e && e.message || e));
          setBusy(false);
        });
      };
      const 标不对 = (m) => {
        setBusy(true);
        post("/mark-wrong", { session: m.session || 当前会话, id: m.id, undo: !!m.别记 }).then((r) => {
          set提示(r && (r.message || r.error) || (m.别记 ? "撤销标记了" : "标好了 —— 这条以后不会再被想起来"));
          装载();
        }).catch((e) => {
          set提示(String(e && e.message || e));
          setBusy(false);
        });
      };
      const 行键 = (m) => (m.deleted ? "d:" : "") + String(m.id) + "@" + String(m.session || "");
      const 行 = (m) => {
        const 全局 = m.scope === "global";
        const 是工区 = m.scope === "workspace";
        const 删了 = m.deleted;
        const 别记中 = !删了 && !!m.别记;
        const 取代中 = !删了 && !!m.已被取代;
        const 改中 = 在改 === 行键(m);
        const 条 = el(
          "div",
          { key: (删了 ? "d:" : "") + m.id + "@" + String(m.session || ""), style: G.item },
          el(
            "div",
            { style: G.itemTop },
            el("span", {
              style: Object.assign({}, G.dot, {
                background: 删了 || 取代中 ? "var(--dsw-alias-label-tertiary, rgba(128,128,128,.5))" : 重要色(m.importance)
              })
            }),
            要删 === 行键(m) ? el(
              "div",
              { style: Object.assign({}, G.confirm, { flex: 1, minWidth: 0, marginBottom: 0 }) },
              el(
                "span",
                { style: { flex: 1, minWidth: 120 } },
                全局 ? "所有会话都会忘 —— 真删？" : "删掉这条？还能在「已删」里找回来。"
              ),
              el("button", { style: G.btnDanger, onClick: () => 删掉(m), disabled: busy }, "确定删"),
              el("button", { style: G.btn, onClick: () => set要删(null) }, "算了")
            ) : 改中 ? null : el(
              "div",
              {
                style: Object.assign(
                  {},
                  G.text,
                  取代中 ? { opacity: 0.62, textDecoration: "line-through" } : null,
                  删了 ? { opacity: 0.55 } : null
                ),
                title: "点一下就能改",
                onClick: () => {
                  set在改(行键(m));
                  set改稿(m.text);
                  set改层级(m.scope === "global" ? "global" : m.scope === "workspace" ? "workspace" : "session");
                }
              },
              m.text
            ),
            el("span", { style: G.date }, m.at ? rel(m.at, now) : 删了 ? "" : "没记时间"),
            改中 || 要删 === 行键(m) ? null : el("button", { style: G.x, title: "删这条", onClick: () => set要删(行键(m)) }, "×")
          ),
          改中 ? el(
            "div",
            { style: S.editBox },
            el("textarea", {
              style: G.area,
              value: 改稿,
              onChange: (e) => set改稿(e.target.value)
            }),
            el(
              "div",
              { style: { display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" } },
              el("button", { style: G.btn, onClick: () => 存改(m), disabled: busy }, "保存"),
              el("button", { style: G.btn, onClick: () => set在改(null) }, "取消"),
              el("span", { style: Object.assign({}, G.note, { marginBottom: 0 }) }, "层级"),
              el(选择器, {
                style: { minWidth: 110 },
                值: 改层级,
                选项: [
                  { v: "global", t: "全局记忆" },
                  { v: "workspace", t: "工作区" },
                  { v: "session", t: "本会话" }
                ],
                onChange: (v) => set改层级(v)
              }),
              el("span", { style: Object.assign({}, G.note, { marginBottom: 0 }) }, "改完检索词不会自动变（要重扩一次）")
            )
          ) : null,
          el(
            "div",
            { style: G.meta },
            el(
              "span",
              {
                style: Object.assign({}, G.badge, 全局 ? { background: "rgba(143,208,160,.18)" } : null, {
                  // 标题可能很长（DSH 自动起的名字）—— 截断显示，悬停看全
                  maxWidth: "18em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }),
                // 悬停显示完整标题；标题拿不到时显示会话 id，方便对照
                title: 全局 ? "全局记忆：每个对话都能看到" : m.sessionTitle ? m.sessionTitle + "（" + (m.sessionId || "") + "）" : m.sessionId || ""
              },
              全局 ? "全局记忆" : 是工区 ? "工作区记忆" : "指定会话 · " + (m.sessionTitle || String(m.sessionId || "").replace(/^session-/, "").slice(0, 8) || "？")
            ),
            m.type ? el("span", { style: G.badge }, 类型名(m.type) || m.type) : null,
            m.category === "stable_profile" ? el("span", { style: G.badge }, "长期设定") : null,
            取代中 ? el("span", { style: G.badge }, "已被取代") : null,
            别记中 ? el("span", { style: G.badge, title: String(m.别记) }, "标了不对") : null,
            删了 ? el("span", { style: G.badge }, "已删") : null,
            m.事实键 ? el("span", { style: G.badge }, "讲的是：" + m.事实键) : null,
            // ⭐ 1.10.3（F12）：这条能对上「你当时说的原话」→ 和纯转述分开标
            m.原话 ? el("span", { style: G.badge, title: "记这条的时候，你最近说的那句话被一起存下来了" }, "你说的") : null,
            el(
              "span",
              null,
              (m.source || "没写出处") + " · " + (删了 ? m.deletedAt ? "删于 " + rel(m.deletedAt, now) : "删了" : m.at || m.createdAt ? rel(m.at || m.createdAt, now) : "时间不详")
            ),
            取代中 ? el("button", { style: G.btn, onClick: () => 撤销作废(m), disabled: busy }, "撤销作废") : null,
            删了 ? el("button", { style: G.btn, onClick: () => 找回(m), disabled: busy }, "找回来") : null,
            删了 || 改中 ? null : el("button", { style: G.btn, onClick: () => {
              set在改(行键(m));
              set改稿(m.text);
              set改层级(m.scope === "global" ? "global" : m.scope === "workspace" ? "workspace" : "session");
            } }, "改"),
            删了 || 改中 ? null : el(
              "button",
              { style: G.btn, title: "标了不对：以后不再被想起来（不删原文，随时能撤销）", onClick: () => 标不对(m), disabled: busy },
              别记中 ? "撤销标记" : "这条不对"
            ),
            // ⭐ 1.10.3（F12）：记这条时你说的话 —— 展开看原话，别只看她的转述
            m.原话 ? el(
              "details",
              { style: { marginTop: 6, width: "100%" } },
              el(
                "summary",
                { style: { fontSize: 11, cursor: "pointer", opacity: 0.62, userSelect: "none" } },
                "你说的（记这条时最近的一句）"
              ),
              el(
                "div",
                {
                  style: {
                    marginTop: 4,
                    paddingLeft: 8,
                    borderLeft: "2px solid rgba(128,128,128,.28)",
                    fontSize: 12,
                    lineHeight: 1.55,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    opacity: 0.8
                  }
                },
                String(m.原话).slice(0, 600)
              )
            ) : null,
            // ⭐ B 轮 F12：这条被提炼之前长什么样 —— 折叠着，点开才占地方
            m.textBefore ? el(
              "details",
              { style: { marginTop: 6, width: "100%" } },
              el(
                "summary",
                { style: { fontSize: 11, cursor: "pointer", opacity: 0.62, userSelect: "none" } },
                "原文（提炼前）"
              ),
              el(
                "div",
                {
                  style: {
                    marginTop: 4,
                    paddingLeft: 8,
                    borderLeft: "2px solid rgba(128,128,128,.28)",
                    fontSize: 12,
                    lineHeight: 1.55,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    opacity: 0.8
                  }
                },
                String(m.textBefore).slice(0, 1200)
              )
            ) : null
          )
        );
        return 条;
      };
      const 关 = () => {
        set加开(false);
        set加正文("");
      };
      return el(
        "div",
        { style: S.wrap },
        // ── 状态条 ────────────────────────────────────────────
        el(
          "div",
          { style: G.hero },
          el(
            "div",
            null,
            el(
              "span",
              { style: Object.assign({}, G.heroNum, { fontSize: 20, letterSpacing: 0 }) },
              "今天记了 " + 今天记 + " 条 · 想起 " + 今天想起 + " 次"
            )
          ),
          el(
            "div",
            { style: G.heroTip },
            "写「全局记忆」的每个对话都看得见，写「指定会话」的只有那一个对话记得。点正文就能改；× 删掉：指定会话的还能在「已删」里找回来，全局记忆的那条是真没了。"
          ),
          // ⭐ F15（1.10.3）：近 7 天的健康度 —— 一行小字，看它到底在不在工作
          (() => {
            if (!健康 || !健康.汇总) return null;
            const 汇 = 健康.汇总;
            const 配 = 健康.配额 || {};
            if (!汇.次数) {
              return el(
                "div",
                { style: Object.assign({}, G.heroTip, { marginTop: 6, opacity: 0.62 }) },
                "近 7 天没有注入记录 —— 这段时间要么没聊天，要么这功能没开着。"
              );
            }
            const 率 = typeof 汇.命中率 === "number" ? Math.round(汇.命中率 * 100) + "%" : "—";
            const 段 = [
              "近 " + 健康.days + " 天：注入 " + 汇.次数 + " 次",
              "有着落 " + 汇.有命中 + " 次（" + 率 + "）",
              "平均 " + 汇.平均条数 + " 条 / " + 汇.平均字数 + " 字",
              "空注入 " + 汇.空注入 + " 次" + (汇.被门挡 ? "（问句门挡 " + 汇.被门挡 + " 次）" : "")
            ];
            if (配.maxItems || 配.maxChars) {
              段.push("配额 " + (配.maxItems || 0) + " 条 / " + (配.maxChars || 0) + " 字");
            }
            if (typeof 汇.预算利用率 === "number") {
              段.push("预算吃 " + 汇.预算利用率 + "%");
            }
            if (汇.被裁条数) {
              段.push("被裁 " + 汇.被裁条数 + " 条（" + 汇.裁剪率 + "%）");
            }
            return el(
              "div",
              {
                style: Object.assign({}, G.heroTip, { marginTop: 6, opacity: 0.72 }),
                title: "「有着落」= 那轮真的注入了至少一条记忆；「空注入」= 翻了库但一条都没给（话太没内容或没有对得上的）"
              },
              段.join(" · ")
            );
          })(),
          // ⭐ F20（1.12.13）：整理 —— 查重合并，一次看全部会话（原来只能一个会话一个会话点进去）
          el(
            "div",
            { style: { marginTop: 10, border: "1px solid rgba(128,128,128,.22)", borderRadius: 8, padding: "8px 10px", fontSize: 12.5 } },
            el(
              "div",
              { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
              el("span", { style: { fontWeight: 600 } }, "整理"),
              el("span", { style: { opacity: 0.6 } }, "查重合并 · 补键 · 一次看全部会话"),
              el("button", { style: S.btn, disabled: 整理跑, onClick: () => 查重() }, "查重"),
              el("button", { style: S.btnOn, disabled: 整理跑, onClick: () => 合并全部() }, "合并全部真重复"),
              el("button", { style: S.btn, disabled: 整理跑, onClick: () => 查补键() }, "补键"),
              // ⭐ 1.12.27：撤回跟着补键一起常显 —— 以前只有会话详情里有，洗完在整理页找不到撤回
              补键结果 && Number(补键结果.可撤) > 0 ? 撤销问 ? el(
                "span",
                { style: { display: "inline-flex", alignItems: "center", gap: 6, opacity: 0.9 } },
                el("span", null, "撤掉全部 " + 补键结果.可撤 + " 条自动补的键？只撤自动补的，你手填的不动。"),
                el("button", { style: S.btnOn, disabled: 整理跑, onClick: () => 撤全部标() }, "确定撤"),
                el("button", { style: S.btn, disabled: 整理跑, onClick: () => set撤销问(false) }, "算了")
              ) : el(
                "button",
                {
                  style: S.btn,
                  disabled: 整理跑,
                  title: "把这次自动补的键全摘掉、顺手收起来的也放回来 —— 回到没洗之前。\n手填的键不动，记忆本身一条都不删。",
                  onClick: () => set撤销问(true)
                },
                "撤掉这次补的标（" + 补键结果.可撤 + "）"
              ) : null
            ),
            整理话 ? el("div", { style: { marginTop: 6, opacity: 0.8 } }, 整理话) : null,
            补键结果 && 补键结果.会话 && 补键结果.会话.length ? el(
              "div",
              { style: { marginTop: 6, opacity: 0.82, maxHeight: 160, overflow: "auto" } },
              ...补键结果.会话.slice(0, 12).map(
                (x) => el(
                  "div",
                  { key: x.session, style: { marginTop: 3, display: "flex", alignItems: "center", gap: 6 } },
                  el("span", { style: { fontWeight: 600 } }, String(x.名称 || x.session)),
                  el("span", { style: { opacity: 0.65 } }, " · 剩 " + x.剩 + " 条"),
                  el("button", { style: S.btn, disabled: 整理跑, onClick: () => 洗一批(x.session) }, "洗一批")
                )
              )
            ) : null,
            查重结果 && 查重结果.会话 && 查重结果.会话.length ? el(
              "div",
              { style: { marginTop: 6, opacity: 0.82, maxHeight: 160, overflow: "auto" } },
              ...查重结果.会话.slice(0, 12).map(
                (x) => el(
                  "div",
                  { key: x.session, style: { marginTop: 3 } },
                  el("span", { style: { fontWeight: 600 } }, String(x.名称 || x.session)),
                  el("span", { style: { opacity: 0.65 } }, " · " + x.组.length + " 组 · 能少 " + x.能少 + " 条")
                )
              )
            ) : null
          ),
          // ⭐ 1.11.0 一期（§4.8）：候选区 —— 钩子只标候选，这里由人决定「记下 / 不管」
          (() => {
            const 数 = 候选们 && typeof 候选们.count === "number" ? 候选们.count : 0;
            const 处理 = (id, action) => {
              post("/candidates", { action, id }).then(() => get("/candidates")).then((r) => {
                if (r && r.ok !== false) set候选们(r);
              }).catch(() => {
              });
            };
            if (!数) {
              return el(
                "div",
                { style: Object.assign({}, G.heroTip, { marginTop: 6, opacity: 0.55 }) },
                "候选区：空的 —— 她没调 remember、但话里像该记的，会先掉在这儿"
              );
            }
            return el(
              "div",
              { style: Object.assign({}, G.heroTip, { marginTop: 6 }) },
              el(
                "span",
                {
                  style: { cursor: "pointer", textDecoration: "underline" },
                  onClick: () => set候选开(!候选开),
                  title: "钩子（承诺 / 偏好 / 身份三类线索）挑出来的话，采纳了才进正式记忆"
                },
                "候选 " + 数 + " 条 " + (候选开 ? "▾" : "→")
              ),
              候选开 ? el(
                "div",
                { style: { marginTop: 6, width: "100%" } },
                (候选们.items || []).map(
                  (it) => el(
                    "div",
                    { key: it.id, style: { display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 } },
                    el("span", { style: { flex: 1, wordBreak: "break-word" } }, String(it.text || "")),
                    el(
                      "button",
                      {
                        style: Object.assign({}, G.btn, { fontSize: 11, padding: "1px 8px" }),
                        onClick: () => 处理(it.id, "adopt")
                      },
                      "记下"
                    ),
                    el(
                      "button",
                      {
                        style: Object.assign({}, G.btn, { fontSize: 11, padding: "1px 8px" }),
                        onClick: () => 处理(it.id, "drop")
                      },
                      "不管"
                    )
                  )
                )
              ) : null
            );
          })(),
          el(
            "div",
            { style: G.chips },
            el("div", { style: G.chip }, el("span", { style: G.chipNum }, String(全计.活跃)), el("span", null, "活着")),
            el("div", { style: G.chip }, el("span", { style: G.chipNum }, String(全计.已被取代)), el("span", null, "已被取代")),
            el("div", { style: G.chip }, el("span", { style: G.chipNum }, String(全计.已删)), el("span", null, "已删")),
            el("div", { style: G.chip }, el("span", { style: G.chipNum }, String(会话们.length)), el("span", null, "个会话"))
          )
        ),
        err ? el("div", { style: G.err }, err) : null,
        提示 ? el("div", { style: G.note }, 提示) : null,
        // ⭐ F22（1.12.11）：一条都还没有的时候别让这页空着 —— 空页面既看不出「能用」，也看不出「怎么用」。
        //   只在「真的空 + 没在筛」时出现，一有内容自动消失（不做「关掉就不再出现」的开关，省一个状态）
        全计.活跃 === 0 && 全计.已删 === 0 && 全计.已被取代 === 0 && !搜 && 作用域 === "全部" ? el(
          "div",
          { style: Object.assign({}, S.sec, { marginBottom: 12 }) },
          el(
            "div",
            { style: S.secH },
            el("span", { style: S.secTitle }, "这里还空着"),
            el("span", { style: S.secTag }, "第一次用，先挑一条路")
          ),
          el(
            "ol",
            { style: { margin: "6px 0 0 18px", padding: 0, fontSize: 12.5, lineHeight: 1.9, opacity: 0.85 } },
            el("li", null, "在聊天里直接说「记住：…」，我会挑值得长期留的那句记下来"),
            el("li", null, "点下面的「+ 记一条」，自己塞一条进去"),
            el("li", null, "以前攒过记录？去「高级 → 从档案导入」整批搬进来")
          ),
          el(
            "div",
            { style: Object.assign({}, S.note, { marginTop: 6 }) },
            "装好第一次用不会自己开始记 —— 得先跟它说过一句话；「像该记但没记」的话会先落到候选区，点「记下」才进库。"
          )
        ) : null,
        // ── ＋记一条（内联展开）───────────────────────────────
        加开 ? el(
          "div",
          { style: Object.assign({}, S.sec, { marginBottom: 12 }) },
          el(
            "div",
            { style: S.secH },
            el("span", { style: S.secTitle }, "记一条"),
            el("span", { style: S.secTag }, "不用等助手想起来，你直接塞进去")
          ),
          el("textarea", {
            style: G.area,
            rows: 2,
            placeholder: "她说过什么、答应了什么、她自己是什么样…",
            value: 加正文,
            onChange: (e) => set加正文(e.target.value)
          }),
          el(
            "div",
            { style: Object.assign({}, G.tools, { marginTop: 8, marginBottom: 6 }) },
            el("span", { style: Object.assign({}, G.note, { marginBottom: 0 }) }, "类型"),
            el(选择器, {
              style: G.sel,
              值: 加类型,
              选项: 类型表.map(([k, t]) => ({ v: k, t })),
              onChange: (v) => set加类型(v)
            }),
            el("span", { style: Object.assign({}, G.note, { marginBottom: 0, marginLeft: 6 }) }, "重要"),
            [["0", "小事"], ["0.5", "一般"], ["1", "很重要"]].map(
              ([v, t]) => el(
                "button",
                {
                  key: v,
                  style: Number(加重要) === Number(v) ? G.pillOn : G.pill,
                  title: v === "1" ? "标成「很重要」的会优先被想起来" : "",
                  onClick: () => set加重要(Number(v))
                },
                t
              )
            ),
            el("button", { style: G.btn, onClick: 记一条, disabled: busy }, busy ? "记…" : "记下"),
            el("button", { style: G.btn, onClick: 关 }, "收起来")
          ),
          el(
            "div",
            { style: Object.assign({}, G.note, { marginBottom: 0 }) },
            "记进「全局记忆」—— 哪个对话都看得见，在这里删了哪儿都会忘。"
          )
        ) : el(
          "button",
          {
            style: Object.assign({}, G.btn, {
              width: "100%",
              textAlign: "left",
              padding: "9px 12px",
              marginBottom: 12,
              fontSize: 13
            }),
            onClick: () => set加开(true)
          },
          "＋ 记一条"
        ),
        // ── 全库搜索 ──────────────────────────────────────────
        el(
          "div",
          { style: G.tools },
          el("input", {
            style: G.search,
            placeholder: "搜全部记忆：正文 / 检索词 / 出处 / 讲的是",
            value: 搜,
            onChange: (e) => set搜(e.target.value)
          }),
          el("button", { style: G.btn, onClick: 装载, disabled: busy }, busy ? "读…" : "刷新")
        ),
        // ── 筛选：作用域 / 类型 / 状态 ────────────────────────
        el(
          "div",
          { style: G.tools },
          el("span", { style: Object.assign({}, G.note, { marginBottom: 0 }) }, "作用域"),
          ["全部", "全局记忆", "指定会话"].map(
            (v) => el("button", { key: v, style: 作用域 === v ? G.pillOn : G.pill, onClick: () => set作用域(v) }, v)
          ),
          作用域 === "指定会话" ? el(选择器, {
            style: G.sel,
            值: 当前会话,
            选项: 会话们.length === 0 ? [{ v: "", t: "（还没有会话）" }] : 会话们.map((s) => ({ v: s.id, t: s.title || s.id })),
            onChange: (v) => set会话(v)
          }) : null
        ),
        el(
          "div",
          { style: G.tools },
          el("span", { style: Object.assign({}, G.note, { marginBottom: 0 }) }, "类型"),
          [["全部", "全部"]].concat(类型表).map(
            ([k, t]) => el("button", { key: k, style: 类型 === k ? G.pillOn : G.pill, onClick: () => set类型(k) }, t)
          )
        ),
        el(
          "div",
          { style: G.tools },
          el("span", { style: Object.assign({}, G.note, { marginBottom: 0 }) }, "状态"),
          ["活跃", "已被取代", "已删"].map(
            (v) => el(
              "button",
              { key: v, style: 状态 === v ? G.pillOn : G.pill, onClick: () => set状态(v) },
              v + " " + 计[v]
            )
          )
        ),
        // ── 列表 ──────────────────────────────────────────────
        !d ? el("div", { style: G.empty }, "读…") : 显示.length === 0 ? el(
          "div",
          { style: G.empty },
          全部.length === 0 ? el(
            "div",
            null,
            "这里还空着。",
            el("br"),
            "点上面的「＋ 记一条」自己写一条，或者在 DSH 里跟助手聊几句让它 remember。"
          ) : "没有符合条件的 —— 换个筛选试试。"
        ) : el("div", null, 画的.map((m) => 行(m))),
        显示.length > 画的.length ? el(
          "div",
          { style: { marginTop: 4 } },
          el(
            "button",
            { style: G.btn, onClick: () => set画全部(true) },
            "还有 " + (显示.length - 画的.length) + " 条 —— 全画出来"
          )
        ) : null,
        el(
          "div",
          { style: Object.assign({}, G.note, { marginTop: 12, marginBottom: 0 }) },
          源 === "list" ? "这次是从旧接口（/list）拼出来的：新加的「作用域 / 类型」可能不全，等后端 /all 上了就自动切过来。" : ""
        )
      );
    }
    return { 所有记忆页 };
  }

  // src/client/pages/advanced/params-section.js
  var GROUPS = [
    ["weight", "权重", "决定「什么更容易被想起来」。四项加起来必须是 100% —— 你改一项，其余三项自动让位，你填的数会尽量保住。"],
    ["time", "遗忘速度", "数字越大 = 忘得越慢。淡了只是不容易被想起来，不会删。"],
    ["gate", "门槛与条数", "控制「一次塞多少给她」。"]
  ];
  function 造参数区({ React, el, get, post, S, toPct, fromPct }) {
    function 参数区() {
      const [params, setParams] = React.useState(null);
      const [spec, setSpec] = React.useState(null);
      const [pin, setPin] = React.useState(null);
      const [editing, setEditing] = React.useState(null);
      const [notes, setNotes] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [开, set开] = React.useState(false);
      const [均长, set均长] = React.useState(0);
      const load = React.useCallback(() => {
        get("/list").then((x) => {
          if (x && x.policy) setParams(Object.assign({}, x.policy));
          setSpec(Array.isArray(x && x.spec) ? x.spec.slice() : []);
          setNotes(null);
        }).catch((e) => setNotes(["读不到参数：" + String(e && e.message || e)]));
        get("/health?days=7").then((h) => set均长(Number(h && h.汇总 && h.汇总.平均字数) || 0)).catch(() => {
        });
      }, []);
      React.useEffect(() => {
        load();
      }, [load]);
      const 头 = el(
        "div",
        { style: Object.assign({}, S.secH, { cursor: "pointer", marginBottom: 开 ? 8 : 0 }), onClick: () => set开(!开) },
        el("span", { style: S.secTitle }, (开 ? "▾ " : "▸ ") + "参数"),
        el("span", { style: S.secTag }, "调一次就不动 · 点开调")
      );
      if (!开) return el("div", { style: S.sec }, 头);
      if (!params || !spec) return el("div", { style: S.sec }, 头, el("div", { style: S.dim }, "正在读参数…"));
      const WK = spec.filter((s) => s.group === "weight").map((s) => s.key);
      const wSum = WK.length ? Math.round(WK.reduce((a, k) => a + toPct(params[k] || 0), 0) * 10) / 10 : 0;
      const setOne = (k, native) => {
        setParams((prev) => Object.assign({}, prev, { [k]: native }));
        if (WK.indexOf(k) >= 0) setPin(k);
        setNotes(null);
      };
      const oneRow = (s) => {
        const isW = s.group === "weight";
        const lo = isW ? toPct(s.min) : s.min;
        const hi = isW ? toPct(s.max) : s.max;
        const cur = isW ? toPct(params[s.key]) : params[s.key];
        const typing = editing && editing.key === s.key;
        const unit = isW ? "%" : s.unit || "";
        const head = [
          el("span", { key: "lbl", style: { flex: "0 0 auto", fontSize: 12 } }, s.label),
          el("input", {
            key: "inp",
            type: "number",
            style: Object.assign({}, S.inp, { fontSize: 12, width: 64, padding: "3px 6px" }),
            min: lo,
            max: hi,
            step: isW ? 0.1 : s.step,
            value: typing ? editing.text : String(cur),
            onChange: (e) => {
              const t = e.target.value;
              setEditing({ key: s.key, text: t });
              const n = Number(t);
              if (t !== "" && isFinite(n)) setOne(s.key, isW ? fromPct(n) : n);
            },
            onBlur: () => setEditing(null)
          })
        ];
        if (unit) head.push(el("span", { key: "unit", style: Object.assign({}, S.dim, { fontSize: 12 }) }, unit));
        head.push(el("span", { key: "rng", style: Object.assign({}, S.dim, { fontSize: 11, opacity: 0.7 }) }, "（" + lo + " ~ " + hi + "）"));
        const 估 = (() => {
          const 均 = Number(均长) || 0;
          const 预算 = Number(params.maxChars) || 0;
          if (!均 || !预算) return null;
          if (s.key === "factsMax" && Number(cur) > 0) {
            const 名义 = Math.round(均 * Number(cur));
            if (名义 > 预算) {
              const 能进 = Math.min(Number(cur), Math.floor(预算 / 均));
              return { 超: true, text: "按当前库均长 " + 均 + " 字算：" + cur + " 条 × " + 均 + " 字 = " + 名义 + " 字，超出 " + 预算 + " 字预算，实际大约只能进 " + 能进 + " 条" };
            }
            return { 超: false, text: "按当前库均长 " + 均 + " 字算：" + cur + " 条 × " + 均 + " 字 = " + 名义 + " 字，" + 预算 + " 字预算装得下" };
          }
          if (s.key === "maxChars" && Number(cur) > 0) {
            return { 超: false, text: "按当前库均长 " + 均 + " 字算：这个预算大约装得下 " + Math.floor(Number(cur) / 均) + " 条（名额 " + (Number(params.factsMax) || 0) + " 条）" };
          }
          return null;
        })();
        return el(
          "div",
          { key: s.key, style: { margin: "5px 0" } },
          el("div", { style: { display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" } }, head),
          估 ? el(
            "div",
            { style: Object.assign({}, S.dim, { fontSize: 11, marginTop: 1, lineHeight: 1.45 }, 估.超 ? { color: "#c2410c", opacity: 0.95 } : { opacity: 0.75 }) },
            估.text
          ) : null,
          s.tip ? el("div", { style: Object.assign({}, S.dim, { fontSize: 11, marginTop: 1, lineHeight: 1.45, opacity: 0.85 }) }, s.tip) : null
        );
      };
      const save = (body) => {
        setBusy(true);
        setNotes(null);
        post("/policy", body).then((r) => {
          if (r && r.policy) setParams(Object.assign({}, r.policy));
          setNotes(r && r.notes || []);
          setBusy(false);
          load();
        }).catch((e) => {
          setBusy(false);
          setNotes(["保存失败：" + (e && e.message || e)]);
        });
      };
      const blocks = [];
      for (const [gid, gname, gtip] of GROUPS) {
        const rows = spec.filter((s) => s.group === gid);
        if (!rows.length) continue;
        blocks.push(el("div", { key: gid, style: Object.assign({}, S.h, { fontSize: 12, marginTop: 10, marginBottom: 2 }) }, gname));
        blocks.push(el("div", { key: gid + "-tip", style: Object.assign({}, S.dim, { fontSize: 11, opacity: 0.85 }) }, gtip));
        if (gid === "weight") {
          blocks.push(
            el(
              "div",
              { key: "wsum", style: { margin: "6px 0 2px", fontSize: 12 } },
              el("span", { style: { display: "inline-block", width: 96 } }, "合计"),
              el("span", { style: wSum === 100 ? S.ok : S.warn, fontWeight: 600, fontSize: 12 }, wSum + "%"),
              wSum === 100 ? el("span", { style: Object.assign({}, S.dim, { marginLeft: 8, fontSize: 11 }) }, "正好 ✓") : el("span", { style: Object.assign({}, S.dim, { marginLeft: 8, fontSize: 11 }) }, "不是 100% —— 保存时会自动调平")
            )
          );
        }
        for (const s of rows) blocks.push(oneRow(s));
      }
      return el(
        "div",
        { style: S.sec },
        头,
        el("div", { style: Object.assign({}, S.dim, { fontSize: 11, marginBottom: 2 }) }, "这些是所有会话共用的。每项都有范围，超出会被收到范围内。"),
        blocks,
        el(
          "div",
          { style: { marginTop: 10, display: "flex", gap: 8, alignItems: "center" } },
          el("button", { style: Object.assign({}, S.btn, { fontSize: 12, padding: "4px 10px" }), disabled: busy, onClick: () => save(Object.assign({}, params, { pin })) }, busy ? "保存中…" : "保存参数"),
          el("button", { style: Object.assign({}, S.btn, { fontSize: 12, padding: "4px 10px" }), disabled: busy, onClick: () => save({ reset: true }) }, "恢复默认"),
          el("button", { style: Object.assign({}, S.btn, { fontSize: 12, padding: "4px 10px" }), disabled: busy, onClick: () => load() }, "刷新")
        ),
        notes && notes.length ? el("div", { style: Object.assign({}, S.warn, { marginTop: 8, fontSize: 11, whiteSpace: "pre-line" }) }, "　· " + notes.join("\n　· ")) : null
      );
    }
    return 参数区;
  }

  // src/client/pages/advanced/archive-gen-section.js
  function 造生成档案区({ React, el, get, post, S, G, 进度, 选择器 }) {
    function 生成档案区(props) {
      const 会话号 = props.会话号 || "";
      const [开, set开] = React.useState(false);
      const [提示, set提示] = React.useState([]);
      const [忙, set忙] = React.useState(false);
      const [生成会话, set生成会话] = React.useState(null);
      const [生成选, set生成选] = React.useState({});
      const [生成计划, set生成计划] = React.useState(null);
      const [生成条目, set生成条目] = React.useState([]);
      const [生成进度, set生成进度] = React.useState(null);
      const [生成档, set生成档] = React.useState(null);
      const [生成备, set生成备] = React.useState(null);
      const [生成诊断, set生成诊断] = React.useState(null);
      const [生成存到, set生成存到] = React.useState("");
      const [生成目录列, set生成目录列] = React.useState(null);
      const [生成选目录, set生成选目录] = React.useState(false);
      const 记 = (x) => set提示(Array.isArray(x) ? x : [String(x)]);
      const 开生成 = () => {
        set开(true);
        set生成会话(null);
        set生成计划(null);
        set生成条目([]);
        set生成档(null);
        set生成进度(null);
        post("/gen-sessions", { session: 会话号 }).then((r) => {
          if (!r || !r.ok) {
            记(["读会话列表失败：" + (r && r.message || "？")]);
            return;
          }
          set生成会话(r.会话 || []);
          set生成诊断(r.诊断 || null);
          if (r.建议存到) set生成存到(String(r.建议存到));
          set生成选({});
        }).catch((e) => 记(["读会话列表失败：" + (e && e.message || e)]));
      };
      const 勾的sid = () => Object.keys(生成选).filter((k) => 生成选[k]);
      const 算生成 = () => {
        const sids = 勾的sid();
        if (!sids.length) {
          记(["一个会话都没勾"]);
          return;
        }
        set忙(true);
        记(["算着呢…（要读一遍会话、去重、切段，一个会话约一秒）"]);
        post("/gen-plan", { session: 会话号, sids }).then((r) => {
          set忙(false);
          if (!r || !r.ok) {
            记(["算失败：" + (r && r.message || "？")]);
            return;
          }
          set生成计划(r);
          set生成条目([]);
          set生成档(null);
          记([]);
        }).catch((e) => {
          set忙(false);
          记(["算失败：" + (e && e.message || e)]);
        });
      };
      const 跑生成 = () => {
        const sids = 勾的sid();
        if (!sids.length || !生成计划) return;
        const 总批 = 生成计划.批数;
        set忙(true);
        set生成档(null);
        const 攒 = 生成条目.slice();
        let 连着空 = 0;
        const 跑一批 = (批号) => {
          if (批号 > 总批) {
            set忙(false);
            set生成进度(null);
            记(["✓ 跑完了：" + 总批 + " 批，攒了 " + 攒.length + " 条。" + (攒.length ? "点「存成档案文件」" : "模型这一轮一条都没收；回文长度记在诊断日志里，换个会话或再点一次试试")]);
            return;
          }
          set生成进度({ 批号, 批数: 总批, 在跑: true, 模型: 生成进度 && 生成进度.模型 || "" });
          post("/gen-run", {
            session: 会话号,
            sids,
            批号,
            // ⚠ 把前面攒的条目当「已记清单」传过去 —— 这是防重复的机制
            已记: 攒.map((x) => x.章 + "|" + x.日期 + "|" + x.话),
            provider: 生成备 ? 生成备.provider : void 0,
            model: 生成备 ? 生成备.model : void 0
          }).then((r) => {
            if (!r || !r.ok) {
              set忙(false);
              set生成进度(null);
              记(["第 " + 批号 + " 批失败：" + (r && r.message || "？"), "已经跑好的 " + 攒.length + " 条留着，再点一次会接着跑"]);
              return;
            }
            if (r.条目 && r.条目.length) {
              r.条目.forEach((x) => 攒.push(x));
              连着空 = 0;
            } else {
              连着空++;
            }
            set生成条目(攒.slice());
            set生成进度({ 批号, 批数: 总批, 在跑: true, 模型: r.模型 || "" });
            if (r.done) {
              set忙(false);
              set生成进度(null);
              记(["✓ 跑完了：" + 总批 + " 批，攒了 " + 攒.length + " 条。" + (攒.length ? "点「存成档案文件」" : "模型这一轮一条都没收；回文长度记在诊断日志里，换个会话或再点一次试试")]);
              return;
            }
            if (连着空 >= 3) {
              set忙(false);
              set生成进度(null);
              记(["连着 3 批模型没回东西，先停了。再点一次会接着跑"]);
              return;
            }
            setTimeout(() => 跑一批(批号 + 1), 300);
          }).catch((e) => {
            set忙(false);
            set生成进度(null);
            记(["第 " + 批号 + " 批失败：" + (e && e.message || e), "再点一次会接着跑"]);
          });
        };
        跑一批(1);
      };
      const 存生成 = () => {
        if (!生成条目.length) {
          记(["还没有条目"]);
          return;
        }
        set忙(true);
        post("/gen-save", { session: 会话号, 条目: 生成条目, 来源: 生成计划 && 生成计划.天数 + " 天" || "", 存到: 生成存到 }).then((r) => {
          set忙(false);
          if (!r || !r.ok) {
            记(["存失败：" + (r && r.message || "？")]);
            return;
          }
          set生成档(r);
          记(["✓ 档案存到：" + r.存到, "共 " + r.条数 + " 条" + (r.去掉重复 ? "（去掉了 " + r.去掉重复 + " 条重复）" : "")]);
        }).catch((e) => {
          set忙(false);
          记(["存失败：" + (e && e.message || e)]);
        });
      };
      return el(
        "div",
        { style: Object.assign({}, S.sec, { marginTop: 14 }) },
        el(
          "div",
          { style: S.secH },
          el("span", { style: S.secTitle }, "从会话导出档案"),
          el("span", { style: S.secTag }, "把某个会话读一遍，导出一份九章档案"),
          el("div", { style: { flex: 1 } }),
          el("button", { style: 开 ? S.btn : G.pillOn, onClick: () => 开 ? set开(false) : 开生成() }, 开 ? "收起" : "打开")
        ),
        el(
          "div",
          { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 8 }) },
          "挑任意一个会话（不一定是当前这个）读一遍，导出一份九章档案；导好的档案再走「从旧档案导入」变成记忆条目。"
        ),
        开 ? React.createElement(
          "div",
          { style: Object.assign({}, S.editBox, { marginTop: 8 }) },
          [
            // ① 选会话
            React.createElement(
              "div",
              { key: "s", style: { marginTop: 8 } },
              React.createElement("div", { style: S.dim }, "① 选会话" + (生成会话 ? "（这个工作区里找到 " + 生成会话.length + " 个）" : "（读着呢…）")),
              生成会话 && 生成会话.length ? React.createElement(
                "div",
                { style: { margin: "4px 0 0 8px", maxHeight: 260, overflow: "auto" } },
                生成会话.map(
                  (x) => React.createElement(
                    "label",
                    { key: x.sid, style: { display: "block", fontSize: 12, cursor: "pointer", padding: "2px 0" } },
                    React.createElement("input", {
                      type: "checkbox",
                      checked: !!生成选[x.sid],
                      onChange: () => set生成选(Object.assign({}, 生成选, { [x.sid]: !生成选[x.sid] }))
                    }),
                    // ⚠⚠ 2026-09-22（反馈：「不显示名字」）：
                    //   光有 `session-a1b2c3d4-…` 这种**没法挑** —— 得显示标题 ✓
                    " ",
                    React.createElement("span", { style: x.标题 ? null : S.dim }, x.标题 || "（没起名字）"),
                    React.createElement(
                      "span",
                      { style: Object.assign({}, S.dim, { marginLeft: 6 }) },
                      (x.话数 ? x.话数 + " 句　" : "") + x.MB + " MB　" + x.sid.slice(0, 12) + "…"
                    )
                  )
                )
              ) : 生成会话 ? React.createElement(
                "div",
                { style: Object.assign({}, S.dim, { marginTop: 4 }) },
                "这个工作区里没找到会话（归档的、子代理跑出来的、空壳的都不列）"
              ) : null,
              // ⚠ 默认一个都不勾 —— 让用户自己挑（后面是要花钱的）✓
              生成会话 && 生成会话.length ? React.createElement(
                "div",
                { style: { marginTop: 4, display: "flex", gap: 8, alignItems: "center" } },
                React.createElement(
                  "button",
                  {
                    style: S.btn,
                    onClick: () => {
                      const 勾 = {};
                      生成会话.forEach((x) => {
                        勾[x.sid] = true;
                      });
                      set生成选(勾);
                    }
                  },
                  "全选"
                ),
                React.createElement("button", { style: S.btn, onClick: () => set生成选({}) }, "全不选"),
                React.createElement("span", { style: S.dim }, "勾了 " + 勾的sid().length + " 个")
              ) : null,
              // ⚠ 诊断：列表跟 DSH 对不上时，这几个数能看出卡在哪一道 ✓
              生成诊断 ? React.createElement(
                "div",
                { style: Object.assign({}, S.dim, { marginTop: 4, fontSize: 11 }) },
                "文件夹里 " + 生成诊断.文件夹里 + " 个　DSH 名单 " + 生成诊断.DSH名单 + " 个　归档 " + 生成诊断.归档 + " 个　筛完剩 " + 生成诊断.筛完剩 + " 个",
                (生成诊断.被我筛掉的 || []).length ? React.createElement(
                  "div",
                  { style: { marginTop: 2 } },
                  "筛掉的：" + (生成诊断.被我筛掉的 || []).map((x) => (x.标题 || x.sid) + "（" + x.因 + "）").join("　")
                ) : null
              ) : null,
              React.createElement(
                "div",
                { style: { marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" } },
                React.createElement(
                  "button",
                  { style: S.btn, disabled: 忙 || 勾的sid().length === 0, onClick: () => 算生成() },
                  "② 算一下要多少"
                ),
                React.createElement(
                  "span",
                  { style: S.dim },
                  !勾的sid().length ? "先勾几个会话" : "（这一步不调模型、不花钱；要读一遍会话、去重、切段，慢一点）"
                )
              )
            ),
            // ② 计划
            生成计划 ? React.createElement(
              "div",
              { key: "p", style: { marginTop: 8 } },
              React.createElement(
                "div",
                { style: S.dim },
                "② 算出来了：" + 生成计划.批数 + " 批　" + 生成计划.天数 + " 天　" + 生成计划.总字.toLocaleString() + " 字　粗算约 " + 生成计划.token.toLocaleString() + " token"
              ),
              React.createElement(
                "div",
                { style: Object.assign({}, S.dim, { marginTop: 2 }) },
                "（每批最多 " + 生成计划.每批字上限.toLocaleString() + " 字；挑出来「不是聊天」的 " + 生成计划.挑出来 + " 条没算进去）"
              ),
              React.createElement(
                "div",
                { style: { marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
                React.createElement(
                  "button",
                  { style: S.btnDanger, disabled: 忙, onClick: () => 跑生成() },
                  忙 ? "跑着呢…" : "③ 开始跑（会调模型、会花钱）"
                ),
                React.createElement(
                  "span",
                  { style: S.dim },
                  "一批一批跑，跑完一批就把条目攒起来；下一批会带上「已经记过的」，同一件事不会收两遍"
                )
              ),
              (生成计划.会话 || []).length ? React.createElement(
                "div",
                { style: Object.assign({}, S.dim, { marginTop: 4, fontSize: 12 }) },
                "会话情况：" + 生成计划.会话.map((x) => (x.标题 || x.sid.slice(0, 12)) + "（独有 " + x.独有 + "／副本 " + x.副本 + "）").join("　")
              ) : null
            ) : null,
            // ③ 进度
            生成进度 && 生成进度.在跑 ? (() => {
              const 百 = Math.round((生成进度.批号 - 1) / 生成进度.批数 * 100);
              return React.createElement(
                "div",
                { key: "bar", style: { marginTop: 8 } },
                React.createElement(
                  "div",
                  { style: S.barOut },
                  React.createElement("div", { style: Object.assign({}, S.barIn, { width: 百 + "%" }) })
                ),
                React.createElement(
                  "div",
                  { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 4 }) },
                  "第 " + 生成进度.批号 + " / " + 生成进度.批数 + " 批（" + 百 + "%）　已攒 " + 生成条目.length + " 条" + (生成进度.模型 ? "　" + 生成进度.模型 : "")
                )
              );
            })() : null,
            // ④ 存到哪儿 —— ⚠⚠ 2026-09-22（反馈：「选了文件夹点了过后
            //   再想换的话就会卡住，就没有那个选项了，就不能再修改了」）
            //   两个毛病：
            //     ① 这块原来在 `生成条目.length` 里面 —— **跑完才出现** ✗
            //        → 挪到外面，面板一开就能设 ✓
            //     ② 再点「选文件夹」时**不重新读目录**（`if (!生成目录列)`）——
            //        看到的还是上次那份，像卡住 ✗ → 每次打开都重读 ✓
            React.createElement(
              "div",
              { key: "save", style: { marginTop: 8 } },
              React.createElement(
                "div",
                { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
                React.createElement("b", null, "④ 存到哪儿"),
                React.createElement("span", { style: S.dim }, "跑完就存到这个文件 —— 能直接改，也能点「选文件夹」挑")
              ),
              React.createElement(
                "div",
                { style: Object.assign({}, S.nameBox, { marginTop: 6 }) },
                React.createElement("div", { style: { flex: "none", width: 72 } }, "存到"),
                React.createElement("input", {
                  style: Object.assign({}, S.inp, { flex: 1, width: "auto", minWidth: 140 }),
                  value: 生成存到,
                  placeholder: "要存的完整路径（比如 D:\\档案\\导出的档案.md）",
                  onChange: (e) => set生成存到(e.target.value)
                }),
                React.createElement(
                  "button",
                  {
                    style: S.btn,
                    onClick: () => {
                      const 要开 = !生成选目录;
                      set生成选目录(要开);
                      if (要开) {
                        const 起点 = /[\\/]/.test(生成存到) ? 生成存到.replace(/[\\/][^\\/]*$/, "") : "";
                        post("/dirs", { path: 起点 }).then((r) => set生成目录列(r)).catch((e) => 记(["列不了目录：" + (e && e.message || e)]));
                      }
                    }
                  },
                  生成选目录 ? "收起" : "选文件夹"
                )
              ),
              // 文件夹选择器（跟「从旧档案导入」那个是同一个接口）
              生成选目录 && 生成目录列 ? React.createElement(
                "div",
                { style: { margin: "4px 0 0", padding: "6px 10px", borderRadius: 6, background: "rgba(128,128,128,.10)", border: "1px solid rgba(128,128,128,.22)", fontSize: 12 } },
                React.createElement(
                  "div",
                  { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 4 } },
                  React.createElement("span", { style: S.dim }, 生成目录列.path ? "当前：" + 生成目录列.path : "选一个盘"),
                  React.createElement("div", { style: { flex: 1 } }),
                  // ⚠ 选择器里也放一个「收起」—— 别只能靠上面那个按钮
                  React.createElement("button", { style: S.btn, onClick: () => set生成选目录(false) }, "收起")
                ),
                生成目录列.ok === false ? React.createElement("div", { style: S.drop }, "✗ " + (生成目录列.message || "列不了")) : React.createElement(
                  "div",
                  null,
                  React.createElement(
                    "div",
                    { style: Object.assign({}, S.dim, { marginBottom: 4 }) },
                    生成目录列.path ? "「" + 生成目录列.path + "」下的文件夹（点一下就进去）：" : "选一个盘："
                  ),
                  React.createElement(
                    "div",
                    { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
                    生成目录列.parent ? React.createElement(
                      "span",
                      {
                        style: S.link,
                        onClick: () => post("/dirs", { path: 生成目录列.parent }).then((r) => set生成目录列(r)).catch(() => {
                        })
                      },
                      "↑ 上一级"
                    ) : null,
                    (生成目录列.dirs || []).map(
                      (d) => React.createElement(
                        "span",
                        {
                          key: d.path,
                          style: S.link,
                          onClick: () => post("/dirs", { path: d.path }).then((r) => set生成目录列(r)).catch(() => {
                          })
                        },
                        "📁 " + d.name
                      )
                    )
                  ),
                  // 「就用这个文件夹」—— 把路径拼成 <文件夹>\导出的档案.md
                  生成目录列.path ? React.createElement(
                    "div",
                    { style: { marginTop: 6 } },
                    React.createElement(
                      "button",
                      {
                        style: S.btn,
                        onClick: () => {
                          const p = String(生成目录列.path).replace(/[\\/]+$/, "");
                          set生成存到(p + "\\导出的档案.md");
                          set生成选目录(false);
                        }
                      },
                      "就用这个文件夹"
                    ),
                    React.createElement(
                      "span",
                      { style: Object.assign({}, S.dim, { marginLeft: 8 }) },
                      "→ 存成「导出的档案.md」（也可以先点进去子文件夹再点这个）"
                    )
                  ) : React.createElement(
                    "div",
                    { style: Object.assign({}, S.dim, { marginTop: 6 }) },
                    "先点进一个盘，再点「就用这个文件夹」"
                  )
                )
              ) : null
            ),
            // 攒下来的条目 + 存文件
            // ⚠ 2026-10-26：原来只在「条目 > 0」时渲染 —— 0 条时界面上只留一句
            //   「点『存成档案文件』」，按钮根本不存在，用户只能到处找 ✗
            //   → 算过计划就画出来；0 条时按钮置灰、旁边写明为什么。
            生成计划 ? React.createElement(
              "div",
              { key: "r", style: { marginTop: 8 } },
              React.createElement(
                "div",
                { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
                React.createElement("b", null, "攒了 " + 生成条目.length + " 条"),
                React.createElement(
                  "button",
                  {
                    style: S.btn,
                    disabled: 忙 || !!(生成进度 && 生成进度.在跑) || !生成条目.length,
                    onClick: () => 存生成()
                  },
                  "存成档案文件"
                ),
                React.createElement(
                  "span",
                  { style: S.dim },
                  生成条目.length ? "存成一份 markdown；然后再用下面的「从旧档案导入」把它变成记忆条目" : "还没有条目可存 —— 这一轮模型一条都没收（也可能输出被截断，诊断日志里有回文长度）"
                )
              ),
              生成条目.length ? React.createElement(
                "div",
                { style: Object.assign({}, S.dim, { marginTop: 4, maxHeight: 200, overflow: "auto", fontSize: 12, whiteSpace: "pre-line" }) },
                生成条目.slice(0, 40).map((x) => x.章 + "|" + x.日期 + "|" + x.话).join("\n") + (生成条目.length > 40 ? "\n…（还有 " + (生成条目.length - 40) + " 条）" : "")
              ) : null
            ) : null,
            // 存好了
            生成档 ? React.createElement(
              "div",
              { key: "ok", style: { marginTop: 8 } },
              React.createElement("div", null, "✓ 档案存到：" + 生成档.存到),
              React.createElement(
                "div",
                { style: Object.assign({}, S.dim, { marginTop: 2 }) },
                "共 " + 生成档.条数 + " 条" + (生成档.去掉重复 ? "（去掉了 " + 生成档.去掉重复 + " 条重复）" : "")
              )
            ) : null
          ]
        ) : null
      );
    }
    return 生成档案区;
  }

  // src/client/pages/advanced/archive-import-section.js
  function 造从档案导入会话区({ React, el, get, post, S, G, 选择器 }) {
    function 从档案导入会话区(props) {
      const 会话们 = props.会话们 || [];
      const [开, set开] = React.useState(false);
      const [挑, set挑] = React.useState(null);
      const [扫, set扫] = React.useState(null);
      const [勾, set勾] = React.useState({});
      const [目标区, set目标区] = React.useState("");
      const [目标会话, set目标会话] = React.useState("");
      const [工作区们, set工作区们] = React.useState([]);
      const [会话表, set会话表] = React.useState([]);
      const [搜, set搜] = React.useState("");
      const [忙, set忙] = React.useState("");
      const [结果, set结果] = React.useState(null);
      const [提示, set提示] = React.useState("");
      const 拉工作区 = React.useCallback(() => {
        get("/workspaces").then((r) => {
          const 表 = r && r.workspaces || [];
          set工作区们(表);
          if (表.length && !目标区) set目标区(表[0].id);
        }).catch(() => {
        });
      }, [目标区]);
      const 拉会话 = React.useCallback((wid, q) => {
        get("/sessions-by-workspace?workspace=" + encodeURIComponent(wid || "") + "&q=" + encodeURIComponent(q || "")).then((r) => set会话表(r && r.sessions || [])).catch(() => set会话表([]));
      }, []);
      React.useEffect(() => {
        if (开) 拉工作区();
      }, [开, 拉工作区]);
      React.useEffect(() => {
        if (开 && 目标区) 拉会话(目标区, 搜);
      }, [开, 目标区, 搜, 拉会话]);
      const 选中文件 = (e) => {
        const f = e && e.target && e.target.files && e.target.files[0];
        if (!f) return;
        set扫(null);
        set勾({});
        set结果(null);
        set提示("");
        set忙("读");
        const 读 = new FileReader();
        读.onload = () => {
          const text = String(读.result || "");
          set挑({ name: f.name, bytes: f.size, text });
          set忙("");
          set忙("扫");
          post("/import/scan-text", { session: 目标会话 || 会话们[0] && 会话们[0].id || "", name: f.name, text }).then((r) => {
            set扫(r);
            if (r && r.ok) {
              const 全 = {};
              for (const it of r.items || []) if (!it.重复) 全[it.key] = true;
              set勾(全);
            } else set提示(r && r.message || "扫描失败");
          }).catch((err) => set提示(String(err))).then(() => set忙(""));
        };
        读.onerror = () => {
          set忙("");
          set提示("读文件失败");
        };
        读.readAsText(f, "utf-8");
      };
      const 勾数 = React.useMemo(() => Object.keys(勾).filter((k) => 勾[k]).length, [勾]);
      const 能导 = !!目标会话 && 勾数 > 0 && !忙;
      const 导入 = () => {
        if (!能导) return;
        const 要导 = (扫.items || []).filter((it) => 勾[it.key]);
        set忙("导");
        set提示("");
        post("/import/apply", { session: 目标会话, items: 要导 }).then((r) => {
          if (r && r.ok !== false) {
            set结果({ added: r.added || 0, 重复: r.重复 || 0, 近似: r.近似 || 0, batch: r.batch, session: 目标会话 });
            set提示("✓ 导入完成");
          } else set提示(r && r.message || "导入失败");
        }).catch((e) => set提示(String(e))).then(() => set忙(""));
      };
      const 停 = React.useRef(false);
      const 整理 = (只本次) => {
        if (!结果 || 忙) return;
        停.current = false;
        set忙("整理");
        set提示("① 改写口吻中…");
        const 附加 = 只本次 && 结果.batch ? { 批次: 结果.batch } : {};
        const 一步 = (地址, 名) => {
          const 跑 = () => {
            if (停.current) return Promise.resolve({ done: true, 停了: true });
            return post(地址, Object.assign({ session: 结果.session, 每批: 6 }, 附加)).then((r) => {
              if (!r || r.ok === false) throw new Error(r && r.message || 名 + "失败");
              if (r.done) return r;
              set提示(名 + "中：还剩 " + (r.剩 || 0) + " 条（这一轮 " + (r.改了 || 0) + " 条）…（点「停止」可以中断）");
              return 跑();
            });
          };
          return 跑();
        };
        一步("/refine", "① 改写").then(() => {
          if (停.current) return null;
          set提示("② 补检索词中…");
          return 一步("/expand", "② 补词");
        }).then(() => set提示(停.current ? "⏹ 已停止（没跑完的，下次点「整理」会接着来）" : "✓ 整理完成（口吻改好了、检索词也补上了）")).catch((e) => set提示("✗ " + String(e && e.message || e))).then(() => set忙(""));
      };
      const 撤销 = () => {
        if (!结果) return;
        set忙("撤");
        post("/import/undo", { session: 结果.session, batch: 结果.batch }).then((r) => set提示(r && r.ok ? "✓ 已撤销这一批" : r && r.message || "撤销失败")).catch((e) => set提示(String(e))).then(() => set忙(""));
      };
      const 卡头 = el(
        "div",
        { style: S.secH },
        el("span", { style: S.secTitle }, "从档案导入会话"),
        el("span", { style: S.secTag }, "把导出的档案读回来，变成记忆条目"),
        el("div", { style: { flex: 1 } }),
        el("button", { style: 开 ? S.btn : G.pillOn, onClick: () => set开(!开) }, 开 ? "收起" : "打开")
      );
      const 说明 = el(
        "div",
        { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 8 }) },
        "先在上面导出一份 .md，再在这里挑它导回来。只认 Markdown；同一份导两次也不会重复记。"
      );
      const 文件行 = el(
        "div",
        { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 } },
        // 原生 input（Electron 里弹的就是系统的「打开」对话框）；label 包一层当成按钮
        el(
          "label",
          { style: Object.assign({}, G.btn, { cursor: 忙 ? "default" : "pointer" }) },
          "选择 Markdown…",
          el("input", {
            type: "file",
            accept: ".md,.markdown,text/markdown",
            style: { display: "none" },
            disabled: !!忙,
            onChange: 选中文件
          })
        ),
        el(
          "span",
          { style: Object.assign({}, S.dim, { fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "40em" }), title: 挑 ? 挑.name : "" },
          挑 ? 挑.name + "（" + Math.max(1, Math.round((挑.bytes || 0) / 1024)) + " KB）" : "还没选文件"
        ),
        !挑 ? null : el("span", { style: Object.assign({}, S.dim, { fontSize: 12 }) }, 忙 === "扫" ? "读着呢…" : "")
      );
      const 候选区 = 扫 && 扫.ok ? el(
        "div",
        null,
        el(
          "div",
          { style: Object.assign({}, S.dim, { fontSize: 12, margin: "4px 0 6px" }) },
          (扫.file ? 扫.file.name + " · " + 扫.file.lines + " 行 · " : "") + "拆出 " + (扫.items || []).length + " 条候选" + (扫.提示 ? "（" + 扫.提示 + "）" : "")
        ),
        el(
          "div",
          { style: { display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" } },
          el("button", { style: S.btn, onClick: () => {
            const 全 = {};
            for (const it of 扫.items || []) 全[it.key] = true;
            set勾(全);
          } }, "全选"),
          el("button", { style: S.btn, onClick: () => set勾({}) }, "全不选"),
          el("span", { style: Object.assign({}, S.dim, { fontSize: 12, alignSelf: "center" }) }, "已勾 " + 勾数 + " / " + (扫.items || []).length)
        ),
        el(
          "div",
          { style: { maxHeight: 260, overflow: "auto", border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))", borderRadius: 8, padding: 6 } },
          (扫.items || []).map(
            (it) => el(
              "label",
              { key: it.key, style: { display: "flex", gap: 8, alignItems: "flex-start", padding: "4px 4px", fontSize: 12.5, cursor: "pointer" } },
              el("input", { type: "checkbox", checked: !!勾[it.key], onChange: () => set勾(Object.assign({}, 勾, { [it.key]: !勾[it.key] })) }),
              el("span", { style: { flex: 1, overflowWrap: "anywhere" } }, String(it.改后 || it.text || "").slice(0, 200)),
              el("span", { style: Object.assign({}, S.dim, { fontSize: 11, flex: "none" }) }, (it.重复 ? "重复 · " : "") + (it.section || ""))
            )
          )
        )
      ) : null;
      const 目标区块 = el(
        "div",
        { style: { marginTop: 12, marginBottom: 10 } },
        el("div", { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 4 }) }, "③ 导到哪儿"),
        el(
          "div",
          { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 } },
          el("span", { style: { fontSize: 12.5 } }, "工作区"),
          el(选择器, {
            style: Object.assign({}, S.inp, { width: "auto", minWidth: 160 }),
            值: 目标区,
            选项: [{ v: "", t: "（选一个工作区）" }].concat(
              工作区们.map((w) => ({ v: w.id, t: w.name + "（" + w.会话数 + " 个会话）" }))
            ),
            onChange: (v) => {
              set目标区(v);
              set目标会话("");
            }
          }),
          el("input", { style: Object.assign({}, S.inp, { width: 180 }), placeholder: "按会话名搜索…", value: 搜, onChange: (e) => set搜(e.target.value) })
        ),
        el(
          "div",
          { style: { maxHeight: 200, overflow: "auto", border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))", borderRadius: 8, padding: 4 } },
          会话表.length ? 会话表.map(
            (x) => el(
              "div",
              {
                key: x.id,
                role: "button",
                tabIndex: 0,
                style: { display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", borderRadius: 6, cursor: "pointer", fontSize: 12.5, background: 目标会话 === x.id ? "var(--dsw-alias-state-business-primary, #5b8fd6)" : "transparent", color: 目标会话 === x.id ? "#fff" : "inherit" },
                onClick: () => set目标会话(x.id),
                onKeyDown: (e) => {
                  if (e.key === "Enter" || e.key === " ") set目标会话(x.id);
                }
              },
              el("span", null, 目标会话 === x.id ? "●" : "○"),
              el("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, x.title || String(x.id || "").replace(/^session-/, "").slice(0, 12)),
              el("span", { style: { flex: "none", fontSize: 11, opacity: 0.75 } }, (x.事件数 || 0) + " 条事件")
            )
          ) : el("div", { style: Object.assign({}, S.dim, { fontSize: 12, padding: "8px 6px" }) }, 目标区 ? "这个工作区里没有匹配的会话" : "先选工作区")
        ),
        目标会话 ? el("div", { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 4 }) }, "已选：" + ((会话表.find((x) => x.id === 目标会话) || {}).title || 目标会话)) : null
      );
      const 动作行 = el(
        "div",
        { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
        el("button", { style: G.pillOn, disabled: !能导, onClick: 导入 }, 忙 === "导" ? "导入中…" : "导入这 " + 勾数 + " 条"),
        !目标会话 ? el("span", { style: Object.assign({}, S.dim, { fontSize: 12 }) }, "先选目标会话") : null,
        !勾数 ? el("span", { style: Object.assign({}, S.dim, { fontSize: 12 }) }, "先勾要导入的条目") : null
      );
      const 结果区 = 结果 ? el(
        "div",
        { style: { marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "var(--dsw-alias-bg-l1, rgba(127,127,127,.06))", border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))" } },
        el("div", { style: { fontSize: 12.5, marginBottom: 6 } }, "✓ 新增 " + 结果.added + " 条 · 跳过重复 " + 结果.重复 + " 条 · 近似 " + 结果.近似 + " 条"),
        el(
          "div",
          { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
          忙 === "整理" ? el("button", {
            style: Object.assign({}, S.btn, { borderColor: "var(--dsw-alias-state-warn-primary, #d6a35b)", color: "var(--dsw-alias-state-warn-primary, #d6a35b)" }),
            onClick: () => {
              停.current = true;
              set提示("要停了，等这一批跑完就不再发下一批…");
            }
          }, "停止") : el("button", { style: S.btn, onClick: () => 整理(true) }, "整理这批（本次导入的）"),
          el("button", { style: S.btn, disabled: !!忙, onClick: () => 整理(false) }, "连历史一起整理"),
          el("span", { style: Object.assign({}, S.dim, { fontSize: 11.5 }) }, "默认只整理本次导入的；「连历史一起」会把以前导入、还没提炼的也跑一遍（贵、慢，自己决定）"),
          el("button", { style: S.btn, disabled: !!忙, onClick: 撤销 }, "撤销这次导入")
        )
      ) : null;
      return el(
        "div",
        { style: Object.assign({}, S.sec, { marginTop: 14 }) },
        卡头,
        说明,
        开 ? el(
          "div",
          { style: { marginTop: 6 } },
          文件行,
          候选区,
          目标区块,
          动作行,
          提示 ? el("div", { style: Object.assign({}, S.dim, { fontSize: 12, marginTop: 8 }) }, 提示) : null,
          结果区
        ) : null
      );
    }
    return 从档案导入会话区;
  }

  // src/client/pages/advanced/semantic-section.js
  function 造语义区({ React, el, get, post, S, G }) {
    function 语义区() {
      const [st, setSt] = React.useState(null);
      const [开, set开] = React.useState(false);
      const [目录, set目录] = React.useState("");
      const [模型, set模型] = React.useState("");
      const [提示, set提示] = React.useState(null);
      const [跑, set跑] = React.useState(false);
      const 按钮行 = { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" };
      const 读 = React.useCallback(() => {
        get("/embed-status").then((r) => {
          if (!r) return;
          setSt(r);
          set开(!!r.开);
          set目录(String(r.模型目录 || ""));
          set模型(String(r.模型名 || ""));
        }).catch((e) => set提示("读不到状态：" + String(e && e.message || e)));
      }, []);
      React.useEffect(() => {
        读();
      }, [读]);
      React.useEffect(() => {
        if (!st || !st.下载中) return;
        const t = setInterval(读, 1500);
        return () => clearInterval(t);
      }, [st, 读]);
      const 存 = (补) => {
        set跑(true);
        post("/embed-config", Object.assign({ 开, 模型目录: 目录, 模型名: 模型 }, 补 || {})).then((r) => {
          set提示(r && r.ok ? "已保存" : "保存失败");
          setTimeout(() => 读(), 300);
        }).catch((e) => set提示("保存失败：" + String(e && e.message || e))).finally(() => set跑(false));
      };
      const 下载 = () => {
        set跑(true);
        post("/embed-download", {}).then((r) => {
          set提示(r && r.started ? "开始下载…（约 24MB，首次要几十秒）" : "启动失败");
          setTimeout(() => 读(), 1e3);
        }).catch((e) => set提示("下载失败：" + String(e && e.message || e))).finally(() => set跑(false));
      };
      const 默认 = st && st.默认目录 || "";
      return el(
        "div",
        { style: Object.assign({}, S.sec, { marginTop: 10 }) },
        el(
          "div",
          { style: S.secH },
          el("span", { style: S.secTitle }, "语义召回"),
          el("span", { style: S.secTag }, "P1-1 · 先用向量找“意思相近”的")
        ),
        el(
          "div",
          { style: Object.assign({}, S.dim, { lineHeight: 1.7 }) },
          "词面召回只认字面重合 ——「我全名咋写」和「ta叫沈知夏」一个字都不挨着，所以想不起来。开了这个，每条记忆多存一个向量，问句也转成向量，两路候选合在一起排。"
        ),
        el(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" } },
          el(
            "label",
            { style: { display: "flex", alignItems: "center", gap: 6, cursor: "pointer" } },
            el("input", {
              type: "checkbox",
              checked: 开,
              disabled: 跑,
              onChange: (e) => set开(!!e.target.checked)
            }),
            el("span", {}, "开启语义召回")
          ),
          st && st.加载过 ? el("span", { style: { color: "var(--dsw-alias-state-success-primary, #4a9)", fontSize: 12 } }, "● 模型已加载") : null,
          st && st.下载中 ? el("span", { style: { color: "var(--dsw-alias-state-warning-primary, #c90)", fontSize: 12 } }, "● 下载中…") : null,
          st && st.失败 ? el("span", { style: { color: "var(--dsw-alias-state-error-primary, #d66)", fontSize: 12, lineHeight: 1.5 } }, "● " + String(st.失败)) : null
        ),
        el(
          "div",
          { style: { marginTop: 8 } },
          el("div", { style: Object.assign({}, S.dim, { marginBottom: 4 }) }, "模型（bge-small-zh-v1.5，ONNX，512 维）"),
          el("input", {
            style: Object.assign({}, G.sel, { width: "100%", boxSizing: "border-box" }),
            placeholder: 默认 ? "留空 = " + 默认 : "模型目录（留空用默认）",
            value: 模型,
            disabled: 跑,
            onChange: (e) => set模型(e.target.value)
          }),
          el("div", { style: Object.assign({}, S.dim, { marginTop: 4 }) }, "默认 bge-small-zh-v1.5（BGE 非对称检索，短问句查陈述事实最稳）；填别的会按 HuggingFace 名字拉。")
        ),
        el(
          "div",
          { style: { marginTop: 8 } },
          el("div", { style: Object.assign({}, S.dim, { marginBottom: 4 }) }, "模型缓存目录"),
          el("input", {
            style: Object.assign({}, G.sel, { width: "100%", boxSizing: "border-box" }),
            placeholder: 默认 ? "留空 = " + 默认 : "留空用 $DSH_HOME/models",
            value: 目录,
            disabled: 跑,
            onChange: (e) => set目录(e.target.value)
          })
        ),
        el(
          "div",
          { style: Object.assign({}, 按钮行, { marginTop: 10 }) },
          el("button", { style: Object.assign({}, G.btn, { opacity: 跑 ? 0.5 : 1 }), disabled: 跑, onClick: () => 存({}) }, "保存"),
          el(
            "button",
            { style: Object.assign({}, G.btn, { opacity: 跑 ? 0.5 : 1 }), disabled: 跑, onClick: 下载 },
            st && st.加载过 ? "重新检查模型" : "下载默认模型"
          )
        ),
        提示 ? el("div", { style: Object.assign({}, S.dim, { marginTop: 6 }) }, 提示) : null
      );
    }
    return 语义区;
  }

  // src/client/pages/advanced.js
  function 造高级区({ React, el, get, post, S, G, toPct, fromPct, 进度, 更新条 }) {
    const 选择器 = 造选择器({ React, el });
    const 参数区 = 造参数区({ React, el, get, post, S, toPct, fromPct });
    const 生成档案区 = 造生成档案区({ React, el, get, post, S, G, 进度, 选择器 });
    const 从档案导入会话区 = 造从档案导入会话区({ React, el, get, post, S, G, 选择器 });
    const 语义区 = 造语义区({ React, el, get, post, S, G });
    function 高级区(props) {
      const [会话们, set会话们] = React.useState([]);
      const [维护在, set维护在] = React.useState("");
      const [维护提示, set维护提示] = React.useState(null);
      const [维护跑, set维护跑] = React.useState(false);
      const [维护模型, set维护模型] = React.useState(null);
      const [维护模型们, set维护模型们] = React.useState(null);
      const [维护范围, set维护范围] = React.useState("会话");
      const [维护区, set维护区] = React.useState("");
      const [维护搜, set维护搜] = React.useState("");
      const [维护表, set维护表] = React.useState([]);
      const [重复组, set重复组] = React.useState([]);
      const [要合并, set要合并] = React.useState(false);
      const [区表, set区表] = React.useState([]);
      const [清空范围, set清空范围] = React.useState("session");
      const [清空问, set清空问] = React.useState(false);
      const [清空字, set清空字] = React.useState("");
      const [清空跑, set清空跑] = React.useState(false);
      const [骨架预, set骨架预] = React.useState(null);
      const [骨架开, set骨架开] = React.useState(false);
      const [骨架跑, set骨架跑] = React.useState(false);
      const [骨架草, set骨架草] = React.useState(null);
      const [骨架存跑, set骨架存跑] = React.useState(false);
      const [骨提示, set骨提示] = React.useState(null);
      React.useEffect(() => {
        get("/list").then((l) => {
          const ss = (l && l.sessions || []).map((s) => ({ id: s.id, title: s.title || s.id }));
          set会话们(ss);
          if (ss[0]) set维护在(ss[0].id);
        }).catch(() => {
        });
        post("/models", { session: "" }).then((r) => {
          if (r && r.ok) set维护模型们(r);
        }).catch(() => {
        });
      }, []);
      React.useEffect(() => {
        get("/workspaces").then((r) => {
          const 表 = Array.isArray(r) ? r : r && r.workspaces || [];
          set区表(表);
          if (表.length) set维护区((v) => v || 表[0].id);
        }).catch(() => set区表([]));
      }, []);
      const 拉骨架预 = () => {
        get("/core-preview").then((r) => {
          if (r && r.ok !== false) {
            set骨架预(r);
            set骨提示(r && r.提示 || null);
          }
        }).catch(() => {
        });
      };
      React.useEffect(() => {
        拉骨架预();
      }, []);
      React.useEffect(() => {
        if (!维护区) return;
        get("/sessions-by-workspace?workspace=" + encodeURIComponent(维护区) + "&q=" + encodeURIComponent(维护搜 || "")).then((r) => set维护表(r && r.sessions || [])).catch(() => set维护表([]));
      }, [维护区, 维护搜]);
      const 导出全部 = () => {
        set维护跑(true);
        set维护提示("打包中…");
        post("/all", {}).then((r) => {
          if (!r || r.ok === false || !Array.isArray(r.memories)) throw new Error("读不出来");
          const 包 = {
            导出于: (/* @__PURE__ */ new Date()).toISOString(),
            统计: r.stats,
            记忆: r.memories,
            已删: r.deleted || []
          };
          const blob = new Blob([JSON.stringify(包, null, 2)], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "黏土记忆-" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + ".json";
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 2e3);
          set维护提示("✓ 导出了 " + r.memories.length + " 条（浏览器下载里找）");
        }).catch((e) => set维护提示("导出失败：" + String(e && e.message || e))).then(() => set维护跑(false));
      };
      const 做清空 = () => {
        const 范围 = 清空范围;
        const sid = 维护在;
        if (范围 === "session" && !sid) {
          set维护提示("先在上面选一个会话");
          return;
        }
        set清空跑(true);
        set维护提示("清空中…");
        post("/clear", { scope: 范围, session: sid, confirm: 清空字 }).then((r) => {
          set维护提示(r && r.ok ? "✓ " + (r.message || "清好了") : "✗ " + (r && r.message || "没成"));
          if (r && r.ok) {
            set清空问(false);
            set清空字("");
          }
        }).catch((e) => set维护提示("✗ " + String(e && e.message || e))).then(() => set清空跑(false));
      };
      const 撤销上一批 = () => {
        const sid = 维护在;
        if (!sid) {
          set维护提示("先在右边选一个会话");
          return;
        }
        const 名 = (会话们.find((x) => x.id === sid) || {}).title || String(sid).replace(/^session-/, "").slice(0, 8);
        const 问 = window.confirm(
          "把「" + 名 + "」恢复到最近一次批量操作之前？\n只认 30 分钟内的「补日期 / 补类型 / 补标长期设定」；\n撤完现在这份会存成 .before-undo，万一撤错还能拿回来。"
        );
        if (!问) return;
        set维护跑(true);
        set维护提示("正在回滚…");
        post("/undo-last", { session: sid }).then((r) => {
          if (!r || !r.ok) {
            set维护提示("撤不了：" + (r && r.message || "？"));
            return;
          }
          set维护提示(
            "✓ 已撤销「" + (r.撤掉 || "那次批量") + "」\n恢复：" + ((r.恢复 || []).join("、") || "（没有文件被换）")
          );
        }).catch((e) => set维护提示("撤销失败：" + String(e && e.message || e))).then(() => set维护跑(false));
      };
      const 做 = async (种) => {
        const sid = 维护在;
        if (!sid) {
          set维护提示("先在右边选一个会话");
          return;
        }
        set维护跑(true);
        set维护提示(种 + "…");
        try {
          if (种 === "补日期") {
            const r = await post("/backfill-dates", { session: sid });
            set维护提示(
              r && r.ok ? "✓ 补了 " + r.补了 + " 条（其中年份是猜的 " + r.猜的 + "），还有 " + r.还是没 + " 条真没日期" : "没成：" + (r && (r.message || r.error) || "？")
            );
          } else if (种 === "查重") {
            const r = await post("/duplicates", { session: sid });
            const 组们 = r && Array.isArray(r.组) ? r.组 : [];
            set重复组(组们);
            set维护提示(
              r && r.ok ? 组们.length ? "找到 " + 组们.length + " 组「像同一件事的」—— 底下可以就地合并，也可以先逐组看过再合" : "✓ 没找到重复" : "没成：" + (r && (r.message || r.error) || "？")
            );
          } else if (种 === "补类型") {
            let 目标sids = [sid];
            if (维护范围 === "工作区") {
              const 区r = await get("/sessions-by-workspace?workspace=" + encodeURIComponent(维护区));
              const 区sids = (区r && 区r.sessions || []).map((x) => x.id);
              if (!区sids.length) {
                set维护提示("这个工作区里没有会话");
                set维护跑(false);
                return;
              }
              目标sids = 区sids;
            }
            let 判 = 0;
            let 用 = "";
            let 跑过会话 = 0;
            for (const s0 of 目标sids) {
              let 连着空 = 0;
              for (let i = 0; i < 400; i++) {
                const 体 = { session: s0, 每批: 20 };
                if (维护模型) {
                  体.provider = 维护模型.provider;
                  体.model = 维护模型.model;
                }
                const r = await post("/classify-types", 体);
                if (!r || !r.ok) {
                  set维护提示("补类型失败：" + (r && r.message || "？") + "（判好的已经存下，再点一次接着跑）");
                  set维护跑(false);
                  return;
                }
                判 += r.判了 || 0;
                用 = r.用 || 用;
                set维护提示("已跑 " + 跑过会话 + "/" + 目标sids.length + " 个会话，判了 " + 判 + " 条…" + (用 ? "（" + 用 + "）" : ""));
                if (r.done) break;
                if (!(r.判了 || 0)) {
                  连着空++;
                  if (连着空 > 2) break;
                } else 连着空 = 0;
              }
              跑过会话++;
            }
            set维护提示("✓ 补类型完成：" + 跑过会话 + " 个会话、共 " + 判 + " 条" + (用 ? "（用的 " + 用 + "）" : ""));
          } else {
            let 判 = 0;
            let 升 = 0;
            let 降 = 0;
            let 连着空 = 0;
            let 头 = true;
            for (let i = 0; i < 400; i++) {
              const 体 = { session: sid, 每批: 20 };
              if (种 === "重判" && 头) 体.重判 = true;
              头 = false;
              const r = await post("/backfill-stable", 体);
              if (!r || !r.ok) {
                set维护提示("补标失败：" + (r && r.message || "？") + "（判好的已经存下，再点一次会接着跑）");
                set维护跑(false);
                return;
              }
              判 += r.判了 || 0;
              升 += r.改成不淡 || 0;
              降 += r.降成会淡 || 0;
              set维护提示("判了 " + 判 + " 条…（升 " + 升 + " / 降 " + 降 + "）");
              if (r.done) break;
              if (!(r.判了 || 0)) {
                连着空++;
                if (连着空 > 2) break;
              } else 连着空 = 0;
            }
            set维护提示("✓ 判了 " + 判 + " 条：升成「长期设定」" + 升 + " 条，降回会淡 " + 降 + " 条");
          }
        } catch (e) {
          set维护提示(String(e && e.message || e));
        }
        set维护跑(false);
      };
      const 合并组 = async () => {
        const sid = 维护在;
        if (!sid || !重复组.length) return;
        const 组们 = [];
        for (const g of 重复组) {
          const 条们 = g.条们 || [];
          if (条们.length < 2) continue;
          const 留 = 条们[0].id;
          const 删 = 条们.filter((t) => t.id !== 留).map((t) => t.id);
          if (删.length) 组们.push({ 留, 删 });
        }
        if (!组们.length) {
          set维护提示("这几组里没有能自动合的（每组不到 2 条）");
          return;
        }
        set维护跑(true);
        set维护提示("合并中…");
        try {
          const r = await post("/duplicates/merge", { session: sid, 组: 组们 });
          set维护提示(r && r.ok ? "✓ " + (r.message || "合并好了") : "没成：" + (r && (r.message || r.error) || "？"));
          if (r && r.ok) {
            set重复组([]);
            set要合并(false);
          }
        } catch (e) {
          set维护提示(String(e && e.message || e));
        }
        set维护跑(false);
      };
      const 组标题 = {
        fontSize: 12.5,
        fontWeight: 600,
        color: "var(--dsw-alias-label-secondary, #666)",
        margin: "14px 0 7px",
        display: "flex",
        alignItems: "center",
        gap: 6
      };
      const 按钮行 = { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" };
      const 分割线 = { margin: "14px 0", borderTop: "2px solid var(--dsw-alias-border-l1, rgba(128,128,128,.45))" };
      const 卡说明 = { fontSize: 11.5, marginTop: 6, color: "var(--dsw-alias-label-tertiary, #8a8a8a)", lineHeight: 1.6 };
      return el(
        "div",
        null,
        // ── 参数（2026-11-01 用户要求：从「会话 → 参数」整块搬来，替代原来的「记忆习惯」三档；
        //   样式沿用原来的折叠卡——默认收起，点标题才展开）
        el(参数区, null),
        // ⭐ F10 阶段 0（1.12.26）：骨架还空着，但主库已经攒够格的了 —— 顶上挂一条，别让人自己去猜
        骨提示 ? el(
          "div",
          {
            style: {
              margin: "0 0 10px",
              padding: "8px 10px",
              border: "1px solid rgba(194,65,12,.35)",
              background: "rgba(249,115,22,.07)",
              borderRadius: 8,
              fontSize: 12.5,
              lineHeight: 1.6,
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              flexWrap: "wrap"
            }
          },
          el(
            "span",
            { style: { flex: "1 1 320px" } },
            "有 " + 骨提示.够格 + " 条记忆够格进骨架（重要度 ≥0.8），但骨架现在是空的。骨架每轮都在场上，适合放「她是谁 / 怎么称呼 / 别做什么」这种长期不变的东西 —— 下面「骨架预览」里能挑几条进去。"
          )
        ) : null,
        // ── 骨架预览（1.12.0）
        //   骨架 _core.json 每轮都在场上，但它一直是手写的、跟主库脱节。
        //   这里把它当「主库的投影」：只算差在哪（该加的 / 主库已经不认的），
        //   写不写由人点 —— 自动覆盖会把手写的风格、边界冲掉，冲掉没后悔药。
        el(
          "div",
          { style: S.sec },
          el(
            "div",
            { style: S.secH },
            el("span", { style: S.secTitle }, "骨架预览"),
            el("span", { style: S.secTag }, "主库 → _core.json")
          ),
          el("div", { style: 分割线 }),
          (() => {
            if (!骨架预) return el("div", { style: 卡说明 }, "读不到骨架（文件不存在也算正常）");
            const 加 = (骨架预.新增 || []).length;
            const 下 = (骨架预.可下线 || []).length;
            const 已 = (骨架预.已有 || []).length;
            const 做写回 = () => {
              set骨架跑(true);
              post("/core-preview", { action: "apply" }).then((r) => {
                if (r && r.ok === false) throw new Error(r.message || "写回失败");
                set维护提示(r && r.message || "骨架已更新");
                set骨架开(false);
                拉骨架预();
              }).catch((e) => set维护提示(String(e && e.message || e))).then(() => set骨架跑(false));
            };
            const 存骨架 = () => {
              set骨架存跑(true);
              post("/core-preview", { action: "save", items: 骨架草 || [] }).then((r) => {
                if (r && r.ok === false) throw new Error(r.message || "保存失败");
                set维护提示(r && r.message || "骨架已保存");
                set骨架草(null);
                拉骨架预();
              }).catch((e) => set维护提示(String(e && e.message || e))).then(() => set骨架存跑(false));
            };
            return el(
              "div",
              null,
              el(
                "div",
                { style: 卡说明 },
                "骨架 " + 骨架预.骨架条数 + " 条 · 主库里够格的 " + 骨架预.候选条数 + " 条 · 可加 " + 加 + " · 可下线 " + 下 + " · 已经对上 " + 已
              ),
              el(
                "div",
                { style: Object.assign({}, 卡说明, { marginTop: 2 }) },
                "主库挑得出的只有「事实层 + 重要度 ≥ 0.8」；风格、边界、关系那种手写的，它挑不出来，也不会替你删。"
              ),
              骨架草 ? el(
                "div",
                null,
                el(
                  "div",
                  { style: Object.assign({}, 卡说明, { marginTop: 6 }) },
                  "改、删、加都行；留空的条目保存时会被丢掉。跟 AGENTS.md 或跟别条重不重复，你自己判断 —— 这里不给建议。"
                ),
                骨架草.map(
                  (it, i) => el(
                    "div",
                    { key: "ce" + i, style: { marginTop: 8 } },
                    el(
                      "div",
                      { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 3, flexWrap: "wrap" } },
                      el(
                        "span",
                        { style: Object.assign({}, 卡说明, { marginTop: 0 }) },
                        (it.core ? "◆ 核心" : "·") + " #" + (i + 1) + " · " + String(it.content || "").length + " 字"
                      ),
                      el(
                        "label",
                        { style: { fontSize: 11.5, display: "flex", gap: 4, alignItems: "center", cursor: "pointer" } },
                        el("input", {
                          type: "checkbox",
                          checked: it.core === true,
                          onChange: (e) => {
                            const 下份 = 骨架草.slice();
                            下份[i] = Object.assign({}, 下份[i], { core: e.target.checked });
                            set骨架草(下份);
                          }
                        }),
                        "核心画像（永不下线）"
                      ),
                      el(
                        "button",
                        {
                          style: { marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#c44", fontSize: 15, lineHeight: 1 },
                          title: "删这条",
                          onClick: () => set骨架草(骨架草.filter((_, j) => j !== i))
                        },
                        "×"
                      )
                    ),
                    el("textarea", {
                      style: G.area,
                      value: it.content || "",
                      onChange: (e) => {
                        const 下份 = 骨架草.slice();
                        下份[i] = Object.assign({}, 下份[i], { content: e.target.value });
                        set骨架草(下份);
                      }
                    })
                  )
                ),
                el(
                  "div",
                  { style: 按钮行 },
                  el(
                    "button",
                    {
                      style: S.btn,
                      onClick: () => set骨架草(骨架草.concat([{ id: "", content: "", core: false, importance: 0 }]))
                    },
                    "＋ 加一条"
                  ),
                  el(
                    "button",
                    { style: Object.assign({}, S.btn, { opacity: 骨架存跑 ? 0.5 : 1 }), disabled: 骨架存跑, onClick: 存骨架 },
                    骨架存跑 ? "保存中…" : "保存骨架"
                  ),
                  el("button", { style: S.btn, onClick: () => set骨架草(null) }, "取消")
                )
              ) : el(
                "div",
                null,
                el(
                  "div",
                  { style: 按钮行 },
                  el(
                    "button",
                    { style: S.btn, onClick: () => set骨架草((骨架预.items || []).map((x) => Object.assign({}, x))) },
                    "编辑骨架（" + 骨架预.骨架条数 + " 条）"
                  ),
                  加 || 下 ? el(
                    "button",
                    { style: S.btn, onClick: () => set骨架开(!骨架开) },
                    (骨架开 ? "收起" : "看差在哪") + "（+" + 加 + " / −" + 下 + "）"
                  ) : null,
                  加 || 下 ? el(
                    "button",
                    {
                      style: Object.assign({}, S.btn, { opacity: 骨架跑 ? 0.5 : 1 }),
                      onClick: 做写回,
                      disabled: 骨架跑
                    },
                    骨架跑 ? "写着…" : "写回骨架"
                  ) : null
                ),
                加 || 下 ? null : el("div", { style: Object.assign({}, 卡说明, { marginTop: 4 }) }, "✓ 主库里没有要改的"),
                骨架开 ? el(
                  "div",
                  { style: Object.assign({}, 卡说明, { marginTop: 6 }) },
                  el("div", null, "▸ 会加进去："),
                  (骨架预.新增 || []).map(
                    (x, i) => el("div", { key: "a" + i, style: { paddingLeft: 10 } }, "· " + x.content)
                  ),
                  el("div", { style: { marginTop: 4 } }, "▸ 会下线（主库已经不认了）："),
                  (骨架预.可下线 || []).map(
                    (x, i) => el("div", { key: "d" + i, style: { paddingLeft: 10 } }, "· " + x)
                  )
                ) : null
              )
            );
          })()
        ),
        // ── 整理会话
        el(
          "div",
          { style: S.sec },
          el(
            "div",
            { style: S.secH },
            el("span", { style: S.secTitle }, "整理会话"),
            el("span", { style: S.secTag }, "整理 · 检查 · 回退")
          ),
          el("div", { style: 分割线 }),
          el(
            "div",
            { style: Object.assign({}, 按钮行, { marginTop: 6 }) },
            el(选择器, {
              style: Object.assign({}, G.sel, { maxWidth: 210 }),
              值: 维护区,
              选项: (区表.length ? 区表 : [{ id: "", name: "（没有工作区）", 会话数: 0 }]).map((w) => ({
                v: w.id,
                t: (w.name || "工作区") + "（" + (w.会话数 || 0) + " 个会话）"
              })),
              onChange: (v) => {
                set维护区(v);
                set维护搜("");
                set维护在("");
              }
            }),
            el("input", {
              style: Object.assign({}, G.sel, { width: 150 }),
              placeholder: "按会话名搜索…",
              value: 维护搜,
              onChange: (e) => set维护搜(e.target.value)
            })
          ),
          el(
            "div",
            {
              style: {
                maxHeight: 150,
                overflow: "auto",
                border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))",
                borderRadius: 8,
                padding: 4,
                marginTop: 8
              }
            },
            维护表.length ? 维护表.map(
              (x) => el(
                "div",
                {
                  key: x.id,
                  role: "button",
                  tabIndex: 0,
                  style: {
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    padding: "6px 8px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12.5,
                    background: 维护在 === x.id ? "var(--dsw-alias-state-business-primary, #5b8fd6)" : "transparent",
                    color: 维护在 === x.id ? "#fff" : "inherit"
                  },
                  onClick: () => set维护在(x.id),
                  onKeyDown: (e) => {
                    if (e.key === "Enter" || e.key === " ") set维护在(x.id);
                  }
                },
                el("span", null, 维护在 === x.id ? "●" : "○"),
                el(
                  "span",
                  { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
                  x.title || String(x.id || "").replace(/^session-/, "").slice(0, 12)
                ),
                el("span", { style: { flex: "none", fontSize: 11, opacity: 0.75 } }, (x.事件数 || 0) + " 条事件")
              )
            ) : el(
              "div",
              { style: Object.assign({}, 卡说明, { padding: "8px 6px", margin: 0 }) },
              维护区 ? "这个工作区里没有匹配的会话" : "先选工作区"
            )
          ),
          el(
            "div",
            { style: Object.assign({}, 按钮行, { marginTop: 8 }) },
            // ⭐ 2026-10-31 用户要求：范围 —— 只跑选中的会话 / 整个工作区逐会话跑
            el(
              "select",
              {
                key: "范围",
                style: Object.assign({}, G.btn, { maxWidth: 170 }),
                disabled: 维护跑,
                value: 维护范围,
                onChange: (e) => set维护范围(String(e && e.target && e.target.value || "会话"))
              },
              el("option", { value: "会话" }, "范围：这个会话"),
              el("option", { value: "工作区" }, "范围：整个工作区")
            ),
            // ⭐ 2026-10-31 用户要求：补类型前可以先选模型（默认跟随 DSH 默认模型）
            el(
              "select",
              {
                key: "模型",
                style: Object.assign({}, G.btn, { maxWidth: 280 }),
                disabled: 维护跑,
                value: 维护模型 ? 维护模型.provider + "/" + 维护模型.model : "",
                onChange: (e) => {
                  const v = String(e && e.target && e.target.value || "");
                  if (!v) {
                    set维护模型(null);
                    return;
                  }
                  const i = v.indexOf("/");
                  set维护模型(i > 0 ? { provider: v.slice(0, i), model: v.slice(i + 1) } : null);
                }
              },
              el(
                "option",
                { value: "" },
                "模型：跟随默认" + (维护模型们 && 维护模型们.默认 && 维护模型们.默认.model ? "（" + 维护模型们.默认.model + "）" : "")
              ),
              ...维护模型们 && 维护模型们.ok ? (维护模型们.providers || []).flatMap(
                (p) => (p.models || []).map(
                  (m) => el("option", { key: p.id + "/" + m.id, value: p.id + "/" + m.id }, p.name + " / " + (m.name || m.id))
                )
              ) : []
            ),
            el(
              "button",
              {
                key: "读模型",
                style: G.btn,
                disabled: 维护跑,
                onClick: () => {
                  set维护提示("读着呢…");
                  post("/models", { session: 维护在 }).then((r) => {
                    set维护模型们(r);
                    if (r && r.ok) set维护提示("模型读好了，下拉里选一个再点补类型");
                    else set维护提示("✗ " + (r && r.message || "读模型失败"));
                  }).catch((e) => set维护提示("✗ " + String(e && e.message || e)));
                }
              },
              "读模型"
            ),
            ["补日期", "补类型", "补标长期设定", "重判"].map(
              (种) => el("button", { key: 种, style: G.btn, disabled: 维护跑, onClick: () => 做(种) }, 种)
            ),
            el(
              "button",
              {
                key: "撤销上一批",
                style: Object.assign({}, G.btn, {
                  borderColor: "var(--dsw-alias-state-warn-primary, #c9963f)",
                  color: "var(--dsw-alias-state-warn-primary, #c9963f)"
                }),
                disabled: 维护跑,
                onClick: 撤销上一批
              },
              "撤销上一批"
            )
          ),
          el("div", { style: 卡说明 }, "前四个会调模型、改分类，别连点。「撤销上一批」撤掉的是这个会话最近一次补日期 / 补类型 / 补标（30 分钟内有效）。"),
          el("div", { style: 组标题 }, "查重"),
          el(
            "div",
            { style: 按钮行 },
            el("button", { key: "查重", style: G.btn, disabled: 维护跑, onClick: () => 做("查重") }, "查重"),
            重复组.length ? 要合并 ? el(
              "span",
              { key: "确认条", style: Object.assign({}, 按钮行, { margin: 0 }) },
              el("span", { style: Object.assign({}, 卡说明, { margin: 0 }) }, "合并掉这 " + 重复组.length + " 组？每组只留最像的一条，其余进「已删」（可找回）"),
              el("button", { key: "确定", style: G.btn, disabled: 维护跑, onClick: 合并组 }, "确定合并"),
              el("button", { key: "取消", style: G.btn, onClick: () => set要合并(false) }, "算了")
            ) : el(
              "button",
              {
                key: "合并",
                style: Object.assign({}, G.btn, {
                  borderColor: "var(--dsw-alias-state-warn-primary, #c9963f)",
                  color: "var(--dsw-alias-state-warn-primary, #c9963f)"
                }),
                disabled: 维护跑,
                onClick: () => set要合并(true)
              },
              "合并这 " + 重复组.length + " 组"
            ) : null
          ),
          重复组.length ? el(
            "div",
            { style: { marginTop: 8, maxHeight: 220, overflow: "auto", border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))", borderRadius: 8, padding: 6 } },
            重复组.map(
              (g, i) => el(
                "div",
                { key: i, style: { padding: "6px 8px", borderBottom: i < 重复组.length - 1 ? "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.16))" : "none" } },
                el("div", { style: { fontSize: 12, fontWeight: 600, marginBottom: 2 } }, (g.类型 || "像同一件事") + " · " + (g.条们 ? g.条们.length : 0) + " 条"),
                (g.条们 || []).slice(0, 3).map(
                  (m, j) => el("div", { key: j, style: { fontSize: 11.5, color: "var(--dsw-alias-label-secondary, #777)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, "· " + String(m.text || "").slice(0, 60))
                )
              )
            )
          ) : null,
          el("div", { style: 卡说明 }, "只找出来、不自动合并。"),
          el("div", { style: 分割线 }),
          el(
            "div",
            { style: 按钮行 },
            el("button", { key: "导出全部", style: G.btn, disabled: 维护跑, onClick: 导出全部 }, "导出全部记忆（JSON）"),
            el("span", { style: Object.assign({}, 卡说明, { margin: 0 }) }, "整库、不分会话；含已删条目，不调模型、不花钱。留底 / 换电脑用这个。")
          ),
          维护提示 ? el(
            "div",
            {
              style: {
                marginTop: 10,
                padding: "8px 10px",
                borderRadius: 8,
                fontSize: 12,
                whiteSpace: "pre-line",
                background: "var(--dsw-alias-bg-l1, rgba(127,127,127,.08))",
                border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))"
              }
            },
            维护提示
          ) : null
        ),
        // ⭐ 1.10.2（F19）一键清空：独立一张卡，跟「整理会话」分开 ——
        //   一个是在旧记忆上做加工，一个是把记忆全收走，不该摆在一起。
        el(
          "div",
          { style: S.sec },
          el("div", { style: S.secH }, el("span", { style: S.secTitle }, "清空"), el("span", { style: S.secTag }, "收进回收站 · 能找回")),
          el(
            "div",
            { style: 卡说明 },
            "「清空」不销毁任何东西：全进回收站，随时能找回。真要彻底销毁，去「回收站」页点「把已删掉的清空」。"
          ),
          el(
            "div",
            { style: Object.assign({}, 按钮行, { marginTop: 8 }) },
            el(
              "select",
              {
                key: "清空范围",
                style: Object.assign({}, G.btn, { maxWidth: 260 }),
                disabled: 清空跑,
                value: 清空范围,
                onChange: (e) => {
                  set清空范围(String(e && e.target && e.target.value || "session"));
                  set清空问(false);
                  set清空字("");
                }
              },
              el("option", { value: "session" }, "只清这个会话（事实 / 工作区不动）"),
              el("option", { value: "all" }, "全清：事实 + 所有会话 + 工作区")
            ),
            el(
              "button",
              {
                key: "清空",
                style: Object.assign({}, G.btn, {
                  borderColor: "var(--dsw-alias-state-error-primary, rgba(208,90,90,.7))",
                  color: "var(--dsw-alias-state-error-primary, rgba(208,90,90,.95))"
                }),
                disabled: 清空跑,
                onClick: () => {
                  set清空问(!清空问);
                  set清空字("");
                }
              },
              清空问 ? "算了" : "清空…"
            )
          ),
          清空问 ? el(
            "div",
            { style: Object.assign({}, 按钮行, { marginTop: 8 }) },
            el(
              "span",
              { style: Object.assign({}, 卡说明, { margin: 0 }) },
              清空范围 === "all" ? "这会清掉**全部**（事实对所有工作区都不可见），清完在回收站能找回。" : "这会清掉「" + ((会话们.find((x) => x.id === 维护在) || {}).title || "当前会话") + "」的事件，事实和工作区不动。"
            ),
            el("input", {
              style: Object.assign({}, G.sel, { width: 110 }),
              placeholder: "打「清空」",
              value: 清空字,
              onChange: (e) => set清空字(e.target.value)
            }),
            el(
              "button",
              {
                key: "确定清空",
                style: Object.assign({}, G.btn, {
                  borderColor: "var(--dsw-alias-state-error-primary, rgba(208,90,90,.7))",
                  color: "var(--dsw-alias-state-error-primary, rgba(208,90,90,.95))"
                }),
                disabled: 清空跑 || 清空字.trim() !== "清空",
                onClick: 做清空
              },
              "确定清空"
            )
          ) : null
        ),
        el(生成档案区, { 会话号: 会话们[0] && 会话们[0].id || "" }),
        // ⭐ 1.8.0：导出档案正下方 —— 从档案导入会话
        el(从档案导入会话区, { 会话们 }),
        el(语义区),
        el("div", { style: { marginTop: 14 } }, el(更新条))
      );
    }
    return { 高级区 };
  }

  // src/client/pages/timeline.js
  function 造时间线页({ React, el, get, S, G, 类型名 }) {
    const 天数们 = [7, 14, 30];
    return function 时间线页() {
      const [天, set天] = React.useState(14);
      const [d, setD] = React.useState(null);
      const [错, set错] = React.useState(null);
      const [载, set载] = React.useState(true);
      React.useEffect(() => {
        let 活了 = true;
        set载(true);
        set错(null);
        get("/timeline?days=" + 天).then((r) => {
          if (!活了) return;
          if (!r || r.ok === false) set错(r && r.message || "拉不到时间线");
          else setD(r);
          set载(false);
        }).catch((e) => {
          if (!活了) return;
          set错(String(e && e.message || e));
          set载(false);
        });
        return () => {
          活了 = false;
        };
      }, [天]);
      const 标 = (x) => {
        const 名 = 类型名 ? 类型名(x) : x;
        return el(
          "span",
          { key: "b-" + x, style: Object.assign({}, G.badge, { marginLeft: 4, opacity: 0.75 }) },
          String(名 || x || "")
        );
      };
      const 顶 = el(
        "div",
        { style: Object.assign({}, S.secH, { marginBottom: 8 }) },
        el("span", { style: S.secTitle }, "时间线"),
        el("span", { style: S.secTag }, "那天记了什么 · 又想起过什么"),
        el(
          "span",
          { style: { marginLeft: "auto", display: "flex", gap: 6 } },
          ...天数们.map(
            (n) => el(
              "button",
              {
                key: "d" + n,
                style: Object.assign({}, n === 天 ? S.btnOn : S.btn, { padding: "2px 9px", fontSize: 12 }),
                onClick: () => set天(n)
              },
              "近 " + n + " 天"
            )
          )
        )
      );
      if (载 && !d) return el("div", null, 顶, el("div", { style: S.note }, "正在数…"));
      if (错) return el("div", null, 顶, el("div", { style: G.err }, "拉不到时间线：" + 错));
      const 每天 = d && d.每天 || [];
      if (!每天.length) {
        return el(
          "div",
          null,
          顶,
          el("div", { style: S.note }, "近 " + 天 + " 天没有记录 —— 这段时间要么没聊天，要么记忆功能没开着。")
        );
      }
      return el(
        "div",
        null,
        顶,
        ...每天.map((x) => {
          const 想 = x.想起 || { 次: 0, 有: 0, 条: 0, 空: 0, 兜底: 0 };
          const 一句话 = "记了 " + x.记数 + " 条 · 想起 " + 想.次 + " 次" + (想.有 ? "（" + 想.有 + " 次翻到东西，共 " + 想.条 + " 条）" : "") + (想.空 ? " · " + 想.空 + " 次什么都没翻到" : "") + (想.兜底 ? " · 兜底 " + 想.兜底 + " 次" : "");
          return el(
            "div",
            { key: x.日, style: Object.assign({}, S.sec, { marginBottom: 10 }) },
            el(
              "div",
              { style: S.secH },
              el("span", { style: S.secTitle }, x.日),
              el("span", { style: S.secTag }, 一句话)
            ),
            x.记.length ? el(
              "div",
              { style: { marginTop: 6 } },
              ...x.记.map(
                (m, i) => el(
                  "div",
                  {
                    key: "m" + i,
                    style: { display: "flex", alignItems: "baseline", gap: 6, fontSize: 12.5, lineHeight: 1.85, opacity: 0.9 }
                  },
                  el("span", { style: { opacity: 0.5, fontFamily: "monospace", fontSize: 11.5 } }, m.t),
                  el("span", { style: { flex: 1, minWidth: 0, wordBreak: "break-word" } }, m.text),
                  m.类型 ? 标(m.类型) : null,
                  m.性质 ? 标("性质:" + m.性质) : null
                )
              ),
              x.记数 > x.记.length ? el("div", { style: Object.assign({}, S.note, { marginTop: 4 }) }, "（还有 " + (x.记数 - x.记.length) + " 条没摆出来，去「记忆」页搜）") : null
            ) : el("div", { style: Object.assign({}, S.note, { marginTop: 4 }) }, "这天一条都没记")
          );
        }),
        el("div", { style: Object.assign({}, S.note, { marginTop: 4 }) }, "只统计保留在库里的记录；「想起」= 每轮对话取记忆的次数，兜底 = 没翻到、改用原文顶上的次数。")
      );
    };
  }

  // src/client/pages/recycle.js
  function 造回收站页({ React, get, post, S, el, 类型名 }) {
    function 回收站页() {
      const [数据, set数据] = React.useState(null);
      const [搜, set搜] = React.useState("");
      const [忙, set忙] = React.useState("");
      const 拉 = React.useCallback(() => {
        get("/recycle-bin").then((r) => set数据(r || { ok: false, message: "没读到" })).catch((e) => set数据({ ok: false, message: String(e && e.message || e) }));
      }, []);
      React.useEffect(() => {
        拉();
      }, [拉]);
      if (!数据) return el("div", { style: Object.assign({}, S.dim, { fontSize: 12 }) }, "读着…");
      if (!数据.ok) return el("div", { style: Object.assign({}, S.dim, { fontSize: 12 }) }, 数据.message || "读不出来");
      const 来源色 = { fact: "rgba(96,165,250,.85)", session: "rgba(148,163,184,.85)", workspace: "rgba(52,211,153,.85)" };
      const 类型名2 = (x) => x.来源类型 === "fact" ? "事实" : x.来源类型 === "workspace" ? "工作区" : "会话";
      const 短来源 = (x) => {
        const 全2 = String(x.来源 || "").trim();
        if (x.来源类型 !== "workspace") return 全2 || "—";
        const 段 = 全2.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
        return (段.length ? 段[段.length - 1] : 全2) || "工作区";
      };
      const q = 搜.trim().toLowerCase();
      const 全 = Array.isArray(数据.items) ? 数据.items : [];
      const 条 = q ? 全.filter((it) => String(it.text || "").toLowerCase().includes(q)) : 全;
      return el(
        "div",
        { style: S.sec },
        el("div", { style: S.secH }, el("span", { style: S.secTitle }, "回收站"), el("span", { style: S.secTag }, "删掉的都在这儿 · 能找回来")),
        el(
          "div",
          { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 8, overflowWrap: "anywhere" }) },
          "共 " + 数据.total + " 条。回收站不共用——事实库 / 每个会话 / 每个工作区各自一个，这里合起来看，标签标明来源。"
        ),
        el(
          "div",
          { style: { display: "flex", gap: 6, alignItems: "center", marginBottom: 8 } },
          el("input", {
            style: Object.assign({}, S.inp, { flex: 1 }),
            placeholder: "搜内容…",
            value: 搜,
            onChange: (e) => set搜(e.target.value)
          }),
          el("span", { style: Object.assign({}, S.dim, { fontSize: 12, flex: "none" }) }, q ? 条.length + " 条命中" : 数据.total + " 条"),
          el("button", { style: Object.assign({}, S.btn, { flex: "none", fontSize: 12, padding: "3px 10px" }), onClick: 拉 }, "刷新")
        ),
        条.length === 0 ? el("div", { style: Object.assign({}, S.dim, { fontSize: 12, padding: "8px 2px" }) }, q ? "没有匹配的" : "回收站是空的") : 条.map(
          (m) => el(
            "div",
            { key: m.file + ":" + m.id, style: Object.assign({}, S.row, S.条) },
            el(
              "span",
              {
                style: {
                  flex: "none",
                  fontSize: 11,
                  padding: "1px 6px",
                  borderRadius: 4,
                  border: "1px solid " + (来源色[m.来源类型] || "rgba(148,163,184,.6)"),
                  color: 来源色[m.来源类型] || "inherit"
                }
              },
              类型名2(m)
            ),
            el(
              "span",
              {
                style: { flex: "none", fontSize: 11.5, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.85 },
                title: m.来源 || ""
              },
              短来源(m)
            ),
            el("span", { style: { flex: 1, minWidth: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", opacity: 0.8 } }, m.text || "（空）"),
            el("span", { style: { flex: "none", fontSize: 11.5 } }, m.deletedAt ? String(m.deletedAt).slice(0, 10) : ""),
            el(
              "button",
              {
                style: {
                  flex: "none",
                  fontSize: 11,
                  padding: "2px 8px",
                  cursor: "pointer",
                  borderRadius: 4,
                  border: "1px solid rgba(148,163,184,.5)",
                  background: "transparent",
                  color: "inherit"
                },
                disabled: 忙 === m.id,
                onClick: () => {
                  set忙(m.id);
                  post("/recycle-bin", { file: m.file, id: m.id }).then((r) => {
                    if (r && r.ok) 拉();
                    else window.alert("没找回来：" + (r && r.message || "？"));
                  }).catch((e) => window.alert("找回来失败：" + String(e && e.message || e))).finally(() => set忙(""));
                }
              },
              忙 === m.id ? "…" : "找回来"
            )
          )
        )
      );
    }
    return 回收站页;
  }

  // src/client/pages/checkup.js
  var 启用陈旧检查 = false;
  function 造回复体检页({ React, get, post, B, S, el }) {
    function 折(props) {
      const 开 = !!props.开;
      const 切 = () => props.on切(!开);
      return el(
        "div",
        { style: Object.assign({}, S.sec, { marginBottom: 10 }) },
        el(
          "div",
          {
            style: Object.assign({}, S.secH, { marginBottom: 开 ? 10 : 0, cursor: "pointer" }),
            onClick: 切,
            role: "button",
            tabIndex: 0,
            "aria-expanded": 开,
            onKeyDown: (e) => {
              if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                e.preventDefault();
                切();
              }
            }
          },
          el("span", { style: S.secTitle }, (开 ? "▾ " : "▸ ") + props.标题),
          props.注 ? el("span", { style: S.secTag }, props.注) : null
        ),
        开 ? props.children : null
      );
    }
    function 回复体检页() {
      const [数据, set数据] = React.useState(null);
      const [忙, set忙] = React.useState(true);
      const [错, set错] = React.useState("");
      const [天数, set天数] = React.useState(14);
      const [条数, set条数] = React.useState(20);
      const [提醒, set提醒] = React.useState("");
      const [上限, set上限] = React.useState(200);
      const [提醒存, set提醒存] = React.useState("");
      const [开提醒, set开提醒] = React.useState(true);
      const [开体检, set开体检] = React.useState(false);
      const [自检, set自检] = React.useState(null);
      const [开自检, set开自检] = React.useState(true);
      const [自检忙, set自检忙] = React.useState("");
      const [自检错, set自检错] = React.useState("");
      const 跑自检 = React.useCallback(() => {
        set自检忙("跑着…");
        set自检错("");
        get("/selfcheck").then((r) => {
          set自检忙("");
          if (r && r.ok) set自检(r);
          else set自检错(String(r && r.error || "没跑成"));
        }).catch((e) => {
          set自检忙("");
          set自检错(String(e && e.message || e));
        });
      }, []);
      React.useEffect(() => {
        跑自检();
      }, [跑自检]);
      const 跑深检 = () => {
        set自检忙("深检中…");
        set自检错("");
        post("/selfcheck/deep", {}).then((r) => {
          set自检忙("");
          if (r && r.ok) set自检(r);
          else set自检错(String(r && r.error || "没跑成"));
        }).catch((e) => {
          set自检忙("");
          set自检错(String(e && e.message || e));
        });
      };
      const [整理, set整理] = React.useState(null);
      const [开整理, set开整理] = React.useState(false);
      const [整理中, set整理中] = React.useState("");
      const [整理后, set整理后] = React.useState("");
      const [陈旧, set陈旧] = React.useState(null);
      const [开陈旧, set开陈旧] = React.useState(false);
      const [陈旧忙, set陈旧忙] = React.useState("");
      const [陈旧后, set陈旧后] = React.useState("");
      const 载陈旧 = React.useCallback(() => {
        get("/stale").then((r) => {
          if (r && r.ok) set陈旧(r);
        }).catch(() => {
        });
      }, []);
      React.useEffect(() => {
        if (启用陈旧检查) 载陈旧();
      }, [载陈旧]);
      const 处置陈旧 = (键, 动作, 强制) => {
        set陈旧忙("处置中…");
        post("/stale/action", { 键, 动作, 强制: !!强制 }).then((r) => {
          if (r && r.ok) {
            set陈旧后(动作 === "undo" ? "撤销了，这条又能被想起来了" : 动作 === "confirm" ? "标成过时了（没删，随时能撤销）" : "记下了，这条路径不再烦你");
            set陈旧忙("");
            载陈旧();
          } else {
            set陈旧后(String(r && r.error || "没成"));
            set陈旧忙("");
          }
        }).catch((e) => {
          set陈旧后(String(e && e.message || e));
          set陈旧忙("");
        });
      };
      const 立刻扫陈旧 = () => {
        set陈旧忙("扫着…");
        post("/stale/scan", {}).then((r) => {
          if (r && r.ok) {
            set陈旧后("扫完了：待确认 " + (r.待确认数 || 0) + " 条");
            set陈旧忙("");
            载陈旧();
          } else {
            set陈旧后(String(r && r.error || "没扫成"));
            set陈旧忙("");
          }
        }).catch((e) => {
          set陈旧后(String(e && e.message || e));
          set陈旧忙("");
        });
      };
      const 陈旧护栏 = (x) => {
        if (!x) return "";
        if (x.伴随有效路径) return "同一句里还有有效路径，像是在举例";
        const 列举 = (x.命中记忆 || []).some((m) => Number(m.失效路径数 || 1) >= 2);
        if (列举) return "这条记忆提到了不止一个失效路径，像是在列举";
        return "";
      };
      const 载 = React.useCallback(() => {
        set忙(true);
        get("/reply-check?days=" + 天数 + "&limit=" + 条数).then((r) => {
          if (r && r.ok) {
            set数据(r);
            set错("");
          } else set错(r && r.message || "读不出来");
        }).catch((e) => set错(String(e && e.message || e))).finally(() => set忙(false));
      }, [天数, 条数]);
      React.useEffect(() => {
        get("/hint").then((r) => {
          if (r && r.ok) {
            set提醒(String(r.文字 || ""));
            set上限(Number(r.上限) || 200);
          }
        }).catch(() => {
        });
      }, []);
      React.useEffect(() => {
        载();
      }, [载]);
      React.useEffect(() => {
        get("/dedupe").then((r) => {
          if (r && r.ok) set整理(r);
        }).catch(() => {
        });
      }, []);
      const 提醒字 = Array.from(提醒).length;
      const 存提醒 = () => {
        set提醒存("保存中…");
        post("/hint", { 文字: 提醒 }).then((r) => {
          if (r && r.ok) {
            set提醒(String(r.文字 || ""));
            set提醒存(r.被截断 ? "超长已截到 " + (r.上限 || 200) + " 字" : "已保存 ✓");
          } else set提醒存("保存失败");
        }).catch((e) => set提醒存("保存失败：" + String(e && e.message || e)));
      };
      const 跑整理 = () => {
        set整理中("整理中…");
        set整理后("");
        post("/dedupe", {}).then((r) => {
          set整理中("");
          if (r && r.ok) {
            set整理((o) => Object.assign({}, o || {}, r));
            set整理后(r.合了 ? "合了 " + r.合了 + " 对，省下 " + r.省下 + " 字" : "没找到能合的");
            get("/dedupe").then((x) => {
              if (x && x.ok) set整理(x);
            }).catch(() => {
            });
          } else set整理中("失败：" + String(r && r.error || "未知"));
        }).catch((e) => {
          set整理中("");
          set整理中("失败：" + String(e && e.message || e));
        });
      };
      const 切规则 = (id) => {
        if (!数据) return;
        const 现在 = new Set(数据.disabled || []);
        if (现在.has(id)) 现在.delete(id);
        else 现在.add(id);
        post("/reply-check/rules", { disabled: [...现在] }).then(() => 载()).catch((e) => window.alert("保存失败：" + String(e && e.message || e)));
      };
      const 汇总 = 数据 && 数据.summary || { count: 0, totalHits: 0, hitRate: 0 };
      const 多行 = Object.assign({}, S.inp, {
        width: "100%",
        minHeight: 130,
        lineHeight: 1.6,
        fontFamily: "inherit",
        fontSize: 12.5,
        padding: "8px 10px",
        resize: "vertical",
        boxSizing: "border-box",
        whiteSpace: "pre-wrap"
      });
      return el(
        "div",
        { style: S.wrap },
        // ---------- ⓿ 兼容性自检（1.12.78）----------
        // 定位：DSH 客户端一升级就可能把事件/服务悄悄换掉，插件不崩不报错、只是那件事
        // 永远不发生（1.12.66 前 dream 静默失败三天就是这个形状）。所以这里不问「有没有
        // 报错」，问「该发生的事最近发生过没有」。
        折({
          标题: "兼容性自检",
          注: 自检 ? (自检.统计 && 自检.统计.结论) === "ok" ? "都正常" : (自检.统计 && 自检.统计.结论) === "warn" ? "有该看的项" : "有问题" : "客户端升级后插件还干不干活",
          开: 开自检,
          on切: set开自检,
          children: el(
            "div",
            null,
            el(
              "div",
              { style: Object.assign({}, S.dim, { fontSize: 11.5, lineHeight: 1.55, marginBottom: 8 }) },
              "查四层：服务在不在（apply 期间接住的那些）· 各条流水线最后干活距今多久 · " + (启用陈旧检查 ? "整理/归纳/陈旧检查的水位" : "整理/归纳的水位") + " · 库文件结构对不对。事件改名这类问题它不会当场发现，但最多两天就能从「上次成功距今多久」里看出来。"
            ),
            el(
              "div",
              { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 } },
              el(
                "button",
                { style: Object.assign({}, S.btn, { fontSize: 12, padding: "4px 10px" }), disabled: !!自检忙, onClick: 跑自检 },
                自检忙 === "跑着…" ? "跑着…" : "跑一次自检"
              ),
              el(
                "button",
                {
                  style: Object.assign({}, S.btn, { fontSize: 12, padding: "4px 10px" }),
                  disabled: !!自检忙,
                  onClick: 跑深检,
                  title: "会真的调一次模型（花一点点 token），确认模型通路能不能用"
                },
                自检忙 === "深检中…" ? "深检中…" : "深度检查（调模型）"
              ),
              el("span", { style: Object.assign({}, S.dim, { fontSize: 11 }) }, "浅检不花钱，深度检查会调一次模型"),
              自检 && 自检.上次检查 ? el("span", { style: Object.assign({}, S.dim, { fontSize: 11 }) }, "· " + String(自检.上次检查).slice(0, 16).replace("T", " ")) : null
            ),
            自检错 ? el("div", { style: Object.assign({}, S.drop, { fontSize: 12 }) }, 自检错) : null,
            自检 && 自检.统计 ? el(
              "div",
              {
                style: {
                  marginBottom: 10,
                  padding: "6px 10px",
                  borderRadius: 6,
                  fontSize: 12,
                  background: 自检.统计.结论 === "ok" ? "rgba(143,208,160,.10)" : 自检.统计.结论 === "warn" ? "rgba(224,176,112,.10)" : "rgba(201,128,128,.12)",
                  color: 自检.统计.结论 === "ok" ? "#8fd0a0" : 自检.统计.结论 === "warn" ? "#e0b070" : "#c98080"
                }
              },
              (自检.统计.结论 === "ok" ? "✓ 都正常" : 自检.统计.结论 === "warn" ? "⚠ 有几项该看看" : "✗ 有东西坏了") + " —— 正常 " + (自检.统计.ok || 0) + " / 要留意 " + (自检.统计.warn || 0) + " / 坏了 " + (自检.统计.fail || 0) + (自检.兜底 ? "（读不到 live 服务，只跑了兜底检查）" : "")
            ) : null,
            自检 && 自检.项们 && 自检.项们.length ? el(
              "div",
              null,
              自检.项们.map(
                (x, i) => el(
                  "div",
                  {
                    key: "hc" + i,
                    style: Object.assign({}, S.row, {
                      alignItems: "baseline",
                      borderBottom: "1px solid rgba(128,128,128,.12)",
                      padding: "4px 0"
                    })
                  },
                  el("span", { style: { flex: "0 0 16px", fontSize: 12, color: x.状态 === "ok" ? "#8fd0a0" : x.状态 === "warn" ? "#e0b070" : "#c98080" } }, x.状态 === "ok" ? "✓" : x.状态 === "warn" ? "!" : "✗"),
                  el("span", { style: { flex: "0 0 132px", fontSize: 12, whiteSpace: "nowrap" } }, String(x.名 || "")),
                  el(
                    "div",
                    { style: { flex: "1 1 0", minWidth: 0 } },
                    el("div", { style: Object.assign({}, S.dim, { fontSize: 11.5, wordBreak: "break-all" }) }, String(x.说明 || "")),
                    x.细节 ? el("div", { style: Object.assign({}, S.dim, { fontSize: 11, opacity: 0.78, marginTop: 2, wordBreak: "break-all" }) }, String(x.细节)) : null
                  )
                )
              )
            ) : el("div", { style: S.dim }, "还没跑过。")
          )
        }),
        // ---------- ① 临场提醒（每轮拼在记忆最后的一段固定文字）----------
        折({
          标题: "临场提醒",
          注: 提醒字 + " / " + 上限 + " 字" + (提醒 ? " · 正在生效" : " · 空着就不注入"),
          开: 开提醒,
          on切: set开提醒,
          children: el(
            "div",
            null,
            el(
              "div",
              { style: Object.assign({}, S.dim, { fontSize: 11.5, lineHeight: 1.55, marginBottom: 6 }) },
              "每轮都会追加到记忆「最后面」的一段固定文字 —— 用来自查这一轮的回复：语气对不对、有没有抢戏、有没有公文腔。只对自己的话管用，不写进记忆库、不占注入名额。"
            ),
            el("textarea", {
              style: 多行,
              value: 提醒,
              maxLength: 上限,
              placeholder: "例：每次回复前先想清楚——主人在说什么情绪、这轮该先用什么称呼、开头一句反应、中间讲正事、结尾一句收尾。别抢戏、别点句号。",
              onChange: (e) => {
                set提醒(e.target.value);
                if (提醒存) set提醒存("");
              }
            }),
            el(
              "div",
              { style: { display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" } },
              el(
                "button",
                { style: Object.assign({}, S.btn, { fontSize: 12, padding: "4px 10px" }), disabled: 提醒存 === "保存中…", onClick: 存提醒 },
                提醒存 === "保存中…" ? "保存中…" : "保存"
              ),
              el(
                "button",
                { style: Object.assign({}, S.btn, { fontSize: 12, padding: "4px 10px" }), onClick: () => {
                  set提醒("");
                  set提醒存("");
                } },
                "清空"
              ),
              el("span", { style: Object.assign({}, S.dim, { fontSize: 11 }) }, "改完下一轮就生效，不用重启"),
              提醒存 ? el("span", { style: Object.assign({}, S.ok, { fontSize: 11 }) }, 提醒存) : null
            )
          )
        }),
        // ---------- ② 回复体检（原有内容，收进折叠区）----------
        折({
          标题: "回复体检",
          注: 数据 ? 汇总.count + " 条 · 命中率 " + 汇总.hitRate + "%" : "词面规则 · 只观察不阻断",
          开: 开体检,
          on切: set开体检,
          children: el(
            "div",
            null,
            el("div", { style: S.dim }, "用词面规则给助手最近的回复打「AI 味」标签：只观察、不阻断、不改写。技术语境里的「不是 A 而是 B」这类排查句式会豁免。"),
            el(
              "div",
              { style: { display: "flex", gap: 8, alignItems: "center", margin: "10px 0" } },
              el("span", { style: S.dim }, "最近"),
              el("input", { style: S.inp, value: 天数, onChange: (e) => set天数(Number(e.target.value) || 14) }),
              el("span", { style: S.dim }, "天，取最近"),
              el("input", { style: S.inp, value: 条数, onChange: (e) => set条数(Number(e.target.value) || 20) }),
              el("span", { style: S.dim }, "条回复"),
              el("button", { style: S.btn, onClick: 载, disabled: 忙 }, 忙 ? "…" : "刷新")
            ),
            错 ? el("div", { style: S.drop }, 错) : null,
            数据 ? el("div", { style: S.nameBox }, "共 " + 汇总.count + " 条 · 命中 " + 汇总.totalHits + " 次 · 命中率 " + 汇总.hitRate + "% · 扫了 " + 数据.files + " 个会话文件") : null,
            数据 ? el("div", { style: S.h }, "规则开关") : null,
            数据 ? el(
              "div",
              null,
              (数据.rules || []).map(
                (r) => el(
                  "div",
                  { key: r.id, style: { display: "flex", gap: 8, alignItems: "center", padding: "2px 0" } },
                  el("input", { type: "checkbox", checked: r.enabled, onChange: () => 切规则(r.id) }),
                  el("span", { style: r.enabled ? {} : S.dim }, r.label),
                  el("span", { style: S.dim }, "(" + r.count + ")")
                )
              )
            ) : null,
            数据 ? el("div", { style: S.h }, "最近回复") : null,
            数据 ? el(
              "div",
              null,
              (数据.messages || []).slice().reverse().map(
                (m) => el(
                  "div",
                  { key: (m.sessionId || "") + ":" + m.seq, style: Object.assign({}, S.条, { padding: "8px 0" }) },
                  el(
                    "div",
                    { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" } },
                    el("span", { style: S.dim }, String(m.length) + " 字"),
                    el("span", { style: S.dim }, "得分 " + m.score),
                    ...(m.hits || []).map(
                      (h) => el(
                        "span",
                        { key: h.id, style: { padding: "1px 6px", borderRadius: 4, background: "rgba(224,176,112,.18)", border: "1px solid rgba(224,176,112,.4)", fontSize: 11.5 } },
                        h.label + " " + Math.round((h.confidence || 0) * 100) + "%"
                      )
                    )
                  ),
                  el("div", { style: { fontSize: 12.5, marginTop: 4, color: "var(--dsw-alias-label-secondary, #8a8a8a)" } }, m.text),
                  m.hits && m.hits.length ? el("div", { style: { fontSize: 11.5, marginTop: 2, color: "var(--dsw-alias-label-tertiary, #999)" } }, m.hits.map((h) => h.evidence).join(" ｜ ")) : null
                )
              )
            ) : null
          )
        }),
        // ---------- ③ 重复整理（存量重复自查自合）----------
        折({
          标题: "重复整理",
          注: 整理 ? (整理.待合 ? 整理.待合 + " 对可以合" : "现在没有重复") + (整理.上次 ? " · 上次 " + String(整理.上次).slice(5, 16).replace("T", " ") : "") : "还没跑过",
          开: 开整理,
          on切: set开整理,
          children: el(
            "div",
            null,
            el(
              "div",
              { style: Object.assign({}, S.dim, { fontSize: 11.5, lineHeight: 1.55, marginBottom: 6 }) },
              "每 24 小时自己查一次：库里「短条的内容长条全都有」那种真重复会自动合掉，被合的那条进回收站、随时能捞回来。汇总型（长条包住好几条不同的事）一律不碰，只列给人看。"
            ),
            el(
              "div",
              { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" } },
              el(
                "button",
                { style: Object.assign({}, S.btn, { fontSize: 12, padding: "4px 10px" }), disabled: 整理中 === "整理中…", onClick: 跑整理 },
                整理中 === "整理中…" ? "整理中…" : "现在整理一次"
              ),
              整理后 ? el("span", { style: Object.assign({}, S.ok, { fontSize: 11 }) }, 整理后) : null,
              整理中 && 整理中 !== "整理中…" ? el("span", { style: S.drop, fontSize: 11 }, 整理中) : null
            ),
            (整理 && 整理.历史 && 整理.历史.length ? 整理.历史 : []).map(
              (h, i) => el(
                "div",
                { key: "h" + i, style: Object.assign({}, S.条, { padding: "6px 0" }) },
                el(
                  "div",
                  { style: { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" } },
                  el("span", { style: S.dim }, String(h.时间 || "").slice(5, 16).replace("T", " ")),
                  el("span", {}, "合了 " + (h.合了 || 0) + " 对"),
                  el("span", { style: S.dim }, "省 " + (h.省下 || 0) + " 字")
                ),
                (h.明细 || []).map(
                  (d, j) => el(
                    "div",
                    { key: "d" + j, style: { fontSize: 11.5, marginTop: 3, color: "var(--dsw-alias-label-secondary, #8a8a8a)" } },
                    "· " + String(d.摘要 || "").slice(0, 30) + "… （" + (d.合前 || "") + " → " + (d.合后 || "") + "）"
                  )
                )
              )
            )
          )
        }),
        // ---------- ④ 陈旧检查（记忆里写的路径现在还在不在）—— 1.12.79 起默认不显示 ----------
        启用陈旧检查 ? 折({
          标题: "陈旧检查",
          注: 陈旧 ? (陈旧.统计 && 陈旧.统计.待确认 ? 陈旧.统计.待确认 + " 条待确认" : "没有失效的路径") + (陈旧.上次检查 ? " · 上次 " + String(陈旧.上次检查).slice(5, 16).replace("T", " ") : "") : "还没跑过",
          开: 开陈旧,
          on切: set开陈旧,
          children: el(
            "div",
            null,
            el(
              "div",
              { style: Object.assign({}, S.dim, { fontSize: 11.5, lineHeight: 1.55, marginBottom: 6 }) },
              "每 24 小时自己扫一遍记忆里提到的路径，只看「这个东西现在还在不在盘上」，不判断这条记忆对不对。东西搬走、记错位置、路径换写法都可能命中，所以每一条都要人看一眼再决定。标成过时不会删原件，随时能恢复。"
            ),
            el(
              "div",
              { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" } },
              el(
                "button",
                { style: Object.assign({}, S.btn, { fontSize: 12, padding: "4px 10px" }), disabled: 陈旧忙 === "扫着…", onClick: 立刻扫陈旧 },
                陈旧忙 === "扫着…" ? "扫着…" : "现在扫一次"
              ),
              陈旧后 ? el("span", { style: Object.assign({}, S.ok, { fontSize: 11 }) }, 陈旧后) : null,
              陈旧忙 && 陈旧忙 !== "扫着…" && 陈旧忙 !== "处置中…" ? el("span", { style: S.drop, fontSize: 11 }, 陈旧忙) : null
            ),
            (陈旧 && 陈旧.待确认 && 陈旧.待确认.length ? 陈旧.待确认 : []).map(
              (x) => el(
                "div",
                { key: "st" + x.键, style: Object.assign({}, S.条, { padding: "8px 0" }) },
                el(
                  "div",
                  { style: { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" } },
                  el("span", { style: { fontSize: 12.5, fontWeight: 600, wordBreak: "break-all" } }, x.字面 || x.键),
                  el("span", { style: S.dim, fontSize: 11 }, (x.命中记忆 || []).length + " 条记忆提到它"),
                  x.伴随有效路径 ? el("span", { style: Object.assign({}, S.secTag, { background: "rgba(143,208,160,.16)", color: "#8fd0a0" }) }, "同一句里还有有效路径") : null,
                  x.疑似历史说明 ? el("span", { style: Object.assign({}, S.secTag, { background: "rgba(224,176,112,.16)", color: "#e0b070" }) }, "像在说以前的事") : null
                ),
                (x.命中记忆 || []).map(
                  (m, i) => el(
                    "div",
                    { key: "sm" + i, style: { fontSize: 11.5, marginTop: 3, color: "var(--dsw-alias-label-secondary, #8a8a8a)" } },
                    "· " + String(m.摘录 || "").slice(0, 60)
                  )
                ),
                el(
                  "div",
                  { style: { display: "flex", gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap" } },
                  el(
                    "button",
                    {
                      style: Object.assign({}, S.btn, { fontSize: 11.5, padding: "3px 9px", opacity: 陈旧护栏(x) ? 0.7 : 1 }),
                      // 2026-11-22：护栏不再把按钮按死。机械规则再准也会冤枉人（比如那条排坑记忆），
                      //   最后一下该由人拍 —— 点了弹二次确认，确认过带 强制 交给后端放行。
                      disabled: 陈旧忙 === "处置中…",
                      title: 陈旧护栏(x) ? "机械护栏：" + 陈旧护栏(x) + "（点一下会再问你一次）" : "标成过时之后召回不再出它，原件还在，随时能撤销",
                      onClick: () => {
                        const 栏 = 陈旧护栏(x);
                        if (栏) {
                          const 敢 = typeof window === "undefined" || !window.confirm ? true : window.confirm(
                            "机械护栏说：" + 栏 + "\n\n这条可能是在举例或列举，标成过时会连排坑知识一起不召回。\n原件不删，标完还能撤销。确定要标吗？"
                          );
                          if (!敢) return;
                        }
                        处置陈旧(x.键, "confirm", !!栏);
                      }
                    },
                    "标成过时（不再召回）"
                  ),
                  el(
                    "button",
                    { style: Object.assign({}, S.btn, { fontSize: 11.5, padding: "3px 9px" }), disabled: 陈旧忙 === "处置中…", onClick: () => 处置陈旧(x.键, "ignore") },
                    "留着，别管它"
                  ),
                  陈旧护栏(x) ? el("span", { style: Object.assign({}, S.dim, { fontSize: 11 }) }, "· " + 陈旧护栏(x)) : null
                )
              )
            ),
            陈旧 && 陈旧.待确认 && !陈旧.待确认.length ? el("div", { style: S.dim }, "没有待确认的路径。") : null,
            陈旧 && 陈旧.已处置 && 陈旧.已处置.length ? el(
              "div",
              { style: { marginTop: 10 } },
              el("div", { style: Object.assign({}, S.dim, { fontSize: 11.5, marginBottom: 4 }) }, "已标成过时的（召回不再出这些，还能撤销）："),
              陈旧.已处置.map(
                (x) => el(
                  "div",
                  {
                    key: "sc" + x.键,
                    style: { display: "flex", gap: 8, alignItems: "center", fontSize: 11.5, marginTop: 3, flexWrap: "wrap" }
                  },
                  el("span", { style: { wordBreak: "break-all" } }, "· " + (x.字面 || x.键)),
                  x.处置于 ? el("span", { style: S.dim }, String(x.处置于).slice(0, 16).replace("T", " ")) : null,
                  el(
                    "button",
                    {
                      style: Object.assign({}, S.btn, { fontSize: 11, padding: "2px 8px" }),
                      disabled: 陈旧忙 === "处置中…",
                      title: "撤销之后这条记忆又会出现在召回里",
                      onClick: () => 处置陈旧(x.键, "undo")
                    },
                    "撤销"
                  )
                )
              )
            ) : null,
            陈旧 && 陈旧.已恢复 && 陈旧.已恢复.length ? el(
              "div",
              { style: { marginTop: 10 } },
              el("div", { style: Object.assign({}, S.dim, { fontSize: 11.5, marginBottom: 4 }) }, "已经恢复的（路径又在了）："),
              陈旧.已恢复.map(
                (x) => el(
                  "div",
                  {
                    key: "sr" + x.键,
                    style: { display: "flex", gap: 8, alignItems: "center", fontSize: 11.5, marginTop: 3, flexWrap: "wrap", color: "var(--dsw-alias-label-secondary, #8a8a8a)" }
                  },
                  el("span", { style: { wordBreak: "break-all" } }, "· " + (x.字面 || x.键)),
                  x.已处置 && x.已处置.length || x.处置于 ? el(
                    "button",
                    {
                      style: Object.assign({}, S.btn, { fontSize: 11, padding: "2px 8px" }),
                      disabled: 陈旧忙 === "处置中…",
                      title: "之前因路径失效标过「过时」，现在路径回来了，点这里把记忆恢复进召回",
                      onClick: () => 处置陈旧(x.键, "undo")
                    },
                    "恢复记忆（撤销过时）"
                  ) : null
                )
              )
            ) : null
          )
        }) : null
      );
    }
    return 回复体检页;
  }

  // src/client/pages/guard.js
  function 造拦截页({ React, el, get, post, S }) {
    function 收一条(r) {
      const 正则表 = {};
      let 参数 = null;
      const 文 = String(r.args || "").trim();
      if (文) {
        try {
          参数 = JSON.parse(文);
        } catch (_) {
          return { 错: "参数不是合法 JSON" };
        }
      }
      if (参数 && typeof 参数 === "object" && !Array.isArray(参数)) {
        Object.keys(参数).forEach((k) => {
          正则表[k] = 参数[k];
        });
      } else if (参数 !== null) {
        return { 错: '参数得是对象，形如 {"file_path":["^..."], "命令":["..."]}' };
      }
      const 工具们 = String(r.tools || "").split(",").map((x) => x.trim()).filter(Boolean);
      if (!工具们.length) return { 错: "至少写一个工具名（* 表示全部）" };
      const 区们 = String(r.workspace || "").split(",").map((x) => x.trim()).filter(Boolean);
      const 条 = {
        id: String(r.id || "").trim() || void 0,
        tools: 工具们,
        action: "deny",
        reason: String(r.reason || "").trim() || void 0
      };
      if (Object.keys(正则表).length) 条.args = 正则表;
      if (区们.length) 条.workspace = 区们.length === 1 ? 区们[0] : 区们;
      return { 条 };
    }
    function 摊一条(r) {
      return {
        id: String(r && r.id || ""),
        tools: Array.isArray(r && r.tools) ? r.tools.join(", ") : String(r && r.tools || ""),
        args: r && r.args ? JSON.stringify(r.args) : "",
        workspace: Array.isArray(r && r.workspace) ? r.workspace.join(", ") : String(r && r.workspace || ""),
        reason: String(r && r.reason || "")
      };
    }
    function 拦截页() {
      const [开, set开] = React.useState(false);
      const [规则, set规则] = React.useState([]);
      const [工作区们, set工作区们] = React.useState([]);
      const [配置错误, set配置错误] = React.useState([]);
      const [载入中, set载入中] = React.useState(true);
      const [提示, set提示] = React.useState(null);
      const [存中, set存中] = React.useState(false);
      const [测工具, set测工具] = React.useState("read");
      const [测参数, set测参数] = React.useState('{"file_path":"G:\\\\Windows\\\\system.ini"}');
      const [测工作区, set测工作区] = React.useState("");
      const [测结果, set测结果] = React.useState(null);
      const [测中, set测中] = React.useState(false);
      const [单测, set单测] = React.useState(null);
      const [人话, set人话] = React.useState("");
      const [翻中, set翻中] = React.useState(false);
      const [翻结果, set翻结果] = React.useState(null);
      const 读 = React.useCallback(() => {
        get("/guard").then((x) => {
          set开(!!(x && x.enabled));
          set规则(Array.isArray(x && x.rules) ? x.rules.map(摊一条) : []);
          set工作区们(Array.isArray(x && x.工作区们) ? x.工作区们 : []);
          set配置错误(Array.isArray(x && x.编译错误) ? x.编译错误 : []);
          set载入中(false);
        }).catch((e) => {
          set载入中(false);
          set提示({ 样: "drop", 文: "读不到拦截配置：" + String(e && e.message || e) });
        });
      }, []);
      React.useEffect(() => {
        读();
      }, [读]);
      const 改一条 = (i, 键, 值) => {
        set规则((prev) => prev.map((r, j) => j === i ? Object.assign({}, r, { [键]: 值 }) : r));
        set提示(null);
        set单测(null);
      };
      const 加一条 = () => {
        set规则((prev) => prev.concat([{ id: "", tools: "", args: "", workspace: "", reason: "" }]));
        set提示(null);
        set单测(null);
      };
      const 删一条 = (i) => {
        set规则((prev) => prev.filter((_, j) => j !== i));
        set提示(null);
        set单测(null);
      };
      function 测一条(i) {
        const 一 = 收一条(规则[i]);
        if (一.错) {
          set单测({ i, 结果: { ok: false, error: "这条写法有问题：" + 一.错 } });
          return;
        }
        const 工具 = String(测工具 || "").trim();
        if (!工具) {
          set单测({ i, 结果: { ok: false, error: "先在下面「干跑一次」里填个工具名（比如 read）" } });
          return;
        }
        let 参数 = null;
        const 文 = String(测参数 || "").trim();
        if (文) {
          try {
            参数 = JSON.parse(文);
          } catch (_) {
            set单测({ i, 结果: { ok: false, error: "下面干跑区的参数不是合法 JSON" } });
            return;
          }
        }
        set单测({ i, 结果: { 载入: true } });
        post("/guard/test", { tool: 工具, args: 参数, workspace: 测工作区, rules: [一.条] }).then((x) => set单测({ i, 结果: x || { ok: false, error: "后端没返回" } })).catch((e) => set单测({ i, 结果: { ok: false, error: String(e && e.message || e) } }));
      }
      function 单测样式(结果) {
        if (!结果 || 结果.载入) return S.dim;
        if (!结果.ok) return S.drop;
        return 结果.拦不拦 ? S.ok : S.warn;
      }
      function 单测文字(结果) {
        if (!结果) return "";
        if (结果.载入) return "试中…";
        if (!结果.ok) return "没试成：" + String(结果.error || "");
        if (结果.拦不拦) {
          const 规 = 结果.命中的 || {};
          return "✓ 这条会拦下这次调用" + (规.reason ? "；对助手说「" + 规.reason + "」" : "");
        }
        return "✗ 这条拦不住这次调用 —— 工具名或参数正则没对上";
      }
      function 折规则() {
        const 出 = [];
        const 错 = [];
        规则.forEach((r, i) => {
          const 一 = 收一条(r);
          if (一.错) 错.push("第 " + (i + 1) + " 条：" + 一.错);
          else 出.push(一.条);
        });
        return { 出, 错 };
      }
      function 存() {
        const { 出, 错 } = 折规则();
        if (错.length) {
          set提示({ 样: "drop", 文: "先改这两处再存：" + 错.join("；") });
          return;
        }
        set存中(true);
        post("/guard/save", { enabled: 开, rules: 出 }).then((x) => {
          set存中(false);
          if (x && x.ok === false) {
            set提示({ 样: "drop", 文: "没存进去：" + String(x.error || "（后端没给原因）") });
            return;
          }
          set提示({ 样: "ok", 文: "存好了，立刻生效（不用重启）" });
          读();
        }).catch((e) => {
          set存中(false);
          set提示({ 样: "drop", 文: "存失败：" + String(e && e.message || e) });
        });
      }
      function 试() {
        let 参数 = null;
        const 文 = String(测参数 || "").trim();
        if (文) {
          try {
            参数 = JSON.parse(文);
          } catch (e) {
            set测结果({ ok: false, error: "参数不是合法 JSON：" + String(e && e.message || e) });
            return;
          }
        }
        const { 出, 错 } = 折规则();
        if (错.length) {
          set测结果({ ok: false, error: "表里有写坏的规则，先修：" + 错.join("；") });
          return;
        }
        set测中(true);
        set测结果(null);
        post("/guard/test", { tool: String(测工具 || "").trim(), args: 参数, workspace: 测工作区, rules: 出 }).then((x) => {
          set测中(false);
          set测结果(x || { ok: false, error: "后端没返回" });
        }).catch((e) => {
          set测中(false);
          set测结果({ ok: false, error: String(e && e.message || e) });
        });
      }
      function 翻一句() {
        const 话 = String(人话 || "").trim();
        if (!话) {
          set翻结果({ ok: false, error: "先在框里写一句要求，比如「别读 Windows 目录里的文件」" });
          return;
        }
        set翻中(true);
        set翻结果(null);
        post("/guard/translate", { text: 话 }).then((x) => {
          set翻中(false);
          set翻结果(x || { ok: false, error: "后端没返回" });
        }).catch((e) => {
          set翻中(false);
          set翻结果({ ok: false, error: String(e && e.message || e) });
        });
      }
      function 并入规则表() {
        const 条 = 翻结果 && Array.isArray(翻结果.规则们) ? 翻结果.规则们 : [];
        if (!条.length) return;
        set规则((prev) => prev.concat(条.map(摊一条)));
        set提示({ 样: "ok", 文: "已把 " + 条.length + " 条草稿并入下面的规则表 —— 看过没问题再点上面的「保存」" });
        set翻结果(null);
      }
      const 输入条 = (键, 宽, 占位, 值, i, 额外) => {
        const 样式 = Object.assign({}, S.inp, { padding: "4px 8px", fontSize: 12.5 }, 宽 ? { width: 宽 } : null, 额外 || {});
        return el("input", {
          value: 值,
          placeholder: 占位,
          onChange: (e) => 改一条(i, 键, e.target.value),
          style: 样式
        });
      };
      const 字段 = (名, 小字, 子, 额外) => el(
        "div",
        { style: Object.assign({ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0, padding: "6px 0" }, 额外 || {}) },
        el("span", { style: { flex: "0 0 56px", fontSize: 13, lineHeight: "26px", opacity: 0.9, whiteSpace: "nowrap" } }, 名),
        el(
          "div",
          { style: { flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 3 } },
          子,
          el("span", { style: Object.assign({}, S.dim, { fontSize: 11, lineHeight: 1.5 }) }, 小字)
        )
      );
      const 翻译块 = el(
        "div",
        { style: S.editBox },
        el("div", { style: { fontWeight: 600, marginBottom: 4 } }, "用一句话说（可选）"),
        el(
          "div",
          { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 6 }) },
          "写人话，让插件自己的模型翻成规则草稿。翻出来**不会直接生效** —— 得你并入下面的规则表、看过、再点「保存」。每翻一次要花一点 token。"
        ),
        el("textarea", {
          value: 人话,
          rows: 2,
          onChange: (e) => set人话(e.target.value),
          placeholder: "例如：别让助手读 Windows 和 Program Files 里的文件",
          style: S.area
        }),
        el(
          "div",
          { style: Object.assign({}, S.row, { marginTop: 6, alignItems: "center" }) },
          el("button", { style: Object.assign({}, S.btn, { opacity: 翻中 ? 0.6 : 1 }), onClick: 翻一句 }, 翻中 ? "翻…" : "翻成规则"),
          el("span", { style: Object.assign({}, S.dim, { fontSize: 11.5 }) }, "只能说「拦什么」；「除了某处以外都放行」这种现在还表达不出来")
        ),
        翻结果 && 翻结果.ok === false ? el(
          "div",
          { style: Object.assign({}, S.drop, { marginTop: 6, fontSize: 12 }) },
          "没翻出来：" + String(翻结果.error || ""),
          翻结果.原文 ? el("div", { style: Object.assign({}, S.dim, { marginTop: 4, fontSize: 11 }) }, "模型原文：" + String(翻结果.原文)) : null
        ) : null,
        翻结果 && 翻结果.ok ? el(
          "div",
          { style: { marginTop: 8, fontSize: 12.5 } },
          Array.isArray(翻结果.规则们) && 翻结果.规则们.length ? el(
            "div",
            null,
            el(
              "div",
              { style: { fontWeight: 600, marginBottom: 4 } },
              "翻出 " + 翻结果.规则们.length + " 条" + (翻结果.截断 ? "（模型没写全，只救回这些）" : "") + "："
            ),
            翻结果.规则们.map(
              (r, i) => el(
                "div",
                { key: i, style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 2 }) },
                i + 1 + ". " + String(r && r.id || "（没名字）") + " · 工具 " + (Array.isArray(r && r.tools) ? r.tools.join(", ") : String(r && r.tools || "")) + (r && r.args ? " · 参数 " + JSON.stringify(r.args) : "") + (r && r.workspace ? " · 只在 " + (Array.isArray(r.workspace) ? r.workspace.join(", ") : r.workspace) : "") + (r && r.reason ? " · 「" + r.reason + "」" : "")
              )
            ),
            Array.isArray(翻结果.编译错误) && 翻结果.编译错误.length ? el(
              "div",
              { style: Object.assign({}, S.warn, { fontSize: 11.5, marginTop: 4 }) },
              "有 " + 翻结果.编译错误.length + " 条写得不对，并入后要改：" + 翻结果.编译错误.join("；")
            ) : null,
            el("button", { style: Object.assign({}, S.btn, { marginTop: 6 }), onClick: 并入规则表 }, "并入规则表")
          ) : el("div", { style: S.dim }, "模型认为这句话里没有需要拦的东西（回了空数组）。"),
          翻结果.用 ? el("div", { style: Object.assign({}, S.dim, { fontSize: 11, marginTop: 6 }) }, "用的模型：" + String(翻结果.用)) : null
        ) : null
      );
      const 规则卡 = (r, i) => el(
        "div",
        {
          key: i,
          style: {
            margin: "8px 0",
            padding: "8px 10px 10px",
            borderRadius: 8,
            border: "1px solid rgba(128,128,128,.28)",
            background: "rgba(128,128,128,.08)"
          }
        },
        el(
          "div",
          { style: Object.assign({}, S.row, { alignItems: "center", rowGap: 6 }) },
          el("span", { style: Object.assign({}, S.secTag, { flex: "none" }) }, "规则 " + (i + 1)),
          输入条("id", 0, "给这条起个名字（可空）", r.id, i, { flex: 1, minWidth: 180 }),
          el("button", { style: Object.assign({}, S.btnDanger, { flex: "none" }), onClick: () => 删一条(i) }, "删掉"),
          el(
            "button",
            {
              style: Object.assign({}, S.btn, { flex: "none", opacity: 单测 && 单测.i === i && 单测.结果 && 单测.结果.载入 ? 0.6 : 1 }),
              title: "用下面「干跑一次」里填的工具和参数，试试这一条拦不拦得住",
              onClick: () => 测一条(i)
            },
            "测试"
          )
        ),
        字段("工具", "拦哪些工具 · 逗号分隔 · bash* 通配 · * = 全部", 输入条("tools", 0, "read, write, bash*", r.tools, i, { width: "100%" })),
        字段("工作区", "只在哪个工作区生效 · 空 = 哪都拦", 输入条("workspace", 0, "G:\\DSH_WORKSPACE\\需求开发", r.workspace, i, { width: "100%" })),
        字段(
          "参数",
          "匹配哪些参数 · JSON · 键之间「且」· 同一个键里多个正则「或」· 空 = 只按工具名拦",
          el("input", {
            value: r.args || "",
            placeholder: '{"file_path":["^[A-Za-z]:[\\\\\\\\/]Windows[\\\\\\\\/]"]}',
            onChange: (e) => 改一条(i, "args", e.target.value),
            style: Object.assign({}, S.inp, { width: "100%", fontFamily: "ui-monospace, Consolas, monospace" })
          })
        ),
        字段(
          "反馈",
          "拦下时对助手说的话 · 写该怎么做，比只写「不行」有用",
          输入条("reason", 0, "Windows 系统目录不归助手管，换个位置", r.reason, i, { width: "100%" })
        ),
        单测 && 单测.i === i ? el("div", { style: Object.assign({}, 单测样式(单测.结果), { fontSize: 12, marginTop: 8 }) }, 单测文字(单测.结果)) : null
      );
      const 规则表 = el(
        "div",
        null,
        el("div", { style: Object.assign({}, S.dim, { marginBottom: 4 }) }, "一条 = 匹配哪些工具 + 匹配哪些参数 + 拦在哪个工作区。参数键之间是「且」，同一个键里多个正则是「或」。参数没出现就不拦（宁可少拦）。"),
        规则.length === 0 ? el(
          "div",
          { style: Object.assign({}, S.editBox, { margin: "8px 0", textAlign: "center", fontSize: 12.5 }) },
          "还没有规则。点下面「加一条」——不知道怎么写，先看页脚的三个例子。"
        ) : el("div", null, 规则.map(规则卡)),
        el("div", { style: { marginTop: 10 } }, el("button", { style: S.btn, onClick: 加一条 }, "加一条规则"))
      );
      const 输入框 = (值, 改, 占位, 额外) => el("input", {
        value: 值,
        placeholder: 占位,
        onChange: (e) => 改(e.target.value),
        style: Object.assign({}, S.inp, { padding: "4px 8px", fontSize: 12.5, width: "100%" }, 额外 || {})
      });
      const 示例们 = [
        {
          名: "别碰 Windows 系统目录",
          说明: "读、写、改、shell 全都管；路径正则同时认正斜杠和反斜杠",
          规则: {
            id: "别碰 Windows 系统目录",
            tools: ["read", "write", "edit", "bash*"],
            args: { file_path: ["^[A-Za-z]:[\\\\/]Windows[\\\\/]"] },
            reason: "Windows 系统目录不归助手管，要改东西去自己的目录"
          }
        },
        {
          名: "只在这个工作区里生效",
          说明: "工作区写前缀加 *，别的项目里这条就不拦",
          规则: {
            id: "只在这个工作区里生效",
            tools: ["*"],
            workspace: "G:\\DSH_WORKSPACE\\*",
            reason: "这条只管这个工作区"
          }
        },
        {
          名: "别手改记忆库",
          说明: "按文件名片段拦，不用跟反斜杠较劲",
          规则: {
            id: "别手改记忆库",
            tools: ["read", "edit", "write"],
            args: { file_path: ["clay-memory.*_facts"] },
            reason: "记忆库由插件自己写，手改容易把格式弄坏"
          }
        }
      ];
      function 按这个加一条(示例) {
        set规则((prev) => prev.concat([摊一条(示例.规则)]));
        set提示({ 样: "ok", 文: "已按「" + 示例.名 + "」加了一条，改完记得点上面的「保存」" });
      }
      const 示例块 = el(
        "div",
        { style: S.sec },
        el(
          "div",
          { style: S.secH },
          el("span", { style: S.secTitle }, "怎么写一条"),
          el("span", { style: S.secTag }, "点一下就填进规则表")
        ),
        示例们.map(
          (示例, i) => el(
            "div",
            {
              key: "ex" + i,
              style: {
                margin: "6px 0",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(128,128,128,.22)",
                background: "rgba(128,128,128,.06)"
              }
            },
            el("div", { style: { fontSize: 12.5, fontWeight: 600 } }, i + 1 + ". " + 示例.名),
            el("div", { style: Object.assign({}, S.dim, { fontSize: 11.5, lineHeight: 1.7, margin: "2px 0 6px" }) }, 示例.说明),
            el("button", { style: S.btn, onClick: () => 按这个加一条(示例) }, "按这个加一条")
          )
        )
      );
      const 测试块 = el(
        "div",
        { style: S.editBox },
        el("div", { style: Object.assign({}, S.dim, { marginBottom: 2 }) }, "干跑一次：不走真工具，只问「这次调用会不会被拦」。改完不存也能试。"),
        字段("工具", "要试的工具名 · read / bash / write …", 输入框(测工具, set测工具, "read")),
        字段("工作区", "空 = 不限（不按工作区过滤）", 输入框(测工作区, set测工作区, "空 = 不限")),
        字段(
          "参数",
          "这次调用带的参数 · JSON · 留空 = 没有参数",
          el("textarea", {
            value: 测参数,
            rows: 3,
            onChange: (e) => set测参数(e.target.value),
            placeholder: '{"file_path":"G:\\\\Windows\\\\system.ini"}',
            style: Object.assign({}, S.area, { fontSize: 12, width: "100%" })
          })
        ),
        el("div", { style: { marginTop: 10, paddingLeft: 66 } }, el("button", { style: Object.assign({}, S.btn, { opacity: 测中 ? 0.6 : 1 }), onClick: 试 }, 测中 ? "试…" : "试试拦不拦")),
        测结果 && 测结果.ok === false ? el("div", { style: Object.assign({}, S.drop, { marginTop: 6, fontSize: 12 }) }, "试不了：" + String(测结果.error || "")) : null,
        测结果 && 测结果.ok ? el(
          "div",
          { style: { marginTop: 8, fontSize: 12.5 } },
          el(
            "div",
            { style: Object.assign({}, 测结果.拦不拦 ? S.drop : S.ok, { fontWeight: 600 }) },
            测结果.拦不拦 ? "会被拦下" : "不会被拦，会照常执行"
          ),
          测结果.拦不拦 && 测结果.命中的 ? el("div", { style: { marginTop: 4 } }, "命中规则：" + String(测结果.命中的.id || "（没写名字）") + " —— " + String(测结果.命中的.reason || "（它没说理由）")) : null,
          el("div", { style: Object.assign({}, S.dim, { marginTop: 4 }) }, "这条会话的工作区：" + (测结果.工作区 || "（查不到）")),
          Array.isArray(测结果.逐条) && 测结果.逐条.length ? el(
            "div",
            { style: Object.assign({}, S.dim, { marginTop: 6 }) },
            测结果.逐条.map(
              (x, i) => el(
                "div",
                { key: i, style: { fontSize: 12 } },
                (x.中 ? "✓ " : "✗ ") + String(x.id || "第 " + (i + 1) + " 条") + (x.workspace === false ? "（工作区不对）" : "")
              )
            )
          ) : null
        ) : null
      );
      if (载入中) return el("div", { style: S.dim }, "正在读拦截配置…");
      return el(
        "div",
        { style: S.wrap },
        el(
          "div",
          { style: S.sec },
          el(
            "div",
            { style: S.secH },
            el("span", { style: S.secTitle }, "工具拦截"),
            el("span", { style: S.secTag }, "Beta"),
            el("span", { style: Object.assign({}, S.dim, { fontSize: 11.5 }) }, "命中就拦下不执行，不是提示")
          ),
          el(
            "div",
            { style: Object.assign({}, S.dim, { fontSize: 12, marginBottom: 8 }) },
            "规则完全由你写，插件一条都不内置 —— 它只负责「拦住」。在哪配都生效：这里、配置文件、老的独立网页。改完立刻生效，不用重启。"
          ),
          el(
            "div",
            { style: Object.assign({}, S.warn, { fontSize: 12, lineHeight: 1.5, marginBottom: 8, padding: "6px 8px", borderRadius: 6, background: "rgba(224,176,112,.10)", border: "1px solid rgba(224,176,112,.28)" }) },
            "Beta —— 这是一道「提醒」，不是「保险箱」。它只按「工具名 + 参数正则」去比，写法不对、路径换个写法（比如 /c/Windows）、或者本机工具名跟规则里写的不一样，都可能漏；漏掉的时候工具会照常执行，它不知道。要紧的东西别只指望它 —— 要真兜底，把会话的文件权限收紧（沙箱 / 审批），那道才拦得住「不该写的目录」。"
          ),
          el(
            "div",
            { style: Object.assign({}, S.row, { alignItems: "center", padding: "4px 0" }) },
            el(
              "label",
              { style: { display: "flex", alignItems: "center", gap: 6, cursor: "pointer" } },
              el("input", { type: "checkbox", checked: 开, onChange: (e) => {
                set开(e.target.checked);
                set提示(null);
              } }),
              "总开关（关掉 = 全部放行）"
            ),
            el("button", { style: Object.assign({}, S.btn, { opacity: 存中 ? 0.6 : 1 }), onClick: 存 }, 存中 ? "存…" : "保存"),
            el("button", { style: S.btn, onClick: 读 }, "刷新"),
            el("span", { style: Object.assign({}, S.dim, { fontSize: 11.5, marginLeft: "auto" }) }, "改完点「保存」才会写回配置文件")
          ),
          提示 ? el("div", { style: Object.assign({}, 提示.样 === "ok" ? S.ok : S.drop, { fontSize: 12, marginTop: 6 }) }, 提示.文) : null,
          配置错误.length ? el(
            "div",
            { style: Object.assign({}, S.warn, { fontSize: 12, marginTop: 6 }) },
            "配置文件里有 " + 配置错误.length + " 条写法不对（那条会被跳过，不连累别的）：" + 配置错误.join("；")
          ) : null
        ),
        el("div", { style: S.sec }, 翻译块),
        el("div", { style: S.sec }, 规则表),
        el("div", { style: S.sec }, 测试块),
        示例块
      );
    }
    return { 拦截页 };
  }

  // src/client/pages/backfill.js
  function 造补记页({ React, el, get, post, S, 初始会话 }) {
    const { useState, useEffect } = React;
    const 动作名 = { add: "新增", update: "改写", noop: "跳过" };
    const 动作色 = {
      add: "var(--dsw-alias-state-success-primary, #2f8f5b)",
      update: "var(--dsw-alias-state-warning-primary, #b7791f)",
      noop: "var(--dsw-alias-label-secondary, #888)"
    };
    function 时长(字节) {
      const n = Number(字节) || 0;
      if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + "MB";
      return Math.round(n / 1024) + "KB";
    }
    function 那天(毫秒) {
      const n = Number(毫秒);
      if (!n || !isFinite(n)) return "";
      const d = new Date(n);
      const p = (x) => String(x).padStart(2, "0");
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
    }
    function 补记页(props) {
      const 想要的会话 = props && props.初始会话 || 初始会话 || "";
      const 直接进 = !!想要的会话;
      const [会话们, set会话们] = useState([]);
      const [选中, set选中] = useState("");
      const [候选, set候选] = useState(null);
      const [勾, set勾] = useState({});
      const [批次们, set批次们] = useState([]);
      const [忙, set忙] = useState("");
      const [错, set错] = useState("");
      const [提示, set提示] = useState("");
      const [诊断, set诊断] = useState(null);
      function 拉会话() {
        set忙("会话");
        set错("");
        get("/backfill/sessions" + (想要的会话 ? "?当前=" + encodeURIComponent(想要的会话) : "")).then((r) => {
          if (!r || !r.ok) {
            set错(r && r.error || "拿不到会话列表");
            set会话们([]);
            return;
          }
          set会话们(Array.isArray(r.会话们) ? r.会话们 : []);
          set诊断(r.当前诊断 && r.当前诊断.会话 ? r.当前诊断 : null);
          if (!选中) {
            const 想要 = (r.会话们 || []).find((x) => x.会话 === 想要的会话);
            if (想要) set选中(想要.文件);
            else if (!想要的会话 && r.会话们 && r.会话们.length) set选中(r.会话们[0].文件);
          }
        }).catch((e) => set错(String(e && e.message || e))).finally(() => set忙(""));
      }
      function 拉批次() {
        get("/backfill/batches").then((r) => {
          if (r && r.ok) {
            const 全 = Array.isArray(r.批次们) ? r.批次们 : [];
            set批次们(想要的会话 ? 全.filter((b) => b.会话 === 想要的会话) : 全);
          }
        }).catch(() => {
        });
      }
      useEffect(() => {
        拉会话();
        拉批次();
      }, []);
      const 这条 = 会话们.find((x) => x.文件 === 选中) || null;
      function 试提取() {
        if (!这条) {
          return;
        }
        set忙("预览");
        set错("");
        set提示("");
        set候选(null);
        post("/backfill/preview", { 会话: 这条.会话, 文件: 这条.文件 }).then((r) => {
          if (!r || !r.ok) {
            set错(r && (r.error || r.message) || "提取失败");
            return;
          }
          set候选(r);
          const 新勾 = {};
          (r.候选 || []).forEach((c, i) => {
            if (c.动作 !== "noop") 新勾[i] = true;
          });
          set勾(新勾);
        }).catch((e) => set错(String(e && e.message || e))).finally(() => set忙(""));
      }
      function 写进去() {
        if (!候选 || !这条) return;
        const 通过 = (候选.候选 || []).filter((c, i) => 勾[i]);
        if (!通过.length) {
          set错("一条都没勾，没什么可写的");
          return;
        }
        set忙("应用");
        set错("");
        post("/backfill/apply", { 会话: 这条.会话, 通过 }).then((r) => {
          if (!r || !r.ok) {
            set错(r && (r.error || r.message) || "写入失败");
            return;
          }
          set提示("写进去了，批次 " + String(r.批次 || "") + "；反悔的话在下面点「撤销」");
          set候选(null);
          set勾({});
          拉会话();
          拉批次();
        }).catch((e) => set错(String(e && e.message || e))).finally(() => set忙(""));
      }
      function 撤批次(批) {
        if (!批) return;
        if (typeof window !== "undefined" && typeof window.confirm === "function") {
          if (!window.confirm("撤销批次 " + 批 + "？\n\n· 这一批写进去的条目会被删掉\n· 被它取代的旧条目会恢复原样")) return;
        }
        set忙("撤销");
        set错("");
        set提示("");
        post("/backfill/undo", { 批次: 批 }).then((r) => {
          if (!r || !r.ok) {
            set错(r && (r.error || r.message) || "撤销失败");
            return;
          }
          set提示("撤销了：删掉 " + Number(r.删了 || 0) + " 条，恢复 " + Number(r.恢复了 || 0) + " 条");
          拉批次();
          拉会话();
        }).catch((e) => set错(String(e && e.message || e))).finally(() => set忙(""));
      }
      const 计 = 候选 && 候选.计 || null;
      return el(
        "div",
        { style: S.wrap },
        // ── 说明 ──
        el(
          "div",
          { style: S.dim },
          "挑一个以前聊过、但当时没记下来的会话，按你现在的偏好重新过一遍，提取出该记的条目。先给你看、你来勾，确认了才写；写进去打成一个批次，反悔能整批撤掉。"
        ),
        el("div", { style: { ...S.dim, marginTop: 4 } }, "只有「预览」这一步会调一次模型，其余都不花 token。"),
        // ── 第一步：选会话 ──
        直接进 ? null : el("div", { style: S.sec }, el("div", { style: S.secH }, el("span", { style: S.secTitle }, "① 选一个历史会话"))),
        直接进 ? null : el(
          "div",
          { style: { ...S.row, marginTop: 6 } },
          el("button", { style: S.btn, onClick: 拉会话, disabled: !!忙 }, 忙 === "会话" ? "刷新中…" : "刷新列表"),
          el("span", { style: S.dim }, "共 " + 会话们.length + " 个（读对话 ≥6 条、助手至少回 2 句的）")
        ),
        直接进 ? null : 会话们.length === 0 ? el("div", { style: { ...S.dim, marginTop: 6 } }, "没有可补记的会话。") : el(
          "select",
          {
            style: { ...S.inp, marginTop: 6, width: "100%" },
            value: 选中,
            onChange: (e) => {
              set选中(e.target.value);
              set候选(null);
              set勾({});
            }
          },
          会话们.map(
            (x) => el(
              "option",
              { key: x.会话, value: x.文件 },
              (x.已补记 ? "✓ " : "") + x.会话.slice(0, 20) + " · " + x.条数 + " 条（我 " + x.用户 + " / 你 " + x.助手 + "）· " + 时长(x.字节) + " · " + 那天(x.时间)
            )
          )
        ),
        直接进 ? el(
          "div",
          { style: 选中 ? { ...S.dim, marginTop: 6 } : { ...S.drop, marginTop: 6 } },
          选中 ? "补记的就是这个会话，不用再挑。" : 诊断 && 诊断.为什么 || "这个会话还不在可补记的范围里：要至少 6 条真正对话、而且我至少回过 2 句。"
        ) : null,
        // ── 第二步：预览 ──
        el("div", { style: S.sec }, el("div", { style: S.secH }, el("span", { style: S.secTitle }, "看它想记什么"))),
        el(
          "div",
          { style: { ...S.row, marginTop: 6 } },
          el("button", { style: S.btn, onClick: 试提取, disabled: !!忙 || !这条 }, 忙 === "预览" ? "正在读…（要调一次模型）" : "试提取一下"),
          计 ? el(
            "span",
            { style: S.dim },
            "新增 " + Number(计.add || 0) + " · 改写 " + Number(计.update || 0) + " · 跳过 " + Number(计.noop || 0),
            "　原文 " + Number(候选.文本长度 || 0) + " 字" + (候选.秒 ? "　花了 " + 候选.秒 + " 秒" : "")
          ) : el("span", { style: S.dim }, "这一步会花 token")
        ),
        候选 && (候选.候选 || []).length === 0 ? el("div", { style: { ...S.dim, marginTop: 6 } }, "这段对话里没有值得记的新东西。") : null,
        候选 && (候选.候选 || []).length > 0 ? el(
          "div",
          { style: { marginTop: 8 } },
          (候选.候选 || []).map(
            (c, i) => el(
              "div",
              {
                key: i,
                style: {
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  padding: "6px 8px",
                  borderRadius: 6,
                  background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,.06))",
                  marginBottom: 4
                }
              },
              el("input", {
                type: "checkbox",
                checked: !!勾[i],
                disabled: c.动作 === "noop",
                onChange: (e) => set勾((p) => ({ ...p, [i]: e.target.checked })),
                style: { marginTop: 3 }
              }),
              el(
                "div",
                { style: { flex: 1, minWidth: 0 } },
                el(
                  "div",
                  { style: { display: "flex", gap: 6, alignItems: "baseline" } },
                  el("span", { style: { fontSize: 11.5, color: 动作色[c.动作] || "inherit", fontWeight: 600 } }, 动作名[c.动作] || c.动作 || "?"),
                  c.为什么 ? el("span", { style: { ...S.dim, fontSize: 11 } }, c.为什么) : null
                ),
                el("div", { style: { fontSize: 12.5, marginTop: 2, wordBreak: "break-word" } }, String(c.text || "")),
                c.撞上 ? el("div", { style: { ...S.dim, fontSize: 11, marginTop: 2 } }, "跟这条像：" + String(c.撞上)) : null
              )
            )
          ),
          el(
            "div",
            { style: { ...S.row, marginTop: 8 } },
            el("button", { style: S.btn, onClick: 写进去, disabled: !!忙 }, 忙 === "应用" ? "写入中…" : "把勾上的写进去"),
            el("span", { style: S.dim }, "写进去的都在这个批次里，能整批撤")
          )
        ) : null,
        // ── 第三步：批次 ──
        el(
          "div",
          { style: S.sec },
          el("div", { style: S.secH }, el("span", { style: S.secTitle }, "补记批次")),
          el("span", { style: S.secTag }, 批次们.length + " 个")
        ),
        批次们.length === 0 ? el("div", { style: { ...S.dim, marginTop: 6 } }, "还没有补记过。") : el(
          "div",
          { style: { marginTop: 6 } },
          批次们.slice(0, 12).map(
            (b) => el(
              "div",
              { key: b.批次, style: { ...S.row, padding: "4px 0", borderBottom: "1px solid rgba(128,128,128,.12)" } },
              el("span", { style: { fontFamily: "monospace", fontSize: 11.5 } }, String(b.批次 || "")),
              el("span", { style: S.dim }, Number(b.条数 || 0) + " 条"),
              el("span", { style: { ...S.dim, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, 那天(b.时间)),
              el("button", { style: S.btnDanger, onClick: () => 撤批次(b.批次), disabled: !!忙 }, 忙 === "撤销" ? "撤销中…" : "撤销")
            )
          )
        ),
        错 ? el("div", { style: { ...S.drop, marginTop: 10 } }, 错) : null,
        提示 ? el("div", { style: { ...S.ok, marginTop: 10 } }, 提示) : null
      );
    }
    return { 补记页 };
  }

  // src/client/app.js
  function 装客户端(require2) {
    const React = require2("react");
    const inject = ["slots"];
    const B = "/dsh-clay-memory";
    const get = (p) => fetch(B + p, { cache: "no-store" }).then((r) => r.json());
    const post = (p, body) => fetch(B + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then((r) => r.json());
    const fmt = (t) => {
      if (!t) return "（没记时间）";
      const d = new Date(t);
      const p = (n) => String(n).padStart(2, "0");
      return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
    };
    const rel = (t, now) => {
      if (!t) return "（没记时间）";
      const dayIdx = (x) => Math.floor((new Date(x).getTime() + 8 * 36e5) / 864e5);
      const days = dayIdx(now) - dayIdx(t);
      if (!isFinite(days)) return fmt(t);
      if (days === 0) return "今天 " + fmt(t).slice(6);
      if (days === -1) return "明天 " + fmt(t).slice(6);
      if (days < 0) {
        const 后 = -days;
        if (后 < 30) return 后 + " 天后";
        return fmt(t).slice(0, 5) + "（" + Math.floor(后 / 30) + " 个月后）";
      }
      if (days === 1) return "昨天 " + fmt(t).slice(6);
      if (days < 30) return days + " 天前";
      const 今年 = new Date(new Date(now).getTime() + 8 * 36e5).getUTCFullYear();
      const 那年 = new Date(new Date(t).getTime() + 8 * 36e5).getUTCFullYear();
      if (那年 !== 今年) {
        const 差 = 今年 - 那年;
        if (差 === 1) return "去年 " + fmt(t).slice(0, 5);
        return 那年 + "-" + fmt(t).slice(0, 5) + "（" + 差 + " 年前）";
      }
      const 月 = Math.floor(days / 30);
      const 零头 = days - 月 * 30;
      return fmt(t).slice(0, 5) + "（" + 月 + (零头 >= 15 ? " 个多" : " 个") + "月前）";
    };
    const impName = (v) => v >= 1 ? "非常重要" : v >= 0.5 ? "比较重要" : "随口提过";
    const 进度 = { 扩词: { 状态: null, 说明: null }, 提炼: { 状态: null, 说明: null }, 订阅: /* @__PURE__ */ new Set() };
    const 补标进度 = { 已: 0, 总: 0, 在跑: false, 重判: false };
    const 洗键进度 = { 已: 0, 总: 0, 在跑: false, 干跑: false };
    const 改进度 = (格, 状态, 说明) => {
      const s = 进度[格] || (进度[格] = { 状态: null, 说明: null });
      s.状态 = 状态;
      s.说明 = 说明;
      for (const f of 进度.订阅) {
        try {
          f();
        } catch (e) {
        }
      }
    };
    const 一次最多画 = 200;
    const toPct = (v) => Math.round(Number(v) * 1e3) / 10;
    const fromPct = (v) => Math.round(Number(v) * 10) / 1e3;
    const S = {
      wrap: { padding: "16px 6px", fontSize: 13, lineHeight: 1.8, maxWidth: 780 },
      dim: { color: "var(--dsw-alias-label-tertiary, #8a8a8a)" },
      h: { fontSize: 14, margin: "20px 0 8px", fontWeight: 600 },
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
      row: { padding: "6px 8px", display: "flex", flexWrap: "wrap", gap: 10, rowGap: 2, alignItems: "baseline" },
      // 「一整条」的分隔线：**连着下面那几行小字一起**框住 ✓
      条: { borderBottom: "1px solid rgba(128,128,128,.15)" },
      btn: { padding: "3px 10px", borderRadius: 6, border: "1px solid rgba(128,128,128,.35)", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 12 },
      inp: { width: 72, padding: "2px 6px", borderRadius: 5, border: "1px solid rgba(128,128,128,.35)", background: "transparent", color: "inherit", colorScheme: "light dark", fontSize: 12 },
      link: { color: "var(--dsw-alias-label-secondary, #8fa8c8)", cursor: "pointer", textDecoration: "underline" },
      confirm: { display: "flex", gap: 8, alignItems: "center", margin: "4px 0 8px 8px", padding: "6px 10px", borderRadius: 6, background: "rgba(200,120,120,.12)", border: "1px solid rgba(200,120,120,.35)", fontSize: 12 },
      // ⚠ flexWrap：放大或窗口窄的时候要能换行，不然会横向撑出容器（右边就看不见了）✗
      nameBox: { display: "flex", flexWrap: "wrap", gap: 8, rowGap: 6, alignItems: "center", margin: "10px 0", padding: "6px 10px", borderRadius: 6, background: "rgba(128,128,128,.10)", border: "1px solid rgba(128,128,128,.22)", fontSize: 12 },
      editBox: { margin: "4px 0 10px 8px", padding: "8px 10px", borderRadius: 6, background: "rgba(128,128,128,.10)", border: "1px solid rgba(128,128,128,.28)" },
      askBox: { display: "flex", gap: 8, alignItems: "center", margin: "8px 0", padding: "8px 10px", borderRadius: 6, background: "rgba(224,176,112,.12)", border: "1px solid rgba(224,176,112,.4)", fontSize: 12 },
      barOut: { height: 10, borderRadius: 5, background: "rgba(128,128,128,.20)", overflow: "hidden", border: "1px solid rgba(128,128,128,.25)" },
      barIn: { height: "100%", background: "linear-gradient(90deg,#5b8fd6,#8fd0a0)", transition: "width .25s" },
      area: { width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 5, border: "1px solid rgba(128,128,128,.35)", background: "transparent", color: "inherit", fontSize: 13, lineHeight: 1.7, fontFamily: "inherit", resize: "vertical" },
      btnDanger: { padding: "3px 10px", borderRadius: 6, border: "1px solid rgba(200,120,120,.6)", background: "rgba(200,120,120,.18)", color: "inherit", cursor: "pointer", fontSize: 12 },
      ok: { color: "#8fd0a0" },
      drop: { color: "#c98080" },
      warn: { color: "#e0b070" },
      // ⭐ 1.4.2（用户：「层次和主次不太分明」）：分区卡片
      //   原来十来个区块平铺在一页里，全靠一行行小字分隔，谁管谁看不出来。
      //   现在每块一个浅色卡 + 一句标题 + 小标签，扫描时先看到「有几块」再看细节 ✓
      sec: {
        margin: "0 0 12px",
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))",
        background: "var(--dsw-alias-bg-l2, rgba(127,127,127,.05))"
      },
      secH: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 4 },
      secTitle: { fontSize: 13.5, fontWeight: 600 },
      secTag: {
        fontSize: 11,
        padding: "1px 7px",
        borderRadius: 999,
        border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3))",
        color: "var(--dsw-alias-label-tertiary, #8a8a8a)"
      },
      // ⭐ 1.4.2：详情页的区块分隔（跟上面那些卡片是一套的）
      //   详情页区块多、又各有自己的折叠，套整张卡片得把每块都包一层 ——
      //   包 JSX 风险大，先用「分隔线 + 加重标题」把段分出来，层次一样能看出来 ✓
      part: {
        marginTop: 20,
        paddingTop: 14,
        borderTop: "1px dashed var(--dsw-alias-border-l1, rgba(128,128,128,.28))",
        marginBottom: 8,
        fontSize: 13.5,
        fontWeight: 650,
        color: "var(--dsw-alias-label-primary)"
      },
      // ⭐ 1.4.2：详情页顶部的「这个会话是谁」小卡（跟全局事实页的 hero 呼应）
      secHero: {
        margin: "2px 0 14px",
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2))",
        background: "linear-gradient(135deg, rgba(91,143,214,.10), rgba(143,208,160,.07) 60%, rgba(128,128,128,.02))"
      },
      // ⭐ 2026-10-28（用户：「详情页下面几块功能拆成几个 tab 分区」）：
      //   原来十来块一路平铺到底，想看「导入」「备份」得滚动好久，谁管谁也看不出来 ✗
      //   → 顶上加一条页签，下面只显示当前那一块 ✓
      //   ⚠ 观感跟外层「会话记忆 / 全局事实」那排页签是同一套：
      //     选中 = 品牌色药丸 + 白字，没选 = 透明底 + 次级字色；
      //     颜色全走主题变量，深色模式自己跟着变 ✓
      tabs: {
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        margin: "0 0 14px",
        padding: 4,
        borderRadius: 10,
        background: "var(--dsw-alias-bg-l2, rgba(128,128,128,.08))",
        border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))",
        width: "fit-content",
        maxWidth: "100%",
        boxSizing: "border-box"
      },
      tabOn: {
        padding: "5px 14px",
        borderRadius: 999,
        border: "1px solid transparent",
        background: "var(--dsw-alias-state-business-primary, #5b8fd6)",
        color: "#fff",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 600,
        boxShadow: "0 1px 3px rgba(0,0,0,.14)"
      },
      tabOff: {
        padding: "5px 14px",
        borderRadius: 999,
        border: "1px solid transparent",
        background: "transparent",
        color: "var(--dsw-alias-label-secondary, rgba(110,110,110,.95))",
        cursor: "pointer",
        fontSize: 13
      },
      // ⭐ 2026-10-28：tab 里面「下一阶段」的小标题
      //   （虚线分隔 + 加重字，比 S.part 轻一档 —— 别抢了 tab 的层级）
      subH: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        gap: 8,
        marginTop: 18,
        paddingTop: 12,
        borderTop: "1px dashed var(--dsw-alias-border-l1, rgba(128,128,128,.28))",
        marginBottom: 4
      }
    };
    const 更新命令 = ["dsh plugin --profile web remove dsh-clay-memory", "dsh plugin --profile web add dsh-clay-memory"].join(String.fromCharCode(10));
    function 更新条() {
      const [up, setUp] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const 查 = async () => {
        setBusy(true);
        try {
          setUp(await get("/update?refresh=1"));
        } catch (e) {
          setUp({ ok: false, error: String(e && e.message || e) });
        }
        setBusy(false);
      };
      React.useEffect(() => {
        get("/update").then((r) => setUp(r)).catch(() => {
        });
      }, []);
      const 说 = !up ? "正在看有没有新版…" : up.hasUpdate ? "仓库里已经有 v" + up.latest + " 了" : up.ok ? "已经是最新版" : "暂时查不到（" + (up.error || "网络") + "）—— 这不代表没有问题";
      return React.createElement(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px", marginBottom: 14, borderRadius: 10, background: "rgba(127,127,127,.07)" } },
        React.createElement(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 10 } },
          React.createElement("div", { style: { flex: 1, fontSize: 13 } }, "插件版本 " + (up && up.current || "—") + "　·　" + 说),
          React.createElement("button", { style: S.btn, disabled: busy, onClick: 查 }, busy ? "查…" : "检查更新")
        ),
        up && up.hasUpdate ? React.createElement(
          "div",
          null,
          React.createElement("div", { style: S.dim }, "更新方法：先卸旧版再装新版（直接装可能拿到缓存里的旧副本）。"),
          React.createElement("div", { style: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: 11.5, whiteSpace: "pre-wrap", wordBreak: "break-all", padding: "8px 10px", borderRadius: 7, background: "rgba(127,127,127,.1)" } }, 更新命令),
          React.createElement("button", {
            style: S.btn,
            onClick: () => navigator.clipboard.writeText(更新命令).catch(() => {
            })
          }, "复制命令")
        ) : null
      );
    }
    const el = React.createElement;
    const 重要色 = (v) => v >= 1 ? "var(--dsw-alias-state-success-primary, #7fbf8f)" : v >= 0.5 ? "var(--dsw-alias-state-warn-primary, #d6a35b)" : "var(--dsw-alias-label-tertiary, rgba(128,128,128,.5))";
    const G = {
      tabs: {
        display: "flex",
        gap: 4,
        margin: "2px 0 14px",
        padding: 4,
        borderRadius: 10,
        background: "rgba(128,128,128,.08)",
        border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))",
        width: "fit-content"
      },
      tabOn: {
        padding: "5px 14px",
        borderRadius: 7,
        border: "1px solid transparent",
        background: "var(--dsw-alias-state-business-primary, #5b8fd6)",
        color: "#fff",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 600,
        boxShadow: "0 1px 3px rgba(0,0,0,.14)"
      },
      tabOff: {
        padding: "5px 14px",
        borderRadius: 7,
        border: "1px solid transparent",
        background: "transparent",
        color: "var(--dsw-alias-label-secondary, rgba(110,110,110,.95))",
        cursor: "pointer",
        fontSize: 13
      },
      hero: {
        position: "relative",
        overflow: "hidden",
        padding: "18px 20px",
        marginBottom: 14,
        borderRadius: 14,
        border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22))",
        background: "linear-gradient(135deg, rgba(91,143,214,.16), rgba(143,208,160,.10) 55%, rgba(128,128,128,.04))"
      },
      heroNum: {
        fontSize: 40,
        lineHeight: 1.1,
        fontWeight: 700,
        letterSpacing: "-1px",
        color: "var(--dsw-alias-label-primary, inherit)"
      },
      heroUnit: {
        fontSize: 13,
        fontWeight: 400,
        marginLeft: 6,
        color: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.8))"
      },
      heroTip: {
        marginTop: 6,
        fontSize: 12,
        color: "var(--dsw-alias-label-secondary, rgba(128,128,128,.9))"
      },
      chips: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 },
      chip: {
        display: "flex",
        alignItems: "baseline",
        gap: 5,
        padding: "5px 10px",
        borderRadius: 8,
        fontSize: 12,
        background: "rgba(255,255,255,.22)",
        border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2))",
        color: "var(--dsw-alias-label-secondary, rgba(128,128,128,.9))"
      },
      chipNum: { fontWeight: 700, fontSize: 14, color: "var(--dsw-alias-label-primary, inherit)" },
      tools: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 },
      search: {
        flex: "1 1 180px",
        minWidth: 140,
        padding: "6px 10px",
        borderRadius: 8,
        border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3))",
        background: "rgba(128,128,128,.06)",
        color: "inherit",
        fontSize: 13,
        outline: "none"
      },
      sel: {
        padding: "6px 8px",
        borderRadius: 8,
        border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3))",
        // ⭐ 1.8.0：下拉框要跟主题走 —— 框体用主题底色，原生弹层用 color-scheme
        background: "var(--dsw-alias-bg-layer-1, rgba(128,128,128,.08))",
        color: "var(--dsw-alias-label-primary, inherit)",
        colorScheme: "light dark",
        fontSize: 12
      },
      pill: {
        padding: "5px 10px",
        borderRadius: 999,
        fontSize: 12,
        cursor: "pointer",
        border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3))",
        background: "transparent",
        color: "var(--dsw-alias-label-secondary, rgba(128,128,128,.9))"
      },
      pillOn: {
        padding: "5px 10px",
        borderRadius: 999,
        fontSize: 12,
        cursor: "pointer",
        border: "1px solid var(--dsw-alias-state-business-primary, #5b8fd6)",
        background: "rgba(91,143,214,.16)",
        color: "var(--dsw-alias-label-primary, inherit)"
      },
      item: {
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.16))",
        background: "rgba(128,128,128,.04)",
        marginBottom: 8
      },
      itemTop: { display: "flex", gap: 10, alignItems: "flex-start" },
      dot: { flex: "none", width: 8, height: 8, borderRadius: 4, marginTop: 7 },
      text: {
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        lineHeight: 1.75,
        color: "var(--dsw-alias-label-primary, inherit)",
        overflowWrap: "anywhere",
        cursor: "text"
      },
      date: {
        flex: "none",
        fontSize: 11,
        paddingTop: 3,
        color: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.75))"
      },
      x: {
        flex: "none",
        padding: "1px 7px",
        borderRadius: 6,
        border: "1px solid transparent",
        background: "transparent",
        color: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.8))",
        cursor: "pointer",
        fontSize: 14,
        lineHeight: 1.4
      },
      meta: {
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        marginTop: 6,
        paddingLeft: 18,
        fontSize: 11,
        color: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.8))"
      },
      badge: {
        padding: "0 6px",
        borderRadius: 5,
        background: "rgba(91,143,214,.14)",
        color: "var(--dsw-alias-label-secondary, rgba(128,128,128,.95))",
        fontSize: 11
      },
      empty: {
        padding: "36px 16px",
        textAlign: "center",
        borderRadius: 12,
        border: "1px dashed var(--dsw-alias-border-l1, rgba(128,128,128,.3))",
        color: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.85))",
        fontSize: 13,
        lineHeight: 2
      },
      confirm: {
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "center",
        padding: "8px 12px",
        borderRadius: 10,
        marginBottom: 8,
        background: "rgba(200,120,120,.12)",
        border: "1px solid rgba(200,120,120,.35)",
        fontSize: 12
      },
      btn: {
        padding: "4px 12px",
        borderRadius: 7,
        border: "1px solid rgba(128,128,128,.35)",
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
        fontSize: 12
      },
      btnDanger: {
        padding: "4px 12px",
        borderRadius: 7,
        border: "1px solid var(--dsw-alias-state-error-primary, rgba(200,120,120,.6))",
        background: "rgba(200,120,120,.18)",
        color: "inherit",
        cursor: "pointer",
        fontSize: 12
      },
      area: {
        width: "100%",
        boxSizing: "border-box",
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3))",
        background: "rgba(128,128,128,.06)",
        color: "inherit",
        fontSize: 13,
        lineHeight: 1.7,
        fontFamily: "inherit",
        resize: "vertical",
        minHeight: 60
      },
      note: {
        fontSize: 12,
        marginBottom: 10,
        color: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.85))"
      },
      err: {
        padding: "8px 12px",
        marginBottom: 10,
        borderRadius: 8,
        fontSize: 12,
        background: "rgba(200,120,120,.12)",
        border: "1px solid rgba(200,120,120,.35)",
        color: "var(--dsw-alias-label-primary, inherit)"
      }
    };
    const 类型表 = [
      ["identity", "身份"],
      ["relation", "关系"],
      ["promise", "约定"],
      ["preference", "偏好"],
      ["experience", "经历"],
      ["misc", "其他"]
    ];
    const 类型名 = (k) => {
      for (let i = 0; i < 类型表.length; i++) if (类型表[i][0] === k) return 类型表[i][1];
      return "";
    };
    const 同日 = (a, b) => {
      if (!a || !b) return false;
      const A = new Date(a);
      const B2 = new Date(b);
      if (isNaN(A.getTime()) || isNaN(B2.getTime())) return false;
      return A.getFullYear() === B2.getFullYear() && A.getMonth() === B2.getMonth() && A.getDate() === B2.getDate();
    };
    const 由id猜时间 = (id) => {
      const s = String(id || "");
      if (s.indexOf("mm") !== 0 || s.length < 8) return null;
      const 上限 = Date.now() + 864e5;
      for (let n = s.length; n > 5; n--) {
        const t = parseInt(s.slice(2, n), 36);
        if (!isFinite(t) || t < 1e12 || t > 上限) continue;
        return new Date(t).toISOString();
      }
      return null;
    };
    const 归整 = (m, 来自全部) => {
      const 是工区 = m.category === "workspace" || String(m.scope || "").indexOf("workspace:") === 0;
      const 全局 = m.scope === "global" || !m.scope && !是工区 && m.category === "stable_profile";
      return {
        id: String(m.id || ""),
        text: String(m.text || ""),
        at: m.at || null,
        createdAt: m.createdAt || m.addedAt || 由id猜时间(m.id),
        importance: typeof m.importance === "number" ? m.importance : null,
        source: String(m.source || ""),
        category: m.category || "",
        已被取代: m.已被取代 || null,
        事实键: m.事实键 || m.factKey || "",
        related: Array.isArray(m.related) ? m.related : [],
        type: m.type || m.kind || "",
        scope: 全局 ? "global" : 是工区 ? "workspace" : "session",
        session: 全局 ? null : m.session || m.sessionId || null,
        sessionTitle: 全局 ? "全局记忆" : 是工区 ? "工作区记忆" : String(m.sessionTitle || ""),
        sessionId: String(m.session || m.sessionId || ""),
        deleted: !!m.deleted || !!m.deletedAt,
        deletedAt: m.deletedAt || null,
        // ⭐ B 轮：这两个字段要从 /all 原样带过来，不然详情块的字段到了列表就被丢掉
        textBefore: String(m.textBefore || ""),
        // ⭐ 1.10.3（F12）：原话也要原样带过来
        原话: String(m.原话 || ""),
        别记: String(m.别记 || "")
      };
    };
    const 合并成一份 = (会话们) => {
      const 条 = [];
      const 见过 = {};
      const 收 = (m, 会话, 标题, 已删) => {
        const k = (已删 ? "d:" : "") + String(m.id);
        if (!m || !m.id || 见过[k]) return;
        见过[k] = true;
        const x = 归整(m, false);
        x.session = 会话 || null;
        x.sessionTitle = 会话 ? 标题 : "全局记忆";
        x.deleted = !!已删;
        if (!x.createdAt) x.createdAt = 已删 ? m.deletedAt || null : null;
        条.push(x);
      };
      (会话们 || []).forEach((s) => {
        ;
        (s.memories || []).forEach((m) => 收(m, s.id, s.title || s.id, false));
        (s.deleted || []).forEach((m) => 收(m, s.id, s.title || s.id, true));
      });
      return 条;
    };
    const 页签名 = [
      ["记忆", "所有记忆"],
      ["时间线", "按天看：那天记了什么 · 又想起过什么"],
      ["会话", "每个会话的开关 · 称呼 · 导入 · 提炼"],
      ["回收站", "删掉的记忆都在这儿 · 能搜能找回"],
      ["体检", "助手回复的 AI 味 · 规则开关"],
      ["高级", "参数 · 整理会话 · 备份 · 版本"]
    ];
    class 兜底 extends React.Component {
      constructor(props) {
        super(props);
        this.state = { 错: null };
      }
      static getDerivedStateFromError(e) {
        return { 错: e };
      }
      componentDidCatch(e) {
        try {
          console.error("[黏土记忆] 渲染出错：", e);
        } catch (_) {
        }
      }
      render() {
        if (this.state.错) {
          return el(
            "div",
            { style: { padding: 12, borderRadius: 8, border: "1px solid var(--dsw-alias-state-error-primary, rgba(208,90,90,.5))", background: "var(--dsw-alias-bg-layer-2, rgba(208,90,90,.08))", fontSize: 12.5 } },
            el("div", { style: { fontWeight: 600, marginBottom: 6 } }, "这块出了点问题（换回别的页签还能用）"),
            el(
              "div",
              { style: { fontFamily: "monospace", fontSize: 11.5, color: "var(--dsw-alias-label-secondary, #888)", marginBottom: 8, wordBreak: "break-all" } },
              String(this.state.错 && this.state.错.message || this.state.错)
            ),
            el(
              "button",
              {
                style: { padding: "3px 10px", fontSize: 12, borderRadius: 6, border: "1px solid rgba(128,128,128,.35)", background: "transparent", color: "inherit", cursor: "pointer" },
                onClick: () => this.setState({ 错: null })
              },
              "重试"
            )
          );
        }
        return this.props.children;
      }
    }
    const 时间线页 = 造时间线页({ React, el, get, S, G, 类型名 });
    const 回收站页 = 造回收站页({ React, get, post, S, el, 类型名 });
    const 回复体检页 = 造回复体检页({ React, get, post, B, S, el });
    const { 拦截页 } = 造拦截页({ React, el, get, post, S });
    const { 补记页 } = 造补记页({ React, el, get, post, S });
    const { 高级区 } = 造高级区({ React, el, get, post, S, G, toPct, fromPct, 进度, 更新条 });
    const { 所有记忆页 } = 造所有记忆页({ React, el, get, post, B, S, G, rel, 类型名, 类型表, 同日, 归整, 一次最多画, 重要色 });
    const { 会话页 } = 造会话页({ React, el, get, post, B, S, rel, impName, 一次最多画, 进度, 改进度, 补标进度, 洗键进度, 补记页 });
    const { 记忆面板 } = 造记忆面板({ React, el, get, post, S, G, B, rel, impName, toPct, fromPct, 进度, 更新条, 类型名, 类型表, 同日, 归整, 一次最多画, 重要色, 会话页, 所有记忆页, 时间线页, 回收站页, 回复体检页, 拦截页, 高级区, 页签名, 兜底 });
    function apply(ctx) {
      const slots = ctx.get("slots");
      if (slots === void 0) return;
      slots.inject(
        "settings.section",
        () => slots.register(
          {
            name: "settings.section",
            id: "memory",
            order: 51,
            label: () => "黏土记忆"
          },
          () => el(记忆面板)
        )
      );
    }
    return { apply, inject };
  }

  // src/client/index.js
  window.__ModuleLoader__.load({
    id: "dsh-clay-memory",
    factory: (require2) => {
      var module = { exports: {} };
      var exports = module.exports;
      const 客户端 = 装客户端(require2);
      exports.apply = 客户端.apply;
      exports.inject = 客户端.inject;
      return module.exports;
    }
  });
})();
