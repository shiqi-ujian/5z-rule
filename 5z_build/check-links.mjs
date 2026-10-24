// 链接完整性检查：扫描 5z_web 下所有生成的 HTML，验证内部 href/src 目标存在
// 2026-10-24「超链接索引」起：同时校验 #fragment 锚点（关键词互链/词典原文链接会跳到 #kw-词条）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('5z_web');
const files = [];
(function collect(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collect(full);
    else files.push(full);
  }
})(ROOT);

const exists = new Set(files.map(f => path.relative(ROOT, f).split(path.sep).join('/')));
const issues = [];
const warnings = [];
const skipProto = /^(https?:|mailto:|javascript:|data:|ftp:|tel:)/i;
// 源 CHM 里本来就有的 4 条坏页内锚点（无对应 id/name，非本功能引入）；
// 只把它们降级为警告，其余锚点（尤其是 auto-link 注入的 #kw-*）一律硬失败。
const LEGACY_BROKEN_HINT = /^(?:#1$|#muse$|#束缚_phb$|#被擒_phb$)/;

// 目标页里的锚点 id/name 集合（懒加载 + 缓存）
const idsCache = new Map();
function idsOf(relFile) {
  if (idsCache.has(relFile)) return idsCache.get(relFile);
  const set = new Set();
  const abs = path.join(ROOT, relFile.split('/').join(path.sep));
  if (fs.existsSync(abs) && fs.statSync(abs).isFile() && /\.(htm|html)$/i.test(relFile)) {
    const html = fs.readFileSync(abs, 'utf8');
    for (const m of html.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)) set.add(m[1]);
    for (const m of html.matchAll(/<a\b[^>]*\sname\s*=\s*["']([^"']+)["']/gi)) set.add(m[1]);
  }
  idsCache.set(relFile, set);
  return set;
}

function resolveLocal(fromRel, hrefPath) {
  if (hrefPath.startsWith('/')) return hrefPath.slice(1);
  const fromDir = path.posix.dirname(fromRel) === '.' ? '' : path.posix.dirname(fromRel);
  const parts = [];
  if (fromDir) parts.push(...fromDir.split('/'));
  for (const seg of hrefPath.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

function check(htmlFile, relFrom) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  // 只在真实标签里找 href/src——不能扫全文本：更新日志等页面会把示例代码转义成
  // `&lt;a href="..."&gt;`，按全文本正则会把示例误判成坏链。
  const tagRe = /<[a-zA-Z][^>]*>/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const linkM = /(?:href|src)\s*=\s*"([^"]+)"/i.exec(m[0]);
    if (!linkM) continue;
    const raw = linkM[1];
    if (!raw || skipProto.test(raw)) continue;
    const hashIdx = raw.indexOf('#');
    const fragRaw = hashIdx >= 0 ? raw.slice(hashIdx + 1).split('?')[0] : '';
    // href="#..."
    let target = raw.split('#')[0].split('?')[0];
    if (!target) {
      // 纯页内锚点：校验锚点在「当前页」
      if (fragRaw) {
        let frag = fragRaw;
        try { frag = decodeURIComponent(fragRaw); } catch (e) { /* 保持原样 */ }
        if (!idsOf(relFrom).has(frag)) {
          const msg = `${relFrom} → 页内锚点缺失: #${frag}`;
          if (LEGACY_BROKEN_HINT.test('#' + frag)) warnings.push(msg);
          else issues.push(msg);
        }
      }
      continue;
    }
    // 旧版规则书入口 v/<版本>/ 由 Cloudflare Pages Function 动态代理（见 build.mjs 8.4.1），
    // 站点里没有对应静态文件，不能按坏链处理。
    if (/^v\/(?:\d+(?:\.\d+)+|__probe)(?:\/|$)/.test(target)) continue;
    target = decodeURIComponent(target);
    const resolved = resolveLocal(relFrom, target);
    if (!exists.has(resolved)) {
      issues.push(`${relFrom} → 缺失: ${raw}`);
      continue;
    }
    // 校验 #fragment 锚点
    if (fragRaw) {
      let frag = fragRaw;
      try { frag = decodeURIComponent(fragRaw); } catch (e) { /* 保持原样 */ }
      if (!idsOf(resolved).has(frag)) {
        const msg = `${relFrom} → 锚点缺失: ${raw}`;
        if (LEGACY_BROKEN_HINT.test(raw.slice(raw.indexOf('#')))) warnings.push(msg);
        else issues.push(msg);
      }
    }
  }
}

for (const f of files) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  if (/\.(htm|html)$/i.test(rel)) check(f, rel);
}
// 壳资源自身
for (const asset of ['assets/site.css', 'assets/app.js', 'assets/body.css', 'assets/favicon.svg', 'assets/search-index.json']) {
  if (!exists.has(asset)) issues.push(`壳资源缺失: ${asset}`);
}

console.log(`扫描 HTML 文件: ${files.filter(f => /\.(htm|html)$/i.test(f)).length}`);
if (warnings.length) {
  console.log(`已知源页面坏锚点 ${warnings.length} 个（CHM 原文遗留，非自动互链引入，仅提示）:`);
  warnings.slice(0, 10).forEach(i => console.log('  - ' + i));
}
console.log(issues.length ? `坏链接 ${issues.length} 个:` : '✓ 所有链接完整，无坏链/坏锚点');
issues.slice(0, 40).forEach(i => console.log('  ! ' + i));
// 流水线门禁：有坏链则以失败退出
if (issues.length) process.exitCode = 1;
