// DELETE /api/admin/:shopCode/accounts/:id   — 删除账号（仅店主）
// 限制：不能删除自己；不能删除最后一个 owner。

import { requireOwner } from "../../_guard.js";
import { json, fail } from "../../../../_shared/helpers.js";

export async function onRequestDelete({ request, env, params }) {
  const { shopCode, id } = params;
  const g = await requireOwner(request, env, shopCode);
  if (!g.ok) return g.response;

  const targetId = Number(id);
  if (!Number.isInteger(targetId)) return fail("无效账号 ID", 400);

  const target = await env.DB.prepare(
    "SELECT * FROM admin_accounts WHERE id = ? AND shop_code = ?"
  ).bind(targetId, shopCode).first();
  if (!target) return fail("账号不存在", 404);

  // 不能删除自己
  if (g.account && g.account.id === targetId) {
    return fail("不能删除当前登录的账号", 400);
  }

  // 不能删除最后一个 owner
  if (target.role === "owner") {
    const ownerCnt = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM admin_accounts WHERE shop_code = ? AND role = 'owner'"
    ).bind(shopCode).first();
    if (ownerCnt && ownerCnt.c <= 1) {
      return fail("至少保留一个店主账号", 400);
    }
  }

  await env.DB.prepare(
    "DELETE FROM admin_accounts WHERE id = ? AND shop_code = ?"
  ).bind(targetId, shopCode).run();

  // 顺手清理该账号的会话
  await env.DB.prepare(
    "DELETE FROM admin_sessions WHERE account_id = ?"
  ).bind(targetId).run();

  return json({ ok: true, deleted: targetId });
}
