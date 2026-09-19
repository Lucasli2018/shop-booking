// GET /api/admin/:shopCode/queue
// 商家后台的排队视图（和 /api/queue/:shopCode 类似，但需要 session）

import { requireAdmin } from "../_guard.js";
import { json, nowLocalString, addMinutes } from "../../../_shared/helpers.js";

export async function onRequestGet({ request, env, params }) {
  const { shopCode } = params;
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;
  const shop = g.shop;

  const url = new URL(request.url);
  const now = url.searchParams.get("now") || nowLocalString(shop.timezone);

  // 当前正在叫号
  const nowServingRow = await env.DB.prepare(`
    SELECT b.*, s.name AS serviceName
    FROM bookings b JOIN services s ON s.id = b.service_id
    WHERE b.shop_code = ? AND b.status = 'called'
    ORDER BY b.called_at DESC
    LIMIT 1
  `).bind(shopCode).first();

  const nowServing = nowServingRow ? {
    id: nowServingRow.id,
    serviceName: nowServingRow.serviceName,
    customerName: nowServingRow.customer_name,
    customerPhone: nowServingRow.customer_phone,
    scheduledAt: nowServingRow.scheduled_at,
    calledAt: nowServingRow.called_at,
  } : null;

  // 今天剩余待叫号的预约（confirmed 且已到期或未到期）
  const horizon = addMinutes(now, 24 * 60);
  const confirmedRows = await env.DB.prepare(`
    SELECT b.*, s.name AS serviceName
    FROM bookings b JOIN services s ON s.id = b.service_id
    WHERE b.shop_code = ? AND b.status = 'confirmed'
      AND b.scheduled_at <= ?
    ORDER BY b.scheduled_at ASC
  `).bind(shopCode, horizon).all();

  const waiting = confirmedRows.results.map((row, i) => ({
    id: row.id,
    serviceName: row.serviceName,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    scheduledAt: row.scheduled_at,
    position: i + 1,
  }));

  // 待确认（pending）
  const pendingRows = await env.DB.prepare(`
    SELECT b.*, s.name AS serviceName
    FROM bookings b JOIN services s ON s.id = b.service_id
    WHERE b.shop_code = ? AND b.status = 'pending'
      AND b.scheduled_at <= ?
    ORDER BY b.scheduled_at ASC
  `).bind(shopCode, horizon).all();

  return json({
    shop: { name: shop.name },
    now,
    nowServing,
    waiting,
    pending: pendingRows.results,
    totalWaiting: waiting.length,
    totalPending: pendingRows.results.length,
  });
}
