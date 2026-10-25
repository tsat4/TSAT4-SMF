-- ล้างตารางกิจกรรมชุดเก่าออกจาก **Mx Data** หลังย้ายไป Tx Data แล้ว (2026-10-25)
-- รันเมื่อ: ตั้ง env TX_* บน Render เป็น Tx Data แล้ว และหน้า 5S (Dashboard / Setting) บนเว็บแสดงข้อมูลจาก Tx Data ถูกต้อง
-- ตารางกิจกรรมใหม่อยู่ใน Tx Data ชื่อ mt_5s_* / tx_5s_* (db/act/5s.sql)

-- ขั้นที่ 1 (ทางเลือก): ถ้าเคยเพิ่มรายการในแผน Gantt ไว้ใน Mx Data ให้รันคำสั่งนี้ใน Mx Data
-- แล้วนำผลลัพธ์ (คำสั่ง insert) ไปรันใน Tx Data ก่อนลบ ถ้าไม่มีแถวก็ข้ามได้
-- select format('insert into public.mt_5s_plan (title, detail, start_date, end_date, responsible, status, created_by, created_at) values (%L, %L, %L, %L, %L, %L, %L, %L);',
--   title, detail, start_date, end_date, responsible, status, created_by, created_at)
-- from public.mt_act_plan where activity = '5s' order by id;

-- ขั้นที่ 2: ลบของเก่าใน Mx Data
drop view if exists public.v_act_audit_group;
drop table if exists public.tx_act_issue_photo;
drop table if exists public.tx_act_issue;
drop table if exists public.tx_act_audit_person;
drop table if exists public.tx_act_audit_score;
drop table if exists public.tx_act_audit;
drop table if exists public.mt_act_audit_plan;
drop table if exists public.mt_act_checklist;
drop table if exists public.mt_act_team;
drop table if exists public.mt_act_area_owner;
drop table if exists public.mt_act_area;
drop table if exists public.mt_act_setting;
drop table if exists public.mt_act_plan;
drop table if exists public.mt_act_owner;
drop table if exists public.mt_act_user;

notify pgrst, 'reload schema';
