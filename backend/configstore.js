/*
 * 规则数据云端快照
 * -------------------------------------------------------------
 * 解决的真问题：
 *   老板手填的项目/价格/工程量只存在手机本地（config_override_v2）。
 *   一旦清缓存、换手机、重装微信，这些数据就全没了 —— 代码能回滚，钱回不来。
 *   所以后台每保存一次，就同步一份到 Redis，最多留 20 份。
 *
 * 存法（单 openid 单写者，不需要分布式锁）：
 *   cfgsnap:<openid>:<ts>   整份规则 JSON
 *   cfgsnap:idx:<openid>    索引数组 [{ts,label,at,items}]，新的在前
 * -------------------------------------------------------------
 */
'use strict';

const store = require('./store.js');

const MAX = 20;

function kSnap(openid, ts) { return 'cfgsnap:' + openid + ':' + ts; }
function kIdx(openid) { return 'cfgsnap:idx:' + openid; }

async function readIdx(openid) {
  const s = await store.get(kIdx(openid));
  if (!s) return [];
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a : [];
  } catch (e) {
    return [];
  }
}

// 存一份快照，自动裁到最近 MAX 份
async function save(openid, data, label) {
  if (!openid) throw new Error('缺少 openid');
  if (!data || typeof data !== 'object') throw new Error('数据格式不对');
  const ts = Date.now();
  await store.set(kSnap(openid, ts), JSON.stringify(data));

  const idx = await readIdx(openid);
  idx.unshift({
    ts: ts,
    label: String(label || ''),
    at: new Date(ts).toISOString(),
    items: (data.spaces && Object.keys(data.spaces).length) || 0
  });
  const keep = idx.slice(0, MAX);
  const drop = idx.slice(MAX);
  for (const d of drop) {
    try { await store.del(kSnap(openid, d.ts)); } catch (e) { /* ignore */ }
  }
  await store.set(kIdx(openid), JSON.stringify(keep));
  return { ts: ts, kept: keep.length, dropped: drop.length };
}

async function listSnaps(openid) {
  if (!openid) return [];
  return await readIdx(openid);
}

async function getSnap(openid, ts) {
  if (!openid || !ts) return null;
  const s = await store.get(kSnap(openid, ts));
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

module.exports = { save, listSnaps, getSnap, MAX };
