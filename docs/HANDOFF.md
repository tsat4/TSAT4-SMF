# HANDOFF — อ่านก่อนเริ่ม และอัปเดตก่อน commit

## กำลังทำอยู่

- งาน: รวมฐาน TX เข้า MX + ตัดสต็อกแบบ atomic (คู่มือเต็มอยู่ที่ `db/README.md`)
- ใคร / เริ่มเมื่อ: Claude, 2026-10-24
- ขั้นตอน:
  - [x] โค้ดเรียก `tx_sto_receive` ถ้ามี ถ้าไม่มี (PGRST202) ใช้วิธีเดิม (deploy แล้ว ปลอดภัยทั้งก่อนและหลังรวมฐาน)
  - [x] `db/01_inspect.sql`, `db/03_receive_rpc.sql`, `scripts/migrate-tx-to-mx.js` (`npm run migrate:tx`)
  - [x] ขั้น 1: inspect TX แล้ว (3 ตาราง, identity always, RLS forced, ใบเบิก 1 / รายการ 0 / จ่าย 0) MX ไม่มี tx_* และมี `mt_sto_stock_adjust(text, text, numeric)` ตรงกับไฟล์ 03
  - [x] ขั้น 2: `db/02_create_tx_in_mx.sql` และรันส่วนตารางใน MX แล้ว (identity by default, force RLS)
  - [x] ขั้น 3: คัดลอกใบเบิกสถานะ cart 1 ใบเข้า MX แล้ว รายการและจ่ายเป็น 0 เลข id ต่อไปคือ 3
  - [x] ขั้น 4: รันฟังก์ชันกับทริกเกอร์ท้ายไฟล์ 02 และ `tx_sto_receive` ใน MX แล้ว
  - [ ] ขั้น 5: ช่วงที่ไม่มีคนใช้ ให้คัดลอกซ้ำ แล้วชี้ Render `TX_SUPABASE_URL` กับ `TX_SUPABASE_SECRET_KEY` ไปที่ MX (ยังไม่ทำ แอปสดยังใช้ฐาน TX)
  - [ ] ขั้น 6: ทดสอบล็อกอิน / เบิก / จัด / จ่าย / รับ แล้วตรวจ Current
  - [ ] หลังรวมฐานและใช้งานได้ราบรื่น: ลบ `receiveLineByLine` ออกจาก requisitions.js และอัปเดต ARCHITECTURE
- ไฟล์ที่ยังแก้ไม่เสร็จ: ไม่มี
<!-- ถ้าเริ่มงานใหญ่ ให้เขียนตามนี้:
- งาน: ...
- ใคร / เริ่มเมื่อ: Cursor | Claude, YYYY-MM-DD HH:MM
- ขั้นตอน: [x] ทำแล้ว  [ ] ยังไม่ทำ
- ไฟล์ที่ยังแก้ไม่เสร็จ: ...
-->

## SQL ที่รอผู้ใช้รัน

- ไม่มี ขั้น 2–4 รันใน MX แล้ว

## ข้อควรระวัง

- ห้ามสร้างตาราง department master กลับมา ผู้ใช้ตัดทิ้งเองโดยตั้งใจ ชื่อหน่วยงานเก็บไว้ที่ `mt_main_costcenter.department`
- หน้า PD1–PD4, MTN, DIE MTN, JIG MTN, PD MTN และหน้ากิจกรรมทั้งหมดยังเป็นหน้าว่าง (มาจาก `units.js`) ยังไม่มีโมดูลจริง

## บันทึก (อันใหม่อยู่บนสุด)

- 2026-10-24 · Cursor · สร้างตาราง tx_* ใน MX, คัดลอกใบเบิก cart 1 ใบ, ติดตั้งทริกเกอร์และ `tx_sto_receive` แล้ว แอปสดยังยิงฐาน TX อยู่ จนกว่าจะสลับค่า Render ในช่วงที่ไม่มีคนใช้
- 2026-10-24 · Claude · เตรียมรวมฐาน TX เข้า MX: receive เรียก RPC `tx_sto_receive` ถ้ามี ถ้าไม่มีใช้วิธีเดิม เพิ่ม db/ (inspect, receive RPC, คู่มือ) และ `npm run migrate:tx` ยังไม่ได้แตะฐานข้อมูล
- 2026-10-24 · Claude · แยก `server.js` เป็น `server/core` + `server/modules/{sto,system}` และแยก `public/app.js` เป็น `public/js/*` พฤติกรรมเหมือนเดิม (route และสิทธิ์ทั้ง 30 รายการตรงกับของเดิม) ระบบสิทธิ์รองรับหลายโมดูลแล้ว (`req.user.roles`) เพิ่ม `npm run check`, AGENTS.md, CLAUDE.md, .cursor/rules ไม่ได้แตะฐานข้อมูล
