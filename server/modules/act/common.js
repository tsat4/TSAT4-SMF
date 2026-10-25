import { mx } from '../../core/db.js';
import { fail } from '../../core/http.js';
import { nameOf } from '../../core/users.js';

// Shared by the act routes: activity list, input checks, yearly team access, and bulk reads.
export const ACTIVITIES = ['100p', '5s', 'cfo', 'e-day', 'kaizen', 'lean', 'qcc', 'safety', 'smf'];
export const PAGE = 1000;

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

// PGRST205 = the table is not created yet: say which SQL file to run instead of a 500.
export function missingTables(res, error, file = 'db/05_act_audit.sql') {
  if (error?.code !== 'PGRST205') return false;
  fail(res, 503, `ยังไม่ได้สร้างตารางของกิจกรรม (${file})`);
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
  const none = { admin: false, chairman: false, auditor: false, teams: [], ownerAreaIds: [], member: false };
  const [team, owners] = await Promise.all([
    mx.from('mt_act_team').select('role,team').eq('year', year).eq('activity', activity).eq('employee_id', me).eq('status', 'Active'),
    mx.from('mt_act_area_owner').select('area_id,mt_act_area!inner(activity)').eq('year', year).eq('employee_id', me).eq('mt_act_area.activity', activity)
  ]);
  if (team.error?.code === 'PGRST205' || owners.error?.code === 'PGRST205') return { ...none, admin: Boolean(req.user.creator) };
  if (team.error) throw team.error;
  if (owners.error) throw owners.error;
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
