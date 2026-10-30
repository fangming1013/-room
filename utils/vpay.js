// 小程序虚拟支付 —— iOS 也能正常买效果图（不是绕，是官方通道）
// ---------------------------------------------------------------------
// 为什么单独一个模块：
//   wx.requestPayment（普通支付）卖虚拟商品在 iOS 上会被风控掐断支付能力；
//   wx.requestVirtualPayment 才是正门，安卓走微信支付、iOS 走 Apple IAP，
//   用户看到的收银台是同一个，价格和按钮两端完全一致。
//
// 服务端算签名，客户端只负责唤起：
//   signData / paySig / signature 三要素由 /api/vpay-order 返回，包里不存任何密钥。
//   价格与张数也由服务端定（客户端传数字没用），避免被改价白拿。
//
// 未开通时后端返回 501 VPAY_NOT_READY，这里抛 code='VPAY_NOT_READY'，
// 调用方据此回落到旧逻辑，不会白屏也不会报错。
// ---------------------------------------------------------------------
const sf = require('./siliconflow.js');

const PROXY_BASE = sf.PROXY_BASE;

// 套餐 → MP 后台「虚拟支付 → 道具管理」里创建的道具 ID，必须一字不差
const PRODUCT_ID = {
  p5: 'render_5',
  p10: 'render_10'
};

// 错误码 → 人话（排查时省掉一整轮猜）
const ERR_HINT = {
  '-15001': '支付参数不合法',
  '-15002': '道具不存在，检查道具是否已创建并发布',
  '-15003': '价格与后台道具不一致',
  '-15005': '虚拟支付未开通',
  '-15006': 'AppKey 与环境不匹配（沙箱/现网混用）',
  '-15010': '道具未发布',
  '-15011': '沙箱未授权，请在该环境白名单内测试',
  '-15013': '价格不一致（单位应为分）',
  '-15014': '道具刚发布，约 10 分钟后生效'
};

function login() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: r => (r.code ? resolve(r.code) : reject(new Error('微信登录失败'))),
      fail: () => reject(new Error('微信登录失败'))
    });
  });
}

function post(path, data) {
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

// 查订单是否已到账（真正加额度在后端，前端只读结果）
function queryStatus(no) {
  return new Promise(resolve => {
    wx.request({
      url: PROXY_BASE + '/api/vpay-status?no=' + encodeURIComponent(no),
      method: 'GET',
      timeout: 8000,
      success: r => resolve((r.data && r.data.ok) ? r.data : null),
      fail: () => resolve(null)
    });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 支付成功后到账是异步的（等微信推送），最多等约 12 秒
async function waitDelivered(no, tries) {
  const n = tries == null ? 8 : tries;
  for (let i = 0; i < n; i++) {
    const st = await queryStatus(no);
    if (st && st.status === 'delivered') return true;
    await sleep(1500);
  }
  return false;
}

/**
 * 购买套餐
 * @param {string} packId 'p5' | 'p10'
 * @returns {Promise<{outTradeNo:string, count:number, delivered:boolean}>}
 */
async function buy(packId) {
  const pid = PRODUCT_ID[packId];
  if (!pid) throw new Error('未知套餐：' + packId);

  const code = await login();
  const d = await post('/api/vpay-order', { code: code, productId: pid });

  await new Promise((resolve, reject) => {
    if (!wx.requestVirtualPayment) {
      const e = new Error('当前微信版本不支持，请升级微信后重试');
      e.code = 'UNSUPPORTED';
      reject(e);
      return;
    }
    wx.requestVirtualPayment({
      signData: d.payParams.signData,
      paySig: d.payParams.paySig,
      signature: d.payParams.signature,
      mode: d.payParams.mode || 'short_series_goods',
      env: d.payParams.env,
      offerId: d.payParams.offerId,
      success: () => resolve(),
      fail: e => {
        const msg = (e && (e.errMsg || e.errmsg)) || '';
        const no = e && (e.errno || e.errCode);
        const hint = no != null ? (ERR_HINT[String(no)] || '') : '';
        const err = new Error(
          /cancel/i.test(msg) ? '已取消支付'
            : (hint || msg || '支付未完成') + (no != null ? '（' + no + '）' : '')
        );
        err.code = /cancel/i.test(msg) ? 'CANCEL' : 'FAIL';
        err.errno = no;
        reject(err);
      }
    });
  });

  // 付款成功 ≠ 到账。等推送落地，别让用户看到"付了钱额度还是 0"
  const delivered = await waitDelivered(d.outTradeNo);
  return { outTradeNo: d.outTradeNo, count: d.count, delivered: delivered };
}

// 是否具备虚拟支付能力（微信版本够 + 接口存在）
function available() {
  return typeof wx !== 'undefined' && typeof wx.requestVirtualPayment === 'function';
}

// 服务端是否已开通虚拟支付（决定 iOS 端要不要放开价格与购买入口）
// 结果缓存 10 分钟：避免每次进页面都打一次接口，但改了后台配置也能较快生效
const READY_KEY = 'vpay_ready_v1';
const READY_TTL = 10 * 60 * 1000;

// 上次已知结论；没有记录时按「可用」处理。
// ⚠️ 这里必须是乐观默认，不能默认 false：
//    iOS 的购买入口完全由这个返回值控制（安卓还有 PAY_ENABLED 本地常量兜底，
//    所以安卓从来不会因为网络问题丢入口）。一旦把「查不到」当成「没开通」，
//    Render 免费层冷启动（30~60 秒）或一次网络抖动，就会让 iPhone 上
//    整个购买入口消失，用户点「看价格」直接被送去预约设计师。
//    真没开通也不会亏：点下去下单会返回 501，由 _fallbackBuy 兜住。
function lastKnown() {
  try {
    const c = wx.getStorageSync(READY_KEY);
    if (c && typeof c.ok === 'boolean') return !!c.ok;
  } catch (e) { /* ignore */ }
  return true;
}

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
      timeout: 15000,   // 原来 8s：Render 冷启动唤醒要 30~60s，8s 必然超时
      success: r => {
        const d = (r.data && r.data.vpay) || null;
        // 只认服务端明确给出的布尔值。502/HTML/字段缺失一律算「未知」，沿用上次结论，
        // 绝不把「响应不对」当成「没开通」写进缓存。
        if (r.statusCode !== 200 || !d || typeof d.configured !== 'boolean') {
          resolve(lastKnown());
          return;
        }
        const ok = !!d.configured;
        try { wx.setStorageSync(READY_KEY, { ok: ok, at: Date.now() }); } catch (e) {}
        resolve(ok);
      },
      fail: () => resolve(lastKnown())
    });
  });
}

module.exports = { buy, available, checkReady, PRODUCT_ID };
