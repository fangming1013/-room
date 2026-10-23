// 版本回滚
// ---------------------------------------------------------------------
// 用法：
//   node tools/restore.js                  # 列出本机所有快照
//   node tools/restore.js v1.0.0           # 解压到 restore/ 下（安全模式，不动当前代码）
//   node tools/restore.js v1.0.0 --apply --yes   # 直接覆盖当前代码（危险，需双确认）
//
// 设计原则：默认绝不覆盖当前代码。先解到旁边目录对比，确认没问题再手动替换。
// 覆盖时保护：certs（支付私钥）、backend/data（订单）、backups 一律不动。
// ---------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'backups');
const PROTECT = ['certs', 'backups', path.join('backend', 'data')];

const args = process.argv.slice(2);
const ver = (args[0] || '').replace(/^v/, '');
const apply = args.includes('--apply');
const yes = args.includes('--yes');

function sevenZip() {
  for (const c of ['C:/Program Files/7-Zip/7z.exe', 'C:/Program Files (x86)/7-Zip/7z.exe']) {
    if (fs.existsSync(c)) return c;
  }
  return '7z';
}

function list() {
  if (!fs.existsSync(OUT)) return [];
  return fs.readdirSync(OUT)
    .filter((f) => /\.meta\.json$/.test(f))
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch (e) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (a.builtAt < b.builtAt ? 1 : -1));
}

if (!ver) {
  const all = list();
  if (!all.length) {
    console.log('还没有任何快照。先跑：node tools/snapshot.js');
    process.exit(0);
  }
  console.log('本机快照（新 → 旧）：\n');
  all.forEach((m) => {
    console.log('  v' + m.version + '  ' + (m.builtLocal || m.builtAt.slice(0, 16).replace('T', ' ')) +
      '  ' + (m.zipBytes / 1024 / 1024).toFixed(2) + 'MB  ' + (m.gitCommit || '-') +
      (m.gitDirty ? ' (含未提交改动)' : ''));
    if (m.note) console.log('      ' + m.note);
  });
  console.log('\n回滚：node tools/restore.js v<版本号>');
  process.exit(0);
}

const all = list().filter((m) => m.version === ver);
if (!all.length) {
  console.log('找不到 v' + ver + ' 的快照。跑 node tools/restore.js 看有哪些。');
  process.exit(1);
}
const meta = all[0];
const zip = path.join(OUT, meta.zip);
if (!fs.existsSync(zip)) {
  console.log('快照文件缺失：' + zip);
  process.exit(1);
}

const z = sevenZip();

if (!apply) {
  const dest = path.join(ROOT, 'restore', 'v' + meta.version + '_' + meta.builtAt.replace(/[:.]/g, '-').slice(0, 16));
  fs.mkdirSync(dest, { recursive: true });
  execFileSync(z, ['x', zip, '-o' + dest, '-y'], { stdio: 'pipe' });
  console.log('');
  console.log('已解压（没有动当前代码）：');
  console.log('  ' + dest);
  console.log('');
  console.log('对比确认后，二选一：');
  console.log('  A. 手动把需要的文件拷回项目（推荐，风险最小）');
  console.log('  B. 覆盖式回滚：node tools/restore.js v' + meta.version + ' --apply --yes');
  process.exit(0);
}

if (!yes) {
  console.log('');
  console.log('⚠️  覆盖式回滚会用 v' + meta.version + ' 覆盖当前代码。');
  console.log('    certs / backups / backend/data 不会被覆盖。');
  console.log('    确认请再跑一次并加 --yes：');
  console.log('    node tools/restore.js v' + meta.version + ' --apply --yes');
  process.exit(1);
}

// 先自动把"当前状态"打成快照，防止回滚本身造成丢失
console.log('覆盖前先给当前状态留一份底…');
try {
  execFileSync(process.execPath, [path.join(__dirname, 'snapshot.js'), '--note', '回滚前自动留底'], { stdio: 'inherit' });
} catch (e) {
  console.log('（留底失败，继续回滚）');
}

console.log('正在覆盖…');
PROTECT.forEach((p) => console.log('  保护不动：' + p));
execFileSync(z, ['x', zip, '-o' + ROOT, '-y'], { stdio: 'pipe' });

console.log('');
console.log('✅ 已回滚到 v' + meta.version + '（' + meta.builtAt.slice(0, 16) + '）');
console.log('下一步：微信开发者工具点「编译」验证；确认无误后提交一次 git。');
