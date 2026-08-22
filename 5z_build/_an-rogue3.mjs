// 盗贼.htm 纯文本行分析：找附录标题（短行、在页面后半段）
import fs from 'node:fs';
import { TextDecoder } from 'node:util';
const text = new TextDecoder('gb18030').decode(fs.readFileSync('5z_src/职业/盗贼.htm'));

// 按段落/换行切分，去标签
const blocks = text.split(/(?=<)/).map(b => b.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
const total = blocks.length;
console.log('文本块数:', total);
// 找「附录」相关块
blocks.forEach((b, i) => {
  if (/附录|杂技花招|潜行技能|精通|大师/.test(b) && b.length < 30) {
    console.log(`块#${i}/${total} (${Math.round(i / total * 100)}%): ${b}`);
  }
});
