// Security helpers (no dependencies). https://oklent.net/

// Content-Security-Policy for everything the browser loads from this app. deploy/nginx/security-headers.conf must carry the SAME string
// (tests/security-unit.mjs fails if they drift). No inline <script> exists anywhere: scripts are same-origin files only.
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

const WEAK = /(change[-_ ]?me|dev[-_]only|erpx_app_dev|owner_dev|^password|^secret|12345|admin123|qwerty)/i;
const DEFAULT_ADMIN = 'ChangeMe!2026';

/** Pure checks shared by the API start-up guard and the deployment .env preflight (api/src/config-check-cli.js). Returns a list of problems. */
export function secretProblems(name, v, { min = 12, distinct = 6 } = {}) {
  const out = [];
  if (!v) return [`${name} is missing`];
  if (v.length < min) out.push(`${name} must be at least ${min} characters`);
  if (WEAK.test(v) || v === DEFAULT_ADMIN) out.push(`${name} is a default / weak value (change-me, dev-only, password, 12345, ...)`);
  if (new Set(v).size < distinct) out.push(`${name} has too little variety (looks like a repeated or trivial value)`);
  return out;
}

/** In production the API must not start with default or weak secrets. Throws one clear message listing every problem (secret VALUES are never printed). */
export function assertProductionSecrets(env) {
  if (env.NODE_ENV !== 'production') return;
  const problems = [];
  problems.push(...secretProblems('JWT_SECRET', env.JWT_SECRET || '', { min: 32, distinct: 10 }));
  let pw = '', dbUser = '';
  try { const u = new URL(env.DATABASE_URL || ''); pw = decodeURIComponent(u.password); dbUser = decodeURIComponent(u.username); } catch { /* handled below */ }
  if (!env.DATABASE_URL) problems.push('DATABASE_URL must be set');
  else {
    problems.push(...secretProblems('the database password inside DATABASE_URL (APP_DB_PASSWORD)', pw, { min: 12 }));
    if (/^(erpx_owner|postgres)$/i.test(dbUser)) problems.push('DATABASE_URL must use the least-privilege role erpx_app, never the owner / postgres superuser');
    if (pw && pw === env.JWT_SECRET) problems.push('the database password and JWT_SECRET must be different values');
  }
  if (env.OWNER_DATABASE_URL) problems.push('OWNER_DATABASE_URL must NOT be present in the api process (the owner credential belongs only to the one-shot migrate service)');
  if (env.PUBLIC_RATE_LIMIT_MAX) problems.push('PUBLIC_RATE_LIMIT_MAX is a test-only switch and must not be set in production');
  if (env.ADMIN_PASSWORD && (env.ADMIN_PASSWORD === DEFAULT_ADMIN || WEAK.test(env.ADMIN_PASSWORD))) problems.push('ADMIN_PASSWORD is a default / weak value');
  if (problems.length) throw new Error('Refusing to start in production: ' + problems.join('; ') + '. Edit .env and restart.');
}

/** Deployment preflight over the compose .env (called by config-check-cli.js): every credential strong, distinct, non-default; production mode. */
export function validateDeployEnv(env) {
  const p = [];
  if (env.NODE_ENV !== 'production') p.push('NODE_ENV must be "production"');
  p.push(...secretProblems('JWT_SECRET', env.JWT_SECRET, { min: 32, distinct: 10 }));
  for (const k of ['OWNER_DB_PASSWORD', 'APP_DB_PASSWORD', 'ADMIN_PASSWORD']) p.push(...secretProblems(k, env[k], { min: 12 }));
  const vals = ['JWT_SECRET', 'OWNER_DB_PASSWORD', 'APP_DB_PASSWORD', 'ADMIN_PASSWORD'].map(k => env[k]).filter(Boolean);
  if (new Set(vals).size !== vals.length) p.push('JWT_SECRET, OWNER_DB_PASSWORD, APP_DB_PASSWORD and ADMIN_PASSWORD must all be DIFFERENT values');
  if (env.PUBLIC_RATE_LIMIT_MAX) p.push('PUBLIC_RATE_LIMIT_MAX must not be set (test-only)');
  return p;
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
