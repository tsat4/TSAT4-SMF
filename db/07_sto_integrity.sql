-- Mx Data · ความสัมพันธ์ที่ขาดของตาราง Usage (tx_sto_receipt / tx_sto_borrow / tx_sto_reserve) · รันซ้ำได้
-- ขั้นที่ 1 ตรวจอย่างเดียว · ขั้นที่ 2 เพิ่ม FK / check / index แบบ NOT VALID (ตรวจเฉพาะแถวใหม่ ข้อมูลเดิมไม่ถูกแตะ)
-- ขั้นที่ 3 (ไม่บังคับ) VALIDATE ให้ตรวจข้อมูลเดิมด้วย: รันเมื่อขั้นที่ 1 ไม่มีแถว

-- ===== ขั้นที่ 1: ตรวจ (ไม่แก้อะไร) · ทุกแถวต้องได้ bad = 0 ก่อนรันขั้นที่ 3 =====
select 'receipt.received_by ไม่มีใน mt_main_employee' as check_name, count(*) as bad
from public.tx_sto_receipt r where not exists (select 1 from public.mt_main_employee e where e.employee_id = r.received_by)
union all
select 'borrow.borrowed_by ไม่มีใน mt_main_employee', count(*)
from public.tx_sto_borrow b where not exists (select 1 from public.mt_main_employee e where e.employee_id = b.borrowed_by)
union all
select 'reserve.requested_by ไม่มีใน mt_main_employee', count(*)
from public.tx_sto_reserve r where not exists (select 1 from public.mt_main_employee e where e.employee_id = r.requested_by)
union all
select 'receipt: replacement ต้องมี borrow_id / purchase ต้องไม่มี', count(*)
from public.tx_sto_receipt where (kind = 'replacement') <> (borrow_id is not null);

-- ===== ขั้นที่ 2: เพิ่มความสัมพันธ์ (NOT VALID = บังคับกับแถวใหม่เท่านั้น) =====
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tx_sto_receipt_received_by_fkey') then
    alter table public.tx_sto_receipt add constraint tx_sto_receipt_received_by_fkey
      foreign key (received_by) references public.mt_main_employee (employee_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tx_sto_borrow_borrowed_by_fkey') then
    alter table public.tx_sto_borrow add constraint tx_sto_borrow_borrowed_by_fkey
      foreign key (borrowed_by) references public.mt_main_employee (employee_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tx_sto_reserve_requested_by_fkey') then
    alter table public.tx_sto_reserve add constraint tx_sto_reserve_requested_by_fkey
      foreign key (requested_by) references public.mt_main_employee (employee_id) not valid;
  end if;
  -- รับคืนจากการยืม (replacement) ต้องชี้ใบยืม · ซื้อปกติ (purchase) ไม่มีใบยืม
  if not exists (select 1 from pg_constraint where conname = 'tx_sto_receipt_kind_borrow') then
    alter table public.tx_sto_receipt add constraint tx_sto_receipt_kind_borrow
      check ((kind = 'replacement') = (borrow_id is not null)) not valid;
  end if;
end $$;

-- index ตามที่ server ค้น (ช่วงเดือน, ใบยืมที่ยังเปิด, ใบจองที่รอสั่งซื้อ)
create index if not exists tx_sto_receipt_received_at on public.tx_sto_receipt (received_at);
create index if not exists tx_sto_borrow_borrowed_at on public.tx_sto_borrow (borrowed_at);
create index if not exists tx_sto_reserve_material on public.tx_sto_reserve (material, status, reserved_at);

notify pgrst, 'reload schema';

-- ===== ขั้นที่ 3 (ไม่บังคับ): ตรวจข้อมูลเดิมด้วย · รันเมื่อขั้นที่ 1 ได้ bad = 0 ทุกแถว (ลบ -- ออกแล้วรัน) =====
-- alter table public.tx_sto_receipt validate constraint tx_sto_receipt_received_by_fkey;
-- alter table public.tx_sto_borrow validate constraint tx_sto_borrow_borrowed_by_fkey;
-- alter table public.tx_sto_reserve validate constraint tx_sto_reserve_requested_by_fkey;
-- alter table public.tx_sto_receipt validate constraint tx_sto_receipt_kind_borrow;
