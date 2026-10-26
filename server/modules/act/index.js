import { fail, wrap } from '../../core/http.js';
import { defineModule } from '../../core/access.js';
import { requireUser } from '../../core/users.js';
import { dateOf, tablesOf } from './common.js';
import { mountAudit } from './audit.js';
import { mountTransaction } from './transaction.js';
import { PLANNER_ON, mountPlanner, plannerEvents } from './planner.js';
import { CFO_ON, mountCfo } from './cfo.js';

// ระบบกิจกรรม (Tx Data): calendar here, Project Planner in planner.js, checklist audit Dashboard/Setting in audit.js,
// audits and Issues in transaction.js. Each activity has its own tables (db/act/<activity>.sql, scripts/act-sql.js).
// Rights come from mt_<act>_team per year (common.js accessOf).
const MAX_RANGE_DAYS = 400;
// Activities with checklist-audit tables in Tx Data; they show up in System > Setting with the planner ones.
const AUDIT_ON = ['5s'];

function tablesForSystem() {
  const out = {};
  for (const activity of new Set([...AUDIT_ON, ...PLANNER_ON, ...CFO_ON])) {
    const t = tablesOf(activity);
    out[t.team] = { db: 'tx', pk: ['id'], columns: [['id', 'read'], ['year', 'int', true], ['employee_id', 'text', true], ['role', 'actrole', true], ['team', 'text'], ['area_id', 'int'], ...(CFO_ON.includes(activity) ? [['department', 'text']] : []), ['status', 'status', true]] };
    out[t.setting] = { db: 'tx', pk: ['key'], columns: [['key', 'text', true], ['value', 'text', true]] };
    out[t.task] = { db: 'tx', pk: ['id'], columns: [['id', 'read'], ['year', 'int', true], ['parent_id', 'int'], ['sort_no', 'int', true], ['title', 'text', true], ['start_date', 'date'], ['end_date', 'date'], ['progress', 'int', true], ['owner_id', 'text'], ['color', 'text'], ['note', 'text'], ['created_by', 'read']] };
    if (CFO_ON.includes(activity)) {
      out[t.cfoScope] = { db: 'tx', pk: ['code'], columns: [['code', 'text', true], ['scope', 'int', true], ['name', 'text', true], ['name_th', 'text']] };
      out[t.gwp] = { db: 'tx', pk: ['code'], columns: [['code', 'text', true], ['co2', 'qty', true], ['ch4_fossil', 'qty', true], ['ch4', 'qty', true], ['n2o', 'qty', true], ['sf6', 'qty', true], ['nf3', 'qty', true], ['reference', 'text'], ['status', 'status', true]] };
      out[t.ef] = { db: 'tx', pk: ['id'], columns: [['id', 'read'], ['code', 'text'], ['scope_code', 'text', true], ['kind', 'text'], ['name', 'text', true], ['detail', 'text'], ['unit', 'text', true], ['kgco2e', 'qty'], ['co2', 'qty'], ['ch4_fossil', 'qty'], ['ch4', 'qty'], ['n2o', 'qty'], ['hfc', 'qty'], ['pfc', 'qty'], ['reference', 'text'], ['year', 'int'], ['status', 'status', true]] };
      out[t.activity] = { db: 'tx', pk: ['id'], columns: [['id', 'read'], ['code', 'text'], ['ef_id', 'int', true], ['gwp_code', 'text', true], ['department', 'text', true], ['name', 'text', true], ['detail', 'text'], ['calc', 'text'], ['status', 'status', true]] };
      out[t.entry] = { db: 'tx', pk: ['id'], columns: [['id', 'read'], ['activity_id', 'int', true], ['month', 'date', true], ['qty', 'qty', true], ['ef_id', 'int', true], ['gwp_code', 'text', true], ['doc', 'text'], ['status', 'text', true], ['remark', 'text'], ['created_by', 'read']] };
    }
    if (!AUDIT_ON.includes(activity)) continue;
    out[t.area] = { db: 'tx', pk: ['id'], columns: [['id', 'read'], ['code', 'text', true], ['area_type', 'areatype', true], ['name', 'text', true], ['section', 'text'], ['status', 'status', true]] };
    out[t.checklist] = { db: 'tx', pk: ['id'], columns: [['id', 'read'], ['year', 'int', true], ['item_no', 'int', true], ['s_group', 'int', true], ['title', 'text', true], ['score_max', 'int', true], ['status', 'status', true]] };
    out[t.auditPlan] = { db: 'tx', pk: ['id'], columns: [['id', 'read'], ['year', 'int', true], ['area_id', 'int', true], ['month', 'int', true], ['week', 'int', true], ['round', 'int'], ['team', 'text']] };
  }
  return out;
}

export default defineModule({
  id: 'act',
  label: 'กิจกรรม',
  tables: tablesForSystem(),
  mount(app) {
    // ระบบตั้งค่า > ปฏิทิน: every activity's Planner items in one list, read only.
    app.get('/api/act/calendar', wrap(requireUser), wrap(async (req, res) => {
      const from = dateOf(req.query.from);
      const to = dateOf(req.query.to);
      if (!from || !to || to < from) return fail(res, 400, 'ช่วงวันที่ไม่ถูกต้อง');
      if ((Date.parse(to) - Date.parse(from)) / 86400000 > MAX_RANGE_DAYS) return fail(res, 400, 'ช่วงวันที่ยาวเกินไป');
      const events = await plannerEvents(from, to);
      res.json({ events: events.sort((a, b) => a.start_date.localeCompare(b.start_date)) });
    }));

    mountPlanner(app);
    mountAudit(app);
    mountTransaction(app);
    mountCfo(app);
  }
});
