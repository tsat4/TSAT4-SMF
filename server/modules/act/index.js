import { tx } from '../../core/db.js';
import { fail, wrap } from '../../core/http.js';
import { defineModule } from '../../core/access.js';
import { requireUser } from '../../core/users.js';
import { ACTIVITIES, accessOf, activityOf, dateOf, missingTables, namesOf, tablesOf } from './common.js';
import { mountAudit } from './audit.js';
import { mountTransaction } from './transaction.js';

// ระบบกิจกรรม (Tx Data): Gantt plan + calendar here, checklist audit Dashboard/Setting in audit.js, audits and Issues in transaction.js.
// Each activity has its own tables (db/act/<activity>.sql). Rights come from mt_<act>_team per year (common.js accessOf).
const STATUSES = ['planned', 'done', 'cancelled'];
const MAX_RANGE_DAYS = 400;
// Activities whose tables exist in Tx Data and show up in System > Setting.
const ACT_WITH_TABLES = ['5s'];

function tablesForSystem() {
  const out = {};
  for (const activity of ACT_WITH_TABLES) {
    const t = tablesOf(activity);
    Object.assign(out, {
      [t.area]: { db: 'tx', pk: ['id'], columns: [['id', 'read'], ['code', 'text', true], ['area_type', 'areatype', true], ['name', 'text', true], ['section', 'text'], ['status', 'status', true]] },
      [t.team]: { db: 'tx', pk: ['id'], columns: [['id', 'read'], ['year', 'int', true], ['employee_id', 'text', true], ['role', 'actrole', true], ['team', 'text'], ['area_id', 'int'], ['status', 'status', true]] },
      [t.checklist]: { db: 'tx', pk: ['id'], columns: [['id', 'read'], ['year', 'int', true], ['item_no', 'int', true], ['s_group', 'int', true], ['title', 'text', true], ['score_max', 'int', true], ['status', 'status', true]] },
      [t.auditPlan]: { db: 'tx', pk: ['id'], columns: [['id', 'read'], ['year', 'int', true], ['area_id', 'int', true], ['month', 'int', true], ['week', 'int', true], ['round', 'int'], ['team', 'text']] },
      [t.setting]: { db: 'tx', pk: ['key'], columns: [['key', 'text', true], ['value', 'text', true]] },
      [t.plan]: { db: 'tx', pk: ['id'], columns: [['id', 'read'], ['title', 'text', true], ['detail', 'text'], ['start_date', 'date', true], ['end_date', 'date', true], ['responsible', 'text'], ['status', 'text', true], ['created_by', 'read']] }
    });
  }
  return out;
}

function planInput(body) {
  const title = String(body.title || '').trim().slice(0, 200);
  const start = dateOf(body.startDate);
  const end = dateOf(body.endDate || body.startDate);
  const status = STATUSES.includes(body.status) ? body.status : 'planned';
  if (!title || !start || !end) return { error: 'ระบุชื่อและวันที่ให้ครบ' };
  if (end < start) return { error: 'วันจบต้องไม่ก่อนวันเริ่ม' };
  return {
    row: {
      title,
      detail: String(body.detail || '').trim().slice(0, 2000) || null,
      start_date: start,
      end_date: end,
      responsible: String(body.responsible || '').trim().slice(0, 200) || null,
      status
    }
  };
}

const PLAN_COLUMNS = 'id,title,detail,start_date,end_date,responsible,status';

export default defineModule({
  id: 'act',
  label: 'กิจกรรม',
  tables: tablesForSystem(),
  mount(app) {
    // Editing a plan item needs admin of the year of its start date (and of the new date when moved).
    const guardYear = async (req, res, activity, ...dates) => {
      for (const year of [...new Set(dates.map((date) => Number(date.slice(0, 4))))]) {
        if (!(await accessOf(req, activity, year)).admin) {
          fail(res, 403, `แก้ได้เฉพาะ admin ของกิจกรรมนี้ปี ${year}`);
          return false;
        }
      }
      return true;
    };

    const rangeOf = (req, res) => {
      const from = dateOf(req.query.from);
      const to = dateOf(req.query.to);
      if (!from || !to || to < from) return fail(res, 400, 'ช่วงวันที่ไม่ถูกต้อง');
      if ((Date.parse(to) - Date.parse(from)) / 86400000 > MAX_RANGE_DAYS) return fail(res, 400, 'ช่วงวันที่ยาวเกินไป');
      return { from, to };
    };

    // ระบบตั้งค่า > ปฏิทิน: every activity's plan in one list, read-only. Activities without tables yet are skipped.
    app.get('/api/act/calendar', wrap(requireUser), wrap(async (req, res) => {
      const range = rangeOf(req, res);
      if (!range) return;
      const results = await Promise.all(ACTIVITIES.map((activity) => tx.from(tablesOf(activity).plan).select(PLAN_COLUMNS)
        .lte('start_date', range.to).gte('end_date', range.from).order('start_date').order('id').limit(1000)));
      const events = [];
      results.forEach(({ data, error }, i) => {
        if (error && error.code !== 'PGRST205') throw error;
        for (const row of data || []) events.push({ ...row, activity: ACTIVITIES[i] });
      });
      events.sort((a, b) => a.start_date.localeCompare(b.start_date));
      res.json({ events });
    }));

    // Everyone signed in may read the plan. years[] tells the page who the admins are and whether this user may edit.
    app.get('/api/act/:activity/plan', wrap(requireUser), wrap(async (req, res) => {
      const activity = activityOf(req, res);
      if (!activity) return;
      const range = rangeOf(req, res);
      if (!range) return;
      const { from, to } = range;
      const t = tablesOf(activity);
      const { data, error } = await tx.from(t.plan).select(PLAN_COLUMNS)
        .lte('start_date', to).gte('end_date', from).order('start_date').order('id').limit(1000);
      if (missingTables(res, error, activity)) return;
      if (error) return fail(res, 400, 'อ่านแผนไม่ได้');
      const fromYear = Number(from.slice(0, 4));
      const toYear = Number(to.slice(0, 4));
      const admins = await tx.from(t.team).select('year,employee_id').eq('role', 'admin').eq('status', 'Active').gte('year', fromYear).lte('year', toYear);
      const adminRows = admins.error ? [] : admins.data || [];
      const names = await namesOf(adminRows.map((row) => row.employee_id));
      const years = [];
      for (let year = fromYear; year <= toYear; year += 1) {
        const list = adminRows.filter((row) => Number(row.year) === year).map((row) => names.get(String(row.employee_id))?.name || row.employee_id);
        years.push({ year, admins: list, canEdit: (await accessOf(req, activity, year)).admin });
      }
      res.json({ events: (data || []).map((row) => ({ ...row, activity })), years });
    }));

    app.post('/api/act/:activity/plan', wrap(requireUser), wrap(async (req, res) => {
      const activity = activityOf(req, res);
      if (!activity) return;
      const { row, error: invalid } = planInput(req.body || {});
      if (invalid) return fail(res, 400, invalid);
      if (!(await guardYear(req, res, activity, row.start_date))) return;
      const { error } = await tx.from(tablesOf(activity).plan).insert({ ...row, created_by: req.user.employeeId });
      if (missingTables(res, error, activity)) return;
      if (error) return fail(res, 400, 'เพิ่มรายการไม่ได้');
      res.status(201).json({ ok: true });
    }));

    app.patch('/api/act/:activity/plan/:id', wrap(requireUser), wrap(async (req, res) => {
      const activity = activityOf(req, res);
      if (!activity) return;
      const table = tablesOf(activity).plan;
      const id = Number(req.params.id);
      const { data: current, error: readError } = await tx.from(table).select('id,start_date').eq('id', id).maybeSingle();
      if (missingTables(res, readError, activity)) return;
      if (readError || !current) return fail(res, 404, 'ไม่พบรายการ');
      const { row, error: invalid } = planInput(req.body || {});
      if (invalid) return fail(res, 400, invalid);
      if (!(await guardYear(req, res, activity, current.start_date, row.start_date))) return;
      const { data, error } = await tx.from(table).update({ ...row, updated_at: new Date().toISOString() }).eq('id', id).select('id');
      if (error || !data?.length) return fail(res, 400, 'แก้ไขรายการไม่ได้');
      res.json({ ok: true });
    }));

    app.delete('/api/act/:activity/plan/:id', wrap(requireUser), wrap(async (req, res) => {
      const activity = activityOf(req, res);
      if (!activity) return;
      const table = tablesOf(activity).plan;
      const id = Number(req.params.id);
      const { data: current, error: readError } = await tx.from(table).select('id,start_date').eq('id', id).maybeSingle();
      if (missingTables(res, readError, activity)) return;
      if (readError || !current) return fail(res, 404, 'ไม่พบรายการ');
      if (!(await guardYear(req, res, activity, current.start_date))) return;
      const { error } = await tx.from(table).delete().eq('id', id);
      if (error) return fail(res, 400, 'ลบรายการไม่ได้');
      res.json({ ok: true });
    }));

    mountAudit(app);
    mountTransaction(app);
  }
});
