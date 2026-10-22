// 语音识别：优先用微信同声传译插件（需真实 AppID 并添加插件）
// 测试号/未添加插件时降级：start() 回调 onUnsupported，由页面弹预设演示
let manager = null;
let available = false;
try {
  const plugin = requirePlugin('WechatSI');
  manager = plugin.getRecordRecognitionManager();
  available = true;
} catch (e) {
  available = false;
}

function start(cbs) {
  if (!available || !manager) {
    cbs.onUnsupported && cbs.onUnsupported();
    return;
  }
  manager.onStart = () => cbs.onStart && cbs.onStart();
  manager.onRecognize = (res) => cbs.onInterim && cbs.onInterim(res.result);
  manager.onStop = (res) => cbs.onFinal && cbs.onFinal(res.result || '');
  manager.onError = (err) => cbs.onError && cbs.onError(err);
  manager.start({ duration: 60000, lang: 'zh_CN' });
}

function stop() {
  if (manager) manager.stop();
}

module.exports = { start, stop, isAvailable: () => available };
