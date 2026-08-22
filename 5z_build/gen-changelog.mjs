// ============================================================
// 更新日志页生成器（反馈状态板版）：由 5z_build/changelog.json 渲染 更新日志.html。
//   顶部为「反馈处理状态一览」：✅ 已修复 / ⏳ 待确认 / 🆕 待处理（实时读 问题收集/inbox/）；
//   下方保留按批次的历史记录。
//   默认输出到 5z_web（构建暂存区），由 sync-web 同步到仓库根目录发布源；
//   build.mjs 每次构建会自动调用本脚本。也可手动指定输出目录：
//   node 5z_build/gen-changelog.mjs [输出目录]
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, '5z_build', 'changelog.json');
const INBOX = path.join(ROOT, '问题收集', 'inbox');
const OUT_DIR = path.resolve(process.argv[2] || path.join(ROOT, '5z_web'));
fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT = path.join(OUT_DIR, '更新日志.html');

const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const entries = [...(data.entries || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n2b = (s) => esc(s).replace(/\n/g, '<br>');

// ---------- 汇总：已修复 / 待确认（全历史） ----------
const allFixes = [];
const allPending = [];
for (const e of entries) {
  for (const f of e.fixes || []) allFixes.push({ ...f, date: e.date, version: e.version });
  for (const p of e.pending || []) allPending.push({ ...p, date: e.date, version: e.version });
}

// ---------- 待处理：实时读 问题收集/inbox/ ----------
const allOpen = [];
try {
  if (fs.existsSync(INBOX)) {
    for (const f of fs.readdirSync(INBOX)) {
      if (!/\.json$/i.test(f)) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(INBOX, f), 'utf8'));
        allOpen.push({ id: j.id || f.replace(/\.json$/, ''), title: j.title || (j.description || '').slice(0, 40) || f, page: j.page || '', ts: j.ts || '' });
      } catch (_) { /* 忽略损坏 */ }
    }
  }
} catch (_) { /* inbox 不存在则视为空 */ }

const statusRow = (label, count, cls) => `<span class="st ${cls}">${label} <b>${count}</b></span>`;

function renderStatusList(items, cls, emptyText) {
  if (!items.length) return `<p class="st-empty">${emptyText}</p>`;
  return `<ul class="st-list">` + items.map(it => `
    <li>
      <span class="cl-id">#${esc(it.id || '')}</span>
      <b>${esc(it.title || '')}</b>
      ${it.page ? `<span class="cl-page">（${esc(it.page)}）</span>` : ''}
      ${it.date ? `<span class="cl-date">${esc(it.date)}</span>` : ''}
      ${it.ts ? `<span class="cl-date">${esc(String(it.ts).slice(0, 10))}</span>` : ''}
      ${it.note ? `<div class="cl-detail">${n2b(it.note)}</div>` : ''}
      ${it.detail ? `<div class="cl-detail">${n2b(it.detail).slice(0, 200)}${it.detail.length > 200 ? '…' : ''}</div>` : ''}
    </li>`).join('') + `</ul>`;
}

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
  .cl-date { color: #999; font-size: .8em; margin-left: 6px; }
  .cl-detail { color: #555; font-size: .92em; margin: 2px 0 0 14px; }
  .cl-pend { color: #a06800; }
  .back { display: inline-block; margin-top: 18px; color: #236; }
  /* 状态板 */
  .status-board { border: 1px solid #8882; border-radius: 12px; padding: 14px 18px; margin: 18px 0 8px; background: #ffffffcc; }
  .status-board h2 { margin: 0 0 10px; font-size: 1.1em; }
  .st { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: .9em; margin-right: 6px; }
  .st b { font-size: 1.05em; }
  .st.done { background: #e5f6e8; color: #166534; }
  .st.pend { background: #fdf3e0; color: #92400e; }
  .st.open { background: #e8f0fd; color: #1e40af; }
  .st-list { margin: 8px 0 14px; padding-left: 20px; }
  .st-list li { margin: 5px 0; }
  .st-empty { color: #888; font-size: .9em; margin: 4px 0 10px; }
  .board-title { font-weight: 700; margin: 10px 0 2px; font-size: .98em; }
  @media (prefers-color-scheme: dark) {
    body { background: #16181d; color: #ddd; }
    .cl-entry, .status-board { background: #1e2128; border-color: #ffffff1a; }
    .cl-release, .cl-detail, .cl-id, .cl-page, .cl-date { color: #9aa; }
    .cl-pend { color: #d9a648; }
    .back { color: #7ab; }
    .st.done { background: #12301c; color: #86efac; }
    .st.pend { background: #33250d; color: #fbbf24; }
    .st.open { background: #12233f; color: #93c5fd; }
    .st-empty { color: #777; }
  }
</style>
</head>
<body>
<h1>🔧 5z 规则 更新日志</h1>
<p>本页由系统在每次修复发布后自动更新。来源：QQ 群收集表提交的问题。顶部为全部反馈的处理状态一览，下方为历史批次记录（最新在上）。</p>
<p><a class="back" href="https://docs.qq.com/form/page/DWm5Mb1ZUVU15Y1hX" target="_blank" rel="noopener">📝 发现问题？点这里提交反馈</a>（需 QQ 登录腾讯文档）</p>

<div class="status-board">
  <h2>📋 反馈处理状态一览</h2>
  <div>${statusRow('✅ 已修复', allFixes.length, 'done')}${statusRow('⏳ 待确认', allPending.length, 'pend')}${statusRow('🆕 待处理', allOpen.length, 'open')}</div>
  <div class="board-title">✅ 已修复（${allFixes.length} 条）</div>
  ${renderStatusList(allFixes, 'done', '暂无已修复反馈。')}
  <div class="board-title">⏳ 待确认 / 待决策（${allPending.length} 条）</div>
  ${renderStatusList(allPending, 'pend', '暂无待确认反馈。')}
  <div class="board-title">🆕 待处理（${allOpen.length} 条 · 每 60 分钟自动巡检）</div>
  ${renderStatusList(allOpen, 'open', '当前没有待处理反馈。')}
</div>

${entries.map(renderEntry).join('\n')}
<a class="back" href="index.html">← 返回目录</a>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf8');
console.log(`[changelog] 已生成 ${OUT}（fixes ${allFixes.length} / pending ${allPending.length} / open ${allOpen.length}）`);
