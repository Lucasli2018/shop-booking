// GET /api/public-image/:shopCode/:key
// 公开读取 R2 图片（顾客端读店铺封面 / 员工头像用，无需 admin token）
//
// 防越权：key 必须扁平且以 `shopCode-` 开头，禁止目录穿越。
// key 例：tonys-hair-logo-123-abc.jpg

export async function onRequestGet({ env, params }) {
  const { shopCode, key } = params;
  if (!shopCode || !key) {
    return new Response(JSON.stringify({ error: "缺少参数" }), {
      status: 400, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const decodedKey = decodeURIComponent(key);
  if (decodedKey.includes("..") || decodedKey.startsWith("/")) {
    return new Response(JSON.stringify({ error: "非法路径" }), {
      status: 400, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  if (!decodedKey.startsWith(`${shopCode}-`)) {
    return new Response(JSON.stringify({ error: "非法路径" }), {
      status: 403, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const obj = await env.R2.get(decodedKey);
  if (!obj) {
    return new Response(JSON.stringify({ error: "图片不存在" }), {
      status: 404, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const contentType = obj.httpMetadata?.contentType || "image/jpeg";
  return new Response(obj.body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-length": String(obj.size),
      "cache-control": "public, max-age=86400",
      "access-control-allow-origin": "*",
    },
  });
}
