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

export function qtyOf(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000) / 1000;
}

export function amountOf(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1000) / 1000;
}

export function cleanTerm(value) {
  return String(value || '').trim().replace(/[%_,]/g, '').slice(0, 40);
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
