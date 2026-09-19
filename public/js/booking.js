// 顾客预约流程：服务选择 → 时间选择 → 填信息 → 提交

class BookingApp {
  constructor(opts = {}) {
    this.shopCode = opts.shopCode || "tonys-hair";
    this.client = new ApiClient({ shopCode: this.shopCode });
    this.state = {
      shop: null,
      services: [],
      selectedService: null,
      selectedDate: todayString(),
      selectedSlot: null,
      slots: null,
    };
    this.daysToShow = 14;
  }

  async init() {
    // 初始化默认日期选择
    this.renderDateRow();
    this.loadServices();
    this.bindEvents();
    this.bindMyBookings();
  }

  bindEvents() {
    document.getElementById("submitBtn").addEventListener("click", () => this.submit());
    document.getElementById("successCloseBtn").addEventListener("click", () => {
      document.getElementById("successModal").classList.add("hidden");
    });
  }

  // ============ 加载服务 ============
  async loadServices() {
    const grid = document.getElementById("serviceGrid");
    grid.innerHTML = '<div class="loading"><span class="spinner"></span> 加载中…</div>';

    try {
      const res = await this.client.get(`/api/services/${this.shopCode}`);
      this.state.shop = res.shop;
      this.state.services = res.services;

      // 更新头部
      document.getElementById("shopName").textContent = res.shop.name;
      document.getElementById("shopIntro").textContent = res.shop.intro || "";
      // 更新 hero
      const heroName = document.getElementById("heroName");
      const heroIntro = document.getElementById("heroIntro");
      if (heroName) heroName.textContent = res.shop.name;
      if (heroIntro) heroIntro.textContent = res.shop.intro || "欢迎预约，我们将为您提供优质服务。";
      const adminLink = document.getElementById("adminLink");
      if (adminLink) adminLink.href = `/admin.html?shop=${encodeURIComponent(this.shopCode)}`;
      if (res.shop.logoUrl) {
        document.getElementById("shopLogo").innerHTML = `<img src="${res.shop.logoUrl}" alt="">`;
      }
      document.title = `${res.shop.name} · 在线预约`;

      if (res.services.length === 0) {
        grid.innerHTML = '<div class="empty"><div class="icon">🛍️</div><div class="title">暂无可预约服务</div></div>';
        return;
      }

      this.renderServices();
    } catch (err) {
      grid.innerHTML = `<div class="empty"><div class="icon">😢</div><div class="title">加载失败</div><div class="text-sm">${err.message}</div></div>`;
    }
  }

  renderServices() {
    const grid = document.getElementById("serviceGrid");
    grid.innerHTML = this.state.services.map(s => `
      <div class="service-card" data-id="${s.id}">
        <div class="service-name">${escapeHtml(s.name)}</div>
        <div class="service-desc">${escapeHtml(s.description || "")}</div>
        <div class="service-meta">
          <div class="service-price">${formatPrice(s.priceCents)}</div>
          <div class="service-duration">${s.durationMin} 分钟</div>
        </div>
      </div>
    `).join("");

    grid.querySelectorAll(".service-card").forEach(el => {
      el.addEventListener("click", () => {
        grid.querySelectorAll(".service-card").forEach(c => c.classList.remove("selected"));
        el.classList.add("selected");
        const id = parseInt(el.dataset.id, 10);
        this.state.selectedService = this.state.services.find(s => s.id === id);
        this.state.selectedSlot = null;
        this.loadSlots();
        document.getElementById("timeSection").classList.remove("hidden");
        document.getElementById("infoSection").classList.add("hidden");
      });
    });
  }

  // ============ 日期选择 ============
  renderDateRow() {
    const row = document.getElementById("dateRow");
    const today = new Date();
    const days = [];
    for (let i = 0; i < this.daysToShow; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const dateStr = `${y}-${m}-${day}`;
      const wd = d.getDay();
      days.push({ dateStr, day, month: d.getMonth() + 1, weekday: wd, label: i === 0 ? "今天" : i === 1 ? "明天" : weekdayName(wd) });
    }

    row.innerHTML = days.map(d => `
      <div class="date-chip ${d.dateStr === this.state.selectedDate ? "active" : ""}" data-date="${d.dateStr}">
        <span class="weekday">${d.label}</span>
        <span class="day">${d.day}</span>
        <span class="month">${d.month}月</span>
      </div>
    `).join("");

    row.querySelectorAll(".date-chip").forEach(el => {
      el.addEventListener("click", () => {
        row.querySelectorAll(".date-chip").forEach(c => c.classList.remove("active"));
        el.classList.add("active");
        this.state.selectedDate = el.dataset.date;
        this.state.selectedSlot = null;
        this.loadSlots();
        document.getElementById("infoSection").classList.add("hidden");
      });
    });
  }

  // ============ 加载时间段 ============
  async loadSlots() {
    if (!this.state.selectedService) return;
    const grid = document.getElementById("slotGrid");
    grid.innerHTML = '<div class="loading"><span class="spinner"></span> 加载中…</div>';
    document.getElementById("slotHint").textContent = "";

    try {
      const res = await this.client.get(
        `/api/slots/${this.shopCode}?serviceId=${this.state.selectedService.id}&date=${this.state.selectedDate}`
      );
      this.state.slots = res;

      if (res.closed) {
        grid.innerHTML = `<div class="empty" style="grid-column: 1/-1;"><div class="icon">😴</div><div class="title">该日休息</div><div class="text-sm">${escapeHtml(res.closedReason || "")}</div></div>`;
        return;
      }

      if (res.available.length === 0) {
        grid.innerHTML = `<div class="empty" style="grid-column: 1/-1;"><div class="icon">📭</div><div class="title">该日已全部约满</div><div class="text-sm">试试其他日期</div></div>`;
        return;
      }

      const schedule = res.schedule || {};
      document.getElementById("slotHint").textContent =
        `营业 ${schedule.opensAt}-${schedule.closesAt} · 每档 ${schedule.slotMinutes} 分钟 · 可约 ${res.available.length} 档`;

      grid.innerHTML = res.all.map(timeStr => {
        const isAvailable = res.available.includes(timeStr);
        const isOccupied = res.occupied[timeStr];
        const active = this.state.selectedSlot === timeStr;
        const cls = isAvailable ? (active ? "active" : "") : "disabled";
        return `<div class="slot ${cls}" data-time="${timeStr}" ${isAvailable ? "" : "title=" + escapeHtml(isOccupied || "不可约") + ""}>
          ${timeStr}
          ${!isAvailable && isOccupied ? `<span class="reason">${escapeHtml(isOccupied)}</span>` : ""}
        </div>`;
      }).join("");

      grid.querySelectorAll(".slot:not(.disabled)").forEach(el => {
        el.addEventListener("click", () => {
          grid.querySelectorAll(".slot").forEach(s => s.classList.remove("active"));
          el.classList.add("active");
          this.state.selectedSlot = el.dataset.time;
          this.showInfoSection();
        });
      });
    } catch (err) {
      grid.innerHTML = `<div class="empty" style="grid-column: 1/-1;"><div class="icon">😢</div><div class="title">加载失败</div><div class="text-sm">${err.message}</div></div>`;
    }
  }

  showInfoSection() {
    const s = this.state.selectedService;
    const summary = document.getElementById("bookingSummary");
    const schedule = this.state.slots?.schedule || {};
    summary.innerHTML = `
      <div><strong>服务：</strong>${escapeHtml(s.name)} · ${s.durationMin} 分钟 · ${formatPrice(s.priceCents)}</div>
      <div><strong>时间：</strong>${this.state.selectedDate} ${this.state.selectedSlot}</div>
      ${schedule.slotMinutes ? `<div class="text-muted">每档时长 ${schedule.slotMinutes} 分钟</div>` : ""}
    `;
    document.getElementById("infoSection").classList.remove("hidden");
    // 滚动到信息区
    document.getElementById("infoSection").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ============ 提交预约 ============
  async submit() {
    const btn = document.getElementById("submitBtn");
    const name = document.getElementById("customerName").value.trim();
    const phone = document.getElementById("customerPhone").value.trim();
    const note = document.getElementById("customerNote").value.trim();

    if (!this.state.selectedService || !this.state.selectedSlot) {
      showToast("请先选择服务和时间", "error");
      return;
    }
    if (!name) { showToast("请填写姓名", "error"); return; }
    if (!phone || !/^\+?\d{7,20}$/.test(phone)) {
      showToast("请填写有效手机号", "error"); return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 提交中…';

    try {
      const scheduledAt = `${this.state.selectedDate} ${this.state.selectedSlot}`;
      const res = await this.client.post(`/api/bookings/${this.shopCode}`, {
        serviceId: this.state.selectedService.id,
        scheduledAt,
        customerName: name,
        customerPhone: phone,
        note,
      });

      // 显示成功
      const b = res.booking;
      // 记录到 localStorage，供排队页识别「您」
      try {
        localStorage.setItem(`last-booking-${this.shopCode}`, JSON.stringify({
          id: b.id, shopCode: this.shopCode,
        }));
      } catch (_) {}
      document.getElementById("successDetail").innerHTML = `
        <div>📋 预约编号：<strong>#${b.id}</strong></div>
        <div style="margin-top: 6px;">💇 服务：${escapeHtml(b.serviceName)}</div>
        <div style="margin-top: 6px;">🕒 时间：${escapeHtml(b.scheduledAt)}</div>
        <div style="margin-top: 6px;">👤 姓名：${escapeHtml(b.customerName)}</div>
        <div style="margin-top: 6px;">📱 电话：${escapeHtml(b.customerPhone)}</div>
        <div style="margin-top: 8px; font-size: 12px;" class="text-muted">
          请提前 10 分钟到店；如需查看叫号情况，可打开排队页。
        </div>
      `;
      document.getElementById("successModal").classList.remove("hidden");

      // 刷新时间段（占用了）
      this.state.selectedSlot = null;
      this.loadSlots();
    } catch (err) {
      showToast(err.message || "预约失败", "error", 4000);
    } finally {
      btn.disabled = false;
      btn.innerHTML = "📅 提交预约";
    }
  }

  // ============ 我的预约 ============
  bindMyBookings() {
    const open = () => document.getElementById("myBookingsModal").classList.remove("hidden");
    const close = () => document.getElementById("myBookingsModal").classList.add("hidden");

    document.getElementById("myBookingsBtn").addEventListener("click", open);
    const heroMy = document.getElementById("heroMyBtn");
    if (heroMy) heroMy.addEventListener("click", open);
    // 点遮罩 / ESC 关闭
    document.getElementById("myBookingsModal").addEventListener("click", e => {
      if (e.target.id === "myBookingsModal") close();
    });
    document.getElementById("myLookupBtn").addEventListener("click", () => this.lookupMine());
    document.getElementById("myPhone").addEventListener("keydown", e => {
      if (e.key === "Enter") this.lookupMine();
    });
  }

  async lookupMine() {
    const phone = document.getElementById("myPhone").value.trim();
    const listEl = document.getElementById("myBookingsList");
    if (!phone || !/^\+?\d{7,20}$/.test(phone)) {
      showToast("请输入有效手机号", "error");
      return;
    }
    listEl.innerHTML = '<div class="loading"><span class="spinner"></span> 查询中…</div>';
    try {
      const res = await this.client.get(`/api/my/${this.shopCode}?phone=${encodeURIComponent(phone)}`);
      this.renderMyBookings(res.bookings || []);
    } catch (err) {
      listEl.innerHTML = `<div class="empty"><div class="title">查询失败</div><div class="text-sm">${escapeHtml(err.message)}</div></div>`;
    }
  }

  renderMyBookings(bookings) {
    const listEl = document.getElementById("myBookingsList");
    if (bookings.length === 0) {
      listEl.innerHTML = `<div class="empty"><div class="icon">📭</div><div class="title">没有找到预约</div><div class="text-sm">确认手机号是否正确，或换个号码试试</div></div>`;
      return;
    }
    const STATUS = {
      pending:   { label: "待确认", cls: "badge-pending" },
      confirmed: { label: "已确认", cls: "badge-confirmed" },
      called:    { label: "已叫号", cls: "badge-called" },
      done:      { label: "已完成", cls: "badge-done" },
      cancelled: { label: "已取消", cls: "badge-cancelled" },
      rejected:  { label: "已拒绝", cls: "badge-rejected" },
    };
    listEl.innerHTML = bookings.map(b => {
      const st = STATUS[b.status] || { label: b.status, cls: "badge-pending" };
      const canCancel = b.status === "pending" || b.status === "confirmed";
      return `
        <div class="my-booking" data-id="${b.id}" style="border:1px solid var(--border); border-radius:var(--radius-sm); padding:14px; margin-bottom:10px; background:var(--card);">
          <div class="flex" style="justify-content:space-between; align-items:center; gap:8px;">
            <strong style="font-size:15px;">${escapeHtml(b.serviceName)}</strong>
            <span class="badge ${st.cls}">${st.label}</span>
          </div>
          <div class="text-sm text-muted" style="margin-top:6px;">🕒 ${escapeHtml(b.scheduledAt)}</div>
          <div class="text-sm text-muted">👤 ${escapeHtml(b.customerName)} · 📱 ${escapeHtml(maskPhone(b.customerPhone))}</div>
          ${b.note ? `<div class="text-sm text-muted">📝 ${escapeHtml(b.note)}</div>` : ""}
          ${canCancel ? `<div class="text-right mt-2"><button class="btn btn-danger btn-sm" data-cancel="${b.id}">取消预约</button></div>` : ""}
        </div>`;
    }).join("");

    listEl.querySelectorAll("[data-cancel]").forEach(btn => {
      btn.addEventListener("click", () => this.cancelMine(parseInt(btn.dataset.cancel, 10)));
    });
  }

  async cancelMine(id) {
    const phone = document.getElementById("myPhone").value.trim();
    const btn = document.querySelector(`[data-cancel="${id}"]`);
    if (btn) { btn.disabled = true; btn.textContent = "取消中…"; }
    try {
      await this.client.post(`/api/my/${this.shopCode}/cancel`, { bookingId: id, phone });
      showToast("已取消预约", "success");
      await this.lookupMine();
    } catch (err) {
      showToast(err.message || "取消失败", "error");
      if (btn) { btn.disabled = false; btn.textContent = "取消预约"; }
    }
  }
}

// ============ 工具 ============
// escapeHtml 已在 api.js 中定义为全局，这里直接复用。
function maskPhone(p) {
  p = String(p || "");
  if (p.length <= 4) return p;
  return p.slice(0, 3) + "****" + p.slice(-4);
}
