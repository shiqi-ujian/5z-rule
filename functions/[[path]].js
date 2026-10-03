// 由 5z_build/build.mjs 自动生成，请勿手改。
// 目的：HTML 文档不缓存（每次回源校验），保证发布新版本后立即生效。
// 原因：_headers 只管静态资源，HTML 会吃 Pages 默认的 4 小时缓存。
// 只改写 HTML 响应，静态资源（返 304/静态资产）原样透传、保持长缓存。
export async function onRequest(context) {
  const res = await context.next();
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return res;
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  return out;
}
