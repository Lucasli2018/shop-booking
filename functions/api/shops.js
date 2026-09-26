// GET /api/shops
// 公开：返回所有 active 店铺（多店铺切换 UI 用）
// 图片走公开接口 /api/public-image/:shopCode/:key（无需 admin token）

export async function onRequestGet({ env }) {
  const rows = await env.DB.prepare(
    `SELECT code, name, intro, logo_key, cover_key, status
     FROM shops WHERE status = 'active' ORDER BY id`
  ).all();

  const shops = (rows.results || []).map(s => ({
    code: s.code,
    name: s.name,
    intro: s.intro || "",
    status: s.status,
    logoUrl: s.logo_key ? `/api/public-image/${s.code}/${encodeURIComponent(s.logo_key)}` : null,
    coverUrl: s.cover_key ? `/api/public-image/${s.code}/${encodeURIComponent(s.cover_key)}` : null,
  }));

  return new Response(JSON.stringify({ shops }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
