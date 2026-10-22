// 报价 = 主材(单价×数量) + 施工(单价×数量)
// 主材支持：材料商注册品牌覆盖单价(带广告标) > 档位倍率(经济/舒适/轻奢) > 基准价
const cfg = require('./config.js');
const auxRule = require('./auxrule.js');

// 计算某材料在指定档位下的有效单价（带品牌覆盖 / 后台逐项价覆盖）
function effUnitPrice(m, tier) {
  if (m.brand && m.brand.price) return { price: m.brand.price, brand: m.brand.name, ad: !!m.brand.ad };
  // 后台逐项覆盖价优先（基/中/高档可直接设定）
  if (m.prices && m.prices[tier] != null) return { price: Number(m.prices[tier]), brand: '', ad: false };
  // 倍率自动乘法已删除：未单独录入档位价时，直接使用基准价(经济价)，不乘以任何系数
  return { price: Number(m.price) || 0, brand: '', ad: false };
}

function calcGroup(list, tier, usedGroups) {
  // 互斥选项组：同 group 只计第一个开启项，其余即便开启也不计价（避免重复计价）
  // usedGroups 跨列表共享（materials→labor），实现"复合实木地板↔贴砖"等跨列表互斥
  usedGroups = usedGroups || new Set();
  const suppressed = new Set();
  const groupOn = {};
  (list || []).forEach(m => {
    if (m.on && m.qty > 0 && m.group) {
      if (groupOn[m.group] || usedGroups.has(m.group)) suppressed.add(m.id);
      else groupOn[m.group] = m.id;
    }
  });
  let total = 0;
  const items = [];
  (list || []).forEach(m => {
    if (m.on && m.qty > 0 && !suppressed.has(m.id)) {
      if (m.group) usedGroups.add(m.group);
      const e = effUnitPrice(m, tier);
      const sub = Math.round(e.price * m.qty);
      total += sub;
      items.push({ id: m.id, name: m.name, brand: e.brand, ad: e.ad, unit: m.unit, price: e.price, qty: m.qty, sub, group: m.group || '' });
    }
  });
  return { total, items };
}

// 辅助费用：base = 主材+施工小计；onlyWhole=true 时为「全屋汇总」模式，取全部开启项各计一次
// 每项返回统一结构 { id,name,kind, qty,unit,price,sub }（fixed/floor）
//   或 { id,name,kind:'pct', rate,base,sub }（税金/管理费，比例可被用户覆盖）
// opts: { onlyWhole, floor, taxOn, taxPct, mgrPct, auxQty }
//   auxQty: { [辅助费id]: 数量 } —— 汇总页可手动填数量，覆盖后台默认
function calcAux(base, opts) {
  opts = opts || {};
  const onlyWhole = !!opts.onlyWhole;
  const auxQty = opts.auxQty || {};
  // 辅助项清单走规则引擎：统一改名（完工保洁→局部保洁）、补内置项（全屋保洁）、打全屋/局部标记
// 注：辅助项不新增拆除项目（老板 2026-09-29 定），拆除沿用施工项里的「墙地砖整体拆除 / 局部拆除」
  const all = auxRule.resolveAux(cfg.aux(), 1);
  // onlyWhole=true：全屋汇总，所有开启项各计一次；否则只取「各空间局部」项
  const list = all.filter(a => a.on && (onlyWhole || a.scope === 'local'));
  let total = 0; const items = [];
  list.forEach(a => {
    if (a.kind === 'floor') {
      // 材料运输及上楼费：数量(层) × 单价(每层费用)
      // 工程量默认取预算算法值（老板 2026-09-29 定：默认 0，不自动计费），手工填写优先
      const qty = auxQty[a.id] != null
        ? (Number(auxQty[a.id]) || 0)
        : (a.defQty != null ? Number(a.defQty) : (opts.floor != null ? Number(opts.floor) : 0));
      const price = Number(a.rate) || 0;
      const sub = qty * price;
      total += sub;
      items.push({ id: a.id, name: a.name, kind: 'floor', qty, unit: a.unit || '层', price, sub });
    } else if (a.kind === 'pct') {
      // 税金可被用户勾选取消；税金/管理费比例可被用户覆盖（手动填写）
      if (a.id === 'tax' && opts.taxOn === false) return;
      const rate = (a.id === 'tax'
        ? (opts.taxPct != null ? opts.taxPct : a.val)
        : (opts.mgrPct != null ? opts.mgrPct : a.val));
      const sub = Math.round(base * Number(rate) / 100);
      total += sub;
      items.push({ id: a.id, name: a.name, kind: 'pct', rate: Number(rate), base, sub });
    } else {
      // 固定费：数量 × 单价 = 小计（工程量 = 空间数规则默认；录入页可手工覆盖，覆盖优先）
      const qty = auxQty[a.id] != null
        ? (Number(auxQty[a.id]) || 0)
        : (a.defQty != null ? a.defQty : (a.qty != null ? Number(a.qty) : 1));
      const price = Number(a.price != null ? a.price : a.val) || 0;
      const sub = Math.round(qty * price);
      total += sub;
      items.push({ id: a.id, name: a.name, kind: 'fixed', qty, unit: a.unit || '项', price, sub });
    }
  });
  return { total, items };
}

function calcQuote(space) {
  const tier = space.tier || 'none';
  const matG = new Set();   // 跨列表互斥共享组（主材占用的 group 也压制施工项，如地板↔贴砖）
  const mat = calcGroup(space.materials, tier, matG);   // 主材随档位/品牌
  // 全屋拆除生效时（space.wholeDemoOn，由 syncWholeDemoDedup 标记）：本空间「墙地砖整体拆除」置 0
  const laborList = space.wholeDemoOn ? auxRule.stripWholeDemo(space.labor) : space.labor;
  const labor = calcGroup(laborList, 'none', matG);      // 施工不随品牌档位；共享 matG 实现跨列表互斥
  const base = mat.total + labor.total;
  // 辅助项目不在空间内计价（避免多空间重复收费），统一在「总预算」合计页一次性计
  return {
    tier,
    matTotal: mat.total,
    laborTotal: labor.total,
    auxTotal: 0,
    auxItems: [],
    total: base,
    demoDedupOn: !!space.wholeDemoOn,     // 是否已按「全屋拆除」扣掉本空间重复拆除项
    matItems: mat.items,
    laborItems: labor.items
  };
}

// 按项目当前状态刷新「全屋拆除 ↔ 空间内拆除项」联动标记（写回各空间）
//   空间数 n ≥ 2 且全屋拆除工程量 > 0 → 各空间标 wholeDemoOn=true，
//   之后 calcQuote 会自动把该空间的「墙地砖整体拆除」工程量算作 0，避免重复计价。
function syncWholeDemoDedup(project) {
  if (!project) return false;
  const n = (project.spaces || []).length || 1;
  const on = auxRule.wholeDemoOn(n, (project.fee || {}).auxQty);
  (project.spaces || []).forEach(s => { s.wholeDemoOn = on; });
  return on;
}

// 汇总页用：全部辅助项目（固定/运输/税金/管理费）全屋只计一次
// opts: { floor, taxOn, taxPct, mgrPct, auxQty }
//   auxQty: { [辅助费id]: 数量 } —— 汇总页手动填写数量，覆盖后台默认
function calcWholeAux(totalBase, opts) {
  return calcAux(totalBase, Object.assign({ onlyWhole: true }, opts || {}));
}

// 三档总价对比（经济/舒适/轻奢）：主材随档升级，施工不变
function buildThreeTiers(space) {
  return cfg.tierList().map(k => {
    const q = calcQuote(Object.assign({}, space, { tier: k }));
    const TIERS = cfg.tiers();
    return { key: k, name: (TIERS[k] || {}).name, matTotal: q.matTotal, laborTotal: q.laborTotal, auxTotal: q.auxTotal, total: q.total };
  });
}

module.exports = { calcQuote, effUnitPrice, buildThreeTiers, calcWholeAux, syncWholeDemoDedup };
