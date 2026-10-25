import { mx } from '../../core/db.js';
import { fail, wrap } from '../../core/http.js';
import { defineModule, atLeast, rankIn } from '../../core/access.js';
import { requireUser } from '../../core/users.js';

// ระบบกิจกรรม: Schedule Plan per activity. Tables: db/04_act_plan.sql.
const ACTIVITIES = ['100p', '5s', 'cfo', 'e-day', 'kaizen', 'lean', 'qcc', 'safety', 'smf'];
const STATUSES = ['planned', 'done', 'cancelled'];
const MAX_RANGE_DAYS = 400;

const ACT_TABLES = {
  mt_act_user: { db: 'mx', pk: ['employee_id'], columns: [
    ['employee_id', 'text', true], ['department', 'text', true], ['role', 'usage', true], ['status', 'status', true]
  ] },
  mt_act_owner: { db: 'mx', pk: ['year', 'activity'], columns: [
    ['year', 'int', true], ['activity', 'text', true], ['department', 'text', true], ['status', 'status', true]
  ] },
  mt_act_plan: { db: 'mx', pk: ['id'], columns: [
    ['id', 'read'], ['activity', 'text', true], ['title', 'text', true], ['detail', 'text'],
    ['start_date', 'date', true], ['end_date', 'date', true], ['responsible', 'text'], ['status', 'text', true], ['created_by', 'read']
  ] }
};

function dateOf(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text;
}

function missingTables(res, error) {
  if (error?.code !== 'PGRST205') return false;
  fail(res, 503, 'ยังไม่ได้สร้างตารางแผนกิจกรรม (db/04_act_plan.sql)');
  return true;
}

async function ownersOf(activity, fromYear, toYear) {
  const { data, error } = await mx.from('mt_act_owner').select('year,department')
    .eq('activity', activity).eq('status', 'Active').gte('year', fromYear).lte('year', toYear);
  if (error) throw error;
  return new Map((data || []).map((row) => [Number(row.year), row.department]));
}

function canEdit(req, mod, department) {
  if (req.user.creator) return true;
  return rankIn(req.user, mod.id) >= 3 && Boolean(department) && department === req.user.department;
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

export default defineModule({
  id: 'act',
  label: 'กิจกรรม',
  memberTable: 'mt_act_user',
  tables: ACT_TABLES,
  mount(app, mod) {
    const activityOf = (req, res) => {
      if (ACTIVITIES.includes(req.params.activity)) return req.params.activity;
      fail(res, 404, 'ไม่พบกิจกรรม');
      return null;
    };
    const guardYear = async (req, res, activity, ...dates) => {
      const years = [...new Set(dates.map((date) => Number(date.slice(0, 4))))];
      const owners = await ownersOf(activity, Math.min(...years), Math.max(...years));
      for (const year of years) {
        if (!canEdit(req, mod, owners.get(year))) {
          fail(res, 403, `แก้ได้เฉพาะ Admin ของหน่วยงานผู้ดูแลปี ${year}${owners.get(year) ? ` (${owners.get(year)})` : ' (ยังไม่กำหนดผู้ดูแล)'}`);
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
      if (missingTables(res, error)) return;
      if (error) return fail(res, 400, 'อ่านปฏิทินไม่ได้');
      res.json({ events: data || [] });
    }));

    // Everyone signed in may read the plan.
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
      if (missingTables(res, error)) return;
      if (error) return fail(res, 400, 'อ่านแผนไม่ได้');
      let owners;
      try {
        owners = await ownersOf(activity, Number(from.slice(0, 4)), Number(to.slice(0, 4)));
      } catch (err) {
        if (missingTables(res, err)) return;
        throw err;
      }
      const years = [];
      for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year += 1) {
        const department = owners.get(year) || '';
        years.push({ year, department, canEdit: canEdit(req, mod, department) });
      }
      res.json({ events: data || [], years });
    }));

    app.post('/api/act/:activity/plan', wrap(requireUser), atLeast(mod, 3), wrap(async (req, res) => {
      const activity = activityOf(req, res);
      if (!activity) return;
      const { row, error: invalid } = planInput(req.body || {});
      if (invalid) return fail(res, 400, invalid);
      if (!(await guardYear(req, res, activity, row.start_date))) return;
      const { error } = await mx.from('mt_act_plan').insert({ ...row, activity, created_by: req.user.employeeId });
      if (missingTables(res, error)) return;
      if (error) return fail(res, 400, 'เพิ่มรายการไม่ได้');
      res.status(201).json({ ok: true });
    }));

    app.patch('/api/act/:activity/plan/:id', wrap(requireUser), atLeast(mod, 3), wrap(async (req, res) => {
      const activity = activityOf(req, res);
      if (!activity) return;
      const id = Number(req.params.id);
      const { data: current, error: readError } = await mx.from('mt_act_plan').select('id,start_date').eq('id', id).eq('activity', activity).maybeSingle();
      if (missingTables(res, readError)) return;
      if (readError || !current) return fail(res, 404, 'ไม่พบรายการ');
      const { row, error: invalid } = planInput(req.body || {});
      if (invalid) return fail(res, 400, invalid);
      if (!(await guardYear(req, res, activity, current.start_date, row.start_date))) return;
      const { data, error } = await mx.from('mt_act_plan').update({ ...row, updated_at: new Date().toISOString() })
        .eq('id', id).eq('activity', activity).select('id');
      if (error || !data?.length) return fail(res, 400, 'แก้ไขรายการไม่ได้');
      res.json({ ok: true });
    }));

    app.delete('/api/act/:activity/plan/:id', wrap(requireUser), atLeast(mod, 3), wrap(async (req, res) => {
      const activity = activityOf(req, res);
      if (!activity) return;
      const id = Number(req.params.id);
      const { data: current, error: readError } = await mx.from('mt_act_plan').select('id,start_date').eq('id', id).eq('activity', activity).maybeSingle();
      if (missingTables(res, readError)) return;
      if (readError || !current) return fail(res, 404, 'ไม่พบรายการ');
      if (!(await guardYear(req, res, activity, current.start_date))) return;
      const { error } = await mx.from('mt_act_plan').delete().eq('id', id).eq('activity', activity);
      if (error) return fail(res, 400, 'ลบรายการไม่ได้');
      res.json({ ok: true });
    }));
  }
});
