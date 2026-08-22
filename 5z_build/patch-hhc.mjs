// HHC 补丁：在 7 个职业条目的子 UL 中插入附录页条目
import fs from 'node:fs';
import { TextDecoder, TextEncoder } from 'node:util';
const HHC = '5z_src/5z规则1.59版.hhc';
const text = new TextDecoder('gb18030').decode(fs.readFileSync(HHC));
const jobs = [
  { file: '盗贼.htm', out: '盗贼附录.htm', nav: '附录：杂技花招' },
  { file: '奇械师.htm', out: '奇械师附录.htm', nav: '附录：制造物品' },
  { file: '契术师.htm', out: '契术师附录.htm', nav: '附录：魔能祈唤' },
  { file: '吟游诗人.htm', out: '吟游诗人附录.htm', nav: '附录：吟唱' },
  { file: '德鲁伊.htm', out: '德鲁伊附录.htm', nav: '附录：荒野变形' },
  { file: '法师.htm', out: '法师附录.htm', nav: '附录：法术书' },
  { file: '召唤师.htm', out: '召唤师附录.htm', nav: '附录：指令列表' },
];
let out = text;
let count = 0;
for (const job of jobs) {
  const local = '职业/' + job.file;
  const idx = out.indexOf(local);
  if (idx < 0) { console.log('✗ 未找到', local); continue; }
  // 从该 Local 往前找所属 LI 的 <OBJECT 开始，往后找该 OBJECT 的 </OBJECT>，再找其后的 <UL>
  const objStart = out.lastIndexOf('<OBJECT', idx);
  const objEnd = out.indexOf('</OBJECT>', idx);
  if (objStart < 0 || objEnd < 0) { console.log('✗ 结构异常', local); continue; }
  const afterObj = out.indexOf('<UL>', objEnd);
  if (afterObj < 0 || afterObj - objEnd > 400) { console.log('✗ 未找到子 UL', local); continue; }
  const entry = `<LI><OBJECT type="text/sitemap">
 <param name="Name" value="${job.nav}">
 <param name="Local" value="职业/${job.out}">
 <param name="ImageNumber" value="11">
 </OBJECT>
</LI>
`;
  out = out.slice(0, afterObj + 4) + '\n' + entry + out.slice(afterObj + 4);
  count++;
  console.log('✓ 插入', job.nav, '→', local, '的子 UL');
}
fs.writeFileSync(HHC, new TextEncoder().encode(out));
console.log('完成，共插入', count, '条');
