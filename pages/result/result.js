const { calcQuote, buildThreeTiers, syncWholeDemoDedup } = require('../../utils/quote.js');
const { TIERS } = require('../../utils/brands.js');
const renderEng = require('../../utils/render.js');
const sf = require('../../utils/siliconflow.js');
const store = require('../../utils/store.js');
const quota = require('../../utils/renderquota.js');
const gallery = require('../../utils/gallery.js');

// 8 种装修风格（现场照片风格迁移可选）
const STYLES = [
  { id: 'random', name: '随机风格', desc: '由模型选择一种协调、现代且富有质感的室内风格，整体美观、采光通透、配色和谐' },
  { id: 'lightlux', name: '现代轻奢', desc: '现代轻奢：高级灰与金属质感，大理石或岩板台面，丝绒或皮质软包，低饱和暖色调，精致灯具与艺术陈设，低调奢华' },
  { id: 'modern', name: '现代风格', desc: '现代简约：中性灰白主调，简洁利落线条，浅木色与少量金属点缀，留白多、开放式' },
  { id: 'cream', name: '小资奶白风', desc: '小资奶白风：米白与奶油色墙面软装，柔和暖光，圆润轻盈家具，温润布艺与绿植点缀，浪漫温馨' },
  { id: 'american', name: '轻奢美式', desc: '轻奢美式：深胡桃木、黄铜金属、皮质软包，对称厚重家具，壁灯与艺术画，温暖高级' },
  { id: 'european', name: '欧式风格', desc: '欧式古典：米金色调，石膏线条与雕花顶角线，弧形曲线家具，水晶吊灯，华丽典雅' },
  { id: 'mediterranean', name: '地中海', desc: '地中海：白色墙面配海蓝色点缀，拱形元素，陶土与天然木，马赛克，明亮通透自然' },
  { id: 'newchinese', name: '新中式', desc: '新中式：深木色与大量留白，水墨意象，简洁东方线条，素雅布艺与盆景，沉稳雅致' }
];

// 按空间类型定义「必须出现的功能配置」与「不该出现的禁忌物件」
// 为什么必须有：模型只拿到风格词时，会照着照片里现有的物件去"换新"——
// 走廊照片被当成厨房生成，出来一堆书架油画皮椅，因为它不知道厨房该有什么。
const SPACE_PROFILE = {
  kitchen: {
    must: '整体橱柜（地柜＋吊柜）、灶台与灶具、抽油烟机、水槽与龙头、操作台面、冰箱、墙砖地砖、防潮吊顶',
    ban: '床、沙发、衣柜、书架、书桌、浴缸、马桶'
  },
  bathroom: {
    must: '马桶、浴室柜与洗手盆、镜柜、淋浴房（或浴缸）与花洒、地漏、墙砖地砖、防潮吊顶',
    ban: '床、沙发、橱柜灶台、抽油烟机、冰箱、书桌'
  },
  living: {
    must: '沙发、茶几、电视柜与电视、边几、地毯、主灯与筒灯',
    ban: '灶台、抽油烟机、马桶、淋浴房、床'
  },
  bedroom: {
    must: '双人床、床头柜、衣柜、窗帘、床头灯、木地板',
    ban: '灶台、抽油烟机、马桶、浴缸'
  },
  study: {
    must: '书桌、书椅、书柜或书架、台灯、窗帘、木地板',
    ban: '灶台、抽油烟机、马桶、浴缸、床'
  },
  balcony: {
    must: '洗衣机或洗衣柜、晾衣架、收纳柜、绿植、防滑地砖',
    ban: '灶台、抽油烟机、马桶、床'
  }
};
const DEFAULT_PROFILE = { must: '该空间应有的标准家具与功能设施', ban: '与本空间功能无关的物品' };

Page({
  data: {
    tab: 'render',          // 默认进入效果图（示意图已移除，2026-10-13 老板定）
    space: null,
    quote: { total: 0, items: [] },
    doorName: '-',
    winName: '-',
    threeTiers: null,
    tierName: '经济',
    projectGrand: 0,
    projectCount: 0,
    recId: '',
    renderUrl: '',
    renders: [],          // 该空间生成的效果图相册（多张）
    renderDemo: false,
    renderErr: '',
    rendering: false,
    hasApi: false,         // 是否配置了生图代理（配置了才开放拍照生成）
    payEnabled: false,     // 效果图是否开启付费（见 siliconflow.js PAY_ENABLED）
    registered: false,     // 是否已注册（未注册则报价页遮罩拦截）
    photoPath: '',         // 现场全景照片
    stampW: 300,           // 导出角标用的画布尺寸
    stampH: 300,
    styles: STYLES,
    selStyle: '',          // 已选风格 id
    genHint: '请先选择一种翻新风格',   // 按钮上的前置提示（缺啥显示啥）
    paying: false,
    // 额度与套餐（2026-10-21：每日免费 2 张，超出走付费套餐，支付未开通时记意向）
    quotaInfo: { freeLimit: 0, freeLeft: 0, balance: 0, totalLeft: 0 },
    packs: quota.PACKS,
    paySheet: false,
    noQuota: true,          // 默认无额度（免费已取消）→ 先展示示例图
    payReady: false,        // 支付是否已开通
    demoImg: ''             // 无额度时展示的同类空间示例图
  },

  onLoad(options) {
    // 生图启用：部署了自有代理并填了 PROXY_BASE（1.0.1 全用户可用）
    const apiCfg = wx.getStorageSync('render_api_cfg') || {};
    this.setData({ hasApi: !!(apiCfg && apiCfg.apiKey) || !!sf.PROXY_BASE, payEnabled: sf.payEnabled() });
    let space;
    if (options && options.rec) {
      const rec = (store.getHistory() || []).find(r => r.id === options.rec);
      if (rec && rec.space) { space = rec.space; this._recId = options.rec; }
    }
    if (!space && options && options.pid !== undefined && options.pid !== '') {
      const si = parseInt(options.si, 10) || 0;
      const p = (store.getProjects() || []).find(x => x.id === options.pid);
      if (p && p.spaces && p.spaces[si] && p.spaces[si].snap) { space = p.spaces[si].snap; this._pid = options.pid; this._pidProj = p; }
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
    this._spaceRef = space;
    this.renderSpace(space);
    // 若本空间已生成过效果图，恢复显示（兼容旧单张 render 与新多张 renders 相册），避免每次进页面都重新生成
    let renders = Array.isArray(space.renders) ? space.renders.slice() : [];
    if (!renders.length && space.render && space.render.url) renders = [space.render];
    if (renders.length) {
      const last = renders[renders.length - 1];
      this.setData({ renders, renderUrl: last.url, selStyle: last.style || this.data.selStyle, renderDemo: false });
      // 旧数据里若还存着网络临时地址，进页面时顺手补存到本地（过期了就下载失败，保持原样）
      renders.forEach((r, i) => { if (/^https?:\/\//.test(r.url || '')) this._localizeRender(i); });
    }
    this.checkReg();
    this.refreshGenHint();
  },

  // 根据当前选择计算按钮提示：缺啥就显示啥，避免"点了没反应"的困惑
  refreshGenHint() {
    const d = this.data;
    let hint = '';
    if (!d.selStyle) hint = '请先选择一种翻新风格';
    else if (!d.photoPath) hint = '请上传一张现场全景照片';
    this.setData({ genHint: hint });
  },

  onShow() {
    this.checkReg();
    this.refreshQuota();
  },

  checkReg() {
    this.setData({ registered: !!store.getUser(), payEnabled: sf.payEnabled() });
  },

  refreshQuota() {
    const info = quota.status();
    this.setData({
      quotaInfo: info,
      noQuota: info.totalLeft <= 0,      // 没额度：不出图，只展示示例 + 购买入口
      payReady: sf.payEnabled(),         // 支付是否已开通（没有商户号时为 false）
      demoImg: this._demoFor()
    });
    // 额度真身在服务端：本地先渲染，再拉一次校准（换手机/清缓存后也能拿回已购张数）
    quota.sync().then(st => {
      this.setData({
        quotaInfo: st,
        noQuota: st.totalLeft <= 0,
        demoImg: this._demoFor()
      });
    }).catch(() => {});
  },

  // 支付成功后回调入账有 1~3 秒延迟，分两次拉，避免客户看到"付了没到账"
  _pollQuota(times) {
    const n = times == null ? 2 : times;
    quota.sync().then(st => {
      this.setData({ quotaInfo: st, noQuota: st.totalLeft <= 0 });
      if (st.totalLeft <= 0 && n > 0) setTimeout(() => this._pollQuota(n - 1), 1500);
    }).catch(() => {});
  },

  // 没额度时给同类空间的示例效果图，让客户知道"能做成什么样"（素材在 assets/renders）
  _demoFor() {
    const sp = this.data.space || {};
    const KEY_BY_NAME = { '厨房': 'kitchen', '卫生间': 'bathroom', '客餐厅': 'living', '客厅': 'living', '卧室': 'bedroom', '书房': 'study', '阳台': 'balcony' };
    const k = sp.key || KEY_BY_NAME[sp.name] || 'living';
    return '/assets/renders/' + k + '.jpg';
  },

  // 渲染当前空间报价（含三档对比 + 全屋合计）
  renderSpace(space) {
    const q = (this._force || !space.quote) ? calcQuote(space) : space.quote;
    space.quote = q;
    const withDisp = arr => (arr || []).map(it => ({ ...it, qtyDisp: (Number(it.qty) || 0).toFixed(1) }));
    q.matItems = withDisp(q.matItems);
    q.laborItems = withDisp(q.laborItems);
    const wName = { top: '上/北', bottom: '下/南', left: '左/西', right: '右/东' };
    let projectGrand = 0, projectCount = 0;
    if (this._pidProj) { projectGrand = this._pidProj.grand; projectCount = this._pidProj.spaces.length; }
    else if (this._recId) { projectGrand = q.total; projectCount = 1; }
    else {
      const proj = getApp().globalData.project.spaces || [];
      proj.forEach(s => { projectGrand += (s.quote ? s.quote.total : 0); });
      projectCount = proj.length;
    }
    this.setData({
      space,
      quote: q,
      doorName: wName[space.doorWall] || '-',
      winName: wName[space.winWall] || '-',
      tierName: (TIERS[space.tier || 'none'] || {}).name || '经济',
      threeTiers: buildThreeTiers(space).filter(t => t.key === (space.tier || 'none')),
      projectGrand,
      projectCount,
      recId: this._recId || ''
    });
  },

  // 结果页直接切换档位：单价与总价同步变化
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
        matTotal: space.quote.matTotal,
        laborTotal: space.quote.laborTotal,
        total: space.quote.total,
        space
      });
    }
    this.renderSpace(space);
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ tab });
  },

  // ===== 注册拦截：未注册要求先注册，注册后完整展示预算 =====
  goRegister() { wx.navigateTo({ url: '/pages/register/register?from=result' }); },

  // ④主材 ⑤施工 ⑥合计 已迁到独立 budget 页面（1.0.1 老板定），此处仅提供入口
  toBudget() {
    if (this._recId) wx.navigateTo({ url: '/pages/budget/budget?rec=' + this._recId });
    else if (this._idx != null) wx.navigateTo({ url: '/pages/budget/budget?idx=' + this._idx });
  },

  // ===== 效果图（拍摄现场照片 + 选风格 + 支付 + 生成 + 下载）=====
  capturePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],          // 压缩版：豆包 base64 上限 10MB，iPhone 原图容易超
      maxWidth: 1600,
      maxHeight: 1600,
      success: res => {
        this.setData({ photoPath: res.tempFiles[0].tempFilePath, renderUrl: '', renderErr: '' });
        this.refreshGenHint();
      }
    });
  },
  chooseStyle(e) {
    this.setData({ selStyle: e.currentTarget.dataset.id, renderUrl: '', renderErr: '' });
    this.refreshGenHint();
  },

  genRender() {
    if (this.data.rendering || !this.data.space) return;
    if (!this.data.selStyle) { const m = '请先选择一种翻新风格'; this.setData({ renderErr: m }); wx.showToast({ title: m, icon: 'none' }); return; }
    if (!this.data.photoPath) { const m = '请先上传一张现场全景照片'; this.setData({ renderErr: m }); wx.showToast({ title: m, icon: 'none' }); return; }
    // 额度闸门：每日免费 2 张，用完后弹套餐（2026-10-21 老板定）
    const info = quota.status();
    if (info.totalLeft <= 0) {
      this.setData({ paySheet: true, quotaInfo: info });
      return;
    }
    this.payAndGenerate();
  },

  // 先扣额度再生成；失败会返还（见 doGenerateImage 的 fail）
  // 额度在服务端扣减，成功后同步本地缓存
  payAndGenerate() {
    quota.consume().then(t => {
      if (!t || !t.ok) {
        this.setData({ paySheet: true, quotaInfo: quota.status() });
        return;
      }
      this._ticket = t;
      this.refreshQuota();
      this.doGenerateImage();
    }).catch(() => {
      this.setData({ paySheet: true, quotaInfo: quota.status() });
    });
  },

  // ===== 套餐购买面板 =====
  openPaySheet() { this.setData({ paySheet: true, quotaInfo: quota.status() }); },
  closePaySheet() { this.setData({ paySheet: false }); },
  noopPay() {},

  buyPack(e) {
    const id = e.currentTarget.dataset.id;
    const pack = (quota.PACKS || []).find(p => p.id === id);
    if (!pack) return;

    // 支付通道还没开通 → 只记「付费意向」，不扣钱
    // 目的：先测出到底有多少人愿意为效果图付费，等商户号下来直接切真实支付
    if (!sf.payEnabled()) {
      try {
        quota.recordIntent(pack, {
          style: this.data.selStyle,
          spaceName: (this.data.space || {}).name || '',
          city: (store.getUser() || {}).city || ''
        });
      } catch (err) {}
      this.setData({ paySheet: false });
      wx.showModal({
        title: '已记下你的意向',
        content: '支付通道还在开通中，现在还不能购买，所以不会扣任何费用。开通后会在小程序内公告，到时可以直接买「' + pack.title + '」。',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }

    if (this.data.paying) return;
    this.setData({ paying: true });
    sf.createPayOrder({ amount: pack.price, count: pack.count, desc: '效果图 ' + pack.count + ' 张' })
      .then(payArgs => {
        wx.requestPayment({
          ...payArgs,
          success: () => {
            // 加额度这一步由微信服务器回调后端完成，前端只负责拉取确认
            this.setData({ paying: false, paySheet: false });
            wx.showToast({ title: '支付成功，正在到账', icon: 'none' });
            this._pollQuota(3);
          },
          fail: () => { this.setData({ paying: false }); wx.showToast({ title: '支付未完成', icon: 'none' }); }
        });
      })
      .catch(err => {
        this.setData({ paying: false });
        wx.showToast({ title: '下单失败：' + ((err && err.message) || ''), icon: 'none' });
      });
  },

  doGenerateImage() {
    this.setData({ rendering: true, renderErr: '' });
    const sel = this.data.styles.find(s => s.id === this.data.selStyle) || STYLES[1];
    const styleName = sel.name;
    const styleDesc = sel.desc || '';
    const sp = this.data.space || {};
    const spaceName = sp.name || '房间';
    // 兜底：老数据可能没存 key，用名称反查
    const KEY_BY_NAME = { '厨房': 'kitchen', '卫生间': 'bathroom', '客餐厅': 'living', '客厅': 'living', '卧室': 'bedroom', '书房': 'study', '阳台': 'balcony' };
    const prof = SPACE_PROFILE[sp.key || KEY_BY_NAME[spaceName] || ''] || DEFAULT_PROFILE;

    // 照片模式提示词（2026-10-20 重构）
    // 旧版逻辑漏洞：只给"风格 + 保持轮廓 + 换掉家具"，模型会照着照片里现有的物件换新，
    // 于是走廊照片 + 厨房标签 → 生成出一间"换了样子的走廊书房"（书架/油画/皮椅），完全没有厨房功能。
    // 现在改为：① 明确"房间外轮廓"（墙/门/窗/层高/视角）不变，不是物品轮廓；② 给出该空间必含的功能清单；③ 给出禁忌物件；④ 照片内容与空间不符时以功能为准。
    const styleLine = sel.id === 'random'
      ? '整体采用协调、现代且富有质感的室内设计风格，配色和谐、采光通透'
      : '整体严格采用' + styleName + '风格（' + styleDesc + '），配色与材质统一';
    const prompt = '把这张' + spaceName + '的现场照片，重新装修成功能完整、可直接交付使用的' + spaceName + '效果图。\n' +
      '必须满足：\n' +
      '1. 房间外轮廓保持不变——墙体位置、门洞位置与开门方向、窗户位置与大小、层高都不能改动，输出画面沿用原照片的取景范围与透视；\n' +
      '2. 按' + spaceName + '的真实使用功能重新布置，画面中必须包含：' + prof.must + '；\n' +
      '3. ' + styleLine + '，材质与工艺有质感，达到样板间级别的设计水准；\n' +
      '4. 照片里原有的物品（家具、橱柜、装饰画、摆件、杂物及其原有样式）全部清除重做，不要照搬；\n' +
      '5. 画面中不要出现与' + spaceName + '功能无关的物品：' + prof.ban + '；\n' +
      '6. 即使照片拍摄的房间看起来不像标准的' + spaceName + '，也请以' + spaceName + '的功能需求为准重新布置；\n' +
      '7. 高清写实摄影质感，自然采光，画面中不要出现任何文字、水印或标识。';

    const finish = (url) => {
      this._ticket = null;                 // 图已出，额度正常消耗，不再返还
      const ts = Date.now();
      const renders = this.data.renders.concat({ url, style: this.data.selStyle, ts });
      this.setData({ rendering: false, renders, renderUrl: url, renderDemo: false });
      this._persistRender(renders);
      // 入相册：所有生成过的效果图长期保留（相册页小图点开大图）
      try {
        gallery.add({
          ts, url,
          style: this.data.selStyle,
          styleName: (sel && sel.name) || '',
          spaceName: spaceName,
          projectId: ((getApp().globalData || {}).project || {}).id || ''
        });
      } catch (e) {}
      // 豆包给的是 24 小时有效的临时链接 → 立刻在后台落成本地文件（失败则保留网络地址）
      this._localizeRender(renders.length - 1);
      this.refreshQuota();
    };
    const fail = (e) => {
      // 没出图就退回额度，避免"扣了没结果"
      if (this._ticket) {
        try { quota.refund(this._ticket); } catch (err) {}
        this._ticket = null;
      }
      this.refreshQuota();
      const kb = this._lastB64Len ? ('｜图片 ' + Math.round(this._lastB64Len / 1024) + 'KB') : '';
      const m = '生成失败：' + ((e && e.message) || '未知错误') + kb;
      this.setData({ rendering: false, renderErr: m });
      // 弹窗强制可见：页面里那行小字经常被忽略/在屏幕外
      wx.showModal({ title: '生成失败', content: String(m).slice(0, 300), showCancel: false, confirmText: '知道了' });
    };

    if (this.data.photoPath) {
      // 关键：base64 会膨胀 1.33 倍，iPhone 原图 2~4MB 转完 3~5MB，
      // 超过小程序单次请求体量上限 → 请求被截断 → 方舟报 "could not parse the JSON body"。
      // 所以上传前强制压到 1280px / quality 70（约 150~300KB）。
      const MAX_B64 = 1500000;   // base64 字符数上限（约 1.1MB 原图）
      const send = (filePath, fmt) => {
        wx.getFileSystemManager().readFile({
          filePath: filePath, encoding: 'base64',
          // 效果图模型：豆包 Seedream（默认 5.0 pro，可在后台「生图 API」改）。
          // 内置 Key 直连火山方舟；后台填了合法 Key 则用后台的。
          success: r => {
            const b64 = (r.data || '').replace(/[\r\n]/g, '');   // 个别机型 base64 会夹换行，进 JSON 会坏
            const len = b64.length;
            this._lastB64Len = len;
            if (len > MAX_B64) {
              fail(new Error('照片太大（base64 ' + Math.round(len / 1024) + 'KB），已超过接口上限。请重拍或从相册选一张压缩过的图'));
              return;
            }
            sf.genImage({ prompt, imageBase64: 'data:' + fmt + ';base64,' + b64 }).then(finish).catch(fail);
          },
          fail: () => fail(new Error('读取照片失败'))
        });
      };
      // 先压一次；压失败就直接用原图（会走上面的体积闸门）
      wx.compressImage({
        src: this.data.photoPath,
        quality: 70,
        compressedWidth: 1280,
        success: res => send(res.tempFilePath, 'image/jpeg'),
        fail: () => {
          const ext = ((this.data.photoPath || '').split('.').pop() || '').toLowerCase();
          send(this.data.photoPath, ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg'));
        }
      });
      return;
    }
    this.setData({ rendering: false, renderErr: '请先上传一张现场全景照片' });
  },

  previewRender(e) {
    const url = (e && e.currentTarget && e.currentTarget.dataset.url) || this.data.renderUrl;
    if (!url) return;
    wx.previewImage({ urls: [url] });
  },
  // 点相册缩略图切换主图
  tapRender(e) {
    const url = e.currentTarget.dataset.url;
    if (url) this.setData({ renderUrl: url });
  },

  // 下载到相册：合成「算一算生成」角标后存入相册
  saveRender() {
    const url = this.data.renderUrl;
    if (!url) { wx.showToast({ title: '请先生成效果图', icon: 'none' }); return; }
    wx.showLoading({ title: '正在保存', mask: true });
    if (/^https?:\/\//.test(url)) {
      wx.downloadFile({
        url,
        success: r => {
          if (r.statusCode === 200) this._stampAndSave(r.tempFilePath);
          else { wx.hideLoading(); wx.showToast({ title: '图片下载失败，请重试', icon: 'none' }); }
        },
        fail: () => { wx.hideLoading(); wx.showToast({ title: '图片下载失败，请检查网络', icon: 'none' }); }
      });
    } else {
      this._stampAndSave(url);
    }
  },

  // 盖角标后存相册。
  // ⚠️ 不能用 wx.createOffscreenCanvas：离屏 Canvas 没有 toTempFilePath 方法，
  //    旧实现在此处抛异常且无兜底 → 用户点按钮"完全没反应"。
  //    现改为页面内 canvas 组件 + wx.canvasToTempFilePath，任何环节失败都直接存原图。
  _stampAndSave(filePath) {
    const fallback = () => this._save(filePath);
    wx.getImageInfo({
      src: filePath,
      success: info => {
        const w = info.width || 1080, h = info.height || 1080;
        const scale = Math.min(1, 2000 / Math.max(w, h));   // 超大图缩到 2000px 内，防 canvas 内存溢出
        const cw = Math.round(w * scale), ch = Math.round(h * scale);
        this.setData({ stampW: cw, stampH: ch }, () => {
          const run = () => {
            wx.createSelectorQuery().in(this).select('#stampCanvas')
              .fields({ node: true, size: true }).exec(res => {
                const node = res && res[0] && res[0].node;
                if (!node) { fallback(); return; }
                try {
                  node.width = cw; node.height = ch;
                  const ctx = node.getContext('2d');
                  const img = node.createImage();
                  img.onload = () => {
                    try {
                      ctx.drawImage(img, 0, 0, cw, ch);
                      const fs = Math.max(16, Math.round(cw / 30));
                      ctx.font = 'bold ' + fs + 'px sans-serif';
                      ctx.textBaseline = 'middle';
                      const text = '算一算生成';
                      const tw = ctx.measureText(text).width;
                      const padX = fs * 0.5, padY = fs * 0.35;
                      const bw = tw + padX * 2, bh = fs + padY * 2;
                      const bx = cw - bw - 16, by = ch - bh - 16;
                      ctx.fillStyle = 'rgba(0,0,0,0.45)';
                      ctx.fillRect(bx, by, bw, bh);
                      ctx.fillStyle = '#ffffff';
                      ctx.fillText(text, bx + padX, by + bh / 2);
                      wx.canvasToTempFilePath({
                        canvas: node, destWidth: cw, destHeight: ch,
                        success: r => this._save(r.tempFilePath || filePath),
                        fail: fallback
                      });
                    } catch (e) { fallback(); }
                  };
                  img.onerror = fallback;
                  img.src = filePath;
                } catch (e) { fallback(); }
              });
            // 等画布渲染完成再取节点
          };
          if (wx.nextTick) wx.nextTick(run); else setTimeout(run, 50);
        });
      },
      fail: fallback
    });
  },

  _save(fp) {
    wx.hideLoading();
    wx.saveImageToPhotosAlbum({
      filePath: fp,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: (e) => {
        const msg = (e && e.errMsg) || '';
        // 隐私协议里没声明「相册（仅写入）」时会走到这里，这不是用户权限问题，
        // 去系统设置里也找不到开关，所以引导长按保存（系统菜单不需要小程序权限）
        if (/privacy agreement|api scope is not declared/i.test(msg)) {
          wx.showModal({
            title: '请长按图片保存',
            content: '长按上方效果图 → 选择「保存图片」，即可存到手机相册。',
            showCancel: false,
            confirmText: '知道了'
          });
        } else if (/auth|deny|denied/i.test(msg)) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存图片需要访问相册，请在设置中开启「保存到相册」权限后重试',
            confirmText: '去设置',
            success: r => { if (r.confirm) wx.openSetting(); }
          });
        } else if (/cancel/i.test(msg)) {
          // 用户主动取消，不打扰
        } else {
          wx.showModal({ title: '保存失败', content: String(msg).slice(0, 200), showCancel: false });
        }
      }
    });
  },

  back() { wx.navigateBack(); },

  toEdit() {
    if (this._recId) wx.navigateTo({ url: '/pages/index/index?edit=' + this._recId });
  },

  toSummary() {
    if (this._pid) { wx.redirectTo({ url: '/pages/summary/summary?pid=' + this._pid }); return; }
    wx.navigateTo({ url: '/pages/summary/summary' });
  },

  // 生成的效果图按空间保存（多张相册），重进页面（含从汇总页点进来）保留，不重复生成
  _persistRender(renders) {
    const s = this._spaceRef; if (!s) return;
    s.renders = renders || [];
    s.render = renders.length ? { url: renders[renders.length - 1].url, style: renders[renders.length - 1].style || '' } : null;
    if (this._recId) store.updateHistory(this._recId, { space: s });
    if (this._pid && this._pidProj) {
      const si = this._pidSi || 0;
      if (this._pidProj.spaces[si]) this._pidProj.spaces[si].snap = s;
    }
  },

  // ===== 效果图本地化 =====
  // 豆包返回的是带签名的临时地址（X-Tos-Expires=86400，24 小时失效），
  // 直接存链接会导致"隔天打开历史记录全是裂图"。这里下载后复制进小程序用户目录，永久可用。
  _localizeRender(idx) {
    const list = this.data.renders || [];
    const item = list[idx];
    if (!item || !/^https?:\/\//.test(item.url || '')) return;
    const remote = item.url, ts = item.ts || Date.now();
    wx.downloadFile({
      url: remote,
      success: d => {
        if (d.statusCode !== 200) return;
        const fs = wx.getFileSystemManager();
        const dir = wx.env.USER_DATA_PATH + '/renders';
        try { fs.accessSync(dir); } catch (e) { try { fs.mkdirSync(dir, true); } catch (e2) {} }
        const dest = dir + '/r' + ts + '.jpg';
        fs.copyFile({
          srcPath: d.tempFilePath,
          destPath: dest,
          success: () => this._swapRenderUrl(remote, ts, dest),
          fail: () => {}   // 落盘失败就保留网络地址（至少当次可用）
        });
      },
      // 下载失败（常见：downloadFile 合法域名没配）→ 保留网络地址，不影响当次展示
      fail: () => {}
    });
  },

  // 把相册里指向 remote 的那一项换成本地路径（按 url 定位，避免生成多张时索引错位）
  _swapRenderUrl(remote, ts, local) {
    const next = (this.data.renders || []).slice();
    let hit = -1;
    for (let i = 0; i < next.length; i++) {
      if (next[i].url === remote) { hit = i; break; }
    }
    if (hit < 0) return;
    next[hit] = Object.assign({}, next[hit], { url: local });
    const patch = { renders: next };
    if (this.data.renderUrl === remote) patch.renderUrl = local;
    this.setData(patch);
    this._persistRender(next);
    // 相册里也换成永久本地路径，隔天打开不会裂图
    try { gallery.setLocal(ts, local); } catch (e) {}
  },

  // 效果图相册（长期保留所有生成过的图）
  goGallery() {
    wx.navigateTo({ url: '/pages/gallery/gallery' });
  },


  // ===== 微信分享 =====
  onShareAppMessage() {
    const nm = (this.data.space && this.data.space.name) || '我家装修';
    return { title: nm + ' AI 效果图 · 算一算装修多少钱', path: '/pages/home/home' };
  },
  onShareTimeline() {
    return { title: '算一算装修要花多少钱 · AI 效果图一键生成' };
  }
});
