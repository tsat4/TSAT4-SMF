import bcrypt from 'bcryptjs';
import { mx, dbReady } from './db.js';
import { fail, wrap } from './http.js';
import { setSession } from './session.js';
import { CREATOR_ID, MEMBER_TABLES } from './access.js';
import { loadUser, publicUser, requireUser } from './users.js';

export function mountAuth(app) {
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, database: dbReady() });
  });

  app.post('/api/login', wrap(async (req, res) => {
    if (!mx || !process.env.SESSION_SECRET) return fail(res, 503, 'ยังไม่ได้ตั้งค่าการเชื่อมฐานข้อมูล');
    const employeeId = String(req.body.employeeId || '').trim();
    const password = String(req.body.password || '');
    const row = employeeId ? await loadUser(employeeId) : null;
    const match = row && await bcrypt.compare(password, row.password_hash);
    if (!row || row.status !== 'Active' || row.mt_main_employee?.status !== 'Active' || !match) {
      return fail(res, 401, 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง');
    }
    setSession(res, row.employee_id);
    res.json({ user: publicUser(row) });
  }));

  app.post('/api/logout', (req, res) => {
    setSession(res, '');
    res.json({ ok: true });
  });

  app.get('/api/me', wrap(requireUser), wrap(async (req, res) => {
    res.json({ user: req.user });
  }));

  app.post('/api/password', wrap(requireUser), wrap(async (req, res) => {
    const current = String(req.body.current || '');
    const next = String(req.body.password || '');
    if (next.length < 8) return fail(res, 400, 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัว');
    if (!(await bcrypt.compare(current, req.userHash))) return fail(res, 401, 'รหัสผ่านเดิมไม่ถูกต้อง');
    if (await bcrypt.compare(next, req.userHash)) return fail(res, 400, 'รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม');
    const { error } = await mx.from('mt_main_user').update({
      password_hash: await bcrypt.hash(next, 10),
      password_changed_at: new Date().toISOString()
    }).eq('employee_id', req.user.employeeId);
    if (error) return fail(res, 400, 'เปลี่ยนรหัสผ่านไม่ได้');
    res.json({ ok: true });
  }));
}

// First start on an empty database: create one login and make it admin of every module.
export async function bootstrap() {
  const employeeId = process.env.BOOTSTRAP_EMPLOYEE_ID;
  const password = process.env.BOOTSTRAP_PASSWORD;
  if (!mx || !employeeId || !password) return;
  const { count } = await mx.from('mt_main_user').select('employee_id', { count: 'exact', head: true });
  if (count) return;
  const { error } = await mx.from('mt_main_user').insert({
    employee_id: employeeId,
    password_hash: await bcrypt.hash(password, 10),
    role: 'employee',
    creator: employeeId === CREATOR_ID,
    password_changed_at: new Date().toISOString()
  });
  if (error) {
    console.error('bootstrap failed');
    return;
  }
  for (const table of Object.values(MEMBER_TABLES)) {
    const member = await mx.from(table).insert({ employee_id: employeeId, role: 'admin', status: 'Active' });
    if (member.error) {
      console.error('bootstrap failed');
      return;
    }
  }
  console.log('bootstrap user created');
}
