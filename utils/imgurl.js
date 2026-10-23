// 效果图地址转换
// ---------------------------------------------------------------------
// 豆包（火山方舟）返回的是带签名的临时地址，形如
//   https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/xxx.jpg
// 子域名是随机的，小程序 downloadFile 白名单只认精确域名、不支持通配符，
// 所以客户端下载一律走自己后端的 /api/img 转一层（后端只放行 volces.com）。
// ---------------------------------------------------------------------

const auth = require('./wxauth.js');

function proxied(u) {
  if (!/^https?:\/\//i.test(u || '')) return u;      // 本地路径原样返回
  if (u.indexOf(auth.API) === 0) return u;           // 已经是自己的地址
  let host = '';
  try { host = u.split('/')[2] || ''; } catch (e) { return u; }
  if (!/\.volces\.com$/i.test(host)) return u;       // 只代理豆包图床
  return auth.API + '/api/img?u=' + encodeURIComponent(u);
}

module.exports = { proxied };
