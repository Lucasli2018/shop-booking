// POST /api/admin/:shopCode/upload
// 上传门店图到 R2，返回 object key 和可访问 URL
//
// Body: multipart/form-data
//   - file: image file
//   - kind: 'logo' | 'cover'  (可选，决定写入 shops 表哪个字段)
//
// 限制：
//   - 单文件 ≤ 5 MB
//   - 只允许 image/jpeg, image/png, image/webp
//   - 若 kind 提供，同时更新 shops.logo_key / cover_key

import { requireAdmin } from "../_guard.js";
import { json } from "../../../_shared/helpers.js";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function onRequestPost({ request, env, params }) {
  const { shopCode } = params;
  const g = await requireAdmin(request, env, shopCode);
  if (!g.ok) return g.response;
  const shop = g.shop;

  const ctype = request.headers.get("content-type") || "";
  if (!ctype.startsWith("multipart/form-data")) {
    return json({ error: "Content-Type 必须是 multipart/form-data" }, 400);
  }

  const form = await request.form();
  const file = form.get("file");
  const kind = form.get("kind");

  if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function") {
    return json({ error: "缺少 file 字段" }, 400);
  }
  if (file.size > MAX_SIZE) {
    return json({ error: `文件太大，最大 ${MAX_SIZE / 1024 / 1024} MB` }, 400);
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return json({ error: `不支持的格式：${file.type}，只支持 jpg/png/webp` }, 400);
  }

  // 生成扁平 R2 key：/<shopCode>-<kind>-<ts>-<rand>.<ext>
  // 用扁平 key 避免 Cloudflare Pages Functions 的路由匹配问题（[key] 只匹配单段）
  const ext = file.type === "image/jpeg" ? "jpg"
            : file.type === "image/png" ? "png"
            : "webp";
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `${shop.code}-${kind || "misc"}-${ts}-${rand}.${ext}`;

  const body = await file.arrayBuffer();
  const meta = { contentType: file.type };

  try {
    await env.R2.put(key, body, meta);
  } catch (err) {
    console.error("R2 upload failed:", err);
    return json({ error: "上传失败", detail: err.message }, 500);
  }

  // 如果指定了 kind，更新 shops 表的对应字段
  if (kind === "logo" || kind === "cover") {
    const field = kind === "logo" ? "logo_key" : "cover_key";
    await env.DB.prepare(
      `UPDATE shops SET ${field} = ?, updated_at = ? WHERE code = ?`
    ).bind(key, new Date().toISOString().slice(0, 19).replace("T", " "), shopCode).run();
  }

  return json({
    key,
    url: `/api/admin/image/${shop.code}/${key}`,
    size: file.size,
    type: file.type,
    updatedField: kind,
  }, 201);
}
