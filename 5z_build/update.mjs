// ============================================================
// 5z 规则 一键更新流水线：CHM → 反编译 → 构建 → 检查 → 同步 → commit → push
// 用法（在仓库根目录运行）：
//   node 5z_build/update.mjs                 # 自动找 incoming/ 或根目录下最新的 .chm
//   node 5z_build/update.mjs "D:\x\新CHM.chm" # 指定 CHM 路径
// 选项：
//   --no-extract  跳过反编译，用现有 5z_src 重新构建（重跑/演练）
//   --no-push     提交但不推送
//   --dry-run     构建+检查+同步，不提交不推送（演练）
//   --skip-deploy 跳过部署器与 Cloudflare 边缘缓存清理
//   --site <域名> 指定「等上线 + purge」用的站点域名（默认 deploy.config.json 的 cloudflare.domain）
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
const msgIdx = args.findIndex(a => a === '--message');
const msgValue = msgIdx >= 0 && args[msgIdx + 1] ? args[msgIdx + 1] : ((args.find(a => a.startsWith('--message=')) || '').slice(10) || null);
const siteIdx = args.findIndex(a => a === '--site');
const siteValue = siteIdx >= 0 && args[siteIdx + 1] ? args[siteIdx + 1] : ((args.find(a => a.startsWith('--site=')) || '').slice(7) || null);
const opts = {
  chm: args.find(a => !a.startsWith('--') && a !== msgValue && a !== siteValue) || null,
  noExtract: args.includes('--no-extract'),
  noPush: args.includes('--no-push'),
  dryRun: args.includes('--dry-run'),
  skipDeploy: args.includes('--skip-deploy'),
  message: msgValue,
  site: siteValue,
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

// ---------- 可选部署器：向多个托管平台发布（未来新平台在此添加） ----------
// 部署配置从 5z_build/deploy.config.json 读取（不入库，见 deploy.config.example.json），
// 敏感凭据一律走环境变量。每个部署器 { name, needs(), check(), run() }：
//   needs() 返回是否配置了该平台（未配置则跳过）
//   check() 返回缺失项说明（配置了但缺凭据时中止）
//   run()   执行部署，失败抛错中止
const DEPLOY_CONFIG = path.join(B, 'deploy.config.json');

function readDeployConfig() {
  try { return JSON.parse(fs.readFileSync(DEPLOY_CONFIG, 'utf8')); }
  catch { return {}; }
}

const deployers = [
  {
    name: 'Cloudflare Pages',
    needs: () => !!readDeployConfig().cloudflare,
    check: () => {
      const missing = [];
      if (!process.env.CLOUDFLARE_API_TOKEN) missing.push('CLOUDFLARE_API_TOKEN');
      return missing;
    },
    run() {
      const cfg = readDeployConfig().cloudflare;
      const token = process.env.CLOUDFLARE_API_TOKEN;
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || cfg.accountId || '';
      // 优先全局 wrangler，否则用 npx 临时拉取
      const wr = spawnSync('wrangler', ['--version'], { encoding: 'utf8' }).status === 0
        ? 'wrangler'
        : 'npx --yes wrangler';
      const cmd = wr.split(' ');
      const argsArr = [...cmd, 'pages', 'deploy', '5z_web',
        '--project-name', cfg.projectName || '5z-rule',
        '--branch', cfg.branch || 'main'];
      const r = spawnSync(argsArr[0], argsArr.slice(1), {
        cwd: ROOT, encoding: 'utf8', timeout: 10 * 60 * 1000,
        env: { ...process.env, CLOUDFLARE_API_TOKEN: token, ...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}) },
      });
      if (r.stdout) console.log(r.stdout.trimEnd());
      if (r.stderr) process.stdout.write(r.stderr);
      if (r.status !== 0) throw new Error(`wrangler 部署失败(exit ${r.status})`);
      console.log('   ✓ Cloudflare Pages 部署成功');
    },
  },
  // 未来平台示例（Vercel / Netlify 等）：
  // { name: 'Vercel', needs: () => !!readDeployConfig().vercel, check: () => [], run() { ... } },
];

// ---------- Cloudflare 边缘缓存：等新版本上线后自动 purge ----------
// 与上面的「部署器」解耦：即使站点只靠 Cloudflare Pages 的 Git 集成自动发布
// （needs() 为假、不跑 wrangler），只要提供 API Token + Zone ID 就能 purge。
// 起因：Pages 默认给 HTML 发 4 小时 TTL，发新版后旧 index.html 会被边缘继续命中，
// 造成「源站已是新版、部分 Cloudflare 节点仍是旧版」（1.62 发布时实际踩到过）。
// 构建戳（与 index.html 里 ?v= 同源）是判断「新版是否已上线」的指纹。
const BUILD_TS = (() => {
  try { return fs.readFileSync(path.join(ROOT, 'assets', 'idx-version.txt'), 'utf8').trim(); }
  catch { return null; }
})();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForSite(domain, ts, timeoutMs) {
  const pathname = '/assets/idx-version.txt?cb=' + Date.now();
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`https://${domain}${pathname}`, { redirect: 'follow' });
      last = (await r.text()).trim();
      if (last === ts) return true;
    } catch { /* 网络抖动/域名未解析，重试 */ }
    await sleep(4000);
  }
  console.log(`   ! 等待超时（${Math.round(timeoutMs / 1000)}s）: 期望 ${ts}，实际 ${last || '无响应'}`);
  return false;
}

async function cfPurge(cfg, domain, urls) {
  const token = process.env.CLOUDFLARE_API_TOKEN || cfg.apiToken;
  if (!token) return { skipped: '缺少 CLOUDFLARE_API_TOKEN（或 deploy.config.json 的 cloudflare.apiToken）' };
  let zoneId = process.env.CLOUDFLARE_ZONE_ID || cfg.zoneId || '';
  if (!zoneId) {
    const rr = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(domain)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await rr.json().catch(() => null);
    if (j && j.success && j.result && j.result.length) zoneId = j.result[0].id;
    else return { skipped: `无法从 API 取得 ${domain} 的 Zone ID，请在 deploy.config.json 里显式填 cloudflare.zoneId` };
  }
  const body = urls.length ? { files: urls } : { purge_everything: true };
  const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  if (!j || !j.success) {
    const detail = (j && j.errors && j.errors.map(e => e.message).join('; ')) || `HTTP ${r.status}`;
    throw new Error(`purge 失败: ${detail}`);
  }
  return { count: urls.length || '全部' };
}

// ---------- 主流程 ----------
console.log('========== 5z 规则 自动更新 ==========');

const chm = findChm();
if (!opts.noExtract && !chm) {
  // 没有新 CHM：若 5z_src 可用则降级为“用现有源重新构建并发布”，否则才中止
  const srcUsable = fs.existsSync(SRC) &&
    fs.readdirSync(SRC).some(f => /\.hhc$/i.test(f));
  if (srcUsable) {
    console.log('\n未找到新 CHM，将使用现有 5z_src 重新构建并发布（等效 --no-extract）。');
    console.log('如需导入新规则版本，请把新 CHM 放进 incoming/ 文件夹，或直接把 CHM 拖到 一键更新.bat 上。');
    opts.noExtract = true;
  } else {
    fail('未找到 CHM 文件。请把新 CHM 放进 incoming/ 文件夹，或直接把 CHM 拖到 一键更新.bat 上。');
  }
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
  run('git', ['commit', '-m', opts.message || `5z 规则 ${VERSION} 版 自动更新`]);
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

// 7/7 可选部署器：同步到其他托管平台（Cloudflare Pages 等）
console.log('\n[7/7] 同步到其他托管平台');
if (opts.dryRun) {
  console.log('   [dry-run] 跳过部署器');
} else if (opts.skipDeploy) {
  console.log('   [--skip-deploy] 跳过');
} else {
  let ran = 0;
  for (const d of deployers) {
    if (!d.needs()) { console.log(`   - ${d.name}: 未配置（见 5z_build/deploy.config.example.json），跳过`); continue; }
    const missing = d.check();
    if (missing.length) fail(`${d.name} 已配置但缺少凭据: ${missing.join(', ')}（可通过环境变量或 deploy.config.json 提供）`);
    console.log(`   → ${d.name}`);
    try { d.run(); ran++; }
    catch (e) { fail(`${d.name} 部署失败（主站已上线，可重跑 update.mjs --no-extract --no-push --skip-deploy 跳过）: ${e.message}`); }
  }
  if (!ran) console.log('   （未配置任何部署器，仅 GitHub Pages 自动上线）');
}

// 8/8 Cloudflare 边缘缓存 purge（Git 集成的 Pages 需要它才能立刻换版）
console.log('\n[8/8] 清理 Cloudflare 边缘缓存');
if (opts.dryRun) {
  console.log('   [dry-run] 跳过');
} else if (opts.skipDeploy) {
  console.log('   [--skip-deploy] 跳过');
} else {
  const cfg = readDeployConfig().cloudflare || {};
  const domain = opts.site || cfg.domain || '5z-rules.top';
  const hasCf = !!(process.env.CLOUDFLARE_API_TOKEN || cfg.apiToken);
  if (!hasCf) {
    console.log('   - 未配置 Cloudflare 凭据，跳过 purge（见 5z_build/DEPLOY.md「发布后自动清缓存」）');
    console.log('     只靠 Git 集成发布时，HTML 仍可能被边缘缓存 4 小时；配置后可自动清理。');
  } else if (!BUILD_TS) {
    console.log('   - 读不到 assets/idx-version.txt，跳过（无法确认新版是否已上线）');
  } else {
    const timeoutMs = Number(cfg.waitForDeployMs) || 240000;
    console.log(`   等待 ${domain} 上线构建戳 ${BUILD_TS}（最多 ${Math.round(timeoutMs / 1000)}s）...`);
    const live = await waitForSite(domain, BUILD_TS, timeoutMs);
    if (!live) {
      console.log('   - 未确认新版已生效，跳过 purge（缓存未过期时清理会把旧内容重新填回去）');
      console.log(`     稍后可手动重跑: node 5z_build/update.mjs --no-extract --no-push`);
    } else {
      console.log('   ✓ 新版已上线，清理边缘缓存...');
      const urls = Array.isArray(cfg.purgePaths) ? cfg.purgePaths : [];
      try {
        const res = await cfPurge(cfg, domain, urls);
        if (res.skipped) console.log(`   - ${res.skipped}`);
        else console.log(`   ✓ 已清理 ${res.count} 个 URL`);
      } catch (e) {
        console.log(`   ! purge 未完成（站点已正常上线，可稍后在 Cloudflare 后台手动「清除缓存」）: ${e.message}`);
      }
    }
  }
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
