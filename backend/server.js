/*
 * 材料商入驻后端（零依赖 Node，演示用）
 * -------------------------------------------------------------
 * 启动： node server.js   （默认端口 3000，可用 PORT 环境变量覆盖）
 * 数据： 同目录 data.json（suppliers + brands）
 *
 * 接口（小程序 brands.js 的 API_BASE 指向本服务即可对接）：
 *   GET  /api/health                  健康检查
 *   POST /api/supplier/register       { name, contact, phone } -> { supplierId }
 *   POST /api/supplier/brand          { supplierId, materialId, materialName, brand, tier, price }
 *                                      -> { ok, adFee, payUrl }   （按档位收广告费）
 *   GET  /api/brands?material=ID       列出该材料已上架品牌 -> { list:[...] }
 *
 * 后台 · 计算规则（导出 / 修改价格与档位）：
 *   POST /api/admin/login      { token }                      -> { ok, token }
 *   GET  /api/admin/config     返回完整规则(读 config.json)   -> { tiers, adFee, spaces }
 *   PUT  /api/admin/config     { tiers, adFee, spaces }       写回 config.json
 *
 * 广告费（元/月）：一线 800、二线 300、无品牌 0
 * 真实收费：在 brand 接口返回 payUrl（微信支付 JSAPI 下单），
 *          支付成功后置 status='on' 才对外可见；本演示直接置 on。
 * -------------------------------------------------------------
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data.json');
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const AD_FEE = { top: 800, mid: 300, none: 0 };
const ADMIN_TOKEN = 'admin123';

function load() {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) { return { suppliers: [], brands: [] }; }
}
function save(db) {
  fs.writeFileSync(DATA, JSON.stringify(db, null, 2));
}
function adFee(tier) { return AD_FEE[tier] || 0; }
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', c => buf += c);
    req.on('end', () => { try { resolve(JSON.parse(buf || '{}')); } catch (e) { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  if (p === '/api/health' && req.method === 'GET') {
    return send(res, 200, { ok: true });
  }

  // 注册材料商
  if (p === '/api/supplier/register' && req.method === 'POST') {
    const b = await readBody(req);
    if (!b.name) return send(res, 400, { error: '缺少 name' });
    const db = load();
    const supplierId = 's' + Date.now();
    db.suppliers.push({ supplierId, name: b.name, contact: b.contact || '', phone: b.phone || '', createdAt: Date.now() });
    save(db);
    return send(res, 200, { supplierId });
  }

  // 添加品牌 + 价格（收广告费）
  if (p === '/api/supplier/brand' && req.method === 'POST') {
    const b = await readBody(req);
    if (!b.supplierId || !b.materialId || !b.brand) return send(res, 400, { error: '缺少 supplierId / materialId / brand' });
    const fee = adFee(b.tier);
    const db = load();
    const rec = {
      id: 'b' + Date.now(),
      supplierId: b.supplierId,
      materialId: b.materialId,
      materialName: b.materialName || b.materialId,
      brand: b.brand,
      tier: b.tier || 'mid',
      price: Number(b.price) || 0,
      adFee: fee,
      status: fee > 0 ? 'pending' : 'on',  // 需缴费才 on（演示直接 on）
      createdAt: Date.now()
    };
    rec.status = 'on'; // 演示：直接上架
    db.brands.push(rec);
    save(db);
    return send(res, 200, { ok: true, id: rec.id, adFee: fee, payUrl: fee > 0 ? '/pay/' + rec.id : '' });
  }

  // 查询某材料已上架品牌
  if (p === '/api/brands' && req.method === 'GET') {
    const material = u.searchParams.get('material');
    const db = load();
    const list = db.brands.filter(x => x.status === 'on' && (!material || x.materialId === material));
    return send(res, 200, { list });
  }

  // ===== 后台 · 计算规则（导出 / 修改）=====
  if (p === '/api/admin/login' && req.method === 'POST') {
    const b = await readBody(req);
    if (b.token === ADMIN_TOKEN) return send(res, 200, { ok: true, token: ADMIN_TOKEN });
    return send(res, 401, { error: '口令错误' });
  }

  if (p === '/api/admin/config') {
    if (req.method === 'GET') {
      try { return send(res, 200, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))); }
      catch (e) { return send(res, 500, { error: 'config 读取失败' }); }
    }
    if (req.method === 'PUT') {
      const b = await readBody(req);
      if (!b.tiers || !b.spaces) return send(res, 400, { error: '缺少 tiers/spaces' });
      try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(b, null, 2)); }
      catch (e) { return send(res, 500, { error: '写入失败' }); }
      return send(res, 200, { ok: true });
    }
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log('材料商入驻后端已启动: http://localhost:' + PORT);
});
