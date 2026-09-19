# shop-booking

小商家预约排队系统 MVP —— 理发店、美甲店、宠物美容、维修店都能用。

**技术栈：** Cloudflare Pages + Functions + D1 + R2，纯 HTML/JS 前端，零构建。

---

## 快速开始

### 1. 安装 Wrangler

```bash
npm install -g --allow-scripts=esbuild,workerd wrangler
```

> `--allow-scripts` 是必须的：wrangler 依赖 `esbuild`（打包）和 `workerd`（本地运行时），
> 它们的 postinstall 脚本被 npm 默认禁用，不加就会报 `Cannot find module 'esbuild'`。

### 2. 在 Cloudflare 上创建 D1 数据库和 R2 bucket

打开 [Cloudflare Dashboard → Workers & Pages](https://dash.cloudflare.com/)：

1. **D1 Database**：Workers & Pages → D1 → Create D1 Database
   - Database name: `shop-booking-db`
   - 创建后记下 **Database ID**（UUID 格式）
2. **R2 Bucket**：Workers & Pages → R2 → Create bucket
   - Bucket name: `shop-booking-images`

### 3. 修改 wrangler.toml

```toml
[[d1_databases]]
binding = "DB"
database_name = "shop-booking-db"
database_id = "你的-D1-Database-ID"      # ← 替换

[[r2_buckets]]
binding = "R2"
bucket_name = "shop-booking-images"       # ← 替换
```

### 4. 初始化生产数据库

```bash
wrangler d1 execute shop-booking-db --remote --file=schema.sql
```

这会创建 5 张表并插入 seed 数据：
- 一个店铺 `tonys-hair`（Tony's 美发）
- 6 个服务
- 7 天营业时间（周一到周日 09:00-21:00，30 分钟一档）
- **初始 PIN = `123456`**（首次登录时会自动写入 hash，之后可在后台修改）

### 5. 本地开发

```bash
wrangler pages dev --port 8787 --persist-to ./.wrangler-dev
```

> **为什么用 `--persist-to`？**
> Windows 上多次重启 wrangler 会导致 `.wrangler/state` 目录被锁死（EPERM），
> 用独立的 `.wrangler-dev` 目录可以避免这个问题。不需要时删除 `.wrangler-dev` 即可重置本地数据。

首次请求时，`_middleware.js` 会自动检测空数据库并执行建表 + seed，无需手动运行 schema。

打开：
- 顾客页：<http://localhost:8787/?shop=tonys-hair>
- 排队页：<http://localhost:8787/queue.html?shop=tonys-hair>
- 商家后台：<http://localhost:8787/admin.html?shop=tonys-hair>（PIN: `123456`）

### 6. 部署到 Cloudflare

```bash
wrangler pages deploy . --project-name=shop-booking
```

部署后得到 URL：`https://shop-booking.pages.dev`

- 顾客页：`https://shop-booking.pages.dev/?shop=tonys-hair`
- 商家后台：`https://shop-booking.pages.dev/admin.html?shop=tonys-hair`
- 排队页：`https://shop-booking.pages.dev/queue.html?shop=tonys-hair`

---

## 目录结构

```
shop-booking/
├── wrangler.toml              # Cloudflare Pages 配置
├── schema.sql                 # D1 初始化脚本（生产用）
├── README.md
├── functions/                 # Pages Functions（后端）
│   ├── _middleware.js         # 全局中间件：CORS + 本地自动建表 + 日志
│   ├── _shared/               # 共享工具
│   │   ├── crypto.js          # HMAC-SHA256 PIN hash、token 生成
│   │   └── helpers.js         # JSON 响应、session 校验、时间工具
│   └── api/
│       ├── services/          # 顾客：服务列表
│       ├── slots/             # 顾客：可用时间段生成
│       ├── bookings/          # 顾客：提交预约
│       ├── queue/             # 顾客：排队状态（公开）
│       └── admin/             # 商家后台
│           ├── auth.js        # PIN 登录
│           ├── _guard.js      # Session 守卫（requireAdmin）
│           ├── image/         # 图片读取
│           └── [shopCode]/    # 店铺级后台接口
│               ├── bookings.js       # 预约列表
│               ├── bookings/[id].js  # 状态变更
│               ├── services.js       # 服务 CRUD
│               ├── services/[id].js
│               ├── schedule.js       # 营业时间
│               ├── profile.js        # 店铺信息 + 改 PIN
│               ├── upload.js         # 图片上传
│               └── queue.js          # 后台排队视图
└── public/                    # 静态前端
    ├── index.html             # 顾客预约页
    ├── queue.html             # 排队叫号页（5s 轮询）
    ├── admin.html             # 商家后台（PIN 登录 → 5 个 Tab）
    ├── css/style.css          # 全局样式（奶油+柔粉+薄荷绿）
    └── js/
        ├── api.js             # API client + AdminClient + showToast
        ├── booking.js         # 顾客预约流程
        ├── queue.js           # 排队轮询
        └── admin.js           # 商家后台（577 行）
```

---

## API 一览

### 顾客侧（公开，无需认证）

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/services/:shopCode` | 服务列表 + 店铺信息 |
| GET | `/api/slots/:shopCode?serviceId&date` | 可用时间段（已扣占用 + 已过时段） |
| POST | `/api/bookings/:shopCode` | 提交预约（原子防并发冲突） |
| GET | `/api/queue/:shopCode` | 当前排队（顾客轮询用） |
| GET | `/api/my/:shopCode?phone=` | 顾客凭手机号查自己的预约（手机号脱敏返回） |
| POST | `/api/my/:shopCode/cancel` | 顾客凭手机号取消自己的预约（仅 pending/confirmed 且未过期） |

### 商家侧（需 `Authorization: Bearer <token>`）

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/admin/auth?shopCode=` | PIN 登录 → 返回 token |
| GET | `/api/admin/:shopCode/bookings?date&status` | 预约列表 + 今日统计 |
| POST | `/api/admin/:shopCode/bookings/:id` | 状态变更，body: `{"action":"confirmed"}` |
| GET/POST | `/api/admin/:shopCode/services` | 服务列表 / 创建 |
| GET/PUT/DELETE | `/api/admin/:shopCode/services/:id` | 服务详情 / 更新 / 软删除 |
| GET/POST | `/api/admin/:shopCode/schedule` | 营业时间 / upsert |
| GET/PUT | `/api/admin/:shopCode/profile` | 店铺信息 / 更新（含改 PIN） |
| POST | `/api/admin/:shopCode/upload` | 上传图片到 R2（multipart，5MB） |
| GET | `/api/admin/image/:shopCode/:key` | 读取图片 |
| GET | `/api/admin/:shopCode/queue` | 后台排队视图（含 pending） |

### 状态变更 action 名称

| action | 从 | 到 | 时间戳字段 |
|--------|----|----|-----------|
| `confirmed` | pending | confirmed | updated_at |
| `rejected` | pending | rejected | rejected_at |
| `cancelled` | pending/confirmed/called | cancelled | cancelled_at |
| `called` | confirmed | called | called_at |
| `done` | confirmed/called | done | done_at |

---

## 数据模型

```sql
shops             店铺（code, name, intro, logo_key, cover_key, pin_hash, pin_salt, timezone, status）
services          服务项目（shop_code, name, description, duration_min, price_cents, sort_order, active）
shop_schedule     营业时间（shop_code, weekday 0-6, opens_at, closes_at, slot_minutes, active）
bookings          预约（shop_code, service_id, customer_name, customer_phone,
                   scheduled_at 'YYYY-MM-DD HH:MM', duration_min, status, note,
                   cancelled_at, rejected_at, called_at, done_at）
admin_sessions    后台会话（token, shop_code, created_at, expires_at）
```

**预约状态机：**
```
pending  → confirmed | rejected | cancelled
confirmed → called | cancelled | done
called   → done | cancelled
done     → (终态)
cancelled → (终态)
rejected  → (终态)
```

---

## 关键设计

### 1. 并发预约防冲突（原子 INSERT）

D1 Workers **没有 `transaction()`**，用 `INSERT ... WHERE NOT EXISTS` 单条原子 SQL 代替：

```sql
INSERT INTO bookings (...)
SELECT ?, ?, ?, ?, ?, ?, 'pending', ?
WHERE NOT EXISTS (
  SELECT 1 FROM bookings
  WHERE shop_code = ?
    AND status IN ('pending','confirmed','called','done')
    AND scheduled_at < ?
    AND datetime(scheduled_at, '+' || duration_min || ' minutes') > ?
)
```

如果时间段被占用，`last_row_id = 0`，返回 409。

### 2. PIN 安全

- HMAC-SHA256(pin, salt) 存储，salt 每店铺随机生成（16 字节 hex）
- 内存 rate-limit：同 shopCode 15 分钟内最多 20 次尝试（429）
- 首次部署：`pin_hash = '__SEED_PIN_UNSET__'`，首次登录用 PIN `123456` 自动写入真实 hash
- 支持后台修改 PIN（`PUT /api/admin/:shopCode/profile` + `{"newPin":"..."}`），生成新 salt

### 3. Session

- 32 字节加密随机 hex token（`crypto.getRandomValues`）
- 24 小时过期，存 D1
- 每次后台调用校验 token + shop_code 匹配 + 未过期
- 退出时删除 session（客户端 `localStorage.removeItem`）

### 4. 排队

- 老板点"叫号"→ `status: confirmed → called`，写 `called_at`
- 顾客 `queue.html` 每 5 秒轮询 `GET /api/queue/:shopCode`
- 页面 `visibilitychange` 时暂停轮询，节省流量
- 用 localStorage 记忆最近一次预约 ID（`last-booking-<shopCode>`），能高亮"轮到您了"

### 5. 图片存储（R2）

- 上传：`POST /api/admin/:shopCode/upload`，multipart/form-data，5MB 上限，仅 jpg/png/webp
- Key 扁平：`<shopCode>-<kind>-<ts>-<rand>.<ext>`（避免 Cloudflare Pages 路由通配符问题）
- 读取：`GET /api/admin/image/:shopCode/:key`，校验 key 必须以 `shopCode-` 开头防越权

### 6. 本地开发自动建表

`wrangler d1 execute --local` 在 wrangler 4.x 有 SQLITE_AUTH bug（不授权）。
`_middleware.js` 在 `CF_PAGES_BRANCH === 'local'` 时自动检测空数据库并执行建表 + seed，
本地开发无需手动初始化。

---

## 部署检查清单

- [ ] `wrangler.toml` 里的 `database_id` 和 `bucket_name` 已替换为真实值
- [ ] `wrangler d1 execute shop-booking-db --remote --file=schema.sql` 已执行（生产 D1 有数据）
- [ ] `wrangler pages deploy . --project-name=shop-booking` 已执行
- [ ] 打开 `https://<project>.pages.dev/?shop=tonys-hair` 看到服务列表
- [ ] 打开 `https://<project>.pages.dev/admin.html?shop=tonys-hair`，用 PIN `123456` 登录成功
- [ ] 登录后在后台修改 PIN（设置 → 修改 PIN）

---

## 常见问题

### Q: `wrangler d1 execute --local` 报 SQLITE_AUTH 错误

wrangler 4.x 的已知 bug，`d1 execute --local` 需要认证但不提供认证入口。
**解决：** 本地开发不需要手动执行 schema，`_middleware.js` 会自动建表。生产环境用 `--remote` 即可。

### Q: 本地开发报 `EPERM: operation not permitted, mkdir .wrangler/state`

Windows 文件锁定问题，之前的 wrangler 进程没完全退出。**解决：**
```bash
wrangler pages dev --port 8787 --persist-to ./.wrangler-dev
```
用独立的 `.wrangler-dev` 目录。

### Q: 后台 PIN 忘了怎么办？

用 D1 SQL 编辑器（Cloudflare Dashboard → D1 → 你的数据库 → SQL）：
```sql
UPDATE shops SET pin_hash = '__SEED_PIN_UNSET__' WHERE code = 'tonys-hair';
```
然后用 PIN `123456` 登录，再在后台修改。

### Q: 怎么加第二个店铺？

用 D1 SQL 编辑器：
```sql
INSERT INTO shops(code, name, intro, pin_hash, pin_salt, timezone, status)
VALUES ('my-shop', '我的店', '介绍', '__SEED_PIN_UNSET__',
        replace(upper(hex(randomblob(16))), ' ', ''), 'Asia/Shanghai', 'active');

-- 添加服务
INSERT INTO services(shop_code, name, duration_min, price_cents, sort_order)
VALUES ('my-shop', '剪发', 30, 5000, 10);

-- 添加营业时间
INSERT INTO shop_schedule(shop_code, weekday, opens_at, closes_at, slot_minutes)
VALUES ('my-shop', 1, '09:00', '21:00', 30);
-- ... 重复 weekday 2-6
```
访问 `https://<project>.pages.dev/?shop=my-shop`。

### Q: 时区怎么配？

店铺表 `timezone` 字段，默认 `Asia/Shanghai`。所有时间字符串用店铺时区的本地时间（naive datetime），
后端用 `Intl.DateTimeFormat` 转换，不做时区偏移计算。

### Q: 为什么部署后 D1 里没数据？

`wrangler pages deploy` 只上传静态文件 + Functions，不初始化数据库。
必须手动执行：`wrangler d1 execute shop-booking-db --remote --file=schema.sql`

### Q: 本地开发数据在哪？

`.wrangler-dev/state/v3/d1/`（如果用 `--persist-to`），删除该目录可重置。

---

## 单店 MVP → 多租户扩展

- 所有表都有 `shop_code` 外键，查询全部走 `shop_code` 参数
- 店铺表支持 `status` 字段（active / paused）
- 扩多租户时：加商户注册表 + 多租户管理后台 + 店铺状态管理，无需迁移

---

## 后续可加

- [ ] 短信/微信通知（顾客预约后、叫号时）
- [ ] 数据统计仪表盘（每日/每周/月预约趋势）
- [x] 顾客手机号一键查我的预约
- [x] 取消预约（顾客端）
- [ ] 服务分类（理发 / 染发 / 护理）
- [ ] 员工管理（多个发型师）
- [ ] 优惠券 / 会员卡
- [ ] 多店铺切换 UI

---

## 本次完善记录（2026-09-20）

- **修复致命 Bug**：`api.js` 此前以 `export` 语法编写，却被三个页面用经典 `<script>` 引入，
  浏览器解析报错导致 `ApiClient` 未定义、整个站点 JS 瘫痪。已改为全局定义（去掉 `export`）。
- **修复日期 bug**：`todayString()` 原用 `toISOString()`（UTC），凌晨 0–8 点会取到「昨天」，
  与日期条的本地日期不一致；改为本地日期。
- **修复排队页「您」识别**：预约成功后写入 `last-booking-<shopCode>` 到 localStorage，
  排队页据此高亮「轮到您了」（此前从不写入，识别永远失效）。
- **修复排队链接**：首页「排队」按钮 `href` 误指向自身，改为 `queue.html`。
- **新增「我的预约」**：顾客在首页点「我的预约」，填手机号即可查询并取消自己的预约
  （后端 `/api/my/:shopCode` 与 `/api/my/:shopCode/cancel`，手机号即弱身份校验）。
- **UI 优化**：新增 hero 欢迎区、卡片入场动画、「我的预约」卡片样式；页脚加商家后台入口；
  手机号标注为必填。

> 注：前端为经典脚本（非 ES Module），所有共享符号在 `api.js` 中定义于全局作用域。

---

## License

MIT — 随便用，改了记得回来看看更新。
