import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import fstatic from '@fastify/static';
import QRCode from 'qrcode';
import { readFile, readdir } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, tx, qPlatform, setExtSchema } from './db.js';
import { als, isMultiTenant, tenantRegistry, resolveCandidate, assertUsable } from './tenancy.js';
import * as TOTP from './totp.js';
import { issueInvoice, httpErr } from './invoicing.js';
import { RULES } from './rules-catalog.js';
import { registerCommerce } from './routes-commerce.js';
import { idempotent } from './idempotency.js';
import { registerHR } from './routes-hr.js';
import { registerAI } from './routes-ai.js';
import { loadMenuCatalog } from './menu-catalog.js';
import { riyadhToday } from './dates.js';

import { bootstrapStores } from './site-defaults.js';
import { renderMarkdown } from './docs-render.js';
import { CSP, assertProductionSecrets, loginGuard, passwordProblems, passwordPolicyOn } from './security.js';
import { SCHEMA_EXPECTED } from './migrate.js';
import { uploadRoot, MAX_IMAGE_BYTES, IMAGE_MIMES } from './uploads.js';
import { renderInvoiceHtml } from './invoice-print.js';
import { APP_VERSION } from './version.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ERPX_ROOT || path.resolve(__dir, '../..');
const RANK = { viewer: 1, cashier: 2, accountant: 3, admin: 4 };
const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' }, bodyLimit: 1_000_000, trustProxy: process.env.TRUST_PROXY === 'true' });   // TRUST_PROXY=true only behind the bundled nginx (it overwrites X-Forwarded-For)

const secret = process.env.JWT_SECRET || 'dev-only-change-me';
assertProductionSecrets(process.env);   // production refuses to start with default / weak JWT secret or DB password
await app.register(jwt, { secret, sign: { expiresIn: '12h' } });
await app.register(fstatic, { root: path.join(ROOT, 'web'), prefix: '/', dotfiles: 'allow', cacheControl: false, setHeaders: reply => reply.header('Cache-Control', 'no-cache') });   // @fastify/static >= 10 passes the Fastify reply (not the raw response)   // always revalidate: no stale JS after an upgrade

// ---- product images: persistent folder (docker volume erpx_uploads -> /app/uploads). Files are random-UUID names; only images are served. ----
const UPLOAD_DIR = uploadRoot(ROOT);
try { mkdirSync(path.join(UPLOAD_DIR, 'products'), { recursive: true }); } catch (e) { throw new Error(`cannot create the uploads folder ${UPLOAD_DIR} (${e.message}) — mount a writable volume there`); }
await app.register(fstatic, { root: UPLOAD_DIR, prefix: '/uploads/', decorateReply: false, dotfiles: 'deny', index: false, list: false, cacheControl: false,
  setHeaders: reply => { reply.header('Cache-Control', 'public, max-age=31536000, immutable'); reply.header('Content-Security-Policy', "default-src 'none'; sandbox"); reply.header('X-Content-Type-Options', 'nosniff'); } });   // names never change (UUID), so they can be cached for a year
// raw image bodies for POST /api/products/:id/image (JPEG/PNG/WebP only, hard size cap; the route re-checks the real bytes)
app.addContentTypeParser(IMAGE_MIMES, { parseAs: 'buffer', bodyLimit: MAX_IMAGE_BYTES }, (req, body, done) => done(null, body));

// Security headers on everything the API itself sends (nginx adds the same set to the static files it serves).
app.addHook('onSend', async (req, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff'); reply.header('X-Frame-Options', 'DENY'); reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  const ct = String(reply.getHeader('content-type') || '');
  if (ct.startsWith('text/html')) reply.header('Content-Security-Policy', CSP);
  if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');   // financial data is never cached by browsers or proxies
  return payload;
});

// ---- multi-tenant (MULTI_TENANT=1): one PostgreSQL schema per company; see docs/MULTITENANT.md ----
// Off by default: the app then behaves exactly like the single-company releases. When on, q()/tx() FAIL CLOSED without a tenant in context.
const MT = isMultiTenant();
const PLATFORM_CTX = { id: 0, slug: 'platform', name: 'platform', schema_name: 'public', status: 'active' };   // health checks only: reads the default schema's version marker
const registry = tenantRegistry({ load: async () => (await qPlatform('SELECT id, slug, name, schema_name, status, is_default, custom_domain, max_users, plan, provisioned_version FROM platform.tenants')).rows });
const store = () => als.getStore();
const usable = t => { try { return assertUsable(t); } catch (e) { throw httpErr(e.statusCode || 403, e.message); } };
app.addHook('onRequest', (req, reply, done) => { als.run({ tenant: null, locked: false }, done); });   // one context per request (AsyncLocalStorage)
app.addHook('preHandler', async req => {
  if (!MT) return;
  const st = store(); if (!st || st.locked) return;                       // a signed-in request already pinned its tenant from the verified token
  if (/^\/api\/(health|readyz|livez)(\?|$)/.test(req.url)) { st.tenant = PLATFORM_CTX; return; }
  if (!/^\/api\//.test(req.url) || /^\/api\/(config|docs)/.test(req.url) || req.headers.authorization) return;     // signed-in calls are resolved by auth(); static files need no tenant
  const t = await resolveCandidate(registry, { host: req.headers.host, header: req.headers['x-tenant'], body: req.body?.tenant });
  if (/^\/api\/(public\/|auth\/(?!mfa))/.test(req.url)) st.tenant = usable(t);   // (auth/mfa takes its company from the signed step-1 token instead)     // login and the public storefront must name an ACTIVE company
  else st.tenant = t;
});

const SAFE_DB_MSG = { '23505': 'a record with the same unique value already exists', '23503': 'a referenced record does not exist or is still in use', '23502': 'a required value is missing', '23514': 'a value is outside the allowed range', '22': 'a value has an invalid format' };
// PostgreSQL errors carry our stable ERPX-xxxx codes: surface them as 422 so clients can show the rule that fired.
app.setErrorHandler((err, req, reply) => {
  const m = /^(ERPX-[A-Z]\d{3}):/.exec(err.message || '');
  if (m) return reply.code(422).send({ error: err.message, rule: m[1] });
  if (err.code && /^(23|22|P0)/.test(String(err.code))) {
    // API-01: never leak table / constraint / column names or raw SQL text to the client; the full error stays in the server log.
    if (!/^P0/.test(String(err.code))) { req.log.warn({ err: err.message, code: err.code, constraint: err.constraint }, 'database constraint rejected a request'); return reply.code(422).send({ error: SAFE_DB_MSG[String(err.code).slice(0, 5)] || SAFE_DB_MSG[String(err.code).slice(0, 2)] || 'invalid data', code: err.code }); }
    return reply.code(422).send({ error: err.message, code: err.code });   // P0xxx = RAISE EXCEPTION written by us (stable rule text)
  }
  // 42P01 undefined table / 42703 undefined column / 42883 undefined function: the database is older than this code -> say so (503), do not hide it behind a bare 500.
  if (['42P01', '42703', '42883'].includes(String(err.code))) { req.log.error({ err: err.message }, 'DATABASE SCHEMA OUTDATED'); return reply.code(503).send({ error: 'قاعدة البيانات أقدم من إصدار التطبيق (' + err.message + '). أعد تشغيل الخدمة ليُرقّيها تلقائياً: docker compose up -d --build', code: 'SCHEMA_OUTDATED' }); }
  if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
  req.log.error(err); reply.code(500).send({ error: 'internal error' });
});

const ENROLL_OK = /^\/api\/(me|auth\/2fa)/;   // a token that must still enrol 2FA may only reach these
const auth = min => async req => {
  try { await req.jwtVerify(); } catch { throw httpErr(401, 'login required'); }
  if (req.user.mfa) throw httpErr(401, 'login required');                  // the short-lived "password OK, code pending" token is NOT a session
  if (MT) {                                                                // the tenant comes from the SIGNED token, never from Host / headers
    const t = req.user.tid != null ? await registry.byId(req.user.tid) : await registry.defaultTenant();   // tokens issued before multi-tenancy belong to the single original company
    const st = store(); if (st) { st.tenant = usable(t); st.locked = true; }
  }
  if (RANK[req.user.role] < RANK[min]) throw httpErr(403, `role ${min} required`);
  if (req.user.enroll && !ENROLL_OK.test(req.url)) throw httpErr(403, 'two-factor setup required before using the system');
};
const route = (method, url, min, handler) => app.route({ method, url, preHandler: min ? auth(min) : undefined, handler, logLevel: url === '/api/health' ? 'warn' : undefined });   // health checks every 5s must not flood the log
const dateOr = (v, d) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : d);
const today = () => riyadhToday();
const yearStart = async () => {
  const { rows:[r] }=await q("SELECT coalesce((value->>'fiscal_start_month')::int,1) AS fiscal_month FROM app_settings WHERE key='account_profile'");
  const now=today(), month=Math.min(Math.max(Number(r?.fiscal_month)||1,1),12), year=Number(now.slice(0,4));
  return `${year}-${String(month).padStart(2,'0')}-01` > now ? `${year-1}-${String(month).padStart(2,'0')}-01` : `${year}-${String(month).padStart(2,'0')}-01`;
};

// ---- auth ----
const guardLogin = loginGuard();
const tenantKey = u => (MT && store()?.tenant ? store().tenant.slug + ':' : '') + u;       // throttle per company + user: one company's typos never lock another
const sign = (u, extra = {}) => app.jwt.sign({ id: u.id, username: u.username, role: u.role, ...(MT && store()?.tenant ? { tid: store().tenant.id } : {}), ...extra });
const secPolicy = async () => { try { const { rows: [r] } = await q("SELECT value FROM app_settings WHERE key='security'"); return r?.value || {}; } catch { return {}; } };
const sessionFor = async u => {                                                   // password verified (and 2FA verified when enabled): build the real session
  const st = (await q('SELECT * FROM totp_state($1)', [u.username])).rows[0];
  const need = ((await secPolicy()).mfa_required_roles || []).includes(u.role) && !st?.enabled;
  return { token: sign(u, need ? { enroll: true } : {}), user: u, ...(need ? { must_enroll_2fa: true } : {}), ...(MT ? { tenant: { slug: store().tenant.slug, name: store().tenant.name } } : {}) };
};
route('GET', '/api/config', null, async () => ({ multiTenant: MT, tenantFromHost: Boolean(process.env.TENANT_BASE_DOMAIN), requireExplicitTenant: /^(1|true|yes)$/i.test(process.env.TENANT_REQUIRE_EXPLICIT || ''), version: APP_VERSION }));
route('POST', '/api/auth/login', null, async (req, reply) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || username.length > 100 || password.length > 200) throw httpErr(400, 'username and password are required');
  const gk = tenantKey(username);
  const wait = guardLogin.blockedFor(req.ip, gk);
  if (wait) { reply.header('Retry-After', String(wait)); throw httpErr(429, 'too many failed sign-in attempts; try again later'); }
  const { rows: [u] } = await q('SELECT * FROM login_user($1,$2)', [username, password]);
  if (!u) { guardLogin.fail(req.ip, gk); await new Promise(r => setTimeout(r, 400)); throw httpErr(401, 'invalid credentials'); }
  const st = (await q('SELECT * FROM totp_state($1)', [u.username])).rows[0];
  if (st?.enabled) return { mfa_required: true, mfa_token: app.jwt.sign({ mfa: true, id: u.id, username: u.username, ...(MT ? { tid: store().tenant.id } : {}) }, { expiresIn: '5m' }) };   // password alone is NOT enough: no session yet
  guardLogin.ok(req.ip, gk);
  return sessionFor(u);
});
// step 2 of a 2FA login: authenticator code (or one single-use recovery code) + the 5-minute mfa_token from step 1
route('POST', '/api/auth/mfa', null, async (req, reply) => {
  const { mfa_token: mt, code } = req.body || {};
  let p; try { p = app.jwt.verify(String(mt || '')); } catch { throw httpErr(401, 'the sign-in step expired; enter your password again'); }
  if (!p.mfa) throw httpErr(401, 'invalid sign-in step');
  if (MT) { const t = usable(await registry.byId(p.tid)); const stx = store(); stx.tenant = t; stx.locked = true; }
  const gk = tenantKey(p.username);
  const wait = guardLogin.blockedFor(req.ip, gk);
  if (wait) { reply.header('Retry-After', String(wait)); throw httpErr(429, 'too many failed attempts; try again later'); }
  const { rows: [st] } = await q('SELECT * FROM totp_state($1)', [p.username]);
  const bad = async () => { guardLogin.fail(req.ip, gk); await new Promise(r => setTimeout(r, 400)); throw httpErr(401, 'invalid code'); };
  if (!st?.enabled) return bad();
  let okAuth = false;
  if (TOTP.looksLikeRecovery(code)) okAuth = (await tx(p.username, async c => (await c.query('SELECT totp_use_recovery($1,$2) ok', [p.username, TOTP.hashRecovery(code)])).rows[0].ok));
  else {
    const step = TOTP.verifyTotp(TOTP.openSecret(st.secret_enc), code, { lastStep: st.last_step });
    if (step !== null) okAuth = (await q('SELECT totp_advance($1,$2) ok', [p.username, step])).rows[0].ok;   // atomic: the same code can never be used twice
  }
  if (!okAuth) return bad();
  guardLogin.ok(req.ip, gk);
  const { rows: [u] } = await q('SELECT id, username, full_name, role FROM users WHERE username=$1 AND is_active', [p.username]);
  if (!u) return bad();
  return sessionFor(u);
});
route('GET', '/api/me', 'viewer', async req => ({ ...req.user, ...(MT && store()?.tenant ? { tenant: { slug: store().tenant.slug, name: store().tenant.name } } : {}) }));

// ---- 2FA self-service ----
const needCode = (b) => { if (!/^\d{6}$/.test(String(b?.code || '').replace(/\s/g, ''))) throw httpErr(400, 'enter the 6-digit code from your authenticator app'); return String(b.code).replace(/\s/g, ''); };
route('GET', '/api/auth/2fa', 'viewer', async req => {
  const { rows: [st] } = await q('SELECT * FROM totp_state($1)', [req.user.username]);
  return { enabled: Boolean(st?.enabled), pending: Boolean(st?.pending), recovery_left: st?.recovery_left || 0, required: ((await secPolicy()).mfa_required_roles || []).includes(req.user.role) };
});
route('POST', '/api/auth/2fa/setup', 'viewer', async req => {
  const { rows: [st] } = await q('SELECT * FROM totp_state($1)', [req.user.username]);
  if (st?.enabled) throw httpErr(409, 'two-factor is already enabled; disable it first to enrol a new device');
  const secret = TOTP.newSecret();
  const ok = (await tx(req.user.username, async c => (await c.query('SELECT totp_begin($1,$2) ok', [req.user.username, TOTP.sealSecret(secret)])).rows[0].ok));
  if (!ok) throw httpErr(409, 'could not start enrolment');
  const account = (MT && store()?.tenant ? store().tenant.slug + ':' : '') + req.user.username;
  const uri = TOTP.otpauthUri({ secret, account });
  return { secret, otpauth_uri: uri, qr_svg: await QRCode.toString(uri, { type: 'svg', margin: 1, width: 220 }) };      // shown ONCE; only the encrypted form is stored
});
route('POST', '/api/auth/2fa/confirm', 'viewer', async req => {
  const code = needCode(req.body);
  const { rows: [st] } = await q('SELECT * FROM totp_state($1)', [req.user.username]);
  if (!st?.pending) throw httpErr(409, 'start the setup first');
  const step = TOTP.verifyTotp(TOTP.openSecret(st.secret_enc), code);
  if (step === null) throw httpErr(422, 'the code is wrong or expired; check the phone clock and try again');
  const rec = TOTP.newRecoveryCodes();
  const ok = (await tx(req.user.username, async c => (await c.query('SELECT totp_confirm($1,$2,$3::text[]) ok', [req.user.username, step, rec.hashes])).rows[0].ok));
  if (!ok) throw httpErr(409, 'could not enable two-factor');
  const { rows: [u] } = await q('SELECT id, username, full_name, role FROM users WHERE username=$1', [req.user.username]);
  return { enabled: true, recovery_codes: rec.plain, token: sign(u) };           // codes are shown once; a fresh session token replaces the enrol-only one
});
route('POST', '/api/auth/2fa/disable', 'viewer', async req => {
  const { password } = req.body || {}; const code = needCode(req.body);
  if (typeof password !== 'string' || !password) throw httpErr(400, 'password is required');
  const gk = tenantKey(req.user.username);
  if (guardLogin.blockedFor(req.ip, gk)) throw httpErr(429, 'too many failed attempts; try again later');
  const { rows: [okPw] } = await q('SELECT * FROM login_user($1,$2)', [req.user.username, password]);
  const { rows: [st] } = await q('SELECT * FROM totp_state($1)', [req.user.username]);
  const step = okPw && st?.enabled ? TOTP.verifyTotp(TOTP.openSecret(st.secret_enc), code, { lastStep: st.last_step }) : null;
  if (step === null) { guardLogin.fail(req.ip, gk); throw httpErr(401, 'password or code is wrong'); }
  if (((await secPolicy()).mfa_required_roles || []).includes(req.user.role)) throw httpErr(403, 'your role is required to use two-factor; ask an administrator to change the policy');
  await tx(req.user.username, async c => { await c.query('SELECT totp_disable($1,$2)', [req.user.username, req.user.username]); });
  return { enabled: false };
});
// administrators: who is protected, reset a locked-out user, and the policy (which roles MUST use 2FA)
route('GET', '/api/users/2fa-status', 'admin', async () => (await q('SELECT * FROM users_2fa_status()')).rows);
route('POST', '/api/users/:id/2fa/reset', 'admin', async req => { const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) throw httpErr(400, 'invalid id');
  const ok = await tx(req.user.username, async c => (await c.query('SELECT admin_reset_totp($1,$2) ok', [id, req.user.username])).rows[0].ok); if (!ok) throw httpErr(404, 'user not found'); return { ok: true }; });
route('GET', '/api/security-settings', 'admin', async () => { const v = await secPolicy(); return { mfa_required_roles: v.mfa_required_roles || [], password_policy_enforced: passwordPolicyOn() }; });
route('PUT', '/api/security-settings', 'admin', async req => {
  const roles = req.body?.mfa_required_roles; if (!Array.isArray(roles) || roles.some(r => !Object.hasOwn(RANK, r))) throw httpErr(400, 'mfa_required_roles must be a list of roles');
  const clean = [...new Set(roles)];
  await tx(req.user.username, async c => { await c.query(`INSERT INTO app_settings(key,value,updated_by) VALUES ('security',$1::jsonb,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`, [JSON.stringify({ mfa_required_roles: clean }), req.user.username]); });
  return { mfa_required_roles: clean };
});
const schemaState = async () => { try { const { rows: [r] } = await q("SELECT value->>'version' v FROM app_settings WHERE key='schema'"); return r?.v === SCHEMA_EXPECTED ? 'ok' : 'outdated'; } catch { return 'outdated'; } };
// OPS-02: liveness (process answers; never touches the DB) vs readiness (DB reachable AND schema current -> else 503). Container / load-balancer health checks use /api/readyz.
route('GET', '/api/livez', null, async () => ({ ok: true }));
route('GET', '/api/readyz', null, async (req, reply) => {
  let db = false; try { db = (await q('SELECT 1 ok')).rows[0].ok === 1; } catch { /* reported below */ }
  const schema = db ? await schemaState() : 'unknown';
  let behind = [];
  if (db && MT) { try { behind = (await registry.all()).filter(t => ['active', 'suspended'].includes(t.status) && t.provisioned_version !== SCHEMA_EXPECTED).map(t => t.slug); } catch { behind = ['registry unreadable']; } }
  const okAll = db && schema === 'ok' && !behind.length;
  if (!okAll) reply.code(503);
  return { ready: okAll, db, schema, ...(MT ? { tenants_outdated: behind } : {}) };
});
route('GET', '/api/health', null, async () => ({ ok: true, version: APP_VERSION, db: (await q('SELECT 1 ok')).rows[0].ok === 1, schema: await schemaState() }));

// ---- reference data ----
route('GET', '/api/company', 'viewer', async () => {
  const [{ rows:[company] }, { rows:[settings] }] = await Promise.all([
    q('SELECT * FROM company'), q("SELECT value FROM app_settings WHERE key='account_profile'")
  ]);
  return { ...company, ...(settings?.value || { country_code:'SA', fiscal_start_month:1, logo_data_url:null }) };
});
route('PUT', '/api/company/settings', 'admin', async req => {
  const b=req.body||{};
  const text=(v,max)=>typeof v==='string'&&v.length<=max?v.trim():null;
  const nameAr=text(b.name_ar,200), nameEn=text(b.name_en,200), country=text(b.country_code,2)?.toUpperCase();
  const currency=text(b.base_currency,3)?.toUpperCase(), vat=text(b.vat_number,15)||null;
  const month=Number(b.fiscal_start_month);
  if(!nameAr||!nameEn||!country||!/^[A-Z]{2}$/.test(country)||!currency||!/^[A-Z]{3}$/.test(currency)||!Number.isInteger(month)||month<1||month>12) throw httpErr(400,'بيانات المؤسسة أو العملة أو الدولة أو بداية السنة المالية غير صالحة');
  if(vat&&(country==='SA'?!/^3[0-9]{13}3$/.test(vat):!/^[A-Za-z0-9 ./-]{3,40}$/.test(vat))) throw httpErr(400,country==='SA'?'أدخل رقم ضريبة سعودي صحيحاً من 15 خانة أو اتركه فارغاً':'رقم التسجيل الضريبي غير صالح');
  const logo=b.logo_data_url;
  if(logo!==undefined&&logo!==null&&logo!==''&&(typeof logo!=='string'||logo.length>700000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(logo))) throw httpErr(400,'الشعار يجب أن يكون PNG أو JPG أو WebP وبحجم مناسب');
  const fields={ vat_number:vat, cr_number:text(b.cr_number,40), building_no:text(b.building_no,20), street:text(b.street,200), district:text(b.district,120), city:text(b.city,120), postal_code:text(b.postal_code,20) };
  return tx(req.user.username,async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['company-settings']);
    const {rows:[current]}=await c.query('SELECT base_currency FROM company WHERE id=1 FOR UPDATE');
    if(!current) throw httpErr(409,'بيانات المؤسسة الأساسية غير موجودة');
    if(current.base_currency.trim()!==currency){
      const {rows:[count]}=await c.query('SELECT (SELECT count(*) FROM journal_entries)::int journals,(SELECT count(*) FROM invoices)::int invoices');
      if(count.journals||count.invoices) throw httpErr(409,'لا يمكن تغيير العملة الأساسية بعد وجود قيود أو فواتير؛ استخدم إعداد العملة قبل بدء التسجيل');
      const exists=(await c.query('SELECT 1 FROM currencies WHERE code=$1',[currency])).rowCount;
      if(!exists) throw httpErr(400,'العملة المختارة غير مسجلة في دليل العملات');
      await c.query('UPDATE currencies SET is_base=false WHERE is_base');
      await c.query('UPDATE currencies SET is_base=true WHERE code=$1',[currency]);
    }
    const {rows:[company]}=await c.query(`UPDATE company SET name_ar=$1,name_en=$2,vat_number=$3,cr_number=$4,building_no=$5,street=$6,district=$7,city=$8,postal_code=$9,base_currency=$10 WHERE id=1 RETURNING *`,
      [nameAr,nameEn,fields.vat_number,fields.cr_number,fields.building_no,fields.street,fields.district,fields.city,fields.postal_code,currency]);
    const {rows:[previous]}=await c.query("SELECT value FROM app_settings WHERE key='account_profile'");
    const profile={...(previous?.value||{}),country_code:country,fiscal_start_month:month,logo_data_url:logo===undefined?((previous?.value||{}).logo_data_url||null):(logo||null)};
    await c.query(`INSERT INTO app_settings(key,value,updated_by) VALUES ('account_profile',$1::jsonb,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`,[JSON.stringify(profile),req.user.username]);
    return {...company,...profile};
  });
});
route('GET', '/api/accounts', 'viewer', async () => (await q('SELECT * FROM accounts ORDER BY code')).rows);
route('POST', '/api/accounts', 'accountant', async req => {
  const b = req.body; return tx(req.user.username, async c => (await c.query(
    `INSERT INTO accounts(code,name_ar,name_en,type,parent_id,is_postable) VALUES ($1,$2,$3,$4,(SELECT id FROM accounts WHERE code=$5),coalesce($6,true)) RETURNING *`,
    [b.code, b.name_ar, b.name_en, b.type, b.parent_code, b.is_postable])).rows[0]);
});
route('PUT', '/api/accounts/:code', 'accountant', async req => {
  const b = req.body || {};
  return tx(req.user.username, async c => {
    const { rows: [acc] } = await c.query(`
      UPDATE accounts SET
        name_ar = coalesce($1, name_ar),
        name_en = coalesce($2, name_en),
        is_active = coalesce($3, is_active)
      WHERE code = $4 RETURNING *
    `, [b.name_ar, b.name_en, b.is_active, req.params.code]);
    if (!acc) throw httpErr(404, 'account not found');
    return acc;
  });
});
route('GET', '/api/branches', 'viewer', async () => (await q('SELECT * FROM branches ORDER BY id')).rows);
route('GET', '/api/currencies', 'viewer', async () => ({
  currencies: (await q('SELECT * FROM currencies ORDER BY is_base DESC, code')).rows,
  rates: (await q('SELECT * FROM exchange_rates ORDER BY rate_date DESC, currency_code LIMIT 100')).rows }));
route('POST', '/api/rates', 'accountant', async req => tx(req.user.username, async c => (await c.query(
  'INSERT INTO exchange_rates(currency_code,rate_date,rate) VALUES ($1,$2,$3) RETURNING *', [req.body.currency_code, req.body.rate_date, req.body.rate])).rows[0]));
route('GET', '/api/tax-codes', 'viewer', async () => (await q('SELECT * FROM tax_codes ORDER BY code')).rows);
route('GET', '/api/partners', 'viewer', async req => (await q(
  `SELECT * FROM partners WHERE ($1::text IS NULL OR kind=$1) ORDER BY id DESC LIMIT 500`, [req.query.kind || null])).rows);
route('POST', '/api/partners', 'cashier', async req => {
  const b = req.body; return tx(req.user.username, async c => (await c.query(
    `INSERT INTO partners(kind,name_ar,name_en,vat_number,cr_number,national_id,phone,email,building_no,street,district,city,postal_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [b.kind, b.name_ar, b.name_en, b.vat_number || null, b.cr_number, b.national_id, b.phone, b.email, b.building_no, b.street, b.district, b.city, b.postal_code])).rows[0]);
});
route('PUT', '/api/partners/:id', 'cashier', async req => {
  const b = req.body || {};
  return tx(req.user.username, async c => {
    const { rows: [p] } = await c.query(`
      UPDATE partners SET
        name_ar = coalesce($1, name_ar),
        name_en = coalesce($2, name_en),
        vat_number = coalesce($3, vat_number),
        cr_number = coalesce($4, cr_number),
        national_id = coalesce($5, national_id),
        phone = coalesce($6, phone),
        email = coalesce($7, email),
        building_no = coalesce($8, building_no),
        street = coalesce($9, street),
        district = coalesce($10, district),
        city = coalesce($11, city),
        postal_code = coalesce($12, postal_code),
        is_active = coalesce($13, is_active)
      WHERE id = $14 RETURNING *
    `, [
      b.name_ar, b.name_en, b.vat_number, b.cr_number, b.national_id,
      b.phone, b.email, b.building_no, b.street, b.district, b.city,
      b.postal_code, b.is_active, req.params.id
    ]);
    if (!p) throw httpErr(404, 'partner not found');
    return p;
  });
});

// ---- journal ----
route('GET', '/api/journal', 'viewer', async (req, reply) => {
  const { from, to, source, limit = 100, offset = 0 } = req.query;
  const f = [dateOr(from, '1900-01-01'), dateOr(to, '2999-12-31'), source || null];
  const [{ rows }, { rows: [{ n }] }] = await Promise.all([
    q(`SELECT e.*, p.name AS period FROM journal_entries e JOIN fiscal_periods p ON p.id=e.period_id
       WHERE e.entry_date BETWEEN $1 AND $2 AND ($3::text IS NULL OR e.source_type=$3) ORDER BY e.id DESC LIMIT $4 OFFSET $5`, [...f, Math.min(Math.max(+limit || 100, 1), 500), Math.max(+offset || 0, 0)]),
    q('SELECT count(*)::int n FROM journal_entries e WHERE e.entry_date BETWEEN $1 AND $2 AND ($3::text IS NULL OR e.source_type=$3)', f)]);
  reply.header('X-Total-Count', String(n));      // the UI shows the document counter as "shown-total" (e.g. 100-852)
  return rows;
});
route('GET', '/api/journal/:id', 'viewer', async req => {
  const { rows: [e] } = await q('SELECT e.*, (SELECT id FROM journal_entries r WHERE r.reversal_of=e.id) reversed_by FROM journal_entries e WHERE id=$1', [req.params.id]);
  if (!e) throw httpErr(404, 'not found');
  e.lines = (await q(`SELECT jl.*, a.code, a.name_ar, p.name_ar partner FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id
     LEFT JOIN partners p ON p.id=jl.partner_id WHERE entry_id=$1 ORDER BY line_no`, [req.params.id])).rows;
  return e;
});
route('POST', '/api/journal', 'accountant', async req => {
  const b = req.body || {};
  return tx(req.user.username, async c => ({ id: (await c.query('SELECT post_entry($1,$2,$3,$4,$5,$6,$7::jsonb) id',
    [b.date, b.memo, b.branch || null, 'manual', null, req.user.username, JSON.stringify(b.lines)])).rows[0].id }));
});
route('POST', '/api/journal/:id/reverse', 'accountant', async req => tx(req.user.username, async c => ({ id: (await c.query(
  'SELECT reverse_entry($1,$2,$3,$4) id', [req.params.id, dateOr(req.body?.date, today()), req.body?.memo, req.user.username])).rows[0].id })));

// ---- periods ----
route('GET', '/api/periods', 'viewer', async () => (await q('SELECT * FROM fiscal_periods ORDER BY start_date')).rows);
route('POST', '/api/periods/:id/close', 'accountant', async req => tx(req.user.username, async c => { await c.query('SELECT close_period($1,$2)', [req.params.id, req.user.username]); return { ok: true }; }));
route('POST', '/api/periods/:id/reopen', 'admin', async req => tx(req.user.username, async c => { await c.query('SELECT reopen_period($1,$2,$3)', [req.params.id, req.user.username, req.body?.reason]); return { ok: true }; }));
route('POST', '/api/periods/:id/lock', 'admin', async req => tx(req.user.username, async c => { await c.query('SELECT lock_period($1,$2)', [req.params.id, req.user.username]); return { ok: true }; }));
route('POST', '/api/year-close/:year', 'admin', async req => tx(req.user.username, async c => ({ entry_id: (await c.query('SELECT year_end_close($1,$2) id', [req.params.year, req.user.username])).rows[0].id })));

// ---- reports ----
const rep = (name, sql, args) => route('GET', `/api/reports/${name}`, 'viewer', async req => (await q(sql, await args(req))).rows);
rep('trial-balance', 'SELECT * FROM fn_trial_balance($1,$2)', async r => [dateOr(r.query.from, await yearStart()), dateOr(r.query.to, today())]);
rep('income-statement', 'SELECT * FROM fn_income_statement($1,$2)', async r => [dateOr(r.query.from, await yearStart()), dateOr(r.query.to, today())]);
rep('balance-sheet', 'SELECT * FROM fn_balance_sheet($1)', r => [dateOr(r.query.to, today())]);
rep('general-ledger', 'SELECT * FROM fn_general_ledger($1,$2,$3)', async r => [r.query.account, dateOr(r.query.from, await yearStart()), dateOr(r.query.to, today())]);
route('GET', '/api/reports/daybook', 'viewer', async req => (await q(`
  SELECT * FROM fn_daybook($1,$2)
  WHERE ($3::text IS NULL OR account_code = $3)
`, [dateOr(req.query.from, await yearStart()), dateOr(req.query.to, today()), req.query.account || null])).rows);
rep('vat-return', 'SELECT * FROM fn_vat_return($1,$2)', async r => [dateOr(r.query.from, await yearStart()), dateOr(r.query.to, today())]);
rep('ar-aging', 'SELECT * FROM fn_ar_aging($1)', r => [dateOr(r.query.to, today())]);
route('GET', '/api/reports/chain-verify', 'viewer', async () => (await q('SELECT * FROM verify_chain()')).rows[0]);
route('GET', '/api/reports/monthly', 'viewer', async req => (await q(`
  SELECT to_char(date_trunc('month',je.entry_date),'YYYY-MM') AS month,
         sum(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit ELSE 0 END) AS revenue,
         sum(CASE WHEN a.type='expense' THEN jl.debit-jl.credit ELSE 0 END) AS expense
  FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id JOIN accounts a ON a.id=jl.account_id
  WHERE a.type IN ('revenue','expense') AND je.source_type<>'year_close' AND je.entry_date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`,
  [dateOr(req.query.from, await yearStart()), dateOr(req.query.to, today())])).rows);

// ---- fleet ----
route('GET', '/api/fleet/vehicles', 'viewer', async () => (await q(`SELECT v.*, b.name_ar branch_name, e.name_ar driver_name,
  (SELECT count(*)::int FROM fleet_trips t WHERE t.vehicle_id=v.id) trips_count,
  (SELECT coalesce(sum(t.end_odometer-t.start_odometer),0) FROM fleet_trips t WHERE t.vehicle_id=v.id AND t.status='completed' AND t.end_odometer IS NOT NULL) distance_total
  FROM fleet_vehicles v LEFT JOIN branches b ON b.id=v.branch_id LEFT JOIN employees e ON e.id=v.employee_id ORDER BY v.id DESC`)).rows);
route('POST', '/api/fleet/vehicles', 'accountant', async req => {
  const b = req.body || {};
  return tx(req.user.username, async c => (await c.query(`INSERT INTO fleet_vehicles(plate_no,vin,make,model,model_year,vehicle_type,ownership,status,branch_id,employee_id,registration_expiry,insurance_expiry,inspection_due,odometer,notes)
    VALUES ($1,nullif($2,''),$3,$4,nullif($5,'')::int,$6,$7,$8,nullif($9,'')::bigint,nullif($10,'')::bigint,nullif($11,'')::date,nullif($12,'')::date,nullif($13,'')::date,coalesce(nullif($14,'')::numeric,0),coalesce($15,'')) RETURNING *`,
    [b.plate_no,b.vin||'',b.make,b.model,b.model_year==null?'':String(b.model_year),b.vehicle_type||'car',b.ownership||'owned',b.status||'active',b.branch_id||'',b.employee_id||'',b.registration_expiry||'',b.insurance_expiry||'',b.inspection_due||'',b.odometer||'',b.notes||''])).rows[0]);
});
route('PUT', '/api/fleet/vehicles/:id', 'accountant', async req => {
  const b = req.body || {};
  return tx(req.user.username, async c => (await c.query(`UPDATE fleet_vehicles SET plate_no=coalesce($1,plate_no), vin=coalesce(nullif($2,'__keep__'),nullif($2,''),vin), make=coalesce($3,make), model=coalesce($4,model), model_year=coalesce($5,model_year), vehicle_type=coalesce($6,vehicle_type), ownership=coalesce($7,ownership), status=coalesce($8,status), branch_id=coalesce($9,branch_id), employee_id=coalesce($10,employee_id), registration_expiry=coalesce($11,registration_expiry), insurance_expiry=coalesce($12,insurance_expiry), inspection_due=coalesce($13,inspection_due), odometer=coalesce($14,odometer), notes=coalesce($15,notes), updated_at=now() WHERE id=$16 RETURNING *`,
    [b.plate_no,b.vin,b.make,b.model,b.model_year,b.vehicle_type,b.ownership,b.status,b.branch_id,b.employee_id,b.registration_expiry,b.insurance_expiry,b.inspection_due,b.odometer,b.notes,req.params.id])).rows[0]);
});
route('GET', '/api/fleet/trips', 'viewer', async () => (await q(`SELECT t.*, v.plate_no, v.make || ' ' || v.model vehicle_name, e.name_ar driver_name FROM fleet_trips t JOIN fleet_vehicles v ON v.id=t.vehicle_id LEFT JOIN employees e ON e.id=t.driver_id ORDER BY t.trip_date DESC,t.id DESC`)).rows);
route('POST', '/api/fleet/trips', 'accountant', async req => { const b=req.body||{}; return tx(req.user.username, async c => (await c.query(`INSERT INTO fleet_trips(vehicle_id,driver_id,trip_date,origin,destination,purpose,start_odometer,end_odometer,status,notes,created_by) VALUES ($1,nullif($2,'')::bigint,$3,$4,$5,$6,$7,nullif($8,'')::numeric,$9,$10,$11) RETURNING *`, [b.vehicle_id,b.driver_id||'',b.trip_date||today(),b.origin,b.destination,b.purpose,b.start_odometer,b.end_odometer||'',b.status||'completed',b.notes||'',req.user.username])).rows[0]); });
route('PUT', '/api/fleet/trips/:id', 'accountant', async req => { const b=req.body||{}; return tx(req.user.username, async c => (await c.query(`UPDATE fleet_trips SET status=coalesce($1,status),end_odometer=coalesce($2,end_odometer) WHERE id=$3 RETURNING *`,[b.status,b.end_odometer,req.params.id])).rows[0]); });
route('GET', '/api/fleet/fuel', 'viewer', async () => (await q(`SELECT f.*,v.plate_no,v.make||' '||v.model vehicle_name FROM fleet_fuel f JOIN fleet_vehicles v ON v.id=f.vehicle_id ORDER BY f.fuel_date DESC,f.id DESC`)).rows);
route('POST', '/api/fleet/fuel', 'accountant', async req => { const b=req.body||{}; return tx(req.user.username, async c => (await c.query(`INSERT INTO fleet_fuel(vehicle_id,fuel_date,fuel_type,liters,unit_price,total_amount,odometer,vendor,reference,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,nullif($7,'')::numeric,$8,$9,$10,$11) RETURNING *`, [b.vehicle_id,b.fuel_date||today(),b.fuel_type||'petrol',b.liters,b.unit_price||0,b.total_amount??(Number(b.liters||0)*Number(b.unit_price||0)),b.odometer||'',b.vendor||'',b.reference||'',b.notes||'',req.user.username])).rows[0]); });
route('GET', '/api/fleet/maintenance', 'viewer', async () => (await q(`SELECT m.*,v.plate_no,v.make||' '||v.model vehicle_name FROM fleet_maintenance m JOIN fleet_vehicles v ON v.id=m.vehicle_id ORDER BY m.maintenance_date DESC,m.id DESC`)).rows);
route('POST', '/api/fleet/maintenance', 'accountant', async req => { const b=req.body||{}; return tx(req.user.username, async c => (await c.query(`INSERT INTO fleet_maintenance(vehicle_id,maintenance_date,maintenance_type,vendor,odometer,description,cost,next_due_date,reference,notes,created_by) VALUES ($1,$2,$3,$4,nullif($5,'')::numeric,$6,$7,nullif($8,'')::date,$9,$10,$11) RETURNING *`, [b.vehicle_id,b.maintenance_date||today(),b.maintenance_type,b.vendor||'',b.odometer||'',b.description,b.cost||0,b.next_due_date||'',b.reference||'',b.notes||'',req.user.username])).rows[0]); });
const fleetReportFilter = async r => [dateOr(r.query.from, await yearStart()),dateOr(r.query.to,today()),r.query.vehicle_id||null,r.query.branch_id||null];
route('GET', '/api/reports/fleet/summary', 'viewer', async req => (await q(`SELECT
  (SELECT count(*)::int FROM fleet_vehicles v WHERE v.status='active' AND ($4::bigint IS NULL OR v.branch_id=$4)) active_vehicles,
  (SELECT count(*)::int FROM fleet_trips t JOIN fleet_vehicles v ON v.id=t.vehicle_id WHERE t.status='completed' AND t.trip_date BETWEEN $1 AND $2 AND ($3::bigint IS NULL OR t.vehicle_id=$3) AND ($4::bigint IS NULL OR v.branch_id=$4)) trips,
  (SELECT coalesce(sum(t.end_odometer-t.start_odometer),0) FROM fleet_trips t JOIN fleet_vehicles v ON v.id=t.vehicle_id WHERE t.status='completed' AND t.end_odometer IS NOT NULL AND t.trip_date BETWEEN $1 AND $2 AND ($3::bigint IS NULL OR t.vehicle_id=$3) AND ($4::bigint IS NULL OR v.branch_id=$4)) distance,
  (SELECT coalesce(sum(f.total_amount),0) FROM fleet_fuel f JOIN fleet_vehicles v ON v.id=f.vehicle_id WHERE f.fuel_date BETWEEN $1 AND $2 AND ($3::bigint IS NULL OR f.vehicle_id=$3) AND ($4::bigint IS NULL OR v.branch_id=$4)) fuel_cost,
  (SELECT coalesce(sum(m.cost),0) FROM fleet_maintenance m JOIN fleet_vehicles v ON v.id=m.vehicle_id WHERE m.maintenance_date BETWEEN $1 AND $2 AND ($3::bigint IS NULL OR m.vehicle_id=$3) AND ($4::bigint IS NULL OR v.branch_id=$4)) maintenance_cost`,await fleetReportFilter(req))).rows[0]);
route('GET', '/api/reports/fleet/trips', 'viewer', async req => (await q(`SELECT t.trip_no,t.trip_date,v.plate_no,v.make||' '||v.model vehicle_name,e.name_ar driver_name,t.origin,t.destination,t.purpose,t.status,t.start_odometer,t.end_odometer,CASE WHEN t.end_odometer IS NULL THEN NULL ELSE t.end_odometer-t.start_odometer END distance FROM fleet_trips t JOIN fleet_vehicles v ON v.id=t.vehicle_id LEFT JOIN employees e ON e.id=t.driver_id WHERE t.trip_date BETWEEN $1 AND $2 AND ($3::bigint IS NULL OR t.vehicle_id=$3) AND ($4::bigint IS NULL OR v.branch_id=$4) ORDER BY t.trip_date DESC,t.id DESC`,await fleetReportFilter(req))).rows);
route('GET', '/api/reports/fleet/fuel', 'viewer', async req => (await q(`SELECT f.fuel_date,v.plate_no,v.make||' '||v.model vehicle_name,f.fuel_type,f.liters,f.unit_price,f.total_amount,f.odometer,f.vendor,f.reference FROM fleet_fuel f JOIN fleet_vehicles v ON v.id=f.vehicle_id WHERE f.fuel_date BETWEEN $1 AND $2 AND ($3::bigint IS NULL OR f.vehicle_id=$3) AND ($4::bigint IS NULL OR v.branch_id=$4) ORDER BY f.fuel_date DESC,f.id DESC`,await fleetReportFilter(req))).rows);
route('GET', '/api/reports/fleet/maintenance', 'viewer', async req => (await q(`SELECT m.maintenance_date,v.plate_no,v.make||' '||v.model vehicle_name,m.maintenance_type,m.vendor,m.odometer,m.description,m.cost,m.next_due_date,m.reference FROM fleet_maintenance m JOIN fleet_vehicles v ON v.id=m.vehicle_id WHERE m.maintenance_date BETWEEN $1 AND $2 AND ($3::bigint IS NULL OR m.vehicle_id=$3) AND ($4::bigint IS NULL OR v.branch_id=$4) ORDER BY m.maintenance_date DESC,m.id DESC`,await fleetReportFilter(req))).rows);

// ---- property ----
route('GET', '/api/properties', 'viewer', async () => (await q(`SELECT p.*, (SELECT count(*) FROM units u WHERE u.property_id=p.id) units,
  (SELECT string_agg(o.name_ar || ' (' || po.share_pct || '%)', '، ' ORDER BY o.name_ar) FROM property_ownership po JOIN owners o ON o.id=po.owner_id WHERE po.property_id=p.id) owners,
  (SELECT coalesce(sum(share_pct),0) FROM property_ownership po WHERE po.property_id=p.id) owned_pct FROM properties p ORDER BY id`)).rows);
route('POST', '/api/properties', 'accountant', async req => { const b = req.body; return tx(req.user.username, async c => (await c.query(
  `INSERT INTO properties(code,name_ar,name_en,kind,city,district,deed_no,branch_id) VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT id FROM branches WHERE code=$8)) RETURNING *`,
  [b.code, b.name_ar, b.name_en, b.kind, b.city, b.district, b.deed_no, b.branch])).rows[0]); });
route('GET', '/api/unit-types', 'viewer', async () => (await q('SELECT * FROM unit_types ORDER BY sort')).rows);
route('GET', '/api/units', 'viewer', async () => (await q(`SELECT u.*, ut.name_ar unit_type_name, p.name_ar property, p.kind property_kind,
  (SELECT l.id FROM leases l WHERE l.unit_id=u.id AND l.status='active' AND current_date BETWEEN l.start_date AND l.end_date) active_lease
  FROM units u JOIN unit_types ut ON ut.code=u.unit_type JOIN properties p ON p.id=u.property_id ORDER BY p.id,u.unit_no`)).rows);
route('POST', '/api/units', 'accountant', async req => { const b = req.body; return tx(req.user.username, async c => (await c.query(
  'INSERT INTO units(property_id,unit_no,unit_type,area_m2,base_annual_rent) VALUES ($1,$2,$3,$4,$5) RETURNING *', [b.property_id, b.unit_no, b.unit_type, b.area_m2, b.base_annual_rent])).rows[0]); });
route('PUT', '/api/properties/:id', 'accountant', async req => { const b = req.body || {}; return tx(req.user.username, async c => (await c.query(
  `UPDATE properties SET name_ar=coalesce($1,name_ar), name_en=coalesce($2,name_en), kind=coalesce($3,kind), city=coalesce($4,city), deed_no=coalesce($5,deed_no) WHERE id=$6 RETURNING *`,
  [b.name_ar, b.name_en, b.kind, b.city, b.deed_no, req.params.id])).rows[0]); });
route('PUT', '/api/units/:id', 'accountant', async req => { const b = req.body || {}; return tx(req.user.username, async c => (await c.query(
  `UPDATE units SET unit_no=coalesce($1,unit_no), unit_type=coalesce($2,unit_type), area_m2=coalesce($3,area_m2), base_annual_rent=coalesce($4,base_annual_rent) WHERE id=$5 RETURNING *`,
  [b.unit_no, b.unit_type, b.area_m2, b.base_annual_rent, req.params.id])).rows[0]); });
route('GET', '/api/leases', 'viewer', async () => (await q(`SELECT l.*, u.unit_no, p.name_ar property, t.name_ar tenant,
  (SELECT count(*) FROM rent_schedule r WHERE r.lease_id=l.id) installments, (SELECT count(*) FROM rent_schedule r WHERE r.lease_id=l.id AND r.invoice_id IS NOT NULL) billed
  FROM leases l JOIN units u ON u.id=l.unit_id JOIN properties p ON p.id=u.property_id JOIN partners t ON t.id=l.tenant_id ORDER BY l.id DESC`)).rows);
route('POST', '/api/leases', 'accountant', async req => { const b = req.body; return tx(req.user.username, async c => {
  const { rows: [l] } = await c.query(`INSERT INTO leases(number,unit_id,tenant_id,start_date,end_date,annual_rent,payment_freq,vat_applicable,deposit,ejar_contract_no)
    VALUES ('L-'||to_char(now(),'YYYY')||'-'||lpad(next_number_app('LEASE')::text,5,'0'),$1,$2,$3,$4,$5,$6,
      (SELECT kind='commercial' FROM properties WHERE id=(SELECT property_id FROM units WHERE id=$1)),$7,$8) RETURNING *`,
    [b.unit_id, b.tenant_id, b.start_date, b.end_date, b.annual_rent, b.payment_freq, b.deposit || 0, b.ejar_contract_no]);
  await c.query('SELECT generate_rent_schedule($1,$2)', [l.id, req.user.username]);
  return l; }); });
route('GET', '/api/leases/:id/schedule', 'viewer', async req => (await q(
  `SELECT r.*, i.number invoice_no, CASE WHEN r.invoice_id IS NULL THEN NULL ELSE fn_invoice_outstanding(r.invoice_id) END outstanding FROM rent_schedule r LEFT JOIN invoices i ON i.id=r.invoice_id WHERE r.lease_id=$1 ORDER BY seq`, [req.params.id])).rows);
route('POST', '/api/rent-schedule/:id/invoice', 'accountant', async req => {
  const { rows: [r] } = await q(`SELECT r.*, l.tenant_id, l.number lnum, l.vat_applicable, u.unit_no, p.name_ar pname, br.code branch FROM rent_schedule r JOIN leases l ON l.id=r.lease_id
    JOIN units u ON u.id=l.unit_id JOIN properties p ON p.id=u.property_id LEFT JOIN branches br ON br.id=p.branch_id WHERE r.id=$1`, [req.params.id]);
  if (!r) throw httpErr(404, 'installment not found');
  if (r.invoice_id) throw httpErr(409, 'already invoiced');
  return issueInvoice(req.user.username, { kind: 'standard', partner_id: r.tenant_id, branch: r.branch, lease_id: r.lease_id, rent_schedule_id: r.id, due_date: r.due_date,
    lines: [{ description: `إيجار ${r.pname} - وحدة ${r.unit_no} - عقد ${r.lnum} - استحقاق ${r.due_date}`, qty: 1, unit_price: r.amount, tax_code: r.vat_applicable ? 'S15' : 'E', revenue_account: '4100' }] });
});

// ---- invoices ----
route('GET', '/api/invoices', 'viewer', async (req, reply) => {
  const [{ rows }, { rows: [{ n }] }] = await Promise.all([
    q(`SELECT i.id,i.number,i.kind,i.issue_at,(i.issue_at AT TIME ZONE 'Asia/Riyadh')::date::text issue_date,i.due_date,i.subtotal,i.vat_amount,i.total,i.icv,p.name_ar partner,
      CASE WHEN i.kind='credit' THEN NULL ELSE fn_invoice_outstanding(i.id) END outstanding FROM invoices i LEFT JOIN partners p ON p.id=i.partner_id ORDER BY i.id DESC LIMIT $1`, [Math.min(Math.max(+(req.query.limit || 200) || 200, 1), 500)]),
    q('SELECT count(*)::int n FROM invoices')]);
  reply.header('X-Total-Count', String(n));
  return rows;
});
route('POST', '/api/invoices', 'cashier', async (req, reply) => idempotent({ q, httpErr, req, reply, scope: 'invoice', fn: () => issueInvoice(req.user.username, { ...(req.body || {}), enforce_rental_period: true }) }));
route('POST', '/api/invoices/:id/payments', 'cashier', async req => tx(req.user.username, async c => ({ entry_id: (await c.query(
  'SELECT record_payment($1,$2,$3,$4,$5,$6) id', [req.params.id, req.body.amount, dateOr(req.body.date, today()), req.body.cash_account || '1110', req.body.method, req.user.username])).rows[0].id })));
route('GET', '/api/invoices/:id', 'viewer', async req => {
  const { rows: [i] } = await q('SELECT i.*, p.name_ar partner_name, p.vat_number partner_vat FROM invoices i LEFT JOIN partners p ON p.id=i.partner_id WHERE i.id=$1', [req.params.id]);
  if (!i) throw httpErr(404, 'not found');
  i.lines = (await q('SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY line_no', [i.id])).rows;
  i.payments = (await q('SELECT * FROM invoice_payments WHERE invoice_id=$1 ORDER BY id', [i.id])).rows;
  return i;
});
route('GET', '/api/invoices/:id/xml', 'viewer', async (req, reply) => { const { rows: [i] } = await q('SELECT number, xml FROM invoices WHERE id=$1', [req.params.id]); if (!i) throw httpErr(404, 'not found');
  return reply.type('application/xml; charset=utf-8').header('content-disposition', `attachment; filename="${i.number}.xml"`).send(i.xml); });
route('GET', '/api/invoices/:id/print', 'viewer', async (req, reply) => {   // A4 printable invoice, ZATCA phase-1 layout (api/src/invoice-print.js)
  const { rows: [i] } = await q('SELECT * FROM invoices WHERE id=$1', [req.params.id]);
  if (!i) throw httpErr(404, 'not found');
  const [{ rows: [co] }, { rows: lines }, buyer, related] = await Promise.all([
    q("SELECT c.*,p.value->>'logo_data_url' logo_data_url FROM company c LEFT JOIN app_settings p ON p.key='account_profile'"), q('SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY line_no', [i.id]),
    i.partner_id ? q('SELECT name_ar, vat_number, cr_number, building_no, street, district, city, postal_code FROM partners WHERE id=$1', [i.partner_id]).then(r => r.rows[0]) : null,
    i.related_invoice_id ? q('SELECT number FROM invoices WHERE id=$1', [i.related_invoice_id]).then(r => r.rows[0]) : null]);
  const qrSvg = await QRCode.toString(i.qr, { type: 'svg', margin: 0, width: 170 });
  return reply.type('text/html; charset=utf-8').send(renderInvoiceHtml({ i, co, lines, buyer, related, qrSvg, logo:co.logo_data_url||'/logo.png' }));
});

// ---- rules lab (teaching) ----
route('GET', '/api/rules', 'viewer', async () => {
  const { rows } = await q(`SELECT c.relname tbl, t.tgname, t.tgenabled, p.proname fn, pg_get_triggerdef(t.oid) def
     FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal AND t.tgname ~ '^r[0-9]+_' ORDER BY t.tgname`);
  return { rules: RULES, triggers: rows };
});
route('POST', '/api/rules/try/:lab', 'viewer', async req => (await q('SELECT * FROM rules_lab($1)', [req.params.lab])).rows[0]);
route('GET', '/api/rules/source/:fn', 'viewer', async req => {
  if (!/^[a-z_0-9]+$/.test(req.params.fn)) throw httpErr(400, 'bad name');
  const { rows: [r] } = await q('SELECT pg_get_functiondef(p.oid) src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=\'public\' AND p.proname=$1 LIMIT 1', [req.params.fn]);
  if (!r) throw httpErr(404, 'function not found'); return r;
});

// ---- docs (SOP / FAQ) ----
const DOCS = { sop: 'SOP.md', faq: 'FAQ.md', zatca: 'ZATCA.md', 'google-play': 'GOOGLE_PLAY.md', commerce: 'COMMERCE.md' };
route('GET', '/api/docs', null, async () => Object.keys(DOCS));
route('GET', '/api/docs/:name', null, async (req, reply) => {
  const f = DOCS[req.params.name]; if (!f) throw httpErr(404, 'unknown doc');
  const md = await readFile(path.join(ROOT, 'docs', f), 'utf8');
  return reply.type('application/json').send({ name: req.params.name, html: renderMarkdown(md), md });
});


// ---- menu visibility (إعدادات القوائم): global, admin-edited, validated against web/nav.json ----
const MENU = loadMenuCatalog(ROOT);
route('GET', '/api/menu-settings', 'viewer', async () => {
  const { rows: [r] } = await q("SELECT value FROM app_settings WHERE key='menu'");
  const disabled = (r?.value?.disabled || MENU.defaultDisabled).filter(x => MENU.ids.has(x));
  return { disabled, locked: [...MENU.locked] };
});
route('PUT', '/api/menu-settings', 'admin', async req => {
  const list = req.body?.disabled;
  if (!Array.isArray(list) || list.length > 500) throw httpErr(400, 'disabled must be an array');
  const clean = [...new Set(list.map(String))];
  const bad = clean.find(x => !MENU.ids.has(x)); if (bad) throw httpErr(422, 'unknown menu id: ' + bad);
  const locked = clean.find(x => MENU.locked.has(x)); if (locked) throw httpErr(422, 'this menu cannot be hidden (it would lock administrators out): ' + locked);
  await tx(req.user.username, async c => { await c.query(`INSERT INTO app_settings(key,value,updated_by) VALUES ('menu',$1::jsonb,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`, [JSON.stringify({ disabled: clean }), req.user.username]); });
  return { disabled: clean };
});

registerCommerce({ app, route, auth, q, tx, issueInvoice, httpErr, UPLOAD_DIR, idempotent });
registerHR({ app, route, auth, q, tx, httpErr, dateOr, today });
await registerAI({ app, auth, q, tx, httpErr, root: ROOT, env: process.env, rules: RULES });

if (MT) {   // the schema that holds pgcrypto must be known before the first tenant connection is opened (it goes into each tenant's search_path)
  try { const { rows: [e] } = await qPlatform("SELECT n.nspname s FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pgcrypto'"); if (e) setExtSchema(e.s); }
  catch (e) { app.log.error('cannot read the pgcrypto schema: ' + e.message); }
}
const port = Number(process.env.PORT || 3100);
await app.listen({ port, host: '0.0.0.0' });
const outdatedMsg = `DATABASE SCHEMA IS OLDER THAN THIS APP (expected ${SCHEMA_EXPECTED}). The db/init scripts run only when the database volume is first created, so screens such as Bookings or the demo seed can fail with 500/422. Demo data: 'docker compose down -v' then 'docker compose up -d --build'. Real data: run 'docker compose up -d --build' (the migrate service upgrades it; see CHANGELOG) after a backup.`;
if (!MT) {
  if (await schemaState() !== 'ok') app.log.error(outdatedMsg);
  await bootstrapStores({ q, tx, log: app.log });   // idempotent: fills blank storefront settings, auto-publishes only verifiably ready sites
} else {
  let tenants = [];
  try { tenants = await registry.active(); if (!tenants.length) app.log.error('MULTI_TENANT=1 but the registry is empty: run the migrate service with MULTI_TENANT=1 (it registers the existing data as the default company)'); }
  catch (e) { app.log.error('MULTI_TENANT=1 but platform.tenants is unreadable (' + e.message + '): run the migrate service with MULTI_TENANT=1'); }
  for (const t of tenants) {
    await als.run({ tenant: t, locked: true }, async () => {
      try { if (await schemaState() !== 'ok') app.log.error(`[${t.slug}] ${outdatedMsg}`); await bootstrapStores({ q, tx, log: app.log }); }
      catch (e) { app.log.error(`[${t.slug}] startup bootstrap failed: ${e.message}`); }      // one company's problem never stops the others
    });
  }
  app.log.info(`multi-tenant mode: ${tenants.length} active compan${tenants.length === 1 ? 'y' : 'ies'}`);
}
