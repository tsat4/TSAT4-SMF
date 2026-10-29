-- Mx Data · mt_main_employee.level เพิ่ม M1–M3 (ผู้จัดการ) และ G1–G3 (ผู้จัดการโรงงาน) · รันซ้ำได้
-- ใช้ได้ทั้งกรณีคอลัมน์เป็น enum และเป็น text ที่มี check constraint (ถ้าไม่มี constraint จะเพิ่มให้แบบ NOT VALID ไม่ตรวจข้อมูลเดิม)

-- ===== ขั้นที่ 1: ดูของเดิม (อ่านอย่างเดียว) =====
select format_type(a.atttypid, a.atttypmod) as level_type,
  (select string_agg(pg_get_constraintdef(c.oid), ' | ') from pg_constraint c
    where c.conrelid = 'public.mt_main_employee'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) ilike '%level%') as level_checks,
  (select string_agg(distinct e.level::text, ', ') from public.mt_main_employee e) as levels_in_use
from pg_attribute a
where a.attrelid = 'public.mt_main_employee'::regclass and a.attname = 'level';

-- ===== ขั้นที่ 2: เพิ่มระดับ =====
do $$
declare
  t oid;
  c record;
  lv text;
begin
  select a.atttypid into t from pg_attribute a where a.attrelid = 'public.mt_main_employee'::regclass and a.attname = 'level';
  if (select typtype from pg_type where oid = t) = 'e' then
    foreach lv in array array['M1', 'M2', 'M3', 'G1', 'G2', 'G3'] loop
      execute format('alter type %s add value if not exists %L', t::regtype, lv);
    end loop;
  else
    for c in select conname from pg_constraint
      where conrelid = 'public.mt_main_employee'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%level%' loop
      execute format('alter table public.mt_main_employee drop constraint %I', c.conname);
    end loop;
    alter table public.mt_main_employee add constraint mt_main_employee_level_check
      check (level in ('S1', 'S2', 'S3', 'T1', 'T2', 'T3', 'T6', 'T7', 'T8', 'M1', 'M2', 'M3', 'G1', 'G2', 'G3')) not valid;
  end if;
end $$;

notify pgrst, 'reload schema';
