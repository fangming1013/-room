// 留资页（老板 2026-10-21 定：进入 → 录尺寸 → 点生成 → 强制注册 → 出预算）
// 采集内容一次到位：城市(选择) / 整装或局改(二选一) / 面积(自动带出可改) / 手机号(一键授权) / 称呼(可选)
// 主路径：微信「手机号快速验证」组件一键授权 → 后端换真实手机号
// 兜底路径：组件不可用/未开通/后端未部署时，退回手动输入手机号，流程不中断
const store = require('../../utils/store.js');
const sf = require('../../utils/siliconflow.js');
const { calcQuote } = require('../../utils/quote.js');

const CITIES = ['上海', '杭州', '苏州', '南京', '北京', '深圳', '广州', '成都', '武汉', '其他'];

Page({
  data: {
    name: '',
    phone: '',
    city: '上海',
    cityOther: false,
    cities: CITIES,
    decoType: '',          // 'partial' 局改 / 'whole' 整装 —— 二选一，不预选，保证数据真实
    areaText: '',          // 面积（㎡），按录入尺寸自动算
    areaAuto: false,       // 是否自动算出（true 时显示"已按尺寸自动计算"）
    areaEdit: false,       // 客户手动改面积
    err: '',
    loading: false,
    manual: false          // 是否走手动输入（授权失败或用户主动选择）
  },

  onLoad(options) {
    this._from = (options && options.from) || '';
    this._loadArea();
    this._loadUser();
  },

  // 已注册过的话带出旧资料，避免重复填
  _loadUser() {
    const u = store.getUser();
    if (!u) return;
    this.setData({
      name: u.name && u.name !== '业主' ? u.name : '',
      phone: u.phone || '',
      city: u.city || '上海',
      decoType: u.decoType || ''
    });
  },

  // 面积自动带出：优先当前正在生成的空间，其次整个项目汇总
  _loadArea() {
    const g = (getApp() && getApp().globalData) || {};
    const cur = g.space;
    const spaces = ((g.project || {}).spaces || []).slice();
    const merged = spaces.map(s => ({ w: s.w, d: s.d, key: s.key }));
    // 当前空间若还没并入项目，也要算进来
    if (cur && !merged.some(s => s.key && cur.key && s.key === cur.key)) {
      merged.push({ w: cur.w, d: cur.d, key: cur.key });
    }
    let a = 0;
    merged.forEach(s => { a += ((Number(s.w) || 0) * (Number(s.d) || 0)) / 10000; });
    a = Math.round(a * 10) / 10;
    this.setData({ areaText: a > 0 ? String(a) : '', areaAuto: a > 0 });
  },

  onName(e) { this.setData({ name: e.detail.value }); },
  onPhone(e) { this.setData({ phone: e.detail.value }); },
  onArea(e) { this.setData({ areaText: e.detail.value }); },

  pickCity(e) {
    const c = e.currentTarget.dataset.c;
    if (c === '其他') this.setData({ cityOther: true, city: '' });
    else this.setData({ city: c, cityOther: false, err: '' });
  },
  onCity(e) { this.setData({ city: e.detail.value }); },

  pickType(e) {
    this.setData({ decoType: e.currentTarget.dataset.t, err: '' });
  },

  editArea() { this.setData({ areaEdit: true, areaAuto: false }); },

  useManual() { this.setData({ manual: true, err: '' }); },

  openAgreement() { wx.navigateTo({ url: '/pages/agreement/agreement' }); },
  openPrivacy() {
    if (typeof wx.openPrivacyContract === 'function') wx.openPrivacyContract();
    else wx.showToast({ title: '请在微信「设置-隐私」中查看', icon: 'none' });
  },

  // 微信手机号快速验证回调：e.detail.code 交给后端换手机号
  onGetPhone(e) {
    const d = e.detail || {};
    if (!d.code) {
      this.setData({ manual: true, err: '未获取到手机号授权，请手动填写' });
      return;
    }
    this.setData({ loading: true, err: '' });
    wx.request({
      url: sf.PROXY_BASE + '/api/lead',
      method: 'POST',
      timeout: 20000,
      header: { 'Content-Type': 'application/json' },
      data: { phoneCode: d.code },
      success: r => {
        const res = r.data || {};
        if (res.ok && res.phone) {
          this._commit(res.phone);
        } else {
          this.setData({ loading: false, manual: true, err: (res.error || '手机号授权失败') + '，请手动填写' });
        }
      },
      fail: () => this.setData({ loading: false, manual: true, err: '网络异常，请手动填写手机号' })
    });
  },

  // 手动兜底
  submit() {
    if (!this._checkType()) return;
    const phone = (this.data.phone || '').trim();
    if (!/^\d{6,15}$/.test(phone)) { wx.showToast({ title: '请输入正确手机号', icon: 'none' }); return; }
    this._commit(phone);
  },

  _checkType() {
    if (!this.data.decoType) {
      this.setData({ err: '请先选择「整装」或「局改」' });
      wx.showToast({ title: '请先选择整装或局改', icon: 'none' });
      return false;
    }
    if (this.data.cityOther && !(this.data.city || '').trim()) {
      this.setData({ err: '请填写您所在的城市' });
      return false;
    }
    return true;
  },

  getTypeName() {
    return this.data.decoType === 'whole' ? '整装' : (this.data.decoType === 'partial' ? '局改' : '');
  },

  // 落库：一次采全，避免以后反复改数据结构
  _commit(phone) {
    if (!this._checkType()) { this.setData({ loading: false }); return; }
    const name = (this.data.name || '').trim() || '业主';
    const city = (this.data.city || '').trim() || '上海';
    const decoType = this.data.decoType;
    const typeName = this.getTypeName();
    const app = getApp();
    const proj = (app && app.globalData && app.globalData.project) || {};
    const list = (proj.spaces || []).slice();
    const cur = app && app.globalData ? app.globalData.space : null;
    if (cur && !list.some(s => s.key && cur.key && s.key === cur.key)) list.push(cur);

    let budget = 0, area = 0;
    const spaces = list.map(s => {
      let b = 0;
      try { b = Math.round(calcQuote(s).total); } catch (e) {}
      budget += b;
      const w = Number(s.w) || 0, d = Number(s.d) || 0;
      area += (w * d) / 10000;                    // 尺寸单位 cm → ㎡
      return { key: s.key || '', name: s.name || '', w: w, d: d, h: Number(s.h) || 0, budget: b };
    });

    // 面积以客户确认/手填的为准（自动算出的值在 areaText 里）
    const areaInput = parseFloat(this.data.areaText);
    const areaFinal = !isNaN(areaInput) && areaInput > 0 ? Math.round(areaInput * 10) / 10 : Math.round(area * 10) / 10;

    const lead = {
      id: 'L' + Date.now(),
      name: name,
      phone: phone,
      city: city,
      decoType: decoType,                 // 'whole' | 'partial'
      decoTypeName: typeName,             // 整装 / 局改，方便后台直接看
      // 需求画像（用户无感采集）
      spaceCount: spaces.length,
      spaces: spaces,
      area: areaFinal,
      budget: budget,
      // 元数据
      source: 'mini-register',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'new'                        // new / contacted / quoted / signed / lost
    };

    const user = { name, phone, city, decoType, decoTypeName: typeName, area: areaFinal };
    store.setUser(user);
    if (app) app.globalData.user = user;
    store.addLead(lead);

    // 上报服务端（客资台/云开发接入后在此统一发送，失败不影响本地留存）
    try { this._upload(lead); } catch (e) {}

    this.setData({ loading: false, err: '' });
    wx.showToast({ title: '已获取报价', icon: 'success' });
    setTimeout(() => {
      const pages = getCurrentPages();
      if (pages.length > 1) wx.navigateBack();
      else wx.reLaunch({ url: '/pages/home/home' });
    }, 600);
  },

  // 上报：优先客资台（配置见 utils/leadapi.js）；未配置则静默跳过
  _upload(lead) {
    const api = require('../../utils/leadapi.js');
    if (!api || !api.enabled()) return;
    api.push(lead).catch(() => {});
  }
});
