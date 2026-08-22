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
const htmlFile = '5z_web/职业/契术师.htm';
const relFrom = '职业/契术师.htm';
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
  const decoded = decodeURIComponent(target);
  const ok = exists.has(decoded);
  if (!ok || target.includes('附录')) {
    fs.writeFileSync('5z_build/_dbg-log.txt', JSON.stringify({ href: m[1], target, decoded, ok, existsHas: exists.has(target) }) + '\n', { flag: 'a' });
  }
}
