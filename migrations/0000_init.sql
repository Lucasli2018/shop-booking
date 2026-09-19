-- 0000_init.sql — 初始 schema
-- 适用：全新数据库（wrangler d1 migrations apply shop-booking-db --remote）


CREATE TABLE IF NOT EXISTS shops (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  intro       TEXT,
  logo_key    TEXT,
  cover_key   TEXT,
  phone       TEXT,
  address     TEXT,
  pin_hash    TEXT NOT NULL,
  pin_salt    TEXT NOT NULL,
  timezone    TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE TABLE IF NOT EXISTS services (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_code    TEXT NOT NULL REFERENCES shops(code) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  price_cents  INTEGER,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE INDEX IF NOT EXISTS idx_services_shop ON services(shop_code, sort_order, active);

CREATE TABLE IF NOT EXISTS shop_schedule (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_code    TEXT NOT NULL REFERENCES shops(code) ON DELETE CASCADE,
  weekday      INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_at     TEXT NOT NULL,
  closes_at    TEXT NOT NULL,
  slot_minutes INTEGER NOT NULL DEFAULT 30 CHECK (slot_minutes IN (15, 30, 45, 60, 90, 120)),
  active       INTEGER NOT NULL DEFAULT 1,
  UNIQUE(shop_code, weekday)
);

CREATE TABLE IF NOT EXISTS bookings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_code      TEXT NOT NULL REFERENCES shops(code) ON DELETE CASCADE,
  service_id     INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  customer_name  TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  scheduled_at   TEXT NOT NULL,
  duration_min   INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','called','done','cancelled','rejected')),
  note           TEXT,
  cancelled_at   TEXT,
  rejected_at    TEXT,
  called_at      TEXT,
  done_at        TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_shop_time_status
  ON bookings(shop_code, scheduled_at, status);
CREATE INDEX IF NOT EXISTS idx_bookings_phone
  ON bookings(shop_code, customer_phone);
CREATE INDEX IF NOT EXISTS idx_bookings_service_time
  ON bookings(service_id, scheduled_at, status);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token       TEXT PRIMARY KEY,
  shop_code   TEXT NOT NULL REFERENCES shops(code) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  expires_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_shop
  ON admin_sessions(shop_code, expires_at);
