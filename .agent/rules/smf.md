---
trigger: always_on
description: SMF project rules shared with Claude Code and Cursor. Read before any change.
---

กฎของโปรเจกต์นี้อยู่ใน `AGENTS.md` และสถานะงานล่าสุดอยู่ใน `docs/HANDOFF.md` อ่านทั้งสองไฟล์ก่อนแก้โค้ดทุกครั้ง

Antigravity ทำงานที่ `C:\Work\projects\SMF` (branch main) เท่านั้น เหมือน Cursor (ใช้ทีละตัว) ส่วน `C:\Work\projects\SMF-act` เป็นของ Claude Code ห้ามเปิด แก้ หรือ commit ไฟล์ในนั้น (ดูหัวข้อ 0 ใน AGENTS.md)

สรุปข้อที่ห้ามพลาด:
1. เริ่มงาน: `git status` ถ้ามีงานค้างที่ไม่ใช่ของคุณ ห้าม reset, checkout หรือ stash ให้ทำต่อตาม HANDOFF ถ้าไม่มีงานค้าง ให้รัน `git pull --rebase`
2. ก่อนงานใหญ่ ให้เขียนแผนลงหัวข้อ "กำลังทำอยู่" ใน docs/HANDOFF.md ระบุชื่อตัวเองว่า Antigravity (ไม่ใช่ Claude หรือ Cursor)
3. หน่วยงานใหม่ = โมดูลใหม่ (`server/modules/<id>/` + `public/js/<id>.js`) ตามที่ docs/ARCHITECTURE.md กำหนด · ตารางกิจกรรมสร้างจาก `scripts/act-sql.js` เท่านั้น
4. ก่อน commit: `npm run check` ต้องผ่าน และต้องอัปเดตบันทึกใน docs/HANDOFF.md (เขียน "Antigravity" เป็นผู้ทำ)
5. push ไปที่ main = deploy ขึ้น Render ทันที ห้าม push ถ้า check ไม่ผ่าน
6. อย่าเขียนไฟล์ที่เปิดค้างใน editor ทับเวอร์ชันที่ commit ไปแล้ว: หลัง commit ให้ `git status` ต้องสะอาด
