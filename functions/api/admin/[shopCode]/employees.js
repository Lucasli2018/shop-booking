// GET    /api/admin/:shopCode/employees  — 列表（含停用员工）
// POST   /api/admin/:shopCode/employees  — 新增
//
// 创建 body: { name, title?, intro?, sortOrder?, active? }

import { requireAdmin } from "../_guard.js";
import { json, readJson } from "../../../_shared/helpers.js";

export async function onRequestGet({ request, env, params }) {
  const { shopCode } = params;
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;

  const rows = await env.DB.prepare(`
    SELECT id, name, title, intro, avatar_key AS avatarKey,
           sort_order AS sortOrder, active, created_at AS createdAt
    FROM employees
    WHERE shop_code = ?
    ORDER BY sort_order, id
  `).bind(shopCode).all();

  return json({ employees: rows.results });
}

export async function onRequestPost({ request, env, params }) {
  const { shopCode } = params;
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;

  const body = await readJson(request);
  if (!body) return json({ error: "JSON body required" }, 400);

  const name = (body.name || "").trim();
  const title = body.title ? String(body.title).trim().slice(0, 20) : null;
  const intro = body.intro ? String(body.intro).trim().slice(0, 200) : null;
  const sortOrder = body.sortOrder != null ? parseInt(body.sortOrder, 10) : 0;
  const active = body.active === false ? 0 : 1;

  if (!name || name.length > 30) return json({ error: "员工姓名必填，最长 30 字" }, 400);

  const result = await env.DB.prepare(`
    INSERT INTO employees (shop_code, name, title, intro, sort_order, active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(shopCode, name, title, intro, sortOrder, active).run();

  const id = result.meta.last_row_id;
  const employee = await env.DB.prepare("SELECT * FROM employees WHERE id = ?").bind(id).first();

  return json({ employee }, 201);
}
