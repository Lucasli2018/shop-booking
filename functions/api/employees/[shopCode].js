// GET /api/employees/:shopCode
// 公开：返回该店铺在岗（active=1）的员工列表，供顾客预约页「指定师傅」使用
//
// 返回：{ employees: [{ id, name, title, intro, sortOrder, avatarUrl }] }

import { json, fail, requireShop } from "../../_shared/helpers.js";

export async function onRequestGet({ request, env, params }) {
  const { shopCode } = params;
  const r = await requireShop(env, shopCode);
  if (r.error) return fail(r.error, 404);

  const rows = await env.DB.prepare(`
    SELECT id, name, title, intro, sort_order AS sortOrder, avatar_key AS avatarKey
    FROM sb_employees
    WHERE shop_code = ? AND active = 1
    ORDER BY sort_order, id
  `).bind(shopCode).all();

  const employees = rows.results.map(e => ({
    id: e.id,
    name: e.name,
    title: e.title || "",
    intro: e.intro || "",
    sortOrder: e.sortOrder,
    avatarUrl: e.avatarKey ? `/api/admin/image/${shopCode}/${e.avatarKey}` : null,
  }));

  return json({ employees });
}
