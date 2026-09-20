// 共享工具：JSON 响应、错误处理、session 校验、时间工具

// ============ JSON helpers ============
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function fail(message, status = 400) {
  return json({ error: message }, status);
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// ============ 校验店铺存在 ============
export async function getShop(env, shopCode) {
  if (!shopCode || typeof shopCode !== "string") return null;
  const row = await env.DB.prepare("SELECT * FROM shops WHERE code = ?")
    .bind(shopCode).first();
  return row;
}

export async function requireShop(env, shopCode) {
  const shop = await getShop(env, shopCode);
  if (!shop) return { error: "店铺不存在" };
  if (shop.status !== "active") return { error: "店铺已暂停" };
  return { shop };
}

// ============ Session 校验 ============
// token 支持两种传递方式：
// 1. query: ?token=xxx
// 2. header: Authorization: Bearer xxx
export function extractToken(request) {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("token");
  if (fromQuery) return fromQuery;
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

export async function requireSession(env, request, shopCode) {
  const token = extractToken(request);
  if (!token) return { error: "未登录", status: 401 };

  const session = await env.DB.prepare(
    "SELECT * FROM admin_sessions WHERE token = ?"
  ).bind(token).first();

  if (!session) return { error: "会话无效", status: 401 };

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  if (session.expires_at < now) {
    await env.DB.prepare("DELETE FROM admin_sessions WHERE token = ?")
      .bind(token).run();
    return { error: "会话已过期", status: 401 };
  }

  if (session.shop_code !== shopCode) {
    return { error: "会话不匹配店铺", status: 403 };
  }

  // 会话绑定的账户（旧会话可能无 account_id，容忍为 null）
  let account = null;
  if (session.account_id) {
    account = await getAccount(env, session.account_id);
    if (!account) return { error: "账户不存在", status: 401 };
  }

  return { session, token, accountId: session.account_id || null, account };
}

export async function getAccount(env, accountId) {
  if (!accountId) return null;
  return env.DB.prepare("SELECT * FROM admin_accounts WHERE id = ?")
    .bind(accountId).first();
}

// ============ 时间工具 ============
// 所有时间字符串统一格式 'YYYY-MM-DD HH:MM'（naive，用店铺本地时间）
// Cloudflare Workers 拿到的 Date 是 UTC，这里手动做本地化转换

export function nowLocalString(tz = "Asia/Shanghai") {
  // 用 Intl.DateTimeFormat 转成目标时区的本地时间字符串
  // hourCycle: 'h23' 保证小时是 0-23（午夜为 00，不是 24）
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export function weekdayOf(dateStr, tz = "Asia/Shanghai") {
  // dateStr: 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:MM'
  const d = dateStr.slice(0, 10);
  const [y, m, day] = d.split("-").map(Number);
  // 用 UTC 构造避免时区偏移；日期本身已经确定
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.getUTCDay(); // 0=Sun ... 6=Sat
}

// 加分钟，返回 'YYYY-MM-DD HH:MM'
export function addMinutes(dateStr, minutes) {
  const [date, time] = dateStr.split(" ");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, hh, mm));
  dt.setUTCMinutes(dt.getUTCMinutes() + minutes);
  const pad = n => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`;
}

// 判断 a < b（字符串比较，格式一致时可用）
export function timeBefore(a, b) {
  return a < b;
}

// 生成候选时间点：从 opens_at 到 closes_at，每 slot_minutes 一个
// 返回 ['HH:MM', 'HH:MM', ...]
export function generateTimePoints(opensAt, closesAt, slotMinutes) {
  const toMin = t => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const fromMin = min => {
    const pad = n => String(n).padStart(2, "0");
    return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
  };
  const points = [];
  for (let t = toMin(opensAt); t < toMin(closesAt); t += slotMinutes) {
    points.push(fromMin(t));
  }
  return points;
}

// 检查一个时间段是否已被占用
// busyRanges: [{start: 'YYYY-MM-DD HH:MM', end: 'YYYY-MM-DD HH:MM'}]
// candidate: 'YYYY-MM-DD HH:MM' + durationMin
export function isOverlapping(candidateStart, durationMin, busyRanges) {
  const candidateEnd = addMinutes(candidateStart, durationMin);
  for (const range of busyRanges) {
    // 有重叠 = candidateStart < range.end && range.start < candidateEnd
    if (candidateStart < range.end && range.start < candidateEnd) {
      return true;
    }
  }
  return false;
}

// ============ 参数解析 ============
export function getString(params, key, fallback = "") {
  return typeof params[key] === "string" ? params[key] : fallback;
}

export function getInt(params, key, fallback = 0) {
  const v = Number(params[key]);
  return Number.isFinite(v) ? v : fallback;
}

export function ok(result) {
  if (result.error) return null;
  return result;
}
