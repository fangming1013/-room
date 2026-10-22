// 全屏手绘户型（交互说明）
// ① 点一下=生成起点（红点）
// ② 点第二点=自动生成厚180mm线段，默认轴对齐(垂直吸附)，可「取消垂直」走自由角度
// ③ 每段必须门/墙/窗三选一 + 输入长度
// ④ 之后点击=从上一终点沿原方向延伸(或选「垂直」转折)自动生成新线段；按住拖动=自由转向并吸附
// ⑤ 类推直到点回起点红圈闭合
const { cloneSpace } = require('../../utils/spaces.js');

function snapAxis(ux, uy) {
  const L = Math.hypot(ux, uy) || 1; const nx = ux / L, ny = uy / L;
  if (Math.abs(nx) >= Math.abs(ny)) return { x: nx >= 0 ? 1 : -1, y: 0 };
  return { x: 0, y: ny >= 0 ? 1 : -1 };
}

Page({
  data: {
    statusBar: 20,
    name: '',
    showPanel: false,
    lenVal: '',
    typeVal: 'wall',
    isClosing: false,
    edgeNo: 1,
    perpOn: true,          // 垂直吸附（轴对齐）开关，默认开
    dirMode: 'extend',     // 点击续画方向：extend=沿原方向 / perp=垂直转折
    dInfo: '点击画布任意处：生成「起点」（红点）',
    dInfo2: '① 点一下=起点　② 点第二点=第一段墙(默认轴对齐)　③ 选门/墙/窗+长度　④ 再点=沿原方向延伸(或选「垂直」转折)　⑤ 画够3段点「完成闭合」',
    canUndo: false,
    canRedo: false,
    closed: false,        // 户型是否已闭合（显示确认完成）
    segCount: 0           // 已确认段数（控制完成闭合按钮可用性）
  },

  onLoad(options) {
    const key = options && options.key ? options.key : 'kitchen';
    const sp = cloneSpace(key);
    let sb = 20;
    try { sb = (wx.getSystemInfoSync() || {}).statusBarHeight || 20; } catch (e) {}
    this.setData({ statusBar: sb, name: sp.name });
    this.ec = (typeof this.getOpenerEventChannel === 'function') ? this.getOpenerEventChannel() : null;
    this.dKey = key;
    this.edges = [];
    this.meterPts = [{ x: 0, y: 0 }];
    this.px = [];
    this.pending = null;
    this.history = []; this.future = [];
    this.hasStart = false;
    this.thick = 0.18;      // 180mm
    this.snapR = 26;
    this.scale = 120; this.ox = 0; this.oy = 0;
    this.cw = 360; this.ch = 600;
    this._s = null; this._drag = false;
  },

  onReady() {
    wx.createSelectorQuery().select('#cv').boundingClientRect(r => {
      if (r && r.width && r.height) { this.cw = r.width; this.ch = r.height; }
      const restored = this.restoreDraft();   // 重进页面自动恢复上次草稿
      if (!restored) { this.layout(); this.render(); }
    }).exec();
  },

  _pt(e) { const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || {}; return { x: t.x || 0, y: t.y || 0 }; },
  _dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },

  _dirOf(dx, dy) {
    if (this.data.perpOn) return snapAxis(dx, dy);
    const L = Math.hypot(dx, dy) || 1; return { x: dx / L, y: dy / L };
  },

  onTouchStart(e) { this._s = this._pt(e); this._drag = false; },
  onTouchMove(e) {
    const p = this._pt(e);
    if (this._s && this._dist(p, this._s) > 12) this._drag = true;
    if (this.hasStart && !this.data.showPanel) {
      const a = this.px[this.px.length - 1];
      const dir = this._dirOf(p.x - a.x, p.y - a.y);
      const len = this.scale ? this._dist(a, p) / this.scale : 0.9;
      this.pending = { ux: dir.x, uy: dir.y, lenM: len, closing: false };
      this.setData({ dInfo: '拖动转向' + (this.data.perpOn ? '（轴对齐）' : '（自由）') + ' · 当前 ' + len.toFixed(2) + 'm' });
      this.render();
    }
  },
  onTouchEnd(e) {
    const p = this._pt(e);
    const moved = this._s ? this._dist(p, this._s) : 0;
    const drag = !!this._drag || moved > 12;
    this._drag = false;
    if (this.data.showPanel) return;
    if (!drag) this.pending = null;   // 点击不沿用拖动残留预览

    // ① 首点 = 仅生成起点
    if (!this.hasStart) {
      this.hasStart = true;
      this.meterPts = [{ x: 0, y: 0 }];
      this.layout(); this.render();
      this.setData({ dInfo: '起点已生成（红点）。点第二点=生成第一段墙（默认轴对齐，可取消垂直）' });
      return;
    }

    // 拖动：方向随手指、长度已算 → 直接弹录入
    if (drag && this.pending) {
      this.openPanel('seg', (this.pending.lenM || 0.9).toFixed(2));
      return;
    }

    // 点回起点红圈 = 闭合
    const px = this.px || [];
    if (this.hasStart && this.edges.length >= 2 && this._dist(p, px[0]) < this.snapR) {
      const lastM = this.meterPts[this.meterPts.length - 1];
      const gap = Math.hypot(lastM.x, lastM.y);
      this.pending = { ux: 0, uy: 0, lenM: gap, closing: true };
      this.openPanel('closing', gap ? gap.toFixed(2) : '');
      return;
    }

    // ② 第二点 = 第一段（无方向信息时默认水平右，轴对齐；拖动则按手指）
    if (this.edges.length === 0) {
      const dir = this.data.perpOn ? { x: 1, y: 0 } : snapAxis(p.x - px[0].x || 1, p.y - px[0].y || 0);
      this.pending = { ux: dir.x, uy: dir.y, lenM: 0.9, closing: false };
      this.layout(); this.render();
      this.openPanel('seg', '0.9');
      return;
    }

    // ④ 后续点击 = 沿原方向延伸 / 或垂直转折（依 dirMode）
    const last = this.edges[this.edges.length - 1];
    let dir;
    if (this.data.dirMode === 'perp') dir = { x: -last.uy, y: last.ux }; // 垂直转折（左转90°）
    else dir = { x: last.ux, y: last.uy };                               // 沿原方向延伸
    const ux = +(+dir.x).toFixed(4), uy = +(+dir.y).toFixed(4);
    this.pending = { ux, uy, lenM: 0.9, closing: false };
    this.openPanel('seg', '0.9');
  },

  togglePerp() {
    this.setData({ perpOn: !this.data.perpOn });
    this.setData({ dInfo: (this.data.perpOn ? '已开启垂直吸附（轴对齐）' : '已取消垂直（自由角度）') });
  },
  setDir(e) { this.setData({ dirMode: e.currentTarget.dataset.m }); },

  openPanel(kind, guess) {
    this.setData({
      showPanel: true,
      lenVal: guess,
      typeVal: 'wall',
      isClosing: kind === 'closing',
      edgeNo: this.edges.length + 1,
      dInfo: (kind === 'closing'
        ? '点回起点(红圈)：输入闭合段长度与类型'
        : ('第' + (this.edges.length + 1) + '段：输入长度，并选 墙/窗/门'))
    });
    this.render();
  },
  onLen(e) { this.setData({ lenVal: e.detail.value }); this.render(); },
  chooseType(e) { this.setData({ typeVal: e.currentTarget.dataset.t }); },
  cancel() {
    this.pending = null;
    this.setData({ showPanel: false, dInfo: this.edges.length ? '已取消，继续点下一段' : '点第二点生成第一段墙' });
    this.render();
  },
  confirm() {
    const len = parseFloat(this.data.lenVal);
    if (!len || len <= 0) { wx.showToast({ title: '请输入长度(米)', icon: 'none' }); return; }
    const pend = this.pending; if (!pend) return;
    this.history.push(this.snapshot()); this.future = [];
    if (pend.closing) {
      const lastM = this.meterPts[this.meterPts.length - 1];
      const vx = -lastM.x, vy = -lastM.y; const L = Math.hypot(vx, vy) || 1;
      this.edges.push({ ux: vx / L, uy: vy / L, lenM: L, type: this.data.typeVal });
    } else {
      this.edges.push({ ux: pend.ux, uy: pend.uy, lenM: len, type: this.data.typeVal });
    }
    this.pending = null;
    this.layout(); this.syncHist();
    this.saveDraft();
    if (pend.closing) {
      this.closed = true;
      this.setData({ showPanel: false, closed: true, segCount: this.edges.length,
        dInfo: '✅ 户型已闭合！点「确认完成」进入下一步（生成图纸/预算）' });
      this.render();
      return;
    }
    this.setData({ showPanel: false, segCount: this.edges.length,
      dInfo: '已确认，继续点下一段（沿原方向延伸；或选「垂直」转折；拖动可自由转向）' });
    this.render();
  },

  snapshot() { return JSON.parse(JSON.stringify(this.edges)); },
  restore(arr) { this.edges = JSON.parse(JSON.stringify(arr)); this.pending = null; this.layout(); this.render(); },
  syncHist() { this.setData({ canUndo: this.history.length > 0, canRedo: this.future.length > 0 }); },
  undo() {
    if (this.data.showPanel) { this.cancel(); return; }
    if (!this.history.length) return;
    this.future.push(this.snapshot()); this.restore(this.history.pop()); this.syncHist();
    if (this.closed) this.closed = false;
    this.setData({ closed: false, segCount: this.edges.length, dInfo: '已撤销上一步' });
    this.saveDraft();
  },
  redo() { if (!this.future.length) return; this.history.push(this.snapshot()); this.restore(this.future.pop()); this.syncHist(); },

  // 米制建模 + fit 画布
  layout() {
    const W = this.cw || 360, H = this.ch || 600, m = 30;
    let mp = [{ x: 0, y: 0 }];
    this.edges.forEach(e => { const prev = mp[mp.length - 1]; mp.push({ x: prev.x + e.ux * e.lenM, y: prev.y + e.uy * e.lenM }); });
    if (this.pending && !this.pending.closing) {
      const prev = mp[mp.length - 1];
      const lm = this.pending.lenM || 0.9;
      mp.push({ x: prev.x + this.pending.ux * lm, y: prev.y + this.pending.uy * lm });
    }
    const xs = mp.map(p => p.x), ys = mp.map(p => p.y);
    const minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs);
    const miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys);
    const w = Math.max(maxx - minx, 0.5), h = Math.max(maxy - miny, 0.5);
    let ppm = Math.min((W - 2 * m) / w, (H - 2 * m) / h);
    if (!isFinite(ppm) || ppm <= 0) ppm = 120;
    ppm = Math.min(ppm, 240);
    const ox = m + (W - 2 * m - w * ppm) / 2 - minx * ppm;
    const oy = m + (H - 2 * m - h * ppm) / 2 - miny * ppm;
    this.scale = ppm; this.ox = ox; this.oy = oy;
    this.px = mp.map(p => ({ x: ox + p.x * ppm, y: oy + p.y * ppm }));
    let mp2 = [{ x: 0, y: 0 }];
    this.edges.forEach(e => { const pr = mp2[mp2.length - 1]; mp2.push({ x: pr.x + e.ux * e.lenM, y: pr.y + e.uy * e.lenM }); });
    if (this.pending && !this.pending.closing) {
      const pr = mp2[mp2.length - 1];
      mp2.push({ x: pr.x + this.pending.ux * (this.pending.lenM || 0.9), y: pr.y + this.pending.uy * (this.pending.lenM || 0.9) });
    }
    this.meterPts = mp2;
  },

  render() {
    const ctx = wx.createCanvasContext('cv');
    const W = this.cw || 360, H = this.ch || 600;
    ctx.clearRect(0, 0, W, H);
    const px = this.px || [];
    const scale = this.scale || 120;
    const colOf = t => t === 'win' ? '#3a7bd5' : (t === 'door' ? '#e0533d' : '#2b6cb0');
    // 已确认段：内墙单线（墙厚仅记数据，不画双线）
    for (let i = 0; i < this.edges.length; i++) {
      const a = px[i], b = px[i + 1];
      if (!a || !b) continue;
      ctx.setStrokeStyle(colOf(this.edges[i].type)); ctx.setLineWidth(3);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      if (this.edges[i].type === 'win') {
        ctx.setLineDash([5, 3]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      } else if (this.edges[i].type === 'door') {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        ctx.beginPath(); ctx.arc(mx, my, 10, 0, 2 * Math.PI); ctx.stroke();
      }
    }
    ctx.setFontSize(12);
    for (let i = 0; i < this.edges.length; i++) {
      const a = px[i], b = px[i + 1]; if (!a || !b) continue;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      ctx.setFillStyle(colOf(this.edges[i].type));
      const tag = this.edges[i].type === 'win' ? '窗' : this.edges[i].type === 'door' ? '门' : '墙';
      ctx.fillText(this.edges[i].lenM.toFixed(2) + 'm ' + tag, mx, my - 8);
    }
    if (this.pending && px.length) {
      const a = px[px.length - 1];
      let bx, by;
      if (this.pending.closing) { bx = px[0].x; by = px[0].y; }
      else {
        const lv = this.data.lenVal && parseFloat(this.data.lenVal) > 0 ? parseFloat(this.data.lenVal) : (this.pending.lenM || 0.9);
        bx = a.x + this.pending.ux * lv * scale; by = a.y + this.pending.uy * lv * scale;
      }
      ctx.setStrokeStyle('#f0a500'); ctx.setLineWidth(3); ctx.setLineDash([7, 4]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      ctx.setFillStyle('#f0a500'); ctx.beginPath(); ctx.arc(bx, by, 6, 0, 2 * Math.PI); ctx.fill();
    }
    px.forEach((p, i) => {
      if (i === 0) {
        ctx.setStrokeStyle('#e0533d'); ctx.setLineWidth(2);
        ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI); ctx.stroke();
        ctx.setFillStyle('#e0533d'); ctx.setFontSize(12); ctx.fillText('起', p.x + 11, p.y - 9);
      } else { ctx.setFillStyle('#2b6cb0'); ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI); ctx.fill(); }
    });
    if (px.length >= 2) {
      const c = px[px.length - 1];
      ctx.setStrokeStyle('#2b6cb0'); ctx.setLineWidth(2);
      ctx.beginPath(); ctx.arc(c.x, c.y, 8, 0, 2 * Math.PI); ctx.stroke();
    } else if (px.length === 1 && !this.pending) {
      ctx.setFillStyle('#2b6cb0'); ctx.setFontSize(12);
      ctx.fillText('从此点续画', px[0].x + 12, px[0].y + 16);
    }
    ctx.draw();
  },

  // 点「完成闭合」：自动把当前终点连回起点，弹闭合段录入（门/墙/窗+长度）
  finishClosing() {
    if (this.closed) return;
    if (this.edges.length < 3) { wx.showToast({ title: '至少画3段再闭合', icon: 'none' }); return; }
    const lastM = this.meterPts[this.meterPts.length - 1];
    const gap = Math.hypot(lastM.x, lastM.y);
    if (gap < 0.05) {
      this.closed = true;
      this.setData({ closed: true, segCount: this.edges.length, dInfo: '✅ 户型已闭合！点「确认完成」进入下一步' });
      this.render();
      return;
    }
    this.pending = { ux: 0, uy: 0, lenM: gap, closing: true };
    this.openPanel('closing', gap.toFixed(2));
  },

  // 点「确认完成」：把户型回传首页并进入下一步（生成图纸/预算）
  doComplete() { this.complete(); },

  // 自动存草稿（返回/每次确认都调用），重进页面可恢复
  saveDraft() {
    try {
      const d = {
        key: this.dKey, name: this.data.name,
        edges: this.edges, meterPts: this.meterPts,
        hasStart: this.hasStart, perpOn: this.data.perpOn,
        dirMode: this.data.dirMode, closed: this.closed
      };
      const g = getApp().globalData; g.draftDraw = g.draftDraw || {};
      g.draftDraw[this.dKey] = d;
      wx.setStorageSync('draftDraw_' + this.dKey, d);
    } catch (e) {}
  },
  // 重进页面恢复草稿；返回是否恢复成功
  restoreDraft() {
    let d = null;
    try {
      const g = getApp().globalData;
      d = (g.draftDraw && g.draftDraw[this.dKey]) || wx.getStorageSync('draftDraw_' + this.dKey) || null;
    } catch (e) {}
    if (!d || !d.edges || !d.edges.length) return false;
    this.edges = d.edges.map(e => ({ ...e }));
    this.meterPts = d.meterPts.map(p => ({ ...p }));
    this.hasStart = d.hasStart !== false;
    this.closed = !!d.closed;
    this.setData({
      perpOn: d.perpOn !== false, dirMode: d.dirMode || 'extend',
      closed: this.closed, segCount: this.edges.length,
      dInfo: '已恢复上次草稿（' + this.edges.length + '段）· 可继续或点「确认完成」'
    });
    this.layout(); this.render();
    return true;
  },

  complete() {
    if (!this.meterPts || this.meterPts.length < 3) { wx.showToast({ title: '请先画出至少3段闭合', icon: 'none' }); return; }
    let poly = this.meterPts.map(p => ({ x: p.x * 100, y: p.y * 100 }));
    const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
    const minx = Math.min.apply(null, xs), miny = Math.min.apply(null, ys);
    poly = poly.map(p => ({ x: Math.round(p.x - minx), y: Math.round(p.y - miny) }));
    const space = cloneSpace(this.dKey);
    space.poly = poly;
    space.edges = this.edges.map(e => ({ lenM: e.lenM, type: e.type, thick: Math.round(this.thick * 1000) }));
    space.w = Math.max.apply(null, poly.map(p => p.x));
    space.d = Math.max.apply(null, poly.map(p => p.y));
    // 写入项目（供第三步 示意图/效果图 读取），并清除草稿
    try { getApp().addSpace(space); } catch (e) {}
    try {
      const g = getApp().globalData; if (g.draftDraw) delete g.draftDraw[this.dKey];
      wx.removeStorageSync('draftDraw_' + this.dKey);
    } catch (e) {}
    if (this.ec) { try { this.ec.emit('done', space); } catch (e) {} }
    wx.navigateBack();
  },

  reset() {
    this.edges = []; this.meterPts = [{ x: 0, y: 0 }]; this.px = []; this.pending = null;
    this.history = []; this.future = []; this.hasStart = false; this.closed = false;
    this.setData({ showPanel: false, canUndo: false, canRedo: false, perpOn: true, dirMode: 'extend',
      closed: false, segCount: 0, dInfo: '点击画布任意处：生成「起点」（红点）', lenVal: '' });
    this.render();
  },
  goBack() { this.saveDraft(); wx.navigateBack(); }
});
