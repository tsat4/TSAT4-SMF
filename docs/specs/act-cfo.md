# CFO — Carbon Footprint for Organization

ผู้ใช้สั่ง 2026-10-26 · ที่มา: `inbox/master_cfo.xlsx` + `inbox/transaction_cfo.xlsx` (ระบบเดิม TSATP4-CFO, Apps Script)
ตาราง: `db/act/cfo.sql` (สร้างจาก `scripts/act-sql.js` ฟังก์ชัน `cfoSql`) · ข้อมูลเดิม: `python -I scripts/import_cfo_excel.py` → `inbox/import_cfo.sql`
ทดสอบ: `npm run test:act` (ยอด tCO2e ตรง Excel: Scope 1 = 188.863, Scope 2 = 6,642.52)

## จาก 15 sheet เหลือ 5 ตาราง + 2 view

| Excel เดิม | ตารางใหม่ | หมายเหตุ |
|---|---|---|
| mt_scope | `mt_cfo_scope` | PK `code` สั้น `1-1` … `3-15` |
| mt_gwp | `mt_cfo_gwp` | PK `code` เช่น `AR5` |
| mt_ef_scope1 + 2 + 3 | `mt_cfo_ef` | ตารางเดียว แยกด้วย `scope_code` · ค่าแยกก๊าซมีเฉพาะ Scope 1 · `kind` = On-Road / Off-Road / กลุ่มของ Scope 3 |
| mt_ef_septictank | `mt_cfo_setting` | ค่าคงที่ 4 ตัว (`septic_bod`, `septic_b0`, `septic_mcf`, `septic_i`) |
| mt_ac_scope1 + 2 + 3 | `mt_cfo_activity` | ตารางเดียว · scope / category / emission_source ดูจาก EF ไม่เก็บซ้ำ · `calc = 'septic'` แทน st_id |
| mt_org | `mt_cfo_team` (แม่แบบ) | ประธาน = `chairman`, รองประธาน = `vice`, ผู้จัดทำ = `admin`, สมาชิก = `member` + `department` · ชื่อ/ตำแหน่งอ่านจาก Mx Data |
| mt_company | `mt_cfo_setting` | key `company_*` |
| tx_scope1 + 2 + 3 | `tx_cfo_entry` | ตารางเดียว 1 แถว = กิจกรรม × เดือน (`unique (activity_id, month)`) |
| tx_scope (สรุป) | `v_cfo_month` | view รวมรายเดือนต่อ Scope |
| คอลัมน์ tGHG / tCO₂e 15 คอลัมน์ | `v_cfo_entry` | view คำนวณจาก qty × EF × GWP ไม่เก็บ |
| tx_septictank (ไฟล์แยก) | `tx_cfo_entry.inputs` | jsonb `{ "people", "days" }` |

ทุกกิจกรรมได้ `mt_cfo_task` (Planner) และ `img_cfo` (ที่เก็บรูป) จากแม่แบบด้วย

## หน้าจอ (public/js/act-cfo.js · server/modules/act/cfo.js)

- **Dashboard:** Summary (รวมทั้งปีเทียบปีก่อน, Scope 1/2/3 + สัดส่วน, กราฟรายเดือนแยก Scope, ตารางตามหมวดและหน่วยงาน) · Schedule (Planner ดูอย่างเดียว)
- **transaction:** เลือกปี / เดือน → ทุกกิจกรรมของเดือนนั้น · ตัวแทนหน่วยงานบันทึกได้เฉพาะหน่วยงานตัวเอง (แถวอื่นเป็นสีจาง) · ผู้จัดทำบันทึกได้ทุกแถวและกด "ยืนยันเดือนนี้" (ล็อกทั้งเดือน) / "เปิดให้แก้เดือนนี้" · บ่อเกรอะกรอกคน × วัน
- **Setting:** แผนงาน (Planner) · กิจกรรม · Emission Factor (EF ที่ใช้แล้วแก้ได้เฉพาะชื่อ/รายละเอียด/อ้างอิง/สถานะ) · ทีม (ผู้จัดทำ / ประธาน / รองประธาน / ตัวแทนหน่วยงาน + หน่วยงาน, คัดลอกจากปีก่อน) · บริษัท (ข้อมูลบริษัท ปีฐาน เป้าลด ค่าบ่อเกรอะ)
- master (EF / กิจกรรม / บริษัท) ไม่แยกปี แก้ได้โดย admin ของปีปัจจุบัน

## สูตร

- tCO2e = qty × `kgco2e` / 1000 (ค่าต่อหน่วยรวมทุกก๊าซ ตามระบบเดิม)
- แยกก๊าซ (Scope 1): qty × EF ก๊าซ × GWP ก๊าซ / 1000 · HFC / PFC เก็บเป็น kgCO2e อยู่แล้ว
- บ่อเกรอะ: kg CH4 = คน × วัน × BOD × 0.001 × I × B0 × MCF (เหมือน `septicCalc` ใน TSATP4-CFO) แล้วบันทึกเป็น qty ของกิจกรรมที่ `calc = 'septic'` (EF = 1 kg CH4 → 28 kgCO2e)

## กติกาข้อมูล

- EF ที่มีรายการใช้แล้ว **ห้ามแก้ค่า** ถ้าค่าเปลี่ยนให้เพิ่มแถวใหม่แล้วปิดแถวเดิม (`Inactive`) · `tx_cfo_entry` เก็บ `ef_id` / `gwp_code` ที่ใช้ตอนบันทึก ผลย้อนหลังจึงไม่เปลี่ยน
- EF ที่ยังไม่มีค่า (`kgco2e` ว่าง) เป็น `Inactive` ใช้บันทึกไม่ได้
- หน่วยงาน (`department`) เป็นข้อความตรงกับ `mt_main_costcenter.department` ใน Mx Data (FK ข้ามฐานไม่ได้)
- สิทธิ์ (accessOf): admin = Setting, chairman / vice / member = transaction (member บันทึกได้เฉพาะหน่วยงานของตัวเอง — ทำตอนสร้างหน้า), ทุกคน = Dashboard

## สิ่งที่แก้ระหว่างนำเข้า (ข้อมูล Excel เดิม)

- Scope 3 รหัส EF ซ้ำ (sc3021026-003 … 015 ใช้ 2 รอบ) → แถวหลังได้รหัส `-2`, `-3`
- Scope 3 ไม่มีรหัส 101 แถว (เคมีภัณฑ์ 85, น้ำเสีย/ขยะ 15, น้ำ 1) → นำเข้าโดยไม่มี `code`
- Scope 3 กลุ่ม "18. กลุ่มการปรับปรุงน้ำเสียชุมชน" ไม่มี category → ใส่ 3-5 Waste Generated in Operations
- Scope 3 ไม่มีค่า EF 40 แถว → `Inactive`
- EF บ่อเกรอะ (sc1021026-119) เดิมรวม = 1 → 1 kg CH4 = 28 kgCO2e (ค่า CH4 ของ AR5) ให้ผลเท่ากับระบบเดิม
- คอลัมน์ `effective_from` ในทุก sheet เก็บชื่อคน (ไม่ใช่วันที่) และ `updated_at` บางแถวเป็นอนาคต / ตัวเลข → ไม่นำเข้า
