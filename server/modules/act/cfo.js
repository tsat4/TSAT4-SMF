import { tx } from '../../core/db.js';
import { fail } from '../../core/http.js';
import { accessOf, actRoute, dateOf, fetchAll, must, requireAdmin, yearOf } from './common.js';

// CFO (Carbon Footprint for Organization): Dashboard totals, monthly entry, and master data (EF, activities, company).
// Tables: db/act/cfo.sql (scripts/act-sql.js cfoSql) · spec: docs/specs/act-cfo.md
export const CFO_ON = ['cfo'];
const SETTING_KEYS = ['company_name', 'company_address', 'company_area', 'company_business', 'company_customers', 'company_employees',
  'company_photo1', 'company_photo2', 'base_year', 'target_percent', 'septic_bod', 'septic_b0', 'septic_mcf', 'septic_i'];
const EF_VALUES = ['kgco2e', 'co2', 'ch4_fossil', 'ch4', 'n2o', 'hfc', 'pfc', 'unit', 'scope_code'];

const text = (v, max = 500) => String(v ?? '').trim().slice(0, max) || null;
const numOrNull = (v) => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);
const monthOf = (v) => (/^\d{4}-\d{2}$/.test(String(v || '')) ? dateOf(`${v}-01`) : null);
const yearRange = (year) => [`${year}-01-01`, `${year}-12-01`];

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
  route('get', '/api/act/:activity/cfo/summary', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const [from] = yearRange(year - 1);
    const [, to] = yearRange(year);
    const rows = await fetchAll(() => tx.from(t.entryView).select('month,scope,scope_code,scope_name,department,tco2e').gte('month', from).lte('month', to).order('id'));
    const cur = rows.filter((r) => r.month.startsWith(String(year)));
    const sum = (list) => Math.round(list.reduce((s, r) => s + Number(r.tco2e), 0) * 1000) / 1000;
    const group = (key, label) => Object.values(cur.reduce((acc, r) => {
      const k = r[key];
      acc[k] = acc[k] || { key: k, label: label(r), tco2e: 0 };
      acc[k].tco2e += Number(r.tco2e);
      return acc;
    }, {})).map((g) => ({ ...g, tco2e: Math.round(g.tco2e * 1000) / 1000 })).sort((a, b) => b.tco2e - a.tco2e);
    res.json({
      year,
      total: sum(cur),
      lastYear: sum(rows.filter((r) => r.month.startsWith(String(year - 1)))),
      scopes: [1, 2, 3].map((scope) => ({ scope, tco2e: sum(cur.filter((r) => r.scope === scope)) })),
      months: Array.from({ length: 12 }, (_, i) => {
        const list = cur.filter((r) => Number(r.month.slice(5, 7)) === i + 1);
        return { month: i + 1, scopes: [1, 2, 3].map((scope) => sum(list.filter((r) => r.scope === scope))), total: sum(list) };
      }),
      categories: group('scope_code', (r) => `${r.scope_code} ${r.scope_name}`),
      departments: group('department', (r) => r.department),
      settings: await settingsOf(t)
    });
  });

  // ---------- transaction: one row per activity for the chosen month ----------
  route('get', '/api/act/:activity/cfo/entries', async (req, res, activity, t) => {
    const month = monthOf(req.query.month);
    if (!month) return fail(res, 400, 'เดือนไม่ถูกต้อง');
    const access = await accessOf(req, activity, Number(month.slice(0, 4)));
    const [activities, entries, efs, settings] = await Promise.all([
      fetchAll(() => tx.from(t.activity).select('id,department,name,detail,calc,status,ef_id').order('department').order('id')),
      fetchAll(() => tx.from(t.entry).select('id,activity_id,qty,inputs,doc,remark,status,ef_id,updated_at').eq('month', month).order('id')),
      fetchAll(() => tx.from(t.ef).select('id,scope_code,name,unit,kgco2e').order('id')),
      settingsOf(t)
    ]);
    const efById = new Map(efs.map((e) => [e.id, e]));
    const entryOf = new Map(entries.map((e) => [e.activity_id, e]));
    const rows = activities.filter((a) => a.status === 'Active' || entryOf.has(a.id)).map((a) => {
      const entry = entryOf.get(a.id) || null;
      const ef = efById.get(entry ? entry.ef_id : a.ef_id) || {};
      return {
        ...a, scope_code: ef.scope_code, source: ef.name, unit: ef.unit, kgco2e: ef.kgco2e,
        entry: entry && { ...entry, tco2e: Math.round(Number(entry.qty) * Number(ef.kgco2e || 0)) / 1000 },
        canEdit: access.admin || access.departments.includes(a.department)
      };
    });
    res.json({ month, admin: access.admin, departments: access.departments, rows, septic: Object.fromEntries(Object.entries(settings).filter(([k]) => k.startsWith('septic_'))) });
  });

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
      if (!(inputs.people >= 0) || !(inputs.days >= 0)) return fail(res, 400, 'ระบุจำนวนคนและจำนวนวัน');
      qty = septicKg(inputs, await settingsOf(t));
    }
    if (qty == null || Number.isNaN(qty) || qty < 0) return fail(res, 400, 'ปริมาณต้องเป็นตัวเลข 0 ขึ้นไป');
    const ef = must(await tx.from(t.ef).select('id,kgco2e,status').eq('id', act.ef_id).maybeSingle());
    if (!ef || ef.kgco2e == null) return fail(res, 400, 'EF ของกิจกรรมนี้ยังไม่มีค่า ให้ผู้จัดทำแก้ที่ Setting');
    const row = { qty, inputs, doc: text(req.body?.doc), remark: text(req.body?.remark), updated_by: req.user.employeeId, updated_at: new Date().toISOString() };
    if (current) must(await tx.from(t.entry).update(row).eq('id', current.id));
    else must(await tx.from(t.entry).insert({ ...row, activity_id: act.id, month, ef_id: act.ef_id, gwp_code: act.gwp_code, created_by: req.user.employeeId }));
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
    const month = monthOf(req.body?.month);
    const status = req.body?.status === 'DRAFT' ? 'DRAFT' : 'CONFIRMED';
    if (!month) return fail(res, 400, 'เดือนไม่ถูกต้อง');
    if (!(await requireAdmin(req, res, activity, Number(month.slice(0, 4))))) return;
    const done = must(await tx.from(t.entry).update({ status, updated_by: req.user.employeeId, updated_at: new Date().toISOString() }).eq('month', month).select('id'));
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

  route('put', '/api/act/:activity/cfo/settings', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const rows = Object.entries(req.body || {}).filter(([k]) => SETTING_KEYS.includes(k)).map(([key, value]) => ({ key, value: String(value ?? '').trim().slice(0, 1000) }));
    if (!rows.length) return fail(res, 400, 'ไม่มีข้อมูลให้บันทึก');
    must(await tx.from(t.setting).upsert(rows, { onConflict: 'key' }));
    res.json({ ok: true });
  });
}
