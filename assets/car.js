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
    name: '', player: '', level: 1, portrait: '',
    raceId: null, classId: null, subclass: '', raceTraining: '', subrace: '',
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
    prepared: [],
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

/* ---------- 准备施法者（法术书 / 已准备法术） ---------- */
// 准备施法者：法术从职业列表选择后，还需标记"已准备"才可施放（数量受职业规则限制）。
// 各职业准备数量公式（来自职业"施法"特性文本）：
//   法师    = 智力调整值 + 法师等级
//   牧师    = 感知调整值 + 牧师等级
//   德鲁伊  = 感知调整值 + 德鲁伊等级
//   圣武士  = 感知调整值 + 圣武士等级的一半
//   灵能武士= 智力调整值 + 灵能武士等级的一半
//   奇械师  = 压缩球制（每个准备法术对应一枚机械压缩球，消耗法术位与材料，无固定数量）
const PREPARED_CASTERS = {
  法师: { attr: '智力', half: false, balls: false },
  牧师: { attr: '感知', half: false, balls: false },
  德鲁伊: { attr: '感知', half: false, balls: false },
  圣武士: { attr: '感知', half: true, balls: false },
  灵能武士: { attr: '智力', half: true, balls: false },
  奇械师: { attr: '智力', half: false, balls: true },
};
// 是否为准备施法者（返回规则对象或 null）
function preparedRule() {
  const k = klass();
  if (!k) return null;
  return PREPARED_CASTERS[k.name] || null;
}
// 当前可准备的最高法术数量（null 表示无固定上限，如奇械师）
function preparedLimit() {
  const rule = preparedRule();
  if (!rule) return null;
  if (rule.balls) return null;
  const mod = finalMod(rule.attr);
  const n = rule.half ? mod + Math.floor(state.char.level / 2) : mod + state.char.level;
  return Math.max(1, n);
}
// 准备数量公式的说明文本
function preparedLimitText() {
  const k = klass();
  const rule = preparedRule();
  if (!rule || !k) return '';
  if (rule.balls) return '压缩球制：每个准备法术对应一枚机械压缩球，消耗法术位与材料成分';
  const attr = rule.attr;
  const half = rule.half ? '等级的一半' : '等级';
  return `${attr}调整值 + ${k.name}${half}（当前 ${preparedLimit()} 个，最少 1 个）`;
}
// 当前等级拥有的最高法术位环阶（0 = 无法术位）
function maxSlotLevel() {
  const k = klass();
  if (!k) return 0;
  const lvRow = k.table.find(r => r[0] === String(state.char.level));
  const headRow = k.table[0];
  if (!lvRow) return 0;
  const slotIdx = headRow.findIndex(h => /法术位/.test(h));
  if (slotIdx < 0) return 0;
  let max = 0;
  for (let i = slotIdx; i < lvRow.length; i++) {
    const v = lvRow[i];
    if (v && v !== '—' && !isNaN(+v) && +v > 0) {
      const lv = i - slotIdx + 1;
      if (lv > max) max = lv;
    }
  }
  return max;
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
  7: '按职业法术列表选择已知/准备法术（可搜索、按环位筛选）。准备施法者（法师等）需从已选法术中标记「已准备」，数量按职业规则（如法师=等级+智力调整值）。',
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
  const detailHost = el('div');
  wrap.appendChild(detailHost);
  const paintDetail = () => {
    detailHost.innerHTML = '';
    const r = race();
    if (!r) return;
    const d = el('div', 'detail-box');
    d.innerHTML = `<h3>${esc(r.name)}</h3>` +
      r.traits.filter(t => t.name).map(t =>
        `<div class="dl-row"><span class="k">${esc(t.name)}</span><span>${esc(t.text)}</span></div>`).join('') +
      `<p class="muted">完整页面：<a href="${esc(r.url)}" target="_blank">${esc(r.name)}（规则书）</a></p>`;
    detailHost.appendChild(d);
    // 种族「训练/选项」类选择（如人类的资本/社交/知识/斥候/民兵/法术训练）
    const opts = r.traits.filter(t => /^·/.test(t.name));
    const hasChoice = r.traits.some(t => /^训练/.test(t.name)) && opts.length;
    if (hasChoice) {
      const pick = el('div', 'field');
      pick.innerHTML = `<label>训练选择（种族特性「训练」，选一项）</label>
        <div class="train-opts">${opts.map(t =>
          `<label class="train-opt${state.char.raceTraining === t.name ? ' sel' : ''}">
            <input type="radio" name="race-train" value="${esc(t.name)}"${state.char.raceTraining === t.name ? ' checked' : ''}>
            <b>${esc(t.name.replace(/^·/, ''))}</b>
            <span>${esc(t.text.length > 90 ? t.text.slice(0, 90) + '…' : t.text)}</span>
          </label>`).join('')}</div>`;
      pick.querySelectorAll('input[name="race-train"]').forEach(inp => {
        inp.addEventListener('change', () => {
          state.char.raceTraining = inp.value;
          save();
          pick.querySelectorAll('.train-opt').forEach(o => o.classList.toggle('sel', o.querySelector('input').checked));
          renderLive();
        });
      });
      detailHost.appendChild(pick);
    }
    // 种族「亚种」选择（如精灵三类、矮人两类）：按文本中的英文亚种名匹配精校词典 + 自由输入兜底
    const SUBRACE_CAND = {
      'high elves': '高等精灵', 'wood elves': '木精灵', 'dark elves': '黑暗精灵', 'drow': '卓尔',
      'sun elves': '日精灵', 'moon elves': '月精灵',
      'hill dwarves': '丘陵矮人', 'mountain dwarves': '山地矮人',
      'lightfoot': '轻足半身人', 'stout': '壮健半身人',
      'forest gnomes': '森林侏儒', 'rock gnomes': '岩石侏儒',
    };
    const subTrait = r.traits.find(t => t.name === '亚种');
    if (subTrait) {
      const chips = [...new Set(Object.entries(SUBRACE_CAND)
        .filter(([en]) => subTrait.text.includes(en)).map(([, cn]) => cn))];
      const pick = el('div', 'field');
      pick.innerHTML = `<label>亚种选择（种族特性「亚种」）</label>
        <div class="sub-chips">${chips.map(s =>
          `<button type="button" class="chip${state.char.subrace === s ? ' sel' : ''}" data-sub="${esc(s)}">${esc(s)}</button>`).join('')}</div>
        <div class="sub-input"><input type="text" id="race-sub" placeholder="${chips.length ? '或手动输入其它亚种名（如 日精灵）' : '输入亚种名（如 丘陵矮人）'}" value="${esc(state.char.subrace)}" maxlength="20"></div>
        <div class="f-hint">${esc(subTrait.text.slice(0, 120))}${subTrait.text.length > 120 ? '…' : ''}</div>`;
      const setSub = (v, fromInput) => {
        state.char.subrace = v;
        save();
        pick.querySelectorAll('.chip').forEach(c => c.classList.toggle('sel', c.dataset.sub === v));
        if (!fromInput) {
          const inp = pick.querySelector('#race-sub');
          if (inp) inp.value = v;
        }
        renderLive();
      };
      pick.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => setSub(c.dataset.sub)));
      pick.querySelector('#race-sub').addEventListener('input', (e) => setSub(e.target.value.trim(), true));
      detailHost.appendChild(pick);
    }
  };
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
    paintDetail();
  };
  q.addEventListener('input', paint);
  q.addEventListener('change', paint);
  paint();
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
    // 输入中允许为空（不立即被回退值弹回）；非空则即时截断并回写（反馈 #20260822-152400）
    if (t.id.startsWith('base-')) {
      const v = t.value.trim();
      if (v === '' || isNaN(+v)) return;
      c.base[attr] = Math.max(1, Math.min(30, Math.round(+v)));
      t.value = String(c.base[attr]);
    } else if (t.id.startsWith('man-')) {
      const v = t.value.trim();
      if (v === '' || isNaN(+v)) return;
      c.manual[attr] = Math.max(-10, Math.min(10, Math.round(+v)));
      t.value = String(c.manual[attr]);
    }
    save(); paint();
  });
  grid.addEventListener('change', (e) => {
    // 失焦/回车：空值保持原值
    const t = e.target;
    if (!t.dataset.attr) return;
    const attr = t.dataset.attr;
    if (t.id.startsWith('base-')) {
      const v = t.value.trim();
      if (v === '' || isNaN(+v)) t.value = String(c.base[attr] != null ? c.base[attr] : 8);
    } else if (t.id.startsWith('man-')) {
      const v = t.value.trim();
      if (v === '' || isNaN(+v)) t.value = String(c.manual[attr] || 0);
    }
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
  // 职业可选技能指引（从 core.skills 文本中识别技能名）
  let classOpts = [];
  if (k && k.core.skills) {
    classOpts = DATA.rules.skills.filter(s => k.core.skills.includes(s.name)).map(s => s.name);
    const g = el('div', 'guide-box');
    g.innerHTML = `<b>本职业技能熟练：</b>${esc(k.core.skills)}
      ${classOpts.length ? `<span style="color:var(--sub)">（下表中 ✓ 标记的为本职业可选技能）</span>` : ''}`;
    stage().appendChild(g);
  }
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
      const classOpt = classOpts.includes(s.name);
      const row = el('div', 'skill-row');
      row.innerHTML = `<span class="s-name">${esc(s.name)}${fixed ? ' <span title="职业固定">★</span>' : classOpt ? ' <span title="本职业可选" style="color:var(--acc)">✓</span>' : ''}</span>
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
  // 已选专长面板：选择后即时可见，可点击 ✕ 移除
  const selBox = el('div', 'sel-box');
  stage().appendChild(selBox);

  const paint = () => {
    const max = featQuota();
    const base = featBaseQuota();
    quota.innerHTML = `本等级基础专长 <b>${base}</b> 个${c.extraFeats ? ` + 额外 <b>${c.extraFeats}</b>` : ''}，共 <b>${max}</b> 个，已选 <b>${c.feats.length}</b> 个。`;
    selBox.innerHTML = c.feats.length
      ? `<div class="sel-box-title">已选专长（<b>${c.feats.length}</b> 个）：</div>
         <div class="sel-chips">${c.feats.map(fn =>
           `<button type="button" class="sel-chip" data-f="${esc(fn)}">${esc(fn)} ✕</button>`).join('')}</div>`
      : `<div class="sel-box-title">已选专长：暂无</div>`;
    selBox.querySelectorAll('.sel-chip').forEach(b => b.addEventListener('click', () => {
      c.feats = c.feats.filter(x => x !== b.dataset.f);
      save(); paint();
    }));
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
/* 已选法术按环阶汇总（戏法单列）：如「戏法 2、1 环 3」 */
function spellLevelSummary() {
  const c = state.char;
  const lvC = {};
  for (const n of (c.spells || [])) {
    const sp = DATA.spells.find(s => s.name === n);
    const lv = sp ? (sp.level === 0 ? '戏法' : sp.level + ' 环') : '未知';
    lvC[lv] = (lvC[lv] || 0) + 1;
  }
  return Object.entries(lvC)
    .sort((a, b) => a[0] === '戏法' ? -1 : b[0] === '戏法' ? 1 : parseInt(a[0], 10) - parseInt(b[0], 10))
    .map(([l, n]) => `${l} ${n}`)
    .join('、');
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
  // 本职业法术（带完整属性，供筛选/详情）
  const spells = [];
  for (const l of Object.keys(cs.lists).sort((a, b) => a - b)) {
    for (const n of cs.lists[l]) {
      const sp = DATA.spells.find(s => s.name === n);
      if (sp) spells.push(sp);
    }
  }
  const lvLabel = (l) => l === 0 ? '戏法' : l + ' 环';
  const prepRule = preparedRule(); // null=非准备施法者
  // 施法指引：职业表当前等级行的法术位/已知法术 + 施法特性说明
  const g = el('div', 'guide-box');
  let gHtml = `<b>${esc(k.name)} 施法指引：</b>`;
  const castFeat = k.features.find(f => /^施法/.test(f.name));
  if (castFeat) gHtml += `${esc(castFeat.text.split('\n')[0].slice(0, 90))}…`;
  const lvRow = k.table.find(r => r[0] === String(c.level));
  const headRow = k.table[0];
  const lv2Row = k.table[1] || [];
  if (lvRow) {
    const start = headRow.findIndex(h => /法术位|已知法术|已知戏法/.test(h));
    if (start >= 0) {
      const slotIdx = headRow.findIndex(h => /法术位/.test(h));
      const pairs = headRow.slice(start).map((h, i) => {
        const col = start + i;
        if (col === slotIdx && lv2Row.length) {
          const slots = lvRow.slice(slotIdx).map((v, j) => (v && v !== '—') ? `${lv2Row[j] || (j + 1) + '环'} ${v}` : null).filter(Boolean);
          return [h, slots.length ? slots.join('；') : '—'];
        }
        return [h, lvRow[col] || '—'];
      });
      gHtml += `<div class="table-wrap" style="margin-top:6px"><table class="data">
        <tr>${pairs.map(([h]) => `<th>${esc(h)}</th>`).join('')}</tr>
        <tr>${pairs.map(([, v]) => `<td>${esc(v)}</td>`).join('')}</tr></table></div>
        <span style="color:var(--sub)">当前等级（${c.level} 级）数据如上；已知/准备法术数量按职业规则，详见职业步骤的职业表。</span>`;
    }
  }
  if (prepRule) {
    gHtml += `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed #c9daf5">
      <b>准备施法者：</b>本职业需从已选法术中标记「已准备」才能当日施放。
      可准备上限 = <b>${esc(preparedLimitText())}</b>；只能准备已获得法术位的法术（当前最高 <b>${maxSlotLevel()} 环</b>）。</div>`;
  }
  g.innerHTML = gHtml;
  stage().appendChild(g);

  // 计数行 + 已选面板 + 选择器（搜索/筛选/列表/详情）
  const cnt = el('div', 'skill-count');
  stage().appendChild(cnt);
  const selBox = el('div', 'sel-box');
  stage().appendChild(selBox);
  const pk = el('div', 'pk-car');
  const pkToolbar = el('div', 'pk-toolbar');
  const pkChips = el('div', 'pk-chips');
  const pkList = el('div', 'pk-list');
  const pkDetail = el('div', 'pk-detail');
  const pkPager = el('div', 'pk-pager');
  pkPager.hidden = true;
  pk.appendChild(pkToolbar);
  pk.appendChild(pkChips);
  pk.appendChild(pkList);
  pk.appendChild(pkDetail);
  pk.appendChild(pkPager);
  stage().appendChild(pk);

  const LEVELS = [...new Set(spells.map(s => s.level))].sort((a, b) => a - b);
  const SCHOOLS = [...new Set(spells.map(s => s.school).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const picker = Picker.create({
    data: spells,
    selKey: 'name',
    pageSize: 80,
    placeholder: '搜索法术名或描述…',
    emptyText: '没有匹配的法术。',
    chips: [
      { key: 'level', label: '环位', items: LEVELS, labelFn: lvLabel },
      { key: 'school', label: '学派', items: SCHOOLS },
    ],
    hay: (s) => s.name + ' ' + s.text,
    containers: { toolbar: pkToolbar, chips: pkChips, list: pkList, detail: pkDetail, pager: pkPager },
    itemHtml: (s) => {
      const sel = c.spells.includes(s.name);
      const isPrep = prepRule && (c.prepared || []).includes(s.name);
      const canPrep = prepRule && s.level >= 1 && s.level <= maxSlotLevel();
      return `<div class="pk-i-name">${esc(s.name)}${isPrep ? ' <span class="pk-tag pk-tag-prep">已准备</span>' : ''}</div>
        <div class="pk-i-sub">${lvLabel(s.level)} · ${esc(s.school || '未知学派')}</div>
        <div class="pk-i-acts">
          <button type="button" class="nav-btn pk-act" data-act="sel" data-name="${esc(s.name)}" style="padding:3px 12px;font-size:12px">${sel ? '移除' : '选择'}</button>
          ${canPrep ? `<button type="button" class="nav-btn pk-act${isPrep ? ' on' : ''}" data-act="prep" data-name="${esc(s.name)}" style="padding:3px 12px;font-size:12px" ${isPrep ? 'disabled' : ''}>${isPrep ? '✓ 已准备' : '准备'}</button>` : ''}
        </div>`;
    },
    detailHtml: (s) => {
      const fields = [
        ['环阶', lvLabel(s.level)], ['学派', s.school || '—'],
        ['施法时间', s.castTime || '—'], ['施法距离', s.range || '—'],
        ['法术目标', s.target || '—'], ['法术成分', s.components || '—'],
        ['持续时间', s.duration || '—'], ['需要专注', s.focus ? '是' : '否'],
        ['仪式', s.ritual ? '是（可作为仪式施展）' : '否'],
      ];
      return `<div class="pk-d-name">${esc(s.name)}</div>
        <div class="pk-d-sub">${lvLabel(s.level)} · ${esc(s.school || '未知学派')}</div>
        <div class="pk-d-fields">${fields.map(([k, v]) =>
          `<div class="f"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`).join('')}</div>
        <div class="pk-d-text">${esc(s.text)}</div>
        <a class="pk-d-link" href="${esc(s.url)}" target="_blank">📖 规则书原文 →</a>`;
    },
  });

  // 已选法术面板 + 计数
  const paintSel = () => {
    const prepN = (c.prepared || []).filter(x => c.spells.includes(x)).length;
    const lvSum = spellLevelSummary();
    cnt.innerHTML = `已选法术 <b>${c.spells.length}</b> 个（共 ${spells.length} 个可选）${lvSum ? `：${lvSum}` : ''}${prepRule ? ` · 已准备 <b class="${prepRule.balls ? '' : (prepN > preparedLimit() ? 'over' : '')}">${prepN}</b> / ${prepRule.balls ? '不限' : preparedLimit()} 个` : ''}。`;
    if (c.spells.length) {
      const groups = {};
      for (const n of c.spells) {
        const sp = DATA.spells.find(s => s.name === n);
        const lv = sp ? (sp.level === 0 ? '戏法' : sp.level + ' 环') : '未知';
        (groups[lv] = groups[lv] || []).push(n);
      }
      const order = Object.keys(groups).sort((a, b) => a === '戏法' ? -1 : b === '戏法' ? 1 : parseInt(a, 10) - parseInt(b, 10));
      selBox.innerHTML = `<div class="sel-box-title">已选法术（<b>${c.spells.length}</b> 个）：</div>
        <div class="sel-groups">` + order.map(lv =>
          `<span class="sel-grp"><b class="sel-grp-lv">${esc(lv)}</b>` +
          groups[lv].map(n =>
            `<button type="button" class="sel-chip${(c.prepared || []).includes(n) ? ' prep' : ''}" data-f="${esc(n)}">${esc(n)}${(c.prepared || []).includes(n) ? ' ✓' : ''} ✕</button>`).join('') +
          `</span>`).join('') + `</div>`;
      selBox.querySelectorAll('.sel-chip').forEach(b => b.addEventListener('click', () => {
        const n = b.dataset.f;
        c.spells = c.spells.filter(x => x !== n);
        c.prepared = (c.prepared || []).filter(x => x !== n);
        save(); paintSel(); picker.paint();
      }));
    } else {
      selBox.innerHTML = `<div class="sel-box-title">已选法术：暂无</div>`;
    }
  };

  // 列表内按钮：事件委托（选择/移除 + 准备/取消）
  pkList.addEventListener('click', (e) => {
    const btn = e.target.closest('.pk-act');
    if (!btn) return;
    const n = btn.dataset.name;
    const act = btn.dataset.act;
    if (act === 'sel') {
      if (c.spells.includes(n)) {
        c.spells = c.spells.filter(x => x !== n);
        c.prepared = (c.prepared || []).filter(x => x !== n);
      } else {
        c.spells.push(n);
      }
    } else if (act === 'prep') {
      const lim = preparedLimit();
      if (!prepRule.balls && lim != null && (c.prepared || []).filter(x => c.spells.includes(x)).length >= lim) {
        toast(`已准备法术已达上限（${lim} 个）；请先取消准备其它法术。`);
        return;
      }
      if (!c.spells.includes(n)) c.spells.push(n);
      c.prepared = (c.prepared || []).concat(n);
    }
    save(); paintSel(); picker.paint();
  });

  picker.paint();
  picker.initialDetail();
  paintSel();
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
  const selBox = el('div', 'sel-box');
  stage().appendChild(selBox);
  const pk = el('div', 'pk-car');
  const pkToolbar = el('div', 'pk-toolbar');
  const pkChips = el('div', 'pk-chips');
  const pkList = el('div', 'pk-list');
  const pkDetail = el('div', 'pk-detail');
  const pkPager = el('div', 'pk-pager');
  pkPager.hidden = true;
  pk.appendChild(pkToolbar);
  pk.appendChild(pkChips);
  pk.appendChild(pkList);
  pk.appendChild(pkDetail);
  pk.appendChild(pkPager);
  stage().appendChild(pk);

  const MLEVELS = [...new Set(DATA.maneuvers.map(m => m.level))].sort((a, b) => a.localeCompare(b));
  const MTYPES = [...new Set(DATA.maneuvers.map(m => m.type))].sort((a, b) => a.localeCompare(b));

  const picker = Picker.create({
    data: () => c.maneuverStyle
      ? DATA.maneuvers.filter(m => m.style === c.maneuverStyle)
      : DATA.maneuvers,
    selKey: 'name',
    pageSize: 100,
    placeholder: '搜索战技名或描述…',
    emptyText: '没有匹配的战技。',
    chips: [
      { key: 'level', label: '级别', items: MLEVELS },
      { key: 'type', label: '类型', items: MTYPES },
    ],
    hay: (m) => m.name + ' ' + (m.text || ''),
    containers: { toolbar: pkToolbar, chips: pkChips, list: pkList, detail: pkDetail, pager: pkPager },
    itemHtml: (m) => {
      const sel = c.maneuvers.includes(m.name);
      return `<div class="pk-i-name">${esc(m.name)}</div>
        <div class="pk-i-sub">${esc(m.style)} · ${esc(m.level)} · ${esc(m.type)}</div>
        <div class="pk-i-acts">
          <button type="button" class="nav-btn pk-act" data-name="${esc(m.name)}" style="padding:3px 12px;font-size:12px">${sel ? '移除' : '选择'}</button>
        </div>`;
    },
    detailHtml: (m) => `<div class="pk-d-name">${esc(m.name)}</div>
      <div class="pk-d-sub">${esc(m.style)} · ${esc(m.level)} · ${esc(m.type)}</div>
      ${m.text ? `<div class="pk-d-text">${esc(m.text)}</div>` : '<p class="pk-muted">规则书未收录该战技的独立详述。</p>'}
      <a class="pk-d-link" href="${esc(m.url)}" target="_blank">📖 规则书原文（${esc(m.style)}）→</a>`,
  });

  const paintSel = () => {
    cnt.innerHTML = `已选战技 <b>${c.maneuvers.length}</b> 个。卓越骰数量与准备战技数按流派规则（如角色卡"战技"栏）。`;
    if (c.maneuvers.length) {
      const rows = c.maneuvers.map(n => {
        const m = DATA.maneuvers.find(x => x.name === n);
        return `<span class="sel-chip" data-f="${esc(n)}">${esc(n)}${m ? `（${esc(m.style)} ${esc(m.level)}·${esc(m.type)}）` : ''} ✕</span>`;
      }).join('');
      selBox.innerHTML = `<div class="sel-box-title">已选战技（<b>${c.maneuvers.length}</b> 个）：</div>
        <div class="sel-chips">${rows}</div>`;
      selBox.querySelectorAll('.sel-chip').forEach(b => b.addEventListener('click', () => {
        c.maneuvers = c.maneuvers.filter(x => x !== b.dataset.f);
        save(); paintSel(); picker.paint();
      }));
    } else {
      selBox.innerHTML = `<div class="sel-box-title">已选战技：暂无</div>`;
    }
  };

  pkList.addEventListener('click', (e) => {
    const btn = e.target.closest('.pk-act');
    if (!btn) return;
    const n = btn.dataset.name;
    if (c.maneuvers.includes(n)) c.maneuvers = c.maneuvers.filter(x => x !== n);
    else c.maneuvers.push(n);
    save(); paintSel(); picker.paint();
  });

  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-s]');
    if (!b) return;
    c.maneuverStyle = b.dataset.s;
    save(); picker.paint(); paintSel();
  });

  picker.paint();
  picker.initialDetail();
  paintSel();
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
  const selBox = el('div', 'sel-box');
  stage().appendChild(selBox);
  const pk = el('div', 'pk-car');
  const pkToolbar = el('div', 'pk-toolbar');
  const pkChips = el('div', 'pk-chips');
  const pkList = el('div', 'pk-list');
  const pkDetail = el('div', 'pk-detail');
  const pkPager = el('div', 'pk-pager');
  pkPager.hidden = true;
  pk.appendChild(pkToolbar);
  pk.appendChild(pkChips);
  pk.appendChild(pkList);
  pk.appendChild(pkDetail);
  pk.appendChild(pkPager);
  stage().appendChild(pk);

  const MODULES = [...new Set(DATA.programs.map(x => x.module).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const picker = Picker.create({
    data: () => DATA.programs.filter(x => x.protocol === (c.programProtocol || '阿尔法')),
    selKey: 'name',
    pageSize: 100,
    placeholder: '搜索程序名或效果…',
    emptyText: '没有匹配的程序。',
    chips: [{ key: 'module', label: '模块', items: MODULES }],
    hay: (p) => p.name + ' ' + (p.text || ''),
    containers: { toolbar: pkToolbar, chips: pkChips, list: pkList, detail: pkDetail, pager: pkPager },
    itemHtml: (p) => {
      const sel = c.programs.includes(p.name);
      return `<div class="pk-i-name">${esc(p.name)}${p.focus ? ' <span class="pk-tag pk-tag-focus">专注</span>' : ''}</div>
        <div class="pk-i-sub">${esc(p.protocol)} · ${esc(p.module || '无模块')} · ${esc(p.act || '')}</div>
        <div class="pk-i-acts">
          <button type="button" class="nav-btn pk-act" data-name="${esc(p.name)}" style="padding:3px 12px;font-size:12px">${sel ? '移除' : '选择'}</button>
        </div>`;
    },
    detailHtml: (p) => `<div class="pk-d-name">${esc(p.name)}</div>
      <div class="pk-d-sub">${esc(p.protocol)}协议</div>
      <div class="pk-d-fields">
        <div class="f"><span class="k">所需模块</span><span class="v">${esc(p.module || '无')}</span></div>
        <div class="f"><span class="k">激活时间</span><span class="v">${esc(p.act || '—')}</span></div>
        <div class="f"><span class="k">需要专注</span><span class="v">${p.focus ? '是' : '否'}</span></div>
      </div>
      ${p.text ? `<div class="pk-d-text">${esc(p.text)}</div>` : ''}
      <a class="pk-d-link" href="${esc(p.url)}" target="_blank">📖 规则书原文（${esc(p.protocol)}协议）→</a>`,
  });

  const paintSel = () => {
    cnt.innerHTML = `已选程序 <b>${c.programs.length}</b> 个。`;
    if (c.programs.length) {
      const rows = c.programs.map(n => {
        const p = DATA.programs.find(x => x.name === n);
        return `<span class="sel-chip" data-f="${esc(n)}">${esc(n)}${p ? `（${esc(p.protocol)} ${esc(p.module || '')}）` : ''} ✕</span>`;
      }).join('');
      selBox.innerHTML = `<div class="sel-box-title">已选程序（<b>${c.programs.length}</b> 个）：</div>
        <div class="sel-chips">${rows}</div>`;
      selBox.querySelectorAll('.sel-chip').forEach(b => b.addEventListener('click', () => {
        c.programs = c.programs.filter(x => x !== b.dataset.f);
        save(); paintSel(); picker.paint();
      }));
    } else {
      selBox.innerHTML = `<div class="sel-box-title">已选程序：暂无</div>`;
    }
  };

  pkList.addEventListener('click', (e) => {
    const btn = e.target.closest('.pk-act');
    if (!btn) return;
    const n = btn.dataset.name;
    if (c.programs.includes(n)) c.programs = c.programs.filter(x => x !== n);
    else c.programs.push(n);
    save(); paintSel(); picker.paint();
  });

  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]');
    if (!b) return;
    c.programProtocol = b.dataset.p;
    save(); picker.paint(); paintSel();
  });

  picker.paint();
  picker.initialDetail();
  paintSel();
}

/* ---------- 步骤10 角色卡 ---------- */
function renderSheet() {
  const c = state.char;
  const s = stage();
  const sheet = el('div', 'sheet');
  const r = race();
  const k = klass();
  sheet.innerHTML = `<h2>${esc(c.name || '未命名角色')}</h2>
    <p class="muted">${esc(c.player ? '玩家：' + c.player : '')}${c.level ? ' · ' + c.level + ' 级' : ''}${k ? ' · ' + esc(k.name) : ''}${c.subclass ? '（' + esc(c.subclass) + '）' : ''}${r ? ' · ' + esc(r.name) : ''}</p>
    ${c.portrait ? `<img class="portrait" src="${esc(c.portrait)}" alt="立绘" onerror="this.style.display='none'">` : ''}`;

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
      </table>
      ${c.raceTraining ? `<p class="muted" style="margin-top:6px">训练选择：<b>${esc(c.raceTraining.replace(/^·/, ''))}</b></p>` : ''}
      ${c.subrace ? `<p class="muted">亚种：<b>${esc(c.subrace)}</b></p>` : ''}
      </div>`);
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
    Excel 导出为自研模板，直接采用规则书 17 项，无需映射。</p>
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
    const prepN = (c.prepared || []).filter(x => c.spells.includes(x)).length;
    const prepTitle = preparedRule()
      ? ` · 已准备 ${prepN}${preparedRule().balls ? '' : ' / ' + preparedLimit()}` : '';
    sheet.insertAdjacentHTML('beforeend', `<div class="sheet-sec"><h3>法术（${c.spells.length}${prepTitle}）</h3>
      <table><tr><th>环阶</th><th>名称</th><th>已准备</th><th>学派</th><th>简介</th></tr>
      ${Object.keys(byLv).sort((a, b) => a - b).map(lv =>
        byLv[lv].map(sp => `<tr><td>${lv === 0 ? '戏法' : lv < 0 ? '?' : lv + '环'}</td><td><b>${esc(sp.name)}</b></td>
          <td>${(c.prepared || []).includes(sp.name) ? '✓ 是' : '—'}</td><td>${esc(sp.school || '')}</td>
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
  // —— 基本信息编辑（姓名/玩家/立绘） ——
  const info = el('div', 'field');
  info.innerHTML = `<label>基本信息</label>
    <div class="info-grid">
      <input type="text" id="info-name" placeholder="角色姓名" value="${esc(c.name)}" maxlength="40">
      <input type="text" id="info-player" placeholder="玩家" value="${esc(c.player)}" maxlength="40">
      <input type="text" id="info-portrait" placeholder="立绘图片 URL" value="${esc(c.portrait)}">
      <span class="info-btns">
        <button type="button" id="info-upload" class="nav-btn">上传立绘</button>
        <button type="button" id="info-clear-p" class="nav-btn" style="color:var(--warn)">清除</button>
      </span>
    </div>
    <div class="f-hint">立绘支持图片 URL 或本地文件（自动压缩后存入浏览器本地存档，仅本机可见）。</div>`;
  s.appendChild(info);
  const $name = $('#info-name', info);
  const $player = $('#info-player', info);
  const $portrait = $('#info-portrait', info);
  const setH2 = () => {
    const h = sheet.querySelector('h2');
    if (h) h.textContent = c.name || '未命名角色';
  };
  $name.addEventListener('input', () => { c.name = $name.value; save(); setH2(); });
  $player.addEventListener('input', () => { c.player = $player.value; save(); });
  const applyPortrait = (v) => {
    c.portrait = v;
    $portrait.value = v;
    save();
    let img = sheet.querySelector('.portrait');
    if (v) {
      if (!img) {
        img = document.createElement('img');
        img.className = 'portrait';
        img.onerror = () => { img.style.display = 'none'; };
        sheet.querySelector('h2').insertAdjacentElement('afterend', img);
      }
      img.src = v;
      img.style.display = '';
    } else if (img) {
      img.remove();
    }
  };
  $portrait.addEventListener('change', () => applyPortrait($portrait.value.trim()));
  $('#info-upload', info).addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      const rd = new FileReader();
      rd.onload = () => {
        const b64 = String(rd.result);
        if (b64.length > 2 * 1024 * 1024) { toast('图片过大（>2MB），请换一张或压缩后重试'); return; }
        applyPortrait(b64);
      };
      rd.readAsDataURL(file);
    };
    inp.click();
  });
  $('#info-clear-p', info).addEventListener('click', () => applyPortrait(''));
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
  const spSum = spellLevelSummary();
  h += `<div class="live-row"><span>法术</span><b>${c.spells.length}${spSum ? '（' + spSum + '）' : ''}${preparedRule() ? '（已准备 ' + (c.prepared || []).filter(x => c.spells.includes(x)).length + '）' : ''}</b></div>`;
  h += `<div class="live-row"><span>战技</span><b>${c.maneuvers.length}${c.maneuverStyle ? '（' + esc(c.maneuverStyle) + '）' : ''}</b></div>`;
  h += `<div class="live-row"><span>程序</span><b>${c.programs.length}</b></div>`;
  h += `</div>`;
  live.innerHTML = h;
}

/* ---------- Excel 导出（自研模板：纯 JS 从零生成，数据全部来自规则书 card-data，永远同步） ----------
 * 不再依赖官方模板 dnd5z人物卡模板改.xlsx：
 *  - 职业基础血量按规则书生命骰计算（与网页角色卡 hpMax() 同源）
 *  - 包含全部职业（含赛博格 D12）与子职数据
 *  - 新增「程序」表（赛博格专属，官方模板没有）
 *  - 技能直接用规则书 17 项，无需模板映射
 * 布局：角色卡 / 法术 / 战技 / 程序 / 装备与背景
 */
// 单元格样式索引（对应 makeStylesXml 中 cellXfs 顺序）
const SX = {
  def: 0,     // 默认
  title: 1,   // 大标题（深蓝底白字）
  section: 2, // 区块标题（浅蓝底粗体）
  head: 3,    // 表头（灰底粗体居中）
  label: 4,   // 标签（浅灰底）
  value: 5,   // 值（白底左边框）
  num: 6,     // 数值（居中）
  text: 7,    // 长文本（自动换行）
  note: 8,    // 小注（灰色）
};
function xlsxColName(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26 | 0; }
  return s;
}
// sheet 构建器：set(r,c,v,style) 后 xml() 序列化。r/c 从 1 起。
function makeSheet(widths) {
  const cells = {};    // 'r,c' -> {v, s, t}
  const merges = [];   // [r, c1, c2]
  const heights = {};  // r -> 行高
  const api = {
    set(r, c, v, s) {
      if (v === '' || v == null) return;
      const t = typeof v === 'number' ? 'n' : 's';
      cells[r + ',' + c] = { v, s: s == null ? SX.value : s, t };
    },
    merge(r, c1, c2) { merges.push([r, c1, c2]); },
    height(r, h) { heights[r] = h; },
    xml() {
      const colDefs = widths.map((w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
      const maxR = Math.max(1, ...Object.keys(cells).map(k => +k.split(',')[0]));
      let rowsXml = '';
      for (let r = 1; r <= maxR; r++) {
        let rowCells = '';
        for (let c = 1; c <= widths.length; c++) {
          const cell = cells[r + ',' + c];
          if (!cell) continue;
          const ref = xlsxColName(c) + r;
          const sAttr = cell.s ? ` s="${cell.s}"` : '';
          if (cell.t === 'n') rowCells += `<c r="${ref}"${sAttr}><v>${cell.v}</v></c>`;
          else rowCells += `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(cell.v)}</t></is></c>`;
        }
        if (!rowCells) continue;
        const ht = heights[r] ? ` ht="${heights[r]}" customHeight="1"` : '';
        rowsXml += `<row r="${r}"${ht}>${rowCells}</row>`;
      }
      const mergeXml = merges.length
        ? '<mergeCells count="' + merges.length + '">' +
          merges.map(([r, c1, c2]) => `<mergeCell ref="${xlsxColName(c1)}${r}:${xlsxColName(c2)}${r}"/>`).join('') +
          '</mergeCells>'
        : '';
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${colDefs}</cols><sheetData>${rowsXml}</sheetData>${mergeXml}</worksheet>`;
    },
  };
  return api;
}
function makeStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="微软雅黑"/></font><font><b/><sz val="14"/><name val="微软雅黑"/></font><font><b/><sz val="11"/><name val="微软雅黑"/></font></fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F5496"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB0B0B0"/></left><right style="thin"><color rgb="FFB0B0B0"/></right><top style="thin"><color rgb="FFB0B0B0"/></top><bottom style="thin"><color rgb="FFB0B0B0"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

// 数值辅助：调整值带符号
function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}
function fmtMod(v) { return (v >= 0 ? '+' : '') + v; }
function speedValue() {
  const r = race();
  if (!r) return '';
  const t = r.traits.find(x => x.name && /^速度/.test(x.name));
  if (!t) return '';
  const m = /(\d+)\s*尺/.exec(t.text);
  return m ? +m[1] : '';
}
function acSourceName() {
  const c = state.char;
  return ({ naked: '无盔甲', light: '轻甲', medium: '中甲', heavy: '重甲', mage: '法师护甲', monk: '武僧无甲防御', barb: '狂战士无甲防御' }[c.armorType] || '无盔甲') +
    (c.shield ? ' + 盾牌' : '') + (c.armorBonus ? ' + 其它 ' + c.armorBonus : '');
}
function classLv1Features() {
  const k = klass();
  if (!k) return [];
  const lv1 = (k.table.find(row => row[0] === '1') || [])[1] || '';
  const names = lv1.split(/[，,、]/).filter(Boolean);
  return k.features.filter(f => names.includes(f.name));
}
function skillGroupRows() {
  const groups = [['力量系', ['运动', '威吓']], ['敏捷系', ['体操', '巧手', '隐匿']],
    ['智力系', ['奥秘', '灵能', '历史', '调查', '自然', '宗教', '表演']],
    ['感知系', ['医药', '洞悉', '察觉', '求生', '交涉']]];
  const rows = [];
  for (const [g, names] of groups) {
    names.forEach((n, i) => {
      const lv = state.char.skills[n] || 0;
      rows.push({ group: i === 0 ? g : '', name: n, total: skillMod(n), state: lv === 2 ? '专精' : lv === 1 ? '熟练' : '—' });
    });
  }
  return rows;
}
function featLv(i) { return [1, 1, 3, 6, 9, 12, 15, 18][i] || ''; }

// Sheet1 角色卡
function buildSheetChar() {
  const s = makeSheet([9, 15, 11, 15, 9, 15, 9, 15]);
  const c = state.char;
  const k = klass();
  const r = race();
  const ver = (DATA.rules || {}).version || '';
  const t = (txt) => txt || '';
  s.set(1, 1, `5z 角色卡${ver ? '（规则书 v' + ver + '）' : ''}`, SX.title);
  s.merge(1, 1, 8);
  s.height(1, 26);
  // —— 基本信息 ——
  s.set(3, 1, '基本信息', SX.section); s.merge(3, 1, 8);
  const info = [
    ['姓名', c.name, '玩家', c.player],
    ['职业', k ? k.name : '', '子职', c.subclass],
    ['等级', c.level, '熟练加值', k ? '+' + profBonus() : ''],
    ['种族', r ? r.name : '', '亚种', c.subrace],
    ['训练选择', (c.raceTraining || '').replace(/^·/, ''), '生命骰', k ? 'D' + k.core.hitDie : ''],
    ['背景', c.bgName, '阵营', c.alignment],
    ['信仰', c.faith, '年龄', c.age],
    ['性别', c.gender, '身高体重', c.heightWeight],
  ];
  info.forEach((row, i) => {
    const rr = 4 + i;
    s.set(rr, 1, row[0], SX.label);
    s.set(rr, 2, row[1], typeof row[1] === 'number' ? SX.num : SX.value);
    s.set(rr, 3, row[2], SX.label);
    s.set(rr, 4, row[3], typeof row[3] === 'number' ? SX.num : SX.value);
  });
  // —— 属性与豁免 ——
  const aStart = 4 + info.length + 2; // 13
  s.set(aStart, 1, '属性与豁免', SX.section); s.merge(aStart, 1, 8);
  ['属性', '属性值', '调整值', '豁免熟练', '豁免总值'].forEach((h, i) => s.set(aStart + 1, 1 + i, h, SX.head));
  ATTRS.forEach((a, i) => {
    const rr = aStart + 2 + i;
    s.set(rr, 1, a, SX.label);
    s.set(rr, 2, finalAttr(a), SX.num);
    s.set(rr, 3, fmtMod(finalMod(a)), SX.num);
    const hasSave = k ? k.core.saveList.includes(a) : false;
    s.set(rr, 4, hasSave ? '熟练' : '—', SX.num);
    s.set(rr, 5, fmtMod(saveMod(a)), SX.num);
  });
  // —— 战斗数据 ——
  const bStart = aStart + 2 + ATTRS.length + 2; // 22
  s.set(bStart, 1, '战斗数据', SX.section); s.merge(bStart, 1, 8);
  const combat = [
    ['生命值上限', k ? hpMax() : '', '生命骰数量', k ? c.level : ''],
    ['防御等级 AC', k ? acValue() : '', '先攻', fmtMod(initBonus())],
    ['AC 来源', t(acSourceName()), '速度', t(speedValue() + '尺')],
    ['法术豁免 DC', k ? spellDC() : '', '法术攻击加值', k ? fmtMod(spellAttack()) : ''],
    ['施法关键属性', c.keyAttr, '法术列表', t(classSpellList() ? classSpellList().class : '')],
  ];
  combat.forEach((row, i) => {
    const rr = bStart + 1 + i;
    s.set(rr, 1, row[0], SX.label);
    s.set(rr, 2, row[1], /^-?\d+$/.test(String(row[1])) ? SX.num : SX.value);
    s.set(rr, 3, row[2], SX.label);
    s.set(rr, 4, row[3], /^-?\d+$/.test(String(row[3])) ? SX.num : SX.value);
  });
  // —— 技能（规则书 17 项） ——
  const sStart = bStart + 1 + combat.length + 2; // 30
  const skRows = skillGroupRows();
  const chosen = skRows.filter(x => x.state !== '—').length;
  s.set(sStart, 1, `技能（${chosen} / ${skillQuota()}）`, SX.section); s.merge(sStart, 1, 8);
  ['分类', '技能', '总值', '状态'].forEach((h, i) => s.set(sStart + 1, 1 + i, h, SX.head));
  skRows.forEach((sk, i) => {
    const rr = sStart + 2 + i;
    s.set(rr, 1, sk.group, SX.label);
    s.set(rr, 2, sk.name, SX.value);
    s.set(rr, 3, fmtMod(sk.total), SX.num);
    s.set(rr, 4, sk.state, SX.num);
  });
  // —— 专长 ——
  const fStart = sStart + 2 + skRows.length + 2;
  s.set(fStart, 1, `专长（${c.feats.length} / ${featQuota()}）`, SX.section); s.merge(fStart, 1, 8);
  ['等级', '名称', '效果摘要'].forEach((h, i) => s.set(fStart + 1, 1 + i, h, SX.head));
  if (!c.feats.length) {
    s.set(fStart + 2, 1, '（未选择专长）', SX.note);
  } else {
    c.feats.forEach((fn, i) => {
      const rr = fStart + 2 + i;
      const f = DATA.feats.find(x => x.name === fn);
      s.set(rr, 1, featLv(i), SX.num);
      s.set(rr, 2, fn, SX.value);
      s.set(rr, 3, f ? f.text.split('\n')[0] : '', SX.text);
      s.merge(rr, 3, 8);
      s.height(rr, 22);
    });
  }
  // —— 种族特性 ——
  if (r && r.traits.some(x => x.name)) {
    const tStart = fStart + 2 + Math.max(1, c.feats.length) + 1;
    s.set(tStart, 1, `种族特性（${r.name}）`, SX.section); s.merge(tStart, 1, 8);
    const traits = r.traits.filter(x => x.name);
    traits.forEach((tr, i) => {
      const rr = tStart + 1 + i;
      s.set(rr, 1, tr.name, SX.label);
      s.set(rr, 2, tr.text, SX.text);
      s.merge(rr, 2, 8);
      s.height(rr, Math.max(22, Math.ceil(tr.text.length / 40) * 15 + 8));
    });
  }
  return s;
}

// Sheet2 法术
function buildSheetSpells() {
  const s = makeSheet([8, 22, 14, 12, 60]);
  const c = state.char;
  const prepRule = preparedRule();
  const title = `法术（${c.spells.length} 个）` + (prepRule
    ? ` · 已准备 ${(c.prepared || []).filter(x => c.spells.includes(x)).length}` + (prepRule.balls ? '' : ' / ' + preparedLimit())
    : '');
  s.set(1, 1, title, SX.title); s.merge(1, 1, 5);
  s.height(1, 24);
  ['环阶', '名称', '学派', '已准备', '详述'].forEach((h, i) => s.set(2, 1 + i, h, SX.head));
  if (!c.spells.length) {
    s.set(3, 1, '（未选择法术）', SX.note);
    return s;
  }
  c.spells.forEach((n, i) => {
    const sp = DATA.spells.find(x => x.name === n);
    const rr = 3 + i;
    const lv = sp ? sp.level : -1;
    s.set(rr, 1, lv === 0 ? '戏法' : lv > 0 ? lv + '环' : '?', SX.num);
    s.set(rr, 2, n, SX.value);
    s.set(rr, 3, sp ? (sp.school || '') : '', SX.value);
    s.set(rr, 4, (c.prepared || []).includes(n) ? '✓ 是' : '—', SX.num);
    s.set(rr, 5, sp ? (sp.text || '').split('\n').slice(1).join('\n').slice(0, 220) : '', SX.text);
    s.height(rr, 30);
  });
  return s;
}

// Sheet3 战技
function buildSheetManeuvers() {
  const s = makeSheet([12, 16, 24, 60]);
  const c = state.char;
  s.set(1, 1, `战技（${c.maneuvers.length} 个）${c.maneuverStyle ? ' · 流派：' + c.maneuverStyle : ''}`, SX.title);
  s.merge(1, 1, 4); s.height(1, 24);
  ['流派', '级别·类型', '名称', '详述'].forEach((h, i) => s.set(2, 1 + i, h, SX.head));
  if (!c.maneuvers.length) {
    s.set(3, 1, '（未选择战技）', SX.note);
    return s;
  }
  c.maneuvers.forEach((n, i) => {
    const m = DATA.maneuvers.find(x => x.name === n);
    const rr = 3 + i;
    s.set(rr, 1, m ? m.style : '', SX.value);
    s.set(rr, 2, m ? m.level + '·' + m.type : '', SX.num);
    s.set(rr, 3, n, SX.value);
    s.set(rr, 4, m ? m.text.slice(0, 220) : '', SX.text);
    s.height(rr, 30);
  });
  return s;
}

// Sheet4 程序（赛博格专属）
function buildSheetPrograms() {
  const s = makeSheet([12, 14, 24, 60]);
  const c = state.char;
  s.set(1, 1, `程序（${c.programs.length} 个）${c.programProtocol ? ' · 协议：' + c.programProtocol : ''}`, SX.title);
  s.merge(1, 1, 4); s.height(1, 24);
  ['协议', '模块', '名称', '详述'].forEach((h, i) => s.set(2, 1 + i, h, SX.head));
  if (!c.programs.length) {
    s.set(3, 1, '（未选择程序。赛博格专属内容，其他职业可忽略本表）', SX.note);
    return s;
  }
  c.programs.forEach((n, i) => {
    const p = DATA.programs.find(x => x.name === n);
    const rr = 3 + i;
    s.set(rr, 1, p ? p.protocol : '', SX.value);
    s.set(rr, 2, p ? (p.module || '') : '', SX.value);
    s.set(rr, 3, n, SX.value);
    s.set(rr, 4, p ? p.text.slice(0, 220) : '', SX.text);
    s.height(rr, 30);
  });
  return s;
}

// Sheet5 装备与背景
function buildSheetExtras() {
  const s = makeSheet([16, 60]);
  const c = state.char;
  s.set(1, 1, '装备与背景', SX.title); s.merge(1, 1, 2); s.height(1, 24);
  let rr = 3;
  const putKV = (label, v, long) => {
    if (!v) return;
    s.set(rr, 1, label, SX.label);
    if (long) { s.set(rr, 2, v, SX.text); s.merge(rr, 2, 2); s.height(rr, Math.max(22, Math.ceil(String(v).length / 50) * 15 + 8)); }
    else s.set(rr, 2, v, SX.value);
    rr++;
  };
  putKV('背景特性', c.bgText, true);
  putKV('额外语言', c.bgLanguage);
  putKV('随身物品', c.items, true);
  putKV('备注 / 法术 / 战技 / 程序', c.traitsNote, true);
  putKV('其他备注', c.notes, true);
  // 1 级职业特性
  const lv1 = classLv1Features();
  if (lv1.length) {
    rr++;
    s.set(rr, 1, '1 级职业特性', SX.section); s.merge(rr, 1, 2); rr++;
    lv1.forEach(f => {
      s.set(rr, 1, f.name, SX.label);
      s.set(rr, 2, f.text, SX.text); s.merge(rr, 2, 2);
      s.height(rr, Math.max(22, Math.ceil(f.text.length / 50) * 15 + 8));
      rr++;
    });
  }
  return s;
}

function exportExcel() {
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
  const enc = new TextEncoder();
  const sheets = [
    ['角色卡', buildSheetChar()],
    ['法术', buildSheetSpells()],
    ['战技', buildSheetManeuvers()],
    ['程序', buildSheetPrograms()],
    ['装备与背景', buildSheetExtras()],
  ];
  const files = {
    '[Content_Types].xml': enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels': enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([name], i) => `<sheet name="${xmlEsc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`),
    'xl/styles.xml': enc.encode(makeStylesXml()),
  };
  sheets.forEach(([, sheet], i) => {
    files['xl/worksheets/sheet' + (i + 1) + '.xml'] = enc.encode(sheet.xml());
  });
  return fflate.zipSync(files, { level: 6 });
}
// 自动化测试钩子：接受可选角色覆盖（用于测试），返回导出结果（base64），不触发下载
window.__CAR_EXPORT_TEST__ = (charOverride) => {
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
