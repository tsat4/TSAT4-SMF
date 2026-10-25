import { mx } from '../../core/db.js';
import { fail, wrap, amountOf, cleanTerm, adminWriteError } from '../../core/http.js';
import { atLeast } from '../../core/access.js';
import { requireUser } from '../../core/users.js';

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

export function mountMaterials(app, mod) {
  app.get('/api/usage-materials', wrap(requireUser), atLeast(mod, 3), wrap(async (req, res) => {
    const term = cleanTerm(req.query.q);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    let query = mx.from('mt_sto_usage')
      .select('no,material,material_description,bun,price,crcy,status,usage_group,img', { count: 'exact' })
      .order('material')
      .range(offset, offset + 49);
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
    const term = cleanTerm(req.query.q);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    let query = mx.from('mt_sto_usage')
      .select('material,material_description,bun,status,usage_group,img', { count: 'exact' })
      .eq('status', 'Active')
      .order('material')
      .range(offset, offset + limit - 1);
    if (term) query = query.or(`material.ilike.%${term}%,material_description.ilike.%${term}%,usage_group.ilike.%${term}%`);
    const { data, error, count } = await query;
    if (error) return fail(res, 400, 'ค้นหารายการไม่ได้');
    res.json({ materials: data || [], total: count || 0 });
  }));
}
