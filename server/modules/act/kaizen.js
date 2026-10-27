import { tx } from '../../core/db.js';
import { fail } from '../../core/http.js';
import { accessOf, actRoute, dateOf, fetchAll, imageBytes, must, namesOf, yearOf } from './common.js';

// Kaizen: the Kaizen sheet (FM-QSM-039 ด้านหน้า) — anyone signed in proposes, the year's admin / chairman approves.
// Table: db/act/kaizen.sql (scripts/act-sql.js kaizenSql) · spec: docs/specs/act-kaizen.md
export const KAIZEN_ON = ['kaizen'];
export const KAIZEN_TYPES = ['Q', 'C', 'D', 'S', 'M', 'E', 'O'];
const KINDS = ['person', 'team', 'qcc'];
const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'];

const text = (v, max = 2000) => String(v ?? '').trim().slice(0, max) || null;
const money = (v) => {
  const n = v === '' || v == null ? 0 : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
};

// Invested = labour + material · payback (months) = invested ÷ return per month (none without a return).
export function kaizenMoney(row) {
  const cost = Math.round((Number(row.cost_labor || 0) + Number(row.cost_material || 0)) * 100) / 100;
  const perMonth = Number(row.return_month || 0);
  return { cost, payback: perMonth > 0 ? Math.round((cost / perMonth) * 100) / 100 : null };
}

export function mountKaizen(app) {
  const route = actRoute(app, { only: KAIZEN_ON });
  const reviewerOf = (access) => access.admin || access.chairman;
  const own = (req, row) => row.employee_id === req.user.employeeId || row.created_by === req.user.employeeId;

  // The year's sheets with the proposer's name and the money results; what this user may do.
  route('get', '/api/act/:activity/kaizen/list', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const [rows, access] = await Promise.all([
      fetchAll(() => tx.from(t.entry).select('*').eq('year', year).order('id', { ascending: false })),
      accessOf(req, activity, year)
    ]);
    const names = await namesOf([...new Set(rows.map((r) => r.employee_id))]);
    res.json({
      year, me: req.user.employeeId, admin: access.admin, reviewer: reviewerOf(access),
      rows: rows.map((r) => ({ ...r, name: names.get(String(r.employee_id))?.name || '', ...kaizenMoney(r), mine: own(req, r) }))
    });
  });

  const input = (b) => {
    const row = {
      title: text(b.title, 300), kind: KINDS.includes(b.kind) ? b.kind : 'person', members: text(b.members, 1000),
      submitted_on: dateOf(b.submitted_on) || new Date().toISOString().slice(0, 10),
      before_text: text(b.before_text), after_text: text(b.after_text), benefit: text(b.benefit),
      types: [...new Set((Array.isArray(b.types) ? b.types : []).filter((x) => KAIZEN_TYPES.includes(x)))], other_type: text(b.other_type, 200),
      cost_labor: money(b.cost_labor), cost_material: money(b.cost_material), return_month: money(b.return_month)
    };
    if (!row.title) return { error: 'ระบุเรื่อง' };
    if ([row.cost_labor, row.cost_material, row.return_month].some(Number.isNaN)) return { error: 'จำนวนเงินต้องเป็นตัวเลข 0 ขึ้นไป' };
    if (row.kind !== 'team') row.members = null;
    if (!row.types.includes('O')) row.other_type = null;
    return { row };
  };

  // New sheet: the proposer is the signed-in user (an admin may enter it for someone else).
  route('post', '/api/act/:activity/kaizen', async (req, res, activity, t) => {
    const { row, error } = input(req.body || {});
    if (error) return fail(res, 400, error);
    const year = Number(row.submitted_on.slice(0, 4));
    const access = await accessOf(req, activity, year);
    const employeeId = access.admin && text(req.body?.employeeId, 20) ? text(req.body.employeeId, 20) : req.user.employeeId;
    const person = (await namesOf([employeeId])).get(String(employeeId));
    if (!person) return fail(res, 400, 'ไม่พบรหัสพนักงานผู้เสนอ');
    // ลงทะเบียนเลขที่ KZ-<year>-<running>; retry when two sheets take the same number at once.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const last = must(await tx.from(t.entry).select('reg_no').eq('year', year).not('reg_no', 'is', null).order('reg_no', { ascending: false }).limit(1));
      const next = (Number(String(last[0]?.reg_no || '').split('-')[2]) || 0) + 1;
      const { data, error: err } = await tx.from(t.entry).insert({
        ...row, year, reg_no: `KZ-${year}-${String(next).padStart(4, '0')}`, employee_id: employeeId, department: person.department || null,
        created_by: req.user.employeeId, updated_by: req.user.employeeId, updated_at: new Date().toISOString()
      }).select('id,reg_no').single();
      if (!err) return res.status(201).json(data);
      if (err.code !== '23505') throw err;
    }
    fail(res, 409, 'ออกเลขทะเบียนไม่ได้ ลองบันทึกอีกครั้ง');
  });

  const loadFor = async (req, activity, t, id) => {
    const row = must(await tx.from(t.entry).select('*').eq('id', Number(id)).maybeSingle());
    if (!row) return { error: [404, 'ไม่พบใบ Kaizen'] };
    const access = await accessOf(req, activity, row.year);
    return { row, access, mine: own(req, row) };
  };

  // The proposer edits until it is approved; admins edit any sheet.
  route('patch', '/api/act/:activity/kaizen/:id', async (req, res, activity, t) => {
    const { row: current, access, mine, error: missing } = await loadFor(req, activity, t, req.params.id);
    if (missing) return fail(res, ...missing);
    if (!access.admin && !(mine && current.status !== 'APPROVED')) return fail(res, 403, 'แก้ได้เฉพาะผู้เสนอ (ก่อนอนุมัติ) หรือผู้ดูแล');
    const { row, error } = input(req.body || {});
    if (error) return fail(res, 400, error);
    if (Number(row.submitted_on.slice(0, 4)) !== current.year) row.submitted_on = current.submitted_on;
    must(await tx.from(t.entry).update({ ...row, updated_by: req.user.employeeId, updated_at: new Date().toISOString() }).eq('id', current.id));
    res.json({ ok: true, id: current.id });
  });

  route('delete', '/api/act/:activity/kaizen/:id', async (req, res, activity, t) => {
    const { row, access, mine, error: missing } = await loadFor(req, activity, t, req.params.id);
    if (missing) return fail(res, ...missing);
    if (!access.admin && !(mine && row.status === 'DRAFT')) return fail(res, 403, 'ลบได้เฉพาะใบร่างของตนเอง หรือผู้ดูแล');
    must(await tx.from(t.entry).delete().eq('id', row.id));
    res.json({ ok: true });
  });

  // Before / after photo (16:9 JPEG made by the page) → img_kaizen/entry/<id>_<side>_<time>.jpg.
  route('post', '/api/act/:activity/kaizen/:id/photo', async (req, res, activity, t) => {
    const { row, access, mine, error: missing } = await loadFor(req, activity, t, req.params.id);
    if (missing) return fail(res, ...missing);
    if (!access.admin && !(mine && row.status !== 'APPROVED')) return fail(res, 403, 'เปลี่ยนรูปได้เฉพาะผู้เสนอ (ก่อนอนุมัติ) หรือผู้ดูแล');
    const side = req.body?.side === 'after' ? 'after' : req.body?.side === 'before' ? 'before' : '';
    const bytes = imageBytes(req.body?.image);
    if (!side || !bytes) return fail(res, 400, 'รูปต้องเป็น JPEG ไม่เกิน 700 KB');
    const key = `entry/${row.id}_${side}_${Date.now()}.jpg`;
    const uploaded = await tx.storage.from(t.bucket).upload(key, new Uint8Array(bytes), { contentType: 'image/jpeg', upsert: false });
    if (uploaded.error) return fail(res, 400, /bucket/i.test(String(uploaded.error.message)) ? `ยังไม่ได้สร้างที่เก็บรูป ${t.bucket} ใน Tx Data` : 'อัปโหลดรูปไม่ได้');
    const url = tx.storage.from(t.bucket).getPublicUrl(key).data.publicUrl;
    must(await tx.from(t.entry).update({ [`${side}_photo`]: url, updated_by: req.user.employeeId, updated_at: new Date().toISOString() }).eq('id', row.id));
    res.status(201).json({ url });
  });

  // Status: the proposer sends a draft (or a rejected sheet) for review; admin / chairman approve, reject or reopen.
  route('post', '/api/act/:activity/kaizen/:id/status', async (req, res, activity, t) => {
    const { row, access, mine, error: missing } = await loadFor(req, activity, t, req.params.id);
    if (missing) return fail(res, ...missing);
    const status = STATUSES.includes(req.body?.status) ? req.body.status : '';
    if (!status) return fail(res, 400, 'สถานะไม่ถูกต้อง');
    const reviewer = reviewerOf(access);
    const send = status === 'SUBMITTED' && ['DRAFT', 'REJECTED'].includes(row.status) && (mine || access.admin);
    if (!send && !reviewer) return fail(res, 403, 'อนุมัติได้เฉพาะประธาน / ผู้ดูแลของปีนี้');
    const patch = { status, updated_by: req.user.employeeId, updated_at: new Date().toISOString() };
    if (['APPROVED', 'REJECTED'].includes(status)) Object.assign(patch, { review_note: text(req.body?.note, 1000), reviewed_by: req.user.employeeId, reviewed_at: new Date().toISOString() });
    must(await tx.from(t.entry).update(patch).eq('id', row.id));
    res.json({ ok: true });
  });
}
