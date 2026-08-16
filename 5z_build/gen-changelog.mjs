// ============================================================
// 更新日志页生成器：由 5z_build/changelog.json 渲染 更新日志.html。
//   默认输出到 5z_web（构建暂存区），由 sync-web 同步到仓库根目录发布源；
//   build.mjs 每次构建会自动调用本脚本。也可手动指定输出目录：
//   node 5z_build/gen-changelog.mjs [输出目录]
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, '5z_build', 'changelog.json');
const OUT_DIR = path.resolve(process.argv[2] || path.join(ROOT, '5z_web'));
fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT = path.join(OUT_DIR, '更新日志.html');

const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const entries = [...(data.entries || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n2b = (s) => esc(s).replace(/\n/g, '<br>');

function renderEntry(e) {
  const fixes = (e.fixes || []).map((f) => `
    <li class="cl-fix">
      <span class="cl-id">#${esc(f.id || '')}</span>
      <b>${esc(f.title || '')}</b>
      ${f.page ? `<span class="cl-page">（${esc(f.page)}）</span>` : ''}
      ${f.detail ? `<div class="cl-detail">${n2b(f.detail)}</div>` : ''}
    </li>`).join('');
  const pend = (e.pending || []).map((p) => `
    <li class="cl-pend">
      <span class="cl-id">#${esc(p.id || '')}</span>
      <b>${esc(p.title || '')}</b>
      ${p.note ? `<div class="cl-detail">⏳ ${n2b(p.note)}</div>` : ''}
    </li>`).join('');
  return `
  <section class="cl-entry">
    <h2>${esc(e.date || '')} ${e.version ? `· v${esc(e.version)}` : ''}</h2>
    ${e.release ? `<p class="cl-release">${n2b(e.release)}</p>` : ''}
    ${fixes ? `<h3>✅ 已修复（${(e.fixes || []).length}）</h3><ul>${fixes}</ul>` : ''}
    ${pend ? `<h3>⏳ 待确认 / 暂缓（${(e.pending || []).length}）</h3><ul>${pend}</ul>` : ''}
  </section>`;
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>更新日志 · 5z 规则</title>
<link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
<link rel="stylesheet" href="assets/site.css">
<style>
  body { font-family: system-ui, -apple-system, "Microsoft YaHei", sans-serif; max-width: 860px; margin: 0 auto; padding: 20px 16px 60px; line-height: 1.7; }
  h1 { border-bottom: 2px solid #8882; padding-bottom: 8px; }
  .cl-entry { margin: 26px 0; padding: 14px 18px; border: 1px solid #8882; border-radius: 10px; background: #ffffffcc; }
  .cl-entry h2 { margin: 0 0 6px; font-size: 1.15em; }
  .cl-entry h3 { margin: 12px 0 6px; font-size: 1em; }
  .cl-release { margin: 4px 0 0; color: #666; }
  ul { margin: 6px 0 0; padding-left: 20px; }
  li { margin: 4px 0; }
  .cl-id { color: #888; font-size: .82em; margin-right: 6px; }
  .cl-page { color: #888; font-size: .9em; }
  .cl-detail { color: #555; font-size: .92em; margin: 2px 0 0 14px; }
  .cl-pend { color: #a06800; }
  .back { display: inline-block; margin-top: 18px; color: #236; }
  @media (prefers-color-scheme: dark) {
    body { background: #16181d; color: #ddd; }
    .cl-entry { background: #1e2128; border-color: #ffffff1a; }
    .cl-release, .cl-detail, .cl-id, .cl-page { color: #9aa; }
    .cl-pend { color: #d9a648; }
    .back { color: #7ab; }
  }
</style>
</head>
<body>
<h1>🔧 5z 规则 更新日志</h1>
<p>本页由系统在每次修复发布后自动更新。来源：QQ 群收集表提交的问题。历史修复见下（最新在上）。</p>
<p><a class="back" href="https://docs.qq.com/form/page/DWm5Mb1ZUVU15Y1hX" target="_blank" rel="noopener">📝 发现问题？点这里提交反馈</a>（需 QQ 登录腾讯文档）</p>
${entries.map(renderEntry).join('\n')}
<a class="back" href="index.html">← 返回目录</a>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf8');
console.log(`[changelog] 已生成 ${OUT}（${entries.length} 条记录）`);
