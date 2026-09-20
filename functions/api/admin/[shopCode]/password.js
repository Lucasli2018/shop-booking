// PUT /api/admin/:shopCode/password
// 修改当前登录账户的密码
//
// Body: { currentPassword: "admin123", newPassword: "newpass123" }

import { requireAdmin } from "../_guard.js";
import { json, readJson, fail } from "../../../_shared/helpers.js";
import { hashPassword, verifyPassword, genSalt } from "../../../_shared/crypto.js";

const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");

export async function onRequestPut({ request, env, params }) {
  const { shopCode } = params;
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;
  const account = g.account;
  if (!account) return fail("会话未绑定账户", 401);

  const body = await readJson(request);
  if (!body) return fail("JSON body required", 400);

  const currentPassword = body.currentPassword ? String(body.currentPassword) : "";
  const newPassword = body.newPassword ? String(body.newPassword) : "";

  if (newPassword.length < 6 || newPassword.length > 64) {
    return fail("新密码长度需 6-64 位", 400);
  }

  // 校验当前密码
  const full = await env.DB.prepare(
    "SELECT * FROM admin_accounts WHERE id = ?"
  ).bind(account.id).first();
  if (!full || !(await verifyPassword(currentPassword, full.pass_salt, full.pass_hash))) {
    return fail("当前密码错误", 401);
  }

  const newSalt = genSalt(16);
  const newHash = await hashPassword(newPassword, newSalt);
  await env.DB.prepare(
    "UPDATE admin_accounts SET pass_hash = ?, pass_salt = ? WHERE id = ?"
  ).bind(newHash, newSalt, account.id).run();

  return json({ ok: true, passwordChanged: true });
}
