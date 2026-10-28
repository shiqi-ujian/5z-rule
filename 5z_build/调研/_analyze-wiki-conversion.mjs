// 只读分析：评估「5z 规则书 CHM 反编译产物 → wiki 格式」的转换成本
// 运行：node 5z_build/调研/_analyze-wiki-conversion.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SRC = path.join(ROOT, '5z_src');
const GB = new TextDecoder('gb18030');

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(SRC).filter(f => /\.htm$/i.test(f));
const pages = [];
let totalBytes = 0, totalChars = 0;
const tagTotals = {};
const sizeHist = {};
const headingSizeHist = {};
const colorSizeBold = {};

for (const f of files) {
  const buf = fs.readFileSync(f);
  totalBytes += buf.length;
  const html = GB.decode(buf);
  const rel = path.relative(SRC, f).replace(/\\/g, '/');
  // 去掉 head/style/script/xml 保护区后统计
  const body = html
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<xml\b[^>]*>[\s\S]*?<\/xml>/gi, '');
  const count = (re) => (body.match(re) || []).length;
  const t = {
    h: count(/<h[1-6]\b/gi),
    table: count(/<table\b/gi),
    tr: count(/<tr\b/gi),
    td: count(/<t[dh]\b/gi),
    ul: count(/<ul\b/gi),
    ol: count(/<ol\b/gi),
    li: count(/<li\b/gi),
    p: count(/<p\b/gi),
    br: count(/<br\b/gi),
    img: count(/<img\b/gi),
    a: count(/<a\b/gi),
    aName: count(/<a\b[^>]*\bname\s*=/gi),
    span: count(/<span\b/gi),
    o_p: count(/<o:p\b/gi),
  };
  for (const [k, v] of Object.entries(t)) tagTotals[k] = (tagTotals[k] || 0) + v;
  const text = body.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  totalChars += text.length;
  // 字号统计
  const sizes = [...body.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)\s*(?:\.0000)?pt/gi)].map(m => parseFloat(m[1]));
  for (const s of sizes) sizeHist[s] = (sizeHist[s] || 0) + 1;
  // 「加粗 + 字号」组合（标题候选的主要来源）
  for (const m of body.matchAll(/<span[^>]*style\s*=\s*"([^"]*)"[^>]*>/gi)) {
    const st = m[1];
    if (!/font-weight\s*:\s*bold|[6-9]00/i.test(st)) continue;
    const sm = /font-size\s*:\s*(\d+(?:\.\d+)?)\s*(?:\.0000)?pt/i.exec(st);
    const cm = /color\s*:\s*rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i.exec(st);
    const key = `${sm ? parseFloat(sm[1]) : '?'}pt|${cm ? `${cm[1]},${cm[2]},${cm[3]}` : '?'}`;
    colorSizeBold[key] = (colorSizeBold[key] || 0) + 1;
    if (sm) headingSizeHist[parseFloat(sm[1])] = (headingSizeHist[parseFloat(sm[1])] || 0) + 1;
  }
  pages.push({ rel, bytes: buf.length, chars: text.length, ...t });
}

const sum = (k) => pages.reduce((a, p) => a + p[k], 0);
const fmt = (n) => n.toLocaleString('en-US');
const mb = (n) => (n / 1048576).toFixed(1);

console.log('===== 语料总览 =====');
console.log(`页面数: ${files.length}`);
console.log(`HTML 体积: ${mb(totalBytes)} MB`);
console.log(`正文字符数(去标签/空白压缩): ${fmt(totalChars)}`);
console.log(`HTML/正文字符比: ${(totalBytes / totalChars).toFixed(1)} : 1`);
console.log('\n===== 元素总量 =====');
for (const [k, v] of Object.entries(tagTotals)) console.log(`${k.padEnd(8)} ${fmt(v)}`);
console.log(`\n平均每页: table ${(sum('table') / pages.length).toFixed(1)} / tr ${(sum('tr') / pages.length).toFixed(1)} / td ${(sum('td') / pages.length).toFixed(1)} / p ${(sum('p') / pages.length).toFixed(0)} / img ${(sum('img') / pages.length).toFixed(2)}`);

const byTable = [...pages].sort((a, b) => b.table - a.table).slice(0, 12);
console.log('\n===== 表格最多的页 =====');
for (const p of byTable) console.log(`${String(p.table).padStart(4)} tables ${String(p.tr).padStart(4)} tr ${String(p.td).padStart(5)} td  ${p.rel}`);

const noTable = pages.filter(p => p.table === 0).length;
const withTable = pages.length - noTable;
console.log(`\n含表格页: ${withTable} / 无表格页: ${noTable}`);

console.log('\n===== 页面体积分布 =====');
const buckets = [[0, 20], [20, 50], [50, 100], [100, 200], [200, 500], [500, 1000], [1000, 1e9]];
for (const [lo, hi] of buckets) {
  const n = pages.filter(p => p.bytes / 1024 >= lo && p.bytes / 1024 < hi).length;
  console.log(`${lo}–${hi === 1e9 ? '∞' : hi} KB: ${String(n).padStart(3)} 页`);
}
const biggest = [...pages].sort((a, b) => b.bytes - a.bytes).slice(0, 10);
console.log('\n===== 最大的 10 页 =====');
for (const p of biggest) console.log(`${String(Math.round(p.bytes / 1024)).padStart(5)} KB ${String(p.chars).padStart(7)} 字 ${String(p.table).padStart(3)} 表  ${p.rel}`);

console.log('\n===== 语义标题 =====');
console.log(`h1–h6 合计: ${fmt(tagTotals.h)}（全文正文页）`);
console.log(`加粗 span 的字号分布(pt: 个数): ${JSON.stringify(headingSizeHist)}`);
const topStyles = Object.entries(colorSizeBold).sort((a, b) => b[1] - a[1]).slice(0, 18);
console.log('\n加粗样式 TOP18（字号|颜色 → 次数）:');
for (const [k, v] of topStyles) console.log(`  ${k.padEnd(18)} ${fmt(v)}`);

console.log('\n===== 链接/图片 =====');
console.log(`<a> 合计 ${fmt(tagTotals.a)}（其中 name= 书签 ${fmt(tagTotals.aName)}）`);
const imgPages = pages.filter(p => p.img > 0);
console.log(`含图页: ${imgPages.length}，图片引用 ${fmt(tagTotals.img)} 次`);
for (const p of imgPages) console.log(`  ${p.img} 图  ${p.rel}`);

const noP = pages.filter(p => p.p === 0).length;
console.log(`\n无 <p> 页: ${noP}`);
console.log('\n===== 结论用数字 =====');
console.log(`若要「一页一词条」拆分：449 个目标页 → 5,014 词条；现有 662 页正文。`);
const textPerPage = totalChars / pages.length;
console.log(`平均每页正文 ${Math.round(textPerPage)} 字，平均每页 HTML ${Math.round(totalBytes / pages.length / 1024)} KB。`);
