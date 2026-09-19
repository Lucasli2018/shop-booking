-- 0002_booking_customer_email.sql — 预约可选联系邮箱
-- 顾客可留邮箱，预约成功后发送确认邮件（未配置 RESEND_API_KEY 时跳过发送）

ALTER TABLE bookings ADD COLUMN customer_email TEXT;
