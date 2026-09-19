// 共享加密工具：PIN 哈希、token 生成
// 设计：
// - PIN 用 HMAC-SHA256(pin, salt) 保护。salt 每店铺随机生成，避免彩虹表。
// - 6-8 位 PIN 的暴力破解防线靠 auth 端点的 rate-limit（见 auth.js）；
//   HMAC 本身提供的是"泄露 DB 后密码不被还原"的保护。
// - 会话 token 用 32 字节加密随机数，64 位 hex。

export async function hashPin(pin, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(pin));
  return uint8ToHex(new Uint8Array(sig));
}

export function genToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return uint8ToHex(arr);
}

export function genSalt(bytes = 16) {
  return genToken(bytes);
}

function uint8ToHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
