const cfg = require('../../utils/config.js');
const { round1, fmt1 } = require('../../utils/num.js');
const brands = require('../../utils/brands.js');
const store = require('../../utils/store.js');
const quota = require('../../utils/renderquota.js');
const VER = require('../../version.js');
const csnap = require('../../utils/configsnap.js');

const ADMIN_TOKEN = 'admin123';   // 演示口令；正式版走后端校验
const API_BASE = '';               // 填后端地址(含 https)则同时保存到服务端
const BACKUP_KEY = 'config_backup_history';
const BACKUP_MAX = 30;             // 最多保留 30 份快照

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function r2(n) { return Math.round(Number(n) || 0); }

Page({
  data: {
    token: '', logged: false,
    verText: 'v' + VER.version + ' · ' + VER.date,   // 手机上看得到自己跑的是哪一版
    cloudSnaps: [], cloudLoading: false,             // 云端备份列表
    cfgObj: null, tiers: [], adFees: [],
    spaceKeys: [], spaceNames: {},
    activeSpace: 'kitchen', items: [],
    newItem: { name: '', unit: '', econ: '', qty: '1', kind: 'material' },
    auxItems: [],
    newAux: { name: '', val: '', kind: 'fixed', whole: false },
    jsonText: '', msg: '',
    backups: [],           // 历史备份（每次保存自动留底）
    dragIdx: null, dragTarget: null,   // 拖动排序的当前项与目标位置
    apiCfg: { endpoint: '', apiKey: '', model: '' },   // 生图 API（存 storage，不进 config 价格数据）
    apiMsg: '',            // 生图 API 卡片的即时状态提示
    pending: [],           // 待审核材料商
    leads: [],             // 客资（业主留资线索）
    adminKey: '', syncing: false, syncMsg: '',   // 云端客资同步
    leadCount: 0, leadToday: 0,
    payIntentCount: 0, payIntentText: '',  // 效果图付费意向（支付未开通期间的点击）
    quotaText: '0 张'
  },

  onLoad() {
    let k = '';
    try { k = wx.getStorageSync('admin_key_v1') || ''; } catch (e) {}
    this.setData({ adminKey: k });
    this.loadLocal(); this.loadPending(); this.loadLeads(); this.refreshQuota();
  },

  // ===== 效果图额度（免费已取消，仅老板验收用）=====
  refreshQuota() {
    const s = quota.status();
    this.setData({ quotaText: s.balance > 0 ? (s.balance + ' 张（套餐余额）') : '0 张（消费者不可生成）' });
    // 额度真身在服务端，再校准一次
    quota.sync().then(st => {
      this.setData({ quotaText: st.balance > 0 ? (st.balance + ' 张（套餐余额）') : '0 张（消费者不可生成）' });
    }).catch(() => {});
  },
  addQuota() {
    quota.addBalance(10).then(st => {
      this.setData({ quotaText: st.balance > 0 ? (st.balance + ' 张（套餐余额）') : '0 张' });
      wx.showToast({ title: '已加 10 张', icon: 'success' });
    });
  },
  resetQuota() {
    wx.showModal({
      title: '清零效果图额度？',
      content: '用于模拟普通消费者：一张都生成不了。已生成过的效果图不受影响。',
      success: r => {
        if (!r.confirm) return;
        quota.clearBalance();
        this.refreshQuota();
        wx.showToast({ title: '已清零', icon: 'none' });
      }
    });
  },

  // ===== 客资台（D-006：小程序漏斗最后一步收电话）=====
  loadLeads() {
    const pad = n => (n < 10 ? '0' : '') + n;
    const list = (store.getLeads() || []).map(x => {
      const ts = Number(x.createdAt || x.time || 0);
      const d = new Date(ts);
      return Object.assign({}, x, {
        ts,
        timeText: ts ? ((d.getMonth() + 1) + '-' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())) : '—',
        typeText: x.decoTypeName || (x.decoType === 'whole' ? '整装' : (x.decoType === 'partial' ? '局改' : '未填')),
        cityText: x.city || '—',
        areaText: x.area ? (x.area + '㎡') : '—'
      });
    });
    const today = new Date().setHours(0, 0, 0, 0);
    // 付费意向：支付通道未开通期间，客户点套餐的记录 —— 用来判断"愿不愿意掏钱"
    let intents = [];
    try { intents = require('../../utils/renderquota.js').getIntents(); } catch (e) {}
    const last = intents[0];
    this.setData({
      leads: list,
      leadCount: list.length,
      leadToday: list.filter(x => (x.ts || 0) >= today).length,
      payIntentCount: intents.length,
      payIntentText: last ? (last.count + ' 张 ¥' + (last.price / 100).toFixed(2)) : ''
    });
  },
  // ===== 云端客资（客户留的电话在服务器上，换手机也能拉回来）=====
  onAdminKey(e) {
    const v = (e.detail.value || '').trim();
    this.setData({ adminKey: v });
    try { wx.setStorageSync('admin_key_v1', v); } catch (err) {}
  },

  syncLeads() {
    const key = (this.data.adminKey || '').trim();
    if (!key) { wx.showToast({ title: '先填云端口令', icon: 'none' }); return; }
    this.setData({ syncing: true, syncMsg: '' });
    let API = 'https://room-rchx.onrender.com';
    try { API = require('../../utils/wxauth.js').API || API; } catch (err) {}
    wx.request({
      url: API + '/api/leads?limit=200&key=' + encodeURIComponent(key),
      timeout: 20000,
      success: r => {
        const d = r.data || {};
        if (!d.ok) { this.setData({ syncing: false, syncMsg: '拉取失败：' + (d.error || r.statusCode) }); return; }
        const pad = n => (n < 10 ? '0' : '') + n;
        const list = (d.list || []).map(x => {
          const ts = Number(x.createdAt || 0);
          const dt = new Date(ts);
          return Object.assign({}, x, {
            ts,
            timeText: ts ? ((dt.getMonth() + 1) + '-' + dt.getDate() + ' ' + pad(dt.getHours()) + ':' + pad(dt.getMinutes())) : '—',
            typeText: x.decoTypeName || (x.decoType === 'whole' ? '整装' : (x.decoType === 'partial' ? '局改' : '未填')),
            cityText: x.city || '—',
            areaText: x.area ? (x.area + '㎡') : '—'
          });
        });
        const today = new Date().setHours(0, 0, 0, 0);
        this.setData({
          syncing: false,
          leads: list,
          leadCount: list.length,
          leadToday: list.filter(x => (x.ts || 0) >= today).length,
          syncMsg: '云端累计 ' + (d.count || list.length) + ' 条，已拉取 ' + list.length + ' 条'
        });
      },
      fail: e => this.setData({ syncing: false, syncMsg: '网络异常：' + (e.errMsg || '') })
    });
  },

  callLead(e) {
    const phone = e.currentTarget.dataset.phone;
    if (!phone) return;
    wx.makePhoneCall({ phoneNumber: String(phone) });
  },
  copyLead(e) {
    const phone = e.currentTarget.dataset.phone;
    if (!phone) return;
    wx.setClipboardData({ data: String(phone) });
  },
  delLead(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这条客资？',
      content: '删除后不可恢复',
      success: r => { if (r.confirm) this.setData({ leads: store.deleteLead(id) }); this.loadLeads(); }
    });
  },

  // ===== 材料商审核：确认费用到账 + 资料完整后上架 =====
  loadPending() {
    const list = brands.pendingBrands().map(b => ({
      id: b.id,
      supplier: b.supplier,
      contact: b.contact,
      phone: b.phone,
      feePlan: b.feePlan === 'year' ? '3000元/年' : '300元/月',
      paid: !!b.paid,
      payText: b.paid ? '已在线支付' : '未付款（需线下确认）',
      qrCode: b.qrCode || '',
      productCount: (b.products || []).length,
      products: (b.products || []).map(p => p.brand + '(' + (p.tier === 'top' ? '轻奢' : p.tier === 'mid' ? '舒适' : '经济') + '·¥' + p.price + '/' + (p.unit || '') + ')')
    }));
    this.setData({ pending: list });
  },
  approveBrandAct(e) {
    const id = e.currentTarget.dataset.id;
    brands.approveBrand(id);
    this.loadPending();
    wx.showToast({ title: '已上架', icon: 'success' });
  },
  rejectBrandAct(e) {
    const id = e.currentTarget.dataset.id;
    brands.rejectBrand(id);
    this.loadPending();
    wx.showToast({ title: '已驳回', icon: 'none' });
  },

  loadLocal() {
    const obj = { tiers: clone(cfg.tiers()), adFee: clone(cfg.adFeeMap()), aux: clone(cfg.aux()), spaces: clone(cfg.spaces()) };
    const tiers = cfg.tierList().map(k => ({ id: k, name: obj.tiers[k].name }));
    const adFees = cfg.tierList().map(k => ({ id: k, name: obj.tiers[k].name, fee: obj.adFee[k] || 0 }));
    const spaceKeys = cfg.spaceKeys();
    const spaceNames = {};
    spaceKeys.forEach(k => { spaceNames[k] = (obj.spaces[k] || {}).name || k; });
    this.setData({ cfgObj: obj, tiers, adFees, spaceKeys, spaceNames, activeSpace: spaceKeys[0] });
    this.buildItems();
    this.buildAux();
    this.loadBackups();   // 载入历史备份列表
    // 生图 API 配置（storage 独立键，与价格数据隔离）
    let apiCfg = null;
    try { apiCfg = wx.getStorageSync('render_api_cfg') || null; } catch (e) {}
    if (apiCfg) {
      const k = apiCfg.apiKey || '';
      this.setData({
        apiCfg: { endpoint: apiCfg.endpoint || '', apiKey: k, model: apiCfg.model || '' },
        apiMsg: k ? ('已配置：' + (apiCfg.model || '默认模型') + ' · Key ' + k.slice(0, 6) + '…' + k.slice(-4)) : '尚未配置，效果图无法生成'
      });
    } else {
      this.setData({ apiMsg: '尚未配置，效果图无法生成' });
    }
  },

  // ===== 生图 API 配置 =====
  onApiField(e) {
    const key = e.currentTarget.dataset.key;
    const apiCfg = Object.assign({}, this.data.apiCfg);
    apiCfg[key] = e.detail.value;
    this.setData({ apiCfg });
  },

  saveApiCfg() {
    const { endpoint, apiKey, model } = this.data.apiCfg || {};
    // 先给即时反馈：点下去必须看得见反应
    wx.showLoading({ title: '保存中', mask: true });
    setTimeout(() => wx.hideLoading(), 400);
    if (!apiKey || !String(apiKey).trim()) {
      const t = '请先填 API Key';
      this.setData({ apiMsg: '生图 API：API Key 必填' });
      wx.showToast({ title: t, icon: 'none' });
      return;
    }
    const ep = (endpoint || '').trim();
    const md = (model || '').trim() || 'doubao-seedream-5-0-pro-260628';   // 默认豆包 Seedream 5.0 pro（火山方舟）
    // 豆包 Key 固定以 ark- 开头；填成"密钥名称"会 401，提前拦住
    if (/^doubao-/i.test(md) && !/^ark-/i.test(String(apiKey).trim())) {
      const t = 'Key 格式不对：豆包 Key 应以 ark- 开头，你填的可能是「密钥名称」';
      this.setData({ apiMsg: t });
      wx.showToast({ title: 'Key 应以 ark- 开头', icon: 'none' });
      return;
    }
    // 豆包（doubao-*）直连火山方舟、通义万相（wan*）直连百炼，地址都可留空自动推导；其他接口商必须填完整地址
    if (!ep && !/^wan/i.test(md) && !/^doubao-/i.test(md)) {
      this.setData({ apiMsg: '生图 API：该模型需要填写接口地址' });
      wx.showToast({ title: '该模型需要填接口地址', icon: 'none' });
      return;
    }
    wx.setStorageSync('render_api_cfg', { endpoint: ep, apiKey: String(apiKey).trim(), model: md });
    const tip = '已保存：' + md;
    this.setData({ apiMsg: tip, msg: tip, apiCfg: { endpoint: ep, apiKey: String(apiKey).trim(), model: md } });
    wx.showToast({ title: '保存成功', icon: 'success' });
  },

  goQtyRules() { wx.navigateTo({ url: '/pages/qtyrules/qtyrules' }); },

  // 把当前编辑态 items 合并回 cfgObj.spaces[activeSpace]
  mergeItemsToSpace() {
    const { cfgObj, activeSpace, items } = this.data;
    const obj = cfgObj;
    const mats = [], labs = [];
    items.filter(it => !it.removed).forEach(it => {
      const econ = r2(it.econ), qty = r2(it.qty);
      const rec = { id: it.id, name: it.name, unit: it.unit, price: econ, qty, on: it.on !== false, group: it.group || undefined };
      const prices = {};
      if (it.kind === 'material') {
        // 舒适/轻奢价以手动录入为准；倍率自动乘法已删除
        if (Number(it.mid) && Number(it.mid) !== econ) prices.mid = Number(it.mid);
        if (Number(it.top) && Number(it.top) !== econ) prices.top = Number(it.top);
      }
      if (Object.keys(prices).length) rec.prices = prices;
      (it.kind === 'material' ? mats : labs).push(rec);
    });
    obj.spaces[activeSpace].materials = mats;
    obj.spaces[activeSpace].labor = labs;
    this.setData({ cfgObj: obj });
  },

  // 由 cfgObj.spaces[activeSpace] 生成可编辑 items
  buildItems() {
    const { cfgObj, activeSpace } = this.data;
    const space = (cfgObj.spaces || {})[activeSpace];
    if (!space) return;
    const items = [];
    const push = (kind, arr) => (arr || []).forEach(m => {
      const econ = m.price != null ? m.price : 0;
      items.push({
        space: activeSpace, kind,
        id: m.id || ('c' + Math.random().toString(36).slice(2, 8)),
        name: m.name || '', unit: m.unit || '', qty: m.qty != null ? m.qty : 0,
        on: m.on !== false, group: m.group || '',
        econ,
        mid: (m.prices && m.prices.mid != null) ? m.prices.mid : '',
        top: (m.prices && m.prices.top != null) ? m.prices.top : '',
        removed: false
      });
    });
    push('material', space.materials);
    push('labor', space.labor);
    this.setData({ items });
  },

  onToken(e) { this.setData({ token: e.detail.value }); },
  login() {
    if (this.data.token === ADMIN_TOKEN) {
      this.setData({ logged: true, msg: '' });
      this.loadCloudSnaps();
    } else this.setData({ msg: '口令错误（演示口令 admin123）' });
  },

  // ===== 云端备份 =====
  loadCloudSnaps() {
    this.setData({ cloudLoading: true });
    csnap.list().then(l => {
      this.setData({
        cloudSnaps: (l || []).map(x => Object.assign({}, x, { timeText: csnap.fmtTime(x.at) })),
        cloudLoading: false
      });
    }).catch(() => this.setData({ cloudLoading: false }));
  },
  backupCloudNow() {
    this.mergeItemsToSpace();
    this.mergeAux();
    const obj = this.data.cfgObj;
    csnap.save(obj, '手动备份').then(r => {
      if (!r) { wx.showToast({ title: '未登录，无法备份', icon: 'none' }); return; }
      wx.showToast({ title: '已备份到云端', icon: 'success' });
      this.loadCloudSnaps();
    }).catch(e => wx.showToast({ title: '备份失败：' + ((e && e.message) || ''), icon: 'none' }));
  },
  restoreCloud(e) {
    const ts = Number(e.currentTarget.dataset.ts);
    wx.showModal({
      title: '从云端恢复？',
      content: '会用这份快照覆盖当前规则。想保险的话，先点一次「立即备份到云端」把当前状态留底。',
      success: r => {
        if (!r.confirm) return;
        wx.showLoading({ title: '读取中', mask: true });
        csnap.get(ts).then(data => {
          wx.hideLoading();
          if (!data) { wx.showToast({ title: '读取失败', icon: 'none' }); return; }
          cfg.setOverride(data);
          try { wx.setStorageSync('config_override_v2', data); } catch (err) {}
          this.setData({ cfgObj: data, activeSpace: cfg.spaceKeys()[0] });
          this.buildItems();
          this.buildAux();
          this.pushBackup(data);   // 本地也留一份，方便再退回
          this.loadBackups();
          wx.showToast({ title: '已从云端恢复', icon: 'success' });
        }).catch(err => {
          wx.hideLoading();
          wx.showToast({ title: '恢复失败：' + ((err && err.message) || ''), icon: 'none' });
        });
      }
    });
  },

  onSelectSpace(e) {
    this.mergeItemsToSpace();
    const activeSpace = e.currentTarget.dataset.k;
    this.setData({ activeSpace, msg: '' });
    this.buildItems();
  },

  // ===== 辅助费用（运输/垃圾/保护/保洁/税金/管理费）=====
  buildAux() {
    const list = (this.data.cfgObj.aux || []).map(a => Object.assign({}, a));
    this.setData({ auxItems: list });
  },
  mergeAux() {
    const obj = this.data.cfgObj;
    obj.aux = this.data.auxItems.filter(it => !it.removed).map(it => {
      const rec = {
        id: it.id, name: it.name, kind: it.kind,
        on: it.on !== false, whole: !!it.whole
      };
      if (it.kind === 'floor') rec.rate = Number(it.rate) || 0;
      else rec.val = Number(it.val) || 0;
      return rec;
    });
    this.setData({ cfgObj: obj });
  },
  onAuxField(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const key = e.currentTarget.dataset.key;
    const auxItems = this.data.auxItems.slice();
    auxItems[idx][key] = e.detail.value;
    this.setData({ auxItems });
  },
  onAuxToggle(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const auxItems = this.data.auxItems.slice();
    auxItems[idx].on = e.detail.value;
    this.setData({ auxItems });
  },
  onAuxDel(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const auxItems = this.data.auxItems.slice();
    auxItems.splice(idx, 1);
    this.setData({ auxItems });
  },
  onAuxKind(e) {
    const k = e.detail.value === 0 ? 'fixed' : (e.detail.value === 1 ? 'pct' : 'floor');
    this.setData({ newAux: Object.assign({}, this.data.newAux, { kind: k }) });
  },
  onAuxWhole(e) { this.setData({ newAux: Object.assign({}, this.data.newAux, { whole: e.detail.value }) }); },
  onAuxNewName(e) { this.setData({ newAux: Object.assign({}, this.data.newAux, { name: e.detail.value }) }); },
  onAuxNewVal(e) { this.setData({ newAux: Object.assign({}, this.data.newAux, { val: e.detail.value }) }); },
  addAux() {
    const n = this.data.newAux;
    if (!n.name) { wx.showToast({ title: '请填费用名称', icon: 'none' }); return; }
    const auxItems = this.data.auxItems.slice();
    const rec = {
      id: 'a' + Date.now(), name: n.name, kind: n.kind,
      on: true, whole: !!n.whole, removed: false
    };
    if (n.kind === 'floor') rec.rate = Number(n.val) || 0;
    else rec.val = Number(n.val) || 0;
    auxItems.push(rec);
    this.setData({ auxItems, newAux: { name: '', val: '', kind: 'fixed', whole: false } });
    wx.showToast({ title: '已加入', icon: 'success' });
  },

  // 倍率功能已删除：三档均以手动录入价计算，故不再提供倍率编辑
  onTierName() {},
  onFee(e) {
    const id = e.currentTarget.dataset.id;
    const v = parseFloat(e.detail.value) || 0;
    const obj = this.data.cfgObj;
    obj.adFee[id] = v;
    const adFees = this.data.adFees.map(t => t.id === id ? { ...t, fee: v } : t);
    this.setData({ cfgObj: obj, adFees });
  },

  onField(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const key = e.currentTarget.dataset.key;
    const items = this.data.items.slice();
    items[idx][key] = e.detail.value;
    if (key === 'qty') items[idx].qtyText = e.detail.value;   // 输入中保留原样，失焦才格式化
    this.setData({ items });
  },
  onItemQtyBlur(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const items = this.data.items.slice();
    if (!items[idx]) return;
    items[idx].qty = round1(items[idx].qty);   // 工程量保留 1 位小数
    this.setData({ items });
  },
  onToggle(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const items = this.data.items.slice();
    items[idx].on = e.detail.value;
    this.setData({ items });
  },
  onDel(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const items = this.data.items.slice();
    items.splice(idx, 1);
    this.setData({ items });
  },
  moveItem(e) {
    const dir = e.currentTarget.dataset.dir;
    const idx = Number(e.currentTarget.dataset.idx);
    const items = this.data.items.slice();
    const j = dir === 'up' ? idx - 1 : idx + 1;
    if (j < 0 || j >= items.length) return;
    const t = items[idx]; items[idx] = items[j]; items[j] = t;
    this.setData({ items });
  },

  // ===== 拖动排序：按住左侧 ⠿ 上下拖动调整项目顺序 =====
  onDragStart(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.setData({ dragIdx: idx, dragTarget: idx });
    // 缓存每个项目行的位置，用于拖动时命中目标行
    wx.createSelectorQuery().selectAll('.proj-item').boundingClientRect().exec(res => {
      const rects = (res && res[0]) || [];
      this._tops = rects.map(r => r.top);
      this._heights = rects.map(r => r.height);
    });
  },
  onDragMove(e) {
    if (this.data.dragIdx == null || !this._tops) return;
    const y = e.touches[0].clientY;
    const tops = this._tops, heights = this._heights;
    let target = tops.length - 1;
    for (let i = 0; i < tops.length; i++) {
      if (y < tops[i] + heights[i] / 2) { target = i; break; }
    }
    if (target !== this.data.dragTarget) this.setData({ dragTarget: target });
  },
  onDragEnd() {
    const { dragIdx, dragTarget, items } = this.data;
    if (dragIdx == null) return;
    if (dragTarget != null && dragTarget !== dragIdx) {
      const arr = items.slice();
      const [m] = arr.splice(dragIdx, 1);
      arr.splice(dragTarget, 0, m);
      this.setData({ items: arr, dragIdx: null, dragTarget: null });
    } else {
      this.setData({ dragIdx: null, dragTarget: null });
    }
  },

  // ===== 复制项目到其他空间 =====
  onCopyItem(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const { spaceKeys, spaceNames, activeSpace, items } = this.data;
    const others = spaceKeys.filter(k => k !== activeSpace);
    if (!others.length) { wx.showToast({ title: '没有其他空间', icon: 'none' }); return; }
    wx.showActionSheet({
      itemList: others.map(k => '复制到「' + spaceNames[k] + '」'),
      success: (r) => {
        if (r.tapIndex < 0) return;
        this.copyItemTo(items[idx], others[r.tapIndex]);
      }
    });
  },
  copyItemTo(src, targetKey) {
    const obj = this.data.cfgObj;
    const sp = obj.spaces[targetKey];
    if (!sp) return;
    const isMat = src.kind === 'material';
    const arr = (isMat ? (sp.materials || []) : (sp.labor || [])).slice();
    const copy = {
      id: 'c' + Date.now() + Math.floor(Math.random() * 1000),
      name: src.name || '', unit: src.unit || '', price: r2(src.econ), qty: r2(src.qty),
      on: src.on !== false
    };
    const prices = {};
    if (isMat) {
      if (Number(src.mid)) prices.mid = Number(src.mid);
      if (Number(src.top)) prices.top = Number(src.top);
    }
    if (Object.keys(prices).length) copy.prices = prices;
    arr.push(copy);
    if (isMat) sp.materials = arr; else sp.labor = arr;
    this.setData({ cfgObj: obj });
    wx.showToast({ title: '已复制到' + this.data.spaceNames[targetKey], icon: 'none' });
  },

  onNewKind(e) { this.setData({ newItem: Object.assign({}, this.data.newItem, { kind: e.detail.value === 0 ? 'material' : 'labor' }) }); },
  onNewName(e) { this.setData({ newItem: Object.assign({}, this.data.newItem, { name: e.detail.value }) }); },
  onNewUnit(e) { this.setData({ newItem: Object.assign({}, this.data.newItem, { unit: e.detail.value }) }); },
  onNewEcon(e) { this.setData({ newItem: Object.assign({}, this.data.newItem, { econ: e.detail.value }) }); },
  onNewQty(e) { this.setData({ newItem: Object.assign({}, this.data.newItem, { qty: e.detail.value }) }); },
  // 失焦时把数量规范化，避免 "1." / 空值 被当工程量存进去
  onNewQtyBlur(e) {
    const v = parseFloat(e.detail.value);
    const q = isNaN(v) || v < 0 ? 1 : v;
    this.setData({ newItem: Object.assign({}, this.data.newItem, { qty: String(q), qtyText: '' }) });
  },
  addItem() {
    const n = this.data.newItem;
    if (!n.name) { wx.showToast({ title: '请填项目名称', icon: 'none' }); return; }
    const items = this.data.items.slice();
    items.push({
      space: this.data.activeSpace, kind: n.kind,
      id: 'c' + Date.now(),
      name: n.name, unit: n.unit || '项', qty: r2(n.qty),
      on: true, econ: r2(n.econ), mid: '', top: '', removed: false
    });
    this.setData({ items, newItem: { name: '', unit: '', econ: '', qty: '1', kind: 'material' } });
    wx.showToast({ title: '已加入', icon: 'success' });
  },

  // ===== 历史备份（每次保存自动留底）=====
  fmtTime(ts) {
    const d = new Date(ts);
    const p = n => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  },
  summaryOf(obj) {
    const s = obj.spaces || {};
    let total = 0;
    const parts = Object.keys(s).map(k => {
      const sp = s[k] || {};
      const m = (sp.materials || []).length;
      const l = (sp.labor || []).length;
      total += m + l;
      return (sp.name || k) + ' ' + m + '+' + l;
    });
    return { total, text: parts.join('  ') };
  },
  pushBackup(obj) {
    try {
      const hist = wx.getStorageSync(BACKUP_KEY) || [];
      const ts = Date.now();
      const sum = this.summaryOf(obj);
      hist.push({ ts, label: this.fmtTime(ts), total: sum.total, text: sum.text, data: clone(obj) });
      while (hist.length > BACKUP_MAX) hist.shift();
      wx.setStorageSync(BACKUP_KEY, hist);
    } catch (e) {}
  },
  loadBackups() {
    let hist = [];
    try { hist = wx.getStorageSync(BACKUP_KEY) || []; } catch (e) {}
    hist = hist.slice().reverse();   // 最新在前
    this.setData({ backups: hist });
  },
  restoreBackup(e) {
    const ts = Number(e.currentTarget.dataset.ts);
    let entry = null;
    try {
      const hist = wx.getStorageSync(BACKUP_KEY) || [];
      entry = hist.find(h => h.ts === ts);
    } catch (err) {}
    if (!entry) { wx.showToast({ title: '备份不存在', icon: 'none' }); return; }
    wx.showModal({
      title: '恢复到此备份？',
      content: entry.label + '\n' + entry.text,
      success: (r) => {
        if (!r.confirm) return;
        const obj = clone(entry.data);
        cfg.setOverride(obj);
        try { wx.setStorageSync('config_override_v2', obj); } catch (err) {}
        this.setData({ cfgObj: obj, activeSpace: cfg.spaceKeys()[0] });
        this.buildItems();
        this.buildAux();
        this.pushBackup(obj);   // 记录一次恢复动作
        this.loadBackups();
        wx.showToast({ title: '已恢复并应用', icon: 'success' });
      }
    });
  },
  clearBackups() {
    wx.showModal({
      title: '清空全部备份？',
      content: '不可恢复，仅清空历史列表，不影响当前数据。',
      success: (r) => {
        if (!r.confirm) return;
        try { wx.removeStorageSync(BACKUP_KEY); } catch (err) {}
        this.setData({ backups: [] });
        wx.showToast({ title: '已清空', icon: 'none' });
      }
    });
  },

  save() {
    this.mergeItemsToSpace();
    this.mergeAux();
    const obj = this.data.cfgObj;
    cfg.setOverride(obj);
    try { wx.setStorageSync('config_override_v2', obj); } catch (e) {}
    this.pushBackup(obj);        // 自动留底
    this.loadBackups();
    // 同步一份到云端：这手机以外的第二份，清缓存/换手机才救得回来
    csnap.save(obj, '保存')
      .then(() => this.loadCloudSnaps())
      .catch(() => {});          // 网络异常不影响本地保存
    if (API_BASE) {
      wx.request({ url: API_BASE + '/api/admin/config', method: 'PUT', data: obj, header: { 'x-admin-token': this.data.token } });
    }
    this.setData({ jsonText: JSON.stringify(obj, null, 2), msg: '已保存并即时生效（下次启动自动加载），已自动留底一份快照' });
    wx.showToast({ title: '已保存', icon: 'success' });
  },
  copyJson() {
    this.mergeItemsToSpace();
    this.mergeAux();
    wx.setClipboardData({ data: JSON.stringify(this.data.cfgObj, null, 2) });
    wx.showToast({ title: '已复制完整规则', icon: 'none' });
  }
});
