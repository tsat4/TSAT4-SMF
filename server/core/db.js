import { createClient } from '@supabase/supabase-js';

function db(url, key) {
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// mx = Mx Data: shared master (mt_main_*) and the work system (mt_sto_*, tx_sto_*, later other units ...).
// tx = Tx Data: the activity system, tables named per activity (mt_5s_*, tx_5s_*, ...). See docs/ARCHITECTURE.md.
export const mx = db(process.env.MX_SUPABASE_URL, process.env.MX_SUPABASE_SECRET_KEY);
export const tx = db(process.env.TX_SUPABASE_URL, process.env.TX_SUPABASE_SECRET_KEY);

export function dbReady() {
  return Boolean(mx && tx && process.env.SESSION_SECRET);
}
