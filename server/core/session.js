import crypto from 'node:crypto';

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function readSession(token) {
  if (!token || !process.env.SESSION_SECRET) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const data = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (!data?.employeeId || !data.exp || data.exp < Date.now()) return null;
  return data;
}

export function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setSession(res, employeeId) {
  const token = employeeId
    ? sign({ employeeId, exp: Date.now() + SESSION_MS })
    : '';
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `smf_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${employeeId ? SESSION_MS / 1000 : 0}${secure}`);
}
