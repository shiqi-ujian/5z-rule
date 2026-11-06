/* 5z 车卡 - 前端逻辑
 * 数据：assets/card-data/{rules,races,classes,feats}.json（构建时从规则书解析）
 * 流程（v3）：种族 → 职业 → 属性 → 技能 → 专长 → 法术 → 战技 → 程序 → 角色卡 → 购物 → 背景
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

/* ---------- 法术学派 / 程序模块 智能筛选辅助（与词典页一致） ----------
 * 不做"把所有组合逐一双列"的 chips，改为：任选基础项 → 智能匹配命中项。
 */
// 程序核心演算模块（顺序即展示顺序）
const CORE_MODULES = ['火力', '工程', '信息', '生存', '时空'];
// 程序的所需模块解析：module 可能为 单个 / 组合 / 无 / 任意两个 / 空（空则回退正文"所需模块"行）
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
// 所需模块可读标签：无 / 任意两个 / 按 CORE_MODULES 顺序排的具体组合
function moduleLabel(p) {
  const info = progModuleInfo(p);
  if (info.none) return '无';
  if (info.any) return '任意两个';
  if (!info.list.length) return '无';
  return CORE_MODULES.filter(m => info.list.includes(m)).join('、');
}
// 法术的学派解析：单 / 多学派（预言/变化/防护）/ 任意学派 / 传奇"法术"占位 / 空
function spellSchools(x) {
  let raw = String(x.school || '').trim();
  if (!raw) return [];
  if (raw === '法术') {
    // 传奇法术：真实学派在正文首行（如 "传奇法术 塑能"）
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
// 学派可读标签
function schoolLabel(s) {
  const set = spellSchools(s);
  if (!set.length) return '未知学派';
  if (set.includes('任意学派')) return '任意学派';
  return set.join('/');
}
// 列表用基础学派（原子学派，剔除"任意学派"与"法术"占位）
function baseSchools(list) {
  return [...new Set(list.flatMap(s => spellSchools(s)).filter(x => x && x !== '任意学派'))]
    .sort((a, b) => a.localeCompare(b));
}

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
  settings: { strict: true }, // 严格模式：必填项未完成时拦截「下一步」/导出（可顶部切换）
};
const SETTINGS_KEY = '5z-car-settings-v1';
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) state.settings = Object.assign({ strict: true }, JSON.parse(raw) || {});
  } catch (e) { /* 忽略损坏设置 */ }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (e) {}
}
function strictOn() { return !!state.settings.strict; }
let rollBuf = null; // 随机骰临时数组

function newChar() {
  return {
    name: '', player: '', level: 1, portrait: '',
    raceId: null, classId: null, variant: '', subclass: '', raceTraining: '', subrace: '',
    raceChoice: { mode: '', a: '', b: '', c: '' }, // 种族属性加值的选择型分配（如人类/精灵）
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
    equipment: [], budget: '', attuneSlots: 3,   // attuneSlots：同调位上限（默认 3，反馈 7）
    notes: '', items: '', traitsNote: '',
  };
}

// 存档步骤迁移表（v2 → v3，反馈 3：背景步从第 4 步移到最后一格第 11 步）
// 旧顺序：1种族 2职业 3属性 4背景 5技能 6专长 7法术 8战技 9程序 10角色卡 11购物
// 新顺序：1种族 2职业 3属性 4技能 5专长 6法术 7战技 8程序 9角色卡 10购物 11背景
const SAVE_STEP_MIGRATE_V2 = { 4: 11, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 10: 9, 11: 10 };

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state.char = Object.assign(newChar(), saved.char || {});
      if (!state.char.raceChoice) state.char.raceChoice = { mode: '', a: '', b: '', c: '' };
      // 同调位上限兜底（反馈 7）：旧存档没有该字段/非法时按 3（不覆盖 newChar 里的正常值）
      if (state.char.attuneSlots == null || !Number.isFinite(Number(state.char.attuneSlots))) state.char.attuneSlots = 3;
      // 旧存档步骤迁移到新顺序（v<3），避免老存档落在错误步骤
      let step = saved.step || 1;
      if ((+saved.v || 0) < 3) step = SAVE_STEP_MIGRATE_V2[step] || step;
      state.step = Math.min(11, Math.max(1, step)); // 11 步向导；旧版曾误钳到 7
      if (state.step > 1) setTimeout(() => toast(`已恢复上次进度（第 ${state.step} 步）`), 500);
    }
  } catch (e) { /* 忽略损坏存档 */ }
  if (!state.char) state.char = newChar();
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      v: 3,
      step: state.step,
      rulesVersion: (DATA && DATA.rules && DATA.rules.version) || '',
      char: state.char,
    }));
  } catch (e) { /* localStorage 容量满/隐私模式：静默失败 */ }
  try { refreshChrome(); } catch (e) { /* 页面尚未渲染 */ }
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
// 基础职业（卡片列表用）；变体职业请用 activeVariant()/klass()（反馈 5）
function baseKlass() { return DATA.classes.find(c => c.id === state.char.classId) || null; }
function activeVariant() {
  const b = baseKlass();
  if (!b || !state.char.variant || !Array.isArray(b.variants)) return null;
  return b.variants.find(v => v.name === state.char.variant) || null;
}
// 车卡计算用职业对象：选中变体职业时返回「变体合并对象」——
// name/core/table/features 全部取变体数据，另带 baseId/baseName/isVariant 便于回链与先决条件判定。
function klass() {
  const b = baseKlass();
  if (!b) return null;
  const v = activeVariant();
  if (!v) return b;
  return Object.assign({}, b, {
    baseId: b.id, baseName: b.name, isVariant: true,
    name: v.name,
    url: v.url || b.url,
    core: (v.core && Object.keys(v.core).length) ? v.core : b.core,
    table: (Array.isArray(v.table) && v.table.length) ? v.table : b.table,
    tableTitle: v.tableTitle || b.tableTitle,
    features: (Array.isArray(v.features) && v.features.length) ? v.features : b.features,
  });
}
// 子职候选项（UI 用）：
//   普通职业 = kind 为 subclass 的条目；inherit 变体 = 基础子职去掉 subclassExclude；own 变体 = 该变体专属子职；none = 无子职。
//   兼容旧数据（无 kind 时）：非嵌套条目视为 subclass，嵌套（战士变体子职）视为 variant-sub。
function subclassList() {
  const b = baseKlass();
  if (!b) return [];
  const all = (b.subclasses || []).filter(s => s && s.url);
  const v = activeVariant();
  if (!v) return all.filter(s => (s.kind || (s.nested ? 'variant-sub' : 'subclass')) === 'subclass');
  if (v.subclassMode === 'own') return all.filter(s => s.kind === 'variant-sub' && s.owner === v.name);
  if (v.subclassMode === 'none') return [];
  return all.filter(s => (s.kind || 'subclass') === 'subclass' && !(v.subclassExclude || []).includes(s.name));
}
function subclassDisplayName(s) {
  const n = (s && (s.displayName || s.name)) || '';
  // 「助虐之誓（恶武士）」这类变体专属子职在 UI 上省略后缀（反馈 5）
  return n.replace(/（[^（）]*变体）$/g, '').replace(/（恶武士）$/g, '').trim() || n;
}
// 载入存档后校正职业/变体/子职选择（规则数据变化后避免悬空选择）
function normalizeClassChoice() {
  const c = state.char;
  if (!baseKlass()) {
    if (c.classId) { c.classId = null; c.variant = ''; c.subclass = ''; }
    return;
  }
  if (c.variant && !activeVariant()) c.variant = '';
  const opts = subclassList();
  if (c.subclass && !opts.some(s => s.name === c.subclass)) c.subclass = '';
}

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
  return state.char.base[attr] + (state.char.manual[attr] || 0) + levelUpBonus(attr) + raceBonus(attr);
}

/* ---------- 种族属性加值（自动/半自动） ----------
 * 规则书种族特性里写作「属性值加成：你的感知+2，敏捷+1」；
 * 部分种族页（真龙/狗头人/眼魔/序位巨人）写作「属性值提升」——两种标题都要识别（反馈 4 顺带修复）。
 * 人类/精灵为「一项属性值+2，另一项属性值+1；或三项属性值+1」需玩家分配。
 */
function raceAbilityText(r) {
  if (!r) return '';
  const traits = r.traits || [];
  const re = /属性值(?:加成|提升)/;
  const t = traits.find(x => re.test(x.name || '')) ||
    traits.find(x => re.test(x.text || ''));
  return t ? String(t.text || '') : '';
}
// 当前所选亚种（种族页解析出的 subraces：{name, bonus, hpPerLevel, text}）
function subraceObj(r) {
  const n = state.char.subrace;
  if (!r || !n || !Array.isArray(r.subraces)) return null;
  return r.subraces.find((s) => s.name === n) || null;
}
function raceBonusPlan(r) {
  const text = raceAbilityText(r);
  const plan = { raw: text, fixed: {}, choice: null, parsed: false };
  if (text) {
    const re = /(力量|敏捷|体质|智力|感知)\s*[+＋加]\s*(\d+)/g;
    let m;
    while ((m = re.exec(text))) plan.fixed[m[1]] = (plan.fixed[m[1]] || 0) + (+m[2]);
    const has21 = /一项属性值\s*[+＋加]\s*2/.test(text) && /另一项属性值\s*[+＋加]\s*1/.test(text);
    const has111 = /三项属性值\s*[+＋加]\s*1/.test(text);
    if (has21 && has111) plan.choice = '2/1or1/1/1';
    else if (has21) plan.choice = '2/1';
    else if (has111) plan.choice = '1/1/1';
  }
  // 亚种加成（如丘陵矮人 感知+1）叠加到固定加值上（反馈 3b58-b）
  const sr = subraceObj(r);
  if (sr && sr.bonus) {
    for (const k of Object.keys(sr.bonus)) plan.fixed[k] = (plan.fixed[k] || 0) + sr.bonus[k];
  }
  plan.parsed = !!Object.keys(plan.fixed).length || !!plan.choice;
  return plan;
}
function raceChoiceValid(r) {
  const plan = raceBonusPlan(r);
  if (!plan.choice) return true;
  const ch = state.char.raceChoice || {};
  const distinct = (...xs) => xs.every(Boolean) && new Set(xs).size === xs.length;
  if (ch.mode === '2/1') return distinct(ch.a, ch.b);
  if (ch.mode === '1/1/1') return distinct(ch.a, ch.b, ch.c);
  return false;
}
function raceBonus(attr) {
  const r = race();
  if (!r) return 0;
  const plan = raceBonusPlan(r);
  let v = plan.fixed[attr] || 0;
  const ch = state.char.raceChoice || {};
  if (ch.mode === '2/1') {
    if (ch.a === attr) v += 2;
    if (ch.b === attr) v += 1;
  } else if (ch.mode === '1/1/1') {
    for (const k of ['a', 'b', 'c']) if (ch[k] === attr) v += 1;
  }
  return v;
}
function raceBonusText(r) {
  const plan = raceBonusPlan(r);
  if (!plan.parsed) return '';
  const parts = ATTRS.filter(a => plan.fixed[a]).map(a => `${a} +${plan.fixed[a]}`);
  return parts.join('、');
}
// 购点已花费（32 点表）
function pointBuySpent() {
  return ATTRS.reduce((s, a) => s + (rules().buyTable[state.char.base[a]] || 0), 0);
}
function finalMod(attr) { return abilityMod(finalAttr(attr)); }
function profBonus() { return levelRow()[4]; }
function hitDie() { return klass() ? klass().core.hitDie : 8; }
function hpMax() {
  if (!klass()) return 0;
  const exp = Math.ceil((hitDie() + 1) / 2);
  // 亚种 HP 加成（如丘陵矮人「矮人刚毅」：最大生命值 + 等级）
  const sr = subraceObj(race());
  const srHp = sr && sr.hpPerLevel ? sr.hpPerLevel * state.char.level : 0;
  return 10 + state.char.level * (exp + finalMod('体质')) + srHp;
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
// 是否为准备施法者（返回规则对象或 null）——按基础职业判定（变体职业沿用基础职业的施法规则，反馈 5）
function preparedRule() {
  const b = baseKlass();
  if (!b) return null;
  return PREPARED_CASTERS[b.name] || null;
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
  const b = baseKlass();
  const rule = preparedRule();
  if (!rule || !b) return '';
  if (rule.balls) return '压缩球制：每个准备法术对应一枚机械压缩球，消耗法术位与材料成分';
  const attr = rule.attr;
  const half = rule.half ? '等级的一半' : '等级';
  return `${attr}调整值 + ${b.name}${half}（当前 ${preparedLimit()} 个，最少 1 个）`;
}
// 当前等级拥有的最高法术位环阶（0 = 无法术位）
// 除职业表「法术位」列外，还要合并「专长授予的额外法术位」（如 进阶法术位 的法术位表），反馈 4498-e。
function featSlotMaxLevel() {
  let max = 0;
  for (const fn of state.char.feats || []) {
    const f = DATA.feats.find((x) => x.name === fn);
    for (const t of (f && f.tables) || []) {
      if (!Array.isArray(t) || t.length < 3) continue;
      const headIdx = t.findIndex((r) => Array.isArray(r) && r.some((c) => /法术位/.test(String(c))));
      if (headIdx < 0) continue;
      const ringRow = t[headIdx + 1] || [];
      const lvRow = t.find((r, i) => i > headIdx + 1 && Array.isArray(r) && String(r[0]).replace(/[^\d]/g, '') === String(state.char.level));
      if (!lvRow) continue;
      for (let i = 1; i < lvRow.length; i++) {
        const v = lvRow[i];
        if (v == null || v === '' || v === '—') continue;
        if (!isNaN(+v) && +v > 0 && i > max) max = i;
      }
      // 环阶标签行若更长（1环/2环…），按标签校正
      if (ringRow.length > 1) {
        for (let i = 1; i < Math.min(ringRow.length, lvRow.length); i++) {
          const lv = +(String(ringRow[i] || '').replace(/[^\d]/g, '') || 0);
          if (lv > max && lvRow[i] && lvRow[i] !== '—' && +lvRow[i] > 0) max = lv;
        }
      }
    }
  }
  return max;
}
function maxSlotLevel() {
  const k = klass();
  let max = 0;
  if (k) {
    const lvRow = k.table.find(r => r[0] === String(state.char.level));
    const headRow = k.table[0];
    if (!lvRow) return featSlotMaxLevel();
    const slotIdx = headRow.findIndex(h => /法术位/.test(h));
    if (slotIdx >= 0) {
      for (let i = slotIdx; i < lvRow.length; i++) {
        const v = lvRow[i];
        if (v && v !== '—' && !isNaN(+v) && +v > 0) {
          const lv = i - slotIdx + 1;
          if (lv > max) max = lv;
        }
      }
    }
  }
  return Math.max(max, featSlotMaxLevel());
}

/* ---------- 职业表配额 / 专长先决条件 ---------- */
function classLevelRow() {
  const k = klass();
  if (!k) return null;
  return k.table.find(r => r[0] === String(state.char.level)) || null;
}
// 从职业表当前等级行取数量列（「已知戏法」「已知环法」「已知法术」等）
function classTableCount(re) {
  const k = klass(), row = classLevelRow();
  if (!k || !row) return null;
  const idx = k.table[0].findIndex(h => re.test(h));
  if (idx < 0) return null;
  const v = row[idx];
  if (v == null || v === '' || v === '—' || isNaN(+v)) return null;
  return +v;
}
function spellQuotaInfo() {
  return { cantrips: classTableCount(/已知戏法/), known: classTableCount(/已知环法|已知法术/) };
}
function selectedSpellObjs() {
  return (state.char.spells || []).map(n => DATA.spells.find(s => s.name === n)).filter(Boolean);
}
function featPrereqLine(f) {
  const lines = String(f.text || '').split('\n');
  return lines.find(l => /^先决条件/.test(l)) || '';
}
/* ---------- 专长先决条件：可判定条件的辅助（反馈 2） ----------
 * 反馈：14 级牧师勾选「仅显示当前可选」仍会列出大量圣武士/德鲁伊专长。
 * 为此把「职业（含变体）、职业等级、种族、只能在N级选择、职业特性、专长类别」等
 * 可判定的条件也纳入判定；武器/护甲熟练、阵营、出身地等无法从车卡数据判定的项
 * 仍返回 null（不误杀）。
 */
// 变体职业 → 基础职业名（与解析器的变体数据同口径；数据未更新时也能用）
const VARIANT_BASE_FALLBACK = {
  神官: '牧师', 萨满: '德鲁伊', 侠客: '武僧', 术士: '法师',
  灵契师: '契术师', 恶武士: '圣武士', 战士: '狂战士',
};
const stripVariantSuffix = (n) => String(n || '').replace(/（[^（）]*变体）$/, '').trim();
function classBaseNameOf(name) {
  const n = stripVariantSuffix(name);
  if (!n) return '';
  if (VARIANT_BASE_FALLBACK[n]) return VARIANT_BASE_FALLBACK[n];
  if (!DATA || !Array.isArray(DATA.classes)) return '';
  for (const c of DATA.classes) {
    if (c.id === n || c.name === n) return c.id || c.name;
    for (const v of (c.variants || [])) {
      if (v.name === n || stripVariantSuffix(v.name) === n) return c.id || c.name;
    }
  }
  return '';
}
// 当前角色的基础职业名（选中变体职业时折算回基础职业）
function currentBaseClassName() {
  const b = baseKlass();
  if (b) return b.id || b.name || '';
  const k = klass();
  if (k && k.baseName) return classBaseNameOf(k.baseName) || k.baseName;
  return classBaseNameOf(state.char.classId) || '';
}
// 先决条件里可能出现的职业名表（基础职业 + 变体职业），长名优先匹配
let CLASS_ATOM_CACHE = null;
function classAtomTable() {
  if (CLASS_ATOM_CACHE) return CLASS_ATOM_CACHE;
  const out = [];
  const push = (name, base) => {
    const n = stripVariantSuffix(name);
    if (n && !out.some(x => x.name === n)) out.push({ name: n, base });
  };
  for (const c of (DATA && DATA.classes) || []) {
    const base = c.id || c.name;
    if (c.name) push(c.name, base);
    for (const v of c.variants || []) push(v.name, base);
    // 兼容旧数据：变体页被解析成子职（「神官（牧师变体）」）
    for (const s of c.subclasses || []) {
      const m = /^(.+?)（[^（）]*变体）$/.exec(String(s.name || ''));
      if (m) push(m[1], base);
    }
  }
  for (const [k, v] of Object.entries(VARIANT_BASE_FALLBACK)) push(k, v);
  CLASS_ATOM_CACHE = out.sort((a, b) => b.name.length - a.name.length);
  return CLASS_ATOM_CACHE;
}
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 原子条件是否为「职业」或「职业N级」→ { base, level, name }；否则 null
function matchClassAtom(t) {
  for (const c of classAtomTable()) {
    if (t === c.name) return { base: c.base, level: 0, name: c.name };
    const m = new RegExp('^' + reEsc(c.name) + '\\s*(\\d+)\\s*级$').exec(t);
    if (m) return { base: c.base, level: +m[1], name: c.name };
  }
  return null;
}
// 原子条件是否为种族（含「卓尔精灵」「绿皮兽人」这类前缀叫法）→ 种族名；否则 null
function matchRaceAtom(t) {
  const names = ((DATA && DATA.races) || []).map(r => r.name).filter(Boolean);
  if (!names.length) return null;
  if (names.includes(t)) return t;
  const alias = { 卓尔精灵: '精灵', 高等精灵: '精灵', 木精灵: '精灵', 黑暗精灵: '精灵', 绿皮兽人: '兽人', 混血儿: '' };
  if (alias[t]) return alias[t];
  const suffix = names.filter(n => t !== n && t.endsWith(n) && t.length <= n.length + 2)
    .sort((a, b) => b.length - a.length)[0];
  return suffix || null;
}
// 所有职业（含变体）的特性名集合
let ALL_CLASS_FEATURE_CACHE = null;
function allClassFeatureNameSet() {
  if (ALL_CLASS_FEATURE_CACHE) return ALL_CLASS_FEATURE_CACHE;
  ALL_CLASS_FEATURE_CACHE = new Set();
  for (const c of (DATA && DATA.classes) || []) {
    for (const f of c.features || []) if (f && f.name) ALL_CLASS_FEATURE_CACHE.add(f.name);
    for (const v of c.variants || []) for (const f of v.features || []) if (f && f.name) ALL_CLASS_FEATURE_CACHE.add(f.name);
  }
  return ALL_CLASS_FEATURE_CACHE;
}
// 当前职业（含变体）在角色等级是否已获得该特性：true/false；数据无法判断时 null（不误杀）
function currentClassHasFeature(fname) {
  const k = klass();
  if (!k) return null;
  const level = state.char.level;
  const pool = [];
  for (const f of k.features || []) if (f && f.name === fname) pool.push(f);
  const b = baseKlass();
  if (b && b !== k) for (const f of b.features || []) if (f && f.name === fname) pool.push(f);
  if (!pool.length) return false;                      // 本职业（含变体）没有该特性
  if (pool.some(f => Array.isArray(f.levels) && f.levels.length)) {
    return pool.some(f => (f.levels || []).some(l => Number(l) <= level));
  }
  // 旧数据无 levels：用职业表「特性」列反推已获得等级
  const gained = classTableFeatureNames(k, level);
  if (gained.includes(fname)) return true;
  const all = classTableFeatureNames(k, 20);
  if (all.includes(fname)) return false;               // 表里有，但要更高等级才获得
  return true;                                         // 表里没列（数据不全）→ 不误杀
}
// 已选专长里属于指定分类（category 或合并后的 categories）的个数
function selectedFeatCategoryCount(cat) {
  let n = 0;
  for (const fn of state.char.feats || []) {
    const f = DATA.feats.find((x) => x.name === fn);
    if (!f) continue;
    if (f.category === cat || (Array.isArray(f.categories) && f.categories.includes(cat))) n++;
  }
  return n;
}
// 条件文本剥外层引号：「引导神力」→ 引导神力
function unquoteCond(s) {
  return String(s || '').trim()
    .replace(/^[“”"'‘’「『]+/, '').replace(/[“”"'‘’」』]+$/, '').trim();
}

// 只对「能确定的先决条件」做判断：属性值、等级、职业/变体、种族、职业特性、专长类别、前置专长；
// 武器/护甲熟练、阵营、出生地等未知项不误杀。
// 支持「或」：同一子句内用「或/、」并列的可选项，满足任一即通过（反馈 4498-c）。
function featPrereqStatus(f) {
  const line = featPrereqLine(f);
  if (!line) return { blocked: false, reasons: [], line: '' };
  const body = line.replace(/^先决条件[：:]\s*/, '').trim();
  const reasons = [];
  const known = state.char.feats || [];
  const curBase = currentBaseClassName();
  const featureSet = allClassFeatureNameSet();
  // 单条原子条件 → { ok, why } ；无法判定返回 null（不误杀）
  const atom = (s) => {
    const t = String(s || '').trim().replace(/^[，,；;、]+|[，,；;、]+$/g, '');
    if (!t) return null;
    // 「只能在N级时选择」：必须恰好 N 级
    const onlyLv = /只能在\s*(\d+)\s*级(?:时)?选择/.exec(t);
    if (onlyLv) {
      const need = +onlyLv[1];
      return { ok: state.char.level === need, why: `只能 ${need} 级时选择（当前 ${state.char.level} 级）` };
    }
    // 职业 / 变体职业："圣武士"「圣武士5级」「恶武士5级」「德鲁伊12级」
    const ca = matchClassAtom(t);
    if (ca) {
      if (!curBase) return null;
      if (ca.base !== curBase) {
        const kname = baseKlass() ? baseKlass().name : curBase;
        return { ok: false, why: `需职业「${ca.name}」（当前 ${kname}）` };
      }
      if (!ca.level) return { ok: true, why: '' };
      return { ok: state.char.level >= ca.level, why: `需 ${ca.name}${ca.level} 级（当前 ${state.char.level} 级）` };
    }
    // 种族 / 亚种："人类""真龙""石猴""序位巨人"
    const rn = matchRaceAtom(t);
    if (rn) {
      const r = race();
      if (!r) return null;
      const sub = state.char.subrace || '';
      const hit = r.name === rn || (!!sub && (sub.indexOf(rn) >= 0 || rn.indexOf(sub) >= 0));
      return { ok: hit, why: `需种族「${rn}」（当前 ${r.name}${sub ? '·' + sub : ''}）` };
    }
    // 属性值
    const am = /(力量|敏捷|体质|智力|感知)\s*(?:值)?\s*(?:至少)?\s*(\d+)/.exec(t);
    if (am) {
      const need = +am[2], have = finalAttr(am[1]);
      return { ok: have >= need, why: `${am[1]}需 ${need}（当前 ${have}）` };
    }
    // 职业特性类条件（施法/引导神力/额外攻击/偷袭/狂暴/使用魔法装置/指令点/魂铸武器…）
    const plain = unquoteCond(t);
    const fbase = featureSet.has(plain) ? plain
      : featureSet.has(plain.split(/[·：:]/)[0].trim()) ? plain.split(/[·：:]/)[0].trim() : '';
    if (fbase) {
      const has = currentClassHasFeature(fbase);
      if (has === null) return null;
      return { ok: has, why: has ? '' : `需职业特性「${fbase}」` };
    }
    // 专长类别类条件（任意超魔专长 / 至少一个超魔专长 / 至少一个战技专长）
    if (/^(?:任意|至少一个|拥有至少一个|至少有一个)(超魔|战技)专长$/.test(t)) {
      const cat = /超魔/.test(t) ? '超魔专长' : '战技专长';
      const n = selectedFeatCategoryCount(cat);
      return { ok: n > 0, why: `需至少一个「${cat}」（当前 ${n} 个）` };
    }
    // 习得一个战技：靠战技步（state.char.maneuvers），不是专长
    if (/^(?:习得|学会|掌握)一个战技$/.test(t)) {
      return { ok: (state.char.maneuvers || []).length > 0, why: '需先在战技步学会至少一个战技' };
    }
    // 「玩家角色」恒真
    if (t === '玩家角色') return { ok: true, why: '' };
    // 一般等级条件（"16级""9级"）：至少 N 级（职业相关等级已在上面的职业分支处理）
    const glm = /^(\d+)\s*级$/.exec(t);
    if (glm) return { ok: state.char.level >= +glm[1], why: `需 ${+glm[1]} 级（当前 ${state.char.level} 级）` };
    // 前置专长
    const cleaned = plain.replace(/^(拥有|已获得|获得|学会)\s*/, '').replace(/专长$/, '').trim();
    const hit = DATA.feats.find((x) => x.name === cleaned || x.name === plain);
    if (hit) return { ok: known.includes(hit.name), why: `需先选「${hit.name}」` };
    return null;
  };
  // 子句 = 逗号/分号分隔；以「或」开头的片段并入上一子句（"魔鬼，或提夫林，或地狱之子"）。
  // 子句内部若含「或」则视为可选项（任一满足即可）
  const clauses = [];
  for (const p of body.split(/[，,；;]/).map((s) => s.trim()).filter(Boolean)) {
    if (/^或/.test(p) && clauses.length) clauses[clauses.length - 1] += '，' + p;
    else clauses.push(p);
  }
  for (const clause of clauses) {
    const alts = clause.split(/\s*或\s*|[、]/).map((s) => s.trim()).filter(Boolean);
    const results = alts.map(atom).filter((r) => r !== null);
    if (!results.length) continue;                 // 全是无法判定的条件 → 跳过
    if (results.some((r) => r.ok)) continue;       // 任一满足 → 该子句通过
    reasons.push(results.length > 1 ? results.map((r) => r.why).filter(Boolean).join(' 或 ') : results[0].why);
  }
  return { blocked: reasons.length > 0, reasons, line };
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
  1: '选择种族', 2: '选择职业', 3: '决定属性值', 4: '选择技能熟练', 5: '选择专长',
  6: '选择法术', 7: '选择战技', 8: '选择程序', 9: '角色卡', 10: '购物（魔法物品）', 11: '设定背景与角色信息',
};
const STEP_HINTS = {
  1: '每个角色都有其所属种族。种族提供属性值加成、速度、语言与种族特性。',
  2: '职业决定了你的生命骰、熟练项与职业特性。可先看定位与难度选择。',
  3: '5z 规则共 5 项属性。使用 32 点购点（8~16），或直接采用标准属性组，或随机掷骰。',
  4: '技能熟练来源：职业（自动按职业文本）、背景 2 项、智力 14/18/22/26/30 各 +1 项。',
  5: '1 级获得 2 个专长（其一代表背景训练），此后每 3 级再获得 1 个。',
  6: '按职业法术列表选择已知/准备法术（可搜索、按环位筛选）。准备施法者（法师等）需从已选法术中标记「已准备」，数量按职业规则（如法师=等级+智力调整值）。',
  7: '选择战技流派（及门弟子）与战技。流派入门专长见专长步骤。',
  8: '赛博格专属：按协议层级选择准备程序。其他职业可跳过。',
  9: '可填写角色姓名/玩家、上传立绘，预览角色卡并导出 Word/Excel；也可在最后一步「设定背景与角色信息」补填姓名。',
  10: '为角色选购魔法物品（可选）。顶部手动输入金币预算，超出预算标红提醒；物品价格为规则书价格区间下限。需同调的魔法物品计入同调位（默认 3 个）。',
  11: '最后一步：填写角色姓名/玩家与背景故事（与游戏数据无关）。姓名用于角色卡标题和导出文件名；立绘仍可在第 9 步「角色卡」上传。',
};

/* ============================================================
 * 校验 / 步骤守卫 / 待补清单 / 顶部问题徽标
 * ============================================================ */
function stepIssues(n) {
  const c = state.char, k = klass(), r = race();
  const issues = [];
  const err = (msg) => issues.push({ level: 'error', step: n, msg });
  const warn = (msg) => issues.push({ level: 'warn', step: n, msg });
  switch (n) {
    case 1:
      if (!c.raceId) err('尚未选择种族');
      else if (r) {
        const plan = raceBonusPlan(r);
        if (plan.choice && !raceChoiceValid(r)) err('种族属性加值尚未分配（需选择 +2/+1 或三项 +1）');
        else if (!plan.parsed && plan.raw) warn('种族属性加值未自动识别，请在属性步「额外加值」手动填写');
      }
      break;
    case 2:
      if (!c.classId) err('尚未选择职业');
      break;
    case 3:
      if (!(c.level >= 1 && c.level <= 20)) err('角色等级需在 1–20 之间');
      if (c.buyMethod === 'points') {
        ATTRS.forEach(a => {
          if (c.base[a] < 8 || c.base[a] > 16) err(`${a} 基础值需在 8–16（当前 ${c.base[a]}）`);
        });
        const spent = pointBuySpent();
        if (spent > rules().buyPoints) err(`购点超支：已花 ${spent} / ${rules().buyPoints} 点`);
        else if (spent < rules().buyPoints) warn(`购点未用完：已花 ${spent} / ${rules().buyPoints} 点`);
      }
      break;
    case 4: {
      if (!k) { err('请先完成第 2 步：选择职业'); break; }
      const chosen = skillChosen(), quota = skillQuota();
      if (chosen < quota) err(`技能熟练未选满：${chosen} / ${quota}`);
      else if (chosen > quota) err(`技能熟练超出配额：${chosen} / ${quota}`);
      break;
    }
    case 5: {
      if (!k) { err('请先完成第 2 步：选择职业'); break; }
      const max = featQuota();
      if (c.feats.length < max) err(`专长未选满：${c.feats.length} / ${max}`);
      else if (c.feats.length > max) err(`专长超出配额：${c.feats.length} / ${max}`);
      for (const fn of c.feats) {
        const f = DATA.feats.find(x => x.name === fn);
        if (!f) { warn(`专长「${fn}」在规则数据中不存在（可能已更名）`); continue; }
        const st = featPrereqStatus(f);
        if (st.blocked) warn(`专长「${fn}」前置未满足：${st.reasons.join('；')}`);
      }
      break;
    }
    case 6: {
      if (!k) { err('请先完成第 2 步：选择职业'); break; }
      if (!classSpellList()) break;
      const maxL = maxSlotLevel();
      const selected = selectedSpellObjs();
      const over = selected.filter(sp => sp.level > maxL);
      if (over.length) err(`有 ${over.length} 个法术超过当前最高环阶（${maxL || 0} 环）：${over.slice(0, 4).map(s => s.name).join('、')}${over.length > 4 ? '…' : ''}`);
      const q = spellQuotaInfo();
      const lv0 = selected.filter(sp => sp.level === 0).length;
      const lvN = selected.filter(sp => sp.level >= 1).length;
      if (q.cantrips != null) {
        if (lv0 > q.cantrips) err(`戏法超出配额：${lv0} / ${q.cantrips}`);
        else if (lv0 < q.cantrips) err(`戏法未选满：${lv0} / ${q.cantrips}`);
      }
      if (q.known != null) {
        if (lvN > q.known) err(`已知法术超出配额：${lvN} / ${q.known}`);
        else if (lvN < q.known) err(`已知法术未选满：${lvN} / ${q.known}`);
      }
      const pr = preparedRule();
      if (pr && !pr.balls) {
        const prepN = (c.prepared || []).filter(x => c.spells.includes(x)).length;
        if (prepN < preparedLimit()) warn(`已准备法术 ${prepN} / ${preparedLimit()}（可准备至上限）`);
      }
      if (!c.spells.length) warn('尚未选择任何法术');
      break;
    }
    case 7:
      if (!k) err('请先完成第 2 步：选择职业');
      else if (c.maneuvers.length && !c.maneuverStyle) warn('已选战技但未选择流派');
      break;
    case 8:
      if (!k) err('请先完成第 2 步：选择职业');
      else if (k.name === '赛博格' && !c.programs.length) warn('赛博格尚未选择程序');
      break;
    default: break;
  }
  return issues;
}
function allIssues() {
  let out = [];
  for (let i = 1; i <= 11; i++) out = out.concat(stepIssues(i));
  return out;
}
function issueSummary() {
  const all = allIssues();
  return {
    all,
    errors: all.filter(x => x.level === 'error'),
    warns: all.filter(x => x.level === 'warn'),
  };
}

/* ---------- 顶部徽标 / 问题面板 / 守卫条 ---------- */
function renderIssuePanel() {
  const panel = $('#issue-panel');
  if (!panel) return;
  const sum = issueSummary();
  const byStep = {};
  sum.all.forEach(i => { (byStep[i.step] = byStep[i.step] || []).push(i); });
  const steps = Object.keys(byStep).map(Number).sort((a, b) => a - b);
  panel.innerHTML = `<div class="issue-head">
      <b>待补清单</b><span>${sum.errors.length} 个错误 · ${sum.warns.length} 个提醒</span>
      <button type="button" class="issue-close" title="关闭">✕</button>
    </div>
    <div class="issue-body">${steps.length ? steps.map(n =>
      `<div class="issue-group"><div class="issue-step">第 ${n} 步 · ${esc(STEP_TITLES[n])}</div>` +
      byStep[n].map(i => `<div class="issue-item ${i.level}"><span>${esc(i.msg)}</span><button type="button" data-goto="${n}">前往</button></div>`).join('') +
      `</div>`).join('') : '<p class="muted" style="padding:12px 0">没有待补项，可以导出角色了。</p>'}</div>`;
  panel.querySelector('.issue-close').onclick = () => { panel.hidden = true; };
  panel.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => { panel.hidden = true; setStep(+b.dataset.goto); });
}
function openIssuePanel() {
  let panel = $('#issue-panel');
  if (!panel) {
    panel = el('div', 'issue-panel');
    panel.id = 'issue-panel';
    panel.hidden = true;
    document.body.appendChild(panel);
  }
  panel.hidden = false;
  renderIssuePanel();
}
function hideGuard() {
  const g = $('#guard-bar');
  if (g) g.hidden = true;
}
function showGuard(errors) {
  let g = $('#guard-bar');
  if (!g) {
    g = el('div', 'guard-bar');
    g.id = 'guard-bar';
    document.body.appendChild(g);
  }
  g.innerHTML = `<div class="guard-msg">本步还有 <b>${errors.length}</b> 项未完成：${esc(errors[0].msg)}${errors.length > 1 ? ` 等 ${errors.length} 项` : ''}</div>
    <div class="guard-acts">
      <button type="button" class="nav-btn" data-issues>查看待补</button>
      <button type="button" class="nav-btn" data-bypass>仍要继续</button>
    </div>`;
  g.hidden = false;
  g.querySelector('[data-issues]').onclick = () => { hideGuard(); openIssuePanel(); };
  g.querySelector('[data-bypass]').onclick = () => { hideGuard(); setStep(Math.min(11, state.step + 1)); };
}
// 刷新步骤条完成状态、问题徽标、面板（若打开）
function refreshChrome() {
  if (!DATA) return;
  $$('.step').forEach(b => {
    const n = +b.dataset.step;
    const list = stepIssues(n);
    let errs = list.filter(x => x.level === 'error');
    const warns = list.filter(x => x.level === 'warn');
    // 角色卡/购物：前面步骤还有错误时也标记为未完成（不重复计入待补总数；背景步不适用）
    if (n >= 9 && n <= 10) {
      for (let i = 1; i < n; i++) errs = errs.concat(stepIssues(i).filter(x => x.level === 'error'));
    }
    b.classList.toggle('active', n === state.step);
    b.classList.toggle('complete', errs.length === 0 && warns.length === 0);
    b.classList.toggle('warn', errs.length === 0 && warns.length > 0);
    b.classList.toggle('incomplete', errs.length > 0);
    b.title = (errs.length || warns.length)
      ? (errs.length ? `待补 ${errs.length} 项：` : '待确认：') + errs.concat(warns).map(e => e.msg).join('；')
      : '已完成';
  });
  // 当前步的问题已修好时自动收起守卫条
  const g = $('#guard-bar');
  if (g && !g.hidden && !stepIssues(state.step).some(x => x.level === 'error')) hideGuard();
  const sum = issueSummary();
  const badge = $('#issue-badge');
  if (badge) {
    const pending = sum.errors.length + sum.warns.length;
    badge.textContent = `⚠ 待补 ${pending}`;
    badge.classList.toggle('has-error', sum.errors.length > 0);
    badge.title = sum.all.length ? sum.all.map(x => x.msg).join('\n') : '没有待补项';
  }
  const panel = $('#issue-panel');
  if (panel && !panel.hidden) renderIssuePanel();
}
// 顶部注入：严格模式开关 + 待补徽标（不改 car.html，构建后自动生效）
function injectChrome() {
  const acts = $('.car-top-actions');
  if (acts && !$('#issue-badge')) {
    const strict = el('label', 'strict-toggle');
    strict.title = '严格模式：必填项未完成时阻止「下一步」和导出；关闭后只提示';
    strict.innerHTML = `<input type="checkbox" id="strict-mode"> 严格`;
    acts.insertBefore(strict, acts.firstChild);
    const badge = el('button', 'issue-badge-btn');
    badge.id = 'issue-badge';
    badge.type = 'button';
    badge.textContent = '⚠ 待补 0';
    acts.insertBefore(badge, acts.firstChild);
    badge.onclick = openIssuePanel;
    $('#strict-mode').checked = strictOn();
    $('#strict-mode').onchange = (e) => {
      state.settings.strict = e.target.checked;
      saveSettings();
      toast(e.target.checked ? '严格模式：未完成必填项将阻止前进/导出' : '自由模式：只提示，不阻止');
      refreshChrome();
    };
  }
}
// 导出前检查：严格模式有错误则阻止；自由模式仅提醒
function exportGuard() {
  const sum = issueSummary();
  if (sum.errors.length && strictOn()) {
    openIssuePanel();
    toast(`严格模式：还有 ${sum.errors.length} 项待补，已打开清单（也可在顶部关闭严格模式）`);
    return false;
  }
  if (sum.errors.length) toast(`注意：导出时仍有 ${sum.errors.length} 项待补`);
  else if (sum.warns.length) toast(`提醒：还有 ${sum.warns.length} 项待确认`);
  return true;
}

function setStep(n) {
  state.step = n;
  hideGuard();
  save();
  render();
  const prev = $('#btn-prev'), next = $('#btn-next');
  if (prev) prev.disabled = n <= 1;
  if (next) { next.textContent = n >= 11 ? '完成 ✓' : '下一步 →'; next.disabled = false; }
  refreshChrome();
}

function render() {
  const s = stage();
  s.innerHTML = `<h2>${STEP_TITLES[state.step]}</h2><p class="hint">${STEP_HINTS[state.step]}</p>`;
  switch (state.step) {
    case 1: renderRace(); break;
    case 2: renderClass(); break;
    case 3: renderAttr(); break;
    case 4: renderSkills(); break;
    case 5: renderFeats(); break;
    case 6: renderSpells(); break;
    case 7: renderManeuvers(); break;
    case 8: renderPrograms(); break;
    case 9: renderSheet(); break;
    case 10: renderShop(); break;
    case 11: renderBg(); break;
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
  const detailHost = el('div', 'race-detail');
  wrap.appendChild(detailHost);
  const grid = el('div', 'grid');
  wrap.appendChild(grid);
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
    // —— 种族属性加值：自动解析 / 选择型分配 ——
    const plan = raceBonusPlan(r);
    if (plan.parsed) {
      const box = el('div', 'field race-bonus');
      const ch = state.char.raceChoice || (state.char.raceChoice = { mode: '', a: '', b: '', c: '' });
      if (plan.choice && !ch.mode) ch.mode = plan.choice === '1/1/1' ? '1/1/1' : '2/1';
      const fixedTxt = ATTRS.filter(a => plan.fixed[a]).map(a => `${a} +${plan.fixed[a]}`).join('、');
      box.innerHTML = `<label>种族属性加值</label>
        ${fixedTxt ? `<div class="f-hint race-auto"><b>已自动计入：</b>${esc(fixedTxt)}</div>` : ''}
        ${plan.choice ? `<div class="race-choice">
          ${plan.choice === '2/1or1/1/1' ? `<div class="seg-mini">
            <button type="button" data-mode="2/1">两项：+2 / +1</button>
            <button type="button" data-mode="1/1/1">三项：+1 / +1 / +1</button>
          </div>` : ''}
          <div class="race-choice-slots"></div>
          <div class="f-hint">${plan.choice === '2/1' ? '选择 +2 与 +1 的属性（不能重复）' : '选择分配方式与具体属性（不能重复）'}</div>
          <div class="f-hint race-choice-total"></div>
          <div class="race-choice-actions"><button type="button" class="nav-btn race-clear">清除加值选择</button></div>
        </div>` : ''}
        ${!plan.choice ? `<div class="f-hint">原文：${esc(plan.raw.slice(0, 120))}</div>` : ''}`;
      detailHost.appendChild(box);
      const slots = $('.race-choice-slots', box);
      const totalEl = $('.race-choice-total', box);
      const selOpts = (cur, dis, ph) =>
        `<option value=""${cur ? '' : ' selected'}>${ph}</option>` +
        ATTRS.map(a => `<option value="${a}"${cur === a ? ' selected' : ''}${dis.includes(a) ? ' disabled' : ''}>${a}</option>`).join('');
      const paintSlots = () => {
        if (!slots) return;
        if (ch.mode === '1/1/1') {
          slots.innerHTML = ['a', 'b', 'c'].map((k, i) => {
            const others = ['a', 'b', 'c'].filter(x => x !== k).map(x => ch[x]).filter(Boolean);
            return `<select data-k="${k}" title="+1 属性 ${i + 1}">${selOpts(ch[k], others, '选择 +1 属性')}</select>`;
          }).join('<span class="plus">+1</span>');
        } else {
          slots.innerHTML = `<select data-k="a" title="+2 属性">${selOpts(ch.a, [], '选择 +2 属性')}</select><span class="plus">+2</span>
            <select data-k="b" title="+1 属性">${selOpts(ch.b, [ch.a].filter(Boolean), '选择 +1 属性')}</select><span class="plus">+1</span>`;
        }
        if (totalEl) {
          const got = ATTRS.filter(a => raceBonus(a)).map(a => `${a} +${raceBonus(a)}`).join('、');
          totalEl.innerHTML = got ? `<b>当前加值：</b>${esc(got)}（已自动计入属性）` : '尚未选择，属性不会获得种族加值';
        }
        slots.querySelectorAll('select').forEach(s => s.addEventListener('change', () => {
          ch[s.dataset.k] = s.value;
          state.char.raceChoice = ch;
          save(); paintSlots(); renderLive();
        }));
      };
      box.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
        ch.mode = b.dataset.mode;
        ch.a = ch.b = ch.c = '';
        state.char.raceChoice = ch;
        box.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('sel', x.dataset.mode === ch.mode));
        save(); paintSlots(); renderLive();
      }));
      box.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('sel', x.dataset.mode === ch.mode));
      // 清除按钮：把种族属性加值选择整个解绑（反馈 4498-a）
      const clearBtn = $('.race-clear', box);
      if (clearBtn) clearBtn.addEventListener('click', () => {
        ch.mode = '';
        ch.a = ch.b = ch.c = '';
        state.char.raceChoice = ch;
        box.querySelectorAll('[data-mode]').forEach(x => x.classList.remove('sel'));
        save(); paintSlots(); renderLive();
        try { refreshChrome(); } catch (err) { /* 首屏未就绪 */ }
      });
      paintSlots();
    } else if (plan.raw) {
      detailHost.insertAdjacentHTML('beforeend',
        `<div class="f-hint">种族属性加值：${esc(plan.raw.slice(0, 120))}（未自动识别，请在属性步「额外加值」手动填写）</div>`);
    }
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
      // 候选亚种：优先用解析出的 subraces（带属性加成），再补硬编码英文名映射
      const parsedNames = (r.subraces || []).map((s) => s.name);
      const dictNames = Object.entries(SUBRACE_CAND)
        .filter(([en]) => subTrait.text.includes(en)).map(([, cn]) => cn);
      const chips = [...new Set([...parsedNames, ...dictNames])];
      const pick = el('div', 'field');
      pick.innerHTML = `<label>亚种选择（种族特性「亚种」）</label>
        <div class="sub-chips">${chips.map(s =>
          `<button type="button" class="chip${state.char.subrace === s ? ' sel' : ''}" data-sub="${esc(s)}">${esc(s)}</button>`).join('')}${state.char.subrace ? '<button type="button" class="chip sub-clear">清除</button>' : ''}</div>
        <div class="sub-input"><input type="text" id="race-sub" placeholder="${chips.length ? '或手动输入其它亚种名（如 日精灵）' : '输入亚种名（如 丘陵矮人）'}" value="${esc(state.char.subrace)}" maxlength="20"></div>
        <div class="f-hint sub-bonus" style="color:#8a5a00"></div>
        <div class="f-hint">${esc(subTrait.text.slice(0, 120))}${subTrait.text.length > 120 ? '…' : ''}</div>`;
      const hintEl = pick.querySelector('.sub-bonus');
      // 亚种加成提示（属性加值与 HP 加成会真正计入角色数值，反馈 3b58-b）
      const paintSubBonus = () => {
        if (!hintEl) return;
        const sr = subraceObj(r);
        if (!sr) { hintEl.innerHTML = ''; return; }
        const bt = Object.keys(sr.bonus || {}).map((k) => `${k} +${sr.bonus[k]}`).join('、');
        hintEl.innerHTML = `<b>亚种加成已计入：</b>${esc(bt || '无属性加值')}` +
          (sr.hpPerLevel ? `；最大生命值 +${sr.hpPerLevel * state.char.level}（等级 × ${sr.hpPerLevel}）` : '');
      };
      const setSub = (v, fromInput) => {
        state.char.subrace = v;
        save();
        pick.querySelectorAll('.chip').forEach(c => c.classList.toggle('sel', c.dataset.sub === v));
        if (!fromInput) {
          const inp = pick.querySelector('#race-sub');
          if (inp) inp.value = v;
        }
        paintSubBonus();
        renderLive();
        try { refreshChrome(); } catch (err) { /* 首屏未就绪 */ }
      };
      pick.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
        // 再点一次已选项 = 取消（解绑亚种，反馈 4498-a）
        setSub(state.char.subrace === c.dataset.sub ? '' : c.dataset.sub);
      }));
      const subClear = pick.querySelector('.sub-clear');
      if (subClear) subClear.addEventListener('click', () => setSub(''));
      pick.querySelector('#race-sub').addEventListener('input', (e) => setSub(e.target.value.trim(), true));
      paintSubBonus();
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
      card.onclick = () => {
        if (state.char.raceId !== r.id) {
          state.char.raceId = r.id;
          state.char.raceChoice = { mode: '', a: '', b: '', c: '' };
        }
        save(); paint(); renderLive();
        // 选中后把详情/加值选择器滚到可见位置（58 个种族卡片很长）
        const rect = detailHost.getBoundingClientRect();
        const vh = window.innerHeight || 800;
        if (rect.top < 0 || rect.bottom > vh) detailHost.scrollIntoView({ block: 'start', behavior: 'smooth' });
      };
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
  const keyOf = (base, variant) => (variant ? base.id + '|' + variant.name : base.id + '|');
  const activeKey = () => (state.char.classId || '') + '|' + (state.char.variant || '');
  // 卡片列表：基础职业 + 该职业的变体职业（变体单独成卡并标注「变体」，与子职区分，反馈 5）
  const entries = [];
  for (const c of DATA.classes) {
    entries.push({ base: c, variant: null });
    for (const v of (c.variants || [])) entries.push({ base: c, variant: v });
  }
  for (const { base, variant } of entries) {
    const sel = activeKey() === keyOf(base, variant);
    const core = variant ? variant.core : base.core;
    const nm = variant ? variant.name : base.name;
    const card = el('div', 'card-item' + (sel ? ' sel' : '') + (variant ? ' variant-card' : ''));
    card.dataset.key = keyOf(base, variant);
    const hd = core.hitDie ? `生命骰 D${core.hitDie} · ` : '';
    const roleText = (core.roles || []).slice(0, 3).join(' ');
    card.innerHTML = `<div class="ci-name">${esc(nm)}${variant ? ' <span class="variant-badge">变体</span>' : ''}</div>
      <div class="ci-sub">${variant ? `替换「${esc(base.name)}」 · ` : ''}${esc(hd)}豁免：${esc(core.saves || '—')}</div>
      <div class="ci-desc">${esc(roleText || (core.skills ? '技能：' + core.skills : '') || '')}</div>`;
    card.onclick = () => {
      const sameBase = state.char.classId === base.id;
      state.char.classId = base.id;
      state.char.variant = variant ? variant.name : '';
      if (!sameBase || !subclassList().some(s => s.name === state.char.subclass)) state.char.subclass = '';
      state.char.keyAttr = keyAttrHint();
      save(); render(); renderLive();
      // 详情（职业表/子职选择）在卡片列表上方，选中后滚回可见
      const d = $('#stage .detail-box');
      if (d) {
        const rect = d.getBoundingClientRect();
        const vh = window.innerHeight || 800;
        if (rect.top < 0 || rect.bottom > vh) d.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    };
    grid.appendChild(card);
  }
  const paint = () => {
    const key = activeKey();
    $$('.card-item', grid).forEach(cd => cd.classList.toggle('sel', cd.dataset.key === key));
  };
  const b = baseKlass();
  if (b) {
    const k = klass();
    const d = el('div', 'detail-box');
    let html = `<h3>${esc(k.name)}${k.isVariant ? ' <span class="variant-badge">变体职业</span>' : ''}</h3>`;
    if (k.isVariant) {
      html += `<p class="muted">变体职业：替换「${esc(k.baseName)}」的基础职业特性；考虑先决条件时按等量 ${esc(k.baseName)} 等级计算。
        <a href="${esc(b.url)}" target="_blank">基础职业页面</a> · <a href="${esc(k.url)}" target="_blank">${esc(k.name)} 页面</a></p>`;
    }
    if (k.core.roles && k.core.roles.length) {
      html += k.core.roles.map(r => `<p>${esc(r)}</p>`).join('');
    }
    // 变体职业切换（基础 ↔ 变体）
    if ((b.variants || []).length) {
      html += `<div class="variant-switch"><span class="vs-label">职业版本</span>
        <button type="button" class="vs-btn${k.isVariant ? '' : ' sel'}" data-variant="">${esc(b.name)}（基础）</button>` +
        b.variants.map(v => `<button type="button" class="vs-btn${k.isVariant && k.name === v.name ? ' sel' : ''}" data-variant="${esc(v.name)}">${esc(v.name)}</button>`).join('') +
        `</div>`;
    }
    html += `<div class="table-wrap"><table class="data"><tbody>
      <tr><th>生命骰</th><td>D${k.core.hitDie || '?'}（期望值 ${k.core.hitDie ? Math.ceil((k.core.hitDie + 1) / 2) : '?'}）</td></tr>
      <tr><th>防具熟练</th><td>${esc(k.core.armor || '—')}</td></tr>
      <tr><th>武器熟练</th><td>${esc(k.core.weapons || '—')}</td></tr>
      <tr><th>豁免熟练</th><td>${esc(k.core.saves || '—')}</td></tr>
      <tr><th>技能熟练</th><td>${esc(k.core.skills || '—')}</td></tr>
    </tbody></table></div>`;
    if (k.tableTitle) {
      html += `<h4 style="margin:10px 0 4px">${esc(k.tableTitle)}</h4><div class="table-wrap"><table class="data">`;
      k.table.forEach((row, i) => {
        html += '<tr>' + row.map(cell => i === 0 ? `<th>${esc(cell)}</th>` : `<td>${esc(cell)}</td>`).join('') + '</tr>';
      });
      html += '</table></div>';
    }
    // 1 级特性
    const lv1 = (k.table.find(r => r[0] === '1') || [])[1] || '';
    if (lv1) {
      html += `<h4 style="margin:10px 0 4px">1 级特性：${esc(lv1)}</h4>`;
      for (const f of k.features) {
        if (lv1.split(/[，,、]/).some(n => f.name === n || f.name === n.split('：')[0])) {
          html += `<p><b>${esc(f.name)}</b>　${esc(f.text)}</p>`;
        }
      }
    }
    // 子职（普通职业 / 变体职业各自的候选表）
    const v = activeVariant();
    const opts = subclassList();
    if (v && v.subclassMode === 'none') {
      const vestiges = (b.subclasses || []).filter(s => s.kind === 'vestige');
      html += `<h4 style="margin:10px 0 4px">子职</h4><p class="muted">${esc(v.subclassNote || '该变体职业没有子职。')}</p>`;
      if (vestiges.length) {
        html += `<p class="muted">契灵阶位：` +
          vestiges.map(s => `<a href="${esc(s.url)}" target="_blank">${esc(s.name)}</a>`).join(' · ') + `</p>`;
      }
    } else if (opts.length) {
      html += `<h4 style="margin:10px 0 4px">子职</h4><select id="subclass-sel" class="subclass-sel">`;
      html += `<option value="">（暂不选择）</option>`;
      for (const s of opts) {
        const sel2 = state.char.subclass === s.name;
        html += `<option value="${esc(s.name)}"${sel2 ? ' selected' : ''}>${esc(subclassDisplayName(s))}</option>`;
      }
      html += '</select>';
      let note = '';
      if (v) {
        if (v.subclassMode === 'inherit' && (v.subclassExclude || []).length) {
          note = `与「${esc(v.subclassFrom || b.name)}」相同的子职，但不能选择：${v.subclassExclude.map(esc).join('、')}。`;
        } else if (v.subclassMode === 'inherit') {
          note = `与「${esc(v.subclassFrom || b.name)}」相同的子职。`;
        } else if (v.subclassMode === 'own') {
          note = '该变体职业专属的子职。';
        }
      } else if ((b.variants || []).some(x => x.subclassMode === 'own')) {
        note = '该职业的变体职业有专属子职，切换职业版本后子职选项会同步变化。';
      }
      if (note) html += `<p class="muted" style="margin-top:6px">${note}</p>`;
      html += `<p class="muted" style="margin-top:6px">子职特性全文请从规则书页面查看：
        <a href="${esc(k.url)}" target="_blank">${esc(k.name)}</a></p>`;
    } else {
      html += `<h4 style="margin:10px 0 4px">子职</h4><p class="muted">该职业暂无可选子职数据。</p>`;
    }
    html += `<p class="muted">完整页面：<a href="${esc(k.url)}" target="_blank">${esc(k.name)}（规则书）</a>${k.isVariant ? ` · <a href="${esc(b.url)}" target="_blank">${esc(b.name)}（基础职业）</a>` : ''}</p>`;
    d.innerHTML = html;
    stage().appendChild(d);
    d.querySelectorAll('.vs-btn').forEach(btn => btn.addEventListener('click', () => {
      state.char.variant = btn.dataset.variant || '';
      state.char.subclass = '';
      save(); render(); renderLive();
      try { refreshChrome(); } catch (err) { /* 首屏未就绪 */ }
    }));
    const ss = $('#subclass-sel', d);
    if (ss) ss.addEventListener('change', () => {
      state.char.subclass = ss.value;
      save(); renderLive();
      try { refreshChrome(); } catch (err) { /* 首屏未就绪 */ }
    });
  }
  stage().appendChild(wrap);
  paint();
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
    const spent = pointBuySpent();
    const remain = rules().buyPoints - spent;
    const arr = rules().standardArrays;
    const arrLabel = { arrayA: arr[0], arrayB: arr[1], arrayC: arr[2] };
    const rbTxt = raceBonusText(race());
    const rbNote = rbTxt ? `<div class="f-hint race-auto"><b>种族属性加值已自动计入：</b>${esc(rbTxt)}</div>` : '';
    if (c.buyMethod === 'points') {
      info.innerHTML = `${rbNote}已花费 <b>${spent}</b> / ${rules().buyPoints} 点，剩余 <b class="${remain < 0 ? 'over' : ''}">${remain}</b> 点。
        属性值 8~16（种族调整前），单项上限 16。`;
    } else if (arrLabel[c.buyMethod]) {
      info.innerHTML = `${rbNote}${esc(arrLabel[c.buyMethod].name)}：${arrLabel[c.buyMethod].values.join('、')}。
        点击属性卡片的数值可微调（上下箭头）。`;
    } else if (c.buyMethod === 'roll') {
      info.innerHTML = `${rbNote}掷 5 次 4d6 去最低。可点击"重新掷骰"。`;
    }
    grid.innerHTML = '';
    for (const a of ATTRS) {
      const card = el('div', 'attr-card');
      const final = finalAttr(a);
      const up = levelUpBonus(a);
      const rb = raceBonus(a);
      const parts = [
        `基础 ${c.base[a]}`,
        (c.manual[a] || 0) ? `额外 ${(c.manual[a] || 0) > 0 ? '+' : ''}${c.manual[a]}` : '',
        rb ? `种族 +${rb}` : '',
        up ? `升级 +${up}` : '',
      ].filter(Boolean).join(' + ');
      const lo = c.buyMethod === 'points' ? 8 : 1;
      const hi = c.buyMethod === 'points' ? 16 : 30;
      card.dataset.attr = a;
      card.innerHTML = `<h3>${a}${rb ? `<span class="race-badge">种族 +${rb}</span>` : ''}</h3>
        <input type="number" id="base-${a}" min="${lo}" max="${hi}" value="${c.base[a]}" data-attr="${a}">
        <span class="attr-mod">调整值 ${finalMod(a) >= 0 ? '+' : ''}${finalMod(a)}</span>
        <details class="attr-calc"><summary class="attr-score" title="点击查看算式">${final}</summary>
          <div class="attr-formula">${esc(parts)} = <b>${final}</b></div></details>
        <div class="attr-adj">额外加值（专长/物品等）：<input type="number" id="man-${a}" min="-10" max="10" value="${c.manual[a] || 0}" data-attr="${a}" style="width:56px">
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
    if (c.buyMethod === 'points') {
      let changed = false;
      ATTRS.forEach(a => {
        const v = Math.max(8, Math.min(16, c.base[a]));
        if (v !== c.base[a]) { c.base[a] = v; changed = true; }
      });
      if (changed) toast('已切到 32 点购点，属性值规范到 8–16');
    }
    save(); paint();
  });
  grid.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.attr) return;
    const attr = t.dataset.attr;
    // 输入过程中允许为空/中间值；只更新状态与右侧预览，不重绘本步（避免丢焦点）
    const v = t.value.trim();
    if (v === '' || isNaN(+v)) return;
    if (t.id.startsWith('base-')) c.base[attr] = Math.round(+v);
    else if (t.id.startsWith('man-')) c.manual[attr] = Math.round(+v);
    save(); renderLive();
  });
  grid.addEventListener('change', (e) => {
    // 失焦/回车：空值回填原值；按当前方式夹取范围；点购模式检查 32 点预算
    const t = e.target;
    if (!t.dataset.attr) return;
    const attr = t.dataset.attr;
    const raw = t.value.trim();
    if (t.id.startsWith('base-')) {
      let v = raw === '' || isNaN(+raw) ? (c.base[attr] != null ? c.base[attr] : 8) : Math.round(+raw);
      const lo = c.buyMethod === 'points' ? 8 : 1;
      const hi = c.buyMethod === 'points' ? 16 : 30;
      v = Math.max(lo, Math.min(hi, v));
      const old = c.base[attr];
      c.base[attr] = v;
      if (c.buyMethod === 'points' && pointBuySpent() > rules().buyPoints) {
        c.base[attr] = old;
        toast(`购点不足（${rules().buyPoints} 点已用完），已恢复为 ${old}`);
      }
    } else if (t.id.startsWith('man-')) {
      let v = raw === '' || isNaN(+raw) ? (c.manual[attr] || 0) : Math.round(+raw);
      c.manual[attr] = Math.max(-10, Math.min(10, v));
    }
    save(); paint(); renderLive();
  });
  $('#lvl-in').addEventListener('change', (e) => {
    c.level = Math.max(1, Math.min(20, +e.target.value || 1));
    save(); paint(); renderLive();
    try { refreshChrome(); } catch (err) { /* 首屏未就绪 */ }   // 等级变化后重算待补清单（反馈 4498-d）
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
  // 角色信息放最后一步顶部：姓名/玩家（第 9 步「角色卡」也有编辑入口，两处同步，反馈「名字在哪填」）
  wrap.innerHTML = `<h4 class="sub-h">角色信息</h4>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px">
      ${f('角色姓名', 'bg-char-name', c.name, '如：卡菈·晨光', '显示在角色卡标题与导出文件名上；也可以在第 9 步「角色卡」里填写。')}
      ${f('玩家', 'bg-player', c.player, '你的名字 / 昵称')}
    </div>
    <h4 class="sub-h">背景与扮演</h4>` +
    f('背景名称', 'bg-name', c.bgName, '如：平民英雄、罪犯、流浪儿…', '5z 背景为开放式设计：任意自拟背景，获得 2 项技能熟练 + 1 门额外语言。') +
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
  const bind = (id, key, after) => {
    const node = $('#' + id);
    if (!node) return;
    node.addEventListener('input', (e) => {
      c[key] = e.target.value;
      save();
      if (after) after();
    });
  };
  // 姓名/玩家：同步右侧实时预览（两处编辑入口共用 state.char）
  bind('bg-char-name', 'name', () => { try { renderLive(); } catch (e) { /* 首屏未就绪 */ } });
  bind('bg-player', 'player');
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
      <span style="color:var(--sub)">（职业 ${k ? k.core.skillsCount || 0 : 0} + 背景 2 + 智力额外 ${Math.max(0, quota - 2 - (k ? k.core.skillsCount || 0 : 0))}）</span>
      ${chosen < quota ? `<span class="warn" style="margin-left:8px">还需选 ${quota - chosen} 项</span>` : chosen === quota ? `<span class="good" style="margin-left:8px">已选满 ✓</span>` : ''}`;
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
  const quota = el('div', 'feat-quota');
  stage().appendChild(quota);
  const tools = el('div', 'feat-tools');
  tools.innerHTML = `<label class="f-check"><input type="checkbox" id="feat-only-ok"> 仅显示当前可选</label>
    <span class="f-hint">额外专长数量（来自独狼、和平誓言、"获得专长的专长"等能力）</span>
    <input type="number" id="feat-extra" min="0" max="20" value="${c.extraFeats || 0}" style="width:80px">`;
  stage().appendChild(tools);
  const selBox = el('div', 'sel-box sticky');
  stage().appendChild(selBox);
  const pk = el('div', 'pk-car feat-pk');
  const pkToolbar = el('div', 'pk-toolbar');
  const pkChips = el('div', 'pk-chips');
  const pkList = el('div', 'pk-list');
  const pkDetail = el('div', 'pk-detail');
  const pkPager = el('div', 'pk-pager');
  pkPager.hidden = true;
  pk.append(pkToolbar, pkChips, pkList, pkDetail, pkPager);
  stage().appendChild(pk);
  // 分类筛选项 = category ∪ categories（同名专长去重后多来源分类并入 categories，反馈 6）
  const cats = [...new Set(DATA.feats.flatMap(f => [f.category, ...(f.categories || [])]).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  let onlyOk = false;
  const picker = Picker.create({
    data: DATA.feats,
    selKey: 'name',
    pageSize: 60,
    placeholder: '搜索专长名或描述…',
    emptyText: '没有匹配的专长。',
    chips: [{ key: 'category', label: '分类', items: cats,
      match: (f, k) => f.category === k || (Array.isArray(f.categories) && f.categories.includes(k)) }],
    hay: (f) => f.name + ' ' + (f.text || ''),
    filter: (f) => !onlyOk || !featPrereqStatus(f).blocked,
    containers: { toolbar: pkToolbar, chips: pkChips, list: pkList, detail: pkDetail, pager: pkPager },
    itemHtml: (f) => {
      const selected = c.feats.includes(f.name);
      const st = featPrereqStatus(f);
      const desc = String(f.text || '').split('\n').filter(l => !/^先决条件/.test(l)).join(' ').slice(0, 90);
      return `<div class="pk-i-name">${esc(f.name)}${selected ? ' <span class="pk-tag pk-tag-sel">已选</span>' : ''}</div>
        <div class="pk-i-sub">${esc(f.category || '')}${f.sub ? ' · ' + esc(f.sub) : ''}</div>
        ${st.line ? `<div class="pk-i-prereq${st.blocked ? ' bad' : ''}">${esc(st.line)}${st.blocked ? '（未满足：' + esc(st.reasons.join('；')) + '）' : ''}</div>` : ''}
        <div class="pk-i-desc">${esc(desc)}</div>
        <div class="pk-i-acts"><button type="button" class="nav-btn pk-act" data-act="sel" data-name="${esc(f.name)}" style="padding:3px 12px;font-size:12px">${selected ? '移除' : '选择'}</button></div>`;
    },
    detailHtml: (f) => {
      const prereq = featPrereqLine(f);
      return `<div class="pk-d-name">${esc(f.name)}</div>
        <div class="pk-d-sub">${esc(f.category || '')}${f.sub ? ' · ' + esc(f.sub) : ''}</div>
        ${prereq ? `<div class="pk-d-fields"><div class="f"><span class="k">先决条件</span><span class="v">${esc(prereq.replace(/^先决条件[：:]\s*/, ''))}</span></div></div>` : ''}
        <div class="pk-d-text">${esc(f.text || '')}</div>
        ${f.url ? `<a class="pk-d-link" href="${esc(f.url)}" target="_blank">📖 规则书原文 →</a>` : ''}`;
    },
  });
  // 回归测试钩子：当前筛选结果（「仅显示当前可选」生效后的列表）
  window.__CAR_FEATLIST__ = () => picker.filtered().map(x => x.name);
  const paintSel = () => {
    const max = featQuota(), base = featBaseQuota();
    quota.innerHTML = `本等级基础专长 <b>${base}</b> 个${c.extraFeats ? ` + 额外 <b>${c.extraFeats}</b>` : ''}，共 <b>${max}</b> 个，已选 <b class="${c.feats.length > max ? 'over' : ''}">${c.feats.length}</b> 个。`;
    selBox.innerHTML = c.feats.length
      ? `<div class="sel-box-title">已选专长（<b>${c.feats.length}</b> 个）：</div>
         <div class="sel-chips">${c.feats.map(fn =>
           `<button type="button" class="sel-chip" data-f="${esc(fn)}">${esc(fn)} ✕</button>`).join('')}</div>`
      : `<div class="sel-box-title">已选专长：暂无（本等级需要选 ${max} 个）</div>`;
    selBox.querySelectorAll('.sel-chip').forEach(b => b.addEventListener('click', () => {
      const st = pkList.scrollTop;
      c.feats = c.feats.filter(x => x !== b.dataset.f);
      save(); paintSel(); picker.paint();
      pkList.scrollTop = st;
      try { refreshChrome(); } catch (err) { /* 首屏未就绪 */ }   // 专长变化后重算待补清单（反馈 4498-d）
    }));
  };
  // 列表内按钮：事件委托（选择/移除）
  pkList.addEventListener('click', (e) => {
    const btn = e.target.closest('.pk-act');
    if (!btn) return;
    const name = btn.dataset.name;
    const st = pkList.scrollTop;
    if (c.feats.includes(name)) {
      c.feats = c.feats.filter(x => x !== name);
    } else {
      const max = featQuota();
      if (c.feats.length >= max) { toast(`专长数量已达上限（${max} 个）；若有额外来源可在上方"额外专长数量"中补充`); return; }
      const f = DATA.feats.find(x => x.name === name);
      const ps = f ? featPrereqStatus(f) : { blocked: false, reasons: [] };
      if (ps.blocked) toast(`注意：前置未满足（${ps.reasons.join('；')}），仍已加入`);
      c.feats.push(name);
    }
    save(); paintSel(); picker.paint();
    pkList.scrollTop = st;
    try { refreshChrome(); } catch (err) { /* 首屏未就绪 */ }   // 专长变化后重算待补清单（反馈 4498-d）
  });
  $('#feat-extra', tools).addEventListener('input', (e) => {
    c.extraFeats = Math.max(0, Math.min(20, +e.target.value || 0));
    save(); paintSel(); picker.paint();
    try { refreshChrome(); } catch (err) { /* 首屏未就绪 */ }
  });
  $('#feat-only-ok', tools).addEventListener('change', (e) => {
    onlyOk = e.target.checked;
    picker.state.page = 1;
    picker.paint(true);
  });
  picker.paint();
  picker.initialDetail();
  paintSel();
  // —— 专长「魔法学徒」授予的法术：2 个戏法 + 1 个一环法术（反馈 3b58-c）——
  if (c.feats.includes('魔法学徒')) {
    const allClasses = [...new Set((DATA['class-spells'] || []).map((x) => x.class))].filter((x) => x !== '非职业法术');
    const listsFor = (cls) => {
      const cs = (DATA['class-spells'] || []).find((x) => x.class === cls);
      return cs ? cs.lists : {};
    };
    const box = el('div', 'field mi-spells');
    const paintMi = () => {
      const cls = c.miClass || allClasses[0] || '';
      const lists = listsFor(cls);
      const opt = (arr, sel, ph) => `<option value=""${sel ? '' : ' selected'}>${ph}</option>` +
        (arr || []).map((n) => `<option value="${esc(n)}"${n === sel ? ' selected' : ''}>${esc(n)}</option>`).join('');
      const cur = Array.isArray(c.featSpells) ? c.featSpells : [];
      box.innerHTML = `<label>魔法学徒法术（专长授予：2 个戏法 + 1 个一环法术）</label>
        <div class="sub-input"><select id="mi-class">${allClasses.map((x) => `<option value="${esc(x)}"${x === cls ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
        <div class="sub-chips">
          <select id="mi-c1" title="戏法 1">${opt(lists['0'], cur[0], '选择戏法 1')}</select>
          <select id="mi-c2" title="戏法 2">${opt(lists['0'], cur[1], '选择戏法 2')}</select>
          <select id="mi-l1" title="一环法术">${opt(lists['1'], cur[2], '选择一环法术')}</select>
        </div>
        <div class="f-hint">这些法术来自所选职业列表；每两次长休之间可免法术位施展那个一环法术，施法关键属性按职业（智力/感知）。</div>`;
      box.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => {
        if (s.id === 'mi-class') { c.miClass = s.value; c.featSpells = []; save(); paintMi(); renderLive(); return; }
        c.miClass = $('#mi-class', box).value;
        c.featSpells = [$('#mi-c1', box).value, $('#mi-c2', box).value, $('#mi-l1', box).value].filter(Boolean);
        if (c.featSpells.length !== new Set(c.featSpells).size) toast('魔法学徒的三个法术不能重复');
        save(); renderLive();
      }));
    };
    paintMi();
    stage().appendChild(box);
  }
}

/* ---------- 步骤7 法术 ---------- */
function classSpellList() {
  const b = baseKlass();
  if (!b) return null;
  // 变体职业沿用基础职业的法术列表（神官→牧师、萨满→德鲁伊、灵契师→契术师…，反馈 5）
  return DATA['class-spells'].find(cs => cs.class === b.name) || null;
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
    gHtml += `<div class="prep-notice" style="margin-top:8px;padding:10px 12px;border:1px solid #f0b429;border-left:4px solid #f0b429;border-radius:8px;background:rgba(240,180,41,.10)">
      <b>⚑ 准备施法者：本职业选完法术后，还需要逐个标记「已准备」才能当日施放。</b><br>
      操作：在下方法术列表中，把要准备的法术右侧的「<b>准备</b>」按钮点一下（按钮会变成「✓ 已准备」）。<br>
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
  const SCHOOLS = baseSchools(spells);

  const picker = Picker.create({
    data: spells,
    selKey: 'name',
    pageSize: 80,
    placeholder: '搜索法术名或描述…',
    emptyText: '没有匹配的法术。',
    chips: [
      { key: 'level', label: '环位', items: LEVELS, labelFn: lvLabel },
      { key: 'school', label: '学派（任选，命中任一即显示）', items: SCHOOLS, match: spellMatchSchool },
    ],
    hay: (s) => s.name + ' ' + s.text,
    containers: { toolbar: pkToolbar, chips: pkChips, list: pkList, detail: pkDetail, pager: pkPager },
    itemHtml: (s) => {
      const sel = c.spells.includes(s.name);
      const isPrep = prepRule && (c.prepared || []).includes(s.name);
      const canPrep = prepRule && s.level >= 1 && s.level <= maxSlotLevel();
      return `<div class="pk-i-name">${esc(s.name)}${isPrep ? ' <span class="pk-tag pk-tag-prep">已准备</span>' : ''}</div>
        <div class="pk-i-sub">${lvLabel(s.level)} · ${esc(schoolLabel(s))}</div>
        <div class="pk-i-acts">
          <button type="button" class="nav-btn pk-act" data-act="sel" data-name="${esc(s.name)}" style="padding:3px 12px;font-size:12px">${sel ? '移除' : '选择'}</button>
          ${canPrep ? `<button type="button" class="nav-btn pk-act${isPrep ? ' on' : ''}" data-act="prep" data-name="${esc(s.name)}" style="padding:3px 12px;font-size:12px;${isPrep ? '' : 'border:1px solid #f0b429;color:#8a5a00;font-weight:600'}" ${isPrep ? 'disabled' : ''}>${isPrep ? '✓ 已准备' : '⚑ 准备'}</button>` : ''}
        </div>`;
    },
    detailHtml: (s) => {
      const fields = [
        ['环阶', lvLabel(s.level)], ['学派', schoolLabel(s)],
        ['施法时间', s.castTime || '—'], ['施法距离', s.range || '—'],
        ['法术目标', s.target || '—'], ['法术成分', s.components || '—'],
        ['持续时间', s.duration || '—'], ['需要专注', s.focus ? '是' : '否'],
        ['仪式', s.ritual ? '是（可作为仪式施展）' : '否'],
      ];
      return `<div class="pk-d-name">${esc(s.name)}</div>
        <div class="pk-d-sub">${lvLabel(s.level)} · ${esc(schoolLabel(s))}</div>
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
    const q = spellQuotaInfo();
    const lv0 = selectedSpellObjs().filter(sp => sp.level === 0).length;
    const lvN = selectedSpellObjs().filter(sp => sp.level >= 1).length;
    const quotaTxt = [
      q.cantrips != null ? `戏法 <b class="${lv0 > q.cantrips ? 'over' : lv0 < q.cantrips ? 'warn' : 'good'}">${lv0}</b> / ${q.cantrips}` : '',
      q.known != null ? `已知法术 <b class="${lvN > q.known ? 'over' : lvN < q.known ? 'warn' : 'good'}">${lvN}</b> / ${q.known}` : '',
    ].filter(Boolean).join(' · ');
    cnt.innerHTML = `已选法术 <b>${c.spells.length}</b> 个（共 ${spells.length} 个可选）${lvSum ? `：${lvSum}` : ''}${quotaTxt ? ` ｜ 配额：${quotaTxt}` : ''}${prepRule ? ` · 已准备 <b class="${prepRule.balls ? '' : (prepN > preparedLimit() ? 'over' : '')}">${prepN}</b> / ${prepRule.balls ? '不限' : preparedLimit()} 个` : ''}。`;
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
        const sp = DATA.spells.find(x => x.name === n);
        const maxL = maxSlotLevel();
        if (sp && sp.level > maxL) {
          toast(`「${n}」是 ${sp.level} 环法术，超过当前等级可获得的最高 ${maxL || 0} 环法术位`);
          return;
        }
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

  const picker = Picker.create({
    data: () => DATA.programs.filter(x => x.protocol === (c.programProtocol || '阿尔法')),
    selKey: 'name',
    pageSize: 100,
    placeholder: '搜索程序名或效果…',
    emptyText: '没有匹配的程序。',
    // 模块：只列 5 个核心模块（任选）。匹配规则为「所需模块 ⊆ 已选模块」，
    // 由下方 filter 按"能用的程序"语义判定；此处 match 恒真以绕过 chips 的 OR 预筛。
    chips: [{ key: 'module', label: '模块（任选，显示能用的程序）', items: CORE_MODULES, match: () => true }],
    hay: (p) => p.name + ' ' + (p.text || ''),
    filter: (p, f) => {
      const sel = f.chips.module || [];
      if (sel.length) {
        const info = progModuleInfo(p);
        if (!info.none) {
          if (info.any) {
            if (sel.length < 2) return false;          // 任意两个：需勾选 ≥2 个模块
          } else if (!info.list.every(m => sel.includes(m))) {
            return false;                               // 所需模块必须全部被勾选
          }
        }
      }
      return true;
    },
    containers: { toolbar: pkToolbar, chips: pkChips, list: pkList, detail: pkDetail, pager: pkPager },
    itemHtml: (p) => {
      const sel = c.programs.includes(p.name);
      return `<div class="pk-i-name">${esc(p.name)}${p.focus ? ' <span class="pk-tag pk-tag-focus">专注</span>' : ''}</div>
        <div class="pk-i-sub">${esc(p.protocol)} · ${esc(moduleLabel(p))} · ${esc(p.act || '')}</div>
        <div class="pk-i-acts">
          <button type="button" class="nav-btn pk-act" data-name="${esc(p.name)}" style="padding:3px 12px;font-size:12px">${sel ? '移除' : '选择'}</button>
        </div>`;
    },
    detailHtml: (p) => `<div class="pk-d-name">${esc(p.name)}</div>
      <div class="pk-d-sub">${esc(p.protocol)}协议</div>
      <div class="pk-d-fields">
        <div class="f"><span class="k">所需模块</span><span class="v">${esc(moduleLabel(p))}</span></div>
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
        return `<span class="sel-chip" data-f="${esc(n)}">${esc(n)}${p ? `（${esc(p.protocol)} ${esc(moduleLabel(p))}）` : ''} ✕</span>`;
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
/* ---------- 步骤11 购物（魔法物品） ---------- */
// 魔法物品价格分级（与词典页一致）
const MI_TIERS = [
  { k: '0', label: '≤100gp', lo: 0, hi: 100 },
  { k: '1', label: '101–500gp', lo: 101, hi: 500 },
  { k: '2', label: '501–2000gp', lo: 501, hi: 2000 },
  { k: '3', label: '2001–1万gp', lo: 2001, hi: 10000 },
  { k: '4', label: '1万–5万gp', lo: 10001, hi: 50000 },
  { k: '5', label: '>5万gp', lo: 50001, hi: Infinity },
];
// 运行时补全 hay/tiers/span（magic-items.json 原始字段不含这些）
function enrichMagicItems() {
  const MI = DATA.magicItems || [];
  for (const i of MI) {
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
  }
  return MI;
}
// 物品预算价：价格区间下限；非卖品/价格见下表 → null（不参与合计）
function miPrice(i) {
  if (!i || i.nonsell || !i.pmin) return null;
  if (i.price === '价格见下表' || /价格见下?表/.test(i.attr || '')) return null;
  return i.pmin;
}

/* ---------- 多价位魔法物品展开（反馈 #20261007-110200-0c44） ----------
 * 规则书里「增强盔甲」「抵抗盔甲」「奥法秘典」这类物品是**一个词条 + 一张按加值分档的价格表**
 * （+1 400gp / +2 3200gp / +3 16000gp），而购物页原本是「一个词条 ↔ 一个价格」，
 * 遇到 price=「价格见下表」就整条不计价。这里把档位展开成独立可购买变体：
 *   增强盔甲 +1（400gp）/ +2（3200gp）/ +3（16000gp）
 * 其中「+N gp，外加盔甲原价」这类（仅 增强盔甲 / 抵抗盔甲 2 件）标记 plusBase=true：
 * 档位价照常计入合计，另在界面提示「＋基底盔甲原价」，由玩家自行补上基底价。
 */
function expandTierVariants(list) {
  const out = [];
  for (const i of list) {
    const rows = [];
    for (const t of i.tables || []) {
      if (!Array.isArray(t)) continue;
      for (const r of t) {
        if (!Array.isArray(r) || r.length < 2) continue;
        const tier = String(r[0] || '').trim();
        const txt = String(r[1] || '');
        if (!/^\+/.test(tier)) continue;
        const m = /(\d[\d,]*(?:\.\d+)?)\s*gp/i.exec(txt);
        if (!m) continue;
        rows.push({ tier, gp: Math.round(parseFloat(m[1].replace(/,/g, ''))), plusBase: /外加|加上|另加|原价/.test(txt) });
      }
    }
    if (!rows.length) { out.push(i); continue; }
    i.hasVariants = true;
    for (const r of rows) {
      out.push({
        ...i,
        id: `${i.id}#${r.tier}`,
        name: `${i.name} ${r.tier}`,
        price: '',
        attr: String(i.attr || '').replace(/[，,]?\s*价格见下?表\s*/g, ''),
        pmin: r.gp,
        pmax: r.gp,
        tiers: [],
        span: `${r.gp}gp`,
        variantOf: i.id,
        variantTier: r.tier,
        plusBase: r.plusBase,
        hasVariants: false,          // 变体自身不是「原多价位词条」，否则会被过滤掉
        hay: `${i.name} ${r.tier} ${i.hay || ''}`,
      });
    }
  }
  return out;
}
let MI_ALL_CACHE = null;
function magicItemsAll() {
  if (!MI_ALL_CACHE) MI_ALL_CACHE = expandTierVariants(enrichMagicItems());
  return MI_ALL_CACHE;
}
function miById(id) {
  const hit = magicItemsAll().find((m) => m.id === id);
  if (hit) return hit;
  // 旧存档兜底：多价位原词条已展开成变体，原 id 仍可用于显示（价格会标为未定）
  return (DATA.magicItems || []).find((m) => m.id === id) || null;
}
// 同调位上限（反馈 7）：默认 3，缺失/非法时按 3，允许 0–30
function clampAttuneSlots(v) {
  if (v === '' || v == null) return 3;
  const n = Number(v);
  if (!Number.isFinite(n)) return 3;
  return Math.max(0, Math.min(30, Math.floor(n)));
}
function attuneSlotsOf() { return clampAttuneSlots(state.char.attuneSlots); }
function renderShop() {
  const c = state.char;
  const MI = magicItemsAll().filter((i) => !i.hasVariants);   // 多价位词条已展开为变体，原条目不再单列
  if (!MI.length) { stage().insertAdjacentHTML('beforeend', '<p class="hint">魔法物品数据未加载。</p>'); return; }

  // 预算输入 + 同调位上限
  const budgetBox = el('div', 'guide-box');
  budgetBox.innerHTML = `<b>购物预算（gp）：</b>
    <input type="number" id="shop-budget" min="0" step="100" value="${c.budget == null ? '' : esc(c.budget)}" placeholder="如 1000" style="width:130px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink)">
    <span class="hint" style="margin-left:8px">留空 = 不限预算。价格为规则书价格区间下限；「非卖品/价格见下表」不计入合计。</span>
    <span class="attune-box" style="margin-left:14px;white-space:nowrap">同调位上限
      <input type="number" id="shop-attune" min="0" max="30" step="1" value="${attuneSlotsOf()}" title="默认为 3 个同调位（0–30）"
        style="width:64px;padding:5px 6px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink)">
    </span>
    <span id="shop-attune-count" class="attune-count" style="margin-left:10px;font-weight:600"></span>`;
  stage().appendChild(budgetBox);
  const budgetIn = $('#shop-budget');
  budgetIn.addEventListener('input', () => { c.budget = budgetIn.value.trim(); save(); paintShop(); });
  const attuneIn = $('#shop-attune');
  attuneIn.addEventListener('input', () => {
    const v = Number(attuneIn.value);
    if (Number.isFinite(v) && v >= 0 && v <= 30) { c.attuneSlots = Math.floor(v); save(); paintShop(); }
  });
  attuneIn.addEventListener('change', () => {
    c.attuneSlots = clampAttuneSlots(attuneIn.value);
    attuneIn.value = c.attuneSlots;
    save(); paintShop();
  });

  // 已购面板 + 合计行
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
  pk.appendChild(pkToolbar); pk.appendChild(pkChips); pk.appendChild(pkList); pk.appendChild(pkDetail); pk.appendChild(pkPager);
  stage().appendChild(pk);

  const CATS = [...new Set(MI.map(i => i.sub).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  // 购物清单默认按价格升序（按规则书价格区间下限），无价的排在最后，便于按价位浏览
  const shopList = [...MI].sort((a, b) => {
    const pa = miPrice(a), pb = miPrice(b);
    if (pa == null && pb == null) return 0;
    if (pa == null) return 1;
    if (pb == null) return -1;
    return pa - pb;
  });

  const picker = Picker.create({
    data: shopList,
    selKey: 'id',
    pageSize: 80,
    placeholder: '搜索物品名、类型、效果…',
    emptyText: '没有匹配的魔法物品。',
    chips: [
      { key: 'sub', label: '分类', items: CATS },
      { key: 'pr', label: '价格', items: [...MI_TIERS.map(t => t.k), 'nonsell', 'none'],
        labelFn: (k) => { const t = MI_TIERS.find(x => x.k === k); return t ? t.label : (k === 'nonsell' ? '非卖品' : '特别'); },
        match: (i, k) => k === 'nonsell' ? !!i.nonsell : k === 'none' ? !(i.nonsell || i.pmin != null) : (i.tiers || []).includes(k) },
    ],
    hay: (i) => i.hay || '',
    filter: (i, f) => {
      if (f.attune === '1' && !i.attune) return false;
      if (f.attune === '0' && i.attune) return false;
      if (f.artifact === '1' && !i.artifact) return false;
      if (f.artifact === '0' && i.artifact) return false;
      // 自定义价格区间（gp，按规则书价格下限）——粗档次之外可精确定位价位
      const p = miPrice(i);
      if (f.pmin !== '' && (p == null || p < parseFloat(f.pmin))) return false;
      if (f.pmax !== '' && (p == null || p > parseFloat(f.pmax))) return false;
      return true;
    },
    extraState: { attune: '', artifact: '', pmin: '', pmax: '' },
    extraToolbar(tb, f, paint) {
      const wrap = el('span', 'pk-toolbar-extras');
      wrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center';
      wrap.innerHTML = `<select class="pk-attune"><option value="">同调：全部</option>
        <option value="1"${f.attune === '1' ? ' selected' : ''}>需同调</option>
        <option value="0"${f.attune === '0' ? ' selected' : ''}>不需同调</option></select>
        <select class="pk-artifact"><option value="">神器：全部</option>
        <option value="1"${f.artifact === '1' ? ' selected' : ''}>仅神器</option>
        <option value="0"${f.artifact === '0' ? ' selected' : ''}>非神器</option></select>
        <span style="font-size:12px;color:var(--muted)">价格(gp)</span>
        <input type="number" class="pk-pmin" min="0" step="100" placeholder="最低"
          value="${esc(f.pmin === '' ? '' : f.pmin)}" style="width:80px;padding:4px 6px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink)">
        <span style="color:var(--muted)">–</span>
        <input type="number" class="pk-pmax" min="0" step="100" placeholder="最高"
          value="${esc(f.pmax === '' ? '' : f.pmax)}" style="width:80px;padding:4px 6px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink)">`;
      tb.appendChild(wrap);
      $('.pk-attune', wrap).addEventListener('change', (e) => { f.attune = e.target.value; f.page = 1; paint(true); });
      $('.pk-artifact', wrap).addEventListener('change', (e) => { f.artifact = e.target.value; f.page = 1; paint(true); });
      $('.pk-pmin', wrap).addEventListener('change', (e) => { f.pmin = e.target.value.trim(); f.page = 1; paint(true); });
      $('.pk-pmax', wrap).addEventListener('change', (e) => { f.pmax = e.target.value.trim(); f.page = 1; paint(true); });
    },
    itemHtml: (i) => {
      const sel = (c.equipment || []).some(x => x.id === i.id);
      const price = miPrice(i);
      return `<div class="pk-i-name">${esc(i.name)}${i.artifact ? ' <span class="pk-tag pk-tag-artifact">神器</span>' : ''}${i.attune ? ' <span class="pk-tag pk-tag-attune">同调</span>' : ''}</div>
        <div class="pk-i-sub">${esc(i.sub)}${i.variantTier ? ` · 档位 ${esc(i.variantTier)}` : ''} · ${price != null ? price + 'gp' : esc(i.span || i.attr || '未收录价格')}${i.plusBase ? ' ＋基底盔甲原价' : ''}</div>
        <div class="pk-i-acts">
          <button type="button" class="nav-btn pk-act" data-act="shop" data-id="${esc(i.id)}" style="padding:3px 12px;font-size:12px">${sel ? '移除' : '购入'}</button>
        </div>`;
    },
    detailHtml: (i) => {
      const price = miPrice(i);
      const fields = [
        ['类型行', i.attr || '—'],
        ['同调', i.attune ? (i.attuneText || '需同调') : '否'],
        ['价格', i.nonsell ? '非卖品' : (price != null ? price + 'gp' + (i.plusBase ? '，外加基底盔甲原价' : '') : (i.span || '价格见下表'))],
        ['价格区间', i.span || '—'],
      ];
      return `<div class="pk-d-name">${esc(i.name)}${i.artifact ? ' <span class="pk-tag pk-tag-artifact">神器</span>' : ''}</div>
        <div class="pk-d-sub">${esc(i.sub)}${i.en ? ` · ${esc(i.en)}` : ''}</div>
        <div class="pk-d-fields">${fields.map(([k, v]) =>
          `<div class="f"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`).join('')}</div>
        ${Picker.tablesHtml(i.tables)}
        ${i.text ? `<div class="pk-d-text">${esc(i.text)}</div>` : '<p class="pk-muted">规则书未收录该物品的独立详述。</p>'}
        <a class="pk-d-link" href="${esc(i.url)}" target="_blank">📖 规则书原文（${esc(i.sub)}）→</a>`;
    },
    containers: { toolbar: pkToolbar, chips: pkChips, list: pkList, detail: pkDetail, pager: pkPager },
  });

  // 已购面板 + 合计
  const paintShop = () => {
    const eq = c.equipment || [];
    let total = 0, unpriced = 0, attuned = 0;
    const rows = [];
    let plusBaseCnt = 0;
    for (const x of eq) {
      const it = miById(x.id);
      const p = miPrice(it);
      const isAttune = !!(it && it.attune);
      if (it && it.plusBase) plusBaseCnt++;
      if (isAttune) attuned++;
      if (p != null) { total += p; rows.push({ id: x.id, name: it ? it.name : x.id, p, plusBase: !!(it && it.plusBase), attune: isAttune }); }
      else { unpriced++; rows.push({ id: x.id, name: it ? it.name : x.id, p: null, plusBase: !!(it && it.plusBase), attune: isAttune }); }
    }
    const budget = c.budget != null && c.budget !== '' ? Math.max(0, parseInt(c.budget, 10) || 0) : null;
    const over = budget != null && total > budget;
    // 同调位：已同调件数 / 上限（默认 3），超限红色提示（反馈 7）
    const slotMax = attuneSlotsOf();
    const slotLeft = slotMax - attuned;
    const attuneOver = slotLeft < 0;
    cnt.innerHTML = `已购 <b>${eq.length}</b> 件 · 合计 <b class="${over ? 'over' : ''}" style="${over ? 'color:var(--bad)' : ''}">${total}gp</b>${unpriced ? ` · ${unpriced} 件价格未定（不计入）` : ''}${plusBaseCnt ? ` · 其中 ${plusBaseCnt} 件需另加基底盔甲价` : ''}${budget != null ? ` · 预算 <b>${budget}gp</b>${over ? ' <span style="color:var(--bad)">⚠ 超预算</span>' : ''}` : ''}`;
    const attuneCnt = $('#shop-attune-count');
    if (attuneCnt) {
      attuneCnt.innerHTML = `已同调 <b>${attuned}</b> / 上限 <b>${slotMax}</b>（剩余 <b>${Math.max(0, slotLeft)}</b>${attuneOver ? '，<span style="color:var(--bad)">⚠ 超限 ' + (-slotLeft) + ' 件</span>' : ''}）`;
      attuneCnt.style.color = attuneOver ? 'var(--bad)' : '';
      attuneCnt.title = attuneOver
        ? `需同调的物品已超出同调位上限 ${-slotLeft} 件：请移除部分物品或调高上限`
        : '需同调的物品件数不能超过同调位上限（默认 3）';
    }
    selBox.innerHTML = rows.length ? `<div class="sel-box-title">已购清单（<b>${eq.length}</b> 件${budget != null ? ` / 预算 ${budget}gp` : ''}${attuned ? ` / 已同调 ${attuned}` : ''}${attuneOver ? ` <span style="color:var(--bad)">⚠ 同调超限</span>` : ''}）：</div>
      <div class="sel-groups">` + rows.map(x =>
        `<button type="button" class="sel-chip" data-id="${esc(x.id)}">${esc(x.name)}${x.attune ? ' · 同调' : ''}${x.p != null ? ` · ${x.p}gp` : ' · 价格未定'}${x.plusBase ? '＋基底' : ''} ✕</button>`).join('') + `</div>`
      : `<div class="sel-box-title">已购清单：暂无</div>`;
    selBox.querySelectorAll('.sel-chip').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.id;
      c.equipment = c.equipment.filter(x => x.id !== id);
      save(); paintShop(); picker.paint();
    }));
  };

  pkList.addEventListener('click', (e) => {
    const btn = e.target.closest('.pk-act');
    if (!btn || btn.dataset.act !== 'shop') return;
    const id = btn.dataset.id;
    c.equipment = c.equipment || [];
    const i = c.equipment.findIndex(x => x.id === id);
    if (i >= 0) c.equipment.splice(i, 1); else c.equipment.push({ id });
    save(); paintShop(); picker.paint();
  });

  picker.paint();
  picker.initialDetail();
  paintShop();
}

function renderSheet() {
  const c = state.char;
  const s = stage();
  const sheet = el('div', 'sheet');
  const r = race();
  const k = klass();
  sheet.innerHTML = `<h2>${esc(c.name || '未命名角色')}</h2>
    <p class="muted">${esc(c.player ? '玩家：' + c.player : '')}${c.level ? ' · ' + c.level + ' 级' : ''}${k ? ' · ' + esc(k.name) : ''}${c.subclass ? '（' + esc(c.subclass) + '）' : ''}${r ? ' · ' + esc(r.name) : ''}</p>
    ${c.portrait ? `<img class="portrait" src="${esc(c.portrait)}" alt="立绘" onerror="this.style.display='none'">` : ''}`;

  // —— 待补清单（完整性检查，可点击跳转） ——
  const _sum = issueSummary();
  if (_sum.all.length) {
    sheet.insertAdjacentHTML('beforeend', `<div class="sheet-sec pending-box">
      <h3>待补清单（${_sum.errors.length} 个错误 / ${_sum.warns.length} 个提醒）</h3>
      <div class="pending-list">${_sum.all.map(i =>
        `<button type="button" class="pending-item ${i.level}" data-goto="${i.step}">第 ${i.step} 步 · ${esc(i.msg)}</button>`).join('')}</div>
      ${strictOn() ? '<p class="muted" style="margin-top:6px">严格模式：有错误时导出会被阻止；可在顶部关闭严格模式。</p>' : ''}
    </div>`);
  }

  // —— 属性 ——
  const saveRows = ATTRS.map(a => {
    const prof = k && k.core.saveList.includes(a);
    return `<tr><td>${a}</td><td>${c.base[a]}</td><td>${(c.manual[a] || 0) + raceBonus(a)}</td>
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

  // —— 职业特性（到当前等级；与 Word 导出同源，反馈 8） ——
  if (k) {
    const mainFeats = (typeof classFeatureListToLevel === 'function' ? classFeatureListToLevel(c.level) : [])
      .filter(f => f && f.name && String(f.text || '').trim());
    const subFeats = (typeof subclassFeatureListToLevel === 'function' ? subclassFeatureListToLevel(c.level) : [])
      .filter(f => f && f.name && String(f.text || '').trim());
    const tName = (f) => {
      const fLevels = Array.isArray(f.levels) && f.levels.length ? f.levels.filter(x => Number.isFinite(x)) : (f.level ? [f.level] : []);
      return fLevels.length ? f.name + '（第' + Math.min.apply(null, fLevels) + '级）' : f.name;
    };
    if (mainFeats.length || subFeats.length || c.subclass) {
      sheet.insertAdjacentHTML('beforeend', `<div class="sheet-sec"><h3>职业特性（至 ${c.level} 级${c.subclass ? ' · ' + esc(c.subclass) : ''}）</h3>
        ${mainFeats.length ? mainFeats.map(f => `<div class="trait"><span class="t-name">${esc(tName(f))}</span>　<span class="t-text">${esc(f.text)}</span></div>`).join('') : '<p class="muted">主职特性数据未收录（见职业表）</p>'}
        ${subFeats.length ? `<h4 style="margin:10px 0 4px">子职特性（${esc(c.subclass)}）</h4>` + subFeats.map(f => `<div class="trait"><span class="t-name">${esc(tName(f))}</span>　<span class="t-text">${esc(f.text)}</span></div>`).join('') : ''}
        <p class="muted">已获得特性按当前 ${c.level} 级列出；更多见规则书：<a href="${esc(k.url)}" target="_blank">${esc(k.name)}</a></p>
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
          <td>${(c.prepared || []).includes(sp.name) ? '✓ 是' : '—'}</td><td>${esc(schoolLabel(sp))}</td>
          <td class="t-text">${esc((sp.text || '').split('\n').slice(1).join('\n').slice(0, 80))}</td></tr>`).join('')).join('')}
      </table></div>`);
  }

  // —— 专长授予的法术（魔法学徒） ——
  if (Array.isArray(c.featSpells) && c.featSpells.length) {
    sheet.insertAdjacentHTML('beforeend', `<div class="sheet-sec"><h3>专长法术（魔法学徒${c.miClass ? ' · ' + esc(c.miClass) : ''}）</h3>
      <table><tr><th>环阶</th><th>名称</th><th>来源</th></tr>
      ${c.featSpells.map((n, i) => {
        const sp = DATA.spells.find((s) => s.name === n);
        return `<tr><td>${i < 2 ? '戏法' : '1环'}</td><td><b>${esc(n)}</b></td><td>魔法学徒专长</td></tr>`;
      }).join('')}</table>
      <p class="muted" style="margin-top:6px">每两次长休之间可免法术位施展该 1 环法术一次。</p></div>`);
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
      return `<tr><td>${m ? esc(m.protocol) : ''}</td><td>${m ? esc(moduleLabel(m)) : ''}</td><td><b>${esc(n)}</b></td><td>${m ? esc(m.text.slice(0, 60)) : ''}</td></tr>`;
    }).join('');
    sheet.insertAdjacentHTML('beforeend', `<div class="sheet-sec"><h3>程序（${c.programs.length}）</h3>
      <table><tr><th>协议</th><th>模块</th><th>名称</th><th>简介</th></tr>${rows}</table></div>`);
  }

  // —— 装备（购物） ——
  if ((c.equipment || []).length) {
    let total = 0, unpriced = 0;
    const rows = (c.equipment || []).map(x => {
      const it = miById(x.id);
      const p = miPrice(it);
      if (p != null) total += p; else unpriced++;
      return `<tr><td><b>${esc(it ? it.name : x.id)}</b></td><td>${it ? esc(it.sub || '') : ''}</td><td>${p != null ? p + 'gp' : '价格未定'}</td>${it && it.attune ? '<td>需同调</td>' : '<td>—</td>'}</tr>`;
    }).join('');
    const budget = c.budget != null && c.budget !== '' ? Math.max(0, parseInt(c.budget, 10) || 0) : null;
    const over = budget != null && total > budget;
    sheet.insertAdjacentHTML('beforeend', `<div class="sheet-sec"><h3>装备（魔法物品 ${(c.equipment || []).length} 件${budget != null ? ' · 预算 ' + budget + 'gp' : ''}${over ? ' · ⚠ 超预算' : ''}）</h3>
      <table><tr><th>名称</th><th>分类</th><th>价格</th><th>同调</th></tr>${rows}</table>
      <p class="muted" style="margin-top:6px">合计 <b>${total}gp</b>${unpriced ? `（另有 ${unpriced} 件价格未定不计入）` : ''}${budget != null ? `，预算 ${budget}gp，${over ? '<b style="color:var(--bad)">超支 ' + (total - budget) + 'gp</b>' : '未超预算'}` : ''}。价格为规则书价格区间下限。</p>
    </div>`);
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
  sheet.querySelectorAll('.pending-item').forEach(b => b.addEventListener('click', () => setStep(+b.dataset.goto)));
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
    <div class="f-hint">立绘支持图片 URL 或本地文件（自动压缩后存入浏览器本地存档，仅本机可见）。角色姓名/玩家也可在最后一步「设定背景与角色信息」填写。</div>`;
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
    <button type="button" class="nav-btn primary" id="btn-docx">⬇ 导出 Word 角色卡</button>
    <button type="button" class="nav-btn" id="btn-xlsx" title="以表格形式导出数据（旧版 Excel，仅数据，不适合直接当角色卡）">⬇ Excel 数据表</button>`;
  s.appendChild(btns);
  $('#btn-print').addEventListener('click', () => window.print());
  $('#btn-docx').addEventListener('click', exportWord);
  $('#btn-xlsx').addEventListener('click', exportExcel);
}

/* ---------- 实时预览 ---------- */
function renderLive() {
  const live = $('#live');
  const c = state.char;
  const r = race();
  const k = klass();
  let h = `<h3>👤 角色预览</h3>`;
  const _is = issueSummary();
  if (_is.errors.length) h += `<div class="live-pending">还有 <b>${_is.errors.length}</b> 项待补（点顶部「待补」查看）</div>`;
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
// 职业表「特性」列 → 到指定等级已获得的特性名（兼容「专长（2项）」「引导神力：荒野变形」等写法）
function classTableFeatureNames(k, level) {
  if (!k || !Array.isArray(k.table) || !k.table.length) return [];
  const head = k.table[0] || [];
  const col = head.indexOf('特性');
  if (col < 0) {
    // 兼容表头被拆分的页面（如「特性」列头带换行/附加字）
    const alt = head.findIndex(h => /^特性/.test(String(h)));
    if (alt < 0) return [];
    return classTableFeatureNamesAt(k, alt, level);
  }
  return classTableFeatureNamesAt(k, col, level);
}
function classTableFeatureNamesAt(k, col, level) {
  const names = [];
  for (const row of k.table.slice(1)) {
    const lv = Number(String(row[0] || '').replace(/[^\d]/g, ''));
    if (!lv || lv > level) continue;
    for (const raw of String(row[col] || '').split(/[，,、]/)) {
      const base = String(raw).replace(/[（(][^（()）]*[)）]/g, '').trim();
      if (!base || /环$/.test(base) || base === '子职特性') continue;
      const key = base.split('：')[0].trim();
      if (key && names.indexOf(key) < 0) names.push(key);
    }
  }
  return names;
}
// 主职特性（到指定等级，反馈 8）：优先用解析器给的 features[].levels；旧数据则按职业表「特性」列反推
function classFeatureListToLevel(level) {
  const k = klass();
  if (!k) return [];
  const lv = Math.max(1, Math.min(20, level || state.char.level || 1));
  const feats = (k.features || []).filter(f => f && f.name && !/^玩家可选变体/.test(f.name));
  const out = [];
  if (feats.some(f => Array.isArray(f.levels))) {
    for (const f of feats) {
      const lvls = (Array.isArray(f.levels) ? f.levels : []).filter(x => Number.isFinite(x));
      const min = lvls.length ? Math.min.apply(null, lvls) : 1;
      if (lvls.length ? lvls.some(x => x <= lv) : min <= lv) {
        out.push({ name: f.name, text: f.text || '', level: min, levels: lvls });
      }
    }
  } else {
    const names = classTableFeatureNames(k, lv);
    for (const f of feats) {
      if (names.includes(f.name)) out.push({ name: f.name, text: f.text || '', level: 1, levels: [] });
    }
  }
  out.sort((a, b) => a.level - b.level);
  return out;
}
// 当前子职条目（基础职业 subclasses 里按 name 匹配）
function subclassEntryByName(name) {
  const b = baseKlass();
  if (!b || !name) return null;
  return (b.subclasses || []).find(s => s.name === name) || null;
}
// 子职特性（到指定等级，反馈 8）：解析器把子职特性挂在 subclasses[].features 上（旧数据则为空）
function subclassFeatureListToLevel(level) {
  const s = subclassEntryByName(state.char.subclass);
  const lv = Math.max(1, Math.min(20, level || state.char.level || 1));
  const feats = (s && Array.isArray(s.features)) ? s.features : [];
  return feats
    .filter(f => f && f.name && (!f.level || f.level <= lv))
    .map(f => ({ name: f.name, text: f.text || '', level: f.level || 0 }))
    .sort((a, b) => a.level - b.level);
}
function levelUpFeatureText(f) {
  const lv = f.level ? `第${f.level}级` : '';
  return lv ? `${f.name}（${lv}）` : f.name;
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
    s.set(rr, 3, sp ? schoolLabel(sp) : '', SX.value);
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
    s.set(rr, 2, p ? moduleLabel(p) : '', SX.value);
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
  // 装备（购物）：魔法物品清单 + 合计
  if ((c.equipment || []).length) {
    let total = 0, unpriced = 0;
    const lines = (c.equipment || []).map(x => {
      const it = miById(x.id);
      const p = miPrice(it);
      if (p != null) total += p; else unpriced++;
      return `${it ? it.name : x.id}（${it ? it.sub || '' : ''}）${p != null ? p + 'gp' : '价格未定'}`;
    });
    s.set(rr, 1, '装备（魔法物品）', SX.label);
    s.set(rr, 2, lines.join('；'), SX.text); s.merge(rr, 2, 2);
    s.height(rr, Math.max(22, Math.ceil(lines.join('；').length / 50) * 15 + 8));
    rr++;
    putKV('装备合计', total + 'gp' + (unpriced ? `（${unpriced} 件价格未定不计入）` : ''));
    if (c.budget != null && c.budget !== '') {
      const b = Math.max(0, parseInt(c.budget, 10) || 0);
      putKV('购物预算', b + 'gp' + (total > b ? `（超支 ${total - b}gp）` : ''));
    }
  }
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
  if (!exportGuard()) return;
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

/* ---------- Word（.docx）导出：纯 JS 手工生成 OOXML，仿社区 5z空白角色卡.docx 骨架 ----------
 * 背景：社区角色卡实际产物 92% 是 Word 文档（成型卡大量为"叙事+手写公式+粘贴规则书原文"的自由格式），
 *       Excel 网格装不下。故导出改为 Word：车卡数据自动填进对应分节，无法自动填的（背景叙事、主职/子职特性全文、
 *       抗性免疫、特点/理想/牵绊/缺点等）留出「（请从规则书复制粘贴）」粘贴区，玩家拿到即可在 Word 里继续编辑。
 * 数据全部来自规则书 card-data，与网页角色卡同源。仅用 fflate 打包 zip，无第三方库。
 * 布局：标题 → 基本信息 → 购点属性 → 战斗数据 → 豁免 → 背景 → 专长 → 种族特性 → 主职/子职特性 →
 *       技能 → 法术 → 战技 → 程序 → 随身物品 → 备注。
 * OOXML 最小集：document.xml + styles.xml + [Content_Types].xml + _rels/.rels + word/_rels/document.xml.rels
 */
const W_NS = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';

// 单个 run：处理 \n → <w:br/>，支持加粗/斜体/字号(半点)/颜色/底纹
function docxRun(text, o) {
  o = o || {};
  let rPr = '';
  if (o.b) rPr += '<w:b/>';
  if (o.i) rPr += '<w:i/>';
  if (o.sz) rPr += `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>`;
  if (o.color) rPr += `<w:color w:val="${o.color}"/>`;
  if (o.shd) rPr += `<w:shd w:val="clear" w:color="auto" w:fill="${o.shd}"/>`;
  const rPrXml = rPr ? '<w:rPr>' + rPr + '</w:rPr>' : '';
  const lines = String(text == null ? '' : text).split('\n');
  return lines.map((ln, i) =>
    '<w:r>' + rPrXml + (i ? '<w:br/>' : '') + `<w:t xml:space="preserve">${xmlEsc(ln)}</w:t>` + '</w:r>'
  ).join('');
}
// 段落：runs 可为字符串(已是 run xml)或数组；opts: jc / spacing(原始spacing属性) / ind(左缩进twips) / pBdr(下边框)
function docxP(runs, o) {
  o = o || {};
  let pPr = '';
  if (o.jc) pPr += `<w:jc w:val="${o.jc}"/>`;
  if (o.spacing) pPr += `<w:spacing ${o.spacing}/>`;
  if (o.ind) pPr += `<w:ind w:left="${o.ind}" w:hanging="0"/>`;
  if (o.pBdr) pPr += '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="2F5496"/></w:pBdr>';
  const pPrXml = pPr ? `<w:pPr>${pPr}</w:pPr>` : '';
  const runXml = Array.isArray(runs) ? runs.join('') : (runs || '');
  return `<w:p>${pPrXml}${runXml}</w:p>`;
}
// 分节标题：深蓝加粗 + 下边框
function docxSec(title) {
  return docxP(docxRun(title, { b: true, sz: 28, color: '1F3864' }), { spacing: 'w:before="240" w:after="80"', pBdr: true });
}
// 「标签：值」行；long 值时换行缩进整段
function docxKV(label, value, o) {
  o = o || {};
  value = value == null ? '' : String(value);
  if (!value && !o.keepEmpty) return '';
  if (o.long) {
    return docxP(docxRun(label, { b: true, color: '2F5496' }), { spacing: 'w:before="40" w:after="20"' }) +
      docxP(docxRun(value), { ind: 420 });
  }
  return docxP(docxRun(label, { b: true }) + docxRun('：' + value), { spacing: 'w:before="20" w:after="20"' });
}
// 粘贴区提示（灰斜体）
function docxPaste(label) {
  return docxP(docxRun('▼ ' + label + '　（请从规则书中复制粘贴）', { b: true, color: '808080' }),
    { spacing: 'w:before="80" w:after="20"' });
}
// 表格：headers 数组，rows 二维数组，widths 数组（twips，总和应≤内容宽 9638，超出自动等比缩放）
// 单元格可为字符串/数字，或 { t, b, i, color, gray, shd } 对象（灰字提示、重点标签等）
function docxTable(headers, rows, widths) {
  widths = (widths || []).slice();
  if (!widths.length) widths = [9638];
  let total = widths.reduce((a, b) => a + b, 0);
  if (total > 9638) {
    const ratio = 9638 / total;
    widths = widths.map(w => Math.max(300, Math.floor(w * ratio)));
    total = widths.reduce((a, b) => a + b, 0);
  }
  const tblPr = `<w:tblW w:w="${total}" w:type="dxa"/>` +
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="B0B0B0"/>`).join('') +
    '</w:tblBorders>';
  const grid = `<w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  const normCell = (x) => (x && typeof x === 'object' && !Array.isArray(x)) ? x : { t: x };
  const cell = (content, w, head) => {
    const o = normCell(content);
    const runOpt = { b: !!(o.b || head) };
    if (o.i) runOpt.i = true;
    if (o.color) runOpt.color = o.color;
    if (o.gray) runOpt.color = '808080';
    if (o.sz) runOpt.sz = o.sz;
    else if (head) runOpt.sz = 21;
    const tcPr = `<w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>` +
      ((head || o.shd) ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shd || 'D9E2F3'}"/>` : '') + '</w:tcPr>';
    const p = docxP(docxRun(o.t == null ? '' : o.t, runOpt), { spacing: 'w:before="40" w:after="40"' });
    return `<w:tc>${tcPr}${p}</w:tc>`;
  };
  let xml = '';
  if (headers && headers.length) {
    xml += `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${headers.map((h, i) => cell(h, widths[i] || 800, true)).join('')}</w:tr>`;
  }
  for (const r of rows) {
    xml += `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c, i) => cell(c, widths[i] || 800, false)).join('')}</w:tr>`;
  }
  return `<w:tbl><w:tblPr>${tblPr}</w:tblPr>${grid}${xml}</w:tbl>`;
}
function docxGap() { return docxP('', { spacing: 'w:after="20"' }); }

/* ---------- Word 导出 · 规则书「空白角色卡（详细版）」字段推导 ----------
 * 主职/子职特性到等级、变体职业合并、职业法术列表分别由 Lead 提供的
 * baseKlass()/klass()/classFeatureListToLevel()/subclassFeatureListToLevel()/classSpellList() 负责；
 * 这里只做导出排版需要的字段整形：职业表等级行/法术位、生命值/AC 分解、种族派生字段、同调位、物品分类。
 * 全部函数带 __docx 前缀，避免与车卡器其他区域的重名冲突。 */
function __docxK() { return (typeof klass === 'function' ? klass() : null); }
function __docxStr(x) { return String(x == null ? '' : x); }
function __docxSign(v) { return (v >= 0 ? '+' : '') + v; }
function __docxMod(v) { return __docxSign(v); }
// 职业显示名：变体职业标题里去掉「（牧师变体）」这类后缀，避免章节标题嵌套括号
function __docxClassName() {
  const k = __docxK();
  if (!k) return '';
  return __docxStr(k.name).replace(/（[^（）]*变体）$/, '').trim() || __docxStr(k.name);
}
// 子职显示名（变体专属子职去掉「（恶武士）」后缀，沿用 Lead 的 subclassDisplayName）
function __docxSubclassName() {
  const c = state.char;
  if (!c.subclass) return '';
  try {
    if (typeof subclassEntryByName === 'function' && typeof subclassDisplayName === 'function') {
      const s = subclassEntryByName(c.subclass);
      if (s) return subclassDisplayName(s);
    }
  } catch (e) { /* 旧数据无子职特性时忽略 */ }
  return c.subclass;
}
// 职业表结构：等级行起点（表头可能占 1~2 行；第二行可能是「1环…9环」法术位环阶标签）
function __docxClassTableMeta(k) {
  const out = { lvStart: 1, header: [], slotIdx: -1, ringIdx: -1, ringRow: null };
  if (!k || !Array.isArray(k.table) || !k.table.length) return out;
  out.header = k.table[0] || [];
  out.lvStart = k.table.findIndex(r => Array.isArray(r) && /^\d+$/.test(__docxStr(r[0]).trim()));
  if (out.lvStart < 0) out.lvStart = 1;
  out.slotIdx = out.header.findIndex(h => /法术位/.test(__docxStr(h)));
  out.ringIdx = out.header.findIndex(h => /环阶/.test(__docxStr(h)));
  if (out.lvStart > 0) {
    const maybe = k.table[out.lvStart - 1];
    if (Array.isArray(maybe) && maybe.some(x => /^\d+环$/.test(__docxStr(x).trim()))) out.ringRow = maybe;
  }
  return out;
}
// 当前等级职业表行
function __docxClassLevelRow(k, level) {
  if (!k || !Array.isArray(k.table) || !k.table.length) return null;
  const lv = Math.max(1, Math.min(20, level || state.char.level || 1));
  return k.table.find(r => Array.isArray(r) && __docxStr(r[0]).trim() === String(lv)) || null;
}
// 当前等级各环法术位（1–9 环，值为职业表原文，如「3」「4+1」）
function __docxSpellSlots(k, level) {
  const slots = {};
  if (!k) return slots;
  const meta = __docxClassTableMeta(k);
  const row = __docxClassLevelRow(k, level);
  if (!row || meta.slotIdx < 0) return slots;
  if (meta.ringRow) {
    for (let i = meta.slotIdx; i < row.length; i++) {
      const ringIdx = i - meta.slotIdx;
      const m = /^(\d+)环$/.exec(__docxStr(meta.ringRow[ringIdx]).trim());
      const ring = m ? +m[1] : ringIdx + 1;
      const v = __docxStr(row[i]).trim();
      if (ring >= 1 && ring <= 9 && v && v !== '—' && v !== '-' && !/^0+$/.test(v)) slots[ring] = v;
    }
    return slots;
  }
  // 契术师式：法术位数量 × 环阶（如 3 个 2 环法术位）
  const ring = parseInt(__docxStr(meta.ringIdx >= 0 ? row[meta.ringIdx] : '').replace(/[^\d]/g, ''), 10);
  const cnt = __docxStr(row[meta.slotIdx]).trim();
  if (ring >= 1 && ring <= 9 && cnt && cnt !== '—' && cnt !== '-' && !/^0+$/.test(cnt)) slots[ring] = cnt;
  return slots;
}
// 生命值分解：10 + 等级 ×（生命骰期望 + 体质调整值）[+ 亚种每级生命]
function __docxHpParts() {
  const k = __docxK();
  if (!k) return null;
  const lv = state.char.level || 1;
  const exp = Math.ceil((hitDie() + 1) / 2);
  const con = finalMod('体质');
  const sr = (typeof subraceObj === 'function') ? subraceObj(race()) : null;
  const srHp = sr && sr.hpPerLevel ? sr.hpPerLevel * lv : 0;
  return { lv, exp, con, srHp, total: hpMax() };
}
// AC 分解：按护甲类型给出基础公式各加数 + 盾牌 + 其它加值
function __docxAcParts() {
  const c = state.char;
  const prof = profBonus();
  const dex = finalMod('敏捷');
  const type = c.armorType || 'naked';
  const dexUse = type === 'medium' ? Math.min(2, dex) : dex;
  const parts = [];
  switch (type) {
    case 'light': parts.push(['10', 10], ['熟练', prof], ['敏捷', dexUse]); break;
    case 'medium': parts.push(['13', 13], ['熟练', prof], ['敏捷', dexUse]); break;
    case 'heavy': parts.push(['16', 16], ['熟练', prof]); break;
    case 'mage': parts.push(['11', 11], ['熟练', prof], ['敏捷', dexUse]); break;
    case 'monk': parts.push(['8', 8], ['熟练', prof], ['敏捷', dex], ['感知', finalMod('感知')]); break;
    case 'barb': parts.push(['8', 8], ['熟练', prof], ['敏捷', dex], ['体质', finalMod('体质')]); break;
    default: parts.push(['8', 8], ['熟练', prof], ['敏捷', dex]);
  }
  const name = ({ naked: '无盔甲', light: '轻甲', medium: '中甲', heavy: '重甲', mage: '法师护甲', monk: '武僧无甲防御', barb: '狂战士无甲防御' })[type] || '无盔甲';
  return { type, name, shield: c.shield ? 2 : 0, extra: c.armorBonus || 0, value: acValue(), parts };
}
// 速度：步行 + 种族特性中的游泳/飞行/掘穴/攀爬
function __docxSpeedText() {
  const r = race();
  const walk = speedValue();
  if (!r) return walk ? `步行 ${walk} 尺` : '';
  const text = (r.traits || []).map(t => `${t.name || ''} ${t.text || ''}`).join('\n');
  const seg = [];
  if (walk) seg.push(`步行 ${walk} 尺`);
  const add = (label, re) => {
    const m = re.exec(text);
    if (m) seg.push(`${label} ${m[1]} 尺`);
  };
  add('游泳', /游泳[^。\n]{0,20}?(\d+)\s*尺/);
  add('飞行', /飞行[^。\n]{0,20}?(\d+)\s*尺/);
  add('掘穴', /掘穴[^。\n]{0,20}?(\d+)\s*尺/);
  add('攀爬', /攀爬[^。\n]{0,20}?(\d+)\s*尺/);
  return seg.join('，');
}
// 特殊感官：从种族特性提取黑暗视觉/盲视/真实视觉/震颤感知
function __docxSensesText() {
  const r = race();
  if (!r) return '';
  const out = [];
  const pairs = [['黑暗视觉', /黑暗视觉[^。；\n]{0,12}?(\d+)\s*尺/g], ['盲视', /(?:盲视|盲感)[^。；\n]{0,12}?(\d+)\s*尺/g],
    ['真实视觉', /真实视觉[^。；\n]{0,12}?(\d+)\s*尺/g], ['震颤感知', /震颤感知[^。；\n]{0,12}?(\d+)\s*尺/g]];
  for (const t of (r.traits || [])) {
    const s = `${t.name || ''}：${t.text || ''}`;
    for (const [label, re] of pairs) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s))) {
        const v = `${label} ${m[1]} 尺`;
        if (!out.includes(v)) out.push(v);
      }
    }
  }
  return out.join('、');
}
// 伤害抗性 / 状态免疫：从种族特性正文粗提（仅预填，玩家可在 Word 中修改）
function __docxDefenseText() {
  const r = race();
  const res = { resist: [], status: [] };
  if (!r) return res;
  for (const t of (r.traits || [])) {
    const s = __docxStr(t.text);
    const push = (arr, v) => {
      v = __docxStr(v).trim();
      if (v && v.length <= 16 && !arr.includes(v)) arr.push(v);
    };
    let m;
    const reRes = /对([^，。；\n]{1,14}?)伤害(?:具有|有|获得)?的?抗性/g;
    while ((m = reRes.exec(s))) push(res.resist, m[1]);
    const reStatus = /(?:免疫|不会受到)([^，。；\n]{1,14}?)(?:伤害|的状态|状态|的影响)?(?=[，。；\n]|$)/g;
    while ((m = reStatus.exec(s))) {
      if (/睡眠|疾病|毒素|麻痹|中毒|魅惑|恐惧|恐慌|石化|即死|耳聋|目盲|力竭|昏迷/.test(m[1])) push(res.status, m[1]);
    }
  }
  return res;
}
// 同调位：上限（旧存档缺字段默认 3）+ 已同调魔法物品 + 已购装备花费
function __docxAttuneInfo() {
  const c = state.char;
  let cap = 3;
  const raw = c.attuneSlots;
  if (raw != null && raw !== '' && Number.isFinite(+raw)) cap = Math.max(0, Math.min(30, Math.floor(+raw)));
  const eq = Array.isArray(c.equipment) ? c.equipment : [];
  const attuned = [];
  let total = 0, unpriced = 0;
  for (const x of eq) {
    const it = miById(x.id);
    const p = miPrice(it);
    if (p != null) total += p; else unpriced++;
    if (it && it.attune) attuned.push(it.name);
  }
  return { cap, used: attuned.length, attuned, total, unpriced };
}
// 魔法物品分类 → 规则书模板「随身物品」分类
const DOCX_ITEM_CATS = ['法器', '武器', '护甲', '服饰', '奇物', '卷轴', '魔药', '普通物品'];
function __docxItemCat(it) {
  if (!it) return '普通物品';
  const s = `${it.category || ''} ${it.sub || ''}`;
  if (/法器/.test(s)) return '法器';
  if (/武器/.test(s)) return '武器';
  if (/防具|盔甲|护甲|盾牌/.test(s)) return '护甲';
  if (/服饰/.test(s)) return '服饰';
  if (/卷轴/.test(s)) return '卷轴';
  if (/魔药|药水/.test(s)) return '魔药';
  if (/奇物|套装/.test(s)) return '奇物';
  return '普通物品';
}
// 种族派生信息：生物类型 / 体型 / 语言
function __docxBioInfo() {
  const bio = { creatureType: '', size: '', languages: [] };
  const r = race();
  if (!r) return bio;
  const findTrait = (re) => (r.traits || []).find(x => x && re.test(__docxStr(x.name).trim()));
  const ct = findTrait(/^生物类型$|^生物种类$/);
  if (ct) {
    const text = __docxStr(ct.text).trim().replace(/。$/, '');
    const known = /(类人生物|不死生物|构装生物|天界生物|邪魔|精类|妖精|龙类|巨人|元素生物|软泥怪|异怪|魔法兽|野兽|植物|亡灵)/.exec(text);
    if (known) bio.creatureType = known[1];
    else {
      const m = /是([^。]+)$/.exec(text);
      bio.creatureType = m ? m[1] : text;
    }
  }
  const sz = findTrait(/^体型$/);
  if (sz) {
    const m = /(微型|小型|中型|大型|巨型)/.exec(__docxStr(sz.text));
    bio.size = m ? m[1] : __docxStr(sz.text).slice(0, 20);
  }
  const lang = findTrait(/^语言$/);
  if (lang) {
    const text = __docxStr(lang.text);
    for (const name of ['通用语', '精灵语', '矮人语', '龙语', '地精语', '兽人语', '天界语', '深渊语', '炼狱语', '巨人语', '侏儒语', '半身人语', '木族语', '原初语', '深潜语', '心灵感应']) {
      if (text.includes(name) && !bio.languages.includes(name)) bio.languages.push(name);
    }
    const pick = /(一|二|两|三)门(?:额外的)?自选语言/.exec(text);
    if (pick) {
      const num = { 一: 1, 二: 2, 两: 2, 三: 3 }[pick[1]] || 1;
      const v = num + '门自选语言';
      if (!bio.languages.includes(v)) bio.languages.push(v);
    } else if (/自选语言|一门其它语言|一门其他语言/.test(text) && !bio.languages.includes('一门自选语言')) {
      bio.languages.push('一门自选语言');
    }
    if (!bio.languages.length) bio.languages.push(text.slice(0, 40));
  }
  const extra = __docxStr(state.char.bgLanguage).split(/[、,，;；\s]+/).filter(Boolean);
  for (const x of extra) if (!bio.languages.includes(x)) bio.languages.push(x);
  return bio;
}
// 灰色提示行（不需要「请从规则书中复制粘贴」时用）
function docxHint(text) {
  return docxP(docxRun(text, { i: true, color: '808080', sz: 18 }), { spacing: 'w:before="20" w:after="20"' });
}


// 构建正文 block 列表（数组，join 后为 body 内容）
// 章节顺序对齐规则书「空白角色卡（详细版）」：基本信息 → 角色 → 购点属性 → 生命值 → 防御等级 →
// 豁免 → 攻击与施法 → 熟练项 → 抗性免疫 → 专长 → 缺陷 → 主职特性 → 子职特性 → 种族特性 →
// 技能 → 战技 → 已知戏法/法术表 → 程序 → 随身物品 → 备注
function buildDocxBody() {
  const c = state.char;
  const k = __docxK();
  const r = race();
  const ver = (DATA.rules || {}).version || '';
  const level = Math.max(1, Math.min(20, c.level || 1));
  const subName = __docxSubclassName();
  const b = [];
  const t = __docxStr;
  const push = (x) => { if (x) b.push(x); };

  // ===== 标题 =====
  b.push(docxP(docxRun(`5z 角色卡${ver ? '（规则书 v' + ver + '）' : ''}`, { b: true, sz: 36, color: '1F3864' }),
    { jc: 'center', spacing: 'w:after="60"' }));
  b.push(docxP(docxRun('规则书「空白角色卡（详细版）」格式 · 由网页车卡器生成 · 可在 Word 中继续编辑补充', { i: true, color: '808080', sz: 18 }),
    { jc: 'center', spacing: 'w:after="160"' }));

  // ===== 基本信息：玩家 / 人物姓名 / 开卡条件 / 背景介绍 =====
  b.push(docxSec('基本信息'));
  const gold = (rules().levelTable[level - 1] || [])[5] || '';
  b.push(docxTable(null, [
    [{ t: '玩家', b: true, color: '2F5496' }, t(c.player) || '（待填）', { t: '人物姓名', b: true, color: '2F5496' }, t(c.name) || '（待填）'],
    [{ t: '开卡条件', b: true, color: '2F5496' }, `5z 规则书 v${ver || '？'}，${level} 级，初始资金 ${gold || '？'}`, { t: '生命骰', b: true, color: '2F5496' }, k ? `D${hitDie()} × ${level}` : ''],
  ], [1300, 3300, 1200, 3200]));
  if (t(c.bgText)) b.push(docxKV('背景介绍', c.bgText, { long: true }));
  else push(docxPaste('背景介绍'));

  // ===== 角色：等级/职业/种族/生物类型/体型/年龄/性别/阵营/信仰/语言 =====
  b.push(docxSec('角色'));
  const bio = __docxBioInfo();
  const clsText = k ? (k.name + (subName ? '（' + subName + '）' : '')) : '';
  const raceText = r ? (r.name + (c.subrace ? '（' + c.subrace + '）' : '')) : '';
  b.push(docxTable(null, [
    [{ t: '角色等级', b: true, color: '2F5496' }, `${level} 级`, { t: '职业', b: true, color: '2F5496' }, clsText],
    [{ t: '种族', b: true, color: '2F5496' }, raceText, { t: '生物类型', b: true, color: '2F5496' }, bio.creatureType],
    [{ t: '体型', b: true, color: '2F5496' }, bio.size, { t: '年龄', b: true, color: '2F5496' }, t(c.age)],
    [{ t: '性别', b: true, color: '2F5496' }, t(c.gender), { t: '阵营', b: true, color: '2F5496' }, t(c.alignment)],
    [{ t: '信仰', b: true, color: '2F5496' }, t(c.faith), { t: '语言', b: true, color: '2F5496' }, bio.languages.join('、')],
    [{ t: '身高体重', b: true, color: '2F5496' }, t(c.heightWeight), { t: '训练选择', b: true, color: '2F5496' }, (c.raceTraining || '').replace(/^·/, '')],
  ], [1300, 3300, 1200, 3200]));

  // ===== 购点属性（每项带 初始/种族+/升级+/专长装备+ 分解） =====
  b.push(docxSec('购点属性'));
  const attrRows = ATTRS.map(a => {
    const raceB = raceBonus(a);
    const lvB = levelUpBonus(a);
    const manualB = c.manual[a] || 0;
    return [a, String(finalAttr(a)), __docxMod(finalMod(a)), String(c.base[a]), __docxMod(raceB), __docxMod(lvB), __docxMod(manualB)];
  });
  b.push(docxTable(['属性', '最终值', '调整值', '初始', '种族+', '升级+', '专长/装备+'], attrRows, [1200, 1300, 1300, 1200, 1200, 1200, 1800]));
  b.push(docxHint(`购点：${c.buyMethod === 'points' ? '32 点购点表' : '自定义'}，已花费 ${pointBuySpent()} 点。主要属性 ${t(c.majorAttr)}（每 3 级 +1）；其余四项每 5 级 +1。`));

  // ===== 生命值（含公式） =====
  b.push(docxSec('生命值'));
  const hp = __docxHpParts();
  if (hp) {
    const srNote = hp.srHp ? `+${hp.srHp}（亚种）` : '';
    b.push(docxP(docxRun('生命值上限', { b: true }) +
      docxRun(`（10+职业等级×（生命骰期望值+体质调整值））：${hp.total}（10+${hp.lv}×（${hp.exp}${__docxMod(hp.con)}）${srNote}）`)));
    b.push(docxP(docxRun('生命骰', { b: true }) + docxRun(`：D${hitDie()} × ${level}（共 ${level} 颗）　期望值 ${hp.exp}/颗`)));
  } else {
    push(docxPaste('生命值'));
  }

  // ===== 防御等级（基础 AC 分解 + 盾牌） =====
  b.push(docxSec('防御等级'));
  const ac = __docxAcParts();
  const acSum = ac.parts.map(([label, v], i) => i === 0 ? String(v) : label + __docxMod(v)).join('+');
  b.push(docxP(docxRun('防御等级 AC', { b: true }) +
    docxRun(`：${ac.value}（基础AC=${acSum}，盾牌+${ac.shield}${ac.extra ? '，其它+' + ac.extra : ''}；${ac.name}${c.shield ? ' + 盾牌' : ''}）`)));

  // ===== 豁免（每项分解） + 专注/先攻/熟练加值/速度/特殊感官 =====
  b.push(docxSec('豁免'));
  const saveRows = ATTRS.map(a => {
    const hasSave = k ? k.core.saveList.includes(a) : false;
    return [a, String(finalAttr(a)), __docxMod(finalMod(a)), hasSave ? `熟练+${profBonus()}` : '—', __docxMod(saveMod(a)),
      `${a}${__docxMod(finalMod(a))}${hasSave ? '，熟练+' + profBonus() : ''}`];
  });
  b.push(docxTable(['属性', '属性值', '调整值', '熟练', '豁免总值', '分解'], saveRows, [1100, 1100, 1100, 1400, 1400, 3300]));
  const conSave = k ? k.core.saveList.includes('体质') : false;
  b.push(docxP(docxRun('专注（体质豁免）', { b: true }) +
    docxRun(`：${__docxMod(saveMod('体质'))}（体质${__docxMod(finalMod('体质'))}${conSave ? '，熟练+' + profBonus() : ''}）　　先攻：${__docxMod(initBonus())}（敏捷${__docxMod(finalMod('敏捷'))}）　　熟练加值：+${profBonus()}`)));
  b.push(docxP(docxRun('速度', { b: true }) + docxRun('：' + (__docxSpeedText() || '—') + '　　特殊感官：' + (__docxSensesText() || '—'))));

  // ===== 攻击与施法（无武器数据 → 灰字粘贴区，保留公式加数） =====
  b.push(docxSec('攻击与施法'));
  b.push(docxP(docxRun('武器攻击加值', { b: true }) +
    docxRun(`：+＿＿（熟练+${profBonus()}，属性+＿＿，装备+＿＿）　　武器攻击伤害：＿＿（武器伤害骰＿＿，属性+＿＿，装备+＿＿）`)));
  b.push(docxPaste('武器攻击加值与武器攻击伤害'));
  const cs = (typeof classSpellList === 'function') ? classSpellList() : null;
  const isCyborg = (k && /赛博格/.test(t(k.name) + t(k.baseName))) || (c.programs || []).length > 0;
  if (k && (cs || (c.spells || []).length)) {
    b.push(docxP(docxRun('法术豁免 DC', { b: true }) +
      docxRun(`：${spellDC()}（8+熟练${profBonus()}+${t(c.keyAttr)}${__docxMod(finalMod(c.keyAttr))}）　　法术攻击加值：${__docxMod(spellAttack())}（熟练${profBonus()}+${t(c.keyAttr)}${__docxMod(finalMod(c.keyAttr))}）`)));
  }
  if (isCyborg) {
    b.push(docxP(docxRun('程序豁免 DC', { b: true }) +
      docxRun(`：${8 + profBonus() + finalMod(c.keyAttr)}（8+熟练${profBonus()}+${t(c.keyAttr)}${__docxMod(finalMod(c.keyAttr))}）　　程序攻击加值：${__docxMod(profBonus() + finalMod(c.keyAttr))}（熟练${profBonus()}+${t(c.keyAttr)}${__docxMod(finalMod(c.keyAttr))}）`)));
  }

  // ===== 熟练项 =====
  b.push(docxSec('熟练项'));
  b.push(docxP(docxRun('武器熟练', { b: true }) + docxRun('：' + ((k && t(k.core.weapons)) || '—'))));
  b.push(docxP(docxRun('护甲熟练', { b: true }) + docxRun('：' + ((k && t(k.core.armor)) || '—'))));
  const tools = k ? t(k.core.tools || k.core.tool || k.core.proficiencies || '') : '';
  if (tools) b.push(docxP(docxRun('配件熟练', { b: true }) + docxRun('：' + tools)));
  else push(docxPaste('配件熟练'));

  // ===== 伤害抗性 / 伤害免疫 / 状态免疫 =====
  b.push(docxSec('伤害抗性 / 伤害免疫 / 状态免疫'));
  const def = __docxDefenseText();
  if (def.resist.length) b.push(docxP(docxRun('伤害抗性', { b: true }) + docxRun('：' + def.resist.join('、') + '（来自种族特性）')));
  if (def.status.length) b.push(docxP(docxRun('状态免疫', { b: true }) + docxRun('：' + def.status.join('、') + '（来自种族特性）')));
  if (!def.resist.length && !def.status.length) push(docxPaste('伤害抗性 / 伤害免疫 / 状态免疫'));
  else b.push(docxPaste('伤害免疫 / 其它抗性与状态免疫（补充）'));

  // ===== 专长（等级 1,1,3,6,9,12,15,18 + 额外专长） =====
  b.push(docxSec(`专长（${c.feats.length} / ${featQuota()}）`));
  const featSlotCount = Math.max(8, featQuota(), c.feats.length);
  const featRows = [];
  for (let i = 0; i < featSlotCount; i++) {
    const fn = t(c.feats[i]);
    const f = fn ? DATA.feats.find(x => x.name === fn) : null;
    featRows.push([String(featLv(i) || '额外'), fn || '（待填）', f ? (t(f.text).split('\n')[0] || '') : '']);
  }
  b.push(docxTable(['等级', '专长名称', '效果摘要'], featRows, [1100, 2600, 5900]));
  if (c.feats.length) b.push(docxPaste('专长完整效果（从规则书复制粘贴，或删除本行后手写）'));

  // ===== 缺陷 =====
  b.push(docxSec('缺陷'));
  b.push(docxTable(null, [['（1）', ''], ['（2）', ''], ['（3）', '']], [1000, 8600]));
  b.push(docxHint('缺陷仅适配「琉璃的万色卷轴」；无此扩展可留空或删除本节。'));

  // ===== 主职特性（到当前等级，反馈 8） =====
  b.push(docxSec(`主职特性（${k ? __docxClassName() : '—'} · 至 ${level} 级）`));
  if (k) {
    const mainFeats = (typeof classFeatureListToLevel === 'function' ? classFeatureListToLevel(level) : [])
      .filter(f => f && f.name && t(f.text).trim());
    if (mainFeats.length) {
      for (const f of mainFeats) {
        const fLevels = Array.isArray(f.levels) ? f.levels.filter(x => Number.isFinite(x)) : [];
        const label = fLevels.length ? f.name + '（第' + Math.min.apply(null, fLevels) + '级）' : f.name;
        b.push(docxKV(label, f.text, { long: true }));
      }
    } else {
      b.push(docxPaste(`主职特性（${k.name}，请从规则书中复制粘贴已获得的特性全文）`));
    }
  } else push(docxPaste('主职特性'));

  // ===== 子职特性（到当前等级，反馈 8） =====
  b.push(docxSec(`子职特性（${subName || '未选择子职'} · 至 ${level} 级）`));
  const subFeats = (typeof subclassFeatureListToLevel === 'function' ? subclassFeatureListToLevel(level) : [])
    .filter(f => f && f.name && t(f.text).trim());
  if (subFeats.length) {
    for (const f of subFeats) {
      const label = f.level ? `${f.name}（第${f.level}级）` : f.name;
      b.push(docxKV(label, f.text, { long: true }));
    }
  } else if (c.subclass) {
    b.push(docxPaste(`子职特性（${subName}，请从规则书中复制粘贴已获得的特性全文）`));
  } else {
    b.push(docxHint('（未选择子职；部分职业 1~3 级获得子职）'));
  }

  // ===== 种族特性 =====
  b.push(docxSec(`种族特性（${r ? r.name + (c.subrace ? ' · ' + c.subrace : '') : '—'}）`));
  if (r) {
    const traits = (r.traits || []).filter(x => x && x.name && t(x.text).trim());
    if (traits.length) b.push(docxTable(['特性', '效果'], traits.map(tr => [tr.name, tr.text]), [2200, 7400]));
    else push(docxPaste('种族特性'));
  } else push(docxPaste('种族特性'));

  // ===== 技能（17 项含分解） =====
  b.push(docxSec(`技能（${skillChosen()} / ${skillQuota()}）`));
  const kSkills = k ? (k.core.skillsCount || 0) : 0;
  const intV = finalAttr('智力');
  const intExtra = intV >= 14 ? Math.min(5, Math.floor((intV - 14) / 4) + 1) : 0;
  const otherSkills = Math.max(0, skillChosen() - kSkills - 2 - intExtra);
  b.push(docxHint(`职业 ${kSkills} 个熟练，背景 2 个熟练，高智力 ${intExtra} 个熟练，其它来源 ${otherSkills} 个熟练（共 ${skillQuota()} 个）。`));
  const skRows = skillGroupRows().map(x => {
    const attr = (rules().skills.find(s => s.name === x.name) || {}).attr || '—';
    const lv = c.skills[x.name] || 0;
    const train = lv >= 2 ? `专精+${profBonus() * 2}` : lv >= 1 ? `熟练+${profBonus()}` : '—';
    return [x.group, x.name, __docxMod(x.total), attr, String(finalAttr(attr)), train,
      `${attr}${__docxMod(finalMod(attr))}${lv >= 1 ? '，' + train : ''}`];
  });
  b.push(docxTable(['分类', '技能', '总值', '属性', '属性值', '熟练/专精', '分解'], skRows, [900, 900, 800, 800, 900, 1400, 3900]));

  // ===== 战技（有则输出，无则省略） =====
  if ((c.maneuvers || []).length) {
    b.push(docxSec('战技'));
    const knownLv = ['低级', '中级', '高级', '超级'];
    const got = {};
    let dice = '';
    const mvRows = c.maneuvers.map(n => {
      const m = DATA.maneuvers.find(x => x.name === n);
      if (m) {
        got[m.level] = true;
        if (!dice) { const dm = /卓越骰：([^\n]+)/.exec(m.text || ''); if (dm) dice = dm[1].trim(); }
      }
      return [m ? m.style : '', m ? m.level + '·' + m.type : '', n];
    });
    b.push(docxP(docxRun('流派', { b: true }) + docxRun('：' + (t(c.maneuverStyle) || '—') + '　　已知战技等级：' + knownLv.map(l => l + (got[l] ? '☑' : '□')).join(' '))));
    b.push(docxP(docxRun('准备战技数量', { b: true }) + docxRun(`：${c.maneuvers.length} 个（角色等级 ${level} + 属性）　　卓越骰：${dice || '—'}（见所选战技正文）`)));
    b.push(docxTable(['流派', '级别·类型', '战技名称'], mvRows, [2000, 2200, 5400]));
  }

  // ===== 已知戏法 / 已知或准备法术表（紧凑：每环 1 行，反馈 9） =====
  b.push(docxSec('已知戏法 / 已知或准备法术表'));
  const spellObjs = (c.spells || []).map(n => DATA.spells.find(s => s.name === n) || { name: n, level: -1 });
  const slots = __docxSpellSlots(k, level);
  const preparedSet = new Set(c.prepared || []);
  const cantrips = spellObjs.filter(s => s.level === 0);
  const leveled = spellObjs.filter(s => s.level > 0);
  const prepN = (c.prepared || []).filter(n => (c.spells || []).includes(n)).length;
  const prepLine = preparedRule() ? `（已准备 ${prepN}${preparedRule().balls ? '' : ' / ' + preparedLimit()}）` : '';
  b.push(docxP(docxRun('已知戏法', { b: true }) + docxRun(`：${cantrips.length} 个　　已知或准备环法：${leveled.length} 个${prepLine}`)));
  if (!spellObjs.length && !Object.keys(slots).length) {
    b.push(docxHint('本角色无已知/准备法术（非施法职业，或尚未在「选择法术」步骤选择）。'));
  }
  const byRing = {};
  for (const sp of spellObjs) (byRing[sp.level] = byRing[sp.level] || []).push(sp.name);
  const fmtNames = (arr) => ((arr || []).map(nn => (preparedSet.has(nn) ? '★' : '') + nn).join('、') || '—');
  const spellRows = [['0环（戏法）', '∞', fmtNames(byRing[0])]];
  for (let ring = 1; ring <= 9; ring++) {
    spellRows.push([ring + '环', slots[ring] ? slots[ring] + ' 个' : '—', fmtNames(byRing[ring])]);
  }
  b.push(docxTable(['环阶', '法术位', '法术名称'], spellRows, [1600, 1400, 6600]));
  b.push(docxHint('★ = 已准备；法术位为当前等级职业表数值。'));
  if (preparedRule()) b.push(docxHint('准备数量公式：' + preparedLimitText()));

  // ===== 程序（赛博格） =====
  if (isCyborg) {
    b.push(docxSec('程序'));
    const mods = new Set();
    for (const n of (c.programs || [])) {
      const p = DATA.programs.find(x => x.name === n);
      if (!p) continue;
      const info = (typeof progModuleInfo === 'function') ? progModuleInfo(p) : { list: [], none: false, any: false };
      for (const m of (info.list || [])) mods.add(m);
    }
    b.push(docxP(docxRun('掌握演算模块', { b: true }) + docxRun('：' + ['火力', '工程', '生存', '信息', '时空'].map(m => m + (mods.has(m) ? '☑' : '□')).join(' '))));
    b.push(docxP(docxRun('准备程序数量', { b: true }) + docxRun(`：${(c.programs || []).length} 个${c.programProtocol ? '　　默认协议：' + c.programProtocol : ''}`)));
    const PROTOCOLS = ['阿尔法', '贝塔', '伽马', '德尔塔', '伊普西隆', '泽塔', '欧米伽'];
    const groups = {};
    for (const n of (c.programs || [])) {
      const p = DATA.programs.find(x => x.name === n);
      const proto = p ? t(p.protocol) : '';
      const key = PROTOCOLS.find(x => proto.indexOf(x) === 0) || proto || '其它';
      (groups[key] = groups[key] || []).push(n);
    }
    const pgRows = PROTOCOLS.map(x => [x, (groups[x] || []).join('、') || '—']);
    for (const key of Object.keys(groups)) if (PROTOCOLS.indexOf(key) < 0) pgRows.push([key, groups[key].join('、')]);
    b.push(docxTable(['协议层级', '程序名称'], pgRows, [2400, 7200]));
    b.push(docxPaste('程序完整文本（从规则书复制粘贴）'));
  }

  // ===== 随身物品（同调位 + 分类清单 + 花费/剩余金钱） =====
  b.push(docxSec('随身物品'));
  const at = __docxAttuneInfo();
  const boxCount = Math.max(3, at.cap);
  const boxes = [];
  for (let i = 0; i < boxCount; i++) boxes.push(`${i + 1}${i < at.used ? '☑' : '□'}`);
  b.push(docxP(docxRun('同调位', { b: true }) + docxRun(`：${boxes.join(' ')}（已同调 ${at.used} / 上限 ${at.cap}）` + (at.attuned.length ? '　已同调：' + at.attuned.join('、') : ''))));
  const cats = {};
  for (const cat of DOCX_ITEM_CATS) cats[cat] = [];
  for (const x of (c.equipment || [])) {
    const it = miById(x.id);
    const cat = __docxItemCat(it);
    const p = it ? miPrice(it) : null;
    const itemName = it ? (it.name + (it.sub && it.sub !== it.name ? '（' + it.sub + '）' : '')) : x.id;
    cats[cat].push(`${itemName}${p != null ? '（' + p + 'gp）' : '（价格未定）'}${it && it.attune ? '·同调' : ''}`);
  }
  if (t(c.items).trim()) cats['普通物品'].push(t(c.items).trim());
  const catRows = DOCX_ITEM_CATS.map(cat => [cat, cats[cat].length ? cats[cat].join('；') : '—']);
  b.push(docxTable(['分类', '物品'], catRows, [1600, 8000]));
  if (!(c.equipment || []).length && !t(c.items).trim()) {
    b.push(docxPaste('武器 / 护甲 / 服饰 / 奇物 / 卷轴 / 魔药 / 普通物品清单（补充上表）'));
  }
  const budget = c.budget != null && c.budget !== '' ? Math.max(0, parseInt(c.budget, 10) || 0) : null;
  const spentTxt = at.total + 'gp' + (at.unpriced ? `（另有 ${at.unpriced} 件价格未定不计入）` : '');
  const restTxt = budget != null ? (Math.max(0, budget - at.total) + 'gp' + (at.total > budget ? `（超支 ${at.total - budget}gp）` : '')) : '（未设置购物预算）';
  b.push(docxP(docxRun('花费金钱', { b: true }) + docxRun(`：${spentTxt}　　剩余金钱：${restTxt}`)));
  b.push(docxHint('服饰每个部位只能装备一件；没有注明「在施法时消耗」的法术材料不会消耗，只需准备一份。'));

  // ===== 备注（含模板底部粘贴区） =====
  b.push(docxSec('备注'));
  if (t(c.traitsNote).trim()) b.push(docxKV('法术 / 战技 / 程序等能力描述', c.traitsNote, { long: true }));
  if (t(c.notes).trim()) b.push(docxKV('其他备注', c.notes, { long: true }));
  b.push(docxPaste('续航资源消耗 / 战斗内生命值变化 / 战斗内动态状态变化'));
  b.push(docxPaste('携带物品效果文本'));
  b.push(docxPaste('所选法术、战技、程序等能力描述的文本'));
  b.push(docxPaste('所召唤的部署数据'));
  b.push(docxPaste('常用的变形数据'));

  return b;
}

// 生成填好值的 Word 文档（Uint8Array）。独立函数便于自动化测试。
function buildDocx() {
  const enc = new TextEncoder();
  const body = buildDocxBody().join('');
  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    W_NS +
    '<w:body>' + body +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>' +
    '</w:body></w:document>';
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="宋体" w:eastAsia="宋体" w:hAnsi="宋体" w:cs="宋体"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>`;
  const files = {
    '[Content_Types].xml': enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>'),
    '_rels/.rels': enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>'),
    'word/document.xml': enc.encode(documentXml),
    'word/_rels/document.xml.rels': enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>'),
    'word/styles.xml': enc.encode(stylesXml),
  };
  return fflate.zipSync(files, { level: 6 });
}

function exportWord() {
  if (typeof fflate === 'undefined') { toast('缺少 zip 组件，无法导出'); return; }
  const c = state.char;
  if (!exportGuard()) return;
  if (!c.raceId && !c.classId) { toast('请先完成种族/职业选择'); return; }
  toast('正在生成 Word 角色卡…');
  try {
    const out = buildDocx();
    const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (c.name || '角色') + '.docx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('已导出 Word 角色卡 ✓');
  } catch (e) {
    console.error(e);
    toast('导出失败：' + (e && e.message ? e.message : e));
  }
}
// 自动化测试钩子：返回 Word 导出结果（base64），不触发下载
window.__CAR_EXPORT_DOCTEST__ = (charOverride) => {
  try {
    if (charOverride) state.char = Object.assign(newChar(), charOverride);
    const u8 = buildDocx();
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
        if (!state.char.raceChoice) state.char.raceChoice = { mode: '', a: '', b: '', c: '' };
        state.step = 9;   // 导入后跳到「角色卡」步（v3 步骤顺序）
        save();
        setStep(9);
        toast('已导入角色（可在任意步骤继续修改）');
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
  loadSettings();
  load();
  normalizeClassChoice();   // 规则数据更新/旧存档：清掉悬空的变体/子职选择（反馈 5）
  // 数据版本显示（与词典页一致，便于核对数据是否随规则书更新）
  const verEl = $('#car-ver');
  if (verEl && DATA.rules) verEl.textContent = 'v' + DATA.rules.version + ' · 规则书数据';
  injectChrome();
  // 事件
  $$('.step').forEach(b => b.addEventListener('click', () => setStep(+b.dataset.step)));
  $('#btn-prev').addEventListener('click', () => setStep(Math.max(1, state.step - 1)));
  $('#btn-next').addEventListener('click', () => {
    if (state.step >= 11) {
      const sum = issueSummary();
      if (sum.errors.length || sum.warns.length) openIssuePanel();
      else toast('角色已完成，可以导出角色卡 ✓');
      return;
    }
    const errors = stepIssues(state.step).filter(i => i.level === 'error');
    if (strictOn() && errors.length) { showGuard(errors); return; }
    setStep(state.step + 1);
  });
  $('#btn-export').addEventListener('click', exportChar);
  $('#btn-export-docx').addEventListener('click', exportWord);
  $('#btn-export-xlsx').addEventListener('click', exportExcel);
  $('#btn-import').addEventListener('click', importChar);
  $('#btn-new').addEventListener('click', newCharAction);
  window.addEventListener('beforeunload', save);
  // 测试/调试钩子（回归脚本用）
  window.__CAR_STATE__ = () => state;
  window.__CAR_ISSUES__ = () => issueSummary();
  window.__CAR_SETSTEP__ = (n) => setStep(n);
  window.__CAR_REFRESH__ = () => refreshChrome();
  // 魔法物品（含多价位展开变体）——回归脚本核对档位价格用
  window.__CAR_MAGIC_ITEMS__ = () => magicItemsAll();
  // 专长先决条件判定——回归脚本核对「或/与」逻辑用（反馈 4498-c）
  window.__CAR_FEATPREREQ__ = (name) => {
    const f = DATA.feats.find((x) => x.name === name);
    return f ? featPrereqStatus(f) : null;
  };
  // 职业/变体/子职数据——回归脚本核对变体职业（反馈 5）与「职业特性到当前等级」（反馈 8）用
  window.__CAR_CLASS_INFO__ = () => {
    const b = baseKlass(), k = klass(), v = activeVariant();
    return {
      base: b ? b.name : null,
      variant: v ? v.name : '',
      active: k ? k.name : null,
      subclassMode: v ? v.subclassMode : 'base',
      subclassExclude: v && Array.isArray(v.subclassExclude) ? v.subclassExclude.slice() : [],
      subclasses: subclassList().map(s => s.name),
      classFeatures: classFeatureListToLevel(state.char.level).map(f => f.name),
      subclassFeatures: subclassFeatureListToLevel(state.char.level).map(f => f.name),
    };
  };
  window.__CAR_FEATURE_HELPERS__ = () => ({ classFeatureListToLevel, subclassFeatureListToLevel });
  // 种族属性加值解析结果——回归脚本核对「属性值提升」类措辞（反馈 4 顺带）
  window.__CAR_RACE_INFO__ = (name) => {
    const r = (name && DATA.races.find(x => x.id === name)) || race();
    return r ? { name: r.name, abilityText: raceAbilityText(r), plan: raceBonusPlan(r) } : null;
  };
  setStep(state.step);
}
boot();
})();
