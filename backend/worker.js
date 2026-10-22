// Cloudflare Worker 版后端（免 GitHub，直接部署）
// 提供两个接口（与小程序调用路径一致）：
//   POST /v1/images/generations  → 代理硅基流动生图（图生图 / 文生图）
//   POST /api/wxpay-order        → 微信支付 JSAPI 下单（返回 payArgs）
// 部署：npx wrangler deploy  （需先设 CLOUDFLARE_API_TOKEN + 注册 workers.dev 子域）
// 免账号试跑：npx wrangler deploy --temporary （60 分钟有效，用于先验证生图）

const SF_BASE = 'https://api.siliconflow.cn';

function json(o, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

function b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function randStr(n) {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

// ---- 硅基流动生图代理 ----
async function handleImageGen(request, env) {
  if (!env.SILICONFLOW_API_KEY) {
    return json({ ok: false, error: 'SILICONFLOW_API_KEY 未配置（用 wrangler secret put 设置）' }, 500);
  }
  let body = '';
  try { body = await request.text(); } catch (e) { body = ''; }
  const r = await fetch(SF_BASE + '/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + env.SILICONFLOW_API_KEY
    },
    body
  });
  const txt = await r.text();
  return new Response(txt, {
    status: r.status,
    headers: {
      'Content-Type': r.headers.get('Content-Type') || 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// ---- 微信支付 JSAPI 下单 ----
async function importKey(pem) {
  const b64key = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(b64key), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
}
async function signRs256(key, str) {
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(str));
  return b64(sig);
}

async function handleWxOrder(request, env) {
  try {
    const { code, amount } = await request.json();
    if (!code) return json({ ok: false, error: '缺少 code' }, 400);

    // 1) code → openid
    const sessUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${env.WX_APP_ID}&secret=${env.WX_APP_SECRET}&js_code=${code}&grant_type=authorization_code`;
    const sess = await (await fetch(sessUrl)).json();
    if (!sess.openid) return json({ ok: false, error: 'openid 获取失败: ' + JSON.stringify(sess) }, 400);
    const openid = sess.openid;

    const key = await importKey(env.WX_PRIVATE_KEY);
    const mchid = env.WX_MCH_ID;
    const serial = env.WX_CERT_SERIAL;
    const method = 'POST';
    const urlPath = '/v3/pay/transactions/jsapi';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randStr(32);
    const outTradeNo = 'R' + Date.now() + randStr(6);

    const bodyJson = {
      appid: env.WX_APP_ID,
      mchid,
      description: '空间效果图生成',
      out_trade_no: outTradeNo,
      notify_url: env.WX_NOTIFY_URL || '',
      amount: { total: amount || 299, currency: 'CNY' },
      payer: { openid }
    };
    const bodyStr = JSON.stringify(bodyJson);
    const signStr = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${bodyStr}\n`;
    const signature = await signRs256(key, signStr);
    const auth = `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${serial}"`;

    const resp = await fetch('https://api.mch.weixin.qq.com' + urlPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': auth },
      body: bodyStr
    });
    const respJson = await resp.json();

    if (respJson.prepay_id) {
      const ts2 = Math.floor(Date.now() / 1000).toString();
      const nonce2 = randStr(32);
      const pkg = 'prepay_id=' + respJson.prepay_id;
      const paySign = await signRs256(key, `${env.WX_APP_ID}\n${ts2}\n${nonce2}\n${pkg}\n`);
      return json({
        ok: true,
        payArgs: { timeStamp: ts2, nonceStr: nonce2, package: pkg, signType: 'RSA', paySign },
        outTradeNo
      });
    }
    return json({ ok: false, error: '下单失败', detail: respJson }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/v1/images/generations') return handleImageGen(request, env);
    if (url.pathname === '/api/wxpay-order') return handleWxOrder(request, env);
    if (url.pathname === '/health') return json({ ok: true });
    return json({ ok: false, error: 'not found', paths: ['/v1/images/generations', '/api/wxpay-order'] }, 404);
  }
};
