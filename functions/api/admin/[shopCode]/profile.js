// GET  /api/admin/:shopCode/profile   — 店铺信息
// PUT  /api/admin/:shopCode/profile   — 更新店铺信息（含改 PIN）
//
// PUT body:
// {
//   name?, intro?, phone?, address?, timezone?,
//   newPin?: "6-8 位数字"     // 可选，改 PIN
// }

import { requireAdmin } from "../_guard.js";
import { json, readJson } from "../../../_shared/helpers.js";
import { hashPin, genSalt } from "../../../_shared/crypto.js";

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

  // 改 PIN
  if (body.newPin != null) {
    const pin = String(body.newPin).trim();
    if (!/^\d{6,8}$/.test(pin)) {
      return json({ error: "新 PIN 必须是 6-8 位数字" }, 400);
    }
    // 生成新 salt 和 hash
    const newSalt = genSalt(16);
    const newHash = await hashPin(pin, newSalt);
    sets.push("pin_hash = ?"); binds.push(newHash);
    sets.push("pin_salt = ?"); binds.push(newSalt);
  }

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
    pinChanged: body.newPin != null,
  });
}
