import { tx } from '../../core/db.js';
import { fail } from '../../core/http.js';
import { accessOf, actRoute, dateOf, fetchAll, imageBytes, must, requireAdmin, yearOf } from './common.js';

// CFO (Carbon Footprint for Organization): Dashboard totals, monthly entry, and master data (EF, activities, company).
// Tables: db/act/cfo.sql (scripts/act-sql.js cfoSql) · spec: docs/specs/act-cfo.md
export const CFO_ON = ['cfo'];
const SETTING_KEYS = ['company_name', 'company_address', 'company_area', 'company_business', 'company_customers', 'company_employees', 'company_updated',
  'company_photo1', 'company_photo2', 'base_year', 'target_percent', 'septic_bod', 'septic_b0', 'septic_mcf', 'septic_i'];
// production_<year> = pieces produced that year (Carbon intensity = tCO2e / pieces)
const settingKey = (k) => SETTING_KEYS.includes(k) || /^production_\d{4}$/.test(k);
const EF_VALUES = ['kgco2e', 'co2', 'ch4_fossil', 'ch4', 'n2o', 'hfc', 'pfc', 'unit', 'scope_code'];

const text = (v, max = 500) => String(v ?? '').trim().slice(0, max) || null;
const numOrNull = (v) => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);
const monthOf = (v) => (/^\d{4}-\d{2}$/.test(String(v || '')) ? dateOf(`${v}-01`) : null);

// Septic tank (IPCC, as TSATP4-CFO septicCalc): kg CH4 = people × days × BOD × 0.001 × I × B0 × MCF.
export function septicKg(inputs, s) {
  const n = (k) => Number(s[k] || 0);
  return Math.round(Number(inputs.people || 0) * Number(inputs.days || 0) * n('septic_bod') * 0.001 * n('septic_i') * n('septic_b0') * n('septic_mcf') * 1e6) / 1e6;
}

export function mountCfo(app) {
  const route = actRoute(app, { only: CFO_ON });
  const settingsOf = async (t) => Object.fromEntries((must(await tx.from(t.setting).select('key,value'))).map((r) => [r.key, r.value]));
  const thisYear = () => new Date().getFullYear();

  // ---------- Dashboard ----------
  // Year totals by month / scope / category / department, compared with the base year (setting base_year) and
  // its target (target_percent, default 5% as TSATP4-CFO) or, without a base year, with the year before.
  // department filters everything; base and target follow the same filter.
  route('get', '/api/act/:activity/cfo/summary', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const department = text(req.query.department, 80);
    const settings = await settingsOf(t);
    const baseYear = yearOf(settings.base_year, 0) || null;
    const compareYear = baseYear && baseYear !== year ? baseYear : year - 1;
    const target = Number(settings.target_percent ?? 5) || 0;
    const rowsOf = (y) => fetchAll(() => {
      let q = tx.from(t.entryView).select('month,scope,scope_code,scope_name,department,tco2e,tco2e_co2,tco2e_ch4,tco2e_n2o,tco2e_fgas').gte('month', `${y}-01-01`).lte('month', `${y}-12-01`).order('id');
      if (department) q = q.eq('department', department);
      return q;
    });
    const [cur, base] = await Promise.all([rowsOf(year), rowsOf(compareYear)]);
    const sum = (list) => Math.round(list.reduce((s, r) => s + Number(r.tco2e), 0) * 1000) / 1000;
    const inMonth = (list, m) => list.filter((r) => Number(r.month.slice(5, 7)) === m);
    // tco2e = this year, base = the compare year (categories: every category used in either year)
    const group = (key, label, list) => Object.values(list.reduce((acc, [r, field]) => {
      const k = r[key];
      acc[k] = acc[k] || { key: k, scope: r.scope, label: label(r), tco2e: 0, base: 0 };
      acc[k][field] += Number(r.tco2e);
      return acc;
    }, {})).map((g) => ({ ...g, tco2e: Math.round(g.tco2e * 1000) / 1000, base: Math.round(g.base * 1000) / 1000 })).sort((a, b) => b.tco2e - a.tco2e);
    const tagged = (withBase) => [...cur.map((r) => [r, 'tco2e']), ...(withBase ? base.map((r) => [r, 'base']) : [])];
    const gasOf = (list) => {
      const add = (key) => Math.round(list.reduce((s, r) => s + Number(r[key] || 0), 0) * 1000) / 1000;
      return { co2: add('tco2e_co2'), ch4: add('tco2e_ch4'), n2o: add('tco2e_n2o'), fgas: add('tco2e_fgas') };
    };
    res.json({
      year,
      department,
      compare: { year: compareYear, isBase: compareYear === baseYear, target, total: sum(base), scopes: [1, 2, 3].map((n) => sum(base.filter((r) => r.scope === n))) },
      total: sum(cur),
      scopes: [1, 2, 3].map((scope) => ({ scope, tco2e: sum(cur.filter((r) => r.scope === scope)) })),
      months: Array.from({ length: 12 }, (_, i) => {
        const list = inMonth(cur, i + 1);
        const before = inMonth(base, i + 1);
        const was = sum(before);
        return {
          month: i + 1, scopes: [1, 2, 3].map((n) => sum(list.filter((r) => r.scope === n))), total: sum(list),
          base: was, baseScopes: [1, 2, 3].map((n) => sum(before.filter((r) => r.scope === n))), target: Math.round(was * (1 - target / 100) * 1000) / 1000
        };
      }),
      categories: group('scope_code', (r) => `${r.scope_code} ${r.scope_name}`, tagged(true))
        .sort((a, b) => a.scope - b.scope || Number(a.key.split('-')[1]) - Number(b.key.split('-')[1])),
      departments: group('department', (r) => r.department, tagged(false)),
      gases: [0, 1, 2, 3].map((scope) => ({ scope, ...gasOf(scope ? cur.filter((r) => r.scope === scope) : cur) })),
      settings
    });
  });

  // Every activity of a year with its months (Dashboard > Scope and transaction): months recorded / months due
  // (this year: up to this month) as TSATP4-CFO getScopeAccount, plus what this user may record (canEdit).
  route('get', '/api/act/:activity/cfo/progress', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const now = new Date();
    const due = year < now.getFullYear() ? 12 : year > now.getFullYear() ? 0 : now.getMonth() + 1;
    const [access, settings, activities, efs, scopes, gwp, entries, details] = await Promise.all([
      accessOf(req, activity, year),
      settingsOf(t),
      fetchAll(() => tx.from(t.activity).select('id,department,name,detail,calc,status,ef_id,gwp_code').order('id')),
      fetchAll(() => tx.from(t.ef).select('id,scope_code,kind,name,unit,kgco2e').order('id')),
      fetchAll(() => tx.from(t.cfoScope).select('code,name').order('code')),
      fetchAll(() => tx.from(t.gwp).select('code,ch4').order('code')),
      fetchAll(() => tx.from(t.entryView).select('id,month,activity_id,qty,tco2e').gte('month', `${year}-01-01`).lte('month', `${year}-12-01`).order('id')),
      fetchAll(() => tx.from(t.entry).select('id,status,inputs,doc,remark,updated_at,updated_by').gte('month', `${year}-01-01`).lte('month', `${year}-12-01`).order('id'))
    ]);
    const efById = new Map(efs.map((e) => [e.id, e]));
    const scopeName = new Map(scopes.map((s) => [s.code, s.name]));
    const gwpCh4 = new Map(gwp.map((g) => [g.code, g.ch4]));
    const detailOf = new Map(details.map((d) => [d.id, d]));
    const category = (ef) => `${scopeName.get(ef.scope_code) || ef.scope_code || '-'}${ef.scope_code?.startsWith('1-') && ef.kind ? `(${ef.kind})` : ''}`;
    res.json({
      year,
      due,
      admin: access.admin,
      departments: access.departments,
      septic: Object.fromEntries(Object.entries(settings).filter(([k]) => k.startsWith('septic_'))),
      rows: activities.filter((a) => a.status === 'Active' || entries.some((e) => e.activity_id === a.id)).map((a) => {
        const list = entries.filter((e) => e.activity_id === a.id);
        const months = [...new Set(list.map((e) => Number(e.month.slice(5, 7))))];
        const ef = efById.get(a.ef_id) || {};
        return {
          id: a.id, department: a.department, name: a.name, detail: a.detail, calc: a.calc, scope_code: ef.scope_code, category: category(ef), source: ef.name,
          canEdit: access.admin || access.departments.includes(a.department),
          unit: a.calc === 'septic' ? 'kg CH₄' : ef.unit, kgco2e: a.calc === 'septic' ? gwpCh4.get(a.gwp_code) : ef.kgco2e,
          byMonth: Object.fromEntries(list.map((e) => [Number(e.month.slice(5, 7)), { qty: e.qty, tco2e: e.tco2e, ...detailOf.get(e.id) }])),
          months: months.sort((x, y) => x - y),
          percent: due ? Math.min(100, Math.round((months.filter((m) => m <= due).length / due) * 100)) : 0,
          qty: Math.round(list.reduce((s, e) => s + Number(e.qty), 0) * 1000) / 1000,
          tco2e: Math.round(list.reduce((s, e) => s + Number(e.tco2e), 0) * 1000) / 1000
        };
      })
    });
  });

  // ---------- transaction: save one activity × month ----------
  route('put', '/api/act/:activity/cfo/entries', async (req, res, activity, t) => {
    const month = monthOf(req.body?.month);
    const activityId = Number(req.body?.activityId);
    if (!month || !activityId) return fail(res, 400, 'เลือกกิจกรรมและเดือน');
    const act = must(await tx.from(t.activity).select('id,department,calc,ef_id,gwp_code').eq('id', activityId).maybeSingle());
    if (!act) return fail(res, 404, 'ไม่พบกิจกรรม');
    const access = await accessOf(req, activity, Number(month.slice(0, 4)));
    if (!access.admin && !access.departments.includes(act.department)) return fail(res, 403, `บันทึกได้เฉพาะตัวแทนหน่วยงาน ${act.department} หรือผู้จัดทำ`);
    const current = must(await tx.from(t.entry).select('id,status').eq('activity_id', act.id).eq('month', month).maybeSingle());
    if (current?.status === 'CONFIRMED' && !access.admin) return fail(res, 400, 'เดือนนี้ยืนยันแล้ว แก้ได้เฉพาะผู้จัดทำ');
    let inputs = null;
    let qty = numOrNull(req.body?.qty);
    if (act.calc === 'septic') {
      inputs = { people: Number(req.body?.inputs?.people), days: Number(req.body?.inputs?.days) };
      if (!(inputs.people >= 0) || !(inputs.days > 0)) return fail(res, 400, 'ระบุจำนวนคน (0 ขึ้นไป) และจำนวนวันทำงาน (มากกว่า 0)');
      qty = septicKg(inputs, await settingsOf(t));
    }
    if (qty == null || Number.isNaN(qty) || qty < 0) return fail(res, 400, 'ปริมาณต้องเป็นตัวเลข 0 ขึ้นไป');
    const linked = must(await tx.from(t.ef).select('id,code,year,kgco2e,status').eq('id', act.ef_id).maybeSingle());
    let ef = linked;
    if (linked?.code) {
      const peers = must(await tx.from(t.ef).select('id,year,kgco2e,status').eq('code', linked.code).eq('status', 'Active'));
      const entryYear = Number(month.slice(0, 4));
      const fit = peers.filter((row) => row.kgco2e != null && (row.year == null || Number(row.year) <= entryYear))
        .sort((a, b) => Number(b.year || 0) - Number(a.year || 0))[0];
      if (fit) ef = fit;
    }
    if (!ef || ef.kgco2e == null) return fail(res, 400, 'EF ของกิจกรรมนี้ยังไม่มีค่า ให้ผู้จัดทำแก้ที่ Setting');
    const quality = req.body?.quality && typeof req.body.quality === 'object' ? {
      activity: ['X', 'Y', 'Z'].includes(req.body.quality.activity) ? req.body.quality.activity : '',
      ef: ['C', 'D', 'E', 'F'].includes(req.body.quality.ef) ? req.body.quality.ef : ''
    } : null;
    if (quality?.activity && quality?.ef) inputs = { ...(inputs || {}), quality };
    let doc = text(req.body?.doc);
    const shot = imageBytes(req.body?.image);
    if (shot) {
      const key = `evidence/${act.id}_${month}_${Date.now()}.jpg`;
      const uploaded = await tx.storage.from(t.bucket).upload(key, new Uint8Array(shot), { contentType: 'image/jpeg', upsert: false });
      if (uploaded.error) return fail(res, 400, /bucket/i.test(String(uploaded.error.message)) ? `ยังไม่ได้สร้างที่เก็บรูป ${t.bucket} ใน Tx Data` : 'อัปโหลดหลักฐานไม่ได้');
      doc = tx.storage.from(t.bucket).getPublicUrl(key).data.publicUrl;
    }
    const row = { qty, inputs, doc, ef_id: ef.id, gwp_code: act.gwp_code, remark: text(req.body?.remark), updated_by: req.user.employeeId, updated_at: new Date().toISOString() };
    if (current) must(await tx.from(t.entry).update(row).eq('id', current.id));
    else must(await tx.from(t.entry).insert({ ...row, activity_id: act.id, month, created_by: req.user.employeeId }));
    res.json({ ok: true, qty });
  });

  route('delete', '/api/act/:activity/cfo/entries/:id', async (req, res, activity, t) => {
    const entry = must(await tx.from(t.entry).select('id,month,status,activity_id').eq('id', Number(req.params.id)).maybeSingle());
    if (!entry) return fail(res, 404, 'ไม่พบรายการ');
    const act = must(await tx.from(t.activity).select('department').eq('id', entry.activity_id).single());
    const access = await accessOf(req, activity, Number(entry.month.slice(0, 4)));
    if (!access.admin && (entry.status === 'CONFIRMED' || !access.departments.includes(act.department))) return fail(res, 403, 'ลบรายการนี้ไม่ได้');
    must(await tx.from(t.entry).delete().eq('id', entry.id));
    res.json({ ok: true });
  });

  // Admin confirms (or reopens) a whole month.
  route('post', '/api/act/:activity/cfo/confirm', async (req, res, activity, t) => {
    const status = req.body?.status === 'DRAFT' ? 'DRAFT' : 'CONFIRMED';
    const year = !req.body?.month && yearOf(req.body?.year, 0);
    const month = monthOf(req.body?.month);
    if (!month && !year) return fail(res, 400, 'เดือนไม่ถูกต้อง');
    if (!(await requireAdmin(req, res, activity, Number((month || String(year)).slice(0, 4))))) return;
    let query = tx.from(t.entry).update({ status, updated_by: req.user.employeeId, updated_at: new Date().toISOString() }).select('id');
    query = month ? query.eq('month', month) : query.gte('month', `${year}-01-01`).lte('month', `${year}-12-01`);
    const done = must(await query);
    res.json({ ok: true, count: done.length });
  });

  // ---------- Setting: master data (admin of this year edits) ----------
  route('get', '/api/act/:activity/cfo/master', async (req, res, activity, t) => {
    const [scopes, gwp, ef, activities, used, settings] = await Promise.all([
      fetchAll(() => tx.from(t.cfoScope).select('*').order('scope').order('code')),
      fetchAll(() => tx.from(t.gwp).select('*').order('code')),
      fetchAll(() => tx.from(t.ef).select('*').order('scope_code').order('id')),
      fetchAll(() => tx.from(t.activity).select('*').order('department').order('id')),
      fetchAll(() => tx.from(t.entry).select('ef_id,activity_id').order('id')),
      settingsOf(t)
    ]);
    const usedEf = new Set(used.map((u) => u.ef_id));
    const usedAct = new Set(used.map((u) => u.activity_id));
    res.json({
      admin: (await accessOf(req, activity, thisYear())).admin,
      scopes, gwp, settings,
      ef: ef.map((e) => ({ ...e, used: usedEf.has(e.id) })),
      activities: activities.map((a) => ({ ...a, used: usedAct.has(a.id) }))
    });
  });

  const efInput = (b) => {
    const row = { scope_code: text(b.scope_code, 10), kind: text(b.kind, 120), name: text(b.name, 300), detail: text(b.detail, 1000), unit: text(b.unit, 30), reference: text(b.reference, 500), year: numOrNull(b.year), status: b.status === 'Inactive' ? 'Inactive' : 'Active' };
    for (const k of ['kgco2e', 'co2', 'ch4_fossil', 'ch4', 'n2o', 'hfc', 'pfc']) row[k] = numOrNull(b[k]);
    if (!row.scope_code || !row.name || !row.unit) return { error: 'ระบุหมวด ชื่อ และหน่วย' };
    if (['kgco2e', 'co2', 'ch4_fossil', 'ch4', 'n2o', 'hfc', 'pfc', 'year'].some((k) => Number.isNaN(row[k]))) return { error: 'ค่าตัวเลขไม่ถูกต้อง' };
    if (row.status === 'Active' && row.kgco2e == null) return { error: 'EF ที่ใช้งานต้องมีค่า kgCO2e ต่อหน่วย' };
    return { row };
  };
  route('post', '/api/act/:activity/cfo/ef', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const { row, error } = efInput(req.body || {});
    if (error) return fail(res, 400, error);
    must(await tx.from(t.ef).insert(row));
    res.status(201).json({ ok: true });
  });
  // An EF that entries already use keeps its values: add a new row and set the old one Inactive.
  route('patch', '/api/act/:activity/cfo/ef/:id', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const id = Number(req.params.id);
    const current = must(await tx.from(t.ef).select('*').eq('id', id).maybeSingle());
    if (!current) return fail(res, 404, 'ไม่พบ EF');
    const { row, error } = efInput(req.body || {});
    if (error) return fail(res, 400, error);
    const used = must(await tx.from(t.entry).select('id').eq('ef_id', id).limit(1)).length > 0;
    if (used && EF_VALUES.some((k) => String(row[k] ?? '') !== String(current[k] ?? ''))) return fail(res, 400, 'EF นี้ถูกใช้แล้ว แก้ค่าไม่ได้ ให้เพิ่ม EF ใหม่แล้วปิดตัวเดิม');
    must(await tx.from(t.ef).update(row).eq('id', id));
    res.json({ ok: true });
  });
  route('delete', '/api/act/:activity/cfo/ef/:id', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const id = Number(req.params.id);
    const usedBy = must(await tx.from(t.activity).select('id').eq('ef_id', id).limit(1)).length + must(await tx.from(t.entry).select('id').eq('ef_id', id).limit(1)).length;
    if (usedBy) return fail(res, 400, 'EF นี้ถูกใช้แล้ว ลบไม่ได้ ให้ตั้งเป็น Inactive');
    must(await tx.from(t.ef).delete().eq('id', id));
    res.json({ ok: true });
  });

  const activityInput = (b) => {
    const row = { ef_id: Number(b.ef_id), gwp_code: text(b.gwp_code, 20) || 'AR5', department: text(b.department, 80), name: text(b.name, 200), detail: text(b.detail, 500), calc: b.calc === 'septic' ? 'septic' : null, status: b.status === 'Inactive' ? 'Inactive' : 'Active' };
    if (!row.ef_id || !row.department || !row.name) return { error: 'ระบุหน่วยงาน ชื่อกิจกรรม และ EF' };
    return { row };
  };
  route('post', '/api/act/:activity/cfo/activities', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const { row, error } = activityInput(req.body || {});
    if (error) return fail(res, 400, error);
    must(await tx.from(t.activity).insert(row));
    res.status(201).json({ ok: true });
  });
  route('patch', '/api/act/:activity/cfo/activities/:id', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const { row, error } = activityInput(req.body || {});
    if (error) return fail(res, 400, error);
    must(await tx.from(t.activity).update(row).eq('id', Number(req.params.id)));
    res.json({ ok: true });
  });
  route('delete', '/api/act/:activity/cfo/activities/:id', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const id = Number(req.params.id);
    if (must(await tx.from(t.entry).select('id').eq('activity_id', id).limit(1)).length) return fail(res, 400, 'กิจกรรมนี้มีข้อมูลแล้ว ลบไม่ได้ ให้ตั้งเป็น Inactive');
    must(await tx.from(t.activity).delete().eq('id', id));
    res.json({ ok: true });
  });

  route('post', '/api/act/:activity/cfo/photo', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const slot = [1, 2].includes(Number(req.body?.slot)) ? Number(req.body.slot) : 0;
    const bytes = imageBytes(req.body?.image);
    if (!slot || !bytes) return fail(res, 400, 'รูปต้องเป็น JPEG ไม่เกิน 700 KB');
    const key = `company/photo${slot}_${Date.now()}.jpg`;
    const uploaded = await tx.storage.from(t.bucket).upload(key, new Uint8Array(bytes), { contentType: 'image/jpeg', upsert: false });
    if (uploaded.error) return fail(res, 400, /bucket/i.test(String(uploaded.error.message)) ? `ยังไม่ได้สร้างที่เก็บรูป ${t.bucket} ใน Tx Data` : 'อัปโหลดรูปไม่ได้');
    const url = tx.storage.from(t.bucket).getPublicUrl(key).data.publicUrl;
    must(await tx.from(t.setting).upsert([{ key: `company_photo${slot}`, value: url }], { onConflict: 'key' }));
    res.status(201).json({ url });
  });

  route('put', '/api/act/:activity/cfo/settings', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const rows = Object.entries(req.body || {}).filter(([k]) => settingKey(k)).map(([key, value]) => ({ key, value: String(value ?? '').trim().slice(0, 1000) }));
    if (!rows.length) return fail(res, 400, 'ไม่มีข้อมูลให้บันทึก');
    must(await tx.from(t.setting).upsert(rows, { onConflict: 'key' }));
    res.json({ ok: true });
  });
}
