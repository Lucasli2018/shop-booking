// GET  /api/admin/:shopCode/profile   — 店铺信息
// PUT  /api/admin/:shopCode/profile   — 更新店铺信息
//
// 改密码走独立的 PUT /api/admin/:shopCode/password

import { requireAdmin } from "../_guard.js";
import { json, readJson } from "../../../_shared/helpers.js";

export async function onRequestGet({ request, env, params }) {
  const { shopCode } = params;
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;

  const shop = g.shop;
  return json({
    shop: {
      code: shop.code,
      name: shop.name,
      intro: shop.intro,
      phone: shop.phone,
      address: shop.address,
      timezone: shop.timezone,
      status: shop.status,
      logoKey: shop.logo_key,
      coverKey: shop.cover_key,
      logoUrl: shop.logo_key ? `/api/admin/image/${shop.code}/${shop.logo_key}` : null,
      coverUrl: shop.cover_key ? `/api/admin/image/${shop.code}/${shop.cover_key}` : null,
      createdAt: shop.created_at,
      updatedAt: shop.updated_at,
    },
    account: g.account ? { id: g.account.id, username: g.account.username, role: g.account.role } : null,
  });
}

export async function onRequestPut({ request, env, params }) {
  const { shopCode } = params;
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;

  const body = await readJson(request);
  if (!body) return json({ error: "JSON body required" }, 400);

  const shop = g.shop;
  const sets = [];
  const binds = [];

  const strField = (field, maxLen) => {
    if (body[field] != null) {
      const v = String(body[field]).trim();
      if (v.length > maxLen) return { error: `${field} 最长 ${maxLen} 字` };
      sets.push(`${field} = ?`);
      binds.push(v);
    }
    return {};
  };

  let r = strField("name", 100); if (r.error) return json({ error: r.error }, 400);
  r = strField("intro", 500); if (r.error) return json({ error: r.error }, 400);
  r = strField("phone", 30); if (r.error) return json({ error: r.error }, 400);
  r = strField("address", 200); if (r.error) return json({ error: r.error }, 400);
  r = strField("timezone", 50); if (r.error) return json({ error: r.error }, 400);

  if (sets.length === 0) return json({ error: "没有要更新的字段" }, 400);

  sets.push("updated_at = ?");
  binds.push(new Date().toISOString().slice(0, 19).replace("T", " "));
  binds.push(shopCode);

  await env.DB.prepare(`UPDATE shops SET ${sets.join(", ")} WHERE code = ?`)
    .bind(...binds).run();

  const updated = await env.DB.prepare("SELECT * FROM shops WHERE code = ?")
    .bind(shopCode).first();

  return json({
    shop: {
      code: updated.code,
      name: updated.name,
      intro: updated.intro,
      phone: updated.phone,
      address: updated.address,
      timezone: updated.timezone,
      status: updated.status,
    },
  });
}
