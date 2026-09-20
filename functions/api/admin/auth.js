// POST /api/admin/auth?shopCode=xxx
// 账号密码登录：校验用户名 + 密码，返回 session token
//
// Body: { username: "admin", password: "admin123" }
// 返回: { token, shop, account: {username, role}, expiresIn }
//
// 简单 rate-limit：同 shopCode 每 15 分钟最多 20 次尝试
// 用内存 Map（每个 Worker 实例独立），Cloudflare 免费够用；
// 严格的话改用 KV 或 D1 计数。

import { verifyPassword, genToken } from "../../_shared/crypto.js";
import { json, fail, readJson, requireShop } from "../../_shared/helpers.js";

// 内存 rate-limit（每个 Worker isolate 独立）
const attempts = new Map(); // shopCode -> [{t: ms, ok: bool}]
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 20;

function checkRateLimit(shopCode) {
  const now = Date.now();
  const list = (attempts.get(shopCode) || []).filter(e => now - e.t < WINDOW_MS);
  if (list.length >= MAX_ATTEMPTS) {
    return false;
  }
  attempts.set(shopCode, list);
  return true;
}

function recordAttempt(shopCode, ok) {
  const now = Date.now();
  const list = (attempts.get(shopCode) || []).filter(e => now - e.t < WINDOW_MS);
  list.push({ t: now, ok });
  attempts.set(shopCode, list);
}

export async function onRequestPost({ request, env, params }) {
  const url = new URL(request.url);
  const shopCode = url.searchParams.get("shopCode");
  if (!shopCode) return fail("缺少 shopCode");

  const r = await requireShop(env, shopCode);
  if (r.error) return fail(r.error, 404);
  const shop = r.shop;

  // Rate limit
  if (!checkRateLimit(shopCode)) {
    return fail("尝试次数过多，请 15 分钟后重试", 429);
  }

  const body = await readJson(request);
  const username = body && body.username ? String(body.username).trim().toLowerCase() : "";
  const password = body && body.password ? String(body.password) : "";

  if (username.length < 3 || username.length > 32) {
    recordAttempt(shopCode, false);
    return fail("用户名格式不正确（3-32 位）", 400);
  }
  if (password.length < 6 || password.length > 64) {
    recordAttempt(shopCode, false);
    return fail("密码长度需 6-64 位", 400);
  }

  // 查账户
  const account = await env.DB.prepare(
    "SELECT * FROM admin_accounts WHERE shop_code = ? AND username = ?"
  ).bind(shopCode, username).first();

  if (!account || !(await verifyPassword(password, account.pass_salt, account.pass_hash))) {
    recordAttempt(shopCode, false);
    return fail("用户名或密码错误", 401);
  }

  recordAttempt(shopCode, true);

  // 更新最后登录时间
  const nowStr = new Date().toISOString().slice(0, 19).replace("T", " ");
  await env.DB.prepare(
    "UPDATE admin_accounts SET last_login_at = ? WHERE id = ?"
  ).bind(nowStr, account.id).run();

  // 创建 session（绑定 account_id）
  const token = genToken(32);
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const expiresStr = expires.toISOString().slice(0, 19).replace("T", " ");

  await env.DB.prepare(
    "INSERT INTO admin_sessions (token, shop_code, account_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(token, shopCode, account.id, nowStr, expiresStr).run();

  // 清理过期 session（顺手做）
  await env.DB.prepare(
    "DELETE FROM admin_sessions WHERE expires_at < ?"
  ).bind(nowStr).run();

  return json({
    token,
    shop: {
      code: shop.code,
      name: shop.name,
      intro: shop.intro,
      phone: shop.phone,
      address: shop.address,
    },
    account: {
      id: account.id,
      username: account.username,
      role: account.role,
    },
    expiresIn: 86400,
  });
}
