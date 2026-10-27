import { mx } from '../../core/db.js';
import { fail, wrap, qtyOf } from '../../core/http.js';
import { atLeast, rankIn } from '../../core/access.js';
import { requireUser } from '../../core/users.js';

const MONTH = /^\d{4}-\d{2}$/;

export function currentMonth() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
}

function monthBounds(month) {
  const [year, monthNo] = month.split('-').map(Number);
  const next = monthNo === 12 ? `${year + 1}-01` : `${year}-${String(monthNo + 1).padStart(2, '0')}`;
  return {
    start: new Date(`${month}-01T00:00:00+07:00`).toISOString(),
    end: new Date(`${next}-01T00:00:00+07:00`).toISOString()
  };
}

export function yearBounds(year) {
  const n = Number(year);
  const y = Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : Number(currentMonth().slice(0, 4));
  return {
    year: y,
    start: new Date(`${y}-01-01T00:00:00+07:00`).toISOString(),
    end: new Date(`${y + 1}-01-01T00:00:00+07:00`).toISOString()
  };
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function brief(row) {
  return { costcenter: row.costcenter, objectName: row.object_name, department: row.department };
}

async function centers() {
  const { data, error } = await mx.from('mt_main_costcenter')
    .select('costcenter,object_name,department,status').eq('status', 'Active').order('costcenter');
  if (error) throw error;
  return (data || []).filter((row) => row.department);
}

async function centerOf(costcenter) {
  const { data, error } = await mx.from('mt_main_costcenter')
    .select('costcenter,object_name,department,status').eq('costcenter', costcenter).maybeSingle();
  if (error) throw error;
  if (!data || data.status !== 'Active' || !data.department) return null;
  return data;
}

async function materialNames(codes) {
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await mx.from('mt_sto_usage').select('material,material_description,bun').in('material', unique);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.material, row]));
}

async function rowsFor(month) {
  const { start, end } = monthBounds(month);
  const [centerRows, receipts, issues, borrows] = await Promise.all([
    centers(),
    mx.from('tx_sto_receipt').select('costcenter,material,qty,kind').gte('received_at', start).lt('received_at', end),
    mx.from('tx_sto_issue').select('costcenter,material,qty').gte('issued_at', start).lt('issued_at', end),
    mx.from('tx_sto_borrow').select('id,borrower_costcenter,lender_costcenter,material,qty,status').gte('borrowed_at', start).lt('borrowed_at', end)
  ]);
  for (const result of [receipts, issues, borrows]) if (result.error) throw result.error;
  const dept = new Map(centerRows.map((row) => [row.costcenter, row.department]));
  const map = new Map();
  const touch = (department, material) => {
    const key = `${department}\0${material}`;
    if (!map.has(key)) map.set(key, { department, material, bought: 0, used: 0, borrowed: 0, lent: 0, replaced: 0 });
    return map.get(key);
  };
  for (const row of receipts.data || []) {
    if (row.kind !== 'purchase') continue;
    const department = dept.get(row.costcenter);
    if (!department) continue;
    const item = touch(department, row.material);
    item.bought = round(item.bought + Number(row.qty));
  }
  for (const row of issues.data || []) {
    const department = dept.get(row.costcenter);
    if (!department) continue;
    const item = touch(department, row.material);
    item.used = round(item.used + Number(row.qty));
  }
  const openBorrows = [];
  for (const row of borrows.data || []) {
    const borrower = dept.get(row.borrower_costcenter);
    const lender = dept.get(row.lender_costcenter);
    if (row.status === 'open') {
      if (borrower) {
        const item = touch(borrower, row.material);
        item.borrowed = round(item.borrowed + Number(row.qty));
      }
      if (lender) {
        const item = touch(lender, row.material);
        item.lent = round(item.lent + Number(row.qty));
      }
      openBorrows.push({ ...row, borrowerDepartment: borrower || '', lenderDepartment: lender || '' });
    } else if (row.status === 'replaced' && borrower) {
      const item = touch(borrower, row.material);
      item.replaced = round(item.replaced + Number(row.qty));
    }
  }
  const rows = [...map.values()].map((row) => {
    const left = round(row.bought - row.used - row.lent);
    let status = 'พอดี';
    if (row.borrowed > 0 || left < 0) status = 'ใช้เกิน';
    else if (left > 0) status = 'เหลือ';
    else if (row.replaced > 0) status = 'ซื้อทดแทนแล้ว';
    return { ...row, left, status };
  });
  return { centers: centerRows, rows, borrows: openBorrows };
}

export async function assertEntitlement(lines) {
  const { rows, centers: centerRows } = await rowsFor(currentMonth());
  const dept = new Map(centerRows.map((row) => [row.costcenter, row.department]));
  const need = new Map();
  for (const line of lines) {
    const department = dept.get(line.costcenter);
    if (!department) throw new Error('เลือก costcenter ในขอบเขตของคุณ');
    const key = `${department}\0${line.material}`;
    need.set(key, round((need.get(key) || 0) + Number(line.qty)));
  }
  for (const [key, qty] of need) {
    const [department, material] = key.split('\0');
    const found = rows.find((row) => row.department === department && row.material === material);
    if (qty > (found ? found.left : 0)) throw new Error(`สิทธิ์เดือนนี้ของ ${department} ไม่พอสำหรับ ${material} ต้องขอยืม`);
  }
}

async function moveStock(costcenter, material, delta) {
  if (delta > 0) {
    const found = await mx.from('mt_sto_stock').select('material').eq('costcenter', costcenter).eq('material', material).maybeSingle();
    if (found.error) throw new Error('ปรับยอดคลังไม่ได้');
    if (!found.data) {
      const inserted = await mx.from('mt_sto_stock').insert({ costcenter, material, min_qty: 0, current_qty: 0, max_qty: 0 });
      if (inserted.error) throw new Error('ปรับยอดคลังไม่ได้');
    }
  }
  const adjusted = await mx.rpc('mt_sto_stock_adjust', { p_costcenter: costcenter, p_material: material, p_delta: delta });
  if (!adjusted.error) return;
  const text = adjusted.error.message || '';
  if (text.includes('not enough') || text.includes('quantity')) throw new Error('ยอดคงเหลือไม่พอ');
  throw new Error('ปรับยอดคลังไม่ได้');
}

async function activeMaterial(material) {
  const item = await mx.from('mt_sto_usage').select('status').eq('material', material).maybeSingle();
  if (item.error) throw new Error('อ่านรายการไม่ได้');
  if (!item.data || item.data.status !== 'Active') throw new Error('รายการนี้ใช้งานไม่ได้');
}

export function mountLedger(app, mod) {
  const adminOf = (req) => rankIn(req.user, mod.id) >= 3;
  const monthOf = (value) => {
    const month = MONTH.test(String(value || '')) ? String(value) : currentMonth();
    if (month > currentMonth()) return null;
    return month;
  };

  app.get('/api/ledger', wrap(requireUser), atLeast(mod, 1), wrap(async (req, res) => {
    const month = monthOf(req.query.month) || currentMonth();
    const { centers: all, rows, borrows } = await rowsFor(month);
    const names = await materialNames([...rows.map((row) => row.material), ...borrows.map((row) => row.material)]);
    const describe = (material) => names.get(material) || {};
    res.json({
      month,
      centers: all.filter((row) => adminOf(req) || row.department === req.user.department).map(brief),
      lenders: all.filter((row) => row.department !== req.user.department).map(brief),
      rows: rows.map((row) => ({ ...row, materialDescription: describe(row.material).material_description || '', bun: describe(row.material).bun || '' })),
      borrows: borrows.map((row) => ({
        id: row.id,
        material: row.material,
        qty: Number(row.qty),
        borrowerCostcenter: row.borrower_costcenter,
        lenderCostcenter: row.lender_costcenter,
        borrowerDepartment: row.borrowerDepartment,
        lenderDepartment: row.lenderDepartment,
        materialDescription: describe(row.material).material_description || ''
      }))
    });
  }));

  app.get('/api/receipts', wrap(requireUser), atLeast(mod, 1), wrap(async (req, res) => {
    const { start, end } = yearBounds(req.query.year);
    const [centerRows, receipts, borrows] = await Promise.all([
      centers(),
      mx.from('tx_sto_receipt').select('*').gte('received_at', start).lt('received_at', end).order('received_at', { ascending: false }).limit(500),
      mx.from('tx_sto_borrow').select('*').gte('borrowed_at', start).lt('borrowed_at', end).order('borrowed_at', { ascending: false }).limit(500)
    ]);
    for (const result of [receipts, borrows]) if (result.error) return fail(res, 400, 'อ่านประวัติรับเข้าไม่ได้');
    const dept = new Map(centerRows.map((row) => [row.costcenter, row]));
    const names = await materialNames([
      ...(receipts.data || []).map((row) => row.material),
      ...(borrows.data || []).map((row) => row.material)
    ]);
    const describe = (material) => names.get(material) || {};
    const events = [
      ...(receipts.data || []).map((row) => ({
        id: `r${row.id}`,
        at: row.received_at,
        kind: row.kind,
        costcenter: row.costcenter,
        department: dept.get(row.costcenter)?.department || '',
        material: row.material,
        materialDescription: describe(row.material).material_description || '',
        bun: describe(row.material).bun || '',
        qty: Number(row.qty),
        by: row.received_by,
        borrowId: row.borrow_id,
        status: row.kind === 'replacement' ? 'ซื้อทดแทนแล้ว' : 'รับเข้า',
        open: false
      })),
      ...(borrows.data || []).map((row) => ({
        id: `b${row.id}`,
        at: row.borrowed_at,
        kind: 'borrow',
        costcenter: row.borrower_costcenter,
        department: dept.get(row.borrower_costcenter)?.department || '',
        lenderCostcenter: row.lender_costcenter,
        lenderDepartment: dept.get(row.lender_costcenter)?.department || '',
        material: row.material,
        materialDescription: describe(row.material).material_description || '',
        bun: describe(row.material).bun || '',
        qty: Number(row.qty),
        by: row.borrowed_by,
        borrowId: row.id,
        status: row.status === 'open' ? 'ยืม' : 'ปิดแล้ว',
        open: row.status === 'open'
      }))
    ].sort((a, b) => new Date(b.at) - new Date(a.at));
    res.json({ events });
  }));

  app.post('/api/receipts', wrap(requireUser), atLeast(mod, 2), wrap(async (req, res) => {
    try {
      const month = monthOf(req.body?.month);
      const qty = qtyOf(req.body?.qty);
      if (!month) return fail(res, 400, 'บันทึกเดือนหน้าไม่ได้');
      if (!qty) return fail(res, 400, 'ระบุจำนวน');
      if (req.body?.borrowId) {
        const borrow = await mx.from('tx_sto_borrow').select('*').eq('id', Number(req.body.borrowId)).eq('status', 'open').maybeSingle();
        if (borrow.error || !borrow.data) return fail(res, 400, 'ไม่พบใบยืมที่ยังเปิดอยู่');
        if (qty !== round(borrow.data.qty)) return fail(res, 400, 'จำนวนซื้อทดแทนต้องเท่ากับที่ยืม');
        const lender = await centerOf(borrow.data.lender_costcenter);
        const borrower = await centerOf(borrow.data.borrower_costcenter);
        if (!lender || !borrower) return fail(res, 400, 'ไม่พบ costcenter ของใบยืม');
        if (!adminOf(req) && borrower.department !== req.user.department) return fail(res, 403, 'ซื้อทดแทนได้เฉพาะหน่วยงานผู้ยืม');
        await moveStock(lender.costcenter, borrow.data.material, qty);
        const inserted = await mx.from('tx_sto_receipt').insert({
          costcenter: lender.costcenter, material: borrow.data.material, qty, kind: 'replacement',
          borrow_id: borrow.data.id, received_at: new Date().toISOString(), received_by: req.user.employeeId
        }).select('id');
        if (inserted.error || !inserted.data?.length) {
          await moveStock(lender.costcenter, borrow.data.material, -qty);
          return fail(res, 400, 'บันทึกรับเข้าไม่ได้');
        }
        const closed = await mx.from('tx_sto_borrow').update({ status: 'replaced' }).eq('id', borrow.data.id).eq('status', 'open').select('id');
        if (closed.error || !closed.data?.length) return fail(res, 400, 'ปิดใบยืมไม่ได้');
        return res.status(201).json({ ok: true });
      }
      const center = await centerOf(String(req.body?.costcenter || '').trim());
      if (!center || (!adminOf(req) && center.department !== req.user.department)) return fail(res, 400, 'เลือก costcenter ในขอบเขตของคุณ');
      const material = String(req.body?.material || '').trim();
      await activeMaterial(material);
      await moveStock(center.costcenter, material, qty);
      const inserted = await mx.from('tx_sto_receipt').insert({
        costcenter: center.costcenter, material, qty, kind: 'purchase',
        received_at: new Date().toISOString(), received_by: req.user.employeeId
      }).select('id');
      if (inserted.error || !inserted.data?.length) {
        await moveStock(center.costcenter, material, -qty);
        return fail(res, 400, 'บันทึกรับเข้าไม่ได้');
      }
      res.status(201).json({ ok: true });
    } catch (err) {
      return fail(res, 400, err.message || 'บันทึกรับเข้าไม่ได้');
    }
  }));

  app.post('/api/borrows', wrap(requireUser), atLeast(mod, 2), wrap(async (req, res) => {
    try {
      const month = monthOf(req.body?.month);
      const qty = qtyOf(req.body?.qty);
      if (!month) return fail(res, 400, 'บันทึกเดือนหน้าไม่ได้');
      if (!qty) return fail(res, 400, 'ระบุจำนวน');
      const borrower = await centerOf(String(req.body?.borrowerCostcenter || '').trim());
      const lender = await centerOf(String(req.body?.lenderCostcenter || '').trim());
      if (!borrower || (!adminOf(req) && borrower.department !== req.user.department)) return fail(res, 400, 'เลือก costcenter ผู้ยืมในขอบเขตของคุณ');
      if (!lender || lender.department === borrower.department) return fail(res, 400, 'เลือก costcenter ของหน่วยงานผู้ให้ยืม');
      const material = String(req.body?.material || '').trim();
      await activeMaterial(material);
      const { rows } = await rowsFor(month);
      const lenderRow = rows.find((row) => row.department === lender.department && row.material === material);
      if (!lenderRow || qty > lenderRow.left) return fail(res, 400, 'หน่วยงานผู้ให้ยืมเหลือไม่พอ');
      const stock = await mx.from('mt_sto_stock').select('current_qty').eq('costcenter', lender.costcenter).eq('material', material).maybeSingle();
      if (stock.error || !stock.data || Number(stock.data.current_qty) < qty) return fail(res, 400, 'ยอดคงเหลือไม่พอ');
      await moveStock(lender.costcenter, material, -qty);
      const inserted = await mx.from('tx_sto_borrow').insert({
        borrower_costcenter: borrower.costcenter, lender_costcenter: lender.costcenter,
        material, qty, status: 'open', borrowed_at: new Date().toISOString(), borrowed_by: req.user.employeeId
      }).select('id');
      if (inserted.error || !inserted.data?.length) {
        await moveStock(lender.costcenter, material, qty);
        return fail(res, 400, 'บันทึกการยืมไม่ได้');
      }
      res.status(201).json({ ok: true });
    } catch (err) {
      return fail(res, 400, err.message || 'บันทึกการยืมไม่ได้');
    }
  }));
}
