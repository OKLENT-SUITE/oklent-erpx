// OPS-02 / SEC-04 / T-10: health endpoints, no secrets in the log or in health output.   LOG_FILE=/path/api.log node tests/ops-check.mjs (running API)
import fs from 'node:fs';
const API = process.env.API_URL || 'http://localhost:3100'; let failed = 0;
const ck = (n, ok, x = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  → ' + x}`); };
const j = async (p, o) => { const r = await fetch(API + p, o); return { status: r.status, text: await r.text() }; };
const live = await j('/api/livez'), ready = await j('/api/readyz'), health = await j('/api/health');
ck('livez 200', live.status === 200); ck('readyz 200 and ready:true on a current schema', ready.status === 200 && JSON.parse(ready.text).ready === true, ready.text);
ck('health/readyz expose only ok/version/db/schema flags (no config, no secrets)', Object.keys(JSON.parse(health.text)).every(k => ['ok', 'version', 'db', 'schema'].includes(k)) && !/postgres:|secret|password|jwt/i.test(health.text + ready.text));
const PW = 'Zz9-Unique-Probe-Password-' + Date.now(), USER = 'probe_user_' + Date.now();
await j('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: USER, password: PW }) });
const ok = await j('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_PASSWORD || 'ChangeMe!2026' }) });
const token = JSON.parse(ok.text).token; await j('/api/me', { headers: { authorization: 'Bearer ' + token } });
await j('/api/employees', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ name_ar: 'سري', national_id: '1099887766', iban: 'SA0380000000608010167519', basic_salary: 'bad' }) });
for (const [path, label] of [['/api/journal?limit=5', 'journal'], ['/api/invoices?limit=5', 'invoices']]) {
  const r = await fetch(API + path, { headers: { authorization: 'Bearer ' + token } }), rows = await r.json(), tot = Number(r.headers.get('x-total-count'));
  ck(`counter: ${label} sends X-Total-Count >= rows shown (shown-total format, e.g. ${rows.length}-${tot})`, r.status === 200 && Number.isInteger(tot) && tot >= rows.length && rows.length <= 5, `${r.status} ${tot}`);
}
await new Promise(r => setTimeout(r, 300));
if (process.env.LOG_FILE) { const log = fs.readFileSync(process.env.LOG_FILE, 'utf8');
  ck('log never contains the submitted password', !log.includes(PW));
  ck('log never contains the admin password or the JWT secret', !log.includes(process.env.ADMIN_PASSWORD || 'ChangeMe!2026') && !log.includes(process.env.JWT_SECRET || 'dev-only-change-me'));
  ck('log never contains a bearer token', !log.includes(token) && !/authorization/i.test(log));
  ck('log never contains request bodies (national id / IBAN)', !log.includes('1099887766') && !log.includes('SA0380000000608010167519')); }
else console.log('SKIPPED log checks (LOG_FILE not set)');
console.log(failed ? `\n${failed} FAILED` : '\nALL OPS CHECKS PASSED'); process.exit(failed ? 1 : 0);
