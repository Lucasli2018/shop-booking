-- 0006: 新增演示店铺 nails-art（多店铺切换 UI 演示数据）
-- 应用方式：
--   A. 全新库无需单独跑（schema.sql 已含）；
--   B. 已有库升级：wrangler d1 migrations apply shop-booking-db --remote
--     或 Cloudflare Dashboard → D1 → SQL 编辑器逐段执行。
-- 幂等：INSERT OR IGNORE / 按姓名独立判定。

INSERT OR IGNORE INTO shops(code, name, intro, phone, address, timezone, status)
VALUES (
  'nails-art',
  '小雅美甲',
  '日式美甲 / 手足护理 / 美睫，环境温馨，技师耐心。',
  '+86-139-0000-0000',
  '上海市静安区南京西路 200 号 2 楼',
  'Asia/Shanghai',
  'active'
);

INSERT OR IGNORE INTO services(shop_code, name, description, duration_min, price_cents, category, sort_order) VALUES
  ('nails-art', '基础护理',     '修甲 + 护手霜',     40, 12800, '护理', 10),
  ('nails-art', '法式美甲',     '经典法式 + 造型',   75, 26800, '美甲', 20),
  ('nails-art', '日式美睫',     '嫁接睫毛',         60, 19800, '美睫', 30),
  ('nails-art', '手足护理套餐', '手 + 足护理',      90, 38800, '护理', 40);

INSERT OR IGNORE INTO shop_schedule(shop_code, weekday, opens_at, closes_at, slot_minutes) VALUES
  ('nails-art', 1, '10:00', '20:00', 30),
  ('nails-art', 2, '10:00', '20:00', 30),
  ('nails-art', 3, '10:00', '20:00', 30),
  ('nails-art', 4, '10:00', '20:00', 30),
  ('nails-art', 5, '10:00', '20:00', 30),
  ('nails-art', 6, '10:00', '19:00', 30),
  ('nails-art', 0, '10:00', '19:00', 30);

INSERT INTO employees(shop_code, name, title, intro, sort_order, active)
  SELECT 'nails-art', '小雅', '首席美甲师', '八年经验，擅长日式晕染与极致单色', 10, 1
  WHERE NOT EXISTS (SELECT 1 FROM employees WHERE shop_code = 'nails-art' AND name = '小雅');
