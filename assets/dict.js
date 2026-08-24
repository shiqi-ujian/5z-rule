/* 5z 词典前端：法术 / 战技 / 程序 / 魔法物品 浏览、搜索、筛选、详情
 * 列表/筛选/分页/详情由公共组件 Picker（assets/picker.js）提供，本文件只做 Tab 配置。
 */
(function () {
'use strict';
const DATA = window.__CAR_DATA__;
if (!DATA || !DATA.spells) {
  document.getElementById('list').innerHTML = '<p style="padding:16px">数据未加载（请确认 card-data.js 存在，或从主页入口进入）。</p>';
  return;
}
const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
const esc = Picker.esc;
const el = Picker.el;

/* ---------- 数据预计算（与之前一致） ---------- */
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
  '服饰（护腿）', '服饰（斗篷）', '服饰（腰带）', '服饰（外套）', '服饰（长袍）',
  '奇物（书本）', '奇物（交通用品）', '奇物（刺青）', '奇物（召唤媒介）', '奇物（宝石）',
  '奇物（容器）', '奇物（拘束用品）', '奇物（旗帜）', '奇物（替身DISC）', '奇物（火器）',
  '奇物（照明用品）', '奇物（电器）', '奇物（移植体）', '奇物（未分类）', '套装'];
const MI_SUBS = [...new Set(MI.map(i => i.sub))]
  .sort((a, b) => {
    const ia = MI_SUB_ORDER.indexOf(a), ib = MI_SUB_ORDER.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
  });
// 顶级分类（可折叠分组用）：取「（」前的部分，无括号（卷轴/魔药/套装/盾牌）用自身。
const MI_TOP = (sub) => { const i = sub.indexOf('（'); return i >= 0 ? sub.slice(0, i) : sub; };
// 顶级分组顺序（已知的按规则书次序，未出现的按拼音兜底）：
const MI_TOP_ORDER = ['武器', '盔甲', '盾牌', '法器', '服饰', '奇物', '卷轴', '魔药', '套装'];
const MI_ALL_TOPS = [...new Set(MI_SUBS.map(MI_TOP))];
for (const t of MI_ALL_TOPS) if (!MI_TOP_ORDER.includes(t)) MI_TOP_ORDER.push(t);
// 每顶级分组的物品数（用于按钮上显示"共 N 件"）
const MI_GROUP_ITEM_CT = {};
for (const i of MI) { const t = MI_TOP(i.sub); MI_GROUP_ITEM_CT[t] = (MI_GROUP_ITEM_CT[t] || 0) + 1; }
const MI_GROUPS = MI_TOP_ORDER
  .filter(t => MI_ALL_TOPS.includes(t))
  .map(t => ({ label: t, items: MI_SUBS.filter(s => MI_TOP(s) === t), count: MI_GROUP_ITEM_CT[t] || 0 }));
// 价格分级：按价格区间（pmin–pmax）有交集即命中（一件物品可能跨多个档位）
const MI_TIERS = [
  { k: '0', label: '≤100gp', lo: 0, hi: 100 },
  { k: '1', label: '101–500gp', lo: 101, hi: 500 },
  { k: '2', label: '501–2000gp', lo: 501, hi: 2000 },
  { k: '3', label: '2001–1万gp', lo: 2001, hi: 10000 },
  { k: '4', label: '1万–5万gp', lo: 10001, hi: 50000 },
  { k: '5', label: '>5万gp', lo: 50001, hi: Infinity },
];
MI.forEach(i => {
  i.hay = [i.name, i.en || '', i.attr || '', i.text || '', (i.tables || []).map(t => t.flat().join(' ')).join(' ')]
    .join(' ').toLowerCase();
  const lo = i.pmin, hi = i.pmax == null ? Infinity : i.pmax;
  i.tiers = [];
  if (!i.nonsell && lo != null) {
    for (const t of MI_TIERS) if (lo <= t.hi && hi >= t.lo) i.tiers.push(t.k);
  }
  i.span = i.nonsell ? '非卖品'
    : lo == null ? ''
    : i.pmax == null ? `≥${lo}gp`
    : lo === i.pmax ? `${lo}gp`
    : `${lo}–${i.pmax}gp`;
});
// 列表默认按分类（固定序）排序，同分类内按名称排序，便于分组浏览。
MI.sort((a, b) => {
  const ia = MI_SUBS.indexOf(a.sub), ib = MI_SUBS.indexOf(b.sub);
  return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.name.localeCompare(b.name);
});

/* ---------- 魔法物品字段提炼 ----------
 * attr（类型行）实为「[神器], 具体类型(如 武器（标枪）/弹药（箭）/法器（法杖）)，[需XX同调]，价格」揉成一条：
 *   - 具体类型是 sub 之外的细分，值得单列「类型」；
 *   - 「需XX同调」与 attuneText 重复，交给「同调」字段；
 *   - 「价格」交给「价格」字段。
 * 据此把冗长 attr 收敛为三个一眼可读的字段。 */
function miType(i) {
  const parts = (i.attr || '').split(/[，,]/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return i.sub || '';
  const tp = [];
  for (const p of parts) {
    if (/^需.*同调$/.test(p)) break;            // 同调子句 -> 停止
    if (/^价格/.test(p)) break;                 // 价格/价格见下表/价格与其…相同 -> 停止
    if (/^\d+(?:[.,]\d+)?gp$/i.test(p) || /^至少\d+gp$/i.test(p) || /^非卖品$/i.test(p)) break; // 价格 -> 停止
    if (/^神器$/.test(p)) continue;             // 神器标记 -> 跳过（神器由角标显示）
    tp.push(p);
  }
  return tp.join('').replace(/[，,]$/, '') || i.sub || '';
}
// 价格字符串去掉前置同调子句（"需XX同调，"），同调已由独立字段显示，避免重复
function miStripAttune(s) { return String(s || '').replace(/^需[^，,，]*同调[，,]?\s*/, '').trim(); }
function miPrice(i) {
  if (i.nonsell) return '非卖品';
  const p = miStripAttune(i.price);
  if (p && !/^价格见/.test(p)) return p;
  if (i.span) return i.span;                    // 数字区间（如 20–24000gp），比"见下表"更具体
  if (i.tables && i.tables.length) return '见下方价格表';
  return '—';
}
// 列表副标题用的价格（比详情更简短；无价格时留空）
function miListPrice(i) {
  if (i.nonsell) return '非卖品';
  if (i.span) return i.span;
  const p = miStripAttune(i.price);
  if (p && !/^价格见/.test(p)) return p;
  return '';
}

/* ---------- 公共容器 ---------- */
const C = {
  toolbar: $('#toolbar'),
  chips: $('#chips'),
  list: $('#list'),
  detail: $('#detail'),
  pager: $('#pager'),
};

/* ---------- 标签匹配：标签 = 学派 或 名称/正文关键词 ---------- */
function tagMatches(s, tag) {
  return (s.school && s.school === tag) || s.name.includes(tag) || s.text.includes(tag);
}

/* ---------- 法术 Tab ---------- */
const spellPicker = Picker.create({
  data: DATA.spells,
  selKey: 'name',
  pageSize: 100,
  placeholder: '搜索法术名或描述…',
  emptyText: '没有匹配的法术。',
  chips: [
    { key: 'level', label: '环位', items: LEVELS, labelFn: lvLabel },
    { key: 'school', label: '学派', items: SCHOOLS },
    { key: 'cls', label: '职业', items: CLASSES, match: (s, c) => (SPELL_JOBS[s.name] || []).includes(c) },
  ],
  hay: (s) => s.name + ' ' + s.text,
  filter: (s, f) => {
    if (f.tags) {
      const tags = String(f.tags).trim().split(/[\s,，、;；]+/).map(t => t.trim()).filter(Boolean);
      if (tags.length) {
        const ok = tags.map(t => tagMatches(s, t));
        if (f.tagsMode === 'or' ? !ok.some(Boolean) : !ok.every(Boolean)) return false;
      }
    }
    if (f.ritual === '1' && !s.ritual) return false;
    if (f.ritual === '0' && s.ritual) return false;
    if (f.focus === '1' && !s.focus) return false;
    if (f.focus === '0' && s.focus) return false;
    return true;
  },
  extraState: { tags: '', tagsMode: 'and', ritual: '', focus: '' },
  extraToolbar(tb, f, paint) {
    const wrap = el('span', 'pk-toolbar-extras');
    wrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;flex:1;min-width:200px';
    wrap.innerHTML = `<input type="search" class="pk-tags" placeholder="标签：如 塑能 火焰（空格分隔）" value="${esc(f.tags)}" title="标签式搜索：输入学派或关键词，多个标签按下方方式匹配">
      <select class="pk-tags-mode" title="多个标签的匹配方式">
        <option value="and"${f.tagsMode === 'and' ? ' selected' : ''}>交集（同时满足）</option>
        <option value="or"${f.tagsMode === 'or' ? ' selected' : ''}>并集（任一满足）</option>
      </select>
      <select class="pk-ritual"><option value="">仪式：全部</option>
        <option value="1"${f.ritual === '1' ? ' selected' : ''}>仅仪式法术</option>
        <option value="0"${f.ritual === '0' ? ' selected' : ''}>仅非仪式</option></select>
      <select class="pk-focus"><option value="">专注：全部</option>
        <option value="1"${f.focus === '1' ? ' selected' : ''}>需要专注</option>
        <option value="0"${f.focus === '0' ? ' selected' : ''}>不需专注</option></select>`;
    tb.appendChild(wrap);
    const bind = (sel2, onVal) => {
      const inp = $(sel2, wrap);
      if (inp) inp.addEventListener('input', onVal);
    };
    const bindChg = (sel2, onVal) => {
      const inp = $(sel2, wrap);
      if (inp) inp.addEventListener('change', onVal);
    };
    bind('.pk-tags', (e) => { f.tags = e.target.value; f.page = 1; paint(true); });
    bindChg('.pk-tags-mode', (e) => { f.tagsMode = e.target.value; f.page = 1; paint(true); });
    bindChg('.pk-ritual', (e) => { f.ritual = e.target.value; f.page = 1; paint(true); });
    bindChg('.pk-focus', (e) => { f.focus = e.target.value; f.page = 1; paint(true); });
  },
  itemHtml: (s) => `<div class="pk-i-name">${esc(s.name)}${s.ritual ? ' <span class="pk-tag pk-tag-ritual">仪式</span>' : ''}${s.focus ? ' <span class="pk-tag pk-tag-focus">专注</span>' : ''}</div>
    <div class="pk-i-sub">${lvLabel(s.level)} · ${esc(s.school || '未知学派')}</div>
    ${s.text ? `<div class="pk-i-brief">${esc(s.text.split('\n').slice(1).join(' ').slice(0, 60))}</div>` : ''}`,
  detailHtml: (s) => {
    const jobs = (SPELL_JOBS[s.name] || []).slice();
    // 环阶/学派已显示在副标题（pk-d-sub），详情字段不再重复
    const fields = [
      ['仪式', s.ritual ? '是（可作为仪式施展）' : '否'],
      ['施法时间', s.castTime || '—'], ['施法距离', s.range || '—'],
      ['法术目标', s.target || '—'], ['法术成分', s.components || '—'],
      ['持续时间', s.duration || '—'], ['需要专注', s.focus ? '是' : '否'],
    ];
    return `<div class="pk-d-name">${esc(s.name)}</div>
      <div class="pk-d-sub">${lvLabel(s.level)} · ${esc(s.school || '未知学派')}</div>
      <div class="pk-d-fields">${fields.map(([k, v]) =>
        `<div class="f"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`).join('')}</div>
      <div class="pk-d-text">${esc(s.text)}</div>
      ${jobs.length ? `<div class="pk-d-jobs">可用职业：<b>${jobs.map(esc).join('、')}</b></div>` : ''}
      <a class="pk-d-link" href="${esc(s.url)}" target="_blank">📖 规则书原文 →</a>`;
  },
  containers: C,
});

/* ---------- 战技 Tab ---------- */
const mvPicker = Picker.create({
  data: DATA.maneuvers,
  selKey: 'name',
  placeholder: '搜索战技名或描述…',
  emptyText: '没有匹配的战技。',
  chips: [
    { key: 'style', label: '流派', items: STYLES },
    { key: 'level', label: '级别', items: MLEVELS },
    { key: 'type', label: '类型', items: MTYPES },
  ],
  hay: (m) => m.name + ' ' + (m.text || ''),
  itemHtml: (m) => `<div class="pk-i-name">${esc(m.name)}</div>
    <div class="pk-i-sub">${esc(m.style)} · ${esc(m.level)} · ${esc(m.type)}</div>`,
  detailHtml: (m) => `<div class="pk-d-name">${esc(m.name)}</div>
    <div class="pk-d-sub">${esc(m.style)} · ${esc(m.level)} · ${esc(m.type)}</div>
    ${m.text ? `<div class="pk-d-text">${esc(m.text)}</div>` : '<p class="pk-muted">规则书未收录该战技的独立详述。</p>'}
    <a class="pk-d-link" href="${esc(m.url)}" target="_blank">📖 规则书原文（${esc(m.style)}）→</a>`,
  containers: C,
});

/* ---------- 程序 Tab ---------- */
const pgPicker = Picker.create({
  data: DATA.programs,
  selKey: 'name',
  placeholder: '搜索程序名或效果…',
  emptyText: '没有匹配的程序。',
  chips: [
    { key: 'protocol', label: '协议层级', items: PROTOCOLS },
    { key: 'module', label: '模块', items: MODULES },
  ],
  hay: (p) => p.name + ' ' + (p.text || ''),
  filter: (p, f) => {
    if (f.focus === '1' && !p.focus) return false;
    if (f.focus === '0' && p.focus) return false;
    return true;
  },
  extraState: { focus: '' },
  extraToolbar(tb, f, paint) {
    const wrap = el('span', 'pk-toolbar-extras');
    wrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    wrap.innerHTML = `<select class="pk-focus"><option value="">专注：全部</option>
      <option value="1"${f.focus === '1' ? ' selected' : ''}>需要专注</option>
      <option value="0"${f.focus === '0' ? ' selected' : ''}>不需专注</option></select>`;
    tb.appendChild(wrap);
    $('.pk-focus', wrap).addEventListener('change', (e) => { f.focus = e.target.value; paint(true); });
  },
  itemHtml: (p) => `<div class="pk-i-name">${esc(p.name)}${p.focus ? ' <span class="pk-tag pk-tag-focus">专注</span>' : ''}</div>
    <div class="pk-i-sub">${esc(p.protocol)} · ${esc(p.module || '无模块')} · ${esc(p.act || '')}</div>
    ${p.text ? `<div class="pk-i-brief">${esc(p.text.slice(0, 60))}</div>` : ''}`,
  detailHtml: (p) => `<div class="pk-d-name">${esc(p.name)}</div>
    <div class="pk-d-sub">${esc(p.protocol)}协议</div>
    <div class="pk-d-fields">
      <div class="f"><span class="k">所需模块</span><span class="v">${esc(p.module || '无')}</span></div>
      <div class="f"><span class="k">激活时间</span><span class="v">${esc(p.act || '—')}</span></div>
      <div class="f"><span class="k">需要专注</span><span class="v">${p.focus ? '是' : '否'}</span></div>
    </div>
    ${p.text ? `<div class="pk-d-text">${esc(p.text)}</div>` : ''}
    <a class="pk-d-link" href="${esc(p.url)}" target="_blank">📖 规则书原文（${esc(p.protocol)}协议）→</a>`,
  containers: C,
});

/* ---------- 魔法物品 Tab ---------- */
const miPicker = Picker.create({
  data: MI,
  selKey: 'id',
  pageSize: 100,
  placeholder: '搜索物品名、类型、效果…',
  emptyText: '没有匹配的魔法物品。',
  chips: [{ key: 'sub', label: '分类', items: MI_SUBS, groups: MI_GROUPS },
    {
      key: 'pr', label: '价格', items: [...MI_TIERS.map(t => t.k), 'nonsell', 'none'],
      labelFn: (k) => {
        const t = MI_TIERS.find(x => x.k === k);
        return t ? t.label : (k === 'nonsell' ? '非卖品' : '特别');
      },
      match: (i, k) => k === 'nonsell' ? !!i.nonsell
        : k === 'none' ? !(i.nonsell || i.pmin != null)
        : (i.tiers || []).includes(k),
    }],
  groupBy: (i) => i.sub,
  hay: (i) => i.hay || '',
  filter: (i, f) => {
    if (f.attune === '1' && !i.attune) return false;
    if (f.attune === '0' && i.attune) return false;
    if (f.artifact === '1' && !i.artifact) return false;
    if (f.artifact === '0' && i.artifact) return false;
    return true;
  },
  extraState: { attune: '', artifact: '' },
  extraToolbar(tb, f, paint) {
    const wrap = el('span', 'pk-toolbar-extras');
    wrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    wrap.innerHTML = `<select class="pk-attune"><option value="">同调：全部</option>
        <option value="1"${f.attune === '1' ? ' selected' : ''}>需同调</option>
        <option value="0"${f.attune === '0' ? ' selected' : ''}>不需同调</option></select>
      <select class="pk-artifact"><option value="">神器：全部</option>
        <option value="1"${f.artifact === '1' ? ' selected' : ''}>仅神器</option>
        <option value="0"${f.artifact === '0' ? ' selected' : ''}>非神器</option></select>`;
    tb.appendChild(wrap);
    const bind = (sel2, key) => {
      $(sel2, wrap).addEventListener('change', (e) => { f[key] = e.target.value; f.page = 1; paint(true); });
    };
    bind('.pk-attune', 'attune');
    bind('.pk-artifact', 'artifact');
  },
  itemHtml: (i) => `<div class="pk-i-name">${esc(i.name)}${i.artifact ? ' <span class="pk-tag pk-tag-artifact">神器</span>' : ''}${i.attune ? ' <span class="pk-tag pk-tag-attune">同调</span>' : ''}</div>
    <div class="pk-i-sub">${esc(i.sub)}${miListPrice(i) ? ` · ${esc(miListPrice(i))}` : ''}</div>
    ${i.text ? `<div class="pk-i-brief">${esc(i.text.split('\n')[0].slice(0, 60))}</div>` : ''}`,
  detailHtml: (i) => {
    // 分类/英文名/神器角标显示在副标题；字段收敛为「类型 / 同调 / 价格」三行，去掉冗余的类型行原文与重复区间
    const fields = [
      ['类型', miType(i)],
      ['同调', i.attune ? (i.attuneText || '需同调') : '否'],
      ['价格', miPrice(i)],
    ];
    return `<div class="pk-d-name">${esc(i.name)}${i.artifact ? ' <span class="pk-tag pk-tag-artifact">神器</span>' : ''}</div>
      <div class="pk-d-sub">${esc(i.sub)}${i.en ? ` · ${esc(i.en)}` : ''}</div>
      <div class="pk-d-fields">${fields.map(([k, v]) =>
        `<div class="f"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`).join('')}</div>
      ${(i.tables && i.tables.length) ? `<div class="pk-d-table-title">价格表</div>${Picker.tablesHtml(i.tables)}` : ''}
      ${i.text ? `<div class="pk-d-text">${esc(i.text)}</div>` : '<p class="pk-muted">规则书未收录该物品的独立详述。</p>'}
      <a class="pk-d-link" href="${esc(i.url)}" target="_blank">📖 规则书原文（${esc(i.sub)}）→</a>`;
  },
  containers: C,
});

const PICKERS = { spells: spellPicker, maneuvers: mvPicker, programs: pgPicker, 'magic-items': miPicker };

/* ---------- Tab 切换 ---------- */
function switchTab(tab) {
  $$('.tab').forEach(b => b.classList.toggle('sel', b.dataset.tab === tab));
  const p = PICKERS[tab] || pgPicker;
  p.reset();
  C.detail.innerHTML = '<p class="pk-muted" style="padding:8px">选择左侧条目查看详情。</p>';
  p.paint();
  p.initialDetail();
}

/* ---------- 启动 ---------- */
document.getElementById('ver').textContent = 'v' + (DATA.rules ? DATA.rules.version : '') + ' · 规则书数据';
$$('#tabs .tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
switchTab('spells');
})();
