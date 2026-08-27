// 完整性交叉验证：hhc 树 / hhk 索引 / 磁盘文件 / 输出站点 四向核对
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('5z_src');
const OUT = path.resolve('5z_web');
const enc = new TextDecoder('gbk');

// 1. 磁盘文件清单
const disk = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else disk.push(path.relative(SRC, f).split(path.sep).join('/'));
  }
})(SRC);
const diskHtm = new Set(disk.filter(f => /\.(htm|html)$/i.test(f)));

// 2. hhc 树 Local（自动发现 5z_src 下的 .hhc，兼容版本号变化）
const hhcFile = fs.readdirSync(SRC).find(f => /\.hhc$/i.test(f));
if (!hhcFile) {
  console.error('5z_src 下未找到 .hhc 目录文件');
  process.exit(1);
}
const hhc = enc.decode(fs.readFileSync(path.join(SRC, hhcFile)));
const hhcLocals = [...hhc.matchAll(/param name="Local" value="([^"]*)"/gi)]
  .map(m => m[1].replace(/&amp;/g, '&').replace(/\\/g, '/'))
  .filter(Boolean);
const hhcUniq = [...new Set(hhcLocals)];
console.log(`hhc 树 Local: ${hhcLocals.length} 条, 去重 ${hhcUniq.length} 个`);

// 3. hhk 索引引用（自动发现 5z_src 下的 .hhk，兼容版本号变化）
const hhkFile = fs.readdirSync(SRC).find(f => /\.hhk$/i.test(f));
if (!hhkFile) {
  console.error('5z_src 下未找到 .hhk 索引文件');
  process.exit(1);
}
const hhk = enc.decode(fs.readFileSync(path.join(SRC, hhkFile)));
const hhkRefs = [...hhk.matchAll(/value="([^"]+\.(?:htm|html))"/gi)]
  .map(m => m[1].replace(/&amp;/g, '&').replace(/\\/g, '/'));
const hhkUniq = [...new Set(hhkRefs)];
console.log(`hhk 索引引用: ${hhkRefs.length} 条, 去重 ${hhkUniq.length} 个`);

// 4. 输出站点文件
const site = [];
(function walk2(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk2(f);
    else site.push(path.relative(OUT, f).split(path.sep).join('/'));
  }
})(OUT);
const siteHtm = new Set(site.filter(f => /\.(htm|html)$/i.test(f)));

console.log(`磁盘 htm/html: ${diskHtm.size} | 站点 htm/html: ${siteHtm.size}`);

// 核对 1: hhc 树里的页面 → 磁盘（不含坏路径修复的 10 个聚合页，它们已生成）
const hhcMissingOnDisk = hhcUniq.filter(u => !diskHtm.has(u));
console.log(`\n[1] hhc 树引用但磁盘缺失: ${hhcMissingOnDisk.length}`);
hhcMissingOnDisk.slice(0, 20).forEach(m => console.log('   !', m));

// 核对 2: hhk 引用 → 磁盘
const hhkMissingOnDisk = hhkUniq.filter(u => !diskHtm.has(u));
console.log(`\n[2] hhk 引用但磁盘缺失: ${hhkMissingOnDisk.length}`);
hhkMissingOnDisk.slice(0, 20).forEach(m => console.log('   !', m));

// 核对 3: hhc 引用 → 站点（聚合页也算）
const hhcMissingOnSite = hhcUniq.filter(u => !siteHtm.has(u));
console.log(`\n[3] hhc 树引用但站点缺失: ${hhcMissingOnSite.length}`);
hhcMissingOnSite.slice(0, 20).forEach(m => console.log('   !', m));

// 核对 4: 磁盘页面 → hhc 树（树外页面）
const diskNotInTree = [...diskHtm].filter(u => !hhcUniq.includes(u));
console.log(`\n[4] 磁盘有但 hhc 树未引用: ${diskNotInTree.length}`);
diskNotInTree.slice(0, 20).forEach(m => console.log('   -', m));

// 核对 5: hhk 引用 → hhc 树
const hhkNotInTree = hhkUniq.filter(u => !hhcUniq.includes(u));
console.log(`\n[5] hhk 引用但 hhc 树没有: ${hhkNotInTree.length}`);
hhkNotInTree.slice(0, 20).forEach(m => console.log('   -', m));
