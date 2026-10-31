// Multi-tenant unit tests: NO database, NO server.   node tests/tenant-unit.mjs
// Proves the parts that can be proven offline: slug/schema rules, the SQL translation of EVERY init file (no hard-coded "public" may survive),
// tenant resolution (sub-domain / custom domain / header), registry cache + suspension, and per-tenant upload isolation.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = async f => import(pathToFileURL(path.join(root, 'api/src', f)).href);
const S = await imp('tenant-sql.js'), T = await imp('tenancy.js'), U = await imp('uploads.js');
let failed = 0; const chk = (n, ok, x = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : '  → ' + x}`); };
const throws = (fn, re = /./) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

// ---- slugs and schema names ----
chk('slug: valid examples accepted', ['acme', 'al-nour', 'shop24', 'a1b'].every(s => S.slugProblems(s).length === 0));
chk('slug: too short / uppercase / underscore / leading digit / trailing hyphen refused', ['ab', 'Acme', 'a_b', '1abc', 'abc-', '-abc', 'a--b', 'x'.repeat(40)].every(s => S.slugProblems(s).length > 0));
chk('slug: reserved words refused (public, platform, admin, api, www ...)', ['public', 'platform', 'admin', 'api', 'www', 'default'].every(s => S.slugProblems(s).length > 0));
chk('slug: SQL / path injection refused', ['a;drop', 'a"b', "a'b", '../x', 'a b', 'a.b', 'acme%00'].every(s => S.slugProblems(s).length > 0));
chk('schemaFor: acme-co -> t_acme_co', S.schemaFor('acme-co') === 't_acme_co');
chk('schemaFor: refuses an invalid slug', throws(() => S.schemaFor('Bad;Slug')));
chk('assertSchemaName: only public or t_<name>', S.assertSchemaName('public') === 'public' && S.assertSchemaName('t_acme') === 't_acme' && throws(() => S.assertSchemaName('pg_catalog')) && throws(() => S.assertSchemaName('platform')) && throws(() => S.assertSchemaName('t_a"b')) && throws(() => S.assertSchemaName('T_ACME')));
chk('searchPathFor: tenant schema FIRST, never public data before it', S.searchPathFor('t_acme') === 't_acme,public' && S.searchPathFor('public') === 'public' && S.searchPathFor('t_acme', 'ext') === 't_acme,ext');

// ---- the SQL translation, for every init file ----
const dir = path.join(root, 'db/init'); const all = fs.readdirSync(dir);
const files = S.tenantInitFiles(all);
chk('tenant init files: globals (roles, first admin, demo catalogue) are excluded', !files.includes('000_roles.sh') && !files.includes('090_admin.sh') && !files.includes('130_demo_catalog.sql') && files.includes('010_core.sql') && files.includes('290_totp.sql'));
chk('tenant init files: processed in numeric order', files.join() === [...files].sort().join());
let leaks = [];
for (const f of files) { const out = S.rewriteForTenant(fs.readFileSync(path.join(dir, f), 'utf8'), 't_acme_co'); const l = S.leftoverPublic(out); if (l.length) leaks.push(f + ':' + l[0].line + ' ' + l[0].text); }
chk(`translation: none of the ${files.length} init files keeps a hard-coded "public" after translation`, leaks.length === 0, leaks.slice(0, 3).join(' | '));
const sample = S.rewriteForTenant("CREATE FUNCTION f() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT 1 $$;\nGRANT USAGE ON SCHEMA public TO erpx_app;\nGRANT SELECT ON ALL TABLES IN SCHEMA public TO erpx_app;\nSELECT to_regprocedure('public.' || sig);\nEXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO erpx_app', sig);\nSELECT 1 FROM information_schema.columns WHERE table_schema='public';\nREVOKE EXECUTE ON FUNCTION f FROM PUBLIC;", 't_acme_co');
chk('translation: search_path pins the tenant schema first and keeps pgcrypto reachable', sample.includes('SET search_path = "t_acme_co", public, pg_temp'));
chk('translation: grants, regprocedure probes, format() and information_schema all follow the tenant', sample.includes('ON SCHEMA "t_acme_co"') && sample.includes('IN SCHEMA "t_acme_co"') && sample.includes("'t_acme_co.' || sig") && sample.includes('"t_acme_co".%s') && sample.includes("table_schema='t_acme_co'"));
chk('translation: the PUBLIC pseudo-role is untouched', sample.includes('FROM PUBLIC;'));
chk('translation: a custom pgcrypto schema is honoured', S.rewriteForTenant('SET search_path = public, pg_temp', 't_x', 'extensions').includes('"t_x", extensions, pg_temp'));
chk('translation: the default tenant (public) is a no-op', S.rewriteForTenant('SET search_path = public, pg_temp', 'public') === 'SET search_path = public, pg_temp');
chk('translation: a new migration with a stray public reference is DETECTED', S.leftoverPublic(S.rewriteForTenant('INSERT INTO app_settings SELECT * FROM public.app_settings;\nSELECT 1 FROM "public".users;', 't_x')).length >= 1);
chk('translation: refuses an invalid schema', throws(() => S.rewriteForTenant('x', 'evil"; DROP SCHEMA public;--')));
chk('preamble: creates the schema and grants usage to the app role only', S.schemaPreamble('t_acme').join(';') === 'CREATE SCHEMA "t_acme";GRANT USAGE ON SCHEMA "t_acme" TO erpx_app');
const platform = fs.readFileSync(path.join(root, 'db/platform/001_platform.sql'), 'utf8');
chk('platform SQL: idempotent (IF NOT EXISTS everywhere) and app role is read-only on the registry', !/CREATE TABLE (?!IF NOT EXISTS)/.test(platform) && /GRANT SELECT ON platform\.tenants TO erpx_app/.test(platform) && !/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*platform\./.test(platform));
chk('platform SQL: exactly one default tenant is enforced', /tenants_one_default[^;]*WHERE is_default/.test(platform));
chk('init files: 000/090 (global) and platform SQL never run inside a tenant', !S.tenantInitFiles(['000_roles.sh', '010_core.sql']).includes('000_roles.sh'));

// ---- host / header resolution ----
chk('host: acme.erp.example.com -> acme', T.slugFromHost('acme.erp.example.com', 'erp.example.com') === 'acme');
chk('host: port and case ignored', T.slugFromHost('ACME.erp.example.com:443', 'erp.example.com') === 'acme');
chk('host: the base domain itself / other domains / nested labels -> null', T.slugFromHost('erp.example.com', 'erp.example.com') === null && T.slugFromHost('acme.other.com', 'erp.example.com') === null && T.slugFromHost('a.b.erp.example.com', 'erp.example.com') === null);
chk('host: no base domain configured -> null', T.slugFromHost('acme.erp.example.com', '') === null);
chk('host: look-alike suffix refused (evilerp.example.com)', T.slugFromHost('acme.evilerp.example.com', 'erp.example.com') === null);

const rows = [
  { id: 1, slug: 'default', name: 'Default', schema_name: 'public', status: 'active', is_default: true },
  { id: 2, slug: 'acme', name: 'Acme', schema_name: 't_acme', status: 'active', custom_domain: 'erp.acme.com' },
  { id: 3, slug: 'beta', name: 'Beta', schema_name: 't_beta', status: 'suspended' }];
let clock = 0, loads = 0; const reg = T.tenantRegistry({ load: async () => { loads++; return rows.map(r => ({ ...r })); }, ttlMs: 1000, now: () => clock });
chk('registry: lookups by slug / id / domain / default', (await reg.bySlug('acme')).id === 2 && (await reg.byId(2)).slug === 'acme' && (await reg.byDomain('ERP.acme.com:8443')).slug === 'acme' && (await reg.defaultTenant()).slug === 'default');
chk('registry: cached within the TTL (one load)', loads === 1);
rows[1].status = 'suspended'; clock = 500; chk('registry: a suspension is NOT visible before the TTL', (await reg.bySlug('acme')).status === 'active');
clock = 1500; chk('registry: a suspension IS visible after the TTL (cut-off within seconds)', (await reg.bySlug('acme')).status === 'suspended' && loads === 2);
chk('registry: active() lists only active companies', (await reg.active()).map(t => t.slug).join() === 'default');
const env0 = { TENANT_BASE_DOMAIN: 'erp.example.com' };
chk('resolve: custom domain wins', (await T.resolveCandidate(reg, { host: 'erp.acme.com' }, env0)).slug === 'acme');
chk('resolve: sub-domain', (await T.resolveCandidate(reg, { host: 'beta.erp.example.com' }, env0)).slug === 'beta');
chk('resolve: X-Tenant header (path-based mode)', (await T.resolveCandidate(reg, { host: 'x.test', header: 'acme' }, {})).slug === 'acme');
chk('resolve: explicit body value (login form)', (await T.resolveCandidate(reg, { host: 'x.test', body: 'beta' }, {})).slug === 'beta');
chk('resolve: sub-domain beats a conflicting header (a company cannot be spoofed from its own address)', (await T.resolveCandidate(reg, { host: 'beta.erp.example.com', header: 'acme' }, env0)).slug === 'beta');
chk('resolve: nothing named -> the default company (legacy URLs keep working)', (await T.resolveCandidate(reg, { host: 'x.test' }, {})).slug === 'default');
chk('resolve: TENANT_REQUIRE_EXPLICIT=1 -> no fallback', (await T.resolveCandidate(reg, { host: 'x.test' }, { TENANT_REQUIRE_EXPLICIT: '1' })) === null);
chk('resolve: unknown slug -> null (never falls back to the default)', (await T.resolveCandidate(reg, { host: 'x.test', header: 'nope' }, {})) === null);
chk('resolve: header value is length-limited and lower-cased', (await T.resolveCandidate(reg, { host: 'x.test', header: 'ACME' }, {})).slug === 'acme' && (await T.resolveCandidate(reg, { host: 'x.test', header: 'a'.repeat(500) }, {})) === null);
chk('assertUsable: active ok; suspended 403; unknown 404; provisioning 403', T.assertUsable({ status: 'active' }).status === 'active' && throws(() => T.assertUsable({ status: 'suspended' }), /suspended/) && throws(() => T.assertUsable(null), /unknown company/) && throws(() => T.assertUsable({ status: 'provisioning' }), /not active/));
try { T.assertUsable(null); } catch (e) { chk('assertUsable: carries HTTP status codes', e.statusCode === 404); }
chk('isMultiTenant: off by default, on for 1/true/yes', !T.isMultiTenant({}) && T.isMultiTenant({ MULTI_TENANT: '1' }) && T.isMultiTenant({ MULTI_TENANT: 'true' }) && !T.isMultiTenant({ MULTI_TENANT: '0' }));
const seen = []; await T.withTenant({ slug: 'acme' }, async () => { await Promise.resolve(); await new Promise(r => setTimeout(r, 5)); seen.push(T.currentTenant()?.slug); });
await Promise.all([T.withTenant({ slug: 'a1' }, async () => { await new Promise(r => setTimeout(r, 10)); seen.push(T.currentTenant().slug); }), T.withTenant({ slug: 'b2' }, async () => { await new Promise(r => setTimeout(r, 2)); seen.push(T.currentTenant().slug); })]);
chk('context: concurrent requests never see each other\'s tenant (AsyncLocalStorage)', seen.join() === 'acme,b2,a1' && T.currentTenant() === null, seen.join());

// ---- uploads: per-tenant isolation ----
const uuid = '123e4567-e89b-42d3-a456-426614174000';
chk('uploads: single-company URL pattern unchanged', U.isOwnUpload(`/uploads/products/${uuid}.png`) && !U.isOwnUpload(`/uploads/t/acme/products/${uuid}.png`));
chk('uploads: tenant URL accepted only for ITS OWN slug', U.isOwnUpload(`/uploads/t/acme/products/${uuid}.png`, 'acme') && !U.isOwnUpload(`/uploads/t/beta/products/${uuid}.png`, 'acme') && !U.isOwnUpload(`/uploads/products/${uuid}.png`, 'acme'));
chk('uploads: traversal / odd slugs refused', !U.isOwnUpload(`/uploads/t/../products/${uuid}.png`, '..') && !U.isOwnUpload(`/uploads/t/a.b/products/${uuid}.png`, 'a.b'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'erpx-up-')); const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const ua = await U.saveProductImage(png, tmp, 'acme'), ub = await U.saveProductImage(png, tmp, 'beta');
chk('uploads: files land in a per-company folder', ua.startsWith('/uploads/t/acme/products/') && fs.existsSync(path.join(tmp, 't', 'acme', 'products', path.basename(ua))) && fs.existsSync(path.join(tmp, 't', 'beta', 'products', path.basename(ub))));
chk('uploads: company A cannot delete company B\'s file even with its exact URL', (await U.removeUpload(ub, tmp, 'acme')) === false && fs.existsSync(path.join(tmp, 't', 'beta', 'products', path.basename(ub))));
chk('uploads: a company deletes its own file', (await U.removeUpload(ua, tmp, 'acme')) === true && !fs.existsSync(path.join(tmp, 't', 'acme', 'products', path.basename(ua))));
chk('uploads: invalid scope refused on save', await U.saveProductImage(png, tmp, '../x').then(() => false, () => true));
fs.rmSync(tmp, { recursive: true, force: true });

// ---- wiring guards (static): the API must stay fail-closed ----
const dbjs = fs.readFileSync(path.join(root, 'api/src/db.js'), 'utf8'), srv = fs.readFileSync(path.join(root, 'api/src/server.js'), 'utf8');
chk('db.js: multi-tenant q()/tx() throw when no tenant is in context (fail closed)', /tenant context missing/.test(dbjs));
chk('db.js: tx() verifies current_schema() against the tenant', /current_schema\(\)/.test(dbjs) && /tenant isolation check failed/.test(dbjs));
chk('db.js: tenant pools fix search_path at connection start (no per-query SET)', /options: `-c search_path=/.test(dbjs) && !/SET search_path/i.test(dbjs.replace(/\/\/.*$/gm, '')));
chk('server.js: the tenant of a signed-in request comes from the verified token, not from headers', /req\.user\.tid/.test(srv) && /st\.locked = true/.test(srv));
chk('server.js: login/public routes require an ACTIVE company (2FA step 2 uses the signed token instead)', /st\.tenant = usable\(t\)/.test(srv) && /auth\\\/\(\?!mfa\)/.test(srv));
chk('server.js: a half-finished 2FA token is never a session', /if \(req\.user\.mfa\) throw httpErr\(401/.test(srv));
const api = fs.readdirSync(path.join(root, 'api/src')).filter(f => f.endsWith('.js')).map(f => [f, fs.readFileSync(path.join(root, 'api/src', f), 'utf8')]);
const direct = api.filter(([f, s]) => !['db.js', 'migrate.js', 'tenant-admin.js', 'migrate-cli.js', 'tenant-cli.js'].includes(f) && /new pg\.(Pool|Client)|from 'pg'/.test(s)).map(([f]) => f);
chk('no API module opens its own database connection (everything goes through the tenant-aware q()/tx())', direct.length === 0, direct.join());
const publicRef = api.filter(([f, s]) => !['migrate.js', 'schema-probes.js', 'tenant-sql.js', 'tenant-admin.js', 'security.js'].includes(f) && /['"`]public\.[a-z_]/.test(s)).map(([f]) => f);
chk('no runtime SQL names schema "public" explicitly (it would bypass the tenant search_path)', publicRef.length === 0, publicRef.join());

console.log(failed ? `\n${failed} FAILED` : '\nALL TENANT CHECKS PASSED'); process.exit(failed ? 1 : 0);
