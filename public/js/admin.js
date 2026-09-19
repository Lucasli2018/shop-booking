// 商家后台：登录、排队、预约、服务、营业时间、店铺设置

class AdminApp {
  constructor(opts = {}) {
    this.shopCode = opts.shopCode || "tonys-hair";
    this.token = localStorage.getItem(`admin-token-${this.shopCode}`) || null;
    this.admin = this.token ? new AdminClient({ shopCode: this.shopCode, token: this.token }) : null;
    this.currentTab = "queue";
    this.queueTimer = null;
    this.bookingsTimer = null;
    this.bookingsView = "day";      // day | week
    this.weekStart = mondayOf(todayString());
  }

  init() {
    this.bindGlobalEvents();

    if (this.token) {
      this.showAdmin();
    } else {
      this.showLogin();
    }
  }

  // ============ 登录 ============
  showLogin() {
    document.getElementById("loginScreen").classList.remove("hidden");
    document.getElementById("adminScreen").classList.add("hidden");

    const input = document.getElementById("pinInput");
    const btn = document.getElementById("loginBtn");
    const err = document.getElementById("loginError");

    const tryLogin = async () => {
      const pin = input.value.trim();
      if (!/^\d{6,8}$/.test(pin)) {
        err.textContent = "PIN 必须是 6-8 位数字";
        return;
      }
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 登录中…';
      err.textContent = "";
      try {
        const res = await AdminClient.login(this.shopCode, pin);
        this.token = res.token;
        localStorage.setItem(`admin-token-${this.shopCode}`, this.token);
        this.admin = new AdminClient({ shopCode: this.shopCode, token: this.token });
        this.showAdmin();
        if (res.isNewPin) {
          showToast("PIN 已设置，下次登录请用此 PIN", "success");
        }
      } catch (e) {
        err.textContent = e.message || "登录失败";
      } finally {
        btn.disabled = false;
        btn.innerHTML = "登 录";
      }
    };

    btn.addEventListener("click", tryLogin);
    input.addEventListener("keypress", e => { if (e.key === "Enter") tryLogin(); });
    setTimeout(() => input.focus(), 100);
  }

  async showAdmin() {
    document.getElementById("loginScreen").classList.add("hidden");
    document.getElementById("adminScreen").classList.remove("hidden");

    // 加载店铺信息
    try {
      const res = await this.admin.getProfile();
      document.getElementById("adminShopName").textContent = res.shop.name;
      document.getElementById("adminShopCode").textContent = res.shop.code;
      document.title = `${res.shop.name} · 商家后台`;
      if (res.shop.logoUrl) {
        document.getElementById("adminLogo").innerHTML = `<img src="${res.shop.logoUrl}" alt="" style="width:100%;height:100%;object-fit:cover;">`;
      }
    } catch (err) {
      // token 可能已失效
      if (err.status === 401) {
        this.logout();
        this.showLogin();
        return;
      }
      console.error(err);
    }

    // 切换到默认 tab
    this.switchTab("queue");
  }

  logout() {
    if (this.admin) this.admin.logout();
    this.token = null;
    this.admin = null;
    if (this.queueTimer) clearInterval(this.queueTimer);
    if (this.bookingsTimer) clearInterval(this.bookingsTimer);
    this.showLogin();
  }

  // ============ 全局事件 ============
  bindGlobalEvents() {
    document.getElementById("logoutBtn").addEventListener("click", () => this.logout());

    document.querySelectorAll(".admin-tab").forEach(tab => {
      tab.addEventListener("click", () => this.switchTab(tab.dataset.tab));
    });

    // 预约页
    document.getElementById("refreshBookingsBtn").addEventListener("click", () => this.loadBookings());
    document.getElementById("bookingDate").addEventListener("change", () => this.loadBookings());
    document.getElementById("bookingStatusFilter").addEventListener("change", () => this.loadBookings());

    // 日/周视图切换
    document.querySelectorAll("#bookingsViewToggle .vt-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        this.bookingsView = btn.dataset.view;
        document.querySelectorAll("#bookingsViewToggle .vt-btn").forEach(b => b.classList.toggle("active", b === btn));
        this.loadBookings();
      });
    });
    document.getElementById("weekPrevBtn").addEventListener("click", () => {
      this.weekStart = shiftDate(this.weekStart, -7);
      this.loadBookings();
    });
    document.getElementById("weekNextBtn").addEventListener("click", () => {
      this.weekStart = shiftDate(this.weekStart, 7);
      this.loadBookings();
    });

    // 服务
    document.getElementById("addServiceBtn").addEventListener("click", () => this.openServiceModal());

    // 店铺设置
    document.getElementById("saveProfileBtn").addEventListener("click", () => this.saveProfile());
    document.getElementById("savePinBtn").addEventListener("click", () => this.changePin());
    document.getElementById("logoInput").addEventListener("change", e => this.uploadImage(e.target, "logo"));
    document.getElementById("coverInput").addEventListener("change", e => this.uploadImage(e.target, "cover"));
  }

  // ============ Tab 切换 ============
  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll(".admin-tab").forEach(t => {
      t.classList.toggle("active", t.dataset.tab === tab);
    });
    document.querySelectorAll(".tab-panel").forEach(p => {
      p.classList.toggle("hidden", p.dataset.panel !== tab);
    });

    // 加载对应数据
    if (tab === "queue") this.loadQueue();
    if (tab === "bookings") this.loadBookings();
    if (tab === "services") this.loadServices();
    if (tab === "schedule") this.loadSchedule();
    if (tab === "profile") this.loadProfile();
  }

  // ============ 排队 Tab ============
  async loadQueue() {
    try {
      const res = await this.admin.getQueue();
      document.getElementById("queueUpdateAt").textContent =
        `· 更新于 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;

      // 正在服务
      const nowServing = document.getElementById("nowServing");
      if (res.nowServing) {
        const s = res.nowServing;
        nowServing.innerHTML = `
          <div class="card" style="background: linear-gradient(135deg, #FCE4E4, #FFFFFF); border-color: var(--primary); padding: 20px;">
            <div style="font-size: 24px; font-weight: 700;">${escapeHtml(s.customerName)}</div>
            <div class="text-sm text-muted">${escapeHtml(s.serviceName)} · 预计 ${escapeHtml(s.scheduledAt)}</div>
            <div class="text-sm text-muted mt-2">电话：${escapeHtml(s.customerPhone || "-")}</div>
            <div class="mt-3">
              <button class="btn btn-primary btn-sm" onclick="app.completeServing(${s.id})">✅ 完成服务</button>
            </div>
          </div>
        `;
      } else {
        nowServing.innerHTML = '<div class="empty"><div class="icon">💤</div><div class="text-sm">暂无</div></div>';
      }

      // 等待列表
      const waiting = document.getElementById("waitingList");
      if (res.waiting.length === 0) {
        waiting.innerHTML = '<div class="empty"><div class="text-sm">暂无</div></div>';
      } else {
        waiting.innerHTML = res.waiting.map(w => `
          <div class="queue-item" style="margin-bottom: 8px;">
            <div class="queue-pos">${w.position}</div>
            <div style="flex: 1;">
              <div><strong>${escapeHtml(w.customerName)}</strong></div>
              <div class="text-sm text-muted">${escapeHtml(w.serviceName)} · ${escapeHtml(w.scheduledAt)}</div>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="app.callBooking(${w.id})">📣 叫号</button>
          </div>
        `).join("");
      }

      // Pending
      const pending = document.getElementById("pendingList");
      if (res.pending.length === 0) {
        pending.innerHTML = '<div class="empty"><div class="text-sm">暂无</div></div>';
      } else {
        pending.innerHTML = res.pending.map(p => `
          <div class="queue-item" style="margin-bottom: 8px; border-color: #F0D9B8; background: linear-gradient(135deg, #FFF8E8, #FFFFFF);">
            <div class="queue-pos" style="background: #FFF4E0; color: #B87A00;">!</div>
            <div style="flex: 1;">
              <div><strong>${escapeHtml(p.customer_name)}</strong></div>
              <div class="text-sm text-muted">${escapeHtml(p.serviceName)} · ${escapeHtml(p.scheduled_at)}</div>
            </div>
            <div class="flex gap-2">
              <button class="btn btn-secondary btn-sm" onclick="app.confirmBooking(${p.id})">✓ 确认</button>
              <button class="btn btn-danger btn-sm" onclick="app.rejectBooking(${p.id})">✕ 拒绝</button>
            </div>
          </div>
        `).join("");
      }
    } catch (err) {
      if (err.status === 401) { this.logout(); return; }
      showToast(err.message, "error");
    }
  }

  // 排队自动刷新
  startQueuePolling() {
    if (this.queueTimer) clearInterval(this.queueTimer);
    this.queueTimer = setInterval(() => {
      if (this.currentTab === "queue") this.loadQueue();
    }, 15000);
  }

  // ============ 排队操作 ============
  async confirmBooking(id) {
    try {
      await this.admin.updateBooking(id, "confirmed");
      showToast("已确认", "success");
      this.loadQueue();
    } catch (err) { showToast(err.message, "error"); }
  }

  async rejectBooking(id) {
    try {
      await this.admin.updateBooking(id, "rejected");
      showToast("已拒绝", "success");
      this.loadQueue();
    } catch (err) { showToast(err.message, "error"); }
  }

  async callBooking(id) {
    try {
      await this.admin.updateBooking(id, "called");
      showToast("已叫号", "success");
      this.loadQueue();
    } catch (err) { showToast(err.message, "error"); }
  }

  async completeServing(id) {
    try {
      await this.admin.updateBooking(id, "done");
      showToast("服务完成", "success");
      this.loadQueue();
    } catch (err) { showToast(err.message, "error"); }
  }

  // ============ 预约 Tab ============
  async loadBookings() {
    const isWeek = this.bookingsView === "week";
    document.getElementById("dayView").classList.toggle("hidden", isWeek);
    document.getElementById("weekView").classList.toggle("hidden", !isWeek);
    document.getElementById("weekPrevBtn").classList.toggle("hidden", !isWeek);
    document.getElementById("weekNextBtn").classList.toggle("hidden", !isWeek);

    if (isWeek) return this.loadWeekBookings();

    const date = document.getElementById("bookingDate").value;
    const status = document.getElementById("bookingStatusFilter").value;
    const body = document.getElementById("bookingsBody");

    if (!date) document.getElementById("bookingDate").value = todayString();

    body.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding: 40px;"><span class="spinner"></span> 加载中…</td></tr>';

    try {
      const res = await this.admin.getBookings({ date, status, limit: 100 });
      this.renderBookingStats(res.todayCounts);
      this.renderBookingsTable(res.bookings);
    } catch (err) {
      body.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding: 40px;">${escapeHtml(err.message)}</td></tr>`;
      if (err.status === 401) this.logout();
    }
  }

  // ============ 周视图 ============
  async loadWeekBookings() {
    const status = document.getElementById("bookingStatusFilter").value;
    const weekEl = document.getElementById("weekView");
    const from = this.weekStart;
    const to = shiftDate(from, 6);

    weekEl.innerHTML = '<div class="loading" style="padding: 40px; justify-content: center;"><span class="spinner"></span> 加载中…</div>';
    try {
      const res = await this.admin.getBookings({ from, to, status, limit: 400 });
      this.renderWeekView(res.bookings, from);
    } catch (err) {
      weekEl.innerHTML = `<div class="text-center text-muted" style="padding: 40px;">${escapeHtml(err.message)}</div>`;
      if (err.status === 401) this.logout();
    }
  }

  renderWeekView(bookings, from) {
    const weekEl = document.getElementById("weekView");
    // 按日期分组
    const byDate = {};
    for (const b of bookings) {
      const d = b.scheduled_at.slice(0, 10);
      (byDate[d] = byDate[d] || []).push(b);
    }
    const WN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const today = todayString();

    let cols = "";
    for (let i = 0; i < 7; i++) {
      const d = shiftDate(from, i);
      const list = (byDate[d] || []).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
      const wd = weekdayOf(d);
      const items = list.map(b => `
        <div class="week-item st-${b.status}" title="${escapeHtml(b.customer_name)} · ${escapeHtml(b.serviceName || "")}">
          <span class="week-time">${escapeHtml(b.scheduled_at.slice(11))}</span>
          <span class="week-svc">${escapeHtml(b.serviceName || "-")}</span>
          <span class="week-cust">${escapeHtml(b.customer_name)}</span>
        </div>`).join("");

      cols += `
        <div class="week-col ${d === today ? "today" : ""}">
          <div class="week-col-head" data-day="${d}" title="切到日视图">
            <span>${WN[wd]}</span>
            <strong>${d.slice(5)}</strong>
            <span class="week-count">${list.length} 单</span>
          </div>
          <div class="week-col-body">${items || '<div class="week-empty">无预约</div>'}</div>
        </div>`;
    }
    weekEl.innerHTML = `<div class="week-grid">${cols}</div>`;

    weekEl.querySelectorAll(".week-col-head").forEach(h => {
      h.addEventListener("click", () => {
        this.bookingsView = "day";
        document.querySelectorAll("#bookingsViewToggle .vt-btn").forEach(b => b.classList.toggle("active", b.dataset.view === "day"));
        document.getElementById("bookingDate").value = h.dataset.day;
        this.loadBookings();
      });
    });
  }

  renderBookingStats(c) {
    const stats = document.getElementById("bookingStats");
    if (!c) return;
    stats.innerHTML = `
      <div class="stat-card pending"><div class="stat-value">${c.pending || 0}</div><div class="stat-label">待确认</div></div>
      <div class="stat-card confirmed"><div class="stat-value">${c.confirmed || 0}</div><div class="stat-label">已确认</div></div>
      <div class="stat-card called"><div class="stat-value">${c.called || 0}</div><div class="stat-label">已叫号</div></div>
      <div class="stat-card done"><div class="stat-value">${c.done || 0}</div><div class="stat-label">已完成</div></div>
      <div class="stat-card"><div class="stat-value">${c.total || 0}</div><div class="stat-label">今日总预约</div></div>
    `;
  }

  renderBookingsTable(bookings) {
    const body = document.getElementById("bookingsBody");
    if (bookings.length === 0) {
      body.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding: 40px;">📭 暂无预约</td></tr>';
      return;
    }
    body.innerHTML = bookings.map(b => `
      <tr>
        <td>#${b.id}</td>
        <td>${escapeHtml(b.scheduled_at)}</td>
        <td>${escapeHtml(b.serviceName || "-")}<br><span class="text-sm text-muted">${b.duration_min} 分钟</span></td>
        <td>${escapeHtml(b.customer_name)}</td>
        <td>${escapeHtml(b.customer_phone)}</td>
        <td><span class="badge badge-${b.status}">${STATUS_LABEL[b.status] || b.status}</span></td>
        <td>${this.renderBookingActions(b)}</td>
      </tr>
    `).join("");
  }

  renderBookingActions(b) {
    const actions = [];
    const id = b.id;
    if (b.status === "pending") {
      actions.push(`<button class="btn btn-secondary btn-sm" onclick="app.confirmBooking(${id})">确认</button>`);
      actions.push(`<button class="btn btn-danger btn-sm" onclick="app.rejectBooking(${id})">拒绝</button>`);
    }
    if (b.status === "confirmed") {
      actions.push(`<button class="btn btn-primary btn-sm" onclick="app.callBooking(${id})">叫号</button>`);
      actions.push(`<button class="btn btn-ghost btn-sm" onclick="app.cancelBooking(${id})">取消</button>`);
    }
    if (b.status === "called") {
      actions.push(`<button class="btn btn-secondary btn-sm" onclick="app.completeServing(${id})">完成</button>`);
      actions.push(`<button class="btn btn-ghost btn-sm" onclick="app.cancelBooking(${id})">取消</button>`);
    }
    return actions.join(" ");
  }

  async cancelBooking(id) {
    try {
      await this.admin.updateBooking(id, "cancelled");
      showToast("已取消", "success");
      this.loadBookings();
    } catch (err) { showToast(err.message, "error"); }
  }

  // ============ 服务 Tab ============
  async loadServices() {
    try {
      const res = await this.admin.getServices();
      const body = document.getElementById("servicesBody");
      if (res.services.length === 0) {
        body.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding: 40px;">📭 暂无服务，点右上角新增</td></tr>';
        return;
      }
      body.innerHTML = res.services.map(s => `
        <tr>
          <td>#${s.id}</td>
          <td><strong>${escapeHtml(s.name)}</strong>${s.description ? `<br><span class="text-sm text-muted">${escapeHtml(s.description)}</span>` : ""}</td>
          <td>${s.durationMin} 分钟</td>
          <td>${formatPrice(s.priceCents)}</td>
          <td>${s.sortOrder}</td>
          <td>${s.active ? '<span class="badge badge-confirmed">上架</span>' : '<span class="badge badge-rejected">下架</span>'}</td>
          <td>
            <button class="btn btn-ghost btn-sm" onclick="app.openServiceModal(${s.id})">✏️ 编辑</button>
            <button class="btn btn-danger btn-sm" onclick="app.deleteService(${s.id}, '${escapeAttr(s.name)}')">🗑️ 删除</button>
          </td>
        </tr>
      `).join("");
    } catch (err) {
      showToast(err.message, "error");
      if (err.status === 401) this.logout();
    }
  }

  openServiceModal(id = null) {
    const content = document.getElementById("modalContent");
    content.innerHTML = `
      <h2 class="modal-title">${id ? "编辑服务" : "新增服务"}</h2>
      <div class="field">
        <label class="field-label">服务名称 <span class="req">*</span></label>
        <input class="input" id="svcName" placeholder="例如：男士精剪">
      </div>
      <div class="field">
        <label class="field-label">描述</label>
        <textarea class="textarea" id="svcDesc" placeholder="简短描述" maxlength="300"></textarea>
      </div>
      <div class="field">
        <label class="field-label">分类</label>
        <input class="input" id="svcCategory" placeholder="例如：剪发 / 染烫 / 护理（留空归为「其他」）" maxlength="20">
      </div>
      <div class="field">
        <label class="field-label">时长（分钟）<span class="req">*</span></label>
        <input type="number" class="input" id="svcDuration" min="5" max="720" placeholder="30">
      </div>
      <div class="field">
        <label class="field-label">价格（元）</label>
        <input type="number" class="input" id="svcPrice" min="0" step="0.01" placeholder="68">
      </div>
      <div class="field">
        <label class="field-label">显示顺序</label>
        <input type="number" class="input" id="svcOrder" min="0" value="0">
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="app.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="app.saveService(${id})">💾 保存</button>
      </div>
    `;

    if (id) {
      // 拉取详情
      this.admin.get(`/api/admin/${this.shopCode}/services/${id}`).then(res => {
        const s = res.service;
        document.getElementById("svcName").value = s.name || "";
        document.getElementById("svcDesc").value = s.description || "";
        document.getElementById("svcCategory").value = s.category || "";
        document.getElementById("svcDuration").value = s.durationMin || "";
        document.getElementById("svcPrice").value = s.priceCents ? (s.priceCents / 100) : "";
        document.getElementById("svcOrder").value = s.sortOrder || 0;
      });
    }

    document.getElementById("modalOverlay").classList.remove("hidden");
    setTimeout(() => document.getElementById("svcName").focus(), 100);
  }

  async saveService(id) {
    const name = document.getElementById("svcName").value.trim();
    const description = document.getElementById("svcDesc").value.trim();
    const durationMin = parseInt(document.getElementById("svcDuration").value, 10);
    const priceYuan = parseFloat(document.getElementById("svcPrice").value || "0");
    const sortOrder = parseInt(document.getElementById("svcOrder").value, 10) || 0;
    const category = document.getElementById("svcCategory").value.trim() || null;

    if (!name) { showToast("服务名必填", "error"); return; }
    if (!durationMin || durationMin < 5) { showToast("时长必须 ≥ 5 分钟", "error"); return; }

    const body = { name, description: description || null, category, durationMin, priceCents: Math.round(priceYuan * 100), sortOrder };

    try {
      if (id) {
        await this.admin.updateService(id, body);
        showToast("已更新", "success");
      } else {
        await this.admin.createService(body);
        showToast("已创建", "success");
      }
      this.closeModal();
      this.loadServices();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  async deleteService(id, name) {
    if (!confirm(`确认删除服务「${name}」？（软删除，可编辑恢复）`)) return;
    try {
      await this.admin.deleteService(id);
      showToast("已删除", "success");
      this.loadServices();
    } catch (err) { showToast(err.message, "error"); }
  }

  // ============ 营业时间 Tab ============
  async loadSchedule() {
    try {
      const res = await this.admin.getSchedule();
      const body = document.getElementById("scheduleBody");
      const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
      body.innerHTML = res.schedule.map(day => `
        <tr>
          <td><strong>${days[day.weekday]}</strong></td>
          <td>
            <input type="checkbox" id="sch-active-${day.weekday}" ${day.active ? "checked" : ""} style="width: auto;">
          </td>
          <td><input type="time" class="input" id="sch-open-${day.weekday}" value="${day.opensAt || "09:00"}" style="width: auto;"></td>
          <td><input type="time" class="input" id="sch-close-${day.weekday}" value="${day.closesAt || "21:00"}" style="width: auto;"></td>
          <td>
            <select class="select" id="sch-slot-${day.weekday}" style="width: auto;">
              ${[15, 30, 45, 60, 90, 120].map(m => `<option value="${m}" ${m === day.slotMinutes ? "selected" : ""}>${m} 分钟</option>`).join("")}
            </select>
          </td>
          <td><button class="btn btn-primary btn-sm" onclick="app.saveScheduleDay(${day.weekday})">💾 保存</button></td>
        </tr>
      `).join("");
    } catch (err) {
      showToast(err.message, "error");
      if (err.status === 401) this.logout();
    }
  }

  async saveScheduleDay(weekday) {
    const active = document.getElementById(`sch-active-${weekday}`).checked;
    const opensAt = document.getElementById(`sch-open-${weekday}`).value;
    const closesAt = document.getElementById(`sch-close-${weekday}`).value;
    const slotMinutes = parseInt(document.getElementById(`sch-slot-${weekday}`).value, 10);

    try {
      await this.admin.upsertSchedule({ weekday, opensAt, closesAt, slotMinutes, active });
      showToast("已保存", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  // ============ 店铺设置 Tab ============
  async loadProfile() {
    try {
      const res = await this.admin.getProfile();
      const s = res.shop;
      document.getElementById("profileName").value = s.name || "";
      document.getElementById("profileIntro").value = s.intro || "";
      document.getElementById("profilePhone").value = s.phone || "";
      document.getElementById("profileAddress").value = s.address || "";
      document.getElementById("profileTimezone").value = s.timezone || "Asia/Shanghai";

      const logoPreview = document.getElementById("logoPreview");
      const coverPreview = document.getElementById("coverPreview");
      logoPreview.innerHTML = s.logoUrl
        ? `<img src="${s.logoUrl}" style="width:100%;height:100%;object-fit:cover;">`
        : "🏪";
      coverPreview.innerHTML = s.coverUrl
        ? `<img src="${s.coverUrl}" style="width:100%;height:100%;object-fit:cover;">`
        : "🖼️";
    } catch (err) {
      if (err.status === 401) { this.logout(); return; }
      showToast(err.message, "error");
    }
  }

  async saveProfile() {
    const body = {
      name: document.getElementById("profileName").value,
      intro: document.getElementById("profileIntro").value,
      phone: document.getElementById("profilePhone").value,
      address: document.getElementById("profileAddress").value,
      timezone: document.getElementById("profileTimezone").value,
    };
    try {
      await this.admin.updateProfile(body);
      showToast("已保存", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  async changePin() {
    const newPin = document.getElementById("newPin").value.trim();
    if (!/^\d{6,8}$/.test(newPin)) {
      showToast("PIN 必须是 6-8 位数字", "error");
      return;
    }
    if (!confirm(`确认将 PIN 改为 ${newPin}？`)) return;

    try {
      await this.admin.updateProfile({ newPin });
      document.getElementById("newPin").value = "";
      showToast("PIN 已修改", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  async uploadImage(input, kind) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast("文件太大，最大 5MB", "error");
      return;
    }
    showToast("上传中…", "info");
    try {
      const res = await this.admin.uploadImage(file, kind);
      showToast("上传成功", "success");
      this.loadProfile();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  // ============ Modal ============
  closeModal() {
    document.getElementById("modalOverlay").classList.add("hidden");
  }
}

// ============ 常量 ============
const STATUS_LABEL = {
  pending: "待确认",
  confirmed: "已确认",
  called: "已叫号",
  done: "已完成",
  cancelled: "已取消",
  rejected: "已拒绝",
};

function escapeAttr(s) {
  return String(s || "").replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

// ============ 全局 app 实例 ============
// 放在 admin.js 顶部，供 inline onclick 和 admin.html 都访问
const app = new AdminApp({ shopCode: new URLSearchParams(location.search).get('shop') || 'tonys-hair' });
window.app = app;

