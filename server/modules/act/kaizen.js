import { mx, tx } from '../../core/db.js';
import { fail } from '../../core/http.js';
import { nameOf } from '../../core/users.js';
import { accessOf, actRoute, dateOf, fetchAll, imageBytes, must, namesOf, statusMove, yearOf } from './common.js';

// Kaizen: the Kaizen sheet (FM-QSM-039 ด้านหน้า + ด้านหลัง) — department representative (or proposer) submits,
// assigned department manager / chairman / vice / admin evaluates and approves.
// Table: db/act/kaizen.sql (scripts/act-sql.js kaizenSql) · spec: docs/specs/act-kaizen.md
export const KAIZEN_ON = ['kaizen'];
export const KAIZEN_TYPES = ['Q', 'C', 'D', 'S', 'M', 'E', 'O'];
const KINDS = ['person', 'team', 'qcc'];
const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'];

// FM-QSM-039 ด้านหลัง (ปรับใหม่): ก1 ลดชั่วโมงการทำงาน (ชม./ปี → เกรด A–I), ก2 คำนวณเป็นตัวเงิน (บาท → เกรด Q–Z), ข คำนวณเป็นเงินไม่ได้ (6 ข้อ × 0–5 คะแนน → เกรด J–P).
export const HOUR_GRADES = [
  [8001, 'A', 500], [5001, 'B', 300], [3001, 'C', 200], [1001, 'D', 100], [501, 'E', 80],
  [201, 'F', 50], [81, 'G', 40], [31, 'H', 30], [10, 'I', 20]
];
export const BAHT_GRADES = [
  [3000001, 'Q', 1500], [1000001, 'R', 1000], [500001, 'S', 500], [300001, 'T', 300], [100001, 'U', 200],
  [50001, 'V', 100], [10001, 'W', 80], [3001, 'X', 50], [301, 'Y', 20], [100, 'Z', 10]
];
export const SCORE_GRADES = [
  [25, 'J', 100], [22, 'K', 50], [19, 'L', 30], [16, 'M', 20], [11, 'N', 15], [4, 'P', 10]
];

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

// Back-of-form evaluation: hours saved (A–I) + money saved (Q–Z) + 6 non-money criteria 0..5 (J–P) → combined grade & total reward (baht).
export function kaizenEval(row = {}) {
  const hours = Math.max(0, Number(row.saved_hours || 0));
  const baht = Math.max(0, Number(row.saved_baht || 0));
  const raw = Array.isArray(row.scores) ? row.scores : [];
  const scores = Array.from({ length: 6 }, (_, i) => Math.min(5, Math.max(0, Math.floor(Number(raw[i]) || 0))));
  const scoreTotal = scores.reduce((s, n) => s + n, 0);
  const pick = (table, val) => table.find(([min]) => val >= min) || [0, null, 0];
  const [, hourGrade, hourReward] = pick(HOUR_GRADES, hours);
  const [, bahtGrade, bahtReward] = pick(BAHT_GRADES, baht);
  const [, scoreGrade, scoreReward] = pick(SCORE_GRADES, scoreTotal);
  const eval_grade = [hourGrade, bahtGrade, scoreGrade].filter(Boolean).join(' / ') || null;
  const eval_reward = hourReward + bahtReward + scoreReward;
  return { scores, scoreTotal, hourGrade, hourReward, bahtGrade, bahtReward, scoreGrade, scoreReward, eval_grade, eval_reward };
}

export function mountKaizen(app) {
  const route = actRoute(app, { only: KAIZEN_ON });
  const own = (req, row) => row.employee_id === req.user.employeeId || row.created_by === req.user.employeeId;

  // The year's sheets, department targets & managers, and department employees the user may select as proposer.
  route('get', '/api/act/:activity/kaizen/list', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const [rows, teamRows, access, activeEmps] = await Promise.all([
      fetchAll(() => tx.from(t.entry).select('*').eq('year', year).order('id', { ascending: false })),
      fetchAll(() => tx.from(t.team).select('*').eq('year', year).eq('status', 'Active').order('id')),
      accessOf(req, activity, year),
      fetchAll(() => mx.from('mt_main_employee').select('employee_id,prefix,first_name,last_name,department,position').eq('status', 'Active').order('department').order('employee_id'))
    ]);
    const empMap = new Map(activeEmps.map((e) => [String(e.employee_id), { name: nameOf(e), department: e.department || '', position: e.position || '' }]));
    const extraIds = [...rows.map((r) => r.employee_id), ...rows.map((r) => r.reviewed_by), ...teamRows.map((r) => r.employee_id), ...teamRows.map((r) => r.manager_id)]
      .filter((id) => id && !empMap.has(String(id)));
    if (extraIds.length) (await namesOf(extraIds)).forEach((v, k) => empMap.set(k, v));

    const me = req.user.employeeId;
    const departments = [...new Set([...activeEmps.map((e) => String(e.department || '').trim()), ...teamRows.map((r) => String(r.department || '').trim()), ...rows.map((r) => String(r.department || '').trim())].filter(Boolean))].sort();
    const myDepartments = access.admin ? departments : access.departments;
    const managedDepartments = [...new Set(teamRows.filter((r) => r.role === 'member' && String(r.manager_id || '') === me).map((r) => r.department).filter(Boolean))];
    const deptEmployees = activeEmps
      .filter((e) => access.admin || myDepartments.includes(e.department) || String(e.employee_id) === me)
      .map((e) => ({ employeeId: String(e.employee_id), name: nameOf(e), department: e.department || '', position: e.position || '' }));
    const teamTargets = teamRows.filter((r) => r.role === 'member').map((r) => ({
      id: r.id,
      employee_id: String(r.employee_id),
      name: empMap.get(String(r.employee_id))?.name || '',
      department: r.department || empMap.get(String(r.employee_id))?.department || '',
      target_count: Number(r.target_count || 0),
      manager_id: r.manager_id ? String(r.manager_id) : null,
      manager_name: r.manager_id ? empMap.get(String(r.manager_id))?.name || '' : ''
    }));
    const canEditRow = (r) => access.admin || ((own(req, r) || myDepartments.includes(r.department)) && r.status !== 'APPROVED');
    const canReviewRow = (r) => access.admin || ((access.chairman || managedDepartments.includes(r.department)) && r.employee_id !== me);
    res.json({
      year,
      me,
      admin: access.admin,
      reviewer: access.admin || access.chairman || managedDepartments.length > 0,
      departments,
      myDepartments,
      managedDepartments,
      deptEmployees,
      teamTargets,
      rows: rows.map((r) => ({
        ...r,
        name: empMap.get(String(r.employee_id))?.name || '',
        reviewer_name: r.reviewed_by ? empMap.get(String(r.reviewed_by))?.name || '' : '',
        ...kaizenMoney(r),
        ...kaizenEval(r),
        mine: own(req, r),
        canEdit: canEditRow(r),
        canReview: canReviewRow(r)
      }))
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

  const resolveProposer = async (req, access, requestedId) => {
    const employeeId = text(requestedId, 20) || req.user.employeeId;
    const person = (await namesOf([employeeId])).get(String(employeeId));
    if (!person) return { error: [400, 'ไม่พบรหัสพนักงานผู้เสนอ'] };
    if (employeeId !== req.user.employeeId && !access.admin && !access.departments.includes(person.department)) {
      return { error: [403, 'เลือกผู้เสนอได้เฉพาะสมาชิกในแผนกที่ตนเองเป็นตัวแทน หรือผู้ดูแล'] };
    }
    return { employeeId, department: person.department || access.departments[0] || null };
  };

  // New sheet: representative picks any employee in their department (same person may submit multiple sheets); admin picks anyone.
  route('post', '/api/act/:activity/kaizen', async (req, res, activity, t) => {
    const { row, error } = input(req.body || {});
    if (error) return fail(res, 400, error);
    const year = Number(row.submitted_on.slice(0, 4));
    const access = await accessOf(req, activity, year);
    const proposer = await resolveProposer(req, access, req.body?.employeeId);
    if (proposer.error) return fail(res, ...proposer.error);
    // ลงทะเบียนเลขที่ KZ-<year>-<running>; retry when two sheets take the same number at once.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const last = must(await tx.from(t.entry).select('reg_no').eq('year', year).not('reg_no', 'is', null).order('reg_no', { ascending: false }).limit(1));
      const next = (Number(String(last[0]?.reg_no || '').split('-')[2]) || 0) + 1;
      const { data, error: err } = await tx.from(t.entry).insert({
        ...row, year, reg_no: `KZ-${year}-${String(next).padStart(4, '0')}`, employee_id: proposer.employeeId, department: proposer.department,
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
    const [access, teamRows] = await Promise.all([
      accessOf(req, activity, row.year),
      fetchAll(() => tx.from(t.team).select('*').eq('year', row.year).eq('status', 'Active'))
    ]);
    const inDept = access.departments.includes(row.department);
    const isManager = teamRows.some((r) => r.role === 'member' && r.department === row.department && String(r.manager_id || '') === req.user.employeeId);
    return { row, access, mine: own(req, row), inDept, isManager };
  };

  // Proposer or department representative edits until approved; admins edit any sheet.
  route('patch', '/api/act/:activity/kaizen/:id', async (req, res, activity, t) => {
    const { row: current, access, mine, inDept, error: missing } = await loadFor(req, activity, t, req.params.id);
    if (missing) return fail(res, ...missing);
    if (!access.admin && !((mine || inDept) && current.status !== 'APPROVED')) return fail(res, 403, 'แก้ได้เฉพาะผู้เสนอ ตัวแทนแผนก (ก่อนอนุมัติ) หรือผู้ดูแล');
    const { row, error } = input(req.body || {});
    if (error) return fail(res, 400, error);
    if (Number(row.submitted_on.slice(0, 4)) !== current.year) row.submitted_on = current.submitted_on;
    if (req.body?.employeeId && String(req.body.employeeId).trim() !== current.employee_id) {
      const proposer = await resolveProposer(req, access, req.body.employeeId);
      if (proposer.error) return fail(res, ...proposer.error);
      row.employee_id = proposer.employeeId;
      row.department = proposer.department;
    }
    must(await tx.from(t.entry).update({ ...row, updated_by: req.user.employeeId, updated_at: new Date().toISOString() }).eq('id', current.id));
    res.json({ ok: true, id: current.id });
  });

  route('delete', '/api/act/:activity/kaizen/:id', async (req, res, activity, t) => {
    const { row, access, mine, inDept, error: missing } = await loadFor(req, activity, t, req.params.id);
    if (missing) return fail(res, ...missing);
    if (!access.admin && !((mine || inDept) && row.status === 'DRAFT')) return fail(res, 403, 'ลบได้เฉพาะใบร่างของตนเอง ตัวแทนแผนก หรือผู้ดูแล');
    must(await tx.from(t.entry).delete().eq('id', row.id));
    res.json({ ok: true });
  });

  // Before / after photo (16:9 JPEG made by the page) → img_kaizen/entry/<id>_<side>_<time>.jpg.
  route('post', '/api/act/:activity/kaizen/:id/photo', async (req, res, activity, t) => {
    const { row, access, mine, inDept, error: missing } = await loadFor(req, activity, t, req.params.id);
    if (missing) return fail(res, ...missing);
    if (!access.admin && !((mine || inDept) && row.status !== 'APPROVED')) return fail(res, 403, 'เปลี่ยนรูปได้เฉพาะผู้เสนอ ตัวแทนแผนก (ก่อนอนุมัติ) หรือผู้ดูแล');
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

  // Status & Back-of-form evaluation: proposer/rep sends a draft (or rejected sheet); assigned department manager / chairman / vice / admin evaluates and approves or rejects.
  route('post', '/api/act/:activity/kaizen/:id/status', async (req, res, activity, t) => {
    const { row, access, mine, inDept, isManager, error: missing } = await loadFor(req, activity, t, req.params.id);
    if (missing) return fail(res, ...missing);
    const status = STATUSES.includes(req.body?.status) ? req.body.status : '';
    if (!status) return fail(res, 400, 'สถานะไม่ถูกต้อง');
    // self = the proposer: a manager may key a sheet in for staff and still evaluate it, but not their own Kaizen.
    const refused = statusMove(row.status, status, {
      owner: mine || inDept, reviewer: access.admin || access.chairman || isManager, admin: access.admin, self: row.employee_id === req.user.employeeId,
      denied: status === 'SUBMITTED' ? 'ส่งพิจารณาได้เฉพาะผู้เสนอ ตัวแทนแผนก หรือผู้ดูแล' : 'ประเมินและอนุมัติได้เฉพาะผู้จัดการประจำแผนก ประธาน รองประธาน หรือผู้ดูแลของปีนี้'
    });
    if (refused) return fail(res, ...refused);
    const patch = { status, updated_by: req.user.employeeId, updated_at: new Date().toISOString() };
    if (['APPROVED', 'REJECTED'].includes(status)) {
      const saved_hours = req.body?.saved_hours !== undefined ? money(req.body.saved_hours) : Number(row.saved_hours || 0);
      const saved_baht = req.body?.saved_baht !== undefined ? money(req.body.saved_baht) : Number(row.saved_baht || 0);
      if ([saved_hours, saved_baht].some(Number.isNaN)) return fail(res, 400, 'ชั่วโมงและจำนวนเงินที่ประหยัดได้ต้องเป็นตัวเลข 0 ขึ้นไป');
      const ev = kaizenEval({ saved_hours, saved_baht, scores: req.body?.scores ?? row.scores });
      Object.assign(patch, {
        start_on: req.body?.start_on !== undefined ? dateOf(req.body.start_on) : row.start_on,
        end_on: req.body?.end_on !== undefined ? dateOf(req.body.end_on) : row.end_on,
        saved_hours,
        saved_baht,
        scores: ev.scores,
        eval_grade: ev.eval_grade,
        eval_reward: ev.eval_reward,
        review_note: text(req.body?.note, 1000),
        reviewed_by: req.user.employeeId,
        reviewed_at: new Date().toISOString()
      });
    }
    must(await tx.from(t.entry).update(patch).eq('id', row.id));
    res.json({ ok: true });
  });
}
