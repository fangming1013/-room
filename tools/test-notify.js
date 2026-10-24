// 客资推送链路自测：发一条样例到老板微信，确认 PushPlus 通路与排版
// 用法：
//   node tools/test-notify.js          普通留资样例
//   node tools/test-notify.js render   iOS「预约设计师出图」样例
const notify = require('../backend/notify.js');

const plain = {
  phone: '13800138000', city: '深圳', decoTypeName: '局改', area: 68,
  budget: 12300, spaces: ['厨房', '卫生间'], name: '王先生'
};

const render = {
  phone: '13800138000', city: '杭州', decoTypeName: '局改', area: 6,
  budget: 42000, spaces: [{ name: '厨房' }], name: '李女士',
  wantRender: true, wantStyle: '现代风格', wantSpace: '厨房'
};

const isRender = process.argv[2] === 'render';
const sample = isRender ? render : plain;

(async () => {
  const note = '<p style="color:#999;font-size:13px;margin:0 0 10px">这是一条<b>样例</b>（假数据）。'
    + (isRender ? '这是 iPhone 客户点「预约设计师出图」后你会收到的样子——同号也一定会响：' : '以后有客户留资，你收到的就是这个样子：')
    + '</p>';
  const r = await notify.pushText(
    isRender ? '预约出图通知（样例，非真实客户）' : '客资通知已打通（样例，非真实客户）',
    note + notify.buildHtml(sample)
  );
  console.log('推送结果：', JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
})();
