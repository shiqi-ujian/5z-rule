// 精确定位 HHC 中 7 个职业条目的 LI 块（是否有 UL 子结构）
import fs from 'node:fs';
import { TextDecoder } from 'node:util';
const text = new TextDecoder('gb18030').decode(fs.readFileSync('5z_src/5z规则1.59版.hhc'));
const jobs = ['盗贼.htm', '奇械师.htm', '契术师.htm', '吟游诗人.htm', '德鲁伊.htm', '法师.htm', '召唤师.htm'];
for (const f of jobs) {
  const idx = text.indexOf('职业/' + f);
  if (idx < 0) { console.log(f, '未找到'); continue; }
  // 从该 Local 往前找 <LI><OBJECT
  const li = text.lastIndexOf('<LI>', idx);
  // 从该 LI 往后找下一个 </LI>（含可能的 UL）
  const seg = text.slice(li, li + 300);
  console.log(`--- ${f} @${idx} ---`);
  console.log(seg.replace(/\n/g, ' ').slice(0, 220));
}
