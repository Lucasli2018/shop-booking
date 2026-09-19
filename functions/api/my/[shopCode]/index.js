// GET /api/my/:shopCode?phone=13800000000
// 顾客凭手机号查询自己的预约（公开接口，手机号充当弱身份校验）
//
// 返回：{ bookings: [{ id, serviceName, scheduledAt, customerName, customerPhone, status, note }] }
// 仅返回该手机号名下的预约（按时间倒序，未来的在前）。

import { json, fail, requireShop } from "../../../_shared/helpers.js";

const PHONE_RE = /^\+?\d{7,20}$/;

export async function onRequestGet({ request, env, params }) {
  const { shopCode } = params;

  const r = await requireShop(env, shopCode);
  if (r.error) return fail(r.error, 404);

  const url = new URL(request.url);
  const phone = (url.searchParams.get("phone") || "").trim();
  if (!PHONE_RE.test(phone)) return fail("手机号格式不正确", 400);

  const rows = await env.DB.prepare(`
    SELECT b.id, b.customer_name, b.customer_phone, b.scheduled_at,
           b.status, b.note, s.name AS serviceName
    FROM bookings b
    JOIN services s ON s.id = b.service_id
    WHERE b.shop_code = ? AND b.customer_phone = ?
    ORDER BY b.scheduled_at DESC
    LIMIT 50
  `).bind(shopCode, phone).all();

  const bookings = rows.results.map(row => ({
    id: row.id,
    serviceName: row.serviceName,
    scheduledAt: row.scheduled_at,
    customerName: row.customer_name,
    customerPhone: maskPhone(row.customer_phone),
    status: row.status,
    note: row.note,
  }));

  return json({ bookings });
}

function maskPhone(p) {
  p = String(p || "");
  if (p.length <= 4) return p;
  return p.slice(0, 3) + "****" + p.slice(-4);
}
