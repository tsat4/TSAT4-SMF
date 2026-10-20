import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const CREATOR_ID = '2102899';
const DRAFT_COSTCENTER = '-';
const USAGE_RANK = { viewer: 1, user: 2, admin: 3 };

function db(url, key) {
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const mx = db(process.env.MX_SUPABASE_URL, process.env.MX_SUPABASE_SECRET_KEY);
const tx = db(process.env.TX_SUPABASE_URL, process.env.TX_SUPABASE_SECRET_KEY);

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function readSession(token) {
  if (!token || !process.env.SESSION_SECRET) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const data = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (!data?.employeeId || !data.exp || data.exp < Date.now()) return null;
  return data;
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSession(res, employeeId) {
  const token = employeeId
    ? sign({ employeeId, exp: Date.now() + SESSION_MS })
    : '';
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `smf_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${employeeId ? SESSION_MS / 1000 : 0}${secure}`);
}

function qtyOf(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000) / 1000;
}

function amountOf(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1000) / 1000;
}

function cleanTerm(value) {
  return String(value || '').trim().replace(/[%_,]/g, '').slice(0, 40);
}

function fail(res, status, error) {
  res.status(status).json({ error });
}

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error(err);
    if (!res.headersSent) fail(res, 500, 'ระบบขัดข้อง');
  });
}

function nameOf(employee) {
  if (!employee) return '';
  return [employee.prefix, employee.first_name, employee.last_name].filter(Boolean).join(' ');
}

async function loadUser(employeeId) {
  const { data, error } = await mx
    .from('mt_main_user')
    .select('employee_id,creator,status,password_expires_at,password_hash,mt_main_employee(prefix,first_name,last_name,department,position,status)')
    .eq('employee_id', employeeId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const member = await mx.from('mt_sto_user').select('role,status,department').eq('employee_id', employeeId).maybeSingle();
  if (member.error) throw member.error;
  data.usage = member.data || null;
  return data;
}

function usageRoleOf(row) {
  const creator = Boolean(row.creator) || row.employee_id === CREATOR_ID;
  if (creator) return 'admin';
  if (row.usage?.status === 'Active') return row.usage.role;
  return null;
}

function publicUser(row) {
  const employee = row.mt_main_employee || {};
  const creator = Boolean(row.creator) || row.employee_id === CREATOR_ID;
  return {
    employeeId: row.employee_id,
    creator,
    usageRole: usageRoleOf(row),
    status: row.status,
    name: nameOf(employee),
    department: row.usage?.department || '',
    position: employee.position || '',
    passwordExpiresAt: row.password_expires_at,
    passwordExpired: new Date(row.password_expires_at).getTime() <= Date.now()
  };
}

function usageRank(user) {
  if (user?.creator) return 3;
  return USAGE_RANK[user?.usageRole] || 0;
}

function usageAtLeast(level) {
  return (req, res, next) => {
    if (usageRank(req.user) < level) return fail(res, 403, 'ไม่มีสิทธิ์ใน Usage');
    next();
  };
}

async function requireUser(req, res, next) {
  if (!mx || !tx || !process.env.SESSION_SECRET) return fail(res, 503, 'ยังไม่ได้ตั้งค่าการเชื่อมฐานข้อมูล');
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

async function adjustStock(costcenter, material, delta) {
  const { error } = await mx.rpc('mt_sto_stock_adjust', {
    p_costcenter: costcenter,
    p_material: material,
    p_delta: delta
  });
  if (error) {
    const text = error.message || '';
    if (text.includes('not enough')) throw new Error('ยอดคงเหลือไม่พอ');
    throw new Error('ปรับยอดคงเหลือไม่ได้');
  }
}

async function materialMap(codes) {
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await mx
    .from('mt_sto_usage')
    .select('material,material_description,bun')
    .in('material', unique);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.material, row]));
}

async function centersForDepartments(departments) {
  const names = [...new Set(departments.map((name) => String(name || '').trim()).filter(Boolean))];
  const grouped = new Map();
  if (!names.length) return grouped;
  const { data, error } = await mx.from('mt_main_costcenter')
    .select('costcenter,object_name,department')
    .eq('status', 'Active')
    .in('department', names)
    .order('costcenter');
  if (error) throw error;
  for (const row of data || []) {
    const list = grouped.get(row.department) || [];
    list.push({ costcenter: row.costcenter, objectName: row.object_name });
    grouped.set(row.department, list);
  }
  return grouped;
}

async function costcenterMap(codes) {
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await mx
    .from('mt_main_costcenter')
    .select('costcenter,object_name,department')
    .in('costcenter', unique);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.costcenter, row]));
}

async function decorate(headers, linesById = new Map()) {
  const centers = await costcenterMap(headers.map((row) => row.costcenter));
  const materials = await materialMap([...linesById.values()].flat().map((line) => line.material));
  return headers.map((row) => ({
    ...row,
    costcenterName: centers.get(row.costcenter)?.object_name || '',
    department: centers.get(row.costcenter)?.department || '',
    lines: (linesById.get(row.id) || []).map((line) => ({
      ...line,
      materialDescription: materials.get(line.material)?.material_description || '',
      bun: materials.get(line.material)?.bun || ''
    }))
  }));
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, database: Boolean(mx && tx && process.env.SESSION_SECRET) });
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

app.get('/api/summary', wrap(requireUser), usageAtLeast(1), wrap(async (req, res) => {
  const open = await tx.from('tx_sto_requisition').select('id', { count: 'exact', head: true })
    .eq('requested_by', req.user.employeeId)
    .in('status', ['cart', 'submitted', 'accepted', 'preparing', 'ready']);
  const ready = await tx.from('tx_sto_requisition').select('id', { count: 'exact', head: true })
    .eq('requested_by', req.user.employeeId)
    .eq('status', 'ready');
  let queue = 0;
  if (usageRank(req.user) >= 3) {
    const rows = await tx.from('tx_sto_requisition').select('id', { count: 'exact', head: true })
      .in('status', ['submitted', 'accepted', 'preparing']);
    queue = rows.count || 0;
  }
  res.json({ open: open.count || 0, ready: ready.count || 0, queue });
}));

app.get('/api/employees', wrap(requireUser), usageAtLeast(3), wrap(async (req, res) => {
  const term = cleanTerm(req.query.q);
  let query = mx.from('mt_main_employee')
    .select('employee_id,prefix,first_name,last_name,position,department,status')
    .eq('status', 'Active')
    .order('employee_id')
    .limit(20);
  if (term) query = query.or(`employee_id.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`);
  const { data, error } = await query;
  if (error) return fail(res, 400, 'ค้นหาพนักงานไม่ได้');
  const centers = await centersForDepartments((data || []).map((row) => row.department));
  res.json({
    employees: (data || []).map((row) => ({
      ...row,
      name: nameOf(row),
      costcenters: centers.get(row.department) || []
    }))
  });
}));

app.get('/api/users', wrap(requireUser), usageAtLeast(3), wrap(async (req, res) => {
  const { data, error } = await mx.from('mt_sto_user')
    .select('employee_id,role,status,department,mt_main_user(creator,password_expires_at,mt_main_employee(prefix,first_name,last_name,department,position))')
    .order('employee_id');
  if (error) return fail(res, 400, 'อ่านผู้ใช้ไม่ได้');
  const users = (data || []).map((row) => {
    const account = row.mt_main_user || {};
    const employee = account.mt_main_employee || {};
    return {
      employeeId: row.employee_id,
      name: nameOf(employee),
      department: row.department || '',
      role: row.role,
      status: row.status,
      creator: Boolean(account.creator) || row.employee_id === CREATOR_ID,
      passwordExpiresAt: account.password_expires_at,
      passwordExpired: account.password_expires_at ? new Date(account.password_expires_at).getTime() <= Date.now() : false
    };
  });
  const centers = await centersForDepartments(users.map((row) => row.department));
  res.json({ users: users.map((row) => ({ ...row, costcenters: centers.get(row.department) || [] })) });
}));

app.post('/api/users', wrap(requireUser), usageAtLeast(3), wrap(async (req, res) => {
  const employeeId = String(req.body.employeeId || '').trim();
  const password = String(req.body.password || '');
  const role = USAGE_RANK[req.body.role] ? req.body.role : '';
  if (!employeeId || !role) return fail(res, 400, 'ระบุพนักงานและบทบาท');
  if (employeeId === CREATOR_ID && role !== 'admin') return fail(res, 400, 'ผู้สร้างระบบเป็น Admin เสมอ');
  const { data: employee, error: employeeError } = await mx.from('mt_main_employee')
    .select('employee_id,status').eq('employee_id', employeeId).maybeSingle();
  if (employeeError || !employee || employee.status !== 'Active') return fail(res, 400, 'พนักงานนี้ใช้งานไม่ได้');
  const existing = await mx.from('mt_main_user').select('employee_id').eq('employee_id', employeeId).maybeSingle();
  if (existing.error) return fail(res, 400, 'ตรวจบัญชีไม่ได้');
  if (!existing.data) {
    if (password.length < 8) return fail(res, 400, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัว');
    const created = await mx.from('mt_main_user').insert({
      employee_id: employeeId,
      password_hash: await bcrypt.hash(password, 10),
      role: 'employee',
      creator: employeeId === CREATOR_ID,
      password_changed_at: new Date().toISOString()
    });
    if (created.error) return fail(res, 400, 'เพิ่มบัญชีเข้าสู่ระบบไม่ได้');
  }
  const status = ['Active', 'Inactive'].includes(req.body.status) ? req.body.status : 'Active';
  const department = await usageDepartment(req.body.department);
  if (!department) return fail(res, 400, 'เลือกหน่วยงานที่มีศูนย์ต้นทุน');
  const { error } = await mx.from('mt_sto_user').upsert({
    employee_id: employeeId,
    role: employeeId === CREATOR_ID ? 'admin' : role,
    status: employeeId === CREATOR_ID ? 'Active' : status,
    department
  }, { onConflict: 'employee_id' });
  if (error) return fail(res, 400, 'เพิ่มรายชื่อ Usage ไม่ได้');
  res.status(201).json({ ok: true });
}));

app.patch('/api/users/:employeeId', wrap(requireUser), usageAtLeast(3), wrap(async (req, res) => {
  const employeeId = req.params.employeeId;
  const patch = {};
  if (req.body.role) {
    if (!USAGE_RANK[req.body.role]) return fail(res, 400, 'บทบาทไม่ถูกต้อง');
    if (employeeId === CREATOR_ID && req.body.role !== 'admin') return fail(res, 400, 'ผู้สร้างระบบเป็น Admin เสมอ');
    patch.role = req.body.role;
  }
  if (req.body.status) {
    if (!['Active', 'Inactive'].includes(req.body.status)) return fail(res, 400, 'สถานะไม่ถูกต้อง');
    if (employeeId === CREATOR_ID && req.body.status !== 'Active') return fail(res, 400, 'ปิดสิทธิ์ผู้สร้างระบบไม่ได้');
    patch.status = req.body.status;
  }
  if (req.body.department != null) {
    const department = await usageDepartment(req.body.department);
    if (!department) return fail(res, 400, 'เลือกหน่วยงานที่มีศูนย์ต้นทุน');
    patch.department = department;
  }
  if (req.body.password) {
    if (String(req.body.password).length < 8) return fail(res, 400, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัว');
    const login = await mx.from('mt_main_user').update({
      password_hash: await bcrypt.hash(String(req.body.password), 10),
      password_changed_at: new Date().toISOString()
    }).eq('employee_id', employeeId).select('employee_id');
    if (login.error || !login.data?.length) return fail(res, 400, 'เปลี่ยนรหัสผ่านไม่ได้');
  }
  if (!Object.keys(patch).length && !req.body.password) return fail(res, 400, 'ไม่มีข้อมูลให้แก้ไข');
  if (Object.keys(patch).length) {
    const { data, error } = await mx.from('mt_sto_user').update(patch).eq('employee_id', employeeId).select('employee_id');
    if (error || !data?.length) return fail(res, 400, 'แก้ไขผู้ใช้ไม่ได้');
  }
  res.json({ ok: true });
}));

app.delete('/api/users/:employeeId', wrap(requireUser), usageAtLeast(3), wrap(async (req, res) => {
  const employeeId = req.params.employeeId;
  if (!/^[A-Za-z0-9]+$/.test(employeeId)) return fail(res, 400, 'รหัสพนักงานไม่ถูกต้อง');
  if (employeeId === CREATOR_ID) return fail(res, 400, 'นำผู้สร้างระบบออกจาก Usage ไม่ได้');
  if (employeeId === req.user.employeeId) return fail(res, 400, 'นำบัญชีที่กำลังใช้งานอยู่ออกไม่ได้');
  const used = await tx.from('tx_sto_requisition').select('id', { count: 'exact', head: true })
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

app.get('/api/usage-materials', wrap(requireUser), usageAtLeast(3), wrap(async (req, res) => {
  const term = cleanTerm(req.query.q);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  let query = mx.from('mt_sto_usage')
    .select('no,material,material_description,bun,price,crcy,status', { count: 'exact' })
    .order('material')
    .range(offset, offset + 49);
  if (term) query = query.or(`material.ilike.%${term}%,material_description.ilike.%${term}%`);
  const { data, error, count } = await query;
  if (error) return fail(res, 400, 'อ่านรายการไม่ได้');
  res.json({ materials: data || [], total: count || 0 });
}));

app.post('/api/usage-materials', wrap(requireUser), usageAtLeast(3), wrap(async (req, res) => {
  const material = String(req.body.material || '').trim();
  const materialDescription = String(req.body.materialDescription || '').trim();
  const bun = String(req.body.bun || '').trim();
  const crcy = String(req.body.crcy || 'THB').trim();
  const price = amountOf(req.body.price);
  const status = ['Active', 'Inactive'].includes(req.body.status) ? req.body.status : '';
  if (!material || !materialDescription || !bun || !crcy || price == null || !status) return fail(res, 400, 'ระบุรายการให้ครบ');
  const last = await mx.from('mt_sto_usage').select('no').order('no', { ascending: false }).limit(1).maybeSingle();
  if (last.error) return fail(res, 400, 'เพิ่มรายการไม่ได้');
  const { error } = await mx.from('mt_sto_usage').insert({
    no: Number(last.data?.no || 0) + 1,
    material,
    material_description: materialDescription,
    bun,
    price,
    crcy,
    status
  });
  if (error) return fail(res, 400, 'เพิ่มรายการไม่ได้');
  res.status(201).json({ ok: true });
}));

app.patch('/api/usage-materials/:material', wrap(requireUser), usageAtLeast(3), wrap(async (req, res) => {
  const materialDescription = String(req.body.materialDescription || '').trim();
  const bun = String(req.body.bun || '').trim();
  const crcy = String(req.body.crcy || '').trim();
  const price = amountOf(req.body.price);
  const status = ['Active', 'Inactive'].includes(req.body.status) ? req.body.status : '';
  if (!materialDescription || !bun || !crcy || price == null || !status) return fail(res, 400, 'ระบุรายการให้ครบ');
  const { data, error } = await mx.from('mt_sto_usage').update({
    material_description: materialDescription,
    bun,
    price,
    crcy,
    status
  }).eq('material', req.params.material).select('material');
  if (error || !data?.length) return fail(res, 400, 'แก้ไขรายการไม่ได้');
  res.json({ ok: true });
}));

app.delete('/api/usage-materials/:material', wrap(requireUser), usageAtLeast(3), wrap(async (req, res) => {
  const used = await mx.from('mt_sto_stock').select('material', { count: 'exact', head: true }).eq('material', req.params.material);
  if (used.count) return fail(res, 400, 'รายการนี้มียอดคงเหลือ ลบไม่ได้');
  const { error } = await mx.from('mt_sto_usage').delete().eq('material', req.params.material);
  if (error) return fail(res, 400, 'ลบรายการไม่ได้');
  res.json({ ok: true });
}));

app.get('/api/departments', wrap(requireUser), usageAtLeast(3), wrap(async (req, res) => {
  const { data, error } = await mx.from('mt_main_costcenter').select('department').eq('status', 'Active');
  if (error) return fail(res, 400, 'อ่านหน่วยงานไม่ได้');
  const departments = [...new Set((data || []).map((row) => row.department).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  res.json({ departments });
}));

app.get('/api/pay-centers', wrap(requireUser), usageAtLeast(1), wrap(async (req, res) => {
  const department = req.user.department || '';
  const centers = await centersForDepartments([department]);
  res.json({ department, costcenters: centers.get(department) || [] });
}));

app.get('/api/costcenters', wrap(requireUser), usageAtLeast(3), wrap(async (req, res) => {
  const term = cleanTerm(req.query.q);
  let query = mx.from('mt_main_costcenter')
    .select('costcenter,object_name,department,status')
    .eq('status', 'Active')
    .order('costcenter')
    .limit(30);
  if (term) query = query.or(`costcenter.ilike.%${term}%,object_name.ilike.%${term}%,department.ilike.%${term}%`);
  const { data, error } = await query;
  if (error) return fail(res, 400, 'อ่านศูนย์ต้นทุนไม่ได้');
  res.json({ costcenters: data || [] });
}));

app.get('/api/buyers', wrap(requireUser), usageAtLeast(2), wrap(async (req, res) => {
  const { data, error } = await mx.from('mt_sto_buyer')
    .select('costcenter,status,mt_main_costcenter(object_name,department)')
    .order('costcenter');
  if (error) return fail(res, 400, 'อ่านศูนย์ต้นทุนที่สั่งซื้อไม่ได้');
  const rows = (usageRank(req.user) < 3 ? (data || []).filter((row) => row.status === 'Active') : data || [])
    .map((row) => ({
      costcenter: row.costcenter,
      status: row.status,
      objectName: row.mt_main_costcenter?.object_name || '',
      department: row.mt_main_costcenter?.department || ''
    }));
  res.json({ buyers: rows });
}));

app.post('/api/buyers', wrap(requireUser), usageAtLeast(3), wrap(async (req, res) => {
  const costcenter = String(req.body.costcenter || '').trim();
  const { data: center } = await mx.from('mt_main_costcenter').select('costcenter,status').eq('costcenter', costcenter).maybeSingle();
  if (!center || center.status !== 'Active') return fail(res, 400, 'ศูนย์ต้นทุนนี้ใช้งานไม่ได้');
  const { error } = await mx.from('mt_sto_buyer').insert({ costcenter });
  if (error) return fail(res, 400, 'เพิ่มศูนย์ต้นทุนที่สั่งซื้อไม่ได้');
  res.status(201).json({ ok: true });
}));

app.patch('/api/buyers/:costcenter', wrap(requireUser), usageAtLeast(3), wrap(async (req, res) => {
  if (!['Active', 'Inactive'].includes(req.body.status)) return fail(res, 400, 'สถานะไม่ถูกต้อง');
  const { data, error } = await mx.from('mt_sto_buyer').update({ status: req.body.status })
    .eq('costcenter', req.params.costcenter).select('costcenter');
  if (error || !data?.length) return fail(res, 400, 'แก้ไขศูนย์ต้นทุนไม่ได้');
  res.json({ ok: true });
}));

app.get('/api/materials', wrap(requireUser), usageAtLeast(1), wrap(async (req, res) => {
  const term = cleanTerm(req.query.q);
  let query = mx.from('mt_sto_usage')
    .select('material,material_description,bun,status')
    .eq('status', 'Active')
    .order('material')
    .limit(20);
  if (term) query = query.or(`material.ilike.%${term}%,material_description.ilike.%${term}%`);
  const { data, error } = await query;
  if (error) return fail(res, 400, 'ค้นหารายการไม่ได้');
  res.json({ materials: data || [] });
}));

app.get('/api/stock', wrap(requireUser), usageAtLeast(2), wrap(async (req, res) => {
  const costcenter = String(req.query.costcenter || '').trim();
  if (!costcenter) return fail(res, 400, 'เลือกศูนย์ต้นทุน');
  const term = cleanTerm(req.query.q);
  let query = mx.from('mt_sto_stock')
    .select('costcenter,material,min_qty,current_qty,max_qty,mt_sto_usage(material_description,bun,status)')
    .eq('costcenter', costcenter)
    .order('material')
    .limit(100);
  if (term) {
    const found = await mx.from('mt_sto_usage').select('material').or(`material.ilike.%${term}%,material_description.ilike.%${term}%`).limit(100);
    const codes = (found.data || []).map((row) => row.material);
    if (!codes.length) return res.json({ stock: [] });
    query = query.in('material', codes);
  }
  const { data, error } = await query;
  if (error) return fail(res, 400, 'อ่านยอดคงเหลือไม่ได้');
  res.json({
    stock: (data || []).map((row) => ({
      costcenter: row.costcenter,
      material: row.material,
      minQty: Number(row.min_qty),
      currentQty: Number(row.current_qty),
      maxQty: Number(row.max_qty),
      materialDescription: row.mt_sto_usage?.material_description || '',
      bun: row.mt_sto_usage?.bun || '',
      low: Number(row.current_qty) <= Number(row.min_qty)
    }))
  });
}));

app.put('/api/stock', wrap(requireUser), usageAtLeast(2), wrap(async (req, res) => {
  const costcenter = String(req.body.costcenter || '').trim();
  const material = String(req.body.material || '').trim();
  const minQty = amountOf(req.body.minQty);
  const currentQty = amountOf(req.body.currentQty);
  const maxQty = amountOf(req.body.maxQty);
  if (!costcenter || !material || minQty == null || currentQty == null || maxQty == null) return fail(res, 400, 'ระบุยอดให้ครบ');
  if (maxQty < minQty) return fail(res, 400, 'Max ต้องไม่ต่ำกว่า Min');
  const center = await mx.from('mt_main_costcenter').select('department,status').eq('costcenter', costcenter).maybeSingle();
  if (!center.data || center.data.status !== 'Active' || center.data.department !== req.user.department) return fail(res, 400, 'ศูนย์ต้นทุนนี้ไม่ใช่ของหน่วยงานคุณ');
  const buyer = await mx.from('mt_sto_buyer').upsert({ costcenter, status: 'Active' }, { onConflict: 'costcenter' });
  if (buyer.error) return fail(res, 400, 'เปิดศูนย์ต้นทุนนี้ให้เบิกจ่ายไม่ได้');
  const item = await mx.from('mt_sto_usage').select('status').eq('material', material).maybeSingle();
  if (!item.data || item.data.status !== 'Active') return fail(res, 400, 'รายการนี้ใช้งานไม่ได้');
  const { error } = await mx.from('mt_sto_stock').upsert({
    costcenter,
    material,
    min_qty: minQty,
    current_qty: currentQty,
    max_qty: maxQty
  }, { onConflict: 'costcenter,material' });
  if (error) return fail(res, 400, 'บันทึกยอดไม่ได้');
  res.json({ ok: true });
}));

app.get('/api/requisitions', wrap(requireUser), usageAtLeast(1), wrap(async (req, res) => {
  const scope = req.query.scope === 'queue' ? 'queue' : 'mine';
  if (scope === 'queue' && usageRank(req.user) < 3) return fail(res, 403, 'จัดเตรียมและจ่ายสำหรับ Admin');
  let query = tx.from('tx_sto_requisition').select('*').order('created_at', { ascending: false }).limit(50);
  if (scope === 'mine') query = query.eq('requested_by', req.user.employeeId);
  else query = query.in('status', ['submitted', 'accepted', 'preparing', 'ready']);
  if (req.query.status) query = query.eq('status', String(req.query.status));
  const { data, error } = await query;
  if (error) return fail(res, 400, 'อ่านใบเบิกไม่ได้');
  const rows = await decorate(data || []);
  res.json({ requisitions: rows });
}));

app.get('/api/requisitions/:id', wrap(requireUser), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { data: header, error } = await tx.from('tx_sto_requisition').select('*').eq('id', id).maybeSingle();
  if (error || !header) return fail(res, 404, 'ไม่พบใบเบิก');
  if (header.requested_by !== req.user.employeeId && usageRank(req.user) < 3) return fail(res, 403, 'เปิดใบเบิกนี้ไม่ได้');
  const { data: lines, error: lineError } = await tx.from('tx_sto_requisition_line').select('*').eq('requisition_id', id).order('id');
  if (lineError) return fail(res, 400, 'อ่านรายการไม่ได้');
  const [row] = await decorate([header], new Map([[id, lines || []]]));
  res.json({ requisition: row });
}));

app.post('/api/requisitions', wrap(requireUser), usageAtLeast(1), wrap(async (req, res) => {
  let costcenter = String(req.body.costcenter || '').trim();
  if (costcenter) {
    if (!(await ownCenter(req, costcenter))) return fail(res, 400, 'เลือกศูนย์ต้นทุนในขอบเขตของคุณ');
  } else costcenter = DRAFT_COSTCENTER;
  const { data, error } = await tx.from('tx_sto_requisition')
    .insert({ requested_by: req.user.employeeId, costcenter })
    .select('id')
    .single();
  if (error) return fail(res, 400, 'เปิดตะกร้าไม่ได้');
  res.status(201).json({ id: data.id });
}));

app.post('/api/requisitions/:id/lines', wrap(requireUser), usageAtLeast(1), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const material = String(req.body.material || '').trim();
  const qty = qtyOf(req.body.qty);
  const header = await ownCart(req, id);
  if (!header) return fail(res, 400, 'แก้ได้เฉพาะตะกร้าของตนเอง');
  if (!material || !qty) return fail(res, 400, 'เลือกรายการและจำนวน');
  const costcenter = String(req.body.costcenter || header.costcenter).trim();
  if (!(await ownCenter(req, costcenter))) return fail(res, 400, 'เลือกศูนย์ต้นทุนในขอบเขตของคุณ');
  if (costcenter !== header.costcenter) {
    const applied = await tx.rpc('tx_sto_apply_costcenter', { p_id: id, p_employee: req.user.employeeId, p_costcenter: costcenter });
    if (applied.error) return fail(res, 400, 'บันทึกศูนย์ต้นทุนไม่ได้');
    header.costcenter = costcenter;
  }
  const item = await mx.from('mt_sto_usage').select('status').eq('material', material).maybeSingle();
  if (!item.data || item.data.status !== 'Active') return fail(res, 400, 'รายการนี้ใช้งานไม่ได้');
  const existing = await tx.from('tx_sto_requisition_line').select('id,qty').eq('requisition_id', id).eq('material', material).maybeSingle();
  if (existing.data) {
    const { error } = await tx.from('tx_sto_requisition_line').update({ qty: qtyOf(Number(existing.data.qty) + qty) }).eq('id', existing.data.id);
    if (error) return fail(res, 400, 'เพิ่มจำนวนไม่ได้');
  } else {
    const { error } = await tx.from('tx_sto_requisition_line').insert({
      requisition_id: id,
      costcenter: header.costcenter,
      material,
      qty
    });
    if (error) return fail(res, 400, 'ใส่ตะกร้าไม่ได้');
  }
  res.json({ ok: true });
}));

app.patch('/api/requisitions/:id/lines/:lineId', wrap(requireUser), usageAtLeast(1), wrap(async (req, res) => {
  const qty = qtyOf(req.body.qty);
  const header = await ownCart(req, Number(req.params.id));
  if (!header || !qty) return fail(res, 400, 'แก้จำนวนในตะกร้าไม่ได้');
  const { data, error } = await tx.from('tx_sto_requisition_line').update({ qty })
    .eq('id', Number(req.params.lineId)).eq('requisition_id', header.id).select('id');
  if (error || !data?.length) return fail(res, 400, 'แก้จำนวนไม่ได้');
  res.json({ ok: true });
}));

app.delete('/api/requisitions/:id/lines/:lineId', wrap(requireUser), usageAtLeast(1), wrap(async (req, res) => {
  const header = await ownCart(req, Number(req.params.id));
  if (!header) return fail(res, 400, 'เอาออกจากตะกร้าไม่ได้');
  const { error } = await tx.from('tx_sto_requisition_line').delete()
    .eq('id', Number(req.params.lineId)).eq('requisition_id', header.id);
  if (error) return fail(res, 400, 'เอาออกจากตะกร้าไม่ได้');
  res.json({ ok: true });
}));

app.post('/api/requisitions/:id/status', wrap(requireUser), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body.status || '');
  const { data: header, error } = await tx.from('tx_sto_requisition').select('*').eq('id', id).maybeSingle();
  if (error || !header) return fail(res, 404, 'ไม่พบใบเบิก');
  const mine = header.requested_by === req.user.employeeId;
  const admin = usageRank(req.user) >= 3;
  try {
    if (status === 'submitted' && mine && header.status === 'cart') {
      const costcenter = String(req.body.costcenter || header.costcenter || '').trim();
      if (!(await ownCenter(req, costcenter))) return fail(res, 400, 'เลือกศูนย์ต้นทุนในขอบเขตของคุณ');
      const { data: lines, error: lineError } = await tx.from('tx_sto_requisition_line').select('material').eq('requisition_id', id);
      if (lineError || !lines?.length) return fail(res, 400, 'ตะกร้าว่าง');
      for (const line of lines) {
        const stock = await mx.from('mt_sto_stock').select('material').eq('costcenter', costcenter).eq('material', line.material).maybeSingle();
        if (!stock.data) return fail(res, 400, `ศูนย์ต้นทุนนี้ยังไม่มียอดของ ${line.material}`);
      }
      if (costcenter !== header.costcenter) {
        const applied = await tx.rpc('tx_sto_apply_costcenter', { p_id: id, p_employee: req.user.employeeId, p_costcenter: costcenter });
        if (applied.error) return fail(res, 400, 'บันทึกศูนย์ต้นทุนไม่ได้');
      }
      await move(id, 'cart', { status: 'submitted' });
    } else if (status === 'cancelled' && mine && ['cart', 'submitted', 'accepted', 'preparing', 'ready'].includes(header.status)) {
      await move(id, header.status, { status: 'cancelled' });
    } else if (status === 'accepted' && admin && header.status === 'submitted') {
      await move(id, 'submitted', { status: 'accepted', accepted_by: req.user.employeeId });
    } else if (status === 'preparing' && admin && header.status === 'accepted') {
      await move(id, 'accepted', { status: 'preparing' });
    } else if (status === 'ready' && admin && header.status === 'preparing') {
      await move(id, 'preparing', { status: 'ready' });
    } else if (status === 'received' && mine && header.status === 'ready') {
      await receive(header);
    } else {
      return fail(res, 400, 'เปลี่ยนสถานะนี้ไม่ได้');
    }
  } catch (err) {
    return fail(res, 400, err.message || 'เปลี่ยนสถานะไม่ได้');
  }
  res.json({ ok: true });
}));

async function usageDepartment(name) {
  const department = String(name || '').trim();
  if (!department) return '';
  const found = await mx.from('mt_main_costcenter').select('department').eq('department', department).eq('status', 'Active').limit(1);
  if (found.error || !found.data?.length) return '';
  return department;
}

async function ownCenter(req, costcenter) {
  const center = await mx.from('mt_main_costcenter').select('department,status').eq('costcenter', costcenter).maybeSingle();
  if (!center.data || center.data.status !== 'Active' || center.data.department !== req.user.department) return null;
  return center.data;
}

async function ownCart(req, id) {
  const { data } = await tx.from('tx_sto_requisition').select('id,requested_by,costcenter,status').eq('id', id).maybeSingle();
  if (!data || data.requested_by !== req.user.employeeId || data.status !== 'cart') return null;
  return data;
}

async function move(id, from, patch) {
  const { data, error } = await tx.from('tx_sto_requisition').update(patch).eq('id', id).eq('status', from).select('id');
  if (error || !data?.length) throw new Error('เปลี่ยนสถานะไม่ได้');
}

async function receive(header) {
  const { data: lines, error } = await tx.from('tx_sto_requisition_line')
    .select('costcenter,material,qty').eq('requisition_id', header.id);
  if (error || !lines?.length) throw new Error('ใบเบิกไม่มีรายการ');
  const done = [];
  try {
    for (const line of lines) {
      await adjustStock(line.costcenter, line.material, -Number(line.qty));
      done.push(line);
    }
    await move(header.id, 'ready', { status: 'received', received_by: header.requested_by });
  } catch (err) {
    for (const line of done) {
      try {
        await adjustStock(line.costcenter, line.material, Number(line.qty));
      } catch (restoreErr) {
        console.error(restoreErr);
      }
    }
    throw err;
  }
}

const ADMIN_TABLES = {
  mt_main_employee: { db: 'mx', pk: ['employee_id'], columns: [
    ['employee_id', 'text', true], ['prefix', 'text'], ['first_name', 'text', true], ['last_name', 'text', true],
    ['position', 'text'], ['level', 'text'], ['department', 'text'], ['status', 'status', true]
  ] },
  mt_main_costcenter: { db: 'mx', pk: ['costcenter'], columns: [
    ['costcenter', 'text', true], ['object_name', 'text', true], ['group_name', 'group', true], ['department', 'text', true], ['status', 'status', true]
  ] },
  mt_sto_usage: { db: 'mx', pk: ['material'], columns: [
    ['no', 'int'], ['material', 'text', true], ['material_description', 'text', true], ['bun', 'text', true],
    ['price', 'money', true], ['crcy', 'text', true], ['status', 'status', true]
  ] },
  mt_main_user: { db: 'mx', pk: ['employee_id'], columns: [
    ['employee_id', 'text', true], ['password', 'password'], ['creator', 'bool'], ['status', 'status', true], ['password_expires_at', 'read']
  ] },
  mt_sto_user: { db: 'mx', pk: ['employee_id'], columns: [
    ['employee_id', 'text', true], ['department', 'text', true], ['role', 'usage', true], ['status', 'status', true]
  ] },
  mt_sto_buyer: { db: 'mx', pk: ['costcenter'], columns: [
    ['costcenter', 'text', true], ['status', 'status', true]
  ] },
  mt_sto_stock: { db: 'mx', pk: ['costcenter', 'material'], columns: [
    ['costcenter', 'text', true], ['material', 'text', true], ['min_qty', 'qty', true], ['current_qty', 'qty', true], ['max_qty', 'qty', true]
  ] },
  tx_sto_requisition: { db: 'tx', pk: ['id'], columns: [
    ['id', 'read'], ['requested_by', 'text', true], ['costcenter', 'text', true],
    ['status', 'req', true], ['note', 'text'], ['accepted_by', 'text'], ['received_by', 'text']
  ] },
  tx_sto_requisition_line: { db: 'tx', pk: ['id'], columns: [
    ['id', 'read'], ['requisition_id', 'int', true], ['costcenter', 'text', true], ['material', 'text', true], ['qty', 'qty', true]
  ] },
  tx_sto_issue: { db: 'tx', pk: ['id'], columns: [
    ['id', 'read'], ['requisition_id', 'int', true], ['requisition_line_id', 'int', true],
    ['costcenter', 'text', true], ['material', 'text', true], ['qty', 'qty', true], ['issued_at', 'read']
  ] }
};

function adminSpec(name) {
  const spec = ADMIN_TABLES[name];
  if (!spec) return null;
  return {
    ...spec,
    columns: spec.columns.map(([name, type, required]) => ({ name, type, required: Boolean(required), pk: spec.pk.includes(name) }))
  };
}

function creatorOnly(req, res, next) {
  if (!req.user?.creator) return fail(res, 403, 'เฉพาะผู้ดูแลระบบ');
  next();
}

function adminValue(column, raw, { insert }) {
  if (column.type === 'read') return undefined;
  if (column.type === 'password') {
    const password = String(raw ?? '');
    if (!password) return insert && column.required ? null : undefined;
    if (password.length < 8) return null;
    return password;
  }
  if (raw == null || raw === '') return column.required ? null : undefined;
  if (column.type === 'bool') return raw === true || raw === 'true';
  if (column.type === 'int') {
    const n = Number(raw);
    return Number.isInteger(n) ? n : null;
  }
  if (column.type === 'qty' || column.type === 'money') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 1000) / 1000;
  }
  if (column.type === 'status' && !['Active', 'Inactive'].includes(raw)) return null;
  if (column.type === 'group' && !['Factory', 'Non', 'Center'].includes(raw)) return null;
  if (column.type === 'usage' && !['viewer', 'user', 'admin'].includes(raw)) return null;
  if (column.type === 'req' && !['cart', 'submitted', 'accepted', 'preparing', 'ready', 'received', 'cancelled'].includes(raw)) return null;
  return String(raw).trim();
}

async function adminPayload(spec, body, { insert }) {
  const out = {};
  for (const column of spec.columns) {
    if (column.type === 'read') continue;
    if (column.type === 'password') {
      const password = adminValue(column, body.password, { insert });
      if (password === null) return { error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัว' };
      if (password) out.password_hash = await bcrypt.hash(password, 10);
      if (password && !insert) out.password_changed_at = new Date().toISOString();
      continue;
    }
    const value = adminValue(column, body[column.name], { insert });
    if (value === null) return { error: `ข้อมูล ${column.name} ไม่ถูกต้อง` };
    if (value !== undefined) out[column.name] = value;
  }
  return { out };
}

app.get('/api/system/tables', wrap(requireUser), creatorOnly, (_req, res) => {
  res.json({
    tables: Object.entries(ADMIN_TABLES).map(([name, spec]) => ({
      name,
      pk: spec.pk,
      columns: spec.columns.map(([column, type, required]) => ({ name: column, type, required: Boolean(required), pk: spec.pk.includes(column) }))
    }))
  });
});

app.get('/api/system/tables/:name', wrap(requireUser), creatorOnly, wrap(async (req, res) => {
  const spec = adminSpec(req.params.name);
  const client = spec && (spec.db === 'tx' ? tx : mx);
  if (!spec || !client) return fail(res, 404, 'ไม่พบตาราง');
  const term = cleanTerm(req.query.q);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const readable = spec.columns.filter((column) => column.type !== 'password').map((column) => column.name);
  let query = client.from(req.params.name).select(readable.join(','), { count: 'exact' }).range(offset, offset + 49);
  const order = spec.pk[0];
  query = query.order(order, { ascending: true });
  if (term) {
    const filters = spec.columns.filter((column) => ['text', 'status', 'group', 'usage', 'req'].includes(column.type)).map((column) => `${column.name}.ilike.%${term}%`);
    if (filters.length) query = query.or(filters.join(','));
  }
  const { data, error, count } = await query;
  if (error) return fail(res, 400, 'อ่านตารางไม่ได้');
  res.json({ rows: data || [], total: count || 0 });
}));

app.post('/api/system/tables/:name', wrap(requireUser), creatorOnly, wrap(async (req, res) => {
  const spec = adminSpec(req.params.name);
  const client = spec && (spec.db === 'tx' ? tx : mx);
  if (!spec || !client) return fail(res, 404, 'ไม่พบตาราง');
  const { out, error: invalid } = await adminPayload(spec, req.body || {}, { insert: true });
  if (invalid) return fail(res, 400, invalid);
  if (req.params.name === 'mt_main_user' && out.creator && out.employee_id !== CREATOR_ID) return fail(res, 400, 'กำหนดผู้สร้างระบบเพิ่มไม่ได้');
  if (req.params.name === 'mt_sto_user' && out.employee_id === CREATOR_ID && out.role && out.role !== 'admin') return fail(res, 400, 'ผู้สร้างระบบเป็น Admin เสมอ');
  if (req.params.name === 'mt_main_user' && !out.password_hash) return fail(res, 400, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัว');
  if (req.params.name === 'mt_main_user') out.role = 'employee';
  const { error } = await client.from(req.params.name).insert(out);
  if (error) return fail(res, 400, 'เพิ่มแถวไม่ได้');
  res.status(201).json({ ok: true });
}));

app.patch('/api/system/tables/:name', wrap(requireUser), creatorOnly, wrap(async (req, res) => {
  const spec = adminSpec(req.params.name);
  const client = spec && (spec.db === 'tx' ? tx : mx);
  if (!spec || !client) return fail(res, 404, 'ไม่พบตาราง');
  const key = req.body?.key || {};
  if (!spec.pk.every((column) => key[column] != null && String(key[column]) !== '')) return fail(res, 400, 'ไม่พบแถวที่แก้');
  const { out, error: invalid } = await adminPayload(spec, req.body?.values || {}, { insert: false });
  if (invalid) return fail(res, 400, invalid);
  for (const column of spec.pk) delete out[column];
  if (req.params.name === 'mt_main_user' && String(key.employee_id) === CREATOR_ID && out.creator === false) return fail(res, 400, 'ปิดผู้สร้างระบบไม่ได้');
  if (req.params.name === 'mt_sto_user' && String(key.employee_id) === CREATOR_ID && (out.role && out.role !== 'admin' || out.status === 'Inactive')) return fail(res, 400, 'ผู้สร้างระบบเป็น Admin เสมอ');
  if (!Object.keys(out).length) return fail(res, 400, 'ไม่มีข้อมูลให้แก้ไข');
  let query = client.from(req.params.name).update(out);
  for (const column of spec.pk) query = query.eq(column, key[column]);
  const { data, error } = await query.select(spec.pk.join(','));
  if (error || !data?.length) return fail(res, 400, 'แก้ไขแถวไม่ได้');
  res.json({ ok: true });
}));

app.delete('/api/system/tables/:name', wrap(requireUser), creatorOnly, wrap(async (req, res) => {
  const spec = adminSpec(req.params.name);
  const client = spec && (spec.db === 'tx' ? tx : mx);
  if (!spec || !client) return fail(res, 404, 'ไม่พบตาราง');
  const key = req.body?.key || {};
  if (!spec.pk.every((column) => key[column] != null && String(key[column]) !== '')) return fail(res, 400, 'ไม่พบแถวที่ลบ');
  if ((req.params.name === 'mt_main_user' || req.params.name === 'mt_sto_user') && String(key.employee_id) === CREATOR_ID) return fail(res, 400, 'ลบผู้สร้างระบบไม่ได้');
  let query = client.from(req.params.name).delete();
  for (const column of spec.pk) query = query.eq(column, key[column]);
  const { error } = await query;
  if (error) return fail(res, 400, 'ลบแถวไม่ได้');
  res.json({ ok: true });
}));

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return fail(res, 404, 'ไม่พบ');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function bootstrap() {
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
  const member = await mx.from('mt_sto_user').insert({ employee_id: employeeId, role: 'admin', status: 'Active' });
  if (member.error) console.error('bootstrap failed');
  else console.log('bootstrap user created');
}

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`SMF listening on ${PORT}`);
  try {
    await bootstrap();
  } catch {
    console.error('bootstrap failed');
  }
});
