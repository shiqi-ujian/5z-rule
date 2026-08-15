// 链接完整性检查：扫描 5z_web 下所有生成的 HTML，验证内部 href/src 目标存在
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
const skipProto = /^(https?:|mailto:|javascript:|data:|ftp:|tel:)/i;

function check(htmlFile, relFrom) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const fromDir = path.posix.dirname(relFrom) === '.' ? '' : path.posix.dirname(relFrom);
  const re = /(?:href|src)\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let target = m[1].split('#')[0].split('?')[0];
    if (!target || skipProto.test(target)) continue;
    if (target.startsWith('/')) target = target.slice(1);
    else {
      const parts = [];
      if (fromDir) parts.push(...fromDir.split('/'));
      for (const seg of target.split('/')) {
        if (seg === '..') parts.pop();
        else if (seg !== '.' && seg !== '') parts.push(seg);
      }
      target = parts.join('/');
    }
    target = decodeURIComponent(target);
    if (!exists.has(target)) {
      issues.push(`${relFrom} → 缺失: ${m[1]}`);
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
console.log(issues.length ? `坏链接 ${issues.length} 个:` : '✓ 所有链接完整，无坏链');
issues.slice(0, 40).forEach(i => console.log('  ! ' + i));
