// GET /api/services/:shopCode
// 返回店铺信息 + 服务列表（顾客首页用）

import { json, fail, requireShop } from "../../_shared/helpers.js";

export async function onRequestGet({ request, env, params }) {
  const { shopCode } = params;

  const r = await requireShop(env, shopCode);
  if (r.error) return fail(r.error, 404);

  const services = await env.DB.prepare(`
    SELECT id, name, description, duration_min AS durationMin,
           price_cents AS priceCents, category, sort_order AS sortOrder
    FROM services
    WHERE shop_code = ? AND active = 1
    ORDER BY sort_order, id
  `).bind(shopCode).all();

  const shop = r.shop;
  return json({
    shop: {
      code: shop.code,
      name: shop.name,
      intro: shop.intro,
      phone: shop.phone,
      address: shop.address,
      logoUrl: shop.logo_key ? `/api/admin/image/${shop.code}/${shop.logo_key}` : null,
      coverUrl: shop.cover_key ? `/api/admin/image/${shop.code}/${shop.cover_key}` : null,
    },
    services: services.results,
  });
}
