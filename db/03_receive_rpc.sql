-- ขั้นที่ 4: รันใน MX หลังจากคัดลอกตาราง tx_* เข้า MX แล้ว (ขั้นที่ 3)
-- (ก) ตั้งเลข id ถัดไปของทุกตาราง tx_* ให้ต่อจากข้อมูลที่คัดลอกมา
-- (ข) tx_sto_receive: ตัดสต็อกทุกรายการและเปลี่ยนสถานะเป็น received ใน transaction เดียว
--     ถ้ารายการไหนสต็อกไม่พอ ระบบจะยกเลิกทั้งหมด ไม่มีการตัดค้างไว้ครึ่งทาง
--     server เรียกฟังก์ชันนี้อัตโนมัติเมื่อมีอยู่ (server/modules/sto/requisitions.js)

do $$
declare col record;
begin
  for col in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name like 'tx\_%'
      and pg_get_serial_sequence('public.' || quote_ident(c.table_name), c.column_name) is not null
  loop
    execute format(
      'select setval(pg_get_serial_sequence(%L, %L), coalesce((select max(%I) from public.%I), 0) + 1, false)',
      'public.' || col.table_name, col.column_name, col.column_name, col.table_name);
  end loop;
end $$;

create or replace function public.tx_sto_receive(p_id bigint, p_employee text)
returns void
language plpgsql
set search_path = public
as $$
declare
  line record;
  done int := 0;
begin
  perform 1 from tx_sto_requisition
    where id = p_id and status = 'ready' and requested_by = p_employee
    for update;
  if not found then
    raise exception 'requisition % is not ready', p_id;
  end if;
  for line in
    select costcenter, material, qty from tx_sto_requisition_line where requisition_id = p_id order by id
  loop
    perform mt_sto_stock_adjust(p_costcenter => line.costcenter, p_material => line.material, p_delta => -line.qty);
    done := done + 1;
  end loop;
  if done = 0 then
    raise exception 'no lines in requisition %', p_id;
  end if;
  update tx_sto_requisition set status = 'received', received_by = p_employee where id = p_id and status = 'ready';
end;
$$;

revoke all on function public.tx_sto_receive(bigint, text) from public, anon, authenticated;
grant execute on function public.tx_sto_receive(bigint, text) to service_role;
