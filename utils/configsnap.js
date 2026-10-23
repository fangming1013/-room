// 规则数据云端快照（老板手填的价格/项目/工程量）
// ---------------------------------------------------------------------
// 为什么要有这一层：
//   这些数据只存在手机本地 config_override_v2，清缓存 / 换手机 / 重装微信就没了。
//   代码可以用 git 回滚，价格回不来 —— 所以每保存一次就同步一份到服务端。
//   保留最近 20 份，恢复时挑一份覆盖即可。
// ---------------------------------------------------------------------

const auth = require('./wxauth.js');

function req(path, method, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: auth.API + path,
      method: method || 'GET',
      data: data,
      timeout: 15000,
      header: { 'Content-Type': 'application/json' },
      success(r) {
        const d = r.data || {};
        if (d.ok) resolve(d);
        else reject(new Error(d.error || ('HTTP ' + (r.statusCode || ''))));
      },
      fail(e) { reject(new Error((e && e.errMsg) || '网络异常')); }
    });
  });
}

// 存一份
function save(data, label) {
  return auth.ensure().then(id => {
    if (!id) return null;
    return req('/api/config-snap', 'POST', { openid: id, data: data, label: label || '' });
  });
}

// 列出历史（新 → 旧）
function list() {
  return auth.ensure().then(id => {
    if (!id) return [];
    return req('/api/config-snap?openid=' + encodeURIComponent(id)).then(d => d.list || []);
  }).catch(() => []);
}

// 取某一份
function get(ts) {
  return auth.ensure().then(id => {
    if (!id) return null;
    return req('/api/config-snap?openid=' + encodeURIComponent(id) + '&ts=' + ts).then(d => d.data || null);
  });
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return (d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

module.exports = { save, list, get, fmtTime };
