// Test the activity tables (scripts/act-sql.js) on in-memory Postgres (PGlite): npm run test:act
// If inbox/import_5s.sql exists (python -I scripts/import_5s_excel.py), also loads the real 5S data
// and checks the server's dashboard functions against the old TSAT4-5S dashboard.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { actSql } from './act-sql.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const importFile = path.join(ROOT, 'inbox', 'import_5s.sql');
let failed = 0;
const ok = (c, label) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${label}`); if (!c) failed++; };
const one = async (db, sql) => (await db.query(sql)).rows[0];
const throws = async (db, sql) => { try { await db.exec(sql); return false; } catch { return true; } };

ok(fs.readFileSync(path.join(ROOT, 'db', 'act', '5s.sql'), 'utf8') === actSql('5s'), 'db/act/5s.sql is up to date (node scripts/act-sql.js 5s)');

const db = new PGlite();
await db.exec(`do $$ begin create role anon; create role authenticated; exception when duplicate_object then null; end $$;`);
await db.exec(actSql('5s'));
await db.exec(actSql('5s'));
await db.exec(actSql('safety'));
await db.exec(actSql('kaizen', { audit: false }));
ok(true, 'schemas run twice; another activity (safety) and a plan-only activity (kaizen) build from the same template');
ok((await one(db, `select to_regclass('public.mt_kaizen_plan') is not null p, to_regclass('public.tx_kaizen_audit') is null a`)).p, 'plan-only activity has no audit tables');

// rules, on the safety tables
await db.exec(`
insert into mt_safety_area (code, area_type, name) values ('X1', 'โรงงาน', 'Test');
insert into mt_safety_checklist (year, item_no, s_group, title) values (2026, 1, 1, 'a'), (2026, 2, 1, 'b'), (2026, 3, 2, 'c');
insert into tx_safety_audit (audit_no, year, audit_type, area_id, audited_at, status) select 'C-X1-1', 2026, 'COMMITTEE', id, now(), 'COMPLETED' from mt_safety_area;
insert into tx_safety_audit_score select a.id, c.id, v.s from tx_safety_audit a, mt_safety_checklist c, (values (1, 5), (2, 3), (3, 4)) v(n, s) where c.item_no = v.n;
`);
const g = (await db.query(`select s_group, percent::float from v_safety_audit_group order by s_group`)).rows;
ok(g.length === 2 && g[0].percent === 80 && g[1].percent === 80, `group percent (got ${JSON.stringify(g)})`);
ok(await throws(db, `insert into mt_safety_area (code, area_type, name) values ('X2', 'บ้าน', 'x')`), 'area_type must be โรงงาน/สำนักงาน');
ok(await throws(db, `insert into mt_safety_team (year, employee_id, role) values (2026, '1', 'auditor')`), 'auditor needs a team');
ok(await throws(db, `insert into mt_safety_team (year, employee_id, role, team) values (2026, '1', 'admin', 'A')`), 'admin has no team');
await db.exec(`insert into mt_safety_team (year, employee_id, role) values (2026, '1', 'admin')`);
ok(await throws(db, `insert into mt_safety_team (year, employee_id, role) values (2026, '1', 'admin')`), 'same admin twice is refused (nulls not distinct)');
ok(await throws(db, `insert into mt_safety_audit_plan (year, area_id, month, week) select 2026, id, 1, 5 from mt_safety_area`), 'week must be 1-4');
ok(await throws(db, `insert into mt_safety_plan (title, start_date, end_date, created_by) values ('x', '2026-02-02', '2026-02-01', '1')`), 'plan end date not before start');
ok((await one(db, `select count(*)::int n from mt_5s_setting`)).n === 5, 'settings seeded');

if (!fs.existsSync(importFile)) {
  console.log('skip real data: inbox/import_5s.sql not found (python -I scripts/import_5s_excel.py)');
} else {
  const sql = fs.readFileSync(importFile, 'utf8');
  await db.exec(sql);
  await db.exec(sql);
  ok(true, 'real import runs twice');
  const parts = path.join(ROOT, 'inbox', 'import_5s');
  for (const f of fs.readdirSync(parts).sort()) await db.exec(fs.readFileSync(path.join(parts, f), 'utf8'));
  ok(true, 'import part files run on top of it');
  const c = await one(db, `select
    (select count(*)::int from mt_5s_area) areas,
    (select count(*)::int from mt_5s_area_owner) owners,
    (select count(*)::int from mt_5s_team) team,
    (select count(*)::int from mt_5s_checklist) checklist,
    (select count(*)::int from mt_5s_audit_plan) plans,
    (select count(*)::int from tx_5s_audit) audits,
    (select count(*)::int from tx_5s_audit_score) scores,
    (select count(*)::int from tx_5s_audit_person) people,
    (select count(*)::int from tx_5s_issue) issues,
    (select count(*)::int from tx_5s_issue_photo) photos`);
  console.log('     counts', JSON.stringify(c));
  ok(c.areas === 34 && c.owners === 34 && c.team === 19 && c.checklist === 25 && c.plans === 14 && c.audits === 33 && c.issues === 52, 'all rows imported');
  ok(c.scores === 33 * 25, `25 scores per audit (got ${c.scores})`);
  const bad = await one(db, `select count(*)::int n from tx_5s_audit a where abs((select sum(score) from tx_5s_audit_score s where s.audit_id = a.id) - a.total_score) > 0.001`);
  ok(bad.n === 0, 'stored total = sum of item scores');
  const sep = await one(db, `select round(avg(percent_score), 2)::float p, count(*)::int n from tx_5s_audit where extract(month from audited_at at time zone 'Asia/Bangkok') = 9`);
  ok(sep.p === 86.67 && sep.n === 33, `September 5S % = 86.67 over 33 audits (got ${sep.p} / ${sep.n})`);

  // The server's own dashboard functions on the same rows.
  const { summarize, rank } = await import('../server/modules/act/audit.js');
  const areas = (await db.query(`select id::int, code, area_type, name, section, status from mt_5s_area order by code`)).rows;
  const audits = (await db.query(`select id::int, audit_no, audit_type, area_id::int, team, audited_at::text, total_score::float, percent_score::float, result from tx_5s_audit where year = 2026 and status = 'COMPLETED'`)).rows;
  const groups = (await db.query(`select audit_id::int, s_group, percent::float from v_5s_audit_group`)).rows;
  const s = summarize(audits, groups);
  ok(s.groups.map((x) => x.percent).join('/') === '85.2/82.5/87/88.7/89.8' && s.months[8].percent === 86.67 && s.months[8].audits === 33, 'summarize() = old Summary page (85.2/82.5/87.0/88.7/89.8, Sep 86.67% of 33)');
  const r = rank(areas, audits, groups, 10);
  const f = r.types['โรงงาน'];
  const o = r.types['สำนักงาน'];
  ok(f.rows.length === 18 && f.rows[0].name === 'ASSY PD4' && f.rows[0].groups.join('/') === '100/92/100/100/92' && f.rows[0].average === 96.8, 'rank(): factory #1 ASSY PD4 100/92/100/100/92 · 96.8 of 18 areas');
  ok(f.total.groups.join('/') === '88.2/85.1/88/91.8/90' && f.total.average === 88.6, 'rank(): factory total = old Ranking (88.2/85.1/88.0/91.8/90.0 · 88.6)');
  ok(o.rows.length === 15 && o.rows[0].name === 'CIC' && o.total.groups.join('/') === '81.6/79.5/85.9/85.1/89.6' && o.total.average === 84.3, 'rank(): office = old Ranking (CIC first · 84.3)');
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
