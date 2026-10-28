-- Mx Data · ระดับสิทธิ์ภาพรวมของบัญชี (mt_main_user) นอกเหนือจาก creator (= จัดการได้ทั้งหมด)
--   executive = ผู้บริหาร: ดูได้ทุกหน้า + อนุมัติเท่าประธานในทุกกิจกรรม
--   admin_of  = ผู้ดูแลบางระบบ: เป็น admin ของระบบ / กิจกรรมที่ระบุทุกปี (เช่น {cfo,kaizen,sto})
-- รันซ้ำได้
alter table public.mt_main_user add column if not exists executive boolean not null default false;
alter table public.mt_main_user add column if not exists admin_of text[] not null default '{}';
