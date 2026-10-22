// 微信登录 / openid 管理
// ---------------------------------------------------------------------
// 为什么需要 openid：
//   效果图额度必须挂在「人」身上而不是「这台手机」上，否则客户换手机、
//   清缓存就能重置额度，付费买的张数也会丢。微信支付回调里也只认 openid。
// 说明：
//   额度接口全在 Render 后端（PROXY_BASE），小程序只拿 openid 去查。
// ---------------------------------------------------------------------

const API = 'https://room-rchx.onrender.com';
const OKEY = 'wx_openid_v1';

let _pending = null;   // 并发去重：同时多处调 login 只发一次请求

function get() {
  try { return wx.getStorageSync(OKEY) || ''; } catch (e) { return ''; }
}

function set(id) {
  try { if (id) wx.setStorageSync(OKEY, id); } catch (e) { /* ignore */ }
}

function clear() {
  try { wx.removeStorageSync(OKEY); } catch (e) { /* ignore */ }
}

// 调后端换 openid；失败返回空串（不阻塞业务，退回本地模式）
function login() {
  if (_pending) return _pending;
  _pending = new Promise(resolve => {
    wx.login({
      success(lr) {
        if (!lr || !lr.code) { _pending = null; resolve(''); return; }
        wx.request({
          url: API + '/api/login',
          method: 'POST',
          timeout: 15000,
          header: { 'Content-Type': 'application/json' },
          data: { code: lr.code },
          success(r) {
            const d = r.data || {};
            if (d.ok && d.openid) { set(d.openid); resolve(d.openid); }
            else resolve('');
            _pending = null;
          },
          fail() { _pending = null; resolve(''); }
        });
      },
      fail() { _pending = null; resolve(''); }
    });
  });
  return _pending;
}

// 已有就返回，没有就登录一次
function ensure() {
  const id = get();
  if (id) return Promise.resolve(id);
  return login();
}

module.exports = { API, get, set, clear, login, ensure };
