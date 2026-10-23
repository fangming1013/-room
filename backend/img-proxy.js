/*
 * 硅基流动 AI 生图代理（零依赖 Node，key 仅存服务端）
 * -------------------------------------------------------------
 * 用途：小程序「快速模式 AI 生图」走本代理，key 不进小程序安装包，
 *       避免反编译被盗刷余额。
 * 启动： SILICONFLOW_API_KEY=sk-xxx node img-proxy.js
 *        （端口可用 PORT 覆盖，默认 3000）
 * 公众平台：开发管理 → 服务器域名 → request 合法域名 加本服务 https 域名
 *
 * 接口：
 *   GET  /api/health            健康检查
 *   POST /api/gen-image         { model, prompt, image, size, n }
 *                                 -> { ok, imageUrl, images, raw }
 *        model 默认 Kwai-Kolors/Kolors（文生图）
 *        image 传 base64 或 url 即走图生图（参考图风格迁移）
 * -------------------------------------------------------------
 */
const http = require('http');
const crypto = require('crypto');
const wxpay = require('./wxpay.js');

const PORT = process.env.PORT || 3000;
const KEY = process.env.SILICONFLOW_API_KEY || '';
const API = 'https://api.siliconflow.cn/v1/images/generations';
const DEFAULT_MODEL = 'Kwai-Kolors/Kolors';

// ===== 豆包 / 火山方舟（ARK）=====
const ARK_KEY = process.env.ARK_API_KEY || process.env.DOUBAO_API_KEY || '';
const ARK_API = process.env.ARK_API || 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const ARK_DEFAULT_MODEL = 'doubao-seedream-5-0-pro-260628';
function isArkModel(m) { return /^doubao-/i.test(m || ''); }

// 豆包图生图：返回 { ok, imageUrl, images, raw }
async function arkGenImage(p) {
  const body = {
    model: p.model || ARK_DEFAULT_MODEL,
    prompt: p.prompt || '',
    size: p.size || '1.5K',            // 1.5K 与 1K 同价（0.30 元/张），2K 翻倍到 0.60
    response_format: 'url',
    watermark: false                   // 关闭"AI生成"水印
  };
  if (p.image) body.image = [p.image]; // 支持 URL 或 data:image/jpeg;base64,…（须小写）
  const r = await fetch(ARK_API, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + ARK_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (j.error) return { code: r.status || 502, obj: { ok: false, error: j.error.message || JSON.stringify(j.error), raw: j } };
  const arr = (j.data || []).map(x => ({ url: x.url, b64: x.b64_json }));
  const imageUrl = arr[0] && (arr[0].url || arr[0].b64) ? (arr[0].url || ('data:image/jpeg;base64,' + arr[0].b64)) : null;
  return { code: 200, obj: { ok: true, imageUrl, images: arr, raw: j } };
}

function send(res, code, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.statusCode = code;
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.url === '/api/health') return send(res, 200, {
    ok: true, hasKey: !!KEY, hasArkKey: !!ARK_KEY, arkModel: ARK_DEFAULT_MODEL,
    storage: require('./store.js').status(),
    wxpay: wxpay.status()
  });

  if (req.url === '/api/gen-image' && req.method === 'POST') {
    let buf = '';
    try { for await (const c of req) buf += c; } catch (e) { return send(res, 400, { ok: false, error: '读取请求失败' }); }
    let p;
    try { p = JSON.parse(buf || '{}'); } catch (e) { return send(res, 400, { ok: false, error: 'JSON 解析失败' }); }

    // ===== 豆包（火山方舟）路由：模型名以 doubao- 开头 =====
    if (isArkModel(p.model)) {
      if (!ARK_KEY) return send(res, 500, { ok: false, error: '代理未配置 ARK_API_KEY（火山方舟控制台创建）' });
      if (!p.prompt && !p.image) return send(res, 400, { ok: false, error: '需要 prompt 或参考图 image' });
      try {
        const out = await arkGenImage(p);
        return send(res, out.code, out.obj);
      } catch (e) {
        return send(res, 500, { ok: false, error: String(e && e.message || e) });
      }
    }

    if (!KEY) return send(res, 500, { ok: false, error: '代理未配置 SILICONFLOW_API_KEY' });
    if (!p.prompt && !p.image) return send(res, 400, { ok: false, error: '需要 prompt 或参考图 image' });

    const body = {
      model: p.model || DEFAULT_MODEL,
      prompt: p.prompt || '',
      n: p.n || 1,
      size: (p.size && /^\d{3,4}x\d{3,4}$/.test(p.size)) ? p.size : '1024x1024',
      watermark: false   // 关闭硅基流动服务端"AI生成"水印（默认会加）
    };
    if (p.image) { body.image = p.image; if (/^data:/i.test(p.image)) body.image_base64 = p.image; body.input_image = p.image; }  // 图生图：兼容 image/image_base64；Kontext 系列需 input_image 字段

    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const j = await r.json().catch(() => ({}));
      // 归一化取图：兼容 images[] / data.images[] / data.image_url
      const arr = (j.images || (j.data && j.data.images) || []);
      const imageUrl = arr[0] && (arr[0].url || arr[0].b64) ? (arr[0].url || arr[0].b64) : (j.data && j.data.image_url) || null;
      if (j.code && j.code !== 20000) return send(res, 502, { ok: false, error: j.message || ('上游错误 ' + j.code), raw: j });
      return send(res, 200, { ok: true, imageUrl, images: arr, raw: j });
    } catch (e) {
      return send(res, 500, { ok: false, error: String(e && e.message || e) });
    }
  }

  if (req.url === '/api/lead' && req.method === 'POST') {
    let buf = '';
    try { for await (const c of req) buf += c; } catch (e) { return send(res, 400, { ok: false, error: '读取请求失败' }); }
    let p;
    try { p = JSON.parse(buf || '{}'); } catch (e) { return send(res, 400, { ok: false, error: 'JSON 解析失败' }); }
    if (!p.phoneCode) return send(res, 400, { ok: false, error: '缺少 phoneCode（需走手机号快速验证组件）' });
    if (!process.env.WX_APP_ID || !process.env.WX_APP_SECRET) {
      return send(res, 500, { ok: false, error: '后端未配置 WX_APP_ID / WX_APP_SECRET，无法换取手机号' });
    }
    try {
      const info = await getPhoneByCode(p.phoneCode);
      return send(res, 200, {
        ok: true,
        phone: info.purePhoneNumber || '',
        countryCode: info.countryCode || '86'
      });
    } catch (e) {
      return send(res, 502, { ok: false, error: String(e && e.message || e) });
    }
  }

  // ===================== 微信支付 / 额度（v3 模块化实现）=====================
  const _u = new URL(req.url, 'http://localhost');

  // 登录换 openid：额度与订单都挂在 openid 上
  if (_u.pathname === '/api/login' && req.method === 'POST') {
    let buf = '';
    try { for await (const c of req) buf += c; } catch (e) { return send(res, 400, { ok: false, error: '读取请求失败' }); }
    let p;
    try { p = JSON.parse(buf || '{}'); } catch (e) { return send(res, 400, { ok: false, error: 'JSON 解析失败' }); }
    if (!p.code) return send(res, 400, { ok: false, error: '缺少 code' });
    try {
      const openid = await wxpay.getOpenid(p.code);
      // 首单赠送：每个 openid 永久 1 张，累计 100 人后自动停止
      let gift = { given: 0, reason: '' };
      try { gift = await wxpay.claimGift(openid); } catch (e) { console.error('[gift]', e && e.message); }
      const balance = await wxpay.getBalance(openid);
      return send(res, 200, { ok: true, openid: openid, balance: balance, gift: gift.given || 0 });
    } catch (e) { return send(res, 502, { ok: false, error: String(e && e.message || e) }); }
  }

  // 查余额
  if (_u.pathname === '/api/quota' && req.method === 'GET') {
    const openid = _u.searchParams.get('openid') || '';
    if (!openid) return send(res, 400, { ok: false, error: '缺少 openid' });
    try {
      return send(res, 200, { ok: true, balance: await wxpay.getBalance(openid) });
    } catch (e) { return send(res, 502, { ok: false, error: String(e && e.message || e) }); }
  }

  // 扣额度（生成前）/ 返还（生成失败）
  if ((_u.pathname === '/api/quota/consume' || _u.pathname === '/api/quota/refund') && req.method === 'POST') {
    let buf = '';
    try { for await (const c of req) buf += c; } catch (e) { return send(res, 400, { ok: false, error: '读取请求失败' }); }
    let p;
    try { p = JSON.parse(buf || '{}'); } catch (e) { return send(res, 400, { ok: false, error: 'JSON 解析失败' }); }
    if (!p.openid) return send(res, 400, { ok: false, error: '缺少 openid' });
    const n = Math.max(1, Math.round(Number(p.n) || 1));
    try {
      if (_u.pathname === '/api/quota/refund') {
        return send(res, 200, { ok: true, balance: await wxpay.refundQuota(p.openid, n) });
      }
      const r = await wxpay.consumeQuota(p.openid, n);
      return send(res, r.ok ? 200 : 402, r);
    } catch (e) { return send(res, 502, { ok: false, error: String(e && e.message || e) }); }
  }

  // 下单：返回 wx.requestPayment 所需参数
  if (_u.pathname === '/api/wxpay-order' && req.method === 'POST') {
    let buf = '';
    try { for await (const c of req) buf += c; } catch (e) { return send(res, 400, { ok: false, error: '读取请求失败' }); }
    let p;
    try { p = JSON.parse(buf || '{}'); } catch (e) { return send(res, 400, { ok: false, error: 'JSON 解析失败' }); }
    if (!wxpay.isConfigured()) {
      return send(res, 500, { ok: false, error: '支付未配置：' + JSON.stringify(wxpay.status()) });
    }
    try {
      const payArgs = await wxpay.createJsapiOrder({
        code: p.code, openid: p.openid, amount: p.amount, count: p.count, desc: p.desc
      });
      return send(res, 200, { ok: true, payArgs: payArgs, outTradeNo: payArgs.outTradeNo });
    } catch (e) { return send(res, 500, { ok: false, error: String(e && e.message || e) }); }
  }

  // 支付回调：微信服务器 POST，必须返回 200 + {code:"SUCCESS"}，否则微信会重试
  if (_u.pathname === '/api/wxpay-notify' && req.method === 'POST') {
    let buf = '';
    try { for await (const c of req) buf += c; } catch (e) { /* ignore */ }
    try {
      const r = await wxpay.handleNotify(buf);
      console.log('[wxpay] notify', JSON.stringify(r));
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ code: 'SUCCESS', message: '成功' }));
    } catch (e) {
      console.error('[wxpay] notify 处理失败：', e && e.message);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ code: 'FAIL', message: String(e && e.message || e) }));
    }
  }

  // 订单列表（对账用，口令保护）
  if (_u.pathname === '/api/orders' && req.method === 'GET') {
    const key = _u.searchParams.get('key') || '';
    if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) return send(res, 401, { ok: false, error: '口令不对' });
    try {
      return send(res, 200, { ok: true, orders: await wxpay.listOrders(100) });
    } catch (e) { return send(res, 502, { ok: false, error: String(e && e.message || e) }); }
  }

  // 对账：扫未入账订单，向微信核实并补额度（回调丢了/实例休眠时用）
  if (_u.pathname === '/api/wxpay-sync') {
    const key = _u.searchParams.get('key') || '';
    if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) return send(res, 401, { ok: false, error: '口令不对' });
    try {
      const r = await wxpay.reconcile(30);
      console.log('[wxpay] reconcile', JSON.stringify(r));
      return send(res, 200, Object.assign({ ok: true }, r));
    } catch (e) { return send(res, 500, { ok: false, error: String(e && e.message || e) }); }
  }

  send(res, 404, { ok: false, error: 'not found' });
});

// （微信支付相关实现已抽到 wxpay.js，此处不再保留旧版签名逻辑）

// ===== 手机号快速验证（客资留资）=====
// access_token 有效期 7200s，缓存并提前 5 分钟失效，避免频繁请求被限流
let _tkCache = { token: '', exp: 0 };
async function getAccessToken() {
  const now = Date.now();
  if (_tkCache.token && now < _tkCache.exp) return _tkCache.token;
  const url = 'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' + process.env.WX_APP_ID + '&secret=' + process.env.WX_APP_SECRET;
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error('获取 access_token 失败：' + (j.errmsg || JSON.stringify(j)));
  _tkCache = { token: j.access_token, exp: now + Math.max(60, (j.expires_in || 7200) - 300) * 1000 };
  return j.access_token;
}
async function getPhoneByCode(code) {
  const tk = await getAccessToken();
  const r = await fetch('https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=' + tk, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
  const j = await r.json().catch(() => ({}));
  if (!j.phone_info) throw new Error('换取手机号失败：' + (j.errmsg || ('errcode ' + (j.errcode || ''))));
  return j.phone_info;
}

server.listen(PORT, () => console.log('[img-proxy] listening on ' + PORT + (KEY ? ' (key ok)' : ' (NO KEY!)') + (wxpay.isConfigured() ? ' (wxpay ok)' : ' (wxpay NOT configured)')));
