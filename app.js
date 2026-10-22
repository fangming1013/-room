App({
  globalData: {
    space: null,            // 当前单空间（兼容旧流程）
    curIdx: -1,             // 当前空间在项目中的下标
    user: null,             // 当前注册客户
    project: { customer: '', spaces: [] }  // 多空间项目：每个空间独立图纸+预算，含总预算
  },
  onLaunch() {
    // 隐私授权（微信要求：调用隐私接口前需用户同意）
    this.initPrivacy();
    // 加载本地保存的计算规则覆写（后台/管理页修改后持久化）
    try {
      const cfg = require('./utils/config.js');
      const ov = wx.getStorageSync('config_override_v2');
      if (ov) cfg.setOverride(ov);
    } catch (e) {}
    // 恢复上次的预算清单：globalData 在小程序被回收后会清空，
    // 不恢复的话首页会显示"0 个空间"，用户会以为数据丢了（其实一直存在 storage 里）。
    this.restoreProject();
    // 补传上次没送出去的客资（网络失败/后端未配置时会排队）
    try { require('./utils/leadapi.js').flush(); } catch (e) {}
    // 静默登录取 openid：效果图额度、订单都挂在 openid 上
    // 失败不弹窗（老版本后端或断网时退回本地模式，不影响算价）
    try { require('./utils/wxauth.js').login(); } catch (e) {}
  },

  // 从本地存档恢复最近一次编辑的项目（含各空间快照与效果图路径）
  restoreProject() {
    try {
      const store = require('./utils/store.js');
      const list = (store.getProjects() || []).slice().sort((a, b) => (b.time || 0) - (a.time || 0));
      const last = list[0];
      if (!last) return;
      const spaces = (last.spaces || [])
        .map(x => (x && x.snap) ? x.snap : (x && x.key ? x : null))   // 兼容旧存档（无 snap 包装）
        .filter(Boolean);
      if (!spaces.length) return;
      this.globalData.project = {
        id: last.id,
        customer: last.customer || '',
        phone: last.phone || '',
        address: last.address || '',
        fee: last.fee || {},
        spaces: spaces
      };
      this.globalData.curIdx = -1;
    } catch (e) {}
  },
  // 监听隐私授权需求，触发官方隐私弹窗（需微信后台已配置《隐私保护指引》）
  initPrivacy() {
    try {
      if (typeof wx.onNeedPrivacyAuthorize === 'function') {
        wx.onNeedPrivacyAuthorize((resolve) => {
          wx.requirePrivacyAuthorize({
            success: () => { if (resolve) resolve(); },
            fail: () => { if (resolve) resolve(); },
            complete: () => { if (resolve) resolve(); }
          });
        });
      }
    } catch (e) {}
  },
  // 把空间写入项目（按 key 去重，已有则替换），返回下标
  addSpace(space) {
    const p = this.globalData.project;
    const i = p.spaces.findIndex(s => s.key === space.key);
    if (i >= 0) p.spaces[i] = space;
    else p.spaces.push(space);
    this.globalData.curIdx = p.spaces.findIndex(s => s.key === space.key);
    return this.globalData.curIdx;
  }
});
