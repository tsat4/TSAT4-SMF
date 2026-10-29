-- 5S: จัดโครงสร้างทีมใหม่ เพิ่มบทบาท advisor (ที่ปรึกษา) ใน mt_5s_team
-- รันใน Tx Data (loeyrgavlpdnrbczjxpl)
alter table public.mt_5s_team
  drop constraint if exists mt_5s_team_role_check,
  add constraint mt_5s_team_role_check check (role in ('admin', 'chairman', 'vice', 'advisor', 'auditor', 'owner', 'member'));

notify pgrst, 'reload schema';

