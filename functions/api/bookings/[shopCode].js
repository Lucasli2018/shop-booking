// POST /api/bookings/:shopCode
// 提交预约
// Body: { serviceId, scheduledAt ('YYYY-MM-DD HH:MM'), customerName, customerPhone, note }
//
// 关键：用 INSERT ... WHERE NOT EXISTS 原子防止并发预约冲突
// D1 Workers 没有 transaction()，用单条原子 SQL 代替

import {
  json, fail, readJson, requireShop,
  addMinutes, nowLocalString,
} from "../../_shared/helpers.js";
import { sendBookingConfirmation, isEmailValid } from "../../_lib/email.js";

export async function onRequestPost({ request, env, params, waitUntil }) {
  const { shopCode } = params;

  const r = await requireShop(env, shopCode);
  if (r.error) return fail(r.error, 404);
  const shop = r.shop;

  const body = await readJson(request);
  if (!body) return fail("请求体必须是 JSON");

  const serviceId = parseInt(body.serviceId, 10);
  const scheduledAt = body.scheduledAt;
  const name = (body.customerName || "").trim();
  const phone = (body.customerPhone || "").trim();
  const note = body.note ? String(body.note).trim().slice(0, 500) : null;

  if (!serviceId) return fail("缺少 serviceId");
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(scheduledAt || "")) {
    return fail("时间格式错误，需要 'YYYY-MM-DD HH:MM'");
  }
  if (!name || name.length < 1 || name.length > 50) {
    return fail("姓名必填，1-50 字");
  }
  // 手机号：允许 7-20 位数字 + 国际前缀
  if (!/^\+?\d{7,20}$/.test(phone)) {
    return fail("手机号格式错误（7-20 位数字，可带 +）");
  }
  // 邮箱可选；填了就必须合法（用于发送确认邮件）
  const email = body.customerEmail ? String(body.customerEmail).trim().slice(0, 100) : null;
  if (email && !isEmailValid(email)) {
    return fail("邮箱格式不正确");
  }

  // 校验服务存在
  const service = await env.DB.prepare(
    "SELECT * FROM services WHERE id = ? AND shop_code = ? AND active = 1"
  ).bind(serviceId, shopCode).first();
  if (!service) return fail("服务不存在", 404);

  // 校验日期在营业时间内（快速检查）
  const date = scheduledAt.slice(0, 10);
  const time = scheduledAt.slice(11);
  const schedule = await env.DB.prepare(`
    SELECT * FROM shop_schedule
    WHERE shop_code = ? AND weekday = strftime('%w', ?) AND active = 1
  `).bind(shopCode, date).first();
  if (!schedule) return fail("该日不营业");
  if (time < schedule.opens_at || time >= schedule.closes_at) {
    return fail("时间在营业时段外");
  }

  // 时间不能早于当前（店铺时区）
  const now = nowLocalString(shop.timezone);
  if (scheduledAt <= now) return fail("时间已过期");

  // 原子插入：用 INSERT ... WHERE NOT EXISTS 防止并发冲突
  try {
    const end = addMinutes(scheduledAt, service.duration_min);
    const result = await env.DB.prepare(`
      INSERT INTO bookings
        (shop_code, service_id, customer_name, customer_phone,
         scheduled_at, duration_min, status, note, customer_email)
      SELECT ?, ?, ?, ?, ?, ?, 'pending', ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM bookings
        WHERE shop_code = ?
          AND status IN ('pending','confirmed','called','done')
          AND scheduled_at < ?
          AND datetime(scheduled_at, '+' || duration_min || ' minutes') > ?
      )
    `).bind(
      shopCode, serviceId, name, phone, scheduledAt, service.duration_min, note, email,
      shopCode, end, scheduledAt
    ).run();

    const id = result.meta.last_row_id;
    if (!id) {
      return fail("该时间段刚被占用，请重新选择", 409);
    }

    // 确认邮件：可插拔，未配置 RESEND_API_KEY 时静默跳过；失败不影响预约结果
    if (waitUntil && email) {
      waitUntil(sendBookingConfirmation(env, {
        customerEmail: email,
        customerName: name,
        serviceName: service.name,
        scheduledAt,
        shopName: shop.name,
        bookingId: id,
      }));
    }

    return json({
      booking: {
        id,
        shopCode,
        serviceId,
        customerName: name,
        customerPhone: phone,
        scheduledAt,
        durationMin: service.duration_min,
        status: "pending",
        note,
        serviceName: service.name,
        priceCents: service.price_cents,
        shopName: shop.name,
      },
      message: "预约成功",
    }, 201);
  } catch (err) {
    console.error("booking insert failed:", err);
    return fail("预约失败，请稍后重试", 500);
  }
}
