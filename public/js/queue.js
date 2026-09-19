// 排队叫号页：5 秒轮询

class QueueApp {
  constructor(opts = {}) {
    this.shopCode = opts.shopCode || "tonys-hair";
    this.client = new ApiClient({ shopCode: this.shopCode });
    this.pollTimer = null;
    this.lastUpdated = null;
  }

  init() {
    this.fetch();
    // 每 5 秒轮询一次
    this.pollTimer = setInterval(() => this.fetch(), 5000);
    // 页面隐藏时暂停轮询，可见时立即刷新
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      } else if (!this.pollTimer) {
        this.fetch();
        this.pollTimer = setInterval(() => this.fetch(), 5000);
      }
    });
  }

  async fetch() {
    const status = document.getElementById("pollStatus");
    try {
      status.textContent = "· 更新中";
      const res = await this.client.get(`/api/queue/${this.shopCode}`);

      this.lastUpdated = new Date();
      status.textContent = `· ${this.lastUpdated.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;

      document.getElementById("shopName").textContent = res.shop.name;

      this.render(res);
    } catch (err) {
      status.textContent = "· 更新失败";
      if (!this.lastUpdated) {
        document.getElementById("heroStatus").textContent = err.message || "加载失败";
      }
    }
  }

  render(res) {
    const heroTitle = document.getElementById("heroTitle");
    const heroNumber = document.getElementById("heroNumber");
    const heroStatus = document.getElementById("heroStatus");
    const list = document.getElementById("queueList");

    // 判断用户是不是当前正在服务的那位（用 localStorage 存预约信息）
    const myBooking = JSON.parse(localStorage.getItem(`last-booking-${this.shopCode}`) || "null");

    // 当前正在叫号
    if (res.nowServing) {
      const isMe = myBooking && myBooking.id === res.nowServing.id;
      heroTitle.textContent = isMe ? "🎉 轮到您了！" : "👉 正在服务";
      heroNumber.textContent = isMe ? "您" : res.nowServing.customerName;
      heroStatus.textContent = isMe
        ? "请到前台或按老板指示，享受您的服务吧~"
        : `下一位请前往前台等候`;
    } else {
      heroTitle.textContent = "🕒 排队中";
      heroNumber.textContent = "-";
      heroStatus.textContent = "暂无服务中的顾客";
    }

    // 列表
    const items = [];
    if (res.nowServing) {
      const isMe = myBooking && myBooking.id === res.nowServing.id;
      items.push({
        serving: true,
        name: isMe ? "您" : res.nowServing.customerName,
        service: res.nowServing.serviceName,
        time: res.nowServing.scheduledAt,
        pos: null,
        isMe,
      });
    }
    for (const w of res.waiting) {
      const isMe = myBooking && myBooking.id === w.id;
      items.push({
        serving: false,
        name: isMe ? "您" : w.customerName,
        service: w.serviceName,
        time: w.scheduledAt,
        pos: w.position,
        isMe,
      });
    }

    if (items.length === 0) {
      list.innerHTML = `
        <div class="empty">
          <div class="icon">🌳</div>
          <div class="title">此刻没有等待的顾客</div>
          <div class="text-sm">您可以先休息一会儿，或去其他事项</div>
        </div>
      `;
      return;
    }

    list.innerHTML = items.map(item => `
      <div class="queue-item ${item.serving ? "serving" : ""} ${item.isMe ? "me" : ""}" style="${item.isMe ? "background: linear-gradient(135deg, #FCE4E4, #FFFFFF); border-color: var(--primary); font-weight: 600;" : ""}">
        ${item.serving ? '<div class="queue-pos" style="background: var(--primary); color: white;">★</div>' : `<div class="queue-pos">${item.pos}</div>`}
        <div style="flex: 1;">
          <div><strong>${escapeHtml(item.name)}</strong> ${item.isMe ? '<span class="badge badge-called">您</span>' : ""}</div>
          <div class="text-sm text-muted">${escapeHtml(item.service)} · ${escapeHtml(item.time)}</div>
        </div>
        ${item.serving ? '<span style="color: var(--primary); font-weight: 700;">服务中</span>' : '<span class="text-muted text-sm">等待中</span>'}
      </div>
    `).join("");
  }

  destroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// 页面隐藏时暂停
window.addEventListener("beforeunload", () => {
  // 页面关闭前的清理
});
