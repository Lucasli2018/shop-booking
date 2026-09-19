// D1 远程初始化脚本（整合版）：读 schema.sql，逐条执行到线上 shop-booking-db
// 用法：先设 CLOUDFLARE_API_TOKEN 环境变量（需 D1 Edit 权限），然后
//   node scripts/init-d1.mjs [--drop]
// --drop：先清掉全部业务表再执行（用于重置，慎用）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ACCT = "332b848d9f5d9ec2808bdb855763eb8e";
const DB_NAME = "shop-booking-db";
const DROP = process.argv.includes("--drop");

// TOKEN_FILE 优先：宿主环境可能预置了权限不足的 CLOUDFLARE_API_TOKEN（如仅 Pages:Edit）
const token = (process.env.TOKEN_FILE ? readFileSync(process.env.TOKEN_FILE, "utf8").trim() : "")
  || process.env.CLOUDFLARE_API_TOKEN || "";
if (!token) { console.error("缺少 CLOUDFLARE_API_TOKEN 或 TOKEN_FILE"); process.exit(1); }
console.error(`token: len=${token.length} prefix=${token.slice(0, 8)} code=${token.charCodeAt(0)} ${token === token.trim() ? "trimmed" : "UNTRIMMED"}`);

// 本机到 CF 的链路会间歇性抖动（连接超时/偶发 10000 auth error），全部纳入重试
const api = async (path, opts = {}, retries = 8) => {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}${path}`, {
        ...opts,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) },
      });
      const j = await r.json();
      if (j.success) return j.result;
      lastErr = new Error(JSON.stringify(j.errors));
      if (j.errors?.[0]?.code !== 10000) throw lastErr; // 非 auth 类错误（如 SQL 语法）直接抛
    } catch (e) {
      lastErr = e;
      if (e instanceof TypeError === false && String(e.message).includes("10000") === false) throw e;
    }
    await new Promise(r => setTimeout(r, 800 * (i + 1)));
    process.stderr.write(`  retry ${i + 1}/${retries}\n`);
  }
  throw lastErr;
};

// 1. 按名字找数据库（避免 database_id 漂移）
const dbs = await api("/d1/database");
const db = dbs.find(d => d.name === DB_NAME);
if (!db) { console.error(`未找到 ${DB_NAME}，请先在 Dashboard 创建`); process.exit(1); }
console.log(`db: ${DB_NAME} (${db.uuid})`);

const query = sql =>
  api(`/d1/database/${db.uuid}/query`, { method: "POST", body: JSON.stringify({ sql }) });

// 2. 可选：清空业务表
if (DROP) {
  for (const t of ["bookings", "admin_sessions", "services", "shop_schedule", "shops"]) {
    await query(`DROP TABLE IF EXISTS ${t}`);
    console.log(`dropped ${t}`);
  }
}

// 3. 读 schema.sql → 去注释行 → 按分号拆语句
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const raw = readFileSync(join(root, "schema.sql"), "utf8");
const cleaned = raw.split("\n").filter(l => !l.trimStart().startsWith("--")).join("\n");
const stmts = cleaned.split(";").map(s => s.trim()).filter(Boolean);
console.log(`statements: ${stmts.length}`);

// 4. 逐条执行
let ok = 0, fail = 0;
for (const s of stmts) {
  try {
    await query(s);
    ok++;
  } catch (e) {
    fail++;
    console.error(`FAIL: ${e.message}\n  SQL: ${s.slice(0, 100).replace(/\n/g, " ")}`);
  }
}
console.log(`done: ok=${ok} fail=${fail}`);
if (fail) process.exit(1);

// 5. 验证（中文 + 行数 + 新列）
const v = await query(`
  SELECT (SELECT COUNT(*) FROM shops) AS shops,
         (SELECT COUNT(*) FROM services) AS services,
         (SELECT COUNT(*) FROM shop_schedule) AS schedule,
         (SELECT COUNT(*) FROM pragma_table_info('services') WHERE name='category') AS has_category,
         (SELECT COUNT(*) FROM pragma_table_info('bookings') WHERE name='customer_email') AS has_email
`);
console.log("counts:", JSON.stringify(v[0].results[0]));
const sample = await query("SELECT name, category FROM services ORDER BY sort_order LIMIT 3");
console.log("sample:", JSON.stringify(sample[0].results));
const names = sample[0].results.map(r => r.name).join(",");
if (/[\u4e00-\u9fff]/.test(names)) {
  console.log("中文校验: OK");
} else {
  console.error("中文校验: 乱码！");
  process.exit(1);
}
