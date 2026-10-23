// 一键版本快照
// ---------------------------------------------------------------------
// 用法：
//   node tools/snapshot.js            # 打快照（zip + meta），不打 tag
//   node tools/snapshot.js --tag      # 打快照并打 git tag vX.Y.Z
//   node tools/snapshot.js --note "改了什么"
//
// 产物（backups/ 不入库）：
//   backups/room-mini_v1.0.0_20261023-1500.zip
//   backups/room-mini_v1.0.0_20261023-1500.meta.json
//
// 不含：.git / node_modules / backups / certs（支付私钥不落备份包）/ backend/data
// ---------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PKG = require(path.join(ROOT, 'version.js'));
const OUT = path.join(ROOT, 'backups');

const args = process.argv.slice(2);
const doTag = args.includes('--tag');
const noteIdx = args.indexOf('--note');
const note = noteIdx >= 0 ? (args[noteIdx + 1] || '') : '';

const EXCLUDES = ['.git', 'node_modules', 'backups', 'certs', path.join('backend', 'data')];

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function stamp(d) {
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
}

function sevenZip() {
  const candidates = [
    'C:/Program Files/7-Zip/7z.exe',
    'C:/Program Files (x86)/7-Zip/7z.exe'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return '7z';
}

function git(args2) {
  try {
    return execFileSync('git', args2, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (e) {
    return '';
  }
}

function walkCount(dir, base) {
  let files = 0, bytes = 0;
  for (const name of fs.readdirSync(dir)) {
    if (EXCLUDES.indexOf(name) >= 0) continue;
    const p = path.join(dir, name);
    let st;
    try { st = fs.statSync(p); } catch (e) { continue; }
    if (st.isDirectory()) {
      const r = walkCount(p, base);
      files += r.files; bytes += r.bytes;
    } else {
      files += 1; bytes += st.size;
    }
  }
  return { files, bytes };
}

(function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const name = 'room-mini_v' + PKG.version + '_' + stamp(new Date());
  const zip = path.join(OUT, name + '.zip');
  const metaPath = path.join(OUT, name + '.meta.json');

  const z = sevenZip();
  const cmdArgs = ['a', '-tzip', '-mx=5', zip, '.'];
  EXCLUDES.forEach((x) => cmdArgs.push('-xr!' + x.replace(/\\/g, '/')));

  console.log('正在打包…（' + z + '）');
  execFileSync(z, cmdArgs, { cwd: ROOT, stdio: 'pipe' });

  const stat = walkCount(ROOT, ROOT);
  const commit = git(['rev-parse', '--short', 'HEAD']);
  const dirty = git(['status', '--porcelain']).length > 0;

  const meta = {
    name: PKG.name,
    version: PKG.version,
    versionDate: PKG.date,
    builtAt: new Date().toISOString(),
    builtLocal: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'),
    note: note || PKG.note,
    gitCommit: commit,
    gitDirty: dirty,
    zip: path.basename(zip),
    zipBytes: fs.statSync(zip).size,
    sourceFiles: stat.files,
    sourceBytes: stat.bytes,
    excludes: EXCLUDES
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  let tagMsg = '';
  if (doTag) {
    const tag = 'v' + PKG.version;
    const exists = git(['tag', '-l', tag]);
    if (exists) {
      tagMsg = '⚠️ tag ' + tag + ' 已存在，未重复打（要改版本号请先改 version.js）';
    } else {
      git(['tag', '-a', tag, '-m', tag + ' ' + (note || PKG.note)]);
      tagMsg = '✅ 已打 git tag ' + tag;
    }
  }

  console.log('');
  console.log('版本     : v' + PKG.version + '（' + PKG.date + '）');
  console.log('快照     : backups/' + path.basename(zip));
  console.log('体积     : ' + (meta.zipBytes / 1024 / 1024).toFixed(2) + ' MB');
  console.log('源文件   : ' + stat.files + ' 个 / ' + (stat.bytes / 1024 / 1024).toFixed(2) + ' MB');
  console.log('提交     : ' + (commit || '(未提交)') + (dirty ? '  ⚠️ 有未提交改动' : ''));
  console.log('说明     : ' + meta.note);
  if (tagMsg) console.log(tagMsg);
  console.log('');
  console.log('回滚用   : node tools/restore.js v' + PKG.version);
})();
