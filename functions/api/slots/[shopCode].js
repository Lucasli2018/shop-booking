// GET /api/slots/:shopCode?serviceId=1&date=2026-09-20
// 返回某服务在某日的可用时间段
//
// 逻辑：
// 1. 查 shop_schedule 拿当日营业时段
// 2. 展开候选时间点
// 3. 查 bookings 里占用状态（pending/confirmed/called/done）的区间
// 4. 减去占用
// 5. 如果是今天，减去已过时段
//
// 返回：
// {
//   shop: { timezone },
//   service: { durationMin },
//   date: 'YYYY-MM-DD',
//   all:      ['HH:MM', ...],           // 所有候选时间点（含占用的）
//   available:['HH:MM', ...],           // 可用时间点
//   occupied: {'HH:MM': 'reason', ...}  // 已占用的时间点及原因
// }

import {
  json, fail, requireShop,
  generateTimePoints, addMinutes, weekdayOf,
  nowLocalString,
} from "../../_shared/helpers.js";

export async function onRequestGet({ request, env, params }) {
  const { shopCode } = params;
  const url = new URL(request.url);
  const serviceId = parseInt(url.searchParams.get("serviceId"), 10);
  let date = url.searchParams.get("date");

  if (!serviceId) return fail("缺少 serviceId");

  const r = await requireShop(env, shopCode);
  if (r.error) return fail(r.error, 404);
  const shop = r.shop;

  const service = await env.DB.prepare(
    "SELECT * FROM services WHERE id = ? AND shop_code = ? AND active = 1"
  ).bind(serviceId, shopCode).first();
  if (!service) return fail("服务不存在", 404);

  // 默认日期 = 今天（店铺时区）
  if (!date) {
    date = nowLocalString(shop.timezone).slice(0, 10);
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return fail("日期格式错误，需要 YYYY-MM-DD");
  }

  const weekday = weekdayOf(date, shop.timezone);
  const schedule = await env.DB.prepare(
    "SELECT * FROM shop_schedule WHERE shop_code = ? AND weekday = ? AND active = 1"
  ).bind(shopCode, weekday).first();

  if (!schedule) {
    return json({
      shop: { timezone: shop.timezone },
      service: { durationMin: service.duration_min },
      date,
      all: [], available: [], occupied: {},
      closed: true,
      closedReason: "该日不营业",
    });
  }

  // 生成候选时间点
  const candidateTimes = generateTimePoints(schedule.opens_at, schedule.closes_at, schedule.slot_minutes);

  // 生成候选的完整时间点（date + time）
  const allSlots = candidateTimes.map(t => `${date} ${t}`);

  // 查占用区间
  const busy = await env.DB.prepare(`
    SELECT scheduled_at, duration_min
    FROM bookings
    WHERE shop_code = ? AND scheduled_at LIKE ?
      AND status IN ('pending','confirmed','called','done')
  `).bind(shopCode, `${date}%`).all();

  const busyRanges = busy.results.map(b => ({
    start: b.scheduled_at,
    end: addMinutes(b.scheduled_at, b.duration_min),
  }));

  // 现在时间（店铺时区）
  const now = nowLocalString(shop.timezone);
  const isToday = date === now.slice(0, 10);

  const available = [];
  const occupied = {};
  const all = [];

  for (const slot of allSlots) {
    const timeStr = slot.slice(11);
    all.push(timeStr);

    // 检查是否被占用
    if (busyRanges.some(br => slot < br.end && br.start < addMinutes(slot, service.duration_min))) {
      occupied[timeStr] = "已被预约";
      continue;
    }

    // 检查是否已过
    if (isToday && slot <= now) {
      occupied[timeStr] = "已过";
      continue;
    }

    // 检查距离现在是否太近（至少 30 分钟后才可约）
    // 简化：只检查是否已过，不额外加提前量
    available.push(timeStr);
  }

  return json({
    shop: { timezone: shop.timezone },
    service: { durationMin: service.duration_min, name: service.name },
    date,
    all,
    available,
    occupied,
    closed: false,
    schedule: {
      opensAt: schedule.opens_at,
      closesAt: schedule.closes_at,
      slotMinutes: schedule.slot_minutes,
    },
  });
}
