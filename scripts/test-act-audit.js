// Test db/05_act_audit.sql on in-memory Postgres (PGlite): npm run test:act
// If inbox/import_5s.sql exists (python -I scripts/import_5s_excel.py), also loads the real 5S data
// and checks the numbers against the old TSAT4-5S dashboard.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = fs.readFileSync(path.join(ROOT, 'db', '05_act_audit.sql'), 'utf8');
const importFile = path.join(ROOT, 'inbox', 'import_5s.sql');
let failed = 0;
const ok = (c, label) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${label}`); if (!c) failed++; };
const one = async (db, sql) => (await db.query(sql)).rows[0];
const throws = async (db, sql) => { try { await db.exec(sql); return false; } catch { return true; } };

const db = new PGlite();
await db.exec(`do $$ begin create role anon; create role authenticated; exception when duplicate_object then null; end $$;`);
await db.exec(schema);
await db.exec(schema);
ok(true, 'schema runs twice');

// rules on a tiny data set
await db.exec(`
insert into mt_act_area (activity, code, area_type, name) values ('t', 'X1', 'โรงงาน', 'Test');
insert into mt_act_checklist (year, activity, item_no, s_group, title) values (2026, 't', 1, 1, 'a'), (2026, 't', 2, 1, 'b'), (2026, 't', 3, 2, 'c');
insert into tx_act_audit (audit_no, activity, year, audit_type, area_id, audited_at, status) select 'C-X1-1', 't', 2026, 'COMMITTEE', id, now(), 'COMPLETED' from mt_act_area where code = 'X1';
insert into tx_act_audit_score select a.id, c.id, v.s from tx_act_audit a, mt_act_checklist c, (values (1, 5), (2, 3), (3, 4)) v(n, s) where c.activity = 't' and c.item_no = v.n;
`);
const g = (await db.query(`select s_group, percent::float from v_act_audit_group order by s_group`)).rows;
ok(g.length === 2 && g[0].percent === 80 && g[1].percent === 80, `group percent (got ${JSON.stringify(g)})`);
ok(await throws(db, `insert into mt_act_area (activity, code, area_type, name) values ('t', 'X2', 'บ้าน', 'x')`), 'area_type must be โรงงาน/สำนักงาน');
ok(await throws(db, `insert into mt_act_team (year, activity, employee_id, role) values (2026, 't', '1', 'auditor')`), 'auditor needs a team');
ok(await throws(db, `insert into mt_act_team (year, activity, employee_id, role, team) values (2026, 't', '1', 'admin', 'A')`), 'admin has no team');
await db.exec(`insert into mt_act_team (year, activity, employee_id, role) values (2026, 't', '1', 'admin')`);
ok(await throws(db, `insert into mt_act_team (year, activity, employee_id, role) values (2026, 't', '1', 'admin')`), 'same admin twice is refused (nulls not distinct)');
ok(await throws(db, `insert into mt_act_audit_plan (year, activity, area_id, month, week) select 2026, 't', id, 1, 5 from mt_act_area where code = 'X1'`), 'week must be 1-4');
ok((await one(db, `select count(*)::int n from mt_act_setting where activity = '5s'`)).n === 5, '5s settings seeded');

if (!fs.existsSync(importFile)) {
  console.log('skip real data: inbox/import_5s.sql not found (python -I scripts/import_5s_excel.py)');
} else {
  const sql = fs.readFileSync(importFile, 'utf8');
  await db.exec(sql);
  await db.exec(sql);
  ok(true, 'real import runs twice');
  const c = await one(db, `select
    (select count(*)::int from mt_act_area where activity = '5s') areas,
    (select count(*)::int from mt_act_area_owner o join mt_act_area a on a.id = o.area_id where a.activity = '5s') owners,
    (select count(*)::int from mt_act_team where activity = '5s') team,
    (select count(*)::int from mt_act_checklist where activity = '5s') checklist,
    (select count(*)::int from mt_act_audit_plan where activity = '5s') plans,
    (select count(*)::int from tx_act_audit where activity = '5s') audits,
    (select count(*)::int from tx_act_audit_score s join tx_act_audit a on a.id = s.audit_id where a.activity = '5s') scores,
    (select count(*)::int from tx_act_audit_person p join tx_act_audit a on a.id = p.audit_id where a.activity = '5s') people,
    (select count(*)::int from tx_act_issue i join tx_act_audit a on a.id = i.audit_id where a.activity = '5s') issues,
    (select count(*)::int from tx_act_issue_photo) photos`);
  console.log('     counts', JSON.stringify(c));
  ok(c.areas === 34 && c.owners === 34 && c.checklist === 25 && c.plans === 14 && c.audits === 33 && c.issues === 52, 'all rows imported');
  ok(c.scores === 33 * 25, `25 scores per audit (got ${c.scores})`);
  const bad = await one(db, `select count(*)::int n from tx_act_audit a
    where a.activity = '5s' and abs((select sum(score) from tx_act_audit_score s where s.audit_id = a.id) - a.total_score) > 0.001`);
  ok(bad.n === 0, 'stored total = sum of item scores');
  // Old dashboard (Ranking, โรงงาน): ASSY PD4 = 100 / 92 / 100 / 100 / 92, avg 96.8
  const pd4 = (await db.query(`select g.s_group, round(avg(g.percent), 1)::float p from v_act_audit_group g
    join tx_act_audit a on a.id = g.audit_id join mt_act_area ar on ar.id = a.area_id
    where ar.activity = '5s' and ar.name = 'ASSY PD4' group by g.s_group order by g.s_group`)).rows.map((r) => r.p);
  ok(JSON.stringify(pd4) === JSON.stringify([100, 92, 100, 100, 92]), `ranking ASSY PD4 per S matches old dashboard (got ${pd4})`);
  // Old dashboard (Summary): ส1 85.2 · ส2 82.5 · ส3 87.0 · ส4 88.7 · ส5 89.8 (average of every audit)
  const sum = (await db.query(`select g.s_group, round(avg(g.percent), 1)::float p from v_act_audit_group g
    join tx_act_audit a on a.id = g.audit_id where a.activity = '5s' and a.year = 2026 group by g.s_group order by g.s_group`)).rows.map((r) => r.p);
  console.log('     summary per S', sum.join(' / '));
  ok(JSON.stringify(sum) === JSON.stringify([85.2, 82.5, 87, 88.7, 89.8]), 'summary per S matches old dashboard');
  const sep = await one(db, `select round(avg(percent_score), 2)::float p, count(*)::int n from tx_act_audit where activity = '5s' and extract(month from audited_at at time zone 'Asia/Bangkok') = 9`);
  ok(sep.p === 86.67 && sep.n === 33, `September 5S % = 86.67 over 33 audits (got ${sep.p} / ${sep.n})`);

  // The server's own dashboard functions on the same rows.
  const { summarize, rank } = await import('../server/modules/act/audit.js');
  const areas = (await db.query(`select id::int, code, area_type, name, section, status from mt_act_area where activity = '5s' order by code`)).rows;
  const audits = (await db.query(`select id::int, audit_no, audit_type, area_id::int, team, audited_at::text, total_score::float, percent_score::float, result from tx_act_audit where activity = '5s' and year = 2026 and status = 'COMPLETED'`)).rows;
  const groups = (await db.query(`select g.audit_id::int, g.s_group, g.percent::float from v_act_audit_group g join tx_act_audit a on a.id = g.audit_id where a.activity = '5s'`)).rows;
  const s = summarize(audits, groups);
  ok(s.groups.map((g) => g.percent).join('/') === '85.2/82.5/87/88.7/89.8' && s.months[8].percent === 86.67 && s.months[8].audits === 33, 'summarize() = old Summary page');
  const r = rank(areas, audits, groups, 10);
  const f = r.types['โรงงาน'];
  const o = r.types['สำนักงาน'];
  console.log('     ranking factory total', f.total.groups.join('/'), f.total.average, '· office total', o.total.groups.join('/'), o.total.average);
  ok(f.rows.length === 18 && f.rows[0].name === 'ASSY PD4' && f.rows[0].average === 96.8, 'rank(): factory #1 ASSY PD4 96.8 of 18 areas');
  ok(f.total.groups.join('/') === '88.2/85.1/88/91.8/90' && f.total.average === 88.6, 'rank(): factory total = old Ranking (88.2/85.1/88.0/91.8/90.0 · 88.6)');
  ok(o.rows.length === 15 && o.rows[0].name === 'CIC' && o.total.groups.join('/') === '81.6/79.5/85.9/85.1/89.6' && o.total.average === 84.3, 'rank(): office = old Ranking (CIC first · 84.3)');
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
