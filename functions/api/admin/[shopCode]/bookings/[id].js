// POST /api/admin/:shopCode/bookings/:id
// 修改预约状态（confirm / reject / call / done / cancel）
//
// Body: { action: "confirm" | "reject" | "call" | "done" | "cancel" }
//
// 状态机：
//   pending  → confirmed / rejected / cancelled
//   confirmed → called / cancelled / done
//   called   → done / cancelled
//   done     → (终态)
//   cancelled→ (终态)
//   rejected → (终态)
//
// 每个状态变更写对应的 xxx_at 时间戳

import { requireAdmin } from "../../_guard.js";
import { json, readJson } from "../../../../_shared/helpers.js";

const TRANSITIONS = {
  pending:   ["confirmed", "rejected", "cancelled"],
  confirmed: ["called", "done", "cancelled"],
  called:    ["done", "cancelled"],
  done:      [],
  cancelled: [],
  rejected:  [],
};

const TIMESTAMP_FIELD = {
  confirmed: null,   // 用 updated_at
  rejected:  "rejected_at",
  called:    "called_at",
  done:      "done_at",
  cancelled: "cancelled_at",
};

export async function onRequestPost({ request, env, params }) {
  const { shopCode, id } = params;
  const bookingId = parseInt(id, 10);
  if (!bookingId) return json({ error: "预约 ID 无效" }, 400);

  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;

  const body = await readJson(request);
  const action = body && body.action;

  if (!action) return json({ error: "缺少 action" }, 400);

  // 查当前预约
  const booking = await env.DB.prepare(
    "SELECT * FROM bookings WHERE id = ? AND shop_code = ?"
  ).bind(bookingId, shopCode).first();

  if (!booking) return json({ error: "预约不存在", }, 404);

  const current = booking.status;
  const allowed = TRANSITIONS[current] || [];
  if (!allowed.includes(action)) {
    return json({ error: `状态不能从 ${current} 变为 ${action}`, status: "invalid_transition" }, 400);
  }

  const nowStr = new Date().toISOString().slice(0, 19).replace("T", " ");

  // 构建 UPDATE
  const tsField = TIMESTAMP_FIELD[action];
  let sql;
  if (tsField) {
    sql = `UPDATE bookings SET status = ?, ${tsField} = ?, updated_at = ? WHERE id = ?`;
    await env.DB.prepare(sql)
      .bind(action, nowStr, nowStr, bookingId)
      .run();
  } else {
    sql = `UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?`;
    await env.DB.prepare(sql)
      .bind(action, nowStr, bookingId)
      .run();
  }

  // 查最新一条
  const updated = await env.DB.prepare(`
    SELECT b.*, s.name AS serviceName, s.price_cents AS priceCents
    FROM bookings b JOIN services s ON s.id = b.service_id
    WHERE b.id = ?
  `).bind(bookingId).first();

  return json({ booking: updated, message: `状态已更新为 ${action}` });
}
