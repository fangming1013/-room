// 品牌档位 + 材料商入驻（本地存储兜底；可切换远程 API）
// —— 2026-10-18 重构：一个「品牌(公司)」可含多款价位段产品，支持微信二维码与审核状态 ——
// 主材「经济」为基准价，按档位倍率调价；材料商注册品牌可覆盖单价并带「广告」标
const C = require('./config.js');
const TIERS = C.TIERS;
const TIER_LIST = C.TIER_LIST;
const AD_FEE = C.AD_FEE;
const adFee = C.adFee;

const STORE_KEY = 'supplier_brands_v1';

// 远程接口（可选）：配置后拉取平台审核通过的品牌，否则走本地
const API_BASE = ''; // 例如 'https://api.example.com'

// 入驻费用方案（统一价，不分一线/二线；一个品牌一笔费用，可上传经济/舒适/轻奢多款产品）
const FEE_PLAN = { month: { label: '按月', fee: 300, unit: '月' }, year: { label: '按年', fee: 3000, unit: '年' } };

// 单价可选单位（必选）
const UNIT_OPTIONS = ['m', '㎡', '组', '樘', '个', '张', '副', '套', '米', '延米', '㎡/天'];

function getStore() {
  try { return wx.getStorageSync(STORE_KEY) || []; } catch (e) { return []; }
}
function setStore(list) {
  try { wx.setStorageSync(STORE_KEY, list); } catch (e) {}
}
function resetStore() { setStore([]); }

// 某材料已审核上架（status==='on'）的品牌产品，扁平化为「产品级」便于预算页直接选
function brandsForMaterial(materialId) {
  const out = [];
  getStore().forEach(b => {
    if (b.status !== 'on') return;
    (b.products || []).forEach(p => {
      if (p.materialId !== materialId) return;
      out.push({
        id: b.id + '_' + (p._pid || p.materialId),
        brandId: b.id,
        brand: p.brand,
        materialId: p.materialId,
        materialName: p.materialName,
        price: Number(p.price) || 0,
        unit: p.unit || '',
        spec: p.spec || '',
        tier: p.tier || 'none',
        image: (p.images && p.images[0]) || '',
        images: p.images || [],
        supplier: b.supplier || '',
        contact: b.contact || '',
        phone: b.phone || '',
        qrCode: b.qrCode || ''   // 微信二维码：客户可扫码加微信
      });
    });
  });
  return out;
}
function listBrands() { return getStore(); }
function pendingBrands() { return getStore().filter(b => b.status === 'pending'); }

// 材料商注册并添加品牌：一个品牌(公司)可含多款价位段产品；提交后待管理员审核
function addBrand(payload) {
  const list = getStore();
  const id = 'b' + Date.now();
  const rec = {
    id,
    supplier: payload.supplier || '',
    contact: payload.contact || '',
    phone: payload.phone || '',
    qrCode: payload.qrCode || '',         // 微信二维码（客户联系用）
    feePlan: payload.feePlan || 'month',  // 'month'=300/月 | 'year'=3000/年
    status: 'pending',                     // 待审核（管理员确认费用到账+资料完整后改为 on）
    paid: !!payload.paid,                  // 是否已在线支付入驻费（未配商户号时为 false，靠线下收款）
    paidAt: payload.paidAt || 0,
    createdAt: Date.now(),
    products: (payload.products || []).map((p, i) => Object.assign({ _pid: 'p' + i }, p))
  };
  list.push(rec);
  setStore(list);
  return rec;
}

// 管理员审核：费用到账且资料完整 → 上架；否则驳回
function approveBrand(id) {
  const list = getStore();
  const b = list.find(x => x.id === id);
  if (b) { b.status = 'on'; setStore(list); }
  return b;
}
function rejectBrand(id) {
  const list = getStore();
  const b = list.find(x => x.id === id);
  if (b) { b.status = 'off'; setStore(list); }
  return b;
}

function fetchBrands(materialId) {
  if (!API_BASE) return Promise.resolve(brandsForMaterial(materialId));
  return new Promise((resolve) => {
    wx.request({
      url: API_BASE + '/api/brands?material=' + encodeURIComponent(materialId),
      success: (r) => resolve((r.data && r.data.list) || []),
      fail: () => resolve(brandsForMaterial(materialId))
    });
  });
}

module.exports = {
  TIERS, TIER_LIST, AD_FEE, adFee, FEE_PLAN, UNIT_OPTIONS,
  getStore, setStore, resetStore,
  brandsForMaterial, listBrands, pendingBrands, addBrand, fetchBrands, API_BASE,
  approveBrand, rejectBrand
};
