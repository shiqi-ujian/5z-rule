// 由 5z_build/build.mjs 自动生成，请勿手改。
// 目的：给 HTML 文档补上「不缓存、每次回源校验」，让发布新版本后立即生效。
//
// 现状（2026-10-03 实测）：5z-rules.top 的 Zone 上有一条把 Cache-Control 改写成
// `public, max-age=14400, must-revalidate` 的缓存规则（页面规则/Cache Rules）。
// 该规则在 Function 之后生效，会覆盖本文件设置的值——实测 Function 设的 Expires
// 能透出、Cache-Control 却仍被改回 14400，而 GitHub Pages 上同一份 HTML 是 max-age=600，
// 说明这 4 小时不是 Pages 默认值，而是这条 Zone 规则造成的。
// 因此：**要根治必须改/删那条 Zone 缓存规则**（见 5z_build/DEPLOY.md）。
// 本 Function 保留为保险：规则一旦修正或移除，它就会自动生效，无需再改代码。
export async function onRequest(context) {
  const res = await context.next();
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return res;
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  out.headers.set('Expires', 'Thu, 01 Jan 1970 00:00:00 GMT');
  return out;
}
