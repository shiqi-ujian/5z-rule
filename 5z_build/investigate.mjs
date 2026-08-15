// 调查：鲜血道途 节点 + 狂战士子树 vs 磁盘差异
import fs from 'node:fs';
import path from 'node:path';
const SRC = path.resolve('5z_src');
const enc = new TextDecoder('gb18030');

// 1. 鲜血.htm 标题
const html = enc.decode(fs.readFileSync(path.join(SRC, '职业/狂战士/鲜血.htm')));
const t = /<title>([\s\S]*?)<\/title>/i.exec(html);
console.log('鲜血.htm <title>:', t ? t[1].trim() : '(无)');

// 2. hhc 里有没有"道途"相关名称
const hhc = enc.decode(fs.readFileSync(path.join(SRC, '5z规则1.59版.hhc')));
for (const kw of ['道途', '鲜血', '龙怒', '战士（狂战士变体）', '回音骑士', '阿斯塔特']) {
  console.log(`hhc 含 "${kw}":`, hhc.includes(kw));
}

// 3. 狂战士子树完整节点（从"狂战士"节点开始到其 UL 闭合）
const start = hhc.indexOf('value="狂战士"');
const end = hhc.indexOf('</UL>', start);
const seg = hhc.substring(start, end + 6);
const items = [...seg.matchAll(/Name" value="([^"]*)"[\s\S]*?Local" value="([^"]*)"/g)]
  .map(m => `${m[1]} => ${m[2] || '(无页面)'}`);
console.log('--- 狂战士子树节点 ---');
items.forEach(x => console.log('  ', x));

// 4. 磁盘 职业/狂战士 下所有 htm（含子目录）
const diskHtm = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.(htm|html)$/i.test(e.name)) diskHtm.push(path.relative(SRC, f).split(path.sep).join('/'));
  }
})(path.join(SRC, '职业/狂战士'));
console.log('--- 磁盘 职业/狂战士 全部 htm ---');
diskHtm.forEach(x => console.log('  ', x));

// 5. hhc 树中全部 Local
const allLocals = [...hhc.matchAll(/Local" value="([^"]*)"/g)].map(m => m[1]).filter(Boolean);
console.log('--- 磁盘有但 hhc 树未引用的页面 ---');
diskHtm.filter(x => !allLocals.includes(x)).forEach(x => console.log('  !', x));
