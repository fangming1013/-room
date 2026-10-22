// 工程量估算引擎（纯函数，不改任何 config 数据）
// 规则来源：技能库 renovation-qty-rules v1.1（老板 2026-09-26 校准定版）
// 用法：estimateQty(itemId, space) → 数量(0.1位) 或 null(项/套/樘整体计价，无需估算)
const P = require('./qty-params.js');
const plan = require('./plan.js');

const r1 = v => Math.round(v * 10) / 10;

// ===== 示意图实测尺寸（与绘制同一布局引擎，S=1 时 rect 单位即 cm）=====
// 沿墙长度：left/right 墙的家具 rect.h 才是沿墙向
function placedLengthM(space, ids) {
  let items = [];
  try { items = plan.measureFurniture(space) || []; } catch (e) { return null; }
  let sum = 0;
  items.forEach(it => {
    // 匹配本尊与前缀克隆（如 U 型厨房拆成 cabinet / cabinet_L / cabinet_B 三段）
    const hit = ids.some(id => it.id === id || String(it.id).indexOf(id) === 0);
    if (!hit) return;
    const along = (it.wall === 'left' || it.wall === 'right') ? it.rect.h : it.rect.w;
    sum += along / 100;
  });
  return sum > 0 ? sum : null;   // null = 未摆放，调用方退回公式
}

// 基础量（统一 m 制）：space.w/d/h 单位 cm，这里转 m
function base(space) {
  const W = space.w / 100, D = space.d / 100, H = space.h / 100;
  return { W, D, H, S: W * D, C: 2 * (W + D), wallGross: 2 * (W + D) * H };
}

// 该空间门洞类型：厨/阳台=推拉门（默认双门），其余=木门
function doorOf(space) {
  const k = space.key;
  if (k === 'kitchen' || k === 'balcony') return P.DOOR[P.SLIDE_DOOR] || P.DOOR.slideDouble;
  return P.DOOR.wood;
}

// 当前空间选定的地面覆盖项（floor_cover 互斥组里 on 且 qty>0 的第一个）
// 顺序：materials(复合实木地板/石塑地板) → labor(贴砖)，与 quote.js calcGroup 计入口径一致（取第一个，非最后一个）
function floorCoverSelected(space) {
  const lists = [space.materials || [], space.labor || []];
  for (const list of lists) {
    for (const m of list) {
      if (m.group === 'floor_cover' && m.on && m.qty > 0) return m.id;
    }
  }
  return null;
}

function winArea(space) { return space.winWall ? P.DOOR.win.w * P.DOOR.win.h : 0; }

// 贴砖面积 = 地砖(S×1.05) + 墙砖(C×2.4 − 门洞 − 窗洞)
function tileArea(space) {
  const b = base(space), d = doorOf(space);
  const wall = b.C * P.TILE_H - d.w * d.h - winArea(space);
  return b.S * (1 + P.LOSS) + Math.max(0, wall);
}

// 净墙面（干区涂料类）= S墙毛 − 木门洞 − 窗洞
function netWall(space) {
  const b = base(space), d = P.DOOR.wood;
  return Math.max(0, b.wallGross - d.w * d.h - winArea(space));
}

// ===== 各空间固定工程量（老板现场口述录入，逐空间生效、互不影响）=====
// 规则：表里写了的就是定值（含 0），表里没写的项目一律走下面 RULES 原算法。
// 逐空间推进：kitchen 2026-09-28 录入 / bathroom 2026-09-28 录入。
const FIXED_BY_SPACE = {
  kitchen: {
  // 拆除与修补
  '墙地砖整体拆除': 1,   // 拆除默认整体拆除（不是局部）
  '局部拆除':       0,
  '拆除后修补':     1,
  // 水电（选全空间）
  '全空间做水电':   1,
  '水电位改造':     0,
  // 基层
  '门套基层处理':   0,
  // 主材小件
  '拉篮':           1,
  '水槽抽拉龙头':   1,
  '烟机灶具套餐':   1,
  '包烟管':         1,
  '抽屉':           3,
  '吊顶':           1,
  // 门（厨房默认不做门）
  '推拉门':         0,
  '平开门钛镁合金': 0,
  '套装门':         0,
  '厨房双边木门套': 0,
  '钛镁合金门套':   0,
  // 套餐与附加
  '翻筑工艺套餐':   0,
  '超出面积':       0,
  '热水器':         0
  },

  // ===== 卫生间（老板 2026-09-28 现场口述录入）=====
  bathroom: {
    // 拆除与修补：默认整体拆除
    '墙地砖整体拆除': 1,
    '局部拆除':       0,
    '拆除后修补':     1,
    // 水电：选全空间做水电，不做局部改造
    '全空间做水电':   1,
    '水电位改造局部改造': 0,   // id 与 config.js 对齐（名称：水电位改造（局部改造））
    // 防水：默认伟星咖乐湿区 1.8m，其余防水项目一律 0
    '伟星咖乐防水湿区1.8m': 1,
    '伟星咖乐防水湿区到顶': 0,
    '防水处理':       0,       // 通用「防水处理（项）」，已被伟星咖乐替代
    '防水处理2':      0,       // 通用「防水处理（M²）」
    // 主材
    '成品淋浴房':     0,       // 用定制淋浴房，成品房默认不做法
    '淋浴房定制':     3,
    '暖风机冷风机':   1,
    '龙头':           1,
    '马桶':           1,
    '花洒':           1,
    '铝扣板吊顶':     1,
    '成品卫浴柜60-90cm': 1,    // 名称：成品卫浴柜（60-90cm）简约款
    '隔音棉包水管':   1,
    // 门与门套
    '平开门钛镁合金': 0,
    '套装门':         0,
    '钛镁合金门套':   0,
    '门套基层处理':   0,
    // 附加
    '翻筑工艺套餐':   0,
    '超出面积':       0,
    '主材包':         0,
    '淋浴区大理石台板': 0      // 名称：淋浴区大理石台板
  }
};

// 返回该空间该项目的固定工程量；undefined = 未在口述规则里定死，交给原算法
function fixedQty(itemId, space) {
  if (!space) return undefined;
  const m = FIXED_BY_SPACE[space.key];
  return m ? m[itemId] : undefined;
}

// 分项映射：id → 计算函数（id 与 config.js 对齐，含老板后台改过的常见别名）
const RULES = {
  // 湿区
  '贴砖':            s => tileArea(s),
  '瓷砖':            s => tileArea(s) * (1 + P.LOSS),
  'tile':            s => tileArea(s) * (1 + P.LOSS),
  'beauty':          s => (floorCoverSelected(s) === '贴砖' ? tileArea(s) : 0), // 美缝：仅贴砖时有，选地板则0
  '美缝':            s => (floorCoverSelected(s) === '贴砖' ? tileArea(s) : 0), // 美缝（标准id）：仅贴砖时按贴砖面积，选地板为0
  '地面自流平':       s => {
    // 仅当选定「复合实木地板」时才算自流平；选地砖(贴砖)/石塑地板则为零（老板 2026-10-01 定）
    const sel = floorCoverSelected(s);
    return sel === '复合实木地板' ? base(s).S : 0;
  },
  '防水处理2':        s => { const b = base(s); return b.S + P.WP_SKIRT * b.C + (P.WP_SHOWER_H - P.WP_SKIRT) * Math.max(b.W, b.D); },
  '推拉门':          s => { const d = doorOf(s); return d.w * d.h; },
  // 橱柜延米：老板 2026-09-28 定版公式 = 房间长+宽−0.6−0.7
  //   示意图里真摆了柜子时以实测柜长为准（更准），没摆才退回公式
  '地柜长度':         s => {
    if (s.key === 'kitchen') {
      const placed = placedLengthM(s, ['cabinet', 'counter']);
      // 口径开关（后台「算法参数」可切）：开=以示意图实测柜长为准；关=老板定版公式
      if (P.KITCHEN_CAB_PLACED && placed != null) return placed;
      const b = base(s); return b.W + b.D - 1.3;   // 长+宽−0.6−0.7（老板 09-28 定版）
    }
    const b = base(s); return Math.max(b.W, b.D);
  },
  '吊柜长度':         s => {
    // 吊柜 = 地柜 × 0.6（烟机段不做上柜）。恒为地柜的 0.6，绝不会比地柜长。
    // 注：老板 2026-09-30 定——原回退公式 (W+D-0.6)×0.6 与地柜口径不一致，会出现吊柜偏长，故改为直接取地柜长度换算。
    const baseLen = RULES['地柜长度'](s);
    return baseLen != null ? r1(baseLen * 0.6) : null;
  },
  // 干区涂料类（同净墙面面积）
  '墙面涂料':         s => netWall(s) * (1 + P.LOSS),
  '墙面铲除':         s => netWall(s) * (1 + P.LOSS),
  '乳胶漆铲除':       s => netWall(s) * (1 + P.LOSS),
  '腻子粉批刮':       s => netWall(s) * (1 + P.LOSS),
  '墙纸拆除':         s => netWall(s) * (1 + P.LOSS),
  '墙面局部修复基层处理': s => netWall(s) * (1 + P.LOSS),
  '墙面粉刷红砖墙处理':   s => netWall(s) * (1 + P.LOSS),
  '芸菁砂艺术墙面':    s => netWall(s) * (1 + P.LOSS),
  'artwall':         s => netWall(s) * (1 + P.LOSS),
  'paint':           s => netWall(s) * (1 + P.LOSS),
  // 顶面/吊顶
  '顶面涂料':         s => base(s).S,
  '石膏板吊顶平顶':    s => base(s).S,
  // 柜体：定制衣柜 = 示意图实际布置的柜长 × 柜高（投影面积）；未摆放退回默认 2.4×2.6
  '定制衣柜':         s => {
    const placed = placedLengthM(s, ['wardrobe']);
    return (placed != null ? placed : P.WARDROBE.len) * P.WARDROBE.h;
  },
  'wardrobe':        s => {
    const placed = placedLengthM(s, ['wardrobe']);
    return (placed != null ? placed : P.WARDROBE.len) * P.WARDROBE.h;
  },
  // 地板（柜下铺，不扣占地——老板定版）
  '复合实木地板':     s => base(s).S * (1 + P.LOSS),
  '石塑地板6mm':     s => base(s).S * (1 + P.LOSS),
  'woodfloor':       s => base(s).S * (1 + P.LOSS),
  // 踢脚线/门套（单面=双面，老板定版）
  '实木踢脚线':       s => Math.max(0, base(s).C - P.SKIRTING_DOOR_W),
  'skirting':        s => Math.max(0, base(s).C - P.SKIRTING_DOOR_W),
  '双边木门套':       () => P.CASE_LEN,
  '厨房双边木门套':    () => P.CASE_LEN,
  'doorset_double':  () => P.CASE_LEN,
  '钛镁合金门套':     () => P.CASE_LEN,
  '单边木门套':  () => P.CASE_LEN,
  // 点位/小件（老板定版点位表）
  '开关插座面板':     s => P.SOCKETS[s.key] || 0,
  'socket':          s => P.SOCKETS[s.key] || 0,
  '地漏':            s => P.FLOOR_DRAIN[s.key] || 0,
  '过门石':          s => P.THRESHOLD[s.key] || 0
};

// 主入口：返回估算数量（0.1 位）；null = 无面积关系（项/套/樘整体计价，不算）
// 顺序：空间固定值 → 分项公式；固定值可以是 0（如厨房默认不做门），不走"<=0 返回 null"
// 例外：ZERO_WHEN_RULE_ZERO 内的项（美缝/自流平），公式算出 0 表示"条件不满足、工程量取零"，
//       必须返回 0（让 autoEstimate 把 qty 归零、不计入），而非 null（null 会保留手工默认 qty 误计价）。
const ZERO_WHEN_RULE_ZERO = new Set(['美缝', 'beauty', '地面自流平']);
function estimateQty(itemId, space) {
  if (!space || !space.w || !space.d || !space.h) return null;
  const fixed = fixedQty(itemId, space);
  if (fixed !== undefined) return r1(fixed);
  const fn = RULES[itemId];
  if (!fn) return null;
  const v = fn(space);
  if (!isFinite(v)) return null;
  if (v <= 0) return ZERO_WHEN_RULE_ZERO.has(itemId) ? 0 : null;  // 仅联动项归零，其余保持原 null（保留手工量）
  return r1(v);
}

module.exports = { estimateQty, fixedQty, tileArea, netWall, base, floorCoverSelected, FIXED_BY_SPACE, KITCHEN_FIXED: FIXED_BY_SPACE.kitchen };
