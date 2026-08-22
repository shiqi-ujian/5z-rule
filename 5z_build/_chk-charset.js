const fs = require('fs');
const { TextDecoder } = require('util');
for (const f of ['契术师.htm','盗贼.htm','召唤师.htm']) {
  const buf = fs.readFileSync('5z_src/职业/' + f);
  const head = buf.slice(0, 800).toString('latin1');
  const m = /charset\s*=\s*["']?([^"'\s>]+)/i.exec(head);
  console.log(f, 'charset 声明:', m ? m[1] : '(无)');
}
