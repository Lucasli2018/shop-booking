// GET    /api/admin/:shopCode/employees/:id  — 详情
// PUT    /api/admin/:shopCode/employees/:id  — 更新（name/title/intro/sortOrder/active）
// DELETE /api/admin/:shopCode/employees/:id  — 软删除（active=0，保留历史预约归属）

import { requireAdmin } from "../../_guard.js";
import { json, readJson } from "../../../../_shared/helpers.js";

export async function onRequestGet({ request, env, params }) {
  const { shopCode, id } = params;
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;

  const emp = await env.DB.prepare(
    "SELECT * FROM sb_employees WHERE id = ? AND shop_code = ?"
  ).bind(parseInt(id, 10), shopCode).first();
  if (!emp) return json({ error: "员工不存在" }, 404);
  return json({ employee: emp });
}

export async function onRequestPut({ request, env, params }) {
  const { shopCode, id } = params;
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;

  const empId = parseInt(id, 10);
  const existing = await env.DB.prepare(
    "SELECT id FROM sb_employees WHERE id = ? AND shop_code = ?"
  ).bind(empId, shopCode).first();
  if (!existing) return json({ error: "员工不存在" }, 404);

  const body = await readJson(request);
  if (!body) return json({ error: "JSON body required" }, 400);

  const name = (body.name || "").toString().trim();
  if (!name || name.length > 30) return json({ error: "员工姓名必填，最长 30 字" }, 400);

  const title = body.title != null ? String(body.title).trim().slice(0, 20) : null;
  const intro = body.intro != null ? String(body.intro).trim().slice(0, 200) : null;
  const sortOrder = body.sortOrder != null ? parseInt(body.sortOrder, 10) : 0;
  const active = body.active === false ? 0 : 1;

  await env.DB.prepare(`
    UPDATE sb_employees
    SET name = ?, title = ?, intro = ?, sort_order = ?, active = ?,
        updated_at = datetime('now', '+8 hours')
    WHERE id = ?
  `).bind(name, title, intro, sortOrder, active, empId).run();

  const employee = await env.DB.prepare("SELECT * FROM sb_employees WHERE id = ?").bind(empId).first();
  return json({ employee, message: "已更新" });
}

export async function onRequestDelete({ request, env, params }) {
  const { shopCode, id } = params;
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;

  const empId = parseInt(id, 10);
  const existing = await env.DB.prepare(
    "SELECT id FROM sb_employees WHERE id = ? AND shop_code = ?"
  ).bind(empId, shopCode).first();
  if (!existing) return json({ error: "员工不存在" }, 404);

  // 软删除：停用在岗状态；历史预约的 employee_id 保留（展示时回退为「已离职/停用」）
  await env.DB.prepare(
    "UPDATE sb_employees SET active = 0, updated_at = datetime('now', '+8 hours') WHERE id = ?"
  ).bind(empId).run();

  return json({ ok: true, message: "员工已停用（历史预约保留归属）" });
}
