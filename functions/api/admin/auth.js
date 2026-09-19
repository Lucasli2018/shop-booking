// POST /api/admin/auth?shopCode=xxx
// 登录：校验 PIN，返回 session token
//
// Body: { pin: "123456" }
// 返回: { token, shop, expiresIn }
//
// 首次部署：如果 pin_hash = '__SEED_PIN_UNSET__'，接受 pin='123456' 并写入 hash
//
// 简单 rate-limit：同 shopCode 每 15 分钟最多 20 次尝试
// 用内存 Map（每个 Worker 实例独立），Cloudflare 免费够用；
// 严格的话改用 KV 或 D1 计数。

import { hashPin, genToken } from "../../_shared/crypto.js";
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
  const pin = body && body.pin ? String(body.pin).trim() : "";

  if (!/^\d{6,8}$/.test(pin)) {
    recordAttempt(shopCode, false);
    return fail("PIN 必须是 6-8 位数字", 400);
  }

  // 计算 hash 并比对
  let pinHash;
  let isNew = false;

  if (shop.pin_hash === "__SEED_PIN_UNSET__") {
    // 首次部署：接受任意合法 PIN 作为初始 PIN，写入 hash
    isNew = true;
    pinHash = await hashPin(pin, shop.pin_salt);
    await env.DB.prepare(
      "UPDATE shops SET pin_hash = ?, updated_at = ? WHERE code = ?"
    ).bind(pinHash, new Date().toISOString().slice(0, 19).replace("T", " "), shopCode).run();
  } else {
    pinHash = await hashPin(pin, shop.pin_salt);
    if (pinHash !== shop.pin_hash) {
      recordAttempt(shopCode, false);
      return fail("PIN 错误", 401);
    }
  }

  recordAttempt(shopCode, true);

  // 创建 session
  const token = genToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nowStr = now.toISOString().slice(0, 19).replace("T", " ");
  const expiresStr = expires.toISOString().slice(0, 19).replace("T", " ");

  await env.DB.prepare(
    "INSERT INTO admin_sessions (token, shop_code, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(token, shopCode, nowStr, expiresStr).run();

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
    isNewPin: isNew,
    expiresIn: 86400,
  });
}
