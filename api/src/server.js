import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import fstatic from '@fastify/static';
import QRCode from 'qrcode';
import { readFile, readdir } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, tx } from './db.js';
import { issueInvoice, httpErr } from './invoicing.js';
import { RULES } from './rules-catalog.js';
import { registerCommerce } from './routes-commerce.js';
import { registerHR } from './routes-hr.js';
import { loadMenuCatalog } from './menu-catalog.js';
import { riyadhToday } from './dates.js';

import { bootstrapStores } from './site-defaults.js';
import { renderMarkdown } from './docs-render.js';
import { CSP, assertProductionSecrets, loginGuard } from './security.js';
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
await app.register(fstatic, { root: path.join(ROOT, 'web'), prefix: '/', dotfiles: 'allow', cacheControl: false, setHeaders: res => res.setHeader('Cache-Control', 'no-cache') });   // always revalidate: no stale JS after an upgrade

// ---- product images: persistent folder (docker volume erpx_uploads -> /app/uploads). Files are random-UUID names; only images are served. ----
const UPLOAD_DIR = uploadRoot(ROOT);
try { mkdirSync(path.join(UPLOAD_DIR, 'products'), { recursive: true }); } catch (e) { throw new Error(`cannot create the uploads folder ${UPLOAD_DIR} (${e.message}) — mount a writable volume there`); }
await app.register(fstatic, { root: UPLOAD_DIR, prefix: '/uploads/', decorateReply: false, dotfiles: 'deny', index: false, list: false, cacheControl: false,
  setHeaders: res => { res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox"); res.setHeader('X-Content-Type-Options', 'nosniff'); } });   // names never change (UUID), so they can be cached for a year
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

// PostgreSQL errors carry our stable ERPX-xxxx codes: surface them as 422 so clients can show the rule that fired.
app.setErrorHandler((err, req, reply) => {
  const m = /^(ERPX-[A-Z]\d{3}):/.exec(err.message || '');
  if (m) return reply.code(422).send({ error: err.message, rule: m[1] });
  if (err.code && /^(23|22|P0)/.test(String(err.code))) return reply.code(422).send({ error: err.message, code: err.code });
  // 42P01 undefined table / 42703 undefined column / 42883 undefined function: the database is older than this code -> say so (503), do not hide it behind a bare 500.
  if (['42P01', '42703', '42883'].includes(String(err.code))) { req.log.error({ err: err.message }, 'DATABASE SCHEMA OUTDATED'); return reply.code(503).send({ error: 'قاعدة البيانات أقدم من إصدار التطبيق (' + err.message + '). أعد تشغيل الخدمة ليُرقّيها تلقائياً: docker compose up -d --build', code: 'SCHEMA_OUTDATED' }); }
  if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
  req.log.error(err); reply.code(500).send({ error: 'internal error' });
});

const auth = min => async req => {
  try { await req.jwtVerify(); } catch { throw httpErr(401, 'login required'); }
  if (RANK[req.user.role] < RANK[min]) throw httpErr(403, `role ${min} required`);
};
const route = (method, url, min, handler) => app.route({ method, url, preHandler: min ? auth(min) : undefined, handler, logLevel: url === '/api/health' ? 'warn' : undefined });   // health checks every 5s must not flood the log
const dateOr = (v, d) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : d);
const today = () => riyadhToday();
const yearStart = () => today().slice(0, 4) + '-01-01';

// ---- auth ----
const guardLogin = loginGuard();
route('POST', '/api/auth/login', null, async (req, reply) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || username.length > 100 || password.length > 200) throw httpErr(400, 'username and password are required');
  const wait = guardLogin.blockedFor(req.ip, username);
  if (wait) { reply.header('Retry-After', String(wait)); throw httpErr(429, 'too many failed sign-in attempts; try again later'); }
  const { rows: [u] } = await q('SELECT * FROM login_user($1,$2)', [username, password]);
  if (!u) { guardLogin.fail(req.ip, username); await new Promise(r => setTimeout(r, 400)); throw httpErr(401, 'invalid credentials'); }
  guardLogin.ok(req.ip, username);
  return { token: app.jwt.sign({ id: u.id, username: u.username, role: u.role }), user: u };
});
route('GET', '/api/me', 'viewer', async req => req.user);
const schemaState = async () => { try { const { rows: [r] } = await q("SELECT value->>'version' v FROM app_settings WHERE key='schema'"); return r?.v === SCHEMA_EXPECTED ? 'ok' : 'outdated'; } catch { return 'outdated'; } };
route('GET', '/api/health', null, async () => ({ ok: true, version: APP_VERSION, db: (await q('SELECT 1 ok')).rows[0].ok === 1, schema: await schemaState() }));

// ---- reference data ----
route('GET', '/api/company', 'viewer', async () => (await q('SELECT * FROM company')).rows[0]);
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
route('GET', '/api/journal', 'viewer', async req => {
  const { from, to, source, limit = 100, offset = 0 } = req.query;
  return (await q(`SELECT e.*, p.name AS period FROM journal_entries e JOIN fiscal_periods p ON p.id=e.period_id
     WHERE e.entry_date BETWEEN $1 AND $2 AND ($3::text IS NULL OR e.source_type=$3) ORDER BY e.id DESC LIMIT $4 OFFSET $5`,
     [dateOr(from, '1900-01-01'), dateOr(to, '2999-12-31'), source || null, Math.min(+limit, 500), +offset])).rows;
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
const rep = (name, sql, args) => route('GET', `/api/reports/${name}`, 'viewer', async req => (await q(sql, args(req))).rows);
rep('trial-balance', 'SELECT * FROM fn_trial_balance($1,$2)', r => [dateOr(r.query.from, yearStart()), dateOr(r.query.to, today())]);
rep('income-statement', 'SELECT * FROM fn_income_statement($1,$2)', r => [dateOr(r.query.from, yearStart()), dateOr(r.query.to, today())]);
rep('balance-sheet', 'SELECT * FROM fn_balance_sheet($1)', r => [dateOr(r.query.to, today())]);
rep('general-ledger', 'SELECT * FROM fn_general_ledger($1,$2,$3)', r => [r.query.account, dateOr(r.query.from, yearStart()), dateOr(r.query.to, today())]);
rep('daybook', 'SELECT * FROM fn_daybook($1,$2)', r => [dateOr(r.query.from, yearStart()), dateOr(r.query.to, today())]);
rep('vat-return', 'SELECT * FROM fn_vat_return($1,$2)', r => [dateOr(r.query.from, yearStart()), dateOr(r.query.to, today())]);
rep('ar-aging', 'SELECT * FROM fn_ar_aging($1)', r => [dateOr(r.query.to, today())]);
route('GET', '/api/reports/chain-verify', 'viewer', async () => (await q('SELECT * FROM verify_chain()')).rows[0]);
route('GET', '/api/reports/monthly', 'viewer', async req => (await q(`
  SELECT to_char(date_trunc('month',je.entry_date),'YYYY-MM') AS month,
         sum(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit ELSE 0 END) AS revenue,
         sum(CASE WHEN a.type='expense' THEN jl.debit-jl.credit ELSE 0 END) AS expense
  FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id JOIN accounts a ON a.id=jl.account_id
  WHERE a.type IN ('revenue','expense') AND je.source_type<>'year_close' AND je.entry_date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`,
  [dateOr(req.query.from, yearStart()), dateOr(req.query.to, today())])).rows);

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
route('GET', '/api/invoices', 'viewer', async req => (await q(`SELECT i.id,i.number,i.kind,i.issue_at,i.due_date,i.subtotal,i.vat_amount,i.total,i.icv,p.name_ar partner,
  CASE WHEN i.kind='credit' THEN NULL ELSE fn_invoice_outstanding(i.id) END outstanding FROM invoices i LEFT JOIN partners p ON p.id=i.partner_id ORDER BY i.id DESC LIMIT $1`, [Math.min(+(req.query.limit || 200), 500)])).rows);
route('POST', '/api/invoices', 'cashier', async req => issueInvoice(req.user.username, req.body));
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
    q('SELECT * FROM company'), q('SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY line_no', [i.id]),
    i.partner_id ? q('SELECT name_ar, vat_number, cr_number, building_no, street, district, city, postal_code FROM partners WHERE id=$1', [i.partner_id]).then(r => r.rows[0]) : null,
    i.related_invoice_id ? q('SELECT number FROM invoices WHERE id=$1', [i.related_invoice_id]).then(r => r.rows[0]) : null]);
  const qrSvg = await QRCode.toString(i.qr, { type: 'svg', margin: 0, width: 170 });
  return reply.type('text/html; charset=utf-8').send(renderInvoiceHtml({ i, co, lines, buyer, related, qrSvg }));
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

registerCommerce({ app, route, auth, q, tx, issueInvoice, httpErr, UPLOAD_DIR });
registerHR({ app, route, auth, q, tx, httpErr, dateOr, today });

const port = Number(process.env.PORT || 3100);
await app.listen({ port, host: '0.0.0.0' });
if (await schemaState() !== 'ok') app.log.error(`DATABASE SCHEMA IS OLDER THAN THIS APP (expected ${SCHEMA_EXPECTED}). The db/init scripts run only when the database volume is first created, so screens such as Bookings or the demo seed can fail with 500/422. Demo data: 'docker compose down -v' then 'docker compose up -d --build'. Real data: run 'docker compose up -d --build' (the migrate service upgrades it; see CHANGELOG) after a backup.`);
await bootstrapStores({ q, tx, log: app.log });   // idempotent: fills blank storefront settings, auto-publishes only verifiably ready sites
