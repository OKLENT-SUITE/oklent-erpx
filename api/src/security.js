// Security helpers (no dependencies). https://oklent.net/

// Content-Security-Policy for everything the browser loads from this app. deploy/nginx/security-headers.conf must carry the SAME string
// (tests/security-unit.mjs fails if they drift). No inline <script> exists anywhere: scripts are same-origin files only.
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

const WEAK = /(change[-_ ]?me|dev[-_]only|erpx_app_dev|owner_dev|^password|^secret|12345)/i;

/** In production the API must not start with default or weak secrets. Throws one clear message listing every problem. */
export function assertProductionSecrets(env) {
  if (env.NODE_ENV !== 'production') return;
  const problems = [];
  const jwt = env.JWT_SECRET || '';
  if (jwt.length < 32 || WEAK.test(jwt)) problems.push('JWT_SECRET must be a random string of at least 32 characters (not a default / "change-me" value)');
  let pw = ''; try { pw = decodeURIComponent(new URL(env.DATABASE_URL || '').password); } catch { /* handled below */ }
  if (!env.DATABASE_URL) problems.push('DATABASE_URL must be set');
  else if (pw.length < 12 || WEAK.test(pw)) problems.push('the database password inside DATABASE_URL (APP_DB_PASSWORD) must be at least 12 characters and not a default / "change-me" value');
  if (problems.length) throw new Error('Refusing to start in production: ' + problems.join('; ') + '. Edit .env and restart.');
}

/** Failed-login throttle (per process). Per (ip + username): LOGIN_MAX_FAILS in 15 min; per ip across usernames: 10x that. A success clears the counter. */
export function loginGuard({ max = Number(process.env.LOGIN_MAX_FAILS || 8), windowMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  const hits = new Map();   // key -> array of failure timestamps
  const keyU = (ip, u) => 'u:' + ip + '|' + String(u).toLowerCase().slice(0, 100), keyI = ip => 'i:' + ip;
  const recent = k => { const a = (hits.get(k) || []).filter(t => now() - t < windowMs); hits.set(k, a); return a; };
  const timer = setInterval(() => { for (const k of [...hits.keys()]) if (!recent(k).length) hits.delete(k); }, 5 * 60 * 1000); timer.unref?.();
  const wait = (a, lim) => (a.length >= lim ? Math.max(1, Math.ceil((a[0] + windowMs - now()) / 1000)) : 0);
  return {
    blockedFor: (ip, u) => Math.max(wait(recent(keyU(ip, u)), max), wait(recent(keyI(ip)), max * 10)),
    fail: (ip, u) => { for (const k of [keyU(ip, u), keyI(ip)]) { const a = recent(k); a.push(now()); } },
    ok: (ip, u) => { hits.delete(keyU(ip, u)); }
  };
}
