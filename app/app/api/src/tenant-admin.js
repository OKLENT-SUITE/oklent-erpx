// Tenant lifecycle (owner role only): provision, upgrade, suspend, resume, archive, list. https://oklent.net/
// Used by api/src/tenant-cli.js. The API process never imports this file's database powers: it has no owner credential in production.
import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { schemaFor, slugProblems, tenantInitFiles, rewriteForTenant, leftoverPublic, schemaPreamble, quoteIdent, DEFAULT_SCHEMA } from './tenant-sql.js';

export const LOCK_KEY = 727002;                                    // advisory lock for tenant lifecycle operations (migrate uses 727001)
const PLATFORM_SQL = ['001_platform.sql'];

export async function connectOwner(url) {
  if (!url) throw new Error('OWNER_DATABASE_URL is required');
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 }); await c.connect(); return c;
}

/** Schema that holds pgcrypto (needed by the rewritten search_path so digest()/crypt() keep resolving). */
export async function extensionSchema(c) {
  const { rows: [r] } = await c.query("SELECT n.nspname s FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pgcrypto'");
  if (!r) throw new Error('extension pgcrypto is not installed in this database');
  return r.s;
}

export async function applyPlatform(c, root) {
  for (const f of PLATFORM_SQL) await c.query(await readFile(path.join(root, 'db', 'platform', f), 'utf8'));
}

/** Registers the pre-existing single-company data (schema public) as the default tenant. Idempotent. */
export async function registerDefaultTenant(c, { slug = 'default', name = 'Default company', version } = {}) {
  const { rows: [has] } = await c.query("SELECT to_regclass('public.company') IS NOT NULL ok");
  if (!has.ok) return null;
  const { rows: [ex] } = await c.query('SELECT * FROM platform.tenants WHERE is_default');
  if (ex) return ex;
  const { rows: [co] } = await c.query('SELECT name_ar, name_en FROM public.company LIMIT 1');
  const { rows: [t] } = await c.query(
    "INSERT INTO platform.tenants(slug,name,schema_name,status,is_default,activated_at,provisioned_version) VALUES ($1,$2,'public','active',true,now(),$3) RETURNING *",
    [slug, co?.name_ar || co?.name_en || name, version || null]);
  await c.query("INSERT INTO platform.tenant_events(tenant_id,event,actor,detail) VALUES ($1,'default_registered','system',$2)", [t.id, JSON.stringify({ schema: 'public' })]);
  return t;
}

const event = (c, id, ev, actor, detail) => c.query('INSERT INTO platform.tenant_events(tenant_id,event,actor,detail) VALUES ($1,$2,$3,$4)', [id, ev, actor || 'cli', JSON.stringify(detail || {})]);

/**
 * Create a tenant: registry row -> schema -> every init file (translated) -> first admin -> verify -> active.
 * All DDL runs in ONE transaction: any failure rolls the schema back completely (PostgreSQL DDL is transactional); the registry row is then
 * recorded as 'failed' so the slug is not silently reused.
 */
export async function provisionTenant(c, { root, slug, name, adminUser = 'admin', adminPassword, adminFullName = 'مدير النظام', company = {}, schemaVersion, plan, maxUsers, customDomain, contactEmail, actor, log = console }) {
  const probs = slugProblems(slug); if (probs.length) throw new Error(probs.join('; '));
  if (!name || name.length > 200) throw new Error('name is required (max 200 chars)');
  if (!adminPassword || adminPassword.length < 12) throw new Error('admin password must be at least 12 characters');
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(adminUser)) throw new Error('admin username must be 3-50 chars (letters, digits . _ -)');
  const schema = schemaFor(slug);
  await c.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    const ext = await extensionSchema(c);
    const dir = path.join(root, 'db', 'init');
    const files = tenantInitFiles(await readdir(dir));
    const prepared = [];
    for (const f of files) {                                       // translate + verify EVERYTHING before touching the database
      const sql = rewriteForTenant(await readFile(path.join(dir, f), 'utf8'), schema, ext);
      const left = leftoverPublic(sql, ext); if (left.length) throw new Error(`${f}: still references public (line ${left[0].line}: ${left[0].text})`);
      prepared.push([f, sql]);
    }
    const { rows: [dup] } = await c.query('SELECT 1 FROM platform.tenants WHERE slug=$1 OR schema_name=$2 OR ($3::text IS NOT NULL AND custom_domain=$3)', [slug, schema, customDomain || null]);
    if (dup) throw new Error(`tenant "${slug}" (or its schema / domain) already exists`);
    const { rows: [t] } = await c.query(
      "INSERT INTO platform.tenants(slug,name,schema_name,status,plan,max_users,custom_domain,contact_email) VALUES ($1,$2,$3,'provisioning',coalesce($4,'standard'),$5,$6,$7) RETURNING *",
      [slug, name, schema, plan || null, maxUsers || null, customDomain || null, contactEmail || null]);
    try {
      await c.query('BEGIN');
      for (const s of schemaPreamble(schema)) await c.query(s);
      await c.query(`SET LOCAL search_path = ${quoteIdent(schema)}, ${ext}`);   // new objects land in the tenant schema; pgcrypto stays reachable
      for (const [f, sql] of prepared) { try { await c.query(sql); } catch (e) { throw new Error(`${f}: ${e.message}`); } }
      // company profile (060_seed inserted a demo row: replace it with the customer's real data)
      const co = { name_ar: name, name_en: company.name_en || name, vat_number: company.vat_number || null, cr_number: company.cr_number || null, city: company.city || null };
      await c.query('UPDATE company SET name_ar=$1, name_en=$2, vat_number=$3, cr_number=$4, city=coalesce($5,city) WHERE id=1', [co.name_ar, co.name_en, co.vat_number, co.cr_number, co.city]);
      await c.query("SELECT create_user($1,$2,'admin',$3)", [adminUser, adminPassword, adminFullName]);
      // proof of isolation: every table of the tenant schema exists, and the ledger chain verifies on an empty book
      const { rows: [chk] } = await c.query("SELECT (SELECT count(*) FROM pg_tables WHERE schemaname=$1)::int tables, (SELECT count(*) FROM users)::int users", [schema]);
      const missing = await verifyTenant(c, root, { schema_name: schema });     // same expected-schema check migrate runs for public (null = file absent)
      if (missing?.length) throw new Error(`new schema is incomplete, missing: ${missing.slice(0, 8).join(', ')}`);
      if (chk.tables < 1) throw new Error('no tables were created');
      const { rows: [v] } = await c.query("SELECT value->>'version' v FROM app_settings WHERE key='schema'");
      await c.query('COMMIT');
      await c.query("UPDATE platform.tenants SET status='active', activated_at=now(), provisioned_version=$2, last_error=NULL WHERE id=$1", [t.id, schemaVersion || v?.v || null]);
      await event(c, t.id, 'provisioned', actor, { schema, files: prepared.length, tables: chk.tables });
      log.info?.(`tenant ${slug} provisioned in schema ${schema} (${chk.tables} tables, ${prepared.length} files)`);
      return { ...t, status: 'active', tables: chk.tables };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      await c.query("UPDATE platform.tenants SET status='failed', last_error=$2 WHERE id=$1", [t.id, String(e.message).slice(0, 500)]);
      await event(c, t.id, 'provision_failed', actor, { error: String(e.message).slice(0, 500) });
      throw e;
    }
  } finally { await c.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {}); }
}

export async function listTenants(c) { return (await c.query('SELECT id,slug,name,schema_name,status,is_default,plan,max_users,custom_domain,provisioned_version,created_at FROM platform.tenants ORDER BY id')).rows; }

export async function setStatus(c, slug, status, { reason, actor } = {}) {
  if (!['active', 'suspended', 'archived'].includes(status)) throw new Error('status must be active, suspended or archived');
  const { rows: [t] } = await c.query(
    `UPDATE platform.tenants SET status=$2, suspended_at = CASE WHEN $2='active' THEN NULL ELSE coalesce(suspended_at, now()) END, suspended_reason = CASE WHEN $2='active' THEN NULL ELSE $3 END
     WHERE slug=$1 AND status <> 'provisioning' AND status <> 'failed' RETURNING *`, [slug, status, reason || null]);
  if (!t) throw new Error(`tenant "${slug}" not found or not in a state that can change`);
  await event(c, t.id, 'status_' + status, actor, { reason: reason || null });
  return t;
}

/** Per-tenant integrity report: tables present vs db/schema-expected.json (same check migrate runs for public). */
export async function verifyTenant(c, root, tenant) {
  let exp; try { exp = JSON.parse(await readFile(path.join(root, 'db', 'schema-expected.json'), 'utf8')); } catch { return null; }
  const { rows } = await c.query("SELECT table_name t, column_name col FROM information_schema.columns WHERE table_schema=$1", [tenant.schema_name]);
  const have = new Map(); for (const r of rows) { if (!have.has(r.t)) have.set(r.t, new Set()); have.get(r.t).add(r.col); }
  const missing = []; for (const [t, cols] of Object.entries(exp)) { if (!have.has(t)) { missing.push(t + ' (table)'); continue; } for (const col of cols) if (!have.get(t).has(col)) missing.push(t + '.' + col); }
  return missing;
}

export { DEFAULT_SCHEMA };
