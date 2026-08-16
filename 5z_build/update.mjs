// ============================================================
// 5z 规则 一键更新流水线：CHM → 反编译 → 构建 → 检查 → 同步 → commit → push
// 用法（在仓库根目录运行）：
//   node 5z_build/update.mjs                 # 自动找 incoming/ 或根目录下最新的 .chm
//   node 5z_build/update.mjs "D:\x\新CHM.chm" # 指定 CHM 路径
// 选项：
//   --no-extract  跳过反编译，用现有 5z_src 重新构建（重跑/演练）
//   --no-push     提交但不推送
//   --dry-run     构建+检查+同步，不提交不推送（演练）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd(); // 必须在仓库根目录运行
const B = path.join(ROOT, '5z_build');
const SRC = path.join(ROOT, '5z_src');
const INCOMING = path.join(ROOT, 'incoming');
const ARCHIVE = path.join(B, 'archive');

const args = process.argv.slice(2);
const opts = {
  chm: args.find(a => !a.startsWith('--')) || null,
  noExtract: args.includes('--no-extract'),
  noPush: args.includes('--no-push'),
  dryRun: args.includes('--dry-run'),
};

// ---------- 工具 ----------
function fail(msg) { console.error('\n[更新中止] ' + msg); process.exit(1); }

function run(cmd, arr, { cwd = ROOT } = {}) {
  console.log(`> ${cmd} ${arr.join(' ')}`);
  const r = spawnSync(cmd, arr, { cwd, encoding: 'utf8', timeout: 10 * 60 * 1000 });
  if (r.stdout) console.log(r.stdout.trimEnd());
  if (r.stderr) process.stdout.write(r.stderr);
  if (r.error) throw new Error(`${cmd} 启动失败: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} 退出码 ${r.status}`);
  return r;
}

function findChm() {
  if (opts.chm) {
    const p = path.resolve(opts.chm);
    if (!fs.existsSync(p)) fail(`CHM 文件不存在: ${p}`);
    return p;
  }
  for (const dir of [INCOMING, ROOT]) {
    if (!fs.existsSync(dir)) continue;
    const list = fs.readdirSync(dir)
      .filter(f => /\.chm$/i.test(f))
      .map(f => path.join(dir, f));
    if (list.length) {
      return list.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    }
  }
  return null;
}

function siteVersion() {
  const hhc = fs.readdirSync(SRC).find(f => /\.hhc$/i.test(f));
  return hhc ? (/(\d+(?:\.\d+)+)/.exec(hhc)?.[1] || '未知版本') : '未知版本';
}

// ---------- 主流程 ----------
console.log('========== 5z 规则 自动更新 ==========');

const chm = findChm();
if (!opts.noExtract && !chm) {
  fail('未找到 CHM 文件。请把新 CHM 放进 incoming/ 文件夹，或直接把 CHM 拖到 一键更新.bat 上。');
}
if (chm) console.log(`源 CHM: ${chm}`);

// 1/6 反编译
if (opts.noExtract) {
  console.log('\n[1/6] 跳过反编译（--no-extract，使用现有 5z_src）');
  if (!fs.existsSync(SRC) || !fs.readdirSync(SRC).some(f => /\.hhc$/i.test(f))) {
    fail('5z_src 里没有可用的 .hhc，无法跳过反编译');
  }
} else {
  console.log('\n[1/6] 反编译 CHM');
  const hh = path.join(process.env.WINDIR || 'C:\\Windows', 'hh.exe');
  if (!fs.existsSync(hh)) fail(`未找到 hh.exe（Windows 系统自带）: ${hh}`);
  fs.rmSync(SRC, { recursive: true, force: true });
  fs.mkdirSync(SRC, { recursive: true });
  const r = spawnSync(hh, ['-decompile', SRC, chm], { encoding: 'utf8', timeout: 5 * 60 * 1000 });
  if (r.status !== 0) {
    fail(`hh.exe 反编译失败(exit ${r.status})。若 CHM 提示不受信任，请右键 CHM → 属性 → 勾选“解除锁定”后重试。`);
  }
  const htm = fs.readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile() && /\.htm$/i.test(e.name)).length;
  const hhc = fs.readdirSync(SRC).find(f => /\.hhc$/i.test(f));
  if (!hhc) fail('反编译后未找到 .hhc 目录文件，解压不完整');
  console.log(`   ✓ 解出目录文件 ${hhc}，htm 页面 ${htm} 个`);
}

const VERSION = siteVersion();
console.log(`   规则版本: ${VERSION}`);

// 2/6 构建
console.log('\n[2/6] 构建网站');
try { run('node', [path.join(B, 'build.mjs')]); }
catch (e) { fail(`构建失败：${e.message}`); }

// 3/6 双重检查（失败即门禁中止）
console.log('\n[3/6] 链接完整性检查');
try { run('node', [path.join(B, 'check-links.mjs')]); }
catch (e) { fail(`链接检查未通过：${e.message}`); }
console.log('\n[3/6] 页面完整性核对');
try { run('node', [path.join(B, 'verify-complete.mjs')]); }
catch (e) { fail(`完整性核对未通过：${e.message}`); }

// 4/6 同步到发布源（仓库根目录）
console.log('\n[4/6] 同步到站点根目录');
try { run('node', [path.join(B, 'sync-web.mjs')]); }
catch (e) { fail(`同步失败：${e.message}`); }

// 5/6 git 提交
const status = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
console.log('\n[5/6] git 提交');
if (!status) {
  console.log('   （工作区无变化，跳过提交）');
} else if (opts.dryRun) {
  console.log(`   [dry-run] 跳过提交。当前变更 ${status.split('\n').length} 项:`);
  console.log('   ' + status.split('\n').slice(0, 20).join('\n   '));
} else {
  run('git', ['add', '-A']);
  run('git', ['commit', '-m', `5z 规则 ${VERSION} 版 自动更新`]);
}

// 6/6 git 推送
console.log('\n[6/6] git 推送');
if (opts.dryRun) {
  console.log('   [dry-run] 跳过推送');
} else if (opts.noPush) {
  console.log('   [--no-push] 跳过推送，可手动执行: git push');
} else if (!status) {
  console.log('   （无变更，无需推送）');
} else {
  try { run('git', ['push']); console.log('   ✓ 已推送到 GitHub，GitHub Pages 即将自动更新上线'); }
  catch (e) { fail(`推送失败（构建已成功）：${e.message}\n请手动执行 git push`); }
}

// 收尾：归档已处理的 CHM（避免下次重复处理）
if (chm && !opts.noExtract && !opts.dryRun) {
  fs.mkdirSync(ARCHIVE, { recursive: true });
  try {
    fs.copyFileSync(chm, path.join(ARCHIVE, path.basename(chm)));
    fs.unlinkSync(chm);
    console.log(`\nCHM 已归档: 5z_build/archive/${path.basename(chm)}`);
  } catch (e) {
    console.log(`\nCHM 归档失败（可手动移动）: ${e.message}`);
  }
}

console.log('\n========== 更新完成 ✓ ==========');
