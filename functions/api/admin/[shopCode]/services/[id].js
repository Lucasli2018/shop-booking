// GET    /api/admin/:shopCode/services/:id  — 详情
// PUT    /api/admin/:shopCode/services/:id  — 更新
// DELETE /api/admin/:shopCode/services/:id  — 软删除（active=0）
//
// PUT body: 任意字段子集（name, description, durationMin, priceCents, sortOrder, active）

import { requireAdmin } from "../../_guard.js";
import { json, readJson } from "../../../../_shared/helpers.js";

async function findService(env, shopCode, id) {
  const result = parseInt(id, 10);
  if (!result) return null;
  return await env.DB.prepare(
    "SELECT * FROM services WHERE id = ? AND shop_code = ?"
  ).bind(result, shopCode).first();
}

export async function onRequestGet({ request, env, params }) {
  const { shopCode, id } = params;
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;

  const service = await findService(env, shopCode, id);
  if (!service) return json({ error: "服务不存在" }, 404);
  return json({ service });
}

export async function onRequestPut({ request, env, params }) {
  const { shopCode, id } = params;
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;

  const service = await findService(env, shopCode, id);
  if (!service) return json({ error: "服务不存在" }, 404);

  const body = await readJson(request);
  if (!body) return json({ error: "JSON body required" }, 400);

  const sets = [];
  const binds = [];

  if (body.name != null) {
    const v = String(body.name).trim();
    if (!v || v.length > 50) return json({ error: "服务名必填，最长 50 字" }, 400);
    sets.push("name = ?"); binds.push(v);
  }
  if (body.description != null) {
    sets.push("description = ?");
    binds.push(body.description ? String(body.description).trim().slice(0, 300) : null);
  }
  if (body.durationMin != null) {
    const v = parseInt(body.durationMin, 10);
    if (!Number.isFinite(v) || v < 5 || v > 720) {
      return json({ error: "时长必须在 5-720 分钟之间" }, 400);
    }
    sets.push("duration_min = ?"); binds.push(v);
  }
  if (body.category != null) {
    sets.push("category = ?");
    binds.push(body.category ? String(body.category).trim().slice(0, 20) : null);
  }
  if (body.priceCents != null) {
    const v = parseInt(body.priceCents, 10);
    if (!Number.isFinite(v) || v < 0) return json({ error: "价格必须 >= 0" }, 400);
    sets.push("price_cents = ?"); binds.push(v);
  }
  if (body.sortOrder != null) {
    sets.push("sort_order = ?");
    binds.push(parseInt(body.sortOrder, 10) || 0);
  }
  if (body.active != null) {
    sets.push("active = ?");
    binds.push(body.active ? 1 : 0);
  }

  if (sets.length === 0) return json({ error: "没有要更新的字段" }, 400);

  sets.push("updated_at = ?");
  binds.push(new Date().toISOString().slice(0, 19).replace("T", " "));
  binds.push(id, shopCode);

  await env.DB.prepare(`UPDATE services SET ${sets.join(", ")} WHERE id = ? AND shop_code = ?`)
    .bind(...binds).run();

  const updated = await findService(env, shopCode, id);
  return json({ service: updated });
}

export async function onRequestDelete({ request, env, params }) {
  const { shopCode, id } = params;
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;

  const service = await findService(env, shopCode, id);
  if (!service) return json({ error: "服务不存在" }, 404);

  // 软删除：active=0
  await env.DB.prepare("UPDATE services SET active = 0, updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString().slice(0, 19).replace("T", " "), id).run();

  return json({ deleted: id, message: "服务已下架" });
}
