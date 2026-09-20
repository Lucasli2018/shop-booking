// GET  /api/admin/:shopCode/accounts   — 列出本店所有账号（仅店主）
// POST /api/admin/:shopCode/accounts   — 新增账号（仅店主）
//
// POST Body: { username: "staff1", password: "abc123", role?: "staff" | "owner" }

import { requireOwner } from "../_guard.js";
import { json, readJson, fail } from "../../../_shared/helpers.js";
import { hashPassword, genSalt } from "../../../_shared/crypto.js";

const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");

export async function onRequestGet({ request, env, params }) {
  const { shopCode } = params;
  const g = await requireOwner(request, env, shopCode);
  if (!g.ok) return g.response;

  const rows = await env.DB.prepare(
    `SELECT id, username, role, last_login_at, created_at
     FROM admin_accounts WHERE shop_code = ? ORDER BY role DESC, id ASC`
  ).bind(shopCode).all();

  return json({ accounts: rows.results || [] });
}

export async function onRequestPost({ request, env, params }) {
  const { shopCode } = params;
  const g = await requireOwner(request, env, shopCode);
  if (!g.ok) return g.response;

  const body = await readJson(request);
  if (!body) return fail("JSON body required", 400);

  const username = body.username ? String(body.username).trim().toLowerCase() : "";
  const password = body.password ? String(body.password) : "";
  const role = body.role === "staff" ? "staff" : "owner";

  if (username.length < 3 || username.length > 32) {
    return fail("用户名需 3-32 位", 400);
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return fail("用户名仅限字母、数字、下划线", 400);
  }
  if (password.length < 6 || password.length > 64) {
    return fail("密码长度需 6-64 位", 400);
  }

  const dup = await env.DB.prepare(
    "SELECT id FROM admin_accounts WHERE shop_code = ? AND username = ?"
  ).bind(shopCode, username).first();
  if (dup) return fail("该用户名已存在", 409);

  const salt = genSalt(16);
  const hash = await hashPassword(password, salt);
  const res = await env.DB.prepare(
    `INSERT INTO admin_accounts(shop_code, username, pass_hash, pass_salt, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(shopCode, username, hash, salt, role, now()).run();

  const id = res.meta?.last_row_id || res.meta?.inserted_rowid;
  return json({
    ok: true,
    account: { id, username, role },
  }, 201);
}
