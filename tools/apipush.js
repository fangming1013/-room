// 临时工具：在 github.com:443 被封时，用 GitHub REST API 推送提交
// 用法：node tools/_apipush.js <baseSha> <headSha>
// token 从 git credential 读取，绝不打印
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const API = 'https://api.github.com';
const REPO = 'fangming1013/-room';
const ROOT = path.join(__dirname, '..');

function token() {
  // 用 spawnSync 直接把凭据查询喂给 git，避免 shell 差异
  const r = spawnSync('git', ['credential', 'fill'], {
    cwd: ROOT,
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8'
  });
  const out = (r.stdout || '') + '';
  const line = out.split(/\r?\n/).find(l => l.startsWith('password='));
  return line ? line.slice(9).trim() : '';
}

const TOK = token();
if (!TOK) { console.error('拿不到 token'); process.exit(1); }

async function api(method, p, body) {
  const r = await fetch(API + p, {
    method,
    headers: {
      Authorization: 'Bearer ' + TOK,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'room-mini-deploy'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const txt = await r.text();
  let j = null;
  try { j = JSON.parse(txt); } catch (e) {}
  if (!r.ok) throw new Error(method + ' ' + p + ' -> ' + r.status + ' ' + txt.slice(0, 300));
  return j;
}

function git(args) {
  return execSync('git ' + args, { cwd: ROOT, encoding: 'utf8' });
}

(async () => {
  const base = process.argv[2];
  const head = process.argv[3];
  if (!base || !head) { console.error('需要 base 和 head 两个提交号'); process.exit(1); }

  const msg = git('log -1 --pretty=%s ' + head).trim();
  const localBase = git('rev-parse ' + base).trim();

  // 父提交一律以远程 main 为准（本地 sha 与远程可能因推送方式不同而不一致）
  const ref = await api('GET', '/repos/' + REPO + '/git/ref/heads/main');
  const parentSha = ref.object.sha;
  const baseCommit = await api('GET', '/repos/' + REPO + '/git/commits/' + parentSha);
  const baseTree = baseCommit.tree.sha;
  console.log('远程 main = ' + parentSha.slice(0, 7) + '，本地增量基准 = ' + localBase.slice(0, 7));

  // 1) 找出差异文件（本地基准 -> 待推送提交）
  const diff = git('diff --name-status ' + localBase + ' ' + head).trim().split(/\r?\n/).filter(Boolean);
  if (!diff.length) { console.log('没有需要推送的改动'); return; }
  console.log('待推送文件 ' + diff.length + ' 个');

  // 3) 逐个上传 blob
  const tree = [];
  for (const row of diff) {
    const parts = row.split('\t');
    const st = parts[0];
    const file = parts[1];
    if (st === 'D') {
      tree.push({ path: file, mode: '100644', type: 'blob', sha: null });
      console.log('  删除 ' + file);
      continue;
    }
    const abs = path.join(ROOT, file);
    const buf = fs.readFileSync(abs);
    const mode = (git('ls-tree ' + head + ' -- ' + JSON.stringify(file)).trim().split(/\s+/)[0]) || '100644';
    const blob = await api('POST', '/repos/' + REPO + '/git/blobs', {
      content: buf.toString('base64'),
      encoding: 'base64'
    });
    tree.push({ path: file, mode, type: 'blob', sha: blob.sha });
    console.log('  ' + (st === 'A' ? '新增' : '修改') + ' ' + file + ' (' + buf.length + 'B)');
  }

  // 4) 建 tree
  const newTree = await api('POST', '/repos/' + REPO + '/git/trees', { base_tree: baseTree, tree });

  // 5) 建 commit
  const newCommit = await api('POST', '/repos/' + REPO + '/git/commits', {
    message: msg,
    tree: newTree.sha,
    parents: [parentSha]
  });
  console.log('新提交 = ' + newCommit.sha);

  // 6) 更新 main
  await api('PATCH', '/repos/' + REPO + '/git/refs/heads/main', { sha: newCommit.sha, force: true });
  console.log('已更新远程 main -> ' + newCommit.sha.slice(0, 7));

  // 7) 打标签（版本号取 version.js，保证与代码一致）
  const VER = require('../version.js');
  const tagName = 'refs/tags/v' + VER.version;
  try {
    await api('POST', '/repos/' + REPO + '/git/refs', { ref: tagName, sha: newCommit.sha });
    console.log('已打标签 v' + VER.version);
  } catch (e) {
    console.log('标签跳过：' + e.message.slice(0, 100));
  }
})().catch(e => { console.error('失败：' + e.message); process.exit(1); });
