# db/ — SQL ที่รันใน Supabase เอง

AI ไม่มีสิทธิ์เข้าฐานข้อมูล ผู้ใช้หรือ Cursor รันไฟล์ใน SQL Editor ของโปรเจกต์ที่ระบุ

| ไฟล์ | ฐาน | ใช้ทำอะไร |
|---|---|---|
| `03_receive_rpc.sql` | **Mx Data** | ฟังก์ชัน `tx_sto_receive` (รับของ + ตัดสต็อกใน transaction เดียว) และ `tx_sto_apply_costcenter` ที่ server เรียก รันซ้ำได้ |
| `02_generate_mx_sql.sql` | — | ตัวสร้าง SQL ตอนย้าย tx_sto_* เข้า Mx Data (ย้ายเสร็จแล้ว 2026-10-25) เก็บไว้เพราะ `npm run test:db` ใช้สร้างฐานจำลองเพื่อทดสอบ `03_receive_rpc.sql` |
| `06_main_user_access.sql` | **Mx Data** | เพิ่ม `executive` (ผู้บริหาร) และ `admin_of` (ผู้ดูแลบางระบบ) ใน `mt_main_user` รันซ้ำได้ |
| `act/<กิจกรรม>.sql` | **Tx Data** | ตารางของแต่ละกิจกรรม สร้างจาก `scripts/act-sql.js` เท่านั้น ห้ามแก้มือ (ดู AGENTS.md) |
| `act/5s_task.sql` | **Tx Data** | เพิ่ม Project Planner ให้ 5S ที่ใช้งานอยู่ และคัดลอกแผน Gantt เดิมครั้งเดียว |

แก้ `03_receive_rpc.sql` แล้วต้องรัน `npm run test:db` ให้ผ่าน · แก้แม่แบบกิจกรรมแล้วรัน `npm run test:act`
