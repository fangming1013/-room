// 效果图相册（本机）
// ---------------------------------------------------------------------
// 每生成一张效果图就入册一条记录；图片文件本身存在 USER_DATA_PATH/renders/，
// 相册只存路径（很小），所以能长期保留而不占 storage。
// 豆包的返回地址 24 小时就失效 → 优先用本地文件，local 为空时才退回网络地址。
// ---------------------------------------------------------------------
const GKEY = 'render_gallery_v1';
const MAX = 200;

function list() {
  let l = [];
  try { l = wx.getStorageSync(GKEY) || []; } catch (e) {}
  return Array.isArray(l) ? l : [];
}
function save(l) {
  try { wx.setStorageSync(GKEY, l.slice(0, MAX)); } catch (e) {}
  return l;
}

// item: { url, local, style, styleName, spaceName, ts }
function add(item) {
  if (!item || (!item.url && !item.local)) return null;
  const ts = item.ts || Date.now();
  const rec = {
    ts,
    url: item.url || '',
    local: item.local || '',
    style: item.style || '',
    styleName: item.styleName || '',
    spaceName: item.spaceName || '房间',
    projectId: item.projectId || ''
  };
  const l = list();
  l.unshift(rec);
  save(l);
  return ts;
}

// 本地化完成后回填路径（按 ts 匹配）
function setLocal(ts, local) {
  if (!ts || !local) return;
  const l = list();
  const i = l.findIndex(x => x.ts === ts);
  if (i >= 0) {
    l[i].local = local;
    save(l);
  }
}

function remove(ts) {
  return save(list().filter(x => x.ts !== ts));
}
function clear() {
  try { wx.removeStorageSync(GKEY); } catch (e) {}
}

// 取可显示的地址（本地优先；本地文件被系统清理时退回网络地址）
function src(item) {
  return (item && (item.local || item.url)) || '';
}

module.exports = { list, add, setLocal, remove, clear, src, MAX };
