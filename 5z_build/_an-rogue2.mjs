// 提取盗贼.htm 中大字号标题（16/22pt）及其文本，定位附录段
import fs from 'node:fs';
import { TextDecoder } from 'node:util';
const text = new TextDecoder('gb18030').decode(fs.readFileSync('5z_src/职业/盗贼.htm'));

// 按 <p ... style="...font-size:NN.0000pt...">...</p> 提取
const re = /<p[^>]*font-size:(\d+(?:\.\d+)?)\.0000pt[^>]*>([\s\S]*?)<\/p>/g;
let m, idx = 0;
const out = [];
while ((m = re.exec(text)) !== null) {
  const size = m[1];
  if (size === '16' || size === '18' || size === '22') {
    const inner = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (inner) out.push({ size, pos: m.index, text: inner.slice(0, 40) });
  }
}
console.log('大字号标题段落:');
for (const o of out) console.log(`  [${o.size}pt @${o.pos}] ${o.text}`);
