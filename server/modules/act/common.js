import { mx, tx } from '../../core/db.js';
import { fail } from '../../core/http.js';
import { nameOf } from '../../core/users.js';

// Shared by the act routes. Activity data lives in Tx Data (client `tx`), one table set per activity:
// mt_<key>_* / tx_<key>_* made by scripts/act-sql.js. Employees and logins stay in Mx Data (client `mx`).
export const ACTIVITIES = ['100p', '5s', 'cfo', 'e-day', 'kaizen', 'lean', 'qcc', 'safety', 'smf'];
export const PAGE = 1000;

export function tablesOf(activity) {
  const k = activity.replace(/[^a-z0-9]/g, '');
  return {
    sql: `db/act/${activity}.sql`,
    bucket: `img_${k}`, // Storage bucket for this activity's photos
    team: `mt_${k}_team`,
    setting: `mt_${k}_setting`,
    plan: `mt_${k}_plan`,
    area: `mt_${k}_area`,
    owner: `mt_${k}_area_owner`,
    checklist: `mt_${k}_checklist`,
    auditPlan: `mt_${k}_audit_plan`,
    audit: `tx_${k}_audit`,
    score: `tx_${k}_audit_score`,
    person: `tx_${k}_audit_person`,
    issue: `tx_${k}_issue`,
    photo: `tx_${k}_issue_photo`,
    group: `v_${k}_audit_group`
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

export function activityOf(req, res) {
  if (ACTIVITIES.includes(req.params.activity)) return req.params.activity;
  fail(res, 404, 'ไม่พบกิจกรรม');
  return null;
}

// PGRST205 = the table is not created yet: say which SQL file to run in Tx Data instead of a 500.
export function missingTables(res, error, activity) {
  if (error?.code !== 'PGRST205') return false;
  fail(res, 503, `ยังไม่ได้สร้างตารางของกิจกรรมนี้ใน Tx Data (${activity ? tablesOf(activity).sql : 'db/act/<กิจกรรม>.sql'})`);
  return true;
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
// admin -> Setting · chairman / auditor / area owner -> transaction · everyone -> Dashboard
export async function accessOf(req, activity, year) {
  const me = req.user.employeeId;
  const t = tablesOf(activity);
  const none = { admin: Boolean(req.user.creator), chairman: false, auditor: false, teams: [], ownerAreaIds: [], member: Boolean(req.user.creator) };
  const [team, owners] = await Promise.all([
    tx.from(t.team).select('role,team').eq('year', year).eq('employee_id', me).eq('status', 'Active'),
    tx.from(t.owner).select('area_id').eq('year', year).eq('employee_id', me)
  ]);
  if (team.error?.code === 'PGRST205') return none;
  if (team.error) throw team.error;
  if (owners.error && owners.error.code !== 'PGRST205') throw owners.error;
  const roles = team.data || [];
  const access = {
    admin: Boolean(req.user.creator) || roles.some((r) => r.role === 'admin'),
    chairman: roles.some((r) => r.role === 'chairman'),
    auditor: roles.some((r) => r.role === 'auditor'),
    teams: [...new Set(roles.filter((r) => r.team).map((r) => r.team))],
    ownerAreaIds: (owners.data || []).map((r) => Number(r.area_id))
  };
  access.member = access.admin || access.chairman || access.auditor || access.ownerAreaIds.length > 0;
  return access;
}

export async function requireAdmin(req, res, activity, year) {
  const access = await accessOf(req, activity, year);
  if (access.admin) return access;
  fail(res, 403, `แก้ได้เฉพาะ admin ของกิจกรรมนี้ปี ${year}`);
  return null;
}
