# HANDOFF — อ่านก่อนเริ่ม และอัปเดตก่อน commit

## กำลังทำอยู่

- งาน: รวมฐาน TX เข้า MX + ตัดสต็อกแบบ atomic **ทำตาม `db/README.md` ทีละขั้น (ขั้น 0–9)**
- ใคร / เริ่มเมื่อ: Claude เตรียมไว้ 2026-10-24 · ผู้ใช้สั่งให้ **Cursor เป็นคนรันขั้นที่เหลือ**
- ขั้นตอน:
  - [x] โค้ดเรียก `tx_sto_receive` ถ้ามี ถ้าไม่มี (PGRST202) ใช้วิธีเดิม (deploy แล้ว)
  - [x] SQL ครบ: `01_inspect.sql`, `02_generate_mx_sql.sql` (สร้าง SQL สำหรับ MX จาก TX ให้อัตโนมัติ), `03_receive_rpc.sql`
  - [x] `npm run migrate:tx` (คัดลอกข้อมูล) และ `npm run test:db` (ทดสอบทั้งชุดบน Postgres จำลอง ผ่าน 22/22)
  - [ ] ขั้นที่ 0–9 ใน `db/README.md` (ต้องใช้ Supabase SQL Editor หรือ MCP ที่เห็นโปรเจกต์ SMF, `.env` ในเครื่อง และสิทธิ์แก้ env บน Render)
  - [ ] หลังรวมฐานแล้ว: ลบ `receiveLineByLine` ออก (ดูท้าย db/README.md)
- ไฟล์ที่ยังแก้ไม่เสร็จ: ไม่มี
<!-- ถ้าเริ่มงานใหญ่ ให้เขียนตามนี้:
- งาน: ...
- ใคร / เริ่มเมื่อ: Cursor | Claude, YYYY-MM-DD HH:MM
- ขั้นตอน: [x] ทำแล้ว  [ ] ยังไม่ทำ
- ไฟล์ที่ยังแก้ไม่เสร็จ: ...
-->

## SQL ที่รอผู้ใช้รัน

- ทั้งชุดในขั้นที่ 1–6 ของ `db/README.md` (ห้ามรันข้ามลำดับ)

## ข้อควรระวัง

- ห้ามสร้างตาราง department master กลับมา ผู้ใช้ตัดทิ้งเองโดยตั้งใจ ชื่อหน่วยงานเก็บไว้ที่ `mt_main_costcenter.department`
- หน้า PD1–PD4, MTN, DIE MTN, JIG MTN, PD MTN และหน้ากิจกรรมทั้งหมดยังเป็นหน้าว่าง (มาจาก `units.js`) ยังไม่มีโมดูลจริง

## บันทึก (อันใหม่อยู่บนสุด)

- 2026-10-24 · Claude · เพิ่ม `db/02_generate_mx_sql.sql` (สร้าง SQL สำหรับ MX จาก TX ให้อัตโนมัติ รันซ้ำได้ และไม่เขียนทับ function ที่ต่างกัน) + `npm run test:db` เขียนคู่มือใหม่ให้ Cursor รันขั้นที่ 0–9
- 2026-10-24 · Cursor · สร้างตาราง tx_* ใน MX, คัดลอกใบเบิก cart 1 ใบ, ติดตั้งทริกเกอร์และ `tx_sto_receive` แล้ว แอปสดยังยิงฐาน TX อยู่ จนกว่าจะสลับค่า Render ในช่วงที่ไม่มีคนใช้
- 2026-10-24 · Claude · เตรียมรวมฐาน TX เข้า MX: receive เรียก RPC `tx_sto_receive` ถ้ามี ถ้าไม่มีใช้วิธีเดิม เพิ่ม db/ (inspect, receive RPC, คู่มือ) และ `npm run migrate:tx` ยังไม่ได้แตะฐานข้อมูล
- 2026-10-24 · Claude · แยก `server.js` เป็น `server/core` + `server/modules/{sto,system}` และแยก `public/app.js` เป็น `public/js/*` พฤติกรรมเหมือนเดิม (route และสิทธิ์ทั้ง 30 รายการตรงกับของเดิม) ระบบสิทธิ์รองรับหลายโมดูลแล้ว (`req.user.roles`) เพิ่ม `npm run check`, AGENTS.md, CLAUDE.md, .cursor/rules ไม่ได้แตะฐานข้อมูล
