// ============================================================
// 5z 规则站 Cloudflare Pages Function（由 5z_build/build.mjs 自动生成，请勿手改！）
//
// 两个职责：
//   1) /v/<版本>/<路径> —— 旧版规则书反向代理：
//      把 GitHub 仓库**历史提交**里的旧版站点文件取回来，在同域下按原路径返回，
//      这样旧版站点自己的相对链接/资源（CSS/图片/搜索索引/车卡器）全部自然工作，
//      仓库里不需要存任何旧版副本（清单见 build 时注入的 ARCHIVE 常量）。
//   2) 其余文档路径 —— 给 HTML 补「不缓存、每次回源校验」，见 5z_build/DEPLOY.md。
//
// 代理源按顺序回退（国内 Cloudflare 边缘取 GitHub 一般可用，多一路兜底）：
//   raw.githubusercontent.com → github.com/<repo>/raw/<commit> → cdn.jsdelivr.net/gh
// ============================================================

const ARCHIVE = __ARCHIVE_MANIFEST__;

const MIME = {
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.gz': 'application/gzip',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
};

// 旧版站点只需要这些路径；构建脚本/源码目录不允许通过存档代理读取（虽然仓库是公开的，仍收敛面）
const BLOCKED_PREFIX = [
  '5z_build/', '5z_src/', '5z_web/', 'functions/', 'incoming/',
  '问题收集/', '.git', '.github', '.dsh', 'assets/archive/',
];

// 旧版壳页左下角浮动徽标（只有 index.html 壳页注入；内容页保持原样、不改 CPU 开销）
const BADGE_CSS =
  '#wz-old-badge{position:fixed;left:12px;bottom:12px;z-index:2147483647;display:flex;gap:8px;align-items:center;' +
  'padding:7px 13px;border-radius:999px;background:rgba(15,23,42,.88);color:#fff;text-decoration:none;' +
  'font:12.5px/1.4 system-ui,"Microsoft YaHei","PingFang SC",sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);' +
  'opacity:.92;transition:background .15s,opacity .15s;-webkit-tap-highlight-color:transparent}' +
  '#wz-old-badge:hover{background:#7c3aed;opacity:1}' +
  '#wz-old-badge b{font-weight:700;white-space:nowrap}' +
  '#wz-old-badge .wz-old-link{color:#ddd6fe;white-space:nowrap}' +
  '@media (max-width:520px){#wz-old-badge .wz-old-link{display:none}}' +
  '@media (prefers-color-scheme:dark){#wz-old-badge{background:rgba(49,46,129,.92)}}';

function pageHtml(status, title, body) {
  return new Response(
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="robots" content="noindex"><title>' + title + ' · 5z 规则存档</title>' +
      '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
      'font-family:system-ui,"Microsoft YaHei",sans-serif;background:#f6f7fb;color:#1e293b}' +
      '.card{max-width:520px;padding:36px 30px;text-align:center}' +
      '.card h1{font-size:22px;margin:0 0 12px;color:#7c3aed}' +
      '.card p{color:#64748b;font-size:14px;line-height:1.7;margin:0 0 10px;word-break:break-all}' +
      '.card a{color:#7c3aed;font-weight:600;text-decoration:none;padding:9px 20px;border:1px solid #ddd6fe;' +
      'border-radius:10px;background:#fff;display:inline-block;margin:8px 6px 0}' +
      '@media (prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}.card p{color:#94a3b8}' +
      '.card a{background:#1e293b;border-color:#312e81}}</style></head><body><div class="card">' +
      body + '</div></body></html>',
    {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex',
      },
    },
  );
}

function findVersion(ver) {
  for (const v of ARCHIVE.versions || []) {
    if (v.version === ver) return v;
  }
  return null;
}

function versionListText() {
  return (ARCHIVE.versions || []).map((v) => 'v' + v.version).join('、') || '（无）';
}

function notFoundVersion(ver) {
  return pageHtml(
    404,
    '旧版不存在',
    '<h1>旧版不存在</h1><p>没有找到版本 <b>v' + escapeHtml(ver) + '</b> 的存档。</p>' +
      '<p>可查看的旧版：' + escapeHtml(versionListText()) + '</p>' +
      '<a href="/旧版规则.html">📜 旧版规则列表</a><a href="/">← 返回最新版</a>',
  );
}

function notFoundFile(meta, filePath) {
  return pageHtml(
    404,
    '旧版页面不存在',
    '<h1>该页面在旧版中不存在</h1>' +
      '<p>版本 v' + escapeHtml(meta.version) + ' 的存档里没有这个页面：</p>' +
      '<p><code>' + escapeHtml(filePath) + '</code></p>' +
      '<a href="/v/' + encodeURIComponent(meta.version) + '/">进入 v' + escapeHtml(meta.version) + ' 目录</a>' +
      '<a href="/旧版规则.html">📜 旧版规则列表</a>',
  );
}

function upstreamDown(meta, filePath) {
  return pageHtml(
    502,
    '旧版存档源不可用',
    '<h1>旧版存档源暂时不可用</h1>' +
      '<p>版本 v' + escapeHtml(meta.version) + ' 的内容来自 GitHub 仓库历史，本次读取失败，请稍后重试。</p>' +
      '<p><code>' + escapeHtml(filePath) + '</code></p>' +
      '<a href="/v/' + encodeURIComponent(meta.version) + '/">重试</a><a href="/旧版规则.html">📜 旧版规则列表</a>',
  );
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extOf(p) {
  const i = p.lastIndexOf('.');
  return i < 0 ? '' : p.slice(i).toLowerCase();
}

/** 校验旧版文件路径：拒绝穿越、控制字符、目录前后缀、非站点资源类型 */
function validatePath(p) {
  if (!p) return '路径为空';
  if (p.length > 600) return '路径过长';
  if (p.includes('\\')) return '不支持反斜杠路径';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(p)) return '路径含控制字符';
  const segs = p.split('/');
  for (const s of segs) {
    if (!s || s === '.' || s === '..') return '非法路径段';
  }
  const lower = p.toLowerCase();
  for (const b of BLOCKED_PREFIX) {
    if (lower === b.replace(/\/$/, '') || lower.startsWith(b)) return '该路径不提供旧版访问';
  }
  const ext = extOf(p);
  if (!MIME[ext]) return '不支持的文件类型: ' + (ext || '(无扩展名)');
  return null;
}

function injectBadge(html, meta) {
  const base = '<base href="/v/' + encodeURIComponent(meta.version) + '/">';
  const badge =
    '<style>' + BADGE_CSS + '</style>' +
    '<a id="wz-old-badge" href="/旧版规则.html" title="返回旧版规则书列表">' +
    '<b>📜 旧版存档 v' + escapeHtml(meta.version) + '</b>' +
    '<span class="wz-old-link">返回旧版列表 ›</span></a>';
  // <base>：让 /v/1.62 和 /v/1.62/ 两种入口下的相对链接都落到 /v/1.62/ 下
  let out = html;
  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => m + base);
  // 只替换最后一个 </body>（避免正文里偶然出现该串时插错位置）
  const re = /<\/body>(?![\s\S]*<\/body>)/i;
  if (re.test(out)) return out.replace(re, badge + '</body>');
  return out + badge;
}

function archiveCache() {
  try {
    return typeof caches !== 'undefined' && caches && caches.default ? caches.default : null;
  } catch {
    return null;
  }
}

async function serveArchiveFile(context, url, meta, filePath) {
  const { request } = context;
  const method = request.method || 'GET';
  const cache = archiveCache();
  const canCache = !!cache && method === 'GET';
  const cacheKey = url.toString();

  if (canCache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    } catch { /* 缓存不可用时继续回源 */ }
  }

  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const targets = [
    'https://raw.githubusercontent.com/' + ARCHIVE.repo + '/' + meta.commit + '/' + encodedPath,
    'https://github.com/' + ARCHIVE.repo + '/raw/' + meta.commit + '/' + encodedPath,
    'https://cdn.jsdelivr.net/gh/' + ARCHIVE.repo + '@' + meta.commit + '/' + encodedPath,
  ];

  let upstream = null;
  let lastStatus = 0;
  for (const target of targets) {
    try {
      const r = await fetch(target, {
        method: method === 'HEAD' ? 'HEAD' : 'GET',
        headers: {
          'User-Agent': '5z-rule-archive/1.0 (+https://5z-rules.top)',
          Accept: '*/*',
        },
        redirect: 'follow',
        // 存档内容按提交固定、永不变化：让 Cloudflare 边缘顺带缓存上游响应
        cf: { cacheEverything: true, cacheTtl: 86400 },
      });
      if (r.ok) { upstream = r; break; }
      lastStatus = r.status;
    } catch { /* 换下一个源 */ }
  }
  if (!upstream) {
    if (lastStatus === 404) return notFoundFile(meta, filePath);
    return upstreamDown(meta, filePath);
  }

  const ext = extOf(filePath);
  const headers = new Headers();
  // 上游 raw 对 htm/css/js 返回的是 text/plain，必须按站点语义重写 content-type
  headers.set('content-type', MIME[ext] || 'application/octet-stream');
  headers.set('cache-control', 'public, max-age=86400');
  headers.set('x-robots-tag', 'noindex');
  headers.set('x-archive-version', meta.version);
  headers.set('access-control-allow-origin', '*');

  let body = upstream.body;
  if (method !== 'HEAD' && (ext === '.htm' || ext === '.html') && filePath === 'index.html') {
    let html = await upstream.text();
    html = injectBadge(html, meta);
    headers.set('content-type', 'text/html; charset=utf-8');
    body = html;
  }

  const out = new Response(method === 'HEAD' ? null : body, { status: 200, headers });
  if (canCache) {
    try {
      const put = cache.put(cacheKey, out.clone());
      if (context.waitUntil) context.waitUntil(put);
      else await put;
    } catch { /* 缓存失败不影响响应 */ }
  }
  return out;
}

async function handleArchive(context, url) {
  const { request } = context;
  const method = request.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    return pageHtml(405, 'Method Not Allowed', '<h1>405</h1><p>旧版存档仅支持 GET / HEAD 请求。</p>');
  }

  // 存活探针：落地页用它判断当前站点是否支持旧版浏览（GitHub Pages 镜像没有 Function）
  if (url.pathname === '/v/__probe') {
    return new Response(
      JSON.stringify({
        ok: true,
        site: '5z-rules',
        repo: ARCHIVE.repo,
        versions: (ARCHIVE.versions || []).map((v) => ({ version: v.version, date: v.date, pages: v.pages })),
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      },
    );
  }

  const after = url.pathname.slice(3); // 去掉 '/v/'
  if (after === '') {
    // HTTP header 只允许 ASCII，中文路径需 percent-encode（浏览器会还原显示）
    return new Response(null, {
      status: 302,
      headers: { location: encodeURI('/旧版规则.html'), 'cache-control': 'no-store' },
    });
  }

  const slash = after.indexOf('/');
  let ver;
  let filePath;
  try {
    if (slash < 0) {
      // '/v/1.62'：同样直接返回旧版壳；壳里注入了 <base href="/v/1.62/">，
      // 所以不需要 301 补斜杠（避免与 Pages 的路径规范化互相打架形成跳转环）
      ver = decodeURIComponent(after);
      filePath = 'index.html';
    } else {
      ver = decodeURIComponent(after.slice(0, slash));
      filePath = decodeURIComponent(after.slice(slash + 1));
    }
  } catch {
    return pageHtml(400, '路径非法', '<h1>400</h1><p>URL 编码不合法。</p>');
  }
  const meta = findVersion(ver);
  if (!meta) return notFoundVersion(ver);
  if (!filePath || filePath.endsWith('/')) filePath = 'index.html';
  // 旧版站点里若自己也有「旧版规则书」入口（1.63 之后的版本才带），
  // 一律跳到站点根的旧版落地页，避免出现 /v/1.63/v/1.62/ 这种嵌套路径。
  if (filePath === '旧版规则.html') {
    return new Response(null, {
      status: 302,
      headers: { location: encodeURI('/旧版规则.html'), 'cache-control': 'public, max-age=86400' },
    });
  }
  const problem = validatePath(filePath);
  if (problem) {
    return pageHtml(400, '路径不可用', '<h1>路径不可用</h1><p>' + escapeHtml(problem) + '</p>');
  }
  return serveArchiveFile(context, url, meta, filePath);
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.pathname === '/v' || url.pathname === '/v/' || url.pathname.startsWith('/v/')) {
    return handleArchive(context, url);
  }
  // 原有行为：HTML 文档不缓存、每次回源校验（Zone 缓存规则修正后自动生效）
  const res = await context.next();
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return res;
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  out.headers.set('Expires', 'Thu, 01 Jan 1970 00:00:00 GMT');
  return out;
}
