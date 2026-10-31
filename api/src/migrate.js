// Automatic, SAFE schema upgrade. https://oklent.net/
// Why: db/init/*.sql run only when a Postgres volume is created for the first time. A volume built by an older package therefore lacked the
// 0.4/0.5 tables (owners, bookings, technicians, stock, Saudi geography) and every related screen answered "500 internal error".
// What it does at API start (needs OWNER_DATABASE_URL; without it the check is skipped and health reports the state):
//   1. takes an advisory lock (two containers never migrate at once);
//   2. recognises the database by what really exists (not by a version label): complete / no platform tables / HALF-upgraded (some platform
//      tables exist, e.g. 125/130/160 were applied by hand before 120) and repairs it with the idempotent 121_platform_repair.sql;
//      each file runs in its own transaction (all-or-nothing); business data is never deleted;
//   3. verifies the result against db/schema-expected.json and reports every table/column that is still missing.
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { rewriteForTenant, leftoverPublic, quoteIdent, tenantInitFiles } from './tenant-sql.js';
import { applyPlatform, registerDefaultTenant, extensionSchema, LOCK_KEY } from './tenant-admin.js';

export const SCHEMA_EXPECTED = '0.17.0';
// objects introduced by 120_platform.sql (all of them must exist together, or none)
const PLATFORM = ['sa_regions', 'sa_cities', 'sa_districts', 'unit_types', 'owners', 'property_ownership', 'technicians', 'bookings', 'booking_lines', 'stock_moves'];
const BASE = ['company', 'accounts', 'journal_entries', 'stores', 'store_site', 'products', 'online_orders', 'vendor_bills'];   // everything from 010..110

const exists = async (c, t, schema = 'public') => (await c.query('SELECT to_regclass($1) r', [schema + '.' + t])).rows[0].r !== null;
// idempotent catch-up files, in order (shared by the default schema and every tenant schema)
export const CATCH_UP = ['150_schema_version.sql', '160_fixes_0_5.sql', '170_fixes_0_6.sql', '175_grants.sql', '180_hr_payroll_custody_expenses.sql', '185_hr_grants.sql', '190_booking_products.sql', '200_inventory_costing_invoice_lines.sql', '210_idempotency.sql', '220_fleet.sql', '230_ai.sql', '240_account_profile.sql', '250_stock_valuation_repair.sql', '260_stock_valuation_60pct.sql'];
export const ALWAYS = ['270_reports_daily_repair.sql', '280_hr_settings_org.sql', '290_totp.sql', '300_zatca_phase2.sql'];

/** Pure classifier (unit-testable): which state is the database in? */
export function classify(has) {
  const missingBase = BASE.filter(t => !has[t]);
  const platform = PLATFORM.filter(t => has[t]);
  if (missingBase.length === BASE.length) return { state: 'empty' };                       // nothing yet: the Docker init scripts will create it
  if (missingBase.length) return { state: 'broken', detail: 'missing base tables: ' + missingBase.join(', ') };
  if (platform.length === 0) return { state: 'pre_platform' };                             // 0.3 / 0.4 volume: add the whole platform schema
  if (platform.length < PLATFORM.length) return { state: 'repair', detail: 'half-upgraded platform schema, missing: ' + PLATFORM.filter(t => !has[t]).join(', ') };
  return { state: 'platform' };
}

// schema: 'public' (default) or a tenant schema. For a tenant the file is translated (tests/tenant-unit.mjs proves every file translates cleanly)
// and runs with search_path = tenant schema first, so unqualified names can never reach another company's tables.
async function applyFile(client, dir, name, log, { schema = 'public', ext = 'public' } = {}) {
  let sql = await readFile(path.join(dir, name), 'utf8');
  if (schema !== 'public') {
    sql = rewriteForTenant(sql, schema, ext);
    const left = leftoverPublic(sql, ext); if (left.length) throw new Error(`${name}: not tenant-safe (line ${left[0].line})`);
  }
  await client.query('BEGIN');
  try {
    if (schema !== 'public') await client.query(`SET LOCAL search_path = ${quoteIdent(schema)}, ${ext}`);
    await client.query(sql); await client.query('COMMIT'); log.info(`migration applied${schema !== 'public' ? ` [${schema}]` : ''}: ${name}`);
  }
  catch (e) { await client.query('ROLLBACK').catch(() => {}); throw new Error(`${name}: ${e.message}`); }
}

/** Which expected tables/columns (db/schema-expected.json, generated from a fresh install) are missing? */
export async function verifySchema(client, dir, schema = 'public') {
  let exp; try { exp = JSON.parse(await readFile(path.join(dir, '..', 'schema-expected.json'), 'utf8')); } catch { return null; }
  const { rows } = await client.query("SELECT table_name t, column_name c FROM information_schema.columns WHERE table_schema=$1", [schema]);
  const have = new Map(); for (const r of rows) { if (!have.has(r.t)) have.set(r.t, new Set()); have.get(r.t).add(r.c); }
  const missing = []; for (const [t, cols] of Object.entries(exp)) { if (!have.has(t)) { missing.push(t + ' (table)'); continue; } for (const c of cols) if (!have.get(t).has(c)) missing.push(t + '.' + c); }
  return missing;
}

export async function migrate({ ownerUrl, root, log, multiTenant = /^(1|true|yes)$/i.test(String(process.env.MULTI_TENANT || '')) }) {
  if (!ownerUrl) return { ran: false, reason: 'OWNER_DATABASE_URL not set' };
  const dir = path.join(root, 'db', 'init');
  const client = new pg.Client({ connectionString: ownerUrl, connectionTimeoutMillis: 8000 });
  try { await client.connect(); } catch (e) { return { ran: false, reason: 'cannot connect as database owner: ' + e.message }; }
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    const has = {}; for (const t of new Set([...BASE, ...PLATFORM, 'app_settings'])) has[t] = await exists(client, t);
    const cls = classify(has); const applied = [];
    if (cls.state === 'empty') return { ran: false, reason: 'database not initialised yet' };
    if (cls.state === 'broken') return { ran: false, error: cls.detail };
    if (cls.state !== 'platform') {
      if (cls.detail) log.warn(`repairing: ${cls.detail}`);
      await applyFile(client, dir, '121_platform_repair.sql', log); applied.push('121_platform_repair.sql');
      // geography: (re)load the official list only while no booking references it (the file itself refuses otherwise)
      if (Number((await client.query('SELECT count(*) n FROM bookings')).rows[0].n) === 0) { await applyFile(client, dir, '125_geo_saudi.sql', log); applied.push('125_geo_saudi.sql'); }
    }
    if (!has.app_settings) { await applyFile(client, dir, '140_menu_settings.sql', log); applied.push('140_menu_settings.sql'); }
    // idempotent catch-up files: always safe to re-run
    const { rows: [v] } = await client.query("SELECT value->>'version' v FROM app_settings WHERE key='schema'").catch(() => ({ rows: [{}] }));
    const priv = (await client.query("SELECT bool_and(has_table_privilege('erpx_app', 'public.' || t, 'SELECT')) ok FROM unnest($1::text[]) t", [PLATFORM])).rows[0].ok;
    if (v?.v !== SCHEMA_EXPECTED || !priv) for (const f of CATCH_UP) { await applyFile(client, dir, f, log); applied.push(f); }
    // Report functions predate the catch-up migration sequence. Re-apply their safe grants on every start so
    // an older database can run all reports even when its original 070_privileges.sql was incomplete.
    for (const f of ALWAYS) { await applyFile(client, dir, f, log); applied.push(f); }
    const missing = await verifySchema(client, dir);
    const out = { ran: true, applied, missing };
    if (multiTenant) out.tenants = await migrateTenants({ client, dir, root, log, applied });
    return out;
  } catch (e) { return { ran: false, error: e.message }; }
  finally { await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {}); await client.end().catch(() => {}); }
}

/** Multi-tenant part of the upgrade: registry -> default tenant -> every active tenant schema brought to SCHEMA_EXPECTED. One tenant failing never stops the others. */
async function migrateTenants({ client, dir, root, log }) {
  await applyPlatform(client, root);
  const def = await registerDefaultTenant(client, { slug: process.env.DEFAULT_TENANT_SLUG || 'default', version: SCHEMA_EXPECTED });
  if (def && def.provisioned_version !== SCHEMA_EXPECTED) await client.query('UPDATE platform.tenants SET provisioned_version=$2 WHERE id=$1', [def.id, SCHEMA_EXPECTED]);
  const ext = await extensionSchema(client);
  const { rows: ts } = await client.query("SELECT * FROM platform.tenants WHERE status IN ('active','suspended') AND NOT is_default ORDER BY id");
  const report = [];
  for (const t of ts) {
    try {
      if (!(await exists(client, 'company', t.schema_name))) throw new Error('schema has no company table (provisioning incomplete?)');
      const { rows: [v] } = await client.query(`SELECT value->>'version' v FROM ${quoteIdent(t.schema_name)}.app_settings WHERE key='schema'`).catch(() => ({ rows: [{}] }));
      const applied = [];
      if (v?.v !== SCHEMA_EXPECTED) {
        for (const f of CATCH_UP) { await applyFile(client, dir, f, log, { schema: t.schema_name, ext }); applied.push(f); }
        for (const f of ALWAYS) { await applyFile(client, dir, f, log, { schema: t.schema_name, ext }); applied.push(f); }
      }
      const missing = await verifySchema(client, dir, t.schema_name);
      if (missing?.length) throw new Error('schema check: missing ' + missing.slice(0, 6).join(', '));
      await client.query('UPDATE platform.tenants SET provisioned_version=$2, last_error=NULL WHERE id=$1', [t.id, SCHEMA_EXPECTED]);
      report.push({ slug: t.slug, ok: true, applied });
    } catch (e) {
      await client.query('UPDATE platform.tenants SET last_error=$2 WHERE id=$1', [t.id, String(e.message).slice(0, 500)]);
      log.error(`tenant ${t.slug}: ${e.message}`); report.push({ slug: t.slug, ok: false, error: e.message });
    }
  }
  return report;
}
