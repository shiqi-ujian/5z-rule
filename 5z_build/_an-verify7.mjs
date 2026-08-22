// 验证 7 个职业页的附录标题位置
import fs from 'node:fs';
import { TextDecoder } from 'node:util';
const targets = {
  '盗贼.htm': '附录：杂技花招',
  '奇械师.htm': '附录：制造物品',
  '契术师.htm': '附录：魔能祈唤',
  '吟游诗人.htm': '附录：吟唱',
  '德鲁伊.htm': '附录：荒野变形',
  '法师.htm': '附录：法术书',
  '召唤师.htm': '附录：指令列表',
};
for (const [f, marker] of Object.entries(targets)) {
  const text = new TextDecoder('gb18030').decode(fs.readFileSync('5z_src/职业/' + f));
  const idx = text.indexOf(marker);
  const pStart = idx >= 0 ? text.lastIndexOf('<p', idx) : -1;
  // 该页所有「附录：」标题
  const appends = [];
  let i = 0;
  while ((i = text.indexOf('附录：', i)) !== -1) {
    const seg = text.slice(i, i + 24).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    appends.push(seg);
    i += 3;
  }
  console.log(`${f}: marker@${idx} (${Math.round(idx / text.length * 100)}%), pStart=${pStart}, 页长=${text.length}`);
  console.log('  附录标题:', [...new Set(appends)].join(' | '));
}
