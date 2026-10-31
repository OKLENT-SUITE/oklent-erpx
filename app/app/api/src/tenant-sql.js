// Multi-tenant SQL helpers (pure: no database, no dependencies). https://oklent.net/
//
// Design: SCHEMA-PER-TENANT. Every customer gets its own PostgreSQL schema (t_<slug>) holding a full copy of the accounting tables,
// the rules/triggers and the SECURITY DEFINER functions. Hash chains, invoice counters, unique codes and the "one company row" rule are
// therefore per customer by construction, and no existing query needs a tenant_id column.
// The existing install (schema "public") stays valid: it is registered as the default tenant, so upgrading never moves data.
//
// The db/init/*.sql files are written for "public". rewriteForTenant() makes a mechanical, fully-checked translation:
//   SET search_path = public, pg_temp      ->  SET search_path = "t_x", <extension schema>, pg_temp
//   ... IN SCHEMA public / ON SCHEMA public ->  ... "t_x"
//   'public' (information_schema probes)   ->  'tenant schema'
//   public.<name> / 'public.' || ...       ->  "t_x".<name>
// and assertTenantSql() refuses any file that still mentions public in a way the translation does not understand.

export const PLATFORM_SCHEMA = 'platform';
export const DEFAULT_SCHEMA = 'public';

// Files that are GLOBAL (roles, first admin, demo catalogue) and are never replayed inside a tenant schema.
export const SKIP_FOR_TENANT = new Set(['000_roles.sh', '090_admin.sh', '130_demo_catalog.sql']);

const RESERVED = new Set(['public', 'platform', 'information_schema', 'pg_catalog', 'pg_temp', 'pg_toast', 'default', 'admin', 'api', 'www', 'app', 'shop', 'static', 'uploads', 'health', 'login', 'system', 'root', 'test', 'demo']);
const SLUG_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;          // 3..32 chars, subdomain-safe

/** Validates a tenant slug (also used as sub-domain). Returns a list of problems (empty = valid). */
export function slugProblems(slug) {
  const p = [];
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) p.push('slug must be 3-32 chars: lowercase letters, digits and hyphens, starting with a letter');
  else {
    if (slug.includes('--')) p.push('slug must not contain two hyphens in a row');
    if (RESERVED.has(slug)) p.push(`slug "${slug}" is reserved`);
  }
  return p;
}

/** slug -> PostgreSQL schema name. Hyphens become underscores; the "t_" prefix keeps it clear of every system schema. */
export function schemaFor(slug) {
  const p = slugProblems(slug); if (p.length) throw new Error(p.join('; '));
  return 't_' + slug.replace(/-/g, '_');
}

const IDENT_RE = /^[a-z_][a-z0-9_]{0,62}$/;
/** Any schema name that reaches SQL text must pass this (defence in depth: the name is also double-quoted). */
export function assertSchemaName(schema) {
  if (typeof schema !== 'string' || !IDENT_RE.test(schema)) throw new Error('invalid schema name');
  if (schema !== DEFAULT_SCHEMA && !/^t_[a-z0-9_]+$/.test(schema)) throw new Error('tenant schema must start with t_');
  return schema;
}
export const quoteIdent = s => '"' + assertSchemaName(s) + '"';

/** Order the init files the same way docker-entrypoint-initdb.d does (plain sort) and drop the global ones. */
export function tenantInitFiles(allNames) {
  return [...allNames].filter(n => /\.sql$/.test(n) && !SKIP_FOR_TENANT.has(n)).sort();
}

/**
 * Translate one init file for a tenant schema.
 * extSchema = the schema that holds pgcrypto (digest/crypt/gen_salt); it is "public" on a standard install.
 */
export function rewriteForTenant(sql, schema, extSchema = DEFAULT_SCHEMA) {
  assertSchemaName(schema); if (!IDENT_RE.test(extSchema)) throw new Error('invalid extension schema');
  if (schema === DEFAULT_SCHEMA) return sql;                       // the default tenant IS public: nothing to translate
  const Q = quoteIdent(schema);
  return sql
    // 1. function search_path (the only place "public" is used as a resolution path)
    .replace(/SET search_path = public, pg_temp/g, `SET search_path = ${Q}, ${extSchema}, pg_temp`)
    // 2. grants
    .replace(/\b(IN|ON) SCHEMA public\b/g, `$1 SCHEMA ${Q}`)
    // 3. information_schema probes written as table_schema='public'
    .replace(/table_schema\s*=\s*'public'/g, `table_schema='${schema}'`)
    // 4. explicit qualification inside strings and identifiers: to_regprocedure('public.' || sig), GRANT ... public.%s
    .replace(/'public\.'/g, `'${schema}.'`)
    .replace(/\bpublic\.%s/g, `${Q}.%s`)
    .replace(/\bpublic\.([a-z_][a-z0-9_]*)/g, `${Q}.$1`);
}

/**
 * Returns the list of places where "public" is still present after translation (comments are ignored).
 * An empty list means the file is safe to run inside a tenant schema. Used by tests/tenant-unit.mjs for EVERY init file,
 * so a future migration that sneaks in a hard-coded public reference fails CI instead of leaking into the default tenant.
 */
export function leftoverPublic(sqlAfter, extSchema = DEFAULT_SCHEMA) {
  const out = [];
  sqlAfter.split('\n').forEach((line, i) => {
    const code = line.replace(/--.*$/, '');
    // allowed: the extension schema inside the translated search_path, and the PUBLIC pseudo-role (REVOKE ... FROM PUBLIC)
    const stripped = code.replace(new RegExp(`,\\s*${extSchema}\\s*,\\s*pg_temp`, 'g'), '').replace(/\bFROM PUBLIC\b|\bTO PUBLIC\b/g, '');
    if (/\bpublic\b/.test(stripped)) out.push({ line: i + 1, text: line.trim().slice(0, 160) });
  });
  return out;
}

/** The statements that run once, right after a tenant schema is created and before its first file. */
export function schemaPreamble(schema) {
  const Q = quoteIdent(schema);
  return [`CREATE SCHEMA ${Q}`, `GRANT USAGE ON SCHEMA ${Q} TO erpx_app`];
}

/** Per-connection search_path of a tenant pool (libpq "options", so no quoting): the tenant schema first, then the schema that holds pgcrypto. Names are validated, never user text. */
export const searchPathFor = (schema, extSchema = DEFAULT_SCHEMA) => {
  assertSchemaName(schema); if (!IDENT_RE.test(extSchema)) throw new Error('invalid extension schema');
  return schema === DEFAULT_SCHEMA ? DEFAULT_SCHEMA : `${schema},${extSchema}`;
};
