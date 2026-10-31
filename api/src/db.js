import pg from 'pg';
import { als, isMultiTenant, currentTenant } from './tenancy.js';
import { searchPathFor, assertSchemaName } from './tenant-sql.js';
// NUMERIC must stay a string (never a JS float) when it travels to the client.
pg.types.setTypeParser(1700, v => v);
pg.types.setTypeParser(20, v => (Number.isSafeInteger(Number(v)) ? Number(v) : v));
pg.types.setTypeParser(1082, v => v); // DATE as 'YYYY-MM-DD'
pg.types.setTypeParser(1114, v => v); // TIMESTAMP (Saudi wall-clock time, no zone) stays a plain string 'YYYY-MM-DD HH:MM:SS'

const CONN = process.env.DATABASE_URL || 'postgres://erpx_app:erpx_app_dev@localhost:5434/erpx';
const mkPool = (extra = {}) => new pg.Pool({ connectionString: CONN, max: Number(process.env.PG_POOL_MAX || 10), statement_timeout: 30000, ...extra });

/** Pool on the default schema (public). Single-company mode uses only this one; multi-tenant mode uses it for the registry and health checks. */
export const pool = mkPool();

// ---- multi-tenant: ONE small pool per tenant whose connections are born with search_path = <tenant schema>. ----
// Fixed at connection start (libpq "options"), so it can never leak between requests the way a per-query SET could.
// Not compatible with PgBouncer in transaction mode (it drops startup options): use session pooling or connect directly.
const MAX_TENANT_POOLS = Number(process.env.PG_MAX_TENANT_POOLS || 40);
const tenantPools = new Map();                                   // schema -> Pool (Map order = least recently used first)
let extSchema = process.env.PG_EXT_SCHEMA || 'public';           // schema that holds pgcrypto (set once by server start via setExtSchema)
export const setExtSchema = s => { extSchema = s; };

function poolForSchema(schema) {
  assertSchemaName(schema);
  let p = tenantPools.get(schema);
  if (p) { tenantPools.delete(schema); tenantPools.set(schema, p); return p; }       // refresh LRU position
  p = mkPool({ max: Number(process.env.PG_TENANT_POOL_MAX || 4), idleTimeoutMillis: 30000, options: `-c search_path=${searchPathFor(schema, extSchema)}` });
  p.on('error', () => { /* an idle client died: the pool replaces it on the next use */ });
  tenantPools.set(schema, p);
  while (tenantPools.size > MAX_TENANT_POOLS) { const [k, old] = tenantPools.entries().next().value; tenantPools.delete(k); old.end().catch(() => {}); }
  return p;
}

/** The pool this call must use. Multi-tenant mode FAILS CLOSED: no tenant in context = error, never "fall back to public". */
function active() {
  if (!isMultiTenant()) return { pool, schema: 'public' };
  const t = currentTenant();
  if (!t) throw Object.assign(new Error('tenant context missing'), { statusCode: 500 });
  return { pool: poolForSchema(t.schema_name), schema: t.schema_name };
}

export const q = (text, params) => active().pool.query(text, params);
/** Platform-level read (registry, health): always the default pool, never a tenant schema. */
export const qPlatform = (text, params) => pool.query(text, params);

/** Run fn inside ONE transaction; every audit row / entry gets the acting user. In multi-tenant mode the connection is verified to sit on the tenant's schema. */
export async function tx(user, fn) {
  const { pool: p, schema } = active();
  const c = await p.connect();
  try {
    await c.query('BEGIN');
    const { rows: [r] } = await c.query("SELECT set_config('erpx.user', $1, true) u, current_schema() s", [user]);
    if (isMultiTenant() && r.s !== schema) throw new Error(`tenant isolation check failed: connection is on schema ${r.s}, expected ${schema}`);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) { try { await c.query('ROLLBACK'); } catch {} throw e; }
  finally { c.release(); }
}

/** Close every pool (tests / graceful shutdown). */
export async function closeAll() { await Promise.allSettled([pool.end(), ...[...tenantPools.values()].map(p => p.end())]); tenantPools.clear(); }
export { als };
