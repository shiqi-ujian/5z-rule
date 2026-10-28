// 试点：把 5z 规则书 Word 导出 HTML → Markdown（wiki 语料）
// 目的：量化「CHM 反编译产物 → wiki 格式」的转换可达质量，不追求一次完美
// 运行：node 5z_build/调研/_pilot-wiki/convert.mjs
import fs from 'node:fs';
import path from 'node:path';
import { readText, scanBlocks, decodeEntities } from '../../lib/html-scan.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SRC = path.join(ROOT, '5z_src');
const OUT = path.join(import.meta.dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  '基础/掷骰.htm',
  '职业/法师/原初魔力.htm',
  '法术/法术详述/3环.htm',
  '装备/魔法物品/武器/武器（近战）.htm',
  '怪物/不死生物/亡灵（CR0-7）.htm',
];

// ---------- 单段/单元格的内联 Markdown 渲染 ----------
const STYLE_RE = /style\s*=\s*["']([^"']*)["']/i;
function inlineStyles(tag) {
  const s = STYLE_RE.exec(tag);
  if (!s) return {};
  const st = s[1];
  return {
    bold: /(?<![-\w])font-weight\s*:\s*(?:bold|[6-9]00)/i.test(st),
    italic: /font-style\s*:\s*italic/i.test(st),
    size: (() => { const m = /font-size\s*:\s*(\d+(?:\.\d+)?)\s*(?:\.0000)?pt/i.exec(st); return m ? parseFloat(m[1]) : null; })(),
  };
}

function renderInline(html, { suppressBold = false, keepLinks = true } = {}) {
  const TAG = /<[^>]*>|[^<]+/g;
  let out = '';
  let bold = 0, italic = 0;
  let href = null;
  let linkStart = -1;
  let m;
  const stack = [];
  while ((m = TAG.exec(html))) {
    const tok = m[0];
    if (tok[0] !== '<') {
      let txt = decodeEntities(tok).replace(/\u00a0/g, ' ');
      if (!txt.trim() && !txt.includes(' ')) continue;
      out += txt;
      continue;
    }
    const close = /^<\s*\//.test(tok);
    const nameM = /^<\s*\/?\s*([a-zA-Z][a-zA-Z0-9:_-]*)/.exec(tok);
    const name = nameM ? nameM[1].toLowerCase() : '';
    if (close) {
      if (name === 'a' && href !== null) {
        if (keepLinks && href && !/^#/.test(href)) {
          const inner = out.slice(linkStart);
          out = out.slice(0, linkStart) + `[${inner}](${href})`;
        }
        href = null; linkStart = -1;
      }
      if (name === 'b' || name === 'strong') { bold = Math.max(0, bold - 1); if (!suppressBold && bold === 0) out += '**'; }
      if (name === 'i' || name === 'em') { italic = Math.max(0, italic - 1); if (italic === 0) out += '*'; }
      if (name === 'p' || name === 'div' || name === 'h1' || name === 'h2' || name === 'h3' || name === 'h4' || name === 'h5' || name === 'h6') out += ' ';
      continue;
    }
    // 注释/条件编译/处理指令：整段跳过（HTML 注释内容不渲染）
    if (/^<!--/.test(tok)) continue;
    if (!name) continue;
    if (name === 'br') { out += '\n'; continue; }
    if (name === 'img') {
      const src = /src\s*=\s*["']([^"']+)["']/i.exec(tok);
      if (src) out += `![](${src[1]})`;
      continue;
    }
    if (name === 'a') {
      const h = /href\s*=\s*["']([^"']*)["']/i.exec(tok);
      if (h) { href = h[1]; linkStart = out.length; }
      continue;
    }
    if (name === 'b' || name === 'strong') { bold++; if (!suppressBold && bold === 1) out += '**'; continue; }
    if (name === 'i' || name === 'em') { italic++; if (italic === 1) out += '*'; continue; }
    // span 等带样式标签：按 style 开关粗体/斜体（用栈保证闭合）
    const st = inlineStyles(tok);
    if (st.bold && !suppressBold) { stack.push('b'); bold++; if (bold === 1) out += '**'; }
    else if (st.italic) { stack.push('i'); italic++; if (italic === 1) out += '*'; }
    else stack.push('');
    if (name === 'a' || name === 'o:p' || name === 'font' || name === 'sup' || name === 'sub' || name === 'span') continue;
  }
  // 兜底：未闭合的粗体
  if (!suppressBold && bold > 0) out += '**';
  if (italic > 0) out += '*';
  return out;
}

// ---------- 标题级别判定（字号 + 加粗 + 颜色；复用 anchorize 的词条样式口径）----------
function styleInfo(inner) {
  const blocks = scanBlocks('<p>' + inner + '</p>');
  const b = blocks[0];
  if (!b) return { size: 12, boldRatio: 0, color: '', text: '' };
  let n = 0, bold = 0, maxSize = 0;
  const colors = new Map();
  for (const c of b.chars) {
    if (!c.ch || /\s/.test(c.ch)) continue;
    n++;
    if (c.bold) bold++;
    if (c.size > maxSize) maxSize = c.size;
    if (c.color) colors.set(c.color, (colors.get(c.color) || 0) + 1);
  }
  const color = [...colors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  return { size: maxSize, boldRatio: n ? bold / n : 0, color, text: b.text };
}

const HEADING_BY_SIZE = [[20, 1], [18, 2], [16, 3], [14, 4]]; // [字号, markdown 级别]
// 词条标题的颜色口径（来自 5z_build/lib/anchorize.mjs 的实测结论）
const ENTRY_STYLE = [
  { color: '128,0,0', level: 3 }, // 法术 / 程序（12pt 加粗深红）
  { color: '118,45,0', level: 3 }, // 专长 / 魔法物品（14pt 加粗棕）
  { color: '128,0,0', minSize: 14, level: 3 },
];
function headingLevel(size, ratio, color, tag) {
  if (tag && /^h[1-6]$/.test(tag)) {
    const n = +tag[1];
    return n <= 2 ? 2 : 3;
  }
  if (ratio < 0.85) return 0;
  // 大字号优先（章节标题 22/20/18pt 多为棕色，不能当词条标题）
  for (const [s, lv] of HEADING_BY_SIZE) if (size >= s) return lv;
  for (const e of ENTRY_STYLE) {
    if (e.color === color && size >= (e.minSize || 0)) return e.level;
  }
  return 0;
}

const escCell = (s) => s.replace(/\|/g, '\\|').replace(/\n+/g, '<br>').trim();

function tableToMarkdown(tableHtml) {
  const hasSpan = /colspan\s*=|rowspan\s*=/i.test(tableHtml);
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(rm =>
    [...rm[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => escCell(renderInline(c[1])))
  ).filter(r => r.length);
  if (!rows.length) return { md: '', kind: 'empty' };
  const rowBold = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(rm =>
    /font-weight\s*:\s*bold|<b>/i.test(rm[1])
  );
  const headerBold = rowBold[0] && rows[0].every(c => c.length > 0);
  if (hasSpan || !headerBold || !rows[0].length) {
    // 结构复杂/无表头：保留为 HTML 表（Markdown / MediaWiki 都能渲染）
    const html = rows.map(r => '<tr>' + r.map(c => `<td>${c.replace(/<br>/g, ' ')}</td>`).join('') + '</tr>').join('');
    return { md: `<table>${html}</table>`, kind: 'html' };
  }
  const head = rows[0];
  const body = rows.slice(1);
  const lines = [];
  lines.push('| ' + head.join(' | ') + ' |');
  lines.push('| ' + head.map(() => '---').join(' | ') + ' |');
  for (const r of body) {
    while (r.length < head.length) r.push('');
    lines.push('| ' + r.slice(0, head.length).join(' | ') + ' |');
  }
  return { md: lines.join('\n'), kind: 'gfm' };
}

// ---------- 主转换 ----------
const BLOCK_RE = /<table\b[^>]*>[\s\S]*?<\/table>|<p\b([^>]*)>([\s\S]*?)<\/p>|<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\3>/gi;

function convertPage(rel) {
  const file = path.join(SRC, rel);
  const html = readText(file);
  const bodyStart = html.search(/<body\b/i);
  const bodyEnd = html.search(/<\/body>/i);
  const body = html.slice(bodyStart >= 0 ? bodyStart : 0, bodyEnd >= 0 ? bodyEnd : html.length);

  const stats = { tables: 0, gfm: 0, htmlTables: 0, headings: {}, lists: 0, paras: 0, images: 0, srcChars: 0, mdChars: 0 };
  const chunks = [];
  let title = '';
  let lastTitle = '';
  BLOCK_RE.lastIndex = 0;
  let m;
  while ((m = BLOCK_RE.exec(body))) {
    if (/^<table/i.test(m[0])) {
      stats.tables++;
      const t = tableToMarkdown(m[0]);
      if (t.kind === 'html') stats.htmlTables++;
      else if (t.kind === 'gfm') stats.gfm++;
      if (t.md) chunks.push(t.md);
      continue;
    }
    const isP = m[1] !== undefined;
    const attrs = isP ? m[1] : m[4];
    const inner = isP ? m[2] : m[5];
    const tag = isP ? 'p' : 'h' + m[3];
    stats.paras++;
    // 列表检测：Word 的 mso-list 或手打编号
    const textProbe = renderInline(inner, { suppressBold: true }).trim();
    if (!textProbe) continue;
    const isList = /mso-list/i.test(attrs) || /^\s*(?:\d+[、.．]|[（(]\d+[）)]|[•·▪])/.test(textProbe);
    const info = styleInfo(inner);
    let lv = headingLevel(info.size, info.boldRatio, info.color, tag === 'p' ? '' : tag);
    // Word 里 h4 也被拿来当正文段（实测：武器页把物品描述写成 h4）→ 长句/句末标点的 h 降级为段落
    if (lv && tag !== 'p' && (textProbe.length > 50 || /[。：；]$/.test(textProbe))) lv = 0;
    if (lv) {
      const txt = renderInline(inner, { suppressBold: true }).replace(/\s+/g, ' ').trim();
      if (!txt) continue;
      stats.headings[lv] = (stats.headings[lv] || 0) + 1;
      if (!title) title = txt;
      lastTitle = txt;
      chunks.push('#'.repeat(lv) + ' ' + txt);
    } else if (isList) {
      stats.lists++;
      let item = textProbe.replace(/^\s*(?:\d+[、.．]|[（(]\d+[）)]|[•·▪])\s*/, '');
      chunks.push('- ' + item);
    } else {
      const md = renderInline(inner);
      if (md) chunks.push(md);
    }
  }

  // 统计文本量（去 Markdown 标记后的纯文本）
  const cleaned = chunks
    .map(c => c
      .split('\n').map(line => line.replace(/^[ \t\u3000]+/, '').replace(/[ \t]+$/, '')).join('\n') // Word 首行缩进 → Markdown 代码块，必须剥
      .replace(/\*{4,}/g, '')      // 空 bold run 产生的 ****
      .replace(/\*{3}/g, '**'))    // 三连星兜底
    .filter(c => c.trim());
  const mdBody = cleaned.join('\n\n').replace(/\n{3,}/g, '\n\n');
  const plain = mdBody
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[|*#>`-]/g, '')
    .replace(/\s+/g, '');
  const srcPlain = html
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<xml\b[^>]*>[\s\S]*?<\/xml>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\s+/g, '');
  stats.srcChars = srcPlain.length;
  stats.mdChars = plain.length;
  stats.images = (html.match(/<img\b/gi) || []).length;

  const fm = `---\ntitle: ${JSON.stringify(title || rel)}\nsource: 5z_src/${rel}\nbook: 5z 规则 1.63 版\n---\n`;
  const outFile = rel.replace(/\.htm$/i, '.md');
  const outPath = path.join(OUT, outFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, fm + '\n' + mdBody + '\n');
  return { rel, outFile, stats, title };
}

const report = [];
for (const rel of PAGES) {
  const r = convertPage(rel);
  report.push(r);
  const s = r.stats;
  const ratio = (s.mdChars / s.srcChars * 100).toFixed(1);
  console.log(`${rel}`);
  console.log(`  → ${r.outFile}  title=${r.title}`);
  console.log(`  文本保留 ${s.mdChars}/${s.srcChars} = ${ratio}%  | 表格 ${s.tables}（GFM ${s.gfm} / HTML ${s.htmlTables}）| 标题 ${JSON.stringify(s.headings)} | 列表项 ${s.lists} | 图 ${s.images}`);
}

// 交叉核对：与 card-data 已知词条数比对
function loadJson(f) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/card-data', f), 'utf8')); } catch { return []; } }
const spells = loadJson('spells.json');
const items = loadJson('magic-items.json');
const monsters = loadJson('monsters.json');
const expect = {
  '法术/法术详述/3环.htm': spells.filter(x => x.url === '法术/法术详述/3环.htm').length,
  '装备/魔法物品/武器/武器（近战）.htm': items.filter(x => x.url === '装备/魔法物品/武器/武器（近战）.htm').length,
  '怪物/不死生物/亡灵（CR0-7）.htm': monsters.filter(x => x.url === '怪物/不死生物/亡灵（CR0-7）.htm').length,
};
console.log('\n===== 与 card-data 词条数对照（期望恢复的「条目标题」数）=====');
for (const r of report) {
  if (expect[r.rel] !== undefined) {
    const got = Object.values(r.stats.headings).reduce((a, b) => a + b, 0);
    console.log(`${r.rel}: card-data ${expect[r.rel]} 词条 / 本转换识别标题 ${got} 个`);
  }
}
fs.writeFileSync(path.join(OUT, '_report.json'), JSON.stringify(report, null, 2));
