// 5z CHM → 现代静态网站 构建器 v2
// 输入: 5z_src/ (hh.exe 反编译输出)
// 输出: 5z_web/
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync as _spawnSync } from 'node:child_process';

const SRC = path.resolve('5z_src');
const OUT = path.resolve('5z_web');
// 自动发现 5z_src 下的 .hhc 目录文件（CHM 每版文件名不同，如 5z规则1.60版.hhc）
const hhcFiles = fs.readdirSync(SRC).filter(f => /\.hhc$/i.test(f));
if (!hhcFiles.length) {
  console.error('[build] 5z_src 下未找到 .hhc 目录文件，请先反编译 CHM');
  process.exit(1);
}
const HHC = path.join(SRC, hhcFiles[0]);
// 从 hhc 文件名提取版本号（如 "5z规则1.59版.hhc" → "1.59"），用于页面标题
const VERSION = /(\d+(?:\.\d+)+)/.exec(hhcFiles[0])?.[1] || '';
const GB18030 = new TextDecoder('gb18030'); // 参考 5echm_web 项目：gb18030 兜底解码，覆盖更全的中文编码

const warnings = [];
const log = (...a) => console.log(...a);

// ---------- 工具 ----------
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}
function readText(file) {
  const buf = fs.readFileSync(file);
  const head = buf.subarray(0, 2000).toString('latin1');
  return /charset\s*=\s*["']?utf-?8/i.test(head) ? buf.toString('utf8') : GB18030.decode(buf);
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function relPath(fromDir, to) {
  const f = fromDir.split('/').filter(Boolean);
  const t = to.split('/');
  let i = 0;
  while (i < f.length && i < t.length - 1 && f[i] === t[i]) i++;
  return '../'.repeat(f.length - i) + t.slice(i).join('/');
}
function extractText(html) {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  t = t.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”').replace(/&middot;/g, '·')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–');
  t = t.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  return t.replace(/\s+/g, ' ').trim();
}
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
// 找出页面文本中"命中密度最高"的 120 字窗口，作为搜索结果片段
function bestWindow(text, windowLen = 120) {
  if (!text) return '';
  if (text.length <= windowLen) return text;
  const posW = []; // [字符偏移, 权重]
  const cjkRe = /[\u4e00-\u9fff]+/g;
  let m;
  while ((m = cjkRe.exec(text))) {
    const seg = m[0], base = m.index;
    if (seg.length === 1) posW.push([base, 1]);
    else for (let i = 0; i < seg.length - 1; i++) posW.push([base + i, 1]);
  }
  const enRe = /[a-z0-9]+/gi;
  while ((m = enRe.exec(text))) posW.push([m.index, 1]);
  if (!posW.length) return text.slice(0, windowLen);
  let bestScore = -1, bestStart = 0;
  let l = 0, score = 0;
  for (let r = 0; r < posW.length; r++) {
    score += posW[r][1];
    while (posW[r][0] - posW[l][0] >= windowLen) { score -= posW[l][1]; l++; }
    if (score > bestScore) { bestScore = score; bestStart = posW[l][0]; }
  }
  let snip = text.slice(bestStart, bestStart + windowLen);
  snip = snip.replace(/^\s+|\s+$/g, '');
  return snip;
}

// ---------- 1. 解析 hhc 目录树 ----------
function parseHhc(text) {
  const root = { name: '', local: '', children: [] };
  const stack = [root.children];
  let cur = null;
  const re = /<UL>|<\/UL>|<LI>|<OBJECT[\s\S]*?<\/OBJECT>/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const t = m[0];
    if (t === '<UL>') {
      stack.push(cur ? cur.children : stack[stack.length - 1]);
    } else if (t === '</UL>') {
      stack.pop();
    } else if (t === '<LI>') {
      cur = { name: '', local: '', children: [] };
      stack[stack.length - 1].push(cur);
    } else {
      const nm = /name="Name" value="([^"]*)"/i.exec(t);
      const lc = /name="Local" value="([^"]*)"/i.exec(t);
      if (nm) cur.name = decodeEntities(nm[1]);
      if (lc) cur.local = decodeEntities(lc[1]).replace(/\\/g, '/');
    }
  }
  return root.children;
}
const tree = parseHhc(readText(HHC));

// ---------- 2. 存在性检查 + 坏路径节点生成聚合索引页 ----------
// 磁盘文件清单（站点相对路径）
const diskFiles = new Set();
(function collect(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collect(full);
    else diskFiles.add(path.relative(SRC, full).split(path.sep).join('/'));
  }
})(SRC);
const isHtm = (p) => /\.(htm|html)$/i.test(p);
const exists = (p) => diskFiles.has(p);

const aggPages = new Map(); // siteRel -> html 字符串（坏路径节点的聚合索引页）
function makeAggPage(node) {
  const kids = [];
  (function flat(nodes) {
    for (const n of nodes) {
      if (n.local && exists(n.local)) kids.push(n);
      else if (n.children.length) flat(n.children);
    }
  })(node.children);
  const items = kids.map((k) => {
    const href = relPath(path.posix.dirname(node.local), k.local);
    return `<li><a href="${esc(href)}">${esc(k.name)}</a></li>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${esc(node.name)}</title></head>
<body>
<h1>${esc(node.name)}</h1>
<p>本章包含以下条目：</p>
<ul>
${items}
</ul>
</body></html>`;
}
(function checkTree(nodes) {
  for (const n of nodes) {
    if (n.local && !exists(n.local)) {
      if (isHtm(n.local) && n.children.length) {
        aggPages.set(n.local, makeAggPage(n));
        warnings.push(`坏路径已修复（生成聚合页）: ${n.local}`);
      } else {
        n.local = '';
        warnings.push(`坏路径节点无子页，降级为纯目录: ${n.name}`);
      }
    }
    if (n.children.length) checkTree(n.children);
  }
})(tree);

// ---------- 3. 前序遍历 → 页面顺序 + 面包屑 ----------
const pages = []; // {url, title, parents, idx}
const seen = new Set();
function walk(nodes, parentChain) {
  for (const node of nodes) {
    const chain = parentChain.concat(node);
    if (node.local && !seen.has(node.local)) {
      seen.add(node.local);
      pages.push({
        url: node.local,
        title: node.name,
        parents: chain.slice(0, -1).map(n => n.name),
      });
    }
    if (node.children.length) walk(node.children, chain);
  }
}
walk(tree, []);
log(`目录树节点: ${countNodes(tree)} | 唯一页面: ${pages.length} | 聚合页: ${aggPages.size}`);

// 注入正文页的页内搜索脚本（照抄 5echm 方案：高亮全部命中 + 浮动导航器 + Alt+↑↓）
const HL_SCRIPT = `<script>
(function () {
  var state = { marks: [], index: -1, terms: [] };
  var NAV_CSS = '#wz-hl-nav{position:fixed;bottom:14px;right:14px;z-index:2147483647;display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid rgba(148,163,184,.55);border-radius:10px;background:rgba(255,255,255,.97);color:#1e293b;box-shadow:0 4px 14px rgba(15,23,42,.2);font:13px/1.3 system-ui,"Microsoft YaHei","PingFang SC",sans-serif}' +
    '#wz-hl-nav button{border:0;border-radius:6px;padding:7px 10px;cursor:pointer;background:#e0e7ff;color:#1e3a8a;font:inherit;font-size:13px;touch-action:manipulation}' +
    '#wz-hl-nav button:hover{background:#c7d2fe}' +
    '#wz-hl-nav .wz-hl-count{min-width:54px;text-align:center;font-weight:600;font-size:13px}' +
    'mark[data-wz-hl]{background:#fde68a;color:inherit;padding:1px 2px;border-radius:2px}' +
    'mark[data-wz-active]{background:#f59e0b;color:#111827;outline:2px solid rgba(245,158,11,.45)}' +
    '@media (prefers-color-scheme: dark){#wz-hl-nav{background:rgba(30,41,59,.97);color:#e2e8f0;border-color:#475569}#wz-hl-nav button{background:#312e81;color:#c7d2fe}}';
  function escRe(s) { return String(s).replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'); }
  function injectStyle() {
    if (document.getElementById('wz-hl-style')) return;
    var st = document.createElement('style');
    st.id = 'wz-hl-style';
    st.textContent = NAV_CSS;
    (document.head || document.documentElement).appendChild(st);
  }
  function reportCount() {
    try { parent.postMessage({ type: 'wz-hl-count', count: state.marks.length, index: state.index }, '*'); } catch (e) {}
  }
  function clearHighlights() {
    if (state.nav && state.nav.parentNode) state.nav.parentNode.removeChild(state.nav);
    state.nav = null;
    var marks = document.querySelectorAll('mark[data-wz-hl]');
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      if (m.parentNode) m.parentNode.replaceChild(document.createTextNode(m.textContent), m);
    }
    state.marks = []; state.index = -1;
    reportCount();
  }
  function jump(dir) {
    if (!state.marks.length) return;
    if (state.index >= 0 && state.marks[state.index]) {
      state.marks[state.index].removeAttribute('data-wz-active');
      state.marks[state.index].style.background = '';
      state.marks[state.index].style.outline = '';
    }
    state.index = (state.index + dir + state.marks.length) % state.marks.length;
    var mark = state.marks[state.index];
    mark.setAttribute('data-wz-active', 'true');
    mark.style.background = '#f59e0b';
    mark.style.outline = '2px solid rgba(245,158,11,.5)';
    try { mark.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { mark.scrollIntoView(true); }
    if (state.nav && state.navCount) state.navCount.textContent = (state.index + 1) + ' / ' + state.marks.length;
    reportCount();
  }
  function highlightAll(terms) {
    terms = (terms || []).filter(function (t) { return t && String(t).trim(); })
      .sort(function (a, b) { return String(b).length - String(a).length; });
    clearHighlights();
    if (!terms.length) return;
    injectStyle();
    var re;
    try { re = new RegExp('(' + terms.map(escRe).join('|') + ')', 'gi'); } catch (e) { return; }
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [], node;
    while ((node = walker.nextNode())) {
      var tag = node.parentNode && node.parentNode.tagName;
      if (tag !== 'SCRIPT' && tag !== 'STYLE' && tag !== 'NOSCRIPT' && tag !== 'MARK') nodes.push(node);
    }
    for (var i = 0; i < nodes.length; i++) {
      var text = nodes[i].nodeValue || '';
      if (!text) continue;
      re.lastIndex = 0;
      var m, last = 0, frag = null, found = false;
      while ((m = re.exec(text)) !== null) {
        found = true;
        if (!frag) frag = document.createDocumentFragment();
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var mk = document.createElement('mark');
        mk.setAttribute('data-wz-hl', '1');
        mk.textContent = m[0];
        frag.appendChild(mk);
        last = m.index + m[0].length;
        if (m[0].length === 0) re.lastIndex++;
      }
      if (found) {
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        nodes[i].parentNode.replaceChild(frag, nodes[i]);
      }
    }
    state.marks = Array.prototype.slice.call(document.querySelectorAll('mark[data-wz-hl]'));
    if (state.marks.length) {
      var nav = document.createElement('div');
      nav.id = 'wz-hl-nav';
      var prev = document.createElement('button');
      prev.type = 'button'; prev.textContent = '↑ 上一个';
      var count = document.createElement('span');
      count.className = 'wz-hl-count';
      var next = document.createElement('button');
      next.type = 'button'; next.textContent = '下一个 ↓';
      var close = document.createElement('button');
      close.type = 'button'; close.textContent = '✕';
      nav.appendChild(prev); nav.appendChild(count); nav.appendChild(next); nav.appendChild(close);
      document.body.appendChild(nav);
      state.nav = nav; state.navCount = count;
      prev.onclick = function () { jump(-1); };
      next.onclick = function () { jump(1); };
      close.onclick = function () { clearHighlights(); };
      jump(0);
    }
    reportCount();
  }
  document.addEventListener('keydown', function (e) {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      jump(e.key === 'ArrowUp' ? -1 : 1);
    }
  });
  window.addEventListener('message', function (ev) {
    var d = ev.data || {};
    if (d.type === 'wz-highlight' || d.type === 'wz-search') highlightAll(d.terms);
    else if (d.type === 'wz-nav') jump(d.dir);
    else if (d.type === 'wz-clear') clearHighlights();
  });
})();
<\/script>`;

// ---------- 4. 生成正文页（转码 + 注入导航条） ----------
function navHtml(page, depth, fromDir) {
  const rel = '../'.repeat(depth);
  const crumbs = page
    ? [...page.parents.map(p => `<span>${esc(p)}</span>`), `<b>${esc(page.title)}</b>`]
    : [];
  let btns = `<a class="wz-btn" href="${rel}index.html" target="_top">☰ 目录</a>`;
  if (page) {
    const idx = page.idx;
    if (idx > 0) {
      const p = pages[idx - 1];
      btns += `<a class="wz-btn" href="${relPath(fromDir, p.url)}">← ${esc(p.title)}</a>`;
    }
    if (idx < pages.length - 1) {
      const n = pages[idx + 1];
      btns += `<a class="wz-btn" href="${relPath(fromDir, n.url)}">${esc(n.title)} →</a>`;
    }
  }
  return `<div class="wz-nav"><span class="wz-crumbs">${crumbs.join('<i>›</i>')}</span><span class="wz-btns">${btns}</span></div>`;
}

const pageByUrl = new Map(pages.map((p, i) => [p.url, { ...p, idx: i }]));

function processHtml(html, siteRel, page) {
  let out = html;
  if (page) {
    const depth = siteRel.split('/').length - 1;
    const nav = navHtml(page, depth, path.posix.dirname(siteRel));
    out = out.replace(/(<body[^>]*>)/i, (m) => `${m}\n${nav}\n`);
  }
  out = out.replace(/charset\s*=\s*["']?gb2312["']?/i, 'charset=utf-8')
    .replace(/charset\s*=\s*["']?gbk["']?/i, 'charset=utf-8');
  // 清理 Word 导出的 File-List 残留（指向未复制的 filelist.xml）
  out = out.replace(/<link[^>]*rel\s*=\s*File-List[^>]*>/gi, '');
  // 注入高亮定位脚本（接收壳的 postMessage，滚动到首个命中词并高亮）
  out = out.replace(/<\/body>/i, (m) => HL_SCRIPT + '\n' + m);
  return out;
}

// 4a. 磁盘正文文件
let htmCount = 0, injected = 0;
for (const rel of diskFiles) {
  const ext = path.extname(rel).toLowerCase();
  if (ext === '.hhc' || ext === '.hhk' || ext === '.xml') continue;
  const srcFile = path.join(SRC, rel.split('/').join(path.sep));
  const dest = path.join(OUT, rel.split('/').join(path.sep));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (isHtm(rel)) {
    htmCount++;
    const page = pageByUrl.get(rel);
    let html = readText(srcFile);
    html = processHtml(html, rel, page);
    if (page) injected++;
    fs.writeFileSync(dest, html, 'utf8');
  } else {
    fs.copyFileSync(srcFile, dest);
  }
}
// 4b. 聚合页（坏路径修复）
for (const [siteRel, html] of aggPages) {
  const page = pageByUrl.get(siteRel);
  let out = processHtml(html, siteRel, page);
  if (page) injected++;
  const dest = path.join(OUT, siteRel.split('/').join(path.sep));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out, 'utf8');
}
log(`正文页: ${htmCount} | 注入导航: ${injected} | 附件/图片已复制`);

// ---------- 5. 搜索倒排索引 ----------
for (const p of pages) {
  if (aggPages.has(p.url)) {
    p.searchTitle = p.title;
    p.text = extractText(aggPages.get(p.url)) + ' ' + p.title;
    p.snippet = bestWindow(p.text);
    continue;
  }
  try {
    const html = readText(path.join(SRC, p.url.split('/').join(path.sep)));
    const t = /<title>([\s\S]*?)<\/title>/i.exec(html);
    const title = (t && t[1].trim()) ? t[1].trim() : p.title;
    p.searchTitle = title;
    p.text = extractText(html);
    p.snippet = bestWindow(p.text);
  } catch (e) {
    warnings.push(`页面缺失: ${p.url} (${e.message})`);
    p.text = '';
    p.searchTitle = p.title;
    p.snippet = '';
  }
}
log(`搜索文本提取完成，总字数: ${pages.reduce((s, p) => s + p.text.length, 0)}`);

// 第一遍：统计词频（正文 tf 与标题 tf 分开，标题命中独立加权）
const inv = new Map(); // term -> Map(idx -> {b: 正文词频, t: 标题词频})
for (let i = 0; i < pages.length; i++) {
  const p = pages[i];
  const tm = new Map();
  for (const tk of tokenize(p.searchTitle)) {
    const e = tm.get(tk) || { b: 0, t: 0 };
    e.t++;
    tm.set(tk, e);
  }
  for (const tk of tokenize(p.text)) {
    const e = tm.get(tk) || { b: 0, t: 0 };
    e.b++;
    tm.set(tk, e);
  }
  for (const [tk, e] of tm) {
    let m = inv.get(tk);
    if (!m) inv.set(tk, (m = new Map()));
    m.set(i, e);
  }
}
// 第二遍：BM25 相关性加权（tf 饱和 + 文档长度归一化 + 标题 ×8）
const N = pages.length;
const avgdl = pages.reduce((s, p) => s + p.text.length, 0) / Math.max(1, N);
const K1 = 1.2, B = 0.75;
const invArr = {};
for (const [term, m] of inv) {
  const df = m.size;
  const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
  const a = [];
  for (const [idx, e] of m) {
    const dl = pages[idx].text.length || 1;
    const norm = K1 * (1 - B + B * dl / avgdl);
    const bm25 = (e.b * (K1 + 1)) / (e.b + norm);
    const w = Math.round(10 * idf * (bm25 + 8 * e.t));
    a.push(idx, Math.max(1, w));
  }
  invArr[term] = a;
}
const pageArr = [];
for (const p of pages) pageArr.push(p.url, p.searchTitle, p.snippet);
// 标题倒排索引（支持"只匹配标题"选项）
const titleInv = {};
for (let i = 0; i < pages.length; i++) {
  const seenT = new Set(tokenize(pages[i].searchTitle));
  for (const tk of seenT) {
    (titleInv[tk] = titleInv[tk] || []).push(i);
  }
}
const indexJson = JSON.stringify({ p: pageArr, inv: invArr, ti: titleInv });
const idxBytes = Buffer.byteLength(indexJson, 'utf8');
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'assets', 'search-index.json'), indexJson);
// 预压缩 gzip 版本（手机端加载更快；前端优先使用并自动解压）
fs.writeFileSync(path.join(OUT, 'assets', 'search-index.json.gz'),
  zlib.gzipSync(Buffer.from(indexJson, 'utf8'), { level: 9 }));
// 索引版本号（前端用它判断本地 IndexedDB 缓存是否过期）
fs.writeFileSync(path.join(OUT, 'assets', 'idx-version.txt'),
  new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14));
log(`搜索索引: ${inv.size} 词条, ${(idxBytes / 1048576).toFixed(2)} MB (gzip ${(fs.statSync(path.join(OUT, 'assets', 'search-index.json.gz')).size / 1048576).toFixed(2)} MB)`);

// ---------- 6. 生成应用壳 index.html ----------
function minifyNode(n) {
  const o = { i: n._id, n: n.name };
  if (n.local) o.u = n.local;
  if (n.children.length) o.c = n.children.map(minifyNode);
  return o;
}
let idc = 0;
(function assignId(nodes) {
  for (const n of nodes) { n._id = idc++; if (n.children.length) assignId(n.children); }
})(tree);
const tocJson = JSON.stringify(tree.map(minifyNode));
const defaultPage = pages.length ? encodeURI(pages[0].url) : '';

let shell = fs.readFileSync(new URL('./shell.html', import.meta.url), 'utf8');
const buildTs = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
shell = shell.replace('__TITLE__', VERSION ? `5z 规则 ${VERSION} 版` : '5z 规则网页版')
  .replace('__VERSION__', VERSION)
  .replace('__PAGE_COUNT__', String(pages.length))
  .replace('__DEFAULT_PAGE__', defaultPage)
  .replace('__TOC_JSON__', tocJson)
  .replace('__BUILD_TS__', buildTs);
fs.writeFileSync(path.join(OUT, 'index.html'), shell, 'utf8');

// ---------- 7. 复制壳资源 ----------
for (const f of ['site.css', 'app.js', 'body.css', 'favicon.svg', 'car.js', 'car.css', 'fflate.min.js', 'dict.js', 'dict.css']) {
  fs.copyFileSync(new URL('./assets/' + f, import.meta.url), path.join(OUT, 'assets', f));
}

// ---------- 7.5 车卡数据（解析规则书 → assets/card-data/*.json + 合并 js） ----------
{
  const r = _spawnSync(process.execPath,
    [path.resolve('5z_build/parse-card-data.mjs'), OUT],
    { encoding: 'utf8', timeout: 5 * 60 * 1000 });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stdout.write(r.stderr);
  if (r.status !== 0) {
    console.error('[build] 车卡数据解析失败，中止构建');
    process.exit(1);
  }
  // 合并为 script 可加载的单文件（file:// 直开时 fetch 被浏览器禁止，script 标签不受限）
  const cardData = {};
  for (const f of ['rules', 'races', 'classes', 'feats', 'spells', 'class-spells', 'maneuvers', 'programs']) {
    cardData[f] = JSON.parse(fs.readFileSync(path.join(OUT, 'assets/card-data', f + '.json'), 'utf8'));
  }
  const dataJs = 'window.__CAR_DATA__ = ' + JSON.stringify(cardData).replace(/</g, '\\u003c') + ';\n';
  fs.writeFileSync(path.join(OUT, 'assets', 'card-data.js'), dataJs, 'utf8');

  // Excel 导出模板（dnd5z人物卡模板改.xlsx）内联为 js（file:// 直开可用）
  const tplFile = path.resolve('dnd5z人物卡模板改.xlsx');
  if (!fs.existsSync(tplFile)) {
    console.error('[build] 未找到 Excel 导出模板: dnd5z人物卡模板改.xlsx');
    process.exit(1);
  }
  const tplB64 = fs.readFileSync(tplFile).toString('base64');
  fs.writeFileSync(path.join(OUT, 'assets', 'car-tpl.js'),
    'window.__TPL_XLSX_B64__ = "' + tplB64 + '";\n', 'utf8');
}

// ---------- 7.6 车卡页面（小页面，数据走独立 script） ----------
fs.copyFileSync(new URL('./car.html', import.meta.url), path.join(OUT, 'car.html'));

// ---------- 7.7 词典页面（法术/战技/程序） ----------
fs.copyFileSync(new URL('./dict.html', import.meta.url), path.join(OUT, 'dict.html'));

// ---------- 8. 部署辅助文件 ----------
fs.writeFileSync(path.join(OUT, '404.html'), `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>页面不存在 - 5z 规则</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,"Microsoft YaHei",sans-serif;background:#f6f7fb;color:#1e293b}
.card{text-align:center;padding:40px}
h1{font-size:48px;margin:0 0 12px;color:#7c3aed}
p{color:#64748b;margin:0 0 24px}
a{color:#7c3aed;font-weight:600;text-decoration:none;padding:10px 22px;border:1px solid #ddd6fe;border-radius:10px;background:#fff}
</style></head>
<body><div class="card"><h1>404</h1><p>你要找的页面不存在，或已被移动。</p><a href="index.html">← 返回目录</a></div></body></html>
`);
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\n');

log('--- 构建完成 ---');
log(`输出: ${OUT}`);
if (warnings.length) {
  log(`警告 (${warnings.length}):`);
  warnings.slice(0, 30).forEach(w => log('  ! ' + w));
}

function countNodes(nodes) {
  let n = 0;
  for (const x of nodes) { n += 1 + (x.children.length ? countNodes(x.children) : 0); }
  return n;
}
