import { mx } from '../../core/db.js';
import { fail, wrap, qtyOf } from '../../core/http.js';
import { atLeast, rankIn } from '../../core/access.js';
import { requireUser } from '../../core/users.js';
import { currentMonth } from './ledger.js';

const MONTH = /^\d{4}-\d{2}$/;

function monthOf(value) {
  const month = MONTH.test(String(value || '')) ? String(value) : currentMonth();
  if (month > currentMonth()) return null;
  return month;
}

function bounds(month) {
  const [year, monthNo] = month.split('-').map(Number);
  const next = monthNo === 12 ? `${year + 1}-01` : `${year}-${String(monthNo + 1).padStart(2, '0')}`;
  return {
    start: new Date(`${month}-01T00:00:00+07:00`).toISOString(),
    end: new Date(`${next}-01T00:00:00+07:00`).toISOString()
  };
}

function stamp(month) {
  return new Date(`${month}-15T12:00:00+07:00`).toISOString();
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

async function centers() {
  const { data, error } = await mx.from('mt_main_costcenter')
    .select('costcenter,object_name,department,status').eq('status', 'Active').order('costcenter');
  if (error) throw error;
  return (data || []).filter((row) => row.department);
}

async function names(codes) {
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await mx.from('mt_sto_usage').select('material,material_description,bun,status').in('material', unique);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.material, row]));
}

export function mountReserves(app, mod) {
  const adminOf = (req) => rankIn(req.user, mod.id) >= 3;

  app.get('/api/reserves', wrap(requireUser), atLeast(mod, 1), wrap(async (req, res) => {
    const month = monthOf(req.query.month) || currentMonth();
    const { start, end } = bounds(month);
    const [centerRows, listed] = await Promise.all([
      centers(),
      mx.from('tx_sto_reserve').select('id,costcenter,material,qty,status,reserved_at').gte('reserved_at', start).lt('reserved_at', end).order('id')
    ]);
    if (listed.error) return fail(res, 400, 'อ่านรายการสั่งจองไม่ได้');
    const dept = new Map(centerRows.map((row) => [row.costcenter, row]));
    const admin = adminOf(req);
    const mine = (listed.data || []).filter((row) => {
      const center = dept.get(row.costcenter);
      return center && (admin || center.department === req.user.department);
    });
    const described = await names(mine.map((row) => row.material));
    const lines = mine.map((row) => {
      const center = dept.get(row.costcenter);
      const item = described.get(row.material) || {};
      return {
        id: row.id,
        costcenter: row.costcenter,
        objectName: center.object_name,
        department: center.department,
        material: row.material,
        materialDescription: item.material_description || '',
        bun: item.bun || '',
        qty: Number(row.qty),
        status: row.status
      };
    });
    const totals = new Map();
    for (const line of lines) {
      if (line.status !== 'open') continue;
      const row = totals.get(line.material) || {
        material: line.material, materialDescription: line.materialDescription, bun: line.bun, qty: 0, parts: []
      };
      row.qty = round(row.qty + line.qty);
      const part = row.parts.find((item) => item.costcenter === line.costcenter);
      if (part) part.qty = round(part.qty + line.qty);
      else row.parts.push({ costcenter: line.costcenter, department: line.department, qty: line.qty });
      totals.set(line.material, row);
    }
    res.json({
      month,
      centers: centerRows.filter((row) => admin || row.department === req.user.department).map((row) => ({
        costcenter: row.costcenter, objectName: row.object_name, department: row.department
      })),
      lines: admin ? [] : lines,
      totals: admin ? [...totals.values()] : []
    });
  }));

  app.post('/api/reserves', wrap(requireUser), atLeast(mod, 2), wrap(async (req, res) => {
    const month = monthOf(req.body?.month);
    const qty = qtyOf(req.body?.qty);
    const material = String(req.body?.material || '').trim();
    const costcenter = String(req.body?.costcenter || '').trim();
    if (!month) return fail(res, 400, 'บันทึกเดือนหน้าไม่ได้');
    if (Array.isArray(req.body?.lines) && req.body.lines.length > 40) return fail(res, 400, 'บันทึกได้ครั้งละไม่เกิน 40 รายการ');
    const rawLines = Array.isArray(req.body?.lines) && req.body.lines.length
      ? req.body.lines
      : [{ material, qty }];
    const lines = [];
    for (const row of rawLines) {
      const code = String(row?.material || '').trim();
      const amount = qtyOf(row?.qty);
      if (!code || !amount) return fail(res, 400, 'ระบุรหัสรายการและจำนวนทุกแถว');
      lines.push({ material: code, qty: amount });
    }
    const center = (await centers()).find((row) => row.costcenter === costcenter);
    if (!center || center.department !== req.user.department) return fail(res, 400, 'เลือก costcenter ในหน่วยงานของคุณ');
    const found = await names(lines.map((row) => row.material));
    const missing = lines.find((row) => found.get(row.material)?.status !== 'Active');
    if (missing) return fail(res, 400, `รายการ ${missing.material} ใช้งานไม่ได้`);
    const inserted = await mx.from('tx_sto_reserve').insert(lines.map((row) => ({
      costcenter, material: row.material, qty: row.qty, status: 'open', reserved_at: stamp(month), requested_by: req.user.employeeId
    }))).select('id');
    if (inserted.error || !inserted.data?.length) return fail(res, 400, 'บันทึกการสั่งจองไม่ได้');
    res.status(201).json({ ok: true, count: inserted.data.length });
  }));

  app.post('/api/reserves/order', wrap(requireUser), atLeast(mod, 3), wrap(async (req, res) => {
    const month = monthOf(req.body?.month);
    const material = String(req.body?.material || '').trim();
    if (!month || !material) return fail(res, 400, 'ระบุรายการที่จะสั่งซื้อ');
    const { start, end } = bounds(month);
    const updated = await mx.from('tx_sto_reserve').update({ status: 'ordered' })
      .eq('material', material).eq('status', 'open').gte('reserved_at', start).lt('reserved_at', end).select('id');
    if (updated.error || !updated.data?.length) return fail(res, 400, 'ไม่มีรายการรอสั่งซื้อ');
    res.json({ ok: true, count: updated.data.length });
  }));
}
