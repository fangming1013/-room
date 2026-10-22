const gallery = require('../../utils/gallery.js');

function fmt(ts) {
  const d = new Date(Number(ts) || Date.now());
  const p = n => (n < 10 ? '0' + n : '' + n);
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

Page({
  data: { list: [], empty: true },

  onShow() { this.load(); },

  load() {
    const raw = gallery.list();
    const list = raw
      .map(x => ({
        ts: x.ts,
        src: gallery.src(x),
        spaceName: x.spaceName || '房间',
        styleName: x.styleName || '',
        date: fmt(x.ts)
      }))
      .filter(x => !!x.src);
    this.setData({ list, empty: !list.length });
  },

  // 点小图看大图，可在相册内左右滑动
  preview(e) {
    const i = Number(e.currentTarget.dataset.i) || 0;
    const urls = this.data.list.map(x => x.src);
    if (!urls.length) return;
    wx.previewImage({ urls, current: urls[i] });
  },

  del(e) {
    const i = Number(e.currentTarget.dataset.i);
    const it = this.data.list[i];
    if (!it) return;
    wx.showModal({
      title: '删除这张效果图？',
      content: '只从相册移除，已存到手机相册的图片不受影响。',
      success: r => {
        if (!r.confirm) return;
        gallery.remove(it.ts);
        this.load();
        wx.showToast({ title: '已删除', icon: 'none' });
      }
    });
  },

  goResult() { wx.navigateBack(); }
});
