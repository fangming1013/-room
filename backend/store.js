/*
 * 统一存储层
 * -------------------------------------------------------------
 * 优先用 Upstash Redis（REST API，零依赖）；
 * 没配 UPSTASH_* 环境变量时回落到本地文件（只用于本机开发）。
 *
 * 为什么必须上 Redis：
 *   Render 免费实例没有持久磁盘，每次重新部署 / 容器重建都会清空 /app 下的文件。
 *   2026-10-23 就因为这个把客户已付的 5 张额度冲掉了。
 * -------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'store.json');

function restUrl() { return process.env.UPSTASH_REDIS_REST_URL || ''; }
function restToken() { return process.env.UPSTASH_REDIS_REST_TOKEN || ''; }
function remote() { return !!(restUrl() && restToken()); }

// ---------- 本地文件（开发用）----------
function readFile() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
  } catch (e) {
    return {};
  }
}

function writeFile(obj) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.error('[store] 文件写入失败：', e && e.message);
  }
}

// ---------- Redis REST ----------
async function cmd(args) {
  const r = await fetch(restUrl(), {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + restToken(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });
  if (!r.ok) throw new Error('Upstash HTTP ' + r.status);
  const j = await r.json().catch(() => ({}));
  if (j.error) throw new Error('Upstash: ' + j.error);
  return j.result;
}

// ---------- 统一接口 ----------
async function get(key) {
  if (remote()) return await cmd(['GET', key]);
  const st = readFile();
  return st[key] == null ? null : st[key];
}

async function set(key, val) {
  if (remote()) return await cmd(['SET', key, String(val)]);
  const st = readFile();
  st[key] = String(val);
  writeFile(st);
  return 'OK';
}

// 仅当 key 不存在时写入，返回 true 表示这一次写入成功（用于"只领一次"）
async function setnx(key, val) {
  if (remote()) {
    const r = await cmd(['SET', key, String(val), 'NX']);
    return r === 'OK';
  }
  const st = readFile();
  if (st[key] != null) return false;
  st[key] = String(val);
  writeFile(st);
  return true;
}

async function del(key) {
  if (remote()) return await cmd(['DEL', key]);
  const st = readFile();
  delete st[key];
  writeFile(st);
  return 1;
}

async function incr(key) {
  if (remote()) return await cmd(['INCR', key]);
  const st = readFile();
  const n = (Number(st[key]) || 0) + 1;
  st[key] = String(n);
  writeFile(st);
  return n;
}

async function getNum(key) {
  const v = await get(key);
  return Number(v) || 0;
}

// 原子加减（n 可为负数）。返回操作后的值
async function incrBy(key, n) {
  const delta = Math.round(Number(n) || 0);
  if (remote()) return await cmd(['INCRBY', key, delta]);
  const st = readFile();
  const v = (Number(st[key]) || 0) + delta;
  st[key] = String(v);
  writeFile(st);
  return v;
}

// 列表：往左推一条
async function push(key, val) {
  if (remote()) return await cmd(['LPUSH', key, String(val)]);
  const st = readFile();
  const arr = Array.isArray(st[key]) ? st[key] : [];
  arr.unshift(String(val));
  st[key] = arr.slice(0, 500);
  writeFile(st);
  return arr.length;
}

// 取列表前 n 条
async function list(key, n) {
  if (remote()) {
    const r = await cmd(['LRANGE', key, 0, (n || 50) - 1]);
    return Array.isArray(r) ? r : [];
  }
  const st = readFile();
  const arr = Array.isArray(st[key]) ? st[key] : [];
  return arr.slice(0, n || 50);
}

function status() {
  return { backend: remote() ? 'upstash' : 'file', remote: remote() };
}

module.exports = { get, set, setnx, del, incr, incrBy, getNum, push, list, status };
