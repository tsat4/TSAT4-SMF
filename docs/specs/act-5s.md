# Spec: ระบบกิจกรรม 5S (แม่แบบให้กิจกรรมอื่น)

สถานะ: ตกลงกับผู้ใช้แล้ว 2026-10-25 · ยังไม่ได้สร้าง เริ่มจากส่วนที่ 1 (Setting)
กิจกรรมอื่น (SAFETY, QCC ฯลฯ) ใช้โครงเดียวกัน แยกข้อมูลด้วยคอลัมน์ `activity`

## หน้าและสิทธิ์

| หน้า | ใครเข้าได้ |
|---|---|
| Dashboard | ทุกคนที่ login |
| transaction | คนที่อยู่ในทีมของกิจกรรมนั้น **ปีนั้น** |
| Setting | admin ของกิจกรรมนั้นปีนั้น + ผู้สร้างระบบ |

- แต่ละกิจกรรมเป็นอิสระต่อกัน ผู้สร้างระบบแต่งตั้ง admin ของแต่ละกิจกรรมในแต่ละปี admin มาจากหน่วยงานไหนก็ได้ (เช่น SAFETY ให้หน่วยงานอื่นดูแล) แล้ว admin เป็นคนจัดการ Setting ของกิจกรรมนั้นเอง
- admin ที่ได้รับแต่งตั้งเพิ่ม admin คนอื่นในกิจกรรม/ปีเดียวกันได้
- บทบาทในทีม: `admin`, `chairman` (ประธาน, แต่งตั้งแยกจาก admin ได้หลายคน), `committee` (กรรมการ), `area_owner` (ผู้รับผิดชอบพื้นที่) คนเดียวมีได้หลายบทบาท

## Setting

1. **พื้นที่:** จุดปฏิบัติงานในโรงงาน เพิ่ม/แก้/ลบได้ ไม่ผูกกับ costcenter แยกตามกิจกรรม
   แต่ละพื้นที่มีผู้รับผิดชอบปีละ **1 คน** และ 1 คนดูแลได้หลายพื้นที่
2. **ทีม:** เลือกพนักงานจาก `mt_main_employee` แล้วกำหนดบทบาท แยกตามปี มีปุ่มคัดลอกจากปีที่แล้ว
3. **หัวข้อตรวจ:** 25 ข้อ = 5ส × 5 ข้อ คะแนนข้อละ 1–5 (ไม่ต้องมีคำอธิบายแต่ละระดับ) แยกชุดตามปี มีปุ่มคัดลอกจากปีที่แล้ว
4. **แผนประจำปี (ปีปฏิทิน ม.ค.–ธ.ค.)**
   - **Self Audit:** ไม่ต้องวางแผน ระบบถือว่าทุกพื้นที่ต้องทำเดือนละ 1 ครั้ง **ภายในวันที่ 10** ทำหลังจากนั้นถือว่า **หลุดแผน**
   - **Committee Audit:** ปีละ 4 รอบ (ทุก 3 เดือน) ประธานกำหนดวันตรวจของแต่ละรอบ และจัดว่ากรรมการคนไหนตรวจพื้นที่ไหน จนครบทุกพื้นที่ (กรรมการตรวจพื้นที่ที่ตัวเองรับผิดชอบได้)
   - ดูได้แบบรายเดือนและรายปี (ปฏิทินใน public/js/act.js)

## transaction

- **Self Audit:** ผู้รับผิดชอบพื้นที่ให้คะแนน 25 ข้อของพื้นที่ตัวเอง ได้ ≤ 3 คะแนน **ไม่ต้อง**เปิด Issue
- **Committee Audit:** กรรมการให้คะแนน 25 ข้อตามพื้นที่ที่ได้รับมอบหมาย ข้อที่ได้ **≤ 3 ต้องเปิด Issue** แนบรูปปัญหา **16:9 1 รูป** + รายละเอียด
- **ผลตรวจ:** คะแนนรวม (เต็ม 125) และ % = รวม / 125 × 100
- **Issue:** ผู้รับผิดชอบพื้นที่เป็นคนแก้ ต้องแก้ให้เสร็จ **ก่อนการตรวจ Committee รอบถัดไป 10 วัน** (กำหนดส่ง = วันตรวจรอบถัดไป − 10 วัน ถ้ายังไม่ได้กำหนดวันรอบถัดไป ให้แสดงว่า "รอกำหนด")
  - สถานะ: `open` → `fixed` (ผู้รับผิดชอบพื้นที่แนบรูปหลังแก้ 1 รูป + รายละเอียด) → ตอน Committee Audit รอบถัดไป **ทีมที่ตรวจพื้นที่นั้น** ตรวจ Action ของ Issue เดิมจากผลรอบก่อน แล้วยืนยันว่า `closed` (ผ่าน) หรือยังไม่ผ่าน (กลับเป็น `open` ยกไปรอบถัดไป)
  - ฟอร์ม Committee Audit ของพื้นที่จึงต้องแสดง Issue ค้างของพื้นที่นั้นจากรอบก่อนให้ยืนยันด้วย

## Dashboard

คะแนนและ % รายพื้นที่และรายเดือน, Self Audit ตรงแผน/หลุดแผน/ยังไม่ทำ, Committee แต่ละรอบ, Issue เปิดค้าง/เลยกำหนด

## ตารางที่เสนอ (ยังไม่ได้สร้าง)

```
mt_act_area        id | activity | name | detail | status
mt_act_team        id | year | activity | employee_id | role | status        unique(year, activity, employee_id, role)
mt_act_area_owner  year | area_id | employee_id                               pk(year, area_id)
mt_act_topic       id | year | activity | s_no 1-5 | item_no 1-5 | title      unique(year, activity, s_no, item_no)
mt_act_round       id | year | activity | round_no 1-4 | audit_date | status
mt_act_round_area  round_id | area_id | auditor (employee_id)                 pk(round_id, area_id)
tx_act_audit       id | year | activity | type self/committee | area_id | month / round_id | auditor | audited_at | total | percent | on_time
tx_act_audit_score audit_id | topic_id | score 1-5
tx_act_issue       id | audit_id | topic_id | area_id | detail | photo | due_date | status | fix_detail | fix_photo | fixed_at | closed_by | closed_at
```

- รูปเก็บใน Supabase Storage (bucket ใหม่ เช่น `act-img`) ครอปเป็น 16:9 ฝั่งเบราว์เซอร์ก่อนอัปโหลด (แบบเดียวกับ squareJpeg ของ usage)
- `mt_act_user` และ `mt_act_owner` ที่สร้างไว้แล้ว (ยังว่าง) จะถูกแทนด้วย `mt_act_team` ส่วน `mt_act_plan` เก็บไว้ใช้กับกิจกรรมทั่วไปในปฏิทิน

## ลำดับการสร้าง

1. Setting: พื้นที่, ทีม (+ สิทธิ์ใหม่), หัวข้อตรวจ, แผน Committee
2. transaction: Self Audit, Committee Audit, Issue
3. Dashboard
