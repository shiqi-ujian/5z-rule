/* 5z 词典前端：法术 / 战技 / 程序 / 魔法物品 浏览、搜索、筛选、详情 */
(function () {
'use strict';
const DATA = window.__CAR_DATA__;
if (!DATA || !DATA.spells) {
  document.getElementById('list').innerHTML = '<p style="padding:16px">数据未加载（请确认 card-data.js 存在，或从主页入口进入）。</p>';
  return;
}
const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

const LEVELS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const LEVEL_LABEL = { 0: '戏法', 10: '传奇' };
const lvLabel = (l) => LEVEL_LABEL[l] || l + ' 环';
const SCHOOLS = [...new Set(DATA.spells.map(s => s.school).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const CLASS_OBJS = DATA['class-spells'].filter(cs => Object.keys(cs.lists || {}).length);
const CLASSES = CLASS_OBJS.map(cs => cs.class);
// 法术名 → 可用职业（由职业法表反查；非职业法术页的"职业：xxx"行并入）
const SPELL_JOBS = {};
for (const cs of DATA['class-spells']) {
  for (const list of Object.values(cs.lists || {})) {
    for (const n of list) {
      const arr = SPELL_JOBS[n] || (SPELL_JOBS[n] = []);
      if (!arr.includes(cs.class)) arr.push(cs.class);
      if (cs.jobs && cs.jobs[n]) {
        for (const j of cs.jobs[n]) if (!arr.includes(j)) arr.push(j);
      }
    }
  }
}
const STYLES = [...new Set(DATA.maneuvers.map(m => m.style))].sort((a, b) => a.localeCompare(b));
const MLEVELS = [...new Set(DATA.maneuvers.map(m => m.level))].sort((a, b) => a.localeCompare(b));
const MTYPES = [...new Set(DATA.maneuvers.map(m => m.type))].sort((a, b) => a.localeCompare(b));
const PROTOCOLS = ['阿尔法', '贝塔', '伽马', '德尔塔', '伊普西隆', '泽塔', '欧米伽'];
const MODULES = [...new Set(DATA.programs.map(p => p.module).filter(Boolean))].sort((a, b) => a.localeCompare(b));
// 魔法物品：预计算搜索串；分类顺序按规则书章节（固定序，未知分类兜底按拼音）
const MI = DATA.magicItems || [];
const MI_SUB_ORDER = ['卷轴', '魔药',
  '武器（近战）', '武器（远程）', '武器（通用）',
  '盔甲（轻甲）', '盔甲（中甲）', '盔甲（重甲）', '盔甲（通用）', '盾牌',
  '法器（乐器）', '法器（书本）', '法器（圣徽）', '法器（法杖）', '法器（法球）', '法器（魔杖）',
  '法器（碎晶）', '法器（职业基础）', '法器（未分类）',
  '服饰（基础）', '服饰（帽子）', '服饰（头饰）', '服饰（戒指）', '服饰（手套）', '服饰（护符）',
  '服饰（护腿）', '服饰（斗篷）', '服饰（腰带）', '服饰（外套）', '服饰（鞋子）',
  '奇物（书本）', '奇物（交通用品）', '奇物（刺青）', '奇物（召唤媒介）', '奇物（宝石）',
  '奇物（容器）', '奇物（拘束用品）', '奇物（旗帜）', '奇物（替身DISC）', '奇物（火器）',
  '奇物（照明用品）', '奇物（电器）', '奇物（移植体）', '奇物（未分类）', '套装'];
const MI_SUBS = [...new Set(MI.map(i => i.sub))]
  .sort((a, b) => {
    const ia = MI_SUB_ORDER.indexOf(a), ib = MI_SUB_ORDER.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
  });
MI.forEach(i => {
  i.hay = [i.name, i.en || '', i.attr || '', i.text || '', (i.tables || []).map(t => t.flat().join(' ')).join(' ')]
    .join(' ').toLowerCase();
});

const state = {
  tab: 'spells',
  spell: { kw: '', level: '', school: '', cls: '', ritual: '', focus: '', page: 1, sel: null },
  mv: { kw: '', style: '', level: '', type: '', sel: null },
  pg: { kw: '', protocol: '', module: '', focus: '', sel: null },
  mi: { kw: '', sub: '', attune: '', artifact: '', page: 1, sel: null },
};
const PAGE_SIZE = 100;

/* ---------- 法术 Tab ---------- */
function spellFiltered() {
  const f = state.spell;
  const kw = f.kw.trim();
  return DATA.spells.filter(s => {
    if (f.level && String(s.level) !== f.level) return false;
    if (f.school && s.school !== f.school) return false;
    if (f.cls && !(SPELL_JOBS[s.name] || []).includes(f.cls)) return false;
    if (f.ritual === '1' && !s.ritual) return false;
    if (f.ritual === '0' && s.ritual) return false;
    if (f.focus === '1' && !s.focus) return false;
    if (f.focus === '0' && s.focus) return false;
    if (kw && !(s.name.includes(kw) || s.text.includes(kw))) return false;
    return true;
  });
}
function renderSpellList(scrollTop) {
  const f = state.spell;
  const all = spellFiltered();
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  if (f.page > pages) f.page = pages;
  const slice = all.slice((f.page - 1) * PAGE_SIZE, f.page * PAGE_SIZE);
  const list = $('#list');
  list.innerHTML = '';
  for (const s of slice) {
    const brief = s.text.split('\n').slice(1).join(' ').slice(0, 60);
    const item = el('button', 'ditem' + (f.sel === s.name ? ' sel' : ''));
    item.type = 'button';
    item.innerHTML = `<div class="di-name">${esc(s.name)}${s.ritual ? ' <span class="tag-ritual">仪式</span>' : ''}${s.focus ? ' <span class="tag-focus">专注</span>' : ''}</div>
      <div class="di-sub">${lvLabel(s.level)} · ${esc(s.school || '未知学派')}</div>
      ${brief ? `<div class="di-brief">${esc(brief)}</div>` : ''}`;
    item.onclick = () => { f.sel = s.name; renderSpellList(); renderSpellDetail(s); };
    list.appendChild(item);
  }
  if (!slice.length) list.innerHTML = '<p style="padding:16px;color:var(--sub)">没有匹配的法术。</p>';
  // 翻页/筛选后回到列表顶部（选中条目时传入空值，不打断浏览位置）
  if (scrollTop) {
    list.scrollTop = 0;
    if (window.innerWidth <= 860) list.scrollIntoView({ block: 'start' });
  }
  const count = $('#spell-count');
  if (count) count.innerHTML = `共 <b>${all.length}</b> 个`;
  const pager = $('#pager');
  if (pages > 1) {
    pager.hidden = false;
    pager.innerHTML = `<button type="button" id="pg-prev" ${f.page <= 1 ? 'disabled' : ''}>← 上一页</button>
      <span class="pg-info">${f.page} / ${pages}</span>
      <button type="button" id="pg-next" ${f.page >= pages ? 'disabled' : ''}>下一页 →</button>`;
    $('#pg-prev').onclick = () => { f.page--; renderSpellList(true); };
    $('#pg-next').onclick = () => { f.page++; renderSpellList(true); };
  } else {
    pager.hidden = true;
  }
}
function renderSpellDetail(s) {
  const d = $('#detail');
  const jobs = (SPELL_JOBS[s.name] || []).slice();
  const fields = [
    ['环阶', lvLabel(s.level)], ['学派', s.school || '—'],
    ['仪式', s.ritual ? '是（可作为仪式施展）' : '否'],
    ['施法时间', s.castTime || '—'], ['施法距离', s.range || '—'],
    ['法术目标', s.target || '—'], ['法术成分', s.components || '—'],
    ['持续时间', s.duration || '—'], ['需要专注', s.focus ? '是' : '否'],
  ];
  d.innerHTML = `<h2 class="dd-name">${esc(s.name)}</h2>
    <div class="dd-sub">${lvLabel(s.level)} · ${esc(s.school || '未知学派')}</div>
    <div class="dd-fields">${fields.map(([k, v]) =>
      `<div class="f"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`).join('')}</div>
    <div class="dd-text">${esc(s.text)}</div>
    ${jobs.length ? `<div class="dd-jobs">可用职业：<b>${jobs.map(esc).join('、')}</b></div>` : ''}
    <a class="dd-link" href="${esc(s.url)}" target="_blank">📖 规则书原文 →</a>`;
}
function spellToolbar() {
  const f = state.spell;
  const tb = $('#toolbar');
  tb.innerHTML = `<input type="search" id="sp-kw" placeholder="搜索法术名或描述…" value="${esc(f.kw)}">
    <select id="sp-level"><option value="">全环位</option>
      ${LEVELS.map(l => `<option value="${l}"${f.level === l ? ' selected' : ''}>${lvLabel(l)}</option>`).join('')}</select>
    <select id="sp-school"><option value="">全学派</option>
      ${SCHOOLS.map(s => `<option value="${esc(s)}"${f.school === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
    <select id="sp-cls"><option value="">全部职业</option>
      ${CLASSES.map(c => `<option value="${esc(c)}"${f.cls === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <select id="sp-ritual"><option value="">仪式：全部</option>
      <option value="1"${f.ritual === '1' ? ' selected' : ''}>仅仪式法术</option>
      <option value="0"${f.ritual === '0' ? ' selected' : ''}>仅非仪式</option></select>
    <select id="sp-focus"><option value="">专注：全部</option>
      <option value="1"${f.focus === '1' ? ' selected' : ''}>需要专注</option>
      <option value="0"${f.focus === '0' ? ' selected' : ''}>不需专注</option></select>
    <span class="count" id="spell-count"></span>`;
  const onInput = () => { f.kw = $('#sp-kw').value; f.page = 1; renderSpellList(true); };
  $('#sp-kw').addEventListener('input', onInput);
  $('#sp-level').addEventListener('change', (e) => { f.level = e.target.value; f.page = 1; renderSpellList(true); });
  $('#sp-school').addEventListener('change', (e) => { f.school = e.target.value; f.page = 1; renderSpellList(true); });
  $('#sp-cls').addEventListener('change', (e) => { f.cls = e.target.value; f.page = 1; renderSpellList(true); });
  $('#sp-ritual').addEventListener('change', (e) => { f.ritual = e.target.value; f.page = 1; renderSpellList(true); });
  $('#sp-focus').addEventListener('change', (e) => { f.focus = e.target.value; f.page = 1; renderSpellList(true); });
  renderSpellList(true);
  // 恢复上次选中的详情
  if (f.sel) {
    const s = DATA.spells.find(x => x.name === f.sel);
    if (s) renderSpellDetail(s);
  } else if (DATA.spells.length) {
    renderSpellDetail(DATA.spells[0]);
  }
}

/* ---------- 战技 Tab ---------- */
function mvFiltered() {
  const f = state.mv;
  const kw = f.kw.trim();
  return DATA.maneuvers.filter(m => {
    if (f.style && m.style !== f.style) return false;
    if (f.level && m.level !== f.level) return false;
    if (f.type && m.type !== f.type) return false;
    if (kw && !(m.name.includes(kw) || (m.text || '').includes(kw))) return false;
    return true;
  });
}
function renderMvList() {
  const f = state.mv;
  const all = mvFiltered();
  const list = $('#list');
  list.innerHTML = '';
  for (const m of all) {
    const item = el('button', 'ditem' + (f.sel === m.name ? ' sel' : ''));
    item.type = 'button';
    item.innerHTML = `<div class="di-name">${esc(m.name)}</div>
      <div class="di-sub">${esc(m.style)} · ${esc(m.level)} · ${esc(m.type)}</div>`;
    item.onclick = () => { f.sel = m.name; renderMvList(); renderMvDetail(m); };
    list.appendChild(item);
  }
  if (!all.length) list.innerHTML = '<p style="padding:16px;color:var(--sub)">没有匹配的战技。</p>';
  const count = $('#mv-count');
  if (count) count.innerHTML = `共 <b>${all.length}</b> 个`;
  $('#pager').hidden = true;
}
function renderMvDetail(m) {
  const d = $('#detail');
  d.innerHTML = `<h2 class="dd-name">${esc(m.name)}</h2>
    <div class="dd-sub">${esc(m.style)} · ${esc(m.level)} · ${esc(m.type)}</div>
    ${m.text ? `<div class="dd-text">${esc(m.text)}</div>` : '<p class="muted">规则书未收录该战技的独立详述。</p>'}
    <a class="dd-link" href="${esc(m.url)}" target="_blank">📖 规则书原文（${esc(m.style)}）→</a>`;
}
function mvToolbar() {
  const f = state.mv;
  const tb = $('#toolbar');
  tb.innerHTML = `<input type="search" id="mv-kw" placeholder="搜索战技名或描述…" value="${esc(f.kw)}">
    <select id="mv-style"><option value="">全流派</option>
      ${STYLES.map(s => `<option value="${s}"${f.style === s ? ' selected' : ''}>${s}</option>`).join('')}</select>
    <select id="mv-level"><option value="">全级别</option>
      ${MLEVELS.map(l => `<option value="${l}"${f.level === l ? ' selected' : ''}>${l}</option>`).join('')}</select>
    <select id="mv-type"><option value="">全类型</option>
      ${MTYPES.map(t => `<option value="${t}"${f.type === t ? ' selected' : ''}>${t}</option>`).join('')}</select>
    <span class="count" id="mv-count"></span>`;
  $('#mv-kw').addEventListener('input', (e) => { f.kw = e.target.value; renderMvList(); });
  $('#mv-style').addEventListener('change', (e) => { f.style = e.target.value; renderMvList(); });
  $('#mv-level').addEventListener('change', (e) => { f.level = e.target.value; renderMvList(); });
  $('#mv-type').addEventListener('change', (e) => { f.type = e.target.value; renderMvList(); });
  renderMvList();
  if (f.sel) {
    const m = DATA.maneuvers.find(x => x.name === f.sel);
    if (m) renderMvDetail(m);
  } else if (DATA.maneuvers.length) {
    renderMvDetail(DATA.maneuvers[0]);
  }
}

/* ---------- 程序 Tab ---------- */
function pgFiltered() {
  const f = state.pg;
  const kw = f.kw.trim();
  return DATA.programs.filter(p => {
    if (f.protocol && p.protocol !== f.protocol) return false;
    if (f.module && p.module !== f.module) return false;
    if (f.focus === '1' && !p.focus) return false;
    if (f.focus === '0' && p.focus) return false;
    if (kw && !(p.name.includes(kw) || (p.text || '').includes(kw))) return false;
    return true;
  });
}
function renderPgList() {
  const f = state.pg;
  const all = pgFiltered();
  const list = $('#list');
  list.innerHTML = '';
  for (const p of all) {
    const item = el('button', 'ditem' + (f.sel === p.name ? ' sel' : ''));
    item.type = 'button';
    item.innerHTML = `<div class="di-name">${esc(p.name)}${p.focus ? ' <span class="tag-focus">专注</span>' : ''}</div>
      <div class="di-sub">${esc(p.protocol)} · ${esc(p.module || '无模块')} · ${esc(p.act || '')}</div>
      ${p.text ? `<div class="di-brief">${esc(p.text.slice(0, 60))}</div>` : ''}`;
    item.onclick = () => { f.sel = p.name; renderPgList(); renderPgDetail(p); };
    list.appendChild(item);
  }
  if (!all.length) list.innerHTML = '<p style="padding:16px;color:var(--sub)">没有匹配的程序。</p>';
  const count = $('#pg-count');
  if (count) count.innerHTML = `共 <b>${all.length}</b> 个`;
  $('#pager').hidden = true;
}
function renderPgDetail(p) {
  const d = $('#detail');
  d.innerHTML = `<h2 class="dd-name">${esc(p.name)}</h2>
    <div class="dd-sub">${esc(p.protocol)}协议</div>
    <div class="dd-fields">
      <div class="f"><span class="k">所需模块</span><span class="v">${esc(p.module || '无')}</span></div>
      <div class="f"><span class="k">激活时间</span><span class="v">${esc(p.act || '—')}</span></div>
      <div class="f"><span class="k">需要专注</span><span class="v">${p.focus ? '是' : '否'}</span></div>
    </div>
    ${p.text ? `<div class="dd-text">${esc(p.text)}</div>` : ''}
    <a class="dd-link" href="${esc(p.url)}" target="_blank">📖 规则书原文（${esc(p.protocol)}协议）→</a>`;
}
function pgToolbar() {
  const f = state.pg;
  const tb = $('#toolbar');
  tb.innerHTML = `<input type="search" id="pg-kw" placeholder="搜索程序名或效果…" value="${esc(f.kw)}">
    <select id="pg-protocol"><option value="">全协议层级</option>
      ${PROTOCOLS.map(p => `<option value="${p}"${f.protocol === p ? ' selected' : ''}>${p}</option>`).join('')}</select>
    <select id="pg-module"><option value="">全模块</option>
      ${MODULES.map(m => `<option value="${esc(m)}"${f.module === m ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select>
    <select id="pg-focus"><option value="">专注：全部</option>
      <option value="1"${f.focus === '1' ? ' selected' : ''}>需要专注</option>
      <option value="0"${f.focus === '0' ? ' selected' : ''}>不需专注</option></select>
    <span class="count" id="pg-count"></span>`;
  $('#pg-kw').addEventListener('input', (e) => { f.kw = e.target.value; renderPgList(); });
  $('#pg-protocol').addEventListener('change', (e) => { f.protocol = e.target.value; renderPgList(); });
  $('#pg-module').addEventListener('change', (e) => { f.module = e.target.value; renderPgList(); });
  $('#pg-focus').addEventListener('change', (e) => { f.focus = e.target.value; renderPgList(); });
  renderPgList();
  if (f.sel) {
    const p = DATA.programs.find(x => x.name === f.sel);
    if (p) renderPgDetail(p);
  } else if (DATA.programs.length) {
    renderPgDetail(DATA.programs[0]);
  }
}

/* ---------- 魔法物品 Tab ---------- */
function miFiltered() {
  const f = state.mi;
  const kw = f.kw.trim().toLowerCase();
  return MI.filter(i => {
    if (f.sub && i.sub !== f.sub) return false;
    if (f.attune === '1' && !i.attune) return false;
    if (f.attune === '0' && i.attune) return false;
    if (f.artifact === '1' && !i.artifact) return false;
    if (f.artifact === '0' && i.artifact) return false;
    if (kw && !i.hay.includes(kw)) return false;
    return true;
  });
}
function renderMiTables(rowsArr) {
  return (rowsArr || []).map(rows => {
    if (!rows || !rows.length) return '';
    const hasHead = rows.length > 1 && rows[0].some(Boolean);
    const thead = hasHead
      ? `<thead><tr>${rows[0].map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>` : '';
    const dataRows = hasHead ? rows.slice(1) : rows;
    const tbody = `<tbody>${dataRows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
    return `<div class="dd-table"><table>${thead}${tbody}</table></div>`;
  }).join('');
}
function renderMiList(scrollTop) {
  const f = state.mi;
  const all = miFiltered();
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  if (f.page > pages) f.page = pages;
  const slice = all.slice((f.page - 1) * PAGE_SIZE, f.page * PAGE_SIZE);
  const list = $('#list');
  list.innerHTML = '';
  for (const i of slice) {
    const brief = (i.text || '').split('\n')[0].slice(0, 60);
    const item = el('button', 'ditem' + (f.sel === i.id ? ' sel' : ''));
    item.type = 'button';
    item.innerHTML = `<div class="di-name">${esc(i.name)}${i.artifact ? ' <span class="tag-artifact">神器</span>' : ''}${i.attune ? ' <span class="tag-attune">同调</span>' : ''}</div>
      <div class="di-sub">${esc(i.sub)} · ${esc(i.attr || '未收录类型行')}</div>
      ${brief ? `<div class="di-brief">${esc(brief)}</div>` : ''}`;
    item.onclick = () => { f.sel = i.id; renderMiList(); renderMiDetail(i); };
    list.appendChild(item);
  }
  if (!slice.length) list.innerHTML = '<p style="padding:16px;color:var(--sub)">没有匹配的魔法物品。</p>';
  if (scrollTop) {
    list.scrollTop = 0;
    if (window.innerWidth <= 860) list.scrollIntoView({ block: 'start' });
  }
  const count = $('#mi-count');
  if (count) count.innerHTML = `共 <b>${all.length}</b> 个`;
  const pager = $('#pager');
  if (pages > 1) {
    pager.hidden = false;
    pager.innerHTML = `<button type="button" id="pg-prev" ${f.page <= 1 ? 'disabled' : ''}>← 上一页</button>
      <span class="pg-info">${f.page} / ${pages}</span>
      <button type="button" id="pg-next" ${f.page >= pages ? 'disabled' : ''}>下一页 →</button>`;
    $('#pg-prev').onclick = () => { f.page--; renderMiList(true); };
    $('#pg-next').onclick = () => { f.page++; renderMiList(true); };
  } else {
    pager.hidden = true;
  }
}
function renderMiDetail(i) {
  const d = $('#detail');
  const fields = [
    ['分类', i.sub], ['类型行', i.attr || '—'],
    ['同调', i.attune ? (i.attuneText || '需同调') : '否'],
    ['价格', i.price || (i.attr && /价格见下?表/.test(i.attr) ? '价格见下表' : '—')],
  ];
  d.innerHTML = `<h2 class="dd-name">${esc(i.name)}${i.artifact ? ' <span class="tag-artifact">神器</span>' : ''}</h2>
    <div class="dd-sub">${esc(i.sub)}${i.en ? ` · ${esc(i.en)}` : ''}</div>
    <div class="dd-fields">${fields.map(([k, v]) =>
      `<div class="f"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`).join('')}</div>
    ${renderMiTables(i.tables)}
    ${i.text ? `<div class="dd-text">${esc(i.text)}</div>` : '<p class="muted">规则书未收录该物品的独立详述。</p>'}
    <a class="dd-link" href="${esc(i.url)}" target="_blank">📖 规则书原文（${esc(i.sub)}）→</a>`;
}
function miToolbar() {
  const f = state.mi;
  const tb = $('#toolbar');
  tb.innerHTML = `<input type="search" id="mi-kw" placeholder="搜索物品名、类型、效果…" value="${esc(f.kw)}">
    <select id="mi-sub"><option value="">全分类</option>
      ${MI_SUBS.map(s => `<option value="${esc(s)}"${f.sub === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
    <select id="mi-attune"><option value="">同调：全部</option>
      <option value="1"${f.attune === '1' ? ' selected' : ''}>需同调</option>
      <option value="0"${f.attune === '0' ? ' selected' : ''}>不需同调</option></select>
    <select id="mi-artifact"><option value="">神器：全部</option>
      <option value="1"${f.artifact === '1' ? ' selected' : ''}>仅神器</option>
      <option value="0"${f.artifact === '0' ? ' selected' : ''}>非神器</option></select>
    <span class="count" id="mi-count"></span>`;
  const onInput = () => { f.kw = $('#mi-kw').value; f.page = 1; renderMiList(true); };
  $('#mi-kw').addEventListener('input', onInput);
  $('#mi-sub').addEventListener('change', (e) => { f.sub = e.target.value; f.page = 1; renderMiList(true); });
  $('#mi-attune').addEventListener('change', (e) => { f.attune = e.target.value; f.page = 1; renderMiList(true); });
  $('#mi-artifact').addEventListener('change', (e) => { f.artifact = e.target.value; f.page = 1; renderMiList(true); });
  renderMiList(true);
  if (f.sel) {
    const i = MI.find(x => x.id === f.sel);
    if (i) renderMiDetail(i);
  } else if (MI.length) {
    renderMiDetail(MI[0]);
  }
}

/* ---------- Tab 切换 ---------- */
function switchTab(tab) {
  state.tab = tab;
  $$('.tab').forEach(b => b.classList.toggle('sel', b.dataset.tab === tab));
  const tb = $('#toolbar');
  tb.innerHTML = '';
  $('#detail').innerHTML = '<p class="muted" style="padding:8px">选择左侧条目查看详情。</p>';
  $('#pager').hidden = true;
  if (tab === 'spells') spellToolbar();
  else if (tab === 'maneuvers') mvToolbar();
  else if (tab === 'programs') pgToolbar();
  else if (tab === 'magic-items') miToolbar();
  else pgToolbar();
}

/* ---------- 启动 ---------- */
document.getElementById('ver').textContent = 'v' + (DATA.rules ? DATA.rules.version : '') + ' · 规则书数据';
$$('#tabs .tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
switchTab('spells');
})();
