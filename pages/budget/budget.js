// 预算报价页（1.0.1 新增，独立页面）：原样保留 1.0 的 ④主材 ⑤施工 ⑥合计
// 含工程量手填 / 采纳估算 / 施工项开关 / 算法·手填 徽标 / 档位切换 / 手动改价。
// 首页只留 ①声控量房 ②门窗 ③家具（1/2/3），录入后「生成预算」跳到此页。
const { calcQuote, buildThreeTiers, effUnitPrice, syncWholeDemoDedup } = require('../../utils/quote.js');
const brands = require('../../utils/brands.js');
const { TIERS } = brands;
const { round1, fmt1 } = require('../../utils/num.js');
const est = require('../../utils/estimate.js');
const auxRule = require('../../utils/auxrule.js');
const store = require('../../utils/store.js');

Page({
  data: {
    space: null,
    quote: { total: 0, matTotal: 0, laborTotal: 0, matItems: [], laborItems: [] },
    doorName: '-', winName: '-',
    threeTiers: null, tierName: '经济',
    projectGrand: 0, projectCount: 0,
    matView: [], laborView: [],
    registered: false, recId: '',
    brandSheet: { show: false, idx: 0, options: [] }
  },

  onLoad(options) {
    let space;
    if (options && options.rec) {
      const rec = (store.getHistory() || []).find(r => r.id === options.rec);
      if (rec && rec.space) { space = rec.space; this._recId = options.rec; }
    }
    if (!space && options && options.pid !== undefined && options.pid !== '') {
      const si = parseInt(options.si, 10) || 0;
      const p = (store.getProjects() || []).find(x => x.id === options.pid);
      if (p && p.spaces && p.spaces[si] && p.spaces[si].snap) { space = p.spaces[si].snap; this._pid = options.pid; this._pidProj = p; this._pidSi = si; }
    }
    if (!space && options && options.idx !== undefined && options.idx !== '') {
      const i = parseInt(options.idx, 10);
      const proj = getApp().globalData.project;
      syncWholeDemoDedup(proj);
      space = proj.spaces[i];
      this._idx = i;
      this._force = true;
    }
    if (!space && !this._recId && !this._pid) space = getApp().globalData.space;
    if (!space) return;
    this.renderSpace(space);
    this.checkReg();
  },

  onShow() { this.checkReg(); },

  checkReg() { this.setData({ registered: !!store.getUser() }); },

  // 未注册要求先注册，注册后完整展示预算（老板 1.0.1 定：拦截在报价页）
  goRegister() { wx.navigateTo({ url: '/pages/register/register?from=budget' }); },

  // 渲染 ④主材 / ⑤施工 的可编辑视图 + ⑥合计
  renderSpace(space) {
    const tier = space.tier || 'none';
    const wName = { top: '上/北', bottom: '下/南', left: '左/西', right: '右/东' };
    const matView = this.buildMatView(space, tier);
    const laborView = this.buildLaborView(space);
    const q = (this._force || !space.quote) ? calcQuote(space) : space.quote;
    space.quote = q;
    let projectGrand = 0, projectCount = 0;
    if (this._pidProj) { projectGrand = this._pidProj.grand; projectCount = this._pidProj.spaces.length; }
    else if (this._recId) { projectGrand = q.total; projectCount = 1; }
    else {
      const proj = getApp().globalData.project.spaces || [];
      proj.forEach(s => { projectGrand += (s.quote ? s.quote.total : 0); });
      projectCount = proj.length;
    }
    this.setData({
      space, quote: q,
      doorName: wName[space.doorWall] || '-', winName: wName[space.winWall] || '-',
      tierName: (TIERS[space.tier || 'none'] || {}).name || '经济',
      threeTiers: buildThreeTiers(space).filter(t => t.key === (space.tier || 'none')),
      projectGrand, projectCount, recId: this._recId || '',
      matView, laborView
    });
  },

  buildMatView(space, tier) {
    const raw = (space.materials || []).map((m, idx) => ({ m, idx })).filter(x => x.m.on);
    const rows = raw.map(({ m, idx }) => {
      const e = effUnitPrice(m, tier);
      const qty = Number(m.qty) || 0;
      const sub = Math.round(e.price * qty);
      const qt = (m.qtyText != null) ? m.qtyText : fmt1(qty);
      return {
        idx, id: m.id, name: m.name, brand: e.brand, ad: e.ad,
        unit: m.unit, price: e.price, qtyText: qt, sub,
        auto: !!m.auto && !m.manual, manual: !!m.manual
      };
    });
    const sum = rows.reduce((s, r) => s + r.sub, 0) || 1;
    rows.forEach(r => { r.pct = Math.round(r.sub / sum * 100); });
    return rows;
  },
  buildLaborView(space) {
    const raw = (space.labor || []).map((l, idx) => ({ l, idx })).filter(x => x.l.on);
    const rows = raw.map(({ l, idx }) => {
      const e = effUnitPrice(l, 'none');
      const qty = Number(l.qty) || 0;
      const sub = Math.round(e.price * qty);
      const qt = (l.qtyText != null) ? l.qtyText : fmt1(qty);
      return {
        idx, id: l.id, name: l.name, unit: l.unit, price: e.price,
        qtyText: qt, sub, auto: !!l.auto && !l.manual, manual: !!l.manual, on: l.on
      };
    });
    const sum = rows.reduce((s, r) => s + r.sub, 0) || 1;
    rows.forEach(r => { r.pct = Math.round(r.sub / sum * 100); });
    return rows;
  },

  updateQuote() {
    const s = this.data.space;
    const proj = (getApp().globalData || {}).project;
    if (proj && (proj.spaces || []).length) {
      const hit = (proj.spaces || []).find(x => x.key === s.key);
      s.wholeDemoOn = hit ? !!hit.wholeDemoOn
        : auxRule.wholeDemoOn((proj.spaces || []).length + 1, (proj.fee || {}).auxQty);
    }
    const q = calcQuote(s);
    this.setData({ quote: q, space: s });
  },

  // ===== ④主材 工程量手填（1.0 方案）=====
  onQty(e) {
    const idx = e.currentTarget.dataset.idx;
    const s = this.data.space;
    s.materials[idx].qty = parseFloat(e.detail.value) || 0;
    s.materials[idx].qtyText = e.detail.value;
    s.materials[idx].manual = true;          // 手填标记：回首页改尺寸也不被自动覆盖
    this.updateQuote();
    this.refreshViews();
  },
  onQtyBlur(e) {
    const idx = e.currentTarget.dataset.idx;
    const s = this.data.space;
    s.materials[idx].qty = round1(s.materials[idx].qty);
    s.materials[idx].qtyText = fmt1(s.materials[idx].qty);
    this.updateQuote();
    this.refreshViews();
  },

  // ===== ⑤施工 工程量手填 + 项开关 =====
  onLaborQty(e) {
    const idx = e.currentTarget.dataset.idx;
    const s = this.data.space;
    s.labor[idx].qty = parseFloat(e.detail.value) || 0;
    s.labor[idx].qtyText = e.detail.value;
    s.labor[idx].manual = true;
    this.updateQuote();
    this.refreshViews();
  },
  onLaborQtyBlur(e) {
    const idx = e.currentTarget.dataset.idx;
    const s = this.data.space;
    s.labor[idx].qty = round1(s.labor[idx].qty);
    s.labor[idx].qtyText = fmt1(s.labor[idx].qty);
    this.updateQuote();
    this.refreshViews();
  },
  toggleLabor(e) {
    // 施工项恒为开启（老板 1.0.1 定：移除开/关，避免"开了回不来"）
    void e;
  },

  // ===== 选品牌（恢复 1.0）：档位默认价 + 已注册材料商品牌（广告）+ 材料商入驻 =====
  openBrand(e) {
    const idx = e.currentTarget.dataset.idx;
    const m = this.data.space.materials[idx];
    const opts = [];
    // 三个档位报价：点选直接切换整空间报价（替换原有预算报价）
    brands.TIER_LIST.forEach(k => {
      const t = brands.TIERS[k];
      const price = (m.prices && m.prices[k] != null) ? Number(m.prices[k]) : m.price;
      opts.push({ key: 'tier_' + k, kind: 'tier', tier: k, name: t.name, price, cur: k === (this.data.space.tier || 'none') });
    });
    // 已入驻材料商（含新录入的，列在三档之下）
    brands.brandsForMaterial(m.id).forEach(b => {
      opts.push({ key: 'brand_' + b.id, kind: 'brand', name: b.brand, price: b.price, ad: true, supplier: b.supplier, tier: b.tier, spec: b.spec, image: b.image, unit: b.unit, qrCode: b.qrCode });
    });
    this.setData({ brandSheet: { show: true, idx, options: opts, matName: m.name } });
  },
  // 弹层点击分发：tier→切换整空间报价；brand→选该材料品牌
  pickSheet(e) {
    const i = e.currentTarget.dataset.i;
    const opt = this.data.brandSheet.options[i];
    if (!opt) return;
    const idx = this.data.brandSheet.idx;
    const s = this.data.space;
    if (opt.kind === 'tier') {
      s.tier = opt.tier;                         // 点任一档位 → 替换整空间报价
      s.quote = calcQuote(s);
      if (this._idx >= 0 && getApp().globalData.project.spaces[this._idx]) getApp().globalData.project.spaces[this._idx] = s;
      if (this._recId) {
        store.updateHistory(this._recId, {
          tier: (TIERS[opt.tier] || {}).name || '经济',
          matTotal: s.quote.matTotal, laborTotal: s.quote.laborTotal, total: s.quote.total, space: s
        });
      }
      this.setData({ space: s, brandSheet: { show: false, idx: 0, options: [], matName: '' } });
      this.renderSpace(s);
      return;
    }
    if (opt.kind === 'brand') {
      s.materials[idx].brand = { name: opt.name, price: opt.price, ad: true, qrCode: opt.qrCode, supplier: opt.supplier, unit: opt.unit };
      this.setData({ space: s, brandSheet: { show: false, idx: 0, options: [], matName: '' } });
      this.updateQuote();
      this.refreshViews();
    }
  },
  // 客户点「加微信」：预览二维码（长按可保存到相册后扫码添加）
  showQR(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.previewImage({ urls: [url], current: url });
  },
  // 材料商入驻：跳新页面（带当前材料，便于录新品）
  toSupplier() {
    const idx = this.data.brandSheet.idx;
    const m = this.data.space.materials[idx];
    const mid = m ? m.id : '';
    const mn = m ? encodeURIComponent(m.name) : '';
    this.setData({ brandSheet: { show: false, idx: 0, options: [], matName: '' } });
    wx.navigateTo({ url: '/pages/supplier/supplier?materialId=' + mid + '&materialName=' + mn });
  },
  resetBrand() {
    const idx = this.data.brandSheet.idx;
    const s = this.data.space;
    s.materials[idx].brand = null;
    this.setData({ space: s, brandSheet: { show: false, idx: 0, options: [], matName: '' } });
    this.updateQuote();
    this.refreshViews();
  },
  closeBrand() { this.setData({ brandSheet: { show: false, idx: 0, options: [], matName: '' } }); },
  noop() {},

  // 采纳系统估算：放弃手填，恢复按预算算法随尺寸自动重算
  onEstimate(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const kind = e.currentTarget.dataset.kind;
    const s = this.data.space;
    const list = kind === 'l' ? s.labor : s.materials;
    const it = list[idx];
    if (!it) return;
    const q = est.estimateQty(it.id, s);
    if (q === null || q === undefined) { wx.showToast({ title: '按项/套计价，无需估算', icon: 'none' }); return; }
    it.qty = q; it.qtyText = fmt1(q); it.manual = false; it.auto = true;
    this.updateQuote();
    this.refreshViews();
    wx.showToast({ title: it.name + ' → ' + q + it.unit, icon: 'none' });
  },

  // 工程量变化后刷新可编辑视图（quote 已由 updateQuote 处理）
  refreshViews() {
    const space = this.data.space;
    this.setData({ matView: this.buildMatView(space, space.tier || 'none'), laborView: this.buildLaborView(space) });
  },

  // 档位切换：主材随档升级，施工不变，单价与总价同步变化
  switchTier(e) {
    if (this._pid) return;
    const id = e.currentTarget.dataset.id;
    const space = this.data.space;
    space.tier = id;
    space.quote = calcQuote(space);
    if (this._idx >= 0) getApp().globalData.project.spaces[this._idx] = space;
    if (this._recId) {
      store.updateHistory(this._recId, {
        tier: (TIERS[space.tier || 'none'] || {}).name || '经济',
        matTotal: space.quote.matTotal, laborTotal: space.quote.laborTotal, total: space.quote.total, space
      });
    }
    this.renderSpace(space);
  },

  toResult() {
    if (this._recId) wx.navigateTo({ url: '/pages/result/result?rec=' + this._recId });
    else if (this._idx != null) wx.navigateTo({ url: '/pages/result/result?idx=' + this._idx });
  },
  toSummary() {
    if (this._pid) { wx.redirectTo({ url: '/pages/summary/summary?pid=' + this._pid }); return; }
    wx.navigateTo({ url: '/pages/summary/summary' });
  },
  back() { wx.navigateBack(); },

  // ===== 微信分享 =====
  onShareAppMessage() {
    const nm = (this.data.space && this.data.space.name) || '我家装修';
    return { title: nm + ' 预算 ¥' + (this.data.quote.total || 0) + ' · 算一算装修多少钱', path: '/pages/home/home' };
  },
  onShareTimeline() {
    return { title: '算一算装修要花多少钱 · 声控量房一键出预算' };
  }
});
