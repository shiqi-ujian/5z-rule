// 补充统计 2：分类别链接量、首现策略、2 字名子集、接收链接的页面数
import fs from 'node:fs';
import path from 'node:path';
const SRC = path.resolve('5z_src');
const DATA = path.resolve('5z_web/assets/card-data');
const GB = new TextDecoder('gb18030');
const readText = (f) => {
  const b = fs.readFileSync(f);
  return /charset\s*=\s*['"]?utf-?8/i.test(b.subarray(0, 2000).toString('latin1')) ? b.toString('utf8') : GB.decode(b);
};
const decodeEntities = (s) => String(s)
  .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
  .replace(/&#39;/g, "'").replace(/&nbsp;/gi, ' ')
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const BLOCK = /<(?:br|hr)\s*\/?>|<\/(?:p|div|tr|td|th|li|ul|ol|h[1-6]|table|section|article|header|footer|blockquote|pre|address|figure|figcaption|dt|dd|dl|tbody|thead|tfoot|caption|fieldset|legend|nav|aside|main|math|ml)\s*>|<(?:p|div|tr|td|th|li|ul|ol|h[1-6]|table|section|article|header|footer|blockquote|pre|address|figure|figcaption|dt|dd|dl|tbody|thead|tfoot|caption|fieldset|legend|nav|aside|main|math|ml)(?:\s[^>]*)?\s*\/?>/gi;
const extractText = (html) => decodeEntities(String(html)
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<head[\s\S]*?<\/head>/gi, ' ')
  .replace(BLOCK, ' ')
  .replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
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
const J = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f + '.json'), 'utf8'));
const cats = [
  { label: '法术', items: J('spells').map(x => ({ name: x.name, url: x.url })) },
  { label: '战技', items: J('maneuvers').map(x => ({ name: x.name, url: x.url })) },
  { label: '程序', items: J('programs').map(x => ({ name: x.name, url: x.url })) },
  { label: '专长', items: J('feats').map(x => ({ name: x.name, url: x.url })) },
  { label: '魔法物品', items: J('magic-items').map(x => ({ name: x.name, url: x.url })) },
  { label: '怪物', items: J('monsters').map(x => ({ name: x.name, url: x.url })) },
  { label: '职业', items: J('classes').map(x => ({ name: x.name, url: x.url })) },
  { label: '种族', items: J('races').map(x => ({ name: x.name, url: x.url })) },
  { label: '子职', items: J('classes').flatMap(c => (c.subclasses || []).map(s => ({ name: s.name, url: s.url }))) },
];
// 建立 canon -> cats 映射
const byCanon = new Map();
for (const c of cats) for (const it of c.items) {
  const k = canonName(it.name);
  if (!k) continue;
  if (!byCanon.has(k)) byCanon.set(k, { cats: new Set(), urls: new Set() });
  const e = byCanon.get(k); e.cats.add(c.label); e.urls.add(it.url);
}
// AC
function buildAC(words) {
  const nodes = [{ next: new Map(), fail: 0, out: [] }];
  for (const w of words) {
    let cur = 0;
    for (const ch of w) { let n = nodes[cur].next.get(ch); if (n === undefined) { n = nodes.length; nodes.push({ next: new Map(), fail: 0, out: [] }); nodes[cur].next.set(ch, n); } cur = n; }
    nodes[cur].out.push(w);
  }
  const q = [];
  for (const [, n] of nodes[0].next) { nodes[n].fail = 0; q.push(n); }
  while (q.length) {
    const cur = q.shift(); const node = nodes[cur];
    for (const [ch, nxt] of node.next) {
      let f = node.fail;
      while (f && !nodes[f].next.has(ch)) f = nodes[f].fail;
      nodes[nxt].fail = nodes[f].next.get(ch) || 0;
      nodes[nxt].out = nodes[nxt].out.concat(nodes[nodes[nxt].fail].out);
      q.push(nxt);
    }
  }
  return nodes;
}
const ac = buildAC([...byCanon.keys()]);
function scan(text) {
  const out = []; let cur = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    while (cur && !ac[cur].next.has(ch)) cur = ac[cur].fail;
    cur = ac[cur].next.get(ch) || 0;
    for (const w of ac[cur].out) out.push([i - w.length + 1, i + 1, w]);
  }
  out.sort((a, b) => a[0] - b[0] || (b[1] - b[0]) - (a[1] - a[0]));
  const res = []; let lastEnd = -1;
  for (const [s, e, w] of out) { if (s < lastEnd) continue; res.push([s, e, w]); lastEnd = e; }
  return res;
}
const corpus = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) { if (!/\.files$/i.test(e.name)) walk(full); continue; }
    if (!/\.html?$/i.test(e.name)) continue;
    corpus.push({ rel: path.relative(SRC, full).split(path.sep).join('/'), text: extractText(readText(full)) });
  }
})(SRC);
const perCat = {};
for (const c of cats) perCat[c.label] = { all: 0, first: 0, firstGe3: 0, pages: new Set() };
const pageLinkCount = new Map();
let totalFirst = 0, totalFirstGe3 = 0, totalAll = 0;
for (const c of corpus) {
  const seen = new Set();
  for (const [, , w] of scan(c.text)) {
    const info = byCanon.get(w);
    if (!info) continue;
    totalAll++;
    for (const label of info.cats) {
      const pc = perCat[label]; pc.all++; pc.pages.add(c.rel);
      if (!seen.has(w)) { pc.first++; if ([...w].length >= 3) pc.firstGe3++; }
    }
    if (!seen.has(w)) {
      totalFirst++;
      if ([...w].length >= 3) totalFirstGe3++;
      pageLinkCount.set(c.rel, (pageLinkCount.get(c.rel) || 0) + 1);
      seen.add(w);
    }
  }
}
console.log('===== 分类别链接量（全站） =====');
console.table(cats.map(c => ({
  类别: c.label, 词条: c.items.length,
  全部命中: perCat[c.label].all,
  每页首现: perCat[c.label].first,
  '首现且≥3字': perCat[c.label].firstGe3,
  涉及页数: perCat[c.label].pages.size,
})));
console.log(`合计：全部 ${totalAll} | 每页首现 ${totalFirst} | 首现且≥3字 ${totalFirstGe3}`);
const counts = [...pageLinkCount.values()];
console.log(`\n接收链接的页面 ${counts.length} 个；每页链接数：最大 ${Math.max(...counts)} | 中位 ${counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)]} | 平均 ${(counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1)}`);
// 2 字名的分布
const two = [...byCanon.keys()].filter(k => [...k].length <= 2);
console.log(`\n≤2 字可链接名 ${two.length} 个，按类别组合:`, JSON.stringify((() => {
  const m = {};
  for (const k of two) { const b = [...byCanon.get(k).cats].sort().join('+'); m[b] = (m[b] || 0) + 1; }
  return m;
})()));
// Tier1 = 法术/战技/程序；若只做这三类，链接量多少
let tier1All = 0, tier1First = 0, tier1Ge3First = 0;
for (const c of corpus) {
  const seen = new Set();
  for (const [, , w] of scan(c.text)) {
    const info = byCanon.get(w);
    if (!info) continue;
    const isT1 = [...info.cats].some(x => ['法术', '战技', '程序'].includes(x));
    if (!isT1) continue;
    tier1All++;
    if (!seen.has(w)) { seen.add(w); tier1First++; if ([...w].length >= 3) tier1Ge3First++; }
  }
}
console.log(`\nTier1（法术/战技/程序）链接量：全部 ${tier1All} | 每页首现 ${tier1First} | 首现且≥3字 ${tier1Ge3First}`);
