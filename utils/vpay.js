// 小程序虚拟支付 —— iOS 也能正常买效果图（不是绕，是官方通道）
// ---------------------------------------------------------------------
// 为什么单独一个模块：
//   wx.requestPayment（普通支付）在 iOS 上卖虚拟商品会被风控掐断支付能力；
//   wx.requestVirtualPayment（虚拟支付）才是正门，安卓走微信支付、iOS 走 Apple IAP，
//   用户看到的收银台是同一个，价格和按钮两端完全一致。
//
// 服务端算签名，客户端只负责唤起：
//   signData / paySig / signature 三要素由 /api/vpay-order 返回，包里不存任何密钥。
//
// 未开通时（后端返回 501 VPAY_NOT_READY）会抛 code='VPAY_NOT_READY'，
// 调用方据此回落到"记意向"，不会白屏也不会报错。
// ---------------------------------------------------------------------
const sf = require('./siliconflow.js');

const PROXY_BASE = sf.PROXY_BASE;

// 套餐 → 虚拟支付后台「道具管理」里创建的道具 ID，必须一字不差
const PRODUCT_ID = {
  p5: 'render_5',
  p10: 'render_10'
};

function login() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: r => (r.code ? resolve(r.code) : reject(new Error('微信登录失败'))),
      fail: () => reject(new Error('微信登录失败'))
    });
  });
}

function request(path, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: PROXY_BASE + path,
      method: 'POST',
      timeout: 20000,
      header: { 'Content-Type': 'application/json' },
      data: data,
      success: r => {
        const d = r.data || {};
        if (d.ok) { resolve(d); return; }
        const err = new Error(d.error || ('服务异常(' + (r.statusCode || '') + ')'));
        err.code = d.code || '';
        err.status = r.statusCode;
        reject(err);
      },
      fail: e => {
        const err = new Error(e.errMsg || '网络异常');
        err.code = 'NET';
        reject(err);
      }
    });
  });
}

/**
 * 购买套餐
 * @param {string} packId 'p5' | 'p10'
 * @param {object} pack   { id, count, price }（price 单位：分）
 * @returns {Promise<{outTradeNo:string}>}
 */
async function buy(packId, pack) {
  const pid = PRODUCT_ID[packId];
  if (!pid) throw new Error('未知套餐：' + packId);
  const code = await login();
  const d = await request('/api/vpay-order', {
    code: code,
    productId: pid,
    price: pack.price,
    count: pack.count
  });

  return new Promise((resolve, reject) => {
    if (!wx.requestVirtualPayment) {
      const e = new Error('当前微信版本不支持虚拟支付，请升级微信');
      e.code = 'UNSUPPORTED';
      reject(e);
      return;
    }
    wx.requestVirtualPayment({
      signData: d.payParams.signData,
      paySig: d.payParams.paySig,
      signature: d.payParams.signature,
      mode: d.payParams.mode || 'short_series_goods',
      success: () => resolve({ outTradeNo: d.outTradeNo }),
      fail: e => {
        const msg = (e && (e.errMsg || e.errmsg)) || '';
        const err = new Error(/cancel/i.test(msg) ? '已取消支付' : (msg || '支付未完成'));
        err.code = /cancel/i.test(msg) ? 'CANCEL' : 'FAIL';
        reject(err);
      }
    });
  });
}

// 是否具备虚拟支付能力（微信版本够 + 接口存在）
function available() {
  return typeof wx !== 'undefined' && typeof wx.requestVirtualPayment === 'function';
}

// 服务端是否已开通虚拟支付（决定 iOS 端要不要放开价格与购买入口）
// 结果缓存 10 分钟：避免每次进页面都打一次接口，但改了后台配置也能较快生效
const READY_KEY = 'vpay_ready_v1';
const READY_TTL = 10 * 60 * 1000;

function checkReady(force) {
  return new Promise(resolve => {
    try {
      const c = wx.getStorageSync(READY_KEY);
      if (!force && c && c.at && (Date.now() - c.at) < READY_TTL) {
        resolve(!!c.ok);
        return;
      }
    } catch (e) { /* ignore */ }
    wx.request({
      url: PROXY_BASE + '/api/health',
      method: 'GET',
      timeout: 8000,
      success: r => {
        const d = (r.data && r.data.vpay) || {};
        const ok = !!d.configured;
        try { wx.setStorageSync(READY_KEY, { ok: ok, at: Date.now() }); } catch (e) {}
        resolve(ok);
      },
      fail: () => resolve(false)
    });
  });
}

module.exports = { buy, available, checkReady, PRODUCT_ID };
