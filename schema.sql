-- shop-booking D1 初始化 schema（全量快照 = migrations 0000~0002 依序应用后的最终态）
--
-- 【整合说明】数据库初始化只有一个入口，二选一：
--   A. 全新库（推荐）：wrangler d1 execute shop-booking-db --remote --file=schema.sql
--   B. 版本化：wrangler d1 migrations apply shop-booking-db --remote（按 migrations/ 序号增量应用）
--   两者结果一致。已有旧库请走 B；本地开发无需执行（_middleware 首访自动建表）。
--
-- 注意：不含 PRAGMA——D1 自管 WAL/外键，远端执行 journal_mode 等会报错。

-- ============ 店铺 ============
CREATE TABLE IF NOT EXISTS shops (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,               -- URL 中用，例如 'tonys-hair'
  name        TEXT NOT NULL,
  intro       TEXT,
  logo_key    TEXT,                              -- R2 object key
  cover_key   TEXT,
  phone       TEXT,
  address     TEXT,
  timezone    TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  status      TEXT NOT NULL DEFAULT 'active',    -- active / paused
  created_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

-- ============ 服务项目 ============
CREATE TABLE IF NOT EXISTS services (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_code    TEXT NOT NULL REFERENCES shops(code) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  price_cents  INTEGER,                          -- 0 或 NULL = 免费
  category     TEXT,                             -- 自由文本分类（如 剪发/染烫/护理），NULL 视为「其他」
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE INDEX IF NOT EXISTS idx_services_shop ON services(shop_code, sort_order, active);

-- ============ 营业时间表 ============
-- weekday: 0 = 周日, 1 = 周一, ..., 6 = 周六
-- slot_minutes: 单个时间片的粒度（分钟）
CREATE TABLE IF NOT EXISTS shop_schedule (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_code    TEXT NOT NULL REFERENCES shops(code) ON DELETE CASCADE,
  weekday      INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_at     TEXT NOT NULL,                    -- '09:00'
  closes_at    TEXT NOT NULL,                    -- '21:00'
  slot_minutes INTEGER NOT NULL DEFAULT 30 CHECK (slot_minutes IN (15, 30, 45, 60, 90, 120)),
  capacity     INTEGER NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 20),  -- 同一时段最大并行预约数
  active       INTEGER NOT NULL DEFAULT 1,
  UNIQUE(shop_code, weekday)
);

-- ============ 预约 ============
-- status: pending / confirmed / called / done / cancelled / rejected
-- scheduled_at: 字符串 'YYYY-MM-DD HH:MM'，shop 本地时间（naive）
CREATE TABLE IF NOT EXISTS bookings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_code      TEXT NOT NULL REFERENCES shops(code) ON DELETE CASCADE,
  service_id     INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  customer_name  TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  scheduled_at   TEXT NOT NULL,                  -- 'YYYY-MM-DD HH:MM'
  duration_min   INTEGER NOT NULL,               -- 冗余存，防止服务后续改动
  status         TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','called','done','cancelled','rejected')),
  note           TEXT,
  customer_email TEXT,                          -- 可选，预约确认邮件发送地址
  cancelled_at   TEXT,
  rejected_at    TEXT,
  called_at      TEXT,
  done_at        TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

-- 覆盖所有高频查询：按店铺+时间+状态、按客户查、按服务查
CREATE INDEX IF NOT EXISTS idx_bookings_shop_time_status
  ON bookings(shop_code, scheduled_at, status);
CREATE INDEX IF NOT EXISTS idx_bookings_phone
  ON bookings(shop_code, customer_phone);
CREATE INDEX IF NOT EXISTS idx_bookings_service_time
  ON bookings(service_id, scheduled_at, status);

-- ============ 管理员 session ============
-- 24 小时过期；token 是 32 字节随机 hex；account_id 绑定登录账户
CREATE TABLE IF NOT EXISTS admin_sessions (
  token       TEXT PRIMARY KEY,
  shop_code   TEXT NOT NULL REFERENCES shops(code) ON DELETE CASCADE,
  account_id  INTEGER REFERENCES admin_accounts(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  expires_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_shop
  ON admin_sessions(shop_code, expires_at);

-- ============ 管理员账号 ============
-- 账号密码登录（替代原单 PIN）：每个店铺可有多账号，含 owner / staff 角色
-- pass_hash = HMAC-SHA256(password, pass_salt)；salt 每账户随机生成
CREATE TABLE IF NOT EXISTS admin_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_code     TEXT NOT NULL REFERENCES shops(code) ON DELETE CASCADE,
  username      TEXT NOT NULL,
  pass_hash     TEXT NOT NULL,
  pass_salt     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'owner',     -- owner / staff
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_accounts_shop_user
  ON admin_accounts(shop_code, username);

-- ============ 种子数据 ============
-- 默认店铺：Tony's 美发
-- 账号在运行时由 _middleware.ensureAccounts 播种：admin / admin123（首次登录请修改密码）
INSERT INTO shops(code, name, intro, phone, address, timezone, status)
VALUES (
  'tonys-hair',
  'Tony''s 美发',
  '精致剪裁 / 染发烫发 / 头皮护理，二十年理发经验，等你来体验。',
  '+86-138-0000-0000',
  '上海市黄浦区南京东路 100 号 3 楼',
  'Asia/Shanghai',
  'active'
);

-- 服务
INSERT INTO services(shop_code, name, description, duration_min, price_cents, category, sort_order) VALUES
  ('tonys-hair', '男士精剪',       '基础剪发 + 造型', 30,  6800, '剪发', 10),
  ('tonys-hair', '女士精剪 + 造型', '剪发 + 吹风造型', 60, 12800, '剪发', 20),
  ('tonys-hair', '染发（含洗护）',   '染发 + 洗护一套', 120, 38800, '染烫', 30),
  ('tonys-hair', '烫发（含剪发）',   '烫发 + 剪发',     180, 58800, '染烫', 40),
  ('tonys-hair', '头皮护理',         '深层清洁 + 按摩', 45, 28800, '护理', 50),
  ('tonys-hair', '洗吹造型',         '洗发 + 吹风',     30,  2800, '护理', 60);

-- 营业时间表（周一到周日，09:00-21:00，30 分钟一档）
INSERT INTO shop_schedule(shop_code, weekday, opens_at, closes_at, slot_minutes) VALUES
  ('tonys-hair', 1, '09:00', '21:00', 30),
  ('tonys-hair', 2, '09:00', '21:00', 30),
  ('tonys-hair', 3, '09:00', '21:00', 30),
  ('tonys-hair', 4, '09:00', '21:00', 30),
  ('tonys-hair', 5, '09:00', '21:00', 30),
  ('tonys-hair', 6, '10:00', '20:00', 30),
  ('tonys-hair', 0, '10:00', '20:00', 30);

-- 说明：
-- 1) D1 使用 SQLite。
-- 2) 账号密码登录：admin_accounts 表存储账号；默认账号 admin/admin123 由运行时播种，
--    首次登录后请尽快在「店铺设置 → 修改密码」中修改。
-- 3) 店主可在后台「账号管理」中新增员工(staff)账号、删除账号。
