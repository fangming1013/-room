// 空间数据出口：统一从 config 取真值，cloneSpace 给页面一份可随意改的副本
// （config.js 是老板后台维护的单一数据源，页面编辑只动副本，不回写）
const cfg = require('./config.js');

// 深拷贝一份空间作为编辑态，并补齐编辑页需要的门窗字段
//   doorOff / winOff = 该洞距所在墙面左端的距离(cm)，未定位＝null（居中）
function cloneSpace(key) {
  const keys = cfg.spaceKeys();
  const k = keys.indexOf(key) >= 0 ? key : keys[0];
  const s = JSON.parse(JSON.stringify(cfg.spaces()[k]));
  s.key = k;
  s.doorWall = s.doorWall || 'right';
  s.doorW = s.doorW || 80;
  s.doorEnd = s.doorEnd || 'min';
  s.doorOff = null;                       // 距左端 cm；null＝居中
  s.winWall = s.winWall || 'top';
  s.winW = s.winW || 100;
  s.winEnd = s.winEnd || 'mid';
  s.winOff = null;
  if (!s.furniture) s.furniture = [];
  (s.materials || []).forEach(m => { if (m.qty == null) m.qty = 1; });
  (s.labor || []).forEach(l => { if (l.qty == null) l.qty = 1; });
  return s;
}

module.exports = {
  SPACE_KEYS: cfg.spaceKeys(),
  SPACES: cfg.spaces(),
  WALLS: cfg.walls(),
  MATERIAL_CATALOG: cfg.materialCatalog(),
  cloneSpace
};
