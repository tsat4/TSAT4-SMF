# รวมฐาน TX เข้า MX และตัดสต็อกแบบ atomic

**เป้าหมาย:** ย้ายตาราง `tx_*` ทั้งหมดจากโปรเจกต์ TX (`loeyrgavlpdnrbczjxpl`) ไปไว้ใน MX (`ezhyitqznflvjnwuuchn`)
เพื่อให้ใบเบิกกับสต็อกอยู่ฐานเดียวกัน แล้วการรับของจะตัดสต็อกได้ใน transaction เดียว (`tx_sto_receive`)

**ไม่ต้องแก้โค้ด และไม่ต้อง push** server ใช้ client `tx` ตาม env `TX_*` ถ้าเปลี่ยน env ให้ชี้ไป MX ก็ใช้ฐานเดียวกันทันที
ส่วน `tx_sto_receive` server จะใช้เองเมื่อฟังก์ชันนี้มีอยู่ ถ้ายังไม่มีก็ใช้วิธีเดิม (deploy ไปแล้วตั้งแต่ commit `2ec0a62`)

SQL ทุกไฟล์ทดสอบแล้วด้วย `npm run test:db` (Postgres จำลอง 2 ก้อน) ถ้าแก้ไฟล์ SQL ในโฟลเดอร์นี้ ต้องรันเทสต์นี้ใหม่ให้ผ่าน

## ขั้นตอน (ทำตามลำดับ ห้ามข้าม)

"SQL Editor" หมายถึง Supabase Dashboard → โปรเจกต์นั้น → SQL Editor ถ้า AI มี Supabase MCP ที่เห็นโปรเจกต์นั้นก็รันแทนได้

| # | ที่ไหน | ทำอะไร | ผ่านเมื่อ |
|---|---|---|---|
| 0 | เครื่อง | `git pull` แล้วตามด้วย `npm install` และ `npm run test:db` | ขึ้นว่า `all passed` |
| 1 | SQL Editor ของ **TX** | รัน `01_inspect.sql` แล้ว save ผลเป็นไฟล์ `db/backup_tx_schema.sql` ไว้เป็นสำรอง (ไฟล์นี้อยู่ใน .gitignore) | ได้ไฟล์สำรอง |
| 2 | SQL Editor ของ **TX** | รัน `02_generate_mx_sql.sql` ได้ 2 แถว copy ช่อง `sql` ของแถว `A_before_copy` ไป save เป็น `db/02a_mx_before_copy.sql` และแถว `B_after_copy` เป็น `db/02b_mx_after_copy.sql` | ได้ 2 ไฟล์ |
| 3 | SQL Editor ของ **MX** | รัน `02a_mx_before_copy.sql` | ไม่มี error (ถ้าขึ้น `MX already has a different ...` ให้**หยุด** ดูหัวข้อ "ถ้าเจอปัญหา") |
| 4 | เครื่อง | สร้าง `.env` (copy ค่าจาก Render → Environment ให้ครบทั้ง `MX_*` และ `TX_*`) แล้วรัน `npm run migrate:tx -- --dry` | เห็นรายชื่อตาราง `tx_*` ทุกตาราง ฝั่ง MX เป็น 0 แถว |
| 5 | เครื่อง | `npm run migrate:tx` | ทุกบรรทัดขึ้นว่า `ok` และจำนวน TX ตรงกับ MX |
| 6 | SQL Editor ของ **MX** | รัน `02b_mx_after_copy.sql` ตามด้วย `03_receive_rpc.sql` | ไม่มี error |
| 7 | **ช่วงที่ไม่มีคนใช้งาน** | รัน `npm run migrate:tx` อีกครั้ง เพื่อดึงใบเบิกที่เพิ่งสร้างระหว่างนี้ จากนั้นไปที่ Render → Environment เปลี่ยน `TX_SUPABASE_URL` เป็นค่าเดียวกับ `MX_SUPABASE_URL` และ `TX_SUPABASE_SECRET_KEY` เป็นค่าเดียวกับ `MX_SUPABASE_SECRET_KEY` แล้วกด Save (Render จะ restart เอง) | ประมาณ 1–2 นาทีต่อมา `https://tsat4-smf.onrender.com/api/health` ตอบ `{"ok":true,"database":true}` |
| 8 | เว็บ | ทดสอบ: login → เบิก → admin จัดเตรียม → จ่าย → ผู้เบิกกดรับ แล้วดูว่า Current ลดลง ลองเบิกเกินยอดคงเหลือ ต้องขึ้นว่า "ยอดคงเหลือไม่พอ" และยอดต้องไม่เปลี่ยน | ผ่านทั้งสองกรณี |
| 9 | repo | อัปเดต `docs/HANDOFF.md` (ย้ายงานนี้ไปไว้ในบันทึก) แล้ว commit ไฟล์ `02a` และ `02b` (ไม่มี secret) | — |

ขั้นที่ 1–6 **ไม่กระทบระบบ live** เพราะระบบยังใช้ TX อยู่ ระบบเปลี่ยนจริงตอนขั้นที่ 7 เท่านั้น

## ถ้าเจอปัญหา

- **ขั้นที่ 3 ขึ้น `MX already has a different function/type X`:** MX มีของชื่อเดียวกันอยู่แล้วแต่เนื้อหาต่างกัน ระบบจึงหยุดเพื่อไม่ให้เขียนทับ ให้เทียบสองเวอร์ชัน (ของ TX อยู่ใน `02a`, ของ MX ดูได้ด้วย `01_inspect.sql` ใน MX) แล้วถามผู้ใช้ว่าจะใช้เวอร์ชันไหน ห้ามลบของใน MX เอง
- **ขั้นที่ 5 มีบรรทัด `FAIL` หรือ error:** รันซ้ำได้ เพราะสคริปต์ใช้ upsert ตาม primary key ถ้ายังไม่ผ่าน ให้ส่งข้อความ error ให้ AI
- **หลังขั้นที่ 7 ระบบมีปัญหา:** คืนค่า `TX_SUPABASE_URL` และ `TX_SUPABASE_SECRET_KEY` บน Render เป็นค่าเดิม ระบบจะกลับไปใช้ TX ทันที (ใบเบิกที่สร้างหลังขั้นที่ 7 จะอยู่ใน MX เท่านั้น ต้องคัดลอกกลับเองถ้าต้องการ)
- **ห้ามลบโปรเจกต์ TX** จนกว่าจะใช้งานฐานรวมได้ราบรื่นอย่างน้อย 2 สัปดาห์

## หลังรวมฐานสำเร็จ (งานของ AI รอบถัดไป)

- ลบ `receiveLineByLine` และ `adjustStock` ออกจาก `server/modules/sto/requisitions.js` ให้เหลือแค่การเรียก RPC
- แก้ `docs/ARCHITECTURE.md` (ตอนนี้ mx กับ tx เป็นฐานเดียวกันแล้ว)
