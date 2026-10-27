import { mx } from '../../core/db.js';
import { fail, wrap, qtyOf, cleanTerm, listFilters } from '../../core/http.js';
import { atLeast, rankIn } from '../../core/access.js';
import { nameOf, requireUser } from '../../core/users.js';
import { centersForDepartments, costcenterMap, ownCenter } from '../../core/master.js';
import { assertEntitlement, yearBounds } from './ledger.js';

const DRAFT_COSTCENTER = '-';

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

async function requesterNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await mx.from('mt_main_employee').select('employee_id,prefix,first_name,last_name').in('employee_id', unique);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.employee_id, nameOf(row)]));
}

async function sourceMap(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await mx.from('tx_sto_requisition_line').select('requisition_id,costcenter').in('requisition_id', unique);
  if (error) throw error;
  const map = new Map();
  for (const row of data || []) {
    if (!row.costcenter || row.costcenter === '-') continue;
    const list = map.get(row.requisition_id) || [];
    if (!list.includes(row.costcenter)) list.push(row.costcenter);
    map.set(row.requisition_id, list);
  }
  return map;
}

async function decorate(headers, linesById = new Map()) {
  const listed = await sourceMap(headers.map((row) => row.id).filter((id) => !linesById.has(id)));
  const lineCodes = [...linesById.values()].flat().map((line) => line.costcenter);
  const centers = await costcenterMap([...headers.map((row) => row.costcenter), ...lineCodes]);
  const people = await requesterNames(headers.map((row) => row.requested_by));
  const materials = await materialMap([...linesById.values()].flat().map((line) => line.material));
  return headers.map((row) => ({
    ...row,
    costcenterName: centers.get(row.costcenter)?.object_name || '',
    department: centers.get(row.costcenter)?.department || '',
    requesterName: people.get(row.requested_by) || '',
    sources: linesById.has(row.id)
      ? [...new Set((linesById.get(row.id) || []).map((line) => line.costcenter).filter((code) => code && code !== '-'))]
      : (listed.get(row.id) || []),
    lines: (linesById.get(row.id) || []).map((line) => ({
      ...line,
      costcenterName: centers.get(line.costcenter)?.object_name || '',
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
// in one transaction.
async function receive(header) {
  const { data: lines, error: lineError } = await mx.from('tx_sto_requisition_line').select('costcenter,material,qty').eq('requisition_id', header.id);
  if (lineError) throw new Error('เปลี่ยนสถานะไม่ได้');
  await assertEntitlement(lines || []);
  const { error } = await mx.rpc('tx_sto_receive', { p_id: header.id, p_employee: header.requested_by });
  if (!error) return;
  const text = error.message || '';
  if (text.includes('not enough')) throw new Error('ยอดคงเหลือไม่พอ');
  if (text.includes('no lines')) throw new Error('ใบเบิกไม่มีรายการ');
  throw new Error('เปลี่ยนสถานะไม่ได้');
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
    const filters = listFilters(req);
    const nameTerm = cleanTerm(filters.materialDescription);
    const bunTerm = cleanTerm(filters.bun);
    const embed = nameTerm || bunTerm ? 'mt_sto_usage!inner(material_description,bun)' : 'mt_sto_usage(material_description,bun)';
    let query = mx.from('mt_sto_stock')
      .select(`costcenter,material,min_qty,current_qty,max_qty,${embed}`, { count: 'exact' })
      .in('costcenter', codes);
    if (cleanTerm(filters.costcenter)) query = query.ilike('costcenter', `%${cleanTerm(filters.costcenter)}%`);
    if (cleanTerm(filters.material)) query = query.ilike('material', `%${cleanTerm(filters.material)}%`);
    for (const [key, column] of [['minQty', 'min_qty'], ['currentQty', 'current_qty'], ['maxQty', 'max_qty']]) {
      const n = Number(cleanTerm(filters[key]));
      if (Number.isFinite(n) && cleanTerm(filters[key])) query = query.eq(column, n);
    }
    if (nameTerm) query = query.ilike('mt_sto_usage.material_description', `%${nameTerm}%`);
    if (bunTerm) query = query.ilike('mt_sto_usage.bun', `%${bunTerm}%`);
    const ascending = req.query.sort ? req.query.dir !== 'desc' : true;
    const localSort = { costcenter: 'costcenter', material: 'material', minQty: 'min_qty', currentQty: 'current_qty', maxQty: 'max_qty' };
    if (req.query.sort === 'materialDescription') query = query.order('material_description', { foreignTable: 'mt_sto_usage', ascending, nullsFirst: false });
    else if (req.query.sort === 'bun') query = query.order('bun', { foreignTable: 'mt_sto_usage', ascending, nullsFirst: false });
    else query = query.order(localSort[req.query.sort] || 'material', { ascending, nullsFirst: false });
    query = query.range(offset, offset + 49);
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

  app.get('/api/issues', wrap(requireUser), atLeast(mod, 1), wrap(async (req, res) => {
    const { start, end } = yearBounds(req.query.year);
    const issued = await mx.from('tx_sto_issue').select('*').gte('issued_at', start).lt('issued_at', end).order('issued_at', { ascending: false }).limit(500);
    if (issued.error) return fail(res, 400, 'อ่านประวัติเบิกไม่ได้');
    let openQuery = mx.from('tx_sto_requisition').select('*')
      .in('status', ['submitted', 'accepted', 'preparing', 'ready'])
      .gte('created_at', start).lt('created_at', end).order('created_at', { ascending: false }).limit(200);
    if (!isAdmin(req)) openQuery = openQuery.eq('requested_by', req.user.employeeId);
    const open = await openQuery;
    if (open.error) return fail(res, 400, 'อ่านใบเบิกไม่ได้');
    const cart = await mx.from('tx_sto_requisition').select('*').eq('requested_by', req.user.employeeId).eq('status', 'cart')
      .gte('created_at', start).lt('created_at', end);
    if (cart.error) return fail(res, 400, 'อ่านตะกร้าไม่ได้');
    const openHeaders = [...(open.data || []), ...(cart.data || [])];
    const headerIds = [...new Set((issued.data || []).map((row) => row.requisition_id))];
    const issuedHeaders = headerIds.length
      ? await mx.from('tx_sto_requisition').select('*').in('id', headerIds)
      : { data: [], error: null };
    if (issuedHeaders.error) return fail(res, 400, 'อ่านใบเบิกไม่ได้');
    const headerMap = new Map([...(issuedHeaders.data || []), ...openHeaders].map((row) => [row.id, row]));
    const openIds = openHeaders.map((row) => row.id);
    const openLines = openIds.length
      ? await mx.from('tx_sto_requisition_line').select('*').in('requisition_id', openIds)
      : { data: [], error: null };
    if (openLines.error) return fail(res, 400, 'อ่านรายการไม่ได้');
    const issueRows = isAdmin(req)
      ? (issued.data || [])
      : (issued.data || []).filter((row) => headerMap.get(row.requisition_id)?.requested_by === req.user.employeeId);
    const materials = await materialMap([...issueRows.map((row) => row.material), ...(openLines.data || []).map((row) => row.material)]);
    const centers = await costcenterMap([...issueRows.map((row) => row.costcenter), ...(openLines.data || []).map((row) => row.costcenter)]);
    const people = await requesterNames([...[...headerMap.values()].map((row) => row.requested_by)]);
    const of = (header, line, at, status) => ({
      at,
      requisitionId: header?.id || line.requisition_id,
      requestedBy: header?.requested_by || '',
      requesterName: people.get(header?.requested_by) || '',
      material: line.material,
      materialDescription: materials.get(line.material)?.material_description || '',
      bun: materials.get(line.material)?.bun || '',
      qty: Number(line.qty),
      costcenter: line.costcenter,
      costcenterName: centers.get(line.costcenter)?.object_name || '',
      department: centers.get(line.costcenter)?.department || '',
      status
    });
    const rows = [
      ...issueRows.map((row) => of(headerMap.get(row.requisition_id), row, row.issued_at, headerMap.get(row.requisition_id)?.status || 'received')),
      ...(openLines.data || []).map((line) => of(headerMap.get(line.requisition_id), line, headerMap.get(line.requisition_id)?.created_at, headerMap.get(line.requisition_id)?.status || 'cart'))
    ].sort((a, b) => new Date(b.at) - new Date(a.at) || b.requisitionId - a.requisitionId);
    res.json({ rows });
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

  app.post('/api/requisitions', wrap(requireUser), atLeast(mod, 2), wrap(async (req, res) => {
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

  app.post('/api/requisitions/:id/lines', wrap(requireUser), atLeast(mod, 2), wrap(async (req, res) => {
    const id = Number(req.params.id);
    const material = String(req.body.material || '').trim();
    const qty = qtyOf(req.body.qty);
    const header = await ownCart(req, id);
    if (!header) return fail(res, 400, 'แก้ได้เฉพาะตะกร้าของตนเอง');
    if (!material || !qty) return fail(res, 400, 'เลือกรายการ และจำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
    const costcenter = String(req.body.costcenter || header.costcenter).trim();
    if (!(await ownCenter(req, costcenter))) return fail(res, 400, 'เลือก costcenter ในขอบเขตของคุณ');
    const item = await mx.from('mt_sto_usage').select('status').eq('material', material).maybeSingle();
    if (!item.data || item.data.status !== 'Active') return fail(res, 400, 'รายการนี้ใช้งานไม่ได้');
    const existing = await mx.from('tx_sto_requisition_line').select('id,qty,costcenter').eq('requisition_id', id).eq('material', material).maybeSingle();
    if (existing.data) {
      const { error } = await mx.from('tx_sto_requisition_line').update({
        qty: Math.round(Number(existing.data.qty)) + qty, // older carts may hold a decimal: round it into a whole number
        costcenter
      }).eq('id', existing.data.id);
      if (error) return fail(res, 400, 'เพิ่มจำนวนไม่ได้');
    } else {
      const { error } = await mx.from('tx_sto_requisition_line').insert({
        requisition_id: id,
        costcenter,
        material,
        qty
      });
      if (error) return fail(res, 400, 'ใส่ตะกร้าไม่ได้');
    }
    res.json({ ok: true });
  }));

  app.patch('/api/requisitions/:id/lines/:lineId', wrap(requireUser), atLeast(mod, 2), wrap(async (req, res) => {
    const header = await ownCart(req, Number(req.params.id));
    if (!header) return fail(res, 400, 'แก้ตะกร้าไม่ได้');
    const patch = {};
    if (req.body.qty != null) {
      const qty = qtyOf(req.body.qty);
      if (!qty) return fail(res, 400, 'จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
      patch.qty = qty;
    }
    if (req.body.costcenter != null) {
      const costcenter = String(req.body.costcenter).trim();
      if (!(await ownCenter(req, costcenter))) return fail(res, 400, 'เลือก costcenter ในขอบเขตของคุณ');
      patch.costcenter = costcenter;
    }
    if (!Object.keys(patch).length) return fail(res, 400, 'แก้ตะกร้าไม่ได้');
    const { data, error } = await mx.from('tx_sto_requisition_line').update(patch)
      .eq('id', Number(req.params.lineId)).eq('requisition_id', header.id).select('id');
    if (error || !data?.length) return fail(res, 400, 'แก้จำนวนไม่ได้');
    res.json({ ok: true });
  }));

  app.delete('/api/requisitions/:id/lines/:lineId', wrap(requireUser), atLeast(mod, 2), wrap(async (req, res) => {
    const header = await ownCart(req, Number(req.params.id));
    if (!header) return fail(res, 400, 'เอาออกจากตะกร้าไม่ได้');
    const { error } = await mx.from('tx_sto_requisition_line').delete()
      .eq('id', Number(req.params.lineId)).eq('requisition_id', header.id);
    if (error) return fail(res, 400, 'เอาออกจากตะกร้าไม่ได้');
    res.json({ ok: true });
  }));

  // Status flow: cart -> submitted -> accepted -> preparing -> ready -> received (owner may cancel before received).
  app.post('/api/requisitions/:id/status', wrap(requireUser), atLeast(mod, 2), wrap(async (req, res) => {
    const id = Number(req.params.id);
    const status = String(req.body.status || '');
    const { data: header, error } = await mx.from('tx_sto_requisition').select('*').eq('id', id).maybeSingle();
    if (error || !header) return fail(res, 404, 'ไม่พบใบเบิก');
    const mine = header.requested_by === req.user.employeeId;
    const admin = isAdmin(req);
    try {
      if (status === 'submitted' && mine && header.status === 'cart') {
        const { data: lines, error: lineError } = await mx.from('tx_sto_requisition_line').select('costcenter').eq('requisition_id', id);
        if (lineError || !lines?.length) return fail(res, 400, 'ตะกร้าว่าง');
        for (const line of lines) {
          if (!(await ownCenter(req, line.costcenter))) return fail(res, 400, 'เลือก costcenter ในขอบเขตของคุณ');
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
