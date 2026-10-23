/*
 * 微信支付 v3（小程序 JSAPI）—— 零依赖实现
 * -------------------------------------------------------------
 * 环境变量：
 *   WX_MCH_ID           商户号            例 1119093588
 *   WX_APP_ID           小程序 AppID      wx89952f3a02cdc470
 *   WX_APP_SECRET       小程序 AppSecret
 *   WX_CERT_SERIAL      API 证书序列号
 *   WX_PRIVATE_KEY_B64  apiclient_key.pem 的 base64（Render 上不落盘）
 *   WX_API_V3_KEY       APIv3 密钥（32 位，用于解密回调）
 *   WX_NOTIFY_URL       支付回调地址（必须 https 公网）
 * 本地开发可把 apiclient_key.pem 放在 ../certs/ 下，免配 WX_PRIVATE_KEY_B64
 * -------------------------------------------------------------
 * 安全策略：回调内容一律不信任，解密拿到 out_trade_no 后**反向查单**，
 *          以微信返回的 trade_state 为准，防止伪造回调白拿额度。
 * -------------------------------------------------------------
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const DEFAULT_NOTIFY = 'https://room-rchx.onrender.com/api/wxpay-notify';

function cfg() {
  return {
    mchId: process.env.WX_MCH_ID || '',
    // AppID 是公开信息（小程序包内也有），写死默认值，少配一个环境变量
    appId: process.env.WX_APP_ID || 'wx89952f3a02cdc470',
    serial: process.env.WX_CERT_SERIAL || '',
    apiV3: process.env.WX_API_V3_KEY || '',
    appSecret: process.env.WX_APP_SECRET || '',
    notifyUrl: process.env.WX_NOTIFY_URL || DEFAULT_NOTIFY
  };
}

function privateKey() {
  const b64 = process.env.WX_PRIVATE_KEY_B64;
  if (b64) {
    try {
      const s = Buffer.from(b64, 'base64').toString('utf8');
      if (s.includes('PRIVATE KEY')) return s;
    } catch (e) { /* 落到本地文件 */ }
  }
  const p = path.join(__dirname, '..', 'certs', 'apiclient_key.pem');
  try { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8'); } catch (e) { /* ignore */ }
  return '';
}

function isConfigured() {
  const c = cfg();
  return !!(c.mchId && c.appId && c.serial && privateKey());
}

function status() {
  const c = cfg();
  return {
    configured: isConfigured(),
    notifyReady: !!c.apiV3,
    hasMchId: !!c.mchId,
    hasSerial: !!c.serial,
    hasKey: !!privateKey(),
    hasApiV3: !!c.apiV3,
    notifyUrl: c.notifyUrl
  };
}

// ==================== 签名 ====================
function rsaSign(message) {
  const s = crypto.createSign('RSA-SHA256');
  s.update(message, 'utf8');
  return s.sign(privateKey(), 'base64');
}

// 注意：签名串里的 URL 必须带 query，否则微信返回 401 签名错误
function authHeader(method, urlPath, body) {
  const c = cfg();
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const msg = method + '\n' + urlPath + '\n' + ts + '\n' + nonce + '\n' + (body || '') + '\n';
  const sig = rsaSign(msg);
  return 'WECHATPAY2-SHA256-RSA2048 mchid="' + c.mchId +
    '",nonce_str="' + nonce +
    '",signature="' + sig +
    '",timestamp="' + ts +
    '",serial_no="' + c.serial + '"';
}

async function wxApi(method, urlPath, bodyObj) {
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const r = await fetch('https://api.mch.weixin.qq.com' + urlPath, {
    method: method,
    headers: {
      Authorization: authHeader(method, urlPath, body),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'room-mini/1.0'
    },
    body: method === 'GET' ? undefined : body
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j };
}

// ==================== 本地存储（订单 / 额度）====================
// 说明：Render 免费实例无持久盘，重新部署会丢。等接上 Postgres 只需改这两个函数。
// 存储统一走 store.js：Upstash Redis 优先，未配置时回落本地文件。
// ⚠️ Render 免费实例没有持久磁盘，必须配 UPSTASH_* 否则每次部署都会丢额度。
const store = require('./store.js');

const GIFT_LIMIT = 100;   // 前 100 个用户首单赠送 1 张（老板 2026-10-23 定），超过自动停
const GIFT_COUNT = 1;

const K_Q = id => 'quota:' + id;
const K_O = no => 'order:' + no;
const K_GIFT = id => 'gift:' + id;
const K_OIDX = 'orders:index';
const K_GIFTC = 'gift:count';

async function saveOrder(o) { await store.set(K_O(o.outTradeNo), JSON.stringify(o)); }

async function getOrder(no) {
  const raw = await store.get(K_O(no));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function indexOrder(no) { await store.push(K_OIDX, no); }

async function listOrders(limit) {
  const nos = await store.list(K_OIDX, limit || 50);
  const out = [];
  for (const no of nos) {
    const o = await getOrder(no);
    if (o) out.push(o);
  }
  return out;
}

async function getBalance(openid) {
  if (!openid) return 0;
  return await store.getNum(K_Q(openid));
}

async function addQuota(openid, n) {
  const add = Math.max(0, Math.round(Number(n) || 0));
  if (!openid || !add) return await getBalance(openid);
  return await store.incrBy(K_Q(openid), add);
}

// 原子扣减：先 DECRBY，减成负数再补回，避免并发多扣
async function consumeQuota(openid, n) {
  const used = Math.max(1, Math.round(Number(n) || 1));
  if (!openid) return { ok: false, balance: 0, error: '缺少 openid' };
  const left = await store.incrBy(K_Q(openid), -used);
  if (left < 0) {
    await store.incrBy(K_Q(openid), used);
    return { ok: false, balance: left + used, error: '额度不足' };
  }
  return { ok: true, balance: left };
}

// 生成失败 / 网络异常时返还
async function refundQuota(openid, n) {
  return await addQuota(openid, n);
}

// 首单赠送：每个 openid 永久一次；累计赠送人数到 GIFT_LIMIT 自动停止
async function claimGift(openid) {
  if (!openid) return { given: 0, reason: 'no-openid' };
  const cnt = await store.getNum(K_GIFTC);
  if (cnt >= GIFT_LIMIT) return { given: 0, reason: 'limit-reached' };
  const first = await store.setnx(K_GIFT(openid), String(Date.now()));
  if (!first) return { given: 0, reason: 'already-claimed' };
  await store.incr(K_GIFTC);
  const balance = await addQuota(openid, GIFT_COUNT);
  return { given: GIFT_COUNT, balance: balance };
}

// 对账：扫最近订单，向微信查真实状态；SUCCESS 但没入账的补上额度
// 作用：回调因实例休眠/网络问题没到，客户付了钱也不会白付
async function reconcile(limit) {
  const nos = await store.list(K_OIDX, limit || 30);
  const result = { checked: 0, fixed: 0, items: [] };
  for (const no of nos) {
    const o = await getOrder(no);
    if (!o || o.status === 'paid') continue;
    result.checked++;
    try {
      const q = await queryOrder(no);
      if (q && q.trade_state === 'SUCCESS') {
        const openid = (q.payer && q.payer.openid) || o.openid;
        const count = Number(o.count) || 0;
        if (count > 0) await addQuota(openid, count);
        o.status = 'paid';
        o.paidAt = Date.now();
        o.transactionId = q.transaction_id || '';
        o.openid = openid;
        await saveOrder(o);
        result.fixed++;
        result.items.push({ outTradeNo: no, count: count, openid: openid });
      }
    } catch (e) {
      result.items.push({ outTradeNo: no, error: String((e && e.message) || e) });
    }
  }
  return result;
}

// ==================== 下单 ====================
async function getOpenid(code) {
  const c = cfg();
  if (!c.appSecret) throw new Error('未配置 WX_APP_SECRET，无法换取 openid');
  const u = 'https://api.weixin.qq.com/sns/jscode2session?appid=' + c.appId +
    '&secret=' + c.appSecret + '&js_code=' + encodeURIComponent(code) + '&grant_type=authorization_code';
  const r = await fetch(u);
  const j = await r.json().catch(() => ({}));
  if (!j.openid) throw new Error('获取 openid 失败：' + (j.errmsg || JSON.stringify(j)));
  return j.openid;
}

function genOutTradeNo() {
  const t = Date.now().toString();
  const r = Math.floor(Math.random() * 900000 + 100000).toString();
  return 'RM' + t + r;   // 20 位，符合微信 ≤32 位要求
}

async function createJsapiOrder(opts) {
  const c = cfg();
  if (!isConfigured()) throw new Error('微信支付未配置完整（缺商户号/证书序列号/私钥）');
  if (!c.notifyUrl) throw new Error('缺少 WX_NOTIFY_URL（微信要求必须传回调地址）');

  const openid = opts.openid || await getOpenid(opts.code);
  const amount = Math.round(Number(opts.amount) || 0);
  if (!(amount > 0)) throw new Error('金额必须大于 0');

  const count = Math.round(Number(opts.count) || 0);
  const outTradeNo = genOutTradeNo();
  const desc = (opts.desc || '装修效果图生成').slice(0, 120);

  const body = {
    appid: c.appId,
    mchid: c.mchId,
    description: desc,
    out_trade_no: outTradeNo,
    notify_url: c.notifyUrl,
    amount: { total: amount, currency: 'CNY' },
    payer: { openid: openid },
    attach: JSON.stringify({ kind: 'render_pack', count: count, openid: openid })
  };

  const { status: httpStatus, data } = await wxApi('POST', '/v3/pay/transactions/jsapi', body);
  if (!data.prepay_id) {
    throw new Error('下单失败：' + (data.message || data.code || ('HTTP ' + httpStatus)));
  }

  await saveOrder({
    outTradeNo: outTradeNo,
    openid: openid,
    amount: amount,
    count: count,
    desc: desc,
    status: 'pending',
    createdAt: Date.now()
  });
  await indexOrder(outTradeNo);   // 进对账索引：回调丢了也能靠这个救回来

  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const pkg = 'prepay_id=' + data.prepay_id;
  // JSAPI 二次签名：四行，每行都以 \n 结尾（最后一行也要）
  const paySign = rsaSign(c.appId + '\n' + timeStamp + '\n' + nonceStr + '\n' + pkg + '\n');

  return {
    timeStamp: timeStamp,
    nonceStr: nonceStr,
    package: pkg,
    signType: 'RSA',
    paySign: paySign,
    outTradeNo: outTradeNo
  };
}

// ==================== 查单 ====================
async function queryOrder(outTradeNo) {
  const c = cfg();
  const p = '/v3/pay/transactions/out-trade-no/' + encodeURIComponent(outTradeNo) + '?mchid=' + c.mchId;
  const { status: httpStatus, data } = await wxApi('GET', p);
  if (httpStatus >= 400 && !data.trade_state) {
    throw new Error('查单失败：' + (data.message || ('HTTP ' + httpStatus)));
  }
  return data;
}

// ==================== 回调 ====================
function decryptResource(resource) {
  const key = cfg().apiV3;
  if (!key || key.length !== 32) throw new Error('WX_API_V3_KEY 缺失或长度不是 32 位');
  const buf = Buffer.from(resource.ciphertext, 'base64');
  const authTag = buf.subarray(buf.length - 16);
  const payload = buf.subarray(0, buf.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'utf8'), Buffer.from(resource.nonce, 'utf8'));
  d.setAuthTag(authTag);
  if (resource.associated_data) d.setAAD(Buffer.from(resource.associated_data, 'utf8'));
  const out = Buffer.concat([d.update(payload), d.final()]).toString('utf8');
  return JSON.parse(out);
}

// 只信任微信侧订单状态：解密 → 拿单号 → 反向查单 → 入账
async function handleNotify(rawBody) {
  let evt;
  try {
    evt = JSON.parse(rawBody || '{}');
  } catch (e) {
    throw new Error('回调 JSON 解析失败');
  }
  if (!evt.resource) throw new Error('回调缺少 resource');
  if (evt.event_type && evt.event_type !== 'TRANSACTION.SUCCESS') {
    return { ok: true, ignored: true, event: evt.event_type };
  }

  const info = decryptResource(evt.resource);
  const outTradeNo = info.out_trade_no;
  if (!outTradeNo) throw new Error('回调缺少 out_trade_no');

  const q = await queryOrder(outTradeNo);
  if (q.trade_state !== 'SUCCESS') {
    return { ok: true, ignored: true, state: q.trade_state || 'UNKNOWN' };
  }

  const order = await getOrder(outTradeNo);
  if (order && order.status === 'paid') {
    return { ok: true, duplicate: true, outTradeNo: outTradeNo };
  }

  let count = order ? order.count : 0;
  if (!count && info.attach) {
    try { count = Math.round(Number(JSON.parse(info.attach).count) || 0); } catch (e) { count = 0; }
  }
  const openid = (q.payer && q.payer.openid) || (order && order.openid) || '';
  const paidAmount = (q.amount && q.amount.total) || (order && order.amount) || 0;

  if (count > 0 && openid) await addQuota(openid, count);

  await saveOrder({
    outTradeNo: outTradeNo,
    openid: openid,
    amount: paidAmount,
    count: count,
    desc: (order && order.desc) || '效果图套餐',
    status: 'paid',
    createdAt: (order && order.createdAt) || Date.now(),
    paidAt: Date.now(),
    transactionId: q.transaction_id || ''
  });
  if (!order) await indexOrder(outTradeNo);   // 回调先于下单记录（极端情况）也要能对账

  return { ok: true, outTradeNo: outTradeNo, count: count, balance: await getBalance(openid) };
}

module.exports = {
  isConfigured,
  status,
  getOpenid,
  createJsapiOrder,
  queryOrder,
  handleNotify,
  getBalance,
  addQuota,
  consumeQuota,
  refundQuota,
  claimGift,
  reconcile,
  listOrders,
  getOrder,
  GIFT_LIMIT
};
