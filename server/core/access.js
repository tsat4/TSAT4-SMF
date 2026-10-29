import { fail } from './http.js';

export const CREATOR_ID = '2102899';
export const ROLE_RANK = { viewer: 1, user: 2, admin: 3 };
// mt_main_user.admin_of: the work units and activities one account administers every year (ids as in public/js/units.js).
export const ADMIN_SCOPES = ['sto', 'planning', 'pd1', 'pd2', 'pd3', 'pd4', 'mtn', 'die-mtn', 'jig-mtn', 'pd-mtn', '100p', '5s', 'cfo', 'e-day', 'kaizen', 'lean', 'qcc', 'safety', 'smf'];

// moduleId -> member table (employee_id, department, role, status). Filled by defineModule().
export const MEMBER_TABLES = {};

export function defineModule(spec) {
  if (spec.memberTable) MEMBER_TABLES[spec.id] = spec.memberTable;
  return { tables: {}, ...spec };
}

export function isCreatorRow(row) {
  return Boolean(row?.creator) || row?.employee_id === CREATOR_ID;
}

export function rankIn(user, moduleId) {
  if (user?.creator) return ROLE_RANK.admin;
  return ROLE_RANK[user?.roles?.[moduleId]] || 0;
}

// Route guard: the signed-in user needs at least `level` in `mod`. `need` is read by scripts/check.js.
export function atLeast(mod, level) {
  const guard = (req, res, next) => {
    if (rankIn(req.user, mod.id) < level) return fail(res, 403, `ไม่มีสิทธิ์ใน ${mod.label}`);
    next();
  };
  guard.need = `${mod.id}:${level}`;
  return guard;
}

export function creatorOnly(req, res, next) {
  if (!req.user?.creator) return fail(res, 403, 'เฉพาะผู้ดูแลระบบ');
  next();
}
creatorOnly.need = 'creator';
