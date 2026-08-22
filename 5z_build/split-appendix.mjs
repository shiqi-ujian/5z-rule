// 职业页附录拆分器：把指定职业页的附录段拆到独立页面，主页面留链接
// 用法: node split-appendix.mjs [dry]
import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder, TextEncoder } from 'node:util';

const SRC = path.resolve('5z_src', '职业');
const DRY = process.argv[2] !== 'wet';

const JOBS = [
  { file: '盗贼.htm', out: '盗贼附录.htm', kw: '杂技花招', nav: '附录：杂技花招' },
  { file: '奇械师.htm', out: '奇械师附录.htm', kw: '制造物品', nav: '附录：制造物品' },
  { file: '契术师.htm', out: '契术师附录.htm', kw: '魔能祈唤', nav: '附录：魔能祈唤' },
  { file: '吟游诗人.htm', out: '吟游诗人附录.htm', kw: '吟唱', nav: '附录：吟唱' },
  { file: '德鲁伊.htm', out: '德鲁伊附录.htm', kw: '荒野变形', nav: '附录：荒野变形' },
  { file: '法师.htm', out: '法师附录.htm', kw: '法术书', nav: '附录：法术书' },
  { file: '召唤师.htm', out: '召唤师附录.htm', kw: '指令列表', nav: '附录：指令列表' },
];

const dec = (buf) => {
  const head = buf.slice(0, 2000).toString('latin1');
  return /charset\s*=\s*["']?utf-?8/i.test(head) ? buf.toString('utf8') : new TextDecoder('gb18030').decode(buf);
};
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

for (const job of JOBS) {
  const fp = path.join(SRC, job.file);
  const text = dec(fs.readFileSync(fp));
  // 按 <p 切段，找同时含「附录」与关键词的段落（去标签匹配，兼容标签拆词）
  const segs = text.split(/(?=<p)/i);
  let splitIdx = -1, hit = null;
  for (let i = 0; i < segs.length; i++) {
    const s = strip(segs[i]);
    if (/^附录[:：]/.test(s) && s.includes(job.kw)) { hit = segs[i]; splitIdx = text.indexOf(segs[i]); break; }
  }
  if (!hit) { console.log(`✗ ${job.file}: 未找到附录标题段落（${job.kw}）`); continue; }
  // 附录内容范围：标题段 → EndFragment（或文件尾）
  const endMark = text.indexOf('<!--EndFragment-->', splitIdx);
  const endIdx = endMark >= 0 ? endMark : text.length;
  const tail = endMark >= 0 ? text.slice(endMark) : '</div><!--EndFragment--></body></html>';
  const appendixContent = text.slice(splitIdx, endIdx);

  const title = path.basename(job.file, '.htm') + ' · ' + job.nav;
  // 复制原页的 <style> 块，保持 Word 导出排版一致
  const styles = (text.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).join('\n');
  const appHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="../assets/body.css">
${styles}
</head>
<body>
${appendixContent}
</body>
</html>
`;
  const linkHtml = `<p class=MsoNormal><b><span style="mso-spacerun:'yes';font-family:宋体;color:rgb(118,45,0);font-weight:bold;font-size:14.0000pt;"><font face="宋体"><a href="${job.out}" style="color:#7c3aed;text-decoration:none">📖 ${job.nav}（另开一页）→</a></font></span></b></p>`;
  const mainHtml = text.slice(0, splitIdx) + linkHtml + tail;

  const pct = Math.round(splitIdx / text.length * 100);
  console.log(`${job.file}: 附录标题段 @${pct}% (${splitIdx}), 附录长 ${appendixContent.length}, 主页面长 ${mainHtml.length}`);
  if (DRY) continue;
  // 写回：主页面 + 新附录页（UTF-8，且头部的 charset 声明必须改为 utf-8，
  // 否则 build 的 readText 按 GB18030 解码 UTF-8 中文 → mojibake 坏链接）
  const fixCharset = (h) => h.replace(/charset\s*=\s*["']?(gb2312|gbk|GB2312|GBK)["']?/i, 'charset=utf-8');
  fs.writeFileSync(path.join(SRC, job.file), fixCharset(mainHtml), 'utf8');
  fs.writeFileSync(path.join(SRC, job.out), appHtml, 'utf8');
  console.log(`  ✓ 已写入 ${job.file}（主） + ${job.out}（附录）`);
}
console.log(DRY ? '(dry run)' : '(wet)');
