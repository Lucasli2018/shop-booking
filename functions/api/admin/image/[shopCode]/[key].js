// GET /api/admin/image/:shopCode/:key
// 读取 R2 里的图片，作为图片响应返回
//
// key 是嵌套路径，例如 'tonys-hair/logo/123-abc.jpg'
// 用 [key] 会截断到最后一个 /，所以用 [key...].js 通配或路径拼接

import { fail } from "../../../../_shared/helpers.js";

export async function onRequestGet({ env, params }) {
  const { shopCode, key } = params;

  if (!shopCode || !key) return fail("缺少参数", 400);

  // key 可能被编码了（URL 编码），解码一下
  const decodedKey = decodeURIComponent(key);

  // 防目录穿越
  if (decodedKey.includes("..") || decodedKey.startsWith("/")) {
    return fail("非法路径", 400);
  }

  // 关键约束：key 必须以 shopCode + '-' 开头（防越权访问其他店铺）
  // key 是扁平的：tonys-hair-logo-123-abc.jpg
  if (!decodedKey.startsWith(`${shopCode}-`)) {
    return fail("非法路径", 403);
  }

  const obj = await env.R2.get(decodedKey);
  if (!obj) return fail("图片不存在", 404);

  const contentType = obj.httpMetadata?.contentType || "image/jpeg";
  const cacheControl = "public, max-age=86400";

  return new Response(obj.body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-length": String(obj.size),
      "cache-control": cacheControl,
      "access-control-allow-origin": "*",
    },
  });
}
