// 效果图额度与付费套餐（2026-10-21 最终版，额度以服务端为准）
// ---------------------------------------------------------------------
// 规则：
//   ① 免费额度 0 张 —— 老板定：不让消费者白嫖，没额度就不出图，不烧钱
//   ② 套餐：6.99 元 / 5 张、9.9 元 / 10 张（微信支付真实扣款）
//   ③ 额度存在**服务端**（按 openid），换手机/清缓存都不会丢；
//      本机 storage 只做 UI 缓存，让页面秒开，后台会自动校准
//   ④ 生成失败必须返还额度（refund）
//   ⑤ 未登录（拿不到 openid）时退回纯本地模式，保证断网也能走通流程
// ---------------------------------------------------------------------

const auth = require('./wxauth.js');

const QKEY = 'render_quota_v1';      // { date, used, balance, total }
const FREE_DAILY = 0;                // 免费额度：0 = 一张都不白给

// 套餐：price 单位「分」，与微信支付一致
const PACKS = [
  { id: 'p5',  count: 5,  price: 699, title: '6.99 元 / 5 张',  per: '¥1.39/张', tag: '' },
  { id: 'p10', count: 10, price: 990, title: '9.9 元 / 10 张',  per: '¥0.99/张', tag: '更划算' }
];

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function today() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function read() {
  let q = null;
  try { q = wx.getStorageSync(QKEY); } catch (e) { /* ignore */ }
  if (!q || typeof q !== 'object') q = {};
  const bal = Number(q.balance) || 0;
  if (!q.date || q.date !== today()) {
    return { date: today(), used: 0, balance: bal, total: Number(q.total) || 0 };
  }
  return {
    date: q.date,
    used: Number(q.used) || 0,
    balance: bal,
    total: Number(q.total) || 0
  };
}

function save(q) { try { wx.setStorageSync(QKEY, q); } catch (e) { /* ignore */ } }

function setBalance(n) {
  const q = read();
  q.balance = Math.max(0, Number(n) || 0);
  save(q);
}

function getBalance() { return read().balance; }

// UI 状态：同步返回，读本地缓存（页面 onShow 里先渲染，再做 sync 校准）
function status() {
  const q = read();
  return {
    freeLimit: FREE_DAILY,
    freeLeft: 0,
    balance: q.balance,
    totalLeft: q.balance,
    date: q.date,
    online: !!auth.get()
  };
}

function req(path, method, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: auth.API + path,
      method: method || 'GET',
      data: data,
      timeout: 15000,
      header: { 'Content-Type': 'application/json' },
      success(r) {
        const d = r.data || {};
        if (d.ok) resolve(d);
        else reject(new Error(d.error || ('HTTP ' + (r.statusCode || ''))));
      },
      fail(e) { reject(new Error((e && e.errMsg) || '网络异常')); }
    });
  });
}

// ===== 服务端同步 =====
// 登录并拉取真实余额（页面 onShow 调一次）
function sync() {
  return auth.ensure().then(id => {
    if (!id) return status();
    return req('/api/quota?openid=' + encodeURIComponent(id))
      .then(d => { setBalance(d.balance); return status(); })
      .catch(() => status());
  }).catch(() => status());
}

// 扣 1 张：优先服务端；拿不到 openid 才退回本地
// 返回 Promise<{ ok, balance, net? }>  net=true 表示网络问题（不是没额度）
function consume() {
  const run = (id) => {
    if (!id) {
      const q = read();
      if (q.balance > 0) {
        q.balance -= 1;
        q.total = (q.total || 0) + 1;
        save(q);
        return Promise.resolve({ ok: true, from: 'local', balance: q.balance });
      }
      return Promise.resolve({ ok: false, balance: 0, error: '额度不足' });
    }
    return req('/api/quota/consume', 'POST', { openid: id, n: 1 })
      .then(d => { setBalance(d.balance); return { ok: true, from: 'server', balance: d.balance, ticket: d.ticket || '' }; })
      .catch(e => {
        const msg = String((e && e.message) || '');
        // 服务端明确说额度不足 → 才算真没额度；超时/断网不算
        const net = !/额度不足|insufficient/i.test(msg);
        return { ok: false, net: net, balance: getBalance(), error: msg };
      });
  };
  const id = auth.get();
  if (id) return run(id);
  // 冷启动时登录可能还没回来：等一次登录再扣，避免误判为没额度
  return auth.ensure().then(i => run(i || '')).catch(() => run(''));
}

// 生成失败返还（不接受"扣了没出图"）
// 服务端要求带 consume 发的一次性凭证 ticket，防止被人当"加额度"接口刷
function refund(ticket) {
  if (!ticket || !ticket.ok) return Promise.resolve(status());
  const tk = typeof ticket === 'string' ? ticket : (ticket.ticket || '');
  const id = auth.get();
  if (!id || !tk) {
    const q = read();
    q.balance += 1;
    if (q.total > 0) q.total -= 1;
    save(q);
    return Promise.resolve(status());
  }
  return req('/api/quota/refund', 'POST', { openid: id, ticket: tk, n: 1 })
    .then(d => { setBalance(d.balance); return status(); })
    .catch(() => status());
}

// 加额度（仅后台用，必须带服务端密钥；普通调用走不通）
function addBalance(n, key) {
  const add = Math.max(0, Number(n) || 0);
  const id = auth.get();
  if (!id || !key) return Promise.resolve(status());
  return req('/api/admin/quota', 'POST', { openid: id, n: add, key: key })
    .then(d => { setBalance(d.balance); return status(); })
    .catch(() => status());
}

// 清零（后台验收用，模拟消费者没额度）
function clearBalance(key) {
  const id = auth.get();
  if (!id || !key) { setBalance(0); return Promise.resolve(status()); }
  return req('/api/admin/quota', 'POST', { openid: id, mode: 'clear', key: key })
    .then(d => { setBalance(d.balance); return status(); })
    .catch(() => { setBalance(0); return status(); });
}

// 记录付费意向（仅支付未开通时使用）
const IKEY = 'pay_intent_v1';
function recordIntent(pack, extra) {
  let list = [];
  try { list = wx.getStorageSync(IKEY) || []; } catch (e) { /* ignore */ }
  if (!Array.isArray(list)) list = [];
  list.unshift(Object.assign({
    ts: Date.now(),
    packId: (pack && pack.id) || '',
    count: (pack && pack.count) || 0,
    price: (pack && pack.price) || 0
  }, extra || {}));
  if (list.length > 100) list.length = 100;
  try { wx.setStorageSync(IKEY, list); } catch (e) { /* ignore */ }
  return list;
}

function getIntents() {
  try { const l = wx.getStorageSync(IKEY) || []; return Array.isArray(l) ? l : []; } catch (e) { return []; }
}

module.exports = {
  FREE_DAILY, PACKS,
  status, sync, consume, refund, addBalance, clearBalance, getBalance,
  recordIntent, getIntents
};
