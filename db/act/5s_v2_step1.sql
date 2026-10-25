-- 5S โครงสร้าง v2 · ขั้นที่ 1 — รันใน **Tx Data** (ไฟล์เขียนมือ ใช้ครั้งเดียวกับฐานที่มีข้อมูลอยู่แล้ว)
-- ยุบ 3 ตารางเข้าตารางหลัก: mt_5s_area_owner → mt_5s_team (role owner) · tx_5s_audit_person → tx_5s_audit.auditors/receivers
-- · tx_5s_issue_photo → tx_5s_issue.photo_before/photo_after
-- ขั้นนี้ "เพิ่มอย่างเดียว" ไม่ลบตารางเก่า โค้ดเดิมยังทำงานได้ · รันซ้ำได้ (เติมเฉพาะช่องที่ยังว่าง ไม่ทับข้อมูลที่โค้ดใหม่เขียนแล้ว)
-- ลำดับเต็ม: docs/HANDOFF.md หัวข้อ "กำลังทำอยู่" · ขั้นที่ 2 (ลบตารางเก่า): db/act/5s_v2_step2.sql

-- 1) mt_5s_team รับเจ้าของพื้นที่
alter table public.mt_5s_team add column if not exists area_id bigint;
alter table public.mt_5s_team drop constraint if exists mt_5s_team_role_check;
alter table public.mt_5s_team add constraint mt_5s_team_role_check check (role in ('admin', 'chairman', 'auditor', 'owner'));
alter table public.mt_5s_team drop constraint if exists mt_5s_team_owner_has_area;
alter table public.mt_5s_team add constraint mt_5s_team_owner_has_area check ((role = 'owner') = (area_id is not null));
alter table public.mt_5s_team drop constraint if exists mt_5s_team_unique;
alter table public.mt_5s_team add constraint mt_5s_team_unique unique nulls not distinct (year, employee_id, role, team, area_id);
create unique index if not exists mt_5s_team_one_owner on public.mt_5s_team (year, area_id) where role = 'owner';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mt_5s_team_area_fk') then
    alter table public.mt_5s_team add constraint mt_5s_team_area_fk foreign key (area_id) references public.mt_5s_area (id) on delete cascade;
  end if;
end $$;

-- 2) คอลัมน์ใหม่ในใบตรวจและ Issue
alter table public.tx_5s_audit add column if not exists auditors text[] not null default '{}';
alter table public.tx_5s_audit add column if not exists receivers text[] not null default '{}';
alter table public.tx_5s_issue add column if not exists photo_before text[] not null default '{}';
alter table public.tx_5s_issue add column if not exists photo_after text[] not null default '{}';

-- 3) คัดลอกข้อมูลจากตารางเก่า (ข้ามไปถ้าตารางเก่าไม่มีแล้ว)
do $$ begin
  if to_regclass('public.mt_5s_area_owner') is not null then
    insert into public.mt_5s_team (year, employee_id, role, team, area_id, status)
    select o.year, o.employee_id, 'owner', null, o.area_id, 'Active' from public.mt_5s_area_owner o
    on conflict do nothing;
  end if;
  if to_regclass('public.tx_5s_audit_person') is not null then
    update public.tx_5s_audit a set auditors = p.ids
    from (select audit_id, array_agg(distinct employee_id order by employee_id) ids from public.tx_5s_audit_person where kind = 'participated' group by audit_id) p
    where p.audit_id = a.id and cardinality(a.auditors) = 0;
    update public.tx_5s_audit a set receivers = p.ids
    from (select audit_id, array_agg(distinct employee_id order by employee_id) ids from public.tx_5s_audit_person where kind = 'receiver' group by audit_id) p
    where p.audit_id = a.id and cardinality(a.receivers) = 0;
  end if;
  if to_regclass('public.tx_5s_issue_photo') is not null then
    update public.tx_5s_issue i set photo_before = p.urls
    from (select issue_id, array_agg(url order by created_at, id) urls from public.tx_5s_issue_photo where kind = 'BEFORE' group by issue_id) p
    where p.issue_id = i.id and cardinality(i.photo_before) = 0;
    update public.tx_5s_issue i set photo_after = p.urls
    from (select issue_id, array_agg(url order by created_at, id) urls from public.tx_5s_issue_photo where kind = 'AFTER' group by issue_id) p
    where p.issue_id = i.id and cardinality(i.photo_after) = 0;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ตรวจผล: ข้อมูลเดิมจาก Excel ต้องได้ เจ้าของ 34 · ใบตรวจที่มีผู้ตรวจ 33 · รูปรวม 54
select (select count(*) from public.mt_5s_team where role = 'owner') as owners,
  (select count(*) from public.tx_5s_audit where cardinality(auditors) > 0) as audits_with_auditors,
  (select coalesce(sum(cardinality(photo_before) + cardinality(photo_after)), 0) from public.tx_5s_issue) as photos;
