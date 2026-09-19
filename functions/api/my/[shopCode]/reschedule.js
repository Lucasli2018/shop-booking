// POST /api/my/:shopCode/reschedule
// 顾客凭手机号改期自己的预约
//
// Body: { bookingId, phone, newScheduledAt ('YYYY-MM-DD HH:MM') }
// 规则：
//   1) booking.customer_phone 必须等于传入 phone（只能改自己的）
//   2) 状态为 pending 或 confirmed 才能改期
//   3) 新时间必须在营业时段内且尚未到达
//   4) 原子 UPDATE + NOT EXISTS 防并发冲突（排除自身），冲突返回 409

import { json, fail, readJson, requireShop, nowLocalString, addMinutes } from "../../../_shared/helpers.js";

const PHONE_RE = /^\+?\d{7,20}$/;

export async function onRequestPost({ request, env, params }) {
  const { shopCode } = params;

  const r = await requireShop(env, shopCode);
  if (r.error) return fail(r.error, 404);
  const shop = r.shop;

  const body = await readJson(request);
  if (!body) return fail("请求体必须是 JSON");

  const bookingId = parseInt(body.bookingId, 10);
  const phone = (body.phone || "").trim();
  const newScheduledAt = body.newScheduledAt;
  if (!bookingId) return fail("缺少 bookingId", 400);
  if (!PHONE_RE.test(phone)) return fail("手机号格式不正确", 400);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(newScheduledAt || "")) {
    return fail("时间格式错误，需要 'YYYY-MM-DD HH:MM'");
  }

  const booking = await env.DB.prepare(
    "SELECT * FROM bookings WHERE id = ? AND shop_code = ?"
  ).bind(bookingId, shopCode).first();
  if (!booking) return fail("预约不存在", 404);

  if (booking.customer_phone !== phone) {
    return fail("手机号与预约不一致，无法改期", 403);
  }
  if (booking.status !== "pending" && booking.status !== "confirmed") {
    return fail("该状态不允许改期");
  }

  // 新时间合法性：营业日 + 营业时段内 + 未过期
  const date = newScheduledAt.slice(0, 10);
  const time = newScheduledAt.slice(11);
  const schedule = await env.DB.prepare(`
    SELECT * FROM shop_schedule
    WHERE shop_code = ? AND weekday = strftime('%w', ?) AND active = 1
  `).bind(shopCode, date).first();
  if (!schedule) return fail("该日不营业");
  if (time < schedule.opens_at || time >= schedule.closes_at) {
    return fail("时间在营业时段外");
  }
  const now = nowLocalString(shop.timezone);
  if (newScheduledAt <= now) return fail("新时间已过期");

  // 原子改期：排除自身的重叠校验，防并发占位
  const end = addMinutes(newScheduledAt, booking.duration_min);
  const result = await env.DB.prepare(`
    UPDATE bookings SET
      scheduled_at = ?,
      updated_at = datetime('now', '+8 hours')
    WHERE id = ?
      AND NOT EXISTS (
        SELECT 1 FROM bookings b2
        WHERE b2.shop_code = ?
          AND b2.id != ?
          AND b2.status IN ('pending','confirmed','called','done')
          AND b2.scheduled_at < ?
          AND datetime(b2.scheduled_at, '+' || b2.duration_min || ' minutes') > ?
      )
  `).bind(newScheduledAt, bookingId, shopCode, bookingId, end, newScheduledAt).run();

  if (!result.meta.changes) {
    return fail("该时间段刚被占用，请重新选择", 409);
  }

  const updated = await env.DB.prepare(`
    SELECT b.id, b.scheduled_at, b.status, s.name AS serviceName
    FROM bookings b JOIN services s ON s.id = b.service_id
    WHERE b.id = ?
  `).bind(bookingId).first();

  return json({ ok: true, booking: updated, message: "改期成功" });
}
