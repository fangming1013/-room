// 客资上报通道
// 设计原则：本地永远先存一份（不丢），上报是"尽量送达"——失败入队，下次启动重试。
// 地址来源优先级：后台配置(storage: lead_api_cfg.base) > 下面的 LEAD_API 常量。
// 未配置 = 只存本地，不报错（开发/未部署阶段的正常状态）。
const LEAD_API = 'https://room-rchx.onrender.com';   // 自建后端 /api/lead（落 Redis，老板后台可见）

const QKEY = 'lead_upload_queue_v1';

function base() {
  try {
    const c = wx.getStorageSync('lead_api_cfg') || {};
    return String(c.base || LEAD_API || '').replace(/\/+$/, '');
  } catch (e) { return LEAD_API; }
}
function enabled() { return !!base(); }

// 字段同时兼容自建后端与第三方客资台（各自取自己要的，多余字段忽略）
function toPayload(lead) {
  let openid = '';
  try { openid = require('./wxauth.js').get() || ''; } catch (e) {}
  return {
    // 自建后端 /api/lead
    name: lead.name || '',
    phone: lead.phone || '',
    city: lead.city || '',
    decoType: lead.decoType || '',
    decoTypeName: lead.decoTypeName || '',
    area: Number(lead.area) || 0,
    budget: Number(lead.budget) || 0,
    spaceCount: Number(lead.spaceCount) || 0,
    spaces: lead.spaces || [],
    createdAt: lead.createdAt || Date.now(),
    openid: openid,
    // 第三方客资台字段（忽略也无妨）
    district: lead.city || '',
    community: '',
    type: (lead.spaceCount || 0) + '个空间',
    timeline: '',
    source: '小程序算价',
    quote_amount: Number(lead.budget) || 0,
    consent: true,
    client_extra: {
      spaces: lead.spaces || [],
      status: lead.status || 'new',
      createdAt: lead.createdAt || Date.now()
    }
  };
}

function post(lead) {
  return new Promise((resolve, reject) => {
    const b = base();
    if (!b) { reject(new Error('未配置客资台地址')); return; }
    wx.request({
      url: b + '/api/lead',
      method: 'POST',
      timeout: 15000,
      header: { 'Content-Type': 'application/json' },
      data: toPayload(lead),
      success: r => {
        const d = r.data || {};
        if (d.ok) resolve(d);
        else reject(new Error(d.msg || d.error || ('上报失败(' + (r.statusCode || '') + ')')));
      },
      fail: e => reject(new Error(e.errMsg || '网络异常'))
    });
  });
}

function getQueue() {
  try { return wx.getStorageSync(QKEY) || []; } catch (e) { return []; }
}
function setQueue(list) {
  try { wx.setStorageSync(QKEY, list.slice(0, 50)); } catch (e) {}
}

// 上报；失败入队（同手机号只留一条）
function push(lead) {
  return post(lead).catch(err => {
    const q = getQueue().filter(x => x.phone !== lead.phone);
    q.push(lead);
    setQueue(q);
    throw err;
  });
}

// 补传队列（app 启动时调用）
function flush() {
  const q = getQueue();
  if (!q.length || !enabled()) return;
  const item = q[0];
  post(item).then(() => {
    setQueue(getQueue().filter(x => x.phone !== item.phone));
    if (getQueue().length) setTimeout(flush, 1200);
  }).catch(() => {});
}

module.exports = { enabled, push, flush, base };
