# โครงสร้าง TSAT4 SMF

เว็บแอปเดียว: Node 22 + Express ต่อกับ Supabase 2 ก้อน frontend เป็น vanilla JS ไม่มีขั้นตอน build

| ฐาน | client / env | เก็บอะไร |
|---|---|---|
| **Mx Data** (ezhyitqznflvjnwuuchn) | `mx` / `MX_SUPABASE_*` | ตารางกลาง `mt_main_*` (พนักงาน, costcenter, login) + ระบบงาน `mt_sto_*` / `tx_sto_*` (และ PD/MTN ในอนาคต) |
| **Tx Data** (loeyrgavlpdnrbczjxpl) | `tx` / `TX_SUPABASE_*` | ระบบกิจกรรม ตารางแยกต่อกิจกรรม `mt_5s_*` / `tx_5s_*` / `v_5s_*` และที่เก็บรูป `img_5s` (สร้างจาก scripts/act-sql.js) |

ชื่อพนักงานในหน้ากิจกรรมดึงจาก Mx Data แยกอีกครั้ง (`namesOf`) เพราะคนละฐาน
deploy บน Render (`render.yaml`): push ไปที่ `main` แล้ว deploy อัตโนมัติ URL คือ https://tsat4-smf.onrender.com

```
server.js                    จุดเริ่ม: createApp().listen() + bootstrap
server/
  app.js                     ประกอบแอป: auth → ทุกโมดูลใน MODULES → static → fallback index.html
  core/                      ของกลางที่ทุกโมดูลใช้
    db.js                    mx = Mx Data (master + ระบบงาน) / tx = Tx Data (กิจกรรม)
    http.js                  fail, wrap, qtyOf, amountOf, cleanTerm, adminWriteError
    session.js               cookie smf_session (HMAC, อายุ 7 วัน)
    access.js                CREATOR_ID, ROLE_RANK, defineModule, atLeast(mod, n), creatorOnly
    users.js                 loadUser, publicUser, requireUser (รหัสผ่านหมดอายุทุก 90 วัน)
    master.js                costcenter ของหน่วยงาน, ownCenter
    auth.js                  /api/health, login, logout, me, password, bootstrap
    tables.js                ตาราง mt_main_* ที่แก้ได้ในหน้า System
  modules/
    index.js                 MODULES = [sto, ..., system]  ← ลงทะเบียนโมดูลใหม่ที่นี่
    sto/                     ระบบงาน > Store > Usage
      index.js               defineModule({ id: 'sto', label: 'Usage', memberTable: 'mt_sto_user', ... })
      members.js             /api/employees, /api/users
      materials.js           /api/usage-materials, /api/materials
      requisitions.js        /api/summary, pay-centers, stock, requisitions (ขั้นตอนการเบิก)
      tables.js              ตาราง sto ที่แก้ได้ในหน้า System
    act/index.js             ระบบกิจกรรม: ปฏิทินรวม /api/act/calendar (อ่านจาก Planner) + รวม route ของ act
    act/common.js            tablesOf(กิจกรรม) ชื่อตาราง, actRoute (route + ตารางยังไม่มี → 503), must/throwIf, accessOf (สิทธิ์รายปีจาก mt_<act>_team), fetchAll/fetchIn (อ่านเกิน 1000 แถว), namesOf
    act/transaction.js       ระบบตรวจ checklist: บันทึกผลตรวจ Self/Committee + Issue (รูปใน Storage bucket img_<กิจกรรม> ของ Tx Data เช่น img_5s) กติกาเป็นฟังก์ชันแยก ทดสอบใน test:act
    act/planner.js           Project Planner (100P, 5S) /api/act/:activity/tasks ข้อหลัก/ข้อรอง ลากได้ (mt_<act>_task) spec docs/specs/act-planner.md
    act/audit.js             ระบบตรวจ checklist: Dashboard + Setting /api/act/:activity/... (db/act/<กิจกรรม>.sql) summarize()/rank() ทดสอบด้วย npm run test:act
    system/index.js          /api/system/tables (เฉพาะ creator) รวมตารางของทุกโมดูลให้อัตโนมัติ
public/
  index.html                 โครงหน้า + sidebar + ลำดับ <script>
  app.css
  js/core.js                 helper, popup, api(), หน้า login, router (VIEWS / TITLES / ACCESS)
  js/sto.js                  หน้า Usage: Dashboard / transaction / Setting
  js/units.js                รายชื่อหน่วยงาน PLANTS / ACTIVITIES และหน้าชั่วคราว
  js/act.js                  ระบบตั้งค่า > ปฏิทิน: แผนของทุกกิจกรรม (สัปดาห์ / เดือน / ปี) ดูอย่างเดียว + helper วันที่
  js/act-5s.js               <กิจกรรม> > Dashboard (Summary/Ranking/Schedule/Team) + Setting (แผนงาน/พื้นที่/ทีม/หัวข้อ/แผนตรวจ) เปิดใช้ตาม A5_ON
  js/act-tx.js               <กิจกรรม> > transaction: รายการใบตรวจ + ฟอร์มตรวจ + Issue (ใช้ helper ของ act-5s.js)
  js/act-planner.js          Project Planner รายปี (W1–W4) / รายเดือน (วัน) ลากแท่งได้: 100P > Setting (APL_ON), 5S > Setting > แผนงาน (แก้) และ Dashboard > Schedule (ดูอย่างเดียว)
  js/system.js               หน้าแก้ตารางของ creator
  js/boot.js                 bind event, สร้าง sidebar, โหลด session (ต้องอยู่ท้ายสุด)
db/                          SQL ที่ผู้ใช้รันเองใน Supabase + คู่มือ (README.md)
scripts/
  check.js                   npm run check (ดู AGENTS.md)
  routes.snapshot.txt        รายการ route + สิทธิ์ที่ถูกต้อง
```

## สิทธิ์

- เข้าสู่ระบบด้วย `mt_main_user` ซึ่งผูกกับ `mt_main_employee`
- แต่ละโมดูลมีตารางสมาชิกของตัวเอง เช่น `mt_sto_user` (employee_id, department, role, status)
  - ประกาศด้วย `memberTable` ใน `defineModule` แล้ว `loadUser` จะอ่านทุกตารางพร้อมกัน
  - ผลที่ได้คือ `req.user.roles = { sto: 'admin', pd1: null, ... }` (ส่งไป frontend ทาง `/api/me` และ `usageRole` ยังส่งอยู่เพื่อให้เข้ากับของเดิม)
- server: `atLeast(mod, 1|2|3)` เป็น guard ของ route ส่วน `rankIn(req.user, mod.id)` ใช้เช็กในโค้ด
- frontend: `rankOf('sto')` และ `ACCESS[view] = ['sto', n]` ถ้า rank ไม่ถึงจะเปิดเป็นหน้า `locked`
- creator (`CREATOR_ID` หรือ `mt_main_user.creator`) เป็น admin ของทุกโมดูลเสมอ และเป็นคนเดียวที่เห็นหน้า System
- ขอบเขตข้อมูล: ผู้ใช้เห็นเฉพาะ costcenter ที่ `mt_main_costcenter.department` ตรงกับ department ของตัวเอง (`ownCenter`)
  (ตาราง department master ถูกตัดทิ้งไปแล้วโดยตั้งใจ ชื่อหน่วยงานเก็บไว้ที่ costcenter)

## เพิ่มหน่วยงานหรือโมดูลใหม่ (ตัวอย่าง PD1)

1. **ฐานข้อมูล** (ผู้ใช้เป็นคนรัน): `mt_pd1_user` ใช้คอลัมน์เดียวกับ `mt_sto_user` และเพิ่มตาราง `mt_pd1_*` / `tx_pd1_*` ตามที่ต้องการ
2. `server/modules/pd1/index.js`
   ```js
   import { defineModule, atLeast } from '../../core/access.js';
   import { wrap } from '../../core/http.js';
   import { requireUser } from '../../core/users.js';
   export default defineModule({
     id: 'pd1', label: 'PD1', memberTable: 'mt_pd1_user',
     tables: { /* ตารางที่จะให้แก้ในหน้า System */ },
     mount(app, mod) {
       app.get('/api/pd1/summary', wrap(requireUser), atLeast(mod, 1), wrap(async (req, res) => { /* ... */ }));
     }
   });
   ```
3. เพิ่มโมดูลนี้ใน `server/modules/index.js` ก่อน `system`
4. `public/js/pd1.js`: เขียน render function (ใช้ prefix `pd1`) แล้วลงทะเบียน
   ```js
   Object.assign(VIEWS, { 'pd1-home': pd1RenderHome });
   Object.assign(ACCESS, { 'pd1-home': ['pd1', 1] });
   ```
   ส่วน `TITLES` และเมนูของ `pd1-*` มีให้แล้วจาก `units.js` ถ้าหน้าไหนยังไม่ได้ลงทะเบียนใน VIEWS จะแสดงเป็นหน้าว่างไปก่อน
5. ใส่ `<script src="/js/pd1.js"></script>` ใน index.html หลัง `units.js` และก่อน `boot.js`
6. รัน `npm run check -- --update` แล้วตรวจ diff ของ snapshot จากนั้นรัน `npm run check`

## ตารางและ RPC ที่ใช้อยู่

| ตาราง | db | หน้าที่ |
|---|---|---|
| mt_main_employee | mx | พนักงาน (level S1–S3, T1–T3, T6–T8) |
| mt_main_costcenter | mx | costcenter + department + group_name (Factory/Non/Center) |
| mt_main_user | mx | บัญชี login, password_hash, creator |
| mt_sto_user | mx | สมาชิก Usage และ role |
| mt_sto_usage | mx | รายการวัสดุ + รูป (storage bucket `usage-img`) |
| mt_sto_stock | mx | ยอด min/current/max ต่อ costcenter และ material |
| mt_sto_buyer | mx | costcenter ที่ซื้อได้ |
| tx_sto_requisition / _line | tx | ใบเบิกและรายการในใบเบิก |
| tx_sto_issue | tx | ประวัติการจ่าย |
| mt_5s_team / _area / _checklist / _audit_plan / _setting / _task | **tx** | กิจกรรม 5S: ทีมรายปี (รวมเจ้าของพื้นที่ role owner + area_id), พื้นที่, หัวข้อตรวจรายปี, แผนตรวจ, ค่าตั้งต้น, Project Planner |
| mt_cfo_scope / _gwp / _ef / _activity, tx_cfo_entry, v_cfo_entry / v_cfo_month (+ team / setting / task) | **tx** | กิจกรรม CFO: หมวด Scope, GWP, Emission factor, กิจกรรมรายหน่วยงาน, ข้อมูลรายเดือน (docs/specs/act-cfo.md) |
| mt_100p_team / _setting / _task | **tx** | กิจกรรม 100P: ทีมรายปี (admin แก้แผน), Project Planner ข้อหลัก/ข้อรอง (db/act/100p.sql) |
| tx_5s_audit (+ auditors, receivers) / _audit_score / _issue (+ photo_before, photo_after), v_5s_audit_group | **tx** | ผลตรวจ คะแนนรายข้อ Issue และ % ราย ส (9 ตาราง ตั้งแต่ v2 2026-10-25) |

## Schedule Plan (ระบบกิจกรรม)

- ทุกคนที่ login ดูแผนได้
- สิทธิ์ของแต่ละกิจกรรมมาจาก `mt_<กิจกรรม>_team` รายปี: role `admin` = แก้ Setting และแผน, `chairman` / `auditor` / เจ้าของพื้นที่ (`mt_<กิจกรรม>_team` role owner) = transaction, ทุกคน = Dashboard · creator ทำได้ทุกอย่าง
- route เขียนข้อมูลของ act ตรวจ admin ของปีนั้นใน handler (`requireAdmin`) snapshot จึงแสดงแค่ `auth`
- แผนของกิจกรรมคือ Project Planner (`mt_<กิจกรรม>_task`, docs/specs/act-planner.md) แก้ที่ Setting · ปฏิทินรวมอ่านจาก Planner (ตาราง Gantt เดิม `mt_<กิจกรรม>_plan` เลิกใช้ ไม่อยู่ในแม่แบบแล้ว)
- เปิดใช้กับกิจกรรมอื่น: ดูหัวข้อท้าย docs/specs/act-planner.md
- ปฏิทินรวมอยู่ที่ ระบบตั้งค่า > ปฏิทิน แสดงทุกกิจกรรม แยกสีตามกิจกรรม ดูอย่างเดียว กดรายการแล้วไปที่แผนของกิจกรรมนั้นได้
- ตั้งค่าทีมและเจ้าของพื้นที่ที่ <กิจกรรม> > Setting (หรือ System > Setting สำหรับ creator)

RPC: `mt_sto_stock_adjust(p_costcenter, p_material, p_delta)` (mx), `tx_sto_apply_costcenter(p_id, p_employee, p_costcenter)` (tx)

ขั้นตอนใบเบิก: `cart → submitted → accepted → preparing → ready → received` เจ้าของใบยกเลิก (`cancelled`) ได้ก่อนถึง received

## หนี้ทางเทคนิคที่รู้แล้ว (ยังไม่แก้)

- mx กับ tx อยู่คนละโปรเจกต์ Supabase จึง join หรือใช้ FK ข้ามกันไม่ได้ และการตัดสต็อกตอน `received` ยังไม่ใช่ transaction เดียว กำลังแก้อยู่โดยรวมฐาน (ดู `db/README.md`) เมื่อมี RPC `tx_sto_receive` แล้ว server จะใช้เอง
- ทุก request อ่านตารางสมาชิกของทุกโมดูล ถ้ามีเกิน 8–10 โมดูล ควรรวมเป็นตารางเดียว `mt_main_user_role(employee_id, module_id, role, status)`
- ยังไม่มีเทสต์ที่ต่อฐานข้อมูลจริง `npm run check` ตรวจได้แค่โครงสร้าง, route, สิทธิ์ และการ boot
