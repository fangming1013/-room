const { MATERIAL_CATALOG } = require('../../utils/spaces.js');
const brands = require('../../utils/brands.js');
const sf = require('../../utils/siliconflow.js');
const { TIERS, TIER_LIST, FEE_PLAN, UNIT_OPTIONS } = brands;

const MAX_IMG = 5;       // 每个产品最多 5 张图
const COMPRESS_Q = 60;   // 压缩质量（自动压缩到手机能看清即可）

Page({
  data: {
    catalog: MATERIAL_CATALOG,
    matRange: MATERIAL_CATALOG.map(c => c.name + '（' + c.spaceName + '）'),
    matIdx: 0,
    supplier: '', contact: '', phone: '',
    qrCode: '',                                  // 微信二维码
    feePlan: 'month',
    feePlans: [
      { id: 'month', label: '按月 ¥300 / 月' },
      { id: 'year', label: '按年 ¥3000 / 年' }
    ],
    tiers: TIER_LIST.map(k => ({ id: k, name: TIERS[k].name })),
    units: UNIT_OPTIONS,
    unitIdx: -1,                                // 单位必选，默认未选
    // 当前正在编辑的产品
    pMatIdx: 0, pBrand: '', pPrice: '', pSpec: '', pImages: [], pTier: 'none',
    products: [],                               // 已添加产品（可含经济/舒适/轻奢）
    list: []
  },

  onLoad(options) {
    if (options && options.materialId) {
      const i = MATERIAL_CATALOG.findIndex(c => c.id === options.materialId);
      if (i >= 0) this.setData({ matIdx: i, pMatIdx: i });
    }
  },
  onShow() { this.setData({ list: brands.listBrands().slice().reverse() }); },

  selectMat(e) { this.setData({ matIdx: Number(e.detail.value) }); },
  onSupplier(e) { this.setData({ supplier: e.detail.value }); },
  onContact(e) { this.setData({ contact: e.detail.value }); },
  onPhone(e) { this.setData({ phone: e.detail.value }); },

  chooseQR() {
    wx.chooseImage({
      count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (r) => { this.setData({ qrCode: r.tempFilePaths[0] }); }
    });
  },
  selectFee(e) { this.setData({ feePlan: e.currentTarget.dataset.id }); },

  // ===== 产品表单 =====
  selectPMat(e) { this.setData({ pMatIdx: Number(e.detail.value) }); },
  onPBrand(e) { this.setData({ pBrand: e.detail.value }); },
  onPPrice(e) { this.setData({ pPrice: e.detail.value }); },
  onPSpec(e) { this.setData({ pSpec: e.detail.value }); },
  selectPUnit(e) { this.setData({ unitIdx: Number(e.detail.value) }); },
  selectPTier(e) { this.setData({ pTier: e.currentTarget.dataset.id }); },

  choosePImg() {
    const remain = MAX_IMG - this.data.pImages.length;
    if (remain <= 0) { wx.showToast({ title: '最多 5 张', icon: 'none' }); return; }
    wx.chooseImage({
      count: remain, sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (r) => {
        const paths = r.tempFilePaths;
        const out = this.data.pImages.slice();
        let done = 0;
        const flush = () => { if (done === paths.length) this.setData({ pImages: out.slice(0, MAX_IMG) }); };
        paths.forEach(p => {
          wx.compressImage({
            src: p, quality: COMPRESS_Q,
            success: (res) => { out.push(res.tempFilePath); done++; flush(); },
            fail: () => { out.push(p); done++; flush(); }
          });
        });
      }
    });
  },
  removePImg(e) {
    const i = Number(e.currentTarget.dataset.idx);
    const a = this.data.pImages.slice(); a.splice(i, 1);
    this.setData({ pImages: a });
  },

  addProduct() {
    const d = this.data;
    const cat = d.catalog[d.pMatIdx];
    if (!d.pBrand) { wx.showToast({ title: '请填品牌名', icon: 'none' }); return; }
    const price = parseFloat(d.pPrice);
    if (!price || price <= 0) { wx.showToast({ title: '请填单价', icon: 'none' }); return; }
    if (d.unitIdx < 0) { wx.showToast({ title: '请选择单位', icon: 'none' }); return; }
    const prod = {
      materialId: cat.id, materialName: cat.name,
      brand: d.pBrand, price, unit: UNIT_OPTIONS[d.unitIdx],
      spec: d.pSpec, images: d.pImages.slice(), tier: d.pTier
    };
    this.setData({
      products: d.products.concat(prod),
      pBrand: '', pPrice: '', pSpec: '', pImages: [], unitIdx: -1, pTier: 'none'
    });
    wx.showToast({ title: '已加入产品', icon: 'success' });
  },
  removeProduct(e) {
    const i = Number(e.currentTarget.dataset.idx);
    const a = this.data.products.slice(); a.splice(i, 1);
    this.setData({ products: a });
  },

  submit() {
    const d = this.data;
    if (!d.supplier) { wx.showToast({ title: '请填公司/品牌名', icon: 'none' }); return; }
    if (!d.products.length) { wx.showToast({ title: '请至少添加一款产品', icon: 'none' }); return; }
    brands.addBrand({
      supplier: d.supplier, contact: d.contact, phone: d.phone,
      qrCode: d.qrCode, feePlan: d.feePlan, products: d.products
    });
    wx.showToast({ title: '已提交，待管理员审核上架', icon: 'success' });
    this.setData({
      supplier: '', contact: '', phone: '', qrCode: '', feePlan: 'month',
      products: [], pBrand: '', pPrice: '', pSpec: '', pImages: [], unitIdx: -1, pTier: 'none',
      list: brands.listBrands().slice().reverse()
    });
  },

  // 入驻费缴纳：真调微信支付；未配商户号时降级为提示线下缴纳
  payAd() {
    const d = this.data;
    // iOS 虚拟支付合规：B 端入驻费属平台服务收费，iOS 端一律不走在线支付
    let isIOS = false;
    try {
      const info = (wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()) || {};
      isIOS = String(info.platform || '').toLowerCase() === 'ios';
    } catch (e) {}
    // iOS 上不做在线支付，但这不是"功能不支持"，而是 B 端正常的「先提交、后对公结算」——
    // 企业客户本来就要发票、要走公账，界面不能摆出一副残缺样。
    if (isIOS) {
      const yr = d.feePlan === 'year';
      wx.showModal({
        title: '提交入驻资料',
        content: '资料审核通过后，我们会联系你办理' + (yr ? '年付 3000 元' : '月付 300 元') + '入驻并开具发票，无需在小程序内支付。',
        confirmText: '提交资料',
        cancelText: '再想想',
        success: r => { if (r.confirm) this.submit(); }
      });
      return;
    }
    if (!d.supplier) { wx.showToast({ title: '请先填公司/品牌名', icon: 'none' }); return; }
    if (!d.products.length) { wx.showToast({ title: '请至少添加一款产品', icon: 'none' }); return; }
    const isYear = d.feePlan === 'year';
    const amount = isYear ? 300000 : 30000;           // 分：3000 元 / 300 元
    wx.showLoading({ title: '创建订单', mask: true });
    sf.createPayOrder({ amount, desc: '材料商入驻费·' + (isYear ? '年付' : '月付') })
      .then(args => {
        wx.hideLoading();
        wx.requestPayment(Object.assign({}, args, {
          success: () => this._submitPaid(true),
          fail: () => wx.showToast({ title: '支付未完成', icon: 'none' })
        }));
      })
      .catch(() => {
        wx.hideLoading();
        wx.showModal({
          title: '在线支付暂未开通',
          content: '请先提交资料，并联系管理员缴纳入驻费（' + (isYear ? '3000 元/年' : '300 元/月') + '），缴费后由管理员在后台通过审核上架。',
          confirmText: '先提交资料',
          success: r => { if (r.confirm) this.submit(); }
        });
      });
  },

  // 支付成功后提交并标记已付费
  _submitPaid(paid) {
    const d = this.data;
    if (!d.supplier || !d.products.length) { wx.showToast({ title: '资料不完整', icon: 'none' }); return; }
    brands.addBrand({
      supplier: d.supplier, contact: d.contact, phone: d.phone,
      qrCode: d.qrCode, feePlan: d.feePlan, products: d.products,
      paid: paid, paidAt: Date.now()
    });
    wx.showModal({
      title: '支付成功',
      content: '已收到入驻费，资料已提交。管理员审核资料完整后即上架，你的产品会出现在客户的选材清单里。',
      showCancel: false,
      success: () => this.setData({
        supplier: '', contact: '', phone: '', qrCode: '', feePlan: 'month',
        products: [], pBrand: '', pPrice: '', pSpec: '', pImages: [], unitIdx: -1, pTier: 'none',
        list: brands.listBrands().slice().reverse()
      })
    });
  },

  noop() {}
});
