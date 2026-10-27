// 小程序虚拟支付（Midas / XPay）—— iOS 也能合法卖虚拟商品的正规通道
// ---------------------------------------------------------------------
// 为什么需要它：
//   虚拟商品（会员、课程、AI 出图、素材下载…）只能用虚拟支付。
//   用普通 wx.requestPayment 卖虚拟商品，真机会报「支付能力已被限制」。
//   开通虚拟支付后，安卓走微信支付、iOS 走 Apple IAP，同一套接口、同一个收银台。
//
// 环境变量：
//   VPAY_OFFER_ID     虚拟支付 OfferID（默认已填，可用变量覆盖）
//   VPAY_APP_KEY      现网 AppKey（保密，只放服务端）
//   VPAY_SANDBOX_KEY  沙箱 AppKey（联调用）
//   VPAY_ENV          0=现网 1=沙箱（默认 0）
//   VPAY_PUSH_TOKEN   发货推送的 Token（后台消息推送里自己填的那个，可选）
//   WX_APP_SECRET     已有，用于 code2Session 换 session_key
//
// ⚠️ 三条铁律（血泪踩坑）：
//   1. goodsPrice 是「道具单价」（分），buyQuantity 是「购买份数」。
//      我们一个套餐＝一个道具 → buyQuantity 恒为 1。
//      若把「套餐总价」当单价、又把「张数」当份数，客户会被扣 5 倍钱。
//   2. signData 必须原样传给前端再原样传回，前端二次 JSON.stringify 会改字段顺序导致验签失败。
//   3. 发货只认推送 + 订单存在性，绝不认前端 success。
// ---------------------------------------------------------------------
const crypto = require('crypto');

// 道具表：productId → 张数 / 套餐价（分）
// ⚠️ 价格与张数在这里定死，不接受客户端传入——否则客户端改个数字就能 1 分钱买 999 张。
// 必须与 MP 后台「虚拟支付 → 道具管理」里创建的道具**一字不差、价格一致**。
const PRODUCTS = {
  render_5:  { count: 5,  price: 699, title: '5 张效果图' },
  render_10: { count: 10, price: 990, title: '10 张效果图' }
};

function cfg() {
  return {
    appId: process.env.WX_APP_ID || 'wx89952f3a02cdc470',
    appSecret: process.env.WX_APP_SECRET || '',
    // OfferID 是公开信息（前端也要用），写死兜底，少一个要配错的变量
    offerId: String(process.env.VPAY_OFFER_ID || '1450694692'),
    appKey: String(process.env.VPAY_APP_KEY || ''),
    sandboxKey: String(process.env.VPAY_SANDBOX_KEY || ''),
    env: Number(process.env.VPAY_ENV || 0) === 1 ? 1 : 0,
    pushToken: String(process.env.VPAY_PUSH_TOKEN || '')
  };
}

// 三个参数齐了才算能收钱
function isConfigured() {
  const c = cfg();
  return !!(c.offerId && c.appKey && c.appSecret);
}

function status() {
  const c = cfg();
  return {
    configured: isConfigured(),
    offerId: c.offerId || '',
    appKeySet: !!c.appKey,
    appSecretSet: !!c.appSecret,
    env: c.env === 1 ? 'sandbox' : 'prod',
    pushTokenSet: !!c.pushToken,
    products: Object.keys(PRODUCTS)
  };
}

/**
 * code → { openid, session_key }
 * 虚拟支付的用户态签名 signature 必须用 session_key 算，所以比普通支付多要一个字段。
 * session_key 只在服务端流转，绝不返回小程序。
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
  return crypto.createHmac('sha256', String(key)).update(String(data), 'utf8').digest('hex');
}

function sha1(str) {
  return crypto.createHash('sha1').update(String(str), 'utf8').digest('hex');
}

let seq = 0;
function genOutTradeNo() {
  // 米大师要求：唯一、8~32 位、不能以下划线开头
  seq = (seq + 1) % 1000;
  return 'VP' + Date.now() + String(seq).padStart(3, '0') + String(Math.floor(Math.random() * 9000 + 1000));
}

/**
 * 下单：返回 wx.requestVirtualPayment 所需三要素
 * @param {object} o
 * @param {string} o.code       wx.login 拿到的 code
 * @param {string} o.productId  render_5 / render_10
 * @param {string} [o.attach]
 */
async function createOrder(o) {
  const c = cfg();
  if (!isConfigured()) throw new Error('虚拟支付未配置（缺 VPAY_APP_KEY / WX_APP_SECRET）');

  const pid = String(o.productId || '');
  const prod = PRODUCTS[pid];
  if (!prod) throw new Error('未知道具：' + pid);
  if (!o.code) throw new Error('缺少登录 code');

  const { openid, session_key } = await code2session(o.code);
  const outTradeNo = genOutTradeNo();

  const payload = {
    offerId: c.offerId,
    buyQuantity: 1,            // 一个套餐＝一份道具，恒为 1（见文件头铁律 1）
    env: c.env,
    currencyType: 'CNY',
    productId: pid,
    goodsPrice: prod.price,    // 套餐价，单位：分，必须与后台道具价格一致
    outTradeNo: outTradeNo,
    attach: String(o.attach || pid)
  };
  const signData = JSON.stringify(payload);
  const key = c.env === 1 ? (c.sandboxKey || c.appKey) : c.appKey;

  return {
    ok: true,
    openid: openid,              // 不下发前端，仅服务端记订单用
    outTradeNo: outTradeNo,
    count: prod.count,           // 发货张数由服务端决定
    price: prod.price,
    payParams: {
      signData: signData,
      paySig: hmac(key, 'requestVirtualPayment&' + signData),
      signature: hmac(session_key, signData),
      mode: 'short_series_goods',
      // 官方接口只要求上面四个；多带 env/offerId 对部分基础库版本更稳
      env: c.env,
      offerId: c.offerId
    }
  };
}

// ===== 发货推送 =====
// 推送可能是 XML（常见）也可能是 JSON。字段见官方：
//   Event / OpenId / OutTradeNo / Env / WeChatPayInfo.MchOrderNo
//   GoodsInfo.{ProductId, Quantity, ActualPrice}
function pickXml(xml, tag) {
  const m = xml.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'i'));
  return m ? m[1].trim() : '';
}

function parseNotify(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s.charAt(0) === '{') {
    try { return JSON.parse(s); } catch (e) { return null; }
  }
  if (/^<xml/i.test(s) || s.indexOf('<xml') >= 0) {
    return {
      isXml: true,
      Event: pickXml(s, 'Event'),
      OpenId: pickXml(s, 'OpenId'),
      OutTradeNo: pickXml(s, 'OutTradeNo'),
      Env: Number(pickXml(s, 'Env') || 0),
      MchOrderNo: pickXml(s, 'MchOrderNo'),
      ProductId: pickXml(s, 'ProductId'),
      Quantity: Number(pickXml(s, 'Quantity') || 0),
      ActualPrice: Number(pickXml(s, 'ActualPrice') || 0),
      Encrypt: pickXml(s, 'Encrypt')
    };
  }
  return null;
}

// 消息推送 URL 校验：signature = sha1(sort(token, timestamp, nonce))
function verifyUrlSign(query, token) {
  if (!token) return true;   // 没配 Token 就跳过（下面还有订单存在性兜底）
  const arr = [String(token), String((query && query.timestamp) || ''), String((query && query.nonce) || '')].sort();
  const expect = sha1(arr.join(''));
  return String((query && query.signature) || '') === expect;
}

// 应答：XML 请求回 XML 的 0，JSON 请求回 JSON；格式不对微信会重推最多 15 次
function buildReply(isXml) {
  return isXml
    ? { type: 'text/xml; charset=utf-8', body: '<?xml version="1.0" encoding="UTF-8"?><xml><ErrCode>0</ErrCode><ErrMsg>success</ErrMsg></xml>' }
    : { type: 'application/json; charset=utf-8', body: JSON.stringify({ ErrCode: 0, ErrMsg: 'success' }) };
}

module.exports = {
  PRODUCTS, isConfigured, status, createOrder,
  code2session, cfg, parseNotify, verifyUrlSign, buildReply
};
