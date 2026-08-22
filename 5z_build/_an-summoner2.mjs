import fs from 'node:fs';
import { TextDecoder } from 'node:util';
const text = new TextDecoder('gb18030').decode(fs.readFileSync('5z_src/职业/召唤师.htm'));
const i = text.indexOf('指令列表');
console.log('=== 指令列表 附近 HTML ===');
console.log(text.slice(i - 400, i + 150));
