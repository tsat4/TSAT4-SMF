export function fail(res, status, error) {
  res.status(status).json({ error });
}

export function wrap(fn) {
  const wrapped = (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error(err);
    if (!res.headersSent) fail(res, 500, 'ระบบขัดข้อง');
  });
  wrapped.need = fn.need;
  return wrapped;
}

// Store quantities are whole numbers (ผู้ใช้กำหนด 2026-10-27): 1, 2, 3 … no decimals.
export function qtyOf(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function amountOf(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1000) / 1000;
}

// Search text for ilike / PostgREST or(): drop wildcards (% _ *) and the characters that break or() syntax (, ( ) " \).
export function cleanTerm(value) {
  return String(value || '').trim().replace(/[%_*,()"\\]/g, '').slice(0, 40);
}

// Column filter + A–Z sort for paged tables. `fields` maps an allowed column to 'text' or 'num'.
export function listFilters(req) {
  try {
    const raw = JSON.parse(String(req.query.filters || '').slice(0, 500) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw;
  } catch {
    return {};
  }
}

export function applyListQuery(query, req, fields, fallback) {
  const filters = listFilters(req);
  for (const [key, value] of Object.entries(filters)) {
    const kind = fields[key];
    const term = cleanTerm(value);
    if (!kind || !term) continue;
    if (kind === 'num') {
      const n = Number(term);
      if (Number.isFinite(n)) query = query.eq(key, n);
    } else query = query.ilike(key, `%${term}%`);
  }
  const sort = fields[req.query.sort] ? req.query.sort : fallback;
  const ascending = req.query.sort ? req.query.dir !== 'desc' : true;
  return query.order(sort, { ascending, nullsFirst: false });
}

export function adminWriteError(error, fallback) {
  const code = error?.code;
  const message = String(error?.message || '');
  if (code === '23505') return 'ข้อมูลนี้มีอยู่แล้ว';
  if (code === '23503') return fallback.includes('ลบ') ? 'แถวนี้ถูกใช้อยู่ ลบไม่ได้' : 'ค่านี้ขัดกับตารางที่เชื่อมอยู่';
  if (message.includes('cannot change employee')) return 'เปลี่ยนรหัสพนักงานไม่ได้';
  if (message.includes('must be Active')) return 'สถานะที่เชื่อมอยู่ต้องเป็น Active';
  return fallback;
}
