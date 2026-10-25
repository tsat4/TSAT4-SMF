-- ล้างตารางใบเบิกชุดเก่าออกจาก **Tx Data** (2026-10-25)
-- ระบบงานย้ายไป Mx Data แล้ว โค้ดอ่าน tx_sto_* จาก client mx เท่านั้น
-- ห้ามรันไฟล์นี้ใน Mx Data

drop table if exists public.tx_sto_issue;
drop table if exists public.tx_sto_requisition_line;
drop table if exists public.tx_sto_requisition;
drop function if exists public.tx_sto_apply_costcenter(bigint, text, text);
drop function if exists public.tx_sto_issue_apply();
drop function if exists public.tx_sto_issue_freeze();
drop function if exists public.tx_sto_requisition_guard();
drop function if exists public.tx_sto_requisition_issue();
drop function if exists public.tx_sto_requisition_line_bind();
drop function if exists public.tx_sto_requisition_line_lock();

notify pgrst, 'reload schema';
