const store = require('../../utils/store.js');
const { calcQuote, calcWholeAux } = require('../../utils/quote.js');
const auxRule = require('../../utils/auxrule.js');
const cfg = require('../../utils/config.js');

// 管理后台口令（上线加固：消费者不可进）。要换口令改这里即可
const ADMIN_PASS = '8008';

Page({
  data: {
    projectCount: 0,
    projectTotal: 0,
    baseTotal: 0,
    auxTotal: 0,
    address: '',
    user: null,
    isAdmin: false,      // 本机解锁过口令才显示后台入口；其他人完全看不到
    galleryCount: 0,     // 已生成的效果图张数
    _logoTaps: 0
  },
  onShow() {
    const p = getApp().globalData.project || { spaces: [] };
    // 各空间主材+施工合计（重算，不读旧缓存）
    let base = 0;
    (p.spaces || []).forEach(s => {
      const q = calcQuote(s);
      s.quote = q;
      base += q.total;
    });
    // 辅助项目合计（全屋只计一次，口径与汇总页一致：运输/固定/税金/管理费）
    const fee = p.fee || {};
    const n = (p.spaces || []).length || 1;
    const ruleQty = auxRule.mergeQty(n, fee.auxQty || {});
    const auxRes = calcWholeAux(base, {
      floor: fee.floor || 1,
      taxOn: fee.taxOn !== false,
      taxPct: fee.taxPct != null ? fee.taxPct : 3,
      mgrPct: fee.mgrPct != null ? fee.mgrPct : 10,
      auxQty: ruleQty
    });
    const auxTotal = auxRes.total;
    const total = base + auxTotal;
    const user = store.getUser();
    getApp().globalData.user = user;
    let gCount = 0;
    try { gCount = (require('../../utils/gallery.js').list() || []).length; } catch (e) {}
    this.setData({
      projectCount: (p.spaces || []).length,
      projectTotal: total,
      baseTotal: base,
      auxTotal: auxTotal,
      user, address: p.address || '', isAdmin: wx.getStorageSync('admin_ok') === 1,
      galleryCount: gCount,
      needProfile: !!(user && user.phone && !user.decoType)
    });
  },
  // 隐秘入口：2 秒内连点 logo 5 次 → 唤起管理后台口令（普通用户不可见不可知）
  onLogoTap() {
    const now = Date.now();
    this._lastTap = this._lastTap || 0;
    if (now - this._lastTap > 2000) this.data._logoTaps = 0;
    this._lastTap = now;
    this.data._logoTaps++;
    if (this.data._logoTaps >= 5) {
      this.data._logoTaps = 0;
      this.goAdmin();
    }
  },
  goVoice() {
    wx.navigateTo({ url: '/pages/index/index?entry=voice' });
  },
  goSummary() {
    wx.navigateTo({ url: '/pages/summary/summary' });
  },
  goRegister() {
    wx.navigateTo({ url: '/pages/register/register' });
  },
  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },
  goGallery() {
    wx.navigateTo({ url: '/pages/gallery/gallery' });
  },
  goAdmin() {
    // 口令锁：本机已解锁过直接进；否则弹口令输入（防消费者误入改价）
    if (wx.getStorageSync('admin_ok') === 1) { wx.navigateTo({ url: '/pages/admin/admin' }); return; }
    wx.showModal({
      title: '管理后台',
      content: '请输入管理员口令',
      editable: true,
      placeholderText: '管理员口令',
      success: (r) => {
        if (!r.confirm) return;
        if ((r.content || '').trim() === ADMIN_PASS) {
          wx.setStorageSync('admin_ok', 1);
          this.setData({ isAdmin: true });
          wx.navigateTo({ url: '/pages/admin/admin' });
        } else {
          wx.showToast({ title: '口令不对', icon: 'none' });
        }
      }
    });
  },
  reset() {
    const app = getApp();
    const pid = app.globalData.project && app.globalData.project.id;
    app.globalData.project = { customer: '', spaces: [] };
    app.globalData.curIdx = -1;
    // 同步删掉本地存档，否则下次启动 app.restoreProject() 会把刚清空的清单又恢复回来
    try { if (pid) store.deleteProject(pid); } catch (e) {}
    this.setData({ projectCount: 0, projectTotal: 0 });
    wx.showToast({ title: '已清空清单', icon: 'none' });
  },
  // ===== 微信分享 =====
  onShareAppMessage() {
    return { title: '算一算装修要花多少钱 · 声控量房一键出预算', path: '/pages/home/home' };
  },
  onShareTimeline() {
    return { title: '算一算装修要花多少钱 · 声控量房一键出预算' };
  }
});
