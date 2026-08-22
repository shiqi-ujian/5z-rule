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

  // 造物素材系数（来自 5z计算器.xlsx）：类型 → [无机, 有机, 魔晶]
  const MATERIALS = [
    ['魔药', 0.3, 0.4, 0.6],
    ['卷轴', 0, 0.5, 0],
    ['法器', 0, 0.7, 0.3],
    ['武器', 0.2, 0.6, 0.7],
    ['护甲（布甲、皮甲、镶钉皮甲、蛛丝衣、藤甲、金竹甲、龙龟铠、木制盾牌）', 1.2, 0, 0.3],
    ['护甲（链甲衫、鳞甲、半身板甲、链甲、板条甲、板甲、金属盾牌）', 0.2, 0.3, 0.2],
    ['服饰（手套、护腿、斗篷、外套、帽子、鞋子）', 0.5, 1, 1],
    ['服饰（护符、腰带、头饰、眼镜、项链、戒指）', 0.7, 0, 0.3],
    ['奇物', 0.4, 0.3, 0.3],
    ['攻城装置', 0.2, 0.6, 0.7],
    ['载具', 0.3, 0.6, 0.3],
    ['类人生物', 0, 0.6, 0.2],
    ['怪兽', 0.4, 0.4, 0.4],
    ['泥怪', 0.6, 0.4, 0.2],
  ];

  let vals = Object.fromEntries(ATTRS.map(a => [a, 8]));

  /* ---------- Tabs ---------- */
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (!b) return;
    $$('.tab').forEach(t => t.classList.toggle('sel', t === b));
    $('#panel-attr').hidden = b.dataset.tab !== 'attr';
    $('#panel-craft').hidden = b.dataset.tab !== 'craft';
  });
  const $$ = (s) => Array.from(document.querySelectorAll(s));

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
    $('#res-m').textContent = (price * m[1]).toFixed(0) + ' gp';
    $('#res-o').textContent = (price * m[2]).toFixed(0) + ' gp';
    $('#res-c').textContent = (price * m[3]).toFixed(0) + ' gp';
    $('#res-f').textContent = (price * 0.2).toFixed(0) + ' gp';
    $('#craft-result').hidden = false;
  });

  renderAttr();
})();
