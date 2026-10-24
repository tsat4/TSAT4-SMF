import { mx, dbReady } from './db.js';
import { fail } from './http.js';
import { cookies, readSession, setSession } from './session.js';
import { MEMBER_TABLES, isCreatorRow } from './access.js';

export function nameOf(employee) {
  if (!employee) return '';
  return [employee.prefix, employee.first_name, employee.last_name].filter(Boolean).join(' ');
}

export async function loadUser(employeeId) {
  const { data, error } = await mx
    .from('mt_main_user')
    .select('employee_id,creator,status,password_expires_at,password_hash,department,mt_main_employee!mt_main_user_employee_id_fkey(prefix,first_name,last_name,department,position,status)')
    .eq('employee_id', employeeId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const entries = Object.entries(MEMBER_TABLES);
  const members = await Promise.all(entries.map(([, table]) => mx.from(table).select('role,status,department').eq('employee_id', employeeId).maybeSingle()));
  data.members = {};
  entries.forEach(([moduleId], i) => {
    if (members[i].error) throw members[i].error;
    data.members[moduleId] = members[i].data || null;
  });
  return data;
}

function rolesOf(row) {
  const creator = isCreatorRow(row);
  const roles = {};
  for (const moduleId of Object.keys(MEMBER_TABLES)) {
    const member = row.members?.[moduleId];
    if (creator) roles[moduleId] = 'admin';
    else roles[moduleId] = member?.status === 'Active' ? member.role : null;
  }
  return roles;
}

export function publicUser(row) {
  const employee = row.mt_main_employee || {};
  const roles = rolesOf(row);
  return {
    employeeId: row.employee_id,
    creator: isCreatorRow(row),
    roles,
    usageRole: roles.sto ?? null,
    status: row.status,
    name: nameOf(employee),
    department: row.department || employee.department || '',
    position: employee.position || '',
    passwordExpiresAt: row.password_expires_at,
    passwordExpired: new Date(row.password_expires_at).getTime() <= Date.now()
  };
}

export async function requireUser(req, res, next) {
  if (!dbReady()) return fail(res, 503, 'ยังไม่ได้ตั้งค่าการเชื่อมฐานข้อมูล');
  const session = readSession(cookies(req).smf_session);
  if (!session) return fail(res, 401, 'กรุณาเข้าสู่ระบบ');
  const row = await loadUser(session.employeeId);
  if (!row || row.status !== 'Active' || row.mt_main_employee?.status !== 'Active') {
    setSession(res, '');
    return fail(res, 401, 'บัญชีนี้ใช้งานไม่ได้');
  }
  req.user = publicUser(row);
  req.userHash = row.password_hash;
  const open = req.path === '/api/me' || req.path === '/api/logout' || req.path === '/api/password';
  if (req.user.passwordExpired && !open) return fail(res, 403, 'ครบกำหนด 90 วัน ต้องเปลี่ยนรหัสผ่าน');
  next();
}
requireUser.need = 'auth';
