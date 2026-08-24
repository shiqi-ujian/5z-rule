/* ============================================================
 * 5z 辅助计算器：属性计算（32 购点 / 标准组 / 掷骰）+ 造物素材计算
 * 数据来源：assets/card-data.js（规则书购点表/调整值）+ 5z计算器.xlsx 素材系数
 * ============================================================ */
'use strict';
(() => {
  const DATA = window.__CAR_DATA__ || {};
  const RULES = DATA.rules || {};
  const ATTRS = ['力量', '敏捷', '体质', '智力', '感知'];
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const BUY = RULES.buyTable || { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9, 16: 12 };
  const MODS = RULES.abilityModTable || [];
  const modOf = (v) => {
    for (const [lo, hi, m] of MODS) { if (v >= lo && v <= hi) return m; }
    return 0;
  };
  const arrays = RULES.standardArrays || [];
  const BUY_MIN = Math.min(...Object.keys(BUY).map(Number));
  const BUY_MAX = Math.max(...Object.keys(BUY).map(Number));
  const buyCost = (v) => BUY[v] != null ? BUY[v] : 0;

  // 造物素材系数（来自 5z计算器.xlsx「后台计算」物品素材单位值，来源精确校正）：
  // 类型 → [无机单位值, 有机单位值, 魔晶单位值]（每 100gp 造价对应的素材份数，见下公式）
  // 物品素材公式（xlsx 实测验证，卷轴 1314gp → 有机 1314×3/100=39.42，魔晶 1314×5/100=65.7，
  // 工艺费用 1314×20/100=262.8）：素材 = 造价 × 单位值 / 100；工艺费用 = 造价 × 20%。
  const MATERIALS = [
    ['魔药', 1, 3, 4],
    ['卷轴', 0, 3, 5],
    ['法器', 1, 1, 6],
    ['武器', 3, 3, 2],
    ['护甲（布甲、皮甲、镶钉皮甲、蛛丝衣、藤甲、金竹甲、龙龟铠、木制盾牌）', 1, 6, 1],
    ['护甲（链甲衫、鳞甲、半身板甲、链甲、板条甲、板甲、金属盾牌）', 6, 1, 1],
    ['服饰（手套、护腿、斗篷、外套、帽子、鞋子）', 2, 4, 2],
    ['服饰（护符、腰带、头饰、眼镜、项链、戒指）', 4, 2, 2],
    ['奇物', 3, 1, 4],
    ['攻城装置', 6, 2, 0],
    ['载具', 5, 3, 0],
  ];

  let vals = Object.fromEntries(ATTRS.map(a => [a, 8]));

  /* ---------- Tabs ---------- */
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (!b) return;
    $$('.tab').forEach(t => t.classList.toggle('sel', t === b));
    $$('.panel').forEach(p => { p.hidden = p.id !== 'panel-' + b.dataset.tab; });
  });

  /* ---------- 属性计算 ---------- */
  function renderAttr() {
    const grid = $('#attr-grid');
    let total = 0;
    grid.innerHTML = '';
    for (const a of ATTRS) {
      const v = vals[a];
      const cost = buyCost(v);
      total += cost;
      const card = document.createElement('div');
      card.className = 'attr-card';
      card.innerHTML = `<div class="attr-name">${esc(a)}</div>
        <div class="attr-val"><b>${v}</b><span class="attr-mod">${modOf(v) >= 0 ? '+' : ''}${modOf(v)}</span></div>
        <div class="attr-ops">
          <button type="button" data-a="${esc(a)}" data-d="1" ${v <= BUY_MIN ? 'disabled' : ''}>−</button>
          <span class="attr-cost">${cost} 点</span>
          <button type="button" data-a="${esc(a)}" data-d="0" ${v >= BUY_MAX ? 'disabled' : ''}>＋</button>
        </div>`;
      grid.appendChild(card);
    }
    const pts = $('#attr-points');
    pts.textContent = `已用 ${total} / 32 点${total > 32 ? '（⚠ 超点）' : ''}`;
    pts.className = 'points' + (total > 32 ? ' over' : '');
  }
  $('#attr-grid').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    vals[a] = Math.max(BUY_MIN, Math.min(BUY_MAX, vals[a] + (b.dataset.d === '1' ? -1 : 1)));
    renderAttr();
  });
  $('#btn-array').addEventListener('click', () => {
    if (!arrays.length) { alert('规则书未提供标准属性组数据'); return; }
    const names = arrays.map((x, i) => `${i + 1}. ${x.name || '组' + (i + 1)}（${x.values.join('/')}）`);
    const pick = prompt('选择标准属性组：\n' + names.join('\n') + '\n\n输入序号 1-' + arrays.length);
    const idx = parseInt(pick, 10) - 1;
    if (idx >= 0 && arrays[idx]) {
      ATTRS.forEach((a, i) => { vals[a] = arrays[idx].values[i] || 8; });
      renderAttr();
    }
  });
  $('#btn-roll').addEventListener('click', () => {
    for (const a of ATTRS) {
      const ds = Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 6)).sort((x, y) => x - y);
      vals[a] = ds[1] + ds[2] + ds[3];
    }
    renderAttr();
  });

  /* ---------- 造物素材计算 ---------- */
  const sel = $('#craft-type');
  sel.innerHTML = MATERIALS.map((m, i) => `<option value="${i}">${esc(m[0])}</option>`).join('');
  $('#btn-craft').addEventListener('click', () => {
    const m = MATERIALS[parseInt(sel.value, 10)];
    const price = Math.max(0, parseFloat($('#craft-price').value) || 0);
    if (!m) return;
    $('#res-m').textContent = (price * m[1] / 100).toFixed(2) + ' 份';
    $('#res-o').textContent = (price * m[2] / 100).toFixed(2) + ' 份';
    $('#res-c').textContent = (price * m[3] / 100).toFixed(2) + ' 份';
    $('#res-f').textContent = (price * 0.2).toFixed(2) + ' gp';
    $('#craft-result').hidden = false;
  });

  /* ---------- 怪物素材获得计算 ---------- */
  // 素材 = 类型系数 × CR² × 数量（系数来自 5z计算器.xlsx 后台计算 G61:J74，14 类生物类型）
  // 泥怪 CR6×1 实测：0.6×36=21.6 / 0.4×36=14.4 / 0.2×36=7.2，与 Excel 缓存一致。
  const MON_CREATURES = [
    ['异怪', 0.3, 0.4, 0.6],
    ['野兽', 0, 0.5, 0],
    ['植物', 0, 0.7, 0.3],
    ['天界生物', 0.2, 0.6, 0.7],
    ['构装生物', 1.2, 0, 0.3],
    ['不死生物', 0.2, 0.3, 0.2],
    ['龙类', 0.5, 1, 1],
    ['元素生物', 0.7, 0, 0.3],
    ['精类', 0.4, 0.3, 0.3],
    ['邪魔', 0.2, 0.6, 0.7],
    ['巨人', 0.3, 0.6, 0.3],
    ['类人生物', 0, 0.6, 0.2],
    ['怪兽', 0.4, 0.4, 0.4],
    ['泥怪', 0.6, 0.4, 0.2],
  ];
  const monSel = $('#mon-type');
  monSel.innerHTML = MON_CREATURES.map((m, i) => `<option value="${i}">${esc(m[0])}</option>`).join('');
  $('#btn-mon').addEventListener('click', () => {
    const m = MON_CREATURES[parseInt(monSel.value, 10)];
    const cr = Math.max(0, parseFloat($('#mon-cr').value) || 0);
    const qty = Math.max(1, parseFloat($('#mon-qty').value) || 1);
    if (!m) return;
    const base = cr * cr * qty;
    $('#res-mon-m').textContent = (m[1] * base).toFixed(2) + ' 份';
    $('#res-mon-o').textContent = (m[2] * base).toFixed(2) + ' 份';
    $('#res-mon-c').textContent = (m[3] * base).toFixed(2) + ' 份';
    $('#mon-result').hidden = false;
  });

  /* ---------- 遭遇难度计算 ---------- */
  // 数据来自 5z计算器.xlsx「后台计算」：CR→个体分值表（5z/5e/万色）、玩家等级→单人团队、四类调整系数。
  // 公式：怪物团队总分 = ( Σ 个体分值^0.5714 × 数量 )^1.75 ；玩家团队总分 = 单人团队 × 人数^搭配系数 × 操作水平 × 准备 × 状态；
  // 难度 = 怪物团队总分 ÷ 玩家团队总分，对照评语表。
  const ORIGINS = {
    '5z': { 0: 1, 0.125: 2.5, 0.25: 5, 0.5: 10, 1: 20, 2: 45, 3: 70, 4: 110, 5: 180, 6: 230, 7: 290, 8: 390, 9: 500, 10: 650, 11: 850, 12: 1100, 13: 1400, 14: 1800, 15: 2300, 16: 3000, 17: 3600, 18: 4600, 19: 6000, 20: 7800, 21: 10100, 22: 12000, 23: 14400, 24: 17450, 25: 21000, 26: 25200, 27: 30200, 28: 36300, 29: 43500, 30: 52200 },
    'dnd5e': { 0: 1, 0.125: 2.5, 0.25: 5, 0.5: 10, 1: 20, 2: 45, 3: 65, 4: 90, 5: 110, 6: 160, 7: 200, 8: 230, 9: 260, 10: 320, 11: 390, 12: 450, 13: 550, 14: 650, 15: 790, 16: 910, 17: 1100, 18: 1300, 19: 1500, 20: 1800, 21: 2150, 22: 2450, 23: 3000, 24: 3300, 25: 3900, 26: 4200, 27: 5000, 28: 5500, 29: 6500, 30: 7800 },
    '万色卷轴': { 0: 1, 0.125: 2.5, 0.25: 5, 0.5: 10, 1: 20, 2: 45, 3: 100, 4: 180, 5: 230, 6: 290, 7: 430, 8: 650, 9: 850, 10: 1100, 11: 1600, 12: 2300, 13: 3000, 14: 3600, 15: 5200, 16: 7800, 17: 10100, 18: 12000, 19: 16000, 20: 21000, 21: 25200, 22: 30200, 23: 40000, 24: 50000, 25: 60000, 26: 72000, 27: 86400, 28: 103000, 29: 124000, 30: 150000 }
  };
  const SOLO = { 0: 10, 1: 20, 2: 45, 3: 70, 4: 110, 5: 180, 6: 230, 7: 290, 8: 390, 9: 500, 10: 650, 11: 850, 12: 1100, 13: 1400, 14: 1800, 15: 2300, 16: 3000, 17: 3600, 18: 4600, 19: 6000, 20: 7800 };
  const OP = { '顶级高手': 1.35, '熟练老手': 1, '懵懂新手': 0.65 };
  const SYN = { '定位全面': 2, '基本合格': 1.85, '严重缺陷': 1.7 };
  const PREP = { '针对性车卡': 1.6, '有上buff时间': 1.15, '仓猝迎战': 1, '被怪物突袭': 0.55 };
  const STATUS = { '资源充足': 1, '节能模式': 0.8, '油尽灯枯': 0.5 };
  const VERDICTS = [
    [0.25, '毫无悬念的清理'],
    [0.5, '稳操胜券，注意减少损耗'],
    [0.75, '优势在我，但不可轻敌'],
    [1, '胜负难料，取决于临场发挥'],
    [1.33, '优势在敌，但有一线胜机'],
    [2, '胜算渺茫，需奇迹或完美策略'],
    [Infinity, '差距悬殊，不可战胜，求生为上'],
  ];
  const encMon = [
    { cr: 14, origin: '5z', qty: 1 },
    { cr: 0, origin: '5z', qty: 0 },
    { cr: 0, origin: '5z', qty: 0 },
    { cr: 0, origin: '万色卷轴', qty: 0 },
  ];

  // 取个体分值：精确命中表中 CR；否则向下就近（避免非表内 CR 报错）
  function crScore(cr, origin) {
    const t = ORIGINS[origin] || ORIGINS['5z'];
    if (t[cr] != null) return t[cr];
    let best = 0;
    for (const k in t) { const kk = +k; if (kk <= cr && kk > best) best = kk; }
    return t[best] != null ? t[best] : 1;
  }
  const fmtNum = (n) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });

  function encRenderMonsters() {
    const box = $('#enc-monsters');
    box.innerHTML = '';
    encMon.forEach((m, i) => {
      const originOpts = Object.keys(ORIGINS).map(o => `<option value="${esc(o)}" ${o === m.origin ? 'selected' : ''}>${esc(o)}</option>`).join('');
      const row = document.createElement('div');
      row.className = 'enc-mon-row';
      row.innerHTML =
        `<span class="enc-mon-name">怪物${i + 1}</span>` +
        `<label class="enc-field">CR<input type="number" class="in" min="0" step="0.125" data-i="${i}" data-k="cr" value="${m.cr}"></label>` +
        `<label class="enc-field">出处<select class="in" data-i="${i}" data-k="origin">${originOpts}</select></label>` +
        `<label class="enc-field">数量<input type="number" class="in" min="0" step="1" data-i="${i}" data-k="qty" value="${m.qty}"></label>`;
      box.appendChild(row);
    });
  }
  $('#enc-monsters').addEventListener('input', (e) => {
    const el = e.target.closest('[data-i]');
    if (!el) return;
    const i = +el.dataset.i, k = el.dataset.k;
    if (k === 'cr') encMon[i].cr = parseFloat(el.value) || 0;
    else if (k === 'qty') encMon[i].qty = parseFloat(el.value) || 0;
    else if (k === 'origin') encMon[i].origin = el.value;
    encCalc();
  });

  function fillSel(sel, items, def) {
    sel.innerHTML = items.map(it => `<option value="${esc(it)}" ${it === def ? 'selected' : ''}>${esc(it)}</option>`).join('');
  }
  const lvOpts = Object.keys(SOLO).map(Number).sort((a, b) => a - b);
  $('#enc-level').innerHTML = lvOpts.map(v => `<option value="${v}" ${v === 10 ? 'selected' : ''}>${v} 级</option>`).join('');
  fillSel($('#enc-op'), Object.keys(OP), '懵懂新手');
  fillSel($('#enc-syn'), Object.keys(SYN), '基本合格');
  fillSel($('#enc-prep'), Object.keys(PREP), '有上buff时间');
  fillSel($('#enc-status'), Object.keys(STATUS), '资源充足');
  $('#enc-player').addEventListener('input', () => encCalc());
  $('#enc-player').addEventListener('change', () => encCalc());

  function encCalc() {
    let sum = 0;
    for (const m of encMon) {
      if (!m.cr && !m.qty) continue;
      sum += Math.pow(crScore(m.cr, m.origin), 0.5714) * m.qty;
    }
    const total = Math.pow(sum, 1.75);
    const level = +$('#enc-level').value || 0;
    const solo = SOLO[level] != null ? SOLO[level] : 0;
    const n = Math.max(1, parseFloat($('#enc-count').value) || 1);
    const syn = SYN[$('#enc-syn').value] != null ? SYN[$('#enc-syn').value] : 1.4;
    const px = Math.pow(n, syn);
    const op = OP[$('#enc-op').value] != null ? OP[$('#enc-op').value] : 0.65;
    const prep = PREP[$('#enc-prep').value] != null ? PREP[$('#enc-prep').value] : 1;
    const status = STATUS[$('#enc-status').value] != null ? STATUS[$('#enc-status').value] : 1;
    const ptotal = solo * px * op * prep * status;
    const ratio = ptotal ? total / ptotal : 0;
    let verdict = VERDICTS[VERDICTS.length - 1][1];
    for (const [t, s] of VERDICTS) { if (ratio < t) { verdict = s; break; } }
    $('#enc-m-total').textContent = fmtNum(total);
    $('#enc-p-total').textContent = fmtNum(ptotal);
    $('#enc-r-m').textContent = fmtNum(total);
    $('#enc-r-p').textContent = fmtNum(ptotal);
    $('#enc-r-ratio').textContent = ratio.toFixed(4);
    $('#enc-r-verdict').textContent = verdict;
  }

  renderAttr();
  encRenderMonsters();
  encCalc();
})();
