const { calcQuote, calcWholeAux, syncWholeDemoDedup } = require('../../utils/quote.js');
const aux = require('../../utils/auxrule.js');
const cfg = require('../../utils/config.js');
const store = require('../../utils/store.js');
const { round1, fmt1 } = require('../../utils/num.js');

Page({
  data: {
    rows: [],
    grand: 0,
    matGrand: 0,
    laborGrand: 0,
    auxFixedSub: 0,
    auxAll: 0,
    carryAmt: 0,
    carryRate: 200,
    taxAmt: 0,
    taxBase: 0,
    mgrAmt: 0,
    mgrBase: 0,
    sumBeforeTax: 0,
    auxTable: [],
    auxText: {},
    count: 0,
    floorText: '1',
    readOnly: false,
    pid: '',
    address: '',
    cust: '',
    phone: '',
    fee: { floor: 1, taxOn: true, taxPct: 3, mgrPct: 10 }
  },

  onLoad(options) {
    if (options && options.pid) {
      const p = (store.getProjects() || []).find(x => x.id === options.pid);
      if (p) { this._view = p; this.setData({ readOnly: true, pid: p.id, address: p.address || '' }); this.renderProject(p); }
    }
  },

  onShow() {
    if (this._view) { this.renderProject(this._view); return; }   // 只读查看已存项目
    const fee = this.ensureFee();
    this.setData({ fee, floorText: String(fee.floor || 1) });
    this.compute();
  },

  // 只读渲染一条已存项目记录（单次项目合计：多空间 + 辅助/税/管）
  renderProject(p) {
    const rows = (p.spaces || []).map((s, i) => ({
      idx: i, key: s.key, name: s.name, dim: s.dim,
      matTotal: s.matTotal, laborTotal: s.laborTotal, total: s.total
    }));
    const matGrand = rows.reduce((a, r) => a + r.matTotal, 0);
    const laborGrand = rows.reduce((a, r) => a + r.laborTotal, 0);
    this.setData({
      rows,
      grand: p.grand, matGrand, laborGrand,
      auxFixedSub: p.auxFixedSub || 0, auxAll: p.auxTotal || 0,
      taxAmt: p.taxAmt || 0, mgrAmt: p.mgrAmt || 0,
      sumBeforeTax: (p.grand || 0) - (p.taxAmt || 0) - (p.mgrAmt || 0),
      cust: p.customer || '', phone: p.phone || '',
      count: rows.length
    });
  },

  // 把当前多空间项目显式保存到「我的记录」（生成时已自动存，这里供手动补存/更新）
  saveToRecords() {
    const app = getApp();
    const p = app.globalData.project;
    if (!p.spaces || !p.spaces.length) { wx.showToast({ title: '还没有空间', icon: 'none' }); return; }
    if (!p.id) p.id = 'p' + Date.now();
    const user = store.getUser() || {};
    const fee = p.fee || { floor: 1, taxOn: true, taxPct: 3, mgrPct: 10, auxQty: {} };
    // 存档前先刷新「全屋拆除」联动：n≥2 时各空间重复拆除项置 0
    syncWholeDemoDedup(p);
    let base = 0;
    const spaces = (p.spaces || []).map(s => {
      const q = calcQuote(s); s.quote = q; base += q.total;
      return { key: s.key, name: s.name, dim: s.w + '×' + s.d + '×' + s.h + ' cm', tier: (cfg.tiers()[s.tier || 'none'] || {}).name || '经济', matTotal: q.matTotal, laborTotal: q.laborTotal, total: q.total, snap: s };
    });
    const whole = calcWholeAux(base, { floor: fee.floor, taxOn: fee.taxOn, taxPct: fee.taxPct, mgrPct: fee.mgrPct, auxQty: aux.mergeQty(spaces.length || 1, fee.auxQty) });
    const taxAmt = (whole.items.find(it => it.id === 'tax') || {}).sub || 0;
    const mgrAmt = (whole.items.find(it => it.id === 'mgr') || {}).sub || 0;
    const auxFixedSub = whole.items.filter(it => it.kind !== 'pct').reduce((s, it) => s + (it.sub || 0), 0);
    const auxAll = whole.items.reduce((s, it) => s + (it.sub || 0), 0);
    store.upsertProject({ id: p.id, customer: user.name || '', phone: user.phone || '', address: p.address || '', time: Date.now(), spaces, fee: JSON.parse(JSON.stringify(fee)), auxFixedSub, taxAmt, mgrAmt, auxTotal: auxAll, grand: base + auxAll });
    wx.showToast({ title: '已保存到我的记录', icon: 'success' });
  },

  // 工程综合费设置：懒初始化（楼层/税金/管理费），默认值取后台配置
  ensureFee() {
    const app = getApp();
    if (!app.globalData.project.fee) {
      const A = cfg.aux();
      const tax = A.find(a => a.id === 'tax');
      const mgr = A.find(a => a.id === 'mgr');
      app.globalData.project.fee = {
        floor: 1,
        taxOn: tax ? tax.on !== false : true,
        taxPct: tax ? tax.val : 3,
        mgrPct: mgr ? mgr.val : 10
      };
    }
    return app.globalData.project.fee;
  },

  compute() {
    const app = getApp();
    const spaces = app.globalData.project.spaces || [];
    const fee = this.data.fee;
    // 先按当前项目状态刷新联动标记：n≥2 且选了全屋拆除 → 各空间内「墙地砖整体拆除」工程量置 0
    syncWholeDemoDedup(app.globalData.project);
    let matGrand = 0, laborGrand = 0, spacesGrand = 0, baseForWhole = 0;
    const rows = spaces.map((s, i) => {
      const q = calcQuote(s);          // 每次都按最新尺寸/联动标记重算，不吃缓存
      s.quote = q;
      matGrand += q.matTotal; laborGrand += q.laborTotal;
      spacesGrand += q.total;          // 空间合计 = 主材+施工（辅助已移至本页统一计）
      baseForWhole += q.total;         // 供辅助费/税金/管理费按总造价计
      return {
        idx: i,
        key: s.key,
        name: s.name,
        dim: s.w + '×' + s.d + '×' + s.h + ' cm',
        matTotal: q.matTotal,
        laborTotal: q.laborTotal,
        total: q.total,
        dedup: !!q.demoDedupOn          // 本空间已按全屋拆除扣掉重复拆除项
      };
    });

    // ===== 辅助项目表：全屋只列一次（不再按空间拆分，避免重复收费）=====
    // 数量 = 预算算法默认值（按空间数自动定），用户在本次会话手工改过的优先
    const auxQty = fee.auxQty || {};
    const n = spaces.length || 1;
    const ruleQty = aux.mergeQty(n, auxQty);   // 规则默认 + 手工覆盖
    const A = aux.resolveAux(cfg.aux().filter(a => a.on), n);
    const auxTable = [];
    let auxFixedSub = 0;   // 固定/运输类辅助小计（税/管之前）
    A.forEach(a => {
      if (a.kind === 'pct') return;    // 税金/管理费单独展示
      if (a.kind === 'floor') {
        // 材料运输及上楼费：工程量默认 0（预算算法定），本页可手工填层数
        const q = auxQty[a.id] != null ? (Number(auxQty[a.id]) || 0) : (ruleQty[a.id] != null ? ruleQty[a.id] : 0);
        auxTable.push({ id: 'carry', name: a.name, unit: a.unit || '层', qty: q, price: Number(a.rate) || 200, sub: Math.round(q * (Number(a.rate) || 200)), edit: 'qty' });
        return;
      }
      // 固定费：数量可在本页编辑（默认取预算算法值）
      const price = Number(a.price != null ? a.price : a.val) || 0;
      const qty = auxQty[a.id] != null ? (Number(auxQty[a.id]) || 0) : (ruleQty[a.id] != null ? ruleQty[a.id] : 1);
      const sub = Math.round(qty * price);
      auxFixedSub += sub;
      auxTable.push({ id: a.id, name: a.name, unit: a.unit || '项', qty, price, sub, edit: 'qty' });
    });

    // 全屋级辅助费计算（运输按楼层、税金可勾选、管理费比例可调）
    // 工程量口径：ruleQty（= 预算算法默认 + 本页手工改过的）
    const wholeAux = calcWholeAux(baseForWhole, {
      floor: fee.floor, taxOn: fee.taxOn, taxPct: fee.taxPct, mgrPct: fee.mgrPct, auxQty: ruleQty
    });
    const amap = {};
    wholeAux.items.forEach(it => { amap[it.id] = it; });
    const carry = amap.carry || {};
    const carryAmt = carry.sub || 0;
    // 回填运输行金额（工程量口径与辅助计算一致：手工覆盖 > 算法默认 0）
    const carryRow = auxTable.find(r => r.id === 'carry');
    if (carryRow) {
      carryRow.qty = auxQty.carry != null ? (Number(auxQty.carry) || 0) : (ruleQty.carry != null ? ruleQty.carry : 0);
      carryRow.price = carry.price || carryRow.price; carryRow.sub = carryAmt;
      carryRow.disp = fmt1(carryRow.qty);
    }
    auxFixedSub = auxTable.reduce((s, r) => s + (r.sub || 0), 0);   // 含运输

    // 预算合计（税/管前）= 各空间主材+施工 + 全部辅助项目
    const sumBeforeTax = baseForWhole + auxFixedSub;
    const taxAmt = (amap.tax || {}).sub || 0;
    const mgrAmt = (amap.mgr || {}).sub || 0;
    const grand = sumBeforeTax + taxAmt + mgrAmt;
    const auxAll = auxFixedSub + taxAmt + mgrAmt;

    this.setData({
      rows, auxTable, grand, matGrand, laborGrand, auxFixedSub, auxAll,
      sumBeforeTax,
      carryAmt, carryRate: carry.price || 200,
      taxAmt: taxAmt, taxBase: (amap.tax || {}).base || 0,
      mgrAmt: mgrAmt, mgrBase: (amap.mgr || {}).base || 0,
      count: rows.length
    });
  },

  // ===== 工程综合费编辑 =====
  persistFee(fee) {
    this.setData({ fee });
    getApp().globalData.project.fee = JSON.parse(JSON.stringify(fee));
  },
  onFloor(e) {
    const fee = this.data.fee;
    const txt = e.detail.value;
    this.setData({ floorText: txt });               // 显示原样，允许清空/改任意数（不再被强制回 1）
    fee.floor = txt === '' ? 1 : Math.max(1, parseInt(txt, 10) || 1);
    this.persistFee(fee); this.compute();
  },
  // 辅助项目数量编辑（垃圾外运车数/保洁次数/全屋拆除等），仅本页计一次
  onAuxQty(e) {
    const id = e.currentTarget.dataset.id;
    const fee = this.data.fee;
    if (!fee.auxQty) fee.auxQty = {};
    fee.auxQty[id] = parseFloat(e.detail.value) || 0;
    const auxText = Object.assign({}, this.data.auxText);
    auxText[id] = e.detail.value;   // 输入中保留原样（含末尾小数点），失焦才格式化
    this.setData({ auxText });
    this.persistFee(fee); this.compute();
  },
  onAuxQtyBlur(e) {
    const id = e.currentTarget.dataset.id;
    const fee = this.data.fee;
    if (!fee.auxQty) fee.auxQty = {};
    fee.auxQty[id] = round1(fee.auxQty[id] || 0);   // 工程量保留 1 位小数
    const auxText = Object.assign({}, this.data.auxText);
    auxText[id] = fmt1(fee.auxQty[id]);
    this.setData({ auxText });
    this.persistFee(fee); this.compute();
  },
  onTaxToggle(e) {
    const fee = this.data.fee;
    fee.taxOn = e.detail.value;
    this.persistFee(fee); this.compute();
  },
  onTaxPct(e) {
    const fee = this.data.fee;
    fee.taxPct = parseFloat(e.detail.value) || 0;
    this.persistFee(fee); this.compute();
  },
  onMgrPct(e) {
    const fee = this.data.fee;
    fee.mgrPct = parseFloat(e.detail.value) || 0;
    this.persistFee(fee); this.compute();
  },

  // 查看图纸：进入该空间效果图页（保留已生成图，不重生成）
  viewRender(e) {
    const idx = e.currentTarget.dataset.idx;
    if (this.data.readOnly && this.data.pid) {
      wx.navigateTo({ url: '/pages/result/result?pid=' + this.data.pid + '&si=' + idx });
    } else {
      wx.navigateTo({ url: '/pages/result/result?idx=' + idx });
    }
  },
  // 查看分项：进入该空间预算明细页（主材/施工逐项可改可删）
  viewBudget(e) {
    const idx = e.currentTarget.dataset.idx;
    if (this.data.readOnly && this.data.pid) {
      wx.navigateTo({ url: '/pages/budget/budget?pid=' + this.data.pid + '&si=' + idx });
    } else {
      wx.navigateTo({ url: '/pages/budget/budget?idx=' + idx });
    }
  },
  addMore() {
    wx.reLaunch({ url: '/pages/home/home' });
  },
  backToRecords() {
    wx.reLaunch({ url: '/pages/history/history' });
  },

  // ===== 微信分享 =====
  onShareAppMessage() {
    return { title: '我家装修总预算 ¥' + (this.data.grand || 0) + ' · 算一算装修多少钱', path: '/pages/home/home' };
  },
  onShareTimeline() {
    return { title: '算一算装修要花多少钱 · 多空间汇总一键出总预算' };
  }
});
