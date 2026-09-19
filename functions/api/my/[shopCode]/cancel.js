// POST /api/my/:shopCode/cancel
// 顾客凭手机号取消自己的预约
//
// Body: { bookingId, phone }
// 规则：
//   1) booking.customer_phone 必须等于传入 phone（只能取消自己的）
//   2) 状态为 pending 或 confirmed 才能取消
//   3) scheduled_at 必须在未来（不能取消已过期/已完成的预约）
//   4) 已取消的预约不可重复取消

import { json, fail, requireShop, nowLocalString } from "../../../_shared/helpers.js";

const PHONE_RE = /^\+?\d{7,20}$/;

export async function onRequestPost({ request, env, params }) {
  const { shopCode } = params;

  const r = await requireShop(env, shopCode);
  if (r.error) return fail(r.error, 404);

  const body = await request.json().catch(() => null);
  if (!body) return fail("请求体必须是 JSON");

  const bookingId = parseInt(body.bookingId, 10);
  const phone = (body.phone || "").trim();
  if (!bookingId) return fail("缺少 bookingId", 400);
  if (!PHONE_RE.test(phone)) return fail("手机号格式不正确", 400);

  const booking = await env.DB.prepare(
    "SELECT * FROM bookings WHERE id = ? AND shop_code = ?"
  ).bind(bookingId, shopCode).first();
  if (!booking) return fail("预约不存在", 404);

  if (booking.customer_phone !== phone) {
    return fail("手机号与预约不一致，无法取消", 403);
  }

  if (booking.status === "cancelled" || booking.status === "rejected") {
    return fail("该预约已不可取消", 400);
  }
  if (booking.status !== "pending" && booking.status !== "confirmed") {
    return fail("该状态不允许取消", 400);
  }

  // 校验预约时间必须尚未到达（留 0 容忍：到点即不可取消）
  const now = nowLocalString(r.shop.timezone);
  if (booking.scheduled_at <= now) {
    return fail("预约时间已过，无法在线取消，请联系商家", 400);
  }

  const nowStr = new Date().toISOString().slice(0, 19).replace("T", " ");
  await env.DB.prepare(
    "UPDATE bookings SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?"
  ).bind(nowStr, nowStr, bookingId).run();

  return json({ ok: true, message: "已取消" });
}
