// 共享加密工具：密码哈希、token 生成
// 设计：
// - 密码用 HMAC-SHA256(password, salt) 保护。salt 每账户随机生成，避免彩虹表。
// - 账号密码的暴力破解防线靠 auth 端点的 rate-limit（见 auth.js）；
//   HMAC 本身提供的是"泄露 DB 后密码不被还原"的保护。
// - 会话 token 用 32 字节加密随机数，64 位 hex。

export async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(password));
  return uint8ToHex(new Uint8Array(sig));
}

// 校验密码：恒定时间比较，避免时序侧信道
export async function verifyPassword(password, salt, expectedHash) {
  const actual = await hashPassword(password, salt);
  if (!expectedHash || actual.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
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
