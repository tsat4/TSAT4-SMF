-- 5S โครงสร้าง v2 · ขั้นที่ 2 — รันใน **Tx Data** หลังจาก deploy โค้ด v2 แล้ว และตรวจบนเว็บผ่าน (ไฟล์เขียนมือ ใช้ครั้งเดียว)
-- รัน db/act/5s_v2_step1.sql ซ้ำอีกรอบก่อน (เติมข้อมูลที่อาจเกิดระหว่าง deploy) แล้วค่อยลบตารางเก่า 3 ตาราง
drop table if exists public.tx_5s_issue_photo;
drop table if exists public.tx_5s_audit_person;
drop table if exists public.mt_5s_area_owner;
notify pgrst, 'reload schema';
