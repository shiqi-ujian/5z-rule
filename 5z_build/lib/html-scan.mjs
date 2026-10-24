// ============================================================
// 共享 HTML 扫描工具（Word 导出 HTML 专用）
// 用途：把页面拆成块（<p>/<hN>），并为每个字符记录「样式 + 原文偏移」，
//       供 ① 标题/锚点定位（parse-card-data + build）② 关键词插链（build linkify）使用。
// 背景：规则书正文是 Word 导出，没有语义标题/锚点；标题只体现为「段落 + 文字样式」，
//       且行内标签会把词拆开，所以必须做 run 级（逐字符）样式追踪。
// ============================================================

const ENT_RE = /&(?:amp|lt|gt|quot|#39|nbsp|ldquo|rdquo|mdash|ndash|middot|hellip|#\d+|#x[0-9a-f]+);/gi;
import fs from 'node:fs';
export function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&nbsp;/gi, ' ')
    .replace(/&middot;/gi, '·').replace(/&ldquo;/gi, '“').replace(/&rdquo;/gi, '”')
    .replace(/&mdash;/gi, '—').replace(/&ndash;/gi, '–').replace(/&hellip;/gi, '…')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

const GB18030 = new TextDecoder('gb18030');
export function readText(file) {
  const buf = fs.readFileSync(file);
  const head = buf.subarray(0, 2000).toString('latin1');
  return /charset\s*=\s*["']?utf-?8/i.test(head) ? buf.toString('utf8') : GB18030.decode(buf);
}

// 词条名的「可匹配形式」：去掉尾部英文别名 / 标点（Word 标题常是「火球术Fireball」）
export function canonName(name) {
  let s = String(name).split('\n')[0].trim();
  let prev;
  do {
    prev = s;
    s = s.replace(/[\s，。、；：！？·—\-_'"“”‘’（）()《》【】\[\]\/／|]+$/, '');
    s = s.replace(/\s*[A-Za-z][A-Za-z0-9\s'’.\-：:，,！!\/／]*$/, '').trim();
  } while (s !== prev);
  return s || String(name).trim();
}

const VOID_TAGS = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr', 'o:p']);
const PROTECTED_RE = /<(script|style|head|xml)\b[^>]*>[\s\S]*?<\/\1>/gi;
const BLOCK_RE = /<p\b([^>]*)>([\s\S]*?)<\/p>|<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\3>/gi;
const TAG_RE = /<[^>]*>|[^<]+/g;

function styleFromTag(tag, attrs, parent) {
  let bold = parent.bold, size = parent.size, color = parent.color;
  if (tag === 'b' || tag === 'strong') bold = true;
  const sm = /style\s*=\s*"([^"]*)"/i.exec(attrs) || /style\s*=\s*'([^']*)'/i.exec(attrs);
  if (sm) {
    const st = sm[1];
    if (/(?<![-\w])font-weight\s*:\s*(?:bold|[6-9]00)/i.test(st)) bold = true;
    const fm = /font-size\s*:\s*(\d+(?:\.\d+)?)\s*(?:\.0000)?pt/i.exec(st);
    if (fm) size = parseFloat(fm[1]);
    const cm = /color\s*:\s*rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i.exec(st);
    if (cm) color = `${cm[1]},${cm[2]},${cm[3]}`;
  }
  return { tag, bold, size, color };
}

// 文本 token → 逐字符数组（带原文偏移；实体展开为单字符并复用整段实体的偏移）
function charsOfToken(tok, rawBase) {
  const out = [];
  let i = 0;
  while (i < tok.length) {
    if (tok[i] === '&') {
      ENT_RE.lastIndex = i;
      const m = ENT_RE.exec(tok);
      if (m && m.index === i) {
        const dec = decodeEntities(m[0]);
        for (const ch of dec) out.push({ ch, rawStart: rawBase + i, rawEnd: rawBase + i + m[0].length });
        i += m[0].length;
        continue;
      }
    }
    const cp = tok.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    out.push({ ch, rawStart: rawBase + i, rawEnd: rawBase + i + ch.length });
    i += ch.length;
  }
  return out;
}

/**
 * 扫描页面里的块（p / h1-h6），返回：
 * [{ tag, openStart, innerStart, innerEnd, closeEnd, chars: [{ch,bold,size,color,inLink,rawStart,rawEnd}] }]
 * - rawStart/rawEnd 是「原 HTML 字符串」中的偏移（用于插锚点/插链接）
 * - inLink = 该字符是否位于已有 <a> 内（避免嵌套链接）
 * - script/style/head/xml 区域内的块会被跳过
 */
export function scanBlocks(html) {
  // 受保护区（script/style/head/xml）：块与之相交则跳过
  const protectedRanges = [];
  PROTECTED_RE.lastIndex = 0;
  let pm;
  while ((pm = PROTECTED_RE.exec(html)) !== null) protectedRanges.push([pm.index, pm.index + pm[0].length]);
  const inProtected = (s, e) => protectedRanges.some(([a, b]) => s < b && e > a);

  const blocks = [];
  BLOCK_RE.lastIndex = 0;
  let m;
  while ((m = BLOCK_RE.exec(html)) !== null) {
    const isP = m[1] !== undefined;
    const inner = isP ? m[2] : m[5] || '';
    const openTagEnd = m[0].indexOf('>');
    const innerStart = m.index + openTagEnd + 1;
    const innerEnd = innerStart + inner.length;
    const blockEnd = m.index + m[0].length;
    if (inProtected(m.index, blockEnd)) continue;
    const tag = isP ? 'p' : 'h' + m[3];
    const chars = [];
    const stack = [{ tag: 'root', bold: false, size: 12, color: '' }];
    let linkDepth = 0;
    TAG_RE.lastIndex = 0;
    let t;
    while ((t = TAG_RE.exec(inner)) !== null) {
      const tok = t[0];
      if (tok[0] === '<') {
        const close = /^<\s*\//.test(tok);
        const nameM = /^<\s*\/?\s*([a-zA-Z][a-zA-Z0-9:_-]*)/.exec(tok);
        const tagName = nameM ? nameM[1].toLowerCase() : '';
        if (close) {
          // 找到同名帧并弹出（容忍 Word 的不规范嵌套）
          for (let k = stack.length - 1; k > 0; k--) {
            if (stack[k].tag === tagName) {
              if (tagName === 'a') linkDepth = Math.max(0, linkDepth - 1);
              stack.length = k;
              break;
            }
          }
          continue;
        }
        if (VOID_TAGS.has(tagName) || /\/\s*>$/.test(tok)) {
          if (tagName === 'br') chars.push({ ch: '\n', bold: false, size: 12, color: '', inLink: linkDepth > 0, rawStart: innerStart + t.index, rawEnd: innerStart + t.index + tok.length });
          continue;
        }
        const frame = styleFromTag(tagName, tok, stack[stack.length - 1]);
        stack.push(frame);
        if (tagName === 'a') linkDepth++;
        continue;
      }
      const rawBase = innerStart + t.index;
      const base = stack[stack.length - 1];
      for (const c of charsOfToken(tok, rawBase)) {
        chars.push({ ch: c.ch, bold: base.bold, size: base.size, color: base.color, inLink: linkDepth > 0, rawStart: c.rawStart, rawEnd: c.rawEnd });
      }
    }
    let text = '';
    for (const c of chars) text += c.ch;
    blocks.push({ tag, openStart: m.index, innerStart, innerEnd, closeEnd: blockEnd, chars, text });
  }
  return blocks;
}

/** 按原文偏移收集插入编辑 [{at, order, text}]，order 小者先插（同一位置：闭合标签先于开启标签） */
export function applyEdits(html, edits) {
  if (!edits.length) return html;
  const byPos = new Map();
  for (const e of edits) {
    if (!byPos.has(e.at)) byPos.set(e.at, []);
    byPos.get(e.at).push(e);
  }
  const positions = [...byPos.keys()].sort((a, b) => b - a);
  let out = html;
  for (const at of positions) {
    const list = byPos.get(at).sort((a, b) => (a.order || 0) - (b.order || 0));
    out = out.slice(0, at) + list.map(e => e.text).join('') + out.slice(at);
  }
  return out;
}

export const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 两个站点页面路径之间的相对链接（fromFile 末段视为文件名） */
export function relHref(fromFile, toFile) {
  const from = fromFile.split('/').filter(Boolean).slice(0, -1);
  const to = toFile.split('/').filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return '../'.repeat(from.length - i) + to.slice(i).join('/');
}
