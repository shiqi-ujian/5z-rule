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
console.log('存在 职业/契术师附录.htm:', exists.has('职业/契术师附录.htm'));
// 列出 职业 目录下含 附录 的 exists 项
const hit = [...exists].filter(x => x.includes('附录'));
console.log('附录相关 exists 项:', JSON.stringify(hit));
// 解析链接
const html = fs.readFileSync('5z_web/职业/契术师.htm', 'utf8');
const m = /href="([^"]*附录[^"]*\.htm)"/.exec(html);
console.log('找到链接:', m && m[1]);
if (m) {
  let target = m[1].split('#')[0].split('?')[0];
  const fromDir = '职业';
  const parts = [];
  if (fromDir) parts.push(...fromDir.split('/'));
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  target = parts.join('/');
  console.log('解析后 target:', target);
  console.log('exists.has:', exists.has(target));
}
