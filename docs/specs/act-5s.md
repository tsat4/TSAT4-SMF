# Spec: ระบบกิจกรรม 5S (แม่แบบให้กิจกรรมอื่น)

สถานะ: ตกลงกับผู้ใช้แล้ว 2026-10-25 · ทำครบ 3 ส่วนแล้ว (Dashboard / Setting / transaction) · ตารางอยู่ใน **Tx Data** ชื่อ `mt_5s_*` / `tx_5s_*` (`db/act/5s.sql` สร้างจาก scripts/act-sql.js)
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
   - **Committee Audit:** ครั้งที่ 1–6 ต่อปี (ใช้เท่าที่ต้องการ เช่น 4 ครั้ง) วางแผนเป็น พื้นที่ × เดือน × สัปดาห์ W1–W4 พร้อมทีม (A–I) ประธานจัดให้ครบทุกพื้นที่ (กรรมการตรวจพื้นที่ที่ตัวเองรับผิดชอบได้)
   - ดูได้แบบรายเดือนและรายปี (ปฏิทินใน public/js/act.js)

## transaction

- **Self Audit:** ผู้รับผิดชอบพื้นที่ให้คะแนน 25 ข้อของพื้นที่ตัวเอง ได้ ≤ 3 คะแนน **ไม่ต้อง**เปิด Issue
- **Committee Audit:** กรรมการให้คะแนน 25 ข้อตามพื้นที่ที่ได้รับมอบหมาย ข้อที่ได้ **≤ 3 ต้องเปิด Issue** แนบรูปปัญหา **16:9 1 รูป** + รายละเอียด
- **ผลตรวจ:** คะแนนรวม (เต็ม 125) และ % = รวม / 125 × 100
- **Issue:** ผู้รับผิดชอบพื้นที่เป็นคนแก้ ต้องแก้ให้เสร็จ **ก่อนการตรวจ Committee รอบถัดไป 10 วัน** (กำหนดส่ง = วันแรกของสัปดาห์ที่วางแผนตรวจพื้นที่นั้นครั้งถัดไป − 10 วัน ถ้ายังไม่มีแผนครั้งถัดไป due_date = null แสดงว่า "รอกำหนด") admin แก้วันได้
  - สถานะ (ตามระบบเดิม): `OPEN` → ผู้รับผิดชอบแนบ Action + รูปหลังแก้ → `ON_PLAN` (ก่อนกำหนด) / `WAIT_VERIFY` (หลังกำหนด) · เลยกำหนดไม่มี Action → `OVERDUE`
  - ตอน Committee Audit รอบถัดไป **ทีมที่ตรวจพื้นที่นั้น** ยืนยัน Issue เดิม: ไม่มี Action = ข้อนั้นได้ 0 + `OVERDUE` · มี Action และให้ ≥ 4 = `CLOSED` · ให้ ≤ 3 = ยกไปรอบถัดไป (เก็บเลขใบตรวจที่ยืนยันใน verify_audit_no และคะแนนใน final_score)
  - รูปปัญหาใหม่ 16:9 1 รูป (ข้อมูลเดิมมีได้ 2 รูป ตารางรองรับ)
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
- Dashboard: Summary (% ราย ส และรายเดือน), Ranking (ราย ส ต่อพื้นที่ แยกโรงงาน/สำนักงาน), Schedule (Project Planner ดูอย่างเดียว), Audit Plan (พื้นที่ × สัปดาห์ สีตามทีม), Team Auditor
- Setting: แผนงาน (Project Planner admin แก้ docs/specs/act-planner.md), พื้นที่, ทีม, หัวข้อตรวจ, แผนตรวจ

## โมเดลข้อมูลที่เสนอ v2 (ยังไม่ได้สร้าง รอผู้ใช้ยืนยัน)

ใช้ได้ทุกกิจกรรมที่เป็น "การตรวจด้วย checklist" (5S, SAFETY Patrol ฯลฯ) คะแนนเก็บแบบแถว (ไม่ใช่ no01–no25) จึงรองรับ checklist กี่ข้อก็ได้

```
-- Tx Data · <k> = กิจกรรม (5s, safety, ...) · v2 (2026-10-25): 9 ตาราง + 1 view
mt_<k>_area        id | code (A01) unique | area_type (โรงงาน/สำนักงาน) | name | section | status
mt_<k>_team        id | year | employee_id | role (admin/chairman/auditor/owner) | team (A–I, เฉพาะ auditor) | area_id (เฉพาะ owner) | status
                   unique (year, area_id) where role = owner  → เจ้าของพื้นที่ปีละ 1 คนต่อพื้นที่
mt_<k>_checklist   id | year | item_no | s_group | title | score_max | status              unique(year, item_no)
mt_<k>_audit_plan  id | year | area_id | month | week 1–4 | round 1–6 | team              unique(year, area_id, month, week)
mt_<k>_setting     key | value      (pass_percent 80, issue_score 3, ...)
mt_<k>_task        Project Planner (แผนงาน / Schedule / ปฏิทินรวม)
tx_<k>_audit        id | audit_no | year | audit_type SELF/COMMITTEE | area_id | plan_id | team | auditors[] | receivers[] | audited_at | total | percent | result | status | created_by
tx_<k>_audit_score  audit_id | checklist_id | score 0–5                                     pk(audit_id, checklist_id)
tx_<k>_issue        id | issue_no | audit_id | area_id | checklist_id | score | description | photo_before[] | photo_after[] | issue_date | responsible_id
                    | due_date | action_description | action_date | status | verify_audit_no | final_score | closed_by | closed_at
v_<k>_audit_group   % ของแต่ละหมวดต่อใบตรวจ
```
- v2 ยุบ mt_<k>_area_owner → team (owner), tx_<k>_audit_person → audit.auditors/receivers, tx_<k>_issue_photo → issue.photo_before/photo_after (ย้ายฐานจริงแล้ว 2026-10-25)

- สิทธิ์ transaction = อยู่ใน mt_<k>_team ปีนั้น (chairman / auditor / owner) · Setting = role admin ปีนั้น
- `หัวหน้าทีม` ของระบบเดิม = `chairman` · `Auditor` ทีม X = `auditor` + team X · สีทีมคำนวณจากตัวอักษร (ไม่เก็บ)
- ฐาน TX ย้ายมารวม MX แล้ว จึงใช้ join คำนวณ Dashboard ได้ (ทำเป็น view เช่น % ราย ส ต่อ audit)
- รูปเดิมอยู่ Google Drive เก็บ URL เดิมไว้ก่อน รูปใหม่เก็บ Supabase Storage ของ Tx Data bucket `img_5s` (กิจกรรมอื่น `img_<กิจกรรม>`) ไฟล์ `issue/<ISSxxxx>_<BEFORE|AFTER>_<เวลา>.jpg`
- ย้ายข้อมูลจาก Excel ได้ครบ: 34 พื้นที่, 17 ทีม, 25 ข้อ, 33 ผลตรวจ, 52 Issue, 14 แผน

## การตัดสินใจ (ผู้ใช้เลือกตามคำแนะนำ 2026-10-25)

1. Committee = ครั้งที่ 1–6 + แผนรายสัปดาห์ W1–W4 (ตามระบบเดิม)
2. กำหนดแก้ Issue = ก่อนตรวจรอบถัดไป 10 วัน admin แก้ได้
3. รูป Issue ใหม่ = 16:9 1 รูป
4. ปิด Issue = กติกาเดิม (ไม่มี Action = 0 + OVERDUE, ≥ 4 = ปิด)

## สูตร Dashboard (ตรวจกับตัวเลขระบบเดิมแล้ว: `npm run test:act`)

- % ของ ส ในใบตรวจ = ผลรวมคะแนน 5 ข้อของ ส นั้น / คะแนนเต็ม × 100 (view `v_act_audit_group`)
- Summary ราย ส ทั้งปี = ค่าเฉลี่ยของ % ส นั้นจากทุกใบตรวจ · 5S % รายเดือน = ค่าเฉลี่ย percent_score ของใบตรวจในเดือนนั้น
- Ranking = ค่าเฉลี่ย % ราย ส ต่อพื้นที่ในช่วงเดือนที่เลือก แยกโรงงาน/สำนักงาน เรียงตามค่าเฉลี่ยรวม
- ผลสอบเทียบ: ASSY PD4 = 100/92/100/100/92 · Summary ส1–ส5 = 85.2/82.5/87.0/88.7/89.8 · ก.ย. = 86.67% จาก 33 ใบ

## ย้ายข้อมูลจากระบบเดิม

1. `python -I scripts/import_5s_excel.py` → สร้าง `inbox/import_5s.sql` (inbox ไม่ขึ้น GitHub)
2. รัน `db/act/5s.sql` แล้วตามด้วย `inbox/import_5s.sql` (หรือไฟล์ย่อย `inbox/import_5s/01–10` ตามลำดับ) ใน **Tx Data** (รันซ้ำได้) ท้ายไฟล์มี query นับจำนวนให้เทียบ: พื้นที่ 34, ทีม 19, หัวข้อ 25, แผน 14, ผลตรวจ 33, Issue 52

## ลำดับการสร้าง

1. Setting: พื้นที่, ทีม (+ สิทธิ์ใหม่), หัวข้อตรวจ, แผน Committee
2. transaction: Self Audit, Committee Audit, Issue
3. Dashboard
