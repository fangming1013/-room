const { SPACE_KEYS, SPACES, WALLS, cloneSpace } = require('../../utils/spaces.js');
const { calcQuote, effUnitPrice, calcWholeAux, syncWholeDemoDedup } = require('../../utils/quote.js');
const brands = require('../../utils/brands.js');
const cfg = require('../../utils/config.js');
const TIERS = cfg.tiers();
const TIER_LIST = cfg.tierList();
const store = require('../../utils/store.js');
const parse = require('../../utils/parse.js');
const speech = require('../../utils/speech.js');
const plan = require('../../utils/plan.js');
const { round1, fmt1 } = require('../../utils/num.js');
const est = require('../../utils/estimate.js');
const VER = require('../../version.js');
const auxRule = require('../../utils/auxrule.js');   // 辅助项工程量规则（按项目空间数分流）

const names = {};
SPACE_KEYS.forEach(k => names[k] = SPACES[k].name);
const wallNames = WALLS.map(w => w.name);

// 语音模板固定示例（与实际工作空间解耦，进入软件未录入前始终展示这段示例话术）
const EXAMPLE = { name: '厨房', w: 320, d: 260, h: 260, doorWall: 'right', winWall: 'top' };

// setData 必须换新引用，否则同一对象更新后视图层不刷新（改了 quantity 看不出变化）
const fresh = s => JSON.parse(JSON.stringify(s));

// 首页不再展示「空间示意图 + 算法已自动算出 N 项」整块（老板 2026-09-29 定）
// 想恢复：把它改回 true，并在 index.wxml 的「② 录入尺寸」卡片前加回：
//   <view class="card"><view class="title">空间示意图</view><canvas canvas-id="planMini" class="planMini"></canvas></view>
const SHOW_PLAN_MINI = false;

// 语音模板：固定话术正常显示，具体内容（数字 / 空间名 / 材料名）走小字灰色
// seg = { t: 文本, v: true 表示"具体内容"（小字灰色） }
function mText(cm) {
  const v = (Number(cm) || 0) / 100;
  return String(Math.round(v * 100) / 100);
}
function wallCN(id) {
  const w = WALLS.find(x => x.id === id);
  return w ? w.name : String(id || '');
}
function buildTplSegs(s) {
  if (!s) return [];
  const G = t => ({ t: String(t), v: true });   // 具体内容 → 小字灰色
  const N = t => ({ t: String(t) });            // 固定话术
  const segs = [G(s.name || '')];
  segs.push(N(' 宽'), G(mText(s.w)), N('米 深'), G(mText(s.d)), N('米 高'), G(mText(s.h)), N('米'));
  // 第一遍只报「长宽高 + 门/窗在哪面墙」（2026-09-29 老板定）：
  // 门宽/窗宽/距左端不再进模板——说了容易被识别成墙长导致整图错位，尺寸在第二遍弹层里确认
  segs.push(N(' 门在'), G(wallCN(s.doorWall)));
  segs.push(N(' 窗在'), G(wallCN(s.winWall)));
  return segs;
}
function tplTextOf(segs) { return segs.map(x => x.t).join(''); }

// 载入历史存档时补齐数量显示文本（否则输入框显示空白）
function syncQtyText(s) {
  s.materials.forEach(m => { if (m.qtyText === undefined || m.qtyText === null) m.qtyText = fmt1(m.qty); });
  s.labor.forEach(l => { if (l.qtyText === undefined || l.qtyText === null) l.qtyText = fmt1(l.qty); });
}

Page({
  data: {
    verText: VER.version + ' · ' + VER.date,
    spaceKeys: SPACE_KEYS,
    names,
    walls: WALLS,
    wallNames,
    cur: 'kitchen',
    space: cloneSpace('kitchen'),
    tier: 'none',
    touched: false,      // 是否已录入真实尺寸；未录入前所有工程量强制为 0
    tiers: TIER_LIST.map(k => ({ id: k, name: TIERS[k].name })),
    brandSheet: { show: false, idx: 0, options: [] },
    doorIdx: 0,
    winIdx: 0,
    voiceText: '',
    recording: false,
    address: '',
    showDraw: false,
    thickness: 180,
    ortho: true,
    edgePanel: { show: false, idx: 0, len: '', type: 'wall', closing: false },
    canUndo: false,
    canRedo: false,
    dInfo: '',
    ptsCount: 0,
    inputMethod: 'voice',  // voice / manual
    methods: [
      { id: 'voice', name: '语音录入' },
      { id: 'manual', name: '手动录入' }
    ],
    showTemplate: true,
    // 模板含真实数据，但具体内容（数字/空间名/材料名）用小字灰色弱化，避免被照着念
    template: '',
    tplSegs: buildTplSegs(cloneSpace('kitchen')),
    openSheet: { show: false },
    openVText: '',
    quote: { total: 0, matTotal: 0, laborTotal: 0, matItems: [], laborItems: [] },
    autoCount: 0,      // 本轮按算法自动算出的工程量项数
    autoLine: '',      // 自动算出的明细（可视化见证算法生效）
    dedupOn: false     // 本空间是否已按「全屋拆除」扣掉重复的墙地砖整体拆除
  },

  onLoad(options) {
    const app = getApp();
    // 编辑历史记录：从存档载入完整空间快照
    if (options && options.edit) {
      const rec = (store.getHistory() || []).find(r => r.id === options.edit);
      if (rec && rec.space) {
        this.editId = rec.id;
        const sp = JSON.parse(JSON.stringify(rec.space));
        syncQtyText(sp);
        sp.touched = true;   // 历史记录是真实数据，进入即按算法计算
        this.setData({
          inputMethod: 'manual',
          showTemplate: false,
          cur: sp.key,
          space: sp,
          tier: sp.tier || 'none',
          doorIdx: WALLS.findIndex(w => w.id === sp.doorWall),
          winIdx: WALLS.findIndex(w => w.id === sp.winWall),
          address: (app.globalData.project.address || rec.address || '')
        });
        this.recalc({ force: true, silent: true });
        return;
      }
    }
    const entry = options && options.entry;
    const method = entry === 'manual' ? 'manual' : 'voice';
    this.setData({ inputMethod: method, showTemplate: method === 'voice', address: app.globalData.project.address || '' });
    this.applySpace('kitchen');
    // 未录入真实尺寸前，所有工程量默认为 0（避免按示例模板尺寸自动生成）
    const sp0 = this.data.space;
    sp0.w = 0; sp0.d = 0; sp0.h = 0; sp0.touched = false;
    this.setData({ space: sp0, tplSegs: buildTplSegs(EXAMPLE), template: tplTextOf(buildTplSegs(EXAMPLE)) });
    this.recalc({ silent: true });
  },

  // 页面就绪后再画一次，避免 onLoad 时 canvas 尚未布局导致首图空白
  onReady() { this.drawMini(); },

  // 注册完成回到本页 → 自动接着生成预算（不打断客户流程）
  // 老板 2026-10-21 定：录尺寸 → 点生成 → 强制注册 → 出预算
  onShow() {
    let pending = 0;
    try { pending = Number(wx.getStorageSync('pending_gen_v1')) || 0; } catch (e) {}
    if (!pending) return;
    // 超过 5 分钟视为放弃，避免下次莫名其妙跳走
    if (Date.now() - pending > 5 * 60 * 1000) {
      try { wx.removeStorageSync('pending_gen_v1'); } catch (e) {}
      return;
    }
    const user = store.getUser();
    if (!user || !user.phone || !user.decoType) return;   // 还没填完，等客户继续
    try { wx.removeStorageSync('pending_gen_v1'); } catch (e) {}
    setTimeout(() => { try { this.doGenerate(); } catch (e) {} }, 60);
  },

  applySpace(key) {
    const space = cloneSpace(key);
    this.setData({
      cur: key,
      space,
      tier: space.tier || 'none',
      doorIdx: WALLS.findIndex(w => w.id === space.doorWall),
      winIdx: WALLS.findIndex(w => w.id === space.winWall)
    });
    // 切换/新建空间：所有工程量按新尺寸全部重算
    this.recalc({ force: true, silent: true });
  },

  // 录入页顶部实时平面图预览（家具按真实尺寸与摆位）
  // 首页已按要求不显示该模块，这里直接返回，避免操作无 canvas 时报错
  drawMini() {
    if (!SHOW_PLAN_MINI) return;
    const space = this.data.space;
    if (!space) return;
    const ctx = wx.createCanvasContext('planMini');
    // 第6个参数传 null：家具改用纯 canvas 矢量画法（不再用 AI 生成的图片图标，无水印/更整齐）
    plan.drawPlan(ctx, space, 330, 220, 4, null, { compass: false });
    ctx.draw();
  },

  // ===== 主材品牌档位（经济/舒适/轻奢）=====
  selectTier(e) {
    const id = e.currentTarget.dataset.id;
    const s = this.data.space;
    s.tier = id;
    this.setData({ space: fresh(s), tier: id });
    this.updateQuote();
  },

  // ===== 选品牌：档位默认价 + 已注册材料商品牌（广告）=====
  openBrand(e) {
    const idx = e.currentTarget.dataset.idx;
    const m = this.data.space.materials[idx];
    const T = cfg.tiers();
    const opts = [];
    cfg.tierList().forEach(k => {
      const t = T[k];
      // 倍率自动乘法已删除：档位价以手动录入价(m.prices[k])为准，未录入则取基准价
      const price = (m.prices && m.prices[k] != null) ? Number(m.prices[k]) : m.price;
      opts.push({ key: 'tier_' + k, kind: 'tier', tier: k, name: t.name, price, ad: false, reset: k === (this.data.space.tier || 'none') });
    });
    brands.brandsForMaterial(m.id).forEach(b => {
      opts.push({ key: 'brand_' + b.id, kind: 'brand', name: b.brand, price: b.price, ad: true, supplier: b.supplier, tier: b.tier, spec: b.spec, image: b.image, unit: b.unit, qrCode: b.qrCode });
    });
    this.setData({ brandSheet: { show: true, idx, options: opts } });
  },
  pickBrand(e) {
    const i = e.currentTarget.dataset.i;
    const opt = this.data.brandSheet.options[i];
    if (!opt) return;
    const idx = this.data.brandSheet.idx;
    const s = this.data.space;
    if (opt.kind === 'brand') s.materials[idx].brand = { name: opt.name, price: opt.price, ad: true, qrCode: opt.qrCode, supplier: opt.supplier, unit: opt.unit };
    else s.materials[idx].brand = null; // 档位默认价：清除品牌覆盖，quote 按该档位录入价(或基准价)计算
    this.setData({ space: fresh(s), brandSheet: { show: false, idx: 0, options: [] } });
    this.updateQuote();
  },
  resetBrand() {
    const idx = this.data.brandSheet.idx;
    const s = this.data.space;
    s.materials[idx].brand = null;
    this.setData({ space: fresh(s), brandSheet: { show: false, idx: 0, options: [] } });
    this.updateQuote();
  },
  closeBrand() { this.setData({ brandSheet: { show: false, idx: 0, options: [] } }); },
  // 客户点「加微信」：预览二维码（长按可保存到相册后扫码添加）
  showQR(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.previewImage({ urls: [url], current: url });
  },

  selectSpace(e) {
    this.applySpace(e.currentTarget.dataset.key);
  },

  // ===== 语音 =====
  onVoiceStart() {
    if (!speech.isAvailable()) {
      wx.showToast({ title: '当前环境不支持语音，请切换手动录入', icon: 'none' });
      this.setData({ inputMethod: 'manual', showTemplate: false });
      return;
    }
    this.setData({ recording: true });
    speech.start({
      onStart: () => {},
      onInterim: (t) => this.setData({ voiceText: t }),
      onFinal: (t) => { this.setData({ recording: false }); if (t) this.applyVoice(t); },
      onError: () => { this.setData({ recording: false }); wx.showToast({ title: '识别失败', icon: 'none' }); }
    });
  },
  onVoiceEnd() {
    if (this.data.recording) speech.stop();
  },

  applyVoice(text) {
    const sp = parse.parseSpaceKey(text);
    if (sp && sp !== this.data.cur) this.applySpace(sp);
    const s = this.data.space;
    const dims = parse.parseDims(text);
    if (dims.w) s.w = dims.w;
    if (dims.d) s.d = dims.d;
    if (dims.h) s.h = dims.h;
    const dw = parse.parseWall(text, '门'); if (dw) s.doorWall = dw;
    const ww = parse.parseWall(text, '窗'); if (ww) s.winWall = ww;
    const fOn = parse.parseFurniture(text, s.furniture);
    s.furniture = s.furniture.map(f => fOn[f.id] ? { ...f, on: true } : f);
    // 工程地址：语音中识别到则写入项目
    const addr = parse.parseAddress(text);
    if (addr) getApp().globalData.project.address = addr;
    this.setData({
      space: s,
      voiceText: text,
      address: getApp().globalData.project.address || this.data.address,
      doorIdx: WALLS.findIndex(w => w.id === s.doorWall),
      winIdx: WALLS.findIndex(w => w.id === s.winWall)
    });
    s.touched = !!(dims.w || dims.d || dims.h);   // 报到了有效尺寸才按算法计算
    // 语音报完尺寸：示意图实时重绘 + 工程量按预算规则自动算出
    const miss = [];
    if (!dims.w) miss.push('宽');
    if (!dims.d) miss.push('深');
    if (!dims.h) miss.push('高');
    this.recalc();
    this.openOpenSheet();
    if (miss.length) {
      wx.showToast({ title: '没听到' + miss.join('、') + '，暂时用默认值', icon: 'none', duration: 2200 });
    }
  },

  // ===== 门窗宽 / 定位 语音确认 =====
  openOpenSheet() { this.setData({ openSheet: { show: true }, openVText: '' }); },
  closeOpenSheet() { this.setData({ openSheet: { show: false }, openVText: '' }); },
  confirmOpenings() { this.closeOpenSheet(); this.recalc({ silent: true }); },

  onOpenVoiceStart() {
    if (!speech.isAvailable()) { wx.showToast({ title: '请使用真机语音录入门窗', icon: 'none' }); return; }
    this.setData({ recording: true });
    speech.start({
      onStart: () => {},
      onInterim: t => this.setData({ openVText: t }),
      onFinal: t => { this.setData({ recording: false }); if (t) this.applyOpenVoice(t); },
      onError: () => { this.setData({ recording: false }); wx.showToast({ title: '识别失败', icon: 'none' }); }
    });
  },
  onOpenVoiceEnd() { if (this.data.recording) speech.stop(); },
  applyOpenVoice(text) {
    const o = parse.parseOpenings(text);
    const s = this.data.space;
    let n = 0;
    if (o.doorW) { s.doorW = o.doorW; n++; }
    if (o.winW) { s.winW = o.winW; n++; }
    if (o.doorOff != null) { s.doorOff = o.doorOff; s.doorEnd = o.doorOff; n++; }
    else if (o.doorEnd === 'mid') { s.doorOff = null; s.doorEnd = 'mid'; n++; }
    if (o.winOff != null) { s.winOff = o.winOff; s.winEnd = o.winOff; n++; }
    else if (o.winEnd === 'mid') { s.winOff = null; s.winEnd = 'mid'; n++; }
    this.setData({ space: fresh(s), openVText: text });
    this.recalc({ silent: true });
    if (n) wx.showToast({ title: '门窗已更新 ' + n + ' 项', icon: 'none' });
    else wx.showToast({ title: '没听清门窗宽与定位，可手动填', icon: 'none' });
  },
  onDoorOff(e) { const s = this.data.space; s.doorOff = e.detail.value === '' ? null : (parseFloat(e.detail.value) || 0); this.setData({ space: fresh(s) }); this.drawMini(); },
  onWinOff(e) { const s = this.data.space; s.winOff = e.detail.value === '' ? null : (parseFloat(e.detail.value) || 0); this.setData({ space: fresh(s) }); this.drawMini(); },
  onAddress(e) {
    const addr = e.detail.value;
    getApp().globalData.project.address = addr;
    this.setData({ address: addr });
  },

  noop() {},

  // ===== 录入方式切换（语音 / 手绘 / 手动）=====
  selectMethod(e) {
    const m = e.currentTarget.dataset.m;
    if (m === 'draw') wx.showToast({ title: '手绘录入为第二阶段功能', icon: 'none' });
    this.setData({ inputMethod: m, showTemplate: m === 'voice' });
  },

  // ===== 手绘（单点续画：点一下从当前端点(绿)沿方向画一段墙→右侧输长度+墙/窗/门→自动续画→点起点(红)闭合；双线180mm；撤销/重做） =====
  openDraw() {
    this.dEdges = [];          // 已确认墙段 {ux,uy,lenM,type}
    this.dPending = null;      // 待录入 {ux,uy,rawEnd,closing}
    this.dPx = [];             // 布局屏幕顶点(米制换算)
    this.dMeterPts = [{ x: 0, y: 0 }]; // 起点米制(常驻)
    this.dMove = null;         // 当前手指位置(橡皮筋预览)
    this.ortho = this.data.ortho;
    this.thick = (this.data.thickness || 180) / 1000; // 米
    this.snapR = 24; this.dScale = 120; this.dOX = 0; this.dOY = 0;
    this.parallelSnap = false; this.orthoSnap = false; this.continueSnap = false; this.turnSnap = false;
    this.dHistory = []; this.dFuture = [];
    this.setData({ showDraw: true, edgePanel: { show: false, idx: 0, len: '', type: 'wall', closing: false }, canUndo: false, canRedo: false, dInfo: '点一下：从起点(起)画第一段墙，输长度与墙/窗/门', ptsCount: 1 });
    wx.createSelectorQuery().select('#drawCanvas').boundingClientRect(r => {
      if (r) { this.dW = r.width; this.dH = r.height; }
      this.layout();
      this.renderDraw();
    }).exec();
  },
  closeDraw() { this.setData({ showDraw: false, edgePanel: { show: false } }); },
  toggleOrtho() { this.ortho = !this.ortho; this.setData({ ortho: this.ortho }); this.renderDraw(); },

  _pt(e) { const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || {}; return { x: t.x || 0, y: t.y || 0 }; },
  _dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },

  // 方向吸附：续(同前段) / 转弯(垂直前段) / 平行首段 / 横竖；取最近候选(~10°内)
  snapDir(ux, uy) {
    this.parallelSnap = false; this.orthoSnap = false; this.continueSnap = false; this.turnSnap = false;
    const cand = [];
    if (this.dEdges.length >= 1) {
      const p = this.dEdges[this.dEdges.length - 1];
      cand.push({ x: p.ux, y: p.uy, tag: 'continue' });   // 续(同前段方向)
      cand.push({ x: -p.ux, y: -p.uy, tag: 'continue' });  // 反向续(往回)
      cand.push({ x: -p.uy, y: p.ux, tag: 'turn' });       // 左转90°
      cand.push({ x: p.uy, y: -p.ux, tag: 'turn' });       // 右转90°
      const f = this.dEdges[0];
      cand.push({ x: f.ux, y: f.uy, tag: 'parallel' });
      cand.push({ x: -f.ux, y: -f.uy, tag: 'parallel' });
    }
    if (this.ortho) {
      cand.push({ x: 1, y: 0, tag: 'axis' }); cand.push({ x: -1, y: 0, tag: 'axis' });
      cand.push({ x: 0, y: 1, tag: 'axis' }); cand.push({ x: 0, y: -1, tag: 'axis' });
    }
    const L = Math.hypot(ux, uy) || 1; const nx = ux / L, ny = uy / L;
    let best = null, bestAng = 0.18;
    cand.forEach(c => {
      const cl = Math.hypot(c.x, c.y) || 1; const cx = c.x / cl, cy = c.y / cl;
      let dot = cx * nx + cy * ny; dot = Math.max(-1, Math.min(1, dot));
      const ang = Math.min(Math.acos(dot), Math.PI - Math.acos(dot));
      if (ang < bestAng) { bestAng = ang; best = { x: cx, y: cy, tag: c.tag }; }
    });
    if (best) {
      if (best.tag === 'parallel') this.parallelSnap = true;
      else if (best.tag === 'axis') this.orthoSnap = true;
      else if (best.tag === 'continue') this.continueSnap = true;
      else if (best.tag === 'turn') this.turnSnap = true;
      return { x: best.x, y: best.y };
    }
    return { x: nx, y: ny };
  },

  // 点击落点（drawEnd 时起点→终点距离判断，避免手指抖动被误判为拖动）
  drawStart(e) { this._ts = this._pt(e); this._drag = false; },
  drawMove(e) {
    const p = this._pt(e);
    if (this._ts && this._dist(p, this._ts) > 12) this._drag = true;
    if (!(this.data.edgePanel.show || this.dPending)) { this.dMove = p; this.renderDraw(); }
  },
  drawEnd(e) {
    const p = this._pt(e);
    const moved = this._ts ? this._dist(p, this._ts) : 0;
    const drag = !!this._drag || moved > 12;
    this._drag = false;
    if (this.data.edgePanel.show || this.dPending) return;   // 录入卡打开时忽略画布
    if (drag) { this.dMove = null; this.renderDraw(); return; } // 拖动只是预览
    const px = this.dPx || [];
    if (!px.length) return;
    // 闭环：已>=1段且点回起点(红圈)
    if (this.dEdges.length >= 1 && this._dist(p, px[0]) < this.snapR) {
      this.dPending = { ux: 0, uy: 0, rawEnd: px[0], closing: true };
      const lastM = this.dMeterPts[this.dMeterPts.length - 1];
      const gap = Math.hypot(lastM.x, lastM.y);
      this.openEdgePanel('closing', gap ? gap.toFixed(2) : '');
      return;
    }
    // 单点一段：从当前端点(绿)沿方向画一段墙
    const a = px[px.length - 1];
    const dir = this.snapDir(p.x - a.x, p.y - a.y);
    if (dir.x === 0 && dir.y === 0) return; // 点与当前端点重合，忽略
    this.dPending = { ux: dir.x, uy: dir.y, rawEnd: p, closing: false };
    const guess = this.dScale ? (this._dist(a, p) / this.dScale).toFixed(2) : '';
    this.openEdgePanel('seg', guess);
    this.setData({ ptsCount: this.dEdges.length + 2 });
  },

  // 右侧录入栏显示当前段（canvas 是原生组件，浮层盖不住，故放右侧固定栏）
  openEdgePanel(kind, guess) {
    const closing = kind === 'closing';
    const tag = closing ? '' : this._snapTag();
    this.setData({
      edgePanel: { show: true, idx: this.dEdges.length, len: guess, type: 'wall', closing },
      dInfo: (closing ? '回到起点(红圈)：输入闭合段长度与类型' : ('第' + (this.dEdges.length + 1) + '段：输入长度与类型' + tag))
    });
    this.renderDraw();
  },
  _snapTag() {
    if (this.continueSnap) return '（续：同前段）';
    if (this.turnSnap) return '（转弯：垂直前段）';
    if (this.parallelSnap) return '（平行首段）';
    if (this.orthoSnap) return '（垂直/水平）';
    return '';
  },

  onEdgeLen(e) { const ep = this.data.edgePanel; ep.len = e.detail.value; this.setData({ edgePanel: ep }); this.renderDraw(); },
  chooseEdgeType(e) {
    const ep = this.data.edgePanel; ep.type = e.currentTarget.dataset.t; this.setData({ edgePanel: ep });
  },
  cancelEdge() {
    this.dPending = null;
    this.setData({ edgePanel: { show: false }, dInfo: '已取消，重新点该段终点' });
    this.renderDraw();
  },
  confirmEdge() {
    const ep = this.data.edgePanel;
    const lenM = parseFloat(ep.len);
    if (!lenM || lenM <= 0) { wx.showToast({ title: '请输入长度(米)', icon: 'none' }); return; }
    const pend = this.dPending; if (!pend) return;
    this.dHistory.push(this.snapshot()); this.dFuture = [];
    if (pend.closing) {
      const lastM = this.dMeterPts[this.dMeterPts.length - 1];
      const vx = -lastM.x, vy = -lastM.y; const L = Math.hypot(vx, vy) || 1;
      this.dEdges.push({ ux: vx / L, uy: vy / L, lenM: L, type: ep.type });
    } else {
      this.dEdges.push({ ux: pend.ux, uy: pend.uy, lenM, type: ep.type });
    }
    this.dPending = null;
    this.layout();
    this.syncHist();
    if (pend.closing) { this.complete(); return; }
    this.setData({ edgePanel: { show: false }, dInfo: '已确认，继续点下一段（从绿点续画）' });
    this.renderDraw();
  },

  // 撤销 / 重做
  snapshot() { return { edges: JSON.parse(JSON.stringify(this.dEdges)) }; },
  restore(s) { this.dEdges = JSON.parse(JSON.stringify(s.edges)); this.dPending = null; this.layout(); this.renderDraw(); },
  syncHist() { this.setData({ canUndo: this.dHistory.length > 0, canRedo: this.dFuture.length > 0 }); },
  undoEdge() {
    if (this.data.edgePanel.show || this.dPending) { this.cancelEdge(); return; }
    if (!this.dHistory.length) return;
    this.dFuture.push(this.snapshot());
    this.restore(this.dHistory.pop());
    this.syncHist();
    this.setData({ dInfo: '已撤销上一步', ptsCount: this.dEdges.length + 1 });
  },
  redoEdge() {
    if (!this.dFuture.length) return;
    this.dHistory.push(this.snapshot());
    this.restore(this.dFuture.pop());
    this.syncHist();
    this.setData({ dInfo: '已重做', ptsCount: this.dEdges.length + 1 });
  },

  // 按真实长度+方向布局，fit 画布
  layout() {
    const W = this.dW || 600, H = this.dH || 400, m = 34;
    let mp = [{ x: 0, y: 0 }];
    this.dEdges.forEach(e => {
      const prev = mp[mp.length - 1];
      mp.push({ x: prev.x + e.ux * e.lenM, y: prev.y + e.uy * e.lenM });
    });
    const xs = mp.map(p => p.x), ys = mp.map(p => p.y);
    const minx = Math.min(...xs), maxx = Math.max(...xs);
    const miny = Math.min(...ys), maxy = Math.max(...ys);
    const w = Math.max(maxx - minx, 0.5), h = Math.max(maxy - miny, 0.5);
    let pxPerM = Math.min((W - 2 * m) / w, (H - 2 * m) / h);
    if (!isFinite(pxPerM) || pxPerM <= 0) pxPerM = 120;
    pxPerM = Math.min(pxPerM, 220);
    const ox = m + (W - 2 * m - w * pxPerM) / 2 - minx * pxPerM;
    const oy = m + (H - 2 * m - h * pxPerM) / 2 - miny * pxPerM;
    this.dScale = pxPerM; this.dOX = ox; this.dOY = oy;
    this.dPx = mp.map(p => ({ x: ox + p.x * pxPerM, y: oy + p.y * pxPerM }));
    this.dMeterPts = mp;
  },

  renderDraw() {
    const ctx = wx.createCanvasContext('drawCanvas');
    const W = this.dW || 600, H = this.dH || 400;
    ctx.clearRect(0, 0, W, H);
    const px = this.dPx || [];
    const halfT = (this.thick / 2) * this.dScale;
    const colOf = t => t === 'win' ? '#3a7bd5' : (t === 'door' ? '#e0533d' : '#1f8a70');
    const drawBand = (a, b, color, type) => {
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      if (L < 0.5) return;
      const nx = -dy / L, ny = dx / L;
      const aO = { x: a.x + nx * halfT, y: a.y + ny * halfT };
      const aI = { x: a.x - nx * halfT, y: a.y - ny * halfT };
      const bO = { x: b.x + nx * halfT, y: b.y + ny * halfT };
      const bI = { x: b.x - nx * halfT, y: b.y - ny * halfT };
      ctx.setStrokeStyle(color); ctx.setLineWidth(3);
      ctx.beginPath(); ctx.moveTo(aO.x, aO.y); ctx.lineTo(bO.x, bO.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(aI.x, aI.y); ctx.lineTo(bI.x, bI.y); ctx.stroke();
      if (type === 'win') {
        ctx.setLineWidth(1.5); ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      } else if (type === 'door') {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        ctx.setLineWidth(2); ctx.beginPath(); ctx.arc(mx, my, halfT * 1.4, 0, 2 * Math.PI); ctx.stroke();
      }
    };
    // 已确认墙体（双线）
    for (let i = 0; i < this.dEdges.length; i++) drawBand(px[i], px[i + 1], colOf(this.dEdges[i].type), this.dEdges[i].type);
    // 角点连接(外↔内)
    ctx.setStrokeStyle('#1f8a70'); ctx.setLineWidth(3);
    for (let i = 0; i < px.length; i++) {
      const a = px[i], b = px[(i + 1) % px.length];
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      if (L < 0.5) continue;
      const nx = -dy / L, ny = dx / L;
      ctx.beginPath(); ctx.moveTo(a.x + nx * halfT, a.y + ny * halfT); ctx.lineTo(a.x - nx * halfT, a.y - ny * halfT); ctx.stroke();
    }
    // 段长与类型标注
    ctx.setFontSize(12);
    for (let i = 0; i < this.dEdges.length; i++) {
      const a = px[i], b = px[i + 1];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      ctx.setFillStyle(colOf(this.dEdges[i].type));
      const tag = this.dEdges[i].type === 'win' ? '窗' : this.dEdges[i].type === 'door' ? '门' : '墙';
      ctx.fillText(this.dEdges[i].lenM.toFixed(2) + 'm ' + tag, mx, my - halfT - 4);
    }
    // 待确认段（高亮虚线 + 端点），体现“点一下就出现一段”
    if (this.dPending && px.length) {
      const a = px[px.length - 1];
      const closing = this.dPending.closing;
      let bx, by;
      if (closing) { bx = px[0].x; by = px[0].y; }
      else if (this.data.edgePanel.len && parseFloat(this.data.edgePanel.len) > 0) {
        const lm = parseFloat(this.data.edgePanel.len) * this.dScale;
        bx = a.x + this.dPending.ux * lm; by = a.y + this.dPending.uy * lm;
      } else { bx = this.dPending.rawEnd.x; by = this.dPending.rawEnd.y; }
      ctx.setStrokeStyle('#f0a500'); ctx.setLineWidth(3); ctx.setLineDash([7, 4]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      ctx.setFillStyle('#f0a500'); ctx.beginPath(); ctx.arc(bx, by, 6, 0, 2 * Math.PI); ctx.fill();
      const tag = this._snapTag();
      if (tag) { ctx.setFillStyle('#f0a500'); ctx.setFontSize(12); ctx.fillText(tag, bx + 9, by - 6); }
    }
    // 橡皮筋(拖动预览)
    if (this.dMove && px.length && !this.dPending) {
      const a = px[px.length - 1];
      ctx.setStrokeStyle('#f0a500'); ctx.setLineWidth(2); ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(this.dMove.x, this.dMove.y); ctx.stroke(); ctx.setLineDash([]);
    }
    // 顶点：起点(红) + 其余(绿)
    px.forEach((p, i) => {
      if (i === 0) {
        ctx.setStrokeStyle('#e0533d'); ctx.setLineWidth(2);
        ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI); ctx.stroke();
        ctx.setFillStyle('#e0533d'); ctx.setFontSize(12); ctx.fillText('起', p.x + 11, p.y - 9);
      } else {
        ctx.setFillStyle('#1f8a70'); ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI); ctx.fill();
      }
    });
    // 当前端点高亮(绿圈)=续画锚点
    if (px.length >= 2) {
      const c = px[px.length - 1];
      ctx.setStrokeStyle('#1f8a70'); ctx.setLineWidth(2);
      ctx.beginPath(); ctx.arc(c.x, c.y, 8, 0, 2 * Math.PI); ctx.stroke();
    } else if (px.length === 1 && !this.dPending) {
      ctx.setFillStyle('#1f8a70'); ctx.setFontSize(12);
      ctx.fillText('从此点续画', px[0].x + 12, px[0].y + 16);
    }
    ctx.draw();
  },

  complete() {
    if (!this.dMeterPts || this.dMeterPts.length < 3) { wx.showToast({ title: '请先画出至少3段闭合', icon: 'none' }); return; }
    let poly = this.dMeterPts.map(p => ({ x: p.x * 100, y: p.y * 100 }));
    const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
    const minx = Math.min(...xs), miny = Math.min(...ys);
    poly = poly.map(p => ({ x: Math.round(p.x - minx), y: Math.round(p.y - miny) }));
    const space = this.data.space;
    space.poly = poly;
    space.edges = this.dEdges.map(e => ({ lenM: e.lenM, type: e.type, thick: Math.round(this.thick * 1000) }));
    space.w = Math.max(...poly.map(p => p.x)); space.d = Math.max(...poly.map(p => p.y));
    space.touched = true;   // 手绘闭合即视为已录入真实尺寸
    this.setData({ space, showDraw: false, edgePanel: { show: false }, dInfo: '' });
    this.recalc({ silent: true });
    wx.showToast({ title: '已生成双线户型', icon: 'success' });
  },

  // ===== 输入 =====
  // 尺寸/门窗变化 → 示意图实时重绘 + 工程量按规则重算（手填项除外）
  onW(e) { const s = this.data.space; s.w = parseFloat(e.detail.value) || 0; this.markTouched(); this.recalc({ silent: true }); },
  onD(e) { const s = this.data.space; s.d = parseFloat(e.detail.value) || 0; this.markTouched(); this.recalc({ silent: true }); },
  onH(e) { const s = this.data.space; s.h = parseFloat(e.detail.value) || 0; this.markTouched(); this.recalc({ silent: true }); },
  onDoorWall(e) { const s = this.data.space; s.doorWall = WALLS[e.detail.value].id; this.setData({ space: s, doorIdx: e.detail.value }); this.recalc({ silent: true }); },
  onWinWall(e) { const s = this.data.space; s.winWall = WALLS[e.detail.value].id; this.setData({ space: s, winIdx: e.detail.value }); this.recalc({ silent: true }); },
  onDoorW(e) { const s = this.data.space; s.doorW = parseFloat(e.detail.value) || 0; this.setData({ space: s }); this.recalc({ silent: true }); },
  onWinW(e) { const s = this.data.space; s.winW = parseFloat(e.detail.value) || 0; this.setData({ space: s }); this.recalc({ silent: true }); },

  onDimBlur() { this.recalc(); },   // 尺寸输完失焦时提示一次"自动算了多少项"

  toggleFurn(e) {
    const id = e.currentTarget.dataset.id;
    const s = this.data.space;
    s.furniture = s.furniture.map(f => f.id === id ? { ...f, on: !f.on } : f);
    this.setData({ space: s });
    this.recalc({ silent: true });   // 家具开关影响柜体/地柜长度
  },
  toggleMat(e) {
    const idx = e.currentTarget.dataset.idx;
    const s = this.data.space;
    const m = s.materials[idx];
    const willOn = !m.on;
    // 互斥选项组：开启某项时，自动取消同组其它项（默认出价只选一个）
    if (willOn && m.group) {
      s.materials.forEach((x, i) => { if (i !== idx && x.group === m.group) x.on = false; });
    }
    m.on = willOn;
    this.setData({ space: fresh(s) });
    this.updateQuote();
  },
  onQty(e) {
    const idx = e.currentTarget.dataset.idx;
    const s = this.data.space;
    s.materials[idx].qty = parseFloat(e.detail.value) || 0;
    s.materials[idx].qtyText = e.detail.value;   // 输入中保留原样（含末尾小数点），失焦才格式化
    s.materials[idx].manual = true;              // 手填标记（界面打「手填」徽标区分算法值）
    this.setData({ space: fresh(s) });
    this.updateQuote();
  },
  onQtyBlur(e) {
    const idx = e.currentTarget.dataset.idx;
    const s = this.data.space;
    s.materials[idx].qty = round1(s.materials[idx].qty);
    s.materials[idx].qtyText = fmt1(s.materials[idx].qty);
    this.setData({ space: fresh(s) });
    this.updateQuote();
  },
  toggleLabor(e) {
    const idx = e.currentTarget.dataset.idx;
    const s = this.data.space;
    s.labor[idx].on = !s.labor[idx].on;
    this.setData({ space: fresh(s) });
    this.updateQuote();
  },
  onLaborQty(e) {
    const idx = e.currentTarget.dataset.idx;
    const s = this.data.space;
    s.labor[idx].qty = parseFloat(e.detail.value) || 0;
    s.labor[idx].qtyText = e.detail.value;   // 输入中保留原样，失焦才格式化
    s.labor[idx].manual = true;              // 手填标记
    this.setData({ space: fresh(s) });
    this.updateQuote();
  },

  // 按工程量规则估算数量（可手改覆盖；不改 config.js 默认值）
  onEstimate(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const kind = e.currentTarget.dataset.kind;
    const s = this.data.space;
    const list = kind === 'l' ? s.labor : s.materials;
    const it = list[idx];
    if (!it) return;
    const q = est.estimateQty(it.id, s);
    if (q === null || q === undefined) {
      wx.showToast({ title: '按项/套计价，无需估算', icon: 'none' });
      return;
    }
    it.qty = q;
    it.qtyText = fmt1(q);   // 估算后同步显示文本，清掉残留的旧输入
    it.manual = false;      // 采纳系统估算值：以后改尺寸会自动跟着重算
    this.setData({ space: fresh(s) });
    this.updateQuote();
    wx.showToast({ title: it.name + ' → ' + q + it.unit, icon: 'none' });
  },
  onLaborQtyBlur(e) {
    const idx = e.currentTarget.dataset.idx;
    const s = this.data.space;
    s.labor[idx].qty = round1(s.labor[idx].qty);
    s.labor[idx].qtyText = fmt1(s.labor[idx].qty);
    this.setData({ space: fresh(s) });
    this.updateQuote();
  },
  // 辅助费已移至「总预算」汇总页统一选择，录入页不再显示（避免多空间重复计价）

  // ===== 尺寸 → 示意图 → 工程量 三点联动 =====
  // autoEstimate：按预算算法把工程量算出来写回 list；item.manual=true 表示该项被手工改过，不自动覆盖
  // 按预算算法算出全部可算工程量并写回（项/套/樘计价项返回 null，跳过）
  autoEstimate() {
    const s = this.data.space;
    if (!s) return 0;
    let n = 0;
    const fill = it => {
      if (!it || it.on === false) return;
      const q = est.estimateQty(it.id, s);
      if (q === null || q === undefined) return;
      if (Math.abs((it.qty || 0) - q) > 0.05) n++;
      it.qty = q;
      it.qtyText = fmt1(q);
      it.auto = true;          // 标记：本项为算法自动算出（界面打「算法」徽标）
    };
    (s.materials || []).forEach(fill);
    (s.labor || []).forEach(fill);
    return n;
  },

  // 自动算出明细：贴砖 12.4㎡ · 地柜 4.6M …
  autoLineOf(s) {
    const parts = [];
    (s.materials || []).concat(s.labor || []).forEach(it => {
      if (it.auto && it.qty) parts.push(it.name + ' ' + fmt1(it.qty) + it.unit);
    });
    const show = parts.slice(0, 6).join(' · ');
    return parts.length > 6 ? show + ' …' : show;
  },

  // 改尺寸/家具/门窗/语音后统一入口：重算工程量 → 重绘示意图 → 刷新报价
  // 注意：必须给 setData 一个新对象引用，否则同引用 setData 视图层不刷新（工程量会看着"没算"）
  recalc(opts) {
    const o = opts || {};
    const s = this.data.space;
    if (!s) return;
    // 未录入真实尺寸：所有工程量强制为 0，不计算（避免按示例模板尺寸自动生成）
    if (!s.touched) {
      (s.materials || []).forEach(it => { it.qty = 0; it.qtyText = '0'; it.auto = false; it.manual = false; });
      (s.labor || []).forEach(it => { it.qty = 0; it.qtyText = '0'; it.auto = false; it.manual = false; });
      this.setData({ space: s, autoCount: 0, autoLine: '' });
      this.updateQuote();
      return 0;
    }
    const n = this.autoEstimate();
    const snap = JSON.parse(JSON.stringify(s));
    snap.autoCount = n;
    snap.autoLine = this.autoLineOf(snap);
    this.setData({ space: snap, autoCount: n, autoLine: snap.autoLine });
    // 等视图层刷完再画，避免旧尺寸残留
    this.drawMini();
    if (wx.nextTick) wx.nextTick(() => this.drawMini()); else setTimeout(() => this.drawMini(), 30);
    this.updateQuote();
    if (n > 0 && !o.silent && o.toast !== false) {
      wx.showToast({ title: '已按算法自动算 ' + n + ' 项工程量', icon: 'none', duration: 1800 });
    }
    return n;
  },

  // 录入了有效尺寸 → 标记 touched，触发按算法计算
  markTouched() {
    const s = this.data.space;
    if (s.w > 0 || s.d > 0 || s.h > 0) s.touched = true;
    this.setData({ space: s });
  },

  // 强制按尺寸重算（忽略手工改动）
  onRecalc() {
    this.recalc({ force: true });
  },

  updateQuote() {
    const s = this.data.space;
    // 与项目里已存空间同步「全屋拆除」联动标记：≥2 空间且选了全屋拆除 → 本空间「墙地砖整体拆除」按 0 计
    const proj = (getApp().globalData || {}).project;
    if (proj && (proj.spaces || []).length) {
      const hit = (proj.spaces || []).find(x => x.key === s.key);
      s.wholeDemoOn = hit ? !!hit.wholeDemoOn
        : auxRule.wholeDemoOn((proj.spaces || []).length + 1, (proj.fee || {}).auxQty);
    }
    const tier = s.tier || 'none';
    s.materials.forEach(m => { m.dispPrice = effUnitPrice(m, tier).price; });
    const q = calcQuote(s);
    this.setData({ quote: q, space: s, dedupOn: !!q.demoDedupOn });
  },

  generate() {
    try {
      this.doGenerate();
    } catch (e) {
      // 兜底：任何异常都给出可见提示，避免"点了没反应"
      wx.showModal({ title: '生成失败', content: String((e && e.message) || e), showCancel: false });
    }
  },

  doGenerate() {
    // 老板 2026-10-21 定：点「生成预算」时必须已注册，否则先收信息再出预算。
    // 先把当前空间放进 globalData：注册页要用它自动算面积；注册回来后再并入项目。
    const space = JSON.parse(JSON.stringify(this.data.space));
    const app = getApp();
    app.globalData.space = space;

    const user = store.getUser();
    // 缺手机号 = 未注册；缺 decoType = 老数据（没有整装/局改），补全后再出预算
    if (!user || !user.phone || !user.decoType) {
      try { wx.setStorageSync('pending_gen_v1', Date.now()); } catch (e) {}
      wx.navigateTo({ url: '/pages/register/register?from=generate' });
      return;
    }

    space.customer = user.name || '';
    const idx = app.addSpace(space);   // 写入多空间项目（按 key 去重）
    // 全屋拆除生效（本项目 ≥2 空间且其工程量>0）时：各空间「墙地砖整体拆除」工程量置 0，避免重复计价
    const proj = app.globalData.project;
    syncWholeDemoDedup(proj);
    (proj.spaces || []).forEach(s => { s.quote = calcQuote(s); });
    space.quote = calcQuote(space);
    // 存档：每次生成存一条历史（含完整空间快照，便于后期查看/修改），便于后期查看
    const rec = {
      customer: user ? user.name : '',
      phone: user ? user.phone : '',
      address: getApp().globalData.project.address || '',
      spaceName: space.name,
      tier: (TIERS[space.tier || 'none'] || {}).name || '经济',
      dim: space.w + '×' + space.d + '×' + space.h + ' cm',
      matTotal: space.quote.matTotal,
      laborTotal: space.quote.laborTotal,
      total: space.quote.total,
      space: space
    };
    this.saveProject();   // 同步把整个项目(多空间+辅助)存为一条记录
    if (this.editId) {
      store.updateHistory(this.editId, rec);
      wx.navigateTo({ url: '/pages/budget/budget?rec=' + this.editId });
    } else {
      store.addHistory(rec);
      wx.navigateTo({ url: '/pages/budget/budget?idx=' + idx });
    }
  },

  // 把当前多空间项目存为一条「项目记录」（含各空间 + 辅助/税/管 + 总预算），按 project.id 去重
  saveProject() {
    const app = getApp();
    const p = app.globalData.project;
    if (!p.id) p.id = 'p' + Date.now();
    const user = store.getUser() || {};
    const fee = p.fee || { floor: 1, taxOn: true, taxPct: 3, mgrPct: 10, auxQty: {} };
    // 全屋拆除生效时，各空间内重复的「墙地砖整体拆除」按 0 计（先刷标记再重算）
    syncWholeDemoDedup(p);
    let base = 0;
    const spaces = (p.spaces || []).map(s => {
      const q = calcQuote(s); s.quote = q;
      base += q.total;
      return {
        key: s.key, name: s.name,
        dim: s.w + '×' + s.d + '×' + s.h + ' cm',
        tier: (TIERS[s.tier || 'none'] || {}).name || '经济',
        matTotal: q.matTotal, laborTotal: q.laborTotal, total: q.total,
        snap: s   // 完整空间快照，便于记录里查看图纸/分项
      };
    });
    // 辅助项目工程量：按本项目空间数走预算算法默认（1 个空间=局部项，≥2 个=全屋项）
    const whole = calcWholeAux(base, {
      floor: fee.floor, taxOn: fee.taxOn, taxPct: fee.taxPct, mgrPct: fee.mgrPct,
      auxQty: auxRule.mergeQty(spaces.length || 1, fee.auxQty)
    });
    const taxAmt = (whole.items.find(it => it.id === 'tax') || {}).sub || 0;
    const mgrAmt = (whole.items.find(it => it.id === 'mgr') || {}).sub || 0;
    const auxFixedSub = whole.items.filter(it => it.kind !== 'pct').reduce((s, it) => s + (it.sub || 0), 0);
    const auxAll = whole.items.reduce((s, it) => s + (it.sub || 0), 0);
    const proj = {
      id: p.id, customer: user.name || '', phone: user.phone || '',
      address: p.address || '', time: Date.now(),
      spaces, fee: JSON.parse(JSON.stringify(fee)),
      auxFixedSub, taxAmt, mgrAmt, auxTotal: auxAll, grand: base + auxAll
    };
    store.upsertProject(proj);
  },

  // 进入全屏手绘页（第二阶段上线）
});
