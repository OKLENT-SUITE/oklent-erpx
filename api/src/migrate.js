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

export const SCHEMA_EXPECTED = '0.7.0';
// objects introduced by 120_platform.sql (all of them must exist together, or none)
const PLATFORM = ['sa_regions', 'sa_cities', 'sa_districts', 'unit_types', 'owners', 'property_ownership', 'technicians', 'bookings', 'booking_lines', 'stock_moves'];
const BASE = ['company', 'accounts', 'journal_entries', 'stores', 'store_site', 'products', 'online_orders', 'vendor_bills'];   // everything from 010..110

const exists = async (c, t) => (await c.query('SELECT to_regclass($1) r', ['public.' + t])).rows[0].r !== null;

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

async function applyFile(client, dir, name, log) {
  const sql = await readFile(path.join(dir, name), 'utf8');
  await client.query('BEGIN');
  try { await client.query(sql); await client.query('COMMIT'); log.info(`migration applied: ${name}`); }
  catch (e) { await client.query('ROLLBACK').catch(() => {}); throw new Error(`${name}: ${e.message}`); }
}

/** Which expected tables/columns (db/schema-expected.json, generated from a fresh install) are missing? */
export async function verifySchema(client, dir) {
  let exp; try { exp = JSON.parse(await readFile(path.join(dir, '..', 'schema-expected.json'), 'utf8')); } catch { return null; }
  const { rows } = await client.query("SELECT table_name t, column_name c FROM information_schema.columns WHERE table_schema='public'");
  const have = new Map(); for (const r of rows) { if (!have.has(r.t)) have.set(r.t, new Set()); have.get(r.t).add(r.c); }
  const missing = []; for (const [t, cols] of Object.entries(exp)) { if (!have.has(t)) { missing.push(t + ' (table)'); continue; } for (const c of cols) if (!have.get(t).has(c)) missing.push(t + '.' + c); }
  return missing;
}

export async function migrate({ ownerUrl, root, log }) {
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
    if (v?.v !== SCHEMA_EXPECTED || !priv) for (const f of ['150_schema_version.sql', '160_fixes_0_5.sql', '170_fixes_0_6.sql', '175_grants.sql', '180_hr_payroll_custody_expenses.sql', '185_hr_grants.sql']) { await applyFile(client, dir, f, log); applied.push(f); }
    const missing = await verifySchema(client, dir);
    return { ran: true, applied, missing };
  } catch (e) { return { ran: false, error: e.message }; }
  finally { await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {}); await client.end().catch(() => {}); }
}
