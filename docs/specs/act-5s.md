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

## ข้อมูลเดิมจากระบบ TSAT4-5S (Apps Script + Google Sheets)

ไฟล์ `inbox/master_5s.xlsx`, `inbox/transaction_5s.xlsx` (ไม่ commit) และโค้ดใน `C:\Work\projects\TSATP4-5S`

| sheet | แถว | เนื้อหา |
|---|---|---|
| mt_area | 34 | area_id (A01–A19 โรงงาน, B01–B15 สำนักงาน), area_type, objectname, section, employee_id (เจ้าของพื้นที่), status |
| mt_audit | 17 | ทีมปี 2026: `หัวหน้าทีม` 2 คน (audit_team = '-'), `Auditor` ทีม A–I ทีมละ ≤ 2 คน |
| mt_list | 25 | ข้อที่ 1–25, s_type 1S–5S, checklist_name, score_max 5 |
| tr_5s | 33 | ผลตรวจ COMMITTEE ทั้งหมด (ก.ย. 2026) คะแนนเป็นคอลัมน์ no01–no25, assigned/participated/receiver เป็น JSON |
| tr_issue | 52 | Issue จากข้อที่ได้ 3 รูป Before เป็น JSON (Google Drive, ≤ 2 รูป) สถานะ OPEN 51 / OVERDUE 1 |
| tr_plan | 14 | แผนตรวจรายพื้นที่: ปี, เดือน, สัปดาห์ W1–W4, ครั้งที่ 1–6, ทีม |
| tr_role | 3 | บัญชี login + password hash ของระบบเดิม **ไม่ย้าย** (SMF ใช้ login ของตัวเอง) |

กติกาที่อยู่ในโค้ดเดิม:
- ผล: `percent ≥ 80` = PASS ไม่ถึง = NEED_IMPROVE · % = คะแนนรวม / 125 × 100
- เปิด Issue เมื่อคะแนน ≤ 3 (ตั้งค่าได้) · รูปต่อ Issue ≤ 2 รูป (Before / After)
- สัปดาห์: W1 = วันที่ 1–7, W2 = 8–14, W3 = 15–21, W4 = 22–สิ้นเดือน
- audit_id = `C|S-<area>-<ddMMyy>-<seq>` เช่น C-A01-040926-01 · issue_id = ISS0001
- สถานะ Issue: OPEN → ON_PLAN (มี Action ก่อนกำหนด) / WAIT_VERIFY (Action หลังกำหนด) / OVERDUE (เลยกำหนดไม่มี Action) → CLOSED
- ตรวจรอบถัดไป: ไม่มี Action = ข้อนั้นได้ 0 และ Issue เป็น OVERDUE · มี Action และได้ ≥ 4 = ปิด Issue · ได้ ≤ 3 = ยกไปต่อ
- Dashboard: Summary (% ราย ส และรายเดือน), Ranking (ราย ส ต่อพื้นที่ แยกโรงงาน/สำนักงาน), Schedule (พื้นที่ × สัปดาห์ สีตามทีม), Team Auditor

## โมเดลข้อมูลที่เสนอ v2 (ยังไม่ได้สร้าง รอผู้ใช้ยืนยัน)

ใช้ได้ทุกกิจกรรมที่เป็น "การตรวจด้วย checklist" (5S, SAFETY Patrol ฯลฯ) คะแนนเก็บแบบแถว (ไม่ใช่ no01–no25) จึงรองรับ checklist กี่ข้อก็ได้

```
-- Setting (mt_*)
mt_act_area        id | activity | code (A01) | area_type (โรงงาน/สำนักงาน) | name | section | status      unique(activity, code)
mt_act_area_owner  year | area_id | employee_id                                                      pk(year, area_id)
mt_act_team        id | year | activity | employee_id | role (admin/chairman/auditor) | team (A–I) | status
mt_act_checklist   id | year | activity | item_no 1–25 | s_group 1–5 | title | score_max | status        unique(year, activity, item_no)
mt_act_audit_plan  id | year | activity | area_id | month | week 1–4 | round 1–6 | team               unique(year, activity, area_id, month, week)
mt_act_setting     activity | key | value      (pass_percent 80, issue_score 3, ...)
mt_act_plan        (มีแล้ว) งานทั่วไปใน Gantt / ปฏิทิน

-- transaction (tx_*)
tx_act_audit        id | audit_no | activity | year | type SELF/COMMITTEE | area_id | plan_id | team | audited_at | total | percent | result | status | created_by
tx_act_audit_score  audit_id | checklist_id | score 0–5                                             pk(audit_id, checklist_id)
tx_act_audit_person audit_id | employee_id | kind (assigned/participated/receiver)                   pk(audit_id, employee_id, kind)
tx_act_issue        id | issue_no | audit_id | area_id | checklist_id | score | description | issue_date | responsible_id | due_date
                    | action_description | action_date | status | verify_audit_id | final_score | closed_by | closed_at
tx_act_issue_photo  id | issue_id | kind BEFORE/AFTER | url | created_at
```

- สิทธิ์ transaction = อยู่ใน mt_act_team ปีนั้น หรือเป็นเจ้าของพื้นที่ใน mt_act_area_owner ปีนั้น · Setting = role admin ปีนั้น
- `หัวหน้าทีม` ของระบบเดิม = `chairman` · `Auditor` ทีม X = `auditor` + team X · สีทีมคำนวณจากตัวอักษร (ไม่เก็บ)
- ฐาน TX ย้ายมารวม MX แล้ว จึงใช้ join คำนวณ Dashboard ได้ (ทำเป็น view เช่น % ราย ส ต่อ audit)
- `mt_act_user` และ `mt_act_owner` (ยังว่าง) จะถูกแทนด้วย mt_act_team
- รูปเดิมอยู่ Google Drive เก็บ URL เดิมไว้ก่อน รูปใหม่เก็บ Supabase Storage (bucket `act-img`)
- ย้ายข้อมูลจาก Excel ได้ครบ: 34 พื้นที่, 17 ทีม, 25 ข้อ, 33 ผลตรวจ, 52 Issue, 14 แผน

## ข้อที่ข้อมูลเดิมขัดกับ spec (รอผู้ใช้ตัดสิน)

1. Committee: spec = ปีละ 4 รอบ · ระบบเดิม = ครั้งที่ 1–6 วางรายสัปดาห์ W1–W4
2. กำหนดแก้ Issue: spec = ก่อนตรวจรอบถัดไป 10 วัน · ระบบเดิม = วันตรวจ + 7 วัน (แก้ได้) ข้อมูลจริงส่วนใหญ่ตั้ง 30 พ.ย.
3. รูป Issue: spec = 16:9 1 รูป · ระบบเดิม = ≤ 2 รูป
4. ปิด Issue: ใช้กติกาเดิม (≥ 4 ปิด, ไม่มี Action ได้ 0 + OVERDUE) ตามที่ทีมยืนยันตอนตรวจรอบถัดไปหรือไม่

## ลำดับการสร้าง

1. Setting: พื้นที่, ทีม (+ สิทธิ์ใหม่), หัวข้อตรวจ, แผน Committee
2. transaction: Self Audit, Committee Audit, Issue
3. Dashboard
