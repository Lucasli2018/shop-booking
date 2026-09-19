// GET /api/queue/:shopCode?now=
// 当前排队情况（公开，顾客手机挂此页看）
//
// 返回：
// {
//   shop: { name },
//   now: 'YYYY-MM-DD HH:MM',
//   nowServing: { id, serviceName, customerName, scheduledAt, calledAt } | null,
//   waiting: [{ id, serviceName, customerName, scheduledAt, position }],
//   totalWaiting: 3
// }
//
// 排队规则：
// - nowServing = 最近一个 status='called' 的记录（按 called_at 倒序取第一条）
// - waiting    = status='confirmed' AND (scheduled_at <= now + 30min OR 无 scheduled_at 但已确认的)
//                按 scheduled_at 升序

import { json, fail, requireShop, nowLocalString, addMinutes } from "../../_shared/helpers.js";

export async function onRequestGet({ request, env, params }) {
  const { shopCode } = params;

  const r = await requireShop(env, shopCode);
  if (r.error) return fail(r.error, 404);
  const shop = r.shop;

  const url = new URL(request.url);
  const now = url.searchParams.get("now") || nowLocalString(shop.timezone);

  // 当前正在叫号：最近一个 status='called'
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
    scheduledAt: nowServingRow.scheduled_at,
    calledAt: nowServingRow.called_at,
  } : null;

  // 等待队列：status='confirmed'
  const horizon = addMinutes(now, 60);
  const waitingRows = await env.DB.prepare(`
    SELECT b.*, s.name AS serviceName
    FROM bookings b JOIN services s ON s.id = b.service_id
    WHERE b.shop_code = ? AND b.status = 'confirmed'
      AND b.scheduled_at <= ?
    ORDER BY b.scheduled_at ASC
  `).bind(shopCode, horizon).all();

  const waiting = waitingRows.results.map((row, i) => ({
    id: row.id,
    serviceName: row.serviceName,
    customerName: row.customer_name,
    scheduledAt: row.scheduled_at,
    position: i + 1,
  }));

  return json({
    shop: { name: shop.name },
    now,
    nowServing,
    waiting,
    totalWaiting: waiting.length,
  });
}
