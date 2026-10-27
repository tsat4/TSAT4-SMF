import { mx } from '../../core/db.js';
import { fail, wrap, cleanTerm } from '../../core/http.js';
import { CREATOR_ID, ROLE_RANK, atLeast } from '../../core/access.js';
import { nameOf, requireUser } from '../../core/users.js';
import { centersForDepartments } from '../../core/master.js';

export function mountMembers(app, mod) {
  app.get('/api/employees', wrap(requireUser), atLeast(mod, 3), wrap(async (req, res) => {
    const term = cleanTerm(req.query.q);
    let query = mx.from('mt_main_employee')
      .select('employee_id,prefix,first_name,last_name,position,department,status')
      .eq('status', 'Active')
      .order('employee_id')
      .limit(20);
    if (term) query = query.or(`employee_id.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`);
    const { data, error } = await query;
    if (error) return fail(res, 400, 'ค้นหาพนักงานไม่ได้');
    res.json({ employees: (data || []).map((row) => ({ ...row, name: nameOf(row) })) });
  }));

  app.get('/api/users', wrap(requireUser), atLeast(mod, 3), wrap(async (req, res) => {
    const { data, error } = await mx.from('mt_sto_user')
      .select('employee_id,role,status,department,mt_main_user!mt_sto_user_employee_id_fkey(creator,mt_main_employee!mt_main_user_employee_id_fkey(prefix,first_name,last_name,department,position))')
      .order('employee_id');
    if (error) return fail(res, 400, 'อ่านผู้ใช้ไม่ได้');
    const users = (data || []).map((row) => {
      const account = row.mt_main_user || {};
      const employee = account.mt_main_employee || {};
      return {
        employeeId: row.employee_id,
        name: nameOf(employee),
        department: employee.department || row.department || '',
        role: row.role,
        status: row.status,
        creator: Boolean(account.creator) || row.employee_id === CREATOR_ID,
        founder: row.employee_id === CREATOR_ID
      };
    });
    const centers = await centersForDepartments(users.map((row) => row.department));
    res.json({ users: users.map((row) => ({ ...row, costcenters: centers.get(row.department) || [] })) });
  }));

  app.post('/api/users', wrap(requireUser), atLeast(mod, 3), wrap(async (req, res) => {
    const employeeId = String(req.body.employeeId || '').trim();
    const role = ROLE_RANK[req.body.role] ? req.body.role : '';
    if (!employeeId || !role) return fail(res, 400, 'ระบุพนักงานและบทบาท');
    if (employeeId === CREATOR_ID && role !== 'admin') return fail(res, 400, 'ผู้สร้างระบบเป็น Admin เสมอ');
    const { data: employee, error: employeeError } = await mx.from('mt_main_employee')
      .select('employee_id,status,department').eq('employee_id', employeeId).maybeSingle();
    if (employeeError || !employee || employee.status !== 'Active') return fail(res, 400, 'พนักงานนี้ใช้งานไม่ได้');
    const department = String(employee.department || '').trim();
    if (!department) return fail(res, 400, 'พนักงานนี้ยังไม่มีหน่วยงาน');
    const existing = await mx.from('mt_main_user').select('employee_id').eq('employee_id', employeeId).maybeSingle();
    if (existing.error) return fail(res, 400, 'ตรวจบัญชีไม่ได้');
    if (!existing.data) return fail(res, 400, 'พนักงานนี้ยังไม่ได้เข้าสู่ระบบครั้งแรก');
    const status = ['Active', 'Inactive'].includes(req.body.status) ? req.body.status : 'Active';
    const { error } = await mx.from('mt_sto_user').upsert({
      employee_id: employeeId,
      role: employeeId === CREATOR_ID ? 'admin' : role,
      status: employeeId === CREATOR_ID ? 'Active' : status,
      department
    }, { onConflict: 'employee_id' });
    if (error) return fail(res, 400, 'เพิ่มรายชื่อ Usage ไม่ได้');
    res.status(201).json({ ok: true });
  }));

  app.patch('/api/users/:employeeId', wrap(requireUser), atLeast(mod, 3), wrap(async (req, res) => {
    const employeeId = req.params.employeeId;
    const patch = {};
    if (req.body.role) {
      if (!ROLE_RANK[req.body.role]) return fail(res, 400, 'บทบาทไม่ถูกต้อง');
      if (employeeId === CREATOR_ID && req.body.role !== 'admin') return fail(res, 400, 'ผู้สร้างระบบเป็น Admin เสมอ');
      patch.role = req.body.role;
    }
    if (req.body.status) {
      if (!['Active', 'Inactive'].includes(req.body.status)) return fail(res, 400, 'สถานะไม่ถูกต้อง');
      if (employeeId === CREATOR_ID && req.body.status !== 'Active') return fail(res, 400, 'ปิดสิทธิ์ผู้สร้างระบบไม่ได้');
      patch.status = req.body.status;
    }
    if (!Object.keys(patch).length) return fail(res, 400, 'ไม่มีข้อมูลให้แก้ไข');
    if (Object.keys(patch).length) {
      const { data, error } = await mx.from('mt_sto_user').update(patch).eq('employee_id', employeeId).select('employee_id');
      if (error || !data?.length) return fail(res, 400, 'แก้ไขผู้ใช้ไม่ได้');
    }
    res.json({ ok: true });
  }));

  app.delete('/api/users/:employeeId', wrap(requireUser), atLeast(mod, 3), wrap(async (req, res) => {
    const employeeId = req.params.employeeId;
    if (!/^[A-Za-z0-9]+$/.test(employeeId)) return fail(res, 400, 'รหัสพนักงานไม่ถูกต้อง');
    if (employeeId === CREATOR_ID) return fail(res, 400, 'นำผู้สร้างระบบออกจาก Usage ไม่ได้');
    if (employeeId === req.user.employeeId) return fail(res, 400, 'นำบัญชีที่กำลังใช้งานอยู่ออกไม่ได้');
    const used = await mx.from('tx_sto_requisition').select('id', { count: 'exact', head: true })
      .or(`requested_by.eq.${employeeId},accepted_by.eq.${employeeId},received_by.eq.${employeeId}`);
    if (used.count) {
      const { error } = await mx.from('mt_sto_user').update({ status: 'Inactive' }).eq('employee_id', employeeId);
      if (error) return fail(res, 400, 'ปิดสิทธิ์ไม่ได้');
      return res.json({ ok: true, inactive: true });
    }
    const { error } = await mx.from('mt_sto_user').delete().eq('employee_id', employeeId);
    if (error) return fail(res, 400, 'นำออกจาก Usage ไม่ได้');
    res.json({ ok: true });
  }));
}
