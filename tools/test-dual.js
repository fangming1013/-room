// 双端体验一致性自测（无 IDE 环境）
// 目的：确认 iOS 与安卓走的是「同一套界面语义」，差别只在后台动作，
//       并且代码里不能再出现"暂不支持 / 暂无额度"这类把差异暴露给用户的文案。
const path = require('path');
const ROOT = path.join(__dirname, '..');

let captured = null;
const calls = { modal: [], request: [], toast: [], nav: [] };
const storage = {};

global.wx = {
  getStorageSync: k => storage[k],
  setStorageSync: (k, v) => { storage[k] = v; },
  removeStorageSync: k => { delete storage[k]; },
  showModal: o => { calls.modal.push(o); if (o.success) o.success({ confirm: true, cancel: false }); },
  showToast: o => calls.toast.push(o),
  showLoading: () => {}, hideLoading: () => {},
  navigateTo: o => calls.nav.push(o),
  switchTab: o => calls.nav.push(o),
  getDeviceInfo: () => ({ platform: 'ios' }),
  getSystemInfoSync: () => ({ platform: 'ios', windowWidth: 375 }),
  request: o => { calls.request.push(o); if (o.success) o.success({ statusCode: 200, data: { ok: true } }); },
  createCanvasContext: () => ({ draw: () => {} }),
  createSelectorQuery: () => ({ in: () => ({ select: () => ({ fields: () => ({ exec: cb => cb([null]) }) }) }) }),
  canvasToTempFilePath: () => {},
  getImageInfo: () => {},
  saveImageToPhotosAlbum: o => { if (o.success) o.success({}); },
  getFileSystemManager: () => ({ readFile: () => {}, writeFile: () => {} }),
  env: { USER_DATA_PATH: '/tmp' }
};
global.getApp = () => ({ globalData: { project: { spaces: [] } } });
global.Page = o => { captured = o; };
global.getCurrentPages = () => [];

// 载入页面逻辑
require(path.join(ROOT, 'pages/result/result.js'));

function makePage(isIOS) {
  const page = Object.assign({}, captured);
  page.data = JSON.parse(JSON.stringify(captured.data || {}));
  page.setData = function (d) { Object.assign(this.data, d); };
  page._isIOS = isIOS;
  page.data.isIOS = isIOS;
  return page;
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? ' → ' + extra : '')); }
}

// —— 1. 界面文案：两端都不能出现"差异暴露型"用语 ——
const fs = require('fs');
const wxml = fs.readFileSync(path.join(ROOT, 'pages/result/result.wxml'), 'utf8');
const sup = fs.readFileSync(path.join(ROOT, 'pages/supplier/supplier.js'), 'utf8');
[-1, 1].forEach(() => {});
console.log('\n[1] 文案一致性');
check('result.wxml 无「暂不支持」', wxml.indexOf('暂不支持') < 0);
check('result.wxml 无「暂无可用额度」', wxml.indexOf('暂无可用额度') < 0);
check('result.wxml 无「iPhone 暂不」', wxml.indexOf('iPhone 暂不') < 0);
check('supplier.js 无「暂不支持在线缴费」', sup.indexOf('暂不支持在线缴费') < 0);
check('两端共用同一句「效果图按需生成」', wxml.indexOf('效果图按需生成') > 0);

// —— 2. iOS 无额度：点生成 → 预约出图（不是"不支持"） ——
console.log('\n[2] iOS 无额度路径');
calls.modal.length = 0; calls.nav.length = 0;
storage.lead_api_cfg = { base: 'https://example.com' };
const iosPage = makePage(true);
iosPage.data.space = { name: '厨房', w: 300, d: 200, h: 270, quote: { total: 42000 } };
iosPage.data.selStyle = 'modern';
iosPage.data.quotaInfo = { totalLeft: 0 };
storage.user_v1 = { phone: '13800000000', city: '杭州', name: '张三' };
iosPage.bookDesigner();
check('弹出的是「预约设计师出图」', /预约设计师出图/.test((calls.modal[0] || {}).title || ''));
check('说明里带尺寸与风格', /300×200×270/.test((calls.modal[0] || {}).content || '') && /现代风格/.test((calls.modal[0] || {}).content || ''));
check('未出现「不支持」字样', !/不支持/.test(JSON.stringify(calls.modal)));

// —— 3. iOS 端 openPaySheet 不再弹"不支持"，直接转预约 ——
console.log('\n[3] iOS 支付入口兜底');
calls.modal.length = 0;
iosPage.openPaySheet();
check('openPaySheet 不再提示"暂不支持"', !/不支持/.test(JSON.stringify(calls.modal)));
check('openPaySheet 走预约', /预约设计师出图/.test((calls.modal[0] || {}).title || ''));
check('iOS 不打开付费面板', iosPage.data.paySheet !== true);

// —— 4. 安卓无额度：仍走购买面板（钱不能丢） ——
console.log('\n[4] 安卓无额度路径');
const andPage = makePage(false);
andPage.data.paySheet = false;
andPage.openPaySheet();
check('安卓打开套餐面板', andPage.data.paySheet === true);

// —— 5. 报文字段：wantRender 能传到服务端 ——
console.log('\n[5] 上报字段');
const leadapi = require(path.join(ROOT, 'utils/leadapi.js'));
const payloadSrc = fs.readFileSync(path.join(ROOT, 'utils/leadapi.js'), 'utf8');
check('leadapi 携带 wantRender', payloadSrc.indexOf('wantRender') > 0);
check('leadapi 携带 wantStyle', payloadSrc.indexOf('wantStyle') > 0);
const be = fs.readFileSync(path.join(ROOT, 'backend/img-proxy.js'), 'utf8');
check('后端 saveLead 落 wantRender', /wantRender: !!p\.wantRender/.test(be));
check('后端预约强制推送', /force: !!p\.wantRender/.test(be));

// —— 6. 虚拟支付开通后：iOS 也能正常买（两端逻辑合一） ——
console.log('\n[6] 虚拟支付开通后');
const iosPaid = makePage(true);
iosPaid._vpayReady = true;
iosPaid.data.paySheet = false;
check('payOn() 变为 true', iosPaid.payOn() === true);
iosPaid.openPaySheet();
check('iOS 也打开套餐面板', iosPaid.data.paySheet === true);
check('面板不再按端隐藏', wxml.indexOf('paySheet && payReady') > 0);

// —— 7. 虚拟支付模块 ——
console.log('\n[7] 虚拟支付模块');
const vp = require(path.join(ROOT, 'utils/vpay.js'));
check('套餐→道具映射齐全', vp.PRODUCT_ID.p5 === 'render_5' && vp.PRODUCT_ID.p10 === 'render_10');
const vpSrc = fs.readFileSync(path.join(ROOT, 'utils/vpay.js'), 'utf8');
check('调的是 requestVirtualPayment', vpSrc.indexOf('wx.requestVirtualPayment') > 0);
check('包里不含任何密钥', !/AppKey\s*[:=]\s*['"][A-Za-z0-9]{8,}/.test(vpSrc));
const vpayBe = fs.readFileSync(path.join(ROOT, 'backend/vpay.js'), 'utf8');
check('签名在服务端算', vpayBe.indexOf("hmac(key, 'requestVirtualPayment&'") > 0);
check('session_key 不下发', vpayBe.indexOf('session_key: session_key') < 0);

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
