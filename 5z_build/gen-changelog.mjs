// ============================================================
// 更新日志页生成器（反馈状态板版）：由 5z_build/changelog.json 渲染 更新日志.html。
//   顶部为「反馈处理状态一览」：✅ 已修复 / ⏳ 待确认 / 🆕 待处理；
//   下方保留按批次的历史记录。
//
//   本页为可折叠长页（需求：折叠 + 锚点跳转 + 数字真实）。
//   - 状态板三个区块与每个历史批次均为 <details> 可折叠，默认收起；
//   - 顶部「✅ 已修复 / ⏳ 待确认 / 🆕 待处理」徽章是锚点，点击平滑滚动到对应区块并自动展开；
//   - 计数：按 issue id 去重，且“后来已修复”的待确认项不再计入待确认（fix 优先），
//     数字真实反映“当前”的已修复/待确认/待处理。
//
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

// ---------- 汇总：已修复 / 待确认（全历史，按 id 去重，fix 优先） ----------
// 按时间正序遍历，保证“后来修复”能覆盖“先前待确认”：同 id 若存在 fix，只计已修复。
const chron = [...entries].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
const doneItems = [];
const pendItems = [];
const doneIds = new Set();
const seenDone = new Set();
const seenPend = new Set();
for (const e of chron) {
  for (const f of e.fixes || []) {
    if (f.id) doneIds.add(f.id);
    if (!seenDone.has(f.id)) { seenDone.add(f.id); doneItems.push({ ...f, date: e.date, version: e.version }); }
  }
}
for (const e of chron) {
  for (const p of e.pending || []) {
    if (doneIds.has(p.id)) continue; // 后续已修复 -> 不再算待确认
    if (!seenPend.has(p.id)) { seenPend.add(p.id); pendItems.push({ ...p, date: e.date, version: e.version }); }
  }
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

// ---------- 渲染辅助 ----------
const statusRow = (label, count, cls, anchor) =>
  `<a class="st ${cls}" href="#${anchor}" title="跳转到「${label}」区块">${label} <b>${count}</b></a>`;

function renderStatusList(items, emptyText) {
  if (!items.length) return `<p class="st-empty">${emptyText}</p>`;
  return `<ul class="st-list">` + items.map(it => `
    <li>
      <span class="cl-id">#${esc(it.id || '')}</span>
      <b>${esc(it.title || '')}</b>
      ${it.page ? `<span class="cl-page">（${esc(it.page)}）</span>` : ''}
      ${it.date ? `<span class="cl-date">${esc(it.date)}</span>` : ''}
      ${it.ts ? `<span class="cl-date">${esc(String(it.ts).slice(0, 10))}</span>` : ''}
      ${it.note ? `<div class="cl-detail">${n2b(it.note)}</div>` : ''}
      ${it.detail ? `<div class="cl-detail">${n2b(it.detail).slice(0, 200)}${(it.detail || '').length > 200 ? '…' : ''}</div>` : ''}
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
  const nf = (e.fixes || []).length;
  const np = (e.pending || []).length;
  const hint = (nf ? `✅${nf}` : '') + (np ? (nf ? ' / ' : '') + `⏳${np}` : '');
  return `
  <details class="cl-entry">
    <summary><span class="cl-title">${esc(e.date || '')} ${e.version ? `· v${esc(e.version)}` : ''}</span>${hint ? `<span class="cl-batch-hint">${hint}</span>` : ''}</summary>
    ${e.release ? `<p class="cl-release">${n2b(e.release)}</p>` : ''}
    ${fixes ? `<h3>✅ 已修复（${nf}）</h3><ul>${fixes}</ul>` : ''}
    ${pend ? `<h3>⏳ 待确认 / 暂缓（${np}）</h3><ul>${pend}</ul>` : ''}
  </details>`;
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
  /* 页面级折叠控制 */
  .page-ctrl { display: flex; gap: 8px; margin: 14px 0 6px; }
  .page-ctrl button { font: inherit; font-size: .92em; padding: 5px 12px; border: 1px solid #8883; border-radius: 999px; background: #ffffffaa; color: #236; cursor: pointer; }
  .page-ctrl button:hover { border-color: #236; }
  /* 批次记录（可折叠） */
  .cl-entry { margin: 16px 0; padding: 0 18px; border: 1px solid #8882; border-radius: 10px; background: #ffffffcc; }
  .cl-entry summary, .board-sec summary { cursor: pointer; user-select: none; list-style: none; }
  .cl-entry summary::-webkit-details-marker, .board-sec summary::-webkit-details-marker { display: none; }
  .cl-entry summary::before, .board-sec summary::before { content: "▸"; display: inline-block; margin-right: 8px; color: #888; transition: transform .15s; }
  .cl-entry[open] > summary::before, .board-sec[open] > summary::before { transform: rotate(90deg); }
  .cl-entry > summary { padding: 13px 0; font-size: 1.05em; font-weight: 600; }
  .cl-entry[open] > summary { border-bottom: 1px solid #8882; }
  .cl-entry h2 { margin: 0 0 6px; font-size: 1.15em; }
  .cl-entry h3 { margin: 12px 0 6px; font-size: 1em; }
  .cl-title { color: #333; }
  .cl-batch-hint { margin-left: 10px; font-size: .8em; font-weight: 400; color: #888; }
  .cl-release { margin: 8px 0 0; color: #666; }
  ul { margin: 6px 0 0; padding-left: 20px; }
  li { margin: 4px 0; }
  .cl-id { color: #888; font-size: .82em; margin-right: 6px; }
  .cl-page { color: #888; font-size: .9em; }
  .cl-date { color: #999; font-size: .8em; margin-left: 6px; }
  .cl-detail { color: #555; font-size: .92em; margin: 2px 0 0 14px; }
  .cl-pend { color: #a06800; }
  .cl-fix, .cl-pend { padding: 4px 0; }
  .back { display: inline-block; margin-top: 18px; color: #236; }
  /* 状态板 */
  .status-board { border: 1px solid #8882; border-radius: 12px; padding: 14px 18px; margin: 18px 0 8px; background: #ffffffcc; }
  .status-board h2 { margin: 0 0 10px; font-size: 1.1em; }
  .st { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: .9em; margin: 0 6px 6px 0; text-decoration: none; }
  .st b { font-size: 1.05em; }
  .st.done { background: #e5f6e8; color: #166534; }
  .st.pend { background: #fdf3e0; color: #92400e; }
  .st.open { background: #e8f0fd; color: #1e40af; }
  .st:hover { outline: 2px solid currentColor; outline-offset: 1px; }
  .board-sec { border: 1px solid #8882; border-radius: 10px; margin: 8px 0; padding: 0 14px; background: #ffffffcc; }
  .board-sec > summary { padding: 10px 0; font-weight: 700; font-size: .98em; }
  .board-sec[open] > summary { border-bottom: 1px solid #8882; }
  .st-list { margin: 8px 0 14px; padding-left: 20px; }
  .st-list li { margin: 5px 0; }
  .st-empty { color: #888; font-size: .9em; margin: 4px 0 10px; }
  @media (prefers-color-scheme: dark) {
    body { background: #16181d; color: #ddd; }
    .cl-entry, .status-board, .board-sec { background: #1e2128; border-color: #ffffff1a; }
    .cl-release, .cl-detail, .cl-id, .cl-page, .cl-date, .cl-title, .cl-batch-hint { color: #9aa; }
    .cl-pend { color: #d9a648; }
    .page-ctrl button { background: #1e2128; color: #7ab; border-color: #ffffff33; }
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

<div class="page-ctrl">
  <button type="button" data-toggle="open">🪗 全部展开</button>
  <button type="button" data-toggle="close">🫲 全部收起</button>
</div>

<section class="status-board" id="board">
  <h2>📋 反馈处理状态一览</h2>
  <div>${statusRow('✅ 已修复', doneItems.length, 'done', 'board-done')}${statusRow('⏳ 待确认', pendItems.length, 'pend', 'board-pend')}${statusRow('🆕 待处理', allOpen.length, 'open', 'board-open')}</div>

  <details id="board-done" class="board-sec">
    <summary>✅ 已修复（${doneItems.length} 条）</summary>
    ${renderStatusList(doneItems, '暂无已修复反馈。')}
  </details>
  <details id="board-pend" class="board-sec">
    <summary>⏳ 待确认 / 待决策（${pendItems.length} 条）</summary>
    ${renderStatusList(pendItems, '暂无待确认反馈。')}
  </details>
  <details id="board-open" class="board-sec">
    <summary>🆕 待处理（${allOpen.length} 条 · 每 60 分钟自动巡检）</summary>
    ${renderStatusList(allOpen, '当前没有待处理反馈。')}
  </details>
</section>

<h2 style="margin-top:28px;">📜 历史批次记录</h2>
${entries.map(renderEntry).join('\n')}
<a class="back" href="index.html">← 返回目录</a>

<script>
(function () {
  function allDetails() { return Array.prototype.slice.call(document.querySelectorAll('details')); }
  function setAll(open) {
    allDetails().forEach(function (d) {
      if (open) d.setAttribute('open', '');
      else d.removeAttribute('open');
    });
  }
  document.querySelectorAll('.page-ctrl button').forEach(function (btn) {
    btn.addEventListener('click', function () { setAll(btn.getAttribute('data-toggle') === 'open'); });
  });
  // 徽章 / 任意 #锚点：平滑滚动到目标区并自动展开
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (ev) {
      var id = a.getAttribute('href').slice(1);
      var t = document.getElementById(id);
      if (!t) return;
      ev.preventDefault();
      if (!t.hasAttribute('open')) t.setAttribute('open', '');
      var y = t.getBoundingClientRect().top + (window.scrollY || window.pageYOffset) - 14;
      window.scrollTo({ top: y, behavior: 'smooth' });
    });
  });
})();
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf8');
console.log(`[changelog] 已生成 ${OUT}（fixes ${doneItems.length} / pending ${pendItems.length} / open ${allOpen.length}）`);
