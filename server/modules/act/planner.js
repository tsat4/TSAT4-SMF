import { tx } from '../../core/db.js';
import { fail, wrap } from '../../core/http.js';
import { requireUser } from '../../core/users.js';
import { accessOf, activityOf, dateOf, fetchAll, missingTables, namesOf, requireAdmin, tablesOf, yearOf } from './common.js';

// Project Planner (100P): one year's plan as main items (parent_id null) with sub items, shown as a Gantt with
// year (W1–W4) and month (day) views. Everyone reads; the year's admins create, edit, drag and delete.
// Table: mt_<act>_task (scripts/act-sql.js --task). A main item with sub items takes its dates and % from them.
export const PLANNER_ON = ['100p'];
const COLORS = ['p1', 'p2', 'p3', 'p4', 'p5'];
const COLUMNS = 'id,year,parent_id,sort_no,title,start_date,end_date,progress,owner_id,color,note';

const daysOf = (start, end) => Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;

// Main item dates = span of its sub items, % = sub items' % weighted by their days.
export function withSpans(rows) {
  const kids = new Map();
  for (const row of rows) if (row.parent_id != null) kids.set(Number(row.parent_id), [...(kids.get(Number(row.parent_id)) || []), row]);
  return rows.map((row) => {
    const list = row.parent_id == null ? kids.get(Number(row.id)) || [] : [];
    if (!list.length) return { ...row, derived: false };
    const total = list.reduce((s, k) => s + daysOf(k.start_date, k.end_date), 0);
    return {
      ...row,
      derived: true,
      start_date: list.map((k) => k.start_date).sort()[0],
      end_date: list.map((k) => k.end_date).sort().at(-1),
      progress: Math.round(list.reduce((s, k) => s + daysOf(k.start_date, k.end_date) * k.progress, 0) / total)
    };
  });
}

function datesIn(year, startRaw, endRaw) {
  const start = dateOf(startRaw);
  const end = dateOf(endRaw || startRaw);
  if (!start || !end) return { error: 'ระบุวันเริ่มและวันจบ' };
  if (end < start) return { error: 'วันจบต้องไม่ก่อนวันเริ่ม' };
  // A plan of year Y starts in Y and may run until December of Y + 1 (planning ahead).
  if (start < `${year}-01-01` || end > `${year + 1}-12-31`) return { error: `วันที่ต้องอยู่ระหว่าง ม.ค. ${year} ถึง ธ.ค. ${year + 1}` };
  return { start, end };
}

export function mountPlanner(app) {
  const route = (method, path, handler) => app[method](path, wrap(requireUser), wrap(async (req, res) => {
    const activity = activityOf(req, res);
    if (!activity) return;
    if (!PLANNER_ON.includes(activity)) return fail(res, 404, 'กิจกรรมนี้ยังไม่มี Project Planner');
    try {
      await handler(req, res, activity, tablesOf(activity).task);
    } catch (err) {
      if (missingTables(res, err, activity)) return;
      throw err;
    }
  }));

  const rowsOf = (table, year) => fetchAll(() => tx.from(table).select(COLUMNS).eq('year', year).order('sort_no').order('id'));
  const oneOf = async (table, id) => {
    const { data, error } = await tx.from(table).select(COLUMNS).eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  };

  // The parent must be a main item of the same year; an item that has sub items stays a main item.
  const checkParent = async (table, year, parentId, selfId) => {
    if (parentId == null) return null;
    if (parentId === selfId) return 'เลือกข้อหลักไม่ถูกต้อง';
    const parent = await oneOf(table, parentId);
    if (!parent || parent.year !== year || parent.parent_id != null) return 'เลือกข้อหลักไม่ถูกต้อง';
    if (selfId != null) {
      const { count, error } = await tx.from(table).select('id', { count: 'exact', head: true }).eq('parent_id', selfId);
      if (error) throw error;
      if (count) return 'ข้อหลักที่มีข้อรองย้ายไปเป็นข้อรองไม่ได้';
    }
    return null;
  };

  const input = (body, year, { hasKids }) => {
    const title = String(body.title || '').trim().slice(0, 200);
    if (!title) return { error: 'ระบุชื่อรายการ' };
    const parentId = body.parentId == null || body.parentId === '' ? null : Number(body.parentId);
    if (parentId != null && !Number.isInteger(parentId)) return { error: 'เลือกข้อหลักไม่ถูกต้อง' };
    const row = {
      title,
      parent_id: parentId,
      owner_id: String(body.ownerId || '').trim().slice(0, 40) || null,
      note: String(body.note || '').trim().slice(0, 2000) || null,
      color: parentId == null && COLORS.includes(body.color) ? body.color : null
    };
    if (hasKids) return { row };
    const progress = Number(body.progress ?? 0);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) return { error: '% ต้องเป็น 0–100' };
    // A main item may be left without dates until it has sub items; a sub item always has dates.
    if (parentId == null && !body.startDate && !body.endDate) return { row: { ...row, start_date: null, end_date: null, progress } };
    const dates = datesIn(year, body.startDate, body.endDate);
    if (dates.error) return dates;
    return { row: { ...row, start_date: dates.start, end_date: dates.end, progress } };
  };

  route('get', '/api/act/:activity/tasks', async (req, res, activity, table) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const rows = await rowsOf(table, year);
    const admins = await tx.from(tablesOf(activity).team).select('employee_id').eq('year', year).eq('role', 'admin').eq('status', 'Active');
    const adminIds = admins.error ? [] : (admins.data || []).map((r) => String(r.employee_id));
    const names = await namesOf([...rows.map((r) => r.owner_id), ...adminIds]);
    res.json({
      year,
      canEdit: (await accessOf(req, activity, year)).admin,
      admins: adminIds.map((id) => names.get(id)?.name || id),
      tasks: withSpans(rows).map((row) => ({ ...row, owner_name: row.owner_id ? names.get(String(row.owner_id))?.name || row.owner_id : '' }))
    });
  });

  route('post', '/api/act/:activity/tasks', async (req, res, activity, table) => {
    const year = yearOf(req.body?.year);
    if (!year || !(await requireAdmin(req, res, activity, year))) return;
    const { row, error: invalid } = input(req.body || {}, year, { hasKids: false });
    if (invalid) return fail(res, 400, invalid);
    const bad = await checkParent(table, year, row.parent_id, null);
    if (bad) return fail(res, 400, bad);
    let last = tx.from(table).select('sort_no').eq('year', year).order('sort_no', { ascending: false }).limit(1);
    last = row.parent_id == null ? last.is('parent_id', null) : last.eq('parent_id', row.parent_id);
    const { data: top, error: topError } = await last;
    if (topError) throw topError;
    const { data, error } = await tx.from(table)
      .insert({ ...row, year, sort_no: (top?.[0]?.sort_no || 0) + 1, created_by: req.user.employeeId }).select('id').single();
    if (error) throw error;
    res.status(201).json({ ok: true, id: data.id });
  });

  // Drag: new dates for one or more items at once (dragging a main item moves all its sub items).
  route('patch', '/api/act/:activity/tasks/dates', async (req, res, activity, table) => {
    const year = yearOf(req.body?.year);
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 200) : [];
    if (!year || !items.length) return fail(res, 400, 'ไม่มีรายการที่ย้าย');
    if (!(await requireAdmin(req, res, activity, year))) return;
    const rows = withSpans(await rowsOf(table, year));
    const changes = [];
    for (const item of items) {
      const row = rows.find((r) => r.id === Number(item.id));
      if (!row || row.derived) return fail(res, 400, 'ย้ายรายการนี้ไม่ได้');
      const dates = datesIn(year, item.startDate, item.endDate);
      if (dates.error) return fail(res, 400, dates.error);
      changes.push({ id: row.id, start_date: dates.start, end_date: dates.end });
    }
    const now = new Date().toISOString();
    for (const change of changes) {
      const { error } = await tx.from(table).update({ start_date: change.start_date, end_date: change.end_date, updated_at: now }).eq('id', change.id);
      if (error) throw error;
    }
    res.json({ ok: true });
  });

  route('patch', '/api/act/:activity/tasks/:id', async (req, res, activity, table) => {
    const current = await oneOf(table, Number(req.params.id));
    if (!current) return fail(res, 404, 'ไม่พบรายการ');
    if (!(await requireAdmin(req, res, activity, current.year))) return;
    const { count, error: countError } = await tx.from(table).select('id', { count: 'exact', head: true }).eq('parent_id', current.id);
    if (countError) throw countError;
    const { row, error: invalid } = input(req.body || {}, current.year, { hasKids: Boolean(count) });
    if (invalid) return fail(res, 400, invalid);
    if (count) row.parent_id = null;
    const bad = await checkParent(table, current.year, row.parent_id, current.id);
    if (bad) return fail(res, 400, bad);
    if (row.parent_id !== current.parent_id) {
      // Moving to another level puts the item last there.
      let last = tx.from(table).select('sort_no').eq('year', current.year).order('sort_no', { ascending: false }).limit(1);
      last = row.parent_id == null ? last.is('parent_id', null) : last.eq('parent_id', row.parent_id);
      const { data: top, error: topError } = await last;
      if (topError) throw topError;
      row.sort_no = (top?.[0]?.sort_no || 0) + 1;
    }
    const { error } = await tx.from(table).update({ ...row, updated_at: new Date().toISOString() }).eq('id', current.id);
    if (error) throw error;
    res.json({ ok: true });
  });

  route('delete', '/api/act/:activity/tasks/:id', async (req, res, activity, table) => {
    const current = await oneOf(table, Number(req.params.id));
    if (!current) return fail(res, 404, 'ไม่พบรายการ');
    if (!(await requireAdmin(req, res, activity, current.year))) return;
    const { error } = await tx.from(table).delete().eq('id', current.id);
    if (error) throw error;
    res.json({ ok: true });
  });
}

// ระบบตั้งค่า > ปฏิทิน: items with their own dates (sub items, and main items without sub items) as calendar events.
export async function plannerEvents(from, to) {
  const out = [];
  for (const activity of PLANNER_ON) {
    const { data, error } = await tx.from(tablesOf(activity).task).select(COLUMNS)
      .lte('start_date', to).gte('end_date', from).order('start_date').limit(1000);
    if (error?.code === 'PGRST205') continue;
    if (error) throw error;
    const rows = data || [];
    // Main items with sub items anywhere in the year are shown through their sub items.
    const subs = await fetchAll(() => tx.from(tablesOf(activity).task).select('parent_id').not('parent_id', 'is', null).order('id'));
    const parents = new Set(subs.map((r) => Number(r.parent_id)));
    const names = await namesOf(rows.map((r) => r.owner_id));
    for (const row of rows) {
      if (row.parent_id == null && parents.has(Number(row.id))) continue;
      out.push({
        id: `t${row.id}`,
        title: row.title,
        detail: row.note,
        start_date: row.start_date,
        end_date: row.end_date,
        responsible: row.owner_id ? names.get(String(row.owner_id))?.name || row.owner_id : null,
        status: row.progress >= 100 ? 'done' : 'planned',
        activity
      });
    }
  }
  return out;
}
