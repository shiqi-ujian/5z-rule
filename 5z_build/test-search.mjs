// 模拟新搜索语法验证
import fs from 'node:fs';
const idx = JSON.parse(fs.readFileSync('C:/Users/shiqi/Desktop/4AD/5z_web/assets/search-index.json', 'utf8'));
console.log('索引字段:', Object.keys(idx), '| 标题索引词条:', Object.keys(idx.ti).length);

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
function extractHighlightTerms(input) {
  if (!input) return [];
  const terms = [];
  const regex = /"([^"]+)"|(\S+)/g;
  let match;
  while ((match = regex.exec(input)) !== null) {
    const token = match[1] || match[2] || '';
    if (!token) continue;
    token.split('|').forEach((part) => { const c = part.trim(); if (c) terms.push(c); });
  }
  return terms;
}
function parseQuery(query) {
  const groups = [];
  const regex = /"([^"]+)"|(\S+)/g;
  let match;
  while ((match = regex.exec(query)) !== null) {
    const token = (match[1] || match[2] || '').trim();
    if (!token) continue;
    if (match[1]) groups.push({ phrase: token });
    else {
      const parts = token.split('|').map(s => s.trim()).filter(Boolean);
      groups.push({ or: parts.length > 1 ? parts : [parts[0]] });
    }
  }
  return groups;
}
function doSearch(query, opts) {
  const groups = parseQuery(query);
  if (!groups.length) return { terms: [], hits: [] };
  const allTokens = [];
  groups.forEach(g => { if (g.phrase) allTokens.push(...tokenize(g.phrase)); else g.or.forEach(w => allTokens.push(...tokenize(w))); });
  const uniqTokens = [...new Set(allTokens)];
  const scores = new Map();
  for (const tk of uniqTokens) {
    const arr = idx.inv[tk]; if (!arr) continue;
    for (let i = 0; i < arr.length; i += 2) {
      const pi = arr[i];
      let e = scores.get(pi); if (!e) { e = { w: 0, hit: new Set() }; scores.set(pi, e); }
      e.w += arr[i + 1]; e.hit.add(tk);
    }
  }
  const gMatch = (pi, g, hit) => {
    if (g.phrase) return tokenize(g.phrase).every(t => hit.has(t));
    return g.or.some(w => tokenize(w).every(t => hit.has(t)));
  };
  let hits = [...scores.keys()].filter(pi => groups.every(g => gMatch(pi, g, scores.get(pi).hit)));
  const ti = idx.ti || {};
  if (opts && opts.titleOnly) {
    hits = hits.filter(pi => groups.every(g => {
      if (g.phrase) return tokenize(g.phrase).every(t => (ti[t] || []).includes(pi));
      return g.or.some(w => tokenize(w).every(t => (ti[t] || []).includes(pi)));
    }));
  }
  if (opts && opts.cat && opts.cat !== 'all') hits = hits.filter(pi => idx.p[pi * 3].startsWith(opts.cat + '/'));
  const sorted = hits.map(pi => [pi, scores.get(pi).w]).sort((a, b) => b[1] - a[1]);
  const max = sorted.length ? sorted[0][1] : 0;
  return { terms: extractHighlightTerms(query), hits: sorted.map(([pi, w]) => [pi, w, max ? Math.round(100 * w / max) : 0]) };
}
const tests = [
  ['豁免 检定', {}],
  ['火球术', {}],
  ['腰带|巨人', {}],
  ['"法师之手"', {}],
  ['狂暴', { titleOnly: true }],
  ['法术', { cat: '法术' }],
  ['法师之手', { cat: '法术' }],
];
for (const [q, o] of tests) {
  const r = doSearch(q, o);
  console.log('=== ', q, JSON.stringify(o), '=>', r.hits.length, '页 ===');
  r.hits.slice(0, 4).forEach(([pi, w, rank]) => console.log('    相关度' + rank, '|', idx.p[pi * 3 + 1], '|', idx.p[pi * 3]));
}
