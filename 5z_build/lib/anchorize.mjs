// ============================================================
// 锚点定位：在 Word 导出页面里找到每个词条标题的位置，并生成页内锚点 id
// 用于 ① parse-card-data 写 anchor 字段 ② build.mjs 注入 <a id="kw-..."> 与后续插链
// ============================================================
import { canonName, scanBlocks } from './html-scan.mjs';

// 各类别的标题样式口径（run 级）：由 2026-10-24 实测得出
export const CATEGORY_STYLE = {
  spells: { label: '法术', priority: 100, heading: (c) => c.bold && c.color === '128,0,0' },
  maneuvers: { label: '战技', priority: 90, heading: (c) => c.bold },
  programs: { label: '程序', priority: 80, heading: (c) => c.bold && c.color === '128,0,0' },
  feats: { label: '专长', priority: 70, heading: (c) => c.bold && c.color === '118,45,0' },
  magicItems: { label: '魔法物品', priority: 60, heading: (c) => c.bold && (c.color === '118,45,0' || c.size >= 16) },
  monsters: { label: '怪物', priority: 50, heading: (c) => c.bold && c.size >= 18 },
  classes: { label: '职业', priority: 40, pageLevel: true },
  races: { label: '种族', priority: 40, pageLevel: true },
  subclasses: { label: '子职', priority: 40, pageLevel: true },
};

/** 锚点 id：kw-<中文名>，非法字符替换为 -；同页重复加 -2/-3 */
export function makeAnchorId(canon, used) {
  let base = 'kw-' + canon.replace(/[^\p{L}\p{N}_·-]/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!base || base === 'kw-') base = 'kw-entry';
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

/**
 * 在一页里定位一组词条的标题位置。
 * @param {string} html 页面 HTML（未提供 preBlocks 时用于扫描）
 * @param {string[]} names 词条名（与调用方 entries 顺序一致；内部用 canonName 归一匹配）
 * @param {keyof CATEGORY_STYLE} catKey
 * @param {object[]} [preBlocks] 已扫描好的 blocks（同一页多次定位时复用，省一次扫描）
 * @returns {{ found: Array<null|{blockIndex:number,charStart:number,charEnd:number}>, blocks: object[], missing: number[] }}
 */
export function locateAnchors(html, names, catKey, preBlocks) {
  const style = CATEGORY_STYLE[catKey];
  const blocks = preBlocks || scanBlocks(html);
  // 每个名字的候选出现位置（文档顺序）：[{blockIndex, charStart, charEnd, name}]
  const uniqueNames = [...new Set(names.map(n => canonName(n)).filter(Boolean))];
  const occurrences = new Map(uniqueNames.map(n => [n, []]));
  for (let bi = 0; bi < blocks.length; bi++) {
    const text = blocks[bi].text;
    if (!text) continue;
    for (const name of uniqueNames) {
      const arr = occurrences.get(name);
      let from = 0;
      while (true) {
        const idx = text.indexOf(name, from);
        if (idx < 0) break;
        arr.push({ blockIndex: bi, charStart: idx, charEnd: idx + name.length });
        from = idx + 1;
      }
    }
  }
  // 是否整段命中都处于标题样式（加粗 + 颜色/字号口径）
  const isHeadingRange = (block, start, end) => {
    const chars = block.chars;
    for (let i = start; i < end; i++) {
      const c = chars[i];
      if (!c || c.inLink) return false;
      if (!style.heading(c)) return false;
    }
    return true;
  };
  const found = new Array(names.length).fill(null);
  const missing = [];
  for (let ei = 0; ei < names.length; ei++) {
    const canon = canonName(names[ei]);
    if (!canon) { missing.push(ei); continue; }
    const list = occurrences.get(canon) || [];
    let hit = null;
    for (const occ of list) {
      if (occ._claimed) continue;
      const block = blocks[occ.blockIndex];
      if (!isHeadingRange(block, occ.charStart, occ.charEnd)) continue;
      hit = occ;
      break;
    }
    if (!hit) { missing.push(ei); continue; }
    hit._claimed = true;
    found[ei] = { blockIndex: hit.blockIndex, charStart: hit.charStart, charEnd: hit.charEnd };
  }
  return { found, blocks, missing };
}

/** 把锚点结果转成 build 用的编辑列表：[{at, order, text}] */
export function anchorEdits(blocks, found) {
  const edits = [];
  for (const hit of found) {
    if (!hit || !hit.anchor) continue;
    const c = blocks[hit.blockIndex].chars[hit.charStart];
    edits.push({ at: c.rawStart, order: 5, text: `<a id="${hit.anchor}"></a>` });
  }
  return edits;
}
