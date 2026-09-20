// 管理后台 session 通用守卫
// 用法：
//   const g = await requireAdmin(request, env, shopCode);
//   if (!g.ok) return g.response;
//   // g.shop, g.session, g.account, g.token
//
//   // 仅店主可操作（账号管理）
//   const o = await requireOwner(request, env, shopCode);
//   if (!o.ok) return o.response;

import { requireSession, requireShop, json } from "../../_shared/helpers.js";

export async function requireAdmin(request, env, shopCode) {
  const r = await requireShop(env, shopCode);
  if (r.error) return { ok: false, response: json({ error: r.error }, 404) };
  const shop = r.shop;

  const s = await requireSession(env, request, shopCode);
  if (s.error) return { ok: false, response: json({ error: s.error }, s.status || 401) };

  return { ok: true, shop, session: s.session, account: s.account, token: s.token };
}

// 仅店主（role = 'owner'）可调用；非店主或无绑定账户返回 403
export async function requireOwner(request, env, shopCode) {
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g;
  if (!g.account || g.account.role !== "owner") {
    return { ok: false, response: json({ error: "仅店主可操作" }, 403) };
  }
  return g;
}
