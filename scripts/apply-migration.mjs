// 应用 migration 到线上 D1：node scripts/apply-migration.mjs 0003_schedule_capacity.sql
// 幂等：ALTER 失败且错误含 duplicate column 视为已存在
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ACCT = "332b848d9f5d9ec2808bdb855763eb8e";
const DB_NAME = "shop-booking-db";
const file = process.argv[2];
if (!file) { console.error("用法: node scripts/apply-migration.mjs <migration-file>"); process.exit(1); }

const token = (process.env.TOKEN_FILE ? readFileSync(process.env.TOKEN_FILE, "utf8").trim() : "")
  || process.env.CLOUDFLARE_API_TOKEN || "";
if (!token) { console.error("缺少 token"); process.exit(1); }

const api = async (path, opts = {}, retries = 6) => {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}${path}`, {
        ...opts, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const j = await r.json();
      if (j.success) return j.result;
      lastErr = new Error(JSON.stringify(j.errors));
      if (j.errors?.[0]?.code !== 10000) throw lastErr;
    } catch (e) {
      lastErr = e;
      if (!(e instanceof TypeError) && !String(e.message).includes("10000")) throw e;
    }
    await new Promise(r => setTimeout(r, 800 * (i + 1)));
    process.stderr.write(`  retry ${i + 1}\n`);
  }
  throw lastErr;
};

const dbs = await api("/d1/database");
const db = dbs.find(d => d.name === DB_NAME);
if (!db) { console.error(`未找到 ${DB_NAME}`); process.exit(1); }
console.log(`db: ${db.uuid}`);

const sql = readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), "migrations", file), "utf8");
const stmts = sql.split("\n").filter(l => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map(s => s.trim()).filter(Boolean);

for (const s of stmts) {
  try {
    await api(`/d1/database/${db.uuid}/query`, { method: "POST", body: JSON.stringify({ sql: s }) });
    console.log("OK:", s.slice(0, 70).replace(/\n/g, " "));
  } catch (e) {
    if (/duplicate column|already exists/i.test(e.message)) {
      console.log("SKIP (已存在):", s.slice(0, 60).replace(/\n/g, " "));
    } else { console.error("FAIL:", e.message); process.exit(1); }
  }
}

const v = await api(`/d1/database/${db.uuid}/query`, { method: "POST", body: JSON.stringify({
  sql: "SELECT name FROM pragma_table_info('shop_schedule') WHERE name='capacity'" }) });
console.log(v.length && v[0].results.length ? "线上 capacity 列确认存在" : "警告: capacity 列缺失");
