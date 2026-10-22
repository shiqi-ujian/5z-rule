// ============================================================
// 旧版规则书清单：从 git 历史推算「每个历史版本最后发布时的站点状态」
//
// 归档提交怎么取：
//   版本 X 的“最终状态” = 下一个版本 X+1 的**第一个**「自动更新」提交的父提交。
//   （X 发布之后、X+1 发布之前，站点在 X 内容上的最后一次状态，含期间的站内修复）
//   最新一个历史版本在下一版发布提交还不存在时（正在构建新版本），用当前 HEAD 兜底；
//   下次构建时下一版的发布提交已存在，就会自动换成稳定的父提交，清单不再变化。
//
// 用法：
//   import { computeArchiveVersions } from './archive-versions.mjs';
//   const archive = computeArchiveVersions({ cwd, currentVersion: VERSION });
//   archive = { generatedAt, source, repo: 'owner/name', versions: [{version, label, commit, date, pages}] }
//
// 网页端由 Cloudflare Pages Function（5z_build/function-template.js）按 commit 反向代理
// GitHub 原始文件，所以这里只需要提交号，不需要把旧版内容存进仓库。
// ============================================================
import { execFileSync } from 'node:child_process';

const RELEASE_RE = /^5z 规则 (\d+(?:\.\d+)+) 版 自动更新/;

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** 从 git remote 地址里提取 owner/repo（github.com 的 https 或 ssh 形式都支持） */
export function parseRepo(remote) {
  const s = String(remote || '').trim();
  let m = /^https?:\/\/[^/]*github\.com[:/]\s*([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(s);
  if (!m) m = /^git@github\.com:\s*([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(s);
  if (!m) m = /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/.exec(s);
  return m ? `${m[1]}/${m[2]}` : '';
}

function cmpVersion(a, b) {
  const A = String(a).split('.').map(Number);
  const B = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const d = (A[i] || 0) - (B[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * @param {{cwd?: string, currentVersion?: string}} opts
 * @returns {{generatedAt:string, source:string, repo:string, versions:Array<{version:string,label:string,commit:string,date:string,pages:number|null}>, error?:string}}
 */
export function computeArchiveVersions({ cwd = process.cwd(), currentVersion = '' } = {}) {
  const result = {
    generatedAt: new Date().toISOString(),
    source: 'git-history',
    repo: '',
    versions: [],
  };

  // 1. 读全部提交（含父提交、日期、标题）
  let log;
  try {
    log = git(cwd, ['log', '--format=%H%x1f%P%x1f%ad%x1f%s', '--date=short']);
  } catch {
    result.error = 'not-a-git-repo';
    return result;
  }
  const commits = [];
  for (const line of log.split('\n')) {
    if (!line.trim()) continue;
    const [hash, parents, date, subject] = line.split('\x1f');
    commits.push({
      hash,
      parent: (parents || '').split(' ').filter(Boolean)[0] || '',
      date: date || '',
      subject: subject || '',
    });
  }

  try {
    result.repo = parseRepo(git(cwd, ['remote', 'get-url', 'origin']));
  } catch {
    result.repo = '';
  }
  if (!result.repo) {
    result.error = 'no-github-remote';
    return result;
  }

  // 2. 按版本归组「自动更新」提交（git log 是新的在前，反转成时间正序）
  const chron = commits.slice().reverse();
  const byVersion = new Map();
  const order = [];
  for (const c of chron) {
    const m = RELEASE_RE.exec(c.subject);
    if (!m) continue;
    const ver = m[1];
    if (!byVersion.has(ver)) {
      byVersion.set(ver, []);
      order.push(ver);
    }
    byVersion.get(ver).push(c);
  }
  if (!order.length) {
    result.error = 'no-release-commits';
    return result;
  }

  const head = commits[0] ? commits[0].hash : '';
  const sorted = order.slice().sort(cmpVersion); // 版本号升序

  // 3. 逐版本确定归档提交
  for (let i = 0; i < sorted.length; i++) {
    const ver = sorted[i];
    // 只归档严格比当前构建版本旧的版本（当前版本就是线上最新版，不需要进存档）
    if (currentVersion && cmpVersion(ver, currentVersion) >= 0) continue;

    const rels = byVersion.get(ver);
    const next = sorted[i + 1];
    const nextRels = next ? byVersion.get(next) : null;
    // 下一版的第一个发布提交的父提交；拿不到（下一版尚未发布）时用当前 HEAD
    let commit = nextRels && nextRels.length ? nextRels[0].parent : '';
    if (!commit) commit = head;
    if (!commit) continue;

    // 页数：从归档提交里的 index.html 读「共 N 页」（拿不到就留空，不阻塞构建）
    let pages = null;
    try {
      const idx = git(cwd, ['show', `${commit}:index.html`]);
      const pm = /共\s*(\d+)\s*页/.exec(idx);
      if (pm) pages = Number(pm[1]);
    } catch {
      pages = null;
    }

    result.versions.push({
      version: ver,
      label: `5z 规则 ${ver} 版`,
      commit,
      date: rels[rels.length - 1].date || '',
      pages,
    });
  }

  // 4. 新版本在前
  result.versions.sort((a, b) => cmpVersion(b.version, a.version));
  return result;
}
