-- ที่เก็บรูป Issue ของระบบกิจกรรม รันใน **Tx Data** ครั้งเดียว (รันซ้ำได้) · ไฟล์นี้เขียนมือ ไม่ได้สร้างจาก scripts/act-sql.js
-- รูปเก็บที่ act-img/<กิจกรรม>/<ISSxxxx>_<BEFORE|AFTER>_<เวลา>.jpg (16:9 JPEG ≤ 700 KB) เปิดดูได้ด้วยลิงก์ (public)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('act-img', 'act-img', true, 716800, array['image/jpeg'])
on conflict (id) do nothing;
