// 虚拟支付自测：不联网、不需要真实 OfferID/AppKey，验证「签名对不对、会不会多收钱」
// 跑法：node tools/test-vpay.js
const crypto = require('crypto');

process.env.VPAY_APP_KEY = 'test_appkey_123456';
process.env.WX_APP_SECRET = 'test_secret';

// mock code2Session：真实调用要 appSecret，这里只验证签名与金额逻辑
global.fetch = async () => ({
  json: async () => ({ openid: 'o_test_user', session_key: 'sk_test_session' })
});

const vpay = require('../backend/vpay.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, String(a) === String(b), '实际=' + a + ' 期望=' + b); }
function hmac(key, data) {
  return crypto.createHmac('sha256', String(key)).update(String(data), 'utf8').digest('hex');
}

(async () => {
  console.log('\n=== 1. 下单参数（最怕多收钱） ===');
  const o5 = await vpay.createOrder({ code: 'c1', productId: 'render_5' });
  const sd5 = JSON.parse(o5.payParams.signData);
  eq('5 张套餐 · 道具单价 699 分', sd5.goodsPrice, 699);
  eq('5 张套餐 · 购买份数 1（不是 5）', sd5.buyQuantity, 1);
  eq('总价 = 6.99 元', sd5.goodsPrice * sd5.buyQuantity, 699);
  eq('OfferID 正确', sd5.offerId, '1450694692');
  eq('道具 ID 正确', sd5.productId, 'render_5');
  eq('币种 CNY', sd5.currencyType, 'CNY');
  eq('环境 现网 0', sd5.env, 0);
  ok('业务单号长度 8~32', sd5.outTradeNo.length >= 8 && sd5.outTradeNo.length <= 32, sd5.outTradeNo);
  ok('业务单号不以 _ 开头', sd5.outTradeNo.charAt(0) !== '_');
  ok('attach 非空（官方必填）', !!sd5.attach);

  const o10 = await vpay.createOrder({ code: 'c1', productId: 'render_10' });
  const sd10 = JSON.parse(o10.payParams.signData);
  eq('10 张套餐 · 990 分', sd10.goodsPrice, 990);
  eq('10 张套餐 · 份数 1', sd10.buyQuantity, 1);
  eq('总价 = 9.9 元', sd10.goodsPrice * sd10.buyQuantity, 990);
  eq('发货张数由服务端定 5', o5.count, 5);
  eq('发货张数由服务端定 10', o10.count, 10);

  console.log('\n=== 2. 客户端改价无效 ===');
  const hacked = await vpay.createOrder({ code: 'c1', productId: 'render_5', price: 1, count: 999 });
  eq('传 price=1 无效', JSON.parse(hacked.payParams.signData).goodsPrice, 699);
  eq('传 count=999 无效（份数仍 1）', JSON.parse(hacked.payParams.signData).buyQuantity, 1);
  eq('发货张数仍 5', hacked.count, 5);
  let threw = false;
  try { await vpay.createOrder({ code: 'c1', productId: 'render_999' }); } catch (e) { threw = true; }
  ok('未知道具直接拒绝', threw);

  console.log('\n=== 3. 签名算法 ===');
  eq('paySig = HMAC(AppKey, "requestVirtualPayment&"+signData)',
    o5.payParams.paySig, hmac('test_appkey_123456', 'requestVirtualPayment&' + o5.payParams.signData));
  eq('signature = HMAC(session_key, signData)',
    o5.payParams.signature, hmac('sk_test_session', o5.payParams.signData));
  ok('paySig 与 signature 不同（AppKey 和 session_key 没搞混）', o5.payParams.paySig !== o5.payParams.signature);
  eq('mode = 道具直购', o5.payParams.mode, 'short_series_goods');
  ok('响应里不含 session_key', !JSON.stringify(o5.payParams).includes('sk_test_session'));

  console.log('\n=== 4. 发货推送解析（XML / JSON） ===');
  const xml = '<xml><ToUserName>gh_x</ToUserName><Event>xpay_goods_deliver_notify</Event>'
    + '<OpenId>o_test_user</OpenId><OutTradeNo>VP123456</OutTradeNo><Env>0</Env>'
    + '<WeChatPayInfo><MchOrderNo>M2026</MchOrderNo><TransactionId>T1</TransactionId></WeChatPayInfo>'
    + '<GoodsInfo><ProductId>render_5</ProductId><Quantity>1</Quantity><ActualPrice>699</ActualPrice></GoodsInfo></xml>';
  const dx = vpay.parseNotify(xml);
  eq('XML · 事件', dx.Event, 'xpay_goods_deliver_notify');
  eq('XML · openid', dx.OpenId, 'o_test_user');
  eq('XML · 业务单号', dx.OutTradeNo, 'VP123456');
  eq('XML · 平台单号', dx.MchOrderNo, 'M2026');
  eq('XML · 道具', dx.ProductId, 'render_5');
  eq('XML · 实付', dx.ActualPrice, 699);
  ok('XML · 标记为 xml', dx.isXml === true);

  const json = '{"Event":"xpay_goods_deliver_notify","OpenId":"o_test_user","OutTradeNo":"VP9","GoodsInfo":{"ProductId":"render_5"}}';
  const dj = vpay.parseNotify(json);
  eq('JSON · 事件', dj.Event, 'xpay_goods_deliver_notify');
  ok('JSON · 不标记 xml', !dj.isXml);
  ok('非法内容返回 null', vpay.parseNotify('<html>404</html>') === null || vpay.parseNotify('<html>404</html>').Event === '');
  ok('空内容返回 null', vpay.parseNotify('') === null);

  console.log('\n=== 5. 应答格式（格式错会重推 15 次） ===');
  const rx = vpay.buildReply(true);
  ok('XML 请求 → XML 应答', /^<\?xml/.test(rx.body) && /<ErrCode>0<\/ErrCode>/.test(rx.body), rx.body);
  const rj = vpay.buildReply(false);
  ok('JSON 请求 → JSON 应答', JSON.parse(rj.body).ErrCode === 0, rj.body);

  console.log('\n=== 6. 推送 URL 校验 ===');
  const token = 'mytoken';
  const ts = '1730000000', nonce = 'abc123';
  const sign = crypto.createHash('sha1').update([token, ts, nonce].sort().join('')).digest('hex');
  ok('签名正确 → 通过', vpay.verifyUrlSign({ signature: sign, timestamp: ts, nonce }, token));
  ok('签名错误 → 拒绝', !vpay.verifyUrlSign({ signature: 'bad', timestamp: ts, nonce }, token));
  ok('未配 Token → 放行（靠订单号兜底）', vpay.verifyUrlSign({ signature: 'x' }, ''));

  console.log('\n=== 7. 状态上报 ===');
  process.env.VPAY_OFFER_ID = '';
  const st = vpay.status();
  ok('configured = true', st.configured === true);
  eq('默认 OfferID 已内置', st.offerId, '1450694692');
  ok('appKeySet = true', st.appKeySet === true);
  eq('两个道具都注册', st.products.join(','), 'render_5,render_10');

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('崩溃：', e); process.exit(1); });
