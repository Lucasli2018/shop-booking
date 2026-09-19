// GET    /api/admin/:shopCode/services  — 列表
// POST   /api/admin/:shopCode/services  — 创建
//
// 创建 body: { name, description?, durationMin, priceCents?, sortOrder? }

import { requireAdmin } from "../_guard.js";
import { json, readJson } from "../../../_shared/helpers.js";

export async function onRequestGet({ request, env, params }) {
  const { shopCode } = params;
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;

  const rows = await env.DB.prepare(`
    SELECT id, name, description, duration_min AS durationMin,
           price_cents AS priceCents, category, sort_order AS sortOrder,
           active, created_at AS createdAt
    FROM services
    WHERE shop_code = ?
    ORDER BY sort_order, id
  `).bind(shopCode).all();

  return json({ services: rows.results });
}

export async function onRequestPost({ request, env, params }) {
  const { shopCode } = params;
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;

  const body = await readJson(request);
  if (!body) return json({ error: "JSON body required" }, 400);

  const name = (body.name || "").trim();
  const description = body.description ? String(body.description).trim().slice(0, 300) : null;
  const durationMin = parseInt(body.durationMin, 10);
  const priceCents = body.priceCents != null ? parseInt(body.priceCents, 10) : null;
  const sortOrder = body.sortOrder != null ? parseInt(body.sortOrder, 10) : 0;
  const category = body.category ? String(body.category).trim().slice(0, 20) : null;
  const active = body.active === false ? 0 : 1;

  if (!name || name.length > 50) return json({ error: "服务名必填，最长 50 字" }, 400);
  if (!Number.isFinite(durationMin) || durationMin < 5 || durationMin > 720) {
    return json({ error: "时长必须在 5-720 分钟之间" }, 400);
  }
  if (priceCents != null && (!Number.isFinite(priceCents) || priceCents < 0)) {
    return json({ error: "价格（分）必须 >= 0" }, 400);
  }

  const result = await env.DB.prepare(`
    INSERT INTO services (shop_code, name, description, duration_min, price_cents, category, sort_order, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(shopCode, name, description, durationMin, priceCents, category, sortOrder, active);

  const id = result.meta.last_row_id;
  const service = await env.DB.prepare("SELECT * FROM services WHERE id = ?")
    .bind(id).first();

  return json({ service }, 201);
}
