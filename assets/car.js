/* 5z 车卡 - 前端逻辑
 * 数据：assets/card-data/{rules,races,classes,feats}.json（构建时从规则书解析）
 * 流程：种族 → 职业 → 属性 → 背景 → 技能 → 专长 → 角色卡
 */
(function () {
'use strict';

/* ---------- 小工具 ---------- */
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
const ATTRS = ['力量', '敏捷', '体质', '智力', '感知'];
const STORAGE_KEY = '5z-car-char-v1';

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._tm);
  t._tm = setTimeout(() => { t.hidden = true; }, 2200);
}

/* ---------- 全局数据/状态 ---------- */
let DATA = null; // {rules, races, classes, feats}
let state = {
  step: 1,
  char: null, // 见 newChar()
};
let rollBuf = null; // 随机骰临时数组

function newChar() {
  return {
    name: '', player: '', level: 1,
    raceId: null, classId: null, subclass: '',
    majorAttr: '力量',
    buyMethod: 'points',
    base: { 力量: 8, 敏捷: 8, 体质: 8, 智力: 8, 感知: 8 },
    manual: { 力量: 0, 敏捷: 0, 体质: 0, 智力: 0, 感知: 0 },
    armorType: 'naked', shield: false, armorBonus: 0,
    keyAttr: '感知',
    bgName: '', bgText: '', bgLanguage: '',
    age: '', gender: '', alignment: '', faith: '', heightWeight: '',
    skills: { 运动: 0, 威吓: 0, 体操: 0, 巧手: 0, 隐匿: 0, 奥秘: 0, 灵能: 0, 历史: 0,
      调查: 0, 自然: 0, 宗教: 0, 表演: 0, 医药: 0, 洞悉: 0, 察觉: 0, 求生: 0, 交涉: 0 },
    feats: [],
    extraFeats: 0,
    maneuverStyle: '',
    maneuvers: [],
    spells: [],
    programProtocol: '阿尔法',
    programs: [],
    notes: '', items: '', traitsNote: '',
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state.char = Object.assign(newChar(), saved.char || {});
      state.step = Math.min(7, Math.max(1, saved.step || 1));
    }
  } catch (e) { /* 忽略损坏存档 */ }
  if (!state.char) state.char = newChar();
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ step: state.step, char: state.char })); } catch (e) {}
}

/* ---------- 摘要工具（种族/职业/专长卡片） ---------- */
// 把 traits 段落统一拼成摘要：优先"特性名：文本"，空字段跳过，避免"有的全显示/有的全空白"
function traitSummary(r, maxLen) {
  if (!r) return '';
  const parts = [];
  for (const t of r.traits || []) {
    const n = (t.name || '').trim();
    const x = (t.text || '').trim();
    if (!n && !x) continue;
    const s = n ? (x ? n + '：' + x : n) : x;
    if (s) parts.push(s);
  }
  const joined = parts.join(' ');
  return joined.length > (maxLen || 90) ? joined.slice(0, maxLen || 90) + '…' : joined;
}
function traitValOf(r, re) {
  if (!r) return '';
  const t = r.traits.find(x => x.name && re.test(x.name));
  if (!t) return '';
  return ((t.text || '').trim()) || (t.name || '').replace(re, '').trim();
}

/* ---------- 派生计算 ---------- */
function rules() { return DATA.rules; }
function race() { return DATA.races.find(r => r.id === state.char.raceId) || null; }
function klass() { return DATA.classes.find(c => c.id === state.char.classId) || null; }
function levelRow() { return rules().levelTable[Math.min(19, Math.max(0, state.char.level - 1))]; }
function abilityMod(v) {
  for (const [lo, hi, m] of rules().abilityModTable) {
    if (v >= lo && v <= hi) return m;
  }
  return 0;
}
function levelUpBonus(attr) {
  const row = levelRow();
  return attr === state.char.majorAttr ? row[2] : row[3];
}
function finalAttr(attr) {
  return state.char.base[attr] + (state.char.manual[attr] || 0) + levelUpBonus(attr);
}
function finalMod(attr) { return abilityMod(finalAttr(attr)); }
function profBonus() { return levelRow()[4]; }
function hitDie() { return klass() ? klass().core.hitDie : 8; }
function hpMax() {
  if (!klass()) return 0;
  const exp = Math.ceil((hitDie() + 1) / 2);
  return 10 + state.char.level * (exp + finalMod('体质'));
}
function acValue() {
  const prof = profBonus();
  const dex = finalMod('敏捷');
  const f = rules().formulas.ac;
  let v = 0;
  switch (state.char.armorType) {
    case 'naked': v = 8 + prof + dex; break;
    case 'light': v = 10 + prof + dex; break;
    case 'medium': v = 13 + prof + Math.min(2, dex); break;
    case 'heavy': v = 16 + prof; break;
    case 'mage': v = 11 + prof + dex; break;
    case 'monk': v = 8 + prof + dex + finalMod('感知'); break;
    case 'barb': v = 8 + prof + dex + finalMod('体质'); break;
    default: v = 8 + prof + dex;
  }
  if (state.char.shield) v += 2;
  return v + (state.char.armorBonus || 0);
}
function saveMod(attr) {
  const saves = klass() ? klass().core.saveList : [];
  return finalMod(attr) + (saves.includes(attr) ? profBonus() : 0);
}
function skillMod(skill) {
  const s = DATA.rules.skills.find(x => x.name === skill);
  const mod = finalMod(s.attr);
  const lv = state.char.skills[skill] || 0;
  return mod + (lv >= 1 ? profBonus() : 0) + (lv >= 2 ? profBonus() : 0);
}
function skillQuota() {
  const k = klass();
  let n = k ? (k.core.skillsCount || 0) : 0;
  n += 2; // 背景
  const intV = finalAttr('智力');
  if (intV >= 14) n += Math.floor((intV - 14) / 4) + 1;
  return n;
}
function skillChosen() {
  let n = 0;
  for (const k in state.char.skills) if (state.char.skills[k] >= 1) n++;
  return n;
}
function featQuota() {
  const row = levelRow();
  return row[1] + (state.char.extraFeats || 0);
}
function featBaseQuota() {
  return levelRow()[1];
}
function spellDC() { return 8 + profBonus() + finalMod(state.char.keyAttr); }
function spellAttack() { return profBonus() + finalMod(state.char.keyAttr); }
function initBonus() { return finalMod('敏捷'); }
function keyAttrHint() {
  const hint = {
    狂战士: '力量', 盗贼: '敏捷', 武僧: '感知', 圣武士: '感知', 游侠: '感知',
    灵能武士: '智力', 牧师: '感知', 德鲁伊: '感知', 奇械师: '智力', 契术师: '感知',
    吟游诗人: '智力', 法师: '智力', 灵能师: '智力', 召唤师: '智力',
  };
  return state.char.classId ? (hint[state.char.classId] || '感知') : '感知';
}

/* ---------- 数据加载 ---------- */
// 加载顺序：car.html 已通过 <script> 引入 card-data.js（file:// 直开可用）。
// 若数据缺失（如浏览器缓存了旧版 car.html），动态注入数据脚本兜底；
// 仍失败则回退 fetch 独立 JSON（http 场景）。
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('加载失败: ' + src));
    document.head.appendChild(s);
  });
}
async function initData() {
  if (window.__CAR_DATA__ && window.__CAR_DATA__.rules) {
    DATA = window.__CAR_DATA__;
    return;
  }
  // 兜底：动态注入数据脚本（覆盖旧版 car.html 未引用数据文件的缓存场景）
  try {
    await loadScript('assets/card-data.js');
    await loadScript('assets/car-tpl.js');
    if (window.__CAR_DATA__ && window.__CAR_DATA__.rules) {
      DATA = window.__CAR_DATA__;
      return;
    }
  } catch (e) { /* 继续尝试 fetch */ }
  const base = 'assets/card-data/';
  const [rules, races, classes, feats] = await Promise.all([
    fetch(base + 'rules.json').then(r => r.json()),
    fetch(base + 'races.json').then(r => r.json()),
    fetch(base + 'classes.json').then(r => r.json()),
    fetch(base + 'feats.json').then(r => r.json()),
  ]);
  DATA = { rules, races, classes, feats };
}

/* ============================================================
 * 步骤渲染
 * ============================================================ */
const stage = () => $('#stage');
const STEP_TITLES = {
  1: '选择种族', 2: '选择职业', 3: '决定属性值', 4: '设定背景', 5: '选择技能熟练',
  6: '选择专长', 7: '选择法术', 8: '选择战技', 9: '选择程序', 10: '角色卡',
};
const STEP_HINTS = {
  1: '每个角色都有其所属种族。种族提供属性值加成、速度、语言与种族特性。',
  2: '职业决定了你的生命骰、熟练项与职业特性。可先看定位与难度选择。',
  3: '5z 规则共 5 项属性。使用 32 点购点（8~16），或直接采用标准属性组，或随机掷骰。',
  4: '背景给予 2 项技能熟练、1 门额外语言与一段身份特性。5z 背景为开放式自定义。',
  5: '技能熟练来源：职业（自动按职业文本）、背景 2 项、智力 14/18/22/26/30 各 +1 项。',
  6: '1 级获得 2 个专长（其一代表背景训练），此后每 3 级再获得 1 个。',
  7: '按职业法术列表选择已知/准备法术（可搜索、按环位筛选）。数量由你的职业规则决定。',
  8: '选择战技流派（及门弟子）与战技。流派入门专长见专长步骤。',
  9: '赛博格专属：按协议层级选择准备程序。其他职业可跳过。',
  10: '完成！可打印、导出 JSON 存档、导出 Excel 角色卡。',
};

function setStep(n) {
  state.step = n;
  save();
  $$('.step').forEach(b => {
    b.classList.toggle('active', +b.dataset.step === n);
    b.classList.toggle('done', +b.dataset.step < n);
  });
  $('#btn-prev').disabled = n <= 1;
  $('#btn-next').textContent = n >= 10 ? '完成 ✓' : '下一步 →';
  $('#btn-next').disabled = false;
  render();
}

function render() {
  const s = stage();
  s.innerHTML = `<h2>${STEP_TITLES[state.step]}</h2><p class="hint">${STEP_HINTS[state.step]}</p>`;
  switch (state.step) {
    case 1: renderRace(); break;
    case 2: renderClass(); break;
    case 3: renderAttr(); break;
    case 4: renderBg(); break;
    case 5: renderSkills(); break;
    case 6: renderFeats(); break;
    case 7: renderSpells(); break;
    case 8: renderManeuvers(); break;
    case 9: renderPrograms(); break;
    case 10: renderSheet(); break;
  }
  renderLive();
}

/* ---------- 步骤1 种族 ---------- */
function renderRace() {
  const wrap = el('div');
  const q = el('div', 'search-bar');
  q.innerHTML = `<input type="search" id="race-q" placeholder="搜索种族…">
    <select id="race-cat"><option value="">全部分类</option></select>`;
  wrap.appendChild(q);
  const cats = [...new Set(DATA.races.map(r => r.category))].sort((a, b) => a.localeCompare(b));
  const catSel = $('#race-cat', q);
  cats.forEach(c => catSel.insertAdjacentHTML('beforeend', `<option>${esc(c)}</option>`));
  const grid = el('div', 'grid');
  wrap.appendChild(grid);
  const paint = () => {
    const kw = ($('#race-q', q) || {}).value || '';
    const cat = ($('#race-cat', q) || {}).value || '';
    grid.innerHTML = '';
    for (const r of DATA.races) {
      if (cat && r.category !== cat) continue;
      if (kw && !(r.name.includes(kw) || r.traits.some(t => t.text.includes(kw)))) continue;
      const sel = state.char.raceId === r.id;
      const card = el('div', 'card-item' + (sel ? ' sel' : ''));
      const bio = traitValOf(r, /^生物类型/) || traitValOf(r, /^体型/);
      card.innerHTML = `<div class="ci-name">${esc(r.name)}</div>
        <div class="ci-sub">${esc(r.category)}${bio ? ' · ' + esc(bio.slice(0, 26)) : ''}</div>
        <div class="ci-desc">${esc(traitSummary(r, 90))}</div>`;
      card.onclick = () => { state.char.raceId = r.id; save(); paint(); renderLive(); };
      grid.appendChild(card);
    }
  };
  q.addEventListener('input', paint);
  q.addEventListener('change', paint);
  paint();
  const r = race();
  if (r) {
    const d = el('div', 'detail-box');
    d.innerHTML = `<h3>${esc(r.name)}</h3>` +
      r.traits.filter(t => t.name).map(t =>
        `<div class="dl-row"><span class="k">${esc(t.name)}</span><span>${esc(t.text)}</span></div>`).join('') +
      `<p class="muted">完整页面：<a href="${esc(r.url)}" target="_blank">${esc(r.name)}（规则书）</a></p>`;
    stage().appendChild(d);
  }
  stage().appendChild(wrap);
}

/* ---------- 步骤2 职业 ---------- */
function renderClass() {
  const wrap = el('div');
  const grid = el('div', 'grid');
  wrap.appendChild(grid);
  for (const c of DATA.classes) {
    const sel = state.char.classId === c.id;
    const card = el('div', 'card-item' + (sel ? ' sel' : ''));
    const hd = c.core.hitDie ? `生命骰 D${c.core.hitDie} · ` : '';
    const roleText = (c.core.roles || []).slice(0, 3).join(' ');
    card.innerHTML = `<div class="ci-name">${esc(c.name)}</div>
      <div class="ci-sub">${esc(hd)}豁免：${esc(c.core.saves || '—')}</div>
      <div class="ci-desc">${esc(roleText || (c.core.skills ? '技能：' + c.core.skills : '') || '')}</div>`;
    card.onclick = () => { state.char.classId = c.id; state.char.keyAttr = keyAttrHint(); save(); paint(); renderLive(); };
    grid.appendChild(card);
  }
  const paint = () => {
    $$('.card-item', grid).forEach(c => c.classList.toggle('sel', false));
    const c = klass();
    if (!c) return;
    const k = DATA.classes.indexOf(c);
    const cards = $$('.card-item', grid);
    if (cards[k]) cards[k].classList.add('sel');
  };
  const c = klass();
  if (c) {
    const d = el('div', 'detail-box');
    let html = `<h3>${esc(c.name)}</h3>`;
    if (c.core.roles && c.core.roles.length) {
      html += c.core.roles.map(r => `<p>${esc(r)}</p>`).join('');
    }
    html += `<div class="table-wrap"><table class="data"><tbody>
      <tr><th>生命骰</th><td>D${c.core.hitDie || '?'}（期望值 ${c.core.hitDie ? Math.ceil((c.core.hitDie + 1) / 2) : '?'}）</td></tr>
      <tr><th>防具熟练</th><td>${esc(c.core.armor || '—')}</td></tr>
      <tr><th>武器熟练</th><td>${esc(c.core.weapons || '—')}</td></tr>
      <tr><th>豁免熟练</th><td>${esc(c.core.saves || '—')}</td></tr>
      <tr><th>技能熟练</th><td>${esc(c.core.skills || '—')}</td></tr>
    </tbody></table></div>`;
    if (c.tableTitle) {
      html += `<h4 style="margin:10px 0 4px">${esc(c.tableTitle)}</h4><div class="table-wrap"><table class="data">`;
      c.table.forEach((row, i) => {
        html += '<tr>' + row.map(cell => i === 0 ? `<th>${esc(cell)}</th>` : `<td>${esc(cell)}</td>`).join('') + '</tr>';
      });
      html += '</table></div>';
    }
    // 1 级特性
    const lv1 = (c.table.find(r => r[0] === '1') || [])[1] || '';
    if (lv1) {
      html += `<h4 style="margin:10px 0 4px">1 级特性：${esc(lv1)}</h4>`;
      for (const f of c.features) {
        if (lv1.split(/[，,、]/).includes(f.name)) {
          html += `<p><b>${esc(f.name)}</b>　${esc(f.text)}</p>`;
        }
      }
    }
    // 子职
    if (c.subclasses.length) {
      html += `<h4 style="margin:10px 0 4px">子职</h4><select id="subclass-sel" style="width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:#fff">`;
      html += `<option value="">（暂不选择）</option>`;
      const direct = c.subclasses.filter(s => !s.nested);
      const nested = c.subclasses.filter(s => s.nested);
      const groups = [];
      for (const s of direct) groups.push([s.name, s]);
      const nestNames = [...new Set(nested.map(s => s.url.split('/')[2]))];
      for (const nn of nestNames) {
        const kids = nested.filter(s => s.url.split('/')[2] === nn);
        groups.push([nn + '（含子职）', kids[0]]);
      }
      for (const [label, s] of groups) {
        const sel2 = state.char.subclass === s.name;
        html += `<option value="${esc(s.name)}"${sel2 ? ' selected' : ''}>${esc(label)}</option>`;
      }
      html += '</select>';
      html += `<p class="muted" style="margin-top:6px">子职特性全文请从规则书页面查看：
        <a href="${esc(c.url)}" target="_blank">${esc(c.name)}</a></p>`;
    }
    html += `<p class="muted">完整页面：<a href="${esc(c.url)}" target="_blank">${esc(c.name)}（规则书）</a></p>`;
    d.innerHTML = html;
    stage().appendChild(d);
    const ss = $('#subclass-sel', d);
    if (ss) ss.addEventListener('change', () => { state.char.subclass = ss.value; save(); });
  }
  stage().appendChild(wrap);
}

/* ---------- 步骤3 属性 ---------- */
function renderAttr() {
  const c = state.char;
  const seg = el('div', 'seg');
  const methods = [['points', '32 点购点'], ['arrayA', '标准组 A'], ['arrayB', '标准组 B'], ['arrayC', '标准组 C'], ['roll', '随机掷骰']];
  seg.innerHTML = methods.map(([v, label]) =>
    `<button type="button" data-m="${v}" class="${c.buyMethod === v ? 'sel' : ''}">${label}</button>`).join('');
  stage().appendChild(seg);

  const info = el('div', 'buy-info');
  stage().appendChild(info);

  const grid = el('div', 'attr-grid');
  stage().appendChild(grid);

  // 等级 + 主属性
  const misc = el('div', 'field');
  misc.innerHTML = `<label>角色等级</label><input type="number" id="lvl-in" min="1" max="20" value="${c.level}">
    <div class="f-hint">升级属性提升将自动计入：主要属性每 3 级 +1，其余 4 项次要属性每 5 级 +1（累计值）。</div>
    <label style="margin-top:10px">主要属性（升级时 +1 的属性）</label>
    <select id="major-sel">${ATTRS.map(a => `<option value="${a}"${c.majorAttr === a ? ' selected' : ''}>${a}</option>`).join('')}</select>
    <label style="margin-top:10px">施法关键属性（用于法术 DC / 法术攻击）</label>
    <select id="key-sel">${ATTRS.map(a => `<option value="${a}"${c.keyAttr === a ? ' selected' : ''}>${a}</option>`).join('')}</select>
    <div class="f-hint">推荐：${esc(keyAttrHint())}（可按需修改；无施法能力的职业可忽略）</div>`;
  stage().appendChild(misc);

  const paint = () => {
    // 购点余额
    const spent = ATTRS.reduce((s, a) => s + (rules().buyTable[c.base[a]] || 0), 0);
    const remain = rules().buyPoints - spent;
    const arr = rules().standardArrays;
    const arrLabel = { arrayA: arr[0], arrayB: arr[1], arrayC: arr[2] };
    if (c.buyMethod === 'points') {
      info.innerHTML = `已花费 <b>${spent}</b> / ${rules().buyPoints} 点，剩余 <b class="${remain < 0 ? 'over' : ''}">${remain}</b> 点。
        属性值 8~16（种族调整前），单项上限 16。`;
    } else if (arrLabel[c.buyMethod]) {
      info.innerHTML = `${esc(arrLabel[c.buyMethod].name)}：${arrLabel[c.buyMethod].values.join('、')}。
        点击属性卡片的数值可微调（上下箭头）。`;
    } else if (c.buyMethod === 'roll') {
      info.innerHTML = `掷 5 次 4d6 去最低。可点击"重新掷骰"。`;
    }
    grid.innerHTML = '';
    for (const a of ATTRS) {
      const card = el('div', 'attr-card');
      const final = finalAttr(a);
      const up = levelUpBonus(a);
      card.innerHTML = `<h3>${a}</h3>
        <input type="number" id="base-${a}" min="1" max="30" value="${c.base[a]}" data-attr="${a}">
        <span class="attr-mod">调整值 ${finalMod(a) >= 0 ? '+' : ''}${finalMod(a)}</span>
        <div class="attr-score">${final}</div>
        <div class="attr-adj">手动调整（种族/专长等）：<input type="number" id="man-${a}" min="-10" max="10" value="${c.manual[a] || 0}" data-attr="${a}" style="width:56px">
        ${up ? `<br>升级提升：+${up}` : ''}</div>`;
      grid.appendChild(card);
    }
    renderLive();
  };
  paint();

  // 随机骰：生成 5 次 4d6 去最低
  const rollAttrs = () => {
    rollBuf = Array.from({ length: 5 }, () => {
      const ds = Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 6)).sort((x, y) => x - y);
      return ds[1] + ds[2] + ds[3];
    }).sort((x, y) => y - x);
    ATTRS.forEach((a, i) => { c.base[a] = rollBuf[i]; });
  };
  // 事件
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-m]');
    if (!b) return;
    c.buyMethod = b.dataset.m;
    if (c.buyMethod.startsWith('array')) {
      const arr = rules().standardArrays[['arrayA', 'arrayB', 'arrayC'].indexOf(c.buyMethod)];
      ATTRS.forEach((a, i) => { c.base[a] = arr.values[i] || 8; });
    } else if (c.buyMethod === 'roll') {
      rollAttrs();
      const rb = el('button', 'nav-btn', '重新掷骰');
      rb.style.marginTop = '8px';
      rb.onclick = () => { rollAttrs(); paint(); renderLive(); };
      // 放在 info 后面
      info.appendChild(document.createTextNode(' '));
      info.appendChild(rb);
    }
    save(); paint();
  });
  grid.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.attr) return;
    const attr = t.dataset.attr;
    if (t.id.startsWith('base-')) c.base[attr] = Math.max(1, Math.min(30, +t.value || 8));
    else c.manual[attr] = Math.max(-10, Math.min(10, +t.value || 0));
    save(); paint();
  });
  $('#lvl-in').addEventListener('change', (e) => {
    c.level = Math.max(1, Math.min(20, +e.target.value || 1));
    save(); paint(); renderLive();
  });
  $('#major-sel').addEventListener('change', (e) => { c.majorAttr = e.target.value; save(); paint(); renderLive(); });
  $('#key-sel').addEventListener('change', (e) => { c.keyAttr = e.target.value; save(); renderLive(); });
}

/* ---------- 步骤4 背景 ---------- */
function renderBg() {
  const c = state.char;
  const f = (label, id, value, ph, hint) => `
    <div class="field"><label>${label}</label>
    <input type="text" id="${id}" value="${esc(value)}" placeholder="${esc(ph || '')}">
    ${hint ? `<div class="f-hint">${hint}</div>` : ''}</div>`;
  const wrap = el('div');
  wrap.innerHTML = f('背景名称', 'bg-name', c.bgName, '如：平民英雄、罪犯、流浪儿…', '5z 背景为开放式设计：任意自拟背景，获得 2 项技能熟练 + 1 门额外语言。') +
    f('背景特性 / 身份描述', 'bg-text', c.bgText, '你的来历、身份、特性文本…') +
    f('额外语言', 'bg-lang', c.bgLanguage, '如：精灵语、龙语…', '背景允许角色掌握种族语言外的一门额外语言。') +
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px">
      ${f('年龄', 'bg-age', c.age, '')}
      ${f('性别', 'bg-gender', c.gender, '')}
      ${f('阵营', 'bg-align', c.alignment, '如：守序善良、绝对中立…')}
      ${f('信仰', 'bg-faith', c.faith, '')}
    </div>` +
    f('身高体重', 'bg-hw', c.heightWeight, '如：5 尺 8 寸，160 磅') +
    `<div class="field"><label>随身物品 / 备注</label>
     <textarea id="bg-items" placeholder="初始资金、装备、物品…">${esc(c.items)}</textarea></div>`;
  stage().appendChild(wrap);
  const bind = (id, key) => {
    $('#' + id).addEventListener('input', (e) => { c[key] = e.target.value; save(); });
  };
  bind('bg-name', 'bgName'); bind('bg-text', 'bgText'); bind('bg-lang', 'bgLanguage');
  bind('bg-age', 'age'); bind('bg-gender', 'gender'); bind('bg-align', 'alignment');
  bind('bg-faith', 'faith'); bind('bg-hw', 'heightWeight'); bind('bg-items', 'items');
}

/* ---------- 步骤5 技能 ---------- */
function renderSkills() {
  const c = state.char;
  const k = klass();
  const count = el('div', 'skill-count');
  stage().appendChild(count);
  const list = el('div');
  stage().appendChild(list);
  const paint = () => {
    const chosen = skillChosen();
    const quota = skillQuota();
    count.innerHTML = `已选熟练 <b class="${chosen > quota ? 'over' : ''}">${chosen}</b> / ${quota} 项
      <span style="color:var(--sub)">（职业 ${k ? k.core.skillsCount || 0 : 0} + 背景 2 + 智力额外 ${Math.max(0, quota - 2 - (k ? k.core.skillsCount || 0 : 0))}）</span>`;
    list.innerHTML = '';
    for (const s of DATA.rules.skills) {
      const lv = c.skills[s.name] || 0;
      const fixed = k && k.core.skillsFixed && k.core.skillsFixed.includes(s.name);
      const row = el('div', 'skill-row');
      row.innerHTML = `<span class="s-name">${esc(s.name)}${fixed ? ' <span title="职业固定">★</span>' : ''}</span>
        <span class="s-attr">${s.attr}</span>
        <span class="s-mod">${skillMod(s.name) >= 0 ? '+' : ''}${skillMod(s.name)}
          ${lv === 1 ? '<span style="color:var(--good)">（熟练）</span>' : lv === 2 ? '<span style="color:var(--acc)">（专精）</span>' : ''}</span>
        <span class="s-toggle">
          <button type="button" data-lv="0" class="${lv === 0 ? 'sel' : ''}">无</button>
          <button type="button" data-lv="1" class="${lv === 1 ? 'sel' : ''}">熟练</button>
          <button type="button" data-lv="2" class="${lv === 2 ? 'sel' : ''}">专精</button>
        </span>`;
      row.querySelector('.s-toggle').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-lv]');
        if (!b) return;
        if (fixed && +b.dataset.lv === 0) { toast('该技能为职业固定熟练项'); return; }
        c.skills[s.name] = +b.dataset.lv;
        save(); paint();
      });
      list.appendChild(row);
    }
  };
  // 职业固定项自动预选（仅首次进入）
  if (k && k.core.skillsFixed) {
    let touched = false;
    for (const f of k.core.skillsFixed) {
      if (DATA.rules.skills.some(s => s.name === f) && !c.skills[f]) { c.skills[f] = 1; touched = true; }
    }
    if (touched) save();
  }
  paint();
}

/* ---------- 步骤6 专长 ---------- */
function renderFeats() {
  const c = state.char;
  const q = el('div', 'search-bar');
  q.innerHTML = `<input type="search" id="feat-q" placeholder="搜索专长…">
    <select id="feat-cat"><option value="">全部分类</option></select>`;
  stage().appendChild(q);
  const cats = [...new Set(DATA.feats.map(f => f.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const catSel = $('#feat-cat', q);
  cats.forEach(cat => catSel.insertAdjacentHTML('beforeend', `<option>${esc(cat)}</option>`));
  const quota = el('div', 'feat-quota');
  stage().appendChild(quota);
  const extra = el('div', 'field');
  extra.innerHTML = `<label>额外专长数量（来自独狼、和平誓言、"获得专长的专长"等能力）</label>
    <input type="number" id="feat-extra" min="0" max="20" value="${c.extraFeats || 0}" style="width:90px">
    <div class="f-hint">基础配额按等级自动计算（1级2个、每3级+1），此处可补充特殊来源获得的额外专长。</div>`;
  stage().appendChild(extra);
  $('#feat-extra').addEventListener('input', (e) => {
    c.extraFeats = Math.max(0, Math.min(20, +e.target.value || 0));
    save(); paint();
  });
  const list = el('div');
  stage().appendChild(list);

  const paint = () => {
    const max = featQuota();
    const base = featBaseQuota();
    quota.innerHTML = `本等级基础专长 <b>${base}</b> 个${c.extraFeats ? ` + 额外 <b>${c.extraFeats}</b>` : ''}，共 <b>${max}</b> 个，已选 <b>${c.feats.length}</b> 个。`;
    const kw = ($('#feat-q', q) || {}).value || '';
    const cat = ($('#feat-cat', q) || {}).value || '';
    list.innerHTML = '';
    for (const f of DATA.feats) {
      if (cat && f.category !== cat) continue;
      if (kw && !(f.name.includes(kw) || f.text.includes(kw))) continue;
      const sel = c.feats.includes(f.name);
      const item = el('div', 'feat-item' + (sel ? ' sel' : ''));
      const lines = f.text.split('\n');
      const prereq = lines.find(l => /^先决条件/.test(l)) || '';
      const desc = lines.filter(l => !/^先决条件/.test(l)).join('\n');
      item.innerHTML = `<div class="fi-head">
          <span class="fi-name">${esc(f.name)}</span>
          <span class="fi-cat">${esc(f.category || '')}${f.sub ? ' · ' + esc(f.sub) : ''}</span>
          <button type="button" class="nav-btn" style="padding:3px 12px;font-size:12px">${sel ? '移除' : '选择'}</button>
        </div>
        ${prereq ? `<div class="fi-text" style="color:var(--warn)">${esc(prereq)}</div>` : ''}
        <div class="fi-text">${esc(desc.length > 200 ? desc.slice(0, 200) + '…' : desc)}</div>`;
      item.querySelector('button').addEventListener('click', () => {
        if (sel) {
          c.feats = c.feats.filter(x => x !== f.name);
        } else {
          if (c.feats.length >= max) { toast(`专长数量已达上限（${max} 个）；若有额外来源可在上方"额外专长数量"中补充`); return; }
          c.feats.push(f.name);
        }
        save(); paint();
      });
      list.appendChild(item);
    }
  };
  q.addEventListener('input', paint);
  q.addEventListener('change', paint);
  paint();
}

/* ---------- 步骤7 法术 ---------- */
function classSpellList() {
  const k = klass();
  if (!k) return null;
  return DATA['class-spells'].find(cs => cs.class === k.name) || null;
}
function renderSpells() {
  const c = state.char;
  const k = klass();
  const cs = classSpellList();
  if (!k) {
    stage().insertAdjacentHTML('beforeend', `<p class="hint">请先选择职业。</p>`);
    return;
  }
  if (!cs || !Object.keys(cs.lists || {}).length) {
    stage().insertAdjacentHTML('beforeend', `<p class="hint">${esc(k.name)} 没有标准法术列表（或列表暂未收录）。法术可在角色卡备注中自行记录。</p>`);
    return;
  }
  const total = Object.values(cs.lists).reduce((s, l) => s + l.length, 0);
  const q = el('div', 'search-bar');
  q.innerHTML = `<input type="search" id="spell-q" placeholder="搜索法术…">
    <select id="spell-level"><option value="">全环位</option>
    ${Object.keys(cs.lists).sort((a, b) => a - b).map(l => `<option value="${l}">${l === '0' ? '戏法' : l + ' 环'}</option>`).join('')}</select>`;
  stage().appendChild(q);
  const cnt = el('div', 'skill-count');
  stage().appendChild(cnt);
  const list = el('div');
  stage().appendChild(list);

  const paint = () => {
    cnt.innerHTML = `已选法术 <b>${c.spells.length}</b> 个（共 ${total} 个可选）。已知/准备数量按职业规则（如职业表"已知法术/准备法术"栏）。`;
    const kw = ($('#spell-q', q) || {}).value || '';
    const lv = ($('#spell-level', q) || {}).value || '';
    list.innerHTML = '';
    const levels = Object.keys(cs.lists).sort((a, b) => a - b);
    for (const l of levels) {
      if (lv && lv !== l) continue;
      const names = cs.lists[l];
      const rows = names.filter(n => !kw || n.includes(kw));
      if (!rows.length) continue;
      const sec = el('div');
      sec.style.marginBottom = '10px';
      sec.innerHTML = `<h4 style="margin:8px 0 4px;color:var(--acc)">${l === '0' ? '0环（戏法）' : l + ' 环'}</h4>`;
      for (const n of rows) {
        const spell = DATA.spells.find(s => s.name === n);
        const sel = c.spells.includes(n);
        const item = el('div', 'feat-item' + (sel ? ' sel' : ''));
        item.innerHTML = `<div class="fi-head">
            <span class="fi-name">${esc(n)}</span>
            <span class="fi-cat">${spell ? (spell.level === 0 ? '戏法' : spell.level + '环') + ' · ' + esc(spell.school || '') : ''}</span>
            <button type="button" class="nav-btn" style="padding:3px 12px;font-size:12px">${sel ? '移除' : '选择'}</button>
          </div>
          ${spell && spell.text ? `<div class="fi-text">${esc(spell.text.split('\n').slice(1).join('\n').slice(0, 140))}${spell.text.length > 140 ? '…' : ''}</div>` : ''}`;
        item.querySelector('button').addEventListener('click', () => {
          if (sel) c.spells = c.spells.filter(x => x !== n);
          else c.spells.push(n);
          save(); paint();
        });
        sec.appendChild(item);
      }
      list.appendChild(sec);
    }
  };
  q.addEventListener('input', paint);
  q.addEventListener('change', paint);
  paint();
}

/* ---------- 步骤8 战技 ---------- */
function renderManeuvers() {
  const c = state.char;
  const styles = [...new Set(DATA.maneuvers.map(m => m.style))];
  const seg = el('div', 'seg');
  seg.innerHTML = `<button type="button" data-s="" class="${!c.maneuverStyle ? 'sel' : ''}">（未选择）</button>` +
    styles.map(s => `<button type="button" data-s="${s}" class="${c.maneuverStyle === s ? 'sel' : ''}">${s}</button>`).join('');
  stage().appendChild(seg);
  stage().insertAdjacentHTML('beforeend', `<p class="hint" style="margin-top:0">流派入门需要对应专长（如"游龙流及门弟子"），可在专长步骤选择。散人流为特殊流派（习得其它流派战技）。</p>`);
  const cnt = el('div', 'skill-count');
  stage().appendChild(cnt);
  const list = el('div');
  stage().appendChild(list);
  const paint = () => {
    cnt.innerHTML = `已选战技 <b>${c.maneuvers.length}</b> 个。卓越骰数量与准备战技数按流派规则（如角色卡"战技"栏）。`;
    list.innerHTML = '';
    const st = c.maneuverStyle;
    const items = st ? DATA.maneuvers.filter(m => m.style === st) : DATA.maneuvers;
    const groups = {};
    for (const m of items) {
      const key = m.level + '·' + m.type;
      (groups[key] = groups[key] || []).push(m);
    }
    for (const key of Object.keys(groups).sort((a, b) => a.localeCompare(b))) {
      const sec = el('div');
      sec.style.marginBottom = '10px';
      sec.innerHTML = `<h4 style="margin:8px 0 4px;color:var(--acc)">${esc(key)}</h4>`;
      for (const m of groups[key]) {
        const sel = c.maneuvers.includes(m.name);
        const item = el('div', 'feat-item' + (sel ? ' sel' : ''));
        item.innerHTML = `<div class="fi-head">
            <span class="fi-name">${esc(m.name)}</span>
            <span class="fi-cat">${esc(m.style)}</span>
            <button type="button" class="nav-btn" style="padding:3px 12px;font-size:12px">${sel ? '移除' : '选择'}</button>
          </div>`;
        item.querySelector('button').addEventListener('click', () => {
          if (sel) c.maneuvers = c.maneuvers.filter(x => x !== m.name);
          else c.maneuvers.push(m.name);
          save(); paint();
        });
        sec.appendChild(item);
      }
      list.appendChild(sec);
    }
  };
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-s]');
    if (!b) return;
    c.maneuverStyle = b.dataset.s;
    save(); paint();
  });
  paint();
}

/* ---------- 步骤9 程序（赛博格） ---------- */
const PROTOCOLS = ['阿尔法', '贝塔', '伽马', '德尔塔', '伊普西隆', '泽塔', '欧米伽'];
function renderPrograms() {
  const c = state.char;
  const k = klass();
  if (!k || k.id !== '赛博格') {
    stage().insertAdjacentHTML('beforeend', `<p class="hint">程序系统为赛博格职业专属。当前职业 ${k ? esc(k.name) : '未选择'} 无需选择程序，可直接下一步。</p>`);
    return;
  }
  const seg = el('div', 'seg');
  seg.innerHTML = PROTOCOLS.map(p =>
    `<button type="button" data-p="${p}" class="${c.programProtocol === p ? 'sel' : ''}">${p}</button>`).join('');
  stage().appendChild(seg);
  stage().insertAdjacentHTML('beforeend', `<p class="hint" style="margin-top:0">最高可掌握协议层级与准备程序数量见赛博格职业表。阿尔法为初始层级。</p>`);
  const cnt = el('div', 'skill-count');
  stage().appendChild(cnt);
  const list = el('div');
  stage().appendChild(list);
  const paint = () => {
    cnt.innerHTML = `已选程序 <b>${c.programs.length}</b> 个。`;
    list.innerHTML = '';
    const p = c.programProtocol || '阿尔法';
    const items = DATA.programs.filter(x => x.protocol === p);
    for (const m of items) {
      const sel = c.programs.includes(m.name);
      const item = el('div', 'feat-item' + (sel ? ' sel' : ''));
      item.innerHTML = `<div class="fi-head">
          <span class="fi-name">${esc(m.name)}</span>
          <span class="fi-cat">${esc(m.module || '无模块')} · ${esc(m.act || '')}</span>
          <button type="button" class="nav-btn" style="padding:3px 12px;font-size:12px">${sel ? '移除' : '选择'}</button>
        </div>
        ${m.text ? `<div class="fi-text">${esc(m.text.slice(0, 120))}</div>` : ''}`;
      item.querySelector('button').addEventListener('click', () => {
        if (sel) c.programs = c.programs.filter(x => x !== m.name);
        else c.programs.push(m.name);
        save(); paint();
      });
      list.appendChild(item);
    }
  };
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]');
    if (!b) return;
    c.programProtocol = b.dataset.p;
    save(); paint();
  });
  paint();
}

/* ---------- 步骤10 角色卡 ---------- */
function renderSheet() {
  const c = state.char;
  const s = stage();
  const sheet = el('div', 'sheet');
  const r = race();
  const k = klass();
  sheet.innerHTML = `<h2>${esc(c.name || '未命名角色')}</h2>
    <p class="muted">${esc(c.player ? '玩家：' + c.player : '')}${c.level ? ' · ' + c.level + ' 级' : ''}${k ? ' · ' + esc(k.name) : ''}${c.subclass ? '（' + esc(c.subclass) + '）' : ''}${r ? ' · ' + esc(r.name) : ''}</p>`;

  // —— 属性 ——
  const saveRows = ATTRS.map(a => {
    const prof = k && k.core.saveList.includes(a);
    return `<tr><td>${a}</td><td>${c.base[a]}</td><td>${c.manual[a] || 0}</td>
      <td>${levelUpBonus(a) ? '+' + levelUpBonus(a) : '0'}</td><td><b>${finalAttr(a)}</b></td>
      <td>${finalMod(a) >= 0 ? '+' : ''}${finalMod(a)}</td>
      <td>${prof ? '有' : '无'}</td><td>${saveMod(a) >= 0 ? '+' : ''}${saveMod(a)}</td></tr>`;
  }).join('');
  sheet.insertAdjacentHTML('beforeend', `<div class="sheet-sec"><h3>属性</h3><table>
    <tr><th>属性</th><th>基础</th><th>种族/专长调整</th><th>升级提升</th><th>最终值</th><th>调整值</th><th>豁免熟练</th><th>豁免总值</th></tr>
    ${saveRows}
  </table></div>`);

  // —— 职业 ——
  const rSpeed = r ? r.traits.find(t => /^速度/.test(t.name)) : null;
  sheet.insertAdjacentHTML('beforeend', `<div class="sheet-sec"><h3>职业与等级</h3>
    <div class="kvs">
      <div class="kv"><span class="k">职业</span><span class="v">${k ? esc(k.name) : '—'}${c.subclass ? '（' + esc(c.subclass) + '）' : ''}</span></div>
      <div class="kv"><span class="k">等级</span><span class="v">${c.level}</span></div>
      <div class="kv"><span class="k">熟练加值</span><span class="v">+${profBonus()}</span></div>
      <div class="kv"><span class="k">生命值上限</span><span class="v">${hpMax()}</span></div>
      <div class="kv"><span class="k">生命骰</span><span class="v">D${hitDie()} × ${c.level}</span></div>
      <div class="kv"><span class="k">生命骰数量</span><span class="v">${c.level}</span></div>
      <div class="kv"><span class="k">防具熟练</span><span class="v">${k ? esc(k.core.armor || '—') : '—'}</span></div>
      <div class="kv"><span class="k">武器熟练</span><span class="v">${k ? esc(k.core.weapons || '—') : '—'}</span></div>
    </div>
    ${k && k.tableTitle ? `<h4 style="margin:10px 0 4px">${esc(k.tableTitle)}</h4><div class="table-wrap"><table class="data">` +
      k.table.map((row, i) => '<tr>' + row.map(cell => i === 0 ? `<th>${esc(cell)}</th>` : `<td>${esc(cell)}</td>`).join('') + '</tr>').join('') +
      `</table></div>` : ''}
  </div>`);

  // —— 战斗数据 ——
  const acName = { naked: '裸体', light: '轻甲', medium: '中甲', heavy: '重甲', mage: '法师护甲', monk: '武僧无甲', barb: '狂战士无甲' }[c.armorType] || '裸体';
  sheet.insertAdjacentHTML('beforeend', `<div class="sheet-sec"><h3>战斗数据</h3>
    <div class="kvs">
      <div class="kv"><span class="k">防御等级 AC</span><span class="v">${acValue()}</span></div>
      <div class="kv"><span class="k">AC 来源</span><span class="v">${acName}${c.shield ? ' + 盾牌' : ''}${c.armorBonus ? ' + 其它 ' + c.armorBonus : ''}</span></div>
      <div class="kv"><span class="k">先攻</span><span class="v">${initBonus() >= 0 ? '+' : ''}${initBonus()}</span></div>
      <div class="kv"><span class="k">法术豁免 DC</span><span class="v">${spellDC()}</span></div>
      <div class="kv"><span class="k">法术攻击加值</span><span class="v">${spellAttack() >= 0 ? '+' : ''}${spellAttack()}</span></div>
      <div class="kv"><span class="k">施法关键属性</span><span class="v">${c.keyAttr}</span></div>
      ${rSpeed ? `<div class="kv"><span class="k">速度</span><span class="v">${esc(rSpeed.text.slice(0, 46))}</span></div>` : ''}
    </div>
  </div>`);

  // —— 种族特性 ——
  if (r) {
    sheet.insertAdjacentHTML('beforeend', `<div class="sheet-sec"><h3>种族特性（${esc(r.name)}）</h3>
      <table><tr><th style="width:110px">特性</th><th>效果</th></tr>
      ${r.traits.filter(t => t.name).map(t => `<tr><td>${esc(t.name)}</td><td class="t-text">${esc(t.text)}</td></tr>`).join('')}
      </table></div>`);
  }

  // —— 技能 ——
  const skillGroups = [['力量系', ['运动', '威吓']], ['敏捷系', ['体操', '巧手', '隐匿']],
    ['智力系', ['奥秘', '灵能', '历史', '调查', '自然', '宗教', '表演']],
    ['感知系', ['医药', '洞悉', '察觉', '求生', '交涉']]];
  const skillRows = skillGroups.map(([g, names]) =>
    `<tr><th rowspan="${names.length}">${g}</th>` +
    names.map((n, i) => {
      const lv = c.skills[n] || 0;
      return `${i ? '</tr><tr>' : ''}<td>${n}</td><td>${skillMod(n) >= 0 ? '+' : ''}${skillMod(n)}</td>
        <td>${lv === 1 ? '熟练' : lv === 2 ? '专精' : '—'}</td>`;
    }).join('') + '</tr>').join('');
  sheet.insertAdjacentHTML('beforeend', `<div class="sheet-sec"><h3>技能（${skillChosen()} / ${skillQuota()}）</h3>
    <table><tr><th>分类</th><th>技能</th><th>总值</th><th>状态</th></tr>${skillRows}</table>
    <p class="muted" style="margin-top:6px">注意：规则书技能为 17 项（感知系：医药/洞悉/察觉/求生/交涉）。
    官方 Excel 模板为 19 行（含驯兽/游说/欺瞒），导出时将自动映射：求生→生存、交涉→游说，模板独有项留空。</p>
  </div>`);

  // —— 专长 ——
  sheet.insertAdjacentHTML('beforeend', `<div class="sheet-sec"><h3>专长（${c.feats.length} / ${featQuota()}）</h3>
    ${c.feats.length ? `<table><tr><th>等级</th><th>名称</th><th>效果摘要</th></tr>` +
      c.feats.map((fn, i) => {
        const f = DATA.feats.find(x => x.name === fn);
        const lv = [1, 1, 3, 6, 9, 12, 15, 18][i] || '';
        return `<tr><td>${lv}</td><td><b>${esc(fn)}</b></td><td>${f ? esc(f.text.split('\n')[0]) : ''}</td></tr>`;
      }).join('') + '</table>' : '<p class="muted">未选择专长</p>'}
  </div>`);

  // —— 1 级职业特性 ——
  if (k) {
    const lv1 = (k.table.find(row => row[0] === '1') || [])[1] || '';
    const feats1 = lv1 ? lv1.split(/[，,、]/) : [];
    const featTexts = k.features.filter(f => feats1.includes(f.name));
    if (featTexts.length) {
      sheet.insertAdjacentHTML('beforeend', `<div class="sheet-sec"><h3>1 级职业特性</h3>
        ${featTexts.map(f => `<div class="trait"><span class="t-name">${esc(f.name)}</span>　<span class="t-text">${esc(f.text)}</span></div>`).join('')}
        <p class="muted">更多等级特性见职业表与规则书页面：<a href="${esc(k.url)}" target="_blank">${esc(k.name)}</a></p>
      </div>`);
    }
  }

  // —— 法术 ——
  if (c.spells.length) {
    const byLv = {};
    for (const n of c.spells) {
      const sp = DATA.spells.find(s => s.name === n);
      const lv = sp ? sp.level : -1;
      (byLv[lv] = byLv[lv] || []).push(sp || { name: n, text: '' });
    }
    sheet.insertAdjacentHTML('beforeend', `<div class="sheet-sec"><h3>法术（${c.spells.length}）</h3>
      <table><tr><th>环阶</th><th>名称</th><th>学派</th><th>简介</th></tr>
      ${Object.keys(byLv).sort((a, b) => a - b).map(lv =>
        byLv[lv].map(sp => `<tr><td>${lv === 0 ? '戏法' : lv < 0 ? '?' : lv + '环'}</td><td><b>${esc(sp.name)}</b></td><td>${esc(sp.school || '')}</td>
          <td class="t-text">${esc((sp.text || '').split('\n').slice(1).join('\n').slice(0, 80))}</td></tr>`).join('')).join('')}
      </table></div>`);
  }

  // —— 战技 ——
  if (c.maneuvers.length) {
    const rows = c.maneuvers.map(n => {
      const m = DATA.maneuvers.find(x => x.name === n);
      return `<tr><td>${m ? esc(m.style) : ''}</td><td>${m ? esc(m.level + '·' + m.type) : ''}</td><td><b>${esc(n)}</b></td></tr>`;
    }).join('');
    sheet.insertAdjacentHTML('beforeend', `<div class="sheet-sec"><h3>战技（${c.maneuvers.length}）${c.maneuverStyle ? '　流派：' + esc(c.maneuverStyle) : ''}</h3>
      <table><tr><th>流派</th><th>级别/类型</th><th>名称</th></tr>${rows}</table></div>`);
  }

  // —— 程序 ——
  if (c.programs.length) {
    const rows = c.programs.map(n => {
      const m = DATA.programs.find(x => x.name === n);
      return `<tr><td>${m ? esc(m.protocol) : ''}</td><td>${m ? esc(m.module || '') : ''}</td><td><b>${esc(n)}</b></td><td>${m ? esc(m.text.slice(0, 60)) : ''}</td></tr>`;
    }).join('');
    sheet.insertAdjacentHTML('beforeend', `<div class="sheet-sec"><h3>程序（${c.programs.length}）</h3>
      <table><tr><th>协议</th><th>模块</th><th>名称</th><th>简介</th></tr>${rows}</table></div>`);
  }

  // —— 背景与扮演 ——
  sheet.insertAdjacentHTML('beforeend', `<div class="sheet-sec"><h3>背景与扮演</h3>
    <div class="kvs">
      ${c.bgName ? `<div class="kv"><span class="k">背景</span><span class="v">${esc(c.bgName)}</span></div>` : ''}
      ${c.bgLanguage ? `<div class="kv"><span class="k">额外语言</span><span class="v">${esc(c.bgLanguage)}</span></div>` : ''}
      ${c.alignment ? `<div class="kv"><span class="k">阵营</span><span class="v">${esc(c.alignment)}</span></div>` : ''}
      ${c.age ? `<div class="kv"><span class="k">年龄</span><span class="v">${esc(c.age)}</span></div>` : ''}
      ${c.gender ? `<div class="kv"><span class="k">性别</span><span class="v">${esc(c.gender)}</span></div>` : ''}
      ${c.faith ? `<div class="kv"><span class="k">信仰</span><span class="v">${esc(c.faith)}</span></div>` : ''}
      ${c.heightWeight ? `<div class="kv"><span class="k">身高体重</span><span class="v">${esc(c.heightWeight)}</span></div>` : ''}
    </div>
    ${c.bgText ? `<p><b>背景特性：</b>${esc(c.bgText)}</p>` : ''}
    ${c.items ? `<p><b>随身物品：</b>${esc(c.items)}</p>` : ''}
    ${c.notes ? `<p><b>备注：</b>${esc(c.notes)}</p>` : ''}
    ${c.traitsNote ? `<p><b>法术/战技/程序：</b>${esc(c.traitsNote)}</p>` : ''}
  </div>`);

  s.appendChild(sheet);
  s.appendChild(el('div', 'field', `
    <label>备注 / 法术 / 战技 / 程序（可粘贴规则书文本）</label>
    <textarea id="sheet-notes" placeholder="记录你携带的法术描述、战技、程序、物品效果等…">${esc(c.traitsNote)}</textarea>`));
  $('#sheet-notes').addEventListener('input', (e) => { c.traitsNote = e.target.value; save(); });
  const btns = el('div');
  btns.style.cssText = 'display:flex;gap:10px;margin-top:14px;flex-wrap:wrap';
  btns.innerHTML = `<button type="button" class="nav-btn primary" id="btn-print">🖨 打印角色卡</button>
    <button type="button" class="nav-btn" id="btn-xlsx">⬇ 导出 Excel 角色卡</button>`;
  s.appendChild(btns);
  $('#btn-print').addEventListener('click', () => window.print());
  $('#btn-xlsx').addEventListener('click', exportExcel);
}

/* ---------- 实时预览 ---------- */
function renderLive() {
  const live = $('#live');
  const c = state.char;
  const r = race();
  const k = klass();
  let h = `<h3>👤 角色预览</h3>`;
  h += `<div class="live-section">
    <div class="live-row"><span>姓名</span><b>${esc(c.name || '未命名')}</b></div>
    <div class="live-row"><span>等级</span><b>${c.level} 级</b></div>
    <div class="live-row"><span>职业</span><b>${k ? esc(k.name) + (c.subclass ? '·' + esc(c.subclass) : '') : '—'}</b></div>
    <div class="live-row"><span>种族</span><b>${r ? esc(r.name) : '—'}</b></div>
    <div class="live-row"><span>熟练加值</span><b>+${profBonus()}</b></div>
    <div class="live-row"><span>生命值上限</span><b>${k ? hpMax() : '—'}</b></div>
    <div class="live-row"><span>防御等级</span><b>${k ? acValue() : '—'}</b></div>
  </div>`;
  h += `<div class="live-section"><h4>属性</h4><div class="live-attr">` +
    ATTRS.map(a => `<span>${a} ${finalAttr(a)}<small>${finalMod(a) >= 0 ? '+' : ''}${finalMod(a)}</small></span>`).join('') +
    `</div></div>`;
  h += `<div class="live-section"><h4>豁免 / 技能</h4>`;
  h += `<div class="live-row"><span>豁免</span><b>${ATTRS.map(a => a + (saveMod(a) >= 0 ? '+' : '') + saveMod(a)).join(' ')}</b></div>`;
  h += `<div class="live-row"><span>技能熟练</span><b>${skillChosen()} / ${skillQuota()}</b></div>`;
  h += `<div class="live-row"><span>专长</span><b>${c.feats.length} / ${featQuota()}</b></div>`;
  h += `<div class="live-row"><span>法术</span><b>${c.spells.length}</b></div>`;
  h += `<div class="live-row"><span>战技</span><b>${c.maneuvers.length}${c.maneuverStyle ? '（' + esc(c.maneuverStyle) + '）' : ''}</b></div>`;
  h += `<div class="live-row"><span>程序</span><b>${c.programs.length}</b></div>`;
  h += `</div>`;
  live.innerHTML = h;
}

/* ---------- Excel 导出（基于官方模板 dnd5z人物卡模板改.xlsx 填值） ---------- */
// 模板中的输入格坐标（浅白/浅蓝格）；公式格（浅绿）不填，Excel 打开自动重算
// 标签在 B/R 列，输入格在 C/S 列（sheet1 角色页）
const TPL = {
  sheet1: {
    C3: () => state.char.name, C4: () => state.char.player,
    C6: () => traitVal(/^生物类型/), C7: () => (race() || {}).name || '', C8: () => '',
    S3: () => state.char.bgName, S4: () => state.char.alignment, S5: () => state.char.faith,
    S6: () => '', S7: () => '', S8: () => '', S9: () => '',
    S10: () => skillSummary(), S11: () => langSummary(), S12: () => state.char.bgText,
  },
  sheet2: {
    D5: () => finalAttr('力量'), D7: () => finalAttr('敏捷'), D9: () => finalAttr('体质'),
    D11: () => finalAttr('智力'), D13: () => finalAttr('感知'),
    F5: () => saveCell('力量'), F7: () => saveCell('敏捷'), F9: () => saveCell('体质'),
    F11: () => saveCell('智力'), F13: () => saveCell('感知'),
    K7: () => (klass() || {}).name || '', R7: () => state.char.subclass, W7: () => state.char.level,
    I20: () => ({ naked: '无盔甲', light: '镶钉皮甲', medium: '半身板甲', heavy: '板甲',
      mage: '法师护甲', monk: '武僧无甲防御', barb: '狂战士无甲防御' }[state.char.armorType] || '无盔甲'),
    I21: () => state.char.shield ? '有盾牌' : '无盾牌',
    I30: () => speedValue(),
    AH5: () => traitVal(/^生物类型/), AH6: () => traitVal(/^属性值/),
    AH7: () => traitVal(/^体型/), AH14: () => traitVal(/^语言/),
    // 技能行映射：模板 19 行，规则书 17 项（求生→生存、交涉→游说；驯兽/欺瞒模板独有留空）
    D18: () => skillCell('运动'), D19: () => skillCell('威吓'),
    D21: () => skillCell('体操'), D22: () => skillCell('巧手'), D23: () => skillCell('隐匿'),
    D25: () => skillCell('奥秘'), D26: () => skillCell('灵能'), D27: () => skillCell('宗教'),
    D28: () => skillCell('历史'), D29: () => skillCell('自然'), D30: () => skillCell('调查'),
    D31: () => skillCell('表演'),
    D33: () => skillCell('察觉'), D34: () => skillCell('洞悉'), D35: () => skillCell('医药'),
    D36: () => skillCell('生存'), D38: () => skillCell('游说'),
  },
};
// 专长：行 18/19=1级、20=3级、21=6级、22=9级、23=12级、24=15级、25=18级
const FEAT_ROWS = [18, 19, 20, 21, 22, 23, 24, 25];
const SAVE_ROWS = { 力量: 'F5', 敏捷: 'F7', 体质: 'F9', 智力: 'F11', 感知: 'F13' };

function traitVal(re) {
  const r = race();
  if (!r) return '';
  const t = r.traits.find(x => x.name && re.test(x.name));
  return t ? t.text : '';
}
function saveCell(attr) {
  const k = klass();
  return k && k.core.saveList.includes(attr) ? '有' : '无';
}
function skillCell(tplName) {
  const ruleName = { 生存: '求生', 游说: '交涉' }[tplName] || tplName;
  const lv = state.char.skills[ruleName] || 0;
  return lv === 2 ? '专精' : lv === 1 ? '熟练' : '无';
}
function speedValue() {
  const r = race();
  if (!r) return '';
  const t = r.traits.find(x => x.name && /^速度/.test(x.name));
  if (!t) return '';
  const m = /(\d+)\s*尺/.exec(t.text);
  return m ? +m[1] : '';
}
function skillSummary() {
  const list = [];
  for (const sk of DATA.rules.skills) {
    const lv = state.char.skills[sk.name] || 0;
    if (lv >= 1) list.push(sk.name + (lv === 2 ? '（专精）' : ''));
  }
  return list.join('、') || '';
}
function langSummary() {
  const parts = [];
  const l = traitVal(/^语言/);
  if (l) parts.push(l.replace(/^语言。?/, '').split('。')[0]);
  if (state.char.bgLanguage) parts.push(state.char.bgLanguage);
  return parts.join('；') || '';
}
function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}
function colNum(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return [n, +m[2]];
}
function setCellXml(sheetXml, ref, idxOrNum, isNum) {
  const val = `<v>${idxOrNum}</v>`;
  const tAttr = isNum ? '' : ' t="s"';
  // 1) 自闭合单元格 <c r="REF" s="N" />（模板大量使用；必须先于完整格式检测，
  //    否则完整格式正则会把"自闭合 + 其后直到下一个 </c> 的大段"误匹配并删除）
  const selfRe = new RegExp(`<c r="${ref}"[^>]*?\\/>`);
  if (selfRe.test(sheetXml)) {
    return sheetXml.replace(selfRe, (open) => {
      const sAttr = / s="[^"]*"/.exec(open);
      return `<c r="${ref}"${sAttr ? sAttr[0] : ''}${tAttr}>${val}</c>`;
    });
  }
  // 2) 完整单元格 <c r="REF" s="N">...</c>
  const fullRe = new RegExp(`<c r="${ref}"[^>]*>[\\s\\S]*?<\\/c>`);
  if (fullRe.test(sheetXml)) {
    return sheetXml.replace(fullRe, (full) => {
      const sAttr = / s="[^"]*"/.exec(full);
      return `<c r="${ref}"${sAttr ? sAttr[0] : ''}${tAttr}>${val}</c>`;
    });
  }
  // 3) 新增单元格：插入到对应行（按列序）
  const [col, row] = colNum(ref);
  const rowRe = new RegExp(`(<row r="${row}"[^>]*>)([\\s\\S]*?)(<\\/row>)`);
  const m = rowRe.exec(sheetXml);
  if (!m) return sheetXml; // 行不存在则跳过
  const cell = `<c r="${ref}"${tAttr}>${val}</c>`;
  const inner = m[2];
  const cellRe = /<c r="([A-Z]+)(\d+)"[^>]*>/g;
  let insertAt = inner.length;
  let cm;
  while ((cm = cellRe.exec(inner)) !== null) {
    const c2 = colNum(cm[1] + cm[2])[0];
    if (c2 > col) { insertAt = cm.index; break; }
  }
  const newInner = inner.slice(0, insertAt) + cell + inner.slice(insertAt);
  return sheetXml.replace(rowRe, `$1${newInner}$3`);
}
function stripFormulaCache(sheetXml) {
  // 删除公式格缓存值，强制 Excel 打开后重算（双保险：另设 fullCalcOnLoad）
  return sheetXml.replace(/(<f>[\s\S]*?<\/f>)<v>[\s\S]*?<\/v>/g, '$1');
}

function exportExcel() {
  if (!window.__TPL_XLSX_B64__) { toast('缺少 Excel 模板数据，无法导出'); return; }
  if (typeof fflate === 'undefined') { toast('缺少 zip 组件，无法导出'); return; }
  const c = state.char;
  if (!c.raceId && !c.classId) { toast('请先完成种族/职业选择'); return; }
  toast('正在生成 Excel…');
  try {
    const out = buildXlsx();
    const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (c.name || '角色') + '.xlsx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('已导出 Excel 角色卡 ✓');
  } catch (e) {
    console.error(e);
    toast('导出失败：' + (e && e.message ? e.message : e));
  }
}

// 生成填好值的 xlsx（Uint8Array）。独立函数便于自动化测试。
function buildXlsx() {
  const c = state.char;
  const k = klass();
  // 1. 解压模板
  const bin = atob(window.__TPL_XLSX_B64__);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const files = fflate.unzipSync(bytes);
  const dec = new TextDecoder('utf-8');
  const enc = new TextEncoder();

  // 2. 收集所有新文本与填值
  const newTexts = [];
  const values = { sheet1: {}, sheet2: {}, sheet5: {}, sheet6: {} };
  for (const [sheet, map] of [['sheet1', TPL.sheet1], ['sheet2', TPL.sheet2]]) {
    for (const ref of Object.keys(map)) {
      const v = map[ref]();
      if (v === '' || v == null) continue;
      values[sheet][ref] = v;
      if (typeof v !== 'number') newTexts.push(String(v));
    }
  }
  // 专长（sheet2 AF/AJ 列）
  c.feats.forEach((fn, i) => {
    if (i >= FEAT_ROWS.length) return;
    const row = FEAT_ROWS[i];
    newTexts.push(fn);
    values.sheet2['AF' + row] = fn;
    const f = DATA.feats.find(x => x.name === fn);
    if (f) { const s = f.text.split('\n')[0]; newTexts.push(s); values.sheet2['AJ' + row] = s; }
  });
  // 法术表（sheet5）：A=名称 E=环阶 G=详述 AL=来源（数据行从第 5 行起）
  c.spells.forEach((n, i) => {
    const sp = DATA.spells.find(s => s.name === n);
    const row = 5 + i;
    newTexts.push(n);
    values.sheet5['A' + row] = n;
    if (sp) {
      values.sheet5['E' + row] = sp.level;
      if (sp.text) { newTexts.push(sp.text); values.sheet5['G' + row] = sp.text; }
    }
    if (k) { newTexts.push(k.name); values.sheet5['AL' + row] = k.name; }
  });
  // 战技表（sheet6）：A=名称 E=级别 G=详述（数据行从第 4 行起）
  c.maneuvers.forEach((n, i) => {
    const m = DATA.maneuvers.find(x => x.name === n);
    const row = 4 + i;
    newTexts.push(n);
    values.sheet6['A' + row] = n;
    if (m) {
      newTexts.push(m.level);
      values.sheet6['E' + row] = m.level;
      const d = m.style + '·' + m.type;
      newTexts.push(d);
      values.sheet6['G' + row] = d;
    }
  });

  // 3. sharedStrings：追加新字符串
  let ssXml = dec.decode(files['xl/sharedStrings.xml']);
  const strIdx = {};
  const existingRe = /<si>[\s\S]*?<\/si>/g;
  let siCount = 0;
  let em;
  while ((em = existingRe.exec(ssXml)) !== null) {
    const tm = /<t[^>]*>([\s\S]*?)<\/t>/.exec(em[0]);
    if (tm) {
      const t = tm[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      if (!(t in strIdx)) strIdx[t] = siCount;
    }
    siCount++;
  }
  const getIdx = (t) => {
    if (t in strIdx) return strIdx[t];
    const idx = siCount;
    siCount++;
    strIdx[t] = idx;
    ssXml = ssXml.replace(/<\/sst>/, `<si><t>${xmlEsc(t)}</t></si></sst>`);
    return idx;
  };
  for (const t of newTexts) getIdx(t);
  if (newTexts.length) {
    ssXml = ssXml.replace(/(<sst[^>]*?count=")(\d+)/, (m2, p, n) => p + (+n + newTexts.length));
    ssXml = ssXml.replace(/(<sst[^>]*?uniqueCount=")(\d+)/, (m2, p, n) => p + (+n + newTexts.length));
  }

  // 4. 填值 sheet1 / sheet2 / sheet5 / sheet6
  let s1 = dec.decode(files['xl/worksheets/sheet1.xml']);
  let s2 = dec.decode(files['xl/worksheets/sheet2.xml']);
  let s5 = dec.decode(files['xl/worksheets/sheet5.xml']);
  let s6 = dec.decode(files['xl/worksheets/sheet6.xml']);
  for (const ref of Object.keys(values.sheet1)) {
    const v = values.sheet1[ref];
    s1 = setCellXml(s1, ref, typeof v === 'number' ? v : getIdx(v), typeof v === 'number');
  }
  for (const ref of Object.keys(values.sheet2)) {
    const v = values.sheet2[ref];
    s2 = setCellXml(s2, ref, typeof v === 'number' ? v : getIdx(v), typeof v === 'number');
  }
  for (const ref of Object.keys(values.sheet5)) {
    const v = values.sheet5[ref];
    s5 = setCellXml(s5, ref, typeof v === 'number' ? v : getIdx(v), typeof v === 'number');
  }
  for (const ref of Object.keys(values.sheet6)) {
    const v = values.sheet6[ref];
    s6 = setCellXml(s6, ref, typeof v === 'number' ? v : getIdx(v), typeof v === 'number');
  }
  // 5. 清除公式缓存 + 强制打开重算
  s1 = stripFormulaCache(s1);
  s2 = stripFormulaCache(s2);
  s5 = stripFormulaCache(s5);
  s6 = stripFormulaCache(s6);
  let wbXml = dec.decode(files['xl/workbook.xml']);
  wbXml = wbXml.replace(/<calcPr[^>]*\/>/, '<calcPr calcId="191029" fullCalcOnLoad="1"/>');

  // 6. 重新打包
  files['xl/sharedStrings.xml'] = enc.encode(ssXml);
  files['xl/worksheets/sheet1.xml'] = enc.encode(s1);
  files['xl/worksheets/sheet2.xml'] = enc.encode(s2);
  files['xl/worksheets/sheet5.xml'] = enc.encode(s5);
  files['xl/worksheets/sheet6.xml'] = enc.encode(s6);
  files['xl/workbook.xml'] = enc.encode(wbXml);
  return fflate.zipSync(files, { level: 6 });
}
// 自动化测试钩子：接受可选角色覆盖（用于测试），返回导出结果（base64），不触发下载
window.__CAR_EXPORT_TEST__ = (charOverride) => {
  if (!window.__TPL_XLSX_B64__) return '';
  try {
    if (charOverride) state.char = Object.assign(newChar(), charOverride);
    const u8 = buildXlsx();
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < u8.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  } catch (e) { return 'ERROR:' + e.message; }
};

/* ---------- 导出/导入/新建 ---------- */
function exportChar() {
  const c = state.char;
  const data = JSON.stringify({ app: '5z-rule-car', version: (DATA.rules || {}).version || '', char: c }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (c.name || '角色') + '.5zchar.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast('已导出角色 JSON');
}
function importChar() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json';
  inp.onchange = () => {
    const f = inp.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result);
        const ch = data.char || data;
        state.char = Object.assign(newChar(), ch);
        state.step = 7;
        save();
        setStep(7);
        toast('已导入角色');
      } catch (e) { toast('导入失败：文件格式不正确'); }
    };
    rd.readAsText(f);
  };
  inp.click();
}
function newCharAction() {
  if (state.char.name || state.char.raceId || state.char.classId) {
    if (!confirm('确定要清空当前角色并重新车卡吗？')) return;
  }
  state.char = newChar();
  state.step = 1;
  save();
  setStep(1);
}

/* ---------- 启动 ---------- */
async function boot() {
  try {
    await initData();
  } catch (e) {
    stage().innerHTML = `<h2>数据加载失败</h2>
      <p class="hint">未能加载车卡数据。请尝试：
      <br>1. 按 <b>Ctrl+F5</b>（Mac：Cmd+Shift+R）强制刷新本页；
      <br>2. 回到规则书主页，从左侧"🧙 创建角色"入口重新进入（会自动加载最新版本）；
      <br>3. 若仍失败，请通过 http 服务访问本网站（如 GitHub Pages），或重新构建网站。</p>`;
    return;
  }
  load();
  // 数据版本显示（与词典页一致，便于核对数据是否随规则书更新）
  const verEl = $('#car-ver');
  if (verEl && DATA.rules) verEl.textContent = 'v' + DATA.rules.version + ' · 规则书数据';
  // 事件
  $$('.step').forEach(b => b.addEventListener('click', () => setStep(+b.dataset.step)));
  $('#btn-prev').addEventListener('click', () => setStep(Math.max(1, state.step - 1)));
  $('#btn-next').addEventListener('click', () => {
    if (state.step >= 7) { render(); return; }
    setStep(state.step + 1);
  });
  $('#btn-export').addEventListener('click', exportChar);
  $('#btn-export-xlsx').addEventListener('click', exportExcel);
  $('#btn-import').addEventListener('click', importChar);
  $('#btn-new').addEventListener('click', newCharAction);
  window.addEventListener('beforeunload', save);
  setStep(state.step);
}
boot();
})();
