// ============================================================
// 5z 车卡数据解析器：从 5z_src/（CHM 反编译产物）提取角色创建数据
// 输出: 5z_web/assets/card-data/{rules,races,classes,feats,spells,class-spells,maneuvers,programs,magic-items,monsters}.json
// 由 build.mjs 在构建流程末尾调用；也可独立运行：
//   node 5z_build/parse-card-data.mjs [输出目录，默认 5z_web]
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { canonName } from './lib/html-scan.mjs';
import { locateAnchors, makeAnchorId } from './lib/anchorize.mjs';

const SRC = path.resolve('5z_src');
const OUT = path.resolve(process.argv[2] || '5z_web');

// ---------- 通用工具（与 build.mjs 一致） ----------
const GB18030 = new TextDecoder('gb18030');
function readText(file) {
  const buf = fs.readFileSync(file);
  const head = buf.subarray(0, 2000).toString('latin1');
  return /charset\s*=\s*["']?utf-?8/i.test(head) ? buf.toString('utf8') : GB18030.decode(buf);
}
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/gi, ' ').replace(/&#183;/g, '·').replace(/&middot;/g, '·')
    .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}
function cleanText(html) {
  return decodeEntities(html)
    .replace(/<o:p>\s*<\/o:p>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/tr>|<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}
const relUrl = (p) => path.relative(SRC, p).split(path.sep).join('/');

// 反复剥离不含文本的包裹标签（Word 导出的空 <b>/<span>/<o:p> 残留，
// 尤其「color:rgb(128,0,0) + font-weight:bold」的空标记会污染段落样式判定）
function stripEmptyTags(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(/<(b|span|font|i|em|strong|u|o:p|p)[^>]*>((?:&nbsp;|\s)*)<\/\1>/gi, '$2');
  } while (s !== prev);
  return s;
}

// ---------- 1. 把页面解析为"段落流" ----------
// 返回 [{ type: 'h1'|'h2'|'h3'|'p'|'table', text, rows?, size }]
// 纯样式判定（Word/WPS 导出页面混用 <h4> 标签与 <p>+bold，标签名不可靠）：
//   h1 = 16pt+ 加粗（章节标题）; h2 = 14pt 棕色(118,45,0) 加粗（条目名: 专长/职业特性/小节标题）
//   h3 = 其它加粗（子条目名: 防具：/武器：/种族特性名）; p = 普通正文
function parsePage(html) {
  // 剥离导航/脚本/样式
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<div class="wz-nav"[\s\S]*?<\/div>/gi, ' ');
  const out = [];
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>|<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>|<table[\s\S]*?<\/table>/gi;
  let m;
  while ((m = pRe.exec(html)) !== null) {
    const tag = m[0];
    if (/^<table/i.test(tag)) {
      out.push({ type: 'table', rows: parseTable(tag) });
      continue;
    }
    const inner = m[1] || m[2] || '';
    // 样式判定用剥离空标签后的副本（空加粗/红色残留不得影响类型判定）；文本仍取原文
    const styleSrc = stripEmptyTags(inner);
    // 判断字号/加粗/颜色
    let size = 12;
    const sm = /font-size:(\d+(?:\.\d+)?)\.0000pt/i.exec(styleSrc);
    if (sm) size = parseFloat(sm[1]);
    const bold = /font-weight:\s*bold/i.test(styleSrc);
    const color118 = /color:rgb\(118,45,0\)/i.test(styleSrc);
    const red = /color:rgb\(128,0,0\)/i.test(styleSrc);
    const text = cleanText(inner);
    if (!text) continue;
    let type = 'p';
    if (size >= 16 && bold) type = 'h1';
    else if (size >= 14 && bold && color118) type = 'h2';
    else if (bold) type = 'h3';
    out.push({ type, text, size, red });
  }
  return out;
}
function parseTable(html) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(html)) !== null) {
    const cells = [];
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let td;
    while ((td = tdRe.exec(tr[1])) !== null) {
      cells.push(cleanText(td[1]));
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

// ---------- 2. 种族 ----------
function parseRaces() {
  const races = [];
  const dir = path.join(SRC, '种族');
  if (!fs.existsSync(dir)) return races;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.htm$/i.test(e.name) && !/\.files$/i.test(d)) {
        const name = e.name.replace(/\.htm$/i, '');
        if (/说明|定制血统|混血儿|模板/.test(name)) continue;
        const flow = parsePage(readText(full));
        let title = (flow.find(x => x.type === 'h1') || {}).text || name;
        // 标题清理：只取第一行（狐妖类页面 h1 混入了整段介绍），并去掉行尾英文名
        title = title.split('\n')[0].replace(/\s*[A-Za-z][A-Za-z\s]*$/, '').trim() || name;
        // 特质段起点：找"XX特质"标题（如"人类特质"），找不到则从第一个标题之后开始
        let start = 0;
        const traitH = flow.findIndex(x => (x.type === 'h1' || x.type === 'h2') && /特质/.test(x.text));
        if (traitH >= 0) start = traitH + 1;
        else {
          const nameH = flow.findIndex(x => x.type === 'h1' || x.type === 'h2');
          start = nameH >= 0 ? nameH + 1 : 0;
        }
        const traits = [];
        let cur = null;
        const raceFeats = [];
        let inRaceFeats = false;
        for (let i = start; i < flow.length; i++) {
          const x = flow[i];
          if (!inRaceFeats && x.type === 'h1' && !/特质/.test(x.text) && !/种族专长/.test(x.text)) {
            break; // 进入其它章节
          }
          if (/种族专长/.test(x.text)) { inRaceFeats = true; continue; }
          if (inRaceFeats) {
            if ((x.type === 'h2' || x.type === 'h3') && !/^\/\//.test(x.text)) {
              raceFeats.push({ name: x.text.replace(/[。．\s]+$/, ''), text: '' });
            } else if (x.type === 'p' && raceFeats.length) {
              raceFeats[raceFeats.length - 1].text +=
                (raceFeats[raceFeats.length - 1].text ? '\n' : '') + x.text;
            }
            continue;
          }
          if (x.type === 'h3') {
            // 整段加粗时（如"语言。你能够说、读、写通用语和矮人语。"），拆分为 特性名 + 描述
            let name = x.text.replace(/[。．\s]+$/, '');
            let lead = '';
            const dot = name.indexOf('。');
            if (dot > 0) {
              lead = name.slice(dot + 1);
              name = name.slice(0, dot);
            }
            cur = { name, text: lead };
            traits.push(cur);
          } else if (x.type === 'p' && cur) {
            if (!/^\/\//.test(x.text)) {
              cur.text += (cur.text ? '\n' : '') + x.text;
            }
          } else if (x.type === 'p' && !cur && !/^\/\//.test(x.text)) {
            // 前置说明段落
            traits.push({ name: '', text: x.text });
          }
        }
        races.push({
          id: name, name: title, category: path.basename(d),
          url: relUrl(full), traits, raceFeats,
        });
      }
    }
  };
  walk(dir);
  return races.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

// ---------- 3. 职业 ----------
// 中文数字 → 数值（"两"=2）
const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function cnToNum(s) {
  if (/^\d+$/.test(s)) return +s;
  return CN_NUM[s] || 0;
}
const ALL_SKILLS = ['运动', '威吓', '体操', '巧手', '隐匿', '奥秘', '灵能', '历史',
  '调查', '自然', '宗教', '表演', '医药', '洞悉', '察觉', '求生', '交涉'];

// 从 head 文本提取结构化核心数据（生命骰/熟练项/豁免/技能/定位）
function extractCore(headParts) {
  const text = headParts.join('\n');
  const core = {};
  const hd = /生命骰：\s*D(\d+)/.exec(text);
  if (hd) core.hitDie = +hd[1];
  const grab = (re) => {
    const m = re.exec(text);
    return m ? m[1].trim() : '';
  };
  core.armor = grab(/防具：\s*([^\n]+)/);
  core.weapons = grab(/武器：\s*([^\n]+)/);
  core.saves = grab(/豁免：\s*([^\n]+)/);
  core.saveList = core.saves ? core.saves.split(/[、,，]/).map(s => s.trim()).filter(Boolean) : [];
  const sk = grab(/技能：\s*([^\n]+)/);
  core.skills = sk;
  core.skillsFixed = [];
  core.skillsOptions = [];
  core.skillsCount = 0;
  const mSel = /从(.+?)中选([一二两三四五六七八九十\d]+)项?/.exec(sk);
  if (mSel) {
    core.skillsOptions = mSel[1].split(/[、,，]/).map(s => s.trim()).filter(Boolean);
    core.skillsCount = cnToNum(mSel[2]);
  } else {
    const mPlus = /(.+?)，外加([一二两三四五六七八九十\d]+)项自选技能/.exec(sk);
    if (mPlus) {
      core.skillsFixed = mPlus[1].split(/[、,，]/).map(s => s.trim()).filter(Boolean);
      core.skillsCount = cnToNum(mPlus[2]);
      core.skillsOptions = [...ALL_SKILLS];
    }
  }
  core.roles = [];
  for (const m of text.matchAll(/(防御者|打击者|控制者|辅助者|无难度|低难度|中难度|高难度)：\s*([^\n]+)/g)) {
    core.roles.push(m[1] + '：' + m[2]);
  }
  return core;
}

function parseClasses() {
  const classes = [];
  const dir = path.join(SRC, '职业');
  if (!fs.existsSync(dir)) return classes;
  // 顶层职业页 + 子目录职业（如 赛博格/赛博格.htm，目录名 == 文件名）
  const tops = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && /\.htm$/i.test(e.name)) {
      tops.push(e.name.replace(/\.htm$/i, ''));
    } else if (e.isDirectory() && !/\.files$/i.test(e.name)) {
      const subFile = path.join(dir, e.name, e.name + '.htm');
      if (fs.existsSync(subFile) && !fs.existsSync(path.join(dir, e.name + '.htm'))) {
        tops.push(e.name + '/' + e.name); // 子目录职业
      }
    }
  }
  const seen = new Set();
  for (const t of tops) {
    const name = t.split('/').pop();
    if (seen.has(name)) continue;
    seen.add(name);
    // 附录页（如 法师附录.htm）是职业的补充规则页，不是可选职业，必须排除
    if (/职业和兼职|非玩家职业|附录/.test(name)) continue;
    const file = t.includes('/')
      ? path.join(dir, ...t.split('/').slice(0, -1), name + '.htm')
      : path.join(dir, name + '.htm');
    const flow = parsePage(readText(file));
    const title = (flow.find(x => x.type === 'h1') || {}).text || name;
    // 头部信息（第一个表格之前的所有 h2/h3/p 段；h2/h3 为分组标题）
    const tableIdx = flow.findIndex(x => x.type === 'table');
    const headEnd = tableIdx >= 0 ? tableIdx : flow.length;
    const head = [];
    let cur = null;
    for (let i = 0; i < headEnd; i++) {
      const x = flow[i];
      if (x.type === 'h2' || x.type === 'h3') {
        cur = { name: x.text.replace(/[。．\s]+$/, ''), text: '' };
        head.push(cur);
      } else if (x.type === 'p' && cur) {
        cur.text += (cur.text ? '\n' : '') + x.text;
      } else if (x.type === 'p') {
        head.push({ name: '', text: x.text });
      }
    }
    // 职业表（第一个表格）
    const table = tableIdx >= 0 ? flow[tableIdx].rows : [];
    const tableTitle = tableIdx > 0 && (flow[tableIdx - 1].type === 'h1' || flow[tableIdx - 1].type === 'h2')
      ? flow[tableIdx - 1].text : '';
    // 特性（"职业特性"标题之后的 h2 段落）
    const features = [];
    let inFeats = false;
    for (const x of flow) {
      if ((x.type === 'h1' || x.type === 'h2') && /职业特性/.test(x.text)) { inFeats = true; continue; }
      if (inFeats && x.type === 'h2') {
        features.push({ name: x.text.replace(/[（(].*?[)）]\s*$/, '').trim(), text: '' });
      } else if (inFeats && x.type === 'p' && features.length) {
        features[features.length - 1].text += (features[features.length - 1].text ? '\n' : '') + x.text;
      }
    }
    // 子职
    const subDir = path.join(dir, name);
    const subclasses = [];
    if (fs.existsSync(subDir)) {
      for (const se of fs.readdirSync(subDir, { withFileTypes: true })) {
        if (se.isDirectory() && /\.files$/i.test(se.name)) continue;
        if (se.isDirectory()) {
          // 嵌套子目录（如 狂战士/战士（狂战士变体）/勇士.htm）
          const subsub = fs.readdirSync(path.join(subDir, se.name), { withFileTypes: true })
            .filter(x => x.isFile() && /\.htm$/i.test(x.name) && !x.name.endsWith('.files'));
          for (const s of subsub) {
            const n = s.name.replace(/\.htm$/i, '');
            subclasses.push({ name: n, url: relUrl(path.join(subDir, se.name, s.name)), nested: true });
          }
        } else if (se.isFile() && /\.htm$/i.test(se.name)) {
          const n = se.name.replace(/\.htm$/i, '');
          // 排除职业本体页（子目录职业，如 赛博格/赛博格.htm）与规则页（程序.htm）
          if (n === name || n === '程序') continue;
          subclasses.push({ name: n, url: relUrl(path.join(subDir, se.name)) });
        }
      }
    }
    const headTexts = head.map(x => (x.name ? x.name + (x.text ? ' ' + x.text : '') : x.text));
    classes.push({
      id: name, name: title, url: relUrl(file), head,
      core: extractCore(headTexts),
      tableTitle, table, features, subclasses,
    });
  }
  return classes.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- 3.5 职业特性 / 子职特性（2026-10-27，供骰子「职业特性」查询；单点数据源） ----------
// 规则书里「特性名」是 14pt 棕色加粗段（parsePage 判为 h2），但 Word 原文常见粘连：
//   1) 标题段里带首段正文：`偷袭\n 第1级起，……`（作者在同一段内换行）
//   2) 连续多个特性挤进同一段：`强化链接\n 第6级起…\n灼烧烈焰\n 第10级起…`
// 直接取整段会得到「标题 = 一大段正文」的脏条目，所以按「短名行 + 第N级起正文行」拆开。
const FEATURE_LEVEL_RE = /^第(\d+)级(?:起|时|，|,)/;
/** 非特性段：职业页头部（定位/生命值/熟练项/兼职/职业表）、附录、变体职业页的头部小节 */
const FEATURE_JUNK_RE = /^(定位|生命值|熟练项|兼职|职业表|附录)|职业表$|职业特性替换|^(力量|敏捷|体质|智力|感知|魅力)(（|$)/;

/** 把可能粘连的标题段拆成 [{name, text}]（只拆标题段，不拆已经在正文里的段落） */
function splitFeatureHeads(text) {
  const lines = String(text)
    .split('\n')
    .map(l => l.replace(/^[\s\u3000]+|[\s\u3000]+$/g, ''))
    .filter(Boolean);
  const out = [];
  let cur = null;
  for (const line of lines) {
    // 正文行：「第N级起，……」
    if (FEATURE_LEVEL_RE.test(line) && cur) {
      cur.text += (cur.text ? '\n' : '') + line;
      continue;
    }
    // 特性名行：短、且不以句末标点结尾；已有正文时再出现短行 ⇒ 新特性
    const looksName = line.length <= 20 && !/[。！？]$/.test(line);
    if (!cur || (looksName && cur.text)) {
      cur = { name: line, text: '' };
      out.push(cur);
    } else {
      cur.text += (cur.text ? '\n' : '') + line;
    }
  }
  return out
    .map(x => ({ name: x.name.replace(/[。．\s]+$/g, '').trim(), text: x.text.trim() }))
    .filter(x => x.name);
}

/** 表格 → 纯文本行（特性正文里夹带的表格不能丢，用 `a｜b` 单行表示） */
function tableToLines(rows) {
  return (rows || [])
    .filter(r => Array.isArray(r) && r.length)
    .map(r => r.map(c => String(c).replace(/\s+/g, ' ').trim()).join('｜'))
    .join('\n');
}

/**
 * 职业特性：重解析职业页「职业特性」章节（比 classes.json 里按 h2+p 的粗解析多保留表格），
 * 等级从职业表「特性」列反推：
 *   - `专精（2项）` → `专精`；`引导神力：荒野变形` → 归到 `引导神力`（父特性）
 *   - `子职特性` / `N环`（法术位表头）不是职业特性，跳过
 * 一个特性可能在多个等级出现（专精 1/6、额外专长 10/16/19），levels 保留全部等级。
 */
function extractClassFeatures(classes) {
  const out = [];
  for (const c of classes) {
    const page = path.join(SRC, c.url);
    if (!fs.existsSync(page)) continue;
    const flow = parsePage(readText(page));
    // 原书有个别页把「职业特性」标题写了两次（连排），取最后一个，避免刚进入章节就 break
    let startIdx = -1;
    for (let i = 0; i < flow.length; i++) {
      const b = flow[i];
      if ((b.type === 'h1' || b.type === 'h2') && /^职业特性$/.test(b.text.trim())) startIdx = i;
    }
    if (startIdx < 0) {
      console.warn(`[parse-card-data] 职业页未找到「职业特性」章节：${c.name}（${c.url}）`);
      continue;
    }
    // 等级映射（来自职业表）
    const table = c.table || [];
    const featCol = (table[0] || []).indexOf('特性');
    const levelMap = new Map();
    if (featCol >= 0) {
      for (const row of table.slice(1)) {
        const lv = Number(String(row[0]).replace(/[^\d]/g, ''));
        if (!lv) continue;
        for (const raw of String(row[featCol] || '').split(/[，,、]/)) {
          const base = String(raw).replace(/[（(][^（()）]*[)）]/g, '').trim();
          if (!base || /环$/.test(base) || base === '子职特性') continue;
          const key = base.split('：')[0].trim();
          if (!key) continue;
          if (!levelMap.has(key)) levelMap.set(key, []);
          const arr = levelMap.get(key);
          if (arr.indexOf(lv) < 0) arr.push(lv);
        }
      }
    }
    // 章节内按 h2 切特性（附录开始即停，附录数据不是特性）
    const feats = [];
    let cur = null;
    for (let i = startIdx + 1; i < flow.length; i++) {
      const x = flow[i];
      if (x.type === 'h1') break; // 下一章
      if (x.type === 'h2') {
        if (/^附录/.test(x.text)) break;
        for (const p of splitFeatureHeads(x.text)) {
          if (FEATURE_JUNK_RE.test(p.name)) continue;
          cur = { name: p.name, text: p.text };
          feats.push(cur);
        }
        continue;
      }
      if (!cur) continue;
      if (x.type === 'p' || x.type === 'h3') cur.text += (cur.text ? '\n' : '') + x.text;
      else if (x.type === 'table') cur.text += (cur.text ? '\n' : '') + tableToLines(x.rows);
    }
    for (const f of feats) {
      const text = String(f.text || '').trim();
      if (!text) continue;
      out.push({ cls: c.name, name: f.name, levels: levelMap.get(f.name) || [], text, url: c.url });
    }
  }
  return out;
}

/**
 * 子职特性：子职页（职业/<职业>/<子职>.htm）里 14pt 棕色 h2 = 子职特性名，其后 p/h3/表格 = 正文。
 * 排除项：
 *   - 「XX（YY变体）」是变体职业页（内含完整职业结构），不是子职；
 *   - `附录：……` 是数据/法术/怪物附录，不是特性（整段跳过）；
 *   - 无 h2 的页（无形者/图腾/神力选项/赛博格协议与核心等）没有特性结构，跳过
 *     （赛博格协议页的内容是「程序」，已在 程序 词典里）。
 * level 从正文开头「第N级起/时」提取（取第一个），没有标注的记 0。
 */
function extractSubclassFeatures(classes) {
  const out = [];
  const stats = { pages: 0, skippedVariant: 0, skippedNoFeature: 0 };
  for (const c of classes) {
    for (const s of c.subclasses || []) {
      if (!s.url) continue;
      if (/（.+变体）$/.test(s.name)) {
        stats.skippedVariant++;
        continue;
      }
      const page = path.join(SRC, s.url);
      if (!fs.existsSync(page)) continue;
      const flow = parsePage(readText(page));
      const feats = [];
      let cur = null;
      for (const x of flow) {
        if (x.type === 'h2') {
          if (/^附录/.test(x.text)) { cur = null; continue; }
          for (const p of splitFeatureHeads(x.text)) {
            if (FEATURE_JUNK_RE.test(p.name)) continue;
            cur = { name: p.name, text: p.text };
            feats.push(cur);
          }
          continue;
        }
        if (!cur) continue;
        if (x.type === 'p' || x.type === 'h3') cur.text += (cur.text ? '\n' : '') + x.text;
        else if (x.type === 'table') cur.text += (cur.text ? '\n' : '') + tableToLines(x.rows);
      }
      let kept = 0;
      for (const f of feats) {
        const text = String(f.text || '').trim();
        if (!text) continue;
        const m = /第(\d+)级(?:起|时|，|,)/.exec(text.slice(0, 120));
        out.push({ cls: c.name, sub: s.name, name: f.name, level: m ? Number(m[1]) : 0, text, url: s.url });
        kept++;
      }
      if (kept) stats.pages++;
      else stats.skippedNoFeature++;
    }
  }
  return { features: out, stats };
}

// ---------- 4. 专长 ----------
function parseFeats() {
  const feats = [];
  const dir = path.join(SRC, '专长');
  if (!fs.existsSync(dir)) return feats;
  const walk = (d, depth) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!/\.files$/i.test(e.name)) walk(full, depth + 1);
      } else if (/\.htm$/i.test(e.name)) {
        const n = e.name.replace(/\.htm$/i, '');
        if (n === '专长说明') continue;
        const flow = parsePage(readText(full));
        // 页面路径如 "专长/通用专长/泛用性的专长.htm"：第一段固定为"专长"，第二段是类别，第三段是子类
        const pageLabel = path.relative(SRC, full).split(path.sep).slice(0, -1).join('/');
        const segs = pageLabel.split('/');
        const bigCat = segs[1] || segs[0] || '';
        const subCat = segs.slice(2).join('/');
        for (let i = 0; i < flow.length; i++) {
          if (flow[i].type === 'h2') {
            const name = flow[i].text;
            // 过滤规则说明类条目（如"玩家可选变体：爆发式卓越骰"），它们不是专长
            if (/^玩家可选变体/.test(name)) continue;
            let text = '';
            for (let j = i + 1; j < flow.length; j++) {
              if (flow[j].type === 'h2') break;
              if (flow[j].type === 'p') text += (text ? '\n' : '') + flow[j].text;
            }
            feats.push({ name, category: bigCat, sub: subCat, page: pageLabel, url: relUrl(full), text });
          }
        }
      }
    }
  };
  walk(dir, 0);
  return feats;
}

// ---------- 5. 法术 / 职业法术列表 / 战技 / 程序 ----------
// 法术详述页（法术/法术详述/0环.htm … 传奇法术.htm）：红色加粗段 = 法术名，后续 p = 环位/学派/施法信息/描述
function parseSpells() {
  const spells = [];
  const dir = path.join(SRC, '法术', '法术详述');
  if (!fs.existsSync(dir)) return spells;
  const levelMap = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9 };
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!/\.htm$/i.test(e.name)) continue;
    const level = /^(\d)环/.test(e.name) ? levelMap[+e.name[0]] : 10; // 传奇法术.htm → 10
    const flow = parsePage(readText(path.join(dir, e.name)));
    for (let i = 0; i < flow.length; i++) {
      if (!(flow[i].type === 'h3' && flow[i].red)) continue;
      let name = flow[i].text.replace(/\s*[A-Za-z][A-Za-z\s'’]*$/, '').trim();
      if (!name) continue;
      let text = '';
      for (let j = i + 1; j < flow.length; j++) {
        if (flow[j].type === 'h3' && flow[j].red) break;
        if (flow[j].type === 'p' && !/^\/\//.test(flow[j].text)) {
          text += (text ? '\n' : '') + flow[j].text;
        }
      }
      // 学派：text 首段 "戏法 防护" / "三环 塑能" / "传奇 变化"；"（仪式）"是标记不是学派
      const sm = /^(?:戏法|传奇|[零一二三四五六七八九十百]+环)\s*([^\s]+)/.exec(text);
      let school = sm ? sm[1] : '';
      const ritual = /（仪式）/.test(school) || /^仪式$/.test(school);
      school = school.replace(/（仪式）/, '').trim();
      // 结构化属性字段（从文本行提取；提取不到留空）
      const grab = (re) => {
        const m = re.exec(text);
        return m ? m[1].replace(/[。．\s]+$/, '').trim() : '';
      };
      const duration = grab(/持续时间：\s*([^\n]+)/);
      spells.push({
        name, level, school, ritual, text,
        url: relUrl(path.join(dir, e.name)),
        castTime: grab(/施法时间：\s*([^\n]+)/),
        range: grab(/施法距离：\s*([^\n]+)/),
        target: grab(/法术目标：\s*([^\n]+)/),
        components: grab(/法术成分：\s*([^\n]+)/),
        duration,
        focus: /专注/.test(duration) || /需要专注|维持专注/.test(text),
      });
    }
  }
  // 补充：非职业法术 / 反派专用法术 页面（其中不在法术详述页的法术，如"消灭个人角色"）
  for (const extra of ['其它职业', '反派专用法术']) {
    const file = path.join(SRC, '法术', '职业法术列表', extra + '.htm');
    if (!fs.existsSync(file)) continue;
    const flow = parsePage(readText(file));
    for (let i = 0; i < flow.length; i++) {
      if (!(flow[i].type === 'h3' && flow[i].red)) continue;
      let name = flow[i].text.replace(/\s*[A-Za-z][A-Za-z\s'’]*$/, '').trim();
      if (!name || spells.some(s => s.name === name)) continue; // 详述页已有则跳过
      let text = '';
      for (let j = i + 1; j < flow.length; j++) {
        if (flow[j].type === 'h3' && flow[j].red) break;
        if (flow[j].type === 'p' && !/^\/\//.test(flow[j].text)) {
          text += (text ? '\n' : '') + flow[j].text;
        }
      }
      // 环位/学派：首段 "戏法 变化" / "四环 附魔" / "传奇 …"
      const lm = /^(?:戏法|传奇|([零一二三四五六七八九十百]+)环)\s*([^\s]*)/.exec(text);
      const level = lm ? (lm[1] ? cnToNum(lm[1]) : (/^戏法/.test(lm[0]) ? 0 : 10)) : 0;
      let school = lm ? (lm[2] || '') : '';
      const ritual = /（仪式）/.test(school);
      school = school.replace(/（仪式）/, '').trim();
      const grabE = (re) => {
        const m = re.exec(text);
        return m ? m[1].replace(/[。．\s]+$/, '').trim() : '';
      };
      const duration = grabE(/持续时间：\s*([^\n]+)/);
      spells.push({
        name, level, school, ritual, text,
        url: relUrl(file),
        castTime: grabE(/施法时间：\s*([^\n]+)/),
        range: grabE(/施法距离：\s*([^\n]+)/),
        target: grabE(/法术目标：\s*([^\n]+)/),
        components: grabE(/法术成分：\s*([^\n]+)/),
        duration,
        focus: /专注/.test(duration) || /需要专注|维持专注/.test(text),
      });
    }
  }
  return spells;
}

// 职业法术列表页（法术/职业法术列表/法师奥术.htm …）：节标题 = 环位，p 段 = 法术名列表
// 特殊页："其它职业"（非职业法术）与"反派专用法术"无节标题，法术名为红 h3，"X环 学派"行标环位
function parseClassSpells() {
  const out = [];
  const dir = path.join(SRC, '法术', '职业法术列表');
  if (!fs.existsSync(dir)) return out;
  const suffix = /^(.*?)(?:奥术|神术|机关术|异能)$/;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!/\.htm$/i.test(e.name)) continue;
    const className = (suffix.exec(e.name.replace(/\.htm$/i, '')) || [null, e.name.replace(/\.htm$/i, '')])[1];
    const flow = parsePage(readText(path.join(dir, e.name)));
    const lists = {};
    const jobs = {};
    let cur = null;
    if (/其它职业|反派专用法术/.test(e.name)) {
      // 特殊页：红 h3 = 法术名；"X环 学派"行 → 环位；"职业：xxx"行 → 可学职业
      const specialName = e.name.replace(/\.htm$/i, '') === '其它职业' ? '非职业法术' : '反派专用法术';
      let spellName = null;
      for (const x of flow) {
        if (x.type === 'h3' && x.red) {
          spellName = x.text.replace(/\s*[A-Za-z][A-Za-z\s'’]*$/, '').trim();
          continue;
        }
        if (x.type === 'p' && spellName) {
          const lm = /^(?:戏法|传奇|([零一二三四五六七八九十百]+)环)/.exec(x.text);
          if (lm) {
            const level = lm[1] ? cnToNum(lm[1]) : (/^戏法/.test(lm[0]) ? 0 : 10);
            (lists[level] = lists[level] || []).push(spellName);
          }
          const jm = /^职业：\s*(.+)/.exec(x.text);
          if (jm) {
            jobs[spellName] = jm[1].split(/[、，,]/).map(s => s.trim()).filter(Boolean);
          }
        }
      }
      out.push({ class: specialName, lists, jobs });
      continue;
    }
    for (const x of flow) {
      if ((x.type === 'h2' || x.type === 'h3') && /^(\d+)环/.test(x.text)) {
        cur = +x.text.match(/^(\d+)环/)[1];
        lists[cur] = lists[cur] || [];
      } else if (x.type === 'h2' && /传奇/.test(x.text)) {
        cur = 10;
        lists[cur] = lists[cur] || [];
      } else if (x.type === 'p' && cur !== null) {
        // 提取中文法术名（跳过英文别名）
        const re = /[\u4e00-\u9fff·]{2,8}(?:[（(][^）)]*[)）])?/g;
        let m;
        while ((m = re.exec(x.text)) !== null) {
          const nm = m[0].trim();
          if (nm && !lists[cur].includes(nm)) lists[cur].push(nm);
        }
      }
    }
    out.push({ class: className, lists });
  }
  return out;
}

// 战技（专长/战技专长/游龙流专长.htm 等）：
//   1) 流派页表格 = 打击技/强化技/应对技 × 低级~超级（名称清单）
//   2) 表格后的详述区（h2"XXX流战技"之后的 h3 条目）= 每个战技的属性行 + 完整描述
function parseManeuvers() {
  const out = [];
  const dir = path.join(SRC, '专长', '战技专长');
  if (!fs.existsSync(dir)) return out;
  const styleNames = ['开山流', '摘星流', '散人流', '混元流', '游龙流', '神机流'];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!/\.htm$/i.test(e.name)) continue;
    const style = styleNames.find(s => e.name.includes(s));
    if (!style) continue;
    const flow = parsePage(readText(path.join(dir, e.name)));
    const url = relUrl(path.join(dir, e.name));
    // 1) 表格：名称/级别/类型
    for (const x of flow) {
      if (x.type !== 'table') continue;
      const rows = x.rows;
      if (!rows.length) continue;
      const headRow = rows.find(r => r.some(c => /打击技/.test(c)));
      if (!headRow) continue;
      const typeIdx = headRow.map((c, i) => ({ c, i }))
        .filter(o => /(打击技|强化技|应对技)/.test(o.c))
        .map(o => ({ type: o.c.replace(/[^\u4e00-\u9fff]/g, ''), i: o.i }));
      for (const r of rows) {
        if (r === headRow) continue;
        const level = r[0].replace(/[^\u4e00-\u9fff]/g, '');
        if (!level) continue;
        for (const { type, i } of typeIdx) {
          const cell = r[i] || '';
          for (const nm of cell.split(/[、，,]/).map(s => s.trim()).filter(Boolean)) {
            out.push({ name: nm, style, type, level, text: '', url });
          }
        }
      }
    }
    // 2) 详述区：h2"XXX流战技"起，h3 = 战技名（须在表格清单中），p = 属性行 + 描述（flush 式合并）
    const tableNames = new Set(out.filter(m => m.style === style).map(m => m.name));
    // 编辑距离 ≤1（一字之差/增删一字）视为同一战技，用于纠正表格与详述的错别字不一致（如 撒棱/撒菱）
    const similarName = (a, b) => {
      if (a === b) return true;
      if (Math.abs(a.length - b.length) > 1) return false;
      let i = 0, j = 0, diff = 0;
      while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i++; j++; }
        else {
          diff++;
          if (diff > 1) return false;
          if (a.length > b.length) i++;
          else if (b.length > a.length) j++;
          else { i++; j++; }
        }
      }
      return true;
    };
    let inDetail = false;
    let cur = null;
    const flush = () => {
      if (!cur || !cur.name) { cur = null; return; }
      let hit = out.find(m => m.name === cur.name && m.style === style);
      if (!hit) hit = out.find(m => m.style === style && !m.text && similarName(m.name, cur.name));
      if (hit) { hit.name = cur.name; hit.text = cur.text; }
      else out.push({ name: cur.name, style, type: '', level: '', text: cur.text, url });
      cur = null;
    };
    for (const x of flow) {
      if (x.type === 'h2' && /战技$/.test(x.text)) { flush(); inDetail = true; continue; }
      if (inDetail && x.type === 'h2') { flush(); inDetail = false; continue; }
      if (inDetail && x.type === 'h3') {
        const isTableName = tableNames.has(x.text) ||
          [...tableNames].some(n => similarName(n, x.text));
        if (isTableName) { flush(); cur = { name: x.text, text: '' }; }
        else if (cur) cur.text += (cur.text ? '\n' : '') + x.text; // 子标题并入当前战技描述
        continue;
      }
      if (inDetail && x.type === 'p' && cur) cur.text += (cur.text ? '\n' : '') + x.text;
    }
    flush();
  }
  return out;
}

// 程序（职业/赛博格/阿尔法协议.htm 等）：
//   1) 表格 = 程序|激活时间|所需模块|效果简述（名称清单 + 简述）
//   2) 表格后的详述区（h3 红色程序名条目）= 属性行 + 完整描述
function parsePrograms() {
  const out = [];
  const dir = path.join(SRC, '职业', '赛博格');
  if (!fs.existsSync(dir)) return out;
  const protNames = ['阿尔法', '贝塔', '伽马', '德尔塔', '伊普西隆', '泽塔', '欧米伽'];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!/协议\.htm$/i.test(e.name)) continue;
    const protocol = protNames.find(p => e.name.includes(p));
    if (!protocol) continue;
    const flow = parsePage(readText(path.join(dir, e.name)));
    const url = relUrl(path.join(dir, e.name));
    // 1) 表格
    for (const x of flow) {
      if (x.type !== 'table') continue;
      const rows = x.rows;
      if (rows.length < 2) continue;
      const headRow = rows[0];
      const ci = headRow.indexOf('程序');
      const ai = headRow.indexOf('激活时间');
      const mi = headRow.indexOf('所需模块');
      if (ci < 0) continue;
      for (const r of rows.slice(1)) {
        if (!r[ci]) continue;
        out.push({
          name: r[ci].replace(/[（(].*?[)）]/g, '').trim(),
          protocol,
          act: ai >= 0 ? (r[ai] || '') : '',
          module: mi >= 0 ? (r[mi] || '') : '',
          text: r.slice(Math.max(ci, ai, mi) + 1).join(' ').trim(),
          url,
        });
      }
    }
    // 2) 详述区：表格后的红色 h3 = 程序名，后续 p 与非红加粗段 = 属性行 + 完整描述（flush 式合并）
    let inDetail = false;
    let cur = null;
    const flush = () => {
      if (!cur || !cur.name) { cur = null; return; }
      const hit = out.find(p => p.name === cur.name && p.protocol === protocol);
      if (hit) {
        // 详述（属性行+描述）在前；表格简述若未被包含则追加在后
        hit.text = cur.text + (hit.text && !cur.text.includes(hit.text) ? '\n' + hit.text : '');
      } else {
        out.push({ name: cur.name, protocol, act: '', module: '', text: cur.text, url });
      }
      cur = null;
    };
    for (const x of flow) {
      if (x.type === 'table') { flush(); inDetail = true; continue; }
      if (!inDetail) continue;
      if (x.type === 'h3' && x.red) { flush(); cur = { name: x.text, text: '' }; continue; }
      if (cur && (x.type === 'p' || (x.type === 'h3' && !x.red))) {
        cur.text += (cur.text ? '\n' : '') + x.text;
      }
    }
    flush();
  }
  // 专注标记：程序有"持续时间：专注，至多X"等表达即需要专注
  for (const p of out) {
    p.focus = /专注，至多|维持专注|需要专注/.test(p.text);
  }
  return out;
}

// ---------- 5c. 魔法物品（装备/魔法物品/**） ----------
// 物品条目 = 14pt 棕色加粗段（parsePage 判为 h2）；套装页特殊：h2 = 套装条目, h1（≠“套装”）= 套装成员物品
// 类型行（attr）两种形式：① 与物品名同段（<br> 分隔，如 卷轴页）；② 名字后独立 p/h3（可能前插“武器加值：+N。”等 h3）
function parseMagicItems() {
  const out = [];
  const dir = path.join(SRC, '装备', '魔法物品');
  if (!fs.existsSync(dir)) return out;
  // 说明/工艺/推荐 页是规则讲解页或清单，不含物品条目
  const skipFile = (name) => /说明\.htm$/i.test(name) || /魔法物品工艺\.htm$/i.test(name) || /常见物品推荐\.htm$/i.test(name);
  // 类型行：主正则（封闭类型集）+ 兜底（短前缀 + 价格/同调标记），实测全量 100% 检出
  const attrRe = /^(神器，)?(卷轴|魔药|武器|法器|奇物|服饰|盔甲|盾牌|套装|弹药)[^，\n]*，/;
  const attrRe2 = /^[^，\n]{1,14}，.*(?:gp|价格|同调|非卖品|耗材)/;
  const enRe = /\s*[A-Za-z][A-Za-z0-9\s'’\-]*$/;
  const hit = (t) => t && (attrRe.test(t) || attrRe2.test(t));
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (!/\.files$/i.test(e.name)) walk(full); continue; }
      if (!/\.htm$/i.test(e.name) || skipFile(e.name)) continue;
      const isSetPage = e.name === '套装.htm';
      const rel = relUrl(full);
      const label = e.name.replace(/\.htm$/i, '');
      const category = isSetPage ? '套装'
        : (label === '卷轴' || label === '魔药') ? label
        : path.basename(path.dirname(full)); // 武器/防具/法器/服饰/奇物
      const flow = parsePage(readText(full));
      let seq = 0;
      for (let i = 0; i < flow.length; i++) {
        const x = flow[i];
        const isName = isSetPage ? (x.type === 'h2' || (x.type === 'h1' && x.text !== '套装')) : x.type === 'h2';
        if (!isName) continue;
        // 条目正文：到下一个条目名为止；套装页的 h1 即条目名（不进正文）
        const body = [];
        for (let j = i + 1; j < flow.length; j++) {
          const y = flow[j];
          const isNext = isSetPage ? (y.type === 'h2' || (y.type === 'h1' && y.text !== '套装')) : y.type === 'h2';
          if (isNext) break;
          if (y.type !== 'h1') body.push(y);
        }
        // 名称：首行；末尾英文拆出 en
        const lines = x.text.split('\n').map(s => s.trim()).filter(Boolean);
        let name = lines[0] || '';
        let en = '';
        const em = name.match(enRe);
        if (em) { en = em[0].trim(); name = name.slice(0, em.index).trim(); }
        if (!name) name = en; // 纯英文名（如 “MP5”）
        // 类型行：先看名字块第 2+ 行，再看正文前 6 块的 p/h3
        let attr = '';
        for (const ln of lines.slice(1)) if (hit(ln)) { attr = ln; break; }
        if (!attr) {
          for (const b of body.slice(0, 6)) {
            if ((b.type === 'p' || b.type === 'h3') && hit(b.text)) { attr = b.text; break; }
          }
        }
        // 结构化字段
        const am = attr.match(/需[^，\n]{0,14}?同调/);
        const priceMatch = attr.match(/(至少[\d,，]+gp|\d[\d,，]*\s*gp)/);
        const price = priceMatch ? priceMatch[1].replace(/\s+/g, '')
          : /价格见下?表/.test(attr) ? '价格见下表'
          : /非卖品/.test(attr) ? '非卖品' : '';
        const text = body.filter(b => (b.type === 'p' || b.type === 'h3') && !/^\/\//.test(b.text))
          .map(b => b.text).join('\n');
        const tables = body.filter(b => b.type === 'table').map(b => b.rows);
        // 价格区间：pmin/pmax（gp 数值；pmax=null 表示“至少 N”，上不封顶）
        let pmin = null, pmax = null, nonsell = false;
        if (/非卖品/.test(attr)) nonsell = true;
        else {
          const pm = attr.match(/(至少)?([\d][\d,，]*)\s*gp/);
          if (pm) {
            pmin = pmax = +pm[2].replace(/[，,]/g, '');
            if (pm[1]) pmax = null; // 至少 N gp
          } else {
            // “价格见下表”：从物品价格表的价格列提取数值（如 卷轴环阶→价格、磨刀石加值→价格）
            const nums = [];
            for (const t of tables) {
              if (!t.length) continue;
              let pi = -1;
              t[0].forEach((c, idx) => { if (/价格|售价|成本/.test(c)) pi = idx; });
              if (pi < 0) continue;
              for (const r of t.slice(1)) {
                const cell = r[pi] || '';
                const cm = cell.match(/([\d][\d,，]*)/);
                if (cm && !/…/.test(cell)) nums.push(+cm[1].replace(/[，,]/g, ''));
              }
            }
            if (nums.length) { pmin = Math.min(...nums); pmax = Math.max(...nums); }
          }
        }
        seq++;
        out.push({
          id: rel + '#' + seq,
          name, en, category, sub: label,
          attr, attune: !!am, attuneText: am ? am[0] : '',
          price, pmin, pmax, nonsell, artifact: /神器/.test(attr),
          text, tables, url: rel,
        });
      }
    }
  };
  walk(dir);
  return out;
}

// ---------- 5d. 怪物（怪物/**/*.htm；Word 导出的「按 CR 分组」合集页，一页多只） ----------
// 页面没有语义标题，只能按文本行切分。切分锚点用**结构判定**而不是类型行措辞：
// 类型行（如「中型不死生物，中立邪恶」）后面 1–3 行内必须出现 AC/HP 等 stat block 行。
// 原因（2026-10-21 骰子侧真实用户反馈）：类型行有半角逗号/空格/句号、错字「中形」、
// 多阵营带百分比等变体，枚举正则必漏；漏判的后果不是报错，而是**下一只怪被并进上一只的
// 正文**（静默串页），因此此函数末尾还有一道串页自检。
//
// 输出字段分两层：
//   ① 与 qq-dice 现有 query-data.json 怪物条目**同语义**的 7 个字段
//      name/type/desc/cr/text/page/url —— 骰子构建脚本可直接改读本文件，无需改查询逻辑；
//   ② 词典页用的结构化字段 ac/hp/speed/abilities/saves/.../sections（解析不到则留空）。
const MONSTER_SIZE_RE = /(超微型|微型|小型或中型|小型|中型|中形|大型|巨型|超巨型|无体型|任意体型)/;
const MONSTER_ALIGN_RE = /(任何|任意|绝对中立|守序善良|守序中立|守序邪恶|中立善良|中立邪恶|混乱善良|混乱中立|混乱邪恶|无阵营|善良|邪恶|守序|混乱|中立)/;
const MONSTER_SECTION_RE = /^(传奇动作（\d+动作）|传奇动作|非传奇特性|传奇特性|特性|附赠动作|反应|动作|巢穴动作|区域效应|专长|装备|法术|职业)$/;
const MONSTER_ATTR_RE = /^(AC|护甲等级|防御等级|HP|生命值|最大HP|速度|力量|敏捷|体质|智力|感知|豁免|技能|伤害免疫|伤害抗性|伤害易伤|伤害抵抗|伤害吸收|状态免疫|状态抗性|感官|语言|熟练加值|挑战等级|先攻)[：:\s]/;
// stat block 结构锚点的「AC/HP」行：允许全角/半角冒号、空格，甚至无分隔符（源站有「防御等级14」「AC 15」写法）
// 注意不要用 \s* 直接跨行匹配——源页表格被摊平成行后会有单独一行的「AC」表头，会被误判成 stat block
const MONSTER_STAT_ANCHOR_RE = /^(?:AC|护甲等级|防御等级|HP|生命值)(?:[：:]|[ \t]|(?=\d))\s*\S/;
// 字段提取：标签 + 可选冒号/空格 + 值（顺序有意义：先具体后宽泛）
const MONSTER_FIELD_RES = [
  ['ac', /^(?:AC|护甲等级|防御等级)\s*[：:]?\s*(.+)$/],
  ['maxHp', /^最大HP\s*[：:]?\s*(.+)$/],
  ['hp', /^(?:HP|生命值)\s*[：:]?\s*(.+)$/],
  ['speed', /^速度\s*[：:]?\s*(.+)$/],
  ['saves', /^豁免\s*[：:]?\s*(.+)$/],
  ['skills', /^技能\s*[：:]?\s*(.+)$/],
  ['damageImmunities', /^伤害免疫\s*[：:]?\s*(.+)$/],
  ['damageResistances', /^(?:伤害抗性|伤害抵抗|抗性)\s*[：:]?\s*(.+)$/],
  ['damageVulnerabilities', /^伤害易伤\s*[：:]?\s*(.+)$/],
  ['damageAbsorption', /^伤害吸收\s*[：:]?\s*(.+)$/],
  ['conditionImmunities', /^状态免疫\s*[：:]?\s*(.+)$/],
  ['conditionResistances', /^(?:状态抗性|害抗性)\s*[：:]?\s*(.+)$/],
  ['senses', /^感官\s*[：:]?\s*(.+)$/],
  ['languages', /^语言\s*[：:]?\s*(.+)$/],
  ['proficiencyBonus', /^熟练加值\s*[：:]?\s*(.+)$/],
  ['initiative', /^先攻\s*[：:]?\s*(.+)$/],
  ['crText', /^挑战等级\s*[：:]?\s*(.+)$/],
];
const MONSTER_ATTR_NAMES = ['力量', '敏捷', '体质', '智力', '感知'];

/** 页面 → 文本行（保留块级行结构；GBK/UTF-8 自动判别；去零宽字符与面包屑） */
function htmlToLines(html) {
  let s = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<xml[\s\S]*?<\/xml>/gi, '')
    .replace(/<\/?(?:html|head|body|o:p|v:[a-z]+|w:[a-z]+)[^>]*>/gi, '');
  s = s.replace(/<\/?(?:p|div|h[1-6]|li|tr|table|ul|ol|br|section|article|blockquote|pre)\b[^>]*>/gi, '\n')
    .replace(/<\/td>/gi, '\t')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  const out = [];
  for (const raw of s.split(/\r?\n/)) {
    const line = raw.replace(/[\u200b-\u200f\ufeff]/g, '').replace(/[ \t]+/g, ' ').trim();
    if (line) out.push(line);
  }
  if (out.length && /^(怪物|职业|法术|种族|装备|专长|世界|基础)›/.test(out[0])) out.shift();
  return out;
}

function isMonsterTypeLineText(t) {
  if (!t || t.length > 60) return false;
  if (/[。！？：]/.test(t)) return false;
  if (!/[，,]/.test(t)) return false;
  if (!MONSTER_SIZE_RE.test(t)) return false;
  if (!MONSTER_ALIGN_RE.test(t)) return false;
  return true;
}
/** 类型行锚点：有 stat block 时靠结构；没有 stat block 的少数页退回措辞启发式 */
function isMonsterTypeAnchor(lines, i) {
  const t = String(lines[i] || '').trim();
  if (!t || t.length > 60) return false;
  if (t.indexOf('：') >= 0) return false;
  let statNearby = false;
  for (let d = 1; d <= 3; d++) {
    if (MONSTER_STAT_ANCHOR_RE.test(String(lines[i + d] || '').trim())) { statNearby = true; break; }
  }
  if (!statNearby) return isMonsterTypeLineText(t);
  if (!MONSTER_SIZE_RE.test(t) || !MONSTER_ALIGN_RE.test(t)) return false;
  // 有 stat block 时类型行分隔符可能是全角/半角逗号、句号、空格
  return /[，,。\s]/.test(t);
}
/** 名字行：短、无句末标点、非节名/属性行/noise；允许中文逗号（「莎尔，暗夜夫人」） */
function isMonsterNameLine(l) {
  const t = String(l || '').trim();
  if (!t || t.length > 45) return false;
  if (/[。！？；：]/.test(t)) return false;
  if (/^[·【]/.test(t)) return false;
  if (MONSTER_SECTION_RE.test(t) || MONSTER_ATTR_RE.test(t) || isMonsterTypeLineText(t)) return false;
  return true;
}
function isMonsterDescLine(l) {
  return l.length > 25 && /[。！？]$/.test(l) && !/^[·【]/.test(l) && l.indexOf('：') < 0 && !MONSTER_ATTR_RE.test(l);
}

/** 类型行 → { size, creatureType, alignment }（供筛选/列表；解析不到则留空） */
function parseMonsterType(typeLine) {
  const raw = String(typeLine || '').trim();
  // 源站有「一般为中型类人生物，混乱邪恶」这类前缀
  const t = raw.replace(/^(?:一般为|通常为|普遍为|一般是)\s*/, '');
  const sizeM = /^(超微型|微型|小型或中型|小型|中型|中形|大型|巨型|超巨型|无体型|任意体型)/.exec(t);
  let size = sizeM ? sizeM[1] : '';
  if (size === '中形') size = '中型'; // 源站错字（中形）→ 归一为中型
  // 「中型类人生物组成的超巨型军团」这类集群条目：实际体型是军团体型
  const army = /组成的(超巨型|巨型|大型|中型|小型)军团/.exec(t);
  if (army) size = army[1];
  const rest = sizeM ? t.slice(sizeM[0].length) : t;
  // 阵营：优先取最后一个逗号/句号后的部分；类型行只用空格分隔时（「大型构装体 无阵营」）退回对齐词搜索
  let alignment = '';
  const seps = [...t.matchAll(/[，,。]/g)];
  if (seps.length) alignment = t.slice(seps[seps.length - 1].index + 1).trim();
  else {
    // 「大型构装体 无阵营」：先精确匹配无阵营，再匹配带阵营前缀词的写法
    const am = /(无阵营|(?:任何|任意|绝对|通常|普遍|一般|守序|中立|混乱|善良|邪恶)(?:守序|中立|混乱|善良|邪恶|阵营|中立)+)/.exec(t);
    if (am) alignment = am[1].trim();
  }
  let creatureType = rest.split(/[，,。（(\s]/)[0].trim().split('的')[0].trim().replace(/组成$/, '');
  // 类型行首段可能只有体型（「小型（狗形态）或中型（人形态），邪魔（魔鬼），守序邪恶」）：
  // 退回到「已知生物类型词」在去括号后的整行里搜索
  const KNOWN_TYPES = /(不死生物|元素生物|天界生物|异怪|怪兽|构装生物|植物|泥怪|类人生物|精类生物|精类|邪魔|魔鬼|恶魔|野兽|龙类|元素|构装体)/;
  if (!creatureType) {
    const bare = t.replace(/[（(][^）)]*[）)]/g, '');
    const km = KNOWN_TYPES.exec(bare);
    if (km) creatureType = km[1];
  }
  return { size, creatureType, alignment };
}

/** stat 区 → 结构化字段 + 属性行 + 未识别行（如「使用“大法师”的数据…」） */
function parseMonsterStatBlock(statLines) {
  const out = {};
  for (const [key, re] of MONSTER_FIELD_RES) {
    for (const l of statLines) {
      const m = re.exec(l);
      if (m && m[1].trim()) { out[key] = m[1].trim(); break; }
    }
  }
  // 五属性行可能一行/多行、带不带冒号、含「—」「∞」「见表格」等非数值
  const attrLines = statLines.filter(l => new RegExp('^(?:' + MONSTER_ATTR_NAMES.join('|') + ')\\s*[：:]?\\s*').test(l));
  const attrText = attrLines.join('');
  const abilities = [];
  for (const name of MONSTER_ATTR_NAMES) {
    const m = new RegExp(name + '\\s*[：:]?\\s*(\\d+|—|–|∞|无|见表格)').exec(attrText);
    if (!m) continue;
    const raw = m[1];
    const score = /^\d+$/.test(raw) ? +raw : null;
    const after = attrText.slice(m.index + m[0].length, m.index + m[0].length + 12);
    const mm = /^[（(]\s*([+\-−]?\s*(?:\d+|∞))\s*[）)]/.exec(after);
    let mod = null;
    if (mm) {
      const ms = mm[1].replace(/\s+/g, '').replace('−', '-');
      if (/^[+\-]?\d+$/.test(ms)) mod = +ms;
    }
    abilities.push(score == null ? { name, raw } : { name, score, mod });
  }
  if (abilities.length) out.abilities = abilities;
  if (attrText) out.abilityText = attrText;
  // 未识别的 stat 区行（NPC 变体「使用XX的数据」等，详情页需要原样展示，不能静默丢）。
  // 少数条目漏了「语言：」标签（如舞翼索尔兽正文只有「理解通用语，但不会说」），按内容归位。
  const extra = [];
  for (const l of statLines) {
    if (attrLines.includes(l)) continue;
    if (MONSTER_FIELD_RES.some(([, re]) => re.test(l))) continue;
    if (!out.languages && /(语|不会说|心灵感应|心灵链接)/.test(l)) { out.languages = l; continue; }
    extra.push(l);
  }
  if (extra.length) out.extraText = extra.join('\n');
  return out;
}

/** 怪物合集页 → 条目数组（与 qq-dice collectMonsters 的行切分语义保持一致） */
function parseMonsters() {
  const dir = path.join(SRC, '怪物');
  if (!fs.existsSync(dir)) return [];
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (!/\.files$/i.test(e.name)) walk(full); continue; }
      if (/\.html?$/i.test(e.name)) files.push(full);
    }
  })(dir);
  const monsters = [];
  // 「纯数值怪」是纯数值表，不是 stat block 条目（骰子侧同样排除）
  const usable = files.filter(f => !/纯数值怪/.test(f));
  for (const file of usable) {
    const rel = relUrl(file); // 怪物/<生物类型>/<CR组>.htm
    const parts = rel.split('/');
    const page = parts.length >= 3 ? parts[1] : '怪物';
    const lines = htmlToLines(readText(file));
    const entries = [];
    for (let i = 1; i < lines.length; i++) {
      if (!isMonsterTypeAnchor(lines, i)) continue;
      const name = lines[i - 1];
      if (!isMonsterNameLine(name)) continue;
      let descStart = i - 1;
      while (descStart - 1 >= 0 && i - 1 - (descStart - 1) < 3 && isMonsterDescLine(lines[descStart - 1])) descStart--;
      entries.push({ nameIdx: i - 1, typeIdx: i, descStart });
    }
    // 整页都没有锚点（整页模板怪）：把整页作为一条，用文件名命名（保持与骰子侧一致）
    if (!entries.length) {
      const title = parts[parts.length - 1].replace(/\.html?$/i, '');
      const text = lines.join('\n');
      monsters.push({
        id: rel + '#1', name: title, type: '', desc: '', cr: '', crText: '', crNum: null,
        text, page, category: page, url: rel, sections: [{ name: '', start: 0 }],
      });
      continue;
    }
    let seq = 0;
    for (let k = 0; k < entries.length; k++) {
      const e = entries[k];
      const next = entries[k + 1];
      const end = next ? next.descStart : lines.length;
      const text = lines.slice(e.nameIdx, end).filter(Boolean).join('\n');
      const typeLine = lines[e.typeIdx];
      // 与骰子侧同口径：从正文里取「挑战等级：」后的整行，截 24 字符（保持字段兼容）
      const crHit = text.match(/挑战等级[：:]\s*([^\n]+)/);
      const cr = crHit ? crHit[1].trim().slice(0, 24) : '';
      // stat 区 = 类型行之后到第一个分节标题；分节标题缺失时退到第一个「【」条目。
      // 两者取更早者：有些页面缺「特性」标题、直接以【条目开头（否则这些条目会被当成 stat 行漏掉）
      const lines2 = lines.slice(e.nameIdx, end);
      let sectionStart = -1;
      for (let i = 2; i < lines2.length; i++) {
        if (MONSTER_SECTION_RE.test(lines2[i]) || /^[·]?【/.test(lines2[i])) { sectionStart = i; break; }
      }
      const statLines = lines2.slice(2, sectionStart < 0 ? lines2.length : sectionStart);
      const stat = parseMonsterStatBlock(statLines);
      const typeInfo = parseMonsterType(typeLine);
      // 分节（特性/动作/附赠动作/…）只记「标题 + 在 text 里的起始行号」，
      // 不重复存正文（正文已在 text 里；重复存储会让 monsters.json 膨胀约 50%）。
      // 前端按相邻分节的 start 切片还原；骰子侧只读 text，不受影响。
      const sections = [];
      if (sectionStart >= 0) {
        let cur = null;
        for (let i = sectionStart; i < lines2.length; i++) {
          const l = lines2[i];
          if (MONSTER_SECTION_RE.test(l)) { cur = { name: l, start: i }; sections.push(cur); continue; }
          if (!cur) { cur = { name: '', start: i }; sections.push(cur); }
        }
      }
      seq += 1;
      monsters.push({
        id: rel + '#' + seq,
        name: lines[e.nameIdx],
        type: typeLine,
        category: page,
        page,
        url: rel,
        size: typeInfo.size,
        creatureType: typeInfo.creatureType,
        alignment: typeInfo.alignment,
        desc: e.descStart < e.nameIdx ? lines.slice(e.descStart, e.nameIdx).join(' ') : '',
        cr,
        crText: crHit ? crHit[1].trim() : '',
        crNum: parseCrNum(crHit ? crHit[1].trim() : ''),
        text,
        sections,
        ...stat,
      });
    }
  }
  return monsters;
}

/** 挑战等级 → 数值（「1/2」=0.5、「10（无坐骑）或11（有坐骑）」取首个数字；不可解析 = null） */
function parseCrNum(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  const frac = /^(\d+)\s*\/\s*(\d+)/.exec(t);
  if (frac) return +frac[1] / +frac[2];
  const m = /^[-+]?\d+(?:\.\d+)?/.exec(t);
  return m ? +m[0] : null;
}

// ---------- 5b. 核心规则表（来自 1.59 规则书正文） ----------
function buildRules(version) {
  return {
    version,
    attributes: ['力量', '敏捷', '体质', '智力', '感知'],
    buyPoints: 32,
    buyTable: { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9, 16: 12 },
    standardArrays: [
      { name: '标准属性组 A', values: [16, 16, 14, 9, 8] },
      { name: '标准属性组 B', values: [16, 15, 14, 12, 8] },
      { name: '标准属性组 C', values: [15, 14, 14, 14, 10] },
    ],
    abilityModTable: [[0, 1, -5], [2, 3, -4], [4, 5, -3], [6, 7, -2], [8, 9, -1],
      [10, 11, 0], [12, 13, 1], [14, 15, 2], [16, 17, 3], [18, 19, 4],
      [20, 21, 5], [22, 23, 6], [24, 25, 7], [26, 27, 8], [28, 29, 9], [30, 30, 10]],
    skills: [
      { name: '运动', attr: '力量' }, { name: '威吓', attr: '力量' },
      { name: '体操', attr: '敏捷' }, { name: '巧手', attr: '敏捷' }, { name: '隐匿', attr: '敏捷' },
      { name: '奥秘', attr: '智力' }, { name: '灵能', attr: '智力' }, { name: '历史', attr: '智力' },
      { name: '调查', attr: '智力' }, { name: '自然', attr: '智力' }, { name: '宗教', attr: '智力' },
      { name: '表演', attr: '智力' },
      { name: '医药', attr: '感知' }, { name: '洞悉', attr: '感知' }, { name: '察觉', attr: '感知' },
      { name: '求生', attr: '感知' }, { name: '交涉', attr: '感知' },
    ],
    // 玩家角色升级表（等级, 专长数, 主要属性提升, 次要属性提升, 熟练加值, 资金）
    levelTable: [
      [1, 2, 0, 0, 2, '500gp'], [2, 2, 0, 0, 2, '800gp'], [3, 3, 1, 0, 2, '1200gp'],
      [4, 3, 1, 0, 2, '1800gp'], [5, 3, 1, 1, 3, '3000gp'], [6, 4, 2, 1, 3, '4400gp'],
      [7, 4, 2, 1, 3, '6000gp'], [8, 4, 2, 1, 3, '8500gp'], [9, 5, 3, 1, 4, '11000gp'],
      [10, 5, 3, 2, 4, '14500gp'], [11, 5, 3, 2, 4, '20000gp'], [12, 6, 4, 2, 4, '27000gp'],
      [13, 6, 4, 2, 5, '38000gp'], [14, 6, 4, 2, 5, '51000gp'], [15, 7, 5, 3, 5, '66000gp'],
      [16, 7, 5, 3, 5, '84000gp'], [17, 7, 5, 3, 6, '110000gp'], [18, 8, 6, 3, 6, '130000gp'],
      [19, 8, 6, 3, 6, '150000gp'], [20, 8, 6, 4, 6, '180000gp'],
    ],
    formulas: {
      hp: '10+职业等级×（职业生命骰期望值+体质调整值）',
      ac: {
        naked: '8+熟练加值+敏捷调整值',
        light: '10+熟练加值+敏捷调整值',
        medium: '13+熟练加值+敏捷调整值（敏捷最大+2）',
        heavy: '16+熟练加值',
        mageArmor: '11+熟练加值+敏捷调整值',
        monk: '8+熟练加值+敏捷调整值+感知调整值',
        barbarian: '8+熟练加值+敏捷调整值+体质调整值',
        shield: '+2',
      },
      dc: '8+熟练加值+关键属性调整值',
      save: '属性调整值+熟练加值（若熟练）',
      attack: '熟练加值+属性调整值',
      profFirst: '1级时2个专长，此后每3级+1个',
      majorAttr: '每3级主要属性+1',
      minorAttr: '每5级次要属性（其余4项）+1',
      attrCap: 24,
    },
  };
}

// ---------- 主流程 ----------
if (!fs.existsSync(SRC) || !fs.readdirSync(SRC).some(f => /\.hhc$/i.test(f))) {
  console.error('[parse-card-data] 5z_src 下未找到 .hhc，请先反编译 CHM');
  process.exit(1);
}
const version = /(\d+(?:\.\d+)+)/.exec(fs.readdirSync(SRC).find(f => /\.hhc$/i.test(f)))?.[1] || '';
const rules = buildRules(version);
const races = parseRaces();
const classes = parseClasses();
const feats = parseFeats();
const spells = parseSpells();
const classSpells = parseClassSpells();
const maneuvers = parseManeuvers();
const programs = parsePrograms();
const magicItems = parseMagicItems();
const monsters = parseMonsters();

// ---------- 职业特性 / 子职特性（骰子「职业特性」查询数据源，2026-10-27） ----------
// 自检口径：条数下限 + 空正文 + 同键重复 + 每职业覆盖（防止源页结构变化后静默丢条目）。
const classFeatures = extractClassFeatures(classes);
const subFeatureResult = extractSubclassFeatures(classes);
const subclassFeatures = subFeatureResult.features;
{
  const errs = [];
  const dupKey = (list, keyOf) => {
    const seen = new Set();
    for (const f of list) {
      const k = keyOf(f);
      if (seen.has(k)) errs.push('重复键: ' + k);
      seen.add(k);
    }
  };
  if (classFeatures.length < 210) errs.push(`职业特性条数 ${classFeatures.length} < 下限 210`);
  if (subclassFeatures.length < 900) errs.push(`子职特性条数 ${subclassFeatures.length} < 下限 900`);
  for (const f of classFeatures) {
    if (!f.name || !f.text) errs.push(`职业特性缺名字/正文：${f.cls}/${f.name}`);
    if (!Array.isArray(f.levels)) errs.push(`职业特性 levels 非数组：${f.cls}/${f.name}`);
  }
  for (const f of subclassFeatures) {
    if (!f.name || !f.text) errs.push(`子职特性缺名字/正文：${f.cls}/${f.sub}/${f.name}`);
    if (!(f.level >= 0 && f.level <= 30)) errs.push(`子职特性等级非法：${f.cls}/${f.sub}/${f.name}=${f.level}`);
  }
  dupKey(classFeatures, f => f.cls + '|' + f.name);
  dupKey(subclassFeatures, f => f.cls + '|' + f.sub + '|' + f.name);
  for (const c of classes) {
    if (!classFeatures.some(f => f.cls === c.name)) errs.push(`职业无特性：${c.name}`);
  }
  if (subFeatureResult.stats.pages < 165) errs.push(`有特性的子职页 ${subFeatureResult.stats.pages} < 下限 165`);
  if (errs.length) {
    console.error('[parse-card-data] 职业/子职特性自检失败：');
    for (const e of errs.slice(0, 30)) console.error('  ✗ ' + e);
    if (errs.length > 30) console.error(`  … 共 ${errs.length} 条`);
    process.exit(1);
  }
  const noLevel = classFeatures.filter(f => !f.levels.length).length + subclassFeatures.filter(f => !f.level).length;
  console.log(
    `[parse-card-data] 特性自检通过：职业特性 ${classFeatures.length} 条（${classFeatures.filter(f => f.levels.length).length} 条可定级）｜` +
    `子职特性 ${subclassFeatures.length} 条（${subFeatureResult.stats.pages} 页；${noLevel} 条无等级标注；跳过变体页 ${subFeatureResult.stats.skippedVariant}、无特性页 ${subFeatureResult.stats.skippedNoFeature}）`
  );
}

// ---------- 怪物数据自检（防静默串页/丢条目） ----------
// 教训（2026-10-21 骰子侧真实反馈）：聚合页解析最常见的静默错误是「下一项被并入上一项」，
// 用户看到的是「文本多截了一段」。用结构断言在构建期抓住，不等用户反馈。
{
  const errs = [];
  const ids = new Set();
  for (const m of monsters) {
    if (ids.has(m.id)) errs.push('重复 id: ' + m.id);
    ids.add(m.id);
    if (!m.name) errs.push('怪物缺少名称: ' + m.id);
    if (!m.text) errs.push('怪物正文为空: ' + m.id);
  }
  if (monsters.length < 600) errs.push(`怪物条数 ${monsters.length} < 下限 600（源页结构可能变了）`);
  // 同一只怪正文里出现第二个完整 stat block ⇒ 类型行未被识别，下一只怪被并了进来
  // （表格被摊平成行后可能有单独一行的「AC」表头，因此要求标签后必须跟冒号/空格/数字）
  const multiStat = monsters.filter(m => (m.text.match(/^(?:AC|护甲等级|防御等级)(?:[：:]|[ \t]|(?=\d))/gm) || []).length > 1);
  if (multiStat.length) errs.push('疑似串页（同一正文多个 AC stat block）: ' + multiStat.slice(0, 8).map(m => m.name).join(' / ') + (multiStat.length > 8 ? ' …' : ''));
  // AC/正文结构化解析覆盖率（源站确有 5 个 NPC 变体条目「使用XX的数据」，允许少量缺失）
  const withAc = monsters.filter(m => m.ac).length / monsters.length;
  const withHp = monsters.filter(m => m.hp).length / monsters.length;
  if (withAc < 0.95) errs.push(`AC 解析覆盖率 ${(withAc * 100).toFixed(1)}% < 95%`);
  if (withHp < 0.95) errs.push(`HP 解析覆盖率 ${(withHp * 100).toFixed(1)}% < 95%`);
  const noCr = monsters.filter(m => !m.crText).length;
  if (errs.length) {
    console.error('[parse-card-data] 怪物数据自检失败：');
    for (const e of errs) console.error('  ✗ ' + e);
    process.exit(1);
  }
  const unparsedCr = monsters.filter(m => !m.crText).map(m => m.name);
  console.log(`[parse-card-data] 怪物自检通过：${monsters.length} 只（AC ${(withAc * 100).toFixed(1)}% / HP ${(withHp * 100).toFixed(1)}%；无挑战等级 ${noCr} 条${unparsedCr.length ? '：' + unparsedCr.join('、') : ''}）`);
}
// ---------- 锚点解析（2026-10-24「超链接索引」） ----------
// 为「一页多词条」的目标页定位每个词条标题，写入 anchor 字段（url 保持不变，避免破坏骰子侧兼容）：
//   - kw-<归一化名字>，同页重复加 -2/-3
//   - 页级词条（职业/种族/子职、一页一条的专长等）anchor=''，链接到页顶
//   - 「种族专长」是种族页里的特性片段（名字含整段话），暂不参与互链，anchor=''
// 定位口径见 lib/anchorize.mjs 的 CATEGORY_STYLE（run 级加粗/字号/颜色）。
function attachAnchors() {
  const cats = { spells, maneuvers, programs, feats, magicItems, monsters };
  for (const c of classes) { c.anchor = ''; for (const s of c.subclasses || []) s.anchor = ''; }
  for (const r of races) r.anchor = '';
  for (const r of races) for (const f of r.raceFeats || []) f.anchor = '';
  const pageUsedIds = new Map(); // url -> Set(已用锚点 id)，跨类别共用，保证页内唯一
  const pageHtml = new Map();
  const getHtml = (url) => {
    if (!pageHtml.has(url)) pageHtml.set(url, readText(path.join(SRC, url)));
    return pageHtml.get(url);
  };
  const stats = [];
  for (const [catKey, entries] of Object.entries(cats)) {
    const byUrl = new Map();
    for (const e of entries) {
      const url = e.url || e.page;
      if (!url) { e.anchor = ''; continue; }
      if (!byUrl.has(url)) byUrl.set(url, []);
      byUrl.get(url).push(e);
    }
    let located = 0, missing = 0, pageLevel = 0;
    const misses = [];
    for (const [url, list] of byUrl) {
      for (const e of list) e.anchor = '';
      if (list.length <= 1) { pageLevel += list.length; continue; }
      // 种族专长不参与互链/锚点
      const need = list.filter(e => !(catKey === 'feats' && e.category === '种族专长'));
      if (!need.length) continue;
      const html = getHtml(url);
      let res;
      try {
        res = locateAnchors(html, need.map(e => e.name), catKey);
      } catch (err) {
        console.warn(`[parse-card-data] 锚点定位异常 ${url}: ${err.message}`);
        continue;
      }
      if (!pageUsedIds.has(url)) pageUsedIds.set(url, new Set());
      const used = pageUsedIds.get(url);
      for (let i = 0; i < need.length; i++) {
        if (!res.found[i]) {
          missing++;
          if (misses.length < 8) misses.push(need[i].name);
          continue;
        }
        need[i].anchor = makeAnchorId(canonName(need[i].name), used);
        located++;
      }
    }
    stats.push({ catKey, located, missing, pageLevel, misses });
  }
  return stats;
}

// 把种族页内的"种族专长"合并进专长列表
for (const r of races) {
  for (const f of r.raceFeats || []) {
    feats.push({ name: f.name, category: '种族专长', page: r.url, url: r.url, text: f.text });
  }
}

// ---------- 锚点解析 + 自检（「超链接索引」P0） ----------
// 门禁：核心类别缺锚点数不得超过实测基线（源站结构变化时会立刻失败，防止锚点静默失效）。
// 先例：怪物页 17 条（毛绒动物·X 变体 / 「XXX，称号」式名字）、程序 1 条（同条异写）为已知基线。
const anchorStats = attachAnchors();
{
  const ANCHOR_MAX_MISSING = { spells: 0, maneuvers: 0, programs: 2, magicItems: 0, feats: 0, monsters: 25 };
  const errs = [];
  const parts = [];
  for (const s of anchorStats) {
    parts.push(`${s.catKey} ${s.located} 锚点${s.missing ? `（缺 ${s.missing}）` : ''}`);
    if (s.missing > ANCHOR_MAX_MISSING[s.catKey]) {
      errs.push(`${s.catKey} 缺锚点 ${s.missing} 条 > 基线 ${ANCHOR_MAX_MISSING[s.catKey]}：${s.misses.join('、')}`);
    }
  }
  console.log(`[parse-card-data] 锚点: ${parts.join(' | ')} | 页级词条（跳页顶）${anchorStats.reduce((n, s) => n + s.pageLevel, 0)}`);
  for (const s of anchorStats) {
    if (s.missing && s.missing <= ANCHOR_MAX_MISSING[s.catKey]) {
      console.log(`[parse-card-data]   ${s.catKey} 已知缺锚点 ${s.missing} 条（回退页顶）：${s.misses.join('、')}${s.missing > 8 ? ' …' : ''}`);
    }
  }
  if (errs.length) {
    console.error('[parse-card-data] 锚点自检失败：');
    for (const e of errs) console.error('  ✗ ' + e);
    process.exit(1);
  }
}

const outDir = path.join(OUT, 'assets', 'card-data');
fs.mkdirSync(outDir, { recursive: true });
const write = (name, data) => fs.writeFileSync(path.join(outDir, name), JSON.stringify(data), 'utf8');
write('rules.json', rules);
write('races.json', races);
write('classes.json', classes);
write('feats.json', feats);
write('spells.json', spells);
write('class-spells.json', classSpells);
write('maneuvers.json', maneuvers);
write('programs.json', programs);
write('magic-items.json', magicItems);
write('monsters.json', monsters);
// 职业特性 / 子职特性：单独成文件（不进 card-data.js——骰子构建脚本直接读 JSON；体积见 site 仓库）
write('features.json', {
  version: version || '',
  generatedBy: '5z_build/parse-card-data.mjs',
  classFeatures,
  subclassFeatures,
});

console.log(`[parse-card-data] 规则 v${version || '?'}: 种族 ${races.length} | 职业 ${classes.length} | 专长 ${feats.length} | 法术 ${spells.length} | 职业法表 ${classSpells.length} | 战技 ${maneuvers.length} | 程序 ${programs.length} | 魔法物品 ${magicItems.length} | 怪物 ${monsters.length}`);
console.log(`[parse-card-data] 输出: ${outDir}`);
