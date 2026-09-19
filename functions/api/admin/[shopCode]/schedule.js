// GET  /api/admin/:shopCode/schedule — 列出 7 天营业时间
// POST /api/admin/:shopCode/schedule — upsert 单天营业时间
//
// POST body: { weekday: 0-6, opensAt: '09:00', closesAt: '21:00', slotMinutes: 30, active?: true }
//
// 语义：对同一 (shopCode, weekday) 唯一，重复提交则更新

import { requireAdmin } from "../_guard.js";
import { json, readJson } from "../../../_shared/helpers.js";

export async function onRequestGet({ request, env, params }) {
  const { shopCode } = params;
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;

  const rows = await env.DB.prepare(`
    SELECT id, weekday, opens_at AS opensAt, closes_at AS closesAt,
           slot_minutes AS slotMinutes, active
    FROM shop_schedule
    WHERE shop_code = ?
    ORDER BY weekday
  `).bind(shopCode).all();

  // 补齐 0-6 的槽位（如果某周几没记录，返回默认 09-21 slot=30 active=0）
  const byWeekday = new Map(rows.results.map(r => [r.weekday, r]));
  const days = [];
  for (let wd = 0; wd <= 6; wd++) {
    days.push(byWeekday.get(wd) || {
      weekday: wd,
      opensAt: "09:00",
      closesAt: "21:00",
      slotMinutes: 30,
      active: 0,
    });
  }

  return json({ schedule: days });
}

export async function onRequestPost({ request, env, params }) {
  const { shopCode } = params;
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;

  const body = await readJson(request);
  if (!body) return json({ error: "JSON body required" }, 400);

  const weekday = parseInt(body.weekday, 10);
  const opensAt = body.opensAt;
  const closesAt = body.closesAt;
  const slotMinutes = parseInt(body.slotMinutes, 10) || 30;
  const active = body.active === false ? 0 : 1;

  if (!Number.isFinite(weekday) || weekday < 0 || weekday > 6) {
    return json({ error: "weekday 必须是 0-6" }, 400);
  }
  if (!/^\d{2}:\d{2}$/.test(opensAt || "") || !/^\d{2}:\d{2}$/.test(closesAt || "")) {
    return json({ error: "营业时间格式错误，需要 HH:MM" }, 400);
  }
  if (opensAt >= closesAt) {
    return json({ error: "开始时间必须早于结束时间" }, 400);
  }
  if (![15, 30, 45, 60, 90, 120].includes(slotMinutes)) {
    return json({ error: "slotMinutes 必须是 15/30/45/60/90/120" }, 400);
  }

  await env.DB.prepare(`
    INSERT INTO shop_schedule (shop_code, weekday, opens_at, closes_at, slot_minutes, active)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(shop_code, weekday) DO UPDATE SET
      opens_at = excluded.opens_at,
      closes_at = excluded.closes_at,
      slot_minutes = excluded.slot_minutes,
      active = excluded.active
  `).bind(shopCode, weekday, opensAt, closesAt, slotMinutes, active);

  const row = await env.DB.prepare(
    "SELECT * FROM shop_schedule WHERE shop_code = ? AND weekday = ?"
  ).bind(shopCode, weekday).first();

  return json({ schedule: row });
}
