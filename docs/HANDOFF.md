# HANDOFF — อ่านก่อนเริ่ม และอัปเดตก่อน commit

## กำลังทำอยู่

- งาน: รวมฐาน TX เข้า MX + ตัดสต็อกแบบ atomic (คู่มือเต็มอยู่ที่ `db/README.md`)
- ใคร / เริ่มเมื่อ: Claude, 2026-10-24
- ขั้นตอน:
  - [x] โค้ดเรียก `tx_sto_receive` ถ้ามี ถ้าไม่มี (PGRST202) ใช้วิธีเดิม (deploy แล้ว ปลอดภัยทั้งก่อนและหลังรวมฐาน)
  - [x] `db/01_inspect.sql`, `db/03_receive_rpc.sql`, `scripts/migrate-tx-to-mx.js` (`npm run migrate:tx`)
  - [ ] ขั้น 1: **รอผู้ใช้** รัน `db/01_inspect.sql` ใน TX และ MX แล้วส่งผลมา
  - [ ] ขั้น 2: AI เขียน `db/02_create_tx_in_mx.sql` จากผล inspect (ดูหมายเหตุท้าย db/README.md)
  - [ ] ขั้น 3–6: ผู้ใช้รันตาม db/README.md
  - [ ] หลังรวมฐานและใช้งานได้ราบรื่น: ลบ `receiveLineByLine` ออกจาก requisitions.js และอัปเดต ARCHITECTURE
- ไฟล์ที่ยังแก้ไม่เสร็จ: ไม่มี (ทุกอย่าง commit แล้ว)
<!-- ถ้าเริ่มงานใหญ่ ให้เขียนตามนี้:
- งาน: ...
- ใคร / เริ่มเมื่อ: Cursor | Claude, YYYY-MM-DD HH:MM
- ขั้นตอน: [x] ทำแล้ว  [ ] ยังไม่ทำ
- ไฟล์ที่ยังแก้ไม่เสร็จ: ...
-->

## SQL ที่รอผู้ใช้รัน

- `db/01_inspect.sql`: รันใน SQL Editor ของ TX และ MX (อ่านอย่างเดียว) แล้วส่งผลให้ AI

## ข้อควรระวัง

- ห้ามสร้างตาราง department master กลับมา ผู้ใช้ตัดทิ้งเองโดยตั้งใจ ชื่อหน่วยงานเก็บไว้ที่ `mt_main_costcenter.department`
- หน้า PD1–PD4, MTN, DIE MTN, JIG MTN, PD MTN และหน้ากิจกรรมทั้งหมดยังเป็นหน้าว่าง (มาจาก `units.js`) ยังไม่มีโมดูลจริง

## บันทึก (อันใหม่อยู่บนสุด)

- 2026-10-24 · Claude · เตรียมรวมฐาน TX เข้า MX: receive เรียก RPC `tx_sto_receive` ถ้ามี ถ้าไม่มีใช้วิธีเดิม เพิ่ม db/ (inspect, receive RPC, คู่มือ) และ `npm run migrate:tx` ยังไม่ได้แตะฐานข้อมูล
- 2026-10-24 · Claude · แยก `server.js` เป็น `server/core` + `server/modules/{sto,system}` และแยก `public/app.js` เป็น `public/js/*` พฤติกรรมเหมือนเดิม (route และสิทธิ์ทั้ง 30 รายการตรงกับของเดิม) ระบบสิทธิ์รองรับหลายโมดูลแล้ว (`req.user.roles`) เพิ่ม `npm run check`, AGENTS.md, CLAUDE.md, .cursor/rules ไม่ได้แตะฐานข้อมูล
