# HANDOFF — อ่านก่อนเริ่ม และอัปเดตก่อน commit

## กำลังทำอยู่

- งาน: 5S → transaction (ฟอร์มตรวจ Self / Committee + Issue) ตาม docs/specs/act-5s.md
- ใคร / เริ่มเมื่อ: Claude (โฟลเดอร์ SMF-act), 2026-10-25
- ขั้นตอน:
  - [ ] server: /api/act/:activity/audits (list, form, save, delete) + /issues (list, photo, action, edit)
  - [ ] หน้า transaction: แท็บ ตรวจประเมิน / Issue
  - [ ] SQL: bucket รูป `act-img` ใน Tx Data (db/act/storage.sql) — ให้ผู้ใช้/Cursor รัน
  - [ ] ทดสอบ + deploy
- ไฟล์ที่ยังแก้ไม่เสร็จ: (อัปเดตระหว่างทำ)
- เสร็จแล้วก่อนหน้า: แยกฐาน Mx/Tx เสร็จ ผู้ใช้สลับ env TX_* ไป Tx Data แล้ว (2026-10-25)
<!-- ถ้าเริ่มงานใหญ่ ให้เขียนตามนี้:
- งาน: ...
- ใคร / เริ่มเมื่อ: Cursor | Claude, YYYY-MM-DD HH:MM
- ขั้นตอน: [x] ทำแล้ว  [ ] ยังไม่ทำ
- ไฟล์ที่ยังแก้ไม่เสร็จ: ...
-->

## SQL ที่รอผู้ใช้รัน

- ไม่มี SQL ค้าง เหลือแค่สลับ env TX บน Render กลับไป Tx Data แล้วตรวจหน้าเว็บ (ขั้น 3–4)

## ข้อควรระวัง

- ห้ามสร้างตาราง department master กลับมา ผู้ใช้ตัดทิ้งเองโดยตั้งใจ ชื่อหน่วยงานเก็บไว้ที่ `mt_main_costcenter.department`
- หน้า PD1–PD4, MTN, DIE MTN, JIG MTN, PD MTN และหน้ากิจกรรมทั้งหมดยังเป็นหน้าว่าง (มาจาก `units.js`) ยังไม่มีโมดูลจริง

## บันทึก (อันใหม่อยู่บนสุด)

- 2026-10-25 · Claude · แยกโฟลเดอร์ทำงาน: Claude ใช้ `C:\Work\projects\SMF-act` (worktree branch claude-act → push `HEAD:main`) · Cursor ใช้ `C:\Work\projects\SMF` (main) · ทำพร้อมกันได้ ดูหัวข้อ 0 ใน AGENTS.md · Claude ดูแลระบบกิจกรรม Cursor ดูแลระบบงาน + งาน SQL
- 2026-10-25 · Cursor · ลบของเก่าตามที่ผู้ใช้สั่ง: Mx Data ไม่มี mt_act_* / tx_act_* แล้ว (พนักงาน 309 และใบเบิก 1 ใบยังอยู่) · Tx Data ไม่มี tx_sto_* แล้ว (พื้นที่ 34 ใบตรวจ 33 Issue 52 ยังอยู่)
- 2026-10-25 · Cursor · โค้ดแยกฐาน `59c8856` อยู่บนเว็บแล้ว และสร้างตาราง `mt_5s_*` / `tx_5s_*` ใน Tx Data พร้อมข้อมูลเดิม ตัวเลขหมวดตรง 85.2/82.5/87.0/88.7/89.8 ยังไม่สลับ env TX กลับ และยังไม่ลบตารางกิจกรรมเก่าใน Mx Data
- 2026-10-25 · Claude · แยกฐาน: Store ใช้ client mx ทั้งหมด (tx_sto_* อยู่ Mx Data) · กิจกรรมใช้ client tx = Tx Data ตารางต่อกิจกรรม mt_5s_* / tx_5s_* จากแม่แบบ scripts/act-sql.js (db/act/5s.sql) · importer/test ใช้ชื่อใหม่ (ผล Dashboard ยังตรงระบบเดิม) · แก้หน้า Gantt ให้แสดงชื่อ admin ของปี · db/04, db/05 เลิกใช้ ล้างด้วย db/07
- 2026-10-25 · Claude · 5S Dashboard (Summary / Ranking / Schedule / Team Auditor) + Setting (แผนงาน Gantt / พื้นที่ / ทีม / หัวข้อตรวจ / แผนตรวจ) สิทธิ์กิจกรรมย้ายไปใช้ mt_act_team รายปี (act ไม่มี memberTable แล้ว) ตัวเลข Dashboard ตรงกับระบบเดิม (`npm run test:act`) แยกไฟล์ import เป็น `inbox/import_5s/01–10` ยังไม่ได้ทำ transaction (ฟอร์มตรวจ + Issue)
- 2026-10-25 · Cursor · รัน `db/05_act_audit.sql` ใน MX แล้ว และใส่ข้อมูลตั้งต้น 5S: พื้นที่ 34 ทีม 19 หัวข้อ 25 แผน 14 ใบตรวจ 33 ยังไม่ใส่คะแนนรายข้อ Issue และรูป หน้าจอตรวจยังไม่ได้ทำ
- 2026-10-25 · Claude · ออกแบบตารางระบบตรวจ 5S จาก Excel + โค้ด TSAT4-5S เดิม (`db/05_act_audit.sql`) + สคริปต์ย้ายข้อมูล `scripts/import_5s_excel.py` + `npm run test:act` (ตัวเลขตรงกับ Dashboard เดิม) ยังไม่ได้ทำหน้าจอและยังไม่ได้รัน SQL ในฐาน
- 2026-10-25 · Claude · แผนประจำปีแบบ Gantt ที่ 5S > Setting (สัปดาห์ / เดือน / ปี, เส้นวันนี้, แถว Self Audit อัตโนมัติ) + ปฏิทินที่ ระบบตั้งค่า > ปฏิทิน แสดงทุกกิจกรรม (`/api/act/calendar`) (Cursor commit ac23b85 ระหว่างที่ Claude แก้ act.js อยู่ จึงติดส่วนปฏิทินรวมของ Claude ไปด้วย ส่วนที่เหลืออยู่ใน 88458cd) **ห้ามให้ Cursor กับ Claude ทำงานพร้อมกันในโฟลเดอร์เดียว**
- 2026-10-25 · Cursor · ย้ายปฏิทินออกจาก 5S > Setting ไปไว้ที่กลุ่มเมนู ระบบตั้งค่า > ปฏิทิน ข้อมูลแผนยังเป็นของกิจกรรม 5S
- 2026-10-25 · Cursor · โค้ดล่าสุด `689f7a8` อยู่บนเว็บแล้ว และสร้างตาราง `mt_act_user`, `mt_act_owner`, `mt_act_plan` ใน MX ผู้ใช้สลับ env TX ไปฐานหลักเองแล้ว
- 2026-10-25 · Claude · หน้า System > Setting: ถ้าอ่านตารางไม่ได้จะล้างแถวเดิมและบอกว่าตารางไหนยังไม่มี (PGRST205)
- 2026-10-25 · Claude · เพิ่ม Schedule Plan ของระบบกิจกรรม (เริ่มที่ 5S > Setting มีมุมมองสัปดาห์ / เดือน / ปี) โมดูล `act` + `db/04_act_plan.sql` ผู้ดูแลเปลี่ยนรายปีผ่าน mt_act_owner ถ้ายังไม่ได้รัน SQL หน้าแผนจะแจ้งเตือน ส่วน login ยังทำงานปกติ (loadUser ข้ามตารางสมาชิกที่ยังไม่มี)
- 2026-10-24 · Cursor · ทำขั้น 0–6 แล้ว คง rls_auto_enable ของ MX ตามที่ผู้ใช้เลือก ฟังก์ชันใบเบิกตรงกับ TX ทริกเกอร์ 8 ตัวและ tx_sto_receive พร้อม ข้อมูลใบเบิก checksum ตรงกัน ยังไม่สลับ env
- 2026-10-24 · Claude · เพิ่ม `db/02_generate_mx_sql.sql` (สร้าง SQL สำหรับ MX จาก TX ให้อัตโนมัติ รันซ้ำได้ และไม่เขียนทับ function ที่ต่างกัน) + `npm run test:db` เขียนคู่มือใหม่ให้ Cursor รันขั้นที่ 0–9
- 2026-10-24 · Cursor · สร้างตาราง tx_* ใน MX, คัดลอกใบเบิก cart 1 ใบ, ติดตั้งทริกเกอร์และ `tx_sto_receive` แล้ว แอปสดยังยิงฐาน TX อยู่ จนกว่าจะสลับค่า Render ในช่วงที่ไม่มีคนใช้
- 2026-10-24 · Claude · เตรียมรวมฐาน TX เข้า MX: receive เรียก RPC `tx_sto_receive` ถ้ามี ถ้าไม่มีใช้วิธีเดิม เพิ่ม db/ (inspect, receive RPC, คู่มือ) และ `npm run migrate:tx` ยังไม่ได้แตะฐานข้อมูล
- 2026-10-24 · Claude · แยก `server.js` เป็น `server/core` + `server/modules/{sto,system}` และแยก `public/app.js` เป็น `public/js/*` พฤติกรรมเหมือนเดิม (route และสิทธิ์ทั้ง 30 รายการตรงกับของเดิม) ระบบสิทธิ์รองรับหลายโมดูลแล้ว (`req.user.roles`) เพิ่ม `npm run check`, AGENTS.md, CLAUDE.md, .cursor/rules ไม่ได้แตะฐานข้อมูล
