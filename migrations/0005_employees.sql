-- 0005_employees.sql — 员工 / 技师管理
-- 新增 employees 表 + bookings.employee_id 列（指定师傅，可空）+ tonys-hair 种子员工
--
-- 应用：node scripts/apply-migration.mjs 0005_employees.sql
-- 脚本已对「重复列/已存在」错误做幂等跳过；也可靠 _middleware.ensureDatabase 自动建表 + 补列。

-- 1) 员工表
CREATE TABLE IF NOT EXISTS employees (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_code    TEXT NOT NULL REFERENCES shops(code) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  title        TEXT,
  intro        TEXT,
  avatar_key   TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE INDEX IF NOT EXISTS idx_employees_shop ON employees(shop_code, sort_order, active);

-- 2) 预约表补充「指定师傅」列（老库无该列时补充）
--    软删除员工时 bookings.employee_id 置 NULL（ON DELETE SET NULL），历史预约不丢归属展示
ALTER TABLE bookings ADD COLUMN employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;

-- 3) tonys-hair 种子员工（按姓名独立判定，避免首条插入后其余被 WHERE NOT EXISTS 跳过）
INSERT INTO employees(shop_code, name, title, intro, sort_order, active)
SELECT 'tonys-hair', 'Tony', '总监发型师', '二十年经验，擅长日系烫染与轮廓剪裁', 10, 1
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE shop_code = 'tonys-hair' AND name = 'Tony');

INSERT INTO employees(shop_code, name, title, intro, sort_order, active)
SELECT 'tonys-hair', 'Lisa', '高级发型师', '韩式刘海与染发设计', 20, 1
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE shop_code = 'tonys-hair' AND name = 'Lisa');

INSERT INTO employees(shop_code, name, title, intro, sort_order, active)
SELECT 'tonys-hair', '阿杰', '洗护技师', '头皮护理与洗发造型', 30, 1
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE shop_code = 'tonys-hair' AND name = '阿杰');
