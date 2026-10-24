// End-to-end test of the TX -> MX move on two in-memory Postgres (PGlite): npm run test:db
// Fake TX is shaped like the real one as far as the code shows. Re-run after any change in db/*.sql.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const DB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db') + path.sep;
const gen = fs.readFileSync(`${DB}02_generate_mx_sql.sql`, 'utf8');
const rpc = fs.readFileSync(`${DB}03_receive_rpc.sql`, 'utf8');
let failed = 0;
const ok = (c, label) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${label}`); if (!c) failed++; };
const roles = `do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;`;
const shared = `create or replace function public.touch_note() returns trigger language plpgsql as $$ begin new.note := coalesce(new.note, ''); return new; end $$;`;

// ---- fake TX (shaped like the real one as far as the code shows) ----
const txdb = new PGlite();
await txdb.exec(`${roles}
create type public.req_status as enum ('cart','submitted','accepted','preparing','ready','received','cancelled');
create table public.tx_sto_requisition (
  id bigint generated always as identity primary key,
  requested_by text not null, costcenter text not null default '-',
  status public.req_status not null default 'cart', note text, accepted_by text, received_by text,
  created_at timestamptz not null default now());
create index tx_req_by on public.tx_sto_requisition (requested_by);
create table public.tx_sto_requisition_line (
  id serial primary key,
  requisition_id bigint not null references public.tx_sto_requisition(id) on delete cascade,
  costcenter text not null, material text not null, qty numeric(12,3) not null check (qty > 0),
  unique (requisition_id, material));
create table public.tx_sto_issue (
  id bigint generated always as identity primary key, requisition_id bigint not null, requisition_line_id integer not null,
  costcenter text not null, material text not null, qty numeric(12,3) not null, issued_at timestamptz not null default now());
alter table public.tx_sto_requisition enable row level security;
create policy svc on public.tx_sto_requisition as permissive for all to service_role using (true);
create or replace function public.tx_sto_apply_costcenter(p_id bigint, p_employee text, p_costcenter text) returns void language sql as $$
  update tx_sto_requisition set costcenter = p_costcenter where id = p_id and requested_by = p_employee and status = 'cart';
  update tx_sto_requisition_line set costcenter = p_costcenter where requisition_id = p_id; $$;
create or replace function public.tx_sto_log_issue() returns trigger language plpgsql as $$
begin
  if new.status = 'received' and old.status <> 'received' then
    insert into tx_sto_issue (requisition_id, requisition_line_id, costcenter, material, qty)
      select l.requisition_id, l.id, l.costcenter, l.material, l.qty from tx_sto_requisition_line l where l.requisition_id = new.id;
  end if;
  return new;
end $$;
create trigger tx_issue_on_receive after update on public.tx_sto_requisition for each row execute function public.tx_sto_log_issue();
${shared}
create trigger tx_touch before insert on public.tx_sto_requisition for each row execute function public.touch_note();
insert into tx_sto_requisition (requested_by, costcenter, status) values ('u1','C1','ready'), ('u1','C1','ready'), ('u2','C1','received');
insert into tx_sto_requisition_line (requisition_id, costcenter, material, qty) values (1,'C1','M1',2),(1,'C1','M2',1),(2,'C1','M1',1),(2,'C1','M2',50),(3,'C1','M1',1);
insert into tx_sto_issue (requisition_id, requisition_line_id, costcenter, material, qty) values (3,5,'C1','M1',1);
`);

const out = (await txdb.query(gen)).rows;
ok(out.length === 2 && out[0].step === 'A_before_copy' && out[1].step === 'B_after_copy', 'generator returns A and B');
const [A, B] = out.map((r) => r.sql);

ok(!/generated always as identity/.test(A), 'identity always converted to by default');
ok(/create sequence if not exists public\.tx_sto_requisition_line_id_seq/.test(A), 'serial sequence created');

// ---- fake MX ----
const mxdb = new PGlite();
await mxdb.exec(`${roles}
create table public.mt_sto_stock (costcenter text, material text, min_qty numeric default 0, current_qty numeric not null, max_qty numeric default 0, primary key (costcenter, material));
create or replace function public.mt_sto_stock_adjust(p_costcenter text, p_material text, p_delta numeric) returns void language plpgsql as $$
begin
  update mt_sto_stock set current_qty = current_qty + p_delta where costcenter = p_costcenter and material = p_material and current_qty + p_delta >= 0;
  if not found then raise exception 'not enough stock for %', p_material; end if;
end $$;
${shared}
insert into mt_sto_stock (costcenter, material, current_qty) values ('C1','M1',10),('C1','M2',5);
`);

// step 2a
await mxdb.exec(A);
ok(true, 'A runs in MX');
await mxdb.exec(A);
ok(true, 'A runs again (idempotent)');

// step 3: simulate migrate (upsert rows with original ids)
for (const t of ['tx_sto_requisition', 'tx_sto_requisition_line', 'tx_sto_issue']) {
  const rows = (await txdb.query(`select * from ${t} order by id`)).rows;
  for (const row of rows) {
    const cols = Object.keys(row);
    await mxdb.query(`insert into ${t} (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) on conflict (id) do nothing`, cols.map((c) => row[c]));
  }
  const a = (await txdb.query(`select count(*)::int n from ${t}`)).rows[0].n;
  const b = (await mxdb.query(`select count(*)::int n from ${t}`)).rows[0].n;
  ok(a === b, `${t} copied ${a} -> ${b}`);
}
const issueBefore = (await mxdb.query('select count(*)::int n from tx_sto_issue')).rows[0].n;
ok(issueBefore === 1, 'no trigger fired during copy');

// step 4: B + 03
await mxdb.exec(B);
ok(true, 'B runs in MX');
await mxdb.exec(B);
ok(true, 'B runs again (idempotent)');
await mxdb.exec(rpc);
ok(true, '03 runs in MX');
await mxdb.exec(rpc);
ok(true, '03 runs again');

const next = await mxdb.query(`insert into tx_sto_requisition (requested_by) values ('u3') returning id, note`);
ok(Number(next.rows[0].id) === 4 && next.rows[0].note === '', `new id continues after copied ids (got ${next.rows[0].id}), copied trigger works`);
const nextLine = await mxdb.query(`insert into tx_sto_requisition_line (requisition_id, costcenter, material, qty) values (4,'C1','M1',1) returning id`);
ok(Number(nextLine.rows[0].id) === 6, `serial id continues (got ${nextLine.rows[0].id})`);

// receive #1: enough stock
await mxdb.query(`select tx_sto_receive(1, 'u1')`);
const s1 = (await mxdb.query(`select material, current_qty::float q from mt_sto_stock order by material`)).rows;
const r1 = (await mxdb.query(`select status, received_by from tx_sto_requisition where id = 1`)).rows[0];
ok(s1[0].q === 8 && s1[1].q === 4 && r1.status === 'received' && r1.received_by === 'u1', 'receive #1 cuts stock and marks received');
ok((await mxdb.query('select count(*)::int n from tx_sto_issue where requisition_id = 1')).rows[0].n === 2, 'issue trigger logged 2 lines');

// receive #2: M2 short (50 > 4) -> nothing changes
let msg = '';
try { await mxdb.query(`select tx_sto_receive(2, 'u1')`); } catch (err) { msg = err.message; }
const s2 = (await mxdb.query(`select material, current_qty::float q from mt_sto_stock order by material`)).rows;
const r2 = (await mxdb.query(`select status from tx_sto_requisition where id = 2`)).rows[0];
ok(msg.includes('not enough') && s2[0].q === 8 && s2[1].q === 4 && r2.status === 'ready', `short stock rolls back everything (${msg})`);

// wrong owner / not ready
msg = '';
try { await mxdb.query(`select tx_sto_receive(2, 'someone')`); } catch (err) { msg = err.message; }
ok(msg.includes('not ready'), 'wrong owner refused');
msg = '';
try { await mxdb.query(`select tx_sto_receive(1, 'u1')`); } catch (err) { msg = err.message; }
ok(msg.includes('not ready'), 'second receive refused');

// apply_costcenter copied and callable
await mxdb.query(`select tx_sto_apply_costcenter(4, 'u3', 'C9')`);
ok((await mxdb.query(`select costcenter from tx_sto_requisition_line where requisition_id = 4`)).rows[0].costcenter === 'C9', 'tx_sto_apply_costcenter works in MX');

// conflict: MX has a different function with the same name -> A must stop
const mx2 = new PGlite();
await mx2.exec(`${roles} create function public.touch_note() returns trigger language plpgsql as $$ begin return new; end $$;`);
msg = '';
try { await mx2.exec(A); } catch (err) { msg = err.message; }
ok(msg.includes('different function'), `refuses to overwrite a different MX function (${msg})`);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
