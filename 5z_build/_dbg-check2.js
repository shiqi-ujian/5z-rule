// 复制 check-links 逻辑并 dump 失败 target 的真实字符
const fs = require('fs');
const path = require('path');
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
function check(htmlFile, relFrom) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const fromDir = path.posix.dirname(relFrom) === '.' ? '' : path.posix.dirname(relFrom);
  const re = /(?:href|src)\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let target = m[1].split('#')[0].split('?')[0];
    if (!target || /^(https?:|mailto:|javascript:|data:|ftp:|tel:)/i.test(target)) continue;
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
    if (!exists.has(target)) issues.push({ from: relFrom, href: m[1], target: target });
  }
}
for (const f of files) check(f, path.relative(ROOT, f).split(path.sep).join('/'));
for (const it of issues.slice(0, 12)) {
  console.log(JSON.stringify(it));
}
console.log('总坏链接:', issues.length);
