// 客资到达 → 微信推送（PushPlus）
// ---------------------------------------------------------------------
// 为什么需要：客户在注册页留下手机号，原来是"只有老板自己进后台点同步才看得到"。
// 装修线索的时效是以小时算的，晚 4 小时打电话，客户已经在跟别人谈了。
// 所以必须"留资即推送"，做到手机响一下就知道有单。
//
// 设计要点：
//   1. 只推首次（store.setnx 去重）——补传队列/重试不会重复轰炸。
//   2. 不阻塞入库：推失败也只写日志，绝不让客户看到报错。
//   3. 手机号直接渲染成 tel: 链接，微信里点一下就能拨，省掉复制粘贴。
//   4. PUSHPLUS_TOKEN 走环境变量，没配就自动跳过（本地开发不吵人）。
// ---------------------------------------------------------------------
const https = require('https');

const DEFAULT_TOKEN = '0c91d6dff98843dcbbe5d961aa05c625'; // 老板个人 PushPlus
const TOKEN = process.env.PUSHPLUS_TOKEN || DEFAULT_TOKEN;
const ENABLED = String(process.env.LEAD_PUSH || 'on').toLowerCase() !== 'off';

function postJSON(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: timeoutMs || 8000
    }, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf || '{}')); }
        catch (e) { resolve({ code: -1, msg: buf.slice(0, 200) }); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('pushplus 超时')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function money(n) {
  const v = Number(n) || 0;
  if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  return String(Math.round(v));
}

function dash(s) { return s ? String(s) : '—'; }

function buildHtml(rec) {
  const phone = String(rec.phone || '');
  const tel = phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  const spaces = (rec.spaces && rec.spaces.length)
    ? (typeof rec.spaces[0] === 'string' ? rec.spaces.join('、') : rec.spaces.map(s => s.name || '').filter(Boolean).join('、') || (rec.spaceCount + ' 个空间'))
    : (rec.spaceCount ? rec.spaceCount + ' 个空间' : '—');
  const want = !!rec.wantRender;

  return '<div style="font-size:15px;line-height:1.9;color:#222">'
    + '<p style="margin:0 0 8px"><b style="color:' + (want ? '#d4380d' : '#07c160') + '">' + (want ? '预约出图' : '新客资') + '</b>　'
    + dash(rec.city) + '　' + dash(rec.decoTypeName) + '　' + (rec.area ? rec.area + '㎡' : '—') + '</p>'
    + (want ? '<p style="margin:0 0 8px;padding:8px 10px;background:#fff7e6;border-left:3px solid #d4380d;color:#8a4b00">'
        + '客户想要「' + dash(rec.wantSpace) + '」的「' + dash(rec.wantStyle) + '」效果图，需人工出图后发给他</p>' : '')
    + '<p style="margin:0 0 8px;font-size:22px;color:#d4380d;font-weight:700">预算 ¥' + money(rec.budget) + '</p>'
    + '<p style="margin:0 0 4px;color:#555">涉及空间：' + spaces + '</p>'
    + '<p style="margin:0 0 14px;color:#555">称呼：' + dash(rec.name) + '</p>'
    + '<a href="tel:' + phone + '" style="display:inline-block;padding:11px 22px;background:#07c160;color:#fff;'
    + 'border-radius:6px;text-decoration:none;font-size:16px;font-weight:600">拨打 ' + tel + '</a>'
    + '<p style="margin:14px 0 0;color:#999;font-size:12px">客户号码已入库，后台「同步云端客资」可看全部</p>'
    + '</div>';
}

// 文本汇总（用于测试/日报）
async function pushText(title, html) {
  if (!ENABLED) return { ok: false, error: 'LEAD_PUSH=off' };
  try {
    const r = await postJSON('https://www.pushplus.plus/send', {
      token: TOKEN, title: title, content: html, template: 'html'
    });
    if (r.code === 200) return { ok: true };
    console.error('[notify] 推送失败', JSON.stringify(r).slice(0, 200));
    return { ok: false, error: r.msg || ('code ' + r.code) };
  } catch (e) {
    console.error('[notify] 推送异常', e && e.message);
    return { ok: false, error: String(e && e.message || e) };
  }
}

// 入口：saveLead 成功后调用（fire-and-forget）
// opts.force = 预约出图这类「客户主动发起的新动作」，同号也要再响一次（否则老板会漏）
async function notifyLead(rec, store, opts) {
  if (!ENABLED) return;
  const force = !!(opts && opts.force);
  try {
    if (!force) {
      // 同一号码只推一次：补传队列 / 客户重复提交都不再吵。
      // 但去重本身失败时一律照推——业务上「漏一条客资」远比「多响一次」严重。
      let first = true;
      try {
        first = await store.setnx('leadpushed:' + rec.phone, String(Date.now()));
      } catch (e) {
        console.log('[notify] 去重检查失败，改为直接推送：' + (e && e.message));
        first = true;
      }
      if (!first) return;
    } else {
      // 强制推送后刷新标记，避免紧随其后的普通提交再推一遍
      try { await store.set('leadpushed:' + rec.phone, String(Date.now())); } catch (e) {}
    }
    const title = (rec.wantRender ? '预约出图 · ' : '新客资 · ')
      + (rec.city || '未知城市') + ' · ' + (rec.area ? rec.area + '㎡' : '')
      + (rec.wantRender ? (' · ' + (rec.wantStyle || '')) : (' · ' + money(rec.budget) + '元'));
    const r = await pushText(title, buildHtml(rec));
    if (!r.ok) {
      // 推失败要放开去重标记，否则这条客资永远补不推
      try { await store.del('leadpushed:' + rec.phone); } catch (e) {}
    }
  } catch (e) {
    console.error('[notify] 客资推送异常', e && e.message);
  }
}

module.exports = { pushText, notifyLead, buildHtml, enabled: ENABLED };
