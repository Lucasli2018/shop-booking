// 管理后台 session 通用守卫
// 用法：
//   const g = await requireAdmin(request, env, shopCode);
//   if (!g.ok) return g.response;
//   // g.shop, g.token

import { requireSession, requireShop, json } from "../../_shared/helpers.js";

export async function requireAdmin(request, env, shopCode) {
  const r = await requireShop(env, shopCode);
  if (r.error) return { ok: false, response: json({ error: r.error }, 404) };
  const shop = r.shop;

  const s = await requireSession(env, request, shopCode);
  if (s.error) return { ok: false, response: json({ error: s.error }, s.status || 401) };

  return { ok: true, shop, session: s.session, token: s.token };
}
