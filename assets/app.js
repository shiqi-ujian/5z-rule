/* 5z 规则站 — 壳逻辑：目录树 / 全站搜索 / 页内搜索 / iframe 同步 */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const tocData = window.__TOC__ || [];
  const frame = $('#frame');
  const tocEl = $('#toc');
  const q = $('#q');
  const resultsEl = $('#results');
  const crumbEl = $('#crumb');

  /* ---------- 主题 ---------- */
  const theme = localStorage.getItem('wz-theme') ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  $('#theme-btn').textContent = theme === 'dark' ? '☀️' : '🌙';
  $('#theme-btn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('wz-theme', next);
    $('#theme-btn').textContent = next === 'dark' ? '☀️' : '🌙';
  });

  /* ---------- 目录树渲染 ---------- */
  const urlToNode = new Map();
  let openSet = new Set();
  try { openSet = new Set(JSON.parse(localStorage.getItem('wz-open') || '[]')); } catch (e) {}

  function buildNodeMap(nodes, path) {
    for (const n of nodes) {
      const p = path.concat(n);
      if (n.u) urlToNode.set(n.u, { node: n, path: p });
      if (n.c) buildNodeMap(n.c, p);
    }
  }
  buildNodeMap(tocData, []);

  function renderTree() {
    tocEl.innerHTML = '';
    tocData.forEach((n) => tocEl.appendChild(renderNode(n, 0)));
  }
  function renderNode(n, depth) {
    const div = document.createElement('div');
    div.className = 'toc-node';
    div.dataset.id = n.i;
    const row = document.createElement('div');
    row.className = 'toc-row' + (n.c ? ' branch' : ' leaf');
    row.style.paddingLeft = (6 + depth * 14) + 'px';
    const tw = document.createElement('span');
    tw.className = 'tw';
    if (n.c) tw.textContent = openSet.has(n.i) ? '▾' : '▸';
    row.appendChild(tw);
    if (n.c) {
      // 分支：箭头/行内空白点击收展；带正文页（n.u）的文字可点击打开页面
      row.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        toggle(n.i);
      });
      if (n.u) {
        const a = document.createElement('a');
        a.className = 'tlabel';
        a.textContent = n.n;
        a.title = n.n;
        a.href = n.u;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          openPage(n.u);
        });
        row.classList.add('has-page');
        row.appendChild(a);
      } else {
        const label = document.createElement('span');
        label.className = 'tlabel';
        label.textContent = n.n;
        label.title = n.n;
        row.appendChild(label);
      }
    } else {
      row.style.cursor = 'pointer';
      row.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        e.preventDefault();
        openPage(n.u);
      });
      const a = document.createElement('a');
      a.className = 'tlabel';
      a.textContent = n.n;
      a.title = n.n;
      a.href = n.u;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        openPage(n.u);
      });
      row.appendChild(a);
      const wrap = document.createElement('div');
      wrap.className = 'toc-children';
      wrap.hidden = true;
      div.appendChild(row);
      div.appendChild(wrap);
      return div;
    }
    const wrap = document.createElement('div');
    wrap.className = 'toc-children';
    wrap.hidden = !openSet.has(n.i);
    if (n.c) n.c.forEach((c) => wrap.appendChild(renderNode(c, depth + 1)));
    div.appendChild(row);
    div.appendChild(wrap);
    return div;
  }
  function toggle(id) {
    if (openSet.has(id)) openSet.delete(id); else openSet.add(id);
    localStorage.setItem('wz-open', JSON.stringify([...openSet]));
    renderTree();
  }
  renderTree();

  /* ---------- 目录一键全展开 / 全收起（反馈 #20260821-164400） ---------- */
  function collectBranchIds() {
    const ids = [];
    (function walk(ns) {
      for (const n of ns) { if (n.c) { ids.push(n.i); walk(n.c); } }
    })(tocData);
    return ids;
  }
  const tocExpand = document.getElementById('toc-expand');
  const tocCollapse = document.getElementById('toc-collapse');
  if (tocExpand) tocExpand.addEventListener('click', () => {
    collectBranchIds().forEach((id) => openSet.add(id));
    localStorage.setItem('wz-open', JSON.stringify([...openSet]));
    renderTree();
  });
  if (tocCollapse) tocCollapse.addEventListener('click', () => {
    openSet.clear();
    localStorage.setItem('wz-open', JSON.stringify([]));
    renderTree();
  });

  /* ---------- 页面导航 ---------- */
  let pendingTerms = null;
  function openPage(url, terms) {
    pendingTerms = terms && terms.length ? terms : null;
    frame.src = url;
    highlight(url);
    document.body.classList.remove('nav-open');
    resultsEl.hidden = true;
  }
  function highlight(url) {
    tocEl.querySelectorAll('.toc-row.active').forEach((r) => r.classList.remove('active'));
    const hit = urlToNode.get(url);
    if (!hit) return;
    const needRender = hit.path.some((p) => p.c && !openSet.has(p.i));
    hit.path.forEach((p) => { if (p.c) openSet.add(p.i); });
    if (needRender) {
      localStorage.setItem('wz-open', JSON.stringify([...openSet]));
      renderTree();
    }
    const row = tocEl.querySelector(`.toc-node[data-id="${hit.node.i}"] > .toc-row`);
    if (row) {
      row.classList.add('active');
      row.scrollIntoView({ block: 'nearest' });
    }
    // hit.path 已包含当前节点自身，最后一段不重复渲染（否则面包屑出现两次"掷骰"）
    crumbEl.innerHTML = hit.path
      .slice(0, -1)
      .map((p) => `<span>${escapeHtml(p.n)}</span> <b>›</b> `).join('') +
      `<b>${escapeHtml(hit.node.n)}</b>`;
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------- 全站搜索 ---------- */
  let idx = null;
  let idxLoading = false;
  // IndexedDB 缓存（手机端首次下载后本地缓存，之后搜索秒开）
  function idbOpen() {
    return new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open('wz-search-idx', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (e) { reject(e); }
    });
  }
  async function idbGet(key) {
    try {
      const db = await idbOpen();
      return await new Promise((res, rej) => {
        const rq = db.transaction('kv', 'readonly').objectStore('kv').get(key);
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
      });
    } catch (e) { return null; }
  }
  async function idbSet(key, val) {
    try {
      const db = await idbOpen();
      return await new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    } catch (e) { /* 忽略存储失败 */ }
  }
  async function fetchAndParse() {
    const gzResp = await fetch('assets/search-index.json.gz');
    if (gzResp.ok) {
      const buf = await gzResp.arrayBuffer();
      const enc = (gzResp.headers.get('content-encoding') || '').toLowerCase();
      if (enc.includes('gzip')) {
        return JSON.parse(new TextDecoder().decode(buf));
      } else if (typeof DecompressionStream !== 'undefined') {
        const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
        return JSON.parse(await new Response(stream).text());
      }
    }
    const resp = await fetch('assets/search-index.json');
    return await resp.json();
  }
  async function loadIndex() {
    if (idx) return idx;
    if (idxLoading) { while (!idx) await new Promise(r => setTimeout(r, 60)); return idx; }
    idxLoading = true;
    try {
      // 版本号对比：远程版本 vs 本地缓存版本（绕过 HTTP 缓存的 no-store 请求）
      let remoteVer = null;
      try {
        const r = await fetch('assets/idx-version.txt?v=' + Date.now(), { cache: 'no-store' });
        if (r.ok) remoteVer = (await r.text()).trim();
      } catch (e) { /* file:// 或离线时忽略 */ }
      const cached = await idbGet('idx');
      if (cached && cached.v && cached.v === remoteVer) {
        idx = cached.data;
      } else {
        idx = await fetchAndParse();
        idbSet('idx', { v: remoteVer, data: idx });
      }
      buildCategories();
    } finally { idxLoading = false; }
    return idx;
  }
  window.addEventListener('load', () => {
    setTimeout(() => { loadIndex().catch(() => {}); }, 600);
  });

  function tokenize(text) {
    const tokens = [];
    const cjk = text.match(/[\u4e00-\u9fff]+/g) || [];
    for (const seg of cjk) {
      if (seg.length === 1) tokens.push(seg);
      else for (let i = 0; i < seg.length - 1; i++) tokens.push(seg.slice(i, i + 2));
    }
    const en = text.toLowerCase().match(/[a-z0-9]+/g) || [];
    tokens.push(...en);
    return tokens;
  }
  // 照抄 5echm：提取用于页内高亮的原始词（引号短语 / 空格词 / | 任一）
  function extractHighlightTerms(input) {
    if (!input) return [];
    const terms = [];
    const regex = /"([^"]+)"|(\S+)/g;
    let match;
    while ((match = regex.exec(input)) !== null) {
      const token = match[1] || match[2] || '';
      if (!token) continue;
      token.split('|').forEach((part) => {
        const cleaned = part.trim();
        if (cleaned) terms.push(cleaned);
      });
    }
    return terms;
  }
  // 查询语法：空格分隔的词取交集（AND）；A|B 表示任一；"短语"精确匹配
  function parseQuery(query) {
    const groups = [];
    const regex = /"([^"]+)"|(\S+)/g;
    let match;
    while ((match = regex.exec(query)) !== null) {
      const token = (match[1] || match[2] || '').trim();
      if (!token) continue;
      if (match[1]) {
        groups.push({ phrase: token });
      } else {
        const parts = token.split('|').map(s => s.trim()).filter(Boolean);
        if (parts.length > 1) groups.push({ or: parts });
        else groups.push({ or: [parts[0]] });
      }
    }
    return groups;
  }
  function wordHitsAll(tokens, hitSet) {
    return tokens.every(t => hitSet.has(t));
  }
  function groupMatch(pi, g, hitSet, index) {
    if (g.phrase) return wordHitsAll(tokenize(g.phrase), hitSet);
    return g.or.some(w => wordHitsAll(tokenize(w), hitSet));
  }
  function doSearch(index, query, opts) {
    const groups = parseQuery(query);
    if (!groups.length) return { terms: [], hits: [] };
    const allTokens = [];
    groups.forEach(g => {
      if (g.phrase) allTokens.push(...tokenize(g.phrase));
      else g.or.forEach(w => allTokens.push(...tokenize(w)));
    });
    const uniqTokens = [...new Set(allTokens)];
    const scores = new Map(); // pi -> {w, hit:Set}
    for (const tk of uniqTokens) {
      const arr = index.inv[tk];
      if (!arr) continue;
      for (let i = 0; i < arr.length; i += 2) {
        const pi = arr[i];
        let e = scores.get(pi);
        if (!e) { e = { w: 0, hit: new Set() }; scores.set(pi, e); }
        e.w += arr[i + 1];
        e.hit.add(tk);
      }
    }
    let hits = [...scores.keys()].filter(pi => {
      const hitSet = scores.get(pi).hit;
      return groups.every(g => groupMatch(pi, g, hitSet, index));
    });
    const ti = index.ti || {};
    if (opts && opts.titleOnly) {
      hits = hits.filter(pi => {
        const hitSet = scores.get(pi).hit;
        return groups.every(g => {
          if (g.phrase) return tokenize(g.phrase).every(t => (ti[t] || []).includes(pi));
          return g.or.some(w => tokenize(w).every(t => (ti[t] || []).includes(pi)));
        });
      });
    }
    if (opts && opts.category && opts.category !== 'all') {
      const prefix = opts.category + '/';
      hits = hits.filter(pi => index.p[pi * 3].startsWith(prefix));
    }
    if (opts && opts.baseSet) {
      hits = hits.filter(pi => opts.baseSet.has(pi));
    }
    const sorted = hits.map(pi => [pi, scores.get(pi).w]).sort((a, b) => b[1] - a[1]);
    const max = sorted.length ? sorted[0][1] : 0;
    const terms = extractHighlightTerms(query);
    return {
      terms,
      hits: sorted.map(([pi, w]) => [pi, w, max ? Math.round(100 * w / max) : 0]),
    };
  }
  function highlightText(text, terms) {
    let s = escapeHtml(text);
    const sorted = [...terms].sort((a, b) => b.length - a.length);
    for (const t of sorted) {
      s = s.split(t).join('<mark>' + t + '</mark>');
    }
    return s;
  }

  // 分类下拉（从页面 URL 首段生成）
  function buildCategories() {
    if (!idx) return;
    const cats = new Set();
    for (let i = 0; i < idx.p.length; i += 3) {
      const url = idx.p[i];
      const first = url.split('/')[0];
      if (first && !/\.(htm|html)$/i.test(first)) cats.add(first);
    }
    const sel = $('#catFilter');
    sel.innerHTML = '<option value="all">全部分类</option>';
    [...cats].sort().forEach(c => {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = c;
      sel.appendChild(o);
    });
  }

  let selected = -1;
  let baseSet = null; // 结果内筛选的基准集
  function renderResults(hits, terms) {
    resultsEl.innerHTML = '';
    selected = -1;
    if (!hits.length) {
      const d = document.createElement('div');
      d.className = 'res-empty';
      d.textContent = '没有找到匹配的页面（空格=交集，A|B=任一，\"短语\"=精确）';
      resultsEl.appendChild(d);
      return;
    }
    const flag = document.createElement('div');
    flag.className = 'res-flag';
    flag.textContent = `共 ${hits.length} 页匹配`;
    resultsEl.appendChild(flag);
    hits.forEach(([pi, w, rank], i) => {
      const url = idx.p[pi * 3];
      const title = idx.p[pi * 3 + 1];
      const snip = idx.p[pi * 3 + 2] || '';
      const a = document.createElement('a');
      a.className = 'res-item';
      a.dataset.i = i;
      const t = document.createElement('div');
      t.className = 'res-title';
      t.innerHTML = highlightText(title, terms) + `<span class="res-rank">相关度 ${rank}</span>`;
      a.appendChild(t);
      if (snip) {
        const s = document.createElement('div');
        s.className = 'res-snip';
        s.innerHTML = highlightText(snip, terms);
        a.appendChild(s);
      }
      const m = document.createElement('div');
      m.className = 'res-meta';
      m.textContent = `命中词：${terms.join('、')} · ${url}`;
      a.appendChild(m);
      a.addEventListener('click', (e) => {
        e.preventDefault();
        openPage(url, terms);
        q.blur();
      });
      a.addEventListener('mousemove', () => setSelected(i, true));
      resultsEl.appendChild(a);
    });
  }
  function setSelected(i, scroll) {
    const items = resultsEl.querySelectorAll('.res-item');
    if (i < 0 || i >= items.length) return;
    items.forEach((it, k) => it.classList.toggle('selected', k === i));
    selected = i;
    if (scroll && items[i]) items[i].scrollIntoView({ block: 'nearest' });
  }

  let searchSeq = 0;
  async function runSearch(raw) {
    const seq = ++searchSeq;
    const query = raw.trim();
    if (!query) { resultsEl.hidden = true; return; }
    if (!idx) {
      resultsEl.innerHTML = '<div class="res-flag">正在加载搜索索引…</div>';
      resultsEl.hidden = false;
    }
    const index = await loadIndex();
    if (seq !== searchSeq) return;
    const opts = {
      titleOnly: $('#titleOnly').checked,
      category: $('#catFilter').value,
      baseSet: $('#within-btn').classList.contains('on') ? baseSet : null,
    };
    const { terms, hits } = doSearch(index, query, opts);
    baseSet = new Set(hits.map(h => h[0]));
    renderResults(hits, terms);
    resultsEl.hidden = false;
  }
  let debounce = null;
  q.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => runSearch(q.value), 120);
  });
  q.addEventListener('keydown', (e) => {
    const items = () => resultsEl.querySelectorAll('.res-item');
    if (e.key === 'Escape') { resultsEl.hidden = true; q.blur(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(selected + 1, true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(selected - 1, true);
    } else if (e.key === 'Enter') {
      const list = items();
      if (selected >= 0 && selected < list.length) list[selected].click();
      else if (list.length) list[0].click();
    }
  });
  $('#titleOnly').addEventListener('change', () => { if (q.value.trim()) runSearch(q.value); });
  $('#catFilter').addEventListener('change', () => { if (q.value.trim()) runSearch(q.value); });
  $('#within-btn').addEventListener('click', () => {
    $('#within-btn').classList.toggle('on');
    if (q.value.trim()) runSearch(q.value);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      q.focus();
      q.select();
    }
  });
  document.addEventListener('click', (e) => {
    if (e.target === q) return;
    if (e.target.closest('.res-item')) return;
    resultsEl.hidden = true;
  });

  /* ---------- 页内搜索条（手机端替代 Ctrl+F） ---------- */
  const psBar = $('#page-search-bar');
  const psQ = $('#ps-q');
  const psCount = $('#ps-count');
  const psState = { open: false };
  function sendToFrame(msg) {
    try { if (frame.contentWindow) frame.contentWindow.postMessage(msg, '*'); } catch (e) {}
  }
  function openPageSearch() {
    psState.open = true;
    psBar.hidden = false;
    psQ.focus();
    psQ.select();
  }
  function closePageSearch() {
    psState.open = false;
    psBar.hidden = true;
    psCount.textContent = '';
    sendToFrame({ type: 'wz-clear' });
  }
  $('#page-search-btn').addEventListener('click', () => {
    if (psState.open) closePageSearch();
    else openPageSearch();
  });
  $('#ps-close').addEventListener('click', closePageSearch);
  $('#ps-prev').addEventListener('click', () => {
    sendToFrame({ type: 'wz-nav', dir: -1 });
  });
  $('#ps-next').addEventListener('click', () => {
    sendToFrame({ type: 'wz-nav', dir: 1 });
  });
  psQ.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendToFrame({ type: 'wz-nav', dir: e.shiftKey ? -1 : 1 });
    } else if (e.key === 'Escape') {
      closePageSearch();
    }
  });
  let psDebounce = null;
  psQ.addEventListener('input', () => {
    clearTimeout(psDebounce);
    psDebounce = setTimeout(() => {
      const terms = extractHighlightTerms(psQ.value.trim());
      sendToFrame({ type: terms.length ? 'wz-search' : 'wz-clear', terms });
    }, 200);
  });
  // iframe 高亮计数回传
  window.addEventListener('message', (ev) => {
    const d = ev.data || {};
    if (d.type === 'wz-hl-count') {
      psCount.textContent = d.count ? `${d.index + 1} / ${d.count}` : '未找到';
    }
  });

  /* ---------- iframe 同步 ---------- */
  frame.addEventListener('load', () => {
    try {
      const base = location.href.replace(/index\.html([?#].*)?$/, '');
      let cur = frame.contentWindow.location.href;
      if (cur.startsWith(base)) {
        const rel = decodeURI(cur.slice(base.length)).split('?')[0];
        if (rel && rel !== 'index.html') highlight(rel);
      }
      // 全站搜索跳转 → 页内高亮+导航器（5echm 行为）
      if (pendingTerms) {
        sendToFrame({ type: 'wz-highlight', terms: pendingTerms });
      }
      // 页内搜索条开着 → 在新页面重放搜索
      if (psState.open && psQ.value.trim()) {
        sendToFrame({ type: 'wz-search', terms: extractHighlightTerms(psQ.value.trim()) });
      }
    } catch (e) { /* 跨域忽略 */ }
    pendingTerms = null;
  });

  /* ---------- 移动端抽屉 ---------- */
  $('#menu-btn').addEventListener('click', () => {
    document.body.classList.toggle('nav-open');
  });
  $('#mask').addEventListener('click', () => {
    document.body.classList.remove('nav-open');
  });
})();
