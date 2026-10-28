// ============================================================
// 超链接索引：锚点可行性实测（run 级样式扫描）
// 目标：判断「每个词条能否在目标页里稳定定位到它的标题位置（插入锚点）」
// 做法：把页面拆成 <p>/<hN> 块 → 块内按标签维护样式栈（bold / font-size / color）
//       得到「文本片段 + 样式」，在块文本里匹配词条名，要求命中的字符处于标题样式 run
// 运行：node 5z_build/调研/_analyze-anchor-runs.mjs
// ============================================================
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const SRC = path.join(ROOT, '5z_src');
const DATA = path.join(ROOT, '5z_web', 'assets', 'card-data');
const GB = new TextDecoder('gb18030');
const readText = (f) => {
  const b = fs.readFileSync(f);
  return /charset\s*=\s*['"]?utf-?8/i.test(b.subarray(0, 2000).toString('latin1')) ? b.toString('utf8') : GB.decode(b);
};
const ENT = /&(?:amp|lt|gt|quot|#39|nbsp|ldquo|rdquo|mdash|ndash|middot|#\d+|#x[0-9a-f]+);/gi;
function decodeEntities(s) {
  return String(s).replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&nbsp;/gi, ' ').replace(/&middot;/gi, '·')
    .replace(/&ldquo;/gi, '“').replace(/&rdquo;/gi, '”').replace(/&mdash;/gi, '—').replace(/&ndash;/gi, '–')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}
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

// ---------- 词条目录 ----------
const J = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f + '.json'), 'utf8'));
const spells = J('spells'), maneuvers = J('maneuvers'), feats = J('feats');
const programs = J('programs'), magicItems = J('magic-items'), monsters = J('monsters');
const classes = J('classes'), races = J('races');
const subclasses = classes.flatMap(c => (c.subclasses || []).map(s => ({ name: s.name, url: s.url })));
const catalog = [
  { key: 'spells', label: '法术', items: spells.map(s => ({ name: s.name, url: s.url })), head: (r) => r.bold && r.red },
  { key: 'maneuvers', label: '战技', items: maneuvers.map(s => ({ name: s.name, url: s.url })), head: (r) => r.bold },
  { key: 'feats', label: '专长', items: feats.map(s => ({ name: s.name, url: s.url })), head: (r) => r.bold && r.brown },
  { key: 'programs', label: '程序', items: programs.map(s => ({ name: s.name, url: s.url })), head: (r) => r.bold && r.red },
  { key: 'magicItems', label: '魔法物品', items: magicItems.map(s => ({ name: s.name, url: s.url })), head: (r) => r.bold && (r.brown || r.size >= 16) }, // 普通物品 14pt 棕色；套装成员 16pt 加粗
  { key: 'monsters', label: '怪物', items: monsters.map(s => ({ name: s.name, url: s.url })), head: (r) => r.bold && r.size >= 18 },
  { key: 'classes', label: '职业', items: classes.map(s => ({ name: s.name, url: s.url })), head: (r) => r.bold },
  { key: 'races', label: '种族', items: races.map(s => ({ name: s.name, url: s.url })), head: (r) => r.bold },
  { key: 'subclasses', label: '子职', items: subclasses.map(s => ({ name: s.name, url: s.url })), head: (r) => r.bold },
];

// ---------- 块内 run 级解析 ----------
function parseBlockRuns(inner) {
  // 返回 { text, runs:[{ch, bold, size, red, brown}] }，按字符对齐（实体展开成单字符）
  const runs = [];
  const stack = [{ bold: false, size: 12, color: '' }];
  const re = /<[^>]*>|[^<]+/g;
  let m;
  while ((m = re.exec(inner)) !== null) {
    const tok = m[0];
    if (tok[0] === '<') {
      const close = /^<\s*\//.test(tok);
      const nameM = /^<\s*\/?\s*([a-zA-Z0-9:]+)/.exec(tok);
      const tag = nameM ? nameM[1].toLowerCase() : '';
      const cur = stack[stack.length - 1];
      if (close) {
        if (['b', 'strong', 'span', 'font'].includes(tag) && stack.length > 1) stack.pop();
        continue;
      }
      const selfClose = /\/>$/.test(tok) || ['br', 'hr', 'img', 'meta', 'link'].includes(tag);
      if (selfClose) {
        // br 视为空白字符（保持块内文字连续但避免粘连）
        if (tag === 'br') runs.push({ ch: '\n', bold: false, size: 12, color: '' });
        continue;
      }
      let bold = cur.bold, size = cur.size, color = cur.color;
      if (tag === 'b' || tag === 'strong') bold = true;
      const styleM = /style\s*=\s*"([^"]*)"/i.exec(tok) || /style\s*=\s*'([^']*)'/i.exec(tok);
      if (styleM) {
        const st = styleM[1];
        if (/font-weight\s*:\s*bold/i.test(st)) bold = true;
        const sm = /font-size\s*:\s*(\d+(?:\.\d+)?)\s*(?:\.0000)?pt/i.exec(st);
        if (sm) size = parseFloat(sm[1]);
        const cm = /color\s*:\s*rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i.exec(st);
        if (cm) color = `${cm[1]},${cm[2]},${cm[3]}`;
      }
      if (['b', 'strong', 'span', 'font'].includes(tag)) stack.push({ bold, size, color });
      continue;
    }
    // 文本：展开实体为单字符
    const chars = [];
    let last = 0;
    tok.replace(ENT, (ent, off) => {
      if (off > last) for (const ch of tok.slice(last, off)) chars.push({ ch, extra: '' });
      const dec = decodeEntities(ent);
      for (const ch of dec) chars.push({ ch, extra: '' });
      last = off + ent.length;
      return ent;
    });
    if (last < tok.length) for (const ch of tok.slice(last)) chars.push({ ch, extra: '' });
    const cur = stack[stack.length - 1];
    for (const c of chars) runs.push({ ch: c.ch, bold: cur.bold, size: cur.size, color: cur.color });
  }
  const text = runs.map(r => r.ch).join('');
  return { text, runs };
}
function parsePage(html) {
  const blocks = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>|<h([1-6])[^>]*>([\s\S]*?)<\/h\2>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const inner = m[1] !== undefined ? m[1] : m[3] || '';
    const { text, runs } = parseBlockRuns(inner);
    if (!text.replace(/\s/g, '')) continue;
    blocks.push({ text, runs, offset: m.index, inner });
  }
  return blocks;
}
const isRed = (c) => c === '128,0,0';
const isBrown = (c) => c === '118,45,0';

// ---------- 逐类别统计锚点定位 ----------
const corpus = new Map();
for (const dir of fs.readdirSync(SRC, { withFileTypes: true })) {
  if (!dir.isDirectory() || /\.files$/i.test(dir.name)) continue;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (!/\.files$/i.test(e.name)) walk(full); continue; }
      if (!/\.html?$/i.test(e.name)) continue;
      const rel = path.relative(SRC, full).split(path.sep).join('/');
      if (!corpus.has(rel)) corpus.set(rel, readText(full));
    }
  })(path.join(SRC, dir.name));
}
const pageBlocks = new Map();
const getBlocks = (rel) => {
  if (!pageBlocks.has(rel)) pageBlocks.set(rel, parsePage(corpus.get(rel) || ''));
  return pageBlocks.get(rel);
};

const rows = [];
const problems = [];
for (const cat of catalog) {
  const byUrl = new Map();
  for (const it of cat.items) { if (!byUrl.has(it.url)) byUrl.set(it.url, []); byUrl.get(it.url).push(it.name); }
  let total = 0, located = 0, locatedAsHeading = 0, dupLocated = 0, pageLevel = 0;
  const miss = [];
  for (const [url, names] of byUrl) {
    const blocks = getBlocks(url);
    // 页面级条目（整页一个词条）→ 不需要锚点，直接算可定位
    if (names.length === 1) { total++; pageLevel++; located++; locatedAsHeading++; continue; }
    for (const n of names) {
      total++;
      const k = canonName(n);
      if (!k) { miss.push(n); continue; }
      let hitHeading = 0, hitAny = 0;
      for (const b of blocks) {
        // 在块文本中找该名（可能被标签拆开：块文本已连续）
        let from = 0;
        while (true) {
          const idx = b.text.indexOf(k, from);
          if (idx < 0) break;
          from = idx + 1;
          hitAny++;
          // 命中字符范围内样式（取首字符的 run）
          const r = b.runs[idx];
          const red = isRed(r.color), brown = isBrown(r.color);
          const st = { bold: b.runs.slice(idx, idx + k.length).every(x => x.bold), size: r.size, red, brown };
          if (cat.head(st)) { hitHeading++; break; }
        }
        if (hitHeading) break;
      }
      if (hitAny) located++;
      if (hitHeading) locatedAsHeading++;
      if (hitHeading > 1) dupLocated++;
      if (!hitHeading && miss.length < 8) miss.push(n);
    }
  }
  rows.push({
    类别: cat.label, 目标页: byUrl.size, 词条: total,
    页面级: pageLevel, 能定位名字: located, 能定位为标题run: locatedAsHeading,
    标题覆盖率: total ? (100 * locatedAsHeading / total).toFixed(1) + '%' : '-',
    标题run重复: dupLocated, 未命中示例: miss.join('、'),
  });
  for (const r of rows) if (r.未命中示例) problems.push(`${r.类别}: ${r.未命中示例}`);
}
console.log('========== 锚点可行性（run 级样式判定） ==========');
console.table(rows);
console.log('\n报告口径：');
console.log('- 「页面级」= 目标页只有 1 个词条（职业/种族/子职），链接到页顶即可，无需锚点；');
console.log('- 「能定位为标题run」= 名字命中处整段字符都是加粗（且符合该类标题的颜色/字号口径），可以在命中处插入空 <a id>；');
console.log('- 标题 run 重复 = 同一页同名标题出现多次（锚点 id 需加序号）。');
if (problems.length) { console.log('\n需要人工兜底的类别/名字：'); problems.forEach(p => console.log('  ! ' + p)); }
