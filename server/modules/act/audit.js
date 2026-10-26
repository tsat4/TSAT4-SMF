import { mx, tx } from '../../core/db.js';
import { fail, cleanTerm } from '../../core/http.js';
import { nameOf } from '../../core/users.js';
import { accessOf, actRoute, fetchAll, fetchIn, namesOf, requireAdmin, roundTo, tablesOf, throwIf, yearOf } from './common.js';

// Checklist audits (5S and similar): Dashboard reads for everyone, Setting writes for the year's admins.
// Tables (Tx Data, one set per activity): db/act/<activity>.sql via tablesOf() · rules: docs/specs/act-5s.md
const AREA_TYPES = ['โรงงาน', 'สำนักงาน'];
const ROLES = ['admin', 'chairman', 'vice', 'auditor', 'member'];
const AUDIT_TYPES = ['SELF', 'COMMITTEE'];

const round1 = (n) => roundTo(n, 1);
const round2 = (n) => roundTo(n, 2);
const avg = (list) => (list.length ? list.reduce((s, n) => s + Number(n), 0) / list.length : null);
// audited_at is stored in UTC; plans and dashboards use Thai dates.
const bangkok = (ts) => new Date(Date.parse(ts) + 7 * 3600000);
const monthOf = (ts) => bangkok(ts).getUTCMonth() + 1;
const weekOf = (ts) => Math.min(4, Math.floor((bangkok(ts).getUTCDate() - 1) / 7) + 1);

function intIn(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

const areasOf = (activity) => fetchAll(() => tx.from(tablesOf(activity).area).select('id,code,area_type,name,section,status').order('code'));

function auditsOf(activity, year, type) {
  return fetchAll(() => {
    let q = tx.from(tablesOf(activity).audit).select('id,audit_no,audit_type,area_id,team,audited_at,total_score,percent_score,result')
      .eq('year', year).eq('status', 'COMPLETED').order('audited_at').order('id');
    if (AUDIT_TYPES.includes(type)) q = q.eq('audit_type', type);
    return q;
  });
}

const groupsOf = (activity, auditIds) => fetchIn(() => tx.from(tablesOf(activity).group).select('audit_id,s_group,percent'), 'audit_id', auditIds);

async function ownersOf(activity, year, areaIds) {
  const rows = await fetchIn(() => tx.from(tablesOf(activity).team).select('area_id,employee_id').eq('year', year).eq('role', 'owner'), 'area_id', areaIds);
  return new Map(rows.map((row) => [Number(row.area_id), String(row.employee_id)]));
}

// Summary: average % per group over every audit, and the average audit % per month.
export function summarize(audits, groups) {
  const groupNos = [...new Set(groups.map((g) => Number(g.s_group)))].sort((x, y) => x - y);
  return {
    groups: groupNos.map((n) => ({ group: n, percent: round1(avg(groups.filter((g) => Number(g.s_group) === n).map((g) => g.percent)) || 0) })),
    months: Array.from({ length: 12 }, (_, i) => {
      const rows = audits.filter((a) => monthOf(a.audited_at) === i + 1);
      return { month: i + 1, percent: rows.length ? round2(avg(rows.map((a) => a.percent_score))) : 0, audits: rows.length };
    }),
    audits: audits.length
  };
}

// Ranking: per area the average % of each group up to a month, their mean, sorted best first, per area type.
export function rank(areas, audits, groups, upTo) {
  const inRange = audits.filter((a) => monthOf(a.audited_at) <= upTo);
  const ids = new Set(inRange.map((a) => a.id));
  const used = groups.filter((g) => ids.has(g.audit_id));
  const groupNos = [...new Set(used.map((g) => Number(g.s_group)))].sort((x, y) => x - y);
  const byArea = areaScores(inRange, used);
  const types = {};
  for (const type of AREA_TYPES) {
    const rows = areas.filter((a) => a.area_type === type && byArea.has(a.id)).map((a) => {
      const list = byArea.get(a.id);
      const values = groupNos.map((n) => round1(avg(list.map((m) => m.get(n)).filter((v) => v != null)) || 0));
      return { id: a.id, code: a.code, name: a.name, audits: list.length, groups: values, average: round1(avg(values) || 0) };
    }).sort((x, y) => y.average - x.average || x.code.localeCompare(y.code));
    types[type] = {
      rows,
      total: { groups: groupNos.map((_, i) => round1(avg(rows.map((r) => r.groups[i])) || 0)), average: round1(avg(rows.map((r) => r.average)) || 0) }
    };
  }
  return { groups: groupNos, types };
}

// Per area: the group percents of each of its audits.
function areaScores(audits, groups) {
  const byAudit = new Map();
  for (const g of groups) {
    if (!byAudit.has(g.audit_id)) byAudit.set(g.audit_id, new Map());
    byAudit.get(g.audit_id).set(Number(g.s_group), Number(g.percent));
  }
  const byArea = new Map();
  for (const a of audits) {
    const list = byArea.get(a.area_id) || [];
    list.push(byAudit.get(a.id) || new Map());
    byArea.set(a.area_id, list);
  }
  return byArea;
}

export function mountAudit(app) {
  const route = actRoute(app);

  // ---------- read: everyone signed in ----------

  route('get', '/api/act/:activity/me', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const [access, team, audits] = await Promise.all([
      accessOf(req, activity, year),
      tx.from(tablesOf(activity).team).select('year'),
      tx.from(tablesOf(activity).audit).select('year')
    ]);
    // Activities without audit tables (CFO, 100P) have no tx_<act>_audit.
    throwIf(team.error, audits.error?.code === 'PGRST205' ? null : audits.error);
    const years = [...new Set([new Date().getFullYear(), year, ...(team.data || []).map((r) => r.year), ...(audits.data || []).map((r) => r.year)].map(Number))].sort();
    res.json({ year, years, access });
  });

  route('get', '/api/act/:activity/dashboard/summary', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const areas = await areasOf(activity);
    const areaType = AREA_TYPES.includes(req.query.areaType) ? req.query.areaType : '';
    const areaId = Number(req.query.area) || 0;
    const allowed = new Set(areas.filter((a) => (!areaType || a.area_type === areaType) && (!areaId || a.id === areaId)).map((a) => a.id));
    const audits = (await auditsOf(activity, year, req.query.type)).filter((a) => allowed.has(a.area_id));
    const groups = await groupsOf(activity, audits.map((a) => a.id));
    const owner = areaId ? (await ownersOf(activity, year, [areaId])).get(areaId) : '';
    const pass = await tx.from(tablesOf(activity).setting).select('value').eq('key', 'pass_percent').maybeSingle();
    res.json({
      pass: Number(pass.data?.value) || 80,
      areas: areas.filter((a) => a.status === 'Active' || allowed.has(a.id)).map((a) => ({ id: a.id, code: a.code, name: a.name, areaType: a.area_type })),
      ...summarize(audits, groups),
      owner: owner ? { employeeId: owner, name: (await namesOf([owner])).get(owner)?.name || '' } : null
    });
  });

  route('get', '/api/act/:activity/dashboard/ranking', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    const upTo = intIn(req.query.month, 1, 12) || 12;
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const areas = await areasOf(activity);
    const audits = (await auditsOf(activity, year, req.query.type)).filter((a) => monthOf(a.audited_at) <= upTo);
    const groups = await groupsOf(activity, audits.map((a) => a.id));
    res.json({ year, month: upTo, ...rank(areas, audits, groups, upTo) });
  });

  route('get', '/api/act/:activity/dashboard/schedule', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const areaType = AREA_TYPES.includes(req.query.areaType) ? req.query.areaType : AREA_TYPES[0];
    const areas = (await areasOf(activity)).filter((a) => a.area_type === areaType);
    const ids = areas.map((a) => a.id);
    const [plans, audits] = await Promise.all([
      fetchIn(() => tx.from(tablesOf(activity).auditPlan).select('id,area_id,month,week,round,team').eq('year', year), 'area_id', ids),
      auditsOf(activity, year, 'COMMITTEE')
    ]);
    const mine = audits.filter((a) => ids.includes(a.area_id));
    const issues = await fetchIn(() => tx.from(tablesOf(activity).issue).select('audit_id,status'), 'audit_id', mine.map((a) => a.id));
    res.json({
      year,
      areaType,
      areas: areas.filter((a) => a.status === 'Active' || plans.some((p) => p.area_id === a.id) || mine.some((x) => x.area_id === a.id)).map((a) => ({ id: a.id, code: a.code, name: a.name })),
      plans,
      audits: mine.map((a) => {
        const own = issues.filter((i) => i.audit_id === a.id);
        return { id: a.id, auditNo: a.audit_no, areaId: a.area_id, month: monthOf(a.audited_at), week: weekOf(a.audited_at), team: a.team, percent: Number(a.percent_score), issues: own.length, openIssues: own.filter((i) => i.status !== 'CLOSED').length };
      })
    });
  });

  route('get', '/api/act/:activity/team', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const rows = await fetchAll(() => tx.from(tablesOf(activity).team).select('*').eq('year', year).neq('role', 'owner').order('role').order('team').order('employee_id'));
    const names = await namesOf(rows.map((r) => r.employee_id));
    res.json({ year, members: rows.map((r) => ({ ...r, name: names.get(String(r.employee_id))?.name || '', department: r.department || names.get(String(r.employee_id))?.department || '' })) });
  });

  route('get', '/api/act/:activity/checklist', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const rows = await fetchAll(() => tx.from(tablesOf(activity).checklist).select('id,item_no,s_group,title,score_max,status').eq('year', year).order('item_no'));
    res.json({ year, items: rows });
  });

  route('get', '/api/act/:activity/areas', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const areas = await areasOf(activity);
    const owners = await ownersOf(activity, year, areas.map((a) => a.id));
    const names = await namesOf([...owners.values()]);
    res.json({ year, areas: areas.map((a) => ({ ...a, owner: owners.get(a.id) ? { employeeId: owners.get(a.id), name: names.get(owners.get(a.id))?.name || '' } : null })) });
  });

  route('get', '/api/act/:activity/audit-plan', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const plans = await fetchAll(() => tx.from(tablesOf(activity).auditPlan).select('id,area_id,month,week,round,team').eq('year', year).order('area_id').order('month').order('week'));
    res.json({ year, plans });
  });

  // ---------- Setting: admin of the year ----------

  // Employee picker for Setting (admins) and for the audit form's receivers (any team member of the year).
  route('get', '/api/act/:activity/employees', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    if (!(await accessOf(req, activity, year)).member) return fail(res, 403, `ค้นพนักงานได้เฉพาะทีมของกิจกรรมนี้ปี ${year}`);
    const term = cleanTerm(req.query.q);
    let q = mx.from('mt_main_employee').select('employee_id,prefix,first_name,last_name,department,position').eq('status', 'Active').order('employee_id').limit(20);
    if (term) q = q.or(`employee_id.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,department.ilike.%${term}%`);
    const { data, error } = await q;
    if (error) return fail(res, 400, 'ค้นหาพนักงานไม่ได้');
    res.json({ employees: (data || []).map((r) => ({ employeeId: String(r.employee_id), name: nameOf(r), department: r.department || '', position: r.position || '' })) });
  });

  const areaInput = (body) => {
    const code = String(body.code || '').trim().toUpperCase().slice(0, 20);
    const name = String(body.name || '').trim().slice(0, 120);
    if (!code || !name || !AREA_TYPES.includes(body.areaType)) return { error: 'ระบุรหัส ชื่อ และประเภทพื้นที่' };
    return { row: { code, name, area_type: body.areaType, section: String(body.section || '').trim().slice(0, 120) || null, status: body.status === 'Inactive' ? 'Inactive' : 'Active' } };
  };

  route('post', '/api/act/:activity/areas', async (req, res, activity) => {
    const year = yearOf(req.body?.year);
    if (!year || !(await requireAdmin(req, res, activity, year))) return;
    const { row, error: invalid } = areaInput(req.body || {});
    if (invalid) return fail(res, 400, invalid);
    const { error } = await tx.from(tablesOf(activity).area).insert(row);
    if (error?.code === '23505') return fail(res, 400, `มีรหัสพื้นที่ ${row.code} แล้ว`);
    throwIf(error);
    res.status(201).json({ ok: true });
  });

  route('patch', '/api/act/:activity/areas/:id', async (req, res, activity) => {
    const year = yearOf(req.body?.year);
    if (!year || !(await requireAdmin(req, res, activity, year))) return;
    const { row, error: invalid } = areaInput(req.body || {});
    if (invalid) return fail(res, 400, invalid);
    const { data, error } = await tx.from(tablesOf(activity).area).update(row).eq('id', Number(req.params.id)).select('id');
    if (error?.code === '23505') return fail(res, 400, `มีรหัสพื้นที่ ${row.code} แล้ว`);
    throwIf(error);
    if (!data?.length) return fail(res, 404, 'ไม่พบพื้นที่');
    res.json({ ok: true });
  });

  // An area that already has audits is kept (Inactive) so old results stay readable.
  route('delete', '/api/act/:activity/areas/:id', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    if (!year || !(await requireAdmin(req, res, activity, year))) return;
    const id = Number(req.params.id);
    const used = await tx.from(tablesOf(activity).audit).select('id', { count: 'exact', head: true }).eq('area_id', id);
    throwIf(used.error);
    if (used.count) {
      const { error } = await tx.from(tablesOf(activity).area).update({ status: 'Inactive' }).eq('id', id);
      throwIf(error);
      return res.json({ ok: true, inactive: true });
    }
    const { error } = await tx.from(tablesOf(activity).area).delete().eq('id', id);
    throwIf(error);
    res.json({ ok: true });
  });

  route('put', '/api/act/:activity/areas/:id/owner', async (req, res, activity) => {
    const year = yearOf(req.body?.year);
    if (!year || !(await requireAdmin(req, res, activity, year))) return;
    const areaId = Number(req.params.id);
    const area = await tx.from(tablesOf(activity).area).select('id').eq('id', areaId).maybeSingle();
    throwIf(area.error);
    if (!area.data) return fail(res, 404, 'ไม่พบพื้นที่');
    const employeeId = String(req.body?.employeeId || '').trim();
    // The owner is a team row (role owner, area_id); one per area per year, so replace it.
    const team = tablesOf(activity).team;
    const removed = await tx.from(team).delete().eq('year', year).eq('area_id', areaId).eq('role', 'owner');
    throwIf(removed.error);
    const { error } = employeeId ? await tx.from(team).insert({ year, employee_id: employeeId, role: 'owner', area_id: areaId, status: 'Active' }) : { error: null };
    throwIf(error);
    res.json({ ok: true });
  });

  route('post', '/api/act/:activity/team', async (req, res, activity) => {
    const year = yearOf(req.body?.year);
    if (!year || !(await requireAdmin(req, res, activity, year))) return;
    const employeeId = String(req.body?.employeeId || '').trim();
    const role = ROLES.includes(req.body?.role) ? req.body.role : '';
    const team = role === 'auditor' ? String(req.body?.team || '').trim().toUpperCase() : null;
    const department = role === 'member' ? String(req.body?.department || '').trim().slice(0, 80) : '';
    if (!employeeId || !role) return fail(res, 400, 'เลือกพนักงานและบทบาท');
    if (role === 'auditor' && !/^[A-Z]$/.test(team)) return fail(res, 400, 'ผู้ตรวจต้องเลือกทีม A–Z');
    if (role === 'member' && !department) return fail(res, 400, 'ตัวแทนหน่วยงานต้องระบุหน่วยงาน');
    const { error } = await tx.from(tablesOf(activity).team).insert({ year, employee_id: employeeId, role, team, ...(department ? { department } : {}), status: 'Active' });
    if (error?.code === '23505') return fail(res, 400, 'คนนี้มีบทบาทนี้อยู่แล้ว');
    throwIf(error);
    res.status(201).json({ ok: true });
  });

  route('delete', '/api/act/:activity/team/:id', async (req, res, activity) => {
    const { data: row, error } = await tx.from(tablesOf(activity).team).select('id,year,employee_id,role').eq('id', Number(req.params.id)).maybeSingle();
    throwIf(error);
    if (!row) return fail(res, 404, 'ไม่พบรายชื่อ');
    if (!(await requireAdmin(req, res, activity, row.year))) return;
    if (row.role === 'admin' && String(row.employee_id) === req.user.employeeId && !req.user.creator) return fail(res, 400, 'นำสิทธิ์ admin ของตัวเองออกไม่ได้');
    const del = await tx.from(tablesOf(activity).team).delete().eq('id', row.id);
    throwIf(del.error);
    res.json({ ok: true });
  });

  // Rows go in one by one so a row that already exists (unique constraint) is simply skipped.
  const copyYear = (key) => async (req, res, activity) => {
    const table = tablesOf(activity)[key];
    const from = yearOf(req.body?.from);
    const to = yearOf(req.body?.to);
    if (!from || !to || from === to) return fail(res, 400, 'เลือกปีต้นทางและปลายทาง');
    if (!(await requireAdmin(req, res, activity, to))) return;
    const rows = await fetchAll(() => tx.from(table).select('*').eq('year', from).order('id'));
    if (!rows.length) return fail(res, 400, `ปี ${from} ไม่มีข้อมูลให้คัดลอก`);
    let copied = 0;
    for (const { id, ...row } of rows) {
      const { error } = await tx.from(table).insert({ ...row, year: to });
      if (error?.code === '23505') continue;
      throwIf(error);
      copied += 1;
    }
    res.json({ ok: true, copied });
  };
  route('post', '/api/act/:activity/team/copy', copyYear('team'));
  route('post', '/api/act/:activity/checklist/copy', copyYear('checklist'));

  const itemInput = (body) => {
    const itemNo = intIn(body.itemNo, 1, 200);
    const sGroup = intIn(body.sGroup, 1, 20);
    const scoreMax = intIn(body.scoreMax ?? 5, 1, 100);
    const title = String(body.title || '').trim().slice(0, 300);
    if (!itemNo || !sGroup || !scoreMax || !title) return { error: 'ระบุข้อที่ หมวด หัวข้อ และคะแนนเต็ม' };
    return { row: { item_no: itemNo, s_group: sGroup, title, score_max: scoreMax, status: body.status === 'Inactive' ? 'Inactive' : 'Active' } };
  };

  route('post', '/api/act/:activity/checklist', async (req, res, activity) => {
    const year = yearOf(req.body?.year);
    if (!year || !(await requireAdmin(req, res, activity, year))) return;
    const { row, error: invalid } = itemInput(req.body || {});
    if (invalid) return fail(res, 400, invalid);
    const { error } = await tx.from(tablesOf(activity).checklist).insert({ ...row, year });
    if (error?.code === '23505') return fail(res, 400, `มีข้อที่ ${row.item_no} ของปี ${year} แล้ว`);
    throwIf(error);
    res.status(201).json({ ok: true });
  });

  route('patch', '/api/act/:activity/checklist/:id', async (req, res, activity) => {
    const { data: current, error: readError } = await tx.from(tablesOf(activity).checklist).select('id,year').eq('id', Number(req.params.id)).maybeSingle();
    throwIf(readError);
    if (!current) return fail(res, 404, 'ไม่พบหัวข้อ');
    if (!(await requireAdmin(req, res, activity, current.year))) return;
    const { row, error: invalid } = itemInput(req.body || {});
    if (invalid) return fail(res, 400, invalid);
    const { error } = await tx.from(tablesOf(activity).checklist).update(row).eq('id', current.id);
    if (error?.code === '23505') return fail(res, 400, `มีข้อที่ ${row.item_no} แล้ว`);
    throwIf(error);
    res.json({ ok: true });
  });

  route('delete', '/api/act/:activity/checklist/:id', async (req, res, activity) => {
    const { data: current, error: readError } = await tx.from(tablesOf(activity).checklist).select('id,year').eq('id', Number(req.params.id)).maybeSingle();
    throwIf(readError);
    if (!current) return fail(res, 404, 'ไม่พบหัวข้อ');
    if (!(await requireAdmin(req, res, activity, current.year))) return;
    const used = await tx.from(tablesOf(activity).score).select('audit_id', { count: 'exact', head: true }).eq('checklist_id', current.id);
    throwIf(used.error);
    const { error } = used.count
      ? await tx.from(tablesOf(activity).checklist).update({ status: 'Inactive' }).eq('id', current.id)
      : await tx.from(tablesOf(activity).checklist).delete().eq('id', current.id);
    throwIf(error);
    res.json({ ok: true, inactive: Boolean(used.count) });
  });

  // One cell of the committee plan: area x month x week. Empty team = remove the cell.
  route('put', '/api/act/:activity/audit-plan', async (req, res, activity) => {
    const year = yearOf(req.body?.year);
    if (!year || !(await requireAdmin(req, res, activity, year))) return;
    const areaId = Number(req.body?.areaId);
    const month = intIn(req.body?.month, 1, 12);
    const week = intIn(req.body?.week, 1, 4);
    const team = String(req.body?.team || '').trim().toUpperCase();
    const round = req.body?.round ? intIn(req.body.round, 1, 6) : null;
    if (!areaId || !month || !week) return fail(res, 400, 'ระบุพื้นที่ เดือน และสัปดาห์');
    if (team && !/^[A-Z]$/.test(team)) return fail(res, 400, 'ทีมต้องเป็น A–Z');
    if (req.body?.round && !round) return fail(res, 400, 'ครั้งที่ต้องเป็น 1–6');
    const area = await tx.from(tablesOf(activity).area).select('id').eq('id', areaId).maybeSingle();
    throwIf(area.error);
    if (!area.data) return fail(res, 404, 'ไม่พบพื้นที่');
    const { error } = team
      ? await tx.from(tablesOf(activity).auditPlan).upsert({ year, area_id: areaId, month, week, round, team }, { onConflict: 'year,area_id,month,week' })
      : await tx.from(tablesOf(activity).auditPlan).delete().eq('year', year).eq('area_id', areaId).eq('month', month).eq('week', week);
    throwIf(error);
    res.json({ ok: true });
  });
}
