/* 5z 通用选择器（Picker）：词典页与车卡器共用的「搜索 + 多选筛选 chips + 分页 + 列表 + 详情」引擎
 * 用法：
 *   const p = Picker.create({ data, filter, chips, containers, itemHtml, detailHtml, ... });
 *   p.paint();
 * 数据源：window.__CAR_DATA__（与 card-data.js 同源），由调用方传入 data 数组。
 * 本文件不依赖具体页面 DOM id，容器由调用方提供。
 */
(function () {
'use strict';

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

/* 多选筛选 chips：items 为候选值，labelFn 渲染标签，selected 为数组（空数组=不限）。
   同组内为并集（命中任一即可），组间为交集（与其它筛选同时生效）。 */
function chipGroup(items, label, labelFn, selected, onChange) {
  const g = el('div', 'pk-chip-group');
  const row = el('div', 'pk-chip-row');
  if (label) {
    const lab = el('span', 'pk-chip-label', esc(label) + ' ');
    const clr = el('button', 'pk-chip-clear', '清除');
    clr.type = 'button';
    clr.title = '清除该组筛选';
    clr.onclick = () => {
      selected.length = 0;
      row.querySelectorAll('.pk-chip').forEach(c => c.classList.remove('on'));
      onChange();
    };
    lab.appendChild(clr);
    g.appendChild(lab);
  }
  for (const v of items) {
    const b = el('button', 'pk-chip' + (selected.includes(v) ? ' on' : ''), esc(labelFn ? labelFn(v) : String(v)));
    b.type = 'button';
    b.title = '可多选，再次点击取消';
    b.onclick = () => {
      const i = selected.indexOf(v);
      if (i >= 0) selected.splice(i, 1); else selected.push(v);
      // chips 只构建一次（_pkReady 守卫），必须就地切换视觉态，
      // 否则筛选已生效但按钮不变色（反馈问题 #20260820-192900）
      b.classList.toggle('on', i < 0);
      onChange();
    };
    row.appendChild(b);
  }
  g.appendChild(row);
  return g;
}

/* 可折叠二级分组 chips：g.groups = [{ label, items:[子值...] }]。
   顶级为分组按钮，点按展开/收起其子 chips；selected 仍是扁平子值数组（与筛选逻辑无缝兼容）。 */
function collapsibleChipGroup(g, selected, onChange) {
  const root = el('div', 'pk-chip-group pk-cg');
  const labelRow = el('div', 'pk-chip-row');
  const lab = el('span', 'pk-chip-label', esc(g.label) + ' ');
  const clr = el('button', 'pk-chip-clear', '清除');
  clr.type = 'button';
  clr.title = '清除该组筛选';
  clr.onclick = () => {
    selected.length = 0;
    root.querySelectorAll('.pk-chipsub .pk-chip').forEach(c => c.classList.remove('on'));
    root.querySelectorAll('.pk-cg-head.has-sel').forEach(h => h.classList.remove('has-sel'));
    onChange();
  };
  lab.appendChild(clr);
  labelRow.appendChild(lab);
  root.appendChild(labelRow);

  const heads = el('div', 'pk-cg-heads');
  const subs = el('div', 'pk-cg-subs');
  for (const grp of g.groups || []) {
    const head = el('button', 'pk-cg-head');
    head.type = 'button';
    head.innerHTML = `<span class="pk-cg-caret">▸</span><span class="pk-cg-name">${esc(grp.label)} <span class="pk-cg-count">${grp.count != null ? grp.count : grp.items.length}</span></span>`;
    head.title = '展开/收起「' + grp.label + '」';
    const syncHead = () => head.classList.toggle('has-sel', grp.items.some(v => selected.includes(v)));
    const subWrap = el('span', 'pk-chipsub');
    subWrap.hidden = true;
    for (const v of grp.items) {
      const b = el('button', 'pk-chip' + (selected.includes(v) ? ' on' : ''), esc(g.labelFn ? g.labelFn(v) : String(v)));
      b.type = 'button';
      b.title = '可多选，再次点击取消';
      b.onclick = () => {
        const i = selected.indexOf(v);
        if (i >= 0) selected.splice(i, 1); else selected.push(v);
        b.classList.toggle('on', i < 0);
        onChange();
        syncHead();
      };
      subWrap.appendChild(b);
    }
    syncHead();
    head.onclick = () => {
      subWrap.hidden = !subWrap.hidden;
      head.classList.toggle('open', !subWrap.hidden);
      head.querySelector('.pk-cg-caret').textContent = subWrap.hidden ? '▸' : '▾';
    };
    heads.appendChild(head);
    subs.appendChild(subWrap);
  }
  root.appendChild(heads);
  root.appendChild(subs);
  return root;
}

/* 通用分页工具：返回当前页切片与分页按钮 HTML（需容器 .pk-pager） */
function pagerHtml(page, pages, onPrev, onNext) {
  return `<button type="button" class="pk-pg-prev" ${page <= 1 ? 'disabled' : ''}>← 上一页</button>
    <span class="pk-pg-info">${page} / ${pages}</span>
    <button type="button" class="pk-pg-next" ${page >= pages ? 'disabled' : ''}>下一页 →</button>`;
}

/* 条目内嵌表格（魔法物品价格表等） */
function tablesHtml(rowsArr) {
  return (rowsArr || []).map(rows => {
    if (!rows || !rows.length) return '';
    const hasHead = rows.length > 1 && rows[0].some(Boolean);
    const thead = hasHead
      ? `<thead><tr>${rows[0].map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>` : '';
    const dataRows = hasHead ? rows.slice(1) : rows;
    const tbody = `<tbody>${dataRows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
    return `<div class="pk-table"><table>${thead}${tbody}</table></div>`;
  }).join('');
}

/* ================= Picker.create =================
 * opts:
 *   data: 数组 | () => 数组          条目数据源（支持函数以便动态更换，如车卡器换职业）
 *   filter: (item, f) => bool       自定义筛选；f = { kw, chips: {key:[...]}, ...extraState }
 *   hay: (item) => string           搜索文本（缺省用 item.name）
 *   chips: [ { key, label, items, labelFn, groups } ]   多选筛选组定义；groups 存在则渲染为可折叠二级分组
 *   groupBy: (item) => string|null   列表按该键分组（连续分组，组间插入分组标题）；缺省为扁平列表
 *   pageSize: number                每页条数；0/undefined = 不分页
 *   selKey: string                  选中标识字段（缺省 'name'）
 *   containers: { toolbar, chips, list, detail, pager, count }
 *                                   toolbar/chips 可缺省（不渲染）；detail 缺省则只点选不展示详情
 *   itemHtml: (item, f) => string   列表条目 HTML（可注入选择按钮等，由调用方做事件委托）
 *   detailHtml: (item) => string    详情 HTML
 *   extraToolbar: (tb, f) => void   附加工具栏控件（标签搜索/仪式/专注下拉等）
 *   extraState: object              额外筛选状态（如 tagsMode）
 *   emptyText: string               无匹配时文案
 *   onSelect: (item) => void        点选条目回调
 */
function create(opts) {
  const C = opts.containers || {};
  const selKey = opts.selKey || 'name';
  const pageSize = opts.pageSize || 0;
  const f = {
    kw: '',
    page: 1,
    sel: null,
    chips: {},
    ...(opts.extraState || {}),
  };
  for (const g of opts.chips || []) f.chips[g.key] = [];

  const dataList = () => (typeof opts.data === 'function' ? opts.data() : opts.data) || [];

  function filtered() {
    const kw = f.kw.trim().toLowerCase();
    return dataList().filter(item => {
      for (const g of opts.chips || []) {
        const sel = f.chips[g.key];
        if (!sel.length) continue;
        // 自定义匹配（如法术按反查职业表）；缺省按 item[g.key] 相等
        const ok = sel.some(v => g.match ? g.match(item, v) : String(item[g.key]) === String(v));
        if (!ok) return false;
      }
      if (kw) {
        const hay = (opts.hay ? opts.hay(item) : String(item[selKey] || '')).toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      if (opts.filter && !opts.filter(item, f)) return false;
      return true;
    });
  }

  function init() {
    // 详情容器统一补 pk-detail 类，确保 .pk-detail 样式（pre-wrap 等）生效
    if (C.detail && !C.detail.classList.contains('pk-detail')) C.detail.classList.add('pk-detail');
    // 工具栏（仅构建一次，避免每次键入重绘导致失焦）
    if (C.toolbar && !C.toolbar._pkReady) {
      const q = el('div', 'pk-toolbar-inner');
      q.innerHTML = `<input type="search" class="pk-kw" placeholder="${esc(opts.placeholder || '搜索…')}" value="${esc(f.kw)}">
        <span class="pk-count"></span>`;
      C.toolbar.appendChild(q);
      const kwIn = $('.pk-kw', C.toolbar);
      kwIn.addEventListener('input', () => { f.kw = kwIn.value; f.page = 1; paint(true); });
      if (opts.extraToolbar) opts.extraToolbar(C.toolbar, f, paint);
      C.toolbar._pkReady = true;
    }
    // chips（同样只构建一次）
    if (C.chips && !C.chips._pkReady) {
      for (const g of opts.chips || []) {
        const onChange = () => { f.page = 1; paint(true); };
        C.chips.appendChild(g.groups
          ? collapsibleChipGroup(g, f.chips[g.key], onChange)
          : chipGroup(g.items, g.label, g.labelFn, f.chips[g.key], onChange));
      }
      C.chips._pkReady = true;
    }
  }

  function paint(scrollTop) {
    init();
    // 列表
    const all = filtered();
    const pages = pageSize ? Math.max(1, Math.ceil(all.length / pageSize)) : 1;
    if (f.page > pages) f.page = pages;
    const slice = pageSize ? all.slice((f.page - 1) * pageSize, f.page * pageSize) : all;
    if (C.list) {
      C.list.innerHTML = '';
      const GROUP = opts.groupBy;
      let groupCounts = null;
      if (GROUP) {
        groupCounts = {};
        for (const item of all) {
          const k = GROUP(item);
          if (k != null && k !== '') groupCounts[k] = (groupCounts[k] || 0) + 1;
        }
      }
      let lastKey;
      for (const item of slice) {
        if (GROUP) {
          const k = GROUP(item) || '';
          if (k !== lastKey) {
            lastKey = k;
            const grpHead = el('div', 'pk-group-head');
            const cnt = groupCounts ? (groupCounts[k] || 0) : 0;
            grpHead.innerHTML = `<span class="pk-group-name">${esc(k)}</span><span class="pk-group-count">${cnt}</span>`;
            C.list.appendChild(grpHead);
          }
        }
        const it = el('div', 'pk-item' + (f.sel === item[selKey] ? ' sel' : ''));
        it.tabIndex = 0;
        it.setAttribute('role', 'button');
        it.dataset.sel = String(item[selKey]);
        it.innerHTML = opts.itemHtml ? opts.itemHtml(item, f) : `<div class="pk-i-name">${esc(item[selKey])}</div>`;
        it.addEventListener('click', (e) => {
          // 条目内的操作按钮（选择/准备等）自行处理并阻止冒泡
          if (e.target.closest('.pk-act')) return;
          f.sel = item[selKey];
          f.selItem = item;
          if (opts.onSelect) opts.onSelect(item);
          paint();
          if (C.detail && opts.detailHtml) C.detail.innerHTML = opts.detailHtml(item);
        });
        C.list.appendChild(it);
      }
      if (!slice.length) C.list.innerHTML = `<p class="pk-empty">${esc(opts.emptyText || '没有匹配的条目。')}</p>`;
      if (scrollTop) C.list.scrollTop = 0;
    }
    // 计数
    if (C.count) C.count.innerHTML = `共 <b>${all.length}</b> 个`;
    else if (C.toolbar) { const c = $('.pk-count', C.toolbar); if (c) c.innerHTML = `共 <b>${all.length}</b> 个`; }
    // 分页
    if (C.pager) {
      if (pages > 1) {
        C.pager.hidden = false;
        C.pager.innerHTML = pagerHtml(f.page, pages, () => { f.page--; paint(true); }, () => { f.page++; paint(true); });
        $('.pk-pg-prev', C.pager).addEventListener('click', () => { f.page--; paint(true); });
        $('.pk-pg-next', C.pager).addEventListener('click', () => { f.page++; paint(true); });
      } else {
        C.pager.hidden = true;
      }
    }
  }

  // 初始详情（有选中则恢复，否则第一条）
  function initialDetail() {
    if (!C.detail || !opts.detailHtml) return;
    const all = dataList();
    if (f.sel) {
      const hit = all.find(x => x[selKey] === f.sel);
      if (hit) { C.detail.innerHTML = opts.detailHtml(hit); return; }
    }
    if (all.length) C.detail.innerHTML = opts.detailHtml(all[0]);
    else C.detail.innerHTML = '<p class="pk-empty">暂无条目。</p>';
  }

  return {
    paint,
    init,
    filtered,
    state: f,
    initialDetail,
    // 重置（换 Tab/换步骤时清空旧容器内容与标志）
    reset() {
      if (C.toolbar) { C.toolbar.innerHTML = ''; C.toolbar._pkReady = false; }
      if (C.chips) { C.chips.innerHTML = ''; C.chips._pkReady = false; }
      if (C.list) C.list.innerHTML = '';
      if (C.pager) C.pager.hidden = true;
      f.page = 1;
    },
    // 供调用方替换数据源后重绘
    setData(fn) { opts.data = fn; },
  };
}

window.Picker = {
  create,
  chipGroup,
  tablesHtml,
  esc,
  el,
};

})();
