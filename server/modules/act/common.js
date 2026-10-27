import { mx, tx } from '../../core/db.js';
import { fail, wrap } from '../../core/http.js';
import { nameOf, requireUser } from '../../core/users.js';

// Shared by the act routes. Activity data lives in Tx Data (client `tx`), one table set per activity:
// mt_<key>_* / tx_<key>_* made by scripts/act-sql.js. Employees and logins stay in Mx Data (client `mx`).
export const ACTIVITIES = ['100p', '5s', 'cfo', 'e-day', 'kaizen', 'lean', 'qcc', 'safety', 'smf'];
const PAGE = 1000;

// Decimal rounding (85.15 -> 85.2) like the old system and SQL; plain Math.round(n * 10) gives 85.1.
export const roundTo = (n, digits) => Number(`${Math.round(Number(`${Number(n).toFixed(8)}e${digits}`))}e-${digits}`);

export function tablesOf(activity) {
  const k = activity.replace(/[^a-z0-9]/g, '');
  return {
    sql: `db/act/${activity}.sql`,
    bucket: `img_${k}`, // Storage bucket for this activity's photos
    team: `mt_${k}_team`,
    setting: `mt_${k}_setting`,
    task: `mt_${k}_task`, // Project Planner (planner.js)
    area: `mt_${k}_area`,
    checklist: `mt_${k}_checklist`,
    auditPlan: `mt_${k}_audit_plan`,
    audit: `tx_${k}_audit`,
    score: `tx_${k}_audit_score`,
    issue: `tx_${k}_issue`,
    group: `v_${k}_audit_group`,
    // CFO only (scripts/act-sql.js cfoSql)
    cfoScope: `mt_${k}_scope`,
    gwp: `mt_${k}_gwp`,
    ef: `mt_${k}_ef`,
    activity: `mt_${k}_activity`,
    entry: `tx_${k}_entry`,
    entryView: `v_${k}_entry`,
    s3Assess: `mt_${k}_s3_assess`,
    revision: `tx_${k}_revision`
  };
}

export function dateOf(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text;
}

export function yearOf(value, fallback = new Date().getFullYear()) {
  const n = Number(value || fallback);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
}

// Route maker for /api/act/:activity/...: signed in, a known activity (and one of `only` when given), and the
// handler gets (req, res, activity, tablesOf(activity)). Any thrown error that means a missing table
// (PGRST205) becomes a 503 naming the SQL file to run in Tx Data instead of a 500.
export function actRoute(app, { only, sqlOf = () => null } = {}) {
  return (method, path, handler) => app[method](path, wrap(requireUser), wrap(async (req, res) => {
    const { activity } = req.params;
    if (!ACTIVITIES.includes(activity) || (only && !only.includes(activity))) return fail(res, 404, 'ไม่พบกิจกรรม');
    try {
      await handler(req, res, activity, tablesOf(activity));
    } catch (err) {
      if (err?.code !== 'PGRST205') throw err;
      fail(res, 503, `ยังไม่ได้สร้างตารางของกิจกรรมนี้ใน Tx Data (${sqlOf(activity) || tablesOf(activity).sql})`);
    }
  }));
}

// Supabase result -> data, or throw its error (actRoute turns it into a response).
export function must({ data, error }) {
  if (error) throw error;
  return data;
}

// JPEG data URL from the browser -> bytes for Storage (img_<act> bucket limit 700 KB), or null.
export function imageBytes(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length < 32 || bytes.length > 700000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  return bytes;
}

export function throwIf(...errors) {
  const error = errors.find(Boolean);
  if (error) throw error;
}

// Reads every row past PostgREST's 1000-row page. build() must return a fresh query each call.
export async function fetchAll(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

export async function fetchIn(build, column, ids, size = 200) {
  const unique = [...new Set(ids.filter((id) => id != null && id !== ''))];
  const rows = [];
  for (let i = 0; i < unique.length; i += size) rows.push(...(await fetchAll(() => build().in(column, unique.slice(i, i + size)))));
  return rows;
}

export async function namesOf(ids) {
  const rows = await fetchIn(() => mx.from('mt_main_employee').select('employee_id,prefix,first_name,last_name,department'), 'employee_id', ids.map(String));
  return new Map(rows.map((row) => [String(row.employee_id), { name: nameOf(row), department: row.department || '' }]));
}

// What the signed-in user may do in one activity for one year.
// admin -> Setting · chairman (+ vice) / auditor / area owner / department member -> transaction · everyone -> Dashboard
export async function accessOf(req, activity, year) {
  const me = req.user.employeeId;
  const t = tablesOf(activity);
  const none = { admin: Boolean(req.user.creator), chairman: false, auditor: false, teams: [], ownerAreaIds: [], departments: [], member: Boolean(req.user.creator) };
  // One table says who does what this year, area owners included (role owner + area_id).
  const team = await tx.from(t.team).select('*').eq('year', year).eq('employee_id', me).eq('status', 'Active');
  if (team.error?.code === 'PGRST205') return none;
  if (team.error) throw team.error;
  const roles = team.data || [];
  const access = {
    admin: Boolean(req.user.creator) || roles.some((r) => r.role === 'admin'),
    chairman: roles.some((r) => r.role === 'chairman' || r.role === 'vice'),
    auditor: roles.some((r) => r.role === 'auditor'),
    teams: [...new Set(roles.filter((r) => r.team).map((r) => r.team))],
    ownerAreaIds: roles.filter((r) => r.role === 'owner').map((r) => Number(r.area_id)),
    departments: roles.filter((r) => r.role === 'member').map((r) => r.department)
  };
  access.member = roles.length > 0 || access.admin;
  return access;
}

export async function requireAdmin(req, res, activity, year) {
  const access = await accessOf(req, activity, year);
  if (access.admin) return access;
  fail(res, 403, `แก้ได้เฉพาะ admin ของกิจกรรมนี้ปี ${year}`);
  return null;
}
