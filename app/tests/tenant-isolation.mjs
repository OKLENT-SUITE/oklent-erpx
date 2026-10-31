// Multi-tenant + 2FA INTEGRATION test. Needs: PostgreSQL initialised (db/init), OWNER_DATABASE_URL, and the API running with MULTI_TENANT=1
// (and TENANT_CACHE_TTL_MS=1000 so suspensions show up quickly). scripts/test-all.sh starts everything for you.
//   API_URL=http://localhost:3198 OWNER_DATABASE_URL=... ADMIN_PASSWORD=... node tests/tenant-isolation.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOTP = await import(pathToFileURL(path.join(root, 'api/src/totp.js')).href);
const API = process.env.API_URL || 'http://localhost:3198', OWNER = process.env.OWNER_DATABASE_URL;
if (!OWNER) { console.log('FAIL OWNER_DATABASE_URL is required'); process.exit(1); }
let failed = 0; const chk = (n, ok, x = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : '  → ' + x}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cli = (...a) => spawnSync('node', ['api/src/tenant-cli.js', ...a], { cwd: root, env: { ...process.env, OWNER_DATABASE_URL: OWNER, ERPX_ROOT: root }, encoding: 'utf8' });
const call = async (method, p, { token, tenant, body } = {}) => { const r = await fetch(API + '/api' + p, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }), ...(tenant && { 'x-tenant': tenant }) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const sfx = Math.random().toString(36).slice(2, 6), A = 'isoa' + sfx, B = 'isob' + sfx, PA = 'Alpha-Strong-Pass-1', PB = 'Bravo-Strong-Pass-2';

const ca = cli('create', '--slug', A, '--name', 'Company A', '--admin-password', PA), cb = cli('create', '--slug', B, '--name', 'Company B', '--admin-password', PB);
chk('tenant-cli: creates company A and B (full schema each)', ca.status === 0 && cb.status === 0, (ca.stderr + ca.stdout + cb.stderr + cb.stdout).slice(0, 300));
chk('tenant-cli: a duplicate slug is refused', cli('create', '--slug', A, '--name', 'dup', '--admin-password', PA).status !== 0);
chk('tenant-cli: verify says both schemas are complete', cli('verify', '--slug', A).status === 0 && cli('verify', '--slug', B).status === 0);
chk('tenant-cli: a weak admin password is refused', cli('create', '--slug', 'weak' + sfx, '--name', 'W', '--admin-password', 'short').status !== 0);

const cfg = (await call('GET', '/config')).body; chk('config: multi-tenant is ON', cfg.multiTenant === true, JSON.stringify(cfg));
const la = await call('POST', '/auth/login', { tenant: A, body: { username: 'admin', password: PA } }), lb = await call('POST', '/auth/login', { tenant: B, body: { username: 'admin', password: PB } });
chk('login: each company signs in with its own admin', la.status === 200 && lb.status === 200 && la.body.tenant?.slug === A && lb.body.tenant?.slug === B, JSON.stringify([la.status, lb.status, la.body]).slice(0, 200));
chk('login: company A\'s password does NOT open company B', (await call('POST', '/auth/login', { tenant: B, body: { username: 'admin', password: PA } })).status === 401);
chk('login: unknown company -> 404 (never falls back to another company)', (await call('POST', '/auth/login', { tenant: 'nope' + sfx, body: { username: 'admin', password: PA } })).status === 404);
chk('login: the legacy single company still signs in without a tenant (default tenant)', (await call('POST', '/auth/login', { body: { username: 'admin', password: process.env.ADMIN_PASSWORD || 'ChangeMe!2026' } })).status === 200);
const ta = la.body.token, tb = lb.body.token;

// data isolation
const pa = await call('POST', '/partners', { token: ta, body: { kind: 'customer', name_ar: 'ISO-ONLY-IN-A-' + sfx } });
chk('data: company A creates a customer', pa.status === 200 || pa.status === 201, JSON.stringify(pa.body).slice(0, 150));
const listB = await call('GET', '/partners', { token: tb }), listA = await call('GET', '/partners', { token: ta });
chk('data: company B does NOT see company A\'s customer', !JSON.stringify(listB.body).includes('ISO-ONLY-IN-A-') && JSON.stringify(listA.body).includes('ISO-ONLY-IN-A-'));
chk('data: a token cannot be redirected to another company with X-Tenant (the signed token decides)', !JSON.stringify((await call('GET', '/partners', { token: ta, tenant: B })).body).includes('ISO-ONLY-IN-B') && JSON.stringify((await call('GET', '/partners', { token: ta, tenant: B })).body).includes('ISO-ONLY-IN-A-'));
chk('data: company names are separate', (await call('GET', '/company', { token: ta })).body.name_ar === 'Company A' && (await call('GET', '/company', { token: tb })).body.name_ar === 'Company B');
chk('data: each company has its own independent ledger chain', (await call('GET', '/reports/chain-verify', { token: ta })).status === 200 && (await call('GET', '/reports/chain-verify', { token: tb })).status === 200);
chk('data: the same account code exists in both companies independently', (await call('GET', '/accounts', { token: ta })).body.length > 10 && (await call('GET', '/accounts', { token: tb })).body.length === (await call('GET', '/accounts', { token: ta })).body.length);
chk('data: no token -> 401', (await call('GET', '/partners', { tenant: A })).status === 401);
chk('data: a forged token for a non-existent company id is refused', (await call('GET', '/partners', { token: ta.split('.')[0] + '.' + Buffer.from(JSON.stringify({ id: 1, username: 'admin', role: 'admin', tid: 99999 })).toString('base64url') + '.' + ta.split('.')[2] })).status === 401);

// suspension
cli('suspend', '--slug', B, '--reason', 'test'); await sleep(1600);
chk('suspend: company B\'s existing token stops working', (await call('GET', '/partners', { token: tb })).status === 403);
chk('suspend: company B cannot sign in', (await call('POST', '/auth/login', { tenant: B, body: { username: 'admin', password: PB } })).status === 403);
chk('suspend: company A is unaffected', (await call('GET', '/partners', { token: ta })).status === 200);
cli('resume', '--slug', B); await sleep(1600);
chk('resume: company B works again', (await call('GET', '/partners', { token: tb })).status === 200);

// 2FA
const e0 = await call('GET', '/auth/2fa', { token: ta }); chk('2fa: starts disabled', e0.body.enabled === false);
const su = await call('POST', '/auth/2fa/setup', { token: ta }); chk('2fa: setup returns a secret, otpauth URI and QR', /^[A-Z2-7]{32}$/.test(su.body.secret || '') && /^otpauth:\/\/totp\//.test(su.body.otpauth_uri || '') && /<svg/.test(su.body.qr_svg || ''), JSON.stringify(su.body).slice(0, 120));
chk('2fa: a wrong confirmation code is refused', (await call('POST', '/auth/2fa/confirm', { token: ta, body: { code: '000000' } })).status === 422);
let nowStep = TOTP.stepOf(); const cf = await call('POST', '/auth/2fa/confirm', { token: ta, body: { code: TOTP.totp(su.body.secret) } });
chk('2fa: confirmation enables it and returns 10 recovery codes once', cf.status === 200 && cf.body.recovery_codes?.length === 10 && cf.body.enabled === true, JSON.stringify(cf.body).slice(0, 150));
const l2 = await call('POST', '/auth/login', { tenant: A, body: { username: 'admin', password: PA } });
chk('2fa: password alone no longer gives a session (mfa_required, no token)', l2.body.mfa_required === true && !l2.body.token && !!l2.body.mfa_token);
chk('2fa: the half-login token is not a session', (await call('GET', '/me', { token: l2.body.mfa_token })).status === 401);
chk('2fa: wrong code refused', (await call('POST', '/auth/mfa', { body: { mfa_token: l2.body.mfa_token, code: '123456' } })).status === 401);
// the code used for confirmation is burned: wait for the next 30 s window, then it must work exactly once
const wait = 30000 - (Date.now() % 30000) + 300; await sleep(wait);
const good = TOTP.totp(su.body.secret); const m1 = await call('POST', '/auth/mfa', { body: { mfa_token: l2.body.mfa_token, code: good } });
chk('2fa: the right code gives a session', m1.status === 200 && !!m1.body.token && m1.body.tenant?.slug === A, JSON.stringify(m1.body).slice(0, 150));
const l3 = await call('POST', '/auth/login', { tenant: A, body: { username: 'admin', password: PA } });
chk('2fa: the SAME code cannot be replayed', (await call('POST', '/auth/mfa', { body: { mfa_token: l3.body.mfa_token, code: good } })).status === 401);
const rc = cf.body.recovery_codes[0], m2 = await call('POST', '/auth/mfa', { body: { mfa_token: l3.body.mfa_token, code: rc } });
chk('2fa: a recovery code works once', m2.status === 200 && !!m2.body.token);
const l4 = await call('POST', '/auth/login', { tenant: A, body: { username: 'admin', password: PA } });
chk('2fa: ...and only once', (await call('POST', '/auth/mfa', { body: { mfa_token: l4.body.mfa_token, code: rc } })).status === 401);
chk('2fa: company B\'s admin is not affected by A\'s 2FA', (await call('POST', '/auth/login', { tenant: B, body: { username: 'admin', password: PB } })).body.token !== undefined);
const adm = m2.body.token;
chk('2fa: admin can list who is protected and reset', (await call('GET', '/users/2fa-status', { token: adm })).body.some(u => u.username === 'admin' && u.totp_enabled === true));
// enrolment policy
await call('PUT', '/security-settings', { token: adm, body: { mfa_required_roles: ['accountant'] } });
await call('POST', '/users', { token: adm, body: { username: 'acct1', password: 'Accountant-Pass-77', role: 'accountant', full_name: 'Acct' } });
const lc = await call('POST', '/auth/login', { tenant: A, body: { username: 'acct1', password: 'Accountant-Pass-77' } });
chk('policy: a required role without 2FA gets an enrol-only session', lc.body.must_enroll_2fa === true && !!lc.body.token);
chk('policy: that session cannot use the system yet (403)', (await call('GET', '/partners', { token: lc.body.token })).status === 403);
chk('policy: ...but can reach the 2FA setup', (await call('GET', '/auth/2fa', { token: lc.body.token })).status === 200);

console.log(`\ncompanies used: ${A}, ${B} (drop with: DROP SCHEMA t_${A} CASCADE, t_${B} CASCADE)`);
console.log(failed ? `\n${failed} FAILED` : '\nALL TENANT + 2FA INTEGRATION CHECKS PASSED'); process.exit(failed ? 1 : 0);
