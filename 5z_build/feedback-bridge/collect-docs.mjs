// ============================================================
// 腾讯文档收集表读取桥
//   自动读取群友在腾讯文档收集表（链接发 QQ 群）提交的问题，
//   写入 问题收集/inbox/<id>.json，供 agent 定时处理。
//
// 用法（在仓库根目录或任意目录运行均可）：
//   node 5z_build/feedback-bridge/collect-docs.mjs            单次读取
//   node 5z_build/feedback-bridge/collect-docs.mjs --probe    校准：dump 结果页 DOM 结构
//   node 5z_build/feedback-bridge/collect-docs.mjs --login    有头打开登录页（一次性登录）
//   node 5z_build/feedback-bridge/collect-docs.mjs --manual   导入 问题收集/manual/ 下的 CSV/XLSX
//   node 5z_build/feedback-bridge/collect-docs.mjs --serve    常驻轮询（watch-collect 调用）
//
// 前置：5z_build/feedback-bridge/config.json（由 config.example.json 复制并填写）。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { launchEdge, getPageTarget, connect, send, evalJs, waitFor, nav, sleep } from './cdp.mjs';
import { readXlsxRows } from './xlsx-util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BRIDGE = path.join(ROOT, '5z_build', 'feedback-bridge');
const INBOX = path.join(ROOT, '问题收集', 'inbox');
const MANUAL = path.join(ROOT, '问题收集', 'manual');
const MANUAL_DONE = path.join(MANUAL, 'imported');
const ATTACH = path.join(ROOT, '问题收集', 'attachments');
const CONFIG_PATH = path.join(BRIDGE, 'config.json');
const STATE_PATH = path.join(BRIDGE, 'feedback-state.json');
const PROFILE = path.join(BRIDGE, 'docs-profile');
const ALERTS = path.join(ROOT, '问题收集', 'alerts.md');

for (const d of [INBOX, MANUAL, MANUAL_DONE, ATTACH]) fs.mkdirSync(d, { recursive: true });

const now = () => new Date();
const iso = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}+08:00`;
};

// ---------- 配置 / 状态 ----------
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`[配置缺失] 请先复制 5z_build/feedback-bridge/config.example.json 为 config.json 并填写 formResultUrl。`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return { lastSeenTs: null, seen: [], lastProbe: null }; }
}
function saveState(s) { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }

function alert(msg) {
  const line = `- ${iso()} ${msg}`;
  fs.appendFileSync(ALERTS, line + '\n');
  console.error('[ALERT]', line);
}

// ---------- 工具 ----------
function hash(s) { return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12); }

function issueId(ts) {
  const m = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(ts || iso());
  const base = m ? `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}` : now().toISOString().replace(/\D/g, '').slice(0, 14);
  return `${base}-${hash(ts + Math.random()).slice(0, 4)}`;
}

/** 由块文本按字段标签解析字段值（Node 侧） */
function parseBlock(text, labels) {
  const out = {};
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let cur = null;
  for (const line of lines) {
    let matched = null;
    for (const [key, label] of Object.entries(labels)) {
      const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^${esc}\\s*[：:)\\]]?\\s*(.*)$`);
      const m = line.match(re);
      if (m) { matched = [key, m[1].trim()]; break; }
    }
    if (matched) {
      cur = matched[0];
      out[cur] = matched[1];
    } else if (cur && out[cur]) {
      out[cur] += '\n' + line; // 续行（如多行描述）
    } else if (cur) {
      out[cur] = line;
    }
  }
  for (const k of Object.keys(out)) out[k] = out[k].replace(/\n{2,}/g, '\n').trim();
  return out;
}

/** DOM 提取的页面内脚本：找出包含时间戳的候选条目块 */
const EXTRACT_JS = `(() => {
  const TS = /20\\d{2}[-/.年]\\d{1,2}[-/月.]\\d{1,2}[日]?([ T]\\d{1,2}:\\d{2}(:\\d{2})?)?|\\d{1,2}[-/]\\d{1,2}[日]?\\s+\\d{1,2}:\\d{2}/;
  const seen = new Set();
  const blocks = [];
  const all = Array.from(document.querySelectorAll('div,li,tr,section,article'));
  for (const el of all) {
    const t = (el.innerText || '').replace(/\\s+/g, '\\n').trim();
    if (!t || t.length < 20 || t.length > 6000 || !TS.test(t)) continue;
    // 只要最深的匹配块
    let p = el.parentElement;
    while (p && p !== document.body) {
      const pt = (p.innerText || '').replace(/\\s+/g, '\\n').trim();
      if (pt === t || (pt.length < 20 || pt.length > 6000)) break;
      if (TS.test(pt)) { t = pt; el = p; }
      p = p.parentElement;
    }
    const key = t.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    const imgs = Array.from(el.querySelectorAll('img')).map(i => i.src).filter(s => s && !s.startsWith('data:'));
    blocks.push({ text: t, imgs });
  }
  blocks.sort((a, b) => a.text.length - b.text.length);
  return blocks.slice(0, 200);
})()`;

// ---------- DOM 模式提取 ----------
async function extractDom(ws, config) {
  const labels = config.fieldMap || {};
  const rows = await evalJs(ws, EXTRACT_JS);
  const out = [];
  for (const r of rows) {
    const tsM = /(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?|\d{1,2}[-/]\d{1,2}[日]?\s+\d{1,2}:\d{2})/.exec(r.text);
    const ts = tsM ? tsM[1] : null;
    if (!ts) continue;
    const fields = parseBlock(r.text, labels);
    out.push({ ts, fields, imgs: r.imgs, raw: r.text.slice(0, 2000) });
  }
  return out;
}

// ---------- 导出 xlsx 模式（兜底） ----------
async function extractExport(ws, config) {
  const dlDir = path.join(BRIDGE, '_dl');
  fs.mkdirSync(dlDir, { recursive: true });
  await send(ws, 'Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  // 找「导出」按钮（文案匹配）
  const clicked = await evalJs(ws, `(() => {
    const btns = Array.from(document.querySelectorAll('button,span,a,div'));
    const b = btns.find(el => {
      const t = (el.innerText || '').trim();
      return /^(导出|导出为|导出数据|下载)/.test(t) && t.length <= 8 && el.offsetParent !== null;
    });
    if (!b) return false;
    b.click(); return true;
  })()`);
  if (!clicked) { console.warn('[export] 未找到导出按钮'); return []; }
  await sleep(4000);
  const files = fs.readdirSync(dlDir).filter((f) => /\.(xlsx|xls|csv)$/i.test(f));
  if (!files.length) { console.warn('[export] 导出目录为空'); return []; }
  const newest = files.map((f) => ({ f, t: fs.statSync(path.join(dlDir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
  const fp = path.join(dlDir, newest.f);
  let rows;
  if (/\.csv$/i.test(fp)) {
    rows = fs.readFileSync(fp, 'utf8').split(/\r?\n/).map((l) => l.split(',').map((c) => c.replace(/^"|"$/g, '')));
  } else {
    rows = readXlsxRows(fp);
  }
  // 表头映射
  const labels = config.fieldMap || {};
  const headerIdx = rows.findIndex((r) => Object.values(labels).some((l) => r.includes(l)));
  if (headerIdx < 0) { console.warn('[export] 未找到表头行'); return []; }
  const header = rows[headerIdx];
  const colForKey = {};
  for (const [key, label] of Object.entries(labels)) {
    const i = header.findIndex((h) => String(h).trim().includes(label));
    if (i >= 0) colForKey[key] = i;
  }
  const out = [];
  for (const r of rows.slice(headerIdx + 1)) {
    if (!r.length || r.every((c) => !String(c).trim())) continue;
    const fields = {};
    for (const [key, i] of Object.entries(colForKey)) fields[key] = String(r[i] ?? '').trim();
    const tsCell = r.find((c) => /20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/.test(String(c)));
    const ts = tsCell ? String(tsCell) : null;
    if (!ts) continue;
    out.push({ ts, fields, imgs: [], raw: r.join(' | ').slice(0, 2000) });
  }
  // 清理下载
  try { fs.rmSync(fp, { force: true }); } catch { /* ignore */ }
  return out;
}

// ---------- 写入 inbox ----------
function isDuplicate(row, state) {
  const key = hash(row.ts + '|' + (row.fields.title || '') + '|' + (row.fields.description || ''));
  if (state.seen.includes(key)) return true;
  return false;
}

function writeInbox(row, state, config, source) {
  if (isDuplicate(row, state)) return false;
  const labels = config.fieldMap || {};
  const id = issueId(row.ts);
  const fields = row.fields || {};
  const issue = {
    id,
    source,
    ts: row.ts,
    reporter: fields.reporter || '',
    category: fields.category || '其他',
    page: fields.page || '',
    title: fields.title || (fields.description || '').slice(0, 40) || '（无标题）',
    description: fields.description || '',
    expected: fields.expected || '',
    reproduce: fields.reproduce || '',
    attachments: [],
    status: 'new',
    resolution: '',
    released: '',
    doneAt: null,
    raw: row.raw || '',
  };
  // 图片附件（同源 blob 抓取）
  if (row.imgs && row.imgs.length) {
    const dir = path.join(ATTACH, id);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < row.imgs.length; i++) {
      const ext = /\.(png|jpe?g|gif|webp)(\?|$)/i.exec(row.imgs[i]);
      const name = `${i + 1}.${ext ? (ext[1].toLowerCase() === 'jpeg' ? 'jpg' : ext[1].toLowerCase()) : 'img'}`;
      try { fs.copyFileSync(new URL(row.imgs[i]), path.join(dir, name)); }
      catch { /* 跨域图抓不到就跳过 */ }
    }
    const saved = fs.readdirSync(dir).filter((f) => !f.startsWith('.'));
    issue.attachments = saved.map((f) => `attachments/${id}/${f}`);
  }
  fs.writeFileSync(path.join(INBOX, `${id}.json`), JSON.stringify(issue, null, 2));
  const key = hash(row.ts + '|' + (fields.title || '') + '|' + (fields.description || ''));
  state.seen.push(key);
  if (state.seen.length > 300) state.seen = state.seen.slice(-300);
  if (row.ts && (!state.lastSeenTs || row.ts > state.lastSeenTs)) state.lastSeenTs = row.ts;
  console.log('[new]', id, '←', (fields.title || '').slice(0, 40) || '(无标题)');
  return true;
}

// ---------- 校准探测 ----------
async function probe(ws, config) {
  const info = await evalJs(ws, `(() => {
    const tables = Array.from(document.querySelectorAll('table')).slice(0, 3).map(t => ({
      rows: t.querySelectorAll('tr').length,
      cells: Array.from(t.querySelectorAll('tr')).slice(0, 3).map(tr => Array.from(tr.querySelectorAll('th,td')).map(c => (c.innerText || '').trim().slice(0, 30))),
    }));
    const buttons = Array.from(document.querySelectorAll('button,span,a,[role="button"]'))
      .map(el => (el.innerText || '').trim()).filter(t => t && t.length <= 10);
    const body = document.body.innerText.replace(/\\s+/g, ' ').slice(0, 600);
    return { title: document.title, url: location.href, tables, buttons: [...new Set(buttons)].slice(0, 30), bodyPreview: body };
  })()`);
  const blocks = await evalJs(ws, EXTRACT_JS);
  const candidates = blocks.slice(0, 20).map((b) => ({ text: b.text.slice(0, 300), imgs: b.imgs.length }));
  return { ...info, candidateCount: blocks.length, candidates };
}

// ---------- 各模式 ----------
async function runOnce() {
  const config = loadConfig();
  const state = loadState();
  if (!config.formResultUrl || !/^https?:\/\//.test(config.formResultUrl)) {
    console.error('[配置错误] config.json 中 formResultUrl 无效。');
    process.exit(2);
  }
  const edge = await launchEdge({ profileDir: PROFILE });
  let ws;
  try {
    const target = await getPageTarget(edge.port);
    ws = await connect(target.webSocketDebuggerUrl);
    await send(ws, 'Page.enable');
    await send(ws, 'Runtime.enable');
    console.log('[nav]', config.formResultUrl);
    await nav(ws, config.formResultUrl, `document.body && document.body.innerText.length > 300`, 45000);
    // 等待可能的登录/加载完成
    await sleep(1500);

    let rows = [];
    const mode = (config.extractMode || 'auto').toLowerCase();
    if (mode === 'export') {
      rows = await extractExport(ws, config);
    } else {
      rows = await extractDom(ws, config);
      if (mode === 'auto' && rows.length === 0) {
        console.log('[auto] DOM 无候选，尝试导出兜底…');
        rows = await extractExport(ws, config);
      }
    }
    let added = 0;
    for (const r of rows) if (writeInbox(r, state, config, 'tencent-docs-form')) added++;
    console.log(`[done] 候选 ${rows.length}，新增 ${added}`);
    if (added === 0 && rows.length === 0) {
      alert('读取桥未从收集表解析到任何提交（可能页面结构变化或未登录）。请运行 --probe 校准，或重跑 login-docs.bat 登录。');
    }
    saveState(state);
  } catch (e) {
    alert(`读取桥失败：${e.message.slice(0, 300)}`);
    throw e;
  } finally {
    if (ws) { try { await send(ws, 'Browser.close'); } catch { /* ignore */ } }
    await edge.close();
  }
}

async function runProbe() {
  const config = loadConfig();
  const state = loadState();
  const edge = await launchEdge({ profileDir: PROFILE });
  let ws;
  try {
    const target = await getPageTarget(edge.port);
    ws = await connect(target.webSocketDebuggerUrl);
    await send(ws, 'Page.enable');
    await send(ws, 'Runtime.enable');
    await nav(ws, config.formResultUrl, `document.body && document.body.innerText.length > 300`, 45000);
    await sleep(2000);
    const info = await probe(ws, config);
    state.lastProbe = { at: iso(), ...info };
    saveState(state);
    console.log(JSON.stringify(info, null, 2));
    console.log('\n[probe] 结果已存 feedback-state.json，供校准 extractor 用。');
  } finally {
    if (ws) { try { await send(ws, 'Browser.close'); } catch { /* ignore */ } }
    await edge.close();
  }
}

async function runLogin() {
  const config = loadConfig();
  console.log('[login] 有头打开', config.loginUrl || 'https://docs.qq.com', '请登录并保持一段时间（登录态会存入 docs-profile）。完成后关闭浏览器窗口。');
  const edge = await launchEdge({ profileDir: PROFILE, headless: false });
  const target = await getPageTarget(edge.port);
  const ws = await connect(target.webSocketDebuggerUrl);
  await send(ws, 'Page.enable');
  await nav(ws, config.loginUrl || 'https://docs.qq.com', `document.body && document.body.innerText.length > 50`, 60000);
  console.log('[login] 窗口已打开。登录完成后直接关闭浏览器即可（脚本等待窗口关闭）。');
  await new Promise((resolve) => {
    edge.proc.on('exit', resolve);
    edge.proc.on('error', resolve);
  });
}

function runManual() {
  const config = loadConfig();
  const state = loadState();
  const files = fs.readdirSync(MANUAL).filter((f) => /\.(csv|xlsx)$/i.test(f));
  if (!files.length) { console.log('[manual] 没有待导入文件。'); return; }
  let added = 0;
  for (const f of files) {
    const fp = path.join(MANUAL, f);
    let rows;
    try {
      if (/\.csv$/i.test(f)) {
        rows = fs.readFileSync(fp, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(',').map((c) => c.replace(/^"|"$/g, '').trim()));
      } else {
        rows = readXlsxRows(fp);
      }
    } catch (e) { alert(`手动导入 ${f} 失败：${e.message.slice(0, 200)}`); continue; }
    const labels = config.fieldMap || {};
    const header = rows[0] || [];
    const colForKey = {};
    for (const [key, label] of Object.entries(labels)) {
      const i = header.findIndex((h) => String(h).trim().includes(label));
      if (i >= 0) colForKey[key] = i;
    }
    for (const r of rows.slice(1)) {
      if (!r.length || r.every((c) => !String(c).trim())) continue;
      const fields = {};
      for (const [key, i] of Object.entries(colForKey)) fields[key] = String(r[i] ?? '').trim();
      const tsCell = r.find((c) => /20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/.test(String(c)));
      const row = { ts: tsCell ? String(tsCell) : iso(), fields, imgs: [], raw: r.join(' | ').slice(0, 2000) };
      if (writeInbox(row, state, config, 'manual-csv')) added++;
    }
    try { fs.renameSync(fp, path.join(MANUAL_DONE, f)); } catch { /* ignore */ }
  }
  console.log(`[manual] 新增 ${added} 条`);
  saveState(state);
}

async function runServe() {
  const config = loadConfig();
  const interval = (config.pollIntervalSec || 1800) * 1000;
  console.log(`[serve] 每 ${interval / 1000}s 轮询一次。Ctrl+C 停止。`);
  let fails = 0;
  for (;;) {
    try { await runOnce(); fails = 0; }
    catch { if (++fails >= 3) { alert(`读取桥连续失败 ${fails} 次，请检查登录与页面结构（--probe）。`); fails = 0; } }
    await sleep(interval);
  }
}

// ---------- main ----------
const arg = process.argv[2] || 'once';
try {
  if (arg === '--login') await runLogin();
  else if (arg === '--probe') await runProbe();
  else if (arg === '--manual') runManual();
  else if (arg === '--serve') await runServe();
  else await runOnce();
} catch (e) {
  console.error('[FATAL]', e.message);
  process.exit(1);
}
