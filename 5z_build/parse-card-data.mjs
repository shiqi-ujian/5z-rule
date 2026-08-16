// ============================================================
// 5z 车卡数据解析器：从 5z_src/（CHM 反编译产物）提取角色创建数据
// 输出: 5z_web/assets/card-data/{rules,races,classes,feats}.json
// 由 build.mjs 在构建流程末尾调用；也可独立运行：
//   node 5z_build/parse-card-data.mjs [输出目录，默认 5z_web]
// ============================================================
import fs from 'node:fs';
import path from 'node:path';

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
    // 判断字号/加粗/颜色
    let size = 12;
    const sm = /font-size:(\d+(?:\.\d+)?)\.0000pt/i.exec(inner);
    if (sm) size = parseFloat(sm[1]);
    const bold = /font-weight:\s*bold/i.test(inner);
    const color118 = /color:rgb\(118,45,0\)/i.test(inner);
    const red = /color:rgb\(128,0,0\)/i.test(inner);
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
        title = title.replace(/\s*[A-Za-z][A-Za-z\s]*$/, '').trim() || name;
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
    if (/职业和兼职|非玩家职业/.test(name)) continue;
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
            feats.push({ name, category: bigCat, sub: subCat, page: pageLabel, text });
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
      let name = flow[i].text.replace(/\s*[A-Za-z][A-Za-z\s']*$/, '').trim();
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
      let name = flow[i].text.replace(/\s*[A-Za-z][A-Za-z\s']*$/, '').trim();
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
          spellName = x.text.replace(/\s*[A-Za-z][A-Za-z\s']*$/, '').trim();
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
// 把种族页内的"种族专长"合并进专长列表
for (const r of races) {
  for (const f of r.raceFeats || []) {
    feats.push({ name: f.name, category: '种族专长', page: r.url, text: f.text });
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

console.log(`[parse-card-data] 规则 v${version || '?'}: 种族 ${races.length} | 职业 ${classes.length} | 专长 ${feats.length} | 法术 ${spells.length} | 职业法表 ${classSpells.length} | 战技 ${maneuvers.length} | 程序 ${programs.length}`);
console.log(`[parse-card-data] 输出: ${outDir}`);
