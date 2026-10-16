// 全局中间件：CORS、错误兜底、本地开发自动建表
// 注意：Pages Functions 里的 _middleware.js 会在每个请求前执行

import { hashPassword, genSalt } from "./_shared/crypto.js";

let initializing = false;
let dbReady = false;
let accountsReady = false;

async function ensureDatabase(env) {
  if (dbReady || initializing) return;
  try {
    const result = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sb_shops'"
    ).first();
    if (result) {
      dbReady = true;
      return;
    }

    initializing = true;
    console.log("[middleware] 首次访问，初始化数据库 schema + seed 数据…");

    const statements = [
      // --- Schema ---
      `CREATE TABLE IF NOT EXISTS sb_shops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        intro TEXT,
        logo_key TEXT,
        cover_key TEXT,
        phone TEXT,
        address TEXT,
        timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
      )`,
      `CREATE TABLE IF NOT EXISTS sb_services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_code TEXT NOT NULL REFERENCES sb_shops(code) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        duration_min INTEGER NOT NULL CHECK (duration_min > 0),
        price_cents INTEGER,
        category TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
      )`,
      `CREATE INDEX IF NOT EXISTS sb_idx_services_shop ON sb_services(shop_code, sort_order, active)`,
      `CREATE TABLE IF NOT EXISTS sb_shop_schedule (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_code TEXT NOT NULL REFERENCES sb_shops(code) ON DELETE CASCADE,
        weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
        opens_at TEXT NOT NULL,
        closes_at TEXT NOT NULL,
        slot_minutes INTEGER NOT NULL DEFAULT 30 CHECK (slot_minutes IN (15, 30, 45, 60, 90, 120)),
        capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 20),
        active INTEGER NOT NULL DEFAULT 1,
        UNIQUE(shop_code, weekday)
      )`,
      `CREATE TABLE IF NOT EXISTS sb_employees (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_code    TEXT NOT NULL REFERENCES sb_shops(code) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        title        TEXT,
        intro        TEXT,
        avatar_key   TEXT,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        active       INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
      )`,
      `CREATE INDEX IF NOT EXISTS sb_idx_employees_shop
        ON sb_employees(shop_code, sort_order, active)`,
      `CREATE TABLE IF NOT EXISTS sb_bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_code TEXT NOT NULL REFERENCES sb_shops(code) ON DELETE CASCADE,
        service_id INTEGER NOT NULL REFERENCES sb_services(id) ON DELETE CASCADE,
        employee_id INTEGER REFERENCES sb_employees(id) ON DELETE SET NULL,
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        duration_min INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','confirmed','called','done','cancelled','rejected')),
        note TEXT,
        customer_email TEXT,
        cancelled_at TEXT,
        rejected_at TEXT,
        called_at TEXT,
        done_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
      )`,
      `CREATE INDEX IF NOT EXISTS sb_idx_bookings_shop_time_status
        ON sb_bookings(shop_code, scheduled_at, status)`,
      `CREATE INDEX IF NOT EXISTS sb_idx_bookings_phone
        ON sb_bookings(shop_code, customer_phone)`,
      `CREATE INDEX IF NOT EXISTS sb_idx_bookings_service_time
        ON sb_bookings(service_id, scheduled_at, status)`,
      `CREATE TABLE IF NOT EXISTS sb_admin_sessions (
        token TEXT PRIMARY KEY,
        shop_code TEXT NOT NULL REFERENCES sb_shops(code) ON DELETE CASCADE,
        account_id INTEGER REFERENCES sb_admin_accounts(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
        expires_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS sb_idx_admin_sessions_shop
        ON sb_admin_sessions(shop_code, expires_at)`,

      // --- 账号表（账号 + 密码登录，替代原单 PIN）---
      `CREATE TABLE IF NOT EXISTS sb_admin_accounts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_code     TEXT NOT NULL REFERENCES sb_shops(code) ON DELETE CASCADE,
        username      TEXT NOT NULL,
        pass_hash     TEXT NOT NULL,
        pass_salt     TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'owner',
        last_login_at TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS sb_idx_admin_accounts_shop_user
        ON sb_admin_accounts(shop_code, username)`,

      // --- Seed ---
      `INSERT OR IGNORE INTO sb_shops(code, name, intro, phone, address, timezone, status)
        VALUES ('tonys-hair', 'Tony''s 美发', '精致剪裁 / 染发烫发 / 头皮护理', '+86-138-0000-0000',
                '上海市黄浦区南京东路 100 号 3 楼', 'Asia/Shanghai', 'active')`,
      `INSERT OR IGNORE INTO sb_services(shop_code, name, description, duration_min, price_cents, category, sort_order) VALUES
        ('tonys-hair', '男士精剪', '基础剪发 + 造型', 30, 6800, '剪发', 10),
        ('tonys-hair', '女士精剪 + 造型', '剪发 + 吹风造型', 60, 12800, '剪发', 20),
        ('tonys-hair', '染发（含洗护）', '染发 + 洗护一套', 120, 38800, '染烫', 30),
        ('tonys-hair', '烫发（含剪发）', '烫发 + 剪发', 180, 58800, '染烫', 40),
        ('tonys-hair', '头皮护理', '深层清洁 + 按摩', 45, 28800, '护理', 50),
        ('tonys-hair', '洗吹造型', '洗发 + 吹风', 30, 2800, '护理', 60)`,
      `INSERT OR IGNORE INTO sb_shop_schedule(shop_code, weekday, opens_at, closes_at, slot_minutes) VALUES
        ('tonys-hair', 1, '09:00', '21:00', 30),
        ('tonys-hair', 2, '09:00', '21:00', 30),
        ('tonys-hair', 3, '09:00', '21:00', 30),
        ('tonys-hair', 4, '09:00', '21:00', 30),
        ('tonys-hair', 5, '09:00', '21:00', 30),
        ('tonys-hair', 6, '10:00', '20:00', 30),
        ('tonys-hair', 0, '10:00', '20:00', 30)`,
      // --- Seed 员工（幂等：按姓名独立判定，避免首条插入后其余被 WHERE NOT EXISTS 跳过）---
      `INSERT INTO sb_employees(shop_code, name, title, intro, sort_order, active)
        SELECT 'tonys-hair', 'Tony', '总监发型师', '二十年经验，擅长日系烫染与轮廓剪裁', 10, 1
        WHERE NOT EXISTS (SELECT 1 FROM sb_employees WHERE shop_code = 'tonys-hair' AND name = 'Tony')`,
      `INSERT INTO sb_employees(shop_code, name, title, intro, sort_order, active)
        SELECT 'tonys-hair', 'Lisa', '高级发型师', '韩式刘海与染发设计', 20, 1
        WHERE NOT EXISTS (SELECT 1 FROM sb_employees WHERE shop_code = 'tonys-hair' AND name = 'Lisa')`,
      `INSERT INTO sb_employees(shop_code, name, title, intro, sort_order, active)
        SELECT 'tonys-hair', '阿杰', '洗护技师', '头皮护理与洗发造型', 30, 1
        WHERE NOT EXISTS (SELECT 1 FROM sb_employees WHERE shop_code = 'tonys-hair' AND name = '阿杰')`,

      // --- Seed 第二店铺：nails-art（小雅美甲，演示多店铺切换）---
      `INSERT OR IGNORE INTO sb_shops(code, name, intro, phone, address, timezone, status)
        VALUES ('nails-art', '小雅美甲', '日式美甲 / 手足护理 / 美睫，环境温馨，技师耐心', '+86-139-0000-0000',
                '上海市静安区南京西路 200 号 2 楼', 'Asia/Shanghai', 'active')`,
      `INSERT OR IGNORE INTO sb_services(shop_code, name, description, duration_min, price_cents, category, sort_order) VALUES
        ('nails-art', '基础护理', '修甲 + 护手霜', 40, 12800, '护理', 10),
        ('nails-art', '法式美甲', '经典法式 + 造型', 75, 26800, '美甲', 20),
        ('nails-art', '日式美睫', '嫁接睫毛', 60, 19800, '美睫', 30),
        ('nails-art', '手足护理套餐', '手 + 足护理', 90, 38800, '护理', 40)`,
      `INSERT OR IGNORE INTO sb_shop_schedule(shop_code, weekday, opens_at, closes_at, slot_minutes) VALUES
        ('nails-art', 1, '10:00', '20:00', 30),
        ('nails-art', 2, '10:00', '20:00', 30),
        ('nails-art', 3, '10:00', '20:00', 30),
        ('nails-art', 4, '10:00', '20:00', 30),
        ('nails-art', 5, '10:00', '20:00', 30),
        ('nails-art', 6, '10:00', '19:00', 30),
        ('nails-art', 0, '10:00', '19:00', 30)`,
      `INSERT INTO sb_employees(shop_code, name, title, intro, sort_order, active)
        SELECT 'nails-art', '小雅', '首席美甲师', '八年经验，擅长日式晕染与极致单色', 10, 1
        WHERE NOT EXISTS (SELECT 1 FROM sb_employees WHERE shop_code = 'nails-art' AND name = '小雅')`,

      // --- Seed 测试数据（演示预约，幂等；动态日期 = 店铺本地时区 +N 天，保证为未来预约）---
      `INSERT INTO sb_bookings(shop_code, service_id, employee_id, customer_name, customer_phone, scheduled_at, duration_min, status, note)
        SELECT 'tonys-hair',
               (SELECT id FROM sb_services WHERE shop_code='tonys-hair' AND name='男士精剪'),
               (SELECT id FROM sb_employees WHERE shop_code='tonys-hair' AND name='Tony'),
               '演示客户·张三', '13800000001', (date('now','+8 hours','+2 days') || ' 10:00'), 30, 'confirmed', '演示预约'
        WHERE NOT EXISTS (SELECT 1 FROM sb_bookings WHERE shop_code='tonys-hair' AND customer_phone='13800000001' AND scheduled_at = (date('now','+8 hours','+2 days') || ' 10:00'))`,
      `INSERT INTO sb_bookings(shop_code, service_id, employee_id, customer_name, customer_phone, scheduled_at, duration_min, status, note)
        SELECT 'tonys-hair',
               (SELECT id FROM sb_services WHERE shop_code='tonys-hair' AND name='染发（含洗护）'),
               (SELECT id FROM sb_employees WHERE shop_code='tonys-hair' AND name='Lisa'),
               '演示客户·李四', '13800000002', (date('now','+8 hours','+2 days') || ' 14:00'), 120, 'pending', '演示预约'
        WHERE NOT EXISTS (SELECT 1 FROM sb_bookings WHERE shop_code='tonys-hair' AND customer_phone='13800000002' AND scheduled_at = (date('now','+8 hours','+2 days') || ' 14:00'))`,
      `INSERT INTO sb_bookings(shop_code, service_id, employee_id, customer_name, customer_phone, scheduled_at, duration_min, status, note)
        SELECT 'tonys-hair',
               (SELECT id FROM sb_services WHERE shop_code='tonys-hair' AND name='头皮护理'),
               (SELECT id FROM sb_employees WHERE shop_code='tonys-hair' AND name='阿杰'),
               '演示客户·王五', '13800000003', (date('now','+8 hours','+3 days') || ' 11:00'), 45, 'done', '演示预约'
        WHERE NOT EXISTS (SELECT 1 FROM sb_bookings WHERE shop_code='tonys-hair' AND customer_phone='13800000003' AND scheduled_at = (date('now','+8 hours','+3 days') || ' 11:00'))`,
      `INSERT INTO sb_bookings(shop_code, service_id, employee_id, customer_name, customer_phone, scheduled_at, duration_min, status, note)
        SELECT 'tonys-hair',
               (SELECT id FROM sb_services WHERE shop_code='tonys-hair' AND name='女士精剪 + 造型'),
               (SELECT id FROM sb_employees WHERE shop_code='tonys-hair' AND name='Tony'),
               '演示客户·赵六', '13800000004', (date('now','+8 hours','+1 days') || ' 15:00'), 60, 'confirmed', '演示预约'
        WHERE NOT EXISTS (SELECT 1 FROM sb_bookings WHERE shop_code='tonys-hair' AND customer_phone='13800000004' AND scheduled_at = (date('now','+8 hours','+1 days') || ' 15:00'))`,
      `INSERT INTO sb_bookings(shop_code, service_id, employee_id, customer_name, customer_phone, scheduled_at, duration_min, status, note)
        SELECT 'nails-art',
               (SELECT id FROM sb_services WHERE shop_code='nails-art' AND name='法式美甲'),
               (SELECT id FROM sb_employees WHERE shop_code='nails-art' AND name='小雅'),
               '演示客户·钱七', '13800000005', (date('now','+8 hours','+2 days') || ' 13:00'), 75, 'pending', '演示预约'
        WHERE NOT EXISTS (SELECT 1 FROM sb_bookings WHERE shop_code='nails-art' AND customer_phone='13800000005' AND scheduled_at = (date('now','+8 hours','+2 days') || ' 13:00'))`,
      `INSERT INTO sb_bookings(shop_code, service_id, employee_id, customer_name, customer_phone, scheduled_at, duration_min, status, note)
        SELECT 'nails-art',
               (SELECT id FROM sb_services WHERE shop_code='nails-art' AND name='基础护理'),
               (SELECT id FROM sb_employees WHERE shop_code='nails-art' AND name='小雅'),
               '演示客户·孙八', '13800000006', (date('now','+8 hours','+2 days') || ' 16:00'), 40, 'confirmed', '演示预约'
        WHERE NOT EXISTS (SELECT 1 FROM sb_bookings WHERE shop_code='nails-art' AND customer_phone='13800000006' AND scheduled_at = (date('now','+8 hours','+2 days') || ' 16:00'))`,
    ];

    for (const sql of statements) {
      await env.DB.prepare(sql).run();
    }

    console.log("[middleware] 数据库初始化完成");
    dbReady = true;
  } catch (err) {
    console.error("[middleware] 数据库初始化失败:", err);
  } finally {
    initializing = false;
  }
}

// 账号表：幂等建表 + 给没有任何账号的店铺播种默认 admin / admin123
// 每次冷启动执行一次（accountsReady 兜底），对已有库安全。
async function ensureAccounts(env) {
  if (accountsReady) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS sb_admin_accounts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_code     TEXT NOT NULL REFERENCES sb_shops(code) ON DELETE CASCADE,
        username      TEXT NOT NULL,
        pass_hash     TEXT NOT NULL,
        pass_salt     TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'owner',
        last_login_at TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
      )
    `).run();
    await env.DB.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS sb_idx_admin_accounts_shop_user
        ON sb_admin_accounts(shop_code, username)
    `).run();

    // 老库补 account_id 列（会话绑定账户）
    const cols = await env.DB.prepare(`PRAGMA table_info(sb_admin_sessions)`).all();
    if (!cols.results.some(c => c.name === "account_id")) {
      await env.DB.prepare(
        `ALTER TABLE sb_admin_sessions ADD COLUMN account_id INTEGER REFERENCES sb_admin_accounts(id)`
      ).run();
      console.log("[middleware] 已升级 admin_sessions.account_id");
    }

    // 给没有任何账号的店铺播种默认账号
    const shops = await env.DB.prepare(`SELECT code FROM sb_shops WHERE status = 'active'`).all();
    for (const shop of (shops.results || [])) {
      const cnt = await env.DB.prepare(
        `SELECT COUNT(*) AS c FROM sb_admin_accounts WHERE shop_code = ?`
      ).bind(shop.code).first();
      if (cnt && cnt.c === 0) {
        const salt = genSalt(16);
        const hash = await hashPassword("admin123", salt);
        await env.DB.prepare(
          `INSERT INTO sb_admin_accounts(shop_code, username, pass_hash, pass_salt, role, created_at)
           VALUES (?, 'admin', ?, ?, 'owner', datetime('now', '+8 hours'))`
        ).bind(shop.code, hash, salt).run();
        console.log(`[middleware] 为店铺 ${shop.code} 播种默认账号 admin / admin123`);
      }
    }
    accountsReady = true;
  } catch (err) {
    console.error("[middleware] 账号表初始化失败:", err);
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // CORS（前后端同源时其实不需要，但加上以防本地开发时 file:// 打开）
  const origin = request.headers.get("origin") || "*";

  // Preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

// 首次访问自动建表（不区分分支：生产库已有 sb_shops 表时会直接跳过，仅多一次轻量查询）
await ensureDatabase(env);

// 账号表幂等建表 + 默认账号播种（每次冷启动执行，安全幂等）
await ensureAccounts(env);

  // 响应加 CORS 头
  const originalNext = context.next;
  context.next = async (nextContext) => {
    const response = await originalNext(nextContext);
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.headers.set("Access-Control-Max-Age", "86400");

    // 简单访问日志
    if (url.pathname.startsWith("/api/")) {
      const start = performance.now();
      if (env.NODE_ENV === "development") {
        const ms = (performance.now() - start).toFixed(0);
        console.log(`[${request.method} ${url.pathname}] ${response.status} ${ms}ms`);
      }
    }
    return response;
  };

  return context.next();
}
