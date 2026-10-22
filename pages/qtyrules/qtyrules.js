// 算法参数页：查看/修改工程量估算参数（只改算法参数，不碰项目/价格/工程量数据）
// 保存后立即可用于录入页「算」按钮；恢复默认一键回 v1.1 定版值。
const P = require('../../utils/qty-params.js');

const SPACE_NAMES = { kitchen: '厨房', bathroom: '卫生间', living: '客餐厅', bedroom: '卧室', study: '书房', balcony: '阳台' };

Page({
  data: {
    groups: [],
    dirty: false,
    msg: ''
  },

  onLoad() { this.build(); },

  // 按 schema 组装表单（value 取运行时参数）
  build() {
    const g = (title, note, fields) => ({ title, note, fields: fields.map(f => ({ ...f, value: this.getVal(f.path) })) });
    const num = (path, label, unit, note) => ({ type: 'num', path, label, unit, note: note || '' });
    const groups = [
      g('基础参数', '影响贴砖/瓷砖/涂料/地板等所有含损耗的项目', [
        num('TILE_H', '贴砖高度', 'm', '厨卫墙砖计算高度（老板定版 2.4）'),
        num('LOSS%', '损耗率', '%', '瓷砖/地砖/地板/涂料统一口径（定版 5）')
      ]),
      g('门洞尺寸', '影响门的㎡工程量与净墙面扣减', [
        num('DOOR.wood.w', '木门洞宽', 'm'), num('DOOR.wood.h', '木门洞高', 'm'),
        num('DOOR.slideDouble.w', '推拉门·双门宽', 'm', '老板定版 1.6'), num('DOOR.slideDouble.h', '推拉门·双门高', 'm'),
        num('DOOR.slideSingle.w', '推拉门·单门宽', 'm', '老板定版 0.8'), num('DOOR.slideSingle.h', '推拉门·单门高', 'm'),
        num('DOOR.win.w', '窗洞宽', 'm'), num('DOOR.win.h', '窗洞高', 'm'),
        { type: 'sel', path: 'SLIDE_DOOR', label: '厨/阳台推拉门默认', options: ['double', 'single'], names: ['双门', '单门'], note: '' }
      ]),
      g('柜体与门套', '', [
        num('WARDROBE.len', '衣柜默认长', 'm', '定版 2.0（与布局上限一致）'),
        num('WARDROBE.h', '衣柜默认高', 'm', '到顶定版 2.6'),
        num('CASE_LEN', '门套每樘长', 'm', '单面=双面，定版 5.0'),
        { type: 'sw', path: 'FLOOR_UNDER_CAB', label: '柜下铺地板', note: '开=不扣柜占地（定版）；关=地板扣柜占地' }
      ]),
      g('防水与踢脚线', '', [
        num('WP_SKIRT', '防水墙面上翻', 'm', 'AI默认 0.3'),
        num('WP_SHOWER_H', '淋浴区防水高', 'm', 'AI默认 1.8'),
        num('SKIRTING_DOOR_W', '踢脚线扣门洞宽', 'm')
      ]),
      g('开关插座点位（个）', '老板定版：厨12/卫6/客餐厅15/房12/阳台5', [
        ...Object.keys(SPACE_NAMES).map(k => num('SOCKETS.' + k, SPACE_NAMES[k], '个'))
      ]),
      g('地漏与过门石（个）', '过门石定版：仅卫生间 1 块', [
        num('FLOOR_DRAIN.bathroom', '地漏·卫生间', '个'),
        num('FLOOR_DRAIN.balcony', '地漏·阳台', '个'),
        num('THRESHOLD.bathroom', '过门石·卫生间', '块')
      ]),
      g('厨房固定工程量（2026-09-28 录入）',
        '老板现场口述定版，只作用于厨房；表里没写的厨房项目仍走原算法',
        [
          { type: 'sw', path: 'KITCHEN_CAB_PLACED', label: '地柜按示意图实测', note: '关=公式 长+宽−0.6−0.7（默认）；开=以示意图实测柜长为准' }
        ])
    ];
    this.setData({ groups, dirty: false, msg: '' });
  },

  getVal(path) {
    if (path === 'LOSS%') return Math.round((P.LOSS || 0) * 1000) / 10;   // 0.05 → 5
    const parts = path.split('.');
    let v = P;
    for (const p of parts) v = v ? v[p] : undefined;
    return v === undefined ? '' : v;
  },

  setVal(path, val) {
    if (path === 'LOSS%') { P.LOSS = Math.max(0, Number(val) || 0) / 100; return; }
    const parts = path.split('.');
    let v = P;
    for (let i = 0; i < parts.length - 1; i++) { if (!v[parts[i]]) v[parts[i]] = {}; v = v[parts[i]]; }
    v[parts[parts.length - 1]] = val;
  },

  onNum(e) {
    const path = e.currentTarget.dataset.path;
    const v = parseFloat(e.detail.value);
    if (isFinite(v)) { this.setVal(path, v); this.setData({ dirty: true }); }
  },

  onBlur(e) {
    // 失焦即写 storage，防误退丢失；界面保持不动
    if (!this.data.dirty) return;
    P.__save({});
    this.setData({ msg: '已暂存', dirty: false });
  },

  onSwitch(e) {
    this.setVal(e.currentTarget.dataset.path, e.detail.value);
    P.__save({});
    this.build();
  },

  onSelect(e) {
    this.setVal(e.currentTarget.dataset.path, e.currentTarget.dataset.v);
    P.__save({});
    this.build();
  },

  // 各空间固定工程量清单（老板现场口述录入，逐条回显核对）
  onRules(e) {
    const key = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.space) || 'bathroom';
    const { FIXED_BY_SPACE } = require('../../utils/estimate.js');
    const T = FIXED_BY_SPACE[key];
    if (!T) { wx.showModal({ title: '尚未录入', content: '该空间还没有口述规则，全部项目走原算法。', showCancel: false }); return; }
    const list = [];
    const grp = (t, ks) => {
      const v = ks.filter(k => T[k] !== undefined).map(k => k + '=' + T[k]);
      if (v.length) list.push(t + '：' + v.join('、'));
    };
    if (key === 'kitchen') {
      grp('拆除', ['墙地砖整体拆除', '局部拆除', '拆除后修补']);
      grp('水电', ['全空间做水电', '水电位改造', '门套基层处理']);
      grp('主材', ['拉篮', '水槽抽拉龙头', '烟机灶具套餐', '包烟管', '抽屉', '吊顶']);
      grp('门', ['推拉门', '平开门钛镁合金', '套装门', '厨房双边木门套', '钛镁合金门套']);
      grp('其它', ['翻筑工艺套餐', '超出面积', '热水器']);
      list.push('地柜 4.50M（3.2+2.6−0.6−0.7）· 吊柜按原规则 · 贴砖/插座按原算法');
    } else {
      grp('拆除', ['墙地砖整体拆除', '局部拆除', '拆除后修补']);
      grp('水电', ['全空间做水电', '水电位改造局部改造']);
      grp('防水', ['伟星咖乐防水湿区1.8m', '伟星咖乐防水湿区到顶', '防水处理', '防水处理2']);
      grp('主材', ['成品淋浴房', '淋浴房定制', '暖风机冷风机', '龙头', '马桶', '花洒', '铝扣板吊顶', '成品卫浴柜60-90cm', '隔音棉包水管']);
      grp('门', ['平开门钛镁合金', '套装门', '钛镁合金门套', '门套基层处理']);
      grp('其它', ['翻筑工艺套餐', '超出面积', '主材包', '淋浴区大理石台板']);
      list.push('贴砖/开关插座按原算法执行');
    }
    list.push('改尺寸后固定值不变；其它空间不受影响');
    wx.showModal({ title: (SPACE_NAMES[key] || key) + '固定工程量', content: list.join('\n'), showCancel: false });
  },

  onSave() {
    P.__save({});
    this.setData({ msg: '已保存并生效', dirty: false });
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  onReset() {
    wx.showModal({
      title: '恢复默认参数',
      content: '将清空你改过的算法参数，回到 v1.1 定版值。项目/价格数据不受影响。',
      confirmText: '恢复',
      success: res => {
        if (!res.confirm) return;
        P.__reset();
        this.build();
        wx.showToast({ title: '已恢复默认', icon: 'success' });
      }
    });
  },

  // 试算：用当前参数跑两个标准算例给老板核对
  onPreview() {
    const { estimateQty } = require('../../utils/estimate.js');
    const mk = (w, d, h, key, win) => ({ key, w, d, h, winWall: win ? 'top' : '' });
    const kitchen = mk(250, 200, 270, 'kitchen', true);
    const bedroom = mk(500, 400, 280, 'bedroom', true);
    const lines = [
      '5㎡厨房（2.5×2.0×2.7）：贴砖 ' + estimateQty('贴砖', kitchen) + '㎡ / 瓷砖 ' + estimateQty('瓷砖', kitchen) + '㎡ / 地柜 ' + estimateQty('地柜长度', kitchen) + 'M / 插座 ' + estimateQty('开关插座面板', kitchen) + '个',
      '20㎡卧室（5×4×2.8）：涂料墙 ' + estimateQty('墙面涂料', bedroom) + '㎡ / 地板 ' + estimateQty('复合实木地板', bedroom) + '㎡ / 衣柜 ' + estimateQty('定制衣柜', bedroom) + '㎡ / 踢脚线 ' + estimateQty('实木踢脚线', bedroom) + 'm'
    ];
    wx.showModal({ title: '参数试算', content: lines.join('\n'), showCancel: false });
  }
});
