// 辅助项目工程量默认规则（老板 2026-09-28 定版）
// 按项目内「空间数量 n」自动定默认工程量（「总预算」页可手工覆盖，覆盖值优先）
//   n ≥ 2（多空间）→ 全屋级项目 = 1，各空间局部项目 = 0
//   n =  1（单空间）→ 全屋级项目 = 0，各空间局部项目 = 1
// 常量类（材料运输及上楼、垃圾外运）恒为 0。
// 另：全屋拆除生效时，各空间内的「墙地砖整体拆除」自动置 0（见文末 stripWholeDemo）。
// 说明：本模块是「算法层」，不直接改 config.js 的项目/价格，改规则只动这个文件。

// 既有项目的规则标注 / 改名 / 改价（完工保洁 → 局部保洁，报价仍取 600）
const OVERRIDE = {
  demo_all:     { scope: 'whole' },                                     // 全屋拆除
  carry:        { scope: 'whole', def: 0 },                             // 材料运输及上楼费：恒 0
  rubbish:      { scope: 'local', def: 0 },                             // 垃圾外运：恒 0
  protect:      { scope: 'whole' },                                     // 成品保护（全屋级）
  localprotect: { scope: 'local' },                                     // 局部保护
  clean:        { name: '局部保洁', scope: 'local', price: 600 },       // 原「完工保洁」更名
  // 代码内置项（配置里还没有，按老板 2026-09-29 定：辅助项不新增拆除项目，拆除沿用施工项）
  clean_all:    { name: '全屋保洁', kind: 'fixed', scope: 'whole', price: 1000, unit: '项' }
};
const BUILTIN = ['clean_all'];
const QTY_IDS = ['demo_all', 'carry', 'rubbish', 'protect', 'localprotect', 'clean', 'clean_all'];

function scopeOf(id, whole) {
  const o = OVERRIDE[id] || {};
  return o.scope || (whole ? 'whole' : 'local');
}

function defaultQty(id, n) {
  n = Math.max(1, n || 1);
  const o = OVERRIDE[id] || {};
  if (o.def != null) return o.def;
  // 全屋级项目（全屋拆除 / 成品保护 / 全屋保洁）：多空间 n≥2 = 1，单空间 n=1 = 0
  // 各空间局部项目（局部拆除 / 局部保护 / 局部保洁）：多空间 n≥2 = 0，单空间 n=1 = 1
  return o.scope === 'whole' ? (n >= 2 ? 1 : 0) : (n >= 2 ? 0 : 1);
}

// ===== 全屋拆除 ↔ 空间内拆除项 的联动（避免重复计价，老板 2026-09-29 定）=====
// 全屋拆除生效（项目内空间数 n ≥ 2 且「全屋拆除」工程量 > 0）时，
// 各空间施工项里的「墙地砖整体拆除」工程量自动置 0 —— 否则与全屋拆除重复计算。
const WHOLE_DEMO_DUP = ['墙地砖整体拆除'];

// 全屋拆除是否生效：多空间(n≥2) 且 工程量 > 0（工程量取手工覆盖值，否则规则默认）
function wholeDemoOn(n, auxQty) {
  if (Math.max(1, n || 1) < 2) return false;
  const q = (auxQty && auxQty.demo_all != null)
    ? (Number(auxQty.demo_all) || 0)
    : defaultQty('demo_all', n);
  return q > 0;
}

// 把与全屋拆除重复的施工项工程量清零（返回新数组，不改原对象）
function stripWholeDemo(list) {
  return (list || []).map(it => {
    const dup = WHOLE_DEMO_DUP.indexOf(it.id) >= 0 || WHOLE_DEMO_DUP.indexOf(it.name) >= 0;
    if (!dup || !(Number(it.qty) > 0)) return it;
    return Object.assign({}, it, { qty: 0, qtyText: '0', dedupBy: '全屋拆除' });
  });
}

// 把规则套到配置里的辅助清单上：补 scope / 默认工程量、改名、补内置项
function resolveAux(list, n) {
  n = Math.max(1, n || 1);
  const out = (list || []).map(a => {
    const o = OVERRIDE[a.id] || {};
    const it = Object.assign({}, a, { scope: scopeOf(a.id, a.whole) });
    if (o.name) it.name = o.name;
    if (o.price != null && it.kind === 'fixed') { it.price = o.price; it.val = o.price; }
    it.defQty = defaultQty(a.id, n);
    return it;
  });
  BUILTIN.forEach(id => {
    if (out.some(a => a.id === id)) return;
    const o = OVERRIDE[id];
    out.push(Object.assign({ id, kind: 'fixed', on: true, unit: '项' }, o, { defQty: defaultQty(id, n) }));
  });
  return out;
}

// 最终工程量 = 规则默认值，被用户手工改过的（auxQty[id]）优先生效
function mergeQty(n, auxQty) {
  const q = {};
  QTY_IDS.forEach(id => { q[id] = defaultQty(id, n); });
  return Object.assign(q, auxQty || {});
}

module.exports = { resolveAux, defaultQty, mergeQty, scopeOf, wholeDemoOn, stripWholeDemo, WHOLE_DEMO_DUP };
