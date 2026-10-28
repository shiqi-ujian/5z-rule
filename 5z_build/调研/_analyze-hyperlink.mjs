// ============================================================
// 需求分析：规则书正文「关键词 → 词条」超链接索引 —— 只读实测脚本
// 目的：给方案评估提供可复现的数字（词条规模 / 候选链接量 / 锚点可行性 /
//       歧义与误链风险 / 数据质量地雷 / 体积与策略对比）
// 运行：node 5z_build/调研/_analyze-hyperlink.mjs
// 说明：只读 5z_src / 5z_web，不修改任何产物。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const SRC = path.join(ROOT, '5z_src');
const DATA = path.join(ROOT, '5z_web', 'assets', 'card-data');
const GB18030 = new TextDecoder('gb18030');

function readText(file) {
  const buf = fs.readFileSync(file);
  const head = buf.subarray(0, 2000).toString('latin1');
  return /charset\s*=\s*["']?utf-?8/i.test(head) ? buf.toString('utf8') : GB18030.decode(buf);
}
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&nbsp;/gi, ' ')
    .replace(/&#183;/g, '·').replace(/&middot;/g, '·')
    .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}
const BLOCK_TAG_RE = /<(?:br|hr)\s*\/?>|<\/(?:p|div|tr|td|th|li|ul|ol|h[1-6]|table|section|article|header|footer|blockquote|pre|address|figure|figcaption|dt|dd|dl|tbody|thead|tfoot|caption|fieldset|legend|nav|aside|main|math|ml)\s*>|<(?:p|div|tr|td|th|li|ul|ol|h[1-6]|table|section|article|header|footer|blockquote|pre|address|figure|figcaption|dt|dd|dl|tbody|thead|tfoot|caption|fieldset|legend|nav|aside|main|math|ml)(?:\s[^>]*)?\s*\/?>/gi;
function extractText(html) {
  let t = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(BLOCK_TAG_RE, ' ')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(t).replace(/\s+/g, ' ').trim();
}
// 词条名的「可匹配形式」：去掉尾部英文别名 / 标点（规则书 Word 导出：中文名 + 英文名 同段落）
function canonName(name) {
  let s = String(name).split('\n')[0].trim();
  let prev;
  do {
    prev = s;
    s = s.replace(/[\s，。、；：！？·—\-_'"“”‘’（）()《》【】\[\]\/／|]+$/, '');
    s = s.replace(/\s*[A-Za-z][A-Za-z0-9\s'’.\-：:，,！!\/／]*$/, '').trim();
  } while (s !== prev);
  return s || String(name).trim();
}

// ---------- 0. hhc 页面清单 ----------
function parseHhc(text) {
  const root = { children: [] };
  const stack = [root.children];
  let cur = null;
  const re = /<UL>|<\/UL>|<LI>|<OBJECT[\s\S]*?<\/OBJECT>/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const t = m[0];
    if (t === '<UL>') stack.push(cur ? cur.children : stack[stack.length - 1]);
    else if (t === '</UL>') stack.pop();
    else if (t === '<LI>') { cur = { name: '', local: '', children: [] }; stack[stack.length - 1].push(cur); }
    else {
      const nm = /name="Name" value="([^"]*)"/i.exec(t);
      const lc = /name="Local" value="([^"]*)"/i.exec(t);
      if (nm) cur.name = decodeEntities(nm[1]);
      if (lc) cur.local = decodeEntities(lc[1]).replace(/\\/g, '/');
    }
  }
  return root.children;
}
const hhcFile = fs.readdirSync(SRC).find(f => /\.hhc$/i.test(f));
const pages = [];
(function walk(nodes) {
  for (const n of nodes) {
    if (n.local) pages.push({ url: n.local, title: n.name });
    if (n.children.length) walk(n.children);
  }
})(parseHhc(readText(path.join(SRC, hhcFile))));

// ---------- 1. 词条目录（card-data 9 类） ----------
const J = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f + '.json'), 'utf8'));
const spells = J('spells'), maneuvers = J('maneuvers'), feats = J('feats');
const programs = J('programs'), magicItems = J('magic-items'), monsters = J('monsters');
const classes = J('classes'), races = J('races');
const subclasses = classes.flatMap(c => (c.subclasses || []).map(s => ({ name: s.name, url: s.url })));
const catalog = [
  { key: 'spells', label: '法术', items: spells.map(s => ({ name: s.name, url: s.url })) },
  { key: 'maneuvers', label: '战技', items: maneuvers.map(s => ({ name: s.name, url: s.url })) },
  { key: 'feats', label: '专长', items: feats.map(s => ({ name: s.name, url: s.url })) },
  { key: 'programs', label: '程序', items: programs.map(s => ({ name: s.name, url: s.url })) },
  { key: 'magicItems', label: '魔法物品', items: magicItems.map(s => ({ name: s.name, url: s.url })) },
  { key: 'monsters', label: '怪物', items: monsters.map(s => ({ name: s.name, url: s.url })) },
  { key: 'classes', label: '职业', items: classes.map(s => ({ name: s.name, url: s.url })) },
  { key: 'races', label: '种族', items: races.map(s => ({ name: s.name, url: s.url })) },
  { key: 'subclasses', label: '子职', items: subclasses },
];
const allEntries = [];
for (const cat of catalog) for (const it of cat.items) allEntries.push({ ...it, cat: cat.key, catLabel: cat.label });
// 可链接名（canonName 归一后）→ 词条列表
const byCanon = new Map();
for (const e of allEntries) {
  const k = canonName(e.name);
  if (!k) continue;
  if (!byCanon.has(k)) byCanon.set(k, []);
  byCanon.get(k).push(e);
}

// ---------- 2. 正文语料（5z_src 全部 htm，排除 .files 附件目录） ----------
const corpus = [];
(function collect(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/\.files$/i.test(e.name)) collect(full); continue; }
    if (!/\.html?$/i.test(e.name)) continue;
    const rel = path.relative(SRC, full).split(path.sep).join('/');
    const html = readText(full);
    corpus.push({ rel, html, text: extractText(html) });
  }
})(SRC);
const corpusByRel = new Map(corpus.map(c => [c.rel, c]));
const totalChars = corpus.reduce((s, c) => s + c.text.length, 0);
const totalLinkTags = corpus.reduce((s, c) => s + (c.html.match(/<a\s/gi) || []).length, 0);
const totalIdAttrs = corpus.reduce((s, c) => s + (c.html.match(/\sid\s*=/gi) || []).length, 0);

// ---------- 3. Aho-Corasick 最长匹配（模拟 linkify 决策） ----------
function buildAC(words) {
  const nodes = [{ next: new Map(), fail: 0, out: [] }];
  for (const w of words) {
    let cur = 0;
    for (const ch of w) {
      let nxt = nodes[cur].next.get(ch);
      if (nxt === undefined) { nxt = nodes.length; nodes.push({ next: new Map(), fail: 0, out: [] }); nodes[cur].next.set(ch, nxt); }
      cur = nxt;
    }
    nodes[cur].out.push(w);
  }
  const q = [];
  for (const [, nxt] of nodes[0].next) { nodes[nxt].fail = 0; q.push(nxt); }
  while (q.length) {
    const cur = q.shift();
    const node = nodes[cur];
    for (const [ch, nxt] of node.next) {
      let f = node.fail;
      while (f && !nodes[f].next.has(ch)) f = nodes[f].fail;
      nodes[nxt].fail = (nodes[f].next.get(ch)) || 0;
      nodes[nxt].out = nodes[nxt].out.concat(nodes[nodes[nxt].fail].out);
      q.push(nxt);
    }
  }
  return nodes;
}
const acNames = [...byCanon.keys()];
const ac = buildAC(acNames);
function scanMatches(text) {
  const out = [];
  let cur = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    while (cur && !ac[cur].next.has(ch)) cur = ac[cur].fail;
    cur = ac[cur].next.get(ch) || 0;
    for (const w of ac[cur].out) out.push([i - w.length + 1, i + 1, w]);
  }
  out.sort((a, b) => a[0] - b[0] || (b[1] - b[0]) - (a[1] - a[0]));
  const res = [];
  let lastEnd = -1;
  for (const [s, e, w] of out) { if (s < lastEnd) continue; res.push([s, e, w]); lastEnd = e; }
  return res;
}

// ---------- 4. 命中统计（每页 / 每词条） ----------
const entryStats = new Map(); // canon name -> stats
for (const n of acNames) entryStats.set(n, { occurrences: 0, ownPage: 0, offPage: 0, pages: new Set() });
const pageMatches = new Map(); // rel -> [{s,e,name}]
for (const c of corpus) {
  const ms = scanMatches(c.text);
  pageMatches.set(c.rel, ms);
  for (const [, , w] of ms) {
    const st = entryStats.get(w);
    st.occurrences++; st.pages.add(c.rel);
    const targets = byCanon.get(w) || [];
    if (targets.some(t => t.url === c.rel)) st.ownPage++; else st.offPage++;
  }
}

// ---------- 5. 汇总表 ----------
const MB = (n) => (n / 1048576).toFixed(2) + ' MB';
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
console.log('========== 一、语料规模 ==========');
console.log(`hhc 目录页: ${pages.length} | 磁盘 htm: ${corpus.length} | 正文总字数: ${totalChars.toLocaleString()}`);
console.log(`源页内现有 <a> 标签: ${totalLinkTags}（其中规则书内部锚点 0 个） | 现有 id 属性: ${totalIdAttrs} | 单页最大正文: ${Math.max(...corpus.map(c => c.text.length)).toLocaleString()} 字`);
const byCat = catalog.map(cat => {
  const names = cat.items.map(i => i.name);
  const uniq = [...new Set(names)];
  const canon = [...new Set(uniq.map(canonName).filter(Boolean))];
  const stats = canon.map(n => entryStats.get(n)).filter(Boolean);
  return {
    类别: cat.label, 词条数: cat.items.length, 唯一名: uniq.length, 归一后唯一名: canon.length,
    目标页: new Set(cat.items.map(i => i.url)).size,
    正文命中: sum(stats, s => s.occurrences),
    非本页命中: sum(stats, s => s.offPage),
    被站内引用: stats.filter(s => s.offPage > 0).length,
    从未被引用: stats.filter(s => s.offPage === 0).length,
  };
});
console.table(byCat);
const totalOcc = sum(byCat, r => r.正文命中);
const totalOff = sum(byCat, r => r.非本页命中);
console.log(`合计：词条 ${allEntries.length}（可链接名 ${acNames.length}），最长匹配命中 ${totalOcc.toLocaleString()} 处，其中「非本条目所在页」${totalOff.toLocaleString()} 处`);

// ---------- 6. 歧义 / 误链风险 ----------
console.log('\n========== 二、歧义与误链风险 ==========');
const dupCanon = [...byCanon.entries()].filter(([, v]) => v.length > 1);
const dupCrossCat = [...byCanon.entries()].filter(([, v]) => new Set(v.map(x => x.catLabel)).size > 1);
const dupSamePage = dupCanon.filter(([, v]) => new Set(v.map(x => x.url)).size < v.length);
const lenDist = {};
for (const n of acNames) { const L = [...n].length; const k = L >= 5 ? '5+' : String(L); lenDist[k] = (lenDist[k] || 0) + 1; }
console.log(`归一后唯一名 ${acNames.length} | 长度分布 ${JSON.stringify(lenDist)}`);
console.log(`同名（跨/同类别）: ${dupCanon.length} 组 | 其中跨类别 ${dupCrossCat.length} 组 | 同名且同目标页 ${dupSamePage.length} 组（锚点必须加序号）`);
console.log('  跨类别同名示例:', dupCrossCat.slice(0, 8).map(([n, v]) => `${n}=${[...new Set(v.map(x => x.catLabel))].join('+')}`).join('  '));
// 短名（≤2 字）在正文中的分布：判断「能不能直接链」
const shortNames = acNames.filter(n => [...n].length <= 2);
const shortRows = shortNames.map(n => ({
  名字: n, 类别: [...new Set(byCanon.get(n).map(x => x.catLabel))].join('/'),
  命中: entryStats.get(n).occurrences, 非本页: entryStats.get(n).offPage,
  页数: entryStats.get(n).pages.size,
}));
shortRows.sort((a, b) => b.非本页 - a.非本页);
console.log(`≤2 字名 ${shortRows.length} 个；其中「非本页命中」≥100 的 ${shortRows.filter(r => r.非本页 >= 100).length} 个（这些几乎都是「通用词」，直接链会是灾难）`);
console.table(shortRows.slice(0, 20));
const shortByCat = {};
for (const r of shortRows) {
  const k = r.类别;
  const e = shortByCat[k] || (shortByCat[k] = { n: 0, occ: 0, max: 0 });
  e.n++; e.occ += r.非本页; e.max = Math.max(e.max, r.非本页);
}
console.log('≤2 字名按类别:', JSON.stringify(shortByCat));

// ---------- 7. 每类名字长度分布（决定「长度门槛」策略） ----------
console.log('\n========== 三、各类名字长度分布 ==========');
const lenTable = catalog.map(cat => {
  const dist = {};
  const seen = new Set();
  for (const it of cat.items) { const n = canonName(it.name); if (seen.has(n)) continue; seen.add(n); const L = [...n].length; const k = L >= 5 ? '5+' : String(L); dist[k] = (dist[k] || 0) + 1; }
  return { 类别: cat.label, ...dist };
});
console.table(lenTable);

// ---------- 8. 链接策略对比（体积/密度） ----------
console.log('\n========== 四、链接策略对比（全站候选 / 首现策略 / 长度门槛） ==========');
const JUNK_PAGES = new Set(['基础/版本更新.htm', '基础/设计师访谈.htm', '基础/5z说明.htm', '法术/召唤物.htm']);
const JUNK_ENTRY = (n) => [...n].length > 16 || /[\n]/.test(n) || [...n].length <= 1;
function policyCount({ firstPerPage = false, minLen = 1, skipOwnPage = false, junkPages = false, junkEntries = false }) {
  let count = 0;
  for (const c of corpus) {
    if (junkPages && JUNK_PAGES.has(c.rel)) continue;
    const seen = new Set();
    for (const [, , w] of pageMatches.get(c.rel)) {
      if ([...w].length < minLen) continue;
      if (junkEntries && JUNK_ENTRY(w)) continue;
      if (skipOwnPage && (byCanon.get(w) || []).some(t => t.url === c.rel)) continue;
      if (firstPerPage) { if (seen.has(w)) continue; seen.add(w); }
      count++;
    }
  }
  return count;
}
const policyRows = [
  { 策略: 'A 全部命中', n: policyCount({}) },
  { 策略: 'B 每页每词条只链首次', n: policyCount({ firstPerPage: true }) },
  { 策略: 'C 仅 ≥3 字名', n: policyCount({ minLen: 3 }) },
  { 策略: 'D ≥3 字 + 每页首次', n: policyCount({ minLen: 3, firstPerPage: true }) },
  { 策略: 'E D + 跳过脏页', n: policyCount({ minLen: 3, firstPerPage: true, junkPages: true }) },
  { 策略: 'F D + 跳过词条自身所在页', n: policyCount({ minLen: 3, firstPerPage: true, skipOwnPage: true }) },
  { 策略: 'G D + 排除脏词条名', n: policyCount({ minLen: 3, firstPerPage: true, junkEntries: true }) },
].map(r => ({ ...r, 估算HTML增量: MB(r.n * 70) }));
console.table(policyRows);
console.log('（每处链接按「<a href="...">…</a>」约 +70 字节估算；正文页总体积见构建日志）');

// ---------- 9. 锚点可行性（样式判定能否精确定位词条头） ----------
console.log('\n========== 五、锚点可行性：目标页里能否稳定定位每个词条 ==========');
function parseBlocks(html) {
  const out = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>|<h([1-6])[^>]*>([\s\S]*?)<\/h\2>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const inner = m[1] !== undefined ? m[1] : m[3] || '';
    const withBr = inner.replace(/<br\s*\/?>/gi, '\n');
    const styleSrc = withBr.replace(/<(b|span|font|i|em|strong|u|o:p|p)[^>]*>((?:&nbsp;|\s)*)<\/\1>/gi, '$2');
    const sm = /font-size:(\d+(?:\.\d+)?)\.0000pt/i.exec(styleSrc);
    const size = sm ? parseFloat(sm[1]) : 12;
    const bold = /font-weight:\s*bold/i.test(styleSrc);
    const brown = /color:rgb\(118,45,0\)/i.test(styleSrc);
    const red = /color:rgb\(128,0,0\)/i.test(styleSrc);
    const text = decodeEntities(withBr.replace(/<[^>]+>/g, '')).replace(/[ \t\u00a0]+/g, ' ').trim();
    if (!text) continue;
    const firstLine = text.split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
    out.push({
      text, firstLine,
      type: size >= 16 && bold ? 'h1' : (size >= 14 && bold && brown ? 'h2' : (bold ? 'h3' : 'p')),
      size, bold, red, brown,
    });
  }
  return out;
}
const anchorRows = [];
for (const cat of catalog) {
  const byUrl = new Map();
  for (const it of cat.items) { if (!byUrl.has(it.url)) byUrl.set(it.url, []); byUrl.get(it.url).push(it.name); }
  let total = 0, asFirstLine = 0, asHeading = 0, samePageDup = 0;
  const miss = [];
  for (const [url, names] of byUrl) {
    const c = corpusByRel.get(url);
    if (!c) { total += names.length; continue; }
    const blocks = parseBlocks(c.html);
    const firstLines = new Map(); // canon firstLine -> blocks[]
    for (const b of blocks) {
      const k = canonName(b.firstLine);
      if (!firstLines.has(k)) firstLines.set(k, []);
      firstLines.get(k).push(b);
    }
    for (const n of names) {
      const k = canonName(n);
      total++;
      const hits = firstLines.get(k) || [];
      if (hits.some(b => b.type !== 'p')) asHeading++;
      if (hits.length) asFirstLine++;
      if (hits.length > 1) samePageDup++;
      else if (!hits.length && miss.length < 6) miss.push(n);
    }
  }
  anchorRows.push({
    类别: cat.label, 目标页: byUrl.size, 词条: total,
    能定位块: asFirstLine, 能定位为标题样式: asHeading,
    标题覆盖率: total ? (100 * asHeading / total).toFixed(1) + '%' : '-',
    同页重名: samePageDup, 未命中示例: miss.join('、'),
  });
}
console.table(anchorRows);

// ---------- 10. 目标页分布（锚点要加在哪些页） ----------
console.log('\n========== 六、锚点落点分布 ==========');
const targetPages = new Map();
for (const e of allEntries) {
  const k = e.url;
  const x = targetPages.get(k) || { count: 0, cats: new Set() };
  x.count++; x.cats.add(e.catLabel);
  targetPages.set(k, x);
}
const multi = [...targetPages.entries()].filter(([, v]) => v.count > 1).sort((a, b) => b[1].count - a[1].count);
console.log(`全部目标页 ${targetPages.size} 个，其中「一页多词条、需要锚点」的 ${multi.length} 个`);
console.table(multi.slice(0, 15).map(([url, v]) => ({ 目标页: url, 词条数: v.count, 类别: [...v.cats].join('/') })));

// ---------- 11. 数据质量地雷 ----------
console.log('\n========== 七、数据质量地雷（会直接变成误链/缺锚点） ==========');
const badSpell = spells.filter(s => /[A-Za-z\n\/／]/.test(s.name));
const badFeat = feats.filter(f => [...f.name].length > 16);
const shortEntries = allEntries.filter(e => [...canonName(e.name)].length <= 1);
const latinNames = allEntries.filter(e => /[A-Za-z]/.test(e.name));
const slashNames = allEntries.filter(e => /[\/／]/.test(e.name));
console.log(`法术名带英文/换行/斜杠 ${badSpell.length} 个 →`, badSpell.slice(0, 10).map(s => JSON.stringify(s.name)).join(' '));
console.log(`专长名是整段文字（>16 字）${badFeat.length} 个，如`, JSON.stringify(badFeat[0]?.name.slice(0, 40)));
console.log(`归一后 ≤1 字的名 ${shortEntries.length} 个：`, shortEntries.map(e => `${e.name}[${e.catLabel}]`).join(' '));
console.log(`含拉丁字母的名 ${latinNames.length} 个（怪物/魔法物品的「中文名+English」属正常，但直接当关键词会把英文片段也链出来）`);
console.log(`含斜杠的名 ${slashNames.length} 个：`, slashNames.slice(0, 8).map(e => e.name).join(' | '));
const canonCollide = acNames.filter(n => byCanon.get(n).length > 1);
console.log(`canonName 归一后发生的合并/同名 ${canonCollide.length} 组（锚点/优先级需要处理）`);

// ---------- 12. Word 行内标签拆断抽样 ----------
console.log('\n========== 八、Word 行内标签拆断抽样（决定匹配按「块」还是按「文本节点」） ==========');
const splitRows = [];
for (const rel of ['法术/法术详述/0环.htm', '法术/法术详述/3环.htm', '法术/法术规则.htm', '专长/通用专长/泛用性的专长.htm', '装备/魔法物品/武器/武器（近战）.htm', '怪物/不死生物/亡灵（CR15+）.htm', '基础/回合与动作.htm']) {
  const c = corpusByRel.get(rel);
  if (!c) continue;
  let cross = 0, total = 0;
  const bre = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = bre.exec(c.html)) !== null) {
    const segs = m[1].split(/<[^>]+>/).map(decodeEntities);
    const joined = segs.join('');
    const bounds = new Set();
    let pos = 0;
    for (let i = 0; i < segs.length - 1; i++) { pos += segs[i].length; bounds.add(pos); }
    for (const [s, e] of scanMatches(joined)) {
      total++;
      for (let p = s + 1; p < e; p++) if (bounds.has(p)) { cross++; break; }
    }
  }
  splitRows.push({ 页面: rel, 块内命中: total, 跨标签命中: cross, 跨断率: total ? (100 * cross / total).toFixed(1) + '%' : '-' });
}
console.table(splitRows);

// ---------- 13. 规则术语（Tier 2 候选：状态/动作/伤害类型…） ----------
console.log('\n========== 九、规则术语候选（基础规则页的短标题，可做第二期关键词） ==========');
const terms = new Map();
for (const c of corpus) {
  if (!c.rel.startsWith('基础/') && c.rel !== '法术/法术规则.htm') continue;
  for (const b of parseBlocks(c.html)) {
    if (b.type === 'p') continue;
    const t = canonName(b.firstLine);
    const L = [...t].length;
    if (L < 2 || L > 6) continue;
    if (/[。，；：！？]/.test(t)) continue;
    const x = terms.get(t) || { 词: t, 来源页: new Set(), 出现: 0, 涉及页: 0 };
    x.来源页.add(c.rel);
    terms.set(t, x);
  }
}
const acTerms = buildAC([...terms.keys()]);
const termOcc = new Map([...terms.keys()].map(k => [k, { occ: 0, pages: new Set() }]));
for (const c of corpus) {
  let cur = 0;
  for (let i = 0; i < c.text.length; i++) {
    const ch = c.text[i];
    while (cur && !acTerms[cur].next.has(ch)) cur = acTerms[cur].fail;
    cur = acTerms[cur].next.get(ch) || 0;
    for (const w of acTerms[cur].out) { const s = termOcc.get(w); if (!s) continue; s.occ++; s.pages.add(c.rel); }
  }
}
const termRows = [...terms.values()].map(t => ({ 术语: t.词, 定义页: [...t.来源页].join('、'), 正文出现: termOcc.get(t.词).occ, 涉及页数: termOcc.get(t.词).pages.size }))
  .sort((a, b) => b.正文出现 - a.正文出现);
console.log(`基础/法术规则页的短标题术语 ${termRows.length} 个；命中分布：`);
console.table(termRows.slice(0, 25));

// ---------- 14. CHM 自带 hhk 索引 ----------
console.log('\n========== 十、CHM 自带 hhk 索引（是不是「关键词索引」？） ==========');
{
  const hhkFile = fs.readdirSync(SRC).find(f => /\.hhk$/i.test(f));
  const txt = readText(path.join(SRC, hhkFile));
  const entries = [];
  for (const m of txt.matchAll(/<OBJECT[\s\S]*?<\/OBJECT>/gi)) {
    const names = [...m[0].matchAll(/name="Name" value="([^"]*)"/gi)].map(x => decodeEntities(x[1]));
    const local = /name="Local" value="([^"]*)"/i.exec(m[0]);
    entries.push({ name: names[names.length - 1] || '', local: local ? decodeEntities(local[1]).replace(/\\/g, '/') : '' });
  }
  const uniqNames = new Set(entries.map(e => e.name));
  const uniqTargets = new Set(entries.map(e => e.local));
  const overlapAll = [...uniqNames].filter(n => acNames.includes(canonName(n)));
  const dirs = {};
  for (const e of entries) { const top = e.local.split('/')[0] || '(空)'; dirs[top] = (dirs[top] || 0) + 1; }
  console.log(`hhk 条目 ${entries.length}（唯一名 ${uniqNames.size}，唯一目标 ${uniqTargets.size}）；hhc 页面 ${pages.length} → hhk 基本就是「页面清单」，不是关键词索引`);
  console.log(`hhk 名与词条名重合 ${overlapAll.length} 个（${(100 * overlapAll.length / uniqNames.size).toFixed(0)}%），且都指向页面而非条目`);
  console.log('hhk 目标目录分布:', JSON.stringify(dirs));
}

// ---------- 15. 现有「规则书原文」链接 = 页顶 ----------
console.log('\n========== 十一、词典 → 规则书原文链路现状 ==========');
const dictUrls = new Map();
for (const e of allEntries) dictUrls.set(e.url, (dictUrls.get(e.url) || 0) + 1);
console.log(`dict.js 的「📖 规则书原文」直接用 url 字段：${dictUrls.size} 个页面，全部落在页顶；一页多词条（需锚点才有意义）的 ${multi.length} 个页面`);
console.log('示例：法术 1196 个全部链接到 13 个环位页的页顶（3环页 155 个法术）');
