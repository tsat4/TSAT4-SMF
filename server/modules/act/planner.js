import { tx } from '../../core/db.js';
import { fail } from '../../core/http.js';
import { accessOf, actRoute, dateOf, fetchAll, must, namesOf, requireAdmin, tablesOf, yearOf } from './common.js';

// Project Planner (100P, 5S): one year's plan as main items (parent_id null) with sub items, shown as a Gantt with
// year (W1–W4) and month (day) views. Everyone reads; the year's admins create, edit, drag and delete.
// Table: mt_<act>_task (scripts/act-sql.js). A main item with sub items takes its dates and % from them.
export const PLANNER_ON = ['100p', '5s', 'e-day', 'kaizen', 'lean', 'qcc', 'safety', 'smf'];
// A running activity got the Planner table from an add-on file; a new one gets it with its tables.
const PLANNER_SQL = { '5s': 'db/act/5s_task.sql' };
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

function input(body, year, hasKids) {
  const title = String(body.title || '').trim().slice(0, 200);
  if (!title) return { error: 'ระบุชื่อรายการ' };
  const parentId = body.parentId == null || body.parentId === '' ? null : Number(body.parentId);
  if (parentId != null && !Number.isInteger(parentId)) return { error: 'เลือกข้อหลักไม่ถูกต้อง' };
  const row = {
    title,
    parent_id: hasKids ? null : parentId,
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
  return dates.error ? dates : { row: { ...row, start_date: dates.start, end_date: dates.end, progress } };
}

export function mountPlanner(app) {
  const route = actRoute(app, { only: PLANNER_ON, sqlOf: (activity) => PLANNER_SQL[activity] });
  const rowsOf = (table, year) => fetchAll(() => tx.from(table).select(COLUMNS).eq('year', year).order('sort_no').order('id'));
  const oneOf = async (table, id) => must(await tx.from(table).select(COLUMNS).eq('id', id).maybeSingle());
  const kidCount = async (table, id) => {
    const { count, error } = await tx.from(table).select('id', { count: 'exact', head: true }).eq('parent_id', id);
    if (error) throw error;
    return count;
  };
  // New or moved items go last in their level.
  const nextSort = async (table, year, parentId) => {
    const q = tx.from(table).select('sort_no').eq('year', year).order('sort_no', { ascending: false }).limit(1);
    const top = must(await (parentId == null ? q.is('parent_id', null) : q.eq('parent_id', parentId)));
    return (top[0]?.sort_no || 0) + 1;
  };
  // The parent must be a main item of the same year; an item that has sub items stays a main item.
  const badParent = async (table, year, parentId, selfId) => {
    if (parentId == null) return null;
    const parent = parentId === selfId ? null : await oneOf(table, parentId);
    if (!parent || parent.year !== year || parent.parent_id != null) return 'เลือกข้อหลักไม่ถูกต้อง';
    return null;
  };

  route('get', '/api/act/:activity/tasks', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const rows = await rowsOf(t.task, year);
    const names = await namesOf(rows.map((r) => r.owner_id));
    res.json({
      year,
      canEdit: (await accessOf(req, activity, year)).admin,
      tasks: withSpans(rows).map((row) => ({ ...row, owner_name: row.owner_id ? names.get(String(row.owner_id))?.name || row.owner_id : '' }))
    });
  });

  route('post', '/api/act/:activity/tasks', async (req, res, activity, t) => {
    const year = yearOf(req.body?.year);
    if (!year || !(await requireAdmin(req, res, activity, year))) return;
    const { row, error: invalid } = input(req.body || {}, year, false);
    const bad = invalid || await badParent(t.task, year, row.parent_id, null);
    if (bad) return fail(res, 400, bad);
    const created = must(await tx.from(t.task)
      .insert({ ...row, year, sort_no: await nextSort(t.task, year, row.parent_id), created_by: req.user.employeeId }).select('id').single());
    res.status(201).json({ ok: true, id: created.id });
  });

  // Drag: new dates for one or more items at once (dragging a main item moves all its sub items).
  route('patch', '/api/act/:activity/tasks/dates', async (req, res, activity, t) => {
    const year = yearOf(req.body?.year);
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 200) : [];
    if (!year || !items.length) return fail(res, 400, 'ไม่มีรายการที่ย้าย');
    if (!(await requireAdmin(req, res, activity, year))) return;
    const rows = withSpans(await rowsOf(t.task, year));
    const changes = [];
    for (const item of items) {
      const row = rows.find((r) => r.id === Number(item.id));
      if (!row || row.derived) return fail(res, 400, 'ย้ายรายการนี้ไม่ได้');
      const dates = datesIn(year, item.startDate, item.endDate);
      if (dates.error) return fail(res, 400, dates.error);
      changes.push({ id: row.id, start_date: dates.start, end_date: dates.end });
    }
    const updated_at = new Date().toISOString();
    for (const { id, ...dates } of changes) must(await tx.from(t.task).update({ ...dates, updated_at }).eq('id', id));
    res.json({ ok: true });
  });

  route('patch', '/api/act/:activity/tasks/:id', async (req, res, activity, t) => {
    const current = await oneOf(t.task, Number(req.params.id));
    if (!current) return fail(res, 404, 'ไม่พบรายการ');
    if (!(await requireAdmin(req, res, activity, current.year))) return;
    const hasKids = (await kidCount(t.task, current.id)) > 0;
    const { row, error: invalid } = input(req.body || {}, current.year, hasKids);
    if (!invalid && hasKids && req.body?.parentId) return fail(res, 400, 'ข้อหลักที่มีข้อรองย้ายไปเป็นข้อรองไม่ได้');
    const bad = invalid || await badParent(t.task, current.year, row.parent_id, current.id);
    if (bad) return fail(res, 400, bad);
    if (row.parent_id !== current.parent_id) row.sort_no = await nextSort(t.task, current.year, row.parent_id);
    must(await tx.from(t.task).update({ ...row, updated_at: new Date().toISOString() }).eq('id', current.id));
    res.json({ ok: true });
  });

  route('delete', '/api/act/:activity/tasks/:id', async (req, res, activity, t) => {
    const current = await oneOf(t.task, Number(req.params.id));
    if (!current) return fail(res, 404, 'ไม่พบรายการ');
    if (!(await requireAdmin(req, res, activity, current.year))) return;
    must(await tx.from(t.task).delete().eq('id', current.id));
    res.json({ ok: true });
  });
}

// ระบบตั้งค่า > ปฏิทิน: items with their own dates (sub items, and main items without sub items) as calendar events.
// Activities whose Planner table is not created yet are skipped.
export async function plannerEvents(from, to) {
  const out = [];
  for (const activity of PLANNER_ON) {
    const table = tablesOf(activity).task;
    const { data, error } = await tx.from(table).select(COLUMNS).lte('start_date', to).gte('end_date', from).order('start_date').limit(1000);
    if (error?.code === 'PGRST205') continue;
    if (error) throw error;
    // Main items with sub items are shown through their sub items.
    const parents = new Set((await fetchAll(() => tx.from(table).select('parent_id').not('parent_id', 'is', null).order('id'))).map((r) => Number(r.parent_id)));
    const names = await namesOf(data.map((r) => r.owner_id));
    for (const row of data) {
      if (row.parent_id == null && parents.has(Number(row.id))) continue;
      out.push({
        id: `t${row.id}`,
        activity,
        title: row.title,
        detail: row.note,
        start_date: row.start_date,
        end_date: row.end_date,
        responsible: row.owner_id ? names.get(String(row.owner_id))?.name || row.owner_id : null,
        status: row.progress >= 100 ? 'done' : 'planned'
      });
    }
  }
  return out;
}
