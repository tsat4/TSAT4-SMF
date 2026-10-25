import bcrypt from 'bcryptjs';
import { mx, tx } from '../../core/db.js';
import { fail, wrap, cleanTerm, adminWriteError } from '../../core/http.js';
import { CREATOR_ID, MEMBER_TABLES, creatorOnly, defineModule } from '../../core/access.js';
import { requireUser } from '../../core/users.js';
import { MAIN_TABLES } from '../../core/tables.js';

const CHOICES = {
  status: ['Active', 'Inactive'],
  level: ['S1', 'S2', 'S3', 'T1', 'T2', 'T3', 'T6', 'T7', 'T8'],
  group: ['Factory', 'Non', 'Center'],
  usage: ['viewer', 'user', 'admin'],
  req: ['cart', 'submitted', 'accepted', 'preparing', 'ready', 'received', 'cancelled'],
  areatype: ['โรงงาน', 'สำนักงาน'],
  actrole: ['admin', 'chairman', 'auditor', 'owner']
};

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
  if (CHOICES[column.type] && !CHOICES[column.type].includes(raw)) return null;
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

function hasKey(spec, key) {
  return spec.pk.every((column) => key?.[column] != null && String(key[column]) !== '');
}

// System > Setting: creator-only CRUD over the shared tables and every module's tables.
export default defineModule({
  id: 'system',
  label: 'System',
  mount(app, _mod, { modules }) {
    const tables = { ...MAIN_TABLES };
    for (const other of modules) Object.assign(tables, other.tables);
    const memberTables = new Set(Object.values(MEMBER_TABLES));
    const isAccount = (name) => name === 'mt_main_user' || memberTables.has(name);

    const specOf = (name) => {
      const spec = Object.hasOwn(tables, name) ? tables[name] : null;
      if (!spec) return null;
      return {
        ...spec,
        columns: spec.columns.map(([column, type, required]) => ({ name: column, type, required: Boolean(required), pk: spec.pk.includes(column) }))
      };
    };
    const open = (name) => {
      const spec = specOf(name);
      const client = spec ? (spec.db === 'tx' ? tx : mx) : null;
      return spec && client ? { spec, client } : null;
    };

    app.get('/api/system/tables', wrap(requireUser), creatorOnly, (_req, res) => {
      res.json({
        tables: Object.keys(tables).map((name) => {
          const spec = specOf(name);
          return { name, pk: spec.pk, columns: spec.columns };
        })
      });
    });

    app.get('/api/system/tables/:name', wrap(requireUser), creatorOnly, wrap(async (req, res) => {
      const opened = open(req.params.name);
      if (!opened) return fail(res, 404, 'ไม่พบตาราง');
      const { spec, client } = opened;
      const term = cleanTerm(req.query.q);
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const readable = spec.columns.filter((column) => column.type !== 'password').map((column) => column.name);
      let query = client.from(req.params.name).select(readable.join(','), { count: 'exact' }).range(offset, offset + 49);
      query = query.order(spec.pk[0], { ascending: true });
      if (term) {
        const filters = spec.columns.filter((column) => column.type === 'text' || CHOICES[column.type]).map((column) => `${column.name}.ilike.%${term}%`);
        if (filters.length) query = query.or(filters.join(','));
      }
      const { data, error, count } = await query;
      if (error?.code === 'PGRST205') return fail(res, 400, `ยังไม่มีตาราง ${req.params.name} ในฐานข้อมูล ต้องรัน SQL สร้างตารางก่อน`);
      if (error) return fail(res, 400, 'อ่านตารางไม่ได้');
      res.json({ rows: data || [], total: count || 0 });
    }));

    app.post('/api/system/tables/:name', wrap(requireUser), creatorOnly, wrap(async (req, res) => {
      const opened = open(req.params.name);
      if (!opened) return fail(res, 404, 'ไม่พบตาราง');
      const { spec, client } = opened;
      const { out, error: invalid } = await adminPayload(spec, req.body || {}, { insert: true });
      if (invalid) return fail(res, 400, invalid);
      if (req.params.name === 'mt_main_user' && out.creator && out.employee_id !== CREATOR_ID) return fail(res, 400, 'กำหนดผู้สร้างระบบเพิ่มไม่ได้');
      if (memberTables.has(req.params.name) && out.employee_id === CREATOR_ID && out.role && out.role !== 'admin') return fail(res, 400, 'ผู้สร้างระบบเป็น Admin เสมอ');
      if (req.params.name === 'mt_main_user' && !out.password_hash) return fail(res, 400, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัว');
      if (req.params.name === 'mt_main_user') out.role = 'employee';
      const { error } = await client.from(req.params.name).insert(out);
      if (error) return fail(res, 400, adminWriteError(error, 'เพิ่มแถวไม่ได้'));
      res.status(201).json({ ok: true });
    }));

    app.patch('/api/system/tables/:name', wrap(requireUser), creatorOnly, wrap(async (req, res) => {
      const opened = open(req.params.name);
      if (!opened) return fail(res, 404, 'ไม่พบตาราง');
      const { spec, client } = opened;
      const key = req.body?.key || {};
      if (!hasKey(spec, key)) return fail(res, 400, 'ไม่พบแถวที่แก้');
      const { out, error: invalid } = await adminPayload(spec, req.body?.values || {}, { insert: false });
      if (invalid) return fail(res, 400, invalid);
      if (req.params.name === 'mt_main_user' && String(key.employee_id) === CREATOR_ID && out.creator === false) return fail(res, 400, 'ปิดผู้สร้างระบบไม่ได้');
      if (memberTables.has(req.params.name) && String(key.employee_id) === CREATOR_ID && (out.role && out.role !== 'admin' || out.status === 'Inactive')) return fail(res, 400, 'ผู้สร้างระบบเป็น Admin เสมอ');
      const changed = {};
      for (const [column, value] of Object.entries(out)) {
        if (spec.pk.includes(column) && String(value) === String(key[column] ?? '')) continue;
        changed[column] = value;
      }
      if (isAccount(req.params.name) && changed.employee_id) return fail(res, 400, 'เปลี่ยนรหัสพนักงานไม่ได้');
      if (!Object.keys(changed).length) return fail(res, 400, 'ไม่มีข้อมูลให้แก้ไข');
      let query = client.from(req.params.name).update(changed);
      for (const column of spec.pk) query = query.eq(column, key[column]);
      const { data, error } = await query.select(spec.pk.join(','));
      if (error) return fail(res, 400, adminWriteError(error, 'แก้ไขแถวไม่ได้'));
      if (!data?.length) return fail(res, 400, 'แก้ไขแถวไม่ได้');
      res.json({ ok: true });
    }));

    app.delete('/api/system/tables/:name', wrap(requireUser), creatorOnly, wrap(async (req, res) => {
      const opened = open(req.params.name);
      if (!opened) return fail(res, 404, 'ไม่พบตาราง');
      const { spec, client } = opened;
      const key = req.body?.key || {};
      if (!hasKey(spec, key)) return fail(res, 400, 'ไม่พบแถวที่ลบ');
      if (isAccount(req.params.name) && String(key.employee_id) === CREATOR_ID) return fail(res, 400, 'ลบผู้สร้างระบบไม่ได้');
      let query = client.from(req.params.name).delete();
      for (const column of spec.pk) query = query.eq(column, key[column]);
      const { error } = await query;
      if (error) return fail(res, 400, adminWriteError(error, 'ลบแถวไม่ได้'));
      res.json({ ok: true });
    }));
  }
});
