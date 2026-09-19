// 邮件发送（Resend API，可插拔）
//
// 环境变量（Pages 项目 Settings → Variables）：
//   RESEND_API_KEY - Resend 的 API Key（re_ 开头）。未配置时本模块静默跳过，不影响预约流程。
//   MAIL_FROM      - 发件人，如 'shop-booking <noreply@yourdomain.com>'。
//                    未配置时用 Resend 默认测试发件人 'onboarding@resend.dev'（仅能发给注册邮箱）。
//
// 为什么用 waitUntil：邮件发送失败不应阻塞/影响预约创建，也不该让顾客看到报错。

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailValid(email) {
  return typeof email === "string" && EMAIL_RE.test(email);
}

export async function sendEmail(env, { to, subject, html }) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, reason: "RESEND_API_KEY 未配置，跳过发送" };
  }
  if (!isEmailValid(to)) {
    return { sent: false, reason: "收件邮箱无效" };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.MAIL_FROM || "onboarding@resend.dev",
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[email] Resend 返回错误:", res.status, text.slice(0, 200));
      return { sent: false, reason: `Resend ${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error("[email] 发送异常:", err);
    return { sent: false, reason: String(err && err.message || err) };
  }
}

export async function sendBookingConfirmation(env, booking) {
  const { customerEmail, customerName, serviceName, scheduledAt, shopName, bookingId } = booking;
  if (!isEmailValid(customerEmail)) return { sent: false, reason: "未留邮箱" };

  const html = `
    <div style="font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #FFF9F0; border-radius: 12px;">
      <h2 style="color: #E85D5D; margin: 0 0 12px;">📅 预约确认</h2>
      <p style="color: #3D2C2E;">${escapeHtml(customerName)}，您好！您的预约已提交成功：</p>
      <table style="width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden;">
        <tr><td style="padding: 10px 14px; color: #6A5659; width: 90px;">店铺</td><td style="padding: 10px 14px; font-weight: 600;">${escapeHtml(shopName)}</td></tr>
        <tr><td style="padding: 10px 14px; color: #6A5659;">服务</td><td style="padding: 10px 14px; font-weight: 600;">${escapeHtml(serviceName)}</td></tr>
        <tr><td style="padding: 10px 14px; color: #6A5659;">时间</td><td style="padding: 10px 14px; font-weight: 600;">${escapeHtml(scheduledAt)}</td></tr>
        <tr><td style="padding: 10px 14px; color: #6A5659;">编号</td><td style="padding: 10px 14px;">#${bookingId}</td></tr>
      </table>
      <p style="color: #A89899; font-size: 13px; margin-top: 16px;">请提前 10 分钟到店。如需取消或改期，请回到预约页面操作。</p>
    </div>`;

  return sendEmail(env, {
    to: customerEmail,
    subject: `【${shopName}】预约确认 · ${scheduledAt}`,
    html,
  });
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
