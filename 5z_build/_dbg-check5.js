const fs = require('fs');
const html = fs.readFileSync('5z_web/职业/契术师.htm', 'utf8');
const i = html.indexOf('濂戞湳甯堥檮褰');
console.log('mojibake 链接位置:', i);
console.log('上下文:', html.slice(i - 200, i + 100).replace(/\n/g, ' '));
// 源文件里找（GB18030 解码后）
const buf = fs.readFileSync('5z_src/职业/契术师.htm');
const src = new (require('util').TextDecoder)('gb18030').decode(buf);
const j = src.indexOf('契术师附录');
console.log('--- 源文件（拆分后）中 契术师附录 出现位置:', j);
console.log('上下文:', src.slice(Math.max(0, j - 150), j + 80).replace(/\n/g, ' '));
