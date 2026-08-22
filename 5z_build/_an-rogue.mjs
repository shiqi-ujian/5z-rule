// 分析 盗贼.htm 的附录段落结构：找附录标题（样式特征：大字号/加粗）及内容范围
import fs from 'node:fs';
import { TextDecoder } from 'node:util';
const text = new TextDecoder('gb18030').decode(fs.readFileSync('5z_src/职业/盗贼.htm'));

// 找「附录：」开头的标题行
const lines = text.split('\n');
console.log('总行数:', lines.length);
const heads = [];
lines.forEach((l, i) => {
  // Word 导出通常 <p class=MsoToc1 ...> 或带大字号 style 的标题
  const t = l.replace(/<[^>]+>/g, '').trim();
  if (/^附录[:：]/.test(t) || /^杂技花招|^潜行技能/.test(t)) heads.push({ i, t: t.slice(0, 30), len: l.length });
});
console.log('「附录：」标题行:');
for (const h of heads) console.log(' 行', h.i, h.t, 'html长', h.len);

// 找样式线索：哪些 style 是标题（font-size 大于 16pt）
const fontSizes = {};
for (const m of text.matchAll(/font-size:(\d+(?:\.\d+)?)\.0000pt/g)) {
  fontSizes[m[1]] = (fontSizes[m[1]] || 0) + 1;
}
console.log('font-size 分布(前10):', Object.entries(fontSizes).sort((a, b) => b[1] - a[1]).slice(0, 10));
