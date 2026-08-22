// 查看 HHC 中「盗贼」条目的结构（插入子条目用）
import fs from 'node:fs';
import { TextDecoder } from 'node:util';
const text = new TextDecoder('gb18030').decode(fs.readFileSync('5z_src/5z规则1.59版.hhc'));
const idx = text.indexOf('职业/盗贼.htm');
console.log('盗贼 @', idx, '/', text.length);
console.log(text.slice(idx - 500, idx + 400));
