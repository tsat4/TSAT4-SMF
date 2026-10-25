import { tx } from '../../core/db.js';
import { fail, wrap } from '../../core/http.js';
import { requireUser } from '../../core/users.js';
import { accessOf, activityOf, dateOf, fetchAll, fetchIn, missingTables, namesOf, tablesOf, yearOf } from './common.js';

// Checklist audits — transaction: record Self / Committee audits and follow Issues to closure.
// Rules: docs/specs/act-5s.md ("transaction", "Issue"). Pure rule functions are exported for scripts/test-act-audit.js.
const AUDIT_TYPES = ['SELF', 'COMMITTEE'];
const PHOTO_BUCKET = 'act-img';
const DEFAULTS = { pass_percent: 80, issue_score: 3, issue_due_days_before_next: 10, issue_photo_max: 1, self_audit_due_day: 10 };

const todayIso = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const roundTo = (n, digits) => Number(`${Math.round(Number(`${Number(n).toFixed(8)}e${digits}`))}e-${digits}`);

// First day of plan week (W1 = 1, W2 = 8, W3 = 15, W4 = 22).
export function weekStartIso(year, month, week) {
  return `${year}-${String(month).padStart(2, '0')}-${String((week - 1) * 7 + 1).padStart(2, '0')}`;
}

// Issue due date = start of the next planned committee week for the area − N days; null when nothing is planned yet.
export function dueDateFor(plans, afterIso, daysBefore) {
  const next = plans.map((p) => weekStartIso(p.year, p.month, p.week)).filter((d) => d > afterIso).sort()[0];
  return next ? addDays(next, -daysBefore) : null;
}

export function scoreAudit(items, scores, passPercent) {
  const max = items.reduce((s, i) => s + Number(i.score_max), 0);
  const total = items.reduce((s, i) => s + Number(scores.get(i.id) ?? 0), 0);
  const percent = max ? roundTo((total / max) * 100, 2) : 0;
  return { total, max, percent, result: percent >= passPercent ? 'PASS' : 'NEED_IMPROVE' };
}

// Next committee audit confirms the area's open Issues (old TSAT4-5S rule):
// no action (text + after photo) -> that item scores 0 and the Issue is OVERDUE · action and score >= 4 -> CLOSED · otherwise it carries on.
export function verifyIssues(openIssues, scores) {
  const adjusted = new Map(scores);
  const updates = [];
  for (const issue of openIssues) {
    const hasAction = Boolean(String(issue.action_description || '').trim()) && Number(issue.after_photos || 0) > 0;
    if (!hasAction) {
      adjusted.set(issue.checklist_id, 0);
      updates.push({ id: issue.id, status: 'OVERDUE', final_score: 0 });
      continue;
    }
    const score = Number(adjusted.get(issue.checklist_id) ?? 0);
    updates.push(score >= 4 ? { id: issue.id, status: 'CLOSED', final_score: score, closed: true } : { id: issue.id, status: 'OPEN', final_score: score, carry: true });
  }
  return { scores: adjusted, updates };
}

// Shown status: an OPEN Issue past its due date without action reads as OVERDUE.
export function shownStatus(issue, today = todayIso()) {
  if (issue.status === 'OPEN' && issue.due_date && issue.due_date < today) return 'OVERDUE';
  return issue.status;
}

async function settingsOf(activity) {
  const { data, error } = await tx.from(tablesOf(activity).setting).select('key,value');
  if (error) throw error;
  const out = { ...DEFAULTS };
  for (const row of data || []) if (row.key in out) out[row.key] = Number(row.value);
  return out;
}

function imageBytes(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length < 32 || bytes.length > 700000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  return bytes;
}

export function mountTransaction(app) {
  const route = (method, path, handler) => app[method](path, wrap(requireUser), wrap(async (req, res) => {
    const activity = activityOf(req, res);
    if (!activity) return;
    try {
      await handler(req, res, activity, tablesOf(activity));
    } catch (err) {
      if (missingTables(res, err, activity)) return;
      throw err;
    }
  }));
  const must = (result) => {
    if (result.error) throw result.error;
    return result.data;
  };

  // Open Issues of an area with how many after photos they have (for the committee form and verification).
  const openIssuesOf = async (t, areaId) => {
    const issues = must(await tx.from(t.issue).select('id,issue_no,checklist_id,score,description,issue_date,due_date,action_description,action_date,status,responsible_id')
      .eq('area_id', areaId).neq('status', 'CLOSED').order('issue_no'));
    const photos = await fetchIn(() => tx.from(t.photo).select('issue_id,kind,url'), 'issue_id', issues.map((i) => i.id));
    return issues.map((i) => ({
      ...i,
      photos: photos.filter((p) => p.issue_id === i.id),
      after_photos: photos.filter((p) => p.issue_id === i.id && p.kind === 'AFTER').length
    }));
  };

  route('get', '/api/act/:activity/audit-form', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const access = await accessOf(req, activity, year);
    if (!access.member) return fail(res, 403, `บันทึกได้เฉพาะทีมของกิจกรรมนี้ปี ${year}`);
    const [settings, items, areas, team] = await Promise.all([
      settingsOf(activity),
      fetchAll(() => tx.from(t.checklist).select('id,item_no,s_group,title,score_max').eq('year', year).eq('status', 'Active').order('item_no')),
      fetchAll(() => tx.from(t.area).select('id,code,area_type,name').eq('status', 'Active').order('code')),
      fetchAll(() => tx.from(t.team).select('employee_id,role,team').eq('year', year).eq('status', 'Active'))
    ]);
    const types = [];
    if (access.admin || access.ownerAreaIds.length) types.push('SELF');
    if (access.admin || access.chairman || access.auditor) types.push('COMMITTEE');
    const names = await namesOf(team.map((m) => m.employee_id));
    const areaId = Number(req.query.area) || 0;
    res.json({
      year,
      access,
      settings,
      types,
      items,
      areas: areas.map((a) => ({ ...a, self: access.admin || access.ownerAreaIds.includes(a.id) })),
      teams: [...new Set(team.filter((m) => m.team).map((m) => m.team))].sort().map((letter) => ({
        team: letter,
        members: team.filter((m) => m.team === letter).map((m) => ({ employeeId: String(m.employee_id), name: names.get(String(m.employee_id))?.name || '' }))
      })),
      openIssues: areaId ? await openIssuesOf(t, areaId) : []
    });
  });

  route('post', '/api/act/:activity/audits', async (req, res, activity, t) => {
    const body = req.body || {};
    const type = AUDIT_TYPES.includes(body.type) ? body.type : '';
    const auditedAt = dateOf(body.auditedAt);
    const areaId = Number(body.areaId);
    if (!type || !auditedAt || !areaId) return fail(res, 400, 'เลือกประเภท พื้นที่ และวันที่ตรวจ');
    if (auditedAt > todayIso()) return fail(res, 400, 'วันที่ตรวจต้องไม่เกินวันนี้');
    const year = Number(auditedAt.slice(0, 4));
    const access = await accessOf(req, activity, year);
    const area = must(await tx.from(t.area).select('id,code,status').eq('id', areaId).maybeSingle());
    if (!area || area.status !== 'Active') return fail(res, 404, 'ไม่พบพื้นที่');
    if (type === 'SELF' && !(access.admin || access.ownerAreaIds.includes(areaId))) return fail(res, 403, 'Self Audit ทำได้เฉพาะเจ้าของพื้นที่ปีนี้');
    if (type === 'COMMITTEE' && !(access.admin || access.chairman || access.auditor)) return fail(res, 403, 'Committee Audit ทำได้เฉพาะทีมตรวจประเมิน');
    const team = type === 'COMMITTEE' ? String(body.team || access.teams[0] || '').trim().toUpperCase() : null;
    if (type === 'COMMITTEE' && !/^[A-Z]$/.test(team || '')) return fail(res, 400, 'เลือกทีมที่ตรวจ');

    const settings = await settingsOf(activity);
    const items = must(await tx.from(t.checklist).select('id,item_no,s_group,title,score_max').eq('year', year).eq('status', 'Active').order('item_no'));
    if (!items.length) return fail(res, 400, `ยังไม่มีหัวข้อตรวจปี ${year}`);
    let scores = new Map();
    for (const item of items) {
      const value = Number(body.scores?.[item.id]);
      if (!Number.isInteger(value) || value < 1 || value > Number(item.score_max)) scores.set(item.id, null);
      else scores.set(item.id, value);
    }
    let verification = { updates: [] };
    let open = [];
    if (type === 'COMMITTEE') {
      open = await openIssuesOf(t, areaId);
      verification = verifyIssues(open, scores);
      scores = verification.scores;
    }
    const missing = items.filter((i) => scores.get(i.id) == null).map((i) => i.item_no);
    if (missing.length) return fail(res, 400, `ให้คะแนนให้ครบ (ข้อที่ ${missing.join(', ')})`);

    // Committee: every item at or below the issue score opens an Issue, unless an open Issue for that item carries on.
    const carried = new Set(verification.updates.filter((u) => u.carry || u.status === 'OVERDUE').map((u) => open.find((i) => i.id === u.id)?.checklist_id));
    const needIssue = type === 'COMMITTEE' ? items.filter((i) => scores.get(i.id) <= settings.issue_score && !carried.has(i.id)) : [];
    const described = new Map((Array.isArray(body.issues) ? body.issues : []).map((x) => [Number(x.checklistId), String(x.description || '').trim().slice(0, 2000)]));
    const undescribed = needIssue.filter((i) => !described.get(i.id)).map((i) => i.item_no);
    if (undescribed.length) return fail(res, 400, `ข้อที่ได้ ≤ ${settings.issue_score} ต้องเปิด Issue พร้อมรายละเอียด (ข้อที่ ${undescribed.join(', ')})`);

    const score = scoreAudit(items, scores, settings.pass_percent);
    const prefix = `${type === 'SELF' ? 'S' : 'C'}-${area.code}-${auditedAt.slice(8, 10)}${auditedAt.slice(5, 7)}${auditedAt.slice(2, 4)}-`;
    const same = must(await tx.from(t.audit).select('audit_no').like('audit_no', `${prefix}%`));
    const auditNo = `${prefix}${String(same.length + 1).padStart(2, '0')}`;
    const audit = must(await tx.from(t.audit).insert({
      audit_no: auditNo, year, audit_type: type, area_id: areaId, team,
      audited_at: `${auditedAt}T05:00:00Z`, // 12:00 Thai time, so the Thai date never shifts
      total_score: score.total, percent_score: score.percent, result: score.result, status: 'DRAFT', created_by: req.user.employeeId
    }).select('id').single());

    try {
      must(await tx.from(t.score).insert(items.map((i) => ({ audit_id: audit.id, checklist_id: i.id, score: scores.get(i.id) }))));
      const people = [];
      const ids = (list) => [...new Set((Array.isArray(list) ? list : []).map((x) => String(x).trim()).filter(Boolean))];
      const participated = ids(body.participated).length ? ids(body.participated) : [req.user.employeeId];
      for (const id of participated) people.push({ audit_id: audit.id, employee_id: id, kind: 'participated' });
      for (const id of participated) people.push({ audit_id: audit.id, employee_id: id, kind: 'assigned' });
      for (const id of ids(body.receivers)) people.push({ audit_id: audit.id, employee_id: id, kind: 'receiver' });
      if (people.length) must(await tx.from(t.person).insert(people));

      let created = [];
      if (needIssue.length) {
        const owner = must(await tx.from(t.owner).select('employee_id').eq('year', year).eq('area_id', areaId).maybeSingle());
        const plans = must(await tx.from(t.auditPlan).select('year,month,week').eq('area_id', areaId).gte('year', year));
        const due = dueDateFor(plans, auditedAt, settings.issue_due_days_before_next);
        const last = must(await tx.from(t.issue).select('issue_no').order('issue_no', { ascending: false }).limit(1));
        let n = Number(String(last[0]?.issue_no || 'ISS0000').replace(/\D/g, '')) || 0;
        created = must(await tx.from(t.issue).insert(needIssue.map((i) => ({
          issue_no: `ISS${String(++n).padStart(4, '0')}`, audit_id: audit.id, area_id: areaId, checklist_id: i.id, score: scores.get(i.id),
          description: described.get(i.id), issue_date: auditedAt, responsible_id: owner?.employee_id || null, due_date: due, status: 'OPEN'
        }))).select('id,issue_no,checklist_id'));
      }

      const plans = verification.updates.length ? must(await tx.from(t.auditPlan).select('year,month,week').eq('area_id', areaId).gte('year', year)) : [];
      for (const u of verification.updates) {
        const patch = { status: u.status, final_score: u.final_score, verify_audit_no: auditNo };
        if (u.closed) Object.assign(patch, { closed_by: req.user.employeeId, closed_at: auditedAt });
        if (u.carry) Object.assign(patch, { due_date: dueDateFor(plans, auditedAt, settings.issue_due_days_before_next) });
        must(await tx.from(t.issue).update(patch).eq('id', u.id));
      }
      must(await tx.from(t.audit).update({ status: 'COMPLETED' }).eq('id', audit.id));
      res.status(201).json({ id: audit.id, auditNo, ...score, issues: created, verified: verification.updates.length });
    } catch (err) {
      await tx.from(t.audit).delete().eq('id', audit.id);
      throw err;
    }
  });

  route('get', '/api/act/:activity/audits', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const access = await accessOf(req, activity, year);
    if (!access.member) return fail(res, 403, `ดูได้เฉพาะทีมของกิจกรรมนี้ปี ${year}`);
    const [audits, areas] = await Promise.all([
      fetchAll(() => tx.from(t.audit).select('id,audit_no,audit_type,area_id,team,audited_at,total_score,percent_score,result,status,created_by').eq('year', year).order('audited_at', { ascending: false })),
      fetchAll(() => tx.from(t.area).select('id,code,name,area_type'))
    ]);
    const issues = await fetchIn(() => tx.from(t.issue).select('audit_id,status'), 'audit_id', audits.map((a) => a.id));
    res.json({
      year,
      canDelete: access.admin,
      audits: audits.map((a) => {
        const area = areas.find((x) => x.id === a.area_id) || {};
        const own = issues.filter((i) => i.audit_id === a.id);
        return { ...a, areaCode: area.code, areaName: area.name, areaType: area.area_type, issues: own.length, openIssues: own.filter((i) => i.status !== 'CLOSED').length };
      })
    });
  });

  route('get', '/api/act/:activity/audits/:id', async (req, res, activity, t) => {
    const audit = must(await tx.from(t.audit).select('*').eq('id', Number(req.params.id)).maybeSingle());
    if (!audit) return fail(res, 404, 'ไม่พบใบตรวจ');
    if (!(await accessOf(req, activity, audit.year)).member) return fail(res, 403, 'ดูได้เฉพาะทีมของกิจกรรมนี้');
    const [scores, people, issues, area] = await Promise.all([
      fetchAll(() => tx.from(t.score).select('checklist_id,score').eq('audit_id', audit.id)),
      fetchAll(() => tx.from(t.person).select('employee_id,kind').eq('audit_id', audit.id)),
      fetchAll(() => tx.from(t.issue).select('id,issue_no,checklist_id,score,description,status,due_date').eq('audit_id', audit.id)),
      tx.from(t.area).select('code,name,area_type').eq('id', audit.area_id).maybeSingle()
    ]);
    const items = await fetchIn(() => tx.from(t.checklist).select('id,item_no,s_group,title,score_max'), 'id', scores.map((s) => s.checklist_id));
    const names = await namesOf(people.map((p) => p.employee_id));
    res.json({
      audit: { ...audit, area: area.data },
      scores: scores.map((s) => ({ ...s, ...(items.find((i) => i.id === s.checklist_id) || {}) })).sort((a, b) => a.item_no - b.item_no),
      people: people.map((p) => ({ ...p, name: names.get(String(p.employee_id))?.name || '' })),
      issues
    });
  });

  route('delete', '/api/act/:activity/audits/:id', async (req, res, activity, t) => {
    const audit = must(await tx.from(t.audit).select('id,year,audit_no').eq('id', Number(req.params.id)).maybeSingle());
    if (!audit) return fail(res, 404, 'ไม่พบใบตรวจ');
    if (!(await accessOf(req, activity, audit.year)).admin) return fail(res, 403, `ลบได้เฉพาะ admin ปี ${audit.year}`);
    must(await tx.from(t.audit).delete().eq('id', audit.id));
    res.json({ ok: true });
  });

  // Who may do what on one Issue: auditors add the problem photo, the owner sends the action, admins move the due date.
  const issueRights = (access, issue, me) => ({
    canAddBefore: access.admin || access.chairman || access.auditor,
    canAct: issue.status !== 'CLOSED' && (access.admin || String(issue.responsible_id || '') === me || access.ownerAreaIds.includes(issue.area_id)),
    canEditDue: access.admin
  });

  route('get', '/api/act/:activity/issues', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const access = await accessOf(req, activity, year);
    if (!access.member) return fail(res, 403, `ดูได้เฉพาะทีมของกิจกรรมนี้ปี ${year}`);
    const audits = await fetchAll(() => tx.from(t.audit).select('id,audit_no,year').eq('year', year));
    const issues = await fetchIn(() => tx.from(t.issue).select('*').order('issue_no'), 'audit_id', audits.map((a) => a.id));
    const [photos, areas, items] = await Promise.all([
      fetchIn(() => tx.from(t.photo).select('issue_id,kind,url,created_at'), 'issue_id', issues.map((i) => i.id)),
      fetchAll(() => tx.from(t.area).select('id,code,name')),
      fetchIn(() => tx.from(t.checklist).select('id,item_no,s_group,title'), 'id', issues.map((i) => i.checklist_id))
    ]);
    const names = await namesOf(issues.map((i) => i.responsible_id).filter(Boolean));
    const today = todayIso();
    res.json({
      year,
      issues: issues.map((i) => ({
        ...i,
        shownStatus: shownStatus(i, today),
        auditNo: audits.find((a) => a.id === i.audit_id)?.audit_no || '',
        area: areas.find((a) => a.id === i.area_id) || {},
        item: items.find((x) => x.id === i.checklist_id) || {},
        responsibleName: names.get(String(i.responsible_id))?.name || '',
        photos: photos.filter((p) => p.issue_id === i.id),
        ...issueRights(access, i, req.user.employeeId)
      })).sort((a, b) => b.issue_no.localeCompare(a.issue_no))
    });
  });

  const issueWithAccess = async (req, res, activity, t) => {
    const issue = must(await tx.from(t.issue).select('*').eq('id', Number(req.params.id)).maybeSingle());
    if (!issue) {
      fail(res, 404, 'ไม่พบ Issue');
      return null;
    }
    const audit = must(await tx.from(t.audit).select('year').eq('id', issue.audit_id).maybeSingle());
    const access = await accessOf(req, activity, audit?.year || Number(issue.issue_date.slice(0, 4)));
    return { issue, access, rights: issueRights(access, issue, req.user.employeeId) };
  };

  route('post', '/api/act/:activity/issues/:id/photo', async (req, res, activity, t) => {
    const found = await issueWithAccess(req, res, activity, t);
    if (!found) return;
    const kind = req.body?.kind === 'AFTER' ? 'AFTER' : 'BEFORE';
    if (kind === 'BEFORE' && !found.rights.canAddBefore) return fail(res, 403, 'แนบรูปปัญหาได้เฉพาะทีมตรวจประเมิน');
    if (kind === 'AFTER' && !found.rights.canAct) return fail(res, 403, 'แนบรูปหลังแก้ได้เฉพาะผู้รับผิดชอบพื้นที่');
    const bytes = imageBytes(req.body?.image);
    if (!bytes) return fail(res, 400, 'รูปต้องเป็น JPEG ไม่เกิน 700 KB');
    const settings = await settingsOf(activity);
    const have = must(await tx.from(t.photo).select('id').eq('issue_id', found.issue.id).eq('kind', kind));
    if (have.length >= settings.issue_photo_max) return fail(res, 400, `แนบรูป${kind === 'AFTER' ? 'หลังแก้' : 'ปัญหา'}ได้ ${settings.issue_photo_max} รูป`);
    const key = `${activity.replace(/[^a-z0-9]/g, '')}/${found.issue.issue_no}_${kind}_${Date.now()}.jpg`;
    const uploaded = await tx.storage.from(PHOTO_BUCKET).upload(key, new Uint8Array(bytes), { contentType: 'image/jpeg', upsert: false });
    if (uploaded.error) {
      const text = String(uploaded.error.message || '');
      return fail(res, 400, /bucket/i.test(text) ? `ยังไม่ได้สร้างที่เก็บรูป ${PHOTO_BUCKET} ใน Tx Data (db/act/storage.sql)` : 'อัปโหลดรูปไม่ได้');
    }
    const url = tx.storage.from(PHOTO_BUCKET).getPublicUrl(key).data.publicUrl;
    must(await tx.from(t.photo).insert({ issue_id: found.issue.id, kind, url }));
    res.status(201).json({ url });
  });

  route('post', '/api/act/:activity/issues/:id/action', async (req, res, activity, t) => {
    const found = await issueWithAccess(req, res, activity, t);
    if (!found) return;
    if (!found.rights.canAct) return fail(res, 403, 'ส่ง Action ได้เฉพาะผู้รับผิดชอบพื้นที่');
    const description = String(req.body?.description || '').trim().slice(0, 2000);
    if (!description) return fail(res, 400, 'ระบุสิ่งที่แก้ไข');
    const after = must(await tx.from(t.photo).select('id').eq('issue_id', found.issue.id).eq('kind', 'AFTER'));
    if (!after.length) return fail(res, 400, 'แนบรูปหลังแก้ก่อนส่ง Action');
    const today = todayIso();
    const status = !found.issue.due_date || today <= found.issue.due_date ? 'ON_PLAN' : 'WAIT_VERIFY';
    must(await tx.from(t.issue).update({ action_description: description, action_date: today, status }).eq('id', found.issue.id));
    res.json({ ok: true, status });
  });

  route('patch', '/api/act/:activity/issues/:id', async (req, res, activity, t) => {
    const found = await issueWithAccess(req, res, activity, t);
    if (!found) return;
    if (!found.rights.canEditDue) return fail(res, 403, 'แก้กำหนดได้เฉพาะ admin');
    const due = req.body?.dueDate ? dateOf(req.body.dueDate) : null;
    if (req.body?.dueDate && !due) return fail(res, 400, 'วันที่ไม่ถูกต้อง');
    must(await tx.from(t.issue).update({ due_date: due }).eq('id', found.issue.id));
    res.json({ ok: true });
  });
}
