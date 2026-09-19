// 通用 fetch 封装
// 使用：
//   const client = new ApiClient({ shopCode: 'tonys-hair' });
//   const res = await client.get('/api/services/tonys-hair');
//   // admin
//   const admin = new AdminClient({ shopCode: 'tonys-hair', token: 'xxx' });
//   const list = await admin.getBookings({ date: '2026-09-20' });

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

class ApiClient {
  constructor(opts = {}) {
    this.shopCode = opts.shopCode || "tonys-hair";
    this.token = opts.token || null;
    this.baseUrl = opts.baseUrl || "";
  }

  async _request(method, path, opts = {}) {
    const headers = { ...opts.headers };
    const body = opts.body;

    if (body && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const url = this.baseUrl + path;
    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : null,
      });
    } catch (err) {
      throw new ApiError(`网络错误：${err.message}`, 0, null);
    }

    let data = null;
    const ctype = res.headers.get("content-type") || "";
    if (ctype.includes("application/json")) {
      try { data = await res.json(); } catch {}
    } else if (ctype.startsWith("image/")) {
      data = res;
    } else {
      data = await res.text();
    }

    if (!res.ok) {
      const msg = (data && data.error) || `请求失败 (${res.status})`;
      throw new ApiError(msg, res.status, data);
    }

    return data;
  }

  get(path, opts) { return this._request("GET", path, opts); }
  post(path, body, opts) { return this._request("POST", path, { ...opts, body }); }
  put(path, body, opts) { return this._request("PUT", path, { ...opts, body }); }
  delete(path, opts) { return this._request("DELETE", path, opts); }
}

class AdminClient extends ApiClient {
  constructor(opts = {}) {
    super(opts);
    if (!this.token) throw new Error("AdminClient 需要 token");
  }

  // ============ 认证 ============
  static async login(shopCode, pin) {
    const client = new ApiClient({ shopCode });
    const res = await client.post(`/api/admin/auth?shopCode=${encodeURIComponent(shopCode)}`, { pin });
    return res;
  }

  // ============ 预约 ============
  async getBookings(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/admin/${this.shopCode}/bookings${qs ? "?" + qs : ""}`);
  }

  async updateBooking(id, action) {
    return this.post(`/api/admin/${this.shopCode}/bookings/${id}`, { action });
  }

  async getQueue() {
    return this.get(`/api/admin/${this.shopCode}/queue`);
  }

  // ============ 服务 ============
  async getServices() {
    return this.get(`/api/admin/${this.shopCode}/services`);
  }

  async createService(service) {
    return this.post(`/api/admin/${this.shopCode}/services`, service);
  }

  async updateService(id, patch) {
    return this.put(`/api/admin/${this.shopCode}/services/${id}`, patch);
  }

  async deleteService(id) {
    return this.delete(`/api/admin/${this.shopCode}/services/${id}`);
  }

  // ============ 营业时间 ============
  async getSchedule() {
    return this.get(`/api/admin/${this.shopCode}/schedule`);
  }

  async upsertSchedule(day) {
    return this.post(`/api/admin/${this.shopCode}/schedule`, day);
  }

  // ============ 店铺信息 ============
  async getProfile() {
    return this.get(`/api/admin/${this.shopCode}/profile`);
  }

  async updateProfile(patch) {
    return this.put(`/api/admin/${this.shopCode}/profile`, patch);
  }

  // ============ 图片上传 ============
  async uploadImage(file, kind) {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    return this.post(`/api/admin/${this.shopCode}/upload`, form);
  }

  logout() {
    this.token = null;
    localStorage.removeItem(`admin-token-${this.shopCode}`);
  }
}

// ============ Toast 消息 ============
// 注意：本文件被各页面以经典 <script> 引入（非 ES Module），
// 所有符号直接挂全局作用域，供 booking.js / queue.js / admin.js 使用。
function showToast(message, type = "info", duration = 2500) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove("show");
  }, duration);
}

// ============ 工具 ============
function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr.replace(" ", "T"));
  return d.toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  });
}

function formatPrice(priceCents) {
  if (priceCents == null || priceCents === 0) return "免费";
  return `¥${(priceCents / 100).toFixed(priceCents % 100 === 0 ? 0 : 1)}`;
}

function todayString() {
  // 本地日期（不能用 toISOString，它是 UTC，凌晨会取到昨天）
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function weekdayOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.getDay(); // 0=Sun
}

function weekdayName(wd) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][wd] || "";
}

function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const pad = n => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// 本周周一（完整周从周一开始）
function mondayOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); // 周一=0
  const pad = n => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// HTML 转义（全局工具，各页面共用）
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// (全局注册完成：ApiClient / AdminClient / ApiError / showToast / formatDate / formatPrice / todayString / weekdayOf / weekdayName / shiftDate / mondayOf / escapeHtml)
