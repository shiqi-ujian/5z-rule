/* 5z 词典前端：法术 / 战技 / 专长 / 程序 / 魔法物品 / 怪物 浏览、搜索、筛选、详情
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
// 基础学派：常规单学派 + 多学派拼出的原子学派（剔除"任意学派"与"法术"占位），
// 供学派筛选使用；多学派法术按"命中任一所选学派"智能匹配，不再把组合逐一双列。
const BASE_SCHOOLS = [...new Set(DATA.spells.flatMap(s => spellSchools(s))
  .filter(x => x && x !== '任意学派'))].sort((a, b) => a.localeCompare(b));
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
// 程序核心演算模块：筛选改为「任选几个模块 → 智能识别能用的程序」，
// 不再把各种组合（火力、工程 / 火力、工程、信息 …）逐一双列出来。
const CORE_MODULES = ['火力', '工程', '信息', '生存', '时空'];
// 程序的所需模块解析：module 字段可能为 单个 / 组合 / 无 / 任意两个 / 空（需回退到正文"所需模块"行）
// 返回 { list: [模块...], none: 是否无需模块, any: 是否要求任意两个 }
function progModuleInfo(p) {
  let raw = String(p.module || '').trim();
  if (!raw) {
    const m = /所需模块：\s*([^\n]+)/.exec(p.text || '');
    if (m) raw = m[1].trim();
  }
  if (!raw || raw === '无') return { list: [], none: true, any: false };
  if (/任意两个/.test(raw)) return { list: [], none: false, any: true };
  return { list: raw.split(/[、,，;；\s]+/).map(s => s.trim()).filter(Boolean), none: false, any: false };
}
// 法术的学派解析：单学派 / 多学派（如 预言/变化/防护）/ 任意学派 / 传奇的"法术"占位 / 空
// 返回学派数组；「任意学派」单独标记为特殊值，供匹配层特判。
function spellSchools(x) {
  let raw = String(x.school || '').trim();
  if (!raw) return [];
  if (raw === '法术') {
    // 传奇法术：真实学派在正文首行（如 "传奇法术 塑能"），占位字段"法术"不具区分度
    const m = /^(?:传奇(?:法术)?|([零一二三四五六七八九十百]+)环|戏法)\s*([^\s/（(]+)/.exec(x.text || '');
    if (m && m[2]) raw = m[2];
  }
  return raw.split('/').map(s => s.trim()).filter(Boolean);
}
function spellMatchSchool(x, v) {
  const set = spellSchools(x);
  if (!set.length) return false;
  if (set.includes('任意学派') && v !== '法术') return true; // 任意学派 → 匹配任意常规学派
  return set.includes(v);
}
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
  return (s.school && spellSchools(s).includes(tag)) || s.name.includes(tag) || s.text.includes(tag);
}
/* 学派显示：多学派拼"、"；任意学派显示为"任意学派"；传奇"法术"占位回退到真实学派。 */
function schoolLabel(s) {
  const set = spellSchools(s);
  if (!set.length) return '未知学派';
  if (set.includes('任意学派')) return '任意学派';
  return set.join('/');
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
    { key: 'school', label: '学派（任选，命中任一即显示）', items: BASE_SCHOOLS, match: spellMatchSchool },
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
    <div class="pk-i-sub">${lvLabel(s.level)} · ${esc(schoolLabel(s))}</div>
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
      <div class="pk-d-sub">${lvLabel(s.level)} · ${esc(schoolLabel(s))}</div>
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

/* ---------- 专长 Tab ---------- */
// 类别按规则书顺序（娴熟/战技/种族/秘法/职业/超魔/通用专长）；不认识的类别兜底排后
const FEAT_CAT_ORDER = ['娴熟专长', '战技专长', '种族专长', '秘法专长', '职业专长', '超魔专长', '通用专长'];
const FEAT_CATS = [...new Set(DATA.feats.map(f => f.category))]
  .sort((a, b) => {
    const ia = FEAT_CAT_ORDER.indexOf(a), ib = FEAT_CAT_ORDER.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
  });
// 专长有重名（同名可跨类别，且 `raceFeats` 合并出的种族特性句），给每条一个稳定 id 作为选中标识
DATA.feats.forEach((f, i) => { if (f.id == null) f.id = (f.category || '') + '\u0000' + (f.name || '') + '\u0000' + i; });
const featPicker = Picker.create({
  data: DATA.feats,
  selKey: 'id',
  pageSize: 100,
  placeholder: '搜索专长名或效果…',
  emptyText: '没有匹配的专长。',
  chips: [{ key: 'category', label: '类别', items: FEAT_CATS }],
  hay: (f) => f.name + ' ' + (f.text || ''),
  itemHtml: (f) => `<div class="pk-i-name">${esc(f.name)}</div>
    <div class="pk-i-sub">${esc(f.category)}</div>
    ${f.text ? `<div class="pk-i-brief">${esc(f.text.split('\n')[0].slice(0, 60))}</div>` : ''}`,
  detailHtml: (f) => `<div class="pk-d-name">${esc(f.name)}</div>
    <div class="pk-d-sub">${esc(f.category)}</div>
    ${f.text ? `<div class="pk-d-text">${esc(f.text)}</div>` : '<p class="pk-muted">规则书未收录该专长的独立详述。</p>'}
    <a class="pk-d-link" href="${esc(f.url || '#')}" target="_blank">📖 规则书原文 →</a>`,
  containers: C,
});

/* ---------- 程序 Tab ---------- */
// 所需模块的可读标签：无 / 任意两个 / 具体组合（按 CORE_MODULES 顺序排列）
function moduleLabel(p) {
  const info = progModuleInfo(p);
  if (info.none) return '无';
  if (info.any) return '任意两个';
  if (!info.list.length) return '无';
  return CORE_MODULES.filter(m => info.list.includes(m)).join('、');
}
const pgPicker = Picker.create({
  data: DATA.programs,
  selKey: 'name',
  placeholder: '搜索程序名或效果…',
  emptyText: '没有匹配的程序。',
  chips: [
    { key: 'protocol', label: '协议层级', items: PROTOCOLS },
    // 模块：只列出 5 个核心模块（任选）。匹配规则为「所需模块 ⊆ 已选模块」，
    // 由下方 filter 按"能用的程序"语义判定；此处 match 恒真以绕过 chips 的 OR 预筛。
    { key: 'module', label: '模块（任选，显示能用的程序）', items: CORE_MODULES, match: () => true },
  ],
  hay: (p) => p.name + ' ' + (p.text || ''),
  filter: (p, f) => {
    if (f.focus === '1' && !p.focus) return false;
    if (f.focus === '0' && p.focus) return false;
    const sel = f.chips.module || [];
    if (sel.length) {
      const info = progModuleInfo(p);
      if (!info.none) {
        if (info.any) {
          if (sel.length < 2) return false;        // 任意两个：需勾选 ≥2 个模块
        } else if (!info.list.every(m => sel.includes(m))) {
          return false;                             // 所需模块必须全部被勾选
        }
      }
    }
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
    <div class="pk-i-sub">${esc(p.protocol)} · ${esc(moduleLabel(p))} · ${esc(p.act || '')}</div>
    ${p.text ? `<div class="pk-i-brief">${esc(p.text.slice(0, 60))}</div>` : ''}`,
  detailHtml: (p) => `<div class="pk-d-name">${esc(p.name)}</div>
    <div class="pk-d-sub">${esc(p.protocol)}协议</div>
    <div class="pk-d-fields">
      <div class="f"><span class="k">所需模块</span><span class="v">${esc(moduleLabel(p))}</span></div>
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

/* ---------- 怪物 Tab ---------- */
// 数据来自 assets/monster-data.js（window.__MONSTER_DATA__）：与 assets/card-data/monsters.json 同源，
// 由 5z_build/parse-card-data.mjs 从规则书怪物页解析。字段同时服务本词典与骰子机器人查询
// （name/type/desc/cr/text/page/url 与 qq-dice 现有查询数据同语义）。
const MON_DATA = window.__MONSTER_DATA__ || null;
const MON = (MON_DATA && Array.isArray(MON_DATA.monsters)) ? MON_DATA.monsters : [];
// 生物类型顺序按规则书章节（怪物目录下的子目录），未知的兜底排后
const MON_CAT_ORDER = ['不死生物', '元素生物', '天界生物', '异怪', '怪兽', '构装生物', '植物', '泥怪', '类人生物', '精类', '邪魔', '野兽', '龙类'];
const MON_CATS = [...new Set(MON.map(m => m.category))]
  .sort((a, b) => {
    const ia = MON_CAT_ORDER.indexOf(a), ib = MON_CAT_ORDER.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
  });
const MON_SIZE_ORDER = ['微型', '小型', '中型', '大型', '巨型', '超巨型'];
const MON_SIZE_CHIPS = [...MON_SIZE_ORDER, '其他'];
const MON_SIZE_OTHER = ['小型或中型', '任意体型', '无体型'];
function monSizeMatch(m, v) {
  if (v === '其他') return MON_SIZE_OTHER.includes(m.size) || !m.size;
  if (m.size === v) return true;
  // 「小型或中型」对小型/中型筛选都算命中
  return m.size === '小型或中型' && (v === '小型' || v === '中型');
}
// 阵营归一到 9 种常规阵营 + 无阵营 + 任意阵营（源站有「通常为…」「75%守序中立/25%绝对中立」等写法，
// 归一后按「命中任一所选阵营」匹配；多阵营条目会同时命中多个）
// ⚠️ 常规阵营是 3×3 共 9 种，别漏「混乱中立」（漏了会把这类全打进「其他」）
const ALIGN_BASE = ['守序善良', '中立善良', '混乱善良', '守序中立', '绝对中立', '混乱中立', '守序邪恶', '中立邪恶', '混乱邪恶'];
const ALIGN_TAG_CACHE = new WeakMap();
function monAlignTags(m) {
  if (ALIGN_TAG_CACHE.has(m)) return ALIGN_TAG_CACHE.get(m);
  const raw = m.alignment || '';
  const set = new Set();
  if (/无阵营/.test(raw)) set.add('无阵营');
  if (/任何|任意/.test(raw)) set.add('任意阵营');
  for (const a of ALIGN_BASE) if (raw.includes(a)) set.add(a);
  if (/邪恶中立/.test(raw)) set.add('中立邪恶');   // 源站错序写法「普遍邪恶中立」
  if (/善良中立/.test(raw)) set.add('中立善良');
  if (!set.size) set.add('其他');
  ALIGN_TAG_CACHE.set(m, set);
  return set;
}
// 「其他」只在确有无法归一的写法时出现，避免出现一个恒为 0 的空筛选组
const MON_ALIGN_CHIPS = [...ALIGN_BASE, '无阵营', '任意阵营'];
if (MON.some(m => monAlignTags(m).has('其他'))) MON_ALIGN_CHIPS.push('其他');
// 挑战等级分级（crNum 不可解析的「无 / +∞ / 见表格 / 动态」归入「特殊」）
const MON_CR_BUCKETS = [
  { k: '0-1', label: 'CR 0–1', test: (c) => c != null && c <= 1 },
  { k: '2-4', label: 'CR 2–4', test: (c) => c != null && c > 1 && c <= 4 },
  { k: '5-10', label: 'CR 5–10', test: (c) => c != null && c > 4 && c <= 10 },
  { k: '11-16', label: 'CR 11–16', test: (c) => c != null && c > 10 && c <= 16 },
  { k: '17+', label: 'CR 17+', test: (c) => c != null && c > 16 },
  { k: 'special', label: '特殊/无固定', test: (c) => c == null },
];
// 列表默认按「生物类型（规则书章节序）→ 挑战等级 → 名称」排序；groupBy 生物类型便于浏览
MON.sort((a, b) => {
  const ia = MON_CAT_ORDER.indexOf(a.category), ib = MON_CAT_ORDER.indexOf(b.category);
  return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
    || (a.crNum == null ? 999 : a.crNum) - (b.crNum == null ? 999 : b.crNum)
    || a.name.localeCompare(b.name);
});
const MON_CR_LABEL = (m) => (m.crText ? 'CR ' + m.crText : 'CR —');
function monFields(m) {
  return [
    ['挑战等级', m.crText ? 'CR ' + m.crText : 'CR —'],
    ['AC', m.ac || '—'],
    ['HP', m.hp || m.maxHp || '—'],
    ['速度', m.speed || '—'],
    ['体型', m.size || '—'],
    ['阵营', m.alignment || '—'],
    ['豁免', m.saves || '—'],
    ['技能', m.skills || '—'],
    ['伤害免疫', m.damageImmunities || '—'],
    ['伤害抗性', m.damageResistances || '—'],
    ['伤害易伤', m.damageVulnerabilities || '—'],
    ['伤害吸收', m.damageAbsorption || '—'],
    ['状态免疫', m.conditionImmunities || '—'],
    ['状态抗性', m.conditionResistances || '—'],
    ['感官', m.senses || '—'],
    ['语言', m.languages || '—'],
    ['熟练加值', m.proficiencyBonus || '—'],
    ['先攻', m.initiative || '—'],
  ].filter(([, v]) => v && v !== '—');
}
// 分节正文不重复存储：数据里只有 {name, start}（start = 在 text 里的起始行号），
// 用相邻分节的 start 切片还原（与解析器口径一致，monsters.json 体积约省一半）
function monSectionText(m, sec, idx) {
  if (sec.text) return sec.text; // 兼容旧格式
  const lines = String(m.text || '').split('\n');
  const next = (m.sections || [])[idx + 1];
  const from = sec.start + (sec.name ? 1 : 0); // 有标题时跳过标题行本身
  return lines.slice(from, next ? next.start : lines.length).join('\n');
}
function monDetailHtml(m) {
  const fields = monFields(m);
  const secs = (m.sections || []).map((s, idx) => ({ name: s.name, text: monSectionText(m, s, idx) }))
    .filter(s => s.text);
  return `<div class="pk-d-name">${esc(m.name)}</div>
    <div class="pk-d-sub">${esc(m.type || '')}</div>
    <div class="pk-d-fields mon-fields">${fields.map(([k, v]) =>
      `<div class="f"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`).join('')}</div>
    ${m.abilityText ? `<div class="pk-d-ability"><span class="k">属性</span>${esc(m.abilityText)}</div>` : ''}
    ${m.desc ? `<div class="pk-d-desc"><span class="k">背景</span>${esc(m.desc)}</div>` : ''}
    ${m.extraText ? `<div class="pk-d-text">${esc(m.extraText)}</div>` : ''}
    ${secs.map(s => `<div class="pk-d-sec">${s.name ? `<div class="pk-d-sec-title">${esc(s.name)}</div>` : ''}<div class="pk-d-text">${esc(s.text)}</div></div>`).join('')}
    <a class="pk-d-link" href="${esc(m.url)}" target="_blank">📖 规则书原文（${esc(m.category)}）→</a>`;
}
const monPicker = Picker.create({
  data: MON,
  selKey: 'id',
  pageSize: 50,
  placeholder: '搜索怪物名、类型、特性…',
  emptyText: MON_DATA ? '没有匹配的怪物。' : '怪物数据未加载（assets/monster-data.js 缺失）。',
  chips: [
    { key: 'category', label: '生物类型', items: MON_CATS },
    { key: 'size', label: '体型', items: MON_SIZE_CHIPS, match: monSizeMatch },
    { key: 'align', label: '阵营（任选，命中任一阵营即显示）', items: MON_ALIGN_CHIPS, match: (m, v) => monAlignTags(m).has(v) },
    {
      key: 'cr', label: '挑战等级', items: MON_CR_BUCKETS.map(b => b.k),
      labelFn: (k) => (MON_CR_BUCKETS.find(b => b.k === k) || {}).label || k,
      match: (m, k) => (MON_CR_BUCKETS.find(b => b.k === k) || { test: () => false }).test(m.crNum),
    },
  ],
  groupBy: (m) => m.category,
  hay: (m) => (m.name + ' ' + (m.type || '') + ' ' + (m.category || '') + ' ' + (m.crText || '') + ' ' + (m.desc || '') + ' ' + (m.text || '')).toLowerCase(),
  itemHtml: (m) => `<div class="pk-i-name">${esc(m.name)}</div>
    <div class="pk-i-sub">${esc(m.type || m.category)} · ${esc(MON_CR_LABEL(m))}</div>`,
  detailHtml: monDetailHtml,
  containers: C,
});

const PICKERS = { spells: spellPicker, maneuvers: mvPicker, feats: featPicker, programs: pgPicker, 'magic-items': miPicker, monsters: monPicker };

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
