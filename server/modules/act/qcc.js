import { mx, tx } from '../../core/db.js';
import { cleanTerm, fail } from '../../core/http.js';
import { SHEET_STALE, accessOf, actRoute, fetchAll, imageBytes, must, namesOf, sheetEditable, sheetWrite, statusMove, yearOf } from './common.js';

// QCC: one project per group and topic, with the 10 report forms FM-QMR-022…031 (inbox/QCC.xlsx) in `forms`.
// The group leader (or whoever made it) fills the forms and sends it; the year's committee (admin / chairman / vice) approves.
// Table: db/act/qcc.sql (scripts/act-sql.js qccSql) · spec: docs/specs/act-qcc.md
export const QCC_ON = ['qcc'];
export const QCC_STEPS = 11; // FM-QMR-022: 11 PDCA steps
export const QCC_CRITERIA = 7; // FM-QMR-023: 7 topic criteria
export const QCC_FISH = ['man', 'machine', 'method', 'material', 'environment'];
const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'];
const PHOTO_SLOTS = ['fishbone', 'before', 'after', 'survey'];

const text = (v, max = 2000) => String(v ?? '').trim().slice(0, max);
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
};
const pick13 = (v) => (Number(v) >= 1 && Number(v) <= 3 ? Math.floor(Number(v)) : 0);
const list = (v, max, each) => (Array.isArray(v) ? v.slice(0, max).map(each) : []);
const weeks = (v, max) => [...new Set(list(v, max, Number).filter((i) => Number.isInteger(i) && i >= 0 && i < max))].sort((a, b) => a - b);
// 'YYYY-MM' or 'YYYY-MM-01' with month 01–12 -> 'YYYY-MM-01'; anything else -> null.
export const monthOf = (v) => {
  const m = /^(\d{4})-(0[1-9]|1[0-2])(-01)?$/.exec(String(v || ''));
  return m ? `${m[1]}-${m[2]}-01` : null;
};

// Every form's shape, so only known fields reach the database (the page sends the whole `forms` object).
export function qccForms(raw, monthsCount = 12) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const slots = Math.max(1, Math.min(12, monthsCount)) * 4;
  return {
    '022': {
      goal: text(f['022']?.goal, 500), reason: text(f['022']?.reason, 1000),
      steps: Array.from({ length: QCC_STEPS }, (_, i) => ({ plan: weeks(f['022']?.steps?.[i]?.plan, slots), actual: weeks(f['022']?.steps?.[i]?.actual, slots) }))
    },
    '023': {
      rows: list(f['023']?.rows, 15, (r) => ({
        problem: text(r?.problem, 300), proposer: text(r?.proposer, 100),
        criteria: Array.from({ length: QCC_CRITERIA }, (_, i) => Boolean(r?.criteria?.[i])),
        freq: pick13(r?.freq), severity: pick13(r?.severity), feasible: pick13(r?.feasible),
        freqNote: text(r?.freqNote, 100), severityNote: text(r?.severityNote, 200)
      })).filter((r) => r.problem)
    },
    '024': {
      month: text(f['024']?.month, 60), unit: text(f['024']?.unit, 30), source: text(f['024']?.source, 300),
      items: list(f['024']?.items, 15, (r) => ({ name: text(r?.name, 200), value: num(r?.value) })).filter((r) => r.name)
    },
    '026': {
      problem: text(f['026']?.problem, 300),
      causes: Object.fromEntries(QCC_FISH.map((k) => [k, text(f['026']?.causes?.[k], 1000)]))
    },
    '027': {
      rows: list(f['027']?.rows, 15, (r) => ({
        what: text(r?.what, 500), why: text(r?.why, 500), how: text(r?.how, 500), who: text(r?.who, 200), when: text(r?.when, 100), where: text(r?.where, 300)
      })).filter((r) => r.what || r.how)
    },
    '028': {
      topic: text(f['028']?.topic, 300), before: text(f['028']?.before, 2000), after: text(f['028']?.after, 2000),
      direction: f['028']?.direction === 'down' ? 'down' : 'up', unit: text(f['028']?.unit, 30), target: text(f['028']?.target, 30), actual: text(f['028']?.actual, 30)
    },
    '029': {
      rows: list(f['029']?.rows, 15, (r) => ({ topic: text(r?.topic, 1000), wi: text(r?.wi, 60), sop: text(r?.sop, 60), other: text(r?.other, 200) })).filter((r) => r.topic)
    },
    '030': {
      costs: list(f['030']?.costs, 25, (r) => ({ item: text(r?.item, 200), qty: text(r?.qty, 30), labor: num(r?.labor), other: num(r?.other) })).filter((r) => r.item),
      money: text(f['030']?.money, 1000), perMonth: num(f['030']?.perMonth), nonMoney: text(f['030']?.nonMoney, 1000)
    },
    '031': {
      direct: text(f['031']?.direct, 2000), indirect: text(f['031']?.indirect, 2000), obstacles: text(f['031']?.obstacles, 2000), future: text(f['031']?.future, 2000)
    }
  };
}

// FM-QMR-023 score = frequency × severity × feasibility (each 1–3) · FM-QMR-030 total = labour + other.
export const qccScore = (r) => pick13(r.freq) * pick13(r.severity) * pick13(r.feasible);
export const qccCost = (forms) => Math.round((forms?.['030']?.costs || []).reduce((t, r) => t + num(r.labor) + num(r.other), 0) * 100) / 100;
// Progress = PDCA steps with any actual week ÷ 11.
export const qccProgress = (forms) => Math.round(((forms?.['022']?.steps || []).filter((s) => s.actual?.length).length / QCC_STEPS) * 100);

function monthsBetween(start, end) {
  if (!start || !end) return 12;
  const [ys, ms] = start.split('-').map(Number);
  const [ye, me] = end.split('-').map(Number);
  return (ye - ys) * 12 + (me - ms) + 1;
}

export function mountQcc(app) {
  const route = actRoute(app, { only: QCC_ON });
  const reviewerOf = (access) => access.admin || access.chairman;
  const own = (req, row) => [row.leader_id, row.created_by].includes(req.user.employeeId);

  route('get', '/api/act/:activity/qcc/list', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const [rows, access] = await Promise.all([
      fetchAll(() => tx.from(t.project).select('*').eq('year', year).order('id', { ascending: false })),
      accessOf(req, activity, year)
    ]);
    const names = await namesOf([...new Set(rows.flatMap((r) => [r.leader_id, r.manager_id]).filter(Boolean))]);
    const nameOf = (id) => (id ? names.get(String(id))?.name || '' : '');
    res.json({
      year, me: req.user.employeeId, admin: access.admin, reviewer: reviewerOf(access),
      rows: rows.map((r) => {
        const mine = own(req, r);
        return {
          ...r, leader_name: nameOf(r.leader_id), manager_name: nameOf(r.manager_id), progress: qccProgress(r.forms), mine,
          canEdit: sheetEditable(r.status, { owner: mine, admin: access.admin }),
          canReview: reviewerOf(access) && (access.admin || r.leader_id !== req.user.employeeId)
        };
      })
    });
  });

  // Leader / manager search for anyone signed in (the activity's employee search is for its team only).
  route('get', '/api/act/:activity/qcc/people', async (req, res) => {
    const term = cleanTerm(req.query.q);
    let q = mx.from('mt_main_employee').select('employee_id,prefix,first_name,last_name,department').eq('status', 'Active').order('employee_id').limit(20);
    if (term) q = q.or(`employee_id.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,department.ilike.%${term}%`);
    const rows = must(await q);
    res.json({ people: rows.map((r) => ({ employeeId: r.employee_id, name: [r.prefix, r.first_name, r.last_name].filter(Boolean).join(' '), department: r.department || '' })) });
  });

  const input = (b, year) => {
    const start = monthOf(b.start_month);
    const end = monthOf(b.end_month);
    const row = {
      reg_no: text(b.reg_no, 60) || null, group_name: text(b.group_name, 120), department: text(b.department, 80) || null, topic: text(b.topic, 300),
      leader_id: text(b.leader_id, 20), manager_id: text(b.manager_id, 20) || null, members: text(b.members, 1000) || null,
      start_month: start, end_month: end
    };
    if (!row.group_name) return { error: 'ระบุชื่อกลุ่ม' };
    if (!row.topic) return { error: 'ระบุเรื่องที่จดทะเบียนกิจกรรม' };
    if (!row.leader_id) return { error: 'เลือกหัวหน้ากลุ่ม' };
    if ((b.start_month && !start) || (b.end_month && !end)) return { error: 'เดือนไม่ถูกต้อง' };
    if (start && end && (end < start || monthsBetween(start, end) > 12)) return { error: 'ระยะเวลาดำเนินกิจกรรม 1–12 เดือน และเดือนสิ้นสุดต้องไม่ก่อนเดือนเริ่ม' };
    if (start && Number(start.slice(0, 4)) !== year) return { error: `เดือนเริ่มต้องอยู่ในปี ${year}` };
    row.forms = qccForms(b.forms, monthsBetween(start, end));
    row.cost_total = qccCost(row.forms);
    row.return_month = row.forms['030'].perMonth;
    return { row };
  };

  const unknownPeople = async (row) => {
    const ids = [row.leader_id, row.manager_id].filter(Boolean);
    const found = await namesOf(ids);
    return ids.some((id) => !found.has(String(id))) ? 'ไม่พบรหัสพนักงานหัวหน้ากลุ่ม หรือผู้จัดการ' : null;
  };

  route('post', '/api/act/:activity/qcc', async (req, res, activity, t) => {
    const year = yearOf(req.body?.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const { row, error } = input({ leader_id: req.user.employeeId, ...(req.body || {}) }, year);
    if (error) return fail(res, 400, error);
    const access = await accessOf(req, activity, year);
    if (!access.admin && row.leader_id !== req.user.employeeId) return fail(res, 403, 'สร้างได้เฉพาะหัวหน้ากลุ่มเอง หรือผู้ดูแล');
    const unknown = await unknownPeople(row);
    if (unknown) return fail(res, 400, unknown);
    const data = must(await tx.from(t.project).insert({ ...row, year, created_by: req.user.employeeId, updated_by: req.user.employeeId, updated_at: new Date().toISOString() }).select('id').single());
    res.status(201).json(data);
  });

  const loadFor = async (req, activity, t, id) => {
    const row = must(await tx.from(t.project).select('*').eq('id', Number(id)).maybeSingle());
    if (!row) return { error: [404, 'ไม่พบโครงการ QCC'] };
    const access = await accessOf(req, activity, row.year);
    return { row, access, mine: own(req, row) };
  };

  route('patch', '/api/act/:activity/qcc/:id', async (req, res, activity, t) => {
    const { row: current, access, mine, error: missing } = await loadFor(req, activity, t, req.params.id);
    if (missing) return fail(res, ...missing);
    if (!sheetEditable(current.status, { owner: mine, admin: access.admin })) return fail(res, 403, 'แก้ได้เฉพาะหัวหน้ากลุ่ม (ใบร่าง / ไม่ผ่าน) หรือผู้ดูแล');
    const { row, error } = input({ leader_id: current.leader_id, ...(req.body || {}) }, current.year);
    if (error) return fail(res, 400, error);
    if (!access.admin) row.leader_id = current.leader_id;
    const unknown = await unknownPeople(row);
    if (unknown) return fail(res, 400, unknown);
    if (!(await sheetWrite(t.project, current, { ...row, updated_by: req.user.employeeId, updated_at: new Date().toISOString() }))) return fail(res, ...SHEET_STALE);
    res.json({ ok: true, id: current.id });
  });

  route('delete', '/api/act/:activity/qcc/:id', async (req, res, activity, t) => {
    const { row, access, mine, error: missing } = await loadFor(req, activity, t, req.params.id);
    if (missing) return fail(res, ...missing);
    if (!access.admin && !(mine && row.status === 'DRAFT')) return fail(res, 403, 'ลบได้เฉพาะโครงการร่างของตนเอง หรือผู้ดูแล');
    must(await tx.from(t.project).delete().eq('id', row.id).eq('status', row.status));
    res.json({ ok: true });
  });

  // Photos: fishbone (026), before / after (028), survey graph (024) → img_qcc/project/<id>_<slot>_<time>.jpg.
  route('post', '/api/act/:activity/qcc/:id/photo', async (req, res, activity, t) => {
    const { row, access, mine, error: missing } = await loadFor(req, activity, t, req.params.id);
    if (missing) return fail(res, ...missing);
    if (!sheetEditable(row.status, { owner: mine, admin: access.admin })) return fail(res, 403, 'เปลี่ยนรูปได้เฉพาะหัวหน้ากลุ่ม (ใบร่าง / ไม่ผ่าน) หรือผู้ดูแล');
    const slot = PHOTO_SLOTS.includes(req.body?.slot) ? req.body.slot : '';
    const bytes = imageBytes(req.body?.image);
    if (!slot || !bytes) return fail(res, 400, 'รูปต้องเป็น JPEG ไม่เกิน 700 KB');
    const key = `project/${row.id}_${slot}_${Date.now()}.jpg`;
    const uploaded = await tx.storage.from(t.bucket).upload(key, new Uint8Array(bytes), { contentType: 'image/jpeg', upsert: false });
    if (uploaded.error) return fail(res, 400, /bucket/i.test(String(uploaded.error.message)) ? `ยังไม่ได้สร้างที่เก็บรูป ${t.bucket} ใน Tx Data` : 'อัปโหลดรูปไม่ได้');
    const url = tx.storage.from(t.bucket).getPublicUrl(key).data.publicUrl;
    must(await tx.from(t.project).update({ photos: { ...(row.photos || {}), [slot]: url }, updated_by: req.user.employeeId, updated_at: new Date().toISOString() }).eq('id', row.id));
    res.status(201).json({ url });
  });

  // The leader sends a draft (or a rejected one); the committee approves or rejects with a note.
  route('post', '/api/act/:activity/qcc/:id/status', async (req, res, activity, t) => {
    const { row, access, mine, error: missing } = await loadFor(req, activity, t, req.params.id);
    if (missing) return fail(res, ...missing);
    const status = STATUSES.includes(req.body?.status) ? req.body.status : '';
    if (!status) return fail(res, 400, 'สถานะไม่ถูกต้อง');
    const refused = statusMove(row.status, status, {
      owner: mine, reviewer: reviewerOf(access), admin: access.admin, self: row.leader_id === req.user.employeeId,
      denied: status === 'SUBMITTED' ? 'ส่งพิจารณาได้เฉพาะหัวหน้ากลุ่ม หรือผู้ดูแล' : 'อนุมัติได้เฉพาะคณะกรรมการ QCC ของปีนี้'
    });
    if (refused) return fail(res, ...refused);
    const patch = { status, updated_by: req.user.employeeId, updated_at: new Date().toISOString() };
    if (['APPROVED', 'REJECTED'].includes(status)) Object.assign(patch, { review_note: text(req.body?.note, 1000) || null, reviewed_by: req.user.employeeId, reviewed_at: new Date().toISOString() });
    if (!(await sheetWrite(t.project, row, patch))) return fail(res, ...SHEET_STALE);
    res.json({ ok: true });
  });
}
