// 效果图生成客户端
// =====================================================================
// 支持两条通道（自动选择，不用改代码）：
//   ① 豆包 / 火山方舟直连：模型名以 doubao- 开头 且 后台填了 API Key → 直连 ARK
//      地址：https://ark.cn-beijing.volces.com/api/v3/images/generations
//      Key 只存在本机 storage（后台「生图 API」填写），测试期用；正式上线前应收归服务端代理。
//   ② 自有代理（Render）：其余情况走 PROXY_BASE/api/gen-image，key 不进安装包
//
// 小程序后台必须把 https://ark.cn-beijing.volces.com 加进 request 合法域名；
// 开发/体验版可在开发者工具勾「不校验合法域名」临时绕过。
// =====================================================================
const PROXY_BASE = 'https://room-rchx.onrender.com';

// 豆包（火山方舟）
const ARK_URL = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const DEFAULT_MODEL = 'doubao-seedream-5-0-pro-260628';   // 豆包 Seedream 5.0 pro（1K/2K，图像生成+编辑）
// 1.5K：豆包 Seedream 5.0 pro 计费分两档（≤261万像素 0.30 元 / 以上 0.60 元），
// 1K 与 1.5K 同价 0.30，所以取画质更好的 1.5K；2K 会翻倍到 0.60 且手机上看不出差别。
const DEFAULT_SIZE = '1.5K';

// 效果图付费开关（老板定：6.99/5 张、9.9/10 张，无免费额度）
// 2026-10-21 商户号已开通、后端支付接口已就绪 → 默认打开
// 开关优先级：后台配置(storage: pay_cfg.enabled) > 下面的常量
const PAY_ENABLED = true;
const PAY_AMOUNT = 699;   // 兼容旧调用（单位：分）

// 运行时判断：后台可开关，后台没配就用常量
function payEnabled() {
  try {
    const c = wx.getStorageSync('pay_cfg') || {};
    if (c.enabled != null) return !!c.enabled;
  } catch (e) {}
  return PAY_ENABLED;
}

function isArkModel(m) { return /^doubao-/i.test(m || ''); }

// 从 ARK 响应里取图：兼容 url / b64_json
function pickArkImage(d) {
  const a = (d && d.data && d.data[0]) || null;
  if (!a) return null;
  if (a.url) return a.url;
  if (a.b64_json) return 'data:image/jpeg;base64,' + a.b64_json;
  return null;
}

// 安全：包内不内置任何 Key，效果图统一走后端代理（服务端环境变量 ARK_API_KEY）

// opts: { model?, prompt, imageBase64?, size? }  -> Promise<imageUrl>
function genImage(opts) {
  return new Promise((resolve, reject) => {
    let apiCfg = {};
    try { apiCfg = wx.getStorageSync('render_api_cfg') || {}; } catch (e) {}
    let model = ((opts.model || apiCfg.model || DEFAULT_MODEL) + '').trim();
    let key = ((apiCfg.apiKey || '') + '').trim();
    const customEp = ((apiCfg.endpoint || '') + '').trim();

    // Key 必须是 ark- 开头的服务端 Key；格式不对（如误填"密钥名称"）当作没填，走代理
    if (!/^ark-/i.test(key)) key = '';
    // 有 Key 就统一走豆包：后台若残留非豆包模型（如旧的 wan2.6-image）也纠正回默认模型
    if (key && !isArkModel(model)) model = DEFAULT_MODEL;

    // 只有明确填了 http:// 开头的自建/内网后端（本地调试）才走代理；其余一律直连方舟
    const useProxy = !!customEp && /^http:\/\//i.test(customEp);

    // ---------- ① 豆包直连 ----------
    if (isArkModel(model) && key && !useProxy) {
      const body = {
        model: model,
        prompt: opts.prompt || '',
        size: opts.size || DEFAULT_SIZE,
        response_format: 'url',
        watermark: false          // 关掉右下角"AI生成"水印
      };
      if (opts.imageBase64) body.image = [opts.imageBase64];   // 图生图：base64 必须是 data:image/jpeg;base64, 小写
      wx.request({
        url: ARK_URL,
        method: 'POST',
        timeout: 180000,
        header: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        // 手动序列化：body 里带大段 base64 时，交给 wx 自动序列化偶发会坏（服务端报 could not parse JSON body）
        data: JSON.stringify(body),
        success(res) {
          const d = res.data || {};
          const url = pickArkImage(d);
          if (url) { resolve(url); return; }
          const code = d.error && d.error.code ? ('[' + d.error.code + '] ') : '';
          const em = (d.error && d.error.message) || d.message || '豆包未返回图片';
          reject(new Error(code + em + '（HTTP ' + (res.statusCode || '') + '｜模型 ' + model + '）'));
        },
        fail(err) {
          const raw = err.errMsg || '网络请求失败';
          // 把最常见的域名问题翻译成人话
          if (/domain list|not in domain|不合法/i.test(raw)) {
            reject(new Error('域名未配置：小程序后台 → 开发管理 → 服务器域名 → request 合法域名，添加 https://ark.cn-beijing.volces.com（开发者工具可勾「不校验合法域名」临时绕过）'));
            return;
          }
          reject(new Error(raw + '｜模型 ' + model));
        }
      });
      return;
    }

    // ---------- ② 自有代理 ----------
    // 没有本地 Key（正常情况：Key 只在服务端）→ 走代理，由服务端注入 ARK_API_KEY
    const base = customEp || PROXY_BASE;
    if (!base) { reject(new Error('未配置图像代理地址')); return; }
    wx.request({
      url: base + '/api/gen-image',
      method: 'POST',
      timeout: 180000,
      header: { 'Content-Type': 'application/json' },
      data: {
        model: model,
        prompt: opts.prompt || '',
        size: opts.size || DEFAULT_SIZE,
        image: opts.imageBase64 || undefined
      },
      success(res) {
        const d = res.data || {};
        if (d.ok && d.imageUrl) resolve(d.imageUrl);
        else reject(new Error(d.error || ('生成失败(' + (res.statusCode || '') + ')')));
      },
      fail(err) { reject(new Error(err.errMsg || '网络请求失败')); }
    });
  });
}

// 统一下单：返回 wx.requestPayment 所需参数（金额单位：分）
// 后端 /api/wxpay-order 用商户私钥签名，key 只在服务端
function createPayOrder(opts) {
  return new Promise((resolve, reject) => {
    if (!opts || !opts.amount) { reject(new Error('金额缺失')); return; }
    wx.login({
      success: lr => {
        if (!lr.code) { reject(new Error('获取登录凭证失败')); return; }
        wx.request({
          url: PROXY_BASE + '/api/wxpay-order',
          method: 'POST',
          timeout: 20000,
          header: { 'Content-Type': 'application/json' },
          data: { code: lr.code, amount: opts.amount, count: opts.count || 0, desc: opts.desc || '装修服务' },
          success: r => {
            const d = r.data || {};
            if (d.ok && d.payArgs) resolve(d.payArgs);
            else reject(new Error(d.error || '下单失败'));
          },
          fail: e => reject(new Error(e.errMsg || '网络异常'))
        });
      },
      fail: () => reject(new Error('微信登录失败'))
    });
  });
}

module.exports = { genImage, createPayOrder, PROXY_BASE, PAY_ENABLED, PAY_AMOUNT, DEFAULT_MODEL, payEnabled };
