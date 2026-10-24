// Copy every tx_* table from the TX Supabase project into the MX project (same names, same ids).
// Run on your own machine with the keys in .env (never commit .env):
//   npm run migrate:tx -- --dry     count rows only, change nothing
//   npm run migrate:tx              copy (upsert by primary key, safe to run again)
// The tables must already exist in MX (db/02_create_tx_in_mx.sql). See db/README.md.
import { createClient } from '@supabase/supabase-js';

const FIRST = ['tx_sto_requisition', 'tx_sto_requisition_line', 'tx_sto_issue'];
const PAGE = 1000;
const dry = process.argv.includes('--dry');

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name} in .env`);
  return value;
};
const source = { url: env('TX_SUPABASE_URL'), key: env('TX_SUPABASE_SECRET_KEY') };
const target = { url: env('MX_SUPABASE_URL'), key: env('MX_SUPABASE_SECRET_KEY') };
if (source.url === target.url) throw new Error('TX and MX already point to the same project, nothing to copy');
const client = (p) => createClient(p.url, p.key, { auth: { persistSession: false, autoRefreshToken: false } });
const tx = client(source);
const mx = client(target);

// PostgREST lists every exposed table and marks primary keys with <pk/>.
async function catalog(p) {
  const res = await fetch(`${p.url}/rest/v1/`, { headers: { apikey: p.key, Authorization: `Bearer ${p.key}` } });
  if (!res.ok) throw new Error(`cannot read table list of ${p.url}: ${res.status}`);
  const spec = await res.json();
  const out = new Map();
  for (const [name, def] of Object.entries(spec.definitions || {})) {
    const pk = Object.entries(def.properties || {}).filter(([, col]) => String(col.description || '').includes('<pk/>')).map(([col]) => col);
    out.set(name, pk);
  }
  return out;
}

async function count(db, table) {
  const { count: n, error } = await db.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return n || 0;
}

const from = await catalog(source);
const to = await catalog(target);
const tables = [...from.keys()].filter((name) => name.startsWith('tx_'))
  .sort((a, b) => (FIRST.indexOf(a) + 1 || 99) - (FIRST.indexOf(b) + 1 || 99) || a.localeCompare(b));
const missing = tables.filter((name) => !to.has(name));
if (missing.length) throw new Error(`create these tables in MX first: ${missing.join(', ')}`);

let bad = 0;
for (const table of tables) {
  const pk = from.get(table);
  if (!pk.length) throw new Error(`${table} has no primary key`);
  const total = await count(tx, table);
  if (dry) {
    console.log(`${table}: TX ${total} rows, MX ${await count(mx, table)} rows (dry run)`);
    continue;
  }
  for (let offset = 0; offset < total; offset += PAGE) {
    let query = tx.from(table).select('*').range(offset, offset + PAGE - 1);
    for (const col of pk) query = query.order(col, { ascending: true });
    const { data, error } = await query;
    if (error) throw new Error(`${table} read: ${error.message}`);
    const { error: writeError } = await mx.from(table).upsert(data, { onConflict: pk.join(',') });
    if (writeError) throw new Error(`${table} write: ${writeError.message}`);
  }
  const copied = await count(mx, table);
  const same = copied === total;
  if (!same) bad += 1;
  console.log(`${same ? 'ok  ' : 'FAIL'} ${table}: TX ${total} -> MX ${copied}`);
}
console.log(dry ? '\ndry run, nothing changed' : bad ? `\n${bad} table(s) differ` : '\nall tables copied');
process.exit(bad ? 1 : 0);
