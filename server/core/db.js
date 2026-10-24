import { createClient } from '@supabase/supabase-js';

function db(url, key) {
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// mx = master data (mt_*), tx = transactions (tx_*). Both are separate Supabase projects.
export const mx = db(process.env.MX_SUPABASE_URL, process.env.MX_SUPABASE_SECRET_KEY);
export const tx = db(process.env.TX_SUPABASE_URL, process.env.TX_SUPABASE_SECRET_KEY);

export function dbReady() {
  return Boolean(mx && tx && process.env.SESSION_SECRET);
}
