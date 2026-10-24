// 客资推送链路自测：发一条样例到老板微信，确认 PushPlus 通路与排版
// 用法：node tools/test-notify.js
const notify = require('../backend/notify.js');

const sample = {
  phone: '13800138000', city: '深圳', decoTypeName: '局改', area: 68,
  budget: 12300, spaces: ['厨房', '卫生间'], name: '王先生'
};

(async () => {
  const html = '<p style="color:#999;font-size:13px;margin:0 0 10px">这是一条<b>样例</b>（假数据）。以后有客户留资，你收到的就是这个样子：</p>'
    + notify.buildHtml(sample);
  const r = await notify.pushText('客资通知已打通（样例，非真实客户）', html);
  console.log('推送结果：', JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
})();
