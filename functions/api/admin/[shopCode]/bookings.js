// GET  /api/admin/:shopCode/bookings?date=YYYY-MM-DD&status=
// 商家后台：预约列表
//
// 需要 Authorization: Bearer <token>
//
// Query params:
//   date    - 'YYYY-MM-DD'，默认今天（店铺时区）
//   status  - pending|confirmed|called|done|cancelled|rejected
//   limit   - 默认 50，最大 200
//   page    - 默认 1

import { requireAdmin } from "../_guard.js";
import { json, readJson, nowLocalString } from "../../../_shared/helpers.js";

export async function onRequestGet({ request, env, params }) {
  const { shopCode } = params;
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;
  const shop = g.shop;

  const url = new URL(request.url);
  let date = url.searchParams.get("date") || "";
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  const status = url.searchParams.get("status") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 500);
  const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10) || 1, 1);
  const offset = (page - 1) * limit;

  // 统计今日总数（各状态）
  const todayStr = nowLocalString(shop.timezone).slice(0, 10);
  const counts = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN status='called' THEN 1 ELSE 0 END) AS called,
      SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejected,
      COUNT(*) AS total
    FROM bookings
    WHERE shop_code = ? AND scheduled_at LIKE ?
  `).bind(shopCode, `${todayStr}%`).first();

  // 查询条件
  const where = ["b.shop_code = ?"];
  const bindParams = [shopCode];
  if (from && to) {
    // 周视图：闭区间查询
    where.push("b.scheduled_at >= ?");
    bindParams.push(`${from} 00:00`);
    where.push("b.scheduled_at <= ?");
    bindParams.push(`${to} 23:59`);
  } else {
    if (!date) date = nowLocalString(shop.timezone).slice(0, 10);
    where.push("b.scheduled_at LIKE ?");
    bindParams.push(`${date}%`);
  }
  if (status) {
    where.push("b.status = ?");
    bindParams.push(status);
  }

  const whereSql = where.join(" AND ");
  const rows = await env.DB.prepare(`
    SELECT b.*, s.name AS serviceName, s.price_cents AS priceCents
    FROM bookings b
    JOIN services s ON s.id = b.service_id
    WHERE ${whereSql}
    ORDER BY b.scheduled_at ASC, b.created_at ASC
    LIMIT ? OFFSET ?
  `).bind(...bindParams, limit, offset).all();

  return json({
    shop: { code: shop.code, name: shop.name },
    date,
    todayCounts: counts || { pending: 0, confirmed: 0, called: 0, done: 0, cancelled: 0, rejected: 0, total: 0 },
    bookings: rows.results,
    limit, page, offset,
  });
}
