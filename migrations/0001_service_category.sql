-- 0001_service_category.sql — 服务分类
-- services.category: 自由文本分类（如 剪发/染烫/护理），NULL 视为「其他」

ALTER TABLE services ADD COLUMN category TEXT;

-- 给 seed 数据补分类
UPDATE services SET category = '剪发' WHERE shop_code = 'tonys-hair' AND name IN ('男士精剪', '女士精剪 + 造型');
UPDATE services SET category = '染烫' WHERE shop_code = 'tonys-hair' AND name IN ('染发（含洗护）', '烫发（含剪发）');
UPDATE services SET category = '护理' WHERE shop_code = 'tonys-hair' AND name IN ('头皮护理', '洗吹造型');
