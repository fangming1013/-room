// 小程序虚拟支付（XPay / 米大师）—— iOS 也能合法卖虚拟商品的正规通道
// ---------------------------------------------------------------------
// 为什么需要它：
//   微信规则里，虚拟商品（会员、课程、AI 出图、素材下载…）只能用虚拟支付，
//   用普通 wx.requestPayment 会被风控直接封支付能力（真机报「支付能力已被限制」）。
//   开通虚拟支付后，安卓走微信支付、iOS 走 Apple IAP，同一套接口、同一个界面。
//
// 前置（老板在 mp 后台完成，缺一项这文件都是空转）：
//   1. 服务类目含「工具」（我们是 工具→效率，已命中）
//   2. 支付与交易 → 虚拟支付 → 开通并签约（1~7 个工作日）
//   3. 基础配置里开「iOS 支付开关」，填小程序简称
//   4. 道具管理建两个道具：render_5 / render_10，拿到 productId
//   5. 消息推送填发货回调地址（本服务的 /api/vpay-notify）
//
// 环境变量：
//   VPAY_OFFER_ID     虚拟支付 OfferID（后台基础配置里）
//   VPAY_APP_KEY      现网 AppKey（保密，只放服务端）
//   VPAY_SANDBOX_KEY  沙箱 AppKey（联调用）
//   VPAY_ENV          0=现网 1=沙箱（默认 0）
//   WX_APP_SECRET     已有，用于 code2Session 换 session_key
//
// ⚠️ 签名必须在服务端算：客户端拿不到 AppKey 和 session_key，也不该拿。
// ---------------------------------------------------------------------
const crypto = require('crypto');

function cfg() {
  return {
    appId: process.env.WX_APP_ID || 'wx89952f3a02cdc470',
    appSecret: process.env.WX_APP_SECRET || '',
    offerId: String(process.env.VPAY_OFFER_ID || ''),
    appKey: String(process.env.VPAY_APP_KEY || ''),
    sandboxKey: String(process.env.VPAY_SANDBOX_KEY || ''),
    env: Number(process.env.VPAY_ENV || 0) === 1 ? 1 : 0,
    deliverUrl: String(process.env.VPAY_DELIVER_URL || '')
  };
}

// 三个参数齐了才算能收钱（AppSecret 是换 session_key 用的，旧代码可能已有）
function isConfigured() {
  const c = cfg();
  return !!(c.offerId && c.appKey && c.appSecret);
}

function status() {
  const c = cfg();
  return {
    configured: isConfigured(),
    offerId: c.offerId ? c.offerId.slice(0, 4) + '****' : '',
    appKeySet: !!c.appKey,
    appSecretSet: !!c.appSecret,
    env: c.env === 1 ? 'sandbox' : 'prod',
    deliverUrlSet: !!c.deliverUrl
  };
}

/**
 * code → { openid, session_key }
 * 虚拟支付的用户态签名 signature 必须用 session_key 算，所以这里比普通支付多要一个字段。
 * 注意：session_key 只在服务端流转，绝不返回小程序。
 */
async function code2session(code) {
  const c = cfg();
  if (!c.appSecret) throw new Error('未配置 WX_APP_SECRET，无法换取 session_key');
  const u = 'https://api.weixin.qq.com/sns/jscode2session?appid=' + c.appId +
    '&secret=' + c.appSecret + '&js_code=' + encodeURIComponent(code) + '&grant_type=authorization_code';
  const r = await fetch(u);
  const j = await r.json().catch(() => ({}));
  if (!j.openid || !j.session_key) {
    throw new Error('换取 session_key 失败：' + (j.errmsg || JSON.stringify(j)));
  }
  return { openid: j.openid, session_key: j.session_key };
}

function hmac(key, data) {
  return crypto.createHmac('sha256', String(key)).update(String(data)).digest('hex');
}

function genOutTradeNo() {
  // 米大师要求全局唯一；20 位足够，且便于肉眼区分是装修线的单
  return 'VP' + Date.now().toString() + Math.floor(Math.random() * 900000 + 100000);
}

/**
 * 下单：返回小程序端调 wx.requestVirtualPayment 所需的三要素
 * @param {object} o
 * @param {string} o.code        wx.login 拿到的 code
 * @param {string} o.productId   后台道具管理里配的道具 ID，如 render_5
 * @param {number} o.price       单价（分），必须与后台道具配置一致，否则会被校验拒绝
 * @param {number} o.count       购买数量（张数）
 * @param {string} [o.outTradeNo]
 */
async function createOrder(o) {
  const c = cfg();
  if (!isConfigured()) throw new Error('虚拟支付未配置（缺 VPAY_OFFER_ID / VPAY_APP_KEY / WX_APP_SECRET）');
  const price = Math.round(Number(o.price) || 0);
  const count = Math.max(1, Math.round(Number(o.count) || 1));
  if (!(price > 0)) throw new Error('金额必须大于 0');
  if (!o.productId) throw new Error('缺少 productId（后台道具管理里创建）');

  const { openid, session_key } = await code2session(o.code);
  const outTradeNo = o.outTradeNo || genOutTradeNo();

  const payload = {
    offerId: c.offerId,
    buyQuantity: count,
    env: c.env,
    currencyType: 'CNY',
    productId: String(o.productId),
    goodsPrice: price,
    outTradeNo: outTradeNo,
    attach: String(o.attach || '')
  };
  const signData = JSON.stringify(payload);
  const key = c.env === 1 ? (c.sandboxKey || c.appKey) : c.appKey;

  return {
    ok: true,
    openid: openid,                 // 不返回给前端，仅内部发货用
    outTradeNo: outTradeNo,
    payParams: {
      signData: signData,
      // 支付签名：证明这笔单是商户自己发起的
      paySig: hmac(key, 'requestVirtualPayment&' + signData),
      // 用户态签名：绑当前用户，防止串号
      signature: hmac(session_key, signData),
      // 道具直购模式（我们卖的是「5 张 / 10 张效果图」这种一次性道具，不是订阅）
      mode: 'short_series_goods'
    }
  };
}

/**
 * 发货回调验签（xpay_goods_deliver_notify）
 * ⚠️ 实装前必须做的三件事：
 *   1. 验签（用 AppKey 对微信推送的签名做 HMAC 比对）
 *   2. 幂等（同一 outTradeNo 只加一次额度，靠 store.setnx 锁）
 *   3. 兜底查单（success 回调会丢，微信侧也可能重推；两边都要能对齐）
 * 这里只做结构占位——没有真实 OfferID 时贸然开路由，等于给自己开一个加额度后门。
 */
function verifyNotify(headers, rawBody) {
  const c = cfg();
  if (!c.appKey) return { ok: false, error: '未配置 AppKey，拒绝处理' };
  const sig = String((headers && (headers['pay-sig'] || headers['Pay-Sig'])) || '');
  if (!sig) return { ok: false, error: '缺少签名' };
  const expect = hmac(c.appKey, rawBody);
  if (sig.length !== expect.length) return { ok: false, error: '签名不匹配' };
  // 定时安全比较，避免逐字节试探
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, error: '签名不匹配' };
  try {
    return { ok: true, data: JSON.parse(rawBody) };
  } catch (e) {
    return { ok: false, error: '报文不是合法 JSON' };
  }
}

module.exports = { isConfigured, status, createOrder, verifyNotify, code2session, cfg };
