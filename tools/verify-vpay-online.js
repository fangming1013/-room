// 线上虚拟支付配置自检（不用真机、不用真付钱）
// 判定逻辑：
//   /api/vpay-order 返回 501          → 服务器还没读到 AppKey
//   返回 500 且报 code 无效           → 配置已读到（差真机付一笔）
//   返回 200                          → 完全通了
// 跑法：node tools/verify-vpay-online.js
const BASE = 'https://room-rchx.onrender.com';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

(async () => {
  console.log('\n=== 1. 服务健康 ===');
  const h = await (await fetch(BASE + '/api/health')).json();
  ok('服务在线', h.ok === true);
  ok('存储是 Upstash（重启不丢额度）', h.storage && h.storage.backend === 'upstash');
  ok('小程序 AppSecret 已配', h.vpay && h.vpay.appSecretSet === true);
  ok('OfferID 已读到 1450694692', h.vpay && h.vpay.offerId === '1450694692', h.vpay && h.vpay.offerId);
  ok('道具表已注册 render_5 / render_10',
    h.vpay && (h.vpay.products || []).join(',') === 'render_5,render_10',
    h.vpay && (h.vpay.products || []).join(','));

  console.log('\n=== 2. AppKey 是否已生效 ===');
  const r = await fetch(BASE + '/api/vpay-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'fake_code_for_selftest', productId: 'render_5' })
  });
  const d = await r.json().catch(() => ({}));
  const configured = h.vpay && h.vpay.configured === true;
  ok('配置标记 configured = true', configured, '当前 ' + configured);

  if (r.status === 501) {
    console.log('  ! 下单仍返回 501：服务器没读到 AppKey，去 Render 加 VPAY_APP_KEY');
  } else if (r.status === 500 && /session_key|code/i.test(String(d.error || ''))) {
    console.log('  ✓ 已越过配置检查，卡在"假 code 换不到 session_key"——这是**正确**状态');
    pass++;
    console.log('  ✓ 说明 AppKey 已生效，可以真机付一笔了');
  } else if (r.status === 200) {
    console.log('  ✓ 竟然返回 200，接口全通');
    pass++;
  } else {
    console.log('  ! 意外返回 ' + r.status + '：' + JSON.stringify(d).slice(0, 200));
  }

  console.log('\n=== 3. 发货推送地址可达 ===');
  const g = await fetch(BASE + '/api/vpay-notify?echostr=ping12345');
  const txt = await g.text();
  ok('GET 握手回显正确（后台保存推送 URL 靠这个）', g.status === 200 && txt === 'ping12345', g.status + ' ' + txt);

  console.log('\n=== 4. 订单查询接口 ===');
  const s = await fetch(BASE + '/api/vpay-status?no=VP_not_exist');
  ok('未知订单返回 404（不是 500）', s.status === 404, String(s.status));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  if (fail) {
    console.log('\n还有 ' + fail + ' 项没过，先别真机测。');
    process.exit(1);
  }
  console.log('\n配置侧全部通过。下一步：真机点「6.99 元 / 5 张」，看能不能弹出收银台。');
})().catch(e => { console.error('请求失败：', e && e.message); process.exit(1); });
