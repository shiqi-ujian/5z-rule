// ============================================================
// 关键词自动互链（「超链接索引」P1）
// 输入：card-data（含 anchor 字段）+ keyword-config.json
// 输出：把页面里的规则关键词（法术/战技/专长/程序 …）包成
//       <a class="wz-kw" href="目标页#锚点" title="类别 · 上下文">关键词</a>
// 规则：最长匹配优先；每页每个词条只链首次；≥3 字；跳过标题锚点区/已有链接/排除页。
// ============================================================
import { canonName, scanBlocks, applyEdits, relHref, escAttr } from './html-scan.mjs';
import { CATEGORY_STYLE, locateAnchors } from './anchorize.mjs';

export const DEFAULT_CONFIG = {
  categories: { spells: true, maneuvers: true, programs: true, feats: true, magicItems: false, monsters: false },
  minLen: 3,
  maxLen: 16,
  firstPerPage: true,
  excludePages: [
    '基础/版本更新.htm',
    '基础/设计师访谈.htm',
    '基础/5z说明.htm',
    '法术/召唤物.htm',
    '辅助计算器.htm',
    '$$unsavedpage1.htm',
    '$$unsavedpage2.htm',
  ],
  excludePagePrefixes: ['私货，未通过的/'],
  excludeCategories: ['种族专长'],
  excludeNames: [],
  twoCharWhitelist: [], // 预留：2 字名人工白名单（当前 minLen=3，不生效）
};

const SPELL_LV = { 0: '戏法', 10: '传奇' };
function titleFor(catKey, e) {
  switch (catKey) {
    case 'spells': {
      const lv = SPELL_LV[e.level] || (e.level != null ? e.level + '环' : '');
      return ['法术', lv, e.school].filter(Boolean).join(' · ');
    }
    case 'maneuvers':
      return ['战技', e.style, e.type].filter(Boolean).join(' · ');
    case 'programs':
      return ['程序', e.protocol ? e.protocol + '协议' : ''].filter(Boolean).join(' · ');
    case 'feats':
      return ['专长', e.category].filter(Boolean).join(' · ');
    case 'magicItems':
      return ['魔法物品', e.sub].filter(Boolean).join(' · ');
    case 'monsters':
      return ['怪物', e.cr ? 'CR' + e.cr : ''].filter(Boolean).join(' · ');
    default:
      return CATEGORY_STYLE[catKey]?.label || '';
  }
}

// ---------- Aho-Corasick（最长匹配） ----------
function buildAC(words) {
  const nodes = [{ next: new Map(), fail: 0, out: [] }];
  for (const w of words) {
    let cur = 0;
    for (const ch of w) {
      let nxt = nodes[cur].next.get(ch);
      if (nxt === undefined) {
        nxt = nodes.length;
        nodes.push({ next: new Map(), fail: 0, out: [] });
        nodes[cur].next.set(ch, nxt);
      }
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
      nodes[nxt].fail = nodes[f].next.get(ch) || 0;
      nodes[nxt].out = nodes[nxt].out.concat(nodes[nodes[nxt].fail].out);
      q.push(nxt);
    }
  }
  return nodes;
}

/** 构建词条注册表：canon 名 → 最高优先级的词条 */
export function buildRegistry(cardData, config = DEFAULT_CONFIG) {
  const byCanon = new Map();
  for (const [catKey, enabled] of Object.entries(config.categories)) {
    if (!enabled) continue;
    const list = cardData[catKey] || [];
    for (const e of list) {
      if (config.excludeCategories.includes(e.category)) continue;
      const canon = canonName(e.name);
      if (!canon) continue;
      const len = [...canon].length;
      const allowedShort = config.twoCharWhitelist.includes(canon);
      if (len > config.maxLen) continue;
      if (len < config.minLen && !allowedShort) continue;
      if (len === 1) continue;
      if (/[\r\n]/.test(canon)) continue;
      if (!/[\u4e00-\u9fff]/.test(canon)) continue; // 纯英文名不参与中文正文匹配
      if (config.excludeNames.includes(canon)) continue;
      const item = {
        canon,
        catKey,
        catLabel: CATEGORY_STYLE[catKey]?.label || catKey,
        url: e.url,
        anchor: e.anchor || '',
        title: titleFor(catKey, e),
      };
      const prev = byCanon.get(canon);
      if (!prev || (CATEGORY_STYLE[catKey]?.priority || 0) > (CATEGORY_STYLE[prev.catKey]?.priority || 0)) {
        byCanon.set(canon, item);
      }
    }
  }
  return [...byCanon.values()];
}

/** 创建「页面 → 锚点注入 + 关键词插链」转换器 */
export function createContentTransformer({ cardData, config = DEFAULT_CONFIG, log = console.log }) {
  const registry = buildRegistry(cardData, config);
  const registryMap = new Map(registry.map(r => [r.canon, r]));
  const ac = buildAC(registry.map(r => r.canon));
  const enc = (s) => encodeURIComponent(s);
  const excludePages = new Set(config.excludePages);
  const excludePrefixes = config.excludePagePrefixes;

  // 目标页 → 需要注入锚点的词条（按类别分组，便于按类别样式定位）
  // 注意：锚点注入与「关键词开关」解耦——即使某类别不做自动互链（如魔法物品/怪物），
  // 词典的「规则书原文」链接也会用到它的锚点，所以所有有 anchor 的类别都要注入。
  const anchorsByPage = new Map();
  for (const catKey of Object.keys(CATEGORY_STYLE)) {
    const list = cardData[catKey];
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      if (!e.anchor || !e.url) continue;
      if (config.excludeCategories.includes(e.category)) continue;
      if (!anchorsByPage.has(e.url)) anchorsByPage.set(e.url, []);
      anchorsByPage.get(e.url).push({ name: e.name, anchor: e.anchor, catKey });
    }
  }

  const stats = { pages: 0, pagesWithLinks: 0, links: 0, anchors: 0, byCat: {}, entries: {}, htmlBytes: 0, pageLinks: new Map() };
  for (const r of registry) stats.entries[r.catKey] = (stats.entries[r.catKey] || 0) + 1;

  function isExcluded(pageUrl) {
    if (excludePages.has(pageUrl)) return true;
    return excludePrefixes.some(p => pageUrl.startsWith(p));
  }

  /** 在页面里找到关键词匹配（块内最长匹配、不重叠） */
  function matchesOf(text) {
    const raw = [];
    let cur = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      while (cur && !ac[cur].next.has(ch)) cur = ac[cur].fail;
      cur = ac[cur].next.get(ch) || 0;
      for (const w of ac[cur].out) raw.push([i - w.length + 1, i + 1, w]);
    }
    raw.sort((a, b) => a[0] - b[0] || (b[1] - b[0]) - (a[1] - a[0]));
    const out = [];
    let lastEnd = -1;
    for (const m of raw) {
      if (m[0] < lastEnd) continue;
      out.push(m);
      lastEnd = m[1];
    }
    return out;
  }

  /**
   * 处理一页正文：
   * ① 给本页词条标题注入 <a id="kw-..."></a>
   * ② 给正文里的关键词插链
   * @returns {{html:string, stats:{links:number,byCat:Object}}}
   */
  function transform(html, pageUrl) {
    const pageStats = { links: 0, anchors: 0, byCat: {} };
    // 排除页照样注入锚点（词典原文链接要用），只是不做关键词插链
    const excluded = isExcluded(pageUrl);
    let blocks;
    try {
      blocks = scanBlocks(html);
    } catch (e) {
      log(`[linkify] 扫描失败 ${pageUrl}: ${e.message}`);
      return { html, stats: pageStats };
    }
    const edits = [];
    const skipByBlock = new Map(); // blockIndex -> [{start,end}]
    const addSkip = (bi, start, end) => {
      if (!skipByBlock.has(bi)) skipByBlock.set(bi, []);
      skipByBlock.get(bi).push({ start, end });
    };
    // ① 锚点注入（本页词条）：按类别分组定位，锚点 id 用 card-data 里已算好的
    const pageAnchors = anchorsByPage.get(pageUrl) || [];
    if (pageAnchors.length) {
      const byCat = new Map();
      for (const a of pageAnchors) {
        if (!byCat.has(a.catKey)) byCat.set(a.catKey, []);
        byCat.get(a.catKey).push(a);
      }
      for (const [catKey, list] of byCat) {
        const { found } = locateAnchors(html, list.map(a => a.name), catKey, blocks);
        const usedIds = new Set();
        for (let i = 0; i < list.length; i++) {
          const hit = found[i];
          if (!hit) continue;
          const c = blocks[hit.blockIndex]?.chars?.[hit.charStart];
          if (!c) continue;
          let anchor = list[i].anchor;
          // 极端情况下同名重复：以卡数据里的 id 为准；若同页重复则顺延（保证唯一）
          if (usedIds.has(anchor)) anchor = `${anchor}-${usedIds.size + 1}`;
          usedIds.add(anchor);
          edits.push({ at: c.rawStart, order: 5, text: `<a id="${escAttr(anchor)}"></a>` });
          addSkip(hit.blockIndex, hit.charStart, hit.charEnd);
          pageStats.anchors++;
          stats.anchors++;
        }
      }
    }
    // ② 关键词插链（排除页跳过）
    const usedNames = new Set();
    if (!excluded) for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi];
      if (!block.text) continue;
      const matches = matchesOf(block.text);
      if (!matches.length) continue;
      const skips = skipByBlock.get(bi) || [];
      for (const [start, end, name] of matches) {
        if (config.firstPerPage && usedNames.has(name)) continue;
        if (skips.some(r => start < r.end && end > r.start)) continue;
        if (block.chars[start]?.inLink) continue;
        let inLink = false;
        for (let i = start; i < end; i++) if (block.chars[i]?.inLink) { inLink = true; break; }
        if (inLink) continue;
        const item = registryMap.get(name);
        if (!item || !item.url) continue;
        const href = item.url === pageUrl
          ? (item.anchor ? '#' + enc(item.anchor) : '')
          : relHref(pageUrl, item.url) + (item.anchor ? '#' + enc(item.anchor) : '');
        if (!href) continue;
        const title = item.title ? ` title="${escAttr(item.title)}"` : '';
        edits.push({ at: block.chars[start].rawStart, order: 0, text: `<a class="wz-kw" href="${escAttr(href)}"${title}>` });
        edits.push({ at: block.chars[end - 1].rawEnd, order: 1, text: '</a>' });
        usedNames.add(name);
        pageStats.links++;
        pageStats.byCat[item.catKey] = (pageStats.byCat[item.catKey] || 0) + 1;
        stats.links++;
        stats.byCat[item.catKey] = (stats.byCat[item.catKey] || 0) + 1;
      }
    }
    stats.pages++;
    if (pageStats.links) {
      stats.pagesWithLinks++;
      stats.pageLinks.set(pageUrl, pageStats.links);
    }
    if (!edits.length) return { html, stats: pageStats };
    // 插入后体积增量（用于构建日志）
    for (const e of edits) stats.htmlBytes += Buffer.byteLength(e.text, 'utf8');
    return { html: applyEdits(html, edits), stats: pageStats };
  }

  return { transform, registry, stats };
}
