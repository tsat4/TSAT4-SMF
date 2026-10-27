import { tx } from '../../core/db.js';
import { fail } from '../../core/http.js';
import { accessOf, actRoute, dateOf, fetchAll, imageBytes, must, namesOf, requireAdmin, yearOf } from './common.js';

// CFO (Carbon Footprint for Organization): Dashboard totals, monthly entry, and master data (EF, activities, company).
// Tables: db/act/cfo.sql (scripts/act-sql.js cfoSql) · spec: docs/specs/act-cfo.md
export const CFO_ON = ['cfo'];
const SETTING_KEYS = ['company_name', 'company_address', 'company_area', 'company_business', 'company_customers', 'company_employees', 'company_updated',
  'company_photo1', 'company_photo2', 'base_year', 'target_percent', 'septic_bod', 'septic_b0', 'septic_mcf', 'septic_i'];
// production_<year> = pieces produced that year (Carbon intensity = tCO2e / pieces)
const settingKey = (k) => SETTING_KEYS.includes(k) || /^production_\d{4}$/.test(k);
// Values an EF keeps once entries use it (Fr-04.1 gas columns included).
const EF_NUMBERS = ['kgco2e', 'co2', 'ch4_fossil', 'ch4', 'n2o', 'sf6', 'nf3', 'hfc', 'hfc_gwp', 'pfc', 'pfc_gwp', 'other', 'other_gwp', 'co2_bio'];
const EF_VALUES = [...EF_NUMBERS, 'unit', 'scope_code', 'separate'];
const EF_SOURCES = ['self', 'supplier', 'th_lci', 'tgo', 'thai_res', 'int_db', 'other'];
// TGO Fr-03.2 criteria (✓ / ×): significant = has a source and meets at least one.
export const S3_CRITERIA = ['magnitude', 'influence', 'risk', 'sector', 'outsourcing', 'engagement'];

const text = (v, max = 500) => String(v ?? '').trim().slice(0, max) || null;
const numOrNull = (v) => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);
const monthOf = (v) => (/^\d{4}-\d{2}$/.test(String(v || '')) ? dateOf(`${v}-01`) : null);

// Septic tank (IPCC, as TSATP4-CFO septicCalc): kg CH4 = people × days × BOD × 0.001 × I × B0 × MCF.
export function septicKg(inputs, s) {
  const n = (k) => Number(s[k] || 0);
  return Math.round(Number(inputs.people || 0) * Number(inputs.days || 0) * n('septic_bod') * 0.001 * n('septic_i') * n('septic_b0') * n('septic_mcf') * 1e6) / 1e6;
}

// Quantity formulas (activity.calc): the inputs the form asks for → qty in the EF unit.
export const CFO_CALCS = {
  septic: { fields: ['people', 'days'], ok: (i) => i.people >= 0 && i.days > 0, error: 'ระบุจำนวนคน (0 ขึ้นไป) และจำนวนวันทำงาน (มากกว่า 0)', qty: (i, s) => septicKg(i, s) },
  tkm: { fields: ['tons', 'km'], ok: (i) => i.tons >= 0 && i.km >= 0, error: 'ระบุน้ำหนัก (ตัน) และระยะทาง (กม.) 0 ขึ้นไป', qty: (i) => Math.round(i.tons * i.km * 1e6) / 1e6 },
  km_fuel: { fields: ['km', 'km_per_l'], ok: (i) => i.km >= 0 && i.km_per_l > 0, error: 'ระบุระยะทาง (กม.) และอัตราสิ้นเปลือง (กม./ลิตร มากกว่า 0)', qty: (i) => Math.round((i.km / i.km_per_l) * 1e6) / 1e6 }
};

export function mountCfo(app) {
  const route = actRoute(app, { only: CFO_ON });
  const settingsOf = async (t) => Object.fromEntries((must(await tx.from(t.setting).select('key,value'))).map((r) => [r.key, r.value]));
  const thisYear = () => new Date().getFullYear();
  // บันทึกการปรับปรุง: written next to an admin change. A missing table (SQL not run yet) never blocks the change.
  const logRev = async (t, req, area, ref, detail) => {
    if (!detail) return;
    const { error } = await tx.from(t.revision).insert({ area, ref: ref == null ? null : String(ref).slice(0, 300), detail: String(detail).slice(0, 2000), by: req.user.employeeId });
    if (error) console.warn(`cfo revision log: ${error.message}`);
  };
  const changes = (before, after, keys) => keys.filter((k) => String(before?.[k] ?? '') !== String(after[k] ?? ''))
    .map((k) => `${k}: ${before?.[k] ?? '-'} → ${after[k] ?? '-'}`).join(' · ');

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
      let q = tx.from(t.entryView).select('*').gte('month', `${y}-01-01`).lte('month', `${y}-12-01`).order('id');
      if (department) q = q.eq('department', department);
      return q;
    });
    // รายงานแยก (EF separate) stays out of every Scope total and is reported on its own (Fr-05 "อื่นๆ").
    const [curAll, baseAll] = await Promise.all([rowsOf(year), rowsOf(compareYear)]);
    const [cur, base] = [curAll, baseAll].map((list) => list.filter((r) => !r.separate));
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
      return { co2: add('tco2e_co2'), ch4: add('tco2e_ch4'), n2o: add('tco2e_n2o'), fgas: add('tco2e_fgas'), sf6nf3: add('tco2e_sf6_nf3') };
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
      separate: [curAll, baseAll].reduce((o, list, i) => ({ ...o, [i ? 'base' : 'tco2e']: Math.round((sum(list.filter((r) => r.separate)) + list.reduce((s, r) => s + Number(r.tco2e_bio || 0), 0)) * 1000) / 1000 }), {}),
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
    const calc = CFO_CALCS[act.calc];
    if (calc) {
      inputs = Object.fromEntries(calc.fields.map((k) => [k, Number(req.body?.inputs?.[k])]));
      if (!calc.ok(inputs)) return fail(res, 400, calc.error);
      qty = calc.qty(inputs, act.calc === 'septic' ? await settingsOf(t) : {});
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
    await logRev(t, req, status === 'CONFIRMED' ? 'ยืนยันข้อมูล' : 'เปิดให้แก้', month ? month.slice(0, 7) : `ปี ${year}`, `${status === 'CONFIRMED' ? 'ยืนยัน' : 'เปิดให้แก้'} ${done.length} รายการ`);
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
    const row = { scope_code: text(b.scope_code, 10), kind: text(b.kind, 120), name: text(b.name, 300), detail: text(b.detail, 1000), unit: text(b.unit, 30), reference: text(b.reference, 500), year: numOrNull(b.year), status: b.status === 'Inactive' ? 'Inactive' : 'Active',
      separate: b.separate === true || b.separate === 'true', source_type: EF_SOURCES.includes(b.source_type) ? b.source_type : null, substitute: text(b.substitute, 300) };
    for (const k of EF_NUMBERS) row[k] = numOrNull(b[k]);
    if (!row.scope_code || !row.name || !row.unit) return { error: 'ระบุหมวด ชื่อ และหน่วย' };
    if ([...EF_NUMBERS, 'year'].some((k) => Number.isNaN(row[k]))) return { error: 'ค่าตัวเลขไม่ถูกต้อง' };
    if (row.status === 'Active' && row.kgco2e == null) return { error: 'EF ที่ใช้งานต้องมีค่า kgCO2e ต่อหน่วย' };
    return { row };
  };
  route('post', '/api/act/:activity/cfo/ef', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const { row, error } = efInput(req.body || {});
    if (error) return fail(res, 400, error);
    must(await tx.from(t.ef).insert(row));
    await logRev(t, req, 'Emission Factor', `${row.scope_code} ${row.name}`, `เพิ่ม EF ${row.kgco2e ?? '-'} kgCO2e/${row.unit}`);
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
    await logRev(t, req, 'Emission Factor', current.code || `${current.scope_code} ${current.name}`, changes(current, row, Object.keys(row)));
    res.json({ ok: true });
  });
  route('delete', '/api/act/:activity/cfo/ef/:id', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const id = Number(req.params.id);
    const usedBy = must(await tx.from(t.activity).select('id').eq('ef_id', id).limit(1)).length + must(await tx.from(t.entry).select('id').eq('ef_id', id).limit(1)).length;
    if (usedBy) return fail(res, 400, 'EF นี้ถูกใช้แล้ว ลบไม่ได้ ให้ตั้งเป็น Inactive');
    const gone = must(await tx.from(t.ef).delete().eq('id', id).select('code,scope_code,name'));
    if (gone[0]) await logRev(t, req, 'Emission Factor', gone[0].code || `${gone[0].scope_code} ${gone[0].name}`, 'ลบ EF');
    res.json({ ok: true });
  });

  const activityInput = (b) => {
    const row = { ef_id: Number(b.ef_id), gwp_code: text(b.gwp_code, 20) || 'AR5', department: text(b.department, 80), name: text(b.name, 200), detail: text(b.detail, 500), calc: CFO_CALCS[b.calc] ? b.calc : null, status: b.status === 'Inactive' ? 'Inactive' : 'Active' };
    if (!row.ef_id || !row.department || !row.name) return { error: 'ระบุหน่วยงาน ชื่อกิจกรรม และ EF' };
    return { row };
  };
  route('post', '/api/act/:activity/cfo/activities', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const { row, error } = activityInput(req.body || {});
    if (error) return fail(res, 400, error);
    must(await tx.from(t.activity).insert(row));
    await logRev(t, req, 'กิจกรรม', `${row.department} · ${row.name}`, 'เพิ่มกิจกรรม');
    res.status(201).json({ ok: true });
  });
  route('patch', '/api/act/:activity/cfo/activities/:id', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const { row, error } = activityInput(req.body || {});
    if (error) return fail(res, 400, error);
    const current = must(await tx.from(t.activity).select('*').eq('id', Number(req.params.id)).maybeSingle());
    if (!current) return fail(res, 404, 'ไม่พบกิจกรรม');
    must(await tx.from(t.activity).update(row).eq('id', current.id));
    await logRev(t, req, 'กิจกรรม', `${current.department} · ${current.name}`, changes(current, row, Object.keys(row)));
    res.json({ ok: true });
  });
  route('delete', '/api/act/:activity/cfo/activities/:id', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const id = Number(req.params.id);
    if (must(await tx.from(t.entry).select('id').eq('activity_id', id).limit(1)).length) return fail(res, 400, 'กิจกรรมนี้มีข้อมูลแล้ว ลบไม่ได้ ให้ตั้งเป็น Inactive');
    const gone = must(await tx.from(t.activity).delete().eq('id', id).select('department,name'));
    if (gone[0]) await logRev(t, req, 'กิจกรรม', `${gone[0].department} · ${gone[0].name}`, 'ลบกิจกรรม');
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
    const before = await settingsOf(t);
    must(await tx.from(t.setting).upsert(rows, { onConflict: 'key' }));
    const after = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    await logRev(t, req, 'ตั้งค่า', null, changes(before, after, Object.keys(after).filter((k) => !k.startsWith('company_photo'))));
    res.json({ ok: true });
  });

  // ---------- TGO forms ----------
  // Fr-03.2: the 15 Scope 3 categories of a year with the 6 criteria. A year not assessed yet shows the latest
  // earlier year (fromYear) so the admin starts from it.
  route('get', '/api/act/:activity/cfo/s3', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const [scopes, rows, access] = await Promise.all([
      fetchAll(() => tx.from(t.cfoScope).select('code,name,name_th').eq('scope', 3)),
      fetchAll(() => tx.from(t.s3Assess).select('*').lte('year', year).order('year', { ascending: false })),
      accessOf(req, activity, year)
    ]);
    const fromYear = rows.some((r) => r.year === year) ? year : rows[0]?.year || null;
    const byCode = new Map(rows.filter((r) => r.year === fromYear).map((r) => [r.scope_code, r]));
    const sorted = scopes.sort((a, b) => Number(a.code.split('-')[1]) - Number(b.code.split('-')[1]));
    res.json({
      year, fromYear, admin: access.admin, criteria: S3_CRITERIA,
      rows: sorted.map((s) => {
        const r = byCode.get(s.code) || { has_source: true };
        const marks = Object.fromEntries(S3_CRITERIA.map((k) => [k, Boolean(r[k])]));
        return { scope_code: s.code, name: s.name, name_th: s.name_th, has_source: r.has_source !== false, ...marks, remark: r.remark || '',
          significant: r.has_source !== false && S3_CRITERIA.some((k) => marks[k]), updated_by: r.updated_by || null, updated_at: r.updated_at || null };
      })
    });
  });
  route('put', '/api/act/:activity/cfo/s3', async (req, res, activity, t) => {
    const year = yearOf(req.body?.year, 0);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    if (!(await requireAdmin(req, res, activity, year))) return;
    const list = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const rows = list.filter((r) => /^3-\d{1,2}$/.test(String(r?.scope_code))).map((r) => ({
      year, scope_code: r.scope_code, has_source: r.has_source !== false, remark: text(r.remark, 1000),
      ...Object.fromEntries(S3_CRITERIA.map((k) => [k, r[k] === true])), updated_by: req.user.employeeId, updated_at: new Date().toISOString()
    }));
    if (!rows.length) return fail(res, 400, 'ไม่มีข้อมูลให้บันทึก');
    const before = new Map((await fetchAll(() => tx.from(t.s3Assess).select('*').eq('year', year))).map((r) => [r.scope_code, r]));
    must(await tx.from(t.s3Assess).upsert(rows, { onConflict: 'year,scope_code' }));
    const changed = rows.map((r) => {
      const d = changes(before.get(r.scope_code), r, ['has_source', ...S3_CRITERIA, 'remark']);
      return d && `${r.scope_code} ${d}`;
    }).filter(Boolean);
    await logRev(t, req, 'Fr-03.2', `ปี ${year}`, before.size ? changed.join(' | ') : 'ประเมินครั้งแรกของปี');
    res.json({ ok: true });
  });

  // Fr-04.1 (Fr-04.2 = the base year): one row per activity × EF for the whole year with the form's columns —
  // EF per gas, ton GHG and tCO2e per gas, total. Groups: Scope 1, รายงานแยก, Scope 2, Scope 3.
  route('get', '/api/act/:activity/cfo/inventory', async (req, res, activity, t) => {
    const baseYear = yearOf((await settingsOf(t)).base_year, 0) || null;
    const year = req.query.base === '1' ? baseYear : yearOf(req.query.year);
    if (!year) return fail(res, 400, req.query.base === '1' ? 'ยังไม่ได้ตั้งปีฐาน (Setting > บริษัท)' : 'ปีไม่ถูกต้อง');
    const department = text(req.query.department, 80);
    const [entries, activities, efs, gwps, scopes] = await Promise.all([
      fetchAll(() => tx.from(t.entry).select('activity_id,ef_id,gwp_code,qty').gte('month', `${year}-01-01`).lte('month', `${year}-12-01`).order('id')),
      fetchAll(() => tx.from(t.activity).select('id,department,name,detail,calc').order('id')),
      fetchAll(() => tx.from(t.ef).select('*').order('id')),
      fetchAll(() => tx.from(t.gwp).select('*')),
      fetchAll(() => tx.from(t.cfoScope).select('code,scope,name'))
    ]);
    const act = new Map(activities.map((a) => [a.id, a]));
    const ef = new Map(efs.map((e) => [e.id, e]));
    const gwp = new Map(gwps.map((g) => [g.code, g]));
    const scope = new Map(scopes.map((s) => [s.code, s]));
    const lines = new Map();
    for (const e of entries) {
      const a = act.get(e.activity_id);
      if (!a || (department && a.department !== department)) continue;
      const key = `${e.activity_id}|${e.ef_id}|${e.gwp_code}`;
      const line = lines.get(key) || { a, f: ef.get(e.ef_id), g: gwp.get(e.gwp_code), qty: 0 };
      line.qty += Number(e.qty);
      lines.set(key, line);
    }
    const n = (v) => Number(v || 0);
    const r6 = (v) => Math.round(v * 1e6) / 1e6;
    const rows = [...lines.values()].filter((l) => l.f && l.g).flatMap(({ a, f, g, qty }) => {
      // Septic: qty is kg CH4 (EF CH4 = 1 kg/kg), as v_cfo_entry.
      const septic = a.calc === 'septic';
      const efGas = { co2: septic ? 0 : n(f.co2), ch4_fossil: septic ? 0 : n(f.ch4_fossil), ch4: septic ? 1 : n(f.ch4), n2o: septic ? 0 : n(f.n2o), sf6: n(f.sf6), nf3: n(f.nf3) };
      const gw = { co2: n(g.co2) || 1, ch4_fossil: n(g.ch4_fossil), ch4: n(g.ch4), n2o: n(g.n2o), sf6: n(g.sf6), nf3: n(g.nf3) };
      const hfcGwp = f.hfc_gwp == null ? 1 : n(f.hfc_gwp);
      const pfcGwp = f.pfc_gwp == null ? 1 : n(f.pfc_gwp);
      const ton = Object.fromEntries(Object.keys(efGas).map((k) => [k, r6((qty * efGas[k]) / 1000)]));
      const tco2e = {
        ...Object.fromEntries(Object.keys(efGas).map((k) => [k, r6((qty * efGas[k] * gw[k]) / 1000)])),
        hfc: r6((qty * n(f.hfc) * hfcGwp) / 1000), pfc: r6((qty * n(f.pfc) * pfcGwp) / 1000), other: r6((qty * n(f.other) * n(f.other_gwp)) / 1000)
      };
      const s = scope.get(f.scope_code) || {};
      const row = {
        group: f.separate ? 'separate' : `s${s.scope}`, scope: s.scope, scope_code: f.scope_code, scope_name: s.name,
        department: a.department, activity: a.name, detail: a.detail, source: f.name, unit: f.unit, qty: r6(qty),
        ef: { ...efGas, hfc: n(f.hfc), hfc_gwp: n(f.hfc) ? hfcGwp : null, pfc: n(f.pfc), pfc_gwp: n(f.pfc) ? pfcGwp : null, other: n(f.other), other_gwp: n(f.other_gwp) },
        total_ef: septic ? gw.ch4 : n(f.kgco2e), source_type: f.source_type, substitute: f.substitute, reference: f.reference,
        ton, tco2e, total: r6((qty * (septic ? gw.ch4 : n(f.kgco2e))) / 1000)
      };
      // B7 / E10 / biomass: the biogenic CO2 is reported apart (EF TGO "Report in Biogenic CO2 emissions").
      if (!n(f.co2_bio)) return [row];
      const zero = (o) => Object.fromEntries(Object.keys(o).map((k) => [k, 0]));
      const bio = r6((qty * n(f.co2_bio)) / 1000);
      return [row, { ...row, group: 'separate', activity: `${a.name} (Biogenic CO₂)`, ef: { ...zero(row.ef), co2: n(f.co2_bio), hfc_gwp: null, pfc_gwp: null },
        total_ef: n(f.co2_bio), ton: { ...zero(ton), co2: bio }, tco2e: { ...zero(row.tco2e), co2: bio }, total: bio }];
    }).sort((x, y) => x.scope_code.localeCompare(y.scope_code, 'en', { numeric: true }) || x.department.localeCompare(y.department) || x.activity.localeCompare(y.activity));
    res.json({ year, baseYear, department, gwp: gwps.find((g) => g.code === 'AR5') || gwps[0] || null, rows });
  });

  // บันทึกการปรับปรุง: newest first; admins add a note by hand. No delete.
  route('get', '/api/act/:activity/cfo/revisions', async (req, res, activity, t) => {
    const rows = await fetchAll(() => tx.from(t.revision).select('*').order('at', { ascending: false }).order('id', { ascending: false }));
    const names = await namesOf([...new Set(rows.map((r) => r.by))]);
    res.json({
      admin: (await accessOf(req, activity, thisYear())).admin,
      rows: rows.map((r, i) => ({ ...r, no: rows.length - i, by_name: names.get(String(r.by))?.name || '' }))
    });
  });
  route('post', '/api/act/:activity/cfo/revisions', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const area = text(req.body?.area, 120);
    const detail = text(req.body?.detail, 2000);
    if (!area || !detail) return fail(res, 400, 'ระบุส่วนที่แก้และรายละเอียด');
    must(await tx.from(t.revision).insert({ area, ref: text(req.body?.ref, 300), detail, by: req.user.employeeId }));
    res.status(201).json({ ok: true });
  });
}
