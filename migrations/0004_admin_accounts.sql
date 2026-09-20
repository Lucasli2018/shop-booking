-- 0004_admin_accounts.sql — 账号密码登录（替代原单 PIN）
-- 新增 admin_accounts 表 + admin_sessions.account_id 列 + 默认账号播种
--
-- 应用：node scripts/apply-migration.mjs 0004_admin_accounts.sql
-- 脚本已对「重复列/已存在」错误做幂等跳过；也可靠 _middleware.ensureAccounts 自动建表。

-- 1) 账号表
CREATE TABLE IF NOT EXISTS admin_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_code     TEXT NOT NULL REFERENCES shops(code) ON DELETE CASCADE,
  username      TEXT NOT NULL,
  pass_hash     TEXT NOT NULL,
  pass_salt     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'owner',
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_accounts_shop_user
  ON admin_accounts(shop_code, username);

-- 2) 会话绑定账户（老库无该列时补充）
ALTER TABLE admin_sessions ADD COLUMN account_id INTEGER REFERENCES admin_accounts(id);

-- 3) 给还没有任何账号的店铺播种默认 admin / admin123（owner）
--    由运行时 ensureAccounts 自动处理，这里仅作手动兜底说明：
--    INSERT INTO admin_accounts(shop_code, username, pass_hash, pass_salt, role, created_at)
--    VALUES ('<shop>', 'admin', '<HMAC-SHA256(admin123, <salt>)>', '<salt>', 'owner', datetime('now','+8 hours'));
