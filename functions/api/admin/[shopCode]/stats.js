// GET /api/admin/:shopCode/stats
// 数据统计仪表盘（全部基于店铺时区的本地日期）
//
// 返回：
// {
//   today:  { total, pending, confirmed, called, done, cancelled, revenueCents },
//   week:   { total, done, cancelled, cancelRate },
//   month:  { total, done, cancelled, cancelRate },
//   topServices: [{ name, count }],        // 近 30 天预约量 TOP5
//   trend: [{ date, total, done }]         // 近 7 天（含今天，升序）
// }

import { requireAdmin } from "../_guard.js";
import { json, nowLocalString } from "../../../_shared/helpers.js";

export async function onRequestGet({ request, env, params }) {
  const { shopCode } = params;
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;
  const shop = g.shop;

  const today = nowLocalString(shop.timezone).slice(0, 10);

  // 今日分状态统计 + 营收（done/called 视为已产生消费）
  const todayStats = await env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN status='called' THEN 1 ELSE 0 END) AS called,
      SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
      COALESCE(SUM(CASE WHEN status IN ('done','called') THEN s.price_cents ELSE 0 END), 0) AS revenueCents
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    WHERE b.shop_code = ? AND b.scheduled_at LIKE ?
  `).bind(shopCode, `${today}%`).first();

  // 区间统计（week = 近7天含今天，month = 近30天）
  const rangeStat = async (days) => {
    const row = await env.DB.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done,
             SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled
      FROM bookings
      WHERE shop_code = ?
        AND scheduled_at >= datetime(?, '-${days} days')
        AND scheduled_at <= ?
    `).bind(shopCode, `${today} 00:00`, `${today} 23:59`).first();
    const total = row.total || 0;
    const cancelled = row.cancelled || 0;
    return {
      total,
      done: row.done || 0,
      cancelled,
      cancelRate: total ? Math.round(cancelled / total * 100) : 0,
    };
  };
  const week = await rangeStat(7);
  const month = await rangeStat(30);

  // 热门服务 TOP5（近 30 天，排除已取消）
  const topRows = await env.DB.prepare(`
    SELECT s.name AS name, COUNT(*) AS count
    FROM bookings b JOIN services s ON s.id = b.service_id
    WHERE b.shop_code = ?
      AND b.status NOT IN ('cancelled','rejected')
      AND b.scheduled_at >= datetime(?, '-30 days')
    GROUP BY s.id ORDER BY count DESC LIMIT 5
  `).bind(shopCode, `${today} 00:00`).all();

  // 近 7 天趋势
  const trendRows = await env.DB.prepare(`
    SELECT substr(scheduled_at, 1, 10) AS date,
           COUNT(*) AS total,
           SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done
    FROM bookings
    WHERE shop_code = ?
      AND scheduled_at >= datetime(?, '-6 days')
      AND scheduled_at <= ?
    GROUP BY date ORDER BY date ASC
  `).bind(shopCode, `${today} 00:00`, `${today} 23:59`).all();

  // 补齐没有数据的日期
  const byDate = new Map(trendRows.results.map(r => [r.date, r]));
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const r = byDate.get(ds);
    trend.push({ date: ds, total: r ? r.total : 0, done: r ? (r.done || 0) : 0 });
  }

  return json({
    today: {
      total: todayStats.total || 0,
      pending: todayStats.pending || 0,
      confirmed: todayStats.confirmed || 0,
      called: todayStats.called || 0,
      done: todayStats.done || 0,
      cancelled: todayStats.cancelled || 0,
      revenueCents: todayStats.revenueCents || 0,
    },
    week,
    month,
    topServices: topRows.results,
    trend,
  });
}
