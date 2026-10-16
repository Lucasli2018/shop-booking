-- shop-booking D1 初始化 schema（全量快照 = migrations 0000~0002 依序应用后的最终态）
--
-- 【整合说明】数据库初始化只有一个入口，二选一：
--   A. 全新库（推荐）：wrangler d1 execute shop-booking-db --remote --file=schema.sql
--   B. 版本化：wrangler d1 migrations apply shop-booking-db --remote（按 migrations/ 序号增量应用）
--   两者结果一致。已有旧库请走 B；本地开发无需执行（_middleware 首访自动建表）。
--
-- 注意：不含 PRAGMA——D1 自管 WAL/外键，远端执行 journal_mode 等会报错。

-- ============ 店铺 ============
CREATE TABLE IF NOT EXISTS sb_shops (
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
CREATE TABLE IF NOT EXISTS sb_services (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_code    TEXT NOT NULL REFERENCES sb_shops(code) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS sb_idx_services_shop ON sb_services(shop_code, sort_order, active);

-- ============ 营业时间表 ============
-- weekday: 0 = 周日, 1 = 周一, ..., 6 = 周六
-- slot_minutes: 单个时间片的粒度（分钟）
CREATE TABLE IF NOT EXISTS sb_shop_schedule (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_code    TEXT NOT NULL REFERENCES sb_shops(code) ON DELETE CASCADE,
  weekday      INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_at     TEXT NOT NULL,                    -- '09:00'
  closes_at    TEXT NOT NULL,                    -- '21:00'
  slot_minutes INTEGER NOT NULL DEFAULT 30 CHECK (slot_minutes IN (15, 30, 45, 60, 90, 120)),
  capacity     INTEGER NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 20),  -- 同一时段最大并行预约数
  active       INTEGER NOT NULL DEFAULT 1,
  UNIQUE(shop_code, weekday)
);

-- ============ 员工 / 技师 ============
-- 预约时可「指定师傅」：employee 是预约上的指派标签（可空），
-- 不影响店铺级时段容量（多工位/多师傅并行仍由 shop_schedule.capacity 控制）。
-- 软删除用 active=0（保留历史预约的归属，硬删除会丢失归属）。
CREATE TABLE IF NOT EXISTS sb_employees (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_code    TEXT NOT NULL REFERENCES sb_shops(code) ON DELETE CASCADE,
  name         TEXT NOT NULL,                     -- 师傅姓名
  title        TEXT,                              -- 头衔/职位，如 高级发型师
  intro        TEXT,                              -- 简介
  avatar_key   TEXT,                              -- R2 头像 object key
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,        -- 1=在岗可约，0=停用（软删）
  created_at   TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE INDEX IF NOT EXISTS sb_idx_employees_shop ON sb_employees(shop_code, sort_order, active);

-- ============ 预约 ============
-- status: pending / confirmed / called / done / cancelled / rejected
-- scheduled_at: 字符串 'YYYY-MM-DD HH:MM'，shop 本地时间（naive）
CREATE TABLE IF NOT EXISTS sb_bookings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_code      TEXT NOT NULL REFERENCES sb_shops(code) ON DELETE CASCADE,
  service_id     INTEGER NOT NULL REFERENCES sb_services(id) ON DELETE CASCADE,
  employee_id    INTEGER REFERENCES sb_employees(id) ON DELETE SET NULL,  -- 指定师傅（可空）
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
CREATE INDEX IF NOT EXISTS sb_idx_bookings_shop_time_status
  ON sb_bookings(shop_code, scheduled_at, status);
CREATE INDEX IF NOT EXISTS sb_idx_bookings_phone
  ON sb_bookings(shop_code, customer_phone);
CREATE INDEX IF NOT EXISTS sb_idx_bookings_service_time
  ON sb_bookings(service_id, scheduled_at, status);

-- ============ 管理员 session ============
-- 24 小时过期；token 是 32 字节随机 hex；account_id 绑定登录账户
CREATE TABLE IF NOT EXISTS sb_admin_sessions (
  token       TEXT PRIMARY KEY,
  shop_code   TEXT NOT NULL REFERENCES sb_shops(code) ON DELETE CASCADE,
  account_id  INTEGER REFERENCES sb_admin_accounts(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  expires_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sb_idx_admin_sessions_shop
  ON sb_admin_sessions(shop_code, expires_at);

-- ============ 管理员账号 ============
-- 账号密码登录（替代原单 PIN）：每个店铺可有多账号，含 owner / staff 角色
-- pass_hash = HMAC-SHA256(password, pass_salt)；salt 每账户随机生成
CREATE TABLE IF NOT EXISTS sb_admin_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_code     TEXT NOT NULL REFERENCES sb_shops(code) ON DELETE CASCADE,
  username      TEXT NOT NULL,
  pass_hash     TEXT NOT NULL,
  pass_salt     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'owner',     -- owner / staff
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE UNIQUE INDEX IF NOT EXISTS sb_idx_admin_accounts_shop_user
  ON sb_admin_accounts(shop_code, username);

-- ============ 种子数据 ============
-- 默认店铺：Tony's 美发
-- 账号在运行时由 _middleware.ensureAccounts 播种：admin / admin123（首次登录请修改密码）
INSERT INTO sb_shops(code, name, intro, phone, address, timezone, status)
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
INSERT INTO sb_services(shop_code, name, description, duration_min, price_cents, category, sort_order) VALUES
  ('tonys-hair', '男士精剪',       '基础剪发 + 造型', 30,  6800, '剪发', 10),
  ('tonys-hair', '女士精剪 + 造型', '剪发 + 吹风造型', 60, 12800, '剪发', 20),
  ('tonys-hair', '染发（含洗护）',   '染发 + 洗护一套', 120, 38800, '染烫', 30),
  ('tonys-hair', '烫发（含剪发）',   '烫发 + 剪发',     180, 58800, '染烫', 40),
  ('tonys-hair', '头皮护理',         '深层清洁 + 按摩', 45, 28800, '护理', 50),
  ('tonys-hair', '洗吹造型',         '洗发 + 吹风',     30,  2800, '护理', 60);

-- 营业时间表（周一到周日，09:00-21:00，30 分钟一档）
INSERT INTO sb_shop_schedule(shop_code, weekday, opens_at, closes_at, slot_minutes) VALUES
  ('tonys-hair', 1, '09:00', '21:00', 30),
  ('tonys-hair', 2, '09:00', '21:00', 30),
  ('tonys-hair', 3, '09:00', '21:00', 30),
  ('tonys-hair', 4, '09:00', '21:00', 30),
  ('tonys-hair', 5, '09:00', '21:00', 30),
  ('tonys-hair', 6, '10:00', '20:00', 30),
  ('tonys-hair', 0, '10:00', '20:00', 30);

-- 员工（默认在岗可约；顾客预约时可指定师傅）
INSERT INTO sb_employees(shop_code, name, title, intro, sort_order, active) VALUES
  ('tonys-hair', 'Tony',    '总监发型师', '二十年经验，擅长日系烫染与轮廓剪裁', 10, 1),
  ('tonys-hair', 'Lisa',    '高级发型师', '韩式刘海与染发设计',               20, 1),
  ('tonys-hair', '阿杰',     '洗护技师',   '头皮护理与洗发造型',               30, 1);

-- 第二店铺：小雅美甲（演示多店铺切换）
INSERT INTO sb_shops(code, name, intro, phone, address, timezone, status)
VALUES (
  'nails-art',
  '小雅美甲',
  '日式美甲 / 手足护理 / 美睫，环境温馨，技师耐心。',
  '+86-139-0000-0000',
  '上海市静安区南京西路 200 号 2 楼',
  'Asia/Shanghai',
  'active'
);

INSERT INTO sb_services(shop_code, name, description, duration_min, price_cents, category, sort_order) VALUES
  ('nails-art', '基础护理',     '修甲 + 护手霜',     40, 12800, '护理', 10),
  ('nails-art', '法式美甲',     '经典法式 + 造型',   75, 26800, '美甲', 20),
  ('nails-art', '日式美睫',     '嫁接睫毛',         60, 19800, '美睫', 30),
  ('nails-art', '手足护理套餐', '手 + 足护理',      90, 38800, '护理', 40);

INSERT INTO sb_shop_schedule(shop_code, weekday, opens_at, closes_at, slot_minutes) VALUES
  ('nails-art', 1, '10:00', '20:00', 30),
  ('nails-art', 2, '10:00', '20:00', 30),
  ('nails-art', 3, '10:00', '20:00', 30),
  ('nails-art', 4, '10:00', '20:00', 30),
  ('nails-art', 5, '10:00', '20:00', 30),
  ('nails-art', 6, '10:00', '19:00', 30),
  ('nails-art', 0, '10:00', '19:00', 30);

INSERT INTO sb_employees(shop_code, name, title, intro, sort_order, active) VALUES
  ('nails-art', '小雅', '首席美甲师', '八年经验，擅长日式晕染与极致单色', 10, 1);

-- ============ 测试数据（演示预约）============
-- 动态日期 = 店铺本地时区 +N 天，保证始终是「未来预约」便于演示；
-- 用 WHERE NOT EXISTS 保证幂等（重复执行 schema.sql 不会重复插入）。
INSERT INTO sb_bookings(shop_code, service_id, employee_id, customer_name, customer_phone, scheduled_at, duration_min, status, note)
SELECT 'tonys-hair',
       (SELECT id FROM sb_services WHERE shop_code='tonys-hair' AND name='男士精剪'),
       (SELECT id FROM sb_employees WHERE shop_code='tonys-hair' AND name='Tony'),
       '演示客户·张三', '13800000001', (date('now','+8 hours','+2 days') || ' 10:00'), 30, 'confirmed', '演示预约'
WHERE NOT EXISTS (SELECT 1 FROM sb_bookings WHERE shop_code='tonys-hair' AND customer_phone='13800000001' AND scheduled_at = (date('now','+8 hours','+2 days') || ' 10:00'));

INSERT INTO sb_bookings(shop_code, service_id, employee_id, customer_name, customer_phone, scheduled_at, duration_min, status, note)
SELECT 'tonys-hair',
       (SELECT id FROM sb_services WHERE shop_code='tonys-hair' AND name='染发（含洗护）'),
       (SELECT id FROM sb_employees WHERE shop_code='tonys-hair' AND name='Lisa'),
       '演示客户·李四', '13800000002', (date('now','+8 hours','+2 days') || ' 14:00'), 120, 'pending', '演示预约'
WHERE NOT EXISTS (SELECT 1 FROM sb_bookings WHERE shop_code='tonys-hair' AND customer_phone='13800000002' AND scheduled_at = (date('now','+8 hours','+2 days') || ' 14:00'));

INSERT INTO sb_bookings(shop_code, service_id, employee_id, customer_name, customer_phone, scheduled_at, duration_min, status, note)
SELECT 'tonys-hair',
       (SELECT id FROM sb_services WHERE shop_code='tonys-hair' AND name='头皮护理'),
       (SELECT id FROM sb_employees WHERE shop_code='tonys-hair' AND name='阿杰'),
       '演示客户·王五', '13800000003', (date('now','+8 hours','+3 days') || ' 11:00'), 45, 'done', '演示预约'
WHERE NOT EXISTS (SELECT 1 FROM sb_bookings WHERE shop_code='tonys-hair' AND customer_phone='13800000003' AND scheduled_at = (date('now','+8 hours','+3 days') || ' 11:00'));

INSERT INTO sb_bookings(shop_code, service_id, employee_id, customer_name, customer_phone, scheduled_at, duration_min, status, note)
SELECT 'tonys-hair',
       (SELECT id FROM sb_services WHERE shop_code='tonys-hair' AND name='女士精剪 + 造型'),
       (SELECT id FROM sb_employees WHERE shop_code='tonys-hair' AND name='Tony'),
       '演示客户·赵六', '13800000004', (date('now','+8 hours','+1 days') || ' 15:00'), 60, 'confirmed', '演示预约'
WHERE NOT EXISTS (SELECT 1 FROM sb_bookings WHERE shop_code='tonys-hair' AND customer_phone='13800000004' AND scheduled_at = (date('now','+8 hours','+1 days') || ' 15:00'));

INSERT INTO sb_bookings(shop_code, service_id, employee_id, customer_name, customer_phone, scheduled_at, duration_min, status, note)
SELECT 'nails-art',
       (SELECT id FROM sb_services WHERE shop_code='nails-art' AND name='法式美甲'),
       (SELECT id FROM sb_employees WHERE shop_code='nails-art' AND name='小雅'),
       '演示客户·钱七', '13800000005', (date('now','+8 hours','+2 days') || ' 13:00'), 75, 'pending', '演示预约'
WHERE NOT EXISTS (SELECT 1 FROM sb_bookings WHERE shop_code='nails-art' AND customer_phone='13800000005' AND scheduled_at = (date('now','+8 hours','+2 days') || ' 13:00'));

INSERT INTO sb_bookings(shop_code, service_id, employee_id, customer_name, customer_phone, scheduled_at, duration_min, status, note)
SELECT 'nails-art',
       (SELECT id FROM sb_services WHERE shop_code='nails-art' AND name='基础护理'),
       (SELECT id FROM sb_employees WHERE shop_code='nails-art' AND name='小雅'),
       '演示客户·孙八', '13800000006', (date('now','+8 hours','+2 days') || ' 16:00'), 40, 'confirmed', '演示预约'
WHERE NOT EXISTS (SELECT 1 FROM sb_bookings WHERE shop_code='nails-art' AND customer_phone='13800000006' AND scheduled_at = (date('now','+8 hours','+2 days') || ' 16:00'));

-- 说明：
-- 1) D1 使用 SQLite。
-- 2) 账号密码登录：sb_admin_accounts 表存储账号；默认账号 admin/admin123 由运行时播种，
--    首次登录后请尽快在「店铺设置 → 修改密码」中修改。
-- 3) 店主可在后台「账号管理」中新增员工(staff)账号、删除账号。
-- 4) 所有业务表统一带 sb_ 前缀，本项目与 linguaverse-web / workbench-mobile / event-signin
--    等共用同一个 Cloudflare D1「dev」数据库，前缀用于隔离各项目的表空间。
