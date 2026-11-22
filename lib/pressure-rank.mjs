/**
 * `pressure-rank` — 挤占式排序（可选模块，默认不接进召回）。
 *
 * 灵感来自 2026-11-11 贴吧那位「手搓身体」的帖子：遗忘不发生在存储层，
 * 发生在**排序层**——原文一个字不删，靠打分把旧条目挤到下面去。
 *
 * 打分口径（对应帖子的公式）：
 *   承重 × 10  +  强度  +  情绪峰  +  类型加成  +  新鲜度  −  「已写过」扣分
 *   新鲜度：满格 6 分，每天 −0.5，12 天归零（线性）
 *
 * 本模块**不 import 插件里任何东西**，也不改任何数据；唯一职责是：
 * 给一批记忆排序 / 挑出「第一层」。觉得不好用就删掉这个文件，召回行为零变化。
 *
 * @module pressure-rank
 */

/** 默认参数，全部可调。 */
export const 默认参数 = {
  承重倍: 10,
  强度倍: 1,
  情绪峰倍: 1,
  类型加成: { stable_profile: 1, workspace: 0.5 },
  新鲜满格: 6,
  每日掉: 0.5,
  归零天: 12,
  已写每次扣: 0.75,
  已写封顶: 3,
  第一层条数: 30,
  第一层字数: 6000,
};

const 一天 = 24 * 3600 * 1000;

function 数(v, 缺省 = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 缺省;
}

function 取条(x) {
  if (x === null || typeof x !== 'object') return {};
  return x.m !== null && typeof x.m === 'object' ? x.m : x;
}

function 取时间(m) {
  const at = 数(m.at ?? m.createdAt ?? m.updatedAt, 0);
  return at > 0 ? at : 0;
}

/** 新鲜度：满格 → 0，线性掉，归零天之后恒 0。 */
export function 新鲜度(m, now, 参数 = 默认参数) {
  const p = { ...默认参数, ...参数 };
  const at = 取时间(取条(m));
  if (at === 0) return 0;
  const days = Math.max(0, (now - at) / 一天);
  if (days >= p.归零天) return 0;
  return Math.round(p.新鲜满格 * (1 - days / p.归零天) * 100) / 100;
}

/** 单条打分，附明细（方便界面上解释「为什么它被挤下去了」）。 */
export function 算挤占(m, now, 参数 = 默认参数, 已写次数 = 0) {
  const p = { ...默认参数, ...参数 };
  const 条 = 取条(m);
  const 承重 = 数(条.承重, 0);
  const 强度 = 数(条.强度 ?? 条.importance, 0);
  const 情绪峰 = 数(条.情绪峰, 0);
  const 类型 = 数(p.类型加成?.[条.category], 0);
  const 新鲜 = 新鲜度(条, now, p);
  const 已写 = Math.min(p.已写封顶, Math.max(0, 数(已写次数, 0)) * p.已写每次扣);
  const 分 = 承重 * p.承重倍 + 强度 * p.强度倍 + 情绪峰 * p.情绪峰倍 + 类型 + 新鲜 - 已写;
  return {
    分: Math.round(分 * 100) / 100,
    明细: { 承重, 强度, 情绪峰, 类型, 新鲜度: 新鲜, 已写扣: Math.round(已写 * 100) / 100 },
  };
}

/**
 * 排序（不增不减，只换顺序）。V8 的 sort 是稳定排序，同分保持原顺序，
 * 所以「原召回里的高分项」不会因为同分被打乱。
 */
export function 挤占排序(items, now, 参数 = 默认参数, 已写表 = null) {
  const p = { ...默认参数, ...参数 };
  const 清单 = Array.isArray(items) ? items : [];
  const 次 = (m) => (已写表 && typeof 已写表.get === 'function' ? 数(已写表.get(取条(m)?.id), 0) : 0);
  return [...清单]
    .map((it, i) => ({ it, i, ...算挤占(it, now, p, 次(it)) }))
    .sort((a, b) => (b.分 - a.分) || (a.i - b.i))
    .map((x) => x.it);
}

/** 第一层：按分数取前 N 条，同时卡条数与总字数（挤占式，满了就进不来）。 */
export function 第一层(items, now, 参数 = 默认参数, 已写表 = null) {
  const p = { ...默认参数, ...参数 };
  const 排好 = 挤占排序(items, now, p, 已写表);
  const 出 = [];
  let 字 = 0;
  for (const it of 排好) {
    if (出.length >= p.第一层条数) break;
    const 长 = String(取条(it)?.text ?? '').length;
    if (字 + 长 > p.第一层字数 && 出.length > 0) break;
    出.push(it);
    字 += 长;
  }
  return 出;
}

/** 从追溯记录里数「这条被注入过几次」（用于「已写过」扣分）。 */
export function 从追溯数已写(追溯条目们) {
  const 表 = new Map();
  for (const 条 of Array.isArray(追溯条目们) ? 追溯条目们 : []) {
    const ids = Array.isArray(条?.picked) ? 条.picked : [];
    for (const id of ids) {
      if (typeof id !== 'string') continue;
      表.set(id, (表.get(id) ?? 0) + 1);
    }
  }
  return 表;
}
