// 查看盗贼.htm 中「附录：杂技花招」标题段落的原始 HTML + 边界
import fs from 'node:fs';
import { TextDecoder } from 'node:util';
const text = new TextDecoder('gb18030').decode(fs.readFileSync('5z_src/职业/盗贼.htm'));
const idx = text.indexOf('附录：杂技花招');
console.log('位置:', idx, '/', text.length);
console.log('=== 标题段前后 600 字符 ===');
console.log(text.slice(idx - 300, idx + 300));
console.log('=== 附录段之前的最后一个完整段落（找段落边界）===');
// 找标题段落的 <p 起始
const pStart = text.lastIndexOf('<p', idx);
console.log('段落起始:', pStart);
console.log(text.slice(pStart - 50, pStart + 100));
// 页尾结构
console.log('=== 文件最后 300 字符 ===');
console.log(text.slice(-300));
