// 工程量估算参数表（v1.1 · 2026-09-26 老板校准定版，规则详见技能库 renovation-qty-rules）
// 单位约定：全流程 m。改参数不改公式（estimate.js）。
// v1.2：支持后台「算法参数」页覆写——覆写存本机 storage(qty_params_override_v1)，默认值永远在这里兜底。
const KEY = 'qty_params_override_v1';

const DEFAULTS = {
  TILE_H: 2.4,            // 贴砖高度 m（老板定版）
  LOSS: 0.05,             // 损耗统一 5%（老板定版：瓷砖/地砖/地板/涂料同口径）
  DOOR: {
    wood:        { w: 0.9, h: 2.05 },   // 木门/套装门/平开门洞
    slideDouble: { w: 1.6, h: 2.05 },   // 推拉门·双门（老板定版）
    slideSingle: { w: 0.8, h: 2.05 },   // 推拉门·单门（老板定版）
    win:         { w: 1.5, h: 1.5 }     // 窗洞（阳台大窗按实测手改）
  },
  SLIDE_DOOR: 'double',   // 厨房/阳台推拉门默认双门
  WARDROBE: { len: 2.0, h: 2.6, dep: 0.6 },   // 衣柜默认长×高（老板定版 2.0，与布局上限一致）
  CASE_LEN: 5.0,          // 门套每樘长度 m：单面=双面（老板定版）
  WP_SKIRT: 0.3,          // 防水墙面上翻 m（AI默认）
  WP_SHOWER_H: 1.8,       // 淋浴区防水高度 m（AI默认）
  SKIRTING_DOOR_W: 0.9,   // 踢脚线扣门洞宽
  FLOOR_UNDER_CAB: true,  // 柜下铺地板，不扣占地（老板定版）
  KITCHEN_CAB_PLACED: false, // 厨房地柜口径：false=老板 09-28 定版公式（长+宽−0.6−0.7）；true=以示意图实测柜长为准
  SOCKETS: { kitchen: 12, bathroom: 6, living: 15, bedroom: 12, study: 12, balcony: 5 },   // 点位数（老板定版）
  FLOOR_DRAIN: { bathroom: 1, balcony: 1 },   // 地漏
  THRESHOLD: { bathroom: 1 }                  // 过门石：仅卫生间 1 块（老板定版）
};

// current = 运行时生效参数（默认值 + 后台覆写深合并），estimate.js 直接引用本对象
const current = JSON.parse(JSON.stringify(DEFAULTS));

function isObj(v) { return v && typeof v === 'object' && !(v instanceof Array); }

function deepMerge(target, src) {
  Object.keys(src || {}).forEach(k => {
    if (k.indexOf('__') === 0) return;              // 跳过内部方法
    if (isObj(target[k]) && isObj(src[k])) deepMerge(target[k], src[k]);
    else if (src[k] !== undefined && src[k] !== null && src[k] !== '') target[k] = src[k];
  });
}

function snapshot() { return JSON.parse(JSON.stringify(current)); }

function load() {
  try {
    const ov = wx.getStorageSync(KEY);
    if (ov) deepMerge(current, ov);
  } catch (e) {}
}

function save(patch) {
  deepMerge(current, patch);
  try { wx.setStorageSync(KEY, snapshot()); } catch (e) {}
}

function reset() {
  const d = JSON.parse(JSON.stringify(DEFAULTS));
  Object.keys(current).forEach(k => { if (k.indexOf('__') !== 0) delete current[k]; });
  deepMerge(current, d);
  try { wx.setStorageSync(KEY, snapshot()); } catch (e) {}
}

load();

module.exports = current;
module.exports.__defaults = () => JSON.parse(JSON.stringify(DEFAULTS));
module.exports.__save = save;
module.exports.__reset = reset;
module.exports.__snapshot = snapshot;
