const store = require('../../utils/store.js');

function fmt(t) {
  if (!t) return '';
  const d = new Date(t);
  const p = n => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

Page({
  data: { list: [], empty: true, grand: 0 },
  onShow() {
    const list = (store.getProjects() || []).map(r => Object.assign({}, r, {
      timeStr: fmt(r.time),
      spaceNames: (r.spaces || []).map(s => s.name).join('、'),
      spaceCount: (r.spaces || []).length
    }));
    const grand = list.reduce((s, r) => s + (r.grand || 0), 0);
    this.setData({ list, empty: list.length === 0, grand });
  },
  // 点项目卡片 → 查看该次项目的合并总预算（含各空间 + 辅助/税/管）
  openRecord(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/summary/summary?pid=' + id });
  },
  clear() {
    wx.showModal({
      title: '清空记录', content: '确定清空全部项目记录？',
      success: (res) => { if (res.confirm) { store.clearProjects(); this.setData({ list: [], empty: true, grand: 0 }); } }
    });
  },
  delRecord(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除该项目', content: '确定删除这条项目预算记录？',
      success: (res) => {
        if (!res.confirm) return;
        const list = store.deleteProject(id).map(r => {
          const o = Object.assign({}, r);
          o.timeStr = fmt(r.time); o.spaceNames = (r.spaces || []).map(s => s.name).join('、'); o.spaceCount = (r.spaces || []).length;
          return o;
        });
        const grand = list.reduce((s, r) => s + (r.grand || 0), 0);
        this.setData({ list, empty: list.length === 0, grand });
        wx.showToast({ title: '已删除', icon: 'none' });
      }
    });
  }
});
