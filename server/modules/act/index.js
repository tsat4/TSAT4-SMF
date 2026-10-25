import { mx } from '../../core/db.js';
import { fail, wrap } from '../../core/http.js';
import { defineModule } from '../../core/access.js';
import { requireUser } from '../../core/users.js';
import { ACTIVITIES, accessOf, activityOf, dateOf, missingTables, namesOf } from './common.js';
import { mountAudit } from './audit.js';

// ระบบกิจกรรม: Gantt plan + calendar (db/04_act_plan.sql) and checklist audits (db/05_act_audit.sql, audit.js).
// Rights come from mt_act_team per activity and year (common.js accessOf), not from a module role.
const STATUSES = ['planned', 'done', 'cancelled'];
const MAX_RANGE_DAYS = 400;

const ACT_TABLES = {
  mt_act_area: { db: 'mx', pk: ['id'], columns: [
    ['id', 'read'], ['activity', 'text', true], ['code', 'text', true], ['area_type', 'areatype', true], ['name', 'text', true], ['section', 'text'], ['status', 'status', true]
  ] },
  mt_act_area_owner: { db: 'mx', pk: ['year', 'area_id'], columns: [
    ['year', 'int', true], ['area_id', 'int', true], ['employee_id', 'text', true]
  ] },
  mt_act_team: { db: 'mx', pk: ['id'], columns: [
    ['id', 'read'], ['year', 'int', true], ['activity', 'text', true], ['employee_id', 'text', true], ['role', 'actrole', true], ['team', 'text'], ['status', 'status', true]
  ] },
  mt_act_checklist: { db: 'mx', pk: ['id'], columns: [
    ['id', 'read'], ['year', 'int', true], ['activity', 'text', true], ['item_no', 'int', true], ['s_group', 'int', true], ['title', 'text', true], ['score_max', 'int', true], ['status', 'status', true]
  ] },
  mt_act_audit_plan: { db: 'mx', pk: ['id'], columns: [
    ['id', 'read'], ['year', 'int', true], ['activity', 'text', true], ['area_id', 'int', true], ['month', 'int', true], ['week', 'int', true], ['round', 'int'], ['team', 'text']
  ] },
  mt_act_setting: { db: 'mx', pk: ['activity', 'key'], columns: [
    ['activity', 'text', true], ['key', 'text', true], ['value', 'text', true]
  ] },
  mt_act_plan: { db: 'mx', pk: ['id'], columns: [
    ['id', 'read'], ['activity', 'text', true], ['title', 'text', true], ['detail', 'text'],
    ['start_date', 'date', true], ['end_date', 'date', true], ['responsible', 'text'], ['status', 'text', true], ['created_by', 'read']
  ] }
};

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

export default defineModule({
  id: 'act',
  label: 'กิจกรรม',
  tables: ACT_TABLES,
  mount(app, mod) {
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

    // ระบบตั้งค่า > ปฏิทิน: every activity's plan in one list, read-only, for everyone signed in.
    app.get('/api/act/calendar', wrap(requireUser), wrap(async (req, res) => {
      const range = rangeOf(req, res);
      if (!range) return;
      const { data, error } = await mx.from('mt_act_plan')
        .select('id,activity,title,detail,start_date,end_date,responsible,status')
        .in('activity', ACTIVITIES).lte('start_date', range.to).gte('end_date', range.from)
        .order('start_date').order('id').limit(2000);
      if (missingTables(res, error, 'db/04_act_plan.sql')) return;
      if (error) return fail(res, 400, 'อ่านปฏิทินไม่ได้');
      res.json({ events: data || [] });
    }));

    // Everyone signed in may read the plan. years[] tells the page who the admins are and whether this user may edit.
    app.get('/api/act/:activity/plan', wrap(requireUser), wrap(async (req, res) => {
      const activity = activityOf(req, res);
      if (!activity) return;
      const range = rangeOf(req, res);
      if (!range) return;
      const { from, to } = range;
      const { data, error } = await mx.from('mt_act_plan')
        .select('id,activity,title,detail,start_date,end_date,responsible,status')
        .eq('activity', activity).lte('start_date', to).gte('end_date', from)
        .order('start_date').order('id').limit(1000);
      if (missingTables(res, error, 'db/04_act_plan.sql')) return;
      if (error) return fail(res, 400, 'อ่านแผนไม่ได้');
      const fromYear = Number(from.slice(0, 4));
      const toYear = Number(to.slice(0, 4));
      const admins = await mx.from('mt_act_team').select('year,employee_id')
        .eq('activity', activity).eq('role', 'admin').eq('status', 'Active').gte('year', fromYear).lte('year', toYear);
      const adminRows = admins.error ? [] : admins.data || [];
      const names = await namesOf(adminRows.map((row) => row.employee_id));
      const years = [];
      for (let year = fromYear; year <= toYear; year += 1) {
        const list = adminRows.filter((row) => Number(row.year) === year).map((row) => names.get(String(row.employee_id))?.name || row.employee_id);
        years.push({ year, admins: list, canEdit: (await accessOf(req, activity, year)).admin });
      }
      res.json({ events: data || [], years });
    }));

    app.post('/api/act/:activity/plan', wrap(requireUser), wrap(async (req, res) => {
      const activity = activityOf(req, res);
      if (!activity) return;
      const { row, error: invalid } = planInput(req.body || {});
      if (invalid) return fail(res, 400, invalid);
      if (!(await guardYear(req, res, activity, row.start_date))) return;
      const { error } = await mx.from('mt_act_plan').insert({ ...row, activity, created_by: req.user.employeeId });
      if (missingTables(res, error, 'db/04_act_plan.sql')) return;
      if (error) return fail(res, 400, 'เพิ่มรายการไม่ได้');
      res.status(201).json({ ok: true });
    }));

    app.patch('/api/act/:activity/plan/:id', wrap(requireUser), wrap(async (req, res) => {
      const activity = activityOf(req, res);
      if (!activity) return;
      const id = Number(req.params.id);
      const { data: current, error: readError } = await mx.from('mt_act_plan').select('id,start_date').eq('id', id).eq('activity', activity).maybeSingle();
      if (missingTables(res, readError, 'db/04_act_plan.sql')) return;
      if (readError || !current) return fail(res, 404, 'ไม่พบรายการ');
      const { row, error: invalid } = planInput(req.body || {});
      if (invalid) return fail(res, 400, invalid);
      if (!(await guardYear(req, res, activity, current.start_date, row.start_date))) return;
      const { data, error } = await mx.from('mt_act_plan').update({ ...row, updated_at: new Date().toISOString() })
        .eq('id', id).eq('activity', activity).select('id');
      if (error || !data?.length) return fail(res, 400, 'แก้ไขรายการไม่ได้');
      res.json({ ok: true });
    }));

    app.delete('/api/act/:activity/plan/:id', wrap(requireUser), wrap(async (req, res) => {
      const activity = activityOf(req, res);
      if (!activity) return;
      const id = Number(req.params.id);
      const { data: current, error: readError } = await mx.from('mt_act_plan').select('id,start_date').eq('id', id).eq('activity', activity).maybeSingle();
      if (missingTables(res, readError, 'db/04_act_plan.sql')) return;
      if (readError || !current) return fail(res, 404, 'ไม่พบรายการ');
      if (!(await guardYear(req, res, activity, current.start_date))) return;
      const { error } = await mx.from('mt_act_plan').delete().eq('id', id).eq('activity', activity);
      if (error) return fail(res, 400, 'ลบรายการไม่ได้');
      res.json({ ok: true });
    }));

    mountAudit(app);
  }
});
