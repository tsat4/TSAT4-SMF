import { mx } from '../../core/db.js';
import { fail, wrap, amountOf, cleanTerm, adminWriteError, applyListQuery } from '../../core/http.js';
import { atLeast, rankIn } from '../../core/access.js';
import { requireUser } from '../../core/users.js';
import { centersForDepartments } from '../../core/master.js';

function usageGroupOf(value) {
  return String(value || '').trim().slice(0, 40);
}

async function saveUsageImage(material, dataUrl) {
  const text = String(dataUrl || '');
  if (!text) return '';
  const match = text.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length < 32 || bytes.length > 400000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const path = `${String(material).replace(/[^A-Za-z0-9._-]/g, '_')}.jpg`;
  const uploaded = await mx.storage.from('usage-img').upload(path, new Uint8Array(bytes), { contentType: 'image/jpeg', upsert: true });
  if (uploaded.error) return null;
  const { data } = mx.storage.from('usage-img').getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

async function currentStock(req, mod, materials) {
  const codes = [...new Set(materials.map((row) => row.material).filter(Boolean))];
  const totals = new Map();
  if (!codes.length) return totals;
  let centers = null;
  if (rankIn(req.user, mod.id) < 3) {
    const grouped = await centersForDepartments([req.user.department || '']);
    centers = (grouped.get(req.user.department) || []).map((row) => row.costcenter);
    if (!centers.length) return totals;
  }
  for (let from = 0; ; from += 1000) {
    let query = mx.from('mt_sto_stock').select('material,current_qty').in('material', codes);
    if (centers) query = query.in('costcenter', centers);
    const { data, error } = await query.range(from, from + 999);
    if (error) throw error;
    for (const row of data || []) totals.set(row.material, (totals.get(row.material) || 0) + (Number(row.current_qty) || 0));
    if (!data || data.length < 1000) break;
  }
  return totals;
}

export function mountMaterials(app, mod) {
  app.get('/api/usage-materials', wrap(requireUser), atLeast(mod, 3), wrap(async (req, res) => {
    const term = cleanTerm(req.query.q);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    let query = mx.from('mt_sto_usage')
      .select('no,material,material_description,bun,price,crcy,status,usage_group,img', { count: 'exact' });
    query = applyListQuery(query, req, {
      usage_group: 'text', material: 'text', material_description: 'text', price: 'num', bun: 'text', crcy: 'text', status: 'text'
    }, 'material').range(offset, offset + 49);
    if (term) query = query.or(`material.ilike.%${term}%,material_description.ilike.%${term}%,usage_group.ilike.%${term}%`);
    const { data, error, count } = await query;
    if (error) return fail(res, 400, 'อ่านรายการไม่ได้');
    res.json({ materials: data || [], total: count || 0 });
  }));

  app.post('/api/usage-materials', wrap(requireUser), atLeast(mod, 3), wrap(async (req, res) => {
    const material = String(req.body.material || '').trim();
    const materialDescription = String(req.body.materialDescription || '').trim();
    const bun = String(req.body.bun || '').trim();
    const crcy = String(req.body.crcy || 'THB').trim();
    const price = amountOf(req.body.price);
    const status = ['Active', 'Inactive'].includes(req.body.status) ? req.body.status : '';
    const usageGroup = usageGroupOf(req.body.usageGroup);
    if (!material || !materialDescription || !bun || !crcy || price == null || !status) return fail(res, 400, 'ระบุรายการให้ครบ');
    const img = req.body.img ? await saveUsageImage(material, req.body.img) : '';
    if (req.body.img && !img) return fail(res, 400, 'รูปต้องเป็นสี่เหลี่ยมจัตุรัส');
    const last = await mx.from('mt_sto_usage').select('no').order('no', { ascending: false }).limit(1).maybeSingle();
    if (last.error) return fail(res, 400, 'เพิ่มรายการไม่ได้');
    const { error } = await mx.from('mt_sto_usage').insert({
      no: Number(last.data?.no || 0) + 1,
      material,
      material_description: materialDescription,
      bun,
      price,
      crcy,
      status,
      usage_group: usageGroup || null,
      img: img || null
    });
    if (error) return fail(res, 400, adminWriteError(error, 'เพิ่มรายการไม่ได้'));
    res.status(201).json({ ok: true });
  }));

  app.patch('/api/usage-materials/:material', wrap(requireUser), atLeast(mod, 3), wrap(async (req, res) => {
    const materialDescription = String(req.body.materialDescription || '').trim();
    const bun = String(req.body.bun || '').trim();
    const crcy = String(req.body.crcy || '').trim();
    const price = amountOf(req.body.price);
    const status = ['Active', 'Inactive'].includes(req.body.status) ? req.body.status : '';
    const usageGroup = usageGroupOf(req.body.usageGroup);
    const nextMaterial = String(req.body.material || '').trim();
    if (!materialDescription || !bun || !crcy || price == null || !status) return fail(res, 400, 'ระบุรายการให้ครบ');
    const patch = {
      material_description: materialDescription,
      bun,
      price,
      crcy,
      status,
      usage_group: usageGroup || null
    };
    if (nextMaterial && nextMaterial !== req.params.material) patch.material = nextMaterial;
    if (req.body.img) {
      const img = await saveUsageImage(req.params.material, req.body.img);
      if (!img) return fail(res, 400, 'รูปต้องเป็นสี่เหลี่ยมจัตุรัส');
      patch.img = img;
    }
    const { data, error } = await mx.from('mt_sto_usage').update(patch).eq('material', req.params.material).select('material');
    if (error) return fail(res, 400, adminWriteError(error, 'แก้ไขรายการไม่ได้'));
    if (!data?.length) return fail(res, 400, 'แก้ไขรายการไม่ได้');
    res.json({ ok: true });
  }));

  app.delete('/api/usage-materials/:material', wrap(requireUser), atLeast(mod, 3), wrap(async (req, res) => {
    const used = await mx.from('mt_sto_stock').select('material', { count: 'exact', head: true }).eq('material', req.params.material);
    if (used.count) return fail(res, 400, 'รายการนี้มียอดคงเหลือ ลบไม่ได้');
    const { error } = await mx.from('mt_sto_usage').delete().eq('material', req.params.material);
    if (error) return fail(res, 400, adminWriteError(error, 'ลบรายการไม่ได้'));
    res.json({ ok: true });
  }));

  app.get('/api/materials', wrap(requireUser), atLeast(mod, 1), wrap(async (req, res) => {
    if (req.query.codes != null) {
      const codes = [...new Set(String(req.query.codes).split(',').map((item) => item.trim()).filter(Boolean))].slice(0, 40);
      if (!codes.length) return res.json({ materials: [] });
      const { data, error } = await mx.from('mt_sto_usage').select('material,material_description,bun,status').in('material', codes);
      if (error) return fail(res, 400, 'ค้นหารายการไม่ได้');
      return res.json({ materials: data || [] });
    }
    if (req.query.part === 'groups') {
      const groups = new Map();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await mx.from('mt_sto_usage').select('usage_group').eq('status', 'Active').range(from, from + 999);
        if (error) return fail(res, 400, 'อ่านกลุ่มไม่ได้');
        for (const row of data || []) groups.set(row.usage_group || '', (groups.get(row.usage_group || '') || 0) + 1);
        if (!data || data.length < 1000) break;
      }
      return res.json({ groups: [...groups.entries()].map(([name, count]) => ({ name, count })) });
    }
    const term = cleanTerm(req.query.q);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const group = String(req.query.group || '');
    let query = mx.from('mt_sto_usage')
      .select('material,material_description,bun,price,status,usage_group,img', { count: 'exact' })
      .eq('status', 'Active');
    if (group === '-') query = query.is('usage_group', null);
    else if (group) {
      const name = cleanTerm(group);
      if (name) query = query.eq('usage_group', name);
    }
    query = applyListQuery(query, req, {
      usage_group: 'text', material: 'text', material_description: 'text', price: 'num', bun: 'text'
    }, 'material').range(offset, offset + limit - 1);
    if (term) query = query.or(`material.ilike.%${term}%,material_description.ilike.%${term}%,usage_group.ilike.%${term}%`);
    const { data, error, count } = await query;
    if (error) return fail(res, 400, 'ค้นหารายการไม่ได้');
    let totals;
    try {
      totals = await currentStock(req, mod, data || []);
    } catch {
      return fail(res, 400, 'อ่านยอดคงเหลือไม่ได้');
    }
    res.json({
      materials: (data || []).map((row) => ({ ...row, currentQty: totals.get(row.material) || 0 })),
      total: count || 0
    });
  }));
}
