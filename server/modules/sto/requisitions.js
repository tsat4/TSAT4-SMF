import { mx } from '../../core/db.js';
import { fail, wrap, qtyOf, cleanTerm } from '../../core/http.js';
import { atLeast, rankIn } from '../../core/access.js';
import { requireUser } from '../../core/users.js';
import { centersForDepartments, costcenterMap, ownCenter } from '../../core/master.js';

const DRAFT_COSTCENTER = '-';

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

async function ownCart(req, id) {
  const { data } = await mx.from('tx_sto_requisition').select('id,requested_by,costcenter,status').eq('id', id).maybeSingle();
  if (!data || data.requested_by !== req.user.employeeId || data.status !== 'cart') return null;
  return data;
}

async function move(id, from, patch) {
  const { data, error } = await mx.from('tx_sto_requisition').update(patch).eq('id', id).eq('status', from).select('id');
  if (error || !data?.length) throw new Error('เปลี่ยนสถานะไม่ได้');
}

// tx_sto_receive (db/03_receive_rpc.sql, Mx Data) cuts all stock and marks the requisition received
// in one transaction. If the function is missing, fall back to the old line-by-line way.
async function receive(header) {
  const { error } = await mx.rpc('tx_sto_receive', { p_id: header.id, p_employee: header.requested_by });
  if (!error) return;
  if (error.code !== 'PGRST202') {
    const text = error.message || '';
    if (text.includes('not enough')) throw new Error('ยอดคงเหลือไม่พอ');
    if (text.includes('no lines')) throw new Error('ใบเบิกไม่มีรายการ');
    throw new Error('เปลี่ยนสถานะไม่ได้');
  }
  await receiveLineByLine(header);
}

// Not atomic: stock is cut line by line and given back if a later line fails.
async function receiveLineByLine(header) {
  const { data: lines, error } = await mx.from('tx_sto_requisition_line')
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

export function mountRequisitions(app, mod) {
  const isAdmin = (req) => rankIn(req.user, mod.id) >= 3;

  app.get('/api/summary', wrap(requireUser), atLeast(mod, 1), wrap(async (req, res) => {
    const open = await mx.from('tx_sto_requisition').select('id', { count: 'exact', head: true })
      .eq('requested_by', req.user.employeeId)
      .in('status', ['cart', 'submitted', 'accepted', 'preparing', 'ready']);
    const ready = await mx.from('tx_sto_requisition').select('id', { count: 'exact', head: true })
      .eq('requested_by', req.user.employeeId)
      .eq('status', 'ready');
    let queue = 0;
    if (isAdmin(req)) {
      const rows = await mx.from('tx_sto_requisition').select('id', { count: 'exact', head: true })
        .in('status', ['submitted', 'accepted', 'preparing']);
      queue = rows.count || 0;
    }
    res.json({ open: open.count || 0, ready: ready.count || 0, queue });
  }));

  app.get('/api/pay-centers', wrap(requireUser), atLeast(mod, 1), wrap(async (req, res) => {
    const department = req.user.department || '';
    const centers = await centersForDepartments([department]);
    res.json({ department, costcenters: centers.get(department) || [] });
  }));

  app.get('/api/stock', wrap(requireUser), atLeast(mod, 1), wrap(async (req, res) => {
    const grouped = await centersForDepartments([req.user.department || '']);
    const codes = (grouped.get(req.user.department) || []).map((row) => row.costcenter);
    if (!codes.length) return res.json({ stock: [], total: 0 });
    const term = cleanTerm(req.query.q);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    let query = mx.from('mt_sto_stock')
      .select('costcenter,material,min_qty,current_qty,max_qty,mt_sto_usage(material_description,bun)', { count: 'exact' })
      .in('costcenter', codes)
      .order('material')
      .range(offset, offset + 49);
    if (term) {
      const found = await mx.from('mt_sto_usage').select('material').or(`material.ilike.%${term}%,material_description.ilike.%${term}%,usage_group.ilike.%${term}%`).limit(200);
      const materials = (found.data || []).map((row) => row.material);
      if (!materials.length) return res.json({ stock: [], total: 0 });
      query = query.in('material', materials);
    }
    const { data, error, count } = await query;
    if (error) return fail(res, 400, 'อ่านยอดคงเหลือไม่ได้');
    res.json({
      stock: (data || []).map((row) => ({
        costcenter: row.costcenter,
        material: row.material,
        minQty: Number(row.min_qty),
        currentQty: Number(row.current_qty),
        maxQty: Number(row.max_qty),
        materialDescription: row.mt_sto_usage?.material_description || '',
        bun: row.mt_sto_usage?.bun || ''
      })),
      total: count || 0
    });
  }));

  app.get('/api/requisitions', wrap(requireUser), atLeast(mod, 1), wrap(async (req, res) => {
    const scope = req.query.scope === 'queue' ? 'queue' : 'mine';
    if (scope === 'queue' && !isAdmin(req)) return fail(res, 403, 'จัดเตรียมและจ่ายสำหรับ Admin');
    let query = mx.from('tx_sto_requisition').select('*').order('created_at', { ascending: false }).limit(50);
    if (scope === 'mine') query = query.eq('requested_by', req.user.employeeId);
    else query = query.in('status', ['submitted', 'accepted', 'preparing', 'ready']);
    const { data, error } = await query;
    if (error) return fail(res, 400, 'อ่านใบเบิกไม่ได้');
    const rows = await decorate(data || []);
    res.json({ requisitions: rows });
  }));

  app.get('/api/requisitions/:id', wrap(requireUser), wrap(async (req, res) => {
    const id = Number(req.params.id);
    const { data: header, error } = await mx.from('tx_sto_requisition').select('*').eq('id', id).maybeSingle();
    if (error || !header) return fail(res, 404, 'ไม่พบใบเบิก');
    if (header.requested_by !== req.user.employeeId && !isAdmin(req)) return fail(res, 403, 'เปิดใบเบิกนี้ไม่ได้');
    const { data: lines, error: lineError } = await mx.from('tx_sto_requisition_line').select('*').eq('requisition_id', id).order('id');
    if (lineError) return fail(res, 400, 'อ่านรายการไม่ได้');
    const [row] = await decorate([header], new Map([[id, lines || []]]));
    res.json({ requisition: row });
  }));

  app.post('/api/requisitions', wrap(requireUser), atLeast(mod, 1), wrap(async (req, res) => {
    let costcenter = String(req.body.costcenter || '').trim();
    if (costcenter) {
      if (!(await ownCenter(req, costcenter))) return fail(res, 400, 'เลือก costcenter ในขอบเขตของคุณ');
    } else costcenter = DRAFT_COSTCENTER;
    const { data, error } = await mx.from('tx_sto_requisition')
      .insert({ requested_by: req.user.employeeId, costcenter })
      .select('id')
      .single();
    if (error) return fail(res, 400, 'เปิดตะกร้าไม่ได้');
    res.status(201).json({ id: data.id });
  }));

  app.post('/api/requisitions/:id/lines', wrap(requireUser), atLeast(mod, 1), wrap(async (req, res) => {
    const id = Number(req.params.id);
    const material = String(req.body.material || '').trim();
    const qty = qtyOf(req.body.qty);
    const header = await ownCart(req, id);
    if (!header) return fail(res, 400, 'แก้ได้เฉพาะตะกร้าของตนเอง');
    if (!material || !qty) return fail(res, 400, 'เลือกรายการและจำนวน');
    const costcenter = String(req.body.costcenter || header.costcenter).trim();
    if (!(await ownCenter(req, costcenter))) return fail(res, 400, 'เลือก costcenter ในขอบเขตของคุณ');
    if (costcenter !== header.costcenter) {
      const applied = await mx.rpc('tx_sto_apply_costcenter', { p_id: id, p_employee: req.user.employeeId, p_costcenter: costcenter });
      if (applied.error) return fail(res, 400, 'บันทึก costcenter ไม่ได้');
      header.costcenter = costcenter;
    }
    const item = await mx.from('mt_sto_usage').select('status').eq('material', material).maybeSingle();
    if (!item.data || item.data.status !== 'Active') return fail(res, 400, 'รายการนี้ใช้งานไม่ได้');
    const existing = await mx.from('tx_sto_requisition_line').select('id,qty').eq('requisition_id', id).eq('material', material).maybeSingle();
    if (existing.data) {
      const { error } = await mx.from('tx_sto_requisition_line').update({ qty: qtyOf(Number(existing.data.qty) + qty) }).eq('id', existing.data.id);
      if (error) return fail(res, 400, 'เพิ่มจำนวนไม่ได้');
    } else {
      const { error } = await mx.from('tx_sto_requisition_line').insert({
        requisition_id: id,
        costcenter: header.costcenter,
        material,
        qty
      });
      if (error) return fail(res, 400, 'ใส่ตะกร้าไม่ได้');
    }
    res.json({ ok: true });
  }));

  app.patch('/api/requisitions/:id/lines/:lineId', wrap(requireUser), atLeast(mod, 1), wrap(async (req, res) => {
    const qty = qtyOf(req.body.qty);
    const header = await ownCart(req, Number(req.params.id));
    if (!header || !qty) return fail(res, 400, 'แก้จำนวนในตะกร้าไม่ได้');
    const { data, error } = await mx.from('tx_sto_requisition_line').update({ qty })
      .eq('id', Number(req.params.lineId)).eq('requisition_id', header.id).select('id');
    if (error || !data?.length) return fail(res, 400, 'แก้จำนวนไม่ได้');
    res.json({ ok: true });
  }));

  app.delete('/api/requisitions/:id/lines/:lineId', wrap(requireUser), atLeast(mod, 1), wrap(async (req, res) => {
    const header = await ownCart(req, Number(req.params.id));
    if (!header) return fail(res, 400, 'เอาออกจากตะกร้าไม่ได้');
    const { error } = await mx.from('tx_sto_requisition_line').delete()
      .eq('id', Number(req.params.lineId)).eq('requisition_id', header.id);
    if (error) return fail(res, 400, 'เอาออกจากตะกร้าไม่ได้');
    res.json({ ok: true });
  }));

  // Status flow: cart -> submitted -> accepted -> preparing -> ready -> received (owner may cancel before received).
  app.post('/api/requisitions/:id/status', wrap(requireUser), wrap(async (req, res) => {
    const id = Number(req.params.id);
    const status = String(req.body.status || '');
    const { data: header, error } = await mx.from('tx_sto_requisition').select('*').eq('id', id).maybeSingle();
    if (error || !header) return fail(res, 404, 'ไม่พบใบเบิก');
    const mine = header.requested_by === req.user.employeeId;
    const admin = isAdmin(req);
    try {
      if (status === 'submitted' && mine && header.status === 'cart') {
        const costcenter = String(req.body.costcenter || header.costcenter || '').trim();
        if (!(await ownCenter(req, costcenter))) return fail(res, 400, 'เลือก costcenter ในขอบเขตของคุณ');
        const { data: lines, error: lineError } = await mx.from('tx_sto_requisition_line').select('material').eq('requisition_id', id);
        if (lineError || !lines?.length) return fail(res, 400, 'ตะกร้าว่าง');
        for (const line of lines) {
          const stock = await mx.from('mt_sto_stock').select('material').eq('costcenter', costcenter).eq('material', line.material).maybeSingle();
          if (!stock.data) return fail(res, 400, `costcenter นี้ยังไม่มียอดของ ${line.material}`);
        }
        if (costcenter !== header.costcenter) {
          const applied = await mx.rpc('tx_sto_apply_costcenter', { p_id: id, p_employee: req.user.employeeId, p_costcenter: costcenter });
          if (applied.error) return fail(res, 400, 'บันทึก costcenter ไม่ได้');
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
}
