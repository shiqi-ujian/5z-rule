import fs from 'node:fs';
import { TextDecoder } from 'node:util';
const text = new TextDecoder('gb18030').decode(fs.readFileSync('5z_src/职业/召唤师.htm'));
for (const kw of ['指令列表', '指令', '附录']) {
  const hits = [];
  let i = 0;
  while ((i = text.indexOf(kw, i)) !== -1) {
    hits.push(i);
    i += kw.length;
  }
  console.log(kw, '出现:', hits.length, '次', hits.slice(0, 10).map(h => Math.round(h / text.length * 100) + '%').join(','));
}
// 最后 20% 的纯文本结构
const tail = text.slice(Math.floor(text.length * 0.75));
const blocks = tail.split(/(?=<)/).map(b => b.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
console.log('尾部文本块（前 40）:');
blocks.slice(0, 40).forEach((b, i) => { if (b.length < 40) console.log(`  #${i}: ${b}`); });
