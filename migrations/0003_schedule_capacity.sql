-- 0003_schedule_capacity.sql — 时段容量（多师傅并行）
-- shop_schedule.capacity: 同一时段允许的最大并行预约数（即同时服务的师傅/工位数）

ALTER TABLE shop_schedule ADD COLUMN capacity INTEGER NOT NULL DEFAULT 1;

-- seed 数据保持 1（单师傅），商家可在后台按天调整
